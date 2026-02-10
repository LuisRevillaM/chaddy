import assert from "node:assert/strict";
import test from "node:test";

import { createMockScoringChecker } from "../../packages/mm-core/src/scoring/mockScoringChecker.js";

test("mock scoring checker: enforces book, minSize, and (optional) top-of-book", () => {
  const c = createMockScoringChecker({ minSize: 10, requireTopOfBook: true });
  const bestBid = { price: 0.49, size: 100 };
  const bestAsk = { price: 0.51, size: 100 };

  assert.deepEqual(c.checkOrder({ side: "BUY", price: 0.49, size: 10, bestBid: null, bestAsk: null }), {
    scoring: false,
    reason: "no_book"
  });

  assert.deepEqual(c.checkOrder({ side: "BUY", price: 0.49, size: 9, bestBid, bestAsk }), {
    scoring: false,
    reason: "size_too_small"
  });

  assert.deepEqual(c.checkOrder({ side: "BUY", price: 0.48, size: 10, bestBid, bestAsk }), {
    scoring: false,
    reason: "not_top_of_book"
  });

  assert.deepEqual(c.checkOrder({ side: "BUY", price: 0.49, size: 10, bestBid, bestAsk }), {
    scoring: true,
    reason: "ok"
  });
});

