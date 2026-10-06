<!-- round=1 reviewed_sha=b2be516a9566b6e378fa5bf24981ac3ca775a8bc scope=full base=main reason="Round 1 (initial review)" -->

The new gate-setting guidance advertises a reroute recovery that is rejected for tasks outside the reroute-admitted phases, leaving the gate armed but ineffective on the ordinary resume path.

Review comment:

- [P2] Give a recovery path that works from the current phase — /Users/tstraub/canon-ai/.canon/worktrees/rearm-spec-gate/src/task/index.ts:1543-1543
  When `spec_review` is already done, this note directs the operator to `canon run --reroute`, but reroute only admits tasks at `code_review`, `qa`, or `human_review`. For example, immediately after the spec gate halts, the task is not reroute-eligible; a normal run will proceed without firing the newly armed gate. Point operators to a recovery path that is valid from the task’s current phase. This also conflicts with the repo’s instruction to trace new gates through recovery paths (`AGENTS.md`, Code Review Rules).