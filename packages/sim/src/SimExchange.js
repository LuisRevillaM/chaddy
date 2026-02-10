// @ts-check

import { EventEmitter } from "node:events";
import { invariant } from "../../shared/src/assert.js";
import { mulberry32 } from "../../shared/src/rng.js";
import { newId } from "../../shared/src/ids.js";
import { roundDownToTick, roundUpToTick } from "../../shared/src/math.js";

/**
 * Extremely small deterministic exchange simulator for proof harnesses.
 *
 * It is NOT a full matching engine. It exists to:
 * - generate market data snapshots deterministically
 * - accept/cancel orders
 * - create fills when the simulated external mid moves across your orders
 */
export class SimExchange extends EventEmitter {
  /**
   * @param {{
   *  seed: number,
   *  tickSize: number,
   *  mid: number,
   *  extSpread: number,
   * }} params
   */
  constructor(params) {
    super();
    invariant(params.tickSize > 0, "tickSize must be > 0");
    invariant(params.extSpread > 0, "extSpread must be > 0");
    this.tickSize = params.tickSize;
    this.extSpread = params.extSpread;
    this.mid = params.mid;
    this.rng = mulberry32(params.seed);

    /** @type {Map<string, {id:string, side:"BUY"|"SELL", price:number, size:number}>} */
    this.orders = new Map();
    /** @type {number} */
    this.position = 0;
    /** @type {number} */
    this.seq = 0;
  }

  /**
   * Advance deterministic time by one step, emit a market snapshot, and fill crossing orders.
   */
  step() {
    // Simple random walk around mid with small noise.
    const u = this.rng() - 0.5;
    const stepSize = this.tickSize * 2;
    this.mid = Math.max(0.01, this.mid + u * stepSize);

    const bestBid = roundDownToTick(this.mid - this.extSpread / 2, this.tickSize);
    const bestAsk = roundUpToTick(this.mid + this.extSpread / 2, this.tickSize);
    this.seq += 1;

    this.emit("market", {
      type: "book",
      seq: this.seq,
      bids: [[bestBid, 1_000]],
      asks: [[bestAsk, 1_000]]
    });

    // Fill any orders that have become crossing vs external top-of-book.
    for (const o of Array.from(this.orders.values())) {
      if (o.side === "BUY" && o.price >= bestAsk) {
        this.orders.delete(o.id);
        this.position += o.size;
        this.emit("user", { type: "fill", orderId: o.id, side: o.side, price: bestAsk, size: o.size });
        this.emit("user", { type: "order_closed", orderId: o.id });
      }
      if (o.side === "SELL" && o.price <= bestBid) {
        this.orders.delete(o.id);
        this.position -= o.size;
        this.emit("user", { type: "fill", orderId: o.id, side: o.side, price: bestBid, size: o.size });
        this.emit("user", { type: "order_closed", orderId: o.id });
      }
    }
  }

  /**
   * @param {{side:"BUY"|"SELL", price:number, size:number}} o
   */
  placeOrder(o) {
    invariant(o.size > 0, "order size must be > 0");
    const id = newId("sim_order");
    this.orders.set(id, { id, ...o });
    this.emit("user", { type: "order_open", orderId: id, side: o.side, price: o.price, size: o.size });
    return id;
  }

  /**
   * @param {string} orderId
   */
  cancelOrder(orderId) {
    if (!this.orders.has(orderId)) return false;
    this.orders.delete(orderId);
    this.emit("user", { type: "order_canceled", orderId });
    return true;
  }

  cancelAll() {
    const ids = Array.from(this.orders.keys());
    for (const id of ids) this.cancelOrder(id);
    return ids.length;
  }

  getTopOfBook() {
    const bestBid = roundDownToTick(this.mid - this.extSpread / 2, this.tickSize);
    const bestAsk = roundUpToTick(this.mid + this.extSpread / 2, this.tickSize);
    return { bestBid, bestAsk };
  }
}

