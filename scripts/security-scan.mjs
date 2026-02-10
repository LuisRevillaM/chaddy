#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = process.cwd();
const OUT_DIR = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;

const SKIP_DIRS = new Set(["node_modules", "artifacts", ".git"]);
const SKIP_FILE_SUFFIXES = [".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip"];

// Heuristics: flag high-risk secret patterns if they appear as values, not just as names.
const VALUE_PATTERNS = [
  // PEM-like blocks
  { id: "pem_block", re: /-----BEGIN [A-Z0-9 _-]+-----/ },
  // 0x + 64 hex chars (Ethereum private key-like)
  { id: "hex_64", re: /\b0x[a-fA-F0-9]{64}\b/ },
  // base64-ish long tokens (very rough)
  { id: "b64_long", re: /\b[A-Za-z0-9+/]{80,}={0,2}\b/ }
];

const ASSIGNMENT_KEYWORDS = [
  "PRIVATE_KEY",
  "API_KEY",
  "API_SECRET",
  "PASSPHRASE",
  "PASSWORD",
  "SECRET",
  "TOKEN"
];

function isProbablyTextFile(p) {
  const lower = p.toLowerCase();
  return !SKIP_FILE_SUFFIXES.some((s) => lower.endsWith(s));
}

async function listFilesRecursive(root) {
  const out = [];
  async function walk(dir) {
    const ents = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of ents) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        await walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!isProbablyTextFile(full)) continue;
      out.push(full);
    }
  }
  await walk(root);
  return out;
}

function looksLikeSecretAssignment(line) {
  // Detect KEY=VALUE where VALUE is non-trivial and not obviously placeholder.
  const m = line.match(/^\s*([A-Z0-9_]{3,})\s*=\s*(.+?)\s*$/);
  if (!m) return false;
  const key = m[1];
  const rawVal = m[2];
  if (!ASSIGNMENT_KEYWORDS.some((kw) => key.includes(kw))) return false;

  // Ignore common placeholders.
  const val = rawVal.replaceAll(/^['"]|['"]$/g, "");
  if (val === "" || val === "REDACTED") return false;
  if (val.startsWith("<") && val.endsWith(">")) return false;
  if (val.toLowerCase().includes("example")) return false;
  if (val.toLowerCase().includes("placeholder")) return false;
  if (val === "changeme") return false;

  // If the "value" looks like a reference to env var or config, ignore.
  if (val.startsWith("$") || val.startsWith("${")) return false;

  // If it's very short, ignore (likely not a real secret).
  if (val.length < 12) return false;
  return true;
}

async function main() {
  const findings = [];

  // Hard fail if a real .env exists (agents love to accidentally commit it).
  try {
    const envStat = await fs.stat(path.join(REPO_ROOT, ".env"));
    if (envStat.isFile()) {
      findings.push({
        file: ".env",
        line: 1,
        kind: "env_file",
        message: "Real .env file present in repo root. Do not commit secrets."
      });
    }
  } catch {
    // ok
  }

  const files = await listFilesRecursive(REPO_ROOT);
  for (const file of files) {
    let buf;
    try {
      buf = await fs.readFile(file);
    } catch {
      continue;
    }
    // Skip files that are likely binary (null bytes).
    if (buf.includes(0)) continue;
    const text = buf.toString("utf8");
    const rel = path.relative(REPO_ROOT, file);
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (looksLikeSecretAssignment(line)) {
        findings.push({
          file: rel,
          line: i + 1,
          kind: "secret_assignment",
          message: "Suspicious KEY=VALUE assignment that looks like a real secret."
        });
      }

      for (const p of VALUE_PATTERNS) {
        if (p.re.test(line)) {
          findings.push({
            file: rel,
            line: i + 1,
            kind: p.id,
            message: `High-risk secret-like pattern detected (${p.id}).`
          });
        }
      }
    }
  }

  // Architecture boundary check: prevent accidental coupling (and key leakage).
  // Rule of thumb:
  // - shared imports nobody
  // - mm-core imports shared only
  // - sim imports shared only
  // - executor imports shared only
  const packageRoots = {
    shared: path.join(REPO_ROOT, "packages", "shared"),
    "mm-core": path.join(REPO_ROOT, "packages", "mm-core"),
    sim: path.join(REPO_ROOT, "packages", "sim"),
    executor: path.join(REPO_ROOT, "packages", "executor")
  };

  /** @param {string} filePath */
  function owningPackage(filePath) {
    const norm = filePath.split(path.sep).join("/");
    const m = norm.match(/\/packages\/([^/]+)\//);
    return m ? m[1] : null;
  }

  /** @param {string} absPath */
  function packageOfResolved(absPath) {
    const pkg = owningPackage(absPath);
    if (!pkg) return null;
    return pkg;
  }

  /** @param {string} text */
  function extractImportSpecifiers(text) {
    const specs = [];
    // import ... from "x"
    for (const m of text.matchAll(/\bimport\s+[^;]*?\s+from\s+["']([^"']+)["']/g)) specs.push(m[1]);
    // import("x")
    for (const m of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) specs.push(m[1]);
    // export ... from "x"
    for (const m of text.matchAll(/\bexport\s+[^;]*?\s+from\s+["']([^"']+)["']/g)) specs.push(m[1]);
    return specs;
  }

  /** @param {string} pkg */
  function allowedDeps(pkg) {
    switch (pkg) {
      case "shared":
        return new Set([]);
      case "mm-core":
        return new Set(["shared"]);
      case "sim":
        return new Set(["shared"]);
      case "executor":
        return new Set(["shared"]);
      default:
        return new Set([]);
    }
  }

  for (const [pkg, root] of Object.entries(packageRoots)) {
    const pkgFiles = (await listFilesRecursive(root)).filter((p) => p.endsWith(".js"));
    for (const file of pkgFiles) {
      const text = await fs.readFile(file, "utf8");
      const specs = extractImportSpecifiers(text);
      for (const spec of specs) {
        if (spec.startsWith("node:")) continue;
        if (!spec.startsWith(".")) continue; // external deps are allowed, but should be reviewed separately
        const resolved = path.resolve(path.dirname(file), spec);
        const depPkg = packageOfResolved(resolved);
        if (!depPkg || depPkg === pkg) continue;

        const allowed = allowedDeps(pkg);
        if (!allowed.has(depPkg)) {
          findings.push({
            file: path.relative(REPO_ROOT, file),
            line: 1,
            kind: "boundary_violation",
            message: `Package '${pkg}' must not import from '${depPkg}' (${spec}).`
          });
        }
      }
    }
  }

  if (OUT_DIR) {
    await fs.mkdir(OUT_DIR, { recursive: true });
    await fs.writeFile(path.join(OUT_DIR, "security-findings.json"), JSON.stringify({ findings }, null, 2) + "\n", "utf8");
  }

  if (findings.length) {
    console.error(`Security scan failed with ${findings.length} finding(s).`);
    for (const f of findings.slice(0, 50)) {
      console.error(`- ${f.file}:${f.line} ${f.kind} ${f.message}`);
    }
    process.exit(1);
  }

  console.log("Security scan passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
