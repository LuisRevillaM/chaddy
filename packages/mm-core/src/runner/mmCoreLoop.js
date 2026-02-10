// @ts-check

import { invariant } from "../../../shared/src/assert.js";

import { ResyncingOrderbook } from "../orderbook/ResyncingOrderbook.js";
import { TokenBucket } from "../controls/tokenBucket.js";
import { UpdateThrottle } from "../controls/updateThrottle.js";
import { killSwitchDecision } from "../controls/killSwitch.js";
import { computeDesiredQuotes } from "../strategy/computeDesiredQuotes.js";
import { diffOrders } from "../orderManager/diffOrders.js";
import { OrderTracker } from "../state/orderTracker.js";
import { PositionTracker } from "../state/positionTracker.js";

/**
 * @typedef {{
 *  market: string,
 *  steps: number,
 *  // Number of steps where market data advances (afterwards, market data becomes stale).
 *  activeMarketSteps: number,
 *  stepMs: number,
 *  quoteCfg: import("../strategy/computeDesiredQuotes.js").QuoteConfig,
 *  killSwitchCfg: import("../controls/killSwitch.js").KillSwitchConfig,
 *  diffCfg: import("../orderManager/diffOrders.js").DiffConfig,
 *  throttle: { minIntervalMs: number },
 *  tokenBucket: { capacity: number, refillEveryMs: number },
 *  traceMax?: number,
 *  scoringCfg: { minSize: number, requireTopOfBook: boolean }
 * }} MmCoreLoopConfig
 *
 * @typedef {{
 *  placeOrder: (req: { market: string, side: "BUY"|"SELL", price: number, size: number }) => ({ ok: boolean, reason: string|null, orderId: string|null }),
 *  cancelOrder: (orderId: string) => ({ ok: boolean, reason: string|null }),
 *  cancelAll: () => ({ ok: boolean, reason: string|null, canceled: number })
 * }} TradeExecutor
 *
 * @typedef {{
 *  onMarket: (cb: (msg: any) => void) => (void | (() => void)),
 *  onUser: (cb: (msg: any) => void) => (void | (() => void)),
 *  stepMarket: () => void,
 *  executor: TradeExecutor,
 *  scoringChecker: { checkOrder: (ctx: { side: "BUY"|"SELL", price: number, size: number, bestBid: {price:number,size:number}|null, bestAsk: {price:number,size:number}|null }) => ({ scoring: boolean, reason: string }) },
 *  midpointRef?: { value: number | null }
 * }} MmCoreLoopDeps
 */

/**
 * Deterministic quoting loop runner. All time is derived from (step index, stepMs).
 *
 * Returns JSON-serializable summaries + trace suitable for writing as proof artifacts.
 *
 * @param {MmCoreLoopConfig} cfg
 * @param {MmCoreLoopDeps} deps
 */
export function runMmCoreLoop(cfg, deps) {
  invariant(cfg.market, "market is required");
  invariant(Number.isInteger(cfg.steps) && cfg.steps >= 1, "steps must be integer >= 1", { steps: cfg.steps });
  invariant(
    Number.isInteger(cfg.activeMarketSteps) && cfg.activeMarketSteps >= 0 && cfg.activeMarketSteps <= cfg.steps,
    "activeMarketSteps must be integer in [0, steps]",
    { activeMarketSteps: cfg.activeMarketSteps, steps: cfg.steps }
  );
  invariant(Number.isInteger(cfg.stepMs) && cfg.stepMs >= 1, "stepMs must be integer >= 1", { stepMs: cfg.stepMs });

  const traceMax = cfg.traceMax ?? 400;

  const ob = new ResyncingOrderbook({ tickSize: cfg.quoteCfg.tickSize });
  const orderTracker = new OrderTracker();
  const positionTracker = new PositionTracker();

  let nowMs = 0;
  /** @type {number|null} */
  let lastMarketDataMs = null;
  /** @type {number|null} */
  let lastUserDataMs = null;

  const onMarket = (msg) => {
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "book") {
      ob.applySnapshot({ seq: msg.seq, bids: msg.bids, asks: msg.asks });
      lastMarketDataMs = nowMs;

      const bb = ob.bestBid();
      const ba = ob.bestAsk();
      if (deps.midpointRef) deps.midpointRef.value = bb && ba ? (bb.price + ba.price) / 2 : null;
      return;
    }

    if (msg.type === "price_change") {
      // Market delta update on the tick grid. Accept size=0 for level deletion.
      if (msg.side !== "bid" && msg.side !== "ask") return;
      if (!Number.isFinite(msg.price) || !Number.isFinite(msg.size)) return;
      if (!Number.isInteger(msg.seq)) return;
      ob.applyDelta({ seq: msg.seq, side: msg.side, price: msg.price, size: msg.size });
      lastMarketDataMs = nowMs;

      const bb = ob.bestBid();
      const ba = ob.bestAsk();
      if (deps.midpointRef) deps.midpointRef.value = bb && ba ? (bb.price + ba.price) / 2 : null;
      return;
    }
  };

  const onUser = (msg) => {
    lastUserDataMs = nowMs;
    orderTracker.applyUserEvent(msg);
    positionTracker.applyUserEvent(msg);
  };

  const unsubMarket = deps.onMarket(onMarket);
  const unsubUser = deps.onUser(onUser);

  const throttle = new UpdateThrottle({ minIntervalMs: cfg.throttle.minIntervalMs });
  const bucket = new TokenBucket({ capacity: cfg.tokenBucket.capacity, refillEveryMs: cfg.tokenBucket.refillEveryMs });

  /** @type {any[]} */
  const trace = [];

  const churnSummary = {
    steps: cfg.steps,
    quoteUpdateCycles: 0,
    placeCalls: 0,
    placeOk: 0,
    cancelCalls: 0,
    cancelOk: 0,
    cancelAllCalls: 0,
    cancelAllCanceled: 0,
    tokenBucketDenied: 0,
    killSwitch: { cancelAllCalls: 0, lastReason: null },
    tokenBucket: { capacity: bucket.capacity, refillEveryMs: bucket.refillEveryMs },
    throttle: { minIntervalMs: throttle.minIntervalMs },
    maxTokensPossible: bucket.capacity + Math.floor(((cfg.steps - 1) * cfg.stepMs) / bucket.refillEveryMs)
  };

  const scoringSummary = {
    steps: cfg.steps,
    cfg: cfg.scoringCfg,
    totals: { scoring: 0, nonScoring: 0, byReason: {} },
    byStep: []
  };

  let cancelAllTriggered = false;

  try {
    for (let i = 0; i < cfg.steps; i++) {
      nowMs = i * cfg.stepMs;

      if (i < cfg.activeMarketSteps) deps.stepMarket();

      const inv = positionTracker.position;
      const bb = ob.bestBid();
      const ba = ob.bestAsk();

      const ks0 = killSwitchDecision(
        {
          nowMs,
          lastMarketDataMs,
          lastUserDataMs
        },
        cfg.killSwitchCfg
      );
      // Orderbook integrity overrides staleness-based decisions.
      // If our local book is inconsistent, cancel-all and refuse to quote until a fresh snapshot arrives.
      let ks = ks0;
      if (ob.needsResync && ob.lastGap) {
        ks = { cancelAll: true, reason: "orderbook_resync_gap" };
      } else if (ob.needsResync && typeof ob.lastResyncReason === "string" && ob.lastResyncReason.startsWith("crossed_book")) {
        ks = { cancelAll: true, reason: "orderbook_crossed" };
      } else if (bb && ba && bb.price >= ba.price) {
        ob.enterResync("crossed_book_loop");
        ks = { cancelAll: true, reason: "orderbook_crossed" };
      }

      /** @type {string[]} */
      const canceled = [];
      /** @type {Array<{side:"BUY"|"SELL", price:number, size:number, ok:boolean, reason:string|null}>} */
      const placed = [];

      if (ks.cancelAll) {
        const r = deps.executor.cancelAll();
        churnSummary.cancelAllCalls += 1;
        churnSummary.cancelAllCanceled += r.canceled;
        churnSummary.killSwitch.cancelAllCalls += 1;
        churnSummary.killSwitch.lastReason = ks.reason;
        cancelAllTriggered = true;
      } else if (!cancelAllTriggered && !ob.needsResync && bb && ba) {
        const desired = computeDesiredQuotes({ bestBid: bb, bestAsk: ba, inventory: inv }, cfg.quoteCfg);

        const live = orderTracker.liveOrders();
        const diff = diffOrders(desired, live, cfg.diffCfg);

        const hasWork = diff.cancel.length > 0 || diff.place.length > 0;
        if (hasWork && throttle.canUpdate(nowMs)) {
          churnSummary.quoteUpdateCycles += 1;
          throttle.markUpdated(nowMs);

          for (const id of diff.cancel) {
            const budget = bucket.tryTake(nowMs, 1);
            if (!budget.ok) {
              churnSummary.tokenBucketDenied += 1;
              break;
            }
            churnSummary.cancelCalls += 1;
            const r = deps.executor.cancelOrder(id);
            if (r.ok) {
              churnSummary.cancelOk += 1;
              canceled.push(id);
            }
          }

          for (const o of diff.place) {
            const budget = bucket.tryTake(nowMs, 1);
            if (!budget.ok) {
              churnSummary.tokenBucketDenied += 1;
              break;
            }
            churnSummary.placeCalls += 1;
            const r = deps.executor.placeOrder({ market: cfg.market, side: o.side, price: o.price, size: o.size });
            if (r.ok) churnSummary.placeOk += 1;
            placed.push({ side: o.side, price: o.price, size: o.size, ok: r.ok, reason: r.reason });
          }
        }
      }

      // Scoring is evaluated on the best live order per side.
      const liveOrders = orderTracker.liveOrders();
      /** @type {{id:string, side:"BUY"|"SELL", price:number, size:number} | null} */
      let bestBuy = null;
      /** @type {{id:string, side:"BUY"|"SELL", price:number, size:number} | null} */
      let bestSell = null;
      for (const o of liveOrders) {
        if (o.side === "BUY") {
          if (!bestBuy || o.price > bestBuy.price) bestBuy = o;
        } else if (o.side === "SELL") {
          if (!bestSell || o.price < bestSell.price) bestSell = o;
        }
      }

      const scoreSide = (side, o) => {
        if (!o) return { scoring: false, reason: "no_order", price: null, size: null };
        const r = deps.scoringChecker.checkOrder({ side, price: o.price, size: o.size, bestBid: bb, bestAsk: ba });
        return { scoring: r.scoring, reason: r.reason, price: o.price, size: o.size };
      };

      const buyScore = scoreSide("BUY", bestBuy);
      const sellScore = scoreSide("SELL", bestSell);

      for (const s of [buyScore, sellScore]) {
        if (s.scoring) scoringSummary.totals.scoring += 1;
        else scoringSummary.totals.nonScoring += 1;
        scoringSummary.totals.byReason[s.reason] = (scoringSummary.totals.byReason[s.reason] || 0) + 1;
      }
      scoringSummary.byStep.push({ i, nowMs, buy: buyScore, sell: sellScore });

      if (trace.length < traceMax) {
        trace.push({
          i,
          nowMs,
          marketSeq: ob.seq,
          bestBid: bb,
          bestAsk: ba,
          inventory: inv,
          liveOrders: liveOrders.length,
          killSwitch: ks,
          canceled,
          placed,
          scoring: { buy: buyScore, sell: sellScore }
        });
      }
    }
  } finally {
    if (typeof unsubMarket === "function") unsubMarket();
    if (typeof unsubUser === "function") unsubUser();
  }

  return {
    churnSummary,
    scoringSummary,
    trace,
    stateFinal: {
      ...positionTracker.toJSON(),
      liveOrders: orderTracker.liveOrders()
    },
    final: {
      cancelAllTriggered,
      lastKillSwitchReason: churnSummary.killSwitch.lastReason
    }
  };
}
