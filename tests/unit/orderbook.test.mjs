import assert from "node:assert/strict";
import test from "node:test";

import { OrderbookState } from "../../packages/mm-core/src/orderbook/OrderbookState.js";

test("OrderbookState: snapshot sets best bid/ask", () => {
  const ob = new OrderbookState({ tickSize: 0.01 });
  ob.applySnapshot({
    seq: 1,
    bids: [
      [0.49, 100],
      [0.48, 50]
    ],
    asks: [
      [0.51, 120],
      [0.52, 80]
    ]
  });

  assert.deepEqual(ob.bestBid(), { price: 0.49, size: 100 });
  assert.deepEqual(ob.bestAsk(), { price: 0.51, size: 120 });
});

test("OrderbookState: deltas update best bid/ask and enforce contiguous seq", () => {
  const ob = new OrderbookState({ tickSize: 0.01 });
  ob.applySnapshot({ seq: 10, bids: [[0.49, 100]], asks: [[0.51, 100]] });

  ob.applyPriceChange({ seq: 11, side: "bid", price: 0.50, size: 80 });
  assert.deepEqual(ob.bestBid(), { price: 0.50, size: 80 });

  ob.applyPriceChange({ seq: 12, side: "ask", price: 0.51, size: 0 });
  ob.applyPriceChange({ seq: 13, side: "ask", price: 0.52, size: 200 });
  assert.deepEqual(ob.bestAsk(), { price: 0.52, size: 200 });

  assert.throws(() => ob.applyPriceChange({ seq: 15, side: "bid", price: 0.40, size: 1 }), /non-contiguous seq/);
});

