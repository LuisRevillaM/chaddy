import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { selectMarkets } from "../../packages/mm-core/src/selection/selectMarkets.js";

test("selectMarkets: ranks Gamma-like markets deterministically with breakdown", async () => {
  const fixturePath = path.join(process.cwd(), "tests", "unit", "fixtures", "gamma-markets.json");
  const fixtureText = await fs.readFile(fixturePath, "utf8");
  const fixture = JSON.parse(fixtureText);

  /** @type {any[]} */
  const markets = fixture.markets;
  const weights = { reward: 0.4, volume: 0.3, liquidity: 0.2, spread: 0.1 };

  const ranked = selectMarkets(markets, { weights });

  assert.deepEqual(
    ranked.map((r) => r.id),
    ["mkt_bravo", "mkt_alpha", "mkt_charlie", "mkt_inactive"]
  );
  assert.equal(ranked[0].eligible, true);
  assert.equal(ranked.at(-1)?.eligible, false);
  assert.deepEqual(ranked.at(-1)?.reasons, ["inactive"]);
  assert.ok(ranked[0].breakdown?.normalized);

  const outDir = process.env.PROVE_OUT_DIR ? path.resolve(process.env.PROVE_OUT_DIR) : null;
  if (outDir) {
    await fs.mkdir(outDir, { recursive: true });
    const inputsSummary = markets.map((m) => ({
      id: m.id,
      active: m.active,
      closed: m.closed,
      liquidityUsd: m.liquidityUsd,
      volume24hUsd: m.volume24hUsd,
      rewardPoolUsd: m.rewardPoolUsd,
      spreadBps: m.spreadBps
    }));
    const artifact = {
      inputs: {
        fixture: path.relative(process.cwd(), fixturePath),
        markets: inputsSummary,
        config: { weights, ineligiblePenalty: weights.reward + weights.volume + weights.liquidity + weights.spread + 1 }
      },
      ranked
    };
    await fs.writeFile(path.join(outDir, "market-selection.json"), JSON.stringify(artifact, null, 2) + "\n", "utf8");
  }
});

