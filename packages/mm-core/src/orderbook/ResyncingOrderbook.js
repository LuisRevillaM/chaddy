// @ts-check

import { invariant } from "../../../shared/src/assert.js";

import { OrderbookState } from "./OrderbookState.js";

/**
 * Resync-aware controller for OrderbookState.
 *
 * Behavior:
 * - Starts in resync mode until a snapshot is applied.
 * - Applies contiguous deltas while "ready".
 * - On a sequence gap, enters resync mode and ignores further deltas until the next snapshot.
 *
 * This makes gaps explicit without silently drifting book state.
 */
export class ResyncingOrderbook {
  /**
   * @param {{ tickSize: number }} params
   */
  constructor({ tickSize }) {
    this.state = new OrderbookState({ tickSize });
    /** @type {"ready" | "resync"} */
    this.mode = "resync";
    /** @type {{ have: number, got: number } | null} */
    this.lastGap = null;
    /** @type {string|null} */
    this.lastResyncReason = null;
  }

  reset() {
    this.state.reset();
    this.mode = "resync";
    this.lastGap = null;
    this.lastResyncReason = null;
  }

  /** @returns {boolean} */
  get needsResync() {
    return this.mode === "resync";
  }

  /**
   * @returns {number|null}
   */
  get seq() {
    return this.state.seq;
  }

  /**
   * @param {{ bids: Array<[number, number]>, asks: Array<[number, number]>, seq: number }} snap
   */
  applySnapshot(snap) {
    this.state.applySnapshot(snap);
    this.mode = "ready";
    this.lastGap = null;
    this.lastResyncReason = null;
    // Even a snapshot can be inconsistent (or mismatched); refuse to quote against a crossed book.
    this.#checkCrossAndEnterResync("crossed_book_snapshot");
    return { action: "snapshot_applied" };
  }

  /**
   * Force resync mode with an explicit reason (useful for higher-level sanity checks).
   *
   * @param {string} reason
   */
  enterResync(reason) {
    this.mode = "resync";
    this.lastGap = null;
    this.lastResyncReason = String(reason || "unknown");
  }

  /**
   * @param {{ side: "bid"|"ask", price: number, size: number, seq: number }} msg
   */
  applyDelta(msg) {
    if (this.mode === "resync") {
      return { applied: false, action: "delta_ignored_resync", gap: this.lastGap };
    }

    const have = this.state.seq;
    invariant(have != null, "invariant: ready mode must have seq");

    if (msg.seq !== have + 1) {
      this.mode = "resync";
      this.lastGap = { have, got: msg.seq };
      this.lastResyncReason = "seq_gap";
      return { applied: false, action: "gap_enter_resync", gap: this.lastGap };
    }

    this.state.applyPriceChange(msg);
    this.#checkCrossAndEnterResync("crossed_book_delta");
    return { applied: true, action: "delta_applied" };
  }

  /**
   * @returns {{ price: number, size: number } | null}
   */
  bestBid() {
    return this.state.bestBid();
  }

  /**
   * @returns {{ price: number, size: number } | null}
   */
  bestAsk() {
    return this.state.bestAsk();
  }

  /**
   * If the best bid is >= best ask, our local book is inconsistent (usually due to
   * missed deltas / out-of-sync state). Enter resync mode until the next snapshot.
   *
   * @param {string} reason
   */
  #checkCrossAndEnterResync(reason) {
    const bb = this.state.bestBid();
    const ba = this.state.bestAsk();
    if (!bb || !ba) return;
    if (bb.price >= ba.price) {
      this.mode = "resync";
      this.lastGap = null;
      this.lastResyncReason = reason;
    }
  }
}
