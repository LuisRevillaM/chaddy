import assert from "node:assert/strict";
import test from "node:test";

import { computeDesiredQuotes } from "../../packages/mm-core/src/strategy/computeDesiredQuotes.js";
import { isOnTick } from "../../packages/shared/src/math.js";

test("computeDesiredQuotes: outputs 2-sided quotes within constraints", () => {
  const cfg = {
    tickSize: 0.01,
    halfSpread: 0.02,
    maxSpread: 0.10,
    minSize: 10,
    orderSize: 25,
    inventoryTarget: 100,
    maxSkew: 0.02
  };
  const state = {
    bestBid: { price: 0.48, size: 100 },
    bestAsk: { price: 0.52, size: 100 },
    inventory: 0
  };

  const q = computeDesiredQuotes(state, cfg);
  assert.equal(q.length, 2);
  const bid = q.find((o) => o.side === "BUY");
  const ask = q.find((o) => o.side === "SELL");
  assert.ok(bid && ask);

  assert.ok(isOnTick(bid.price, cfg.tickSize));
  assert.ok(isOnTick(ask.price, cfg.tickSize));
  assert.ok(ask.price > bid.price);
  assert.ok(ask.price - bid.price <= cfg.maxSpread + 1e-9);
  assert.ok(bid.size >= cfg.minSize);
  assert.ok(ask.size >= cfg.minSize);
});

test("computeDesiredQuotes: positive inventory skews quotes down (more eager to sell)", () => {
  const cfg = {
    tickSize: 0.01,
    halfSpread: 0.02,
    maxSpread: 0.10,
    minSize: 1,
    orderSize: 5,
    inventoryTarget: 100,
    maxSkew: 0.02
  };
  const base = computeDesiredQuotes(
    { bestBid: { price: 0.48, size: 1 }, bestAsk: { price: 0.52, size: 1 }, inventory: 0 },
    cfg
  );
  const skewed = computeDesiredQuotes(
    { bestBid: { price: 0.48, size: 1 }, bestAsk: { price: 0.52, size: 1 }, inventory: 100 },
    cfg
  );

  const baseAsk = base.find((o) => o.side === "SELL").price;
  const skewAsk = skewed.find((o) => o.side === "SELL").price;
  assert.ok(skewAsk <= baseAsk, JSON.stringify({ baseAsk, skewAsk }));
});

test("computeDesiredQuotes: clamps quotes into (0,1) even when midpoint is near 0", () => {
  const cfg = {
    tickSize: 0.001,
    halfSpread: 0.02,
    maxSpread: 0.1,
    minSize: 1,
    orderSize: 1,
    inventoryTarget: 10,
    maxSkew: 0.02
  };
  const state = {
    bestBid: { price: 0.008, size: 100 },
    bestAsk: { price: 0.009, size: 100 },
    inventory: 0
  };

  const q = computeDesiredQuotes(state, cfg);
  const bid = q.find((o) => o.side === "BUY");
  const ask = q.find((o) => o.side === "SELL");
  assert.ok(bid && ask);

  assert.ok(bid.price > 0 && bid.price < 1, JSON.stringify({ bid: bid.price }));
  assert.ok(ask.price > 0 && ask.price < 1, JSON.stringify({ ask: ask.price }));
  assert.ok(bid.price >= cfg.tickSize, JSON.stringify({ bid: bid.price, tickSize: cfg.tickSize }));
  assert.ok(ask.price <= 1 - cfg.tickSize + 1e-12, JSON.stringify({ ask: ask.price, tickSize: cfg.tickSize }));
});

test("computeDesiredQuotes: clamps quotes into (0,1) even when midpoint is near 1", () => {
  const cfg = {
    tickSize: 0.001,
    halfSpread: 0.02,
    maxSpread: 0.1,
    minSize: 1,
    orderSize: 1,
    inventoryTarget: 10,
    maxSkew: 0.02
  };
  const state = {
    bestBid: { price: 0.991, size: 100 },
    bestAsk: { price: 0.992, size: 100 },
    inventory: 0
  };

  const q = computeDesiredQuotes(state, cfg);
  const bid = q.find((o) => o.side === "BUY");
  const ask = q.find((o) => o.side === "SELL");
  assert.ok(bid && ask);

  assert.ok(bid.price > 0 && bid.price < 1, JSON.stringify({ bid: bid.price }));
  assert.ok(ask.price > 0 && ask.price < 1, JSON.stringify({ ask: ask.price }));
  assert.ok(bid.price >= cfg.tickSize, JSON.stringify({ bid: bid.price, tickSize: cfg.tickSize }));
  assert.ok(ask.price <= 1 - cfg.tickSize + 1e-12, JSON.stringify({ ask: ask.price, tickSize: cfg.tickSize }));
});
