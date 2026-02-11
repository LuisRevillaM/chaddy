#!/usr/bin/env node
// @ts-check

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = process.cwd();

function parseArgs(argv) {
  const out = {
    outDir: path.join(REPO_ROOT, "artifacts", "operator-bundle", "latest")
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") {
      out.outDir = path.resolve(String(argv[++i] ?? ""));
      continue;
    }
  }
  return out;
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function rmrf(p) {
  await fs.rm(p, { recursive: true, force: true });
}

async function copyFileRelative(srcRel, dstRel, outDir) {
  const src = path.join(REPO_ROOT, srcRel);
  const dst = path.join(outDir, dstRel);
  await ensureDir(path.dirname(dst));
  await fs.copyFile(src, dst);
}

async function writeRunbookSnippet(outDir) {
  const p = path.join(outDir, "docs", "runbook-snippets.md");
  await ensureDir(path.dirname(p));
  const text = [
    "# Operator Runbook Snippets",
    "",
    "## 1) Environment Selfcheck",
    "`bash operator/selfcheck.command`",
    "",
    "## 2) Paper Mode (Offline Fixture)",
    "`PROVE_NO_NETWORK=1 GEO_ALLOWED=1 bash operator/start-paper.command`",
    "",
    "## 3) Doctor Report",
    "`PROVE_NO_NETWORK=1 GEO_ALLOWED=1 bash operator/doctor.command`"
  ].join("\n");
  await fs.writeFile(p, text + "\n", "utf8");
}

async function listFilesRecursive(root) {
  const out = [];
  async function walk(dir) {
    const ents = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of ents) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      out.push(full);
    }
  }
  await walk(root);
  return out.sort();
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function buildManifest(outDir) {
  const files = await listFilesRecursive(outDir);
  const rows = [];
  for (const f of files) {
    if (path.basename(f) === "manifest.json") continue;
    const rel = path.relative(outDir, f).split(path.sep).join("/");
    const buf = await fs.readFile(f);
    rows.push({
      path: rel,
      bytes: buf.length,
      sha256: sha256Hex(buf)
    });
  }
  rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    schemaVersion: 1,
    bundle: "operator-bundle",
    fileCount: rows.length,
    files: rows
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await rmrf(args.outDir);
  await ensureDir(args.outDir);

  const copies = [
    ["operator/selfcheck.command", "operator/selfcheck.command"],
    ["operator/start-paper.command", "operator/start-paper.command"],
    ["operator/start-live.command", "operator/start-live.command"],
    ["operator/status.command", "operator/status.command"],
    ["operator/stop.command", "operator/stop.command"],
    ["operator/doctor.command", "operator/doctor.command"],
    ["config/example.json", "config/example.json"]
  ];
  for (const [srcRel, dstRel] of copies) {
    await copyFileRelative(srcRel, dstRel, args.outDir);
  }

  await writeRunbookSnippet(args.outDir);

  const manifest = await buildManifest(args.outDir);
  await fs.writeFile(path.join(args.outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  process.stdout.write(`${path.relative(REPO_ROOT, args.outDir)}\n`);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

