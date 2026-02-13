import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createOfficialClobClientFromEnv } from "../../packages/executor/src/polymarket/official/createClientFromEnv.js";

async function writeJson(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
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

  /** @type {any} */
  const artifact = { enabled, ok: false, host: process.env.POLY_CLOB_HOST || "https://clob.polymarket.com", result: null };
  try {
    const official = await createOfficialClobClientFromEnv();
    if (!official.ok) throw new Error(official.error);

    await official.client.cancelAll();
    artifact.result = { ok: true };
    // Avoid writing any server response body into artifacts.
    artifact.ok = true;
  } catch (e) {
    artifact.error = String(e?.message || e);
  }

  await writeJson(outPath, artifact);
  assert.equal(artifact.ok, true, JSON.stringify({ error: artifact.error }));
});
