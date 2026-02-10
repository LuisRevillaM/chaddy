import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createGeoChecker } from "../../packages/executor/src/geoblockClient.js";

async function writeJson(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

test("integration: real geoblock endpoint check (opt-in)", async () => {
  const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
  assert.ok(outDir, "PROVE_OUT_DIR must be set by the harness");

  const enabled = process.env.INTEGRATION_ENABLED === "1";
  const outPath = path.join(outDir, "geoblock.json");

  if (!enabled) {
    await writeJson(outPath, { enabled, ok: true, note: "INTEGRATION_ENABLED!=1; skipping network call" });
    return;
  }

  const geo = createGeoChecker({ fetchImpl: fetch, cacheMs: 0 });
  const r = await geo.isAllowed();

  // Never write raw IP addresses into proof artifacts.
  const details = r.details
    ? { blocked: r.details.blocked ?? null, country: r.details.country ?? null, region: r.details.region ?? null, ip: null, ipRedacted: true }
    : null;

  await writeJson(outPath, { enabled, ok: true, allowed: r.allowed, details });
});

