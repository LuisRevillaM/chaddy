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

test("sim: shadow-live CLI runs in fixture mode and writes a stable status JSON", async () => {
  const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
  assert.ok(outDir, "PROVE_OUT_DIR must be set by the harness");

  const outPath = path.join(outDir, "shadow-live-cli.json");
  const repoRoot = process.cwd();

  const r = await run(
    process.execPath,
    [
      path.join("scripts", "run-shadow-live.mjs"),
      "--mode",
      "fixture",
      "--steps",
      "5",
      "--step-ms",
      "1000",
      "--market-fixture",
      path.join("tests", "replay", "fixtures", "polymarket-market-channel.jsonl"),
      "--user-fixture",
      path.join("tests", "replay", "fixtures", "polymarket-user-channel.jsonl"),
      "--out",
      outPath
    ],
    { cwd: repoRoot, env: process.env }
  );

  assert.equal(r.code, 0, JSON.stringify({ stdout: r.stdout, stderr: r.stderr }));

  const txt = await fs.readFile(outPath, "utf8");
  const obj = JSON.parse(txt);

  assert.equal(obj.mode, "fixture");
  assert.ok(obj.result && typeof obj.result === "object");
  assert.ok(Array.isArray(obj.result.history));
  assert.ok(obj.result.final && typeof obj.result.final === "object");

  // Schema sanity: final snapshot contains key observability fields.
  const f = obj.result.final;
  assert.ok(typeof f.market === "string" && f.market.length > 0);
  assert.ok(f.orderbook && typeof f.orderbook === "object");
  assert.ok("bestBid" in f.orderbook && "bestAsk" in f.orderbook);
  assert.ok(Array.isArray(f.desiredQuotes));
  assert.ok(typeof f.inventory === "number");
  assert.ok(Array.isArray(f.liveOrders));
  assert.ok(f.killSwitch && typeof f.killSwitch === "object");
});

