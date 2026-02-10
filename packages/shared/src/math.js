// @ts-check

import { invariant } from "./assert.js";

/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 */
export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Round down to a tick.
 * @param {number} price
 * @param {number} tick
 */
export function roundDownToTick(price, tick) {
  invariant(tick > 0, "tick must be > 0", { tick });
  return Math.floor(price / tick + 1e-12) * tick;
}

/**
 * Round up to a tick.
 * @param {number} price
 * @param {number} tick
 */
export function roundUpToTick(price, tick) {
  invariant(tick > 0, "tick must be > 0", { tick });
  return Math.ceil(price / tick - 1e-12) * tick;
}

/**
 * @param {number} price
 * @param {number} tick
 */
export function isOnTick(price, tick) {
  invariant(tick > 0, "tick must be > 0", { tick });
  const q = price / tick;
  return Math.abs(q - Math.round(q)) < 1e-9;
}

