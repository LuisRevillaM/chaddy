#!/usr/bin/env node
// @ts-check

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { RUN_JOURNAL_SCHEMA_VERSION, validateRunJournalEntry } from "../packages/shared/src/runJournalSchema.js";

function parseArgs(argv) {
  const out = { journalPath: null, outPath: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--journal" || a === "--in") {
      out.journalPath = path.resolve(process.cwd(), String(argv[++i] ?? ""));
      continue;
    }
    if (a === "--out") {
      out.outPath = path.resolve(process.cwd(), String(argv[++i] ?? ""));
      continue;
    }
  }
  return out;
}

async function atomicWriteJson(p, obj) {
  const dir = path.dirname(p);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  await fs.rename(tmp, p);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.journalPath) {
    console.error("Usage: node scripts/analyze-run.mjs --journal <path> [--out <path>]");
    process.exit(2);
  }

  const text = await fs.readFile(args.journalPath, "utf8");
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let parseErrors = 0;
  /** @type {any[]} */
  const entries = [];
  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      parseErrors += 1;
      continue;
    }
    const v = validateRunJournalEntry(obj);
    if (!v.ok) {
      parseErrors += 1;
      continue;
    }
    entries.push(v.entry);
  }

  // Aggregate.
  let t0 = null;
  let t1 = null;
  const churn = { placed: 0, placedOk: 0, canceled: 0, cancelOk: 0, cancelAllCycles: 0 };
  const scoring = { sides: 0, scoring: 0, byReason: {} };
  const econ = { last: null, min: null, max: null, cash: null, position: null };
  /** @type {string[]} */
  const markets = [];

  for (const e of entries) {
    if (t0 == null) t0 = e.t;
    t1 = e.t;

    if (e.kind === "meta") {
      if (Array.isArray(e.markets)) {
        for (const m of e.markets) if (!markets.includes(m)) markets.push(m);
      }
      continue;
    }

    if (e.kind !== "cycle") continue;

    const ops = e.ops || {};
    churn.placed += Number(ops.placed || 0);
    churn.placedOk += Number(ops.placedOk || 0);
    churn.canceled += Number(ops.canceled || 0);
    churn.cancelOk += Number(ops.cancelOk || 0);
    if (ops.cancelAll) churn.cancelAllCycles += 1;

    const sc = e.scoring || null;
    for (const sideKey of ["buy", "sell"]) {
      const s = sc && sc[sideKey];
      if (!s || typeof s !== "object") continue;
      if (typeof s.scoring !== "boolean") continue;
      scoring.sides += 1;
      if (s.scoring) scoring.scoring += 1;
      const r = typeof s.reason === "string" && s.reason ? s.reason : "unknown";
      scoring.byReason[r] = (scoring.byReason[r] || 0) + 1;
    }

    const ec = e.economics || null;
    if (ec && typeof ec === "object" && Number.isFinite(ec.pnlMarkToMid)) {
      const p = Number(ec.pnlMarkToMid);
      econ.last = p;
      econ.min = econ.min == null ? p : Math.min(econ.min, p);
      econ.max = econ.max == null ? p : Math.max(econ.max, p);
      if (Number.isFinite(ec.cash)) econ.cash = Number(ec.cash);
      if (Number.isFinite(ec.position)) econ.position = Number(ec.position);
    }
  }

  const uptimeMs = t0 != null && t1 != null ? Math.max(0, t1 - t0) : 0;
  const scoringRate = scoring.sides > 0 ? scoring.scoring / scoring.sides : null;

  const summary = {
    schemaVersion: RUN_JOURNAL_SCHEMA_VERSION,
    meta: {
      journal: path.relative(process.cwd(), args.journalPath),
      entries: entries.length,
      parseErrors,
      markets
    },
    uptimeMs,
    churn,
    scoring: { ...scoring, rate: scoringRate },
    economics: econ
  };

  if (args.outPath) {
    await atomicWriteJson(args.outPath, summary);
  } else {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

