import assert from "node:assert/strict";
import test from "node:test";

import { createGeoChecker } from "../../packages/executor/src/geoblockClient.js";

test("createGeoChecker: caches results within cacheMs", async () => {
  let calls = 0;
  const mockFetch = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ blocked: false, country: "US", region: "CA", ip: "1.2.3.4" }) };
  };

  const geo = createGeoChecker({ fetchImpl: mockFetch, url: "https://example.test/geoblock", cacheMs: 60_000 });

  const a = await geo.isAllowed();
  const b = await geo.isAllowed();

  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.equal(a.allowed, true);
  assert.equal(a.details.blocked, false);
});

test("createGeoChecker: re-fetches when cacheMs=0", async () => {
  let calls = 0;
  const mockFetch = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ blocked: false }) };
  };

  const geo = createGeoChecker({ fetchImpl: mockFetch, url: "https://example.test/geoblock", cacheMs: 0 });

  await geo.isAllowed();
  await geo.isAllowed();

  assert.equal(calls, 2);
});

test("createGeoChecker: refuses when blocked", async () => {
  const mockFetch = async () => ({ ok: true, json: async () => ({ blocked: true, country: "US", region: "CA", ip: "1.2.3.4" }) });

  const geo = createGeoChecker({ fetchImpl: mockFetch, url: "https://example.test/geoblock", cacheMs: 60_000 });

  const r = await geo.isAllowed();
  assert.equal(r.allowed, false);
  assert.equal(r.details.blocked, true);
});

