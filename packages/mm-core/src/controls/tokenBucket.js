// @ts-check

import { invariant } from "../../../shared/src/assert.js";

/**
 * Deterministic token bucket rate limiter.
 *
 * - No timers; caller provides `nowMs`.
 * - Refills in discrete 1-token increments every `refillEveryMs`.
 */
export class TokenBucket {
  /**
   * @param {{
   *  capacity: number,
   *  refillEveryMs: number,
   *  startFull?: boolean
   * }} cfg
   */
  constructor(cfg) {
    invariant(Number.isInteger(cfg.capacity) && cfg.capacity >= 0, "capacity must be integer >= 0", { capacity: cfg.capacity });
    invariant(
      Number.isInteger(cfg.refillEveryMs) && cfg.refillEveryMs > 0,
      "refillEveryMs must be integer > 0",
      { refillEveryMs: cfg.refillEveryMs }
    );
    this.capacity = cfg.capacity;
    this.refillEveryMs = cfg.refillEveryMs;
    this.tokens = cfg.startFull === false ? 0 : cfg.capacity;
    /** @type {number|null} */
    this.lastRefillMs = null;
  }

  /**
   * @param {number} nowMs
   */
  refill(nowMs) {
    invariant(Number.isInteger(nowMs) && nowMs >= 0, "nowMs must be integer >= 0", { nowMs });
    if (this.lastRefillMs == null) {
      this.lastRefillMs = nowMs;
      return;
    }
    invariant(nowMs >= this.lastRefillMs, "nowMs must be monotonic", { nowMs, lastRefillMs: this.lastRefillMs });
    if (this.tokens >= this.capacity) {
      // Still advance lastRefillMs so a long idle doesn't mint a huge burst later.
      this.lastRefillMs = nowMs;
      return;
    }
    const delta = nowMs - this.lastRefillMs;
    const add = Math.floor(delta / this.refillEveryMs);
    if (add <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + add);
    this.lastRefillMs += add * this.refillEveryMs;
  }

  /**
   * @param {number} nowMs
   * @param {number} n
   */
  tryTake(nowMs, n = 1) {
    invariant(Number.isInteger(n) && n >= 0, "n must be integer >= 0", { n });
    this.refill(nowMs);
    if (n === 0) return { ok: true, remaining: this.tokens };
    if (this.tokens < n) return { ok: false, remaining: this.tokens };
    this.tokens -= n;
    return { ok: true, remaining: this.tokens };
  }
}

