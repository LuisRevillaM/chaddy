# NegRisk Milestone Contracts (Agent-Executable)

Each milestone includes: Goal, Required Outputs, Verify Commands, Assertions, Evidence.

## NR0 — Bootstrap + Strategy Flag
**Goal:** NegRisk strategy boots without trading.
**Required outputs:** strategy scaffold, config flags (`STRATEGY=negrisk`, `DRY_RUN=true`).
**Verify commands:**
- `npm run prove`
- `node scripts/list-goals.mjs`
**Assertions:**
- process starts with NegRisk strategy selected
- no trading calls executed in dry run
**Evidence:** startup log + prove artifacts.

## NR1 — NegRisk Universe Scanner
**Goal:** build tradable event universe from Gamma filters.
**Required outputs:** scanner module, event cache, exclusion of `negRiskOther`.
**Verify commands:**
- `npm run goal -- --pack docs/agent-goals/goalpack-v11.json G27`
- `npm test -- tests/unit/*negRisk*.test.mjs`
**Assertions:**
- only events with required flags are included
- each event has `negRiskMarketID`
- outcomes with `negRiskOther=true` excluded
**Evidence:** `artifacts/negrisk/universe/latest.json`.

## NR2 — Canonical Outcome Mapper + IndexSet Builder
**Goal:** deterministic mapping from outcome index to bitmask.
**Required outputs:** canonical order builder + indexset utilities.
**Verify commands:**
- `npm test -- tests/unit/*indexset*.test.mjs`
- `node scripts/prove.mjs --suite=nr2`
**Assertions:**
- canonical ordering excludes `negRiskOther=true`
- ordering is stable by (`market.slug` fallback `conditionId`)
- same event always yields same ordered outcomes hash
- `indexSetFor(i)` equals `1<<i`
- mismatch with canonical hash hard fails and blocks event
**Evidence:** canonical order files + assertion report.

## NR3 — Orderbook Cache for YES/NO Tokens
**Goal:** stable best bid/ask + depth for all relevant token IDs.
**Verify commands:**
- `npm test -- tests/replay/*orderbook*.test.mjs`
- `node scripts/prove.mjs --suite=nr3`
**Assertions:**
- resync restores top-of-book correctly
- token registry resolves YES/NO ids per outcome
**Evidence:** replay report + drift metrics.

## NR4 — Opportunity Engine (Dry Run)
**Goal:** detect profitable NO->convert->YES bundle opportunities.
**Verify commands:**
- `npm test -- tests/unit/*opportunity*.test.mjs`
- `node scripts/run-paper-live.mjs --mode fixture --strategy negrisk`
**Assertions:**
- fee-aware edge math correct
- size bounded by depth + risk limits
- ranked opportunities emitted with deterministic ordering
**Evidence:** paper run journal + `opportunities.json`.

## NR5 — CLOB Execution State Machine
**Goal:** robust buy/sell order lifecycle with policy checks.
**Verify commands:**
- `npm test -- tests/integration/*executor*.test.mjs`
- `node scripts/prove.mjs --suite=nr5`
**Assertions:**
- state transitions valid (placed->filled/partial/cancelled)
- no convert attempted before NO fill
**Evidence:** execution trace + policy guardrail logs.

## NR6 — Relayer + Adapter Conversion
**Goal:** submit and track `convertPositions` lifecycle.
**Verify commands:**
- `npm test -- tests/integration/*convert*.test.mjs`
- `node scripts/prove.mjs --suite=nr6`
**Assertions:**
- correct `_marketId`, `_indexSet`, `_amount`
- tx state machine handling is explicit:
  - `STATE_CONFIRMED` => success
  - `STATE_FAILED` / `STATE_INVALID` => terminal failure
  - `STATE_NEW` / `STATE_EXECUTED` / `STATE_MINED` => in-flight
- no duplicate write submission while tx state is unknown/in-flight
- conversion status tracked to terminal state
- approval preflight gates pass before submission
**Evidence:** conversion ledger + tx status journal + approval check artifact.

## NR7 — Inventory + Reconciliation
**Goal:** persistent inventory with pending buckets and restart safety.
**Verify commands:**
- `npm test -- tests/integration/*inventory*.test.mjs`
- `node scripts/prove.mjs --suite=nr7`
**Assertions:**
- restart rebuilds accurate positions and pending conversions
- drift detection/reconcile works
**Evidence:** reconciliation report.

## NR8 — Risk + Circuit Breakers
**Goal:** prevent blowups during volatile/failed conditions.
**Verify commands:**
- `npm test -- tests/integration/*killSwitch*.test.mjs`
- `node scripts/prove.mjs --suite=nr8`
**Assertions:**
- max per-event notional <= $250 enforced
- max total open notional <= $500 enforced
- max order size <= $50 enforced
- min edge >= $0.02/share enforced before execution
- max active events <= 2 enforced
- kill switch cancels open orders and halts entries
- relayer fail streak >=3 pauses strategy
- websocket stale >20s pauses strategy
**Evidence:** kill switch drill artifacts + policy assertion report.

## NR9 — Tiny Live Canary
**Goal:** minimal live run with strict caps.
**Verify commands:**
- `node scripts/run-live.mjs --strategy negrisk --tiny`
- `node scripts/analyze-run.mjs artifacts/.../journal.jsonl`
**Assertions:**
- run duration >= 24h
- zero policy violations
- bounded churn (within configured API budget)
- no trading on `negRiskOther` outcomes
- clean cancel-all drill outcome
- no unresolved conversion-in-flight entries at shutdown
**Evidence:** live run summary + incident-free checklist + conversion reconciliation report.

## NR10 — Production Readiness Gate
**Goal:** explicit go/no-go decision pack.
**Verify commands:**
- `npm run prove`
- `node scripts/run-operator-doctor.mjs`
**Assertions:**
- all prior milestone suites green
- operator runbook and rollback tested
- alerting/observability healthy
**Evidence:** signed release checklist + operator doctor report.
