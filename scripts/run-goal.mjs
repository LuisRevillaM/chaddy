#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = process.cwd();

async function readJson(p) {
  const text = await fs.readFile(p, "utf8");
  return JSON.parse(text);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function parseSuitesFromCommand(cmd) {
  // Expected form: "npm run prove -- --suite unit,replay,security"
  const m = cmd.match(/--suite\s+([^\s]+)/);
  if (!m) return null;
  return m[1];
}

function run(cmd, args, { cwd }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function parseArgs(argv) {
  const out = { pack: null, goalId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pack") {
      out.pack = argv[i + 1] ?? null;
      i++;
      continue;
    }
    if (!out.goalId && !a.startsWith("-")) {
      out.goalId = a;
      continue;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const goalId = args.goalId;
  if (!goalId) {
    console.error("Usage: node scripts/run-goal.mjs [--pack <path>] <GOAL_ID>");
    process.exit(2);
  }

  const goalpackPath = path.resolve(
    REPO_ROOT,
    process.env.GOALPACK_PATH || args.pack || path.join("docs", "agent-goals", "goalpack-v1.json")
  );
  const goalpack = await readJson(goalpackPath);
  const goal = (goalpack.goals || []).find((g) => g.id === goalId);
  if (!goal) {
    console.error(`Unknown goal id: ${goalId} (pack: ${path.relative(REPO_ROOT, goalpackPath)})`);
    process.exit(2);
  }

  const suites = parseSuitesFromCommand(goal.proof?.command || "");
  if (!suites) {
    console.error(`Goal ${goalId} has unsupported proof.command format. Expected '--suite ...'.`);
    process.exit(2);
  }

  console.log(`[goal] ${goalId}: ${goal.title}`);
  console.log(`[goal] Running proofs: suites=${suites}`);

  const proveCode = await run(process.execPath, ["scripts/prove.mjs", "--suite", suites], { cwd: REPO_ROOT });

  const required = goal.proof?.required_artifacts || [];
  const missing = [];
  for (const rel of required) {
    const abs = path.join(REPO_ROOT, rel);
    if (!(await exists(abs))) missing.push(rel);
  }

  const proofResultsPath = path.join(REPO_ROOT, "artifacts", "proofs", "latest", "results.json");
  const proofResults = (await exists(proofResultsPath)) ? await readJson(proofResultsPath) : null;

  const outDir = path.join(REPO_ROOT, "artifacts", "goals", goalId, "latest");
  await fs.mkdir(outDir, { recursive: true });

  // Snapshot goal + run linkage for later debugging.
  await fs.writeFile(path.join(outDir, "goal.json"), JSON.stringify(goal, null, 2) + "\n", "utf8");
  await fs.writeFile(
    path.join(outDir, "result.json"),
    JSON.stringify(
      {
        goalId,
        title: goal.title,
        milestone: goal.milestone,
        ranAt: new Date().toISOString(),
        proof: {
          suites,
          exitCode: proveCode,
          ok: Boolean(proofResults?.ok),
          runId: proofResults?.meta?.runId || null
        },
        requiredArtifacts: required,
        missingArtifacts: missing
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  // Convenience copy of the latest proof report for this goal run.
  const reportSrc = path.join(REPO_ROOT, "artifacts", "proofs", "latest", "report.md");
  if (await exists(reportSrc)) {
    await fs.copyFile(reportSrc, path.join(outDir, "proof-report.md"));
  }

  const ok = proveCode === 0 && missing.length === 0 && Boolean(proofResults?.ok);
  if (!ok) {
    if (missing.length) {
      console.error(`[goal] Missing required artifacts:`);
      for (const m of missing) console.error(`- ${m}`);
    }
    console.error(`[goal] FAILED (${goalId}). See artifacts/goals/${goalId}/latest/result.json`);
    process.exit(1);
  }

  console.log(`[goal] PASS (${goalId}). Artifacts: artifacts/goals/${goalId}/latest/`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
