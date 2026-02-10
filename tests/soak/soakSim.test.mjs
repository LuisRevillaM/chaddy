import assert from "node:assert/strict";
import test from "node:test";

import { SimExchange } from "../../packages/sim/src/SimExchange.js";

test("soak: long sim run stays bounded", { skip: process.env.PROVE_SLOW !== "1" }, () => {
  const ex = new SimExchange({ seed: 999, tickSize: 0.01, mid: 0.5, extSpread: 0.02 });
  for (let i = 0; i < 20_000; i++) ex.step();

  // Basic boundedness: open orders should not grow without us placing any.
  assert.equal(ex.orders.size, 0);
});

