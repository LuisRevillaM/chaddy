// @ts-check

import { invariant } from "../../../shared/src/assert.js";

/**
 * @typedef {"BUY"|"SELL"} Side
 *
 * @typedef {{
 *  side: Side,
 *  price: number,
 *  size: number,
 *  bestBid: { price: number, size: number } | null,
 *  bestAsk: { price: number, size: number } | null
 * }} ScoringContext
 *
 * @typedef {{
 *  scoring: boolean,
 *  reason: "ok" | "no_book" | "size_too_small" | "not_top_of_book"
 * }} ScoringResult
 */

/**
 * Deterministic scoring verifier mock.
 *
 * Rules:
 * - Requires a book (bestBid/bestAsk).
 * - Requires order size >= minSize.
 * - If requireTopOfBook=true, requires:
 *   - BUY at bestBid.price
 *   - SELL at bestAsk.price
 *
 * This is designed to be injected in proofs; a live implementation can replace it.
 *
 * @param {{
 *  minSize: number,
 *  requireTopOfBook?: boolean
 * }} cfg
 */
export function createMockScoringChecker(cfg) {
  invariant(cfg.minSize >= 0, "minSize must be >= 0", { minSize: cfg.minSize });
  const requireTopOfBook = cfg.requireTopOfBook !== false;

  return {
    /**
     * @param {ScoringContext} ctx
     * @returns {ScoringResult}
     */
    checkOrder(ctx) {
      if (!ctx.bestBid || !ctx.bestAsk) return { scoring: false, reason: "no_book" };
      if (ctx.size < cfg.minSize) return { scoring: false, reason: "size_too_small" };

      if (requireTopOfBook) {
        if (ctx.side === "BUY" && ctx.price !== ctx.bestBid.price) return { scoring: false, reason: "not_top_of_book" };
        if (ctx.side === "SELL" && ctx.price !== ctx.bestAsk.price) return { scoring: false, reason: "not_top_of_book" };
      }

      return { scoring: true, reason: "ok" };
    }
  };
}

