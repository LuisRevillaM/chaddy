# M7: Shadow Mode Against Real Endpoints (No Trading)

## Goal

Connect to real market data to validate parsing/state handling without placing orders.

## Constraints

- Shadow mode must never place orders (even if misconfigured).
- Proof suites remain offline; real endpoint tests are opt-in.

## Deliverables

- A shadow-mode runner (CLI) that:
  - connects to market data
  - maintains books
  - computes desired orders
  - writes a periodic status snapshot to disk
- Integration test suite gated by env vars (not run by default).

## Proofs

- `npm run prove` still passes offline.
- Optional: `npm run prove -- --suite integration` passes when env vars are set.

