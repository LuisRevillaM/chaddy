import test from 'node:test';
import assert from 'node:assert/strict';

test('NR1 universe filters include required negRisk flags and exclude negRiskOther', () => {
  const events = [
    {
      negRisk: true,
      enableOrderBook: true,
      enableNegRisk: true,
      markets: [{ id: 'm1', negRiskOther: false }, { id: 'm2', negRiskOther: true }]
    },
    { negRisk: false, enableOrderBook: true, enableNegRisk: true, markets: [] }
  ];

  const tradable = events
    .filter((e) => e.negRisk && e.enableOrderBook && e.enableNegRisk)
    .flatMap((e) => e.markets)
    .filter((m) => !m.negRiskOther);

  assert.equal(tradable.length, 1);
  assert.equal(tradable[0].id, 'm1');
});
