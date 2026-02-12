import test from 'node:test';
import assert from 'node:assert/strict';
import { computeInventorySignals } from '../../packages/mm-core/src/state/inventorySignals.js';

test('NR7 inventory signal indicates buy when below band', () => {
  const s = computeInventorySignals({ position: -20, target: 10 });
  assert.equal(s.ok, true);
  assert.equal(s.needsBuy, true);
});
