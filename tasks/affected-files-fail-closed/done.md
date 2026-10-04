# Completion Summary: affected-files-fail-closed — getAffectedFiles fails closed on git diff failure

> For the human. This is what you need to know.

## What Changed

When canon couldn't read the task branch's diff against its base (stale or mistyped `base_branch`, deleted base, any git error), the changed-file list silently became empty, so scope guards treated "couldn't read the diff" as "nothing changed" and let work through. `getAffectedFiles` now returns an explicit success-or-failure result that carries git's error text on failure, and every caller handles the failure. The full-send review router and the code-review pre-flight now block `code_review` with the git error instead of advancing to QA or misrouting to re-implement. The `--pr`/`--push` drift abort now says the task-changed files couldn't be computed (and `--force` does not bypass that) instead of giving wrong rebase advice. The implement phase keeps going but tells the agent to run the full check matrix rather than claiming "no prior commits". Existing bundle precedence is preserved: SPEC GAP halts, requested changes reroute, and only bundles that would otherwise advance get the new block.

## Files Changed

- `src/orchestrator/git.ts` — `getAffectedFiles` returns an `ok`/`stderr` result; failure has no files field
- `src/orchestrator/main.ts` — full-send router fails closed with precedence kept; `--pr`/`--push` drift gate reports unreadable task-changed diff before the `--force` branch
- `src/orchestrator/phases/code-review.ts` — pre-flight blocks on unreadable scope before handoff classification; shared full-send exemption predicate
- `src/orchestrator/phases/implement.ts` — warns on probe failure and continues
- `src/orchestrator/prompts/index.ts` — distinct "could not determine" affected-files note
- `tests/run-task-code-review.test.ts`, `tests/run-task-safety.test.ts`, `tests/run-task-validation.test.ts`, `tests/run-task-prompts.test.ts` — regressions for each caller plus real-git contract test
- `dist/orchestrator/run-task.js` — rebuilt bundle
- `docs/patterns.md` — documents the explicit result contract

## How to Test

1. In a throwaway task with `status.base_branch` set to a nonexistent branch, run `canon run` through `code_review`.
2. Expected: `code_review` auto-blocks (exit 2) with the git error in the reason; it does not advance to QA or loop back to implement.
3. Run `canon run --pr` (also with `--force`) in the same state with drift present. Expected: abort saying task-changed files could not be computed, no rebase advice, no commit.
4. Normal tasks with a valid base behave as before.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm run build` | Pass (second build byte-identical; CLI bundle unchanged) |
| `npm test` | Pass — 1,348 tests: 1,347 passed, 0 failed, 1 skipped (existing linked-worktree REPO_ROOT fixture, skipped by its environment guard because `.git` writes are restricted; unverified here, not passing) |
| `npm run docs-refs-check` | Pass |
| Targeted regressions | Pass (red-first failures confirmed before fixes) |
| Structural collapse check | Pass |
| `git diff --check` | Pass |

## Human Verification Required

None.

Pre-merge checklist (not confirmable from this session): version/changelog (decided at release step), PR body current, final CI green on the PR head, final diff matches spec intent.

## Proposed Changelog

- **A task whose base branch can't be diffed now blocks instead of passing scope checks.** If git can't read the task's committed diff against its base (a stale or mistyped `base_branch`, a deleted base), full-send review and the code-review pre-flight block `code_review` with git's error rather than advancing to QA or looping back to implement, and `--pr`/`--push` report that the task-changed files couldn't be computed instead of advising a rebase. `--force` does not bypass it. Implementation continues, with the full check matrix required.

## Decisions Made

- `--force` does not bypass an unreadable task-changed diff: the probe runs before the force branch. The plan flagged this for confirmation; implemented per the spec's no-bypass non-goal.
- Unreadable scope under SPEC GAP gives no assurance that a later `--pr` gate will catch scope (that gate skips when the fetch fails); the note requires repairing the base/history and manual scope verification before BLESS.
- Suggested `canon task set base_branch` recovery hint omitted: base_branch is locked once a branch is recorded.
- Deferred: operator-doc addition and a pre-existing sibling evidence-probe issue (outside Affected Files).

## Open Questions

- Confirm the `--force` semantics above are intended.
- Sibling evidence-probe fail-open issue should be filed as a follow-up.

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Code review ran 3 rounds (two wording-level recovery-guidance fixes in SPEC GAP messages); one environment-skipped linked-worktree test.
