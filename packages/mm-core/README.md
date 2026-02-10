# mm-core

Deterministic data-plane logic:

- orderbook state
- strategy (quote computation)
- order diffing / churn control
- kill-switch decisions

## Hard constraints

- Must not contain private keys, API secrets, or trading credentials.
- Must not place orders directly against external trading endpoints.
- Must be deterministic and testable under `npm run prove`.

