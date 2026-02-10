# executor

Capability boundary for trading:

- owns signing keys / derived credentials (when added)
- enforces guardrails (allowlist, caps, price bands, geoblock gating)
- exposes a narrow interface: place/cancel/cancel-all

## Hard constraints

- Other packages must not import executor implementation details (enforced by security scan).
- Never log secrets.

