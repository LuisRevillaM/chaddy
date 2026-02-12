# PLAN
AUTOPILOT_APPROVED: true
PROJECT_KEY: bot
REPO_PATH: /root/agents/workspaces/cto/projects/bot

## Goal
Deliver a NegRisk conversion/arbitrage strategy using the existing bot infrastructure, with explicit proof gates per milestone.

## Execution policy
- Extension-first architecture (shared core, strategy modules).
- NegRisk is primary/default strategy for this execution track.
- Rewards strategy remains available but not default.

## Milestones
- [ ] NR0 Bootstrap + strategy flag
- [x] NR1 NegRisk universe scanner
- [x] NR2 Canonical mapper + indexSet
- [x] NR3 Orderbook cache reliability
- [x] NR4 Opportunity engine (dry run)
- [x] NR5 CLOB execution state machine
- [x] NR6 Relayer + adapter conversion
- [ ] NR7 Inventory + reconciliation
- [ ] NR8 Risk + circuit breakers
- [ ] NR9 Tiny live canary
- [ ] NR10 Production readiness gate

## Required docs
- docs/negrisk/MASTER_PLAN.md
- docs/negrisk/MILESTONE_CONTRACTS.md

## Constraints
- No infra changes unless explicitly approved.
- No geoblock bypass behavior.
- No direct key exposure in strategy code.
- No milestone completion without proof artifacts.
