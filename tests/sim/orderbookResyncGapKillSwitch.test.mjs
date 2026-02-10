import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { Executor } from "../../packages/executor/src/Executor.js";
import { runMmCoreLoop } from "../../packages/mm-core/src/runner/mmCoreLoop.js";
import { createMockScoringChecker } from "../../packages/mm-core/src/scoring/mockScoringChecker.js";
import { _resetIdsForTesting } from "../../packages/shared/src/ids.js";
import { SimExchange } from "../../packages/sim/src/SimExchange.js";

test("sim: orderbook seq gap triggers resync-gap kill-switch cancel-all", async () => {
  const prevGeo = process.env.GEO_ALLOWED;
  try {
    process.env.GEO_ALLOWED = "1";
    _resetIdsForTesting();

    const marketEmitter = new EventEmitter();
    let step = 0;

    const stepMarket = () => {
      // Snapshot then contiguous delta, then a gap delta (seq jump) to force resync.
      if (step === 0) {
        marketEmitter.emit("market", { type: "book", seq: 1, bids: [[0.5, 15]], asks: [[0.52, 25]] });
      } else if (step === 1) {
        marketEmitter.emit("market", { type: "price_change", seq: 2, side: "bid", price: 0.51, size: 40 });
      } else if (step === 2) {
        // Gap: expected seq=3, we send seq=4.
        marketEmitter.emit("market", { type: "price_change", seq: 4, side: "ask", price: 0.52, size: 0 });
      }
      step += 1;
    };

    const ex = new SimExchange({ seed: 5, tickSize: 0.01, mid: 0.5, extSpread: 0.10 });
    const market = "mkt_gap";
    const STEP_MS = 1_000;
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

    const scoringChecker = createMockScoringChecker({ minSize: 1, requireTopOfBook: true });

    const result = runMmCoreLoop(
      {
        market,
        steps: 3,
        activeMarketSteps: 3,
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
        killSwitchCfg: { staleMarketDataMs: 30_000, staleUserDataMs: 60_000 },
        diffCfg: {
          priceTolerance: 0,
          sizeTolerance: 0,
          maxCancelsPerCycle: 10,
          maxPlacesPerCycle: 10
        },
        // Place once in step 0, then hold so the resync-gap cancel-all has something to cancel.
        throttle: { minIntervalMs: 999_999 },
        tokenBucket: { capacity: 10, refillEveryMs: 1_000 },
        scoringCfg: { minSize: 1, requireTopOfBook: true },
        traceMax: 50
      },
      {
        onMarket: (cb) => {
          marketEmitter.on("market", cb);
          return () => marketEmitter.off("market", cb);
        },
        onUser: (cb) => {
          ex.on("user", cb);
          return () => ex.off("user", cb);
        },
        stepMarket,
        executor: exec,
        scoringChecker,
        midpointRef
      }
    );

    assert.equal(result.churnSummary.placeOk, 2, JSON.stringify(result.churnSummary));
    assert.equal(result.final.cancelAllTriggered, true);
    assert.equal(result.churnSummary.killSwitch.lastReason, "orderbook_resync_gap");
    assert.equal(result.stateFinal.liveOrders.length, 0, JSON.stringify(result.stateFinal));

    const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
    if (outDir) {
      await fs.mkdir(outDir, { recursive: true });
      await fs.writeFile(
        path.join(outDir, "orderbook-resync-gap-killswitch.json"),
        JSON.stringify(
          {
            meta: { steps: 3, stepMs: STEP_MS },
            churnSummary: result.churnSummary,
            final: result.final,
            stateFinal: result.stateFinal,
            trace: result.trace.map((e) => ({
              i: e.i,
              nowMs: e.nowMs,
              marketSeq: e.marketSeq,
              bestBid: e.bestBid,
              bestAsk: e.bestAsk,
              killSwitch: e.killSwitch
            }))
          },
          null,
          2
        ) + "\n",
        "utf8"
      );
    }
  } finally {
    if (prevGeo == null) delete process.env.GEO_ALLOWED;
    else process.env.GEO_ALLOWED = prevGeo;
  }
});

