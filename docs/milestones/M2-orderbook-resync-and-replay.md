# M2: Orderbook Resync + Replay Harness

## Goal

Make market data handling robust by construction:

- detect sequence gaps
- resync from a fresh snapshot
- prove correctness via deterministic replays

## Constraints

- Must handle reconnect/resubscribe without silent book drift.
- Must fail fast on non-contiguous sequence numbers unless a resync occurs.

## Deliverables

- Orderbook module(s) that:
  - apply snapshots and deltas
  - detect gaps
  - expose a "needsResync" signal (or throws a typed error) that the caller can act on
- Replay fixtures format (JSON) and tests that:
  - include a forced gap
  - assert resync behavior

## Proofs

- `npm run prove -- --suite replay,unit,security` passes.
- `replay` suite writes at least:
  - `artifacts/proofs/latest/suite/replay/orderbook-final.json`
  - (optional) `.../replay-trace.jsonl` (event-by-event state)

## Notes

Keep replay files small and readable; they double as documentation.

