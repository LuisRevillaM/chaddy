import assert from "node:assert/strict";
import test from "node:test";

import { fetchOrderbookSnapshot, parseBestBidAskFromDeltaEvent, shouldLatchCancelAll } from "../../scripts/run-paper-live.mjs";

test("unit: parseBestBidAskFromDeltaEvent extracts top-of-book from delta metadata", () => {
  const ev = { meta: { best_bid: "0.008", best_ask: "0.009" } };
  const seeded = parseBestBidAskFromDeltaEvent(ev);
  assert.deepEqual(seeded, { bids: [[0.008, 1]], asks: [[0.009, 1]] });
});

test("unit: parseBestBidAskFromDeltaEvent rejects invalid or crossed metadata", () => {
  assert.equal(parseBestBidAskFromDeltaEvent({ meta: { best_bid: "x", best_ask: "0.2" } }), null);
  assert.equal(parseBestBidAskFromDeltaEvent({ meta: { best_bid: "0.2", best_ask: "0.2" } }), null);
  assert.equal(parseBestBidAskFromDeltaEvent({ meta: { best_bid: "0.3", best_ask: "0.2" } }), null);
});

test("unit: shouldLatchCancelAll does not latch startup no-market-data kill switch", () => {
  assert.equal(shouldLatchCancelAll("no_market_data_yet"), false);
  assert.equal(shouldLatchCancelAll("stale_market_data"), true);
  assert.equal(shouldLatchCancelAll("orderbook_crossed"), true);
});

test("unit: fetchOrderbookSnapshot normalizes levels and handles statuses", async () => {
  const okFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      bids: [
        ["0.11", "5"],
        { price: 0.1, size: 0 },
        { price: "bad", size: 2 }
      ],
      asks: [{ price: "0.12", size: "7" }]
    })
  });
  const ok = await fetchOrderbookSnapshot({ baseUrl: "https://clob.polymarket.com", tokenId: "abc", fetchImpl: okFetch });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.bids, [[0.11, 5]]);
  assert.deepEqual(ok.asks, [[0.12, 7]]);

  const nonOkFetch = async () => ({ ok: false, status: 429 });
  const nonOk = await fetchOrderbookSnapshot({ baseUrl: "https://clob.polymarket.com", tokenId: "abc", fetchImpl: nonOkFetch });
  assert.deepEqual(nonOk, { ok: false, status: 429 });

  const emptyFetch = async () => ({ ok: true, status: 200, json: async () => ({ bids: [], asks: [] }) });
  const empty = await fetchOrderbookSnapshot({ baseUrl: "https://clob.polymarket.com", tokenId: "abc", fetchImpl: emptyFetch });
  assert.deepEqual(empty, { ok: false, status: 200 });
});

