// @ts-check

import { invariant } from "../../../shared/src/assert.js";

import { ResyncingOrderbook } from "../orderbook/ResyncingOrderbook.js";
import { killSwitchDecision } from "../controls/killSwitch.js";
import { computeDesiredQuotes } from "../strategy/computeDesiredQuotes.js";
import { OrderTracker } from "../state/orderTracker.js";
import { PositionTracker } from "../state/positionTracker.js";

/**
 * Deterministic, read-only engine:
 * - ingest market + user events
 * - maintain orderbook + trackers
 * - compute desired quotes + kill-switch status
 *
 * This is used by both offline proofs (step-based) and live "shadow" runners.
 */
export class ShadowEngine {
  /**
   * @param {{
   *  market: string,
   *  quoteCfg: import("../strategy/computeDesiredQuotes.js").QuoteConfig,
   *  killSwitchCfg: import("../controls/killSwitch.js").KillSwitchConfig,
   *  midpointRef?: { value: number | null }
   * }} params
   */
  constructor(params) {
    invariant(params && typeof params === "object", "params is required");
    invariant(typeof params.market === "string" && params.market.length > 0, "market is required");
    invariant(params.quoteCfg && typeof params.quoteCfg === "object", "quoteCfg is required");
    invariant(params.killSwitchCfg && typeof params.killSwitchCfg === "object", "killSwitchCfg is required");

    this.market = params.market;
    this.quoteCfg = params.quoteCfg;
    this.killSwitchCfg = params.killSwitchCfg;
    this.midpointRef = params.midpointRef ?? null;

    this.ob = new ResyncingOrderbook({ tickSize: this.quoteCfg.tickSize });
    this.orderTracker = new OrderTracker();
    this.positionTracker = new PositionTracker();

    /** @type {number|null} */
    this.lastMarketDataMs = null;
    /** @type {number|null} */
    this.lastUserDataMs = null;
  }

  /**
   * @param {number} nowMs
   * @param {any} msg
   */
  ingestMarket(nowMs, msg) {
    invariant(Number.isInteger(nowMs) && nowMs >= 0, "nowMs must be integer >= 0", { nowMs });
    if (!msg || typeof msg.type !== "string") return { ok: false, reason: "ignored" };

    if (msg.type === "book") {
      this.ob.applySnapshot({ seq: msg.seq, bids: msg.bids, asks: msg.asks });
      this.lastMarketDataMs = nowMs;
      this.#updateMidpointRef();
      return { ok: true, kind: "snapshot" };
    }

    if (msg.type === "price_change") {
      if (msg.side !== "bid" && msg.side !== "ask") return { ok: false, reason: "invalid_side" };
      if (!Number.isFinite(msg.price) || !Number.isFinite(msg.size)) return { ok: false, reason: "invalid_price_size" };
      if (!Number.isInteger(msg.seq)) return { ok: false, reason: "invalid_seq" };
      const r = this.ob.applyDelta({ seq: msg.seq, side: msg.side, price: msg.price, size: msg.size });
      this.lastMarketDataMs = nowMs;
      this.#updateMidpointRef();
      return { ok: true, kind: "delta", applied: r.applied, action: r.action };
    }

    return { ok: false, reason: "ignored" };
  }

  /**
   * @param {number} nowMs
   * @param {any} msg
   */
  ingestUser(nowMs, msg) {
    invariant(Number.isInteger(nowMs) && nowMs >= 0, "nowMs must be integer >= 0", { nowMs });
    this.lastUserDataMs = nowMs;
    this.orderTracker.applyUserEvent(msg);
    this.positionTracker.applyUserEvent(msg);
    return { ok: true };
  }

  /**
   * Compute a stable status snapshot for observability.
   *
   * @param {{ i: number, nowMs: number }} t
   */
  snapshot(t) {
    invariant(Number.isInteger(t.i) && t.i >= 0, "i must be integer >= 0", { i: t.i });
    invariant(Number.isInteger(t.nowMs) && t.nowMs >= 0, "nowMs must be integer >= 0", { nowMs: t.nowMs });

    const inv = this.positionTracker.position;
    const bb = this.ob.bestBid();
    const ba = this.ob.bestAsk();
    const kill = killSwitchDecision(
      { nowMs: t.nowMs, lastMarketDataMs: this.lastMarketDataMs, lastUserDataMs: this.lastUserDataMs },
      this.killSwitchCfg
    );

    let desiredQuotes = [];
    let quoteSuppressedReason = null;

    if (kill.cancelAll) {
      quoteSuppressedReason = `kill_switch:${kill.reason}`;
    } else if (this.ob.needsResync) {
      quoteSuppressedReason = "orderbook_resync";
    } else if (!bb || !ba) {
      quoteSuppressedReason = "no_top_of_book";
    } else if (bb.price >= ba.price) {
      // Live feeds can temporarily go out of sync; treat a crossed book as a hard resync condition.
      this.ob.enterResync("crossed_book_snapshot");
      quoteSuppressedReason = "crossed_book";
    } else {
      desiredQuotes = computeDesiredQuotes({ bestBid: bb, bestAsk: ba, inventory: inv }, this.quoteCfg);
    }

    const liveOrders = this.orderTracker.liveOrders();

    return {
      i: t.i,
      nowMs: t.nowMs,
      market: this.market,
      orderbook: {
        seq: this.ob.seq,
        needsResync: this.ob.needsResync,
        gap: this.ob.lastGap,
        resyncReason: this.ob.lastResyncReason,
        bestBid: bb,
        bestAsk: ba
      },
      midpoint: bb && ba ? (bb.price + ba.price) / 2 : null,
      inventory: inv,
      liveOrders,
      lastMarketDataAgeMs: this.lastMarketDataMs == null ? null : t.nowMs - this.lastMarketDataMs,
      lastUserDataAgeMs: this.lastUserDataMs == null ? null : t.nowMs - this.lastUserDataMs,
      killSwitch: kill,
      quoteSuppressedReason,
      desiredQuotes
    };
  }

  stateFinal() {
    return {
      orderbook: {
        bestBid: this.ob.bestBid(),
        bestAsk: this.ob.bestAsk(),
        seq: this.ob.seq,
        needsResync: this.ob.needsResync,
        gap: this.ob.lastGap,
        resyncReason: this.ob.lastResyncReason
      },
      ...this.positionTracker.toJSON(),
      liveOrders: this.orderTracker.liveOrders()
    };
  }

  #updateMidpointRef() {
    if (!this.midpointRef) return;
    const bb = this.ob.bestBid();
    const ba = this.ob.bestAsk();
    this.midpointRef.value = bb && ba ? (bb.price + ba.price) / 2 : null;
  }
}
