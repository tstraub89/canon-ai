# Spec: worktree-canonical-task-state — Worktree-canonical task state from implement onward

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

canon-ai maintains **two copies of task state** for worktree-mode tasks. The worktree at `dev-worktrees/<id>/tasks/<id>/` and REPO_ROOT at `tasks/<id>/`. They are kept in time-lagged sync via `syncWorktreeArtifacts` ([worktree.ts:215](../../scripts/run-task/worktree.ts:215), worktree → REPO_ROOT after each phase) and `syncWorktreeTelemetry` ([worktree.ts:245](../../scripts/run-task/worktree.ts:245), bidirectional with selective reset of telemetry files). The pipeline writes into the worktree; the sync copies a snapshot back to REPO_ROOT. REPO_ROOT's `tasks/<id>/` is a *lazy mirror*, not a source of truth, during pipeline execution.

This dual-source model produces a class of bugs already filed and partially fixed:

- **parser-cwd-worktree-mode (archived 2026-05-23)** — `parseAffectedFilesFromSpec` and three sibling parsers read from `taskDirFor(taskId)` at [state.ts:34](../../scripts/run-task/state.ts:34), which returns `REPO_ROOT/tasks/<id>`. Worktree-context callers see REPO_ROOT's stale copy. Bug bit during prepr-base-drift-check's `--pr` cycle. The parser-cwd task tried to thread an explicit `cwd` parameter through; Codex's spec_review iterated 3 times catching missed call sites and the plumbing turned out to be throwaway under SSOT.
- **GP `--ship` post-merge-pull failure (2026-05-23, BACKLOG.md:9 evidence sub-bullet)** — `canon run --ship` for posthog-bootstrap-identity successfully squash-merged PR #101 and deleted the remote task branch, then failed at `git pull origin main` because the main worktree had unstaged modifications to `tasks/<id>/{done,handoff,notes,review}.md`. Source: the worktree → REPO_ROOT sync wrote these without committing.
- **Operator git surgery between phases** (`docs/patterns.md` "Operator git surgery on a task branch between phases discards uncommitted pipeline state") — `git reset --hard` in the worktree reverts uncommitted post-implement state to the scaffold-commit version. canon's dispatcher then re-dispatches implement based on the reverted status.json. **NOT closed by this task alone** — uncommitted-state-in-worktree is a separate fragility tracked by the QA-end-commit BACKLOG entry; but this task eliminates the *additional* fragility from REPO_ROOT's stale mirror.

The root cause is the dual-source model itself. The sync papers over the dissonance but introduces ambiguity (both surfaces "live"), visible dirty state in REPO_ROOT during pipelines (tempting cleanup commits), `--ship` pull conflicts (exactly GP's bug), and stale parser reads (exactly parser-cwd's bug).

## Scope precision

The change is **worktree-canonical for task-scoped state during pipeline execution**. "Task-scoped state" includes:

- **Task artifacts** in `tasks/<id>/` (spec.md, plan.md, handoff.md, review.md, done.md, notes.md, status.json)
- **Per-task telemetry** in `docs/pipeline-invocations.md`, `docs/task-quality-log.md`, `docs/lessons-learned.md` — these files live at project paths but their rows describe individual tasks; under SSOT, post-plan invocations append to the worktree, not REPO_ROOT
- **Operator-facing task state queries** via `canon task status / list / accept / phase` — these CLI commands now read from the worktree when one exists past plan, so the operator sees live pipeline state instead of frozen scaffold state

**REPO_ROOT remains canonical for**:

- **Project-level resources** that describe the project (managed docs: `docs/codebase-map.md`, `docs/decisions.md`, `docs/patterns.md`, `docs/architecture.md`, `docs/product-context.md`, `docs/pipeline-orchestrator.md`, plus `scripts/`, `src/`, `.canon/`, root agent files). These describe the project, not any one task. Cross-task sync of managed docs is governed by the separate sync-rewrite BACKLOG entry.
- **Pre-implement task state**: spec, plan, status.json BEFORE the worktree exists. `resolveTaskCwd` correctly returns REPO_ROOT at this stage.

It is NOT strict single-source-of-truth across the entire repo — that's a stronger claim than the design supports. The model is "worktree is canonical for task-scoped state from implement-phase start onward; REPO_ROOT is canonical for project-level resources and pre-implement state."

## Decision

**Two structural changes** that together make the worktree canonical for task artifacts from implement-phase onward:

### Change 1 — extract `taskDirForRepoRoot` + rewire `taskDirFor`

A naïve rewire of `taskDirFor` to route through `resolveTaskCwd` creates **infinite recursion**: `resolveTaskCwd` at [state.ts:45](../../scripts/run-task/state.ts:45) currently calls `taskDirFor` to read status.json. Rewiring `taskDirFor → resolveTaskCwd` makes that call recursive.

Fix: extract a private REPO_ROOT-only resolver `taskDirForRepoRoot(taskId)` in `scripts/run-task/state.ts`. Its body is the current `taskDirFor` implementation: `return path.join(process.env.CANON_TASKS_DIR_OVERRIDE ?? TASKS_DIR, taskId)`. Used by:

- `resolveTaskCwd` (for the status-read at line 45 — breaks the recursion)
- `commitTaskArtifactsToBase` ([git.ts:86](../../scripts/run-task/git.ts:86)) — intentionally REPO_ROOT-anchored; writes the initial scaffold commit
- The archive-move at [main.ts:1692](../../scripts/run-task/main.ts:1692) — runs AFTER `teardownWorktree`; worktree no longer exists, must read REPO_ROOT directly

Then rewire `taskDirFor` itself: `return path.join(resolveTaskCwd(taskId), 'tasks', taskId)`. Every other consumer of `taskDirFor` automatically becomes worktree-aware via this single change. Pre-implement phases (no worktree → `resolveTaskCwd` returns REPO_ROOT) are unaffected.

### Change 2 — delete the sync machinery

- `syncWorktreeArtifacts` at [worktree.ts:215-243](../../scripts/run-task/worktree.ts:215) — DELETE. Call site at [main.ts:2404](../../scripts/run-task/main.ts:2404) removed.
- `syncWorktreeTelemetry` at [worktree.ts:245-352](../../scripts/run-task/worktree.ts:245) — DELETE. Call site at [main.ts:2405](../../scripts/run-task/main.ts:2405) removed.
- The REPO_ROOT → worktree copy loop at [implement.ts:48-64](../../scripts/run-task/phases/implement.ts:48) — DELETE. The worktree inherits the scaffold via `commitTaskArtifactsToBase`'s one-time initial commit (already gated since 69917f8). Worktree creation happens in `getActiveCwd(taskIds)` at [implement.ts:66](../../scripts/run-task/phases/implement.ts:66) which calls `ensureWorktree` — preserved by NOT deleting line 66.
- The analogous REPO_ROOT → worktree copy in `runCodeReviewPhase` at [code-review.ts:95](../../scripts/run-task/phases/code-review.ts:95) — also DELETE; same rationale (worktree already has the spec/plan from branch creation).
- `flushWorktreeTelemetry` — confirmed dead code post-d7c2dbc; DELETE the function declaration alongside (zero callers per grep).

### Change 3 — CLI commands become worktree-aware past plan

The CLI commands (`canon task status / list / accept / phase`) in [src/task/index.ts](../../src/task/index.ts) use their own private helper `taskDirForCwd(cwd, taskId)` at [src/task/index.ts:65](../../src/task/index.ts:65), NOT the rewired `taskDirFor` in `scripts/run-task/state.ts`. They take an explicit `cwd` parameter (typically `process.cwd()`).

Under this task, `taskDirForCwd` in `src/task/index.ts` is updated to apply the same worktree-resolution logic as `resolveTaskCwd`. Specifically: read REPO_ROOT's status.json; if `worktree: true` AND `branch: <name>` AND `dev-worktrees/<id>/` exists, return the worktree's task dir; otherwise return REPO_ROOT's. Implementation reuses `resolveTaskCwd` by importing it from `scripts/run-task/state.ts` (cross-module dependency; tsup bundles both into dist cleanly).

The practical effect: `canon task status <id>` mid-pipeline reads live worktree state. Operators (Claude or human) get current data, not frozen scaffold values. The previous asymmetry — pipeline-internal callers worktree-aware, CLI callers REPO_ROOT-anchored — was a footgun (mid-pipeline status reads would show stale values); this change closes it.

`canon task new` is a special case: it creates the task dir at REPO_ROOT before any worktree exists. Its existing behavior is preserved — `resolveTaskCwd` returns REPO_ROOT pre-implement (worktree not created yet), so the rewire is a no-op for `canon task new`.

### Change 4 — Telemetry writes land in worktree past plan

The orchestrator's metrics writer at [scripts/run-task/metrics.ts:7-11](../../scripts/run-task/metrics.ts:7) currently hardcodes `path.join(REPO_ROOT, 'docs/pipeline-invocations.md')`. Under this change, `getMetricsFile` accepts an optional `activeCwd` parameter (defaulting to REPO_ROOT for backward-compat). Callers in `main.ts` pass `getActiveCwd(taskIds)` so post-implement appends land in the worktree's `docs/pipeline-invocations.md` while pre-implement (no worktree) appends land in REPO_ROOT.

QA-phase writes to `docs/task-quality-log.md` and `docs/lessons-learned.md` by the agent (Claude) already happen in the worktree because the agent's cwd is `activeCwd` (the worktree). Under this task: no change to those writes — they were already worktree-correct; the deleted sync was the part that copied them back to REPO_ROOT (causing GP's bug class). With `syncWorktreeArtifacts` + `syncWorktreeTelemetry` deleted, the worktree's telemetry stays in the worktree until squash-merge.

`mirrorHumanReviewDocsToCwd` at [main.ts:647](../../scripts/run-task/main.ts:647) currently mirrors REPO_ROOT's telemetry → worktree before `commitHumanReviewFiles`. Under the new design, that mirror is BACKWARDS — the worktree's telemetry is already canonical post-plan; copying REPO_ROOT's content (which has only pre-implement appends) would overwrite valid content with partial content. DELETE the function and remove its call site at [main.ts:905](../../scripts/run-task/main.ts:905).

### Change 5 — `commitTaskArtifactsToBase` absorbs pre-implement REPO_ROOT telemetry

Pre-implement phases (spec_review, plan) write to REPO_ROOT's `docs/pipeline-invocations.md` (and potentially other telemetry files) because no worktree exists yet. These few appended rows leave REPO_ROOT dirty until — historically — the sync would clean them up. With the sync deleted, the dirt would persist.

Solution: expand `commitTaskArtifactsToBase` at [git.ts:83](../../scripts/run-task/git.ts:83) to also stage and commit dirty `PIPELINE_TELEMETRY_FILES` at scaffold-commit time. The scaffold absorbs pre-implement telemetry. REPO_ROOT is clean after `runImplementPhase` starts.

The expanded body iterates `PIPELINE_TELEMETRY_FILES`, checks each for dirty status via `git status --porcelain --`, stages and commits with the existing scaffold message (`task(<id>): commit artifacts pre-pipeline`). This codifies the discipline operator Claude already follows manually (commit clean state before spawning the worktree).

### Change 6 — operator-facing surface updates

- `CLAUDE.md` "Reroute" section — invert convention from "edit in MAIN" to "edit the worktree's spec.md when a worktree exists; edit REPO_ROOT only when no worktree exists (pre-implement state)."
- `scripts/run-task/prompts/templates/implement-reroute.md` line ~15 — explicit direction: "Read `tasks/<id>/spec.md` from your current working directory (the worktree). REPO_ROOT's copy is the pre-implement scaffold and does NOT contain operator amendments."
- `docs/patterns.md` worktree-git-fragility pitfall — annotate that this task closes the stale-mirror class but the worktree-uncommitted class persists (QA-end-commit BACKLOG entry is the structural fix for that).

### What `PIPELINE_MANAGED_DOCS` does NOT do

Project-level managed docs (codebase-map, decisions, patterns, architecture, product-context, pipeline-orchestrator) stay REPO_ROOT-canonical. They describe the project, not specific tasks. Cross-task sync of managed docs is governed by the separate sync-rewrite BACKLOG entry; not addressed here.

## Comprehensive `taskDirFor` audit (22 sites)

| # | Site | Function | Operational Context | Classification under SSOT |
|---|------|----------|---------------------|---------------------------|
| 1 | [state.ts:45](../../scripts/run-task/state.ts:45) | `resolveTaskCwd` | Inside `resolveTaskCwd` for status read | **Breaking (recursion)** — must switch to `taskDirForRepoRoot` |
| 2 | [git.ts:86](../../scripts/run-task/git.ts:86) | `commitTaskArtifactsToBase` | Writes scaffold commit to base branch | **Breaking** — must switch to `taskDirForRepoRoot` |
| 3 | [main.ts:1692](../../scripts/run-task/main.ts:1692) | archive-move in `shipTasks` | Runs AFTER `teardownWorktree` | **Breaking** — must switch to `taskDirForRepoRoot` |
| 4 | [main.ts:182](../../scripts/run-task/main.ts:182) | `appendAutoCommitDebug` | Writes debug notes to `notes.md` during auto-commit | **Correct** — worktree is canonical for notes during pipeline |
| 5 | [main.ts:1984](../../scripts/run-task/main.ts:1984) | `readArtifact` | Reads any artifact for phase logic | **Correct** — worktree is canonical |
| 6 | [main.ts:2012](../../scripts/run-task/main.ts:2012) | `tryEvidenceAdvance` (implement spec read) | Reads spec via `validateHandoffAgainstSpec` | **Correct** |
| 7 | [main.ts:2013](../../scripts/run-task/main.ts:2013) | `tryEvidenceAdvance` (implement handoff read) | Same flow | **Correct** |
| 8 | [main.ts:2083](../../scripts/run-task/main.ts:2083) | `tryEvidenceAdvance` (qa done.md read) | Reads `done.md` for QA evidence | **Correct** — done.md lives in worktree |
| 9 | [validation.ts:72](../../scripts/run-task/validation.ts:72) | `validateHandoff` (handoff path) | Validation gate | **Correct** — worktree is canonical |
| 10 | [validation.ts:73](../../scripts/run-task/validation.ts:73) | `validateHandoff` (spec path) | Same | **Correct** |
| 11 | [validation.ts:511](../../scripts/run-task/validation.ts:511) | `resolveTaskDirForValidation` | Wraps `taskDirFor` with `taskDirOverride` for tests | **Correct** — test override path preserved; no-override path becomes worktree-aware |
| 12 | [validation.ts:622](../../scripts/run-task/validation.ts:622) | `parseHandoffChangesRows` | Reads handoff for gate | **Correct** |
| 13 | [validation.ts:654](../../scripts/run-task/validation.ts:654) | `parseAffectedFilesFromSpec` | Reads spec for v2/Fix 1 gates — **the parser-cwd bug fix** | **Correct** |
| 14 | [context.ts:10](../../scripts/run-task/context.ts:10) | `extractAffectedFiles` | Reads spec for Codex implement prompt | **Correct** — worktree spec includes amendments |
| 15 | [context.ts:85](../../scripts/run-task/context.ts:85) | `buildKnownRisks` | Reads spec for prompt | **Correct** |
| 16 | [context.ts:128](../../scripts/run-task/context.ts:128) | `extractValidationChecks` | Reads spec for prompt | **Correct** |
| 17 | [context.ts:145](../../scripts/run-task/context.ts:145) | `extractAcSummary` | Reads spec for prompt | **Correct** |
| 18 | [plan.ts:31](../../scripts/run-task/phases/plan.ts:31) | `runPlanPhase` plan.md write | Plan phase runs pre-implement (no worktree yet) | **Correct** — returns REPO_ROOT pre-implement |
| 19 | [implement.ts:52](../../scripts/run-task/phases/implement.ts:52) | REPO_ROOT → worktree copy loop source | About to be deleted | **Deleted with the loop** |
| 20 | [code-review.ts:95](../../scripts/run-task/phases/code-review.ts:95) | code-review REPO_ROOT → worktree copy source | About to be deleted | **Deleted with the loop** |
| 21 | [main.ts:98](../../scripts/run-task/main.ts:98) | re-export `const taskDirFor = splitState.taskDirFor` | Just a binding | **Correct** — rewire propagates |
| 22 | [tests/run-task-validation.test.ts:1400](../../tests/run-task-validation.test.ts:1400) | comment reference | Doc | **N/A** — not a runtime call |

**Note on `buildKnownPitfalls`**: at [context.ts:71-81](../../scripts/run-task/context.ts:71). Reads from `REPO_ROOT/docs/patterns.md` (project-level managed doc, NOT a task file). This is correct under SSOT — managed docs at the project level stay REPO_ROOT-canonical. No change needed.

**Additional out-of-table sites** affected by Change 3 (CLI worktree-awareness) and Change 4 (telemetry-in-worktree):

| Site | Function | Current behavior | Change |
|------|----------|------------------|--------|
| [src/task/index.ts:65-70](../../src/task/index.ts:65) | `taskDirForCwd(cwd, taskId)` | Returns `path.join(cwd, root, taskId)` — cwd-relative path resolution; not worktree-aware | Rewired to use `resolveTaskCwd` semantics: read REPO_ROOT's status.json, return worktree path if `worktree: true` + branch set + worktree exists, else cwd-relative path |
| [src/task/index.ts:377, 471, 733, 761](../../src/task/index.ts:377) | Callers of `taskDirForCwd` in `canon task status / list / accept / phase / new` | Use the cwd-relative result | Automatically inherit the new behavior |
| [scripts/run-task/metrics.ts:7-11](../../scripts/run-task/metrics.ts:7) | `getMetricsFile()` | Returns `path.join(REPO_ROOT, 'docs/pipeline-invocations.md')` (hardcoded REPO_ROOT) | Accepts optional `activeCwd` parameter; returns `path.join(activeCwd, 'docs/pipeline-invocations.md')`. Default `REPO_ROOT` for backward-compat. |
| `recordMetric` callers in `main.ts` (orchestrator's per-agent-invocation logging) | Pass no cwd to `getMetricsFile` today | Pass `getActiveCwd(taskIds)` so post-implement appends land in worktree |
| [main.ts:647-678](../../scripts/run-task/main.ts:647) | `mirrorHumanReviewDocsToCwd` | Mirrors `PIPELINE_TELEMETRY_FILES` REPO_ROOT → worktree before `commitHumanReviewFiles` | DELETED — backwards under SSOT past plan; worktree's telemetry is already canonical |
| [main.ts:905](../../scripts/run-task/main.ts:905) | Call site of `mirrorHumanReviewDocsToCwd` in `commitHumanReviewFiles` | Invokes the mirror | Removed (function is deleted) |
| [git.ts:83-93](../../scripts/run-task/git.ts:83) | `commitTaskArtifactsToBase(taskIds, _artifactFiles)` | Stages `tasks/<taskId>/` paths; commits with scaffold message | Also stages dirty `PIPELINE_TELEMETRY_FILES` if any; absorbs pre-implement REPO_ROOT telemetry into the scaffold commit |

## Non-Goals

- **`canon task open <id>` helper** — operator is Claude 99% of the time; Claude reads via absolute paths and tooling, not `$EDITOR`. Defer to a follow-up if human-operator dogfood reveals friction.
- **Per-phase commit redesign** (the QA-end-commit BACKLOG entry) — SSOT doesn't commit task artifacts more frequently; it just eliminates the second copy. The worktree-uncommitted-state class (operator `git reset --hard` discards uncommitted state) STAYS relevant. Separate fix.
- **`commitTaskArtifactsToBase`'s gate** — the `worktreeAlreadyCreated` check at [implement.ts:42-44](../../scripts/run-task/phases/implement.ts:42) stays unchanged. Under this task it remains load-bearing: ensures base only ever has the initial scaffold, never updated.
- **Managed-doc sync between worktrees** (parallel-pipelines case from PR #95/96 dogfood). Separate BACKLOG entry.
- **Project-level managed doc rewiring**. `PIPELINE_MANAGED_DOCS` (codebase-map, decisions, patterns, architecture, product-context, pipeline-orchestrator) stay REPO_ROOT-canonical — they describe the project, not individual tasks. Cross-task coordination of these is the sync-rewrite BACKLOG entry.
- **GP's `--ship` explicit pre-flight gate** — becomes inert under SSOT. The worktree → main sync that creates main's dirty state goes away.
- **Backward compatibility for adopters mid-task on canon 1.3.x** — this is a release-internal refactor for `release/v1.4`. Adopters upgrade between tasks.
- **Updating `tests/run-task-prompts.test.ts`** unless the implement-reroute template change triggers a snapshot mismatch (audit during implementation).

## Acceptance Criteria

- [ ] AC-1: A new function `taskDirForRepoRoot(taskId: string): string` is added to [scripts/run-task/state.ts](../../scripts/run-task/state.ts) and **exported** from the module so cross-file callers (`git.ts`, `main.ts`) can import it. Its body is exactly the current `taskDirFor` implementation: `return path.join(process.env.CANON_TASKS_DIR_OVERRIDE ?? TASKS_DIR, taskId);`. **Implementation MUST NOT call `resolveTaskCwd`** — that would reintroduce the recursion AC-3 breaks. Add a code comment above the declaration: `// REPO_ROOT-only resolver. Reserved for callers that intentionally need REPO_ROOT semantics regardless of worktree state — currently resolveTaskCwd (breaks the self-reference cycle), commitTaskArtifactsToBase (scaffold-to-base commit), and the post-teardownWorktree archive-move in shipTasks. Do not use for general task-state reads; use taskDirFor() instead.` Verify by reading the source: export exists, signature matches, body matches, no `resolveTaskCwd` call inside, comment present.

- [ ] AC-2: `taskDirFor(taskId)` at [state.ts:34](../../scripts/run-task/state.ts:34) is rewired. New body: `return path.join(resolveTaskCwd(taskId), 'tasks', taskId);`. Function signature unchanged. Verify by reading the source.

- [ ] AC-3: `resolveTaskCwd` at [state.ts:45](../../scripts/run-task/state.ts:45) is updated to call `taskDirForRepoRoot` (not `taskDirFor`) for its status-read. Verify by reading the source: line 45 reads `const statusPath = path.join(taskDirForRepoRoot(taskId), 'status.json');`. This breaks the recursion that would otherwise occur from AC-2's rewire.

- [ ] AC-4: `commitTaskArtifactsToBase` at [git.ts:83-93](../../scripts/run-task/git.ts:83) is updated. Line 86 changes from `const taskDir = path.relative(REPO_ROOT, taskDirFor(taskId));` to `const taskDir = path.relative(REPO_ROOT, taskDirForRepoRoot(taskId));` (or equivalent — the function MUST read REPO_ROOT regardless of worktree state, because it writes the scaffold commit to base). Verify by reading the source.

- [ ] AC-5: The archive-move at [main.ts:1692](../../scripts/run-task/main.ts:1692) is updated. The line `const src = taskDirFor(taskId);` changes to `const src = taskDirForRepoRoot(taskId);` (or `path.join(REPO_ROOT, 'tasks', taskId)` directly — both correct). This runs AFTER `teardownWorktree`, so the worktree is gone; the rewired `taskDirFor` would either die (per `resolveTaskCwd`'s die path) or accidentally fall through to REPO_ROOT depending on status.json state. Explicit REPO_ROOT resolution is required. Verify by reading the source.

- [ ] AC-6: `syncWorktreeArtifacts` at [worktree.ts:215-243](../../scripts/run-task/worktree.ts:215) is deleted entirely (function body, export, any local helpers used only by it). All call sites are removed; the only call site at [main.ts:2404](../../scripts/run-task/main.ts:2404) is removed in the same diff. Verify with `grep -rn "syncWorktreeArtifacts" scripts/ src/ tests/` returning zero matches.

- [ ] AC-7: `syncWorktreeTelemetry` at [worktree.ts:245-352](../../scripts/run-task/worktree.ts:245) is deleted entirely. All call sites removed; the only call site at [main.ts:2405](../../scripts/run-task/main.ts:2405) is removed in the same diff. Verify with `grep -rn "syncWorktreeTelemetry" scripts/ src/ tests/` returning zero matches (EXCEPT the four test cases enumerated in AC-15, which are also deleted in the same diff).

- [ ] AC-8: `flushWorktreeTelemetry` (confirmed dead post-d7c2dbc, zero callers) is deleted entirely. Verify with `grep -rn "flushWorktreeTelemetry" scripts/ src/ tests/` returning zero matches.

- [ ] AC-9: The REPO_ROOT → worktree copy loop in `runImplementPhase` at [implement.ts:48-64](../../scripts/run-task/phases/implement.ts:48) is deleted. The function transitions from the `worktreeAlreadyCreated` gate check (lines 42-44) and `ensureBranch(taskIds)` (line 46) directly to the `getActiveCwd(taskIds)` call at line 66. Worktree creation still happens via that `getActiveCwd` call (which invokes `ensureWorktree` internally) — the timing is preserved. Verify by reading the source.

- [ ] AC-10: The REPO_ROOT → worktree copy loop in `runCodeReviewPhase` at [code-review.ts:92-107](../../scripts/run-task/phases/code-review.ts:92) — the `if (isWorktreeEnabled(taskIds)) { ... }` block — is deleted. Do **NOT** delete the BLOCKED-rejection write path at [code-review.ts:80-86](../../scripts/run-task/phases/code-review.ts:80) which writes review.md via `resolveTaskCwd` directly (not `taskDirFor`); that path stays. Same rationale as AC-9: worktree already has the spec/plan/etc. from branch creation. Verify by reading the source: the `if (isWorktreeEnabled(taskIds))` block at lines 92-107 is removed; the BLOCKED-write at 80-86 is preserved.

- [ ] AC-11: Pre-implement → implement timing window covered. After AC-9's deletion, the implement-phase flow is: line 41 `readStatus` → line 42-44 gate check → line 46 `ensureBranch` (creates branch only) → line 66 `getActiveCwd` (creates worktree via `ensureWorktree`). The first post-`ensureBranch`-but-pre-`getActiveCwd` `taskDirFor` call would resolve via `resolveTaskCwd` against status.json that says `worktree: true, branch: <name>` with no worktree directory yet, triggering the die at [state.ts:53-57](../../scripts/run-task/state.ts:53). Verify by reading the source: no `taskDirFor` call exists between line 46 (`ensureBranch`) and line 66 (`getActiveCwd`). If one is found, it must be moved or refactored.

- [ ] AC-12: Pre-implement REPO_ROOT correctness. Tasks that have NOT yet reached implement phase (still at spec, spec_review, or plan) have `worktree` flag set in status.json but no worktree directory yet. `resolveTaskCwd` reads status.json via `taskDirForRepoRoot`, sees `worktree: true`, sees `branch === ""` (per the empty-string check at [state.ts:50](../../scripts/run-task/state.ts:50)), falls through to return REPO_ROOT. Verify with a unit test that creates a task with `worktree: true, branch: ""` and asserts `taskDirFor(taskId)` returns the REPO_ROOT path.

- [ ] AC-13: Post-implement worktree resolution. Tasks past implement have `worktree: true, branch: <name>` AND a worktree directory exists. `resolveTaskCwd` returns the worktree path. Verify with a unit test that creates a task fixture with a populated worktree directory (via `fs.mkdtempSync` + `fs.mkdirSync` for the `dev-worktrees/<id>` path) and asserts `taskDirFor(taskId)` returns the worktree's task dir.

- [ ] AC-14: The four test cases that explicitly test `syncWorktreeTelemetry` behavior are DELETED (since the function is deleted in AC-7):
  - [tests/run-task-safety.test.ts:736](../../tests/run-task-safety.test.ts:736) — `syncWorktreeTelemetry skips a telemetry file when destination has file-specific commits source lacks`
  - [tests/run-task-safety.test.ts:798](../../tests/run-task-safety.test.ts:798) — `syncWorktreeTelemetry copies telemetry docs even when the new content is the same length`
  - [tests/run-task-safety.test.ts:849](../../tests/run-task-safety.test.ts:849) — `syncWorktreeTelemetry preserves external dirty edits to managed docs in supervising`
  - [tests/run-task-safety.test.ts:2525](../../tests/run-task-safety.test.ts:2525) — `syncWorktreeTelemetry mirrors managed docs to supervising and keeps worktree edits for autoCommit`
  Each test's removal is justified by AC-7's deletion of the function under test (per `CLAUDE.md` "Test change rule: tests must only change when behavior is intentionally changing"). Verify by reading the diff and the new test file.

- [ ] AC-15: All other tests pass. The full `npm test` suite reports zero failures after the AC-14 deletions. Other tests that may have implicitly depended on the sync (e.g., reading REPO_ROOT post-pipeline expecting synced content) are updated to either (a) write directly to the side being tested, or (b) read from the worktree path explicitly. Audit during implementation; update each. Note: tests that set `CANON_TASKS_DIR_OVERRIDE` continue to work — that override is read by `taskDirForRepoRoot`, which is called by `resolveTaskCwd`, so the override propagates correctly.

- [ ] AC-16: The parser-cwd bug regression is closed. Reproduce: in a worktree-mode task at human_review, edit the worktree's `tasks/<id>/spec.md` to add a managed doc to `### Affected Files` that's not in REPO_ROOT's spec.md. Make that managed doc dirty in the worktree. Run `canon run <id> --pr` from REPO_ROOT. Expected: v2's gate reads the worktree's spec.md (correctly listing the managed doc), permits the commit. The AC-7 advisory warning fires. PR opens. Verify with an integration test in `tests/run-task-safety.test.ts` following the existing fixture pattern.

- [ ] AC-17: GP's `--ship` post-merge-pull bug is closed. After this fix, `--ship`'s `git pull origin <base>` after the squash-merge does not fail because main's worktree has NO uncommitted `tasks/<id>/{done,handoff,notes,review}.md` mods (the sync that wrote them is deleted). Verify with an integration test: simulate the full pipeline for a worktree-mode task, assert `git status --porcelain` in REPO_ROOT post-pipeline shows the task dir was untouched in REPO_ROOT during the pipeline (only the scaffold from the initial commit, no post-implement mods).

- [ ] AC-18: `CLAUDE.md` "Reroute" section is updated. Replace any "edit in MAIN" / "edit in REPO_ROOT" wording with "edit the worktree's spec.md if a worktree exists for this task; edit REPO_ROOT only when no worktree exists (pre-implement state)." Verify by reading the file.

- [ ] AC-19: `scripts/run-task/prompts/templates/implement-reroute.md` is updated. The line "Read tasks/<id>/spec.md top-to-bottom" gains an explicit note about reading from the current working directory (the worktree). Suggested exact text: `"Read tasks/<id>/spec.md from your current working directory (the worktree). REPO_ROOT's copy is the pre-implement scaffold and does NOT contain operator amendments."` Verify by reading the file.

- [ ] AC-20: `docs/patterns.md` "Operator git surgery on a task branch between phases discards uncommitted pipeline state" pitfall (added 2026-05-23) is updated. Add a note: "This task (worktree-canonical-task-state) closes the stale-mirror class of fragility — `--pr` gates and validation now read the worktree, not REPO_ROOT. The worktree-uncommitted class (operator `git reset --hard` discards uncommitted post-implement state) persists; the QA-end-commit BACKLOG entry is the structural fix for that remaining half." Verify by reading the file.

- [ ] AC-21: `canon task new <id>` continues to work correctly. The CLI command creates `tasks/<id>/` at REPO_ROOT and does NOT create a `dev-worktrees/<id>/` directory (worktree creation is deferred to first implement). At `canon task new` time `resolveTaskCwd` returns REPO_ROOT (no worktree directory exists yet), so the worktree-aware `taskDirForCwd` rewire is a no-op for this command. Verify with a unit test: `canon task new foo "Test"` then assert `tasks/foo/` exists at REPO_ROOT and `dev-worktrees/foo/` does not.

- [ ] AC-21b: `taskDirForCwd(cwd, taskId)` at [src/task/index.ts:65](../../src/task/index.ts:65) is rewired to apply worktree-resolution. `resolveTaskCwd` is already imported at [src/task/index.ts:13](../../src/task/index.ts:13); use it. The new body must preserve `CANON_TASKS_DIR_OVERRIDE` semantics — when `tasksRoot()` returns an absolute path (override set), return `path.join(root, taskId)` regardless of worktree (override takes precedence). When `tasksRoot()` returns a relative path, route through `resolveTaskCwd(taskId)` to pick the canonical cwd (worktree past plan, else REPO_ROOT) and return `path.join(resolveTaskCwd(taskId), root, taskId)`. The `cwd` parameter becomes effectively unused in the non-override branch (replaced by `resolveTaskCwd`'s answer). Signature unchanged. Verify by reading the source: import is from existing line 13, body has the absolute-root branch unchanged, body's relative-root branch uses `resolveTaskCwd(taskId)` instead of the parameter `cwd`.

- [ ] AC-21c: `canon task status <id>` from REPO_ROOT shell reads worktree state when one exists past plan. Verify with an integration test: create a worktree-mode task, manually populate the worktree's `tasks/<id>/status.json` with a distinguishing field (e.g., a fake phase progress value), run `canon task status <id>` from REPO_ROOT, assert the output reflects the worktree's content not REPO_ROOT's scaffold.

- [ ] AC-21d: `canon task list` reads from worktrees for tasks that have them. Verify with an integration test: create two tasks, one worktree-mode (with a populated worktree) and one not, run `canon task list`, assert both are listed with their respective canonical state.

- [ ] AC-21e: `canon task accept <id> <phase>` and `canon task phase <id> <phase> <status>` write to the worktree's status.json when a worktree exists. Verify with an integration test: create a worktree-mode task at implement phase with a worktree populated, run `canon task accept implement`, assert the worktree's status.json was updated AND REPO_ROOT's scaffold status.json was NOT modified.

- [ ] AC-22a: `getMetricsFile(activeCwd?: string)` at [metrics.ts:7](../../scripts/run-task/metrics.ts:7) accepts an optional `activeCwd` parameter (defaulting to `REPO_ROOT` for backward-compat). Body: when no `CANON_METRICS_FILE_OVERRIDE`, returns `path.join(activeCwd ?? REPO_ROOT, 'docs/pipeline-invocations.md')`. Signature change is purely additive (optional param). Verify by reading the source.

- [ ] AC-22b: The `activeCwd` is threaded to `getMetricsFile` via the existing `metricsContext` plumbing. `recordMetric` is called from [scripts/run-task/agents/claude.ts:225](../../scripts/run-task/agents/claude.ts:225) and [scripts/run-task/agents/codex.ts:104](../../scripts/run-task/agents/codex.ts:104), not from `main.ts`. The `metricsContext` object is built in each phase module (`phases/spec.ts`, `phases/spec-review.ts`, `phases/plan.ts`, `phases/implement.ts`, `phases/code-review.ts`, `phases/qa.ts`) and passed through `runClaude`/`runCodex`. The fix: add an `activeCwd` field to `metricsContext` (or pass it as a sibling parameter to `runClaude`/`runCodex`); each phase module supplies it via `getActiveCwd(taskIds)` (already in scope — `phases/implement.ts:101` passes `activeCwd` to `runCodex`; analogous sites in other phase modules). In `agents/claude.ts:225` and `agents/codex.ts:104`, change `getMetricsFile()` to `getMetricsFile(metricsContext.activeCwd)`. Verify by reading the source: `metricsContext` type gains `activeCwd`; each phase's metricsContext build site passes it; the two `recordMetric` paths use it. Pre-implement phases (no worktree) supply `REPO_ROOT` (which is what `getActiveCwd` returns when no worktree exists).

- [ ] AC-22c: `mirrorHumanReviewDocsToCwd` at [main.ts:647](../../scripts/run-task/main.ts:647) is DELETED entirely. The call site at [main.ts:905](../../scripts/run-task/main.ts:905) is removed. Verify with `grep -rn "mirrorHumanReviewDocsToCwd" scripts/ src/ tests/` returning zero matches.

- [ ] AC-22d: `commitTaskArtifactsToBase` at [git.ts:83-93](../../scripts/run-task/git.ts:83) is expanded to also stage and commit dirty `PIPELINE_TELEMETRY_FILES` at scaffold-commit time. Implementation: **once per invocation, AFTER the per-task loop completes**, iterate `PIPELINE_TELEMETRY_FILES` (imported from `worktree.ts`), check each with `git status --porcelain -- <file>`, stage dirty ones via `git add -- <file>`, and produce ONE additional commit covering all dirty telemetry with a message like `chore: absorb pre-implement telemetry into scaffold for <taskId-list>`. Do NOT fold telemetry into the per-task commits — that would either double-stage in bundle mode or arbitrarily attribute telemetry to the first task. If no telemetry is dirty, the function exits without the extra commit. Verify by reading the source: telemetry staging happens once outside the per-task loop; commit message is distinct from the per-task scaffold message.

- [ ] AC-22e: Pre-implement REPO_ROOT telemetry absorption verified end-to-end. Integration test: simulate a spec_review phase (invokes metrics.recordMetric writing to REPO_ROOT's `docs/pipeline-invocations.md` because no worktree exists yet), then trigger `commitTaskArtifactsToBase`. Assert that REPO_ROOT's `docs/pipeline-invocations.md` is committed (no longer dirty in `git status`). This codifies operator-Claude's manual "commit clean state before spawning worktree" discipline.

- [ ] AC-22f: Post-implement telemetry lands in the worktree. Integration test: run the implement phase (which invokes metrics.recordMetric with `getActiveCwd(taskIds)` = worktree path). Assert the worktree's `docs/pipeline-invocations.md` got the append AND REPO_ROOT's `docs/pipeline-invocations.md` was NOT modified post-scaffold-commit.

- [ ] AC-22g: Pre-flight gate against cross-task telemetry contamination. `commitTaskArtifactsToBase` gains a third parameter `options: { force: boolean }` — new signature: `(taskIds: string[], _artifactFiles: ReadonlySet<string>, options: { force: boolean })`. Caller in [implement.ts:44](../../scripts/run-task/phases/implement.ts:44) passes `{ force: cliArgs.force }` (cliArgs is already in scope in implement.ts via the existing import from main.ts or cli.ts — whichever the existing pattern is; implementer confirms). Inside `commitTaskArtifactsToBase`, BEFORE the telemetry-absorption loop (added in AC-22d) stages anything: iterate `PIPELINE_TELEMETRY_FILES` and check each via `git status --porcelain -- <file>`. If ANY file is dirty AND `options.force === false`, `die()` with the actionable message below. If `options.force === true`, emit a `warn()` listing the absorbed files (so the operator sees what got committed under this task's label) and proceed with absorption. If no telemetry is dirty, gate passes silently and absorption loop runs unconditionally. **No `cliArgs` import in git.ts** — the parameter-passing pattern avoids a circular dependency (git.ts → cli.ts isn't a circular path, but using parameter-passing keeps git.ts pure and matches the pattern v2/Fix 1 used for force-aware gates). Exact die message:

  ```
  --pipeline aborted: telemetry files have uncommitted appends that would be absorbed into <taskId>'s scaffold commit.
    docs/pipeline-invocations.md
    docs/task-quality-log.md
    docs/lessons-learned.md
  If these appends describe THIS task (likely if you ran spec_review or plan on <taskId> earlier), the absorption is correct — re-run with --force to proceed.
  If they describe a PRIOR task, attribution would be wrong. Either commit under the prior task's name, or `git checkout HEAD -- <file>` to discard.
  ```

  Verify by reading the source: the gate fires before the telemetry-staging loop; the die path emits the message; `--force` allows the absorption with a warn. Integration test: create dirty telemetry without `--force`, assert the function dies; create same dirty state with `--force`, assert the function commits and warns.

- [ ] AC-27: `docs/architecture.md` Tech Stack "Worktree" section is updated to describe the worktree-canonical model. Replace any "REPO_ROOT and worktree are kept in sync via..." wording with "worktree is canonical for task-scoped state (task artifacts AND per-task telemetry) during pipeline execution; REPO_ROOT is canonical for project-level resources (managed docs, scripts/, src/, root agent files) and for pre-implement task state."

- [ ] AC-23: `docs/decisions.md` gains a new entry: "Worktree-canonical task state from implement onward." Sections: What was decided, Why (dual-source bug class), Rule (don't reintroduce REPO_ROOT mirrors of task artifacts; use `taskDirFor` for runtime resolution, `taskDirForRepoRoot` only for REPO_ROOT-anchored operations like scaffold commits and post-teardown archive). Verify by reading the file.

- [ ] AC-24: `docs/codebase-map.md` Pipeline Orchestration table updates the `worktree.ts` row to reflect deleted sync functions; `worktree.ts` is now just lifecycle (create / cleanup / detect / `findExistingWorktreeForBranch`), not sync.

- [ ] AC-25: Lint and type-check pass. `dist/cli/index.js` and `dist/scripts/run-task.js` are regenerated by `npm run build` and committed. CI's `git diff --exit-code -- dist/` gate passes.

- [ ] AC-26: Stale in-tree comments that reference pre-rewire `taskDirFor` semantics are updated to reflect post-rewire behavior. Specifically:
  - [scripts/run-task/phases/qa.ts:36-39](../../scripts/run-task/phases/qa.ts:36) — currently says "taskDirFor() is not worktree-aware; a REPO_ROOT write would be clobbered milliseconds later by syncWorktreeArtifacts." Both halves are false post-rewire (taskDirFor IS worktree-aware; syncWorktreeArtifacts is gone). Update or delete the comment.
  - [scripts/run-task/phases/code-review.ts:80-83](../../scripts/run-task/phases/code-review.ts:80) — currently says "taskDirFor is not worktree-aware and would land in REPO_ROOT, where main.ts's later worktree sync would clobber the BLOCKED reason." Update — the `resolveTaskCwd` write at line 84 still goes to the worktree directly (fine), but the rationale about `taskDirFor` is now outdated.
  - [scripts/run-task/phases/code-review.ts:119-123](../../scripts/run-task/phases/code-review.ts:119) — currently says "taskDirFor would resolve to REPO_ROOT and read a stale (likely still-template) copy." False post-rewire. Update or delete.
  Also audit other comments at [main.ts:1596](../../scripts/run-task/main.ts:1596) and [main.ts:2398](../../scripts/run-task/main.ts:2398) referenced in the audit table for similar staleness; update where misleading. Verify by reading the source: the three named comments no longer claim `taskDirFor` is REPO_ROOT-only.

## Design

### Affected Files

> Any protected doc Claude expects QA to touch (codebase-map, decisions, patterns, architecture, product-context, pipeline-orchestrator) must be listed here. Telemetry files (lessons-learned, task-quality-log, pipeline-invocations) are auto-committed and do not need a row.

| File | Change |
|---|---|
| `scripts/run-task/state.ts` | (1) Add new function `taskDirForRepoRoot(taskId: string): string` with the body of the current `taskDirFor` (REPO_ROOT-anchored, honors `CANON_TASKS_DIR_OVERRIDE`). Export it so `git.ts` and `main.ts` can import. (2) Update `taskDirFor` body to `return path.join(resolveTaskCwd(taskId), 'tasks', taskId);`. Signature unchanged. (3) Update `resolveTaskCwd` line 45 to call `taskDirForRepoRoot` instead of `taskDirFor` — breaks the otherwise-infinite recursion. |
| `scripts/run-task/worktree.ts` | DELETE `syncWorktreeArtifacts` (lines 215-243). DELETE `syncWorktreeTelemetry` (lines 245-352). DELETE `flushWorktreeTelemetry` (currently dead code, zero callers). Remove their exports. Also remove any private helpers used only by these functions (audit during implementation). |
| `scripts/run-task/main.ts` | (1) Remove the post-phase sync calls at lines 2404-2405. (2) Update the archive-move at line 1692 from `taskDirFor(taskId)` to `taskDirForRepoRoot(taskId)` (import from state.ts). (3) The re-export `const taskDirFor = splitState.taskDirFor` at line 98 stays — propagates the rewired function. (4) Other `taskDirFor` consumers (line 182, 1984, 2012, 2013, 2083) are unchanged — naturally inherit the rewire. (5) DELETE `mirrorHumanReviewDocsToCwd` (lines 647-678 approx). (6) Remove the call to `mirrorHumanReviewDocsToCwd(cwd)` at line 905 in `commitHumanReviewFiles`. (7) Update `recordMetric` call sites in the agent-dispatch flow to pass `getActiveCwd(taskIds)` to `getMetricsFile`. |
| `scripts/run-task/git.ts` | (1) Update `commitTaskArtifactsToBase` at line 86 from `taskDirFor(taskId)` to `taskDirForRepoRoot(taskId)`. Add import for `taskDirForRepoRoot` from `state.ts`. (2) Expand `commitTaskArtifactsToBase` body to also stage dirty `PIPELINE_TELEMETRY_FILES` (import from `worktree.ts`) **once per invocation, AFTER the per-task loop completes**, with a distinct commit message. (3) Add the pre-flight gate from AC-22g — before the telemetry-staging step, check `git status --porcelain -- <PIPELINE_TELEMETRY_FILES...>` and die with the actionable message if dirty AND `options.force === false`. Function signature gains a third parameter `options: { force: boolean }`; no `cliArgs` import in git.ts. |
| `scripts/run-task/phases/implement.ts` | Already in Affected Files for the copy-loop deletion (lines 48-64). Additionally: update the `commitTaskArtifactsToBase` call at line 44 to pass `{ force: cliArgs.force }` as the third argument. `cliArgs` is accessible via whatever existing import pattern implement.ts uses (audit at implementation time). |
| `scripts/run-task/metrics.ts` | Update `getMetricsFile()` at line 7 to accept an optional `activeCwd?: string` parameter. New body: `return process.env.CANON_METRICS_FILE_OVERRIDE ? path.resolve(...) : path.join(activeCwd ?? REPO_ROOT, 'docs/pipeline-invocations.md');`. Signature change is purely additive. |
| `src/task/index.ts` | Update `taskDirForCwd(cwd, taskId)` at line 65-70 to apply worktree-resolution. Import `resolveTaskCwd` from `../../scripts/run-task/state.js` (relative path resolves through tsup bundle). Body: call `resolveTaskCwd(taskId)`; if it returns a worktree path (i.e., not REPO_ROOT-equivalent), return `path.join(<worktreePath>, 'tasks', taskId)`; else return the previous cwd-relative computation. Signature unchanged. Callers at lines 377, 471, 733, 761 inherit automatically. |
| `scripts/run-task/phases/implement.ts` | DELETE the REPO_ROOT → worktree copy loop at lines 48-64. The function transitions from `ensureBranch(taskIds)` (line 46) directly to `getActiveCwd(taskIds)` (line 66) which creates the worktree. |
| `scripts/run-task/phases/code-review.ts` | DELETE the analogous REPO_ROOT → worktree copy at line 95 (and its surrounding loop if there is one — audit). Same rationale: worktree inherits state from branch creation. |
| `src/task/index.ts` | **NO CODE CHANGES**. CLI commands continue using their private `taskDirForCwd` helper. Preserves CLI backward-compat per Non-Goals. |
| `CLAUDE.md` | Update "Reroute" section convention per AC-18. Add a one-liner to "Quick refs" noting that `canon task status <id>` from REPO_ROOT reads REPO_ROOT state; for live worktree state, `cd dev-worktrees/<id>` (mostly redundant for Claude). |
| `scripts/run-task/prompts/templates/implement-reroute.md` | Update Line ~15 per AC-19 with the explicit worktree direction. |
| `docs/patterns.md` | Update worktree-git-fragility pitfall per AC-20. |
| `docs/architecture.md` | Update Tech Stack Worktree section per AC-22. |
| `docs/decisions.md` | Add new decision entry per AC-23. |
| `docs/codebase-map.md` | Update Pipeline Orchestration table's `worktree.ts` row per AC-24. |
| `tests/run-task-safety.test.ts` | DELETE the four `syncWorktreeTelemetry` tests per AC-14 (line refs in AC). Add integration tests for AC-16 (parser-cwd bug closed) and AC-17 (`--ship` post-merge-pull clean). Add coverage for AC-12 (pre-implement REPO_ROOT) and AC-13 (post-implement worktree). |
| `tests/run-task-validation.test.ts` | Update any tests that depended on the now-deleted sync (audit during implementation). Tests using `CANON_TASKS_DIR_OVERRIDE` continue to work — override propagates through `taskDirForRepoRoot` → `resolveTaskCwd` → `taskDirFor`. |
| `dist/cli/index.js` | Regenerated by `npm run build`. |
| `dist/scripts/run-task.js` | Same. |

### Interaction Dependencies

- **`resolveTaskCwd`** at [state.ts:39](../../scripts/run-task/state.ts:39) — gains the `taskDirForRepoRoot` dependency (replaces internal `taskDirFor` call). Otherwise unchanged.
- **`commitTaskArtifactsToBase`** at [git.ts:83](../../scripts/run-task/git.ts:83) — switches from `taskDirFor` to `taskDirForRepoRoot`. Still REPO_ROOT-anchored intentionally. The 69917f8 gate stays load-bearing (ensures only the initial scaffold commit lands on base).
- **`mirrorHumanReviewDocsToCwd`** at [main.ts:642](../../scripts/run-task/main.ts:642) — unchanged. Mirrors project-level docs (PIPELINE_TELEMETRY_FILES), not task-artifact files. Distinct concern.
- **`autoCommitCode`** at [main.ts:346](../../scripts/run-task/main.ts:346) — calls `parseHandoffChangesRows(taskId)` which now reads from the worktree (via the rewired `taskDirFor`). The auto-commit allow-list comes from the worktree's handoff. Correct under SSOT.
- **`commitHumanReviewFiles`** at [main.ts:887](../../scripts/run-task/main.ts:887) — v2's allow-list gate calls `parseAffectedFilesFromSpec(taskId)` which now reads worktree. Fix 1's `verifyBaseDrift` likewise. Both gates correctly see operator amendments.
- **`tryEvidenceAdvance`** at [main.ts:1988](../../scripts/run-task/main.ts:1988) — all three branches naturally rewire to read worktree.
- **`getActiveCwd` / `ensureWorktree`** at [worktree.ts](../../scripts/run-task/worktree.ts) — unchanged. Worktree creation timing is preserved (line 66 of implement.ts still calls `getActiveCwd` post-`ensureBranch`).

### Data Model Changes

None. No `status.json` schema changes. No new flags. No template structural changes. `taskDirForRepoRoot` is a new function but doesn't alter any data shape.

## Validation Required

- [ ] `lint` (`npm run lint`)
- [ ] `type-check` (`npm run type-check`)
- [ ] `unit tests` (`npm test`) — full suite passes
- [ ] `build` (`npm run build`) — required per `docs/architecture.md` Full build binding; CI gates on `git diff --exit-code -- dist/`
- [ ] `E2E` — N/A; no UI

## Docs Impact

Per Affected Files. The big ones:

- `CLAUDE.md` — reroute convention inversion.
- `docs/architecture.md` — worktree-canonical model description.
- `docs/decisions.md` — new decision entry capturing the rationale + the `taskDirForRepoRoot` rule for REPO_ROOT-only callers.
- `docs/codebase-map.md` — `worktree.ts` row updated.
- `docs/patterns.md` — pitfall annotation.
- `docs/lessons-learned.md` — QA distills any insights. Candidate lesson: "Adding a function-internal abstraction (`taskDirForRepoRoot`) to break a self-reference cycle is cheaper than re-routing every caller to handle the cycle."

## Known Risks

- **Recursion** is the highest-leverage risk; AC-3 explicitly fixes it. If `resolveTaskCwd` is somehow NOT updated to use `taskDirForRepoRoot`, the rewired `taskDirFor` would infinitely recurse on the first call. Verify by running ANY test post-fix — if it stack-overflows, AC-3 was missed.
- **Pre-implement → implement transition** (AC-11). After deleting the copy loop, there must be no `taskDirFor` call between `ensureBranch` and `getActiveCwd` (lines 46 and 66 of implement.ts). If one is found, it would hit `resolveTaskCwd`'s die path because `worktree: true, branch: <name>` is set but the worktree dir doesn't exist yet. AC-11 catches this; implementation must verify.
- **Audit miss on `taskDirFor` consumers**. The audit table above is comprehensive per current grep. If a future caller is added that needs REPO_ROOT semantics, it should use `taskDirForRepoRoot` — document this in the `docs/decisions.md` entry (AC-23).
- **Test fixtures with explicit `dev-worktrees/<id>` setup**. Tests that create a fake worktree directory will now have `resolveTaskCwd` return the worktree. If the test then writes to REPO_ROOT and expects the parser to see it, the test fails under SSOT. Audit during implementation; tests that exercise both sides need disposition.
- **Cross-task telemetry contamination at scaffold-commit time**. AC-22d's expanded `commitTaskArtifactsToBase` stages whatever `PIPELINE_TELEMETRY_FILES` are dirty at the moment it fires. If Task A's pipeline ran spec_review + plan invocations (which appended to REPO_ROOT's `docs/pipeline-invocations.md`) but the operator then did `canon task new B` + `canon run B` WITHOUT first committing or discarding Task A's appends, the expanded `commitTaskArtifactsToBase` would absorb Task A's telemetry into Task B's scaffold commit — wrong attribution. The cleanest mitigation is operator discipline: commit clean state before invoking implement on a new task (the user's existing manual habit). Document this in [CLAUDE.md](../../CLAUDE.md) Quick refs as "before `canon run <id>` on a new task, ensure `git status --porcelain -- docs/pipeline-invocations.md docs/task-quality-log.md docs/lessons-learned.md` is clean — any dirty rows from a prior task get absorbed into the new task's scaffold commit." Acceptable trade-off: codifying the existing discipline is simpler than a per-row taskId-attribution filter (parsing the markdown row-by-row). Filter approach is filed for a follow-up if dogfood reveals the discipline is frequently violated.
- **Deletion-heavy refactor risk profile**. Different from parser-cwd's addition-heavy profile. Risk: "did we miss a side effect of the deleted sync?" Mitigation: AC-15's "audit during implementation; update each." The deletion-impact sub-agent identified `buildKnownPitfalls` as reading from REPO_ROOT (project-level doc, intentionally REPO_ROOT) — confirmed safe. The same sub-agent identified four `syncWorktreeTelemetry` tests for deletion — AC-14 enumerates them. Codex's spec_review should re-verify the deletion impact.
- **The `mirrorHumanReviewDocsToCwd` still mirrors REPO_ROOT → worktree** for project-level docs. This is INTENDED — those docs are REPO_ROOT-canonical. But it means the "no REPO_ROOT → worktree writes" claim is partial; managed docs still flow that direction. Be precise in `docs/decisions.md`.
- **`src/task/index.ts` divergence**. Under this task, CLI commands stay REPO_ROOT-anchored while pipeline-internal callers become worktree-aware. This is an intentional asymmetry. Future maintainers may be tempted to "unify" the two; document in `docs/decisions.md` that the asymmetry is intentional and explain why (CLI is operator-facing, pipeline is task-state-facing).
- **`tests/run-task-validation.test.ts` reference at line 1400** — it's a comment, not a runtime call. Safe.
- **Delicate surface confirmed**. Worktree machinery is explicitly listed in `docs/product-context.md` delicate domains. Full-tier review chain with upgraded Codex. The change is deletion-heavy AND structural (taskDirFor body change is the load-bearing line). Higher review-chain rigor warranted.
- **Snapshot tests**. If `tests/run-task-prompts.test.ts` has snapshot tests for the implement-reroute template, AC-19's text change triggers snapshot mismatches. Update during implementation.

## Human Test Plan

> Reproduces parser-cwd's bug and GP's bug, then verifies both are closed.

1. **Setup**: from `release/v1.4` with this fix merged, create a worktree-mode task (`canon task new` with defaults). Run `canon run <id>` to advance to `human_review`.

2. **Reproduce parser-cwd's bug pattern**:
   - In the worktree, edit `tasks/<id>/spec.md` to add a managed doc to `### Affected Files`. Do NOT mirror the edit to REPO_ROOT.
   - Make that managed doc dirty in the worktree.
   - Run `canon run <id> --pr` from REPO_ROOT.
   - **Expected**: v2's gate reads the worktree's spec.md, permits the commit. The AC-7 advisory warning fires. PR opens.
   - **Pre-fix behavior**: gate read REPO_ROOT's stale spec, died with allow-list rejection.

3. **Verify GP's bug is inert**:
   - After step 2's `--pr` opens the PR, mark ready, get CI green, run `canon run <id> --ship`.
   - **Expected**: `--ship` squash-merges, deletes remote task branch, runs `git pull origin <base>` against main which has NO uncommitted task-artifact mods (sync that wrote them is deleted). Pull succeeds; cleanup completes.
   - **Pre-fix behavior**: pull failed because main had unstaged `tasks/<id>/{done,handoff,notes,review}.md`.

4. **Verify pre-implement REPO_ROOT correctness**:
   - Create another task but stop at spec phase (`canon task new <id>` + write spec).
   - Confirm `tasks/<id>/spec.md` is in REPO_ROOT (no worktree exists yet).
   - Run `canon task status <id>` from REPO_ROOT — reports pre-implement state correctly.

5. **Verify operator-UX docs**:
   - Read CLAUDE.md "Reroute" section — confirms "edit the worktree's spec.md."
   - Check `canon --help` / `canon run --help` / `canon task --help` aren't misleading.
   - Verify patterns.md worktree-git-fragility pitfall mentions partial coverage.

6. **Verify no recursion in normal flow**:
   - Run `canon run <id>` on any task. If `taskDirFor` recurses (AC-3 missed), the orchestrator stack-overflows on entry. Smoke test passing = recursion-free.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry checked (or "None" with justification)
