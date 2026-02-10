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

test("sim: operator bundle selfcheck + start-paper run offline (fixture mode) and write a stable artifact", async () => {
  const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
  assert.ok(outDir, "PROVE_OUT_DIR must be set by the harness");

  const repoRoot = process.cwd();
  const selfcheckPath = path.join(repoRoot, "artifacts", "operator", "selfcheck.json");
  const paperStatusPath = path.join(repoRoot, "artifacts", "paper-live", "latest.json");

  const selfcheck = await run("bash", [path.join("operator", "selfcheck.command")], { cwd: repoRoot, env: process.env });
  assert.equal(selfcheck.code, 0, JSON.stringify({ stdout: selfcheck.stdout, stderr: selfcheck.stderr }));

  const startPaper = await run("bash", [path.join("operator", "start-paper.command")], {
    cwd: repoRoot,
    env: { ...process.env, GEO_ALLOWED: "1" }
  });
  assert.equal(startPaper.code, 0, JSON.stringify({ stdout: startPaper.stdout, stderr: startPaper.stderr }));

  const status = await run("bash", [path.join("operator", "status.command")], { cwd: repoRoot, env: process.env });
  assert.equal(status.code, 0, JSON.stringify({ stdout: status.stdout, stderr: status.stderr }));

  const selfObj = JSON.parse(await fs.readFile(selfcheckPath, "utf8"));
  const paperObj = JSON.parse(await fs.readFile(paperStatusPath, "utf8"));

  const artifact = {
    ok: true,
    env: { PROVE_NO_NETWORK: process.env.PROVE_NO_NETWORK === "1" },
    selfcheck: {
      ok: selfObj.ok,
      node: selfObj.node,
      reasons: selfObj.reasons
    },
    startPaper: {
      mode: paperObj.mode,
      outPath: path.relative(repoRoot, paperStatusPath),
      churnSummary: paperObj?.result?.churnSummary || null,
      final: paperObj?.result?.final || null
    },
    status: {
      stdout: status.stdout.trim()
    }
  };

  await fs.writeFile(path.join(outDir, "operator-bundle.json"), JSON.stringify(artifact, null, 2) + "\n", "utf8");
});

