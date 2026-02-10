import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { Executor } from "../../packages/executor/src/Executor.js";
import { runMmCoreLoop } from "../../packages/mm-core/src/runner/mmCoreLoop.js";
import { createMockScoringChecker } from "../../packages/mm-core/src/scoring/mockScoringChecker.js";
import { _resetIdsForTesting } from "../../packages/shared/src/ids.js";
import { SimExchange } from "../../packages/sim/src/SimExchange.js";

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const qq = Math.max(0, Math.min(1, q));
  const idx = Math.floor(qq * (sorted.length - 1));
  return sorted[idx];
}

test("sim: economics ledger produces deterministic mark-to-mid summary artifact", async () => {
  const prevGeo = process.env.GEO_ALLOWED;
  try {
    process.env.GEO_ALLOWED = "1";
    _resetIdsForTesting();

    const ex = new SimExchange({ seed: 321, tickSize: 0.01, mid: 0.5, extSpread: 0.04 });
    const market = "tok_ECON";
    const STEP_MS = 1_000;
    const midpointRef = { value: null };

    const exec = new Executor({
      exchange: ex,
      policy: {
        allowedMarkets: [market],
        minOrderSize: 1,
        maxOrderSize: 50,
        maxAbsNotional: 1_000,
        maxPriceBand: 0.2
      },
      marketMidpoint: () => midpointRef.value
    });

    const scoringChecker = createMockScoringChecker({ minSize: 1, requireTopOfBook: true });

    let seeded = false;
    const stepMarket = () => {
      if (!seeded) {
        seeded = true;
        // Seed two crossing orders so we deterministically generate fills on the first step.
        ex.placeOrder({ side: "BUY", price: 0.99, size: 1 });
        ex.placeOrder({ side: "SELL", price: 0.01, size: 1 });
      }
      ex.step();
    };

    const result = runMmCoreLoop(
      {
        market,
        steps: 12,
        activeMarketSteps: 12,
        stepMs: STEP_MS,
        quoteCfg: {
          tickSize: ex.tickSize,
          halfSpread: 0.02,
          maxSpread: 0.1,
          minSize: 1,
          orderSize: 1,
          inventoryTarget: 10,
          maxSkew: 0.02
        },
        // Keep staleness generous; this artifact is about economics, not kill-switch.
        killSwitchCfg: { staleMarketDataMs: 60_000, staleUserDataMs: 60_000 },
        diffCfg: { priceTolerance: 0, sizeTolerance: 0, maxCancelsPerCycle: 10, maxPlacesPerCycle: 10 },
        // Place once early, then hold.
        throttle: { minIntervalMs: 999_999 },
        tokenBucket: { capacity: 10, refillEveryMs: 1_000 },
        scoringCfg: { minSize: 1, requireTopOfBook: true },
        traceMax: 400
      },
      {
        onMarket: (cb) => {
          ex.on("market", cb);
          return () => ex.off("market", cb);
        },
        onUser: (cb) => {
          ex.on("user", cb);
          return () => ex.off("user", cb);
        },
        stepMarket,
        executor: exec,
        scoringChecker,
        midpointRef
      }
    );

    const pnlSeries = result.trace
      .map((e) => e?.economics?.pnlMarkToMid)
      .filter((x) => typeof x === "number" && Number.isFinite(x));
    assert.ok(pnlSeries.length > 0, "pnl series should be non-empty");

    const sorted = pnlSeries.slice().sort((a, b) => a - b);
    const econFinal = result.stateFinal.economics;
    assert.ok(econFinal && typeof econFinal === "object");

    const finalMid = midpointRef.value;
    const finalPnl = typeof finalMid === "number" ? econFinal.cash + econFinal.position * finalMid : null;

    const artifact = {
      meta: { market, stepMs: STEP_MS, steps: 12, seed: 321, tickSize: ex.tickSize, extSpread: ex.extSpread },
      fills: { fillCount: econFinal.fillCount, duplicateFillCount: econFinal.duplicateFillCount },
      final: { cash: econFinal.cash, position: econFinal.position, mid: finalMid, pnl: finalPnl },
      pnl: {
        n: pnlSeries.length,
        first: pnlSeries[0],
        last: pnlSeries[pnlSeries.length - 1],
        min: sorted[0],
        p50: quantile(sorted, 0.5),
        p90: quantile(sorted, 0.9),
        max: sorted[sorted.length - 1]
      }
    };

    const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
    assert.ok(outDir, "PROVE_OUT_DIR must be set by the harness");
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, "economics-summary.json"), JSON.stringify(artifact, null, 2) + "\n", "utf8");
  } finally {
    if (prevGeo == null) delete process.env.GEO_ALLOWED;
    else process.env.GEO_ALLOWED = prevGeo;
  }
});

