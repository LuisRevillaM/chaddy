// @ts-check

import { invariant } from "../../shared/src/assert.js";

const DEFAULT_URL = "https://polymarket.com/api/geoblock";

/**
 * @typedef {{ allowed: boolean, details?: { country?: string|null, region?: string|null, ip?: string|null, blocked?: boolean|null } }} GeoAllowedResult
 */

/**
 * Create an injectable, cached geoblock checker.
 *
 * Notes:
 * - Safe-by-default: on any error, returns { allowed:false }.
 * - Network calls are only performed when `isAllowed()` is awaited and cache is stale.
 *
 * @param {{
 *  fetchImpl?: typeof fetch,
 *  url?: string,
 *  cacheMs?: number
 * }} params
 * @returns {{ isAllowed: () => Promise<GeoAllowedResult> }}
 */
export function createGeoChecker(params = {}) {
  const fetchImpl = params.fetchImpl || globalThis.fetch;
  const url = String(params.url || DEFAULT_URL);
  const cacheMs = Number.isFinite(params.cacheMs) ? Number(params.cacheMs) : 60_000;

  invariant(typeof fetchImpl === "function", "fetchImpl must be a function");
  invariant(url.startsWith("http"), "url must be http(s)", { url });
  invariant(cacheMs >= 0, "cacheMs must be >= 0", { cacheMs });

  /** @type {number|null} */
  let lastFetchAt = null;
  /** @type {GeoAllowedResult|null} */
  let lastResult = null;
  /** @type {Promise<GeoAllowedResult>|null} */
  let inflight = null;

  const parseResponse = (obj) => {
    // Endpoint is expected to return JSON including `blocked: boolean`.
    // Be liberal in parsing to handle minor schema shifts, but never default-allow.
    const blocked =
      typeof obj?.blocked === "boolean"
        ? obj.blocked
        : typeof obj?.isBlocked === "boolean"
          ? obj.isBlocked
          : typeof obj?.allowed === "boolean"
            ? !obj.allowed
            : null;

    const details = {
      country: typeof obj?.country === "string" ? obj.country : null,
      region: typeof obj?.region === "string" ? obj.region : null,
      ip: typeof obj?.ip === "string" ? obj.ip : null,
      blocked: typeof blocked === "boolean" ? blocked : null
    };

    if (typeof blocked !== "boolean") {
      return { allowed: false, details: { ...details, blocked: null } };
    }
    return { allowed: !blocked, details };
  };

  const fetchOnce = async () => {
    try {
      const res = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" } });
      if (!res || typeof res.ok !== "boolean") return { allowed: false };
      if (!res.ok) return { allowed: false, details: { blocked: true } };
      const data = await res.json();
      return parseResponse(data);
    } catch {
      return { allowed: false };
    }
  };

  const isAllowed = async () => {
    const now = Date.now();
    if (lastFetchAt != null && lastResult && now - lastFetchAt < cacheMs) return lastResult;
    if (inflight) return inflight;

    inflight = (async () => {
      const r = await fetchOnce();
      lastFetchAt = Date.now();
      lastResult = r;
      inflight = null;
      return r;
    })();

    return inflight;
  };

  return { isAllowed };
}

