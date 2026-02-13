import assert from "node:assert/strict";
import test from "node:test";

import { PolymarketOfficialExecutor } from "../../packages/executor/src/polymarket/PolymarketOfficialExecutor.js";

function makePolicy() {
  return {
    allowedMarkets: ["m1"],
    minOrderSize: 1,
    maxOrderSize: 10,
    maxAbsNotional: 100,
    maxPriceBand: 0.2
  };
}

test("PolymarketOfficialExecutor: guardrails reject before attempting network/client", async () => {
  let calls = 0;
  const stub = {
    async createAndPostOrder() {
      calls += 1;
      return { orderID: "o1" };
    }
  };

  const ex = new PolymarketOfficialExecutor({
    client: stub,
    policy: makePolicy(),
    marketMidpoint: () => 0.5,
    geoAllowed: () => true,
    tickSize: 0.001,
    negRisk: false
  });

  const r = await ex.placeOrder({ market: "m2", side: "BUY", price: 0.5, size: 1 });
  assert.deepEqual(r, { ok: false, reason: "market_not_allowed", orderId: null });
  assert.equal(calls, 0);
});

test("PolymarketOfficialExecutor: refuses when geoblocked (no client calls)", async () => {
  let calls = 0;
  const stub = {
    async createAndPostOrder() {
      calls += 1;
      return { orderID: "o1" };
    }
  };

  const ex = new PolymarketOfficialExecutor({
    client: stub,
    policy: makePolicy(),
    marketMidpoint: () => 0.5,
    geoAllowed: () => false,
    tickSize: 0.001,
    negRisk: false
  });

  const r = await ex.placeOrder({ market: "m1", side: "BUY", price: 0.5, size: 1 });
  assert.deepEqual(r, { ok: false, reason: "geoblocked", orderId: null });
  assert.equal(calls, 0);
});

test("PolymarketOfficialExecutor: rejects unsupported tick sizes before loading deps", async () => {
  let calls = 0;
  const stub = {
    async createAndPostOrder() {
      calls += 1;
      return { orderID: "o1" };
    }
  };

  const ex = new PolymarketOfficialExecutor({
    client: stub,
    policy: makePolicy(),
    marketMidpoint: () => 0.5,
    geoAllowed: () => true,
    tickSize: 0.002,
    negRisk: false
  });

  const r = await ex.placeOrder({ market: "m1", side: "BUY", price: 0.5, size: 1 });
  assert.deepEqual(r, { ok: false, reason: "invalid_tick_size", orderId: null });
  assert.equal(calls, 0);
});

