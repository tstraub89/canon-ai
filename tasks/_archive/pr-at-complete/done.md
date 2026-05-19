# Done: pr-at-complete — `canon run --pr` handles `complete` phase + idempotent on existing PR

## What Changed

`canon run <id> --pr` (and `--push`) previously died with `Unknown phase: complete` when a task had already passed `human_review`. Two related sharp edges were fixed in the same change:

1. **`complete`-phase dispatch**: `runPhase()` now routes `complete` through the same terminal handler as `human_review` for `--pr` and `--push`. No new code path — the existing handler body is shared; only the dispatch condition was widened.

2. **Idempotent `--pr` on an already-open PR**: `commitHumanReviewFiles()` now checks for an existing open PR *before* trying to create one. When a PR is already open (the normal state after a successful first `--pr` run), the function prints the PR URL and exits 0 instead of crashing. This applies at both `human_review` and `complete` — the fix is in the shared code path.

3. **State-aware `complete` banner**: Running `canon run <id>` with no flags at `complete` now prints a friendly banner instead of crashing. The banner inspects three signals (open PR exists / branch on origin with no PR / unpushed local branch) and prints the matching next-step command.

## Files Changed

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | Extended `runPhase()` dispatch to accept `complete`; added state-aware `complete` banner (three states per spec); added idempotent existing-PR branch in `commitHumanReviewFiles()` with canonical URL lookup via `gh pr view` + remote fallback. |
| `tests/run-task-safety.test.ts` | New tests: banner formatter unit tests, `complete` no-flag subprocess tests for all three states, idempotent `--pr` tests at `human_review` and `complete`, dirty-file allowlist guard at `complete`, `--ship` smoke test. |
| `CHANGELOG.md` | `### Fixed` entry under `## [1.1.4] — unreleased` referencing issue #72. |
| `dist/scripts/run-task.js` | Rebuilt from source (standard post-build normalize). |

## How to Test

Follow the Human Test Plan from the spec:

1. Advance any task to `complete` manually: `canon task phase <id> human_review done`. Confirm `canon task list` shows it at `complete`.
2. Run `canon run <id> --pr`. Should push + open a draft PR (or print the existing PR URL) — must NOT crash with "Unknown phase: complete".
3. Re-run `canon run <id> --pr` immediately. Should print `Existing draft PR: #N (URL)` and exit 0. No duplicate PR created.
4. Run `canon run <id>` (no flags). Should print the "TASK COMPLETE — already past human_review" banner with the matching next-step. Exit 0.
5. Edit an unrelated file under `src/`, then run `canon run <id> --pr`. Should reject with the dirty-file allowlist guard. Exit non-zero.
6. After merging the PR, run `canon run <id> --ship`. Should archive normally.
7. Read `CHANGELOG.md` and confirm the `### Fixed` entry under `[1.1.4]` references issue #72.

## Test Results

All validation checks passed in Codex's implementation run:

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass — 279 passing, 1 skipped (includes new complete / human_review / ship coverage) |
| `npm run build` | Pass — dist/ regenerated and path-normalized |

## Decisions Made

- **Subprocess-level tests over unit-testing `runPhase()` directly.** Codex tested via spawned CLI subprocesses rather than exporting `runPhase()` for direct unit testing. This exercises the shipped CLI entrypoint and avoids brittle internal mocking. Documented in handoff as a valid implementer's call per spec guidance.
- **`gh pr view` + remote fallback for PR URL.** When the idempotent branch fires, the canonical PR URL comes from `gh pr view <num> --json url --jq .url`, with fallback to parsing `git remote get-url origin`. Matches the spec's preference order.

## Open Questions

None. All ACs met, no reroutes.

---

## Proposed Changelog

The CHANGELOG entry was written by Codex as part of the implementation (AC-9). It is already present under `## [1.1.4] — unreleased`:

> **`canon run <id> --pr` now handles `complete` and stays idempotent when a PR already exists.** The terminal dispatch now treats `complete` the same as `human_review` for `--push` / `--pr`, so a task that has already reached `complete` no longer dies with `Unknown phase: complete`. On a rerun, the idempotent `--pr` path detects an already-open draft PR and prints its URL instead of trying to recreate it. `canon run <id>` with no flags at `complete` now prints a state-aware banner for the three exit states: open PR, pushed with no PR, or not pushed yet. Closes [#72](https://github.com/tstraub89/canon-ai/issues/72).

**Proposed version bump**: no change beyond what was already planned for 1.1.4. This is a `### Fixed` entry — a crash and hostile-UX fix with no new commands or adopter behavior to learn. SemVer: patch.
