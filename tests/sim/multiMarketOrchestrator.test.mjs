import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { Executor } from "../../packages/executor/src/Executor.js";
import { createMockScoringChecker } from "../../packages/mm-core/src/scoring/mockScoringChecker.js";
import { runMultiMarketOrchestrator } from "../../packages/mm-core/src/runner/multiMarketOrchestrator.js";
import { _resetIdsForTesting } from "../../packages/shared/src/ids.js";
import { SimExchange } from "../../packages/sim/src/SimExchange.js";

test("sim: multi-market orchestrator isolates kill-switch + state per market", async () => {
  const prevGeo = process.env.GEO_ALLOWED;
  try {
    process.env.GEO_ALLOWED = "1";
    _resetIdsForTesting();

    const scoringChecker = createMockScoringChecker({ minSize: 1, requireTopOfBook: true });
    const STEP_MS = 1_000;

    const mk = ({ market, seed, mid, activeMarketSteps, steps }) => {
      const ex = new SimExchange({ seed, tickSize: 0.01, mid, extSpread: 0.04 });
      const midpointRef = { value: null };

      const exec = new Executor({
        exchange: ex,
        policy: {
          allowedMarkets: [market],
          minOrderSize: 1,
          maxOrderSize: 50,
          maxAbsNotional: 1_000,
          maxPriceBand: 0.2
        },
        marketMidpoint: () => midpointRef.value
      });

      /** @type {import("../../packages/mm-core/src/runner/mmCoreLoop.js").MmCoreLoopConfig} */
      const loopCfg = {
        market,
        steps,
        activeMarketSteps,
        stepMs: STEP_MS,
        quoteCfg: {
          tickSize: ex.tickSize,
          halfSpread: 0.02,
          maxSpread: 0.1,
          minSize: 1,
          orderSize: 1,
          inventoryTarget: 10,
          maxSkew: 0.02
        },
        killSwitchCfg: { staleMarketDataMs: 5_000, staleUserDataMs: 10_000 },
        diffCfg: {
          priceTolerance: 0,
          sizeTolerance: 0,
          maxCancelsPerCycle: 10,
          maxPlacesPerCycle: 10
        },
        throttle: { minIntervalMs: 3_000 },
        tokenBucket: { capacity: 4, refillEveryMs: 2_000 },
        scoringCfg: { minSize: 1, requireTopOfBook: true },
        traceMax: 120
      };

      /** @type {import("../../packages/mm-core/src/runner/mmCoreLoop.js").MmCoreLoopDeps} */
      const deps = {
        onMarket: (cb) => {
          ex.on("market", cb);
          return () => ex.off("market", cb);
        },
        onUser: (cb) => {
          ex.on("user", cb);
          return () => ex.off("user", cb);
        },
        stepMarket: () => ex.step(),
        executor: exec,
        scoringChecker,
        midpointRef
      };

      return { market, seed, loopCfg, deps };
    };

    const scenarios = [
      // Two markets that will go stale (kill-switch triggers) at different times.
      mk({ market: "mkt_A", seed: 101, mid: 0.50, activeMarketSteps: 10, steps: 24 }),
      // One market that stays active for the entire run (no kill-switch).
      mk({ market: "mkt_B", seed: 202, mid: 0.62, activeMarketSteps: 24, steps: 24 }),
      mk({ market: "mkt_C", seed: 303, mid: 0.44, activeMarketSteps: 8, steps: 22 })
    ];

    const result = runMultiMarketOrchestrator(
      scenarios.map((s) => ({ market: s.market, loopCfg: s.loopCfg, deps: s.deps }))
    );

    assert.equal(result.perMarket.length, scenarios.length);

    const byMarket = Object.fromEntries(result.perMarket.map((r) => [r.market, r]));

    assert.equal(byMarket.mkt_A.final.cancelAllTriggered, true);
    assert.equal(byMarket.mkt_A.churnSummary.killSwitch.lastReason, "stale_market_data");
    assert.ok(byMarket.mkt_A.churnSummary.placeOk > 0);
    assert.equal(byMarket.mkt_A.stateFinal.liveOrders.length, 0);

    assert.equal(byMarket.mkt_C.final.cancelAllTriggered, true);
    assert.equal(byMarket.mkt_C.churnSummary.killSwitch.lastReason, "stale_market_data");
    assert.ok(byMarket.mkt_C.churnSummary.placeOk > 0);
    assert.equal(byMarket.mkt_C.stateFinal.liveOrders.length, 0);

    // Independence: cancel-all in other markets must not propagate to mkt_B.
    assert.equal(byMarket.mkt_B.final.cancelAllTriggered, false);
    assert.equal(byMarket.mkt_B.churnSummary.killSwitch.cancelAllCalls, 0);
    assert.ok(byMarket.mkt_B.churnSummary.placeOk > 0);

    const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
    if (outDir) {
      await fs.mkdir(outDir, { recursive: true });

      const summary = {
        meta: {
          stepMs: STEP_MS,
          markets: scenarios.map((s) => ({
            market: s.market,
            seed: s.seed,
            steps: s.loopCfg.steps,
            activeMarketSteps: s.loopCfg.activeMarketSteps
          }))
        },
        perMarket: result.perMarket.map((r) => ({
          market: r.market,
          final: r.final,
          churn: {
            quoteUpdateCycles: r.churnSummary.quoteUpdateCycles,
            placeOk: r.churnSummary.placeOk,
            cancelOk: r.churnSummary.cancelOk,
            cancelAllCalls: r.churnSummary.cancelAllCalls,
            cancelAllCanceled: r.churnSummary.cancelAllCanceled,
            tokenBucketDenied: r.churnSummary.tokenBucketDenied,
            killSwitch: r.churnSummary.killSwitch
          },
          scoringTotals: r.scoringSummary.totals,
          stateFinal: { position: r.stateFinal.position, liveOrders: r.stateFinal.liveOrders.length }
        }))
      };

      await fs.writeFile(path.join(outDir, "multi-market-summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");

      const traceLines = [];
      for (const e of result.trace) {
        traceLines.push(
          JSON.stringify({
            market: e.market,
            i: e.i,
            nowMs: e.nowMs,
            marketSeq: e.marketSeq,
            bestBid: e.bestBid ? { price: e.bestBid.price, size: e.bestBid.size } : null,
            bestAsk: e.bestAsk ? { price: e.bestAsk.price, size: e.bestAsk.size } : null,
            inventory: e.inventory,
            liveOrders: e.liveOrders,
            killSwitch: e.killSwitch,
            ops: {
              canceled: Array.isArray(e.canceled) ? e.canceled.length : 0,
              placed: Array.isArray(e.placed) ? e.placed.length : 0,
              placedOk: Array.isArray(e.placed) ? e.placed.filter((p) => p.ok).length : 0
            },
            scoring: e.scoring
              ? { buy: { scoring: e.scoring.buy.scoring, reason: e.scoring.buy.reason }, sell: { scoring: e.scoring.sell.scoring, reason: e.scoring.sell.reason } }
              : null
          })
        );
      }
      await fs.writeFile(path.join(outDir, "multi-market-trace.jsonl"), traceLines.join("\n") + "\n", "utf8");
    }
  } finally {
    if (prevGeo == null) delete process.env.GEO_ALLOWED;
    else process.env.GEO_ALLOWED = prevGeo;
  }
});

