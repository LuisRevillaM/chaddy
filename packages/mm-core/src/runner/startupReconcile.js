// @ts-check

import { invariant } from "../../../shared/src/assert.js";

import { runMmCoreLoop } from "./mmCoreLoop.js";

/**
 * Startup reconciliation runner:
 * - cancel-all once at start (executor boundary)
 * - run a fresh mm-core loop (new orderbook + trackers)
 * - rely on ResyncingOrderbook behavior to gate quoting until a snapshot arrives
 *
 * @param {import("./mmCoreLoop.js").MmCoreLoopConfig} loopCfg
 * @param {import("./mmCoreLoop.js").MmCoreLoopDeps} deps
 * @returns {{
 *  startup: { cancelAll: { ok: boolean, reason: string|null, canceled: number } },
 *  loop: ReturnType<typeof runMmCoreLoop>,
 *  gating: { firstSnapshotStep: number|null, firstQuoteStep: number|null }
 * }}
 */
export function runStartupReconcile(loopCfg, deps) {
  invariant(loopCfg && typeof loopCfg === "object", "loopCfg is required");
  invariant(deps && typeof deps === "object", "deps is required");
  invariant(deps.executor && typeof deps.executor.cancelAll === "function", "deps.executor.cancelAll is required");

  // Cancel any orphaned live orders from a previous run.
  const cancelAll = deps.executor.cancelAll();

  // Start from a clean in-memory state: mm-core loop creates fresh orderbook/trackers.
  const loop = runMmCoreLoop(loopCfg, deps);

  let firstSnapshotStep = null;
  let firstQuoteStep = null;
  for (const e of loop.trace) {
    if (firstSnapshotStep == null) {
      if (e && e.bestBid && e.bestAsk) firstSnapshotStep = e.i;
    }
    if (firstQuoteStep == null) {
      if (e && Array.isArray(e.placed) && e.placed.length > 0) firstQuoteStep = e.i;
    }
  }

  return {
    startup: { cancelAll },
    loop,
    gating: { firstSnapshotStep, firstQuoteStep }
  };
}

