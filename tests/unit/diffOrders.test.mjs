import assert from "node:assert/strict";
import test from "node:test";

import { diffOrders } from "../../packages/mm-core/src/orderManager/diffOrders.js";

test("diffOrders: places both sides when live is empty", () => {
  const desired = [
    { side: "BUY", price: 0.49, size: 10 },
    { side: "SELL", price: 0.51, size: 10 }
  ];
  const live = [];
  const d = diffOrders(desired, live, {
    priceTolerance: 0,
    sizeTolerance: 0,
    maxCancelsPerCycle: 10,
    maxPlacesPerCycle: 10
  });
  assert.deepEqual(d.cancel, []);
  assert.equal(d.place.length, 2);
});

test("diffOrders: no-op when live already matches desired within tolerance", () => {
  const desired = [
    { side: "BUY", price: 0.49, size: 10 },
    { side: "SELL", price: 0.51, size: 10 }
  ];
  const live = [
    { id: "b1", side: "BUY", price: 0.49, size: 10 },
    { id: "a1", side: "SELL", price: 0.51, size: 10 }
  ];
  const d = diffOrders(desired, live, {
    priceTolerance: 0.001,
    sizeTolerance: 0,
    maxCancelsPerCycle: 10,
    maxPlacesPerCycle: 10
  });
  assert.deepEqual(d.cancel, []);
  assert.deepEqual(d.place, []);
});

test("diffOrders: cancels and replaces when price differs", () => {
  const desired = [
    { side: "BUY", price: 0.49, size: 10 },
    { side: "SELL", price: 0.51, size: 10 }
  ];
  const live = [
    { id: "b1", side: "BUY", price: 0.45, size: 10 },
    { id: "a1", side: "SELL", price: 0.55, size: 10 }
  ];
  const d = diffOrders(desired, live, {
    priceTolerance: 0.001,
    sizeTolerance: 0,
    maxCancelsPerCycle: 10,
    maxPlacesPerCycle: 10
  });
  assert.deepEqual(new Set(d.cancel), new Set(["b1", "a1"]));
  assert.equal(d.place.length, 2);
});

