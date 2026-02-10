import assert from "node:assert/strict";
import test from "node:test";

import { ClobClient } from "../../packages/executor/src/polymarket/ClobClient.js";
import { PolymarketRestExecutor } from "../../packages/executor/src/polymarket/PolymarketRestExecutor.js";

test("PolymarketRestExecutor: guardrails reject before any network call", async () => {
  let fetchCalls = 0;
  const mockFetch = async () => {
    fetchCalls += 1;
    return { ok: true, json: async () => ({ orderId: "order_1" }) };
  };

  const client = new ClobClient({ fetchImpl: mockFetch, baseUrl: "https://clob.polymarket.com", authHeaders: { "x-api-key": "k" } });

  const policy = {
    allowedMarkets: ["tok_ok"],
    minOrderSize: 1,
    maxOrderSize: 10,
    maxAbsNotional: 100,
    maxPriceBand: 0.2
  };

  const ex = new PolymarketRestExecutor({
    client,
    policy,
    marketMidpoint: () => 0.5,
    geoAllowed: () => true
  });

  const deniedMarket = await ex.placeOrder({ market: "tok_no", side: "BUY", price: 0.5, size: 1 });
  assert.deepEqual(deniedMarket, { ok: false, reason: "market_not_allowed", orderId: null });
  assert.equal(fetchCalls, 0);

  const deniedSize = await ex.placeOrder({ market: "tok_ok", side: "BUY", price: 0.5, size: 0 });
  assert.deepEqual(deniedSize, { ok: false, reason: "size_out_of_bounds", orderId: null });
  assert.equal(fetchCalls, 0);

  const deniedBand = await ex.placeOrder({ market: "tok_ok", side: "BUY", price: 0.1, size: 1 });
  assert.deepEqual(deniedBand, { ok: false, reason: "price_out_of_band", orderId: null });
  assert.equal(fetchCalls, 0);

  const ok = await ex.placeOrder({ market: "tok_ok", side: "BUY", price: 0.5, size: 1 });
  assert.equal(ok.ok, true);
  assert.equal(fetchCalls, 1);
});

test("PolymarketRestExecutor: refuses when geoblocked (no network)", async () => {
  let fetchCalls = 0;
  const mockFetch = async () => {
    fetchCalls += 1;
    return { ok: true, json: async () => ({ orderId: "order_1" }) };
  };

  const client = new ClobClient({ fetchImpl: mockFetch, baseUrl: "https://clob.polymarket.com" });

  const policy = {
    allowedMarkets: ["tok_ok"],
    minOrderSize: 1,
    maxOrderSize: 10,
    maxAbsNotional: 100,
    maxPriceBand: 0.2
  };

  const ex = new PolymarketRestExecutor({
    client,
    policy,
    marketMidpoint: () => 0.5,
    geoAllowed: () => false
  });

  const r = await ex.placeOrder({ market: "tok_ok", side: "BUY", price: 0.5, size: 1 });
  assert.deepEqual(r, { ok: false, reason: "geoblocked", orderId: null });
  assert.equal(fetchCalls, 0);
});

