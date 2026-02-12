Read ops/runner-state.json and ops/contracts/negrisk-milestones.json.
If lease valid + heartbeat fresh: SUPERVISOR_OK.
If stale/expired: mark stalled, increment attempt, append incident to BLOCKERS.md and STATUS.md.
Soft threshold: 45m warn.
Hard threshold: 2h pause + escalate.

Validation duties per milestone:
- ensure verify commands completed with pass status
- ensure artifact bundle exists
- ensure completion status is `done` or `noop_done` with explicit reason
- move to review_required on repeated gate failures
