import assert from "node:assert/strict";
import test from "node:test";

import { ResyncingOrderbook } from "../../packages/mm-core/src/orderbook/ResyncingOrderbook.js";

test("ResyncingOrderbook: enters resync on seq gap and recovers on snapshot", () => {
  const ob = new ResyncingOrderbook({ tickSize: 0.01 });
  assert.equal(ob.needsResync, true);

  ob.applySnapshot({ seq: 1, bids: [[0.49, 100]], asks: [[0.51, 100]] });
  assert.equal(ob.needsResync, false);

  const d1 = ob.applyDelta({ seq: 2, side: "bid", price: 0.5, size: 80 });
  assert.equal(d1.applied, true);
  assert.equal(ob.seq, 2);
  assert.deepEqual(ob.bestBid(), { price: 0.5, size: 80 });

  const beforeAsk = ob.bestAsk();
  const gap = ob.applyDelta({ seq: 4, side: "ask", price: 0.52, size: 120 });
  assert.equal(gap.applied, false);
  assert.equal(gap.action, "gap_enter_resync");
  assert.equal(ob.needsResync, true);
  assert.deepEqual(ob.lastGap, { have: 2, got: 4 });
  assert.equal(ob.seq, 2);
  assert.deepEqual(ob.bestAsk(), beforeAsk);

  const ignored = ob.applyDelta({ seq: 5, side: "ask", price: 0.51, size: 0 });
  assert.equal(ignored.applied, false);
  assert.equal(ignored.action, "delta_ignored_resync");
  assert.equal(ob.seq, 2);

  ob.applySnapshot({ seq: 10, bids: [[0.5, 80]], asks: [[0.52, 120]] });
  assert.equal(ob.needsResync, false);
  assert.equal(ob.seq, 10);
  assert.equal(ob.lastGap, null);

  const d2 = ob.applyDelta({ seq: 11, side: "ask", price: 0.52, size: 0 });
  assert.equal(d2.applied, true);
  assert.equal(ob.seq, 11);
});

test("ResyncingOrderbook: enters resync when book becomes crossed", () => {
  const ob = new ResyncingOrderbook({ tickSize: 0.01 });

  ob.applySnapshot({ seq: 1, bids: [[0.49, 100]], asks: [[0.51, 100]] });
  assert.equal(ob.needsResync, false);

  // Make best bid >= best ask. In a real CLOB this should not persist; treat it as out-of-sync state.
  ob.applyDelta({ seq: 2, side: "bid", price: 0.52, size: 10 });
  assert.equal(ob.needsResync, true);
  assert.equal(ob.lastGap, null);
  assert.equal(ob.lastResyncReason, "crossed_book_delta");

  // Further deltas are ignored until a snapshot arrives.
  const ignored = ob.applyDelta({ seq: 3, side: "ask", price: 0.51, size: 0 });
  assert.equal(ignored.applied, false);
  assert.equal(ignored.action, "delta_ignored_resync");

  ob.applySnapshot({ seq: 10, bids: [[0.5, 80]], asks: [[0.52, 120]] });
  assert.equal(ob.needsResync, false);
  assert.equal(ob.lastResyncReason, null);
});
