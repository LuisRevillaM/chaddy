import assert from "node:assert/strict";
import test from "node:test";

import { mulberry32 } from "../../packages/shared/src/rng.js";
import { roundDownToTick, roundUpToTick, isOnTick } from "../../packages/shared/src/math.js";
import { computeDesiredQuotes } from "../../packages/mm-core/src/strategy/computeDesiredQuotes.js";

test("computeDesiredQuotes property: always on tick, positive spread, within maxSpread", () => {
  const rng = mulberry32(42);
  for (let i = 0; i < 500; i++) {
    const tickSize = [0.001, 0.01, 0.05][Math.floor(rng() * 3)];

    // Ensure a non-crossed book.
    const mid = 0.05 + rng() * 0.9;
    const bestBid = roundDownToTick(mid - tickSize, tickSize);
    const bestAsk = roundUpToTick(mid + tickSize, tickSize);

    const halfSpread = tickSize * (1 + Math.floor(rng() * 10));
    const maxSpread = halfSpread * 2 + tickSize * (1 + Math.floor(rng() * 10));

    const inventoryTarget = 50 + Math.floor(rng() * 200);
    const inventory = Math.floor((rng() * 2 - 1) * inventoryTarget);

    const cfg = {
      tickSize,
      halfSpread,
      maxSpread,
      minSize: 1,
      orderSize: 1 + Math.floor(rng() * 20),
      inventoryTarget,
      maxSkew: tickSize * Math.floor(rng() * 10)
    };

    const q = computeDesiredQuotes(
      { bestBid: { price: bestBid, size: 100 }, bestAsk: { price: bestAsk, size: 100 }, inventory },
      cfg
    );
    assert.equal(q.length, 2);
    const bid = q.find((o) => o.side === "BUY");
    const ask = q.find((o) => o.side === "SELL");
    assert.ok(bid && ask);

    assert.ok(isOnTick(bid.price, tickSize), JSON.stringify({ bid: bid.price, tickSize }));
    assert.ok(isOnTick(ask.price, tickSize), JSON.stringify({ ask: ask.price, tickSize }));
    assert.ok(ask.price > bid.price, JSON.stringify({ bid: bid.price, ask: ask.price }));
    assert.ok(bid.price > 0 && bid.price < 1, JSON.stringify({ bid: bid.price }));
    assert.ok(ask.price > 0 && ask.price < 1, JSON.stringify({ ask: ask.price }));
    assert.ok(
      ask.price - bid.price <= maxSpread + 1e-9,
      JSON.stringify({ bid: bid.price, ask: ask.price, maxSpread, tickSize, cfg })
    );
    assert.ok(bid.size >= cfg.minSize);
    assert.ok(ask.size >= cfg.minSize);
  }
});
