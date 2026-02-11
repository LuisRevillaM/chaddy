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

test("sim: operator doctor runs offline, redacts ip, and writes deterministic report artifact", async () => {
  const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
  assert.ok(outDir, "PROVE_OUT_DIR must be set by the harness");

  const repoRoot = process.cwd();
  const doctorPath = path.join(repoRoot, "artifacts", "operator", "doctor.json");

  const r = await run("bash", [path.join("operator", "doctor.command")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PROVE_NO_NETWORK: "1",
      GEO_ALLOWED: "1"
    }
  });
  assert.equal(r.code, 0, JSON.stringify({ stdout: r.stdout, stderr: r.stderr }));

  const doctor = JSON.parse(await fs.readFile(doctorPath, "utf8"));
  assert.equal(doctor.ok, true);
  assert.equal(doctor.offlineMode, true);
  assert.equal(doctor.selfcheck?.ok, true);
  assert.equal(doctor.geoblock?.mode, "offline_env");
  assert.equal(doctor.geoblock?.allowed, true);
  assert.equal(doctor.geoblock?.details?.ip, null);
  assert.equal(doctor.geoblock?.details?.ipRedacted, true);
  assert.equal(doctor.integration?.enabled, false);
  assert.equal(doctor.integration?.ran, false);

  const artifact = {
    ok: doctor.ok,
    offlineMode: doctor.offlineMode,
    selfcheck: {
      ok: doctor.selfcheck?.ok,
      exitCode: doctor.selfcheck?.exitCode,
      reasons: doctor.selfcheck?.report?.reasons ?? []
    },
    geoblock: {
      mode: doctor.geoblock?.mode,
      allowed: doctor.geoblock?.allowed,
      details: doctor.geoblock?.details
    },
    integration: {
      enabled: doctor.integration?.enabled,
      ran: doctor.integration?.ran,
      ok: doctor.integration?.ok,
      note: doctor.integration?.note ?? null
    },
    doctorPath: path.relative(repoRoot, doctorPath)
  };

  await fs.writeFile(path.join(outDir, "operator-doctor.json"), JSON.stringify(artifact, null, 2) + "\n", "utf8");
});

