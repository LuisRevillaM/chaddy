#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = process.cwd();

function parseArgs(argv) {
  const args = { suites: null, slow: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--suite" || a === "--suites") {
      args.suites = String(argv[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      i++;
      continue;
    }
    if (a === "--slow") {
      args.slow = true;
      continue;
    }
  }
  return args;
}

function nowRunId() {
  // YYYYMMDD-HHMMSS-mmm-pPID (local time)
  // Include ms+pid to avoid collisions when multiple runs start in the same second.
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return [
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`,
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
    ms,
    `p${process.pid}`
  ].join("-");
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function rmrf(p) {
  await fs.rm(p, { recursive: true, force: true });
}

async function writeJson(p, obj) {
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

async function copyDir(src, dst) {
  await rmrf(dst);
  await ensureDir(dst);
  await fs.cp(src, dst, { recursive: true });
}

async function readGitSha() {
  // Repo might not be a git repo; this should never fail the harness.
  try {
    const { stdout } = await runCmdCapture("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT });
    return stdout.trim();
  } catch {
    return null;
  }
}

function runCmdCapture(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      ...opts,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve({ code, stdout, stderr });
      const err = new Error(`${cmd} ${args.join(" ")} exited with code ${code}`);
      err.code = code;
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    });
  });
}

function runCmdToLog(cmd, args, { cwd, env, logPath }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const chunks = [];
    const onData = (buf) => chunks.push(buf);
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", async (code) => {
      const out = Buffer.concat(chunks);
      await fs.writeFile(logPath, out);
      resolve({ code, bytes: out.length });
    });
  });
}

async function listTestFiles(dir) {
  const out = [];
  async function walk(p) {
    const ents = await fs.readdir(p, { withFileTypes: true });
    for (const ent of ents) {
      const full = path.join(p, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      if (ent.name.endsWith(".test.mjs")) out.push(full);
    }
  }
  try {
    await walk(dir);
  } catch {
    // No tests for that suite yet; treat as empty.
  }
  return out.sort();
}

function mdEscape(s) {
  return String(s).replaceAll("|", "\\|");
}

function formatDurationMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(2);
  return `${s}s`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const slow = args.slow || process.env.PROVE_SLOW === "1";
  const OFFLINE_SUITES = new Set(["unit", "replay", "sim", "soak"]);

  const defaultSuites = ["unit", "replay", "sim", "security"];
  const suites = args.suites?.length ? args.suites : defaultSuites;
  const expandedSuites = slow ? Array.from(new Set([...suites, "soak"])) : suites;

  const runId = nowRunId();
  const runRoot = path.join(REPO_ROOT, "artifacts", "proofs", "runs", runId);
  const latestRoot = path.join(REPO_ROOT, "artifacts", "proofs", "latest");

  await ensureDir(runRoot);
  await ensureDir(path.join(runRoot, "logs"));

  const meta = {
    runId,
    startedAt: new Date().toISOString(),
    repoRoot: REPO_ROOT,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    gitSha: await readGitSha(),
    suites: expandedSuites
  };

  const suiteResults = [];
  let anyFailed = false;

  for (const suite of expandedSuites) {
    const suiteStart = Date.now();
    const suiteOutDir = path.join(runRoot, "suite", suite);
    await ensureDir(suiteOutDir);

    const logPath = path.join(runRoot, "logs", `${suite}.log`);
    const logPathRel = path.join("logs", `${suite}.log`);
    const outDirRel = path.join("suite", suite);
    const env = {
      ...process.env,
      PROVE_RUN_ID: runId,
      PROVE_RUN_DIR: runRoot,
      PROVE_SUITE: suite,
      PROVE_OUT_DIR: suiteOutDir,
      PROVE_SLOW: slow ? "1" : "0",
      PROVE_NO_NETWORK: OFFLINE_SUITES.has(suite) ? "1" : "0"
    };

    let cmd;
    let cmdArgs;
    if (suite === "security") {
      cmd = process.execPath;
      cmdArgs = [path.join("scripts", "security-scan.mjs")];
    } else {
      const suiteDir = path.join(REPO_ROOT, "tests", suite);
      const testFiles = await listTestFiles(suiteDir);
      if (testFiles.length === 0) {
        await fs.writeFile(logPath, Buffer.from(`No tests found for suite '${suite}'.\n`));
        const suiteMs = Date.now() - suiteStart;
        suiteResults.push({
          suite,
          ok: true,
          exitCode: 0,
          durationMs: suiteMs,
          logPath: logPathRel,
          outDir: outDirRel,
          note: "no_tests"
        });
        continue;
      }
      cmd = process.execPath;
      cmdArgs = OFFLINE_SUITES.has(suite)
        ? ["--import", "./tests/_setup/noNetwork.mjs", "--test", ...testFiles]
        : ["--test", ...testFiles];
    }

    const { code } = await runCmdToLog(cmd, cmdArgs, {
      cwd: REPO_ROOT,
      env,
      logPath
    });

    const suiteMs = Date.now() - suiteStart;
    const ok = code === 0;
    if (!ok) anyFailed = true;

    suiteResults.push({
      suite,
      ok,
      exitCode: code,
      durationMs: suiteMs,
      logPath: logPathRel,
      outDir: outDirRel
    });
  }

  const results = {
    meta,
    suites: suiteResults,
    ok: !anyFailed,
    finishedAt: new Date().toISOString()
  };

  await writeJson(path.join(runRoot, "results.json"), results);

  const reportLines = [];
  reportLines.push(`# Proof Report`);
  reportLines.push(``);
  reportLines.push(`- Run ID: \`${meta.runId}\``);
  reportLines.push(`- Started: \`${meta.startedAt}\``);
  reportLines.push(`- Finished: \`${results.finishedAt}\``);
  reportLines.push(`- Node: \`${meta.node}\``);
  reportLines.push(`- Platform: \`${meta.platform}\``);
  if (meta.gitSha) reportLines.push(`- Git SHA: \`${meta.gitSha}\``);
  reportLines.push(``);
  reportLines.push(`## Summary`);
  reportLines.push(``);
  reportLines.push(`| Suite | Status | Duration | Log | Output |`);
  reportLines.push(`|---|---|---:|---|---|`);
  for (const s of suiteResults) {
    reportLines.push(
      `| ${mdEscape(s.suite)} | ${s.ok ? "PASS" : "FAIL"} | ${formatDurationMs(s.durationMs)} | \`${mdEscape(s.logPath)}\` | \`${mdEscape(s.outDir)}\` |`
    );
  }
  reportLines.push(``);
  reportLines.push(`## How To Debug`);
  reportLines.push(``);
  reportLines.push(`- Open the suite log under \`artifacts/proofs/latest/logs/\``);
  reportLines.push(`- Inspect any suite artifacts under \`artifacts/proofs/latest/suite/<suite>/\``);
  reportLines.push(``);

  await fs.writeFile(path.join(runRoot, "report.md"), reportLines.join("\n") + "\n", "utf8");

  await copyDir(runRoot, latestRoot);

  process.exit(anyFailed ? 1 : 0);
}

main().catch(async (err) => {
  try {
    const latestRoot = path.join(REPO_ROOT, "artifacts", "proofs", "latest");
    await ensureDir(latestRoot);
    await fs.writeFile(path.join(latestRoot, "fatal.txt"), String(err?.stack || err) + "\n", "utf8");
  } catch {
    // ignore
  }
  console.error(err);
  process.exit(1);
});
