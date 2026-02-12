import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateNegRiskEdgePerShare,
  sizeByDepthAndRisk
} from '../../packages/mm-core/src/strategy/negriskOpportunity.js';

test('estimateNegRiskEdgePerShare computes fee-adjusted edge', () => {
  const edge = estimateNegRiskEdgePerShare({
    buyNoAsk: 0.31,
    otherYesBids: [0.12, 0.11, 0.105],
    feeBips: 20
  });
  assert.ok(edge > 0);
});

test('estimateNegRiskEdgePerShare returns null for invalid input', () => {
  assert.equal(estimateNegRiskEdgePerShare({ buyNoAsk: -1, otherYesBids: [0.1] }), null);
  assert.equal(estimateNegRiskEdgePerShare({ buyNoAsk: 0.2, otherYesBids: [] }), null);
});

test('sizeByDepthAndRisk caps size by shallowest leg and risk cap', () => {
  const q = sizeByDepthAndRisk({
    noAskSize: 300,
    otherYesBidSizes: [120, 80, 200],
    maxSharesByRisk: 100
  });
  assert.equal(q, 80);
});
