import assert from "node:assert/strict";
import test from "node:test";

import { OrderTracker } from "../../packages/mm-core/src/state/orderTracker.js";

test("OrderTracker: tracks live orders from user events", () => {
  const t = new OrderTracker();

  t.applyUserEvent({ type: "order_open", orderId: "o1", side: "BUY", price: 0.5, size: 10 });
  assert.deepEqual(t.liveOrders(), [{ id: "o1", side: "BUY", price: 0.5, size: 10 }]);

  t.applyUserEvent({ type: "fill", orderId: "o1", side: "BUY", price: 0.51, size: 3 });
  assert.deepEqual(t.liveOrders(), [{ id: "o1", side: "BUY", price: 0.5, size: 7 }]);

  t.applyUserEvent({ type: "order_closed", orderId: "o1" });
  assert.deepEqual(t.liveOrders(), []);

  t.applyUserEvent({ type: "order_open", orderId: "o2", side: "SELL", price: 0.55, size: 5 });
  t.applyUserEvent({ type: "order_canceled", orderId: "o2" });
  assert.deepEqual(t.liveOrders(), []);
});

test("OrderTracker: fails loudly on inconsistent sequences", () => {
  const t = new OrderTracker();

  assert.throws(() => t.applyUserEvent({ type: "order_canceled", orderId: "missing" }), /unknown orderId/);

  t.applyUserEvent({ type: "order_open", orderId: "o1", side: "BUY", price: 0.5, size: 10 });
  assert.throws(() => t.applyUserEvent({ type: "order_open", orderId: "o1", side: "BUY", price: 0.5, size: 10 }), /duplicate/);
  assert.throws(() => t.applyUserEvent({ type: "fill", orderId: "o1", side: "BUY", price: 0.5, size: 11 }), /exceeds remaining/);
});

