// @ts-check

import { invariant } from "../../../shared/src/assert.js";

const DEFAULT_BASE_URL = "https://clob.polymarket.com";

function joinUrl(baseUrl, p) {
  const b = String(baseUrl || "").replace(/\/+$/, "");
  const path = String(p || "");
  if (!path.startsWith("/")) return `${b}/${path}`;
  return `${b}${path}`;
}

/**
 * Fetch-injectable scoring client.
 *
 * Returns stable, redacted result objects and never throws secrets into logs.
 */
export class ScoringClient {
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
   * @param {string} orderId
   * @returns {Promise<{ ok: boolean, scoring: boolean|null, reason: string|null }>}
   */
  async checkOrderScoring(orderId) {
    if (!(typeof orderId === "string" && orderId.length > 0)) {
      return { ok: false, scoring: null, reason: "invalid_order_id" };
    }

    const url = joinUrl(this.baseUrl, `/orders/${encodeURIComponent(orderId)}/scoring`);
    const headers = { accept: "application/json", ...this.authHeaders };

    /** @type {any} */
    let res;
    try {
      res = await this.fetchImpl(url, { method: "GET", headers });
    } catch {
      return { ok: false, scoring: null, reason: "http_error" };
    }

    if (!res || typeof res.ok !== "boolean") return { ok: false, scoring: null, reason: "invalid_fetch_response" };
    if (!res.ok) {
      const status = Number.isFinite(Number(res.status)) ? Number(res.status) : 0;
      return { ok: false, scoring: null, reason: `http_${status || "error"}` };
    }

    /** @type {any} */
    let data;
    try {
      data = await res.json();
    } catch {
      return { ok: false, scoring: null, reason: "invalid_json" };
    }

    const scoring =
      typeof data?.scoring === "boolean"
        ? data.scoring
        : typeof data?.isScoring === "boolean"
          ? data.isScoring
          : typeof data?.is_scoring === "boolean"
            ? data.is_scoring
            : null;

    if (typeof scoring !== "boolean") {
      const reason = typeof data?.reason === "string" && data.reason ? data.reason : "missing_scoring_flag";
      return { ok: false, scoring: null, reason };
    }

    const reason = typeof data?.reason === "string" && data.reason ? data.reason : scoring ? "ok" : "not_scoring";
    return { ok: true, scoring, reason };
  }
}

