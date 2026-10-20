<!-- round=1 reviewed_sha=b93273b933bd9f98749d723cd4ee1062ffd6026c scope=full base=main reason="Round 1 (initial review)" -->

The new crash detection can miss a non-zero exit marker when preceding agent stderr does not end with a newline, leaving the original false `step_done` result possible. The test suite passes, but does not cover this valid output sequence.

Review comment:

- [P2] Detect exit markers after unterminated stderr output — /Users/tstraub/canon-ai/.canon/worktrees/watch-crash-not-step-done/src/orchestrator/run-context.ts:35-35
  When an agent’s final stderr chunk has no trailing newline, it is written directly to the orchestrator’s stderr and the exit handler appends the marker immediately afterward. The marker then starts mid-line, so this anchored regex ignores it and `classifyIdle` can still report the crashed run as `step_done` with exit code 0. Ensure the writer delimits the marker or parse this valid marker form without accepting arbitrary embedded text.