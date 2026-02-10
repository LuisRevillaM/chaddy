import assert from "node:assert/strict";
import test from "node:test";

import { killSwitchDecision } from "../../packages/mm-core/src/controls/killSwitch.js";

test("killSwitchDecision: cancels when market data is stale", () => {
  const cfg = { staleMarketDataMs: 5_000, staleUserDataMs: 10_000 };
  const d = killSwitchDecision(
    {
      nowMs: 100_000,
      lastMarketDataMs: 90_000,
      lastUserDataMs: 99_000
    },
    cfg
  );
  assert.equal(d.cancelAll, true);
  assert.equal(d.reason, "stale_market_data");
});

