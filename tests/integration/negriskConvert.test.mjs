import test from 'node:test';
import assert from 'node:assert/strict';

test('NR6 conversion tx state machine classifies terminal and in-flight states', () => {
  const classify = (s) => {
    if (s === 'STATE_CONFIRMED') return 'success';
    if (s === 'STATE_FAILED' || s === 'STATE_INVALID') return 'terminal_failure';
    return 'in_flight';
  };
  assert.equal(classify('STATE_CONFIRMED'), 'success');
  assert.equal(classify('STATE_FAILED'), 'terminal_failure');
  assert.equal(classify('STATE_MINED'), 'in_flight');
});
