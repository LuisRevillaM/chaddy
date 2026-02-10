// @ts-check

/**
 * @typedef {{
 *  staleMarketDataMs: number,
 *  staleUserDataMs: number
 * }} KillSwitchConfig
 */

/**
 * @param {{
 *  nowMs: number,
 *  lastMarketDataMs: number | null,
 *  lastUserDataMs: number | null
 * }} state
 * @param {KillSwitchConfig} cfg
 * @returns {{ cancelAll: boolean, reason: string | null }}
 */
export function killSwitchDecision(state, cfg) {
  if (state.lastMarketDataMs == null) return { cancelAll: true, reason: "no_market_data_yet" };
  const marketAge = state.nowMs - state.lastMarketDataMs;
  if (marketAge > cfg.staleMarketDataMs) return { cancelAll: true, reason: "stale_market_data" };

  if (state.lastUserDataMs == null) return { cancelAll: false, reason: null };
  const userAge = state.nowMs - state.lastUserDataMs;
  if (userAge > cfg.staleUserDataMs) return { cancelAll: true, reason: "stale_user_data" };

  return { cancelAll: false, reason: null };
}

