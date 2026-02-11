// @ts-check

/**
 * Parse Gamma `clobTokenIds` into a normalized string array.
 *
 * Gamma commonly returns this field as:
 * - array of token ids
 * - JSON-encoded string containing an array
 * - single token id string
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseGammaClobTokenIds(raw) {
  /** @type {string[]} */
  let ids = [];

  if (Array.isArray(raw)) {
    ids = raw.map((x) => String(x).trim()).filter(Boolean);
  } else if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];

    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        ids = parsed.map((x) => String(x).trim()).filter(Boolean);
      } else if (typeof parsed === "string") {
        ids = [parsed.trim()].filter(Boolean);
      } else {
        ids = [s];
      }
    } catch {
      ids = [s];
    }
  } else {
    return [];
  }

  // Stable de-duplication preserving first occurrence.
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

