# M8: Tiny Live Mode (1-3 Markets, Small Caps)

## Goal

Run 24/7 with tiny caps and survive reconnects, rate limits, and partial failures.

## Constraints

- Must be safe by default:
  - allowlist markets required
  - caps required
  - geoblock required
- Must have a tested cancel-all drill (deadman switch).

## Deliverables

- Live runner that:
  - uses executor boundary
  - enforces allowlist + caps
  - has deadman switch cancel-all on stale feeds
- Minimal dashboard or status endpoint (read-only is fine for MVP).

## Proofs

- Offline: `npm run prove` passes.
- Optional integration proof: a scripted "cancel-all drill" can be run and produces an artifact log.

