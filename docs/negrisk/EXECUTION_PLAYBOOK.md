# NegRisk Autopilot Execution Playbook

Status: Ready for execution once approved
Approval gate: `AUTOPILOT_APPROVED: true` in `PLAN.md`

This playbook is the operator/agent checklist for NR0–NR10. Each milestone requires:
1) implementation chunk, 2) verification commands, 3) artifact bundle, 4) status update.

## Global rules (all milestones)
- Operate only in `/workspace/projects/bot`.
- No infra/server/credential changes unless explicitly approved.
- No geoblock bypass behavior.
- Do not trade `negRiskOther` outcomes.
- Do not mark complete without artifact evidence.
- Completion labels:
  - `done`: verify pass + code diff committed
  - `noop_done`: verify pass + no diff + explicit noop reason + artifacts

## Artifact standard
`artifacts/milestones/<NRX>/<timestamp>/`
- `summary.json`
- `commands.log`
- `assertions.json`
- `artifacts_manifest.txt` (sha256)
- optional: replay traces/journals

## Milestone execution checklists

### NR0 Bootstrap + strategy flag
- Implement strategy scaffold and runtime flags.
- Verify:
  - `npm run prove`
  - `node scripts/list-goals.mjs`
- Assert:
  - NegRisk strategy selectable
  - `DRY_RUN=true` blocks trade writes
- Evidence:
  - startup log + prove artifacts

### NR1 NegRisk universe scanner
- Implement Gamma event filter + market extraction.
- Verify:
  - `npm run goal -- --pack docs/agent-goals/goalpack-v11.json G27`
  - `npm test -- tests/unit/*negRisk*.test.mjs`
- Assert:
  - `negRisk`, `enableOrderBook`, `enableNegRisk` required
  - `negRiskMarketID` captured
  - `negRiskOther` excluded
- Evidence:
  - `artifacts/negrisk/universe/latest.json`

### NR2 Canonical mapper + indexSet
- Implement canonical ordering + indexSet builder.
- Verify:
  - `npm test -- tests/unit/*indexset*.test.mjs`
  - `node scripts/prove.mjs --suite=nr2`
- Assert:
  - canonical id = `conditionId`
  - deterministic order hash
  - `indexSet(i) = 1 << i`
  - hash mismatch blocks conversion
- Evidence:
  - `artifacts/negrisk/<eventId>/canonical-order.json`

### NR3 Orderbook cache reliability
- Implement token registry + resilient book state.
- Verify:
  - `npm test -- tests/replay/*orderbook*.test.mjs`
  - `node scripts/prove.mjs --suite=nr3`
- Assert:
  - top-of-book consistent after resync
  - YES/NO token mapping complete
- Evidence:
  - replay report + drift metrics

### NR4 Opportunity engine (dry run)
- Implement fee-aware opportunity and sizing logic.
- Verify:
  - `npm test -- tests/unit/*opportunity*.test.mjs`
  - `node scripts/run-paper-live.mjs --mode fixture --strategy negrisk`
- Assert:
  - edge math correct after fees/slippage buffer
  - size bounded by depth and risk limits
- Evidence:
  - paper run journal + opportunities snapshot

### NR5 CLOB execution state machine
- Implement order lifecycle and conversion preconditions.
- Verify:
  - `npm test -- tests/integration/*executor*.test.mjs`
  - `node scripts/prove.mjs --suite=nr5`
- Assert:
  - no convert before NO fill
  - state transitions valid
- Evidence:
  - execution trace + guardrail logs

### NR6 Relayer + adapter conversion
- Implement conversion tx submit/poll/finalize path.
- Verify:
  - `npm test -- tests/integration/*convert*.test.mjs`
  - `node scripts/prove.mjs --suite=nr6`
- Assert:
  - tx states handled exactly:
    - `STATE_CONFIRMED` success
    - `STATE_FAILED`/`STATE_INVALID` terminal fail
    - `STATE_NEW`/`STATE_EXECUTED`/`STATE_MINED` in-flight
  - no duplicate write submits while in-flight
  - approval preflight required
- Evidence:
  - tx journal + approval report

### NR7 Inventory + reconciliation
- Implement persistent inventory + pending conversion buckets.
- Verify:
  - `npm test -- tests/integration/*inventory*.test.mjs`
  - `node scripts/prove.mjs --suite=nr7`
- Assert:
  - restart recovery accurate
  - drift reconcile works
- Evidence:
  - reconciliation report

### NR8 Risk + circuit breakers
- Implement hard caps and pause/kill behavior.
- Verify:
  - `npm test -- tests/integration/*killSwitch*.test.mjs`
  - `node scripts/prove.mjs --suite=nr8`
- Assert:
  - per-event <= $250
  - total open <= $500
  - max order <= $50
  - min edge >= $0.02/share
  - max active events <= 2
  - relayer fail streak >=3 pauses
  - ws stale >20s pauses + cancel-all
- Evidence:
  - policy assertions + kill switch drill artifacts

### NR9 Tiny live canary
- Run constrained live canary.
- Verify:
  - `node scripts/run-live.mjs --strategy negrisk --tiny`
  - `node scripts/analyze-run.mjs <journal>`
- Assert:
  - 24h run
  - zero policy violations
  - no unresolved conversion in-flight at shutdown
- Evidence:
  - canary summary + reconciliation report

### NR10 Production readiness gate
- Prepare go/no-go decision pack.
- Verify:
  - `npm run prove`
  - `node scripts/run-operator-doctor.mjs`
- Assert:
  - all suites green
  - rollback runbook validated
  - alerting/observability healthy
- Evidence:
  - signed release checklist
