# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] The spec names three worktree-mode parser call sites, but the live code also calls the affected parsers from `scripts/run-task/phases/code-review.ts` and from `scripts/run-task/main.ts` implement-phase helpers (`autoCommitCode`, `tryEvidenceAdvance`).
[spec_review] `tryEvidenceAdvance()` still reads `review.md` in its `code_review` branch via `readArtifact(taskId, 'review.md')`, which is still REPO_ROOT-anchored. The revised spec does not cover that worktree-mode recovery read.
[spec_review] `tryEvidenceAdvance()` also reads `done.md` in its `qa` branch via `splitState.taskDirFor(taskId)`, which is still REPO_ROOT-anchored. That recovery path can still miss a worktree-written QA artifact.
