# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[spec_review] `resolveTaskCwd()` can die on an expected-but-missing worktree; `doctor`/`stop` already fall back to `taskDirForRepoRoot()` via `isOrphanedWorktreeState()`.
[spec_review] `detachAndExit()` can fail to write `.canon-pid` for a task in a bundle, and `stop.ts` already has a heartbeat-only CASE C fallback. `watch` spec still does not say how to classify that live-but-pidfile-missing state.
[spec_review] `canon run` does not write a bootstrap heartbeat; `stop` explicitly waits for the first heartbeat tick before deciding. `watch` still has no launch-window wait, so invoking it immediately after detach can see a live process with missing heartbeat and misclassify it.
[spec_review] `stop` already treats "both `.canon-pid` and heartbeat present but disagree" as a real live-run state when the heartbeat pid is alive and fresh. AC-2/13 still only spell out the missing-pid fallback, so `watch`'s live-pid selection remains under-defined for stale-pid / fresh-heartbeat disagreement.
[implement] `doctor` needed a task-dir resolver override so `checkActiveOrchestrators(cwd)` could read the temp fixture root instead of the repo-root task tree.
[implement] `tests/cli.test.ts`'s `MIN_VALID_STATUS` needed an `id` field once the shared status guard started validating the fixture shape.
[implement] `tests/run-task-validation.test.ts` still trips `readStatus()` on a missing `status.json` in `verifyBaseDrift: two-dot diff catches base-advance drift that three-dot would miss`; left as an unrelated failure outside the task's affected files.
[implement-revision] `npm test` also trips `tests/task-cli.test.ts`'s `docs telemetry files stay clean after the suite` check because `docs/pipeline-invocations.md` is dirty after the suite run; keep that in the handoff as an unrelated failure, not a code bug.
[implement-revision] The pre-flight gate rejects a bare `Fail` in the handoff validation table even when the notes call it unrelated; use `Fail – unrelated` plus a file-specific repro path.
[implement-revision] `readStatus()` must preserve throw semantics; converting it to `die()` breaks callers that intentionally wrap it in `try/catch` for fallback behavior.
[implement-revision] `doctor` should use the shared resolver directly; forcing `cwd/tasks/<id>` through `resolveTaskDirImpl` hides worktree-backed task state.
[implement-revision] `watch`'s checkpoint should key off a real `human_review` snapshot and source the verdict from code_review, not an impossible `human_review.status === done` state.
[implement-reroute] `watch` needs a dedicated ambiguous-PID refusal path; reusing the live branch would let a disagreed `.canon-pid` / heartbeat pair attach to the wrong process.
[implement-reroute] The live phase-transition line needs spaced arrows on stderr (`spec_review → plan`), while the summary-line `phase=` field stays compact (`qa→human_review`); they need separate formatters.



