# Observability Expectations (Agent-Driven)

Agents need to be able to determine correctness without a human staring at logs. That means:

- deterministic proofs (`npm run prove`)
- structured artifacts (`artifacts/proofs/latest/...`)
- explicit invariants (tests that fail loudly when violated)

## Logging (runtime)

When real services exist, logs should be:

- JSON lines (one event per line)
- include: `ts`, `service`, `level`, `msg`, `market` (if applicable), `runId` (if applicable)
- never include secrets (private keys, API secrets, session tokens)

## Metrics (runtime)

Minimum metrics per service:

- heartbeat: `last_market_msg_age_ms`, `last_user_msg_age_ms`
- churn: `orders_placed_total`, `orders_canceled_total`, `order_replaces_total`
- errors: `ws_reconnects_total`, `api_errors_total`
- executor guardrails: `policy_rejections_total` by reason, `cancel_all_total` by reason
- rewards: `scoring_ok_total`, `scoring_not_ok_total` (once implemented)

## Proof artifacts (development)

Each proof suite should write at least one suite artifact that helps debug failures:

- `unit`: optional (usually the log is enough)
- `replay`: final state snapshot(s)
- `sim`: summary JSON + optionally event log JSONL
- `security`: findings JSON (even when empty)

The harness already standardizes suite artifact locations:

- `artifacts/proofs/latest/suite/<suite>/`

