import assert from "node:assert/strict";
import test from "node:test";

import { TokenBucket } from "../../packages/mm-core/src/controls/tokenBucket.js";
import { UpdateThrottle } from "../../packages/mm-core/src/controls/updateThrottle.js";

test("TokenBucket: refills deterministically in discrete steps", () => {
  const b = new TokenBucket({ capacity: 2, refillEveryMs: 10 });

  assert.deepEqual(b.tryTake(0, 1), { ok: true, remaining: 1 });
  assert.deepEqual(b.tryTake(0, 1), { ok: true, remaining: 0 });
  assert.deepEqual(b.tryTake(0, 1), { ok: false, remaining: 0 });

  // No refill before 10ms has elapsed.
  assert.deepEqual(b.tryTake(9, 1), { ok: false, remaining: 0 });

  // Refill 1 token at 10ms.
  assert.deepEqual(b.tryTake(10, 1), { ok: true, remaining: 0 });

  // Refill up to capacity.
  b.refill(100);
  assert.deepEqual(b.tryTake(100, 2), { ok: true, remaining: 0 });
});

test("UpdateThrottle: enforces minIntervalMs with explicit nowMs", () => {
  const t = new UpdateThrottle({ minIntervalMs: 5 });
  assert.equal(t.allow(0), true);
  assert.equal(t.allow(4), false);
  assert.equal(t.allow(5), true);
});

