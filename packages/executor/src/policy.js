// @ts-check

import { invariant } from "../../shared/src/assert.js";

/**
 * @typedef {"BUY"|"SELL"} Side
 *
 * @typedef {{
 *  market: string,
 *  side: Side,
 *  price: number,
 *  size: number
 * }} OrderRequest
 *
 * @typedef {{
 *  allowedMarkets: string[],
 *  maxOrderSize: number,
 *  minOrderSize: number,
 *  maxAbsNotional: number,
 *  // If provided, enforce that order prices are within +/- band around midpoint.
 *  maxPriceBand: number | null
 * }} Policy
 */

/**
 * @param {OrderRequest} req
 * @param {Policy} policy
 * @param {{ midpoint: number | null }} marketState
 */
export function validateOrderPolicy(req, policy, marketState) {
  invariant(policy.maxOrderSize > 0, "policy.maxOrderSize must be > 0");
  invariant(policy.minOrderSize >= 0, "policy.minOrderSize must be >= 0");
  invariant(policy.maxAbsNotional > 0, "policy.maxAbsNotional must be > 0");

  if (!policy.allowedMarkets.includes(req.market)) {
    return { ok: false, reason: "market_not_allowed" };
  }
  if (!(req.size >= policy.minOrderSize && req.size <= policy.maxOrderSize)) {
    return { ok: false, reason: "size_out_of_bounds" };
  }
  if (!Number.isFinite(req.price) || req.price <= 0 || req.price >= 1) {
    return { ok: false, reason: "price_out_of_bounds" };
  }
  const notional = Math.abs(req.size * req.price);
  if (notional > policy.maxAbsNotional) {
    return { ok: false, reason: "notional_cap_exceeded" };
  }
  if (policy.maxPriceBand != null && marketState.midpoint != null) {
    const lo = marketState.midpoint - policy.maxPriceBand;
    const hi = marketState.midpoint + policy.maxPriceBand;
    if (req.price < lo || req.price > hi) {
      return { ok: false, reason: "price_out_of_band" };
    }
  }
  return { ok: true, reason: null };
}
