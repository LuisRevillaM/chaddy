// @ts-check

import { invariant } from "../../../shared/src/assert.js";

/**
 * @typedef {"BUY"|"SELL"} Side
 *
 * @typedef {{
 *  id: string,
 *  side: Side,
 *  price: number,
 *  size: number
 * }} LiveOrder
 */

/**
 * Deterministic order tracker driven solely by user events.
 *
 * This is intentionally strict (fail loud on inconsistencies) so proofs
 * catch protocol mismatches early.
 */
export class OrderTracker {
  constructor() {
    /** @type {Map<string, LiveOrder>} */
    this._live = new Map();
  }

  /**
   * Apply a user event emitted by the exchange adapter.
   *
   * Supported event shapes (SimExchange compatible):
   * - { type: "order_open", orderId, side, price, size }
   * - { type: "fill", orderId, side, price, size }
   * - { type: "order_canceled", orderId }
   * - { type: "order_closed", orderId }
   *
   * @param {any} msg
   */
  applyUserEvent(msg) {
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "order_open") {
      invariant(typeof msg.orderId === "string" && msg.orderId, "order_open: orderId required");
      invariant(msg.side === "BUY" || msg.side === "SELL", "order_open: invalid side", { side: msg.side });
      invariant(Number.isFinite(msg.price), "order_open: price must be finite", { price: msg.price });
      invariant(msg.size > 0, "order_open: size must be > 0", { size: msg.size });
      invariant(!this._live.has(msg.orderId), "order_open: duplicate orderId", { orderId: msg.orderId });
      this._live.set(msg.orderId, { id: msg.orderId, side: msg.side, price: msg.price, size: msg.size });
      return;
    }

    if (msg.type === "fill") {
      invariant(typeof msg.orderId === "string" && msg.orderId, "fill: orderId required");
      invariant(msg.side === "BUY" || msg.side === "SELL", "fill: invalid side", { side: msg.side });
      invariant(msg.size > 0, "fill: size must be > 0", { size: msg.size });
      const o = this._live.get(msg.orderId);
      invariant(o, "fill: unknown orderId", { orderId: msg.orderId });
      // Update remaining size; keep the order until an explicit close/cancel.
      invariant(msg.size <= o.size, "fill: size exceeds remaining", { orderId: msg.orderId, fillSize: msg.size, remaining: o.size });
      o.size -= msg.size;
      this._live.set(msg.orderId, o);
      return;
    }

    if (msg.type === "order_canceled") {
      invariant(typeof msg.orderId === "string" && msg.orderId, "order_canceled: orderId required");
      invariant(this._live.has(msg.orderId), "order_canceled: unknown orderId", { orderId: msg.orderId });
      this._live.delete(msg.orderId);
      return;
    }

    if (msg.type === "order_closed") {
      invariant(typeof msg.orderId === "string" && msg.orderId, "order_closed: orderId required");
      invariant(this._live.has(msg.orderId), "order_closed: unknown orderId", { orderId: msg.orderId });
      this._live.delete(msg.orderId);
      return;
    }
  }

  /**
   * @returns {LiveOrder[]}
   */
  liveOrders() {
    // Return copies so callers can safely snapshot without later mutations
    // (fills mutate the live objects inside the tracker).
    const out = Array.from(this._live.values(), (o) => ({ id: o.id, side: o.side, price: o.price, size: o.size }));
    out.sort((a, b) => {
      if (a.side !== b.side) return a.side < b.side ? -1 : 1;
      if (a.price !== b.price) return a.price - b.price;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return out;
  }
}
