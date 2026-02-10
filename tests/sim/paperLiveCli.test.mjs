import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

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

test("sim: paper-live CLI runs in fixture mode and writes a stable status JSON", async () => {
  const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
  assert.ok(outDir, "PROVE_OUT_DIR must be set by the harness");

  const outPath = path.join(outDir, "paper-live-cli.json");
  const repoRoot = process.cwd();

  const r = await run(
    process.execPath,
    [
      path.join("scripts", "run-paper-live.mjs"),
      "--mode",
      "fixture",
      "--steps",
      "2",
      "--step-ms",
      "1000",
      "--market-fixture",
      path.join("tests", "replay", "fixtures", "polymarket-market-channel.jsonl"),
      "--out",
      outPath
    ],
    { cwd: repoRoot, env: { ...process.env, GEO_ALLOWED: "1" } }
  );

  assert.equal(r.code, 0, JSON.stringify({ stdout: r.stdout, stderr: r.stderr }));

  const txt = await fs.readFile(outPath, "utf8");
  const obj = JSON.parse(txt);

  assert.equal(obj.mode, "fixture");
  assert.ok(obj.result && typeof obj.result === "object");

  // mm-core loop schema sanity.
  assert.ok(obj.result.churnSummary && typeof obj.result.churnSummary === "object");
  assert.ok(obj.result.scoringSummary && typeof obj.result.scoringSummary === "object");
  assert.ok(Array.isArray(obj.result.trace));
  assert.ok(obj.result.stateFinal && typeof obj.result.stateFinal === "object");
  assert.ok(obj.result.final && typeof obj.result.final === "object");

  // Fixture-driven trace should reflect the snapshot + delta messages.
  assert.equal(obj.result.trace.length, 2);
  assert.deepEqual(obj.result.trace[0].bestBid, { price: 0.5, size: 15 });
  assert.deepEqual(obj.result.trace[0].bestAsk, { price: 0.52, size: 25 });
  assert.deepEqual(obj.result.trace[1].bestBid, { price: 0.51, size: 40 });
  assert.deepEqual(obj.result.trace[1].bestAsk, { price: 0.53, size: 60 });

  // Quoting should update after the delta shifts the midpoint.
  assert.equal(obj.result.churnSummary.quoteUpdateCycles, 2, JSON.stringify(obj.result.churnSummary));
  assert.equal(obj.result.churnSummary.placeOk, 4, JSON.stringify(obj.result.churnSummary));
  assert.equal(obj.result.churnSummary.cancelOk, 2, JSON.stringify(obj.result.churnSummary));

  // End state should reflect the second-step desired quotes.
  assert.ok(Array.isArray(obj.result.stateFinal.liveOrders));
  assert.equal(obj.result.stateFinal.liveOrders.length, 2);
  const bySide = Object.fromEntries(obj.result.stateFinal.liveOrders.map((o) => [o.side, o]));
  assert.deepEqual({ price: bySide.BUY.price, size: bySide.BUY.size }, { price: 0.5, size: 1 });
  assert.deepEqual({ price: bySide.SELL.price, size: bySide.SELL.size }, { price: 0.54, size: 1 });
});

