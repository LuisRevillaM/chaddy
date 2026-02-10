# M3: Strategy Engine (Deterministic, Pure)

## Goal

Compute desired quotes as a pure function of state + config.

## Constraints

- The quoting function must be deterministic and side-effect free.
- It must not call network, touch disk, or depend on timers.
- It must enforce: tick size, max spread, min size, inventory skew bounds.

## Deliverables

- Strategy module(s) in `packages/mm-core/src/strategy/`:
  - `computeDesiredQuotes(...)` stays pure
  - property tests cover hundreds of random scenarios deterministically
- Config schema for quoting parameters (even if minimal initially).

## Proofs

- `npm run prove -- --suite unit,security` passes.
- Property tests exist and are stable (seeded RNG).

