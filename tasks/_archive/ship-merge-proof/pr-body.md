## Summary

- Fixed `--ship` requiring 2–3 invocations when the first run landed the squash-merge on origin but aborted before the pull/archive step — the re-run now fast-forwards the base and finishes in one shot.
- Added forge-proof merge verification before local task-branch deletion: the pinned PR must be `MERGED`, its base ref must match the task's `base_branch`, and the local task-branch tip must be an ancestor of (or equal to) the PR's `headRefOid`. `--force` does not bypass this gate.
- `--pr` now records the PR number in `status.json` so `--ship` keys off the specific PR rather than a branch-name query, preventing false confirmation from a stale or reused branch name.
- `--ship` no longer dies when the remote task branch is already gone on cleanup (GitHub's auto-delete-head-branches removes it on merge; the cleanup step now treats "remote ref does not exist" as a no-op).

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` or `scripts/run-task/` changed)

## Notes

The data-loss surface was specific: `git branch -D` (destructive) was unconditional once the branch was queued for deletion, while `git pull --ff-only` (non-destructive) was being gated on a forgeable proof. This inverts that: the fast-forward runs freely, and the deletion requires all three of MERGED + base-ref-match + ancestor-or-equal head check.

The proof uses ancestor-or-equal (`git merge-base --is-ancestor <localTip> <headRefOid>`) rather than strict SHA equality. Strict equality broke a documented-safe case: when the task branch was advanced from another checkout, the local ref is behind `origin/<branch>` but holds no unique commits — the ancestor check accepts that (local ⊆ merged) while still failing closed when the local branch has commits the PR never included. The `headRefOid` is materialized locally before the squash-merge can delete the remote branch; if it can't be fetched, the merge is unproven and `--ship` dies.

`dist/cli/index.js` had no tracked delta after normalization despite `main.ts` being reachable from both dist entry points; only `dist/scripts/run-task.js` appears in the diff.

The new `tests/run-task-ship.test.ts` uses real-git fixtures and a stubbed `gh` to cover all 15 ACs, including the abort-then-re-run path, bundle all-or-nothing proof ordering, behind-local ancestor ships (AC-14), unmaterializable PR head fails closed (AC-15), and the P1 regression guard (base in sync without proof must still refuse deletion).
