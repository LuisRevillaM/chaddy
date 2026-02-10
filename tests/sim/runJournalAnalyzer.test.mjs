import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { Executor } from "../../packages/executor/src/Executor.js";
import { runMmCoreLoop } from "../../packages/mm-core/src/runner/mmCoreLoop.js";
import { createMockScoringChecker } from "../../packages/mm-core/src/scoring/mockScoringChecker.js";
import { makeRunJournalMeta, RUN_JOURNAL_SCHEMA_VERSION } from "../../packages/shared/src/runJournalSchema.js";
import { _resetIdsForTesting } from "../../packages/shared/src/ids.js";
import { SimExchange } from "../../packages/sim/src/SimExchange.js";

function run(cmd, args, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

test("sim: run journal analyzer outputs a single deterministic summary JSON", async () => {
  const prevGeo = process.env.GEO_ALLOWED;
  try {
    process.env.GEO_ALLOWED = "1";
    _resetIdsForTesting();

    const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
    assert.ok(outDir, "PROVE_OUT_DIR must be set by the harness");

    const ex = new SimExchange({ seed: 777, tickSize: 0.01, mid: 0.5, extSpread: 0.04 });
    const market = "tok_JOURNAL";
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
        ex.placeOrder({ side: "BUY", price: 0.99, size: 1 });
        ex.placeOrder({ side: "SELL", price: 0.01, size: 1 });
      }
      ex.step();
    };

    const result = runMmCoreLoop(
      {
        market,
        steps: 8,
        activeMarketSteps: 8,
        stepMs: 1_000,
        quoteCfg: {
          tickSize: ex.tickSize,
          halfSpread: 0.02,
          maxSpread: 0.1,
          minSize: 1,
          orderSize: 1,
          inventoryTarget: 10,
          maxSkew: 0.02
        },
        killSwitchCfg: { staleMarketDataMs: 60_000, staleUserDataMs: 60_000 },
        diffCfg: { priceTolerance: 0, sizeTolerance: 0, maxCancelsPerCycle: 10, maxPlacesPerCycle: 10 },
        throttle: { minIntervalMs: 0 },
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

    const journalPath = path.join(outDir, "run.journal.jsonl");
    const summaryPath = path.join(outDir, "run-summary.json");

    const lines = [];
    lines.push(JSON.stringify(makeRunJournalMeta({ t: 0, runner: "sim", markets: [market] })));
    for (const e of result.trace) {
      const placedOk = Array.isArray(e.placed) ? e.placed.filter((p) => p.ok).length : 0;
      const cancelOk = Array.isArray(e.canceled) ? e.canceled.length : 0;
      lines.push(
        JSON.stringify({
          v: RUN_JOURNAL_SCHEMA_VERSION,
          t: e.nowMs,
          kind: "cycle",
          market,
          i: e.i,
          ops: {
            placed: Array.isArray(e.placed) ? e.placed.length : 0,
            placedOk,
            canceled: Array.isArray(e.canceled) ? e.canceled.length : 0,
            cancelOk,
            cancelAll: Boolean(e.killSwitch && e.killSwitch.cancelAll)
          },
          scoring: e.scoring
            ? {
                buy: { scoring: Boolean(e.scoring.buy.scoring), reason: String(e.scoring.buy.reason) },
                sell: { scoring: Boolean(e.scoring.sell.scoring), reason: String(e.scoring.sell.reason) }
              }
            : null,
          economics: e.economics || null
        })
      );
    }
    await fs.writeFile(journalPath, lines.join("\n") + "\n", "utf8");

    const r = await run(process.execPath, [path.join("scripts", "analyze-run.mjs"), "--journal", journalPath, "--out", summaryPath], {
      cwd: process.cwd(),
      env: process.env
    });
    assert.equal(r.code, 0, JSON.stringify({ stdout: r.stdout, stderr: r.stderr }));

    const summary = JSON.parse(await fs.readFile(summaryPath, "utf8"));
    assert.equal(summary.schemaVersion, RUN_JOURNAL_SCHEMA_VERSION);
    assert.ok(typeof summary.uptimeMs === "number");
    assert.ok(summary.meta && summary.meta.journal);
    assert.ok(summary.churn && typeof summary.churn.placed === "number");
  } finally {
    if (prevGeo == null) delete process.env.GEO_ALLOWED;
    else process.env.GEO_ALLOWED = prevGeo;
  }
});

