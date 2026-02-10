// @ts-check

import { invariant } from "../../../shared/src/assert.js";

/**
 * @typedef {"BUY"|"SELL"} Side
 *
 * @typedef {{
 *  id: string,
 *  side: Side,
 *  price: number,
 *  size: number
 * }} LiveOrder
 *
 * @typedef {{
 *  side: Side,
 *  price: number,
 *  size: number
 * }} DesiredOrder
 *
 * @typedef {{
 *  priceTolerance: number,
 *  sizeTolerance: number,
 *  maxCancelsPerCycle: number,
 *  maxPlacesPerCycle: number
 * }} DiffConfig
 */

/**
 * Decide minimal changes to converge live -> desired while limiting churn.
 *
 * Simplifying assumption (MVP): at most one live order per side should exist.
 *
 * @param {DesiredOrder[]} desired
 * @param {LiveOrder[]} live
 * @param {DiffConfig} cfg
 * @returns {{ cancel: string[], place: DesiredOrder[] }}
 */
export function diffOrders(desired, live, cfg) {
  invariant(cfg.maxCancelsPerCycle >= 0, "maxCancelsPerCycle must be >= 0");
  invariant(cfg.maxPlacesPerCycle >= 0, "maxPlacesPerCycle must be >= 0");
  invariant(cfg.priceTolerance >= 0, "priceTolerance must be >= 0");
  invariant(cfg.sizeTolerance >= 0, "sizeTolerance must be >= 0");

  /** @type {string[]} */
  const cancel = [];
  /** @type {DesiredOrder[]} */
  const place = [];

  for (/** @type {Side[]} */ const side of ["BUY", "SELL"]) {
    const d = desired.find((o) => o.side === side) ?? null;
    const liveForSide = live.filter((o) => o.side === side);
    const keep = liveForSide.find((o) => {
      if (!d) return false;
      const priceOk = Math.abs(o.price - d.price) <= cfg.priceTolerance;
      const sizeOk = Math.abs(o.size - d.size) <= cfg.sizeTolerance;
      return priceOk && sizeOk;
    });

    for (const o of liveForSide) {
      if (keep && o.id === keep.id) continue;
      cancel.push(o.id);
    }

    if (d && !keep) place.push(d);
  }

  return {
    cancel: cancel.slice(0, cfg.maxCancelsPerCycle),
    place: place.slice(0, cfg.maxPlacesPerCycle)
  };
}

