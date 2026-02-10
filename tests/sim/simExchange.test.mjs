import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { Executor } from "../../packages/executor/src/Executor.js";
import { runMmCoreLoop } from "../../packages/mm-core/src/runner/mmCoreLoop.js";
import { createMockScoringChecker } from "../../packages/mm-core/src/scoring/mockScoringChecker.js";
import { _resetIdsForTesting } from "../../packages/shared/src/ids.js";
import { SimExchange } from "../../packages/sim/src/SimExchange.js";

test("sim: deterministic quoting loop is churn-bounded and kill-switch cancels on stale market data", async () => {
  const prevGeo = process.env.GEO_ALLOWED;
  try {
    _resetIdsForTesting();
    const ex = new SimExchange({ seed: 123, tickSize: 0.01, mid: 0.5, extSpread: 0.04 });
    const market = "mkt_1";

    const STEP_MS = 1_000;
    const ACTIVE_STEPS = 30;
    const STALE_STEPS = 10;
    const TOTAL_STEPS = ACTIVE_STEPS + STALE_STEPS;

    // Runner updates this reference when it observes a new book snapshot.
    const midpointRef = { value: null };

    const exec = new Executor({
      exchange: ex,
      policy: {
        allowedMarkets: [market],
        minOrderSize: 1,
        maxOrderSize: 50,
        maxAbsNotional: 10,
        maxPriceBand: 0.20
      },
      marketMidpoint: () => midpointRef.value
    });

    const policyRejections = {
      market_not_allowed: 0,
      size_out_of_bounds: 0,
      price_out_of_bounds: 0,
      notional_cap_exceeded: 0,
      price_out_of_band: 0,
      geoblocked: 0
    };

    // Geoblock: should refuse when GEO_ALLOWED is not set.
    delete process.env.GEO_ALLOWED;
    const denied = exec.placeOrder({ market, side: "BUY", price: 0.5, size: 1 });
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, "geoblocked");
    policyRejections.geoblocked += 1;

    // Allow trading for the rest of the test.
    process.env.GEO_ALLOWED = "1";

    const scoringChecker = createMockScoringChecker({ minSize: 1, requireTopOfBook: true });

    const result = runMmCoreLoop(
      {
        market,
        steps: TOTAL_STEPS,
        activeMarketSteps: ACTIVE_STEPS,
        stepMs: STEP_MS,
        quoteCfg: {
          tickSize: ex.tickSize,
          halfSpread: 0.02,
          maxSpread: 0.10,
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
        traceMax: 400
      },
      {
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
      }
    );

    // Prove kill-switch behavior: market data becomes stale and cancel-all happens.
    assert.equal(result.final.cancelAllTriggered, true);
    assert.equal(result.churnSummary.killSwitch.lastReason, "stale_market_data");
    assert.equal(result.stateFinal.liveOrders.length, 0);

    // Prove churn is bounded by the call budget.
    const executedOps = result.churnSummary.placeOk + result.churnSummary.cancelOk;
    assert.ok(
      executedOps <= result.churnSummary.maxTokensPossible,
      JSON.stringify({
        executedOps,
        maxTokensPossible: result.churnSummary.maxTokensPossible,
        churn: result.churnSummary
      })
    );

    // Prove we observe both scoring and non-scoring states (to avoid "always true" mocks).
    assert.ok(result.scoringSummary.totals.scoring > 0, JSON.stringify(result.scoringSummary.totals));
    assert.ok(result.scoringSummary.totals.nonScoring > 0, JSON.stringify(result.scoringSummary.totals));

    // Policy rejection probes: exercise all rejection reasons once.
    {
      const probes = [
        { market: "mkt_nope", side: "BUY", price: 0.5, size: 1, reason: "market_not_allowed" },
        { market, side: "BUY", price: 0.5, size: 0, reason: "size_out_of_bounds" },
        { market, side: "BUY", price: 0.0, size: 1, reason: "price_out_of_bounds" },
        { market, side: "BUY", price: 0.5, size: 50, reason: "notional_cap_exceeded" },
        { market, side: "BUY", price: 0.1, size: 1, reason: "price_out_of_band" }
      ];
      for (const p of probes) {
        const r = exec.placeOrder(p);
        assert.equal(r.ok, false);
        assert.equal(r.reason, p.reason);
        policyRejections[p.reason] += 1;
      }
    }

    const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
    if (outDir) {
      await fs.mkdir(outDir, { recursive: true });
      await fs.writeFile(path.join(outDir, "churn-summary.json"), JSON.stringify(result.churnSummary, null, 2) + "\n", "utf8");
      await fs.writeFile(path.join(outDir, "scoring-summary.json"), JSON.stringify(result.scoringSummary, null, 2) + "\n", "utf8");
      await fs.writeFile(path.join(outDir, "state-tracker-final.json"), JSON.stringify(result.stateFinal, null, 2) + "\n", "utf8");
      await fs.writeFile(
        path.join(outDir, "sim-trace.jsonl"),
        result.trace.map((e) => JSON.stringify(e)).join("\n") + "\n",
        "utf8"
      );
      await fs.writeFile(path.join(outDir, "policy-rejections.json"), JSON.stringify({ counts: policyRejections }, null, 2) + "\n", "utf8");
    }
  } finally {
    if (prevGeo == null) delete process.env.GEO_ALLOWED;
    else process.env.GEO_ALLOWED = prevGeo;
  }
});
