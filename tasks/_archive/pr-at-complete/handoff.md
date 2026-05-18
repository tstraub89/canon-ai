# Implementation Handoff: pr-at-complete

> Author: Codex | Spec: `tasks/pr-at-complete/spec.md` | Plan: `tasks/pr-at-complete/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The section below covers Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file.

## Changes

| File | What Changed |
|---|---|
| [scripts/run-task/main.ts](/Users/tstraub/canon-ai/dev-worktrees/pr-at-complete/scripts/run-task/main.ts) | Added the `complete` terminal dispatch, a state-aware `complete` banner, canonical PR URL lookup with `gh pr view` + remote fallback, and an idempotent existing-PR branch for `--pr` reruns. |
| [tests/run-task-safety.test.ts](/Users/tstraub/canon-ai/dev-worktrees/pr-at-complete/tests/run-task-safety.test.ts) | Added helper-level banner assertions plus CLI subprocess coverage for `complete` no-flag states, idempotent `--pr` at `human_review` and `complete`, the complete-phase allowlist guard, and a `--ship` smoke test. |
| [CHANGELOG.md](/Users/tstraub/canon-ai/dev-worktrees/pr-at-complete/CHANGELOG.md) | Added the unreleased fixed entry for the `complete` / existing-PR behavior. |
| [dist/scripts/run-task.js](/Users/tstraub/canon-ai/dev-worktrees/pr-at-complete/dist/scripts/run-task.js) | Rebuilt from source so the shipped artifact matches the updated `complete` handling and PR idempotency logic. |

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

Keep `complete` on the same terminal path as `human_review` for `--pr` / `--push`, and make the rerun case idempotent by detecting an already-open PR and printing its canonical URL instead of trying to recreate it. The no-flag path now tells the user which of the three post-completion states they are in and what command to run next.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** Document any implementation differences here.

| Deviation | Rationale | AC impact |
|---|---|---|
| Kept the `human_review` banner inline instead of extracting a dedicated helper. | The implementation needed only the new `complete` banner and the shared PR URL helper, so the smaller refactor kept churn lower. | None |
| Added subprocess-level tests in `tests/run-task-safety.test.ts` instead of exporting `runPhase()` for direct unit tests. | The subprocess tests exercise the shipped CLI entrypoint and avoided brittle internal mocking, while still covering the required dispatch behavior. | None |
| Added explicit `human_review` and `--ship` smoke coverage in addition to the `complete` cases from the plan. | This closed the spec's rerun requirement for `human_review` and locked in the unchanged `--ship` path. | None |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1: `runPhase()` routes `phase === 'complete'` through the human-review terminal path for `--pr` / `--push`, and no-flags at `complete` exits 0 with the new banner. | Met | Covered by the complete-phase subprocess tests and the `complete` branch in `scripts/run-task/main.ts`. |
| AC-2: On a clean tree at `complete`, `--pr` detects an existing open PR and prints its URL instead of recreating it. | Met | `commitHumanReviewFiles()` now resolves the canonical URL and emits `Existing draft PR: #N (URL)`. |
| AC-3: No-flag `complete` prints the correct state-aware banner for open PR, pushed-no-PR, and unpushed states. | Met | Covered by the three `main()` subprocess tests and the pure `formatCompleteStateBanner()` helper tests. |
| AC-4: On a clean tree at `complete`, if the branch is on origin and a PR is already open, `--pr` is a no-op with the existing-PR message. | Met | Verified by the `main --pr on complete` subprocess test. |
| AC-5: Re-running `canon run X --pr` at `human_review` after a successful first run is a no-op with the existing-PR message. | Met | Verified by the `main --pr at human_review` subprocess test. |
| AC-6: The dirty-file allowlist still rejects files outside the `human_review` allowlist, even at `complete` with `--pr`. | Met | Verified by the `complete --pr` dirty-path rejection test. |
| AC-7: `--ship` continues to fire at `complete` unchanged. | Met | Verified by the complete-phase ship smoke test that exits 0 and archives the disposable task. |
| AC-8: Unit tests cover the banner formatter, the `complete` no-flag states, the idempotent PR helper/message, the dirty allowlist guard, and the `--ship` sanity path. | Met | Implemented in `tests/run-task-safety.test.ts`. |
| AC-9: `CHANGELOG.md` gets a `### Fixed` entry under `## [1.1.4] — unreleased` describing the crash fix, idempotent retry, and friendly `complete` status message. | Met | Added the unreleased fix bullet and linked issue #72. |

## Edge Cases Considered

- Bundles dedupe the no-flag `complete` banner by branch, so a shared-branch bundle prints one message per branch, not one per task.
- The PR URL lookup prefers `gh pr view` and falls back to parsing `origin` when `gh` cannot return the URL.
- The existing-PR branch is shared by `human_review` and `complete`, so reruns stay idempotent in both phases.
- The `--ship` smoke test uses a disposable synthetic task ID and cleans up the archived and source task directories afterward.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final tree is lint-clean. |
| `npm run type-check` | Pass | Final tree type-checks cleanly. |
| `npm test` | Pass | 279 passing tests, 1 skipped. Includes the new complete/human_review/ship coverage. |
| `npm run build` | Pass | Regenerated `dist/scripts/run-task.js` and normalized the output paths. |
| `E2E` | not_configured | Spec marks E2E as N/A for this task. |

## Ready for Review

- [x] All spec ACs met
- [x] All applicable validation checks pass
- [x] All deviations from plan documented with rationale
- [x] Branch is current with `origin/<base>`

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

| File | What Changed |
|---|---|
| `<path>` | ... |

> **Reverting a file?** Perfect revert (no longer in `git diff base...HEAD`): delete it from all prior Changes tables and omit it here. Imperfect revert (still in diff, e.g. trailing newline): add it here as "Reverted to original (describe residual diff)".

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
