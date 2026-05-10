# Code Review: fix-pipeline-bugs

> Reviewer: Claude | Spec: `tasks/fix-pipeline-bugs/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

> **Note**: The pipeline's pre-flight validation gate previously wrote a "BLOCKED" rejection to this file because it ran against a stale baseline before the implementation commit landed. That artifact is replaced by this full review. The diff from `dev...HEAD` confirms all handoff-listed files are present and changed.

Review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run (lint, type-check, test)
- [x] No required checks were skipped without justification (build and e2e marked N/A with valid reasons)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `--dry-run` prints planned phases/agents/model/effort; skips LLM spawn; `CliArgs.dryRun`; flag in `printUsage`; `skipAgentDeps` extended | Pass | `dryRun: boolean` in `types.ts`; parsed + usage in `cli.ts`; `skipAgentDeps = cliArgs.ship \|\| cliArgs.dryRun` in `main.ts`; `printDryRunPlan()` exits before any phase dispatch. |
| AC-2: `syncWorktreeTelemetry` does not write to REPO_ROOT when destination is ≥ source bytes | Pass | `needsCopy = a.length > b.length` in `worktree.ts:187` — copies only when worktree source is strictly longer. |
| AC-3a: human_review no longer dies with "Unknown phase"; without `--push`/`--pr` prints notice and exits 0 | Pass | `runPhase()` has a `human_review` case that prints a formatted notice with done.md paths and calls `process.exit(0)`. |
| AC-3b: With `--push`/`--pr`, commits task artifacts + telemetry + managed docs, pushes; `--pr` also creates draft PR | Pass | `commitHumanReviewFiles()` mirrors docs, validates allowlist, stages all five categories, commits, pushes, and optionally calls `gh pr create --draft`. |
| AC-3c: `PIPELINE_MANAGED_DOCS` is a single exported constant in `worktree.ts`, no inline path duplication | Pass | Constant exported from `worktree.ts`, consumed by `flushWorktreeTelemetry()` and imported as `splitWorktree.PIPELINE_MANAGED_DOCS` in `main.ts`. |
| AC-3d: `TASK_ARTIFACT_FILES` includes `notes.md` | Pass | `notes.md` added to the `Set` in `worktree.ts:20`. |
| AC-4: `REPO_ROOT` resolves to canonical repo root from inside a worktree | Pass | `resolveRepoRoot()` in `env.ts` runs `git rev-parse --git-common-dir`, handles relative (main repo) and absolute (worktree) return paths via `path.isAbsolute`, falls back to `__dirname` arithmetic on error. |
| AC-5: AC Coverage check uses a table parser; Status column inferred from header; prose line does not trigger false positive | Pass | `checkAcCoveragePlaceholders()` in `validation.ts` filters to `\|`-prefixed lines only, finds Status column index by header name, skips separator row, checks only the Status cell. |
| AC-6: lint/type-check/test pass; new test cases for prose false-positive and all-placeholder table with non-first Status column | Pass | All three commands exited 0; two new test cases in `tests/run-task-validation.test.ts` matching exactly the spec's scenarios. |

### Dropped Sections Check

- [x] Non-goals respected — no new pipeline phases, no tier/model/effort changes, no `--ship` behavior changes, no `AGENTS.md` workflow rule changes
- [x] Known Risks addressed — `spawnSync` in try/catch with fallback; commit path checks `git status` and rejects empty/unexpected staged sets; `gh` guard fires before any git state mutation; Status column inferred from header
- [x] Human Test Plan is satisfiable — dry-run, worktree REPO_ROOT, sync clobber guard, human-review clean exit, and AC false-positive all exercisable from the repo root

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

All five bugs are fixed cleanly in their intended files. The `commitHumanReviewFiles` function is notably thorough: it mirrors managed docs before staging, enforces an allowlist on both the pre-stage dirty set and the post-stage index, and guards against pre-existing staged files outside the allowlist. The `checkAcCoveragePlaceholders` extraction makes the AC table parser independently testable. No correctness bugs found.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- `optional cleanup/nit`: In `commitHumanReviewFiles` (`main.ts:562-563`), `baseBranch` and `title` are computed unconditionally but are only consumed inside the `if (cliArgs.pr)` block. No correctness impact — just unnecessary work on `--push`-only runs.

- `optional cleanup/nit`: The `if (cliArgs.pr && !ghAvailable) die(...)` guard appears in both `main()` (early exit before phase loop) and inside `commitHumanReviewFiles` (redundant). Not a bug — the inner copy is dead code given the outer guard runs first.

#### Spec Gaps

- `spec gap`: AC-3c says `PIPELINE_MANAGED_DOCS` is "consumed by both `syncWorktreeTelemetry`/`flushWorktreeTelemetry`" but `syncWorktreeTelemetry` does not use the constant. Codex correctly reasoned that managed docs don't flow in the worktree→REPO_ROOT direction (only telemetry files do), so the constant belongs only in `flushWorktreeTelemetry` and the human_review commit path. The AC text over-specified by naming both functions together. Worth clarifying in the spec template so future reviewers don't flag this as a miss.

## Final Verdict

- [x] **Approved** — ship as-is

---

<!--
On re-review, append below this line:

## Round N — verifying iteration N's response to round N-1

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
