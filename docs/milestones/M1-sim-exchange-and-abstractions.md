# M1: Sim Exchange + Core Abstractions

## Goal

Enable deterministic development without relying on external endpoints.

## Constraints

- Deterministic: all simulations must be seedable and reproducible.
- No external network needed for any proof suite.

## Deliverables

- `SimExchange` (in `packages/sim/`) capable of:
  - emitting deterministic market snapshots
  - accepting/canceling orders
  - emitting deterministic user fill events
- Minimal interfaces/types in `packages/shared/` for:
  - order requests
  - market data events
  - user events

## Proofs

- `npm run prove -- --suite unit,replay,sim,security` passes.
- `sim` suite writes a compact summary artifact under `artifacts/proofs/latest/suite/sim/`.

