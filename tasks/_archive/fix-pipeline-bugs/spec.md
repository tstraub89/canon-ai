# Spec: Fix five harness bugs from pipeline refactor

## Problem

The recent pipeline refactor introduced five discrete bugs:

1. **No `--dry-run` flag** — no way to render phase prompts without spawning an LLM session. Smoke-testing the orchestrator fell back to a weaker check that doesn't exercise prompt construction.

2. **`syncWorktreeTelemetry` clobbers REPO_ROOT on cross-tree smoke** — `syncWorktreeTelemetry` in `worktree.ts` uses simple byte-equality to decide whether to overwrite. When a worktree was created before a dev-only commit landed on the main branch, the worktree's version of `docs/lessons-learned.md` is older; the sync copies it to REPO_ROOT and silently deletes the newer content.

3. **`--push`/`--pr` human_review handler dropped in refactor** — `cliArgs.push` and `cliArgs.pr` are parsed but never consumed. After the qa phase completes, `main.ts`'s while loop calls `runPhase('human_review', ...)`, which hits the `die('Unknown phase: human_review')` fallthrough. The pre-refactor behavior — commit task artifacts + push + optionally create draft PR + exit 0 — must be restored. Additionally, protected docs written by the QA agent's Docs Freshness sweep (`docs/decisions.md`, `docs/product-context.md`) are not in any artifact commit allowlist, so they would be left dirty post-push even once the handler is restored.

4. **REPO_ROOT resolves to worktree when invoked from inside a worktree** — `env.ts` derives `REPO_ROOT` via `path.resolve(__dirname, '../..')`. Inside a git worktree, `__dirname` points to the worktree's copy of the scripts, so `REPO_ROOT` resolves to the worktree root. `WORKTREES_ROOT` is then `<worktree>/../dev-worktrees` — a nested wrong path. `--reroute` and any other flag invoked from inside a worktree crashes.

5. **AC Coverage preflight parser is regex-based, not table-aware** — `validateHandoff` uses `^\|\s*AC-\d.*?Met\s*\/\s*Partial\s*\/\s*Not met` (line-anchored substring) to detect unfilled placeholder rows. Prose in the AC Coverage section that happens to contain both "AC-1" and the placeholder text would produce a false positive. The fix is a small markdown table parser that separates header, separator, and data rows before checking cell values.

## Decision

Fix all five bugs in a single task. Bugs 2 & 3 share a root cause — "which files does the orchestrator consider pipeline-managed?" — and are fixed together via a `PIPELINE_MANAGED_DOCS` constant in `worktree.ts` consumed by both the sync and the human_review flush paths.

**Bug 3 scope**: restore the human_review handler in `main.ts` (add a `'human_review'` case to the `runPhase` switch that handles `--push`/`--pr` and exits 0 cleanly in the no-push case), and expand the artifact commit to include `PIPELINE_MANAGED_DOCS`. Add `notes.md` to `TASK_ARTIFACT_FILES` in `worktree.ts` so worktree-mode runs sync raw notes back to REPO_ROOT before the human_review commit — without this, agent notes written in a worktree never reach the artifact commit.

**Bug 1 scope**: `--dry-run` is a dependency-free smoke test, so it must bypass the agent dependency gate in `checkDeps` (claude/codex). It still requires `jq` and a valid task ID. The simplest fix: extend the existing `skipAgentDeps` flag in `main()` to be true for `cliArgs.ship || cliArgs.dryRun`. The dry-run early-exit branch then runs before any phase dispatch, so no LLM is spawned regardless of agent CLI presence.

**Bug 4 fix**: at module load time in `env.ts`, run `git rev-parse --git-common-dir` via `spawnSync` to locate the canonical `.git` directory; `REPO_ROOT` is its parent directory. Fall back to `__dirname` arithmetic when git is unavailable. Note: `--git-common-dir` returns a relative path (`.git`) from the main repo and an absolute path from a worktree — both must resolve correctly.

## Non-Goals

- No changes to pipeline tiers, model/effort selection, or phase order.
- No new pipeline phases or task schema fields.
- No changes to `--ship` behavior.
- No changes to `AGENTS.md` workflow rules.

## Acceptance Criteria

- **AC-1**: `npx tsx scripts/run-task.ts <id> --dry-run` prints the phase name, agent, model, and effort for each planned phase, without spawning any LLM session. `CliArgs` has a `dryRun: boolean` field; `--dry-run` is listed in `printUsage`. `--dry-run` skips the agent dependency check (`claude`, `codex`) in `checkDeps` — `skipAgentDeps` is set when either `--ship` or `--dry-run` is passed. The `jq` and task-id checks still run.
- **AC-2**: `syncWorktreeTelemetry` does not write to a REPO_ROOT file when the destination has at least as many bytes as the source (append-only guard: REPO_ROOT is already a superset). It does write when the source is strictly longer (worktree added new entries since the fork).
- **AC-3a**: After qa phase, the pipeline no longer dies with "Unknown phase: human_review". Without `--push`/`--pr`, the pipeline prints a human_review notice (listing the done.md path) and exits 0.
- **AC-3b**: With `--push` or `--pr`, the human_review handler commits all dirty files in the task artifact set (`tasks/<id>/`, including `notes.md`), `PIPELINE_TELEMETRY_FILES`, and `PIPELINE_MANAGED_DOCS` (all five protected docs: `docs/architecture.md`, `docs/codebase-map.md`, `docs/decisions.md`, `docs/patterns.md`, `docs/product-context.md`) to the task branch, then pushes. With `--pr`, it additionally creates a draft PR via `gh pr create`.
- **AC-3c**: `PIPELINE_MANAGED_DOCS` is a single exported constant in `worktree.ts`, consumed by both `syncWorktreeTelemetry`/`flushWorktreeTelemetry` and the new human_review handler — no inline path duplication across files.
- **AC-3d**: `TASK_ARTIFACT_FILES` in `worktree.ts` includes `notes.md`, so `syncWorktreeArtifacts` mirrors notes from the worktree back to REPO_ROOT in worktree mode. Without this, agent notes written during implement/review never appear in the human_review commit.
- **AC-4**: Running any `run-task.ts` flag from inside `../dev-worktrees/<task>/` (i.e., `process.cwd()` is the worktree) resolves `REPO_ROOT` to the canonical repo root, not the worktree path. `WORKTREES_ROOT` derives from the corrected `REPO_ROOT`.
- **AC-5**: The AC Coverage check in `validateHandoff` uses a markdown table parser: it locates the header row, determines the Status column index by header name, iterates data rows (skipping the separator line), and checks only the Status cell against the placeholder value. A prose line in the AC Coverage section containing "AC-1" and the placeholder text does not trigger a false positive.
- **AC-6**: `npm run lint`, `npm run type-check`, and `npm test` all pass. New test cases in `tests/run-task-validation.test.ts` cover: (a) AC Coverage section containing prose with the placeholder text that should not fire; (b) table with all-placeholder Status cells that should fire.

## Affected Files

| File | Change |
|---|---|
| `scripts/run-task/types.ts` | Add `dryRun: boolean` to `CliArgs` |
| `scripts/run-task/cli.ts` | Parse `--dry-run` in `parseArgs`; add to `printUsage` |
| `scripts/run-task/env.ts` | Resolve `REPO_ROOT` via `git rev-parse --git-common-dir` with `__dirname`-based fallback |
| `scripts/run-task/worktree.ts` | Add `PIPELINE_MANAGED_DOCS` constant; add `notes.md` to `TASK_ARTIFACT_FILES`; add byte-length guard to `syncWorktreeTelemetry`; expand `flushWorktreeTelemetry` to include managed docs |
| `scripts/run-task/main.ts` | Add `--dry-run` early-exit branch in the phase loop; extend `skipAgentDeps` to include `cliArgs.dryRun`; add `'human_review'` case to `runPhase` switch with clean-exit and `--push`/`--pr` paths |
| `scripts/run-task/validation.ts` | Replace regex AC table check with a markdown table parser |
| `tests/run-task-validation.test.ts` | Add AC parser test cases per AC-6 |

### Data Model Changes

`CliArgs` gains `dryRun: boolean`. No schema or `status.json` changes.

## Validation Required

- [x] Linting — `npm run lint`
- [x] Type checking — `npm run type-check`
- [x] Unit tests — `npm test`

## Known Risks

- **Bug 4 — `spawnSync` at import time**: `git rev-parse --git-common-dir` runs synchronously when `env.ts` is first imported. This adds ~5–10 ms to startup and will throw in non-git environments (some CI test runners). Wrap in try/catch; fall back to `__dirname` arithmetic. Document the behavior in a comment.
- **Bug 3 — conditional dirty-file commit**: Not all five protected docs will be touched by every QA run. The commit step must check `git status` and only stage files that are actually dirty; committing empty sets or unrelated changes is a hard abort.
- **Bug 3 — `gh` dependency**: `--pr` requires `gh` CLI. Guarded by the existing `ghAvailable` check in `checkDeps`. If `gh` is not available and `--pr` is set, fail fast with a clear message before touching git state.
- **Bug 5 — Status column position**: The column index of "Status" must be inferred from the header row, not hardcoded. Projects may customize AC table column ordering.

## Human Test Plan

1. **Dry-run smoke** — from the repo root, run `npx tsx scripts/run-task.ts fix-pipeline-bugs --dry-run`. Verify: output lists each pipeline phase with agent and model; no external AI service is called; the command exits without error.
2. **Dry-run from worktree** — `cd ../dev-worktrees/<any-worktree>` then run `npx tsx scripts/run-task.ts <task-id> --dry-run`. Verify: command does not crash; if REPO_ROOT is printed anywhere in the output, it points to the canonical repo, not the worktree directory.
3. **Sync clobber guard** — open a worktree's `docs/lessons-learned.md` and delete several lines. Run a pipeline step. Verify: the copy of `lessons-learned.md` in the main repo checkout is unchanged (not overwritten with the shorter worktree version).
4. **Human-review clean exit** — advance a task to the qa phase via `--step` until qa is marked done. Then run without `--step`. Verify: the pipeline prints a human_review notice (not an "Unknown phase" error) and exits cleanly.
5. **AC false-positive guard** — manually add a line like `See AC-1 for the Met / Partial / Not met breakdown.` to a handoff's AC Coverage section (outside the table). Run the pipeline through code_review. Verify: the preflight does not reject the handoff due to this prose line.

## Docs Impact

- `docs/pipeline-orchestrator.md` §Flags table: add `--dry-run` row.
- `docs/pipeline-orchestrator.md` §Auto-Commit: note that `PIPELINE_MANAGED_DOCS` (all five protected docs) are committed at human_review alongside task artifacts and telemetry.
