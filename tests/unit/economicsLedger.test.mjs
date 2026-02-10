import assert from "node:assert/strict";
import test from "node:test";

import { EconomicsLedger } from "../../packages/mm-core/src/state/economicsLedger.js";

test("EconomicsLedger: tracks cash/position from fills and computes mark-to-mid PnL", () => {
  const l = new EconomicsLedger({ maxFills: 10 });

  l.applyUserEvent({ type: "fill", orderId: "o1", side: "BUY", price: 0.6, size: 2 });
  assert.equal(l.position, 2);
  assert.equal(l.cash, -1.2);
  assert.equal(l.fillCount, 1);

  l.applyUserEvent({ type: "fill", orderId: "o2", side: "SELL", price: 0.7, size: 1 });
  assert.equal(l.position, 1);
  assert.equal(l.cash, -0.5);
  assert.equal(l.fillCount, 2);

  assert.equal(l.pnlMarkToMid(0.5), 0.0);
});

test("EconomicsLedger: de-dupes identical fills (best-effort)", () => {
  const l = new EconomicsLedger({ maxFills: 10 });
  const fill = { type: "fill", orderId: "o1", side: "BUY", price: 0.5, size: 1 };

  l.applyUserEvent(fill);
  l.applyUserEvent(fill);

  assert.equal(l.fillCount, 1);
  assert.equal(l.duplicateFillCount, 1);
  assert.equal(l.position, 1);
  assert.equal(l.cash, -0.5);
});

test("EconomicsLedger: bounds fill history to maxFills", () => {
  const l = new EconomicsLedger({ maxFills: 2 });
  l.applyUserEvent({ type: "fill", orderId: "a", side: "BUY", price: 0.5, size: 1 });
  l.applyUserEvent({ type: "fill", orderId: "b", side: "BUY", price: 0.5, size: 1 });
  l.applyUserEvent({ type: "fill", orderId: "c", side: "BUY", price: 0.5, size: 1 });

  const j = l.toJSON();
  assert.equal(j.lastFills.length, 2);
  assert.deepEqual(
    j.lastFills.map((x) => x.orderId),
    ["b", "c"]
  );
});

