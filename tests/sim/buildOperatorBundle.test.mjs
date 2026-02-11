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

test("sim: build-operator-bundle writes deterministic manifest", async () => {
  const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
  assert.ok(outDir, "PROVE_OUT_DIR must be set by the harness");

  const repoRoot = process.cwd();
  const bundleDir = path.join(repoRoot, "artifacts", "operator-bundle", "latest");
  const manifestPath = path.join(bundleDir, "manifest.json");

  const first = await run("node", [path.join("scripts", "build-operator-bundle.mjs")], { cwd: repoRoot, env: process.env });
  assert.equal(first.code, 0, JSON.stringify({ stdout: first.stdout, stderr: first.stderr }));
  const manifest1 = JSON.parse(await fs.readFile(manifestPath, "utf8"));

  const second = await run("node", [path.join("scripts", "build-operator-bundle.mjs")], { cwd: repoRoot, env: process.env });
  assert.equal(second.code, 0, JSON.stringify({ stdout: second.stdout, stderr: second.stderr }));
  const manifest2 = JSON.parse(await fs.readFile(manifestPath, "utf8"));

  assert.deepEqual(manifest2, manifest1);
  assert.equal(manifest1.schemaVersion, 1);
  assert.ok(Array.isArray(manifest1.files) && manifest1.files.length > 0);
  assert.ok(manifest1.files.every((f) => typeof f.path === "string" && typeof f.sha256 === "string" && typeof f.bytes === "number"));

  await fs.writeFile(
    path.join(outDir, "operator-bundle-manifest.json"),
    JSON.stringify(
      {
        ok: true,
        bundleDir: path.relative(repoRoot, bundleDir),
        manifest: manifest1
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
});

