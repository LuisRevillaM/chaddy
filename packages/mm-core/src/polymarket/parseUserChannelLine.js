// @ts-check

/**
 * Parse a single JSONL line from the Polymarket *user channel* into internal user events.
 *
 * Parsers must be total: return either `{ ok: true, events: [...] }` or `{ ok: false, error: {...} }`.
 */

/**
 * @typedef {"BUY"|"SELL"} Side
 *
 * @typedef {{
 *  type: "order_open",
 *  orderId: string,
 *  side: Side,
 *  price: number,
 *  size: number,
 *  meta: Record<string, unknown>
 * } | {
 *  type: "fill",
 *  orderId: string,
 *  side: Side,
 *  price: number,
 *  size: number,
 *  meta: Record<string, unknown>
 * } | {
 *  type: "order_canceled" | "order_closed",
 *  orderId: string,
 *  meta: Record<string, unknown>
 * }} InternalUserEvent
 */

/**
 * @param {string} line
 * @returns {{ ok: true, events: InternalUserEvent[] } | { ok: false, error: { code: string, message: string, details?: Record<string, unknown> } }}
 */
export function parsePolymarketUserChannelLine(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return { ok: false, error: { code: "empty_line", message: "Empty line" } };

  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch (e) {
    return { ok: false, error: { code: "invalid_json", message: "Invalid JSON", details: { error: String(e?.message || e) } } };
  }

  const eventType = obj?.event_type;

  if (eventType === "order") {
    const kind = obj?.type;
    const id = obj?.id;
    if (typeof id !== "string" || !id) {
      return { ok: false, error: { code: "invalid_shape", message: "order message must include id", details: { id } } };
    }

    if (kind === "PLACEMENT") {
      const side = obj?.side;
      const price = Number(obj?.price);
      const size = Number(obj?.original_size);
      if ((side !== "BUY" && side !== "SELL") || !Number.isFinite(price) || !(size > 0)) {
        return { ok: false, error: { code: "invalid_shape", message: "PLACEMENT must include side, price, original_size", details: { side, price: obj?.price, original_size: obj?.original_size } } };
      }
      return {
        ok: true,
        events: [
          {
            type: "order_open",
            orderId: id,
            side,
            price,
            size,
            meta: { event_type: obj.event_type, type: obj.type, market: obj.market, asset_id: obj.asset_id, owner: obj.owner, timestamp: obj.timestamp }
          }
        ]
      };
    }

    if (kind === "CANCELLATION") {
      return {
        ok: true,
        events: [
          {
            type: "order_canceled",
            orderId: id,
            meta: { event_type: obj.event_type, type: obj.type, market: obj.market, asset_id: obj.asset_id, owner: obj.owner, timestamp: obj.timestamp }
          }
        ]
      };
    }

    if (kind === "UPDATE") {
      // For this proof harness, treat UPDATE as a matched-size "fill" hint when present.
      // WARNING: size_matched is cumulative in many APIs; fixtures should keep UPDATE usage unambiguous.
      const side = obj?.side;
      const price = Number(obj?.price);
      const sizeMatched = Number(obj?.size_matched);
      const originalSize = Number(obj?.original_size);
      if ((side !== "BUY" && side !== "SELL") || !Number.isFinite(price) || !(sizeMatched >= 0) || !(originalSize > 0)) {
        return {
          ok: false,
          error: {
            code: "invalid_shape",
            message: "UPDATE must include side, price, original_size, size_matched",
            details: { side, price: obj?.price, original_size: obj?.original_size, size_matched: obj?.size_matched }
          }
        };
      }
      /** @type {InternalUserEvent[]} */
      const events = [];
      if (sizeMatched > 0) {
        events.push({
          type: "fill",
          orderId: id,
          side,
          price,
          size: sizeMatched,
          meta: { event_type: obj.event_type, type: obj.type, market: obj.market, asset_id: obj.asset_id, owner: obj.owner, timestamp: obj.timestamp }
        });
        if (sizeMatched >= originalSize) {
          events.push({
            type: "order_closed",
            orderId: id,
            meta: { event_type: obj.event_type, type: obj.type, market: obj.market, asset_id: obj.asset_id, owner: obj.owner, timestamp: obj.timestamp }
          });
        }
      }
      return { ok: true, events };
    }

    return {
      ok: false,
      error: { code: "unsupported_order_type", message: `Unsupported order type: ${String(kind)}`, details: { type: kind } }
    };
  }

  if (eventType === "trade") {
    // Convert maker order matches into internal fills, assuming maker side is opposite the taker side.
    const side = obj?.side;
    const takerSide = side === "BUY" || side === "SELL" ? side : null;
    if (!takerSide) {
      return { ok: false, error: { code: "invalid_shape", message: "trade message must include side BUY/SELL", details: { side } } };
    }
    const makerSide = takerSide === "BUY" ? "SELL" : "BUY";

    const makerOrders = Array.isArray(obj?.maker_orders) ? obj.maker_orders : null;
    if (!makerOrders || makerOrders.length === 0) {
      return { ok: false, error: { code: "invalid_shape", message: "trade message must include maker_orders[]", details: { have: Object.keys(obj || {}) } } };
    }

    /** @type {InternalUserEvent[]} */
    const events = [];
    for (const m of makerOrders) {
      const orderId = m?.order_id;
      const price = Number(m?.price ?? obj?.price);
      const size = Number(m?.matched_amount ?? obj?.size);
      if (typeof orderId !== "string" || !orderId || !Number.isFinite(price) || !(size > 0)) {
        return { ok: false, error: { code: "invalid_shape", message: "maker_order must include order_id, price, matched_amount", details: { maker_order: m } } };
      }
      events.push({
        type: "fill",
        orderId,
        side: makerSide,
        price,
        size,
        meta: { event_type: obj.event_type, type: obj.type, market: obj.market, asset_id: obj.asset_id, timestamp: obj.timestamp, trade_id: obj.id }
      });
      events.push({
        type: "order_closed",
        orderId,
        meta: { event_type: obj.event_type, type: obj.type, market: obj.market, asset_id: obj.asset_id, timestamp: obj.timestamp, trade_id: obj.id }
      });
    }

    return { ok: true, events };
  }

  return {
    ok: false,
    error: {
      code: "unsupported_event_type",
      message: `Unsupported event_type: ${String(eventType)}`,
      details: { event_type: eventType }
    }
  };
}

