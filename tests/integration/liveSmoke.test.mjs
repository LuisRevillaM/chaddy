import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createOfficialClobClientFromEnv } from "../../packages/executor/src/polymarket/official/createClientFromEnv.js";
import { loadOfficialPolymarketDeps } from "../../packages/executor/src/polymarket/official/loadDeps.js";

async function writeJson(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

test("integration: live trading smoke (place then cancel) skeleton (opt-in)", async () => {
  const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
  assert.ok(outDir, "PROVE_OUT_DIR must be set by the harness");

  const enabled = process.env.INTEGRATION_ENABLED === "1";
  const outPath = path.join(outDir, "live-smoke.json");

  if (!enabled) {
    await writeJson(outPath, { enabled, ok: true, note: "INTEGRATION_ENABLED!=1; skipping network call" });
    return;
  }

  const deps = await loadOfficialPolymarketDeps();
  const tokenId = process.env.POLY_CLOB_TOKEN_ID || null;
  const side = process.env.POLY_CLOB_SIDE || "BUY";
  const price = Number(process.env.POLY_CLOB_PRICE || "0.5");
  const size = Number(process.env.POLY_CLOB_SIZE || "1");
  const host = process.env.POLY_CLOB_HOST || "https://clob.polymarket.com";

  if (!deps.ok) {
    await writeJson(outPath, { enabled, ok: false, error: deps.error });
    assert.fail(String(deps.error));
  }
  if (!tokenId) {
    await writeJson(outPath, { enabled, ok: false, error: "missing_POLY_CLOB_TOKEN_ID" });
    assert.fail("missing POLY_CLOB_TOKEN_ID");
  }

  /** @type {any} */
  const artifact = { enabled, ok: false, host, place: null, cancel: null };

  try {
    const official = await createOfficialClobClientFromEnv();
    if (!official.ok) throw new Error(official.error);

    // Determine market constraints via official client (public endpoints).
    const tickSize = await official.client.getTickSize(tokenId);
    const negRisk = await official.client.getNegRisk(tokenId);

    const placed = await official.client.createAndPostOrder(
      {
        tokenID: tokenId,
        side: side === "SELL" ? deps.Side.SELL : deps.Side.BUY,
        price,
        size,
        orderType: deps.OrderType.GTC
      },
      { tickSize, negRisk }
    );

    const orderId = placed?.orderID ?? placed?.orderId ?? placed?.order_id ?? null;
    if (!orderId) throw new Error("orderId_missing_in_response");
    artifact.place = { ok: true, orderId: String(orderId) };

    await official.client.cancelOrder(String(orderId));
    artifact.cancel = { ok: true };
    artifact.ok = true;
  } catch (e) {
    artifact.error = String(e?.message || e);
  }

  await writeJson(outPath, artifact);
  assert.equal(artifact.ok, true, JSON.stringify({ error: artifact.error }));
});
