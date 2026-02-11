#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createGeoChecker } from "../packages/executor/src/geoblockClient.js";

const REPO_ROOT = process.cwd();

function parseArgs(argv) {
  const args = { out: path.join(REPO_ROOT, "artifacts", "operator", "doctor.json"), bundle: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") {
      args.out = path.resolve(String(argv[i + 1] ?? args.out));
      i++;
      continue;
    }
    if (a === "--bundle") {
      args.bundle = true;
      continue;
    }
  }
  return args;
}

function nowIso() {
  return new Date().toISOString();
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function writeJson(p, obj) {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function redactGeoDetails(details) {
  if (!details || typeof details !== "object") return null;
  return {
    blocked: typeof details.blocked === "boolean" ? details.blocked : null,
    country: typeof details.country === "string" ? details.country : null,
    region: typeof details.region === "string" ? details.region : null,
    ip: null,
    ipRedacted: true
  };
}

async function runSelfcheck(operatorDir) {
  const selfcheckOut = path.join(REPO_ROOT, "artifacts", "operator", "selfcheck.json");
  const startedAt = nowIso();
  const r = await run("bash", [path.join(operatorDir, "selfcheck.command")], {
    cwd: REPO_ROOT,
    env: { ...process.env, OPERATOR_SELF_CHECK_OUT: selfcheckOut }
  });
  const finishedAt = nowIso();

  let report = null;
  try {
    report = JSON.parse(await fs.readFile(selfcheckOut, "utf8"));
  } catch {
    report = null;
  }

  return {
    ok: r.code === 0,
    exitCode: r.code,
    outPath: path.relative(REPO_ROOT, selfcheckOut),
    startedAt,
    finishedAt,
    report,
    stdout: r.stdout.trim(),
    stderr: r.stderr.trim()
  };
}

async function runGeoblockCheck() {
  const offline = process.env.PROVE_NO_NETWORK === "1";
  if (offline) {
    const allowed = process.env.GEO_ALLOWED === "1";
    return {
      mode: "offline_env",
      ok: true,
      allowed,
      note: "PROVE_NO_NETWORK=1; skipped remote geoblock endpoint",
      details: { blocked: !allowed, country: null, region: null, ip: null, ipRedacted: true }
    };
  }

  const checker = createGeoChecker({ fetchImpl: fetch, cacheMs: 0 });
  const r = await checker.isAllowed();
  return {
    mode: "live_endpoint",
    ok: true,
    allowed: r.allowed,
    note: null,
    details: redactGeoDetails(r.details)
  };
}

async function runIntegrationIfEnabled() {
  const enabled = process.env.INTEGRATION_ENABLED === "1";
  const offline = process.env.PROVE_NO_NETWORK === "1";
  const integrationLog = path.join(REPO_ROOT, "artifacts", "operator", "integration.log");

  if (!enabled) {
    return { enabled, ran: false, ok: true, exitCode: 0, note: "INTEGRATION_ENABLED!=1; skipped", logPath: null };
  }
  if (offline) {
    return {
      enabled,
      ran: false,
      ok: true,
      exitCode: 0,
      note: "PROVE_NO_NETWORK=1; skipped integration to preserve offline mode",
      logPath: null
    };
  }

  const startedAt = nowIso();
  const r = await run("npm", ["run", "integration"], { cwd: REPO_ROOT, env: process.env });
  const finishedAt = nowIso();

  await ensureDir(path.dirname(integrationLog));
  const log = [
    "[stdout]",
    r.stdout.trim(),
    "",
    "[stderr]",
    r.stderr.trim()
  ].join("\n");
  await fs.writeFile(integrationLog, log + "\n", "utf8");

  return {
    enabled,
    ran: true,
    ok: r.code === 0,
    exitCode: r.code,
    note: null,
    startedAt,
    finishedAt,
    logPath: path.relative(REPO_ROOT, integrationLog)
  };
}

async function writeBundleIfEnabled(doctorPath) {
  const bundlePath = path.join(REPO_ROOT, "artifacts", "operator", "doctor-bundle.tgz");
  const relDoctor = path.relative(path.join(REPO_ROOT, "artifacts", "operator"), doctorPath);

  const entries = ["doctor.json", "selfcheck.json", "integration.log"];
  if (relDoctor === "doctor.json") {
    // already included
  }

  const existing = [];
  for (const e of entries) {
    try {
      const p = path.join(REPO_ROOT, "artifacts", "operator", e);
      const st = await fs.stat(p);
      if (st.isFile()) existing.push(e);
    } catch {
      // ignore
    }
  }

  if (existing.length === 0) return null;

  const r = await run("tar", ["-czf", bundlePath, "-C", path.join(REPO_ROOT, "artifacts", "operator"), ...existing], {
    cwd: REPO_ROOT
  });
  if (r.code !== 0) return null;
  return path.relative(REPO_ROOT, bundlePath);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const operatorDir = path.join(REPO_ROOT, "operator");

  const startedAt = nowIso();
  const selfcheck = await runSelfcheck(operatorDir);
  const geoblock = await runGeoblockCheck();
  const integration = await runIntegrationIfEnabled();

  const doctor = {
    ok: Boolean(selfcheck.ok && geoblock.allowed && integration.ok),
    repoRoot: REPO_ROOT,
    startedAt,
    finishedAt: nowIso(),
    offlineMode: process.env.PROVE_NO_NETWORK === "1",
    selfcheck: {
      ok: selfcheck.ok,
      exitCode: selfcheck.exitCode,
      outPath: selfcheck.outPath,
      report: selfcheck.report
    },
    geoblock,
    integration
  };

  await writeJson(args.out, doctor);

  let bundlePath = null;
  if (args.bundle || process.env.OPERATOR_DOCTOR_BUNDLE === "1") {
    bundlePath = await writeBundleIfEnabled(args.out);
  }

  if (bundlePath) {
    doctor.bundlePath = bundlePath;
    await writeJson(args.out, doctor);
  }

  console.log(`doctor: wrote ${args.out}`);
  if (bundlePath) console.log(`doctor: wrote ${path.join(REPO_ROOT, bundlePath)}`);

  process.exit(doctor.ok ? 0 : 1);
}

main().catch(async (err) => {
  const outPath = path.join(REPO_ROOT, "artifacts", "operator", "doctor.json");
  await writeJson(outPath, {
    ok: false,
    fatal: String(err?.message || err),
    offlineMode: process.env.PROVE_NO_NETWORK === "1"
  });
  console.error(err);
  process.exit(1);
});

