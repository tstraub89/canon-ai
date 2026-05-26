# Implementation Handoff: worktree-canonical-task-state

> Author: Codex | Spec: `tasks/worktree-canonical-task-state/spec.md` | Plan: `tasks/worktree-canonical-task-state/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

| File | What Changed |
|---|---|
| `CLAUDE.md` | Updated quick refs so operator task commands are documented as worktree-aware past plan. |
| `dist/cli/index.js` | Rebuilt bundled CLI after task-state resolver and task CLI changes. |
| `dist/scripts/run-task.js` | Rebuilt bundled orchestrator after run-task source changes. |
| `docs/architecture.md` | Documented the worktree-canonical task-state model. |
| `docs/codebase-map.md` | Updated the `worktree.ts` map entry to lifecycle and registry responsibilities only. |
| `docs/decisions.md` | Added the worktree-canonical task-state decision entry and resolver rules. |
| `docs/patterns.md` | Updated worktree-state pitfalls for the deleted mirror model and remaining uncommitted-worktree risk. |
| `docs/pipeline-orchestrator.md` | Replaced artifact-sync and reroute guidance with worktree-canonical task-state guidance. |
| `scripts/run-task/agents/claude.ts` | Added `activeCwd` to metrics context forwarding. |
| `scripts/run-task/agents/codex.ts` | Added `activeCwd` to metrics context forwarding. |
| `scripts/run-task/env.ts` | Removed stale shared-doc sync wording from the REPO_ROOT anchoring comment. |
| `scripts/run-task/git.ts` | Made scaffold commits REPO_ROOT-specific, path-restricted them with `--only`, and added telemetry absorption. |
| `scripts/run-task/main.ts` | Removed post-phase mirroring, deleted human-review doc mirroring, fixed post-teardown archive resolution, and updated reroute messaging. |
| `scripts/run-task/metrics.ts` | Made metrics output optionally active-cwd scoped via `MetricEntry.activeCwd`. |
| `scripts/run-task/phases/code-review.ts` | Deleted the root-to-worktree artifact copy loop and added `activeCwd` metrics context. |
| `scripts/run-task/phases/implement.ts` | Deleted the root-to-worktree artifact copy loop and preserved direct `ensureBranch` to `getActiveCwd` flow. |
| `scripts/run-task/phases/plan.ts` | Added `activeCwd` metrics context. |
| `scripts/run-task/phases/qa.ts` | Added `activeCwd` metrics context and kept salvage writes on the active cwd. |
| `scripts/run-task/phases/spec-review.ts` | Added `activeCwd` metrics context. |
| `scripts/run-task/phases/spec.ts` | Added `activeCwd` metrics context for fresh and revision spec calls. |
| `scripts/run-task/prompts/templates/implement-reroute.md` | Updated reroute prompt to read the worktree spec from current cwd. |
| `scripts/run-task/state.ts` | Added `taskDirForRepoRoot`, rewired `taskDirFor`, and broke resolver recursion. |
| `scripts/run-task/types.ts` | Added optional `MetricEntry.activeCwd`. |
| `scripts/run-task/validation.ts` | Updated reroute amendment preflight comment for active task-dir semantics. |
| `scripts/run-task/worktree.ts` | Deleted artifact and telemetry sync functions plus the now-unused shared-doc mirror helper. |
| `src/task/index.ts` | Made task CLI status/list/accept/phase resolution worktree-aware while preserving override behavior. |
| `templates/CLAUDE.md` | Synced managed template copy after `CLAUDE.md` update. |
| `templates/docs/pipeline-orchestrator.md` | Synced managed template copy after orchestrator doc update. |
| `tests/run-task-prompts.golden.json` | Regenerated prompt golden for reroute template text. |
| `tests/run-task-reroute-preflight.test.ts` | Updated reroute preflight coverage to use the live worktree spec. |
| `tests/run-task-safety.test.ts` | Added state, parser, telemetry-absorption, implement SSOT tests and removed deleted sync tests. |
| `tests/task-cli.test.ts` | Added task CLI worktree-aware status/list/accept coverage and preserved task-new behavior. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`. Reference those fields here instead of duplicating them as a second source of truth.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

Task-scoped state now resolves through the active worktree once one exists. REPO_ROOT-only resolution is explicit and limited to bootstrap or teardown paths that genuinely need the supervising checkout. The old mirror path is removed so parsers, validators, task commands, and telemetry all observe the same live task state during implement and later phases.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Removed exported `SharedDocSyncResult` and `canMirrorSharedDocs` along with the sync functions. | They only supported the deleted shared-doc mirror behavior and had zero in-tree callers; leaving them would keep a stale sync API in `worktree.ts`. | Supports AC-24; no behavioral AC loss. |
| Updated `docs/pipeline-orchestrator.md` and synced `templates/docs/pipeline-orchestrator.md`. | The reroute and worktree sections contradicted the new source-of-truth model, and canon-managed templates must stay aligned. | Documentation-only; supports AC-18/19/22h/24 intent. |
| Test subprocesses that need current source now import from `process.cwd()` rather than `REPO_ROOT`. | In this linked worktree, `REPO_ROOT` intentionally resolves to the supervising checkout and loaded stale bundled behavior in child processes. The note was recorded in `notes.md`. | Test harness correction only; supports AC-12/13/16/17/22e/22f verification. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `taskDirForRepoRoot(taskId: string)` is exported with the required body and comment. |
| AC-2 | Met | `taskDirFor` preserves `CANON_TASKS_DIR_OVERRIDE` precedence and otherwise resolves through `resolveTaskCwd`. |
| AC-3 | Met | `resolveTaskCwd` reads `status.json` through `taskDirForRepoRoot`, avoiding recursion. |
| AC-4 | Met | `commitTaskArtifactsToBase` uses `taskDirForRepoRoot` for scaffold commits. |
| AC-5 | Met | Post-teardown archive move uses `taskDirForRepoRoot`. |
| AC-6 | Met | `syncWorktreeArtifacts` and call sites are deleted; structural grep returned zero matches in `scripts/ src/ tests/`. |
| AC-7 | Met | `syncWorktreeTelemetry` and call sites are deleted; structural grep returned zero matches in `scripts/ src/ tests/`. |
| AC-8 | Met | `flushWorktreeTelemetry` is deleted; structural grep returned zero matches in `scripts/ src/ tests/`. |
| AC-9 | Met | Implement phase now flows from first-implement scaffold handling to `ensureBranch()` to `getActiveCwd()` with no copy loop. |
| AC-10 | Met | Code-review copy loop is deleted and the BLOCKED rejection path still writes through `resolveTaskCwd`. |
| AC-11 | Met | No `taskDirFor` call exists between `ensureBranch()` and `getActiveCwd()` in implement. |
| AC-12 | Met | Unit test covers branch-empty pre-implement `taskDirFor` returning REPO_ROOT task dir. |
| AC-13 | Met | Unit test covers worktree-backed `taskDirFor` returning the worktree task dir. |
| AC-14 | Met | The four deleted `syncWorktreeTelemetry` tests were removed with the deleted function. |
| AC-15 | Met | Full `npm test` passes after updating implicit sync dependencies. |
| AC-16 | Met | `parseAffectedFilesFromSpec` test proves the worktree spec wins over the REPO_ROOT scaffold. |
| AC-17 | Met | Implement integration test asserts REPO_ROOT task dir stays clean after scaffold commit while worktree task artifacts receive new output. |
| AC-18 | Met | `CLAUDE.md` reroute/task-command guidance is updated and template-synced. |
| AC-19 | Met | Implement reroute prompt now explicitly reads `tasks/<id>/spec.md` from current cwd. |
| AC-20 | Met | `docs/patterns.md` documents the stale-mirror class as closed and the uncommitted-worktree class as remaining. |
| AC-21 | Met | `canon task new` test asserts REPO_ROOT task creation without worktree creation. |
| AC-21b | Met | `taskDirForCwd` preserves absolute override behavior and uses `resolveTaskCwd` for relative task roots. |
| AC-21c | Met | Task status integration test reads the worktree status from REPO_ROOT shell. |
| AC-21d | Met | Task list integration test reads per-entry status through `taskDirForCwd`. |
| AC-21e | Met | Task accept and existing task phase tests write to worktree status while leaving REPO_ROOT scaffold unchanged. |
| AC-22a | Met | `getMetricsFile(activeCwd?: string)` defaults to REPO_ROOT and uses active cwd when supplied. |
| AC-22b | Met | `MetricEntry`, both agent metric contexts, `recordMetric`, and all phase metric contexts carry `activeCwd`. |
| AC-22c | Met | `mirrorHumanReviewDocsToCwd` and its call site are deleted; structural grep returned zero matches. |
| AC-22d | Met | Scaffold commits and telemetry absorption are separate path-restricted `--only` commits. |
| AC-22e | Met | Telemetry absorption test proves dirty pre-implement metrics are committed and no longer dirty. |
| AC-22f | Met | Implement test proves post-implement metrics append in the worktree and REPO_ROOT telemetry stays unchanged. |
| AC-22h | Met | Architecture and orchestrator docs describe worktree-canonical task state and REPO_ROOT project-resource scope. |
| AC-23 | Met | `docs/decisions.md` has the new decision entry and resolver rules. |
| AC-24 | Met | `docs/codebase-map.md` describes `worktree.ts` as lifecycle and registry code, not sync. |
| AC-25 | Met | Lint, type-check, unit tests, and build pass; dist bundles were regenerated. |
| AC-26 | Met | Stale comments and reroute messages that described old `taskDirFor` or sync behavior were updated. |

## Edge Cases Considered

- `CANON_TASKS_DIR_OVERRIDE` remains an absolute override and is tested separately from worktree resolution.
- Missing worktrees still fail closed through the existing `resolveTaskCwd` / `getActiveCwd` die paths.
- First implement still creates the worktree through `ensureBranch`; the copied scaffold comes from the base commit, not a filesystem copy loop.
- Pre-implement telemetry is absorbed once at scaffold time; cross-task telemetry discrimination remains the separate BACKLOG item called out by the spec.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `lint` (`npm run lint`) | Pass | |
| `type-check` (`npm run type-check`) | Pass | |
| `unit tests` (`npm test`) | Pass | 479 tests: 478 pass, 1 skipped. |
| `build` (`npm run build`) | Pass | Regenerated `dist/cli/index.js` and `dist/scripts/run-task.js`. |
| `docs-refs-check` (`npm run docs-refs-check`) | Pass | Required by docs/reference changes. |
| `sync-templates:check` (`npm run sync-templates:check`) | Pass | Required after managed `CLAUDE.md` and pipeline-orchestrator template sync. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>` (not checked; this worktree has no upstream tracking branch configured)

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

| File | What Changed |
|---|---|

### Findings addressed

- _correctness bug:_ "<one-line summary>" → fixed at file:line

### AC deltas (if any)

- AC-N: was Partial → now Met (file:line)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |
-->

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `tasks/worktree-canonical-task-state/handoff.md` | Verified the current handoff contains concrete Changes, AC Coverage, Validation Outcomes, and Ready for Review entries, then appended this revision record for the Round 1 pre-flight rejection. |

### Findings addressed

- _handoff pre-flight:_ Round 1 reported generic template AC Coverage rows and missing required validation rows. The current cumulative handoff now has concrete AC-1 through AC-26 statuses and required rows for `lint`, `type-check`, `unit tests`, and `build`.

### AC deltas

- None. This revision changed only the handoff artifact; source AC coverage remains as recorded in Iteration 1.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| Handoff artifact check | Pass | Current handoff contains the required AC Coverage and Validation Outcomes tables with no generic template status rows. |
| `lint` (`npm run lint`) | Pass | Re-ran after the artifact repair. |
| `type-check` (`npm run type-check`) | Pass | Re-ran after the artifact repair. |
| `unit tests` (`npm test`) | Pass | 479 tests: 478 pass, 1 skipped. |
| `build` (`npm run build`) | Pass | Rebuilt dist; `normalize-dist-paths` rewrote 1 file. |
