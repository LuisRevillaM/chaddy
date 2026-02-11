import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { parseGammaClobTokenIds } from "../../packages/shared/src/gamma.js";

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

test("parseGammaClobTokenIds: handles array, JSON-encoded array string, and single string", () => {
  assert.deepEqual(parseGammaClobTokenIds(["a", "b", "a"]), ["a", "b"]);
  assert.deepEqual(parseGammaClobTokenIds("[\"x\", \"y\", \"x\"]"), ["x", "y"]);
  assert.deepEqual(parseGammaClobTokenIds("solo"), ["solo"]);
  assert.deepEqual(parseGammaClobTokenIds(""), []);
});

test("resolve-gamma CLI: fixture mode resolves slug -> assetId and writes unit artifact", async () => {
  const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
  assert.ok(outDir, "PROVE_OUT_DIR must be set by the harness");

  const repoRoot = process.cwd();
  const fixturePath = path.join(repoRoot, "tests", "unit", "fixtures", "gamma-markets.json");
  const cliOutPath = path.join(outDir, "gamma-resolve-cli.out.json");

  const r = await run(
    "node",
    [
      path.join("scripts", "resolve-gamma.mjs"),
      "--mode",
      "fixture",
      "--gamma-slug",
      "alpha-vs-bravo",
      "--token-index",
      "1",
      "--fixture",
      fixturePath,
      "--out",
      cliOutPath
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, PROVE_NO_NETWORK: "1" }
    }
  );
  assert.equal(r.code, 0, JSON.stringify({ stdout: r.stdout, stderr: r.stderr }));

  const cliOut = JSON.parse(await fs.readFile(cliOutPath, "utf8"));
  assert.equal(cliOut.ok, true);
  assert.equal(cliOut.input.mode, "fixture");
  assert.equal(cliOut.resolved.slug, "alpha-vs-bravo");
  assert.equal(cliOut.resolved.assetId, "alpha_no");
  assert.equal(cliOut.resolved.tokenCount, 2);
  assert.deepEqual(cliOut.resolved.tokenIds, ["alpha_yes", "alpha_no"]);

  const artifact = {
    ok: cliOut.ok,
    input: cliOut.input,
    resolved: {
      slug: cliOut.resolved.slug,
      marketId: cliOut.resolved.marketId,
      tokenIndex: cliOut.resolved.tokenIndex,
      tokenCount: cliOut.resolved.tokenCount,
      assetId: cliOut.resolved.assetId,
      tokenIds: cliOut.resolved.tokenIds
    }
  };
  await fs.writeFile(path.join(outDir, "gamma-resolve.json"), JSON.stringify(artifact, null, 2) + "\n", "utf8");
});

