Operate ONLY in /workspace/projects/bot.
Use /workspace/projects/bot/PLAN.md and /workspace/projects/bot/ops/contracts/negrisk-milestones.json as source of truth.
If PLAN.md missing OR `AUTOPILOT_APPROVED: true` absent: NOOP.

Execute ONE bounded chunk per run (max 15m): preflight -> implement -> verify -> artifact -> report.
Preflight command (required): `npm run negrisk:preflight`; if it fails, set blocked_preflight and stop run.
Update ops/runner-state.json at start/end heartbeat.

Required per milestone:
- run listed verify commands
- produce artifact bundle under artifacts/milestones/<milestone>/<timestamp>/
- write assertions.json and commands.log

Completion policy:
- done: verify passes and repo has changes committed
- noop_done: verify passes + artifacts exist + explicit noop reason

If tests fail: no commit; append blocker to BLOCKERS.md.
If blocked twice on same milestone: mark stalled and stop run.
