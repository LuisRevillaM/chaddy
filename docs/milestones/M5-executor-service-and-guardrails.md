# M5: Executor Boundary (Guardrails + Key Isolation)

## Goal

Make it impossible for agents/LLMs/UI to place arbitrary orders.

## Constraints

- Only `packages/executor/` may contain code that can trade.
- Executor must enforce:
  - geoblock gating (refuse to trade when blocked)
  - allowed markets
  - size bounds
  - notional caps
  - (optional) price bands
- mm-core must not import executor implementation details (boundary enforced by security scan).

## Deliverables

- Executor policy module(s) + tests for each rejection reason.
- A narrow executor interface that is hard to misuse.
- Security harness keeps boundary rules enforced.

## Proofs

- `npm run prove -- --suite sim,unit,security` passes.
- `sim` suite includes tests proving:
  - geoblock denies trading when `GEO_ALLOWED!=1`
  - policy rejects out-of-bounds orders

