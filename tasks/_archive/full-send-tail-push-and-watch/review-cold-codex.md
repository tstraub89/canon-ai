The patch weakens an existing test assertion, allowing unexpected source paths to go undetected. The other reviewed changes do not present a definite issue.

Review comment:

- [P2] Keep the base-drift source-path assertion broad — /Users/tstraub/canon-ai/.canon/worktrees/full-send-tail-push-and-watch/tests/run-task-safety.test.ts:6833-6833
  When this test encounters an unexpected source path other than `src/orchestrator/main.ts`, the narrowed regex allows it through. The base assertion rejected any `src/` path; keep that broader check so the test still detects unrelated source changes in the output.