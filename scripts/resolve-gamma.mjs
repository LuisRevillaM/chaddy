#!/usr/bin/env node
// @ts-check

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { parseGammaClobTokenIds } from "../packages/shared/src/gamma.js";

function parseArgs(argv) {
  const out = {
    mode: "fixture",
    gammaSlug: "",
    tokenIndex: 0,
    fixture: path.join(process.cwd(), "tests", "unit", "fixtures", "gamma-markets.json"),
    gammaUrl: "https://gamma-api.polymarket.com",
    outPath: null
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode") {
      out.mode = String(argv[++i] ?? "");
      continue;
    }
    if (a === "--gamma-slug") {
      out.gammaSlug = String(argv[++i] ?? "");
      continue;
    }
    if (a === "--token-index") {
      out.tokenIndex = Number(argv[++i] ?? NaN);
      continue;
    }
    if (a === "--fixture") {
      out.fixture = path.resolve(process.cwd(), String(argv[++i] ?? ""));
      continue;
    }
    if (a === "--gamma-url") {
      out.gammaUrl = String(argv[++i] ?? "");
      continue;
    }
    if (a === "--out") {
      out.outPath = path.resolve(process.cwd(), String(argv[++i] ?? ""));
      continue;
    }
  }

  return out;
}

async function writeJson(p, obj) {
  if (!p) return;
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

/**
 * @param {unknown} payload
 */
function extractMarkets(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && Array.isArray(payload.markets)) return payload.markets;
  return [];
}

/**
 * @param {unknown[]} markets
 * @param {string} slug
 * @param {number} tokenIndex
 */
function resolveFromMarkets(markets, slug, tokenIndex) {
  if (!slug) throw new Error("--gamma-slug is required");
  if (!Number.isInteger(tokenIndex) || tokenIndex < 0) throw new Error("--token-index must be an integer >= 0");

  const match = markets.find((m) => {
    if (!m || typeof m !== "object") return false;
    const s = typeof m.slug === "string" ? m.slug : null;
    return s === slug;
  });
  if (!match || typeof match !== "object") throw new Error(`No market found for slug '${slug}'`);

  const ids = parseGammaClobTokenIds(match.clobTokenIds);
  if (ids.length === 0) throw new Error(`Market '${slug}' has no clobTokenIds`);
  if (!(tokenIndex >= 0 && tokenIndex < ids.length)) {
    throw new Error(`--token-index out of range (have ${ids.length})`);
  }

  return {
    slug,
    marketId: typeof match.id === "string" ? match.id : null,
    tokenIndex,
    tokenCount: ids.length,
    tokenIds: ids,
    assetId: ids[tokenIndex]
  };
}

async function resolveFixtureMode(opts) {
  const raw = JSON.parse(await fs.readFile(opts.fixture, "utf8"));
  const markets = extractMarkets(raw);
  return {
    input: {
      mode: "fixture",
      fixture: path.relative(process.cwd(), opts.fixture),
      gammaSlug: opts.gammaSlug,
      tokenIndex: opts.tokenIndex
    },
    resolved: resolveFromMarkets(markets, opts.gammaSlug, opts.tokenIndex)
  };
}

async function resolveLiveMode(opts) {
  const url = `${opts.gammaUrl.replace(/\/+$/, "")}/markets?slug=${encodeURIComponent(opts.gammaSlug)}`;
  const res = await fetch(url, { method: "GET", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Gamma request failed: ${res.status} ${res.statusText}`);
  const payload = await res.json();
  const markets = extractMarkets(payload);
  return {
    input: {
      mode: "live",
      gammaUrl: opts.gammaUrl,
      gammaSlug: opts.gammaSlug,
      tokenIndex: opts.tokenIndex
    },
    resolved: resolveFromMarkets(markets, opts.gammaSlug, opts.tokenIndex)
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.mode !== "fixture" && opts.mode !== "live") throw new Error("--mode must be fixture|live");

  const result = opts.mode === "fixture" ? await resolveFixtureMode(opts) : await resolveLiveMode(opts);
  const output = { ok: true, ...result };

  if (opts.outPath) await writeJson(opts.outPath, output);
  else process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}

main().catch(async (err) => {
  const opts = parseArgs(process.argv.slice(2));
  const output = { ok: false, error: String(err?.message || err) };
  if (opts.outPath) {
    await writeJson(opts.outPath, output);
  } else {
    process.stderr.write(JSON.stringify(output) + "\n");
  }
  process.exit(1);
});

