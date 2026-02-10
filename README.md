# Proof-Driven Liquidity Rewards MM Bot (Scaffold)

This repo is a scaffold for building a liquidity-rewards-focused market maker with **agent-driven development**. The primary interface is a single verification harness:

- `npm run prove`

It runs deterministic proof suites and writes human + machine readable artifacts under:

- `artifacts/proofs/latest/`

## Why this exists

This project is meant to be built mostly by agents. That only works if:

- constraints are explicit (what must never happen),
- proofs are executable (what must pass),
- artifacts are inspectable (what happened, why it failed).

## Quick start

```bash
npm run prove
```

## Docs

- `docs/polymarket-liquidity-rewards-mm.md` (concept + architecture notes)
- `docs/mm-bot-build-plan.md` (milestones + proof strategy)
- `docs/end-to-end-delivery-plan.md` (end-to-end delivery plan + operator logistics)
- `docs/proofs.md` (proof suites + artifacts)
- `AGENTS.md` (hard constraints for agents)
