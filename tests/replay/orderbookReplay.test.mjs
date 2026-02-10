import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ResyncingOrderbook } from "../../packages/mm-core/src/orderbook/ResyncingOrderbook.js";

test("replay: orderbook reaches expected top-of-book", async () => {
  const fixturePath = fileURLToPath(new URL("./fixtures/orderbook-resync-gap.json", import.meta.url));
  const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));

  const ob = new ResyncingOrderbook({ tickSize: fixture.tickSize });

  /** @type {Array<Record<string, unknown>>} */
  const trace = [];
  /** @type {{ have: number, got: number } | null} */
  let seenGap = null;

  for (let i = 0; i < fixture.events.length; i++) {
    const e = fixture.events[i];

    let action = "unknown";
    let applied = null;
    if (e.type === "snapshot") {
      ({ action } = ob.applySnapshot({ seq: e.seq, bids: e.bids, asks: e.asks }));
    } else if (e.type === "delta") {
      const r = ob.applyDelta({ seq: e.seq, side: e.side, price: e.price, size: e.size });
      action = r.action;
      applied = r.applied;
      if (r.gap && !seenGap) seenGap = r.gap;
    } else {
      throw new Error(`Unknown event type: ${String(e.type)}`);
    }

    trace.push({
      i,
      type: e.type,
      seq: e.seq,
      side: e.side,
      price: e.price,
      size: e.size,
      nBids: e.bids ? e.bids.length : undefined,
      nAsks: e.asks ? e.asks.length : undefined,
      action,
      applied,
      needsResync: ob.needsResync,
      gap: ob.lastGap,
      bestBid: ob.bestBid(),
      bestAsk: ob.bestAsk(),
      obSeq: ob.seq
    });
  }

  assert.deepEqual(seenGap, fixture.expected.gapAt);
  assert.deepEqual(ob.bestBid(), fixture.expected.bestBid);
  assert.deepEqual(ob.bestAsk(), fixture.expected.bestAsk);
  assert.equal(ob.seq, fixture.expected.finalSeq);
  assert.equal(ob.needsResync, false);

  const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
  if (outDir) {
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(
      path.join(outDir, "orderbook-final.json"),
      JSON.stringify({ bestBid: ob.bestBid(), bestAsk: ob.bestAsk(), seq: ob.seq }, null, 2) + "\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(outDir, "replay-trace.jsonl"),
      trace.map((row) => JSON.stringify(row)).join("\n") + "\n",
      "utf8"
    );
  }
});
