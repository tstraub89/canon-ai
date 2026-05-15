# Implementation Handoff: fix-pipeline-bugs

> Author: Codex | Spec: `tasks/fix-pipeline-bugs/spec.md` | Plan: `tasks/fix-pipeline-bugs/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

| File | What Changed |
|---|---|
| `scripts/run-task/types.ts` | Added `dryRun: boolean` to `CliArgs`. |
| `scripts/run-task/cli.ts` | Parsed `--dry-run` and added it to the usage text. |
| `scripts/run-task/env.ts` | Resolved `REPO_ROOT` via `git rev-parse --git-common-dir` with a `__dirname` fallback for non-git environments. |
| `scripts/run-task/main.ts` | Added dry-run early exit, extended the agent-dependency skip path, restored a dedicated `human_review` phase handler, and implemented the human-review commit/push/PR flow. |
| `scripts/run-task/worktree.ts` | Added `PIPELINE_MANAGED_DOCS`, added `notes.md` to `TASK_ARTIFACT_FILES`, expanded the telemetry flush set, and changed the worktree-to-repo copy guard to append-only byte length comparison. |
| `scripts/run-task/validation.ts` | Replaced the regex AC Coverage check with a markdown-table-aware parser that infers the Status column from the header row. |
| `tests/run-task-validation.test.ts` | Added coverage for the AC Coverage parser false-positive case and the all-placeholder-table case with non-first Status columns. |
| `tests/run-task-prompts.golden.json` | Updated the prompt snapshot to the canonical repo-root path now returned by `REPO_ROOT`. |
| `docs/pipeline-orchestrator.md` | Documented `--dry-run` and the human-review commit scope. |
| `tasks/fix-pipeline-bugs/status.json` | Phase state advanced through `implement → done` via the task helper. |
| `tasks/fix-pipeline-bugs/notes.md` | Added implement-phase notes about the `REPO_ROOT` resolution change and the prompt snapshot update. |

## Intent & Rationale

The fix centers on the orchestrator surfaces the refactor broke: a dependency-free dry-run path, a restored `human_review` phase handler, worktree-safe artifact/telemetry syncing, canonical repo-root resolution, and a table-aware AC Coverage parser. The work keeps the existing pipeline structure intact while making the new phase and commit paths explicit instead of falling through to `Unknown phase`.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Mirrored `PIPELINE_MANAGED_DOCS` from `REPO_ROOT` back into the active worktree before the human-review commit. | `syncWorktreeTelemetry()` intentionally reverts those files in the worktree after syncing them to `REPO_ROOT`. Copying them back immediately before the task-branch commit keeps the human-review commit complete in worktree mode. | None; this preserves AC-3b in worktree runs. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: `--dry-run` prints the planned phases, agents, model, and effort without spawning an LLM, and skips the agent dependency check. | Met | `main.ts` exits before phase dispatch, `cli.ts` parses the flag, and `checkDeps()` now skips `claude`/`codex` when `--dry-run` is set. |
| AC-2: `syncWorktreeTelemetry` only copies to `REPO_ROOT` when the source is strictly longer than the destination. | Met | `worktree.ts` now uses a byte-length comparison instead of full-buffer equality, so append-only telemetry changes still flush but shorter worktree copies do not clobber `REPO_ROOT`. |
| AC-3a: `human_review` no longer falls through to `Unknown phase`; without `--push`/`--pr`, it prints a notice with `done.md` paths and exits 0. | Met | `runPhase()` now handles `human_review` explicitly and prints the no-push notice before exiting cleanly. |
| AC-3b: With `--push` or `--pr`, human_review commits the task artifact set, telemetry, and managed docs, then pushes; `--pr` also creates a draft PR. | Met | The commit path stages dirty task artifact dirs, telemetry files, and all five managed docs, pushes the current task branch, and uses `gh pr create --draft` when `--pr` is present. |
| AC-3c: `PIPELINE_MANAGED_DOCS` is a single exported constant consumed by sync/flush logic and the human_review handler. | Met | The constant lives in `worktree.ts` and is referenced by `flushWorktreeTelemetry()`, `syncWorktreeTelemetry()`, and the human-review commit path in `main.ts`. |
| AC-3d: `TASK_ARTIFACT_FILES` includes `notes.md`, so worktree notes sync back before human_review. | Met | `syncWorktreeArtifacts()` now mirrors `notes.md` alongside the other task artifact files. |
| AC-4: `REPO_ROOT` resolves to the canonical repo root even when invoked from inside a worktree. | Met | `env.ts` now resolves the git common dir first and falls back to `__dirname` arithmetic only when git is unavailable. |
| AC-5: AC Coverage validation uses a markdown table parser and only checks the Status column. | Met | `validation.ts` now locates the AC Coverage table, infers the Status column from the header row, skips the separator row, and ignores prose outside the table. |
| AC-6: `npm run lint`, `npm run type-check`, and `npm test` pass; tests cover the false-positive and all-placeholder AC Coverage cases. | Met | All three required checks passed on the final tree, and `tests/run-task-validation.test.ts` includes the two parser regressions from the spec. |

## Edge Cases Considered

- `--dry-run` still validates task IDs and `status.json` presence, but it intentionally bypasses `claude`/`codex` dependency checks.
- `--pr` still fails fast if `gh` is unavailable, before any commit or push happens.
- Human-review commit logic rejects preexisting staged files outside the allowlist instead of sweeping them in.
- Worktree mode copies the managed docs back into the active worktree immediately before the human-review commit so the task-branch commit stays complete after the telemetry sync step.
- The prompt snapshot changed because `REPO_ROOT` now resolves through git during tests, so the canonical repo path appears in the generated fixture instead of the old worktree path.

## Blockers

- None.

## Validation Outcomes

> All applicable checks must pass before submitting for review. If a check appears in spec.md's Validation Required section, it must be recorded as Pass or Fail here — do not mark a required check N/A. Use N/A only for checks that the spec did not require, and explain why in Notes. Failed checks must be fixed — do not submit with failures. Move unresolved failures to Blockers.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Exited 0 on the final tree. |
| `npm run type-check` | Pass | Exited 0 on the final tree. |
| `npm test` | Pass | Exited 0 on the final tree; 69 tests passed. |
| `npm run build` | N/A | No build step is required by the spec or the repo’s validation matrix for this task. |
| `npm run test:e2e` | N/A | No UI surface or E2E harness is involved in this task. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>`

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Findings addressed

- _correctness bug:_ "<one-line summary>" → fixed at file:line
- _risk/guardrail:_ ... → ...
- _spec gap:_ ... → ...
- _optional cleanup/nit:_ ... → addressed / deferred (rationale)

### AC deltas (if any)

- AC-N: was Partial → now Met (file:line)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |
-->
