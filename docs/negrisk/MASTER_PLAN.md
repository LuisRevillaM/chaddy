# NegRisk Bot Master Plan (Extension-First, Proof-Gated)

Status: Draft for approval
Owner: cto
Date: 2026-02-12

## Strategy policy
We will keep a single shared codebase and support strategy modules.
- Instance A can run rewards strategy.
- Instance B can run NegRisk strategy.
- For this project, NegRisk is primary and default for execution tracks.

## Mission
Build a production-safe NegRisk conversion/arbitrage strategy that can prove, at each milestone, that functional goals are met via deterministic verification artifacts.

## Non-negotiable constraints
1. Geoblock compliance; no bypass behavior.
2. No direct private-key access in strategy/runtime agent code.
3. Deterministic hot path and replayable verification.
4. No trading of augmented NegRisk "Other" outcomes.
5. No milestone completion without evidence artifacts.

## Canonical outcome ordering (critical)
Every NegRisk event must have a canonical ordering file:
- `artifacts/negrisk/<eventId>/canonical-order.json`
- Fields: eventId, negRiskMarketId, orderedOutcomes[], sourceHash, createdAt

Default canonical policy:
1. Start from Gamma event market list.
2. Exclude markets where `negRiskOther == true`.
3. Canonical market identity is `conditionId` (slug is alias only).
4. Sort by stable key: `conditionId` (fallback: slug only if required for display).
5. Persist `orderedOutcomes` and `sourceHash`.
6. Before any conversion, recompute hash; if mismatch, block event and escalate.

IndexSet generation is valid only against this canonical order.
Any order mismatch => hard fail.

## Global proof gate shape (applies to every milestone)
Each milestone must produce:
1. `artifacts/milestones/<milestone>/<timestamp>/summary.json`
2. `commands.log` with exact command transcript
3. `assertions.json` with pass/fail checks
4. `artifacts_manifest.txt` (sha256)
5. rollback note

Completion states:
- `done`: code change + verify pass
- `noop_done`: no diff but verify + artifacts prove milestone already satisfied

## Delivery phases
- P0: control-plane + feature flag bootstrap
- P1: NegRisk universe and canonical mapping
- P2: data reliability (books + token registry)
- P3: opportunity model in dry-run
- P4: execution + conversion state machine
- P5: inventory, risk, and launch hardening

## Stop conditions
Autopilot must stop and escalate on:
- signing/auth mismatch
- mapping/indexSet inconsistency
- stale books / feed drift
- repeated relayer/conversion failures
- risk rule violation

## Runtime policy
- Keep rewards strategy runnable but not default.
- Set runtime default strategy to NegRisk in deployment config.
- Rewards path remains for fallback/parallel mode only.

## Default execution/auth model (until overridden)
- Market data: direct read clients.
- Order execution: dedicated executor account path.
- Conversion execution: relayer-based `convertPositions` path.
- Secrets: executor boundary only; never strategy logs.

## Relayer transaction policy (default)
- Treat `STATE_CONFIRMED` as final success.
- Treat `STATE_FAILED` and `STATE_INVALID` as terminal failure.
- Treat `STATE_NEW` / `STATE_EXECUTED` / `STATE_MINED` as in-flight; continue polling.
- Never blindly resubmit writes while state is unknown/in-flight.
- Poll quickly first, then backoff; escalate alert on long pending windows (SLO breach) without duplicate submits.

## Approvals policy (required before live)
- Verify required approvals for CTF, CTF Exchange, Neg Risk CTF Exchange, and Neg Risk Adapter per Polymarket docs.
- Conversion must be blocked if approval preflight fails.

## Default safety limits (tiny-live baseline)
- Max notional per event: $250
- Max total open notional: $500
- Max single order size: $50
- Max daily traded notional: $1,500
- Min edge after fees/slippage buffer: $0.02/share
- Max concurrent active events: 2
- Relayer conversion failures >=3 in streak: pause strategy
- WS stale >20s: pause + cancel-all

These defaults are conservative and required for NR9 canary.

## Done definition (program level)
- End-to-end cycle proven: buy NO -> convert -> sell YES bundle
- Deterministic proofs pass for all milestones
- Tiny-live canary run passes without policy violations
- Operator runbook + rollback drill validated
