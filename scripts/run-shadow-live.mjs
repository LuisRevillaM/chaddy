#!/usr/bin/env node
// @ts-check

import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { parsePolymarketMarketChannelLine } from "../packages/mm-core/src/polymarket/parseMarketChannelLine.js";
import { parsePolymarketUserChannelLine } from "../packages/mm-core/src/polymarket/parseUserChannelLine.js";
import { ShadowEngine } from "../packages/mm-core/src/runner/shadowEngine.js";
import { runShadowLoop } from "../packages/mm-core/src/runner/shadowLoop.js";

function parseArgs(argv) {
  const out = {
    mode: "fixture",
    market: "mkt_shadow_live",
    outPath: path.join(process.cwd(), "artifacts", "shadow-live", "latest.json"),
    steps: 5,
    stepMs: 1_000,
    tickSize: 0.01,
    // Live market channels can be quiet for long stretches; default staleness to a few minutes.
    staleMarketDataMs: 5 * 60_000,
    staleUserDataMs: 60_000,
    marketFixture: path.join(process.cwd(), "tests", "replay", "fixtures", "polymarket-market-channel.jsonl"),
    userFixture: path.join(process.cwd(), "tests", "replay", "fixtures", "polymarket-user-channel.jsonl"),
    wsUrl: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
    assetId: null,
    gammaUrl: "https://gamma-api.polymarket.com",
    gammaSlug: null,
    tokenIndex: 0,
    pingMs: 10_000,
    snapshotEveryMs: 1_000,
    // Some docs/examples omit this; keep it opt-in in case the server is strict about unknown fields.
    initialDump: false
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode") {
      out.mode = String(argv[++i] ?? "");
      continue;
    }
    if (a === "--market") {
      out.market = String(argv[++i] ?? "");
      continue;
    }
    if (a === "--out") {
      out.outPath = path.resolve(process.cwd(), String(argv[++i] ?? ""));
      continue;
    }
    if (a === "--steps") {
      out.steps = Number(argv[++i] ?? NaN);
      continue;
    }
    if (a === "--step-ms") {
      out.stepMs = Number(argv[++i] ?? NaN);
      continue;
    }
    if (a === "--tick-size") {
      out.tickSize = Number(argv[++i] ?? NaN);
      continue;
    }
    if (a === "--stale-market-ms") {
      out.staleMarketDataMs = Number(argv[++i] ?? NaN);
      continue;
    }
    if (a === "--stale-user-ms") {
      out.staleUserDataMs = Number(argv[++i] ?? NaN);
      continue;
    }
    if (a === "--market-fixture") {
      out.marketFixture = path.resolve(process.cwd(), String(argv[++i] ?? ""));
      continue;
    }
    if (a === "--user-fixture") {
      out.userFixture = path.resolve(process.cwd(), String(argv[++i] ?? ""));
      continue;
    }
    if (a === "--ws-url") {
      out.wsUrl = String(argv[++i] ?? "");
      continue;
    }
    if (a === "--asset-id") {
      out.assetId = String(argv[++i] ?? "");
      continue;
    }
    if (a === "--gamma-url") {
      out.gammaUrl = String(argv[++i] ?? "");
      continue;
    }
    if (a === "--gamma-slug") {
      out.gammaSlug = String(argv[++i] ?? "");
      continue;
    }
    if (a === "--token-index") {
      out.tokenIndex = Number(argv[++i] ?? NaN);
      continue;
    }
    if (a === "--ping-ms") {
      out.pingMs = Number(argv[++i] ?? NaN);
      continue;
    }
    if (a === "--snapshot-every-ms") {
      out.snapshotEveryMs = Number(argv[++i] ?? NaN);
      continue;
    }
    if (a === "--initial-dump") {
      const v = String(argv[++i] ?? "true").toLowerCase();
      out.initialDump = v === "1" || v === "true" || v === "yes";
      continue;
    }
  }

  return out;
}

async function readJsonlLines(p) {
  const text = await fs.readFile(p, "utf8");
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

async function atomicWriteJson(p, obj) {
  const dir = path.dirname(p);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  await fs.rename(tmp, p);
}

function makeQuoteCfg(tickSize) {
  return {
    tickSize,
    halfSpread: 0.02,
    maxSpread: 0.1,
    minSize: 1,
    orderSize: 1,
    inventoryTarget: 10,
    maxSkew: 0.02
  };
}

async function runFixtureMode(opts) {
  const marketLines = await readJsonlLines(opts.marketFixture);
  const userLines = await readJsonlLines(opts.userFixture);

  const marketEmitter = new EventEmitter();
  const userEmitter = new EventEmitter();

  let seq = 0;
  let marketIdx = 0;
  let userIdx = 0;

  const emitMarketLine = (line) => {
    const parsed = parsePolymarketMarketChannelLine(line);
    if (!parsed.ok) throw new Error(`market parse failed: ${parsed.error.code} ${parsed.error.message}`);
    for (const ev of parsed.events) {
      seq += 1;
      if (ev.kind === "snapshot") {
        marketEmitter.emit("market", { type: "book", seq, bids: ev.bids, asks: ev.asks });
      } else if (ev.kind === "delta") {
        marketEmitter.emit("market", { type: "price_change", seq, side: ev.side, price: ev.price, size: ev.size });
      }
    }
  };

  const emitUserLine = (line) => {
    const parsed = parsePolymarketUserChannelLine(line);
    if (!parsed.ok) throw new Error(`user parse failed: ${parsed.error.code} ${parsed.error.message}`);
    for (const ev of parsed.events) userEmitter.emit("user", ev);
  };

  const stepMarket = () => {
    if (marketIdx < marketLines.length) emitMarketLine(marketLines[marketIdx++]);
    if (userIdx < userLines.length) emitUserLine(userLines[userIdx++]);
  };

  const result = runShadowLoop(
    {
      market: opts.market,
      steps: opts.steps,
      activeMarketSteps: opts.steps,
      stepMs: opts.stepMs,
      quoteCfg: makeQuoteCfg(opts.tickSize),
      killSwitchCfg: { staleMarketDataMs: opts.staleMarketDataMs, staleUserDataMs: opts.staleUserDataMs },
      traceMax: 400
    },
    {
      onMarket: (cb) => {
        marketEmitter.on("market", cb);
        return () => marketEmitter.off("market", cb);
      },
      onUser: (cb) => {
        userEmitter.on("user", cb);
        return () => userEmitter.off("user", cb);
      },
      stepMarket
    }
  );

  await atomicWriteJson(opts.outPath, { mode: "fixture", result });
  return result;
}

async function resolveAssetIdFromGamma(opts) {
  if (!opts.gammaSlug) return null;
  const url = `${opts.gammaUrl.replace(/\/+$/, "")}/markets?slug=${encodeURIComponent(opts.gammaSlug)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gamma request failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error("Gamma returned no markets for the given slug");
  const m = data[0];

  // Gamma often returns `clobTokenIds` as a JSON-encoded string, not an array.
  /** @type {unknown} */
  const rawIds = m?.clobTokenIds;
  /** @type {string[]} */
  let ids = [];
  if (Array.isArray(rawIds)) {
    ids = rawIds.map((x) => String(x));
  } else if (typeof rawIds === "string") {
    const trimmed = rawIds.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) ids = parsed.map((x) => String(x));
      } catch {
        // Fall back to treating it as a single token id string.
        ids = [trimmed];
      }
    }
  }
  if (ids.length === 0) throw new Error("Gamma market missing clobTokenIds[]");
  const idx = Number.isInteger(opts.tokenIndex) ? opts.tokenIndex : 0;
  if (!(idx >= 0 && idx < ids.length)) throw new Error(`--token-index out of range (have ${ids.length})`);
  return String(ids[idx]);
}

async function runLiveMode(opts) {
  const resolved = opts.assetId || (await resolveAssetIdFromGamma(opts));
  if (!resolved) throw new Error("Provide --asset-id or (--gamma-slug and optional --token-index)");
  if (typeof WebSocket !== "function") throw new Error("WebSocket is not available in this Node environment");

  const t0 = Date.now();
  const nowMs = () => Date.now() - t0;

  let seq = 0;
  let i = 0;
  /** @type {WebSocket|null} */
  let ws = null;
  /** @type {NodeJS.Timeout|null} */
  let pingTimer = null;
  /** @type {NodeJS.Timeout|null} */
  let snapTimer = null;
  /** @type {NodeJS.Timeout|null} */
  let subscribeRetryTimer = null;

  const wsStats = {
    connectAttempts: 0,
    openCount: 0,
    closeCount: 0,
    errorCount: 0,
    messageCount: 0,
    parsedOkCount: 0,
    parsedErrorCount: 0,
    bookEventCount: 0,
    deltaEventCount: 0,
    ignoredMessageCount: 0,
    subscribeAttempts: 0,
    lastOpenAtMs: null,
    lastCloseAtMs: null,
    lastCloseCode: null,
    lastCloseReason: null,
    lastError: null,
    lastMessageAtMs: null,
    lastParsedOkAtMs: null,
    lastParsedErrorAtMs: null,
    lastParsedErrorCode: null,
    lastParsedErrorEventType: null,
    lastParsedErrorKeys: null,
    lastMessageSample: null,
    lastSubscribeAtMs: null,
    lastSubscribePayload: null,
    lastBookAtMs: null,
    lastDeltaAtMs: null
  };

  const midpointRef = { value: null };
  let engine = new ShadowEngine({
    market: opts.market,
    quoteCfg: makeQuoteCfg(opts.tickSize),
    killSwitchCfg: { staleMarketDataMs: opts.staleMarketDataMs, staleUserDataMs: opts.staleUserDataMs },
    midpointRef
  });

  const handleMarketMessage = (text) => {
    wsStats.lastMessageSample = String(text ?? "").slice(0, 600);
    const parsed = parsePolymarketMarketChannelLine(text);
    if (!parsed.ok) {
      wsStats.parsedErrorCount += 1;
      wsStats.lastParsedErrorAtMs = nowMs();
      wsStats.lastParsedErrorCode = parsed.error.code;
      wsStats.lastParsedErrorEventType = String(parsed.error.details?.event_type ?? "null");
      wsStats.lastParsedErrorKeys = parsed.error.details?.have || null;
      return;
    }
    wsStats.parsedOkCount += 1;
    wsStats.lastParsedOkAtMs = nowMs();
    const t = nowMs();
    if (parsed.events.length === 0) wsStats.ignoredMessageCount += 1;
    for (const ev of parsed.events) {
      seq += 1;
      if (ev.kind === "snapshot") {
        wsStats.bookEventCount += 1;
        wsStats.lastBookAtMs = t;
        engine.ingestMarket(t, { type: "book", seq, bids: ev.bids, asks: ev.asks });
      } else if (ev.kind === "delta") {
        wsStats.deltaEventCount += 1;
        wsStats.lastDeltaAtMs = t;
        engine.ingestMarket(t, { type: "price_change", seq, side: ev.side, price: ev.price, size: ev.size });
      }
    }
  };

  const sendSubscribe = (payload) => {
    if (!ws || ws.readyState !== 1) return;
    wsStats.subscribeAttempts += 1;
    wsStats.lastSubscribeAtMs = nowMs();
    const txt = JSON.stringify(payload);
    wsStats.lastSubscribePayload = txt.slice(0, 400);
    ws.send(txt);
  };

  const connect = () => {
    wsStats.connectAttempts += 1;
    ws = new WebSocket(opts.wsUrl);

    ws.addEventListener("open", () => {
      wsStats.openCount += 1;
      wsStats.lastOpenAtMs = nowMs();
      /** @type {Record<string, unknown>} */
      const payload = { type: "market", assets_ids: [resolved] };
      if (opts.initialDump) payload.initial_dump = true;
      sendSubscribe(payload);

      // If we never see a book snapshot, retry a couple alternate subscribe shapes.
      // This is best-effort and only affects live shadow mode.
      if (subscribeRetryTimer) clearTimeout(subscribeRetryTimer);
      subscribeRetryTimer = setTimeout(() => {
        if (wsStats.bookEventCount > 0) return;
        sendSubscribe({ type: "MARKET", assets_ids: [resolved] });
        setTimeout(() => {
          if (wsStats.bookEventCount > 0) return;
          sendSubscribe({ operation: "subscribe", assets_ids: [resolved] });
        }, 1_000);
      }, 1_500);
    });

    ws.addEventListener("message", (ev) => {
      const data = ev?.data;
      const text =
        typeof data === "string"
          ? data
          : Buffer.isBuffer(data)
            ? data.toString("utf8")
            : data instanceof ArrayBuffer
              ? Buffer.from(data).toString("utf8")
              : ArrayBuffer.isView(data)
                ? Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8")
                : String(data ?? "");
      if (text === "PONG" || text === "PING") return;
      wsStats.messageCount += 1;
      wsStats.lastMessageAtMs = nowMs();
      handleMarketMessage(text);
    });

    ws.addEventListener("close", (ev) => {
      wsStats.closeCount += 1;
      wsStats.lastCloseAtMs = nowMs();
      wsStats.lastCloseCode = Number.isFinite(ev?.code) ? ev.code : null;
      wsStats.lastCloseReason = typeof ev?.reason === "string" ? ev.reason : null;
      if (subscribeRetryTimer) clearTimeout(subscribeRetryTimer);
      // Best-effort: reset state and attempt a reconnect.
      seq = 0;
      i = 0;
      engine = new ShadowEngine({
        market: opts.market,
        quoteCfg: makeQuoteCfg(opts.tickSize),
        killSwitchCfg: { staleMarketDataMs: opts.staleMarketDataMs, staleUserDataMs: opts.staleUserDataMs },
        midpointRef
      });
      setTimeout(connect, 2_000);
    });

    ws.addEventListener("error", (ev) => {
      wsStats.errorCount += 1;
      wsStats.lastError = String(ev?.message || ev || "error");
    });
  };

  connect();

  pingTimer = setInterval(() => {
    if (!ws || ws.readyState !== 1) return; // OPEN
    ws.send("PING");
  }, opts.pingMs);

  snapTimer = setInterval(async () => {
    const t = nowMs();
    const snap = engine.snapshot({ i, nowMs: t });
    i += 1;
    await atomicWriteJson(opts.outPath, {
      mode: "live",
      meta: { wsUrl: opts.wsUrl, assetId: resolved, market: opts.market, startedAt: new Date(t0).toISOString() },
      ws: { ...wsStats, readyState: ws ? ws.readyState : null },
      snapshot: snap,
      state: engine.stateFinal()
    });
  }, opts.snapshotEveryMs);

  const shutdown = () => {
    if (pingTimer) clearInterval(pingTimer);
    if (snapTimer) clearInterval(snapTimer);
    if (subscribeRetryTimer) clearTimeout(subscribeRetryTimer);
    try {
      ws?.close();
    } catch {
      // ignore
    }
    // This script intentionally runs forever; exit explicitly on shutdown signals.
    setTimeout(() => process.exit(0), 50);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.mode !== "fixture" && opts.mode !== "live") {
    console.error("Usage: node scripts/run-shadow-live.mjs --mode fixture|live [options]");
    process.exit(2);
  }

  if (opts.mode === "fixture") {
    await runFixtureMode(opts);
    return;
  }

  await runLiveMode(opts);
  // live mode runs until terminated.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
