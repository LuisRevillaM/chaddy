import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { Executor } from "../../packages/executor/src/Executor.js";
import { parsePolymarketMarketChannelLine } from "../../packages/mm-core/src/polymarket/parseMarketChannelLine.js";
import { createMockScoringChecker } from "../../packages/mm-core/src/scoring/mockScoringChecker.js";
import { runStartupReconcile } from "../../packages/mm-core/src/runner/startupReconcile.js";
import { OrderTracker } from "../../packages/mm-core/src/state/orderTracker.js";
import { PositionTracker } from "../../packages/mm-core/src/state/positionTracker.js";
import { _resetIdsForTesting } from "../../packages/shared/src/ids.js";
import { SimExchange } from "../../packages/sim/src/SimExchange.js";

async function readJsonlLines(p) {
  const text = await fs.readFile(p, "utf8");
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

test("sim: startup reconcile cancels orphan orders and gates quoting until a snapshot arrives", async () => {
  const prevGeo = process.env.GEO_ALLOWED;
  try {
    process.env.GEO_ALLOWED = "1";
    _resetIdsForTesting();

    // Deterministic exchange used only for user events (no fills; we never call ex.step()).
    const ex = new SimExchange({ seed: 4242, tickSize: 0.01, mid: 0.5, extSpread: 0.10 });

    // External state observer driven by user events only.
    const orders = new OrderTracker();
    const pos = new PositionTracker();
    ex.on("user", (msg) => {
      orders.applyUserEvent(msg);
      pos.applyUserEvent(msg);
    });

    // Pre-existing live orders from a previous run (placed outside the executor boundary).
    ex.placeOrder({ side: "BUY", price: 0.1, size: 1 });
    ex.placeOrder({ side: "SELL", price: 0.9, size: 1 });
    assert.equal(orders.liveOrders().length, 2);

    const market = "mkt_STARTUP";
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

    let cancelAllCalls = 0;
    /** @type {number|null} */
    let liveOrdersAfterCancelAll = null;

    /** @type {import("../../packages/mm-core/src/runner/mmCoreLoop.js").TradeExecutor} */
    const wrappedExec = {
      placeOrder: (req) => exec.placeOrder(req),
      cancelOrder: (id) => exec.cancelOrder(id),
      cancelAll: () => {
        cancelAllCalls += 1;
        const r = exec.cancelAll();
        liveOrdersAfterCancelAll = orders.liveOrders().length;
        return r;
      }
    };

    const scoringChecker = createMockScoringChecker({ minSize: 1, requireTopOfBook: true });

    // Market stream: emit a delta *before* the first snapshot to prove gating.
    const marketEmitter = new EventEmitter();
    const fixturePath = path.join(process.cwd(), "tests", "replay", "fixtures", "polymarket-market-channel.jsonl");
    const lines = await readJsonlLines(fixturePath);
    assert.ok(lines.length >= 2, "fixture should include snapshot + delta line");

    // Reorder: delta first, snapshot second.
    const reordered = [lines[1], lines[0]];
    let seq = 0;
    let idx = 0;

    const stepMarket = () => {
      if (idx >= reordered.length) return;
      const parsed = parsePolymarketMarketChannelLine(reordered[idx++]);
      assert.ok(parsed.ok, JSON.stringify(parsed.ok ? null : parsed.error));
      for (const ev of parsed.events) {
        seq += 1;
        if (ev.kind === "snapshot") {
          marketEmitter.emit("market", { type: "book", seq, bids: ev.bids, asks: ev.asks });
        } else if (ev.kind === "delta") {
          marketEmitter.emit("market", { type: "price_change", seq, side: ev.side, price: ev.price, size: ev.size });
        }
      }
    };

    /** @type {import("../../packages/mm-core/src/runner/mmCoreLoop.js").MmCoreLoopConfig} */
    const loopCfg = {
      market,
      steps: 2,
      activeMarketSteps: 2,
      stepMs: 1_000,
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
      throttle: { minIntervalMs: 0 },
      tokenBucket: { capacity: 10, refillEveryMs: 1_000 },
      scoringCfg: { minSize: 1, requireTopOfBook: true },
      traceMax: 50
    };

    const result = runStartupReconcile(loopCfg, {
      onMarket: (cb) => {
        marketEmitter.on("market", cb);
        return () => marketEmitter.off("market", cb);
      },
      onUser: (cb) => {
        ex.on("user", cb);
        return () => ex.off("user", cb);
      },
      stepMarket,
      executor: wrappedExec,
      scoringChecker,
      midpointRef
    });

    // Cancel-all must be invoked and must clear the pre-existing orders before quoting can begin.
    assert.equal(cancelAllCalls, 1);
    assert.equal(liveOrdersAfterCancelAll, 0, "pre-existing orders must be canceled at startup");

    // Gating: step 0 had only deltas => no top-of-book => no quoting.
    assert.equal(result.gating.firstSnapshotStep, 1);
    assert.equal(result.gating.firstQuoteStep, 1);
    assert.equal(result.loop.trace[0].bestBid, null);
    assert.equal(result.loop.trace[0].bestAsk, null);
    assert.equal(result.loop.trace[0].placed.length, 0);

    // Once snapshot arrives, quoting begins.
    assert.ok(result.loop.trace[1].bestBid && result.loop.trace[1].bestAsk);
    assert.ok(result.loop.trace[1].placed.length > 0);

    // Artifact
    const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
    assert.ok(outDir, "PROVE_OUT_DIR must be set by the harness");
    const artifact = {
      meta: { fixture: "tests/replay/fixtures/polymarket-market-channel.jsonl", market, steps: loopCfg.steps },
      startup: {
        cancelAllCalls,
        liveOrdersAfterCancelAll,
        canceledAtStartup: result.startup.cancelAll
      },
      gating: result.gating,
      trace: result.loop.trace.map((e) => ({
        i: e.i,
        bestBid: e.bestBid,
        bestAsk: e.bestAsk,
        placed: e.placed.length,
        canceled: e.canceled.length
      })),
      final: {
        position: orders.position,
        liveOrders: orders.liveOrders().length
      }
    };
    await fs.writeFile(path.join(outDir, "startup-reconcile.json"), JSON.stringify(artifact, null, 2) + "\n", "utf8");
  } finally {
    if (prevGeo == null) delete process.env.GEO_ALLOWED;
    else process.env.GEO_ALLOWED = prevGeo;
  }
});

