import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { Executor } from "../../packages/executor/src/Executor.js";
import { runMmCoreLoop } from "../../packages/mm-core/src/runner/mmCoreLoop.js";
import { parsePolymarketMarketChannelLine } from "../../packages/mm-core/src/polymarket/parseMarketChannelLine.js";
import { createMockScoringChecker } from "../../packages/mm-core/src/scoring/mockScoringChecker.js";
import { _resetIdsForTesting } from "../../packages/shared/src/ids.js";
import { SimExchange } from "../../packages/sim/src/SimExchange.js";

async function readJsonlLines(p) {
  const text = await fs.readFile(p, "utf8");
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

test("sim: polymarket market-channel replay (snapshot+delta) drives mm-core loop", async () => {
  const prevGeo = process.env.GEO_ALLOWED;
  try {
    process.env.GEO_ALLOWED = "1";
    _resetIdsForTesting();

    const fixturePath = path.join(process.cwd(), "tests", "replay", "fixtures", "polymarket-market-channel.jsonl");
    const lines = await readJsonlLines(fixturePath);
    assert.ok(lines.length >= 2, "fixture should include at least snapshot + one delta message");

    const marketEmitter = new EventEmitter();
    let lineIdx = 0;
    let seq = 0;

    const stepMarket = () => {
      if (lineIdx >= lines.length) return;
      const parsed = parsePolymarketMarketChannelLine(lines[lineIdx++]);
      assert.ok(parsed.ok, JSON.stringify(parsed.ok ? null : parsed.error));
      for (const ev of parsed.events) {
        seq += 1;
        if (ev.kind === "snapshot") {
          marketEmitter.emit("market", { type: "book", seq, bids: ev.bids, asks: ev.asks });
        } else if (ev.kind === "delta") {
          marketEmitter.emit("market", { type: "price_change", seq, side: ev.side, price: ev.price, size: ev.size });
        } else {
          assert.fail(`unknown internal event kind: ${String(ev.kind)}`);
        }
      }
    };

    // Use SimExchange only as a deterministic user-event source for the executor boundary.
    const ex = new SimExchange({ seed: 999, tickSize: 0.01, mid: 0.5, extSpread: 0.10 });
    const market = "mkt_polymarket_replay";
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
        steps: 2,
        activeMarketSteps: 2,
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
        throttle: { minIntervalMs: 0 },
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

    assert.equal(result.trace.length, 2);
    assert.deepEqual(result.trace[0].bestBid, { price: 0.5, size: 15 });
    assert.deepEqual(result.trace[0].bestAsk, { price: 0.52, size: 25 });
    assert.deepEqual(result.trace[1].bestBid, { price: 0.51, size: 40 });
    assert.deepEqual(result.trace[1].bestAsk, { price: 0.53, size: 60 });

    // Quotes should update after the delta shifts the midpoint.
    assert.equal(result.churnSummary.quoteUpdateCycles, 2, JSON.stringify(result.churnSummary));
    assert.equal(result.churnSummary.placeOk, 4, JSON.stringify(result.churnSummary));
    assert.equal(result.churnSummary.cancelOk, 2, JSON.stringify(result.churnSummary));

    // End state should reflect the second-step desired quotes.
    assert.equal(result.stateFinal.liveOrders.length, 2, JSON.stringify(result.stateFinal));
    const bySide = Object.fromEntries(result.stateFinal.liveOrders.map((o) => [o.side, o]));
    assert.deepEqual({ price: bySide.BUY.price, size: bySide.BUY.size }, { price: 0.5, size: 1 });
    assert.deepEqual({ price: bySide.SELL.price, size: bySide.SELL.size }, { price: 0.54, size: 1 });

    const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
    if (outDir) {
      await fs.mkdir(outDir, { recursive: true });
      await fs.writeFile(
        path.join(outDir, "polymarket-mmcore-replay.json"),
        JSON.stringify(
          {
            meta: { fixture: "tests/replay/fixtures/polymarket-market-channel.jsonl", steps: 2, stepMs: STEP_MS },
            churnSummary: result.churnSummary,
            stateFinal: { position: result.stateFinal.position, liveOrders: result.stateFinal.liveOrders },
            topOfBookByStep: result.trace.map((e) => ({ i: e.i, bestBid: e.bestBid, bestAsk: e.bestAsk }))
          },
          null,
          2
        ) + "\n",
        "utf8"
      );
      await fs.writeFile(
        path.join(outDir, "polymarket-mmcore-trace.jsonl"),
        result.trace.map((e) => JSON.stringify(e)).join("\n") + "\n",
        "utf8"
      );
    }
  } finally {
    if (prevGeo == null) delete process.env.GEO_ALLOWED;
    else process.env.GEO_ALLOWED = prevGeo;
  }
});

