// @ts-check

import { invariant } from "../../../shared/src/assert.js";
import { runMmCoreLoop } from "./mmCoreLoop.js";

/**
 * @typedef {{
 *  market: string,
 *  loopCfg: import("./mmCoreLoop.js").MmCoreLoopConfig,
 *  deps: import("./mmCoreLoop.js").MmCoreLoopDeps
 * }} MarketPhase
 *
 * @typedef {{
 *  a: MarketPhase,
 *  b: MarketPhase,
 *  // Optional hook for deterministic observability snapshots. Called at:
 *  // - "after_a" (after phase A loop)
 *  // - "after_exit" (after cancel-all)
 *  // - "after_reset" (after reset marker, before phase B loop)
 *  // - "after_b" (after phase B loop)
 *  observe?: (label: "after_a" | "after_exit" | "after_reset" | "after_b") => any
 * }} MarketLifecycleConfig
 */

/**
 * Sequential lifecycle runner:
 * - run market A loop
 * - exit market A (cancel-all via executor)
 * - reset (new state for next market)
 * - run market B loop
 *
 * This runner is intentionally pure (no sim/exchange dependencies). Tests inject
 * executors, websocket/user streams, and deterministic observers.
 *
 * @param {MarketLifecycleConfig} cfg
 */
export function runMarketLifecycle(cfg) {
  invariant(cfg && typeof cfg === "object", "cfg is required");
  invariant(cfg.a && cfg.a.market, "cfg.a.market is required");
  invariant(cfg.b && cfg.b.market, "cfg.b.market is required");
  invariant(cfg.a.loopCfg && cfg.a.loopCfg.market === cfg.a.market, "cfg.a.loopCfg.market must equal cfg.a.market", {
    aMarket: cfg.a.market,
    aLoopMarket: cfg.a.loopCfg?.market
  });
  invariant(cfg.b.loopCfg && cfg.b.loopCfg.market === cfg.b.market, "cfg.b.loopCfg.market must equal cfg.b.market", {
    bMarket: cfg.b.market,
    bLoopMarket: cfg.b.loopCfg?.market
  });

  const snapshots = {
    after_a: null,
    after_exit: null,
    after_reset: null,
    after_b: null
  };

  const a = runMmCoreLoop(cfg.a.loopCfg, cfg.a.deps);
  if (cfg.observe) snapshots.after_a = cfg.observe("after_a");

  // Exit must always cancel-all via executor.
  const exit = cfg.a.deps.executor.cancelAll();
  if (cfg.observe) snapshots.after_exit = cfg.observe("after_exit");

  // "Reset" is represented by starting a fresh loop instance for market B.
  // Any per-market state (orderbook, trackers, throttles, buckets) must not leak.
  const reset = { ok: true };
  if (cfg.observe) snapshots.after_reset = cfg.observe("after_reset");

  const b = runMmCoreLoop(cfg.b.loopCfg, cfg.b.deps);
  if (cfg.observe) snapshots.after_b = cfg.observe("after_b");

  return { a, exit, reset, b, snapshots };
}

