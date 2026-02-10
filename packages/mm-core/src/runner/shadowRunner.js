// @ts-check

import { invariant } from "../../../shared/src/assert.js";

import { computeDesiredQuotes } from "../strategy/computeDesiredQuotes.js";
import { killSwitchDecision } from "../controls/killSwitch.js";

/**
 * @typedef {{
 *  market: string,
 *  steps: number,
 *  stepMs: number,
 *  quoteCfg: import("../strategy/computeDesiredQuotes.js").QuoteConfig,
 *  killSwitchCfg: import("../controls/killSwitch.js").KillSwitchConfig,
 * }} ShadowRunnerConfig
 *
 * @typedef {{
 *  step: () => void,
 *  getTopOfBook: () => ({ bestBid: number, bestAsk: number }),
 *  getLiveOrders: () => Array<{ id: string, side: "BUY"|"SELL", price: number, size: number }>,
 *  getInventory: () => number
 * }} ShadowDeps
 */

/**
 * Run a deterministic "shadow mode" loop:
 * - advances an injected exchange
 * - computes desired quotes
 * - NEVER places/cancels orders (read-only)
 * - returns periodic status snapshots for inspection
 *
 * @param {ShadowRunnerConfig} cfg
 * @param {ShadowDeps} deps
 */
export function runShadowRunner(cfg, deps) {
  invariant(cfg.steps >= 1, "steps must be >= 1", { steps: cfg.steps });
  invariant(cfg.stepMs >= 1, "stepMs must be >= 1", { stepMs: cfg.stepMs });
  invariant(cfg.market, "market is required");

  /** @type {number|null} */
  let lastMarketDataMs = null;
  /** @type {number|null} */
  let lastUserDataMs = null; // shadow runner is read-only; remains null unless inventory changes.
  let lastInv = deps.getInventory();

  /** @type {Array<Record<string, unknown>>} */
  const history = [];

  for (let i = 0; i < cfg.steps; i++) {
    const nowMs = i * cfg.stepMs;
    deps.step();
    lastMarketDataMs = nowMs;

    const inv = deps.getInventory();
    if (inv !== lastInv) {
      lastInv = inv;
      lastUserDataMs = nowMs;
    }

    const tob = deps.getTopOfBook();
    const bestBid = { price: tob.bestBid, size: 1_000 };
    const bestAsk = { price: tob.bestAsk, size: 1_000 };
    const midpoint = (tob.bestBid + tob.bestAsk) / 2;

    const kill = killSwitchDecision({ nowMs, lastMarketDataMs, lastUserDataMs }, cfg.killSwitchCfg);

    const desiredQuotes = computeDesiredQuotes(
      { bestBid, bestAsk, inventory: inv },
      cfg.quoteCfg
    );

    const liveOrders = deps.getLiveOrders().slice().sort((a, b) => {
      if (a.side !== b.side) return a.side < b.side ? -1 : 1;
      if (a.price !== b.price) return a.price - b.price;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    history.push({
      i,
      nowMs,
      market: cfg.market,
      midpoint,
      topOfBook: { bestBid, bestAsk },
      desiredQuotes,
      liveOrders,
      inventory: inv,
      lastMarketDataAgeMs: lastMarketDataMs == null ? null : nowMs - lastMarketDataMs,
      lastUserDataAgeMs: lastUserDataMs == null ? null : nowMs - lastUserDataMs,
      killSwitch: kill
    });
  }

  return {
    config: cfg,
    final: history[history.length - 1],
    history
  };
}

