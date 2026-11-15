<!-- round=1 reviewed_sha=7537f6ec52887cedbfebeaa56d08d310d558defb scope=full base=main reason="Round 1 (initial review)" -->

The new follow-up parser can silently accept and discard unstructured items after a `None.` line, defeating the QA gate and ship-time follow-up listing. The other reviewed changes and checks appear consistent.

Review comment:

- [P2] Require `None.` to be the only visible content — /Users/tstraub/canon-ai/.canon/worktrees/ship-followup-capture/src/orchestrator/followups.ts:41-42
  When a Follow-ups section has no table, any body containing a line equal to `None.` is accepted as empty, even if other prose or bullets follow it. Those items are then omitted from `--ship` output, and the QA gate incorrectly passes; accept this form only when `None.` is the sole visible body line.