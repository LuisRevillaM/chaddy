import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { SimExchange } from "../../packages/sim/src/SimExchange.js";
import { runShadowRunner } from "../../packages/mm-core/src/runner/shadowRunner.js";
import { OrderTracker } from "../../packages/mm-core/src/state/orderTracker.js";
import { PositionTracker } from "../../packages/mm-core/src/state/positionTracker.js";
import { _resetIdsForTesting } from "../../packages/shared/src/ids.js";

test("sim: shadow runner writes deterministic status snapshot", async () => {
  _resetIdsForTesting();
  const ex = new SimExchange({ seed: 7, tickSize: 0.01, mid: 0.5, extSpread: 0.04 });

  const orders = new OrderTracker();
  const pos = new PositionTracker();
  ex.on("user", (msg) => {
    orders.applyUserEvent(msg);
    pos.applyUserEvent(msg);
  });

  // Seed a couple of passive orders so snapshots include stable live order state.
  ex.placeOrder({ side: "BUY", price: 0.1, size: 1 });
  ex.placeOrder({ side: "SELL", price: 0.9, size: 1 });

  const cfg = {
    market: "mkt_shadow",
    steps: 12,
    stepMs: 1_000,
    quoteCfg: {
      tickSize: ex.tickSize,
      halfSpread: 0.02,
      maxSpread: 0.1,
      minSize: 1,
      orderSize: 1,
      inventoryTarget: 10,
      maxSkew: 0.02
    },
    killSwitchCfg: { staleMarketDataMs: 5_000, staleUserDataMs: 10_000 }
  };

  const result = runShadowRunner(cfg, {
    step: () => ex.step(),
    getTopOfBook: () => ex.getTopOfBook(),
    getLiveOrders: () => orders.liveOrders(),
    getInventory: () => pos.position
  });

  assert.equal(result.history.length, cfg.steps);
  assert.equal(result.final.market, cfg.market);
  assert.ok(typeof result.final.midpoint === "number");
  assert.equal(result.final.liveOrders.length, 2);
  assert.ok(Array.isArray(result.final.desiredQuotes));
  assert.deepEqual(result.final.killSwitch, { cancelAll: false, reason: null });

  const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
  if (outDir) {
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, "shadow-status.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  }
});
