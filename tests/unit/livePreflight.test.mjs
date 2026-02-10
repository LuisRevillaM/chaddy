import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { preflightLiveMode } from "../../packages/executor/src/preflight.js";

test("preflightLiveMode: refuses deterministically with stable reason codes", async () => {
  const prevGeo = process.env.GEO_ALLOWED;
  try {
    /** @type {import("../../packages/executor/src/policy.js").Policy} */
    const basePolicy = {
      allowedMarkets: ["m1"],
      minOrderSize: 1,
      maxOrderSize: 10,
      maxAbsNotional: 100,
      maxPriceBand: 0.2
    };

    const cases = [
      {
        name: "geoblocked",
        env: {},
        policy: basePolicy,
        expect: { ok: false, reasons: ["geoblocked"] }
      },
      {
        name: "missing_allowlist",
        env: { GEO_ALLOWED: "1" },
        policy: { ...basePolicy, allowedMarkets: [] },
        expect: { ok: false, reasons: ["missing_allowlist"] }
      },
      {
        name: "invalid_max_order_size",
        env: { GEO_ALLOWED: "1" },
        policy: { ...basePolicy, maxOrderSize: 0 },
        expect: { ok: false, reasons: ["invalid_max_order_size"] }
      },
      {
        name: "invalid_max_abs_notional",
        env: { GEO_ALLOWED: "1" },
        policy: { ...basePolicy, maxAbsNotional: 0 },
        expect: { ok: false, reasons: ["invalid_max_abs_notional"] }
      },
      {
        name: "missing_price_band",
        env: { GEO_ALLOWED: "1" },
        policy: { ...basePolicy, maxPriceBand: null },
        expect: { ok: false, reasons: ["missing_price_band"] }
      },
      {
        name: "success",
        env: { GEO_ALLOWED: "1" },
        policy: basePolicy,
        expect: { ok: true, reasons: [] }
      }
    ];

    const results = [];
    for (const c of cases) {
      if ("GEO_ALLOWED" in c.env) process.env.GEO_ALLOWED = c.env.GEO_ALLOWED;
      else delete process.env.GEO_ALLOWED;
      const r = await preflightLiveMode({ policy: c.policy });
      assert.deepEqual(r, c.expect, c.name);
      results.push({ name: c.name, env: c.env, result: r });
    }

    const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
    if (outDir) {
      await fs.mkdir(outDir, { recursive: true });
      await fs.writeFile(
        path.join(outDir, "live-preflight.json"),
        JSON.stringify({ cases: results }, null, 2) + "\n",
        "utf8"
      );
    }
  } finally {
    if (prevGeo == null) delete process.env.GEO_ALLOWED;
    else process.env.GEO_ALLOWED = prevGeo;
  }
});
