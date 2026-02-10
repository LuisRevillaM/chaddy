# End-to-End Delivery Plan (Build + Operator Logistics)

This document ties together:

- what we’re building (technical milestones)
- how we’ll run it safely (practice -> tiny-live)
- how non-technical operators can run it from a non-blocked location

## Roles

- Builder (you): writes/reviews code and runs offline proofs.
- Operator (Argentina / non-blocked): runs any mode that touches real Polymarket endpoints.
- Observer (you, Texas/blocked): reads status/metrics only. Must not control trading actions.

## Environments

- Offline: no network. Deterministic proofs only (`npm run prove`).
- Networked read-only: market data only (shadow / paper-live). No orders sent to Polymarket.
- Live trading: place/cancel orders via executor (tiny caps + allowlist + preflight).

## Phase 0: Proof-Driven Core (Today)

Goal:

- deterministic, testable mm-core + executor guardrails

Gate:

- `npm run prove` passes
- artifacts under `artifacts/proofs/latest/`

## Phase 1: Shadow Mode (Read-Only)

What it is:

- connect to Polymarket market WebSocket
- build a local book and compute “desired quotes”
- never place/cancel orders

Purpose:

- validate parsing, reconnect/resync behavior, kill-switch behavior, and basic quoting under real feed conditions

Operator gate (must run from operator machine):

- `curl -s https://polymarket.com/api/geoblock` reports `blocked:false`

## Phase 2: Practice Mode (“Paper-Live”)

Definition:

- **live market data in**
- **no real trading out**

Two variants (we’ll implement both; same UI/ops surface):

1) Paper-Live (No-Fills):
   - mm-core computes desired orders and order-manager diffs
   - executor is a no-op recorder that writes artifacts (“would place/cancel X”)
   - simplest and safest; great for ops confidence

2) Paper-Live (Sim-Fills):
   - executor sends orders to `SimExchange` (local deterministic simulator)
   - optionally drive SimExchange’s top-of-book from the live feed to simulate fills on cross
   - gives rough inventory/PnL dynamics (still not “real” performance)

What Paper-Live can tell us:

- uptime, reconnect rate, stale-feed kill switch behavior
- churn metrics (how often we replace/cancel)
- quote placement relative to live midpoint/top-of-book

What Paper-Live cannot tell us reliably:

- actual fill quality and adverse selection
- actual Liquidity Rewards earned (needs real orders, and scoring verification tied to those orders)

## Phase 3: Tiny Live (Real Trading, 1–3 Markets)

Definition:

- market data + user channel ingestion
- executor uses real Polymarket adapter
- strict preflight gates:
  - geoblock must allow
  - explicit allowlist + tiny caps must be configured
  - price-band guardrail on every order

Operational goal:

- survive overnight with tiny exposure and no safety violations

## Phase 4: Scale + Inventory Ops

Add:

- inventory split/merge automation (careful caps)
- better market selection + per-market budgets
- monitoring, alerting, and runbooks

## Operator Bundle (Non-Technical Macs)

Goal:

- operator can run this without knowing Node/Git

Deliverable shape:

- an “Operator Bundle” zip (or installer) that includes:
  - `Start (Paper).command`
  - `Start (Live).command` (only after opt-in integration smoke passes on operator machine)
  - `Stop.command`
  - `Status.command` (prints and writes a single JSON status file)
  - `config.json` (editable, or a tiny interactive setup)
- optional: `launchd` plist for auto-restart

Design rule:

- observers (blocked regions) only get read-only status; no remote “trade” controls.
