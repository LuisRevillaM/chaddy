# Proof Harness

The proof harness is the gating system agents must satisfy.

## Run

```bash
npm run prove
```

Outputs:

- `artifacts/proofs/latest/report.md` (human readable)
- `artifacts/proofs/latest/results.json` (machine readable)
- `artifacts/proofs/latest/logs/<suite>.log` (raw logs)
- `artifacts/proofs/latest/suite/<suite>/...` (suite-specific artifacts)

## Suites

- `unit`
  - Fast, deterministic unit tests for pure logic: orderbook, quoting, diffing, kill-switch.
- `replay`
  - Deterministic playback tests: apply known market data events and assert state.
  - Writes final state snapshots to `artifacts/proofs/latest/suite/replay/`.
- `sim`
  - Deterministic simulation tests: basic market data generation, fills, and executor guardrails.
  - Writes sim summaries to `artifacts/proofs/latest/suite/sim/`.
- `security`
  - Secret scanning (prevent committing keys/tokens).
  - Enforces package boundary rules to prevent key leakage / unsafe coupling.
- `soak` (only when `PROVE_SLOW=1` or `--slow`)
  - Longer deterministic runs to catch churn/memory regressions.

## Debugging

1. Open `artifacts/proofs/latest/report.md` to see which suite failed.
2. Open the suite log in `artifacts/proofs/latest/logs/`.
3. Inspect suite artifacts in `artifacts/proofs/latest/suite/<suite>/`.

