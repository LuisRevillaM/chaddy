#!/usr/bin/env node
// @ts-check

import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Executor } from "../packages/executor/src/Executor.js";
import { killSwitchDecision } from "../packages/mm-core/src/controls/killSwitch.js";
import { TokenBucket } from "../packages/mm-core/src/controls/tokenBucket.js";
import { UpdateThrottle } from "../packages/mm-core/src/controls/updateThrottle.js";
import { diffOrders } from "../packages/mm-core/src/orderManager/diffOrders.js";
import { ResyncingOrderbook } from "../packages/mm-core/src/orderbook/ResyncingOrderbook.js";
import { createMockScoringChecker } from "../packages/mm-core/src/scoring/mockScoringChecker.js";
import { parsePolymarketMarketChannelLine } from "../packages/mm-core/src/polymarket/parseMarketChannelLine.js";
import { runMmCoreLoop } from "../packages/mm-core/src/runner/mmCoreLoop.js";
import { computeDesiredQuotes } from "../packages/mm-core/src/strategy/computeDesiredQuotes.js";
import { OrderTracker } from "../packages/mm-core/src/state/orderTracker.js";
import { PositionTracker } from "../packages/mm-core/src/state/positionTracker.js";
import { _resetIdsForTesting } from "../packages/shared/src/ids.js";
import { RUN_JOURNAL_SCHEMA_VERSION, makeRunJournalMeta } from "../packages/shared/src/runJournalSchema.js";

function parseArgs(argv) {
  const out = {
    mode: "fixture",
    market: "mkt_paper_live",
    outPath: path.join(process.cwd(), "artifacts", "paper-live", "latest.json"),
    journalPath: null,
    steps: 2,
    stepMs: 1_000,
    tickSize: 0.01,
    staleMarketDataMs: 5 * 60_000,
    staleUserDataMs: 60_000,
    marketFixture: path.join(process.cwd(), "tests", "replay", "fixtures", "polymarket-market-channel.jsonl"),
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
    if (a === "--journal") {
      out.journalPath = path.resolve(process.cwd(), String(argv[++i] ?? ""));
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

export async function fetchOrderbookSnapshot({ baseUrl, tokenId, fetchImpl = fetch }) {
  const url = `${String(baseUrl || "").replace(/\/+$/, "")}/book?token_id=${encodeURIComponent(String(tokenId || ""))}`;
  const res = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" } });
  if (!res.ok) return { ok: false, status: res.status };
  const data = await res.json();
  const bids = normalizeSnapshotLevels(data?.bids ?? data?.buys ?? []);
  const asks = normalizeSnapshotLevels(data?.asks ?? data?.sells ?? []);
  if (bids.length === 0 || asks.length === 0) return { ok: false, status: 200 };
  return { ok: true, bids, asks, url };
}

export function parseBestBidAskFromDeltaEvent(ev) {
  const bid = Number(ev?.meta?.best_bid);
  const ask = Number(ev?.meta?.best_ask);
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return null;
  if (!(bid > 0) || !(ask > 0)) return null;
  if (bid >= ask) return null;
  return { bids: [[bid, 1]], asks: [[ask, 1]] };
}

export function shouldLatchCancelAll(reason) {
  return String(reason || "") !== "no_market_data_yet";
}

async function atomicWriteJson(p, obj) {
  const dir = path.dirname(p);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  await fs.rename(tmp, p);
}

async function writeJournalFromMmCoreTrace({ journalPath, runner, market, trace }) {
  if (!journalPath) return;
  const dir = path.dirname(journalPath);
  await fs.mkdir(dir, { recursive: true });
  const lines = [];
  lines.push(JSON.stringify(makeRunJournalMeta({ t: 0, runner, markets: [market] })));
  for (const e of trace || []) {
    const placedOk = Array.isArray(e.placed) ? e.placed.filter((p) => p.ok).length : 0;
    const cancelOk = Array.isArray(e.canceled) ? e.canceled.length : 0;
    lines.push(
      JSON.stringify({
        v: RUN_JOURNAL_SCHEMA_VERSION,
        t: e.nowMs,
        kind: "cycle",
        market,
        i: e.i,
        ops: {
          placed: Array.isArray(e.placed) ? e.placed.length : 0,
          placedOk,
          canceled: Array.isArray(e.canceled) ? e.canceled.length : 0,
          cancelOk,
          cancelAll: Boolean(e.killSwitch && e.killSwitch.cancelAll)
        },
        scoring: e.scoring
          ? {
              buy: { scoring: Boolean(e.scoring.buy.scoring), reason: String(e.scoring.buy.reason) },
              sell: { scoring: Boolean(e.scoring.sell.scoring), reason: String(e.scoring.sell.reason) }
            }
          : null,
        economics: e.economics || null
      })
    );
  }
  await fs.writeFile(journalPath, lines.join("\n") + "\n", "utf8");
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

function defaultPolicy(market) {
  return {
    allowedMarkets: [market],
    minOrderSize: 1,
    maxOrderSize: 50,
    maxAbsNotional: 1_000,
    maxPriceBand: 0.2
  };
}

async function runFixtureMode(opts) {
  _resetIdsForTesting();

  const lines = await readJsonlLines(opts.marketFixture);

  const marketEmitter = new EventEmitter();
  let lineIdx = 0;
  let seq = 0;

  const stepMarket = () => {
    if (lineIdx >= lines.length) return;
    const parsed = parsePolymarketMarketChannelLine(lines[lineIdx++]);
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

  // Use SimExchange only as a deterministic user-event source for the executor boundary.
  // Never call ex.step() here (no fills).
  const { SimExchange } = await import("../packages/sim/src/SimExchange.js");
  const ex = new SimExchange({ seed: 999, tickSize: opts.tickSize, mid: 0.5, extSpread: 0.10 });

  const midpointRef = { value: null };
  const exec = new Executor({ exchange: ex, policy: defaultPolicy(opts.market), marketMidpoint: () => midpointRef.value });
  const scoringChecker = createMockScoringChecker({ minSize: 1, requireTopOfBook: true });

  const result = runMmCoreLoop(
    {
      market: opts.market,
      steps: opts.steps,
      activeMarketSteps: opts.steps,
      stepMs: opts.stepMs,
      quoteCfg: makeQuoteCfg(opts.tickSize),
      killSwitchCfg: { staleMarketDataMs: opts.staleMarketDataMs, staleUserDataMs: opts.staleUserDataMs },
      diffCfg: { priceTolerance: 0, sizeTolerance: 0, maxCancelsPerCycle: 10, maxPlacesPerCycle: 10 },
      throttle: { minIntervalMs: 0 },
      tokenBucket: { capacity: 10, refillEveryMs: 1_000 },
      scoringCfg: { minSize: 1, requireTopOfBook: true },
      traceMax: 400
    },
    {
      onMarket: (cb) => {
        marketEmitter.on("market", cb);
        return () => marketEmitter.off("market", cb);
      },
      onUser: (cb) => {
        ex.on("user", cb);
        return () => ex.off("user", cb);
      },
      stepMarket,
      executor: exec,
      scoringChecker,
      midpointRef
    }
  );

  await atomicWriteJson(opts.outPath, {
    mode: "fixture",
    meta: { fixture: path.relative(process.cwd(), opts.marketFixture), steps: opts.steps, stepMs: opts.stepMs, market: opts.market },
    result
  });

  await writeJournalFromMmCoreTrace({
    journalPath: opts.journalPath,
    runner: "paper-live:fixture",
    market: opts.market,
    trace: result.trace
  });
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

class PaperLiveEngine {
  /**
   * @param {{
   *  market: string,
   *  quoteCfg: import("../packages/mm-core/src/strategy/computeDesiredQuotes.js").QuoteConfig,
   *  killSwitchCfg: import("../packages/mm-core/src/controls/killSwitch.js").KillSwitchConfig,
   *  diffCfg: import("../packages/mm-core/src/orderManager/diffOrders.js").DiffConfig,
   *  throttle: { minIntervalMs: number },
   *  tokenBucket: { capacity: number, refillEveryMs: number },
   *  scoringCfg: { minSize: number, requireTopOfBook: boolean },
   *  executor: import("../packages/mm-core/src/runner/mmCoreLoop.js").TradeExecutor,
   *  scoringChecker: { checkOrder: (ctx: { side: "BUY"|"SELL", price: number, size: number, bestBid: {price:number,size:number}|null, bestAsk: {price:number,size:number}|null }) => ({ scoring: boolean, reason: string }) },
   *  midpointRef?: { value: number | null }
   * }} params
   */
  constructor(params) {
    this.market = params.market;
    this.quoteCfg = params.quoteCfg;
    this.killSwitchCfg = params.killSwitchCfg;
    this.diffCfg = params.diffCfg;
    this.scoringCfg = params.scoringCfg;
    this.executor = params.executor;
    this.scoringChecker = params.scoringChecker;
    this.midpointRef = params.midpointRef ?? null;

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

    this.churnSummary = {
      quoteUpdateCycles: 0,
      placeCalls: 0,
      placeOk: 0,
      cancelCalls: 0,
      cancelOk: 0,
      cancelAllCalls: 0,
      cancelAllCanceled: 0,
      tokenBucketDenied: 0,
      killSwitch: { cancelAllCalls: 0, lastReason: null },
      tokenBucket: { capacity: this.bucket.capacity, refillEveryMs: this.bucket.refillEveryMs },
      throttle: { minIntervalMs: this.throttle.minIntervalMs }
    };

    this.scoringSummary = {
      cfg: this.scoringCfg,
      totals: { scoring: 0, nonScoring: 0, byReason: {} }
    };
  }

  /**
   * @param {number} nowMs
   * @param {any} msg
   */
  ingestMarket(nowMs, msg) {
    if (!Number.isInteger(nowMs) || nowMs < 0) return { ok: false, reason: "invalid_now" };
    if (!msg || typeof msg.type !== "string") return { ok: false, reason: "ignored" };

    if (msg.type === "book") {
      this.ob.applySnapshot({ seq: msg.seq, bids: msg.bids, asks: msg.asks });
      this.lastMarketDataMs = nowMs;
      this.#updateMidpointRef();
      return { ok: true, kind: "snapshot" };
    }

    if (msg.type === "price_change") {
      if (msg.side !== "bid" && msg.side !== "ask") return { ok: false, reason: "invalid_side" };
      if (!Number.isFinite(msg.price) || !Number.isFinite(msg.size)) return { ok: false, reason: "invalid_price_size" };
      if (!Number.isInteger(msg.seq)) return { ok: false, reason: "invalid_seq" };
      const r = this.ob.applyDelta({ seq: msg.seq, side: msg.side, price: msg.price, size: msg.size });
      this.lastMarketDataMs = nowMs;
      this.#updateMidpointRef();
      return { ok: true, kind: "delta", applied: r.applied, action: r.action };
    }

    return { ok: false, reason: "ignored" };
  }

  /**
   * @param {number} nowMs
   * @param {any} msg
   */
  ingestUser(nowMs, msg) {
    if (!Number.isInteger(nowMs) || nowMs < 0) return { ok: false, reason: "invalid_now" };
    this.lastUserDataMs = nowMs;
    this.orderTracker.applyUserEvent(msg);
    this.positionTracker.applyUserEvent(msg);
    return { ok: true };
  }

  /**
   * Execute one paper quoting cycle against the injected executor.
   *
   * @param {number} nowMs
   */
  cycle(nowMs) {
    if (!Number.isInteger(nowMs) || nowMs < 0) return { ok: false, reason: "invalid_now" };

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
      this.ob.enterResync("crossed_book_paper_live");
      ks = { cancelAll: true, reason: "orderbook_crossed" };
    }

    /** @type {string[]} */
    const canceled = [];
    /** @type {Array<{side:"BUY"|"SELL", price:number, size:number, ok:boolean, reason:string|null}>} */
    const placed = [];

    /** @type {Array<{side:"BUY"|"SELL", price:number, size:number}>} */
    let desired = [];

    if (ks.cancelAll) {
      const r = this.executor.cancelAll();
      this.churnSummary.cancelAllCalls += 1;
      this.churnSummary.cancelAllCanceled += r.canceled;
      this.churnSummary.killSwitch.cancelAllCalls += 1;
      this.churnSummary.killSwitch.lastReason = ks.reason;
      if (shouldLatchCancelAll(ks.reason)) this.cancelAllTriggered = true;
    } else if (!this.cancelAllTriggered && !this.ob.needsResync && bb && ba) {
      desired = computeDesiredQuotes({ bestBid: bb, bestAsk: ba, inventory: inv }, this.quoteCfg);

      const live = this.orderTracker.liveOrders();
      const diff = diffOrders(desired, live, this.diffCfg);

      const hasWork = diff.cancel.length > 0 || diff.place.length > 0;
      if (hasWork && this.throttle.canUpdate(nowMs)) {
        this.churnSummary.quoteUpdateCycles += 1;
        this.throttle.markUpdated(nowMs);

        for (const id of diff.cancel) {
          const budget = this.bucket.tryTake(nowMs, 1);
          if (!budget.ok) {
            this.churnSummary.tokenBucketDenied += 1;
            break;
          }
          this.churnSummary.cancelCalls += 1;
          const r = this.executor.cancelOrder(id);
          if (r.ok) {
            this.churnSummary.cancelOk += 1;
            canceled.push(id);
          }
        }

        for (const o of diff.place) {
          const budget = this.bucket.tryTake(nowMs, 1);
          if (!budget.ok) {
            this.churnSummary.tokenBucketDenied += 1;
            break;
          }
          this.churnSummary.placeCalls += 1;
          const r = this.executor.placeOrder({ market: this.market, side: o.side, price: o.price, size: o.size });
          if (r.ok) this.churnSummary.placeOk += 1;
          placed.push({ side: o.side, price: o.price, size: o.size, ok: r.ok, reason: r.reason });
        }
      }
    }

    const liveOrders = this.orderTracker.liveOrders();
    /** @type {{id:string, side:"BUY"|"SELL", price:number, size:number} | null} */
    let bestBuy = null;
    /** @type {{id:string, side:"BUY"|"SELL", price:number, size:number} | null} */
    let bestSell = null;
    for (const o of liveOrders) {
      if (o.side === "BUY") {
        if (!bestBuy || o.price > bestBuy.price) bestBuy = o;
      } else if (o.side === "SELL") {
        if (!bestSell || o.price < bestSell.price) bestSell = o;
      }
    }

    const scoreSide = (side, o) => {
      if (!o) return { scoring: false, reason: "no_order" };
      const r = this.scoringChecker.checkOrder({ side, price: o.price, size: o.size, bestBid: bb, bestAsk: ba });
      return { scoring: r.scoring, reason: r.reason };
    };

    const buyScore = scoreSide("BUY", bestBuy);
    const sellScore = scoreSide("SELL", bestSell);

    for (const s of [buyScore, sellScore]) {
      if (s.scoring) this.scoringSummary.totals.scoring += 1;
      else this.scoringSummary.totals.nonScoring += 1;
      this.scoringSummary.totals.byReason[s.reason] = (this.scoringSummary.totals.byReason[s.reason] || 0) + 1;
    }

    return {
      ok: true,
      nowMs,
      bestBid: bb,
      bestAsk: ba,
      inventory: inv,
      killSwitch: ks,
      desiredQuotes: desired,
      canceled,
      placed,
      scoring: { buy: buyScore, sell: sellScore }
    };
  }

  /**
   * @param {{ i: number, nowMs: number, lastCycle?: any }} t
   */
  snapshot(t) {
    const bb = this.ob.bestBid();
    const ba = this.ob.bestAsk();
    return {
      i: t.i,
      nowMs: t.nowMs,
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
      liveOrders: this.orderTracker.liveOrders(),
      lastMarketDataAgeMs: this.lastMarketDataMs == null ? null : t.nowMs - this.lastMarketDataMs,
      lastUserDataAgeMs: this.lastUserDataMs == null ? null : t.nowMs - this.lastUserDataMs,
      cancelAllTriggered: this.cancelAllTriggered,
      churnSummary: this.churnSummary,
      scoringTotals: this.scoringSummary.totals,
      lastCycle: t.lastCycle ?? null
    };
  }

  stateFinal() {
    return {
      orderbook: {
        bestBid: this.ob.bestBid(),
        bestAsk: this.ob.bestAsk(),
        seq: this.ob.seq,
        needsResync: this.ob.needsResync,
        gap: this.ob.lastGap,
        resyncReason: this.ob.lastResyncReason
      },
      ...this.positionTracker.toJSON(),
      liveOrders: this.orderTracker.liveOrders()
    };
  }

  #updateMidpointRef() {
    if (!this.midpointRef) return;
    const bb = this.ob.bestBid();
    const ba = this.ob.bestAsk();
    this.midpointRef.value = bb && ba ? (bb.price + ba.price) / 2 : null;
  }
}

async function runLiveMode(opts) {
  // Live paper mode is still *paper*: it reads public market data, but trades only against SimExchange via Executor.
  // It must never touch Polymarket trading endpoints.
  const resolved = opts.assetId || (await resolveAssetIdFromGamma(opts));
  if (!resolved) throw new Error("Provide --asset-id or (--gamma-slug and optional --token-index)");
  if (typeof WebSocket !== "function") throw new Error("WebSocket is not available in this Node environment");

  _resetIdsForTesting();

  const { SimExchange } = await import("../packages/sim/src/SimExchange.js");
  const ex = new SimExchange({ seed: 123, tickSize: opts.tickSize, mid: 0.5, extSpread: 0.10 });

  const t0 = Date.now();
  const nowMs = () => Date.now() - t0;

  const midpointRef = { value: null };
  const exec = new Executor({ exchange: ex, policy: defaultPolicy(opts.market), marketMidpoint: () => midpointRef.value });
  const scoringChecker = createMockScoringChecker({ minSize: 1, requireTopOfBook: true });
  const engine = new PaperLiveEngine({
    market: opts.market,
    quoteCfg: makeQuoteCfg(opts.tickSize),
    killSwitchCfg: { staleMarketDataMs: opts.staleMarketDataMs, staleUserDataMs: opts.staleUserDataMs },
    diffCfg: { priceTolerance: 0, sizeTolerance: 0, maxCancelsPerCycle: 10, maxPlacesPerCycle: 10 },
    throttle: { minIntervalMs: 250 },
    tokenBucket: { capacity: 10, refillEveryMs: 1_000 },
    scoringCfg: { minSize: 1, requireTopOfBook: true },
    executor: exec,
    scoringChecker,
    midpointRef
  });

  ex.on("user", (msg) => engine.ingestUser(nowMs(), msg));

  let seq = 0;
  const bootstrap = {
    attempted: false,
    ok: false,
    source: null,
    status: null,
    bids: 0,
    asks: 0,
    url: null
  };

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
    syntheticBookFromDeltaCount: 0,
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

  // Best-effort startup bootstrap to avoid waiting for a websocket snapshot shape that may never arrive.
  bootstrap.attempted = true;
  try {
    const snap = await fetchOrderbookSnapshot({ baseUrl: "https://clob.polymarket.com", tokenId: resolved });
    if (snap.ok) {
      seq += 1;
      engine.ingestMarket(nowMs(), { type: "book", seq, bids: snap.bids, asks: snap.asks });
      bootstrap.ok = true;
      bootstrap.source = "rest_snapshot";
      bootstrap.bids = snap.bids.length;
      bootstrap.asks = snap.asks.length;
      bootstrap.url = snap.url;
      wsStats.bookEventCount += 1;
      wsStats.lastBookAtMs = nowMs();
    } else {
      bootstrap.ok = false;
      bootstrap.source = "rest_snapshot_failed";
      bootstrap.status = snap.status ?? null;
    }
  } catch {
    bootstrap.ok = false;
    bootstrap.source = "rest_snapshot_failed";
  }

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
        if (engine.ob.needsResync) {
          const seed = parseBestBidAskFromDeltaEvent(ev);
          if (seed) {
            seq += 1;
            wsStats.bookEventCount += 1;
            wsStats.syntheticBookFromDeltaCount += 1;
            wsStats.lastBookAtMs = t;
            engine.ingestMarket(t, { type: "book", seq, bids: seed.bids, asks: seed.asks });
            if (!bootstrap.ok) {
              bootstrap.ok = true;
              bootstrap.source = "delta_best_bid_ask";
              bootstrap.bids = seed.bids.length;
              bootstrap.asks = seed.asks.length;
            }
          }
        }
        wsStats.deltaEventCount += 1;
        wsStats.lastDeltaAtMs = t;
        engine.ingestMarket(t, { type: "price_change", seq, side: ev.side, price: ev.price, size: ev.size });
      }
    }
  };

  /** @type {WebSocket|null} */
  let ws = null;
  /** @type {NodeJS.Timeout|null} */
  let pingTimer = null;
  /** @type {NodeJS.Timeout|null} */
  let snapTimer = null;
  /** @type {NodeJS.Timeout|null} */
  let loopTimer = null;
  /** @type {NodeJS.Timeout|null} */
  let subscribeRetryTimer = null;

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

  let snapI = 0;
  let lastCycle = null;

  loopTimer = setInterval(() => {
    lastCycle = engine.cycle(nowMs());
  }, Math.max(250, opts.stepMs));

  snapTimer = setInterval(async () => {
    const t = nowMs();
    await atomicWriteJson(opts.outPath, {
      mode: "live",
      meta: { wsUrl: opts.wsUrl, assetId: resolved, market: opts.market, startedAt: new Date(t0).toISOString() },
      bootstrap,
      ws: { ...wsStats, readyState: ws ? ws.readyState : null },
      snapshot: engine.snapshot({ i: snapI, nowMs: t, lastCycle }),
      state: engine.stateFinal()
    });
    snapI += 1;
  }, opts.snapshotEveryMs);

  const shutdown = () => {
    if (pingTimer) clearInterval(pingTimer);
    if (snapTimer) clearInterval(snapTimer);
    if (loopTimer) clearInterval(loopTimer);
    if (subscribeRetryTimer) clearTimeout(subscribeRetryTimer);
    try {
      ws?.close();
    } catch {
      // ignore
    }
    setTimeout(() => process.exit(0), 50);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.mode !== "fixture" && opts.mode !== "live") {
    console.error("Usage: node scripts/run-paper-live.mjs --mode fixture|live [options]");
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

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
  });
}
