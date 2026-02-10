// @ts-check

let COUNTER = 0;

/**
 * @param {string} prefix
 */
export function newId(prefix) {
  COUNTER = (COUNTER + 1) % 1_000_000;
  // Deterministic ID generation (no wall-clock).
  return `${prefix}_${COUNTER}`;
}

// Exposed for tests/sims that want stable IDs regardless of test order.
export function _resetIdsForTesting() {
  COUNTER = 0;
}
