// @ts-check

import { invariant } from "../../../shared/src/assert.js";

/**
 * @typedef {{
 *  id: string,
 *  question?: string,
 *  active?: boolean,
 *  closed?: boolean,
 *  liquidityUsd?: number,
 *  volume24hUsd?: number,
 *  rewardPoolUsd?: number,
 *  spreadBps?: number
 * }} GammaLikeMarket
 *
 * @typedef {{
 *  weights?: Partial<{
 *    reward: number,
 *    volume: number,
 *    liquidity: number,
 *    spread: number
 *  }>,
 *  ineligiblePenalty?: number
 * }} SelectMarketsCfg
 *
 * @typedef {{
 *  id: string,
 *  score: number,
 *  eligible: boolean,
 *  reasons: string[],
 *  breakdown: {
 *    raw: {
 *      rewardPoolUsd: number,
 *      volume24hUsd: number,
 *      liquidityUsd: number,
 *      spreadBps: number,
 *      active: boolean,
 *      closed: boolean
 *    },
 *    normalized: {
 *      reward: number,
 *      volume: number,
 *      liquidity: number,
 *      spreadScore: number
 *    },
 *    weights: {
 *      reward: number,
 *      volume: number,
 *      liquidity: number,
 *      spread: number
 *    },
 *    contributions: {
 *      reward: number,
 *      volume: number,
 *      liquidity: number,
 *      spread: number,
 *      penalty: number
 *    }
 *  }
 * }} MarketSelection
 */

/**
 * Deterministic, explainable market ranking.
 *
 * Notes:
 * - No wall-clock time. All behavior is a pure function of inputs + cfg.
 * - "Gamma-like" here means "market metadata you could get from Gamma".
 *
 * @param {GammaLikeMarket[]} markets
 * @param {SelectMarketsCfg} [cfg]
 * @returns {MarketSelection[]}
 */
export function selectMarkets(markets, cfg = {}) {
  invariant(Array.isArray(markets), "markets must be an array");

  const w = {
    reward: 0.4,
    volume: 0.3,
    liquidity: 0.2,
    spread: 0.1,
    ...(cfg.weights ?? {})
  };
  for (const [k, v] of Object.entries(w)) {
    invariant(Number.isFinite(v) && v >= 0, "weight must be a finite number >= 0", { k, v });
  }

  const maxReward = Math.max(0, ...markets.map((m) => asNumber(m.rewardPoolUsd)));
  const maxVol = Math.max(0, ...markets.map((m) => asNumber(m.volume24hUsd)));
  const maxLiq = Math.max(0, ...markets.map((m) => asNumber(m.liquidityUsd)));
  const maxSpread = Math.max(0, ...markets.map((m) => asNumber(m.spreadBps)));

  const totalWeight = w.reward + w.volume + w.liquidity + w.spread;
  const ineligiblePenalty = Number.isFinite(cfg.ineligiblePenalty) ? cfg.ineligiblePenalty : totalWeight + 1;

  /** @type {MarketSelection[]} */
  const out = [];

  for (const m of markets) {
    const id = String(m.id ?? "");
    invariant(id.length > 0, "market.id must be a non-empty string");

    const active = m.active === true;
    const closed = m.closed === true;
    const eligible = active && !closed;

    const rewardPoolUsd = asNumber(m.rewardPoolUsd);
    const volume24hUsd = asNumber(m.volume24hUsd);
    const liquidityUsd = asNumber(m.liquidityUsd);
    const spreadBps = asNumber(m.spreadBps);

    const nReward = normalize(rewardPoolUsd, maxReward);
    const nVol = normalize(volume24hUsd, maxVol);
    const nLiq = normalize(liquidityUsd, maxLiq);
    const spreadScore = 1 - normalize(spreadBps, maxSpread);

    const cReward = w.reward * nReward;
    const cVol = w.volume * nVol;
    const cLiq = w.liquidity * nLiq;
    const cSpread = w.spread * spreadScore;

    const penalty = eligible ? 0 : -ineligiblePenalty;
    const scoreFloat = cReward + cVol + cLiq + cSpread + penalty;
    const score = Math.round(scoreFloat * 100_000);

    const reasons = [];
    if (!eligible) reasons.push(!active ? "inactive" : "closed");

    out.push({
      id,
      score,
      eligible,
      reasons,
      breakdown: {
        raw: { rewardPoolUsd, volume24hUsd, liquidityUsd, spreadBps, active, closed },
        normalized: { reward: nReward, volume: nVol, liquidity: nLiq, spreadScore },
        weights: { reward: w.reward, volume: w.volume, liquidity: w.liquidity, spread: w.spread },
        contributions: { reward: cReward, volume: cVol, liquidity: cLiq, spread: cSpread, penalty }
      }
    });
  }

  // Deterministic ordering: score desc, then id asc.
  out.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return out;
}

/**
 * @param {unknown} v
 */
function asNumber(v) {
  return Number.isFinite(Number(v)) ? Number(v) : 0;
}

/**
 * @param {number} v
 * @param {number} max
 */
function normalize(v, max) {
  if (!(max > 0)) return 0;
  return v <= 0 ? 0 : v / max;
}

