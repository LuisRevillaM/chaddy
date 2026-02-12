import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOrderPolicy } from '../../packages/executor/src/policy.js';

test('NR5 executor policy allows bounded order and rejects out-of-policy order', () => {
  const policy = {
    allowedMarkets: ['m1'],
    maxOrderSize: 100,
    minOrderSize: 1,
    maxAbsNotional: 50,
    maxPriceBand: null
  };
  const good = validateOrderPolicy({ market: 'm1', side: 'BUY', price: 0.4, size: 10 }, policy, { midpoint: 0.4 });
  const bad = validateOrderPolicy({ market: 'm2', side: 'BUY', price: 0.4, size: 10 }, policy, { midpoint: 0.4 });
  assert.equal(good.ok, true);
  assert.equal(bad.ok, false);
});
