// @ts-check

import { invariant } from "./assert.js";

export const RUN_JOURNAL_SCHEMA_VERSION = 1;

/**
 * @typedef {{
 *  v: 1,
 *  t: number,
 *  kind: "meta" | "cycle",
 *  // meta
 *  runner?: string,
 *  markets?: string[],
 *  // cycle
 *  market?: string,
 *  i?: number,
 *  ops?: { placed?: number, placedOk?: number, canceled?: number, cancelOk?: number, cancelAll?: boolean },
 *  scoring?: { buy?: { scoring: boolean, reason: string }, sell?: { scoring: boolean, reason: string } },
 *  economics?: { cash?: number, position?: number, pnlMarkToMid?: number|null, fillCount?: number }
 * }} RunJournalEntry
 */

/**
 * @param {any} e
 * @returns {{ ok: true, entry: RunJournalEntry } | { ok: false, error: { code: string, message: string } }}
 */
export function validateRunJournalEntry(e) {
  if (!e || typeof e !== "object") {
    return { ok: false, error: { code: "not_object", message: "entry must be an object" } };
  }

  if (e.v !== RUN_JOURNAL_SCHEMA_VERSION) {
    return { ok: false, error: { code: "bad_version", message: "entry.v must equal schema version" } };
  }

  if (!Number.isInteger(e.t) || e.t < 0) {
    return { ok: false, error: { code: "bad_time", message: "entry.t must be integer >= 0" } };
  }

  const kind = e.kind;
  if (kind !== "meta" && kind !== "cycle") {
    return { ok: false, error: { code: "bad_kind", message: "entry.kind must be meta|cycle" } };
  }

  if (kind === "meta") {
    if (e.runner != null && typeof e.runner !== "string") {
      return { ok: false, error: { code: "bad_runner", message: "meta.runner must be string when provided" } };
    }
    if (e.markets != null) {
      if (!Array.isArray(e.markets) || e.markets.some((m) => typeof m !== "string" || !m)) {
        return { ok: false, error: { code: "bad_markets", message: "meta.markets must be string[]" } };
      }
    }
    return { ok: true, entry: e };
  }

  // cycle
  if (typeof e.market !== "string" || !e.market) {
    return { ok: false, error: { code: "bad_market", message: "cycle.market must be a non-empty string" } };
  }
  if (!Number.isInteger(e.i) || e.i < 0) {
    return { ok: false, error: { code: "bad_i", message: "cycle.i must be integer >= 0" } };
  }
  if (e.ops != null && typeof e.ops !== "object") {
    return { ok: false, error: { code: "bad_ops", message: "cycle.ops must be object when provided" } };
  }
  if (e.scoring != null && typeof e.scoring !== "object") {
    return { ok: false, error: { code: "bad_scoring", message: "cycle.scoring must be object when provided" } };
  }
  if (e.economics != null && typeof e.economics !== "object") {
    return { ok: false, error: { code: "bad_econ", message: "cycle.economics must be object when provided" } };
  }
  return { ok: true, entry: e };
}

/**
 * Helper to build a meta entry with invariant checks.
 *
 * @param {{ t: number, runner: string, markets: string[] }} params
 * @returns {RunJournalEntry}
 */
export function makeRunJournalMeta(params) {
  invariant(Number.isInteger(params.t) && params.t >= 0, "t must be integer >= 0");
  invariant(typeof params.runner === "string" && params.runner.length > 0, "runner is required");
  invariant(Array.isArray(params.markets) && params.markets.length > 0, "markets must be non-empty string[]");
  for (const m of params.markets) invariant(typeof m === "string" && m.length > 0, "market must be non-empty string");
  return { v: 1, t: params.t, kind: "meta", runner: params.runner, markets: params.markets.slice() };
}

