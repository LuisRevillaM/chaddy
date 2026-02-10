# Agent Runbook (How To Work This Repo)

This is how an agent should execute work here without human supervision.

## Loop

1. Pick exactly one milestone doc under `docs/milestones/`.
   - Or pick a concrete goal under `docs/agent-goals/goalpack-v1.json`.
2. Restate:
   - constraints
   - deliverables
   - proofs to run
3. Implement the smallest change-set that satisfies the milestone.
4. Run proofs:
   - `npm run prove` (or `npm run prove -- --suite ...` if the milestone specifies)
   - If using a goal from the goal pack: `npm run goal -- <GOAL_ID>`
5. If any proof fails:
   - read `artifacts/proofs/latest/report.md`
   - read failing logs under `artifacts/proofs/latest/logs/`
   - inspect suite artifacts under `artifacts/proofs/latest/suite/<suite>/`
    - fix and repeat
6. Only declare success if proofs pass and artifacts are present.

## Rules of engagement

- Do not add real secrets to the repo. `security` suite will fail.
- Do not weaken executor guardrails or geoblock gating.
- Keep proofs offline by default; integration tests must be opt-in.
- Prefer deterministic simulators and replays over flaky "live" tests.

## Evidence to provide

When done, always point to:

- `artifacts/proofs/latest/report.md`
- the suite artifact(s) added/changed (if any)
