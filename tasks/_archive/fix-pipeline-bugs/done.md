# Done: Fix five harness bugs from pipeline refactor

**Task**: fix-pipeline-bugs
**Date**: 2026-05-09
**Reviewer**: Claude
**Verdict**: Approved — no code-quality issues requiring a Codex iteration; two nits and one spec-text gap noted but not blocking.

---

## What Changed

Five discrete bugs introduced by the recent pipeline refactor are fixed. The changes are confined to the orchestrator scripts and tests — no pipeline tiers, phase order, or AGENTS.md policy was altered.

**Bug 1 — `--dry-run` flag (`cli.ts`, `types.ts`, `main.ts`)**
Added a dependency-free smoke path. `npx tsx scripts/run-task.ts <id> --dry-run` now prints every planned phase with its agent, model, and effort, then exits 0 without spawning any LLM session. The flag bypasses the `claude`/`codex` dependency check while still requiring `jq` and a valid task ID.

**Bug 2 — `syncWorktreeTelemetry` clobber guard (`worktree.ts`)**
The byte-equality guard was replaced by a byte-length comparison: the worktree copy only writes to REPO_ROOT when it is strictly longer than the destination. This prevents a stale (shorter) worktree copy of `docs/lessons-learned.md` from silently deleting newer entries in the main checkout.

**Bug 3 — `human_review` handler (`main.ts`, `worktree.ts`)**
Restored the handler that was dropped in the refactor. Without `--push`/`--pr`, the pipeline now prints a summary notice (listing the done.md path) and exits 0. With `--push` or `--pr`, it commits all dirty task artifacts (including `notes.md`, now added to `TASK_ARTIFACT_FILES`), telemetry files, and all five protected docs (`docs/architecture.md`, `docs/codebase-map.md`, `docs/decisions.md`, `docs/patterns.md`, `docs/product-context.md`) to the task branch, then pushes. `--pr` additionally creates a draft PR via `gh pr create`.

The five protected docs are now tracked as a single exported constant `PIPELINE_MANAGED_DOCS` in `worktree.ts`, consumed by `flushWorktreeTelemetry()` and the human_review commit path — no inline path duplication.

**Bug 4 — `REPO_ROOT` resolves to worktree (`env.ts`)**
`env.ts` now resolves the canonical repo root by running `git rev-parse --git-common-dir` at import time (with a `__dirname`-based fallback for non-git environments). Both relative (`.git`, from the main repo) and absolute paths (from a worktree) are handled correctly. `WORKTREES_ROOT` derives from the corrected root.

**Bug 5 — AC Coverage false-positive (`validation.ts`, `tests/run-task-validation.test.ts`)**
Replaced the line-anchored regex with a markdown table parser. The parser locates the header row, infers the Status column index by name, skips the separator row, and checks only Status cells. Prose lines in the AC Coverage section that happen to contain "AC-1" and the placeholder text no longer trigger a false positive. Two new test cases were added: one for the prose false-positive scenario, one for a table where Status is not the first column.

**Docs updated**: `docs/pipeline-orchestrator.md` — added the `--dry-run` flag row to the Flags table and documented `PIPELINE_MANAGED_DOCS` in the Auto-Commit section.

**Prompt snapshot updated**: `tests/run-task-prompts.golden.json` — the golden file now reflects the canonical repo path returned by `REPO_ROOT` during tests (previously pointed to the worktree path).

---

## Files Changed

| File | Change |
|---|---|
| `scripts/run-task/types.ts` | Added `dryRun: boolean` to `CliArgs` |
| `scripts/run-task/cli.ts` | Parsed `--dry-run`; added to `printUsage` |
| `scripts/run-task/env.ts` | `REPO_ROOT` now resolves via `git rev-parse --git-common-dir` with fallback |
| `scripts/run-task/main.ts` | Added dry-run early exit, extended `skipAgentDeps`, restored `human_review` handler |
| `scripts/run-task/worktree.ts` | Added `PIPELINE_MANAGED_DOCS`; added `notes.md` to `TASK_ARTIFACT_FILES`; byte-length sync guard; expanded telemetry flush |
| `scripts/run-task/validation.ts` | Replaced regex AC Coverage check with table parser |
| `tests/run-task-validation.test.ts` | Added two AC parser test cases |
| `tests/run-task-prompts.golden.json` | Updated golden file to canonical repo path |
| `docs/pipeline-orchestrator.md` | Documented `--dry-run` and human-review commit scope |

---

## How to Test

1. **Dry-run smoke** — from repo root: `npx tsx scripts/run-task.ts fix-pipeline-bugs --dry-run`
   - Expected: lists each pipeline phase with agent and model; no AI service is called; exits 0.

2. **Dry-run from worktree** — `cd ../dev-worktrees/<any-worktree>` then run the same command.
   - Expected: does not crash; any REPO_ROOT printed in output points to the canonical repo, not the worktree directory.

3. **Sync clobber guard** — open a worktree's `docs/lessons-learned.md` and delete several lines. Run a pipeline step.
   - Expected: `lessons-learned.md` in the main repo checkout is unchanged (shorter worktree copy did not clobber it).

4. **Human-review clean exit** — advance any task to qa done via `--step`, then run `npx tsx scripts/run-task.ts <id>` without `--step`.
   - Expected: pipeline prints a human_review notice listing done.md path and exits 0; no "Unknown phase: human_review" error.

5. **AC false-positive guard** — add a prose line like `See AC-1 for the Met / Partial / Not met breakdown.` to a handoff's AC Coverage section (outside the table). Run through code_review.
   - Expected: preflight accepts the handoff; the prose line does not trigger an "unfilled placeholder" rejection.

---

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` (69 tests) | Pass |
| Build | N/A — no build step required |
| E2E | N/A — no UI surface |

Code review passed in one round: Stage 1 (spec compliance) and Stage 2 (code quality) both approved. No correctness bugs. Two nits noted (unconditional variable computation, dead guard copy) and one spec-text gap (AC-3c over-stated which functions consume `PIPELINE_MANAGED_DOCS`); none were blocking.

---

## Decisions Made

- `syncWorktreeTelemetry` uses byte-length (not byte-equality or line-count) as the append-only guard. Byte-length is the cheapest reliable proxy for "source has more content" given the telemetry files are append-only by convention.
- Before the human_review commit, `PIPELINE_MANAGED_DOCS` are mirrored from REPO_ROOT back into the active worktree (undoing what `syncWorktreeTelemetry` reverted) so the task-branch commit is complete in worktree mode.
- `PIPELINE_MANAGED_DOCS` is intentionally *not* consumed by `syncWorktreeTelemetry` — managed docs do not flow in the worktree→REPO_ROOT direction, only in the flush/commit direction. AC-3c's spec text over-stated this; the implementation is correct.

---

## Open Questions

None. All five bugs are resolved and all ACs met.

---

## Proposed Changelog

This task fixes five bugs in the pipeline harness. All fixes are internal to the orchestrator — no pipeline phase order, task schema, or AGENTS.md policy changed. Audience: canon-ai contributors.

**Proposed version**: `0.3.0` (minor bump)

**Rationale**: AC-1 adds `--dry-run`, a new user-visible CLI flag and orchestrator capability. New flags are minor by the project's SemVer policy (new features without breaking existing usage). The remaining four bugs are patch-quality fixes absorbed into the same minor bump. No breaking changes.

**Proposed entry** (human finalizes before the changelog/version-bump commit):

```markdown
## [0.3.0] — 2026-05-09

### Added

- `--dry-run` flag: prints planned phases, agents, model, and effort for any task without spawning an LLM session. Useful for smoke-testing orchestrator prompt construction. Skips `claude`/`codex` dependency checks; still requires `jq` and a valid task ID.

### Fixed

- `syncWorktreeTelemetry` no longer overwrites `docs/lessons-learned.md` (and other telemetry files) in the main checkout with a shorter worktree copy. The sync now writes only when the worktree source is strictly longer than the destination.
- `human_review` phase no longer crashes with "Unknown phase: human_review" after qa completes. Without `--push`/`--pr`, the pipeline prints a notice listing the done.md path and exits 0. With `--push`/`--pr`, it commits task artifacts, telemetry, and all five protected docs to the task branch before pushing.
- `notes.md` is now included in `TASK_ARTIFACT_FILES`, so agent notes written inside a worktree are mirrored back to REPO_ROOT before the human_review commit.
- `REPO_ROOT` resolves to the canonical repo root when `run-task.ts` is invoked from inside a git worktree. Previously it resolved to the worktree root, causing `--reroute` and other flags to crash.
- AC Coverage validation no longer false-positives on prose lines in the AC Coverage section that happen to contain "AC-N" and the placeholder text. The check now uses a markdown table parser and inspects only the Status column.
```
