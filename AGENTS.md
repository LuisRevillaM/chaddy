# Agent Operating Rules (This Repo)

This repo is designed for agent-driven development. Your output is only trusted if it is **provably correct** under the local proof harness.

## The only definition of "done"

- `npm run prove` exits `0`
- Artifacts exist under `artifacts/proofs/latest/` and explain what ran and what passed/failed.

If you change behavior, you must add or update proofs so regressions are caught automatically.

## Hard constraints (must never be violated)

- Do not bypass or weaken Polymarket geographic restrictions. The system must refuse to trade if blocked.
- Do not grant LLMs/agents direct access to signing keys or trading credentials.
  - Keys (when added) must live only inside `packages/executor/`.
- Do not remove or loosen executor guardrails (allowed markets, max size/notional, price bands) without adding stronger proofs.

## Architecture boundaries (enforced by `npm run prove` security scan)

- `packages/shared/` must not import other packages.
- `packages/mm-core/` may import only `packages/shared/`.
- `packages/sim/` may import only `packages/shared/`.
- `packages/executor/` may import only `packages/shared/`.

If you need a new shared type/util, put it in `packages/shared/`.

## What to write when you finish a task

- What changed (1-3 bullets)
- Proofs run and their outcome
- Where the artifacts are (`artifacts/proofs/latest/report.md`)

