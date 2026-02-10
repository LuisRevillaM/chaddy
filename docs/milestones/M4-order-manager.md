# M4: Order Manager (Diff + Anti-Churn)

## Goal

Convert desired orders into safe trading actions with bounded churn.

## Constraints

- Must avoid churn storms:
  - rate limiting / token bucket
  - minimum update interval per market
  - idempotent diffs
- Must have a kill switch path that cancels all on stale feeds.

## Deliverables

- Order diff algorithm(s) in `packages/mm-core/src/orderManager/`:
  - minimal cancel/place deltas
  - bounded operations per cycle
- Anti-churn policy integrated and proven in simulation.

## Proofs

- `npm run prove -- --suite unit,sim,security` passes.
- `sim` suite writes:
  - churn metrics summary (orders placed/canceled) under `artifacts/proofs/latest/suite/sim/`.

