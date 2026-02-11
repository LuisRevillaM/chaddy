import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { buildLiveJournalScoring, pickBestOrdersBySide } from "../../scripts/lib/liveScoringJournal.js";

test("live journal scoring helpers: select best orders per side and build scoring payload", async () => {
  const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
  assert.ok(outDir, "PROVE_OUT_DIR must be set by the harness");

  const liveOrders = [
    { id: "buy_1", side: "BUY", price: 0.45, size: 5 },
    { id: "buy_2", side: "BUY", price: 0.47, size: 4 },
    { id: "sell_1", side: "SELL", price: 0.56, size: 2 },
    { id: "sell_2", side: "SELL", price: 0.54, size: 3 }
  ];

  const best = pickBestOrdersBySide(liveOrders);
  assert.equal(best.buy?.id, "buy_2");
  assert.equal(best.sell?.id, "sell_2");

  const calls = [];
  const scoringClient = {
    async checkOrderScoring(orderId) {
      calls.push(orderId);
      if (orderId === "buy_2") return { ok: true, scoring: true, reason: "ok" };
      if (orderId === "sell_2") return { ok: true, scoring: false, reason: "not_scoring" };
      return { ok: false, scoring: null, reason: "unknown_order" };
    }
  };

  const scoringEnabled = await buildLiveJournalScoring({ enabled: true, scoringClient, liveOrders });
  assert.deepEqual(scoringEnabled, {
    buy: { scoring: true, reason: "ok" },
    sell: { scoring: false, reason: "not_scoring" }
  });
  assert.deepEqual(calls, ["buy_2", "sell_2"]);

  const scoringDisabled = await buildLiveJournalScoring({ enabled: false, scoringClient, liveOrders });
  assert.equal(scoringDisabled, null);

  await fs.writeFile(
    path.join(outDir, "live-scoring-journal.json"),
    JSON.stringify(
      {
        ok: true,
        best,
        scoringEnabled,
        scoringDisabled
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
});

