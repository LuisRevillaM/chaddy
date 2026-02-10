import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { ResyncingOrderbook } from "../../packages/mm-core/src/orderbook/ResyncingOrderbook.js";
import { OrderTracker } from "../../packages/mm-core/src/state/orderTracker.js";
import { PositionTracker } from "../../packages/mm-core/src/state/positionTracker.js";
import { parsePolymarketMarketChannelLine } from "../../packages/mm-core/src/polymarket/parseMarketChannelLine.js";
import { parsePolymarketUserChannelLine } from "../../packages/mm-core/src/polymarket/parseUserChannelLine.js";

async function readJsonlLines(p) {
  const text = await fs.readFile(p, "utf8");
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

test("replay: polymarket fixtures parse and update orderbook + trackers", async () => {
  const marketPath = path.join(process.cwd(), "tests", "replay", "fixtures", "polymarket-market-channel.jsonl");
  const userPath = path.join(process.cwd(), "tests", "replay", "fixtures", "polymarket-user-channel.jsonl");

  const marketLines = await readJsonlLines(marketPath);
  const userLines = await readJsonlLines(userPath);
  assert.ok(marketLines.length >= 1);
  assert.ok(userLines.length >= 1);

  const ob = new ResyncingOrderbook({ tickSize: 0.01 });
  const orders = new OrderTracker();
  const pos = new PositionTracker();
  let seq = 0;

  /** @type {Array<Record<string, unknown>>} */
  const trace = [];

  for (let i = 0; i < marketLines.length; i++) {
    const line = marketLines[i];
    const parsed = parsePolymarketMarketChannelLine(line);
    if (!parsed.ok) {
      trace.push({ src: "market", i, ok: false, error: parsed.error });
      assert.fail(`market parse failed at line ${i}: ${parsed.error.code}`);
    }

    for (const ev of parsed.events) {
      if (ev.kind === "snapshot") {
        seq += 1;
        ob.applySnapshot({ seq, bids: ev.bids, asks: ev.asks });
        trace.push({ src: "market", i, ok: true, kind: ev.kind, seq, meta: ev.meta, bestBid: ob.bestBid(), bestAsk: ob.bestAsk() });
        continue;
      }
      if (ev.kind === "delta") {
        seq += 1;
        const r = ob.applyDelta({ seq, side: ev.side, price: ev.price, size: ev.size });
        trace.push({
          src: "market",
          i,
          ok: true,
          kind: ev.kind,
          seq,
          meta: ev.meta,
          applied: r.applied,
          action: r.action,
          needsResync: ob.needsResync,
          bestBid: ob.bestBid(),
          bestAsk: ob.bestAsk()
        });
        continue;
      }
      trace.push({ src: "market", i, ok: false, error: { code: "unknown_internal_event", message: "Unknown internal market event", details: { ev } } });
      assert.fail(`unknown internal market event at line ${i}`);
    }
  }

  for (let i = 0; i < userLines.length; i++) {
    const line = userLines[i];
    const parsed = parsePolymarketUserChannelLine(line);
    if (!parsed.ok) {
      trace.push({ src: "user", i, ok: false, error: parsed.error });
      assert.fail(`user parse failed at line ${i}: ${parsed.error.code}`);
    }
    for (const ev of parsed.events) {
      orders.applyUserEvent(ev);
      pos.applyUserEvent(ev);
      trace.push({
        src: "user",
        i,
        ok: true,
        type: ev.type,
        orderId: ev.orderId,
        side: ev.side,
        price: ev.price,
        size: ev.size,
        meta: ev.meta,
        position: pos.position,
        liveOrders: orders.liveOrders().length
      });
    }
  }

  const final = {
    orderbook: { bestBid: ob.bestBid(), bestAsk: ob.bestAsk(), seq: ob.seq, needsResync: ob.needsResync },
    position: pos.position,
    fills: { fillCount: pos.fillCount, duplicateFillCount: pos.duplicateFillCount },
    liveOrders: orders.liveOrders()
  };

  // Deterministic expectations based on fixtures.
  assert.deepEqual(final.orderbook.bestBid, { price: 0.51, size: 40 });
  assert.deepEqual(final.orderbook.bestAsk, { price: 0.53, size: 60 });
  assert.equal(final.position, -10);
  assert.equal(final.liveOrders.length, 0);

  const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
  if (outDir) {
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, "polymarket-replay-trace.jsonl"), trace.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    await fs.writeFile(path.join(outDir, "polymarket-final.json"), JSON.stringify(final, null, 2) + "\n", "utf8");
  }
});

