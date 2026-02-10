// @ts-check

import { invariant } from "./assert.js";

/**
 * Minimal config validator for early milestones.
 *
 * Keep this intentionally small and strict; add fields as milestones require.
 *
 * @param {any} cfg
 */
export function validateConfig(cfg) {
  invariant(cfg && typeof cfg === "object", "config must be an object");
  invariant(cfg.runMode === "shadow" || cfg.runMode === "live", "config.runMode must be 'shadow' or 'live'");
  invariant(Array.isArray(cfg.markets) && cfg.markets.length > 0, "config.markets must be a non-empty array");

  const q = cfg.quote;
  invariant(q && typeof q === "object", "config.quote must be an object");
  for (const k of ["tickSize", "halfSpread", "maxSpread", "minSize", "orderSize", "inventoryTarget", "maxSkew"]) {
    invariant(typeof q[k] === "number" && Number.isFinite(q[k]), `config.quote.${k} must be a finite number`);
  }
  invariant(q.tickSize > 0, "quote.tickSize must be > 0");
  invariant(q.maxSpread >= q.tickSize, "quote.maxSpread must be >= tickSize");
  invariant(q.orderSize >= q.minSize, "quote.orderSize must be >= minSize");
  invariant(q.inventoryTarget > 0, "quote.inventoryTarget must be > 0");

  const ks = cfg.killSwitch;
  invariant(ks && typeof ks === "object", "config.killSwitch must be an object");
  invariant(typeof ks.staleMarketDataMs === "number" && ks.staleMarketDataMs > 0, "killSwitch.staleMarketDataMs must be > 0");
  invariant(typeof ks.staleUserDataMs === "number" && ks.staleUserDataMs > 0, "killSwitch.staleUserDataMs must be > 0");

  const p = cfg.executorPolicy;
  invariant(p && typeof p === "object", "config.executorPolicy must be an object");
  invariant(Array.isArray(p.allowedMarkets), "executorPolicy.allowedMarkets must be an array");
  for (const k of ["minOrderSize", "maxOrderSize", "maxAbsNotional"]) {
    invariant(typeof p[k] === "number" && Number.isFinite(p[k]), `executorPolicy.${k} must be a finite number`);
  }
  invariant(p.maxOrderSize > 0, "executorPolicy.maxOrderSize must be > 0");
  invariant(p.maxAbsNotional > 0, "executorPolicy.maxAbsNotional must be > 0");
  if (p.maxPriceBand != null) {
    invariant(typeof p.maxPriceBand === "number" && p.maxPriceBand > 0, "executorPolicy.maxPriceBand must be > 0 when provided");
  }

  return true;
}

