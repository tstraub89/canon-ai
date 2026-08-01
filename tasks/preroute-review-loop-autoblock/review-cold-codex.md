The new pre-revision auto-block flow leaves a stale blocked review marker when only the deferred revision is run, causing watch to report an unrun review as successfully settled.

Review comment:

- [P2] Clear the stale review block after a stepped revision — /Users/tstraub/canon-ai/dev-worktrees/preroute-review-loop-autoblock/scripts/run-task/phases/implement.ts:36-40
  When the cap is raised and an operator resumes with `--step`, this gate runs the deferred `implement`/`spec` phase but leaves the previously auto-blocked review phase marked `blocked`. After that one phase exits, `canon watch --until code_review` (or `spec_review`) treats the dead blocked marker as settled and returns success even though the review has not run. Clear the review phase to `pending` when the deferred revision starts or completes, or make watch distinguish this deferred state.