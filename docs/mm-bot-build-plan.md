# Build Plan: Liquidity-Rewards MM Bot (Proof-Driven)

This is a pragmatic plan for building the liquidity-rewards-focused market maker described in `docs/polymarket-liquidity-rewards-mm.md`, with verification harnesses ("proofs") that an agent can be run against step-by-step.

## Non-negotiable constraints

- Comply with Polymarket's geographic restrictions. The system should implement geoblock checks and must refuse to trade if blocked. Do not attempt to bypass restrictions.
- Key safety: no AI/agent has direct access to private keys or trading credentials. Keys live only inside a narrowly-scoped `executor` service with guardrails.
- Determinism in the hot loop: the quoting loop must be predictable and testable. Put agentic logic in a slow control plane only.

## Recommended stack (given JS/TS + Go)

- `mm-core` (data plane): TypeScript/Node.
  - Reason: fastest integration with the Polymarket TS client ecosystem; good WS/event-loop behavior.
- `executor` (signing/trading boundary): start in TypeScript/Node, optionally migrate to Go later.
  - Reason: minimizing "time-to-first-trade" matters; Go rewrite is optional once behavior is stable.
- UI (optional): React + a small API server (can live with `mm-core` at first).
- Storage: SQLite for MVP, Postgres for production.
- Metrics: Prometheus + Grafana (or cloud equivalent).

## What "MVP" means (2-3 weeks for 1 engineer, realistic)

- Run in "shadow mode" (no orders) and "live mode" (tiny limits) with the same codepath.
- Quote 1-3 markets 24/7 with:
  - robust WS reconnect/resync
  - order diffing (no churn storms)
  - hard guardrails (max size, max notional, allowed markets, price bands)
  - stale-feed kill switch that cancels all
  - reward scoring verification loop (if available) that proves orders qualify
- Emit a proof report for every run (see "Proof Harness" below).

What MVP does NOT include:

- fully automated inventory split/merge
- sophisticated market selection heuristics
- multi-region HA
- fancy UI (a simple dashboard page is fine)

## Production target (6-10+ weeks, depending on inventory + ops)

- Multi-market support (10s-100s) with per-market budgets.
- Automated inventory ops (split/merge/position rebalancing) with strong safety caps.
- Operational maturity:
  - alerts/paging
  - deploy automation
  - runbooks
  - daily reward + PnL + incident summaries

## Milestones with proofs (agent-executable)

Each milestone below includes:

- Deliverable: what code exists
- Proof: what must run successfully (tests + artifacts)
- Failure modes: the specific bugs we want the harness to catch

### M0: Repo bootstrap

Deliverable:

- A monorepo skeleton and a single command to run all proofs.

Proof:

- `prove` command runs lint/typecheck/unit tests (even if minimal initially) and writes `artifacts/proofs/latest/report.md`.

Failure modes:

- no single source of truth for "done"

### M1: Exchange abstraction + local simulator

Deliverable:

- `ExchangeAdapter` interface (REST + WS-ish surface).
- `SimExchange` implementation for deterministic tests:
  - book snapshots + price_change events
  - order acceptance/cancel
  - simple matching (enough to generate fills)
  - user stream events (order status + fills)

Proof:

- Simulation test: run 10 minutes of accelerated sim time and assert:
  - no invariant violations
  - bounded inventory
  - bounded order churn
  - kill switch cancels on stale feed scenario

Failure modes:

- "works in prod" only; no deterministic debugging loop

### M2: Orderbook + WS resync logic

Deliverable:

- Orderbook state builder that can:
  - apply snapshots
  - apply deltas
  - recover from reconnect by requesting a fresh snapshot

Proof:

- Replay harness: feed recorded (or generated) WS messages and assert top-of-book correctness at each step.

Failure modes:

- silent book drift after reconnect

### M3: Strategy engine (quotes as a pure function)

Deliverable:

- `computeDesiredQuotes(state, config) -> DesiredOrder[]` that is deterministic and side-effect free.
- Constraints enforced here:
  - tick size
  - max spread
  - min size
  - inventory skew bounds

Proof:

- Property tests: for random books/configs, output quotes always satisfy constraints.
- Golden tests: fixed market scenarios produce fixed quotes.

Failure modes:

- invalid price steps or spread violations

### M4: Order manager (diff desired vs live, anti-churn)

Deliverable:

- Diff algorithm that decides place/cancel/replace.
- Anti-churn controls:
  - min time between edits per market
  - "do nothing" zone (ignore tiny midpoint moves)
  - global call budget (token bucket)

Proof:

- Unit tests for diff minimality and idempotence.
- Soak sim: 60 minutes accelerated with noisy midpoint; assert API calls stay under budget.

Failure modes:

- churn storms that trip rate limits

### M5: Executor boundary + policy guardrails

Deliverable:

- Separate `executor` process/service:
  - owns L1 key material and derived trading creds
  - exposes a tiny internal API: place/cancel/cancel-all + read-only status
  - enforces policy: allowed markets, max order size, price bands, daily caps
  - geoblock check on startup and periodically; refuse to trade if blocked

Proof:

- Integration tests against `SimExchange`:
  - executor refuses policy-violating orders
  - kill switch path calls cancel-all
- Security proof:
  - no secrets in logs (basic regex scan in harness)

Failure modes:

- an agent or UI can bypass caps and place arbitrary orders

### M6: Rewards-scoring verification loop

Deliverable:

- After each place/update, check scoring eligibility (single/batch if available).
- Feedback loop:
  - if not scoring, adjust parameters or exit the market (configurable)

Proof:

- Mock scoring server in sim, plus "expected scoring" assertions in replay tests.

Failure modes:

- running for days without actually qualifying

### M7: Shadow mode against real endpoints

Deliverable:

- Connect to real WS market data and build books.
- Produce quotes and "intended orders" but do not place anything.

Proof:

- 1+ hour run with:
  - at least N reconnects injected (network fault simulation)
  - no book drift
  - stable memory

Failure modes:

- WS reconnection breaks state or leaks memory

### M8: Tiny live mode + operational checklist

Deliverable:

- Live trading with tiny caps and an allowlist of 1-3 markets.
- Runbook + alerting:
  - deadman alert (no WS updates)
  - error-rate alert
  - reward scoring drop alert

Proof:

- 24h run with:
  - zero policy violations
  - bounded churn
  - successful cancel-all drill

Failure modes:

- "it worked for 30 minutes" but fails overnight

## Proof harness design (how we make agents succeed)

### One command: `prove`

`prove` should:

- run all tests (unit + replay + sim + security checks)
- write a human-readable report to `artifacts/proofs/latest/report.md`
- write machine-readable results to `artifacts/proofs/latest/results.json`

This is the gate an agent must satisfy before claiming a milestone is done.

### Proof types (minimal set)

- `unit`: deterministic unit tests for pure functions and diff logic
- `replay`: deterministic WS playback tests (orderbook correctness + reconnect)
- `sim`: deterministic market simulator tests (fills + inventory + kill switch)
- `soak`: longer sim runs to catch churn/memory regressions
- `security`: log scan + config checks that prove secrets/keys are not exposed

### Invariants to enforce (examples)

- Quotes always respect: tick size, max spread, min size.
- Order churn never exceeds a configured API call budget.
- Cancel-all triggers on stale market data or user stream failures.
- Inventory stays within per-market bounds in simulation.
- Executor rejects any order outside policy guardrails.

## UI plan (optional, low-risk)

Build UI only after M4 (order manager) is solid.

Minimum useful dashboard:

- per-market status: midpoint, current quotes, scoring status, inventory, last WS heartbeat
- global status: API call budget, error rate, last cancel-all, geoblock status
- config viewer (read-only in MVP; changes via config deploy)

## How to run an agent against this plan

Give the agent a single milestone at a time with:

- Constraints: what it must not do (key access, bypass restrictions, remove caps)
- Proof: which `prove` sub-tests must pass and what artifacts must be produced
- Scope limit: which packages/files it can change for that milestone

If you want, I can turn this plan into:

- a repo blueprint (directory layout + interfaces)
- a `prove` harness scaffold (scripts + artifact format)
- milestone task files (one per milestone) that an agent can execute verbatim

