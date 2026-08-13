# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] Runtime-check cleanup must account for dirty task artifacts: after implement, code files may be committed while `tasks/<id>/handoff.md` remains an uncommitted worktree artifact, so stash/drop-all cleanup can erase the handoff.

[spec_review_revision_v5] Addressed Codex's round-4 finding:
- AC-13 rewrote the capture model as **two independent sinks per stream**: (1) full-fidelity disk file (`stdout.log` / `stderr.log`, unbounded, streamed directly to disk during the check — AC-11's source) and (2) bounded 2KB head-truncated in-memory buffer (handoff Notes excerpt + summary display). This resolves the previous contradiction between AC-13's "2KB capture buffer" and AC-11's "full, untruncated" log files. AC-11 step 4 reworded to reference the AC-13 disk sink instead of the in-process buffer. AC-10 grew a regression test asserting (a) 100KB-stderr disk file is full-fidelity, (b) handoff Notes cell is 512 bytes, (c) prompt content is 2KB.

[spec_review_revision_v4] Addressed Codex's round-3 findings:
- AC-11 step 4 rewrote artifact preservation as two independent paths: declared `artifactPaths` copies verbatim regardless of `git status` visibility or gitignore state (the explicit-intent surface — required for Playwright traces in gitignored `test-results/`, etc.); implicit fallback uses the delta only when no `artifactPaths` declared. Intersect-with-delta rule eliminated — it silently dropped explicit intent.
- AC-12 stderr source order made explicit: prefer reading `stderr.log` from disk (2KB head-truncated), fall back to 512-byte handoff excerpt with a `[stderr.log missing ...]` annotation so Codex knows. AC-10 grew tests for both gitignored-artifact preservation and the stderr source order.

[spec_review_revision_v3] Addressed Codex's three new findings (round 2 of spec review):
- AC-9b NEW: `getIterations()` only reads `code_review.iterations`, so a runtime-only failure would route back to implement with `TaskContext.iterations === 0` and Codex would receive the fresh prompt instead of the revision prompt. Fix: add `runtimeIterations` field to `TaskContext`, update `runImplementPhase`'s `isRevision` check to OR both counters. Tests in AC-10 cover.
- AC-12 + AC-12b: existing `implement-revisions.md` template is code-review-specific (says "Claude appended findings to review.md", reads `## Round N`). Runtime-only first-failure has no review.md, no `## Round 0`. Fix: restructure builder + template with two Handlebars conditional blocks driven by `hasReviewFindings` and `hasRuntimeFailures` flags, with conditional banner/handoff-append wording. AC-10 covers all three composition shapes.
- AC-12 nit: replaced stale `runtime_validation.verdict = 'failed'` with `'changes_requested'`.

[spec_review_revision] Addressed Codex's four findings in spec v2:
- AC-11 rewritten to use pre/post `git status --porcelain` delta cleanup that explicitly excludes `tasks/` (no blanket `git stash`). New test case in AC-10 exercises pre-existing-dirty-task-artifacts invariant.
- AC-4, AC-6, AC-9, AC-10, AC-4b, dispatch-flow block, and Data Model section all aligned: `status = 'done'` always when phase completes; verdict reuses existing `Verdict` type (`'approved'` / `'changes_requested'`) — no widening, follows code_review's failure convention so `checkAndRoute`'s "phase must be done" guard at `main.ts:1404–1416` passes.
- AC-4 adds an optional `checks?: readonly RuntimeCheck[]` test seam parameter to `runRuntimeValidationPhase` so tests don't have to mutate ESM-imported `RUNTIME_CHECKS`.
- Dispatch-flow textual block now says `spawn` (matches AC-13), not `spawnSync`.

[spec_review] Runtime-validation reroutes need their own implement prompt state: current `TaskContext.iterations` is derived from code_review iterations only, so a runtime-only failure can look like a fresh implement pass.

[spec_review] `git status --porcelain -uall` excludes ignored files; runtime artifact preservation cannot rely only on status deltas if e2e reports/traces live in ignored paths.

[implement] In linked worktrees, resolving repo root via `git rev-parse --git-common-dir` points at the supervising checkout's `.git` parent, not the active worktree. Use `git rev-parse --show-toplevel` when paths/artifacts must be worktree-local.

[implement] Cleanup tests that assert `git status` delta behavior must write non-ignored fixture paths; ignored `*.tmp` files do not appear in porcelain output and therefore cannot exercise scoped delta cleanup.
