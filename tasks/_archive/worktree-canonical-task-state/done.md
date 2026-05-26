# QA Summary: worktree-canonical-task-state

## What Changed

**The problem**: canon kept two copies of task state during pipeline execution — the worktree at `dev-worktrees/<id>/tasks/<id>/` and REPO_ROOT at `tasks/<id>/`. A sync loop copied from worktree → REPO_ROOT after each phase. This produced two known-bad bugs from 1.4.0:

1. `parseAffectedFilesFromSpec` and sibling parsers read from REPO_ROOT's stale copy, so spec amendments made in the worktree weren't seen by the `--pr` allow-list gate.
2. `--ship`'s post-squash-merge `git pull origin main` failed because REPO_ROOT had uncommitted task artifact modifications written by the sync.

**The fix**: worktree is now canonical for task-scoped state from implement-phase start onward. REPO_ROOT is canonical for project-level resources and pre-implement task state. The sync functions are deleted entirely.

**Structural changes**:
- **`taskDirForRepoRoot` extracted** — private REPO_ROOT-only resolver that breaks the recursion that would have occurred if `taskDirFor` had been naïvely rewired (it was called by `resolveTaskCwd`, which `taskDirFor` would have called back).
- **`taskDirFor` rewired** to route through `resolveTaskCwd`, making every consumer automatically worktree-aware. Pre-implement callers are unaffected (no worktree exists yet → REPO_ROOT returned).
- **Sync machinery deleted**: `syncWorktreeArtifacts`, `syncWorktreeTelemetry`, `flushWorktreeTelemetry`, `mirrorHumanReviewDocsToCwd`, and both REPO_ROOT → worktree copy loops in `implement.ts` / `code-review.ts`.
- **CLI commands made worktree-aware**: `canon task status/list/accept/phase` now read from the worktree when one exists past plan, so mid-pipeline status queries show live state instead of frozen scaffold values.
- **Metrics land in worktree**: `getMetricsFile` accepts an optional `activeCwd`; all phase modules supply `getActiveCwd(taskIds)` via `MetricEntry.activeCwd`, so post-implement `pipeline-invocations.md` appends land in the worktree.
- **Pre-implement telemetry absorbed at scaffold time**: `commitTaskArtifactsToBase` now commits dirty `PIPELINE_TELEMETRY_FILES` in a separate absorption commit after per-task scaffold commits, keeping REPO_ROOT clean once the worktree is created.

## Files Changed

Core resolver and sync:
- `scripts/run-task/state.ts` — new `taskDirForRepoRoot`, rewired `taskDirFor`, fixed `resolveTaskCwd` self-reference
- `scripts/run-task/worktree.ts` — deleted `syncWorktreeArtifacts`, `syncWorktreeTelemetry`, `flushWorktreeTelemetry`, and shared-doc mirror helper
- `scripts/run-task/main.ts` — removed post-phase sync calls, deleted `mirrorHumanReviewDocsToCwd`, fixed post-teardown archive resolution
- `scripts/run-task/git.ts` — path-restricted scaffold commits with `--only`, telemetry absorption phase
- `scripts/run-task/phases/implement.ts` — deleted REPO_ROOT → worktree copy loop
- `scripts/run-task/phases/code-review.ts` — deleted REPO_ROOT → worktree copy loop

CLI worktree-awareness:
- `src/task/index.ts` — `taskDirForCwd` rewired to use `resolveTaskCwd`; `taskList()` reads per-entry via `taskDirForCwd`

Metrics threading:
- `scripts/run-task/metrics.ts` — `getMetricsFile(activeCwd?)` optional param
- `scripts/run-task/types.ts` — `MetricEntry.activeCwd?: string`
- `scripts/run-task/agents/claude.ts`, `agents/codex.ts` — `activeCwd` in metrics context
- `scripts/run-task/phases/spec.ts`, `spec-review.ts`, `plan.ts`, `implement.ts`, `code-review.ts`, `qa.ts` — `activeCwd: getActiveCwd(taskIds)` in `metricsContext`

Docs:
- `CLAUDE.md` + `templates/CLAUDE.md` — reroute convention inverted; CLI commands documented as worktree-aware
- `docs/architecture.md` — worktree-canonical model description
- `docs/decisions.md` — new decision entry with `taskDirForRepoRoot` rule
- `docs/codebase-map.md` — `worktree.ts` row updated to lifecycle-only
- `docs/patterns.md` — worktree-state pitfall annotated for partial coverage
- `docs/pipeline-orchestrator.md` + `templates/docs/pipeline-orchestrator.md` — reroute/worktree sections updated
- `scripts/run-task/prompts/templates/implement-reroute.md` — explicit worktree cwd direction added

Tests:
- `tests/run-task-safety.test.ts` — 4 deleted `syncWorktreeTelemetry` tests; new state, parser-cwd, telemetry-absorption, and implement SSOT tests
- `tests/task-cli.test.ts` — worktree-aware status/list/accept coverage
- `tests/run-task-reroute-preflight.test.ts` — updated for live worktree spec
- `tests/run-task-prompts.golden.json` — regenerated for reroute template text

Build artifacts:
- `dist/cli/index.js`, `dist/scripts/run-task.js` — regenerated

## How to Test

1. Create a worktree-mode task and advance it to `human_review` via `canon run <id>`.

2. **Parser-cwd test (closes 1.4.0 known limitation)**: edit `tasks/<id>/spec.md` in the worktree to add a managed doc to `### Affected Files`. Do NOT mirror the edit to REPO_ROOT. Run `canon run <id> --pr` from REPO_ROOT. Expected: gate reads the worktree's spec, permits the commit, PR opens. Pre-fix: gate read REPO_ROOT's stale copy and died.

3. **`--ship` pull test (closes 1.4.0 known limitation)**: run `canon run <id> --ship` after the PR is ready. Expected: `git pull origin <base>` succeeds — REPO_ROOT has no uncommitted task-artifact files. Pre-fix: pull failed with uncommitted `done/handoff/notes/review.md` conflicts.

4. **Pre-implement correctness**: create a task, stop at spec phase. Confirm `tasks/<id>/spec.md` is at REPO_ROOT. Run `canon task status <id>` from REPO_ROOT — should report pre-implement state correctly (no worktree exists yet).

5. **CLI worktree-awareness**: while a task is mid-pipeline at implement or later, run `canon task status <id>` from REPO_ROOT. Should reflect the worktree's live status.json, not the frozen scaffold.

6. **No recursion smoke test**: run `canon run <id>` on any task. If `taskDirFor` recurses, the orchestrator stack-overflows on entry. Any passing run confirms AC-3 is intact.

## Test Results

| Check | Result |
|---|---|
| Lint | Pass |
| Type-check | Pass |
| Unit tests | Pass (479 tests: 478 pass, 1 skipped) |
| E2E tests | N/A — no UI |
| Build | Pass |
| `docs-refs-check` | Pass |
| `sync-templates:check` | Pass |

## Decisions Made

- **`taskDirForRepoRoot` as a private escape hatch** rather than threading `cwd` parameters: the earlier parser-cwd task tried parameter threading and accumulated 3 spec_review rounds catching missed call sites. A private function restricted to REPO_ROOT semantics is self-documenting and cannot be misapplied from worktree contexts.
- **AC-22g (telemetry discrimination gate) carved out to BACKLOG**: after 5 spec_review iterations each catching new edge cases in the per-file parser design, the gate was deferred. The successor uses byte-offset snapshotting (format-agnostic, ~110 lines). **Interim mitigation**: before `canon run <id>` on a new task, ensure `git status --porcelain -- docs/pipeline-invocations.md docs/task-quality-log.md docs/lessons-learned.md` is clean.
- **Telemetry absorption is unconditional** (no foreign-task discrimination): cross-task contamination is detectable in PR review (rows contain task IDs) and recoverable via `git revert`. The structural gate is the BACKLOG follow-up.

## Open Questions / Follow-ups

- **Telemetry discrimination gate** (BACKLOG): byte-offset snapshotting to prevent cross-task telemetry misattribution at scaffold-commit time. Interim mitigation is operator discipline.
- **Per-phase commit redesign** (QA-end-commit BACKLOG entry): the worktree-uncommitted class (operator `git reset --hard` discards uncommitted post-implement state) persists — this task closes the stale-mirror class but not the uncommitted class.
- **Managed-doc cross-worktree sync** (sync-rewrite BACKLOG): project-level managed docs stay REPO_ROOT-canonical with no in-pipeline sync to worktrees. Parallel-pipeline work that updates managed docs in one worktree won't be visible to another until merge.

---

## Proposed Changelog

> For inclusion in `CHANGELOG.md` under `## [1.5.0] — unreleased`, `### Fixed`.

```markdown
- **`canon task status`, `list`, `accept`, and `phase` read live worktree state past plan.**
  Previously these CLI commands always read REPO_ROOT's scaffold copy, returning frozen
  pre-implement values even mid-pipeline. Now they route through `resolveTaskCwd` and return
  the worktree's current `status.json` when one exists, so `canon task status <id>` from
  REPO_ROOT reflects implement/code-review/QA progress without requiring a `cd` into the worktree.

- **`canon run --pr` auto-commit and base-drift gates now read the worktree's `spec.md`.**
  `parseAffectedFilesFromSpec` and its sibling parsers previously read from REPO_ROOT's
  pre-implement scaffold. Operator amendments to the spec in the worktree were invisible to
  the gates, causing allow-list rejections for legitimate managed-doc edits. Parsers now route
  through `taskDirFor` which resolves to the worktree past plan. Closes the
  "parseAffectedFilesFromSpec reads REPO_ROOT in worktree mode" known limitation from 1.4.0.

- **REPO_ROOT no longer accumulates stale task-artifact files that block `git pull` during `--ship`.**
  The worktree → REPO_ROOT sync (`syncWorktreeArtifacts`) that wrote `done.md`, `handoff.md`,
  `notes.md`, and `review.md` into the main checkout during pipeline execution is removed.
  The squash-merge delivers final task artifacts atomically; REPO_ROOT stays clean between
  phases, so `--ship`'s `git pull origin <base>` no longer fails with uncommitted-modification
  conflicts. Closes the "main-repo accumulates stale artifacts" known limitation from 1.4.0.
```

**Version bump**: no additional bump — these fixes land in the open `1.5.0` unreleased block.
