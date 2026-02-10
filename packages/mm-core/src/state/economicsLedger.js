// @ts-check

import { invariant } from "../../../shared/src/assert.js";

/**
 * Deterministic economics ledger driven solely by user fill events.
 *
 * Tracks:
 * - cash: signed quote-currency cashflow (BUY spends cash, SELL earns cash)
 * - position: signed base/outcome-token position
 * - fillCount: count of unique fills processed (best-effort de-dupe)
 *
 * Memory is bounded by retaining at most the last N fills.
 */
export class EconomicsLedger {
  /**
   * @param {{ maxFills?: number }} params
   */
  constructor(params = {}) {
    const maxFills = params.maxFills ?? 50;
    invariant(Number.isInteger(maxFills) && maxFills >= 0, "maxFills must be integer >= 0", { maxFills });
    this.maxFills = maxFills;

    /** @type {number} */
    this.cash = 0;
    /** @type {number} */
    this.position = 0;
    /** @type {number} */
    this.fillCount = 0;
    /** @type {number} */
    this.duplicateFillCount = 0;

    /** @type {Set<string>} */
    this._seenFillKeys = new Set();
    /** @type {Array<{ orderId: string, side: "BUY"|"SELL", price: number, size: number }>} */
    this._lastFills = [];
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

    const notional = msg.price * msg.size;
    if (msg.side === "BUY") {
      this.position += msg.size;
      this.cash -= notional;
    } else {
      this.position -= msg.size;
      this.cash += notional;
    }

    if (this.maxFills > 0) {
      this._lastFills.push({ orderId: msg.orderId, side: msg.side, price: msg.price, size: msg.size });
      while (this._lastFills.length > this.maxFills) this._lastFills.shift();
    }
  }

  /**
   * Mark-to-mid PnL (cash + position * mid).
   *
   * @param {number} mid
   */
  pnlMarkToMid(mid) {
    invariant(Number.isFinite(mid), "mid must be finite", { mid });
    return this.cash + this.position * mid;
  }

  toJSON() {
    return {
      cash: this.cash,
      position: this.position,
      fillCount: this.fillCount,
      duplicateFillCount: this.duplicateFillCount,
      lastFills: this._lastFills.slice()
    };
  }
}

