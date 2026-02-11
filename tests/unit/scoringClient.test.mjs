import assert from "node:assert/strict";
import test from "node:test";

import { ScoringClient } from "../../packages/executor/src/polymarket/ScoringClient.js";

test("ScoringClient: forms deterministic request and parses scoring response", async () => {
  const calls = [];
  const mockFetch = async (url, init) => {
    calls.push({
      url: String(url),
      method: String(init?.method || ""),
      headers: init?.headers || null
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({ scoring: true, reason: "ok" })
    };
  };

  const client = new ScoringClient({
    fetchImpl: mockFetch,
    baseUrl: "https://clob.polymarket.com",
    authHeaders: { authorization: "Bearer redacted" }
  });

  const r = await client.checkOrderScoring("order_123");
  assert.deepEqual(r, { ok: true, scoring: true, reason: "ok" });
  assert.deepEqual(calls, [
    {
      url: "https://clob.polymarket.com/orders/order_123/scoring",
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: "Bearer redacted"
      }
    }
  ]);
});

test("ScoringClient: returns stable redacted error result", async () => {
  const secret = "SENTINEL_SECRET_VALUE";
  const mockFetch = async () => {
    throw new Error(`network_down_${secret}`);
  };

  const client = new ScoringClient({
    fetchImpl: mockFetch,
    baseUrl: "https://clob.polymarket.com",
    authHeaders: { authorization: secret }
  });

  const r = await client.checkOrderScoring("order_123");
  assert.deepEqual(r, { ok: false, scoring: null, reason: "http_error" });
  const msg = JSON.stringify(r);
  assert.ok(!msg.includes(secret), `result leaked secret: ${msg}`);
});

