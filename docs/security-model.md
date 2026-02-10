# Security Model (MVP)

This is a development-time security model intended to keep agent-driven work safe.

## Key isolation

- Private keys and derived trading credentials must live only inside `packages/executor/`.
- `mm-core` must never be able to sign or place orders directly against external trading endpoints.
- Any UI or "AI ops" component must never receive signing keys or trading credentials.

## Guardrails (executor)

The executor is the only component allowed to perform trading actions. It must enforce:

- allowlist of markets
- max order size + min order size
- max notional per order (and later per day)
- (optional) price bands around midpoint
- geoblock gating: refuse to trade if blocked

## Verification (current)

`npm run prove` includes a `security` suite that:

- fails on common secret patterns (PEM blocks, 0x64 hex strings, long base64 tokens)
- fails on suspicious `KEY=VALUE` assignments for secret-like keys
- enforces package import boundaries to prevent accidental capability leaks

This is not a substitute for real secret management and runtime hardening; it is a safety net for agent-driven iteration.

