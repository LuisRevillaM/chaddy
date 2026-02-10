// @ts-check

import { invariant } from "../../shared/src/assert.js";
import { validateOrderPolicy } from "./policy.js";
import { isGeoAllowed } from "./geoblock.js";

/**
 * @typedef {"BUY"|"SELL"} Side
 *
 * @typedef {{
 *  market: string,
 *  side: Side,
 *  price: number,
 *  size: number
 * }} OrderRequest
 */

/**
 * Minimal "executor" boundary:
 * - owns the ability to hit trading endpoints (in prod)
 * - enforces policy guardrails
 * - enforces geoblock gating
 *
 * For now it delegates to a provided exchange adapter (SimExchange in tests).
 */
export class Executor {
  /**
   * @param {{
   *  exchange: { placeOrder: (o: {side:Side, price:number, size:number}) => string, cancelOrder: (id:string) => boolean, cancelAll: () => number },
   *  policy: import("./policy.js").Policy,
   *  marketMidpoint: () => number | null
   * }} params
   */
  constructor(params) {
    this.exchange = params.exchange;
    this.policy = params.policy;
    this.marketMidpoint = params.marketMidpoint;
  }

  /**
   * @param {OrderRequest} req
   */
  placeOrder(req) {
    if (!isGeoAllowed()) {
      return { ok: false, reason: "geoblocked", orderId: null };
    }

    const midpoint = this.marketMidpoint();
    const v = validateOrderPolicy(req, this.policy, { midpoint });
    if (!v.ok) return { ok: false, reason: v.reason, orderId: null };

    invariant(req.side === "BUY" || req.side === "SELL", "invalid side");
    const orderId = this.exchange.placeOrder({ side: req.side, price: req.price, size: req.size });
    return { ok: true, reason: null, orderId };
  }

  /**
   * @param {string} orderId
   */
  cancelOrder(orderId) {
    if (!isGeoAllowed()) return { ok: false, reason: "geoblocked" };
    const ok = this.exchange.cancelOrder(orderId);
    return { ok, reason: ok ? null : "not_found" };
  }

  cancelAll() {
    if (!isGeoAllowed()) return { ok: false, reason: "geoblocked", canceled: 0 };
    const canceled = this.exchange.cancelAll();
    return { ok: true, reason: null, canceled };
  }
}

