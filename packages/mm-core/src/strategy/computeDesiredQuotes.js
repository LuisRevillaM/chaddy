// @ts-check

import { invariant } from "../../../shared/src/assert.js";
import { clamp } from "../../../shared/src/math.js";

/**
 * @typedef {"BUY"|"SELL"} Side
 *
 * @typedef {{
 *  side: Side,
 *  price: number,
 *  size: number
 * }} DesiredOrder
 *
 * @typedef {{
 *  tickSize: number,
 *  // Desired half-spread around midpoint (price units).
 *  halfSpread: number,
 *  // Max total spread allowed (price units).
 *  maxSpread: number,
 *  // Min order size required by the rewards program / policy.
 *  minSize: number,
 *  // Target order size to post.
 *  orderSize: number,
 *  // Inventory skew:
 *  // - inventoryTarget is the position size where skew saturates
 *  // - maxSkew is the max price shift applied to both quotes (price units)
 *  inventoryTarget: number,
 *  maxSkew: number
 * }} QuoteConfig
 */

/**
 * Pure quoting function: takes best bid/ask + inventory and returns desired orders.
 *
 * @param {{
 *  bestBid: {price:number, size:number} | null,
 *  bestAsk: {price:number, size:number} | null,
 *  inventory: number
 * }} state
 * @param {QuoteConfig} cfg
 * @returns {DesiredOrder[]}
 */
export function computeDesiredQuotes(state, cfg) {
  invariant(cfg.tickSize > 0, "tickSize must be > 0", { tickSize: cfg.tickSize });
  invariant(cfg.maxSpread > 0, "maxSpread must be > 0", { maxSpread: cfg.maxSpread });
  invariant(cfg.halfSpread > 0, "halfSpread must be > 0", { halfSpread: cfg.halfSpread });
  invariant(cfg.orderSize >= cfg.minSize, "orderSize must be >= minSize", { orderSize: cfg.orderSize, minSize: cfg.minSize });
  invariant(cfg.inventoryTarget > 0, "inventoryTarget must be > 0", { inventoryTarget: cfg.inventoryTarget });
  invariant(cfg.maxSkew >= 0, "maxSkew must be >= 0", { maxSkew: cfg.maxSkew });

  const bb = state.bestBid;
  const ba = state.bestAsk;
  invariant(bb && ba, "cannot quote without best bid/ask");
  invariant(bb.price < ba.price, "crossed book; cannot compute midpoint", { bid: bb.price, ask: ba.price });

  const mid = (bb.price + ba.price) / 2;
  const half = Math.min(cfg.halfSpread, cfg.maxSpread / 2);

  const invNorm = clamp(state.inventory / cfg.inventoryTarget, -1, 1);
  // Positive inventory => shift down (more eager to sell, less eager to buy).
  const skew = invNorm * cfg.maxSkew;

  const tick = cfg.tickSize;
  const center = mid - skew;

  // Work on the tick grid directly so we can guarantee maxSpread after rounding.
  const maxTicks = Math.floor(cfg.maxSpread / tick + 1e-12);
  invariant(maxTicks >= 1, "maxSpread too small for tickSize", { maxSpread: cfg.maxSpread, tickSize: tick });

  const desiredTotal = Math.min(cfg.maxSpread, 2 * half);
  const desiredTicks = Math.max(1, Math.round(desiredTotal / tick));
  let spreadTicks = Math.min(maxTicks, desiredTicks);

  // Clamp to the valid Polymarket price domain (0, 1) on the tick grid.
  // We intentionally avoid quoting at exactly 0 or 1, since those are not meaningful prices.
  const oneTicks = Math.round(1 / tick + 1e-12);
  const one = oneTicks * tick;
  invariant(Math.abs(one - 1) <= 1e-9, "tickSize must evenly divide 1.0", { tickSize: tick, oneTicks, one });
  const minTick = 1;
  const maxTick = oneTicks - 1;
  invariant(maxTick >= minTick, "tickSize too large for (0,1) price domain", { tickSize: tick, minTick, maxTick });
  const maxSpreadTicksDomain = maxTick - minTick;
  if (spreadTicks > maxSpreadTicksDomain) spreadTicks = maxSpreadTicksDomain;
  invariant(spreadTicks >= 1, "unable to quote on tick grid within (0,1) price domain", { tickSize: tick, spreadTicks });

  const centerTicks = center / tick;
  const bidTick0 = Math.round(centerTicks - spreadTicks / 2);
  const bidTick = clamp(bidTick0, minTick, maxTick - spreadTicks);
  const askTick = bidTick + spreadTicks;

  const bid = bidTick * tick;
  const ask = askTick * tick;

  invariant(ask > bid, "unable to compute positive spread on tick grid", { bid, ask, spreadTicks });
  invariant(ask - bid <= cfg.maxSpread + 1e-9, "unable to satisfy maxSpread on tick grid", { bid, ask, maxSpread: cfg.maxSpread, tickSize: tick });
  invariant(bid > 0 && ask < 1, "unable to quote within (0,1) bounds", { bid, ask, tickSize: tick });

  const size = cfg.orderSize;
  return [
    { side: "BUY", price: bid, size },
    { side: "SELL", price: ask, size }
  ];
}
