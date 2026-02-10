// @ts-check

import { invariant } from "../../../shared/src/assert.js";

import { ShadowEngine } from "./shadowEngine.js";

/**
 * @typedef {{
 *  market: string,
 *  steps: number,
 *  // Number of steps where the injected step function runs (afterwards, the feed becomes stale).
 *  activeMarketSteps: number,
 *  stepMs: number,
 *  quoteCfg: import("../strategy/computeDesiredQuotes.js").QuoteConfig,
 *  killSwitchCfg: import("../controls/killSwitch.js").KillSwitchConfig,
 *  traceMax?: number
 * }} ShadowLoopConfig
 *
 * @typedef {{
 *  onMarket: (cb: (msg: any) => void) => (void | (() => void)),
 *  onUser: (cb: (msg: any) => void) => (void | (() => void)),
 *  stepMarket: () => void,
 *  midpointRef?: { value: number | null }
 * }} ShadowLoopDeps
 */

/**
 * Deterministic, read-only loop using the same event interfaces as `runMmCoreLoop`:
 * - ingests market + user events
 * - maintains orderbook + trackers
 * - computes desired quotes (but NEVER places/cancels)
 * - records stable status snapshots for observability
 *
 * @param {ShadowLoopConfig} cfg
 * @param {ShadowLoopDeps} deps
 */
export function runShadowLoop(cfg, deps) {
  invariant(cfg.market, "market is required");
  invariant(Number.isInteger(cfg.steps) && cfg.steps >= 1, "steps must be integer >= 1", { steps: cfg.steps });
  invariant(
    Number.isInteger(cfg.activeMarketSteps) && cfg.activeMarketSteps >= 0 && cfg.activeMarketSteps <= cfg.steps,
    "activeMarketSteps must be integer in [0, steps]",
    { activeMarketSteps: cfg.activeMarketSteps, steps: cfg.steps }
  );
  invariant(Number.isInteger(cfg.stepMs) && cfg.stepMs >= 1, "stepMs must be integer >= 1", { stepMs: cfg.stepMs });

  const traceMax = cfg.traceMax ?? 400;

  let nowMs = 0;
  const engine = new ShadowEngine({
    market: cfg.market,
    quoteCfg: cfg.quoteCfg,
    killSwitchCfg: cfg.killSwitchCfg,
    midpointRef: deps.midpointRef
  });

  const onMarket = (msg) => engine.ingestMarket(nowMs, msg);
  const onUser = (msg) => engine.ingestUser(nowMs, msg);

  const unsubMarket = deps.onMarket(onMarket);
  const unsubUser = deps.onUser(onUser);

  /** @type {any[]} */
  const history = [];

  try {
    for (let i = 0; i < cfg.steps; i++) {
      nowMs = i * cfg.stepMs;
      if (i < cfg.activeMarketSteps) deps.stepMarket();

      if (history.length < traceMax) {
        history.push(engine.snapshot({ i, nowMs }));
      }
    }
  } finally {
    if (typeof unsubMarket === "function") unsubMarket();
    if (typeof unsubUser === "function") unsubUser();
  }

  return {
    config: cfg,
    final: history[history.length - 1],
    history,
    stateFinal: engine.stateFinal()
  };
}
