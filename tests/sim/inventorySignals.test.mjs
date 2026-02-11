import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { computeInventorySignals } from "../../packages/mm-core/src/state/inventorySignals.js";
import { PositionTracker } from "../../packages/mm-core/src/state/positionTracker.js";
import { SimExchange } from "../../packages/sim/src/SimExchange.js";
import { _resetIdsForTesting } from "../../packages/shared/src/ids.js";

test("sim: inventory signals expose deterministic inventory pressure snapshots", async () => {
  const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
  assert.ok(outDir, "PROVE_OUT_DIR must be set by the harness");

  _resetIdsForTesting();
  const ex = new SimExchange({ seed: 41, tickSize: 0.01, mid: 0.5, extSpread: 0.04 });
  const pos = new PositionTracker();
  ex.on("user", (msg) => pos.applyUserEvent(msg));

  // Force a BUY fill to move position above target.
  ex.placeOrder({ side: "BUY", price: 1, size: 3 });
  ex.step();
  const afterBuy = {
    position: pos.position,
    signal: computeInventorySignals({ position: pos.position, target: 2 })
  };
  assert.equal(afterBuy.signal.ok, true);
  assert.equal(afterBuy.signal.needsSell, true);

  // Force a SELL fill to move position below negative target.
  ex.placeOrder({ side: "SELL", price: 0.01, size: 7 });
  ex.step();
  const afterSell = {
    position: pos.position,
    signal: computeInventorySignals({ position: pos.position, target: 2 })
  };
  assert.equal(afterSell.signal.ok, true);
  assert.equal(afterSell.signal.needsBuy, true);

  const balanced = computeInventorySignals({ position: 0, target: 2 });
  assert.deepEqual(balanced, { ok: true, needsBuy: false, needsSell: false, note: "within_target_band" });

  const artifact = {
    ok: true,
    target: 2,
    snapshots: {
      afterBuy,
      afterSell,
      balanced: { position: 0, signal: balanced }
    },
    final: {
      position: pos.position,
      signal: computeInventorySignals({ position: pos.position, target: 2 })
    }
  };

  await fs.writeFile(path.join(outDir, "inventory-signals.json"), JSON.stringify(artifact, null, 2) + "\n", "utf8");
});

