Read ops/runner-state.json and ops/contracts/negrisk-milestones.json.
If lease valid + heartbeat fresh: SUPERVISOR_OK.
If stale/expired: mark stalled, increment attempt, append incident to BLOCKERS.md and STATUS.md.

Lease-repair policy:
- If heartbeat is fresh but `lease_expires_at` is null/missing, do NOT stall.
- Instead, record `lease_repaired=true`, set `lease_expires_at = now + 30m`, and continue.
- Stall only when heartbeat stale OR lease expired with no fresh heartbeat.
Soft threshold: 45m warn.
Hard threshold: 2h pause + escalate.

Validation duties per milestone:
- ensure verify commands completed with pass status
- ensure artifact bundle exists
- ensure completion status is `done` or `noop_done` with explicit reason
- move to review_required on repeated gate failures
