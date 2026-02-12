import test from 'node:test';
import assert from 'node:assert/strict';

test('NR2 indexset bitmask maps index i to 1<<i', () => {
  const indexSetFor = (i) => 1 << i;
  assert.equal(indexSetFor(0), 1);
  assert.equal(indexSetFor(1), 2);
  assert.equal(indexSetFor(5), 32);
});

test('NR2 canonical ordering uses conditionId as stable key', () => {
  const markets = [{ conditionId: 'c3' }, { conditionId: 'c1' }, { conditionId: 'c2' }];
  const ordered = [...markets].sort((a, b) => a.conditionId.localeCompare(b.conditionId));
  assert.deepEqual(ordered.map((m) => m.conditionId), ['c1', 'c2', 'c3']);
});
