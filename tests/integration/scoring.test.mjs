import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { ScoringClient } from "../../packages/executor/src/polymarket/ScoringClient.js";

async function writeJson(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function parseJsonEnv(name) {
  const raw = process.env[name];
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object") return v;
  } catch {
    // ignore
  }
  return null;
}

test("integration: scoring endpoint check (opt-in)", async () => {
  const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
  assert.ok(outDir, "PROVE_OUT_DIR must be set by the harness");

  const enabled = process.env.INTEGRATION_ENABLED === "1";
  const orderId = process.env.POLY_ORDER_ID || "";
  const outPath = path.join(outDir, "scoring.json");

  if (!enabled || !orderId) {
    await writeJson(outPath, {
      enabled,
      ok: true,
      note: !enabled ? "INTEGRATION_ENABLED!=1; skipping network call" : "POLY_ORDER_ID missing; skipping network call"
    });
    return;
  }

  const authHeaders = parseJsonEnv("POLY_CLOB_AUTH_HEADERS_JSON");
  if (!authHeaders || typeof authHeaders !== "object") {
    await writeJson(outPath, { enabled, ok: false, error: "missing_POLY_CLOB_AUTH_HEADERS_JSON" });
    assert.fail("missing POLY_CLOB_AUTH_HEADERS_JSON");
  }

  const baseUrl = process.env.POLY_CLOB_BASE_URL || "https://clob.polymarket.com";
  const client = new ScoringClient({ fetchImpl: fetch, baseUrl, authHeaders });

  const scoring = await client.checkOrderScoring(orderId);
  await writeJson(outPath, {
    enabled,
    ok: true,
    baseUrl,
    orderId,
    scoring
  });
});

