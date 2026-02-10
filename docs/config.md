# Configuration

This repo intentionally keeps config simple and explicit so agents can reason about safety.

Example:

- `config/example.json`

## Safety notes

- Do not store secrets in config files committed to the repo.
- Trading must be guarded by:
  - geoblock gating (refuse when blocked)
  - executor policy allowlists + caps

