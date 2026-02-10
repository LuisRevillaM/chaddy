// @ts-check

import { validateOrderPolicy } from "../policy.js";
import { isGeoAllowed } from "../geoblock.js";

import { ClobClient } from "./ClobClient.js";

/**
 * Async REST executor adapter for Polymarket CLOB.
 *
 * This is intentionally not wired into mm-core yet (mm-core is deterministic/synchronous).
 * It exists so we can:
 * - prove request formation offline (mock fetch)
 * - prove guardrails reject before any network call
 * - keep secrets confined to packages/executor/
 */
export class PolymarketRestExecutor {
  /**
   * @param {{
   *  client: ClobClient,
   *  policy: import("../policy.js").Policy,
   *  marketMidpoint: () => number | null,
   *  geoAllowed?: () => boolean
   * }} params
   */
  constructor(params) {
    this.client = params.client;
    this.policy = params.policy;
    this.marketMidpoint = params.marketMidpoint;
    this.geoAllowed = params.geoAllowed || isGeoAllowed;
  }

  /**
   * @param {{ market: string, side: "BUY"|"SELL", price: number, size: number }}
   */
  async placeOrder(req) {
    if (!this.geoAllowed()) return { ok: false, reason: "geoblocked", orderId: null };

    const midpoint = this.marketMidpoint();
    const v = validateOrderPolicy(req, this.policy, { midpoint });
    if (!v.ok) return { ok: false, reason: v.reason, orderId: null };

    try {
      const data = await this.client.placeOrder({ tokenId: req.market, side: req.side, price: req.price, size: req.size });
      const orderId = data?.orderId ?? data?.orderID ?? data?.order_id ?? null;
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
      await this.client.cancelOrder({ orderId });
      return { ok: true, reason: null };
    } catch {
      return { ok: false, reason: "http_error" };
    }
  }

  async cancelAll() {
    if (!this.geoAllowed()) return { ok: false, reason: "geoblocked", canceled: 0 };
    try {
      const data = await this.client.cancelAll();
      const canceled = Number(data?.canceled ?? data?.canceledCount ?? data?.canceled_count ?? 0);
      return { ok: true, reason: null, canceled: Number.isFinite(canceled) ? canceled : 0 };
    } catch {
      return { ok: false, reason: "http_error", canceled: 0 };
    }
  }
}

