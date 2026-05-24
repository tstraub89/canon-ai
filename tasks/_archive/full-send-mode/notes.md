# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[spec_review] `canon run` does not currently parse `--force`; AC-3 needs a new CLI surface, not just a status.json check.
[spec_review] `commitHumanReviewFiles()` only opens a PR when `cliArgs.pr` is true, so the full-send tail needs extra plumbing or it will only push.
[spec] Revised AC-2/AC-3 to add `--force` as a first-class CLI flag (plumbed through `parseArgs` → `CliArgs.force`). Added AC-4a covering the `commitHumanReviewFiles` signature change (new required `createPR: boolean` parameter) so the full-send tail can force PR creation without setting `cliArgs.pr`. Tests in AC-12 extended to cover both new surfaces and the helper-signature refactor. Affected Files: `types.ts` and `cli.ts` rows updated to call out the new `CliArgs` fields and `--force` parsing; `src/cli/index.ts` row added for top-level help; `main.ts` row gains the `commitHumanReviewFiles` refactor hunk.
[spec_review iter 2] `reportOrCreatePR` returns void — the spec's "pipe URLs through" claim was unimplementable. AC-3 + AC-8 also didn't thread `--force` through the skill's invocation.
[spec] Added AC-4b: re-query PR URLs via existing `inspectCompleteState` (the same path `printCompleteStateBanner` uses) after `commitHumanReviewFiles` succeeds — avoids refactoring `reportOrCreatePR`'s return type. AC-7 wording updated. Added AC-8(e): `/canon-spec` skill auto-appends `--force` and surfaces a high-commitment acknowledgment block when the task is `delicate: true`. AC-10 CLAUDE.md guidance extended so operator Claude carries the same rule for direct-CLI invocations. AC-12 gains (f5)(f6) for URL capture happy/defensive paths.
[spec_review iter 3] AC-4b/AC-7 still implied multi-branch bundle support, but `commitHumanReviewFiles` only operates on one `cwd`/branch per call. Spec never specified the branch-grouping/per-branch helper loop, making multi-branch unimplementable from the described control flow.
[spec] Narrowed full-send to single-branch invocations (matches today's `--pr` reality). Added AC-4c: full-send tail asserts `new Set(taskIds.map(resolveTaskBranchName)).size === 1` before `checkPhaseGate` runs; multi-branch bundles die with an actionable message. AC-4b and AC-7 rewritten for the single-URL case. New Non-Goal explicitly listed. "Bundle mode" interaction dep corrected (today's `--pr` is one-branch-per-call, not per-task across branches). AC-12 gains (f7) for the guard.
[implement] `canon run --reroute` clears `full_send`, then immediately resumes `implement`, so the status check after reroute sees `implement.status = in_progress` rather than `pending`.
[implement-revision] Full-send helper tests need a spawned process for `ghAvailable` to resolve true; in-process imports see the module's initial PATH and fail closed on `--pr`.
[implement-revision] The PR banner can legitimately fall back to `(PR URL unavailable — check GitHub)` when `gh pr create` succeeds without leaving behind listable PR state.
[implement-revision] `commitHumanReviewFiles` also needs a local `ghAvailable` refresh when it is imported directly; otherwise helper coverage hits the `--pr requires the gh CLI` guard before the PR branch can be exercised.
[implement-reroute] `runNodeInline` now auto-redirects telemetry writes to a temp file; the suite-end docs cleanliness assert belongs in the last task-cli test file, not mid-suite, or it will race later tests.
[implement-reroute] Fast-tier spec_review auto-advance still requires populated `spec-review.md` and `plan.md` artifacts even when the gate is meant to stay open; the all-full-send skip path only reaches `plan` after both artifacts are present.
[implement-revision] Bundle-level handoff verification checks the committed diff against every task-artifact and docs path, so telemetry/QA docs like `docs/lessons-learned.md`, `docs/pipeline-invocations.md`, and `docs/task-quality-log.md` need explicit handoff rows even when the pipeline updates them automatically.




