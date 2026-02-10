import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { parsePolymarketMarketChannelLine } from "../../packages/mm-core/src/polymarket/parseMarketChannelLine.js";
import { parsePolymarketUserChannelLine } from "../../packages/mm-core/src/polymarket/parseUserChannelLine.js";
import { runShadowLoop } from "../../packages/mm-core/src/runner/shadowLoop.js";
import { _resetIdsForTesting } from "../../packages/shared/src/ids.js";

async function readJsonlLines(p) {
  const text = await fs.readFile(p, "utf8");
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

test("sim: polymarket fixtures drive event-based shadow loop snapshots (no trading)", async () => {
  _resetIdsForTesting();

  const marketPath = path.join(process.cwd(), "tests", "replay", "fixtures", "polymarket-market-channel.jsonl");
  const userPath = path.join(process.cwd(), "tests", "replay", "fixtures", "polymarket-user-channel.jsonl");
  const marketLines = await readJsonlLines(marketPath);
  const userLines = await readJsonlLines(userPath);
  assert.ok(marketLines.length >= 2);
  assert.ok(userLines.length >= 4);

  const marketEmitter = new EventEmitter();
  const userEmitter = new EventEmitter();

  let seq = 0;
  const emitMarketLine = (line) => {
    const parsed = parsePolymarketMarketChannelLine(line);
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

  const emitUserLine = (line) => {
    const parsed = parsePolymarketUserChannelLine(line);
    assert.ok(parsed.ok, JSON.stringify(parsed.ok ? null : parsed.error));
    for (const ev of parsed.events) userEmitter.emit("user", ev);
  };

  const STEP_MS = 1_000;
  const steps = 5;
  let step = 0;
  const stepMarket = () => {
    if (step === 0) emitMarketLine(marketLines[0]); // snapshot
    if (step === 1) {
      emitMarketLine(marketLines[1]); // delta (2 entries)
      emitUserLine(userLines[0]); // placement: SELL 10 @ 0.53
    }
    if (step === 2) emitUserLine(userLines[1]); // trade match => fill + close
    if (step === 3) emitUserLine(userLines[2]); // placement: BUY 5 @ 0.50
    if (step === 4) emitUserLine(userLines[3]); // cancellation of BUY order
    step += 1;
  };

  const result = runShadowLoop(
    {
      market: "mkt_polymarket_shadow",
      steps,
      activeMarketSteps: steps,
      stepMs: STEP_MS,
      quoteCfg: {
        tickSize: 0.01,
        halfSpread: 0.02,
        maxSpread: 0.1,
        minSize: 1,
        orderSize: 1,
        inventoryTarget: 10,
        maxSkew: 0.02
      },
      killSwitchCfg: { staleMarketDataMs: 10_000, staleUserDataMs: 10_000 },
      traceMax: 50
    },
    {
      onMarket: (cb) => {
        marketEmitter.on("market", cb);
        return () => marketEmitter.off("market", cb);
      },
      onUser: (cb) => {
        userEmitter.on("user", cb);
        return () => userEmitter.off("user", cb);
      },
      stepMarket
    }
  );

  assert.equal(result.history.length, steps);

  assert.deepEqual(result.history[0].orderbook.bestBid, { price: 0.5, size: 15 });
  assert.deepEqual(result.history[0].orderbook.bestAsk, { price: 0.52, size: 25 });
  assert.deepEqual(result.history[0].desiredQuotes, [
    { side: "BUY", price: 0.49, size: 1 },
    { side: "SELL", price: 0.53, size: 1 }
  ]);
  assert.equal(result.history[0].inventory, 0);
  assert.equal(result.history[0].liveOrders.length, 0);
  assert.equal(result.history[0].quoteSuppressedReason, null);

  assert.deepEqual(result.history[1].orderbook.bestBid, { price: 0.51, size: 40 });
  assert.deepEqual(result.history[1].orderbook.bestAsk, { price: 0.53, size: 60 });
  assert.deepEqual(result.history[1].desiredQuotes, [
    { side: "BUY", price: 0.5, size: 1 },
    { side: "SELL", price: 0.54, size: 1 }
  ]);
  assert.equal(result.history[1].inventory, 0);
  assert.equal(result.history[1].liveOrders.length, 1);

  // Inventory changes after the trade match; quotes should skew upward (more eager to buy).
  assert.equal(result.history[2].inventory, -10);
  assert.equal(result.history[2].liveOrders.length, 0);
  assert.deepEqual(result.history[2].desiredQuotes, [
    { side: "BUY", price: 0.52, size: 1 },
    { side: "SELL", price: 0.56, size: 1 }
  ]);

  // BUY order appears then is canceled.
  assert.equal(result.history[3].liveOrders.length, 1);
  assert.equal(result.history[4].liveOrders.length, 0);

  const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
  if (outDir) {
    await fs.mkdir(outDir, { recursive: true });
    const artifact = {
      meta: {
        fixture: {
          market: "tests/replay/fixtures/polymarket-market-channel.jsonl",
          user: "tests/replay/fixtures/polymarket-user-channel.jsonl"
        },
        steps,
        stepMs: STEP_MS
      },
      final: result.final,
      history: result.history.map((h) => ({
        i: h.i,
        nowMs: h.nowMs,
        orderbook: { seq: h.orderbook.seq, bestBid: h.orderbook.bestBid, bestAsk: h.orderbook.bestAsk },
        inventory: h.inventory,
        liveOrders: h.liveOrders.map((o) => ({ id: o.id, side: o.side, price: o.price, size: o.size })),
        quoteSuppressedReason: h.quoteSuppressedReason,
        desiredQuotes: h.desiredQuotes
      }))
    };
    await fs.writeFile(path.join(outDir, "polymarket-shadow-status.json"), JSON.stringify(artifact, null, 2) + "\n", "utf8");
  }
});

