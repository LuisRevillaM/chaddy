# Repo Blueprint

This blueprint exists so agents don't invent inconsistent structure.

## Top-level layout

- `packages/shared/`
  - shared utils and message/type definitions
  - must not import other packages (enforced)
- `packages/mm-core/`
  - deterministic market making logic (orderbook, strategy, order manager, kill switch)
  - may import only `shared` (enforced)
- `packages/executor/`
  - the only trading capability boundary (keys/creds later)
  - may import only `shared` (enforced)
- `packages/sim/`
  - deterministic simulator used by proof suites
  - may import only `shared` (enforced)
- `scripts/`
  - proof harness and repo safety checks
- `tests/<suite>/`
  - proof suites:
    - `unit`, `replay`, `sim`, `soak`, `integration` (opt-in), etc.
- `artifacts/` (generated)
  - proof reports, suite logs, and debugging artifacts

## The boundary that matters

`mm-core` must be able to say: "I want these orders live."

It must not be able to:

- sign anything
- touch keys
- talk directly to external trading endpoints

Only `executor` is allowed to have those capabilities.

## Proof gate

The repo is intended to be changed by agents. Therefore:

- if it isn't proven, it isn't trusted
- `npm run prove` is the gate for every milestone

See `docs/proofs.md`.

