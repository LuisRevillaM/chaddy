import assert from "node:assert/strict";
import test from "node:test";

import { PositionTracker } from "../../packages/mm-core/src/state/positionTracker.js";

test("PositionTracker: tracks inventory from fills (and de-dupes identical fills)", () => {
  const t = new PositionTracker();
  assert.equal(t.position, 0);

  t.applyUserEvent({ type: "fill", orderId: "o1", side: "BUY", price: 0.5, size: 3 });
  assert.equal(t.position, 3);
  assert.equal(t.fillCount, 1);
  assert.equal(t.duplicateFillCount, 0);

  // Duplicate fill should not double-count.
  t.applyUserEvent({ type: "fill", orderId: "o1", side: "BUY", price: 0.5, size: 3 });
  assert.equal(t.position, 3);
  assert.equal(t.fillCount, 1);
  assert.equal(t.duplicateFillCount, 1);

  t.applyUserEvent({ type: "fill", orderId: "o2", side: "SELL", price: 0.51, size: 2 });
  assert.equal(t.position, 1);
  assert.equal(t.fillCount, 2);

  // Non-fill events are ignored.
  t.applyUserEvent({ type: "order_open", orderId: "o3", side: "BUY", price: 0.5, size: 1 });
  assert.equal(t.position, 1);
});

