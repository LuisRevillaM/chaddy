# Agent Goals (Goal Pack)

These are concrete, self-verifying goals intended for autonomous agents.

Rules:

- Pick exactly one goal at a time.
- Do not relax safety constraints (geoblock + executor guardrails).
- The goal is only complete when the listed proof command passes and the artifacts exist.

## One-command goal runner

Run a goal (this runs the goal's proof suites and checks required artifacts):

```bash
npm run goal -- G1
```

Run a goal from a specific goal pack:

```bash
npm run goal -- --pack docs/agent-goals/goalpack-v2.json G4
```

List goals:

```bash
npm run goals
```

See:

- `docs/agent-goals/goalpack-v1.json` (machine-readable)
- `docs/agent-goals/goalpack-v2.json` (machine-readable)
- `docs/agent-goals/goalpack-v3.json` (machine-readable)
- `docs/agent-goals/goalpack-v4.json` (machine-readable)
- `docs/agent-goals/goalpack-v5.json` (machine-readable)
- `docs/agent-goals/goalpack-v6.json` (machine-readable)
- `docs/agent-goals/goalpack-v7.json` (machine-readable)
- `docs/agent-goals/goalpack-v8.json` (machine-readable)
- `docs/agent-goals/goalpack-v9.json` (machine-readable)
- `docs/milestones/` (full milestone docs)
- `docs/agent-runbook.md` (execution loop)
