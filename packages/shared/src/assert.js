// @ts-check

/**
 * @param {unknown} condition
 * @param {string} message
 * @param {Record<string, unknown>=} details
 */
export function invariant(condition, message, details) {
  if (condition) return;
  const suffix = details ? ` details=${JSON.stringify(details)}` : "";
  const err = new Error(`${message}${suffix}`);
  err.name = "InvariantError";
  throw err;
}

