// @ts-check

import { invariant } from "../../../shared/src/assert.js";

const DEFAULT_BASE_URL = "https://clob.polymarket.com";

function joinUrl(baseUrl, p) {
  const b = String(baseUrl || "").replace(/\/+$/, "");
  const path = String(p || "");
  if (!path.startsWith("/")) return `${b}/${path}`;
  return `${b}${path}`;
}

function safeErr(e) {
  return String(e?.message || e || "error");
}

/**
 * Minimal CLOB REST client wrapper.
 *
 * This module:
 * - is fetch-injectable for offline proofs
 * - never logs secrets
 * - avoids embedding auth headers in thrown errors
 */
export class ClobClient {
  /**
   * @param {{
   *  fetchImpl?: typeof fetch,
   *  baseUrl?: string,
   *  authHeaders?: Record<string, string>
   * }} params
   */
  constructor(params = {}) {
    this.fetchImpl = params.fetchImpl || globalThis.fetch;
    this.baseUrl = params.baseUrl || DEFAULT_BASE_URL;
    this.authHeaders = params.authHeaders || {};

    invariant(typeof this.fetchImpl === "function", "fetchImpl must be a function");
    invariant(typeof this.baseUrl === "string" && this.baseUrl.startsWith("http"), "baseUrl must be http(s)", { baseUrl: this.baseUrl });
  }

  /**
   * @param {string} path
   * @param {{ method: string, body?: any }} req
   */
  async #requestJson(path, req) {
    const url = joinUrl(this.baseUrl, path);
    /** @type {Record<string,string>} */
    const headers = { accept: "application/json", ...this.authHeaders };
    /** @type {any} */
    const init = { method: req.method, headers };
    if (req.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(req.body);
    }

    let res;
    try {
      res = await this.fetchImpl(url, init);
    } catch (e) {
      const err = new Error(`CLOB request failed: ${req.method} ${path}: ${safeErr(e)}`);
      err.cause = e;
      throw err;
    }

    if (!res || typeof res.ok !== "boolean") {
      throw new Error(`CLOB request failed: ${req.method} ${path}: invalid_fetch_response`);
    }

    if (!res.ok) {
      // Do not include response body (could contain echoed metadata); keep errors stable.
      throw new Error(`CLOB HTTP ${res.status}: ${req.method} ${path}`);
    }

    try {
      return await res.json();
    } catch (e) {
      const err = new Error(`CLOB invalid JSON: ${req.method} ${path}: ${safeErr(e)}`);
      err.cause = e;
      throw err;
    }
  }

  /**
   * Place a single order.
   *
   * @param {{ tokenId: string, side: "BUY"|"SELL", price: number, size: number }} req
   */
  async placeOrder(req) {
    invariant(typeof req.tokenId === "string" && req.tokenId.length > 0, "tokenId is required");
    invariant(req.side === "BUY" || req.side === "SELL", "side must be BUY|SELL");
    invariant(Number.isFinite(req.price) && req.price > 0, "price must be > 0");
    invariant(Number.isFinite(req.size) && req.size > 0, "size must be > 0");

    return await this.#requestJson("/orders", {
      method: "POST",
      body: { token_id: req.tokenId, side: req.side, price: req.price, size: req.size }
    });
  }

  /**
   * Cancel a single order.
   *
   * @param {{ orderId: string }} req
   */
  async cancelOrder(req) {
    invariant(typeof req.orderId === "string" && req.orderId.length > 0, "orderId is required");
    return await this.#requestJson(`/orders/${encodeURIComponent(req.orderId)}`, { method: "DELETE" });
  }

  /**
   * Cancel all orders (account-wide).
   */
  async cancelAll() {
    return await this.#requestJson("/orders", { method: "DELETE" });
  }
}

