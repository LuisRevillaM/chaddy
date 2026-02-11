#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = process.cwd();

async function readJson(p) {
  const text = await fs.readFile(p, "utf8");
  return JSON.parse(text);
}

function parseArgs(argv) {
  const out = { pack: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pack") {
      out.pack = argv[i + 1] ?? null;
      i++;
    }
  }
  return out;
}

function padRight(s, n) {
  const t = String(s);
  if (t.length >= n) return t;
  return t + " ".repeat(n - t.length);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const packs = args.pack
    ? [path.resolve(REPO_ROOT, args.pack)]
    : [
      path.join(REPO_ROOT, "docs", "agent-goals", "goalpack-v1.json"),
      path.join(REPO_ROOT, "docs", "agent-goals", "goalpack-v2.json"),
      path.join(REPO_ROOT, "docs", "agent-goals", "goalpack-v3.json"),
      path.join(REPO_ROOT, "docs", "agent-goals", "goalpack-v4.json"),
      path.join(REPO_ROOT, "docs", "agent-goals", "goalpack-v5.json"),
      path.join(REPO_ROOT, "docs", "agent-goals", "goalpack-v6.json"),
      path.join(REPO_ROOT, "docs", "agent-goals", "goalpack-v7.json"),
      path.join(REPO_ROOT, "docs", "agent-goals", "goalpack-v8.json"),
      path.join(REPO_ROOT, "docs", "agent-goals", "goalpack-v9.json"),
      path.join(REPO_ROOT, "docs", "agent-goals", "goalpack-v10.json"),
      path.join(REPO_ROOT, "docs", "agent-goals", "goalpack-v11.json")
    ];

  /** @type {Array<{pack:string, id:string, milestone:string, title:string, proof:string}>} */
  const rows = [];

  for (const p of packs) {
    try {
      const gp = await readJson(p);
      for (const g of gp.goals || []) {
        rows.push({
          pack: path.relative(REPO_ROOT, p),
          id: g.id,
          milestone: g.milestone || "",
          title: g.title || "",
          proof: g.proof?.command || ""
        });
      }
    } catch {
      // pack missing is OK (e.g. v2 not created yet)
    }
  }

  rows.sort((a, b) => (a.pack + a.id).localeCompare(b.pack + b.id));

  if (rows.length === 0) {
    console.error("No goals found.");
    process.exit(1);
  }

  const idW = Math.max(...rows.map((r) => r.id.length), 2);
  const msW = Math.max(...rows.map((r) => r.milestone.length), 2);
  const packW = Math.max(...rows.map((r) => r.pack.length), 4);

  console.log(`${padRight("ID", idW)}  ${padRight("MS", msW)}  ${padRight("PACK", packW)}  TITLE`);
  for (const r of rows) {
    console.log(`${padRight(r.id, idW)}  ${padRight(r.milestone, msW)}  ${padRight(r.pack, packW)}  ${r.title}`);
  }
  console.log("");
  console.log("Run a goal:");
  console.log("  npm run goal -- --pack docs/agent-goals/goalpack-v2.json G4");
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
