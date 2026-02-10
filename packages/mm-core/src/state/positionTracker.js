// @ts-check

import { invariant } from "../../../shared/src/assert.js";

/**
 * Deterministic position tracker driven solely by user fill events.
 *
 * For proof harnesses we de-dupe identical fills (same orderId/side/price/size)
 * to avoid double-counting if an adapter replays the same fill message.
 */
export class PositionTracker {
  constructor() {
    /** @type {number} */
    this.position = 0;
    /** @type {Set<string>} */
    this._seenFillKeys = new Set();
    /** @type {number} */
    this.fillCount = 0;
    /** @type {number} */
    this.duplicateFillCount = 0;
  }

  /**
   * @param {any} msg
   */
  applyUserEvent(msg) {
    if (!msg || msg.type !== "fill") return;
    invariant(typeof msg.orderId === "string" && msg.orderId, "fill: orderId required");
    invariant(msg.side === "BUY" || msg.side === "SELL", "fill: invalid side", { side: msg.side });
    invariant(Number.isFinite(msg.price), "fill: price must be finite", { price: msg.price });
    invariant(msg.size > 0, "fill: size must be > 0", { size: msg.size });

    const key = `${msg.orderId}|${msg.side}|${msg.price}|${msg.size}`;
    if (this._seenFillKeys.has(key)) {
      this.duplicateFillCount += 1;
      return;
    }
    this._seenFillKeys.add(key);
    this.fillCount += 1;

    if (msg.side === "BUY") this.position += msg.size;
    else this.position -= msg.size;
  }

  toJSON() {
    return {
      position: this.position,
      fillCount: this.fillCount,
      duplicateFillCount: this.duplicateFillCount
    };
  }
}

