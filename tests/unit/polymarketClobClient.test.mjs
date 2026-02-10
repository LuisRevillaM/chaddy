import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { ClobClient } from "../../packages/executor/src/polymarket/ClobClient.js";

async function readJson(p) {
  const txt = await fs.readFile(p, "utf8");
  return JSON.parse(txt);
}

test("ClobClient: forms deterministic REST requests (golden)", async () => {
  const goldenPath = path.join(process.cwd(), "tests", "unit", "fixtures", "polymarket-clob-requests.json");
  const golden = await readJson(goldenPath);

  const calls = [];
  const mockFetch = async (url, init) => {
    calls.push({
      url: String(url),
      method: String(init?.method || ""),
      headers: init?.headers || null,
      body: init?.body ?? null
    });
    return { ok: true, json: async () => ({ ok: true, orderId: "order_1", canceled: 1 }) };
  };

  const client = new ClobClient({ fetchImpl: mockFetch, baseUrl: golden.baseUrl, authHeaders: golden.authHeaders });

  await client.placeOrder({ tokenId: "tok_1", side: "BUY", price: 0.5, size: 1 });
  await client.cancelOrder({ orderId: "order_1" });
  await client.cancelAll();

  assert.deepEqual(calls, golden.calls);
});

test("ClobClient: does not leak auth headers in error strings (best-effort)", async () => {
  const secret = "SENTINEL_SECRET_VALUE";
  const mockFetch = async () => {
    throw new Error("network_down");
  };

  const client = new ClobClient({
    fetchImpl: mockFetch,
    baseUrl: "https://clob.polymarket.com",
    authHeaders: { "x-api-key": secret, "x-api-passphrase": secret }
  });

  await assert.rejects(
    () => client.placeOrder({ tokenId: "tok_1", side: "BUY", price: 0.5, size: 1 }),
    (err) => {
      const msg = String(err?.message || err);
      assert.ok(!msg.includes(secret), `error string leaked secret: ${msg}`);
      return true;
    }
  );
});

