# Completion Summary: push-upstream-tracking — Set upstream tracking on task-branch push

> For the human. This is what you need to know.

## What Changed

When canon pushes a task branch at `human_review` (via `--pr` or `--push`), it previously used a bare `git push origin <branch>` at both push call sites. Neither set an upstream tracking ref, so the task worktree's local branch never knew it tracked `origin/<branch>`. After the push, `git status` reported no upstream, and bare `git pull` / `git push` (no args) failed with "no upstream configured."

The fix adds the `-u` / `--set-upstream` flag to both push invocations in `scripts/run-task/main.ts` — the clean-tree path (≈line 1117) and the dirty-tree commit-then-push path (≈line 1215). After `--pr`, `git status` in the worktree now shows `## branch...origin/branch`, and bare `git pull` / `git push` work without spelling out the remote and branch name. Re-running `--pr` is idempotent — `-u` on an already-tracking branch re-affirms the ref without error.

## Files Changed

- `scripts/run-task/main.ts` — added `-u` at both human_review push call sites
- `dist/scripts/run-task.js` — rebuilt from source (carries the same flag)
- `tests/run-task-safety.test.ts` — fake-git harness extended; argv assertions for both push paths; push-failure regression for `die(...)` message
- `tests/run-task-ship.test.ts` — real-git fixture extended: upstream tracking ref assertion, `status -sb` header assertion, and rerun idempotence test

## How to Test

1. Take a task to the review-ready state and run `canon run <id> --pr` to push the branch and open the draft PR.
2. In the task's worktree, run `git status`. **Expected:** the status header shows the branch is tracking its remote copy (e.g. `## task/my-task...origin/task/my-task`), not "no upstream configured."
3. Run `git pull` and `git push` with no arguments. **Expected:** both work without an error about missing upstream.
4. Run `canon run <id> --pr` a second time. **Expected:** succeeds without error; tracking ref remains intact.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass — full suite including new argv and tracking-ref assertions |
| `npm run build` | Pass — `dist/scripts/run-task.js` rebuilt and committed |
| `npm run sync-templates:check` | N/A (no canon-managed template changed) |
| `npm run docs-refs-check` | N/A (no docs reference changed) |
| E2E | N/A (no UI surface) |

## Human Verification Required

None.

## Proposed Changelog

Proposed entry (targeting `release/v1.12`):

```
### Fixed

- **`canon run --pr` now sets the upstream tracking ref on the pushed task branch.**
  Previously, `git push` was bare, leaving the local branch without a configured
  upstream. After `--pr`, `git status` shows the branch is up to date with
  `origin/<branch>`, and bare `git pull` / `git push` work without spelling out
  the remote and branch name. Re-running `--pr` is idempotent — the flag is a
  safe no-op when the branch already tracks origin.
```

Proposed version bump: **patch** — single-flag ergonomic fix; no behavior change to the pipeline itself. Human finalizes the version number for the v1.12 release.

## Decisions Made

- `-u` added to both push sites independently rather than consolidating the two sites first. Both share the same `gitSafeAt` wrapper and `die(...)` failure contract; the single-flag change is complete and low-risk without a larger refactor.
- The flag is applied on every `--pr` invocation, not just the first push, because `-u` is idempotent and ensures tracking is always established regardless of which code path ran.

## Open Questions

None.
