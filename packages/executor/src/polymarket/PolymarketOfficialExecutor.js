// @ts-check

import { validateOrderPolicy } from "../policy.js";
import { isGeoAllowed } from "../geoblock.js";

import { loadOfficialPolymarketDeps } from "./official/loadDeps.js";

function tickSizeToString(tickSize) {
  const n = Number(tickSize);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n === 0.1) return "0.1";
  if (n === 0.01) return "0.01";
  if (n === 0.001) return "0.001";
  if (n === 0.0001) return "0.0001";
  return null;
}

/**
 * Executor adapter that uses Polymarket's official `@polymarket/clob-client`.
 *
 * The official client handles:
 * - L1 auth (EIP-712) to derive L2 API creds
 * - L2 request signing
 * - Order signing and submission
 *
 * This class still enforces:
 * - geoblock gating
 * - policy allowlist + caps + price bands
 */
export class PolymarketOfficialExecutor {
  /**
   * @param {{
   *  client: any,
   *  policy: import("../policy.js").Policy,
   *  marketMidpoint: () => number | null,
   *  geoAllowed?: () => boolean,
   *  tickSize: number,
   *  negRisk?: boolean
   * }} params
   */
  constructor(params) {
    this.client = params.client;
    this.policy = params.policy;
    this.marketMidpoint = params.marketMidpoint;
    this.geoAllowed = params.geoAllowed || isGeoAllowed;
    this.tickSize = params.tickSize;
    this.negRisk = Boolean(params.negRisk);
  }

  /**
   * @param {{ market: string, side: "BUY"|"SELL", price: number, size: number }}
   */
  async placeOrder(req) {
    if (!this.geoAllowed()) return { ok: false, reason: "geoblocked", orderId: null };

    const midpoint = this.marketMidpoint();
    const v = validateOrderPolicy(req, this.policy, { midpoint });
    if (!v.ok) return { ok: false, reason: v.reason, orderId: null };

    const tickSize = tickSizeToString(this.tickSize);
    if (!tickSize) return { ok: false, reason: "invalid_tick_size", orderId: null };

    const deps = await loadOfficialPolymarketDeps();
    if (!deps.ok) return { ok: false, reason: deps.error, orderId: null };

    try {
      const side = req.side === "SELL" ? deps.Side.SELL : deps.Side.BUY;
      const resp = await this.client.createAndPostOrder(
        {
          tokenID: String(req.market),
          side,
          price: Number(req.price),
          size: Number(req.size),
          orderType: deps.OrderType.GTC
        },
        { tickSize, negRisk: this.negRisk }
      );
      const orderId = resp?.orderID ?? resp?.orderId ?? resp?.order_id ?? null;
      return { ok: true, reason: null, orderId: orderId == null ? null : String(orderId) };
    } catch {
      return { ok: false, reason: "http_error", orderId: null };
    }
  }

  /**
   * @param {string} orderId
   */
  async cancelOrder(orderId) {
    if (!this.geoAllowed()) return { ok: false, reason: "geoblocked" };
    try {
      await this.client.cancelOrder(String(orderId));
      return { ok: true, reason: null };
    } catch {
      return { ok: false, reason: "http_error" };
    }
  }

  async cancelAll() {
    if (!this.geoAllowed()) return { ok: false, reason: "geoblocked", canceled: 0 };
    try {
      await this.client.cancelAll();
      return { ok: true, reason: null, canceled: 0 };
    } catch {
      return { ok: false, reason: "http_error", canceled: 0 };
    }
  }
}
