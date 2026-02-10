# Project Status (As Of 2026-02-10)

This repo is **proof-driven**. "Done" for any change means `npm run prove` passes and artifacts exist under `artifacts/proofs/latest/`.

## Current State

### What works today (offline / safe)

- Deterministic proof harness: `npm run prove`
- Deterministic sim exchange + mm-core loop + anti-churn + kill-switch
- Executor boundary with strict policy guardrails (sim only)
- Rewards scoring mock + artifacts
- Shadow runner (fixture mode) that never trades

### What is partially working

- Shadow-live (real WebSocket market data, read-only): exists as `scripts/run-shadow-live.mjs --mode live`, but it may not receive usable market data from blocked locations and it currently only consumes market-channel data (no user channel).

### What is NOT implemented yet (required for real trading)

- Real Polymarket trading adapter in `packages/executor/` (signing/auth + REST calls)
- Real geoblock check (current `packages/executor/src/geoblock.js` is a proof stub)
- Live-mode runner that places/cancels real orders with tiny caps
- Live user-channel ingestion (fills/order updates) + robust inventory ops
- Deployment packaging (Docker/systemd), monitoring/alerts, and operator runbooks (in progress)

## Milestones (docs/milestones)

- M0 Repo bootstrap: DONE
- M1 Sim exchange + abstractions: DONE
- M2 Orderbook resync + replay: DONE
- M3 Strategy engine (pure function): DONE
- M4 Order manager (diff + anti-churn): DONE
- M5 Executor boundary + guardrails: PARTIAL
  - Guardrails + tests exist.
  - Real geoblock + real trading adapter are pending.
- M6 Rewards scoring verifier: PARTIAL
  - Mock verifier exists and is proven offline.
  - Real scoring integration is pending.
- M7 Shadow mode: PARTIAL
  - Fixture-proven shadow runner exists.
  - "Live shadow" is best-effort and depends on network + geolocation.
- M8 Tiny live mode: NOT STARTED (real trading)

## Practical Readiness

- Safe for agent-driven iteration: YES (proof harness is fast and deterministic)
- Ready to deploy as a read-only monitor from a non-blocked location: CLOSE
- Ready to deploy as a real trading bot: NOT YET (missing executor adapter + real geoblock + live runner)

