# Project Status (As Of 2026-02-10)

This repo is **proof-driven**. "Done" for any change means `npm run prove` passes and artifacts exist under `artifacts/proofs/latest/`.

## Current State

### What works today (offline / safe)

- Deterministic proof harness: `npm run prove`
- Deterministic sim exchange + mm-core loop + anti-churn + kill-switch
- Deterministic startup reconciliation (cancel-all once, then gate quoting until snapshot) (sim-proven)
- Executor boundary with strict policy guardrails (sim-proven)
- Rewards scoring verifier (deterministic mock) + artifacts
- Economics ledger (mark-to-mid PnL) (sim-proven)
- Paper-live runner (fixture mode) + artifacts
- Run journal (JSONL) + offline analyzer producing a single `run-summary.json` (sim-proven)

### What works (networked, non-trading / practice)

- Shadow-live (read-only market WebSocket): `scripts/run-shadow-live.mjs --mode live` (best-effort; depends on geolocation + feed shapes)
- Paper-live (live market WebSocket in, simulated trading out): `scripts/run-paper-live.mjs --mode live` (never hits trading endpoints)

### Implemented, but not yet validated on a real operator account (trading path)

- Real geoblock check client (cached + injectable) with opt-in integration test (`npm run integration` with `INTEGRATION_ENABLED=1`)
- Polymarket REST client + executor adapter (request formation proven offline; integration smoke tests are opt-in)
- Live runner script (`scripts/run-live.mjs`) with strict preflight gates + operator `.command` wrappers (`operator/start-live.command`, `operator/stop.command`, `operator/status.command`)

This code exists, but "works on real Polymarket" is still **unproven** until integration is run from a non-blocked operator machine with real credentials.

### Still missing / likely next cracks to close before we call it "production-ready"

- Confirm and implement the real Polymarket auth/signing requirements (the current REST adapter may need order-signing fields or the official SDK to succeed).
- Live runner: ensure user-channel subscription/auth is configured so live orders + fills are tracked (otherwise live order state can drift).
- Rewards scoring: real `/order-scoring` integration (currently mock only).
- Inventory operations (split/merge) if you want sustained two-sided quoting without manual intervention.
- Packaging + deployment: auto-restart (launchd/systemd), log rotation, metrics, alerts, and an operator-friendly distribution bundle.

## Milestones (docs/milestones)

- M0 Repo bootstrap: DONE
- M1 Sim exchange + abstractions: DONE
- M2 Orderbook resync + replay: DONE
- M3 Strategy engine (pure function): DONE
- M4 Order manager (diff + anti-churn): DONE
- M5 Executor boundary + guardrails: DONE (offline) / PARTIAL (real integration not yet validated)
- M6 Rewards scoring verifier: DONE (mock) / PARTIAL (real scoring integration pending)
- M7 Shadow mode: PARTIAL
  - Fixture-proven shadow runner exists.
  - "Live shadow" is best-effort and depends on network + geolocation.
- M8 Tiny live mode: IMPLEMENTED (code) / NOT YET VALIDATED (needs integration on operator machine)

## Practical Readiness

- Safe for agent-driven iteration: YES (proof harness is fast and deterministic)
- Ready to run Paper-Live from a non-blocked location (practice): YES
- Ready to run Tiny-Live trading on a real operator account: NOT YET (must pass opt-in integration smoke + confirm real auth/signing)
