import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { Executor } from "../../packages/executor/src/Executor.js";
import { createMockScoringChecker } from "../../packages/mm-core/src/scoring/mockScoringChecker.js";
import { runMarketLifecycle } from "../../packages/mm-core/src/runner/marketLifecycle.js";
import { OrderTracker } from "../../packages/mm-core/src/state/orderTracker.js";
import { PositionTracker } from "../../packages/mm-core/src/state/positionTracker.js";
import { _resetIdsForTesting } from "../../packages/shared/src/ids.js";
import { SimExchange } from "../../packages/sim/src/SimExchange.js";

test("sim: market lifecycle exits with cancel-all + resets state for next market", async () => {
  const prevGeo = process.env.GEO_ALLOWED;
  try {
    process.env.GEO_ALLOWED = "1";
    _resetIdsForTesting();

    // Use a wider external spread to avoid accidental fills during lifecycle phases.
    const ex = new SimExchange({ seed: 77, tickSize: 0.01, mid: 0.5, extSpread: 0.10 });
    const scoringChecker = createMockScoringChecker({ minSize: 1, requireTopOfBook: true });

    const marketA = "mkt_LIFE_A";
    const marketB = "mkt_LIFE_B";
    const STEP_MS = 1_000;

    // External deterministic state observer (driven by user events only).
    const orders = new OrderTracker();
    const pos = new PositionTracker();
    ex.on("user", (msg) => {
      orders.applyUserEvent(msg);
      pos.applyUserEvent(msg);
    });

    const mkExecutor = (market, midpointRef) =>
      new Executor({
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

    const midpointRefA = { value: null };
    const midpointRefB = { value: null };
    const execA = mkExecutor(marketA, midpointRefA);
    const execB = mkExecutor(marketB, midpointRefB);

    /** @type {(exec: any, midpointRef: {value:number|null}) => import("../../packages/mm-core/src/runner/mmCoreLoop.js").MmCoreLoopDeps} */
    const mkDeps = (exec, midpointRef) => ({
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
    });

    /** @type {import("../../packages/mm-core/src/runner/mmCoreLoop.js").MmCoreLoopConfig} */
    const loopA = {
      market: marketA,
      steps: 10,
      activeMarketSteps: 10,
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
      // Use a generous user-data staleness threshold to avoid cancel-all during the phase.
      killSwitchCfg: { staleMarketDataMs: 5_000, staleUserDataMs: 60_000 },
      diffCfg: {
        priceTolerance: 0,
        sizeTolerance: 0,
        maxCancelsPerCycle: 10,
        maxPlacesPerCycle: 10
      },
      // Make phase behavior stable: place once, then hold orders.
      throttle: { minIntervalMs: 999_999 },
      tokenBucket: { capacity: 10, refillEveryMs: 1_000 },
      scoringCfg: { minSize: 1, requireTopOfBook: true },
      traceMax: 80
    };

    /** @type {import("../../packages/mm-core/src/runner/mmCoreLoop.js").MmCoreLoopConfig} */
    const loopB = {
      ...loopA,
      market: marketB,
      steps: 8,
      activeMarketSteps: 8,
      traceMax: 80
    };

    const lifecycle = runMarketLifecycle({
      a: { market: marketA, loopCfg: loopA, deps: mkDeps(execA, midpointRefA) },
      b: { market: marketB, loopCfg: loopB, deps: mkDeps(execB, midpointRefB) },
      observe: () => ({ liveOrders: orders.liveOrders(), position: pos.position })
    });

    // Phase A should place at least one order and leave them live (no kill-switch in this phase).
    assert.ok(lifecycle.a.churnSummary.placeOk > 0, JSON.stringify(lifecycle.a.churnSummary));
    assert.equal(lifecycle.a.final.cancelAllTriggered, false);
    assert.ok(lifecycle.a.stateFinal.liveOrders.length > 0, JSON.stringify(lifecycle.a.stateFinal));

    // Exit must cancel all live orders, and post-exit there must be zero live orders.
    assert.equal(lifecycle.exit.ok, true);
    assert.equal(lifecycle.exit.reason, null);
    assert.equal(lifecycle.exit.canceled, lifecycle.a.stateFinal.liveOrders.length);
    assert.ok(lifecycle.snapshots.after_exit, "after_exit snapshot must exist");
    assert.equal(lifecycle.snapshots.after_exit.liveOrders.length, 0, JSON.stringify(lifecycle.snapshots.after_exit));

    // Reset snapshot should still be clean before market B starts.
    assert.ok(lifecycle.snapshots.after_reset, "after_reset snapshot must exist");
    assert.equal(lifecycle.snapshots.after_reset.liveOrders.length, 0, JSON.stringify(lifecycle.snapshots.after_reset));

    // Market B should operate from a clean slate and place orders.
    assert.ok(lifecycle.b.churnSummary.placeOk > 0, JSON.stringify(lifecycle.b.churnSummary));
    assert.ok(lifecycle.b.stateFinal.liveOrders.length > 0, JSON.stringify(lifecycle.b.stateFinal));

    // No order id leakage between phases.
    const aIds = new Set(lifecycle.a.stateFinal.liveOrders.map((o) => o.id));
    for (const o of lifecycle.b.stateFinal.liveOrders) {
      assert.ok(!aIds.has(o.id), `order id leaked from A to B: ${o.id}`);
    }

    const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
    if (outDir) {
      await fs.mkdir(outDir, { recursive: true });

      const summarize = (market, r) => ({
        market,
        churn: {
          steps: r.churnSummary.steps,
          quoteUpdateCycles: r.churnSummary.quoteUpdateCycles,
          placeOk: r.churnSummary.placeOk,
          cancelOk: r.churnSummary.cancelOk,
          cancelAllCalls: r.churnSummary.cancelAllCalls,
          cancelAllCanceled: r.churnSummary.cancelAllCanceled,
          tokenBucketDenied: r.churnSummary.tokenBucketDenied,
          killSwitch: r.churnSummary.killSwitch
        },
        scoringTotals: r.scoringSummary.totals,
        stateFinal: {
          position: r.stateFinal.position,
          fillCount: r.stateFinal.fillCount,
          liveOrders: r.stateFinal.liveOrders.map((o) => ({ id: o.id, side: o.side, price: o.price, size: o.size }))
        },
        final: r.final
      });

      const artifact = {
        meta: {
          tickSize: ex.tickSize,
          stepMs: STEP_MS,
          markets: [marketA, marketB]
        },
        phaseA: summarize(marketA, lifecycle.a),
        exit: {
          cancelAll: lifecycle.exit,
          afterExit: lifecycle.snapshots.after_exit
        },
        reset: {
          ...lifecycle.reset,
          afterReset: lifecycle.snapshots.after_reset
        },
        phaseB: summarize(marketB, lifecycle.b)
      };

      await fs.writeFile(path.join(outDir, "market-lifecycle.json"), JSON.stringify(artifact, null, 2) + "\n", "utf8");
    }
  } finally {
    if (prevGeo == null) delete process.env.GEO_ALLOWED;
    else process.env.GEO_ALLOWED = prevGeo;
  }
});
