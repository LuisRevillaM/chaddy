// @ts-check

import { invariant } from "../../../shared/src/assert.js";

/**
 * Deterministic minimum-update-interval gate.
 *
 * Caller provides `nowMs` and only calls `allow(nowMs)` when it intends to update.
 */
export class UpdateThrottle {
  /**
   * @param {{ minIntervalMs: number }} cfg
   */
  constructor(cfg) {
    invariant(
      Number.isInteger(cfg.minIntervalMs) && cfg.minIntervalMs >= 0,
      "minIntervalMs must be integer >= 0",
      { minIntervalMs: cfg.minIntervalMs }
    );
    this.minIntervalMs = cfg.minIntervalMs;
    /** @type {number|null} */
    this.lastUpdateMs = null;
  }

  /**
   * @param {number} nowMs
   */
  canUpdate(nowMs) {
    invariant(Number.isInteger(nowMs) && nowMs >= 0, "nowMs must be integer >= 0", { nowMs });
    if (this.lastUpdateMs == null) return true;
    invariant(nowMs >= this.lastUpdateMs, "nowMs must be monotonic", { nowMs, lastUpdateMs: this.lastUpdateMs });
    return nowMs - this.lastUpdateMs >= this.minIntervalMs;
  }

  /**
   * @param {number} nowMs
   */
  markUpdated(nowMs) {
    invariant(Number.isInteger(nowMs) && nowMs >= 0, "nowMs must be integer >= 0", { nowMs });
    if (this.lastUpdateMs != null) invariant(nowMs >= this.lastUpdateMs, "nowMs must be monotonic", { nowMs, lastUpdateMs: this.lastUpdateMs });
    this.lastUpdateMs = nowMs;
  }

  /**
   * Convenience: if allowed, mark updated and return true.
   * @param {number} nowMs
   */
  allow(nowMs) {
    if (!this.canUpdate(nowMs)) return false;
    this.markUpdated(nowMs);
    return true;
  }
}

