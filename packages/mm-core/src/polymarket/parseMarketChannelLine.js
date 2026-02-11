// @ts-check

/**
 * Parse a single JSONL line from the Polymarket *market channel* into internal market events.
 *
 * Parsers must be total: return either `{ ok: true, events: [...] }` or `{ ok: false, error: {...} }`.
 */

/**
 * @typedef {{
 *  kind: "snapshot",
 *  bids: Array<[number, number]>,
 *  asks: Array<[number, number]>,
 *  meta: Record<string, unknown>
 * } | {
 *  kind: "delta",
 *  side: "bid"|"ask",
 *  price: number,
 *  size: number,
 *  meta: Record<string, unknown>
 * }} InternalMarketEvent
 */

/**
 * @param {string} line
 * @returns {{ ok: true, events: InternalMarketEvent[] } | { ok: false, error: { code: string, message: string, details?: Record<string, unknown> } }}
 */
export function parsePolymarketMarketChannelLine(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return { ok: false, error: { code: "empty_line", message: "Empty line" } };

  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch (e) {
    return { ok: false, error: { code: "invalid_json", message: "Invalid JSON", details: { error: String(e?.message || e) } } };
  }

  if (Array.isArray(obj)) {
    /** @type {InternalMarketEvent[]} */
    const events = [];
    for (let i = 0; i < obj.length; i++) {
      const parsed = parseSingleMarketPayload(obj[i]);
      if (!parsed.ok) {
        return {
          ok: false,
          error: {
            code: parsed.error.code,
            message: parsed.error.message,
            details: { ...(parsed.error.details || {}), envelope: "array", index: i }
          }
        };
      }
      events.push(...parsed.events);
    }
    return { ok: true, events };
  }

  return parseSingleMarketPayload(obj);
}

/**
 * @param {unknown} obj
 * @returns {{ ok: true, events: InternalMarketEvent[] } | { ok: false, error: { code: string, message: string, details?: Record<string, unknown> } }}
 */
function parseSingleMarketPayload(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return {
      ok: false,
      error: {
        code: "invalid_shape",
        message: "market payload must be a JSON object",
        details: { type: Array.isArray(obj) ? "array" : typeof obj }
      }
    };
  }

  const eventType = obj?.event_type ?? obj?.type ?? null;

  // Snapshot messages are identified by the presence of bids[] and asks[], regardless of event_type.
  // Some environments / routes omit or rename event_type, so we parse by shape to be robust.
  if (
    eventType === "book" ||
    (Array.isArray(obj?.bids) && Array.isArray(obj?.asks)) ||
    (Array.isArray(obj?.buys) && Array.isArray(obj?.sells))
  ) {
    // Docs/examples have used both `bids/asks` and `buys/sells` for the snapshot shape.
    const bids = Array.isArray(obj.bids) ? obj.bids : Array.isArray(obj.buys) ? obj.buys : null;
    const asks = Array.isArray(obj.asks) ? obj.asks : Array.isArray(obj.sells) ? obj.sells : null;
    if (!bids || !asks) {
      return {
        ok: false,
        error: {
          code: "invalid_shape",
          message: "book message must include bids[] and asks[] (or buys[] and sells[])",
          details: { have: Object.keys(obj || {}) }
        }
      };
    }
    return {
      ok: true,
      events: [
        {
          kind: "snapshot",
          bids: parseLevels(bids),
          asks: parseLevels(asks),
          meta: {
            event_type: eventType,
            asset_id: obj.asset_id,
            market: obj.market,
            timestamp: obj.timestamp,
            hash: obj.hash
          }
        }
      ]
    };
  }

  // Delta messages are identified by the presence of price_changes[], regardless of event_type.
  if (eventType === "price_change" || Array.isArray(obj?.price_changes)) {
    const pcs = Array.isArray(obj.price_changes) ? obj.price_changes : null;
    if (!pcs) {
      return {
        ok: false,
        error: { code: "invalid_shape", message: "price_change message must include price_changes[]", details: { have: Object.keys(obj || {}) } }
      };
    }
    /** @type {InternalMarketEvent[]} */
    const events = [];
    for (const ch of pcs) {
      const side = ch?.side === "BUY" ? "bid" : ch?.side === "SELL" ? "ask" : null;
      const price = Number(ch?.price);
      const size = Number(ch?.size);
      if (!side || !Number.isFinite(price) || !Number.isFinite(size)) {
        return {
          ok: false,
          error: {
            code: "invalid_shape",
            message: "price_change entry must include side BUY/SELL and numeric price/size",
            details: { entry: ch }
          }
        };
      }
      events.push({
        kind: "delta",
        side,
        price,
        size,
        meta: {
          event_type: eventType,
          asset_id: ch.asset_id,
          market: obj.market,
          timestamp: obj.timestamp,
          hash: ch.hash,
          best_bid: ch.best_bid,
          best_ask: ch.best_ask
        }
      });
    }
    return { ok: true, events };
  }

  // Some routes can optionally emit best-bid-ask messages (top-of-book only).
  // Treat this as a degenerate snapshot so we can compute a midpoint without needing full depth.
  if (eventType === "best_bid_ask") {
    const bb = obj?.best_bid ?? obj?.bestBid ?? null;
    const ba = obj?.best_ask ?? obj?.bestAsk ?? null;

    const bidPrice = Number(typeof bb === "object" && bb != null ? bb.price : bb);
    const askPrice = Number(typeof ba === "object" && ba != null ? ba.price : ba);

    const bidSize = Number(typeof bb === "object" && bb != null ? bb.size : obj?.best_bid_size ?? 1);
    const askSize = Number(typeof ba === "object" && ba != null ? ba.size : obj?.best_ask_size ?? 1);

    if (!Number.isFinite(bidPrice) || !Number.isFinite(askPrice)) {
      return {
        ok: false,
        error: {
          code: "invalid_shape",
          message: "best_bid_ask message must include best_bid and best_ask (as numbers or {price,size})",
          details: { have: Object.keys(obj || {}) }
        }
      };
    }

    return {
      ok: true,
      events: [
        {
          kind: "snapshot",
          bids: Number.isFinite(bidSize) && bidSize > 0 ? [[bidPrice, bidSize]] : [[bidPrice, 1]],
          asks: Number.isFinite(askSize) && askSize > 0 ? [[askPrice, askSize]] : [[askPrice, 1]],
          meta: {
            event_type: eventType,
            asset_id: obj.asset_id,
            market: obj.market,
            timestamp: obj.timestamp,
            hash: obj.hash
          }
        }
      ]
    };
  }

  return {
    ok: false,
    error: {
      code: "unsupported_event_type",
      message: `Unsupported event_type: ${String(eventType)}`,
      details: { event_type: eventType, have: Object.keys(obj || {}) }
    }
  };
}

/**
 * @param {unknown[]} levels
 * @returns {Array<[number, number]>}
 */
function parseLevels(levels) {
  /** @type {Array<[number, number]>} */
  const out = [];
  for (const lvl of levels) {
    const p = Array.isArray(lvl) ? Number(lvl[0]) : Number(lvl?.price);
    const s = Array.isArray(lvl) ? Number(lvl[1]) : Number(lvl?.size);
    if (!Number.isFinite(p) || !Number.isFinite(s)) continue;
    if (s <= 0) continue;
    out.push([p, s]);
  }
  return out;
}
