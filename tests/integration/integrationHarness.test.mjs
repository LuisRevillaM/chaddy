import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function writeJson(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

test("integration: harness is opt-in, performs no network unless enabled, and always writes an artifact", async () => {
  const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
  assert.ok(outDir, "PROVE_OUT_DIR must be set by the harness");

  const enabled = process.env.INTEGRATION_ENABLED === "1";

  /** @type {Array<{ id: string, kind: string, attempted: boolean, ok: boolean | null, error: string | null }>} */
  const checks = [
    { id: "gamma_fetch_smoke", kind: "fetch", attempted: false, ok: null, error: null },
    { id: "market_ws_connect", kind: "websocket", attempted: false, ok: null, error: null }
  ];

  if (!enabled) {
    await writeJson(path.join(outDir, "integration-harness.json"), { enabled, checks });
    return;
  }

  // Network checks (opt-in): keep them read-only, bounded, and explicit.
  try {
    checks[0].attempted = true;
    const res = await fetch("https://gamma-api.polymarket.com/markets?limit=1");
    checks[0].ok = Boolean(res.ok);
    checks[0].error = res.ok ? null : `http_${res.status}`;
  } catch (e) {
    checks[0].attempted = true;
    checks[0].ok = false;
    checks[0].error = String(e?.message || e);
  }

  try {
    checks[1].attempted = true;
    if (typeof WebSocket !== "function") throw new Error("WebSocket unavailable");
    await new Promise((resolve, reject) => {
      const ws = new WebSocket("wss://ws-subscriptions-clob.polymarket.com/ws/market");
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(new Error("ws_timeout"));
      }, 5_000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          // ignore
        }
        resolve(null);
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("ws_error"));
      });
    });
    checks[1].ok = true;
    checks[1].error = null;
  } catch (e) {
    checks[1].attempted = true;
    checks[1].ok = false;
    checks[1].error = String(e?.message || e);
  }

  await writeJson(path.join(outDir, "integration-harness.json"), { enabled, checks });

  // If explicitly enabled, fail the suite if any check failed.
  const failed = checks.filter((c) => c.attempted && c.ok === false);
  assert.equal(failed.length, 0, JSON.stringify({ failed, checks }));
});

