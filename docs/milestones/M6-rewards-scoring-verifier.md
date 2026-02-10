# M6: Rewards Scoring Verifier (Proof of Eligibility)

## Goal

Never "think" you're earning rewards without verifying it.

## Constraints

- Scoring checks must be explicit and observable.
- The system must surface a clear "scoring OK / not OK" state per order/market.

## Deliverables

- Scoring verifier module:
  - local mock implementation for proof suites
  - real implementation behind configuration/env gating for live runs
- Control loop behavior when scoring fails:
  - adjust quotes or pause market (configurable)

## Proofs

- `npm run prove -- --suite unit,sim,security` passes.
- `sim` suite includes mock scoring server behavior with assertions.

