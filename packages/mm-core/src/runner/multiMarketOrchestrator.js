// @ts-check

import { invariant } from "../../../shared/src/assert.js";
import { runMmCoreLoop } from "./mmCoreLoop.js";

/**
 * @typedef {{
 *  market: string,
 *  loopCfg: import("./mmCoreLoop.js").MmCoreLoopConfig,
 *  deps: import("./mmCoreLoop.js").MmCoreLoopDeps
 * }} MultiMarketItem
 *
 * @typedef {{
 *  market: string,
 *  churnSummary: any,
 *  scoringSummary: { steps: number, cfg: any, totals: any },
 *  stateFinal: any,
 *  final: any
 * }} MultiMarketResult
 */

/**
 * Orchestrate multiple independent mm-core loops (one per market) in a single deterministic run.
 *
 * This intentionally keeps mm-core free of sim/executor package dependencies: tests provide
 * SimExchange + Executor instances via injected `deps`.
 *
 * @param {MultiMarketItem[]} items
 * @returns {{
 *  perMarket: MultiMarketResult[],
 *  trace: any[]
 * }}
 */
export function runMultiMarketOrchestrator(items) {
  invariant(Array.isArray(items) && items.length >= 1, "items must be a non-empty array");

  /** @type {MultiMarketResult[]} */
  const perMarket = [];
  /** @type {any[]} */
  const trace = [];

  for (const it of items) {
    invariant(it && typeof it.market === "string" && it.market.length > 0, "item.market must be a non-empty string");
    invariant(it.loopCfg && it.loopCfg.market === it.market, "loopCfg.market must equal item.market", {
      itemMarket: it.market,
      loopMarket: it.loopCfg?.market
    });

    const r = runMmCoreLoop(it.loopCfg, it.deps);

    perMarket.push({
      market: it.market,
      churnSummary: r.churnSummary,
      scoringSummary: { steps: r.scoringSummary.steps, cfg: r.scoringSummary.cfg, totals: r.scoringSummary.totals },
      stateFinal: r.stateFinal,
      final: r.final
    });

    for (const e of r.trace) trace.push({ market: it.market, ...e });
  }

  return { perMarket, trace };
}

