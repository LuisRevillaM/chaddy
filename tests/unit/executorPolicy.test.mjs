import assert from "node:assert/strict";
import test from "node:test";

import { validateOrderPolicy } from "../../packages/executor/src/policy.js";
import { Executor } from "../../packages/executor/src/Executor.js";

test("validateOrderPolicy: rejects with explicit stable reason codes", () => {
  const policy = {
    allowedMarkets: ["m1"],
    minOrderSize: 1,
    maxOrderSize: 10,
    maxAbsNotional: 1,
    maxPriceBand: 0.2
  };
  const midpoint = 0.5;

  assert.deepEqual(
    validateOrderPolicy({ market: "m2", side: "BUY", price: 0.5, size: 1 }, policy, { midpoint }),
    { ok: false, reason: "market_not_allowed" }
  );
  assert.deepEqual(
    validateOrderPolicy({ market: "m1", side: "BUY", price: 0.5, size: 0 }, policy, { midpoint }),
    { ok: false, reason: "size_out_of_bounds" }
  );
  assert.deepEqual(
    validateOrderPolicy({ market: "m1", side: "BUY", price: 0.0, size: 1 }, policy, { midpoint }),
    { ok: false, reason: "price_out_of_bounds" }
  );
  assert.deepEqual(
    validateOrderPolicy({ market: "m1", side: "BUY", price: 0.5, size: 10 }, policy, { midpoint }),
    { ok: false, reason: "notional_cap_exceeded" }
  );
  assert.deepEqual(
    validateOrderPolicy({ market: "m1", side: "BUY", price: 0.1, size: 1 }, policy, { midpoint }),
    { ok: false, reason: "price_out_of_band" }
  );
  assert.deepEqual(
    validateOrderPolicy({ market: "m1", side: "BUY", price: 0.5, size: 1 }, policy, { midpoint }),
    { ok: true, reason: null }
  );
});

test("Executor: geoblock is enforced before any trading action", () => {
  const calls = { place: 0, cancel: 0, cancelAll: 0 };
  const exchange = {
    placeOrder: () => {
      calls.place += 1;
      return "order_1";
    },
    cancelOrder: () => {
      calls.cancel += 1;
      return true;
    },
    cancelAll: () => {
      calls.cancelAll += 1;
      return 0;
    }
  };

  const exec = new Executor({
    exchange,
    policy: {
      allowedMarkets: ["m1"],
      minOrderSize: 1,
      maxOrderSize: 10,
      maxAbsNotional: 100,
      maxPriceBand: null
    },
    marketMidpoint: () => 0.5
  });

  const prevGeo = process.env.GEO_ALLOWED;
  try {
    delete process.env.GEO_ALLOWED;

    const p = exec.placeOrder({ market: "m1", side: "BUY", price: 0.5, size: 1 });
    assert.deepEqual(p, { ok: false, reason: "geoblocked", orderId: null });
    assert.equal(calls.place, 0);

    const c = exec.cancelOrder("order_1");
    assert.deepEqual(c, { ok: false, reason: "geoblocked" });
    assert.equal(calls.cancel, 0);

    const ca = exec.cancelAll();
    assert.deepEqual(ca, { ok: false, reason: "geoblocked", canceled: 0 });
    assert.equal(calls.cancelAll, 0);
  } finally {
    if (prevGeo == null) delete process.env.GEO_ALLOWED;
    else process.env.GEO_ALLOWED = prevGeo;
  }
});
