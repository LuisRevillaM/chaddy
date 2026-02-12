import test from 'node:test';
import assert from 'node:assert/strict';
import { killSwitchDecision } from '../../packages/mm-core/src/controls/killSwitch.js';

test('NR8 kill switch cancels on stale market data', () => {
  const d = killSwitchDecision(
    { nowMs: 10_000, lastMarketDataMs: 1_000, lastUserDataMs: 9_500 },
    { staleMarketDataMs: 5_000, staleUserDataMs: 5_000 }
  );
  assert.equal(d.cancelAll, true);
});
