import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { ClobClient } from "../../packages/executor/src/polymarket/ClobClient.js";

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

test("integration: cancel-all drill (opt-in)", async () => {
  const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
  assert.ok(outDir, "PROVE_OUT_DIR must be set by the harness");

  const enabled = process.env.INTEGRATION_ENABLED === "1";
  const outPath = path.join(outDir, "cancel-all-drill.json");

  if (!enabled) {
    await writeJson(outPath, { enabled, ok: true, note: "INTEGRATION_ENABLED!=1; skipping network call" });
    return;
  }

  const authHeaders = parseJsonEnv("POLY_CLOB_AUTH_HEADERS_JSON");
  const baseUrl = process.env.POLY_CLOB_BASE_URL || "https://clob.polymarket.com";

  if (!authHeaders || typeof authHeaders !== "object") {
    await writeJson(outPath, { enabled, ok: false, error: "missing_POLY_CLOB_AUTH_HEADERS_JSON" });
    assert.fail("missing POLY_CLOB_AUTH_HEADERS_JSON");
  }

  const client = new ClobClient({ fetchImpl: fetch, baseUrl, authHeaders });

  /** @type {any} */
  const artifact = { enabled, ok: false, baseUrl, result: null };
  try {
    const r = await client.cancelAll();
    artifact.result = { ok: true };
    // Avoid writing any server response body into artifacts.
    artifact.ok = true;
  } catch (e) {
    artifact.error = String(e?.message || e);
  }

  await writeJson(outPath, artifact);
  assert.equal(artifact.ok, true, JSON.stringify({ error: artifact.error }));
});

