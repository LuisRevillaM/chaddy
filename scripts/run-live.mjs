#!/usr/bin/env node
// @ts-check

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createGeoChecker } from "../packages/executor/src/geoblockClient.js";
import { preflightLiveMode } from "../packages/executor/src/preflight.js";
import { ClobClient } from "../packages/executor/src/polymarket/ClobClient.js";
import { PolymarketRestExecutor } from "../packages/executor/src/polymarket/PolymarketRestExecutor.js";
import { ScoringClient } from "../packages/executor/src/polymarket/ScoringClient.js";
import { parsePolymarketMarketChannelLine } from "../packages/mm-core/src/polymarket/parseMarketChannelLine.js";
import { parsePolymarketUserChannelLine } from "../packages/mm-core/src/polymarket/parseUserChannelLine.js";
import { killSwitchDecision } from "../packages/mm-core/src/controls/killSwitch.js";
import { TokenBucket } from "../packages/mm-core/src/controls/tokenBucket.js";
import { UpdateThrottle } from "../packages/mm-core/src/controls/updateThrottle.js";
import { diffOrders } from "../packages/mm-core/src/orderManager/diffOrders.js";
import { ResyncingOrderbook } from "../packages/mm-core/src/orderbook/ResyncingOrderbook.js";
import { computeDesiredQuotes } from "../packages/mm-core/src/strategy/computeDesiredQuotes.js";
import { OrderTracker } from "../packages/mm-core/src/state/orderTracker.js";
import { PositionTracker } from "../packages/mm-core/src/state/positionTracker.js";
import { validateConfig } from "../packages/shared/src/validateConfig.js";
import { RUN_JOURNAL_SCHEMA_VERSION, makeRunJournalMeta } from "../packages/shared/src/runJournalSchema.js";
import { buildLiveJournalScoring } from "./lib/liveScoringJournal.js";

function parseArgs(argv) {
  const out = {
    configPath: null,
    outPath: path.join(process.cwd(), "artifacts", "live", "latest.json"),
    journalPath: null,
    liveScoringEnabled: false,
    snapshotEveryMs: 1_000,
    cycleEveryMs: 1_000,
    wsMarketUrl: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
    // This is best-effort; real auth flows may differ. Operator can override via env.
    wsUserUrl: "wss://ws-subscriptions-clob.polymarket.com/ws/user",
    clobBaseUrl: "https://clob.polymarket.com"
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") {
      out.configPath = path.resolve(process.cwd(), String(argv[++i] ?? ""));
      continue;
    }
    if (a === "--out") {
      out.outPath = path.resolve(process.cwd(), String(argv[++i] ?? ""));
      continue;
    }
    if (a === "--journal") {
      out.journalPath = path.resolve(process.cwd(), String(argv[++i] ?? ""));
      continue;
    }
    if (a === "--live-scoring-enabled") {
      out.liveScoringEnabled = true;
      continue;
    }
    if (a === "--snapshot-every-ms") {
      out.snapshotEveryMs = Number(argv[++i] ?? NaN);
      continue;
    }
    if (a === "--cycle-every-ms") {
      out.cycleEveryMs = Number(argv[++i] ?? NaN);
      continue;
    }
    if (a === "--ws-market-url") {
      out.wsMarketUrl = String(argv[++i] ?? "");
      continue;
    }
    if (a === "--ws-user-url") {
      out.wsUserUrl = String(argv[++i] ?? "");
      continue;
    }
    if (a === "--clob-base-url") {
      out.clobBaseUrl = String(argv[++i] ?? "");
      continue;
    }
  }
  return out;
}

async function atomicWriteJson(p, obj) {
  const dir = path.dirname(p);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  await fs.rename(tmp, p);
}

async function appendJsonl(p, obj) {
  if (!p) return;
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.appendFile(p, JSON.stringify(obj) + "\n", "utf8");
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

async function readJson(p) {
  const txt = await fs.readFile(p, "utf8");
  return JSON.parse(txt);
}

function normalizeSnapshotLevels(x) {
  /** @type {Array<[number, number]>} */
  const out = [];
  if (!Array.isArray(x)) return out;
  for (const lvl of x) {
    const p = Array.isArray(lvl) ? Number(lvl[0]) : Number(lvl?.price);
    const s = Array.isArray(lvl) ? Number(lvl[1]) : Number(lvl?.size);
    if (!Number.isFinite(p) || !Number.isFinite(s)) continue;
    if (s <= 0) continue;
    out.push([p, s]);
  }
  return out;
}

async function fetchOrderbookSnapshot({ baseUrl, tokenId }) {
  const url = `${String(baseUrl || "").replace(/\/+$/, "")}/book?token_id=${encodeURIComponent(String(tokenId || ""))}`;
  const res = await fetch(url, { method: "GET", headers: { accept: "application/json" } });
  if (!res.ok) return { ok: false, status: res.status };
  const data = await res.json();
  const bids = normalizeSnapshotLevels(data?.bids ?? data?.buys ?? []);
  const asks = normalizeSnapshotLevels(data?.asks ?? data?.sells ?? []);
  if (bids.length === 0 || asks.length === 0) return { ok: false, status: 200 };
  return { ok: true, bids, asks, url };
}

class LiveEngine {
  /**
   * @param {{
   *  market: string,
   *  quoteCfg: import("../packages/mm-core/src/strategy/computeDesiredQuotes.js").QuoteConfig,
   *  killSwitchCfg: import("../packages/mm-core/src/controls/killSwitch.js").KillSwitchConfig,
   *  diffCfg: import("../packages/mm-core/src/orderManager/diffOrders.js").DiffConfig,
   *  throttle: { minIntervalMs: number },
   *  tokenBucket: { capacity: number, refillEveryMs: number },
   *  executor: PolymarketRestExecutor,
   *  midpointRef: { value: number | null }
   * }} params
   */
  constructor(params) {
    this.market = params.market;
    this.quoteCfg = params.quoteCfg;
    this.killSwitchCfg = params.killSwitchCfg;
    this.diffCfg = params.diffCfg;
    this.executor = params.executor;
    this.midpointRef = params.midpointRef;

    this.ob = new ResyncingOrderbook({ tickSize: this.quoteCfg.tickSize });
    this.orderTracker = new OrderTracker();
    this.positionTracker = new PositionTracker();
    this.throttle = new UpdateThrottle({ minIntervalMs: params.throttle.minIntervalMs });
    this.bucket = new TokenBucket({ capacity: params.tokenBucket.capacity, refillEveryMs: params.tokenBucket.refillEveryMs });

    /** @type {number|null} */
    this.lastMarketDataMs = null;
    /** @type {number|null} */
    this.lastUserDataMs = null;
    /** @type {boolean} */
    this.cancelAllTriggered = false;

    this.policyRejections = {};
    this.lastKill = { cancelAll: false, reason: null };
  }

  /**
   * @param {number} nowMs
   * @param {{ type: "book"|"price_change", seq: number, bids?: any, asks?: any, side?: "bid"|"ask", price?: number, size?: number }} msg
   */
  ingestMarket(nowMs, msg) {
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "book") {
      this.ob.applySnapshot({ seq: msg.seq, bids: msg.bids || [], asks: msg.asks || [] });
      this.lastMarketDataMs = nowMs;
      this.#updateMidpointRef();
      return;
    }
    if (msg.type === "price_change") {
      const r = this.ob.applyDelta({ seq: msg.seq, side: msg.side, price: msg.price, size: msg.size });
      if (r.applied) {
        this.lastMarketDataMs = nowMs;
        this.#updateMidpointRef();
      }
    }
  }

  /**
   * @param {number} nowMs
   * @param {any} ev
   */
  ingestUser(nowMs, ev) {
    this.lastUserDataMs = nowMs;
    this.orderTracker.applyUserEvent(ev);
    this.positionTracker.applyUserEvent(ev);
  }

  /**
   * @param {number} nowMs
   */
  async cycle(nowMs) {
    const inv = this.positionTracker.position;
    const bb = this.ob.bestBid();
    const ba = this.ob.bestAsk();

    const ks0 = killSwitchDecision({ nowMs, lastMarketDataMs: this.lastMarketDataMs, lastUserDataMs: this.lastUserDataMs }, this.killSwitchCfg);
    let ks = ks0;
    if (this.ob.needsResync && this.ob.lastGap) {
      ks = { cancelAll: true, reason: "orderbook_resync_gap" };
    } else if (this.ob.needsResync && typeof this.ob.lastResyncReason === "string" && this.ob.lastResyncReason.startsWith("crossed_book")) {
      ks = { cancelAll: true, reason: "orderbook_crossed" };
    } else if (bb && ba && bb.price >= ba.price) {
      this.ob.enterResync("crossed_book_live");
      ks = { cancelAll: true, reason: "orderbook_crossed" };
    }
    this.lastKill = ks;

    if (ks.cancelAll) {
      const r = await this.executor.cancelAll();
      this.cancelAllTriggered = true;
      return { kind: "cancel_all", ok: r.ok, reason: r.reason, canceled: r.canceled };
    }

    if (this.cancelAllTriggered) return { kind: "suppressed", reason: "cancel_all_triggered" };
    if (this.ob.needsResync) return { kind: "suppressed", reason: "orderbook_resync" };
    if (!bb || !ba) return { kind: "suppressed", reason: "no_top_of_book" };

    const desired = computeDesiredQuotes({ bestBid: bb, bestAsk: ba, inventory: inv }, this.quoteCfg);
    const live = this.orderTracker.liveOrders();
    const diff = diffOrders(desired, live, this.diffCfg);

    const hasWork = diff.cancel.length > 0 || diff.place.length > 0;
    if (!hasWork || !this.throttle.canUpdate(nowMs)) return { kind: "idle" };
    this.throttle.markUpdated(nowMs);

    const out = { kind: "update", canceled: 0, placed: 0, placedOk: 0, cancelOk: 0, rejected: {} };

    for (const id of diff.cancel) {
      const budget = this.bucket.tryTake(nowMs, 1);
      if (!budget.ok) break;
      const r = await this.executor.cancelOrder(id);
      out.canceled += 1;
      if (r.ok) out.cancelOk += 1;
      else this.#reject(r.reason);
    }

    for (const o of diff.place) {
      const budget = this.bucket.tryTake(nowMs, 1);
      if (!budget.ok) break;
      const r = await this.executor.placeOrder({ market: this.market, side: o.side, price: o.price, size: o.size });
      out.placed += 1;
      if (r.ok) out.placedOk += 1;
      else this.#reject(r.reason);
    }

    out.rejected = { ...this.policyRejections };
    return out;
  }

  #reject(reason) {
    const k = String(reason || "unknown");
    this.policyRejections[k] = (this.policyRejections[k] || 0) + 1;
  }

  snapshot(nowMs) {
    const bb = this.ob.bestBid();
    const ba = this.ob.bestAsk();
    return {
      market: this.market,
      orderbook: {
        seq: this.ob.seq,
        needsResync: this.ob.needsResync,
        gap: this.ob.lastGap,
        resyncReason: this.ob.lastResyncReason,
        bestBid: bb,
        bestAsk: ba
      },
      midpoint: bb && ba ? (bb.price + ba.price) / 2 : null,
      inventory: this.positionTracker.position,
      liveOrders: this.orderTracker.liveOrders().length,
      lastMarketDataAgeMs: this.lastMarketDataMs == null ? null : nowMs - this.lastMarketDataMs,
      lastUserDataAgeMs: this.lastUserDataMs == null ? null : nowMs - this.lastUserDataMs,
      killSwitch: this.lastKill,
      cancelAllTriggered: this.cancelAllTriggered,
      policyRejections: { ...this.policyRejections }
    };
  }

  liveOrders() {
    return this.orderTracker.liveOrders();
  }

  #updateMidpointRef() {
    const bb = this.ob.bestBid();
    const ba = this.ob.bestAsk();
    this.midpointRef.value = bb && ba ? (bb.price + ba.price) / 2 : null;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.configPath) {
    console.error("Usage: node scripts/run-live.mjs --config <path> [--out <path>]");
    process.exit(2);
  }

  const cfg = await readJson(opts.configPath);
  validateConfig(cfg);
  if (cfg.runMode !== "live") {
    console.error("config.runMode must be 'live' for scripts/run-live.mjs");
    process.exit(2);
  }

  const statusBase = {
    runner: "live",
    pid: process.pid,
    startedAt: new Date().toISOString(),
    configPath: path.relative(process.cwd(), opts.configPath)
  };

  // Strict preflight: refuse to start when blocked or policy is missing.
  const geoChecker = createGeoChecker({ fetchImpl: fetch, cacheMs: 60_000 });
  const pre = await preflightLiveMode({ policy: cfg.executorPolicy, geoChecker });
  if (!pre.ok) {
    await atomicWriteJson(opts.outPath, { ...statusBase, ok: false, phase: "preflight_failed", reasons: pre.reasons });
    process.exit(1);
  }

  if (opts.journalPath) {
    // Start a fresh journal for this run.
    await fs.mkdir(path.dirname(opts.journalPath), { recursive: true });
    await fs.writeFile(opts.journalPath, JSON.stringify(makeRunJournalMeta({ t: 0, runner: "live", markets: cfg.markets.slice(0, 3) })) + "\n", "utf8");
  }

  // Runtime-only auth headers; never persist them.
  const authHeaders = parseJsonEnv("POLY_CLOB_AUTH_HEADERS_JSON");
  if (!authHeaders || typeof authHeaders !== "object") {
    await atomicWriteJson(opts.outPath, { ...statusBase, ok: false, phase: "missing_auth", reasons: ["missing_POLY_CLOB_AUTH_HEADERS_JSON"] });
    process.exit(1);
  }

  const client = new ClobClient({ fetchImpl: fetch, baseUrl: opts.clobBaseUrl, authHeaders });
  const liveScoringEnabled =
    (opts.liveScoringEnabled || process.env.LIVE_SCORING_ENABLED === "1") &&
    process.env.PROVE_NO_NETWORK !== "1";
  const scoringClient = liveScoringEnabled ? new ScoringClient({ fetchImpl: fetch, baseUrl: opts.clobBaseUrl, authHeaders }) : null;

  // Track up to 3 markets.
  const markets = cfg.markets.slice(0, 3);
  const engines = new Map();
  const seqByMarket = new Map();

  for (const m of markets) {
    const midpointRef = { value: null };
    const exec = new PolymarketRestExecutor({
      client,
      policy: cfg.executorPolicy,
      marketMidpoint: () => midpointRef.value,
      // Live runner already preflighted. Keep geoAllowed permissive here to avoid requiring GEO_ALLOWED env.
      geoAllowed: () => true
    });

    engines.set(
      m,
      new LiveEngine({
        market: m,
        quoteCfg: {
          tickSize: cfg.quote.tickSize,
          halfSpread: cfg.quote.halfSpread,
          maxSpread: cfg.quote.maxSpread,
          minSize: cfg.quote.minSize,
          orderSize: cfg.quote.orderSize,
          inventoryTarget: cfg.quote.inventoryTarget,
          maxSkew: cfg.quote.maxSkew
        },
        killSwitchCfg: { staleMarketDataMs: cfg.killSwitch.staleMarketDataMs, staleUserDataMs: cfg.killSwitch.staleUserDataMs },
        diffCfg: { priceTolerance: 0, sizeTolerance: 0, maxCancelsPerCycle: 10, maxPlacesPerCycle: 10 },
        throttle: { minIntervalMs: 250 },
        tokenBucket: { capacity: 10, refillEveryMs: 1_000 },
        executor: exec,
        midpointRef
      })
    );
    seqByMarket.set(m, 0);
  }

  // Best-effort snapshot bootstrap per market.
  const bootstrap = [];
  for (const m of markets) {
    try {
      const snap = await fetchOrderbookSnapshot({ baseUrl: opts.clobBaseUrl, tokenId: m });
      if (snap.ok) {
        const nextSeq = (seqByMarket.get(m) || 0) + 1;
        seqByMarket.set(m, nextSeq);
        engines.get(m).ingestMarket(0, { type: "book", seq: nextSeq, bids: snap.bids, asks: snap.asks });
        bootstrap.push({ market: m, ok: true, url: snap.url, bids: snap.bids.length, asks: snap.asks.length });
      } else {
        bootstrap.push({ market: m, ok: false, status: snap.status || null });
      }
    } catch {
      bootstrap.push({ market: m, ok: false, status: null });
    }
  }

  if (typeof WebSocket !== "function") {
    await atomicWriteJson(opts.outPath, { ...statusBase, ok: false, phase: "no_websocket" });
    process.exit(1);
  }

  const t0 = Date.now();
  const nowMs = () => Date.now() - t0;

  const wsMarketStats = {
    connectAttempts: 0,
    openCount: 0,
    closeCount: 0,
    errorCount: 0,
    messageCount: 0,
    parsedOkCount: 0,
    parsedErrorCount: 0,
    bookEventCount: 0,
    deltaEventCount: 0,
    lastOpenAtMs: null,
    lastCloseAtMs: null,
    lastError: null,
    lastMessageAtMs: null,
    lastParsedErrorCode: null,
    lastMessageSample: null
  };

  const wsUserStats = {
    enabled: Boolean(process.env.POLY_USER_WS_SUBSCRIBE_JSON),
    connectAttempts: 0,
    openCount: 0,
    closeCount: 0,
    errorCount: 0,
    messageCount: 0,
    parsedOkCount: 0,
    parsedErrorCount: 0,
    lastOpenAtMs: null,
    lastCloseAtMs: null,
    lastError: null,
    lastMessageAtMs: null,
    lastParsedErrorCode: null
  };

  /** @type {WebSocket|null} */
  let wsMarket = null;
  /** @type {WebSocket|null} */
  let wsUser = null;
  /** @type {NodeJS.Timeout|null} */
  let snapTimer = null;
  /** @type {NodeJS.Timeout|null} */
  let cycleTimer = null;

  const handleMarketText = (text) => {
    wsMarketStats.lastMessageSample = String(text ?? "").slice(0, 600);
    const parsed = parsePolymarketMarketChannelLine(text);
    if (!parsed.ok) {
      wsMarketStats.parsedErrorCount += 1;
      wsMarketStats.lastParsedErrorCode = parsed.error.code;
      return;
    }
    wsMarketStats.parsedOkCount += 1;
    const t = nowMs();
    for (const ev of parsed.events) {
      const assetId = String(ev?.meta?.asset_id || "");
      const m = engines.has(assetId) ? assetId : null;
      if (!m) continue;
      const nextSeq = (seqByMarket.get(m) || 0) + 1;
      seqByMarket.set(m, nextSeq);
      if (ev.kind === "snapshot") {
        wsMarketStats.bookEventCount += 1;
        engines.get(m).ingestMarket(t, { type: "book", seq: nextSeq, bids: ev.bids, asks: ev.asks });
      } else if (ev.kind === "delta") {
        wsMarketStats.deltaEventCount += 1;
        engines.get(m).ingestMarket(t, { type: "price_change", seq: nextSeq, side: ev.side, price: ev.price, size: ev.size });
      }
    }
  };

  const connectMarketWs = () => {
    wsMarketStats.connectAttempts += 1;
    wsMarket = new WebSocket(opts.wsMarketUrl);
    wsMarket.addEventListener("open", () => {
      wsMarketStats.openCount += 1;
      wsMarketStats.lastOpenAtMs = nowMs();
      // Subscribe to all configured markets (asset ids).
      try {
        wsMarket.send(JSON.stringify({ type: "market", assets_ids: markets }));
      } catch {
        // ignore
      }
    });
    wsMarket.addEventListener("message", (ev) => {
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
      wsMarketStats.messageCount += 1;
      wsMarketStats.lastMessageAtMs = nowMs();
      handleMarketText(text);
    });
    wsMarket.addEventListener("close", () => {
      wsMarketStats.closeCount += 1;
      wsMarketStats.lastCloseAtMs = nowMs();
      setTimeout(connectMarketWs, 2_000);
    });
    wsMarket.addEventListener("error", (ev) => {
      wsMarketStats.errorCount += 1;
      wsMarketStats.lastError = String(ev?.message || ev || "error");
    });
  };

  const connectUserWs = () => {
    if (!wsUserStats.enabled) return;
    wsUserStats.connectAttempts += 1;
    wsUser = new WebSocket(opts.wsUserUrl);
    wsUser.addEventListener("open", () => {
      wsUserStats.openCount += 1;
      wsUserStats.lastOpenAtMs = nowMs();
      const payload = parseJsonEnv("POLY_USER_WS_SUBSCRIBE_JSON");
      if (payload) {
        try {
          wsUser.send(JSON.stringify(payload));
        } catch {
          // ignore
        }
      }
    });
    wsUser.addEventListener("message", (ev) => {
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
      wsUserStats.messageCount += 1;
      wsUserStats.lastMessageAtMs = nowMs();

      const parsed = parsePolymarketUserChannelLine(text);
      if (!parsed.ok) {
        wsUserStats.parsedErrorCount += 1;
        wsUserStats.lastParsedErrorCode = parsed.error.code;
        return;
      }
      wsUserStats.parsedOkCount += 1;
      const t = nowMs();
      for (const ev of parsed.events) {
        const assetId = String(ev?.meta?.asset_id || "");
        const m = engines.has(assetId) ? assetId : null;
        if (!m) continue;
        engines.get(m).ingestUser(t, ev);
      }
    });
    wsUser.addEventListener("close", () => {
      wsUserStats.closeCount += 1;
      wsUserStats.lastCloseAtMs = nowMs();
      setTimeout(connectUserWs, 2_000);
    });
    wsUser.addEventListener("error", (ev) => {
      wsUserStats.errorCount += 1;
      wsUserStats.lastError = String(ev?.message || ev || "error");
    });
  };

  connectMarketWs();
  connectUserWs();

  let cycleLast = null;
  let cycleI = 0;
  cycleTimer = setInterval(async () => {
    const t = nowMs();
    /** @type {any[]} */
    const perMarket = [];
    for (const m of markets) {
      const r = await engines.get(m).cycle(t);
      perMarket.push({ market: m, result: r });
    }
    cycleLast = { nowMs: t, perMarket };

    // Optional append-only run journal (no secrets).
    if (opts.journalPath) {
      for (const it of perMarket) {
        const r = it.result || {};
        const ops = { placed: 0, placedOk: 0, canceled: 0, cancelOk: 0, cancelAll: false };
        if (r.kind === "update") {
          ops.placed = Number(r.placed || 0);
          ops.placedOk = Number(r.placedOk || 0);
          ops.canceled = Number(r.canceled || 0);
          ops.cancelOk = Number(r.cancelOk || 0);
        } else if (r.kind === "cancel_all") {
          ops.cancelAll = true;
          ops.canceled = Number(r.canceled || 0);
          ops.cancelOk = Number(r.ok ? r.canceled || 0 : 0);
        }
        const scoring = await buildLiveJournalScoring({
          enabled: liveScoringEnabled,
          scoringClient,
          liveOrders: engines.get(it.market).liveOrders()
        });

        const entry = {
          v: RUN_JOURNAL_SCHEMA_VERSION,
          t,
          kind: "cycle",
          market: it.market,
          i: cycleI,
          ops
        };
        if (scoring) entry.scoring = scoring;
        await appendJsonl(opts.journalPath, entry);
      }
      cycleI += 1;
    }
  }, Math.max(250, opts.cycleEveryMs));

  let snapI = 0;
  snapTimer = setInterval(async () => {
    const t = nowMs();
    const perMarket = markets.map((m) => engines.get(m).snapshot(t));
    await atomicWriteJson(opts.outPath, {
      ...statusBase,
      ok: true,
      heartbeat: { i: snapI, nowMs: t, uptimeMs: t },
      bootstrap,
      preflight: pre,
      scoring: { enabled: liveScoringEnabled },
      ws: { market: { ...wsMarketStats, readyState: wsMarket ? wsMarket.readyState : null }, user: { ...wsUserStats, readyState: wsUser ? wsUser.readyState : null } },
      cycleLast,
      perMarket
    });
    snapI += 1;
  }, Math.max(250, opts.snapshotEveryMs));

  const shutdown = async () => {
    if (snapTimer) clearInterval(snapTimer);
    if (cycleTimer) clearInterval(cycleTimer);
    try {
      wsMarket?.close();
    } catch {
      // ignore
    }
    try {
      wsUser?.close();
    } catch {
      // ignore
    }
    try {
      await atomicWriteJson(opts.outPath, { ...statusBase, ok: false, phase: "shutdown", at: new Date().toISOString() });
    } catch {
      // ignore
    }
    setTimeout(() => process.exit(0), 50);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

main().catch(async (err) => {
  try {
    const outPath = path.join(process.cwd(), "artifacts", "live", "fatal.json");
    await atomicWriteJson(outPath, { ok: false, error: String(err?.stack || err) });
  } catch {
    // ignore
  }
  console.error(err?.stack || String(err));
  process.exit(1);
});
