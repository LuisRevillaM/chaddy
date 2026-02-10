// @ts-check

import { invariant } from "../../../shared/src/assert.js";

/**
 * Minimal orderbook state for deterministic quoting:
 * - maintains price->size maps
 * - provides best bid/ask
 * - enforces monotonically increasing sequence numbers
 */
export class OrderbookState {
  /**
   * @param {{ tickSize: number }} params
   */
  constructor({ tickSize }) {
    invariant(tickSize > 0, "tickSize must be > 0", { tickSize });
    this.tickSize = tickSize;
    /** @type {Map<number, number>} */
    this.bids = new Map();
    /** @type {Map<number, number>} */
    this.asks = new Map();
    /** @type {number|null} */
    this.seq = null;
  }

  reset() {
    this.bids.clear();
    this.asks.clear();
    this.seq = null;
  }

  /**
   * @param {{ bids: Array<[number, number]>, asks: Array<[number, number]>, seq: number }} snap
   */
  applySnapshot(snap) {
    invariant(Number.isInteger(snap.seq), "snapshot seq must be integer", { seq: snap.seq });
    this.bids.clear();
    this.asks.clear();
    for (const [p, s] of snap.bids) {
      if (s <= 0) continue;
      this.bids.set(p, s);
    }
    for (const [p, s] of snap.asks) {
      if (s <= 0) continue;
      this.asks.set(p, s);
    }
    this.seq = snap.seq;
  }

  /**
   * @param {{ side: "bid"|"ask", price: number, size: number, seq: number }} msg
   */
  applyPriceChange(msg) {
    invariant(this.seq != null, "cannot apply delta before snapshot");
    invariant(Number.isInteger(msg.seq), "delta seq must be integer", { seq: msg.seq });
    invariant(msg.seq === this.seq + 1, "non-contiguous seq; resync required", { have: this.seq, got: msg.seq });
    const book = msg.side === "bid" ? this.bids : this.asks;
    if (msg.size <= 0) book.delete(msg.price);
    else book.set(msg.price, msg.size);
    this.seq = msg.seq;
  }

  /**
   * @returns {{ price: number, size: number } | null}
   */
  bestBid() {
    let bestP = null;
    let bestS = 0;
    for (const [p, s] of this.bids.entries()) {
      if (bestP == null || p > bestP) {
        bestP = p;
        bestS = s;
      }
    }
    return bestP == null ? null : { price: bestP, size: bestS };
  }

  /**
   * @returns {{ price: number, size: number } | null}
   */
  bestAsk() {
    let bestP = null;
    let bestS = 0;
    for (const [p, s] of this.asks.entries()) {
      if (bestP == null || p < bestP) {
        bestP = p;
        bestS = s;
      }
    }
    return bestP == null ? null : { price: bestP, size: bestS };
  }
}

