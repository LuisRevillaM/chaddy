import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyConversionState } from '../../packages/mm-core/src/strategy/negriskConvert.js';

test('NR6 conversion tx state machine classifies terminal and in-flight states', () => {
  assert.equal(classifyConversionState('STATE_CONFIRMED'), 'success');
  assert.equal(classifyConversionState('STATE_FAILED'), 'terminal_failure');
  assert.equal(classifyConversionState('STATE_MINED'), 'in_flight');
});
