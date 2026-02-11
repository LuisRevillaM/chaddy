// @ts-check

/**
 * @typedef {{ id?: string, side: "BUY"|"SELL", price: number, size: number }} LiveOrder
 */

/**
 * @param {LiveOrder[]} liveOrders
 * @returns {{ buy: LiveOrder|null, sell: LiveOrder|null }}
 */
export function pickBestOrdersBySide(liveOrders) {
  /** @type {LiveOrder|null} */
  let buy = null;
  /** @type {LiveOrder|null} */
  let sell = null;

  for (const o of Array.isArray(liveOrders) ? liveOrders : []) {
    if (!o || (o.side !== "BUY" && o.side !== "SELL")) continue;
    if (o.side === "BUY") {
      if (!buy || o.price > buy.price) buy = o;
    } else {
      if (!sell || o.price < sell.price) sell = o;
    }
  }

  return { buy, sell };
}

/**
 * Build scoring payload for run-journal cycle entries.
 * Network calls are performed only when `enabled=true`.
 *
 * @param {{
 *  enabled: boolean,
 *  liveOrders: LiveOrder[],
 *  scoringClient: { checkOrderScoring: (orderId: string) => Promise<{ ok: boolean, scoring: boolean|null, reason: string|null }> } | null
 * }} params
 * @returns {Promise<null | { buy: { scoring: boolean, reason: string }, sell: { scoring: boolean, reason: string } }>}
 */
export async function buildLiveJournalScoring(params) {
  if (!params.enabled || !params.scoringClient) return null;

  const best = pickBestOrdersBySide(params.liveOrders);

  const oneSide = async (order) => {
    if (!order) return { scoring: false, reason: "no_order" };
    if (!(typeof order.id === "string" && order.id.length > 0)) return { scoring: false, reason: "missing_order_id" };

    const r = await params.scoringClient.checkOrderScoring(order.id);
    if (!r.ok || typeof r.scoring !== "boolean") {
      return { scoring: false, reason: String(r.reason || "scoring_error") };
    }
    return { scoring: r.scoring, reason: String(r.reason || (r.scoring ? "ok" : "not_scoring")) };
  };

  return {
    buy: await oneSide(best.buy),
    sell: await oneSide(best.sell)
  };
}

