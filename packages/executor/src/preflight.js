// @ts-check

import { isGeoAllowed } from "./geoblock.js";

/**
 * @typedef {"missing_allowlist" | "invalid_min_order_size" | "invalid_max_order_size" | "invalid_max_abs_notional" | "missing_price_band" | "geoblocked"} LivePreflightReason
 */

/**
 * Live-mode safety preflight.
 *
 * This must be checked before starting any loop that might trade.
 * It is intentionally strict: it requires explicit allowlist + caps.
 *
 * @param {{
 *  policy: import("./policy.js").Policy
 * }} params
 * @returns {{ ok: boolean, reasons: LivePreflightReason[] }}
 */
export function preflightLiveMode(params) {
  /** @type {LivePreflightReason[]} */
  const reasons = [];

  if (!isGeoAllowed()) reasons.push("geoblocked");

  const p = params.policy;
  if (!Array.isArray(p.allowedMarkets) || p.allowedMarkets.length === 0) reasons.push("missing_allowlist");
  if (!(typeof p.minOrderSize === "number" && p.minOrderSize >= 0)) reasons.push("invalid_min_order_size");
  if (!(typeof p.maxOrderSize === "number" && p.maxOrderSize > 0)) reasons.push("invalid_max_order_size");
  if (!(typeof p.maxAbsNotional === "number" && p.maxAbsNotional > 0)) reasons.push("invalid_max_abs_notional");

  // Require an explicit, finite price band for live-mode safety.
  if (!(typeof p.maxPriceBand === "number" && Number.isFinite(p.maxPriceBand) && p.maxPriceBand > 0)) reasons.push("missing_price_band");

  return { ok: reasons.length === 0, reasons };
}

