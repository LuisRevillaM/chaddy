import assert from "node:assert/strict";
import test from "node:test";

import { parsePolymarketMarketChannelLine } from "../../packages/mm-core/src/polymarket/parseMarketChannelLine.js";

test("unit: market channel parser accepts book snapshots using buys/sells", () => {
  const line = JSON.stringify({
    event_type: "book",
    buys: [[0.51, 40]],
    sells: [{ price: "0.53", size: "60" }]
  });

  const parsed = parsePolymarketMarketChannelLine(line);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].kind, "snapshot");
  assert.deepEqual(parsed.events[0].bids, [[0.51, 40]]);
  assert.deepEqual(parsed.events[0].asks, [[0.53, 60]]);
});

test("unit: market channel parser accepts snapshots by shape (buys/sells without event_type)", () => {
  const line = JSON.stringify({
    buys: [{ price: 0.1, size: 1 }],
    sells: [{ price: 0.2, size: 2 }]
  });

  const parsed = parsePolymarketMarketChannelLine(line);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].kind, "snapshot");
  assert.deepEqual(parsed.events[0].bids, [[0.1, 1]]);
  assert.deepEqual(parsed.events[0].asks, [[0.2, 2]]);
});

test("unit: market channel parser treats best_bid_ask as a top-of-book snapshot", () => {
  const line = JSON.stringify({
    event_type: "best_bid_ask",
    best_bid: 0.12,
    best_ask: 0.14
  });

  const parsed = parsePolymarketMarketChannelLine(line);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].kind, "snapshot");
  assert.deepEqual(parsed.events[0].bids, [[0.12, 1]]);
  assert.deepEqual(parsed.events[0].asks, [[0.14, 1]]);
});
