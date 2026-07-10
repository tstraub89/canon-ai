## Summary

- `--ship` used to run a blanket `checkout HEAD --` on every dirty shared doc in the supervising checkout right before the base-branch switch, discarding whatever was there — including a sibling task's pending pre-implement telemetry rows and any uncommitted edit to a knowledge doc. This actually happened in an adopter repo and destroyed an in-flight task's telemetry.
- Shared-doc dirt is now classified via `git status --porcelain` before anything merges. A dirty managed doc (e.g. `docs/patterns.md`) aborts the ship pre-merge, names the file, and tells you to commit or stash — `--force` does not bypass it. A dirty telemetry file (`docs/pipeline-invocations.md`, `docs/lessons-learned.md`, `docs/task-quality-log.md`) is only preserved if it's in the plain unstaged-modification shape *and* a pure append over the committed copy: the suffix is backed up, the working copy is reverted so the merge can proceed, and the suffix is re-appended as uncommitted dirt once the ship's own archive commit is staged (but before it's committed). A staged-only edit, a working-tree deletion or rename, and non-append telemetry dirt all abort pre-merge instead of being discarded or silently swept into the archive commit.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` since `scripts/run-task/` changed)

## Notes

- The re-append happens at a single point strictly *after* `stageArchiveChanges()` but *before* `commitArchiveChanges()` runs — not right after the merge, and not after the whole archive commit/push completes. Two of the three telemetry files pass through the archive commit's staging, so re-appending earlier would fold a sibling task's uncommitted rows into this task's `chore: archive` commit and push them upstream under the wrong task; re-appending later would leave the suffix unrestored through a commit or push failure. Dedicated integration tests pin both: the committed blob excludes the suffix while the working copy includes it, and the suffix survives a forced commit or push failure.
- Classification is gated first on the file's `git status --porcelain` code, not on content diff alone. An earlier round of this change classified purely by content, which let a staged-only edit (`git add` followed by a working-tree reset back to HEAD) pass as `clean` and ride silently into the archive commit — code review caught this as a real regression. Only the exact `' M'` code (plain unstaged modification) is eligible for the pure-append/managed-dirt content check; staged adds/modifies/deletes, working-tree deletes, renames, and untracked files all abort for both file classes.
- `--force` intentionally does not bypass the managed-doc abort — silent data loss on a knowledge doc is worse than the added friction of a commit-or-stash prompt.
- No dedup on re-append: under the current worktree-canonical model, REPO_ROOT telemetry dirt never gets mirrored onto a task branch, so the merged content can't already contain the preserved suffix. If a future change reintroduces that path, this assumption needs revisiting.
- The final 3-lens code review (anchored Claude, cold Claude, cold Codex) converged on two residual edges, both low-severity with no data-loss path: a mode-only (`chmod`) change with identical content is classified `clean`, which would bypass the fail-closed gate for a managed doc if that ever happened in practice; and the `HEAD:<path>` snapshot is read before the base-branch switch, which is correct under the supported worktree-canonical model but would validate against the wrong blob in a contrived non-base supervising checkout. Four smaller cosmetic/test-coverage nits (leaked empty backup dir, one misleading error string, an under-asserted test, a missing fixture) round out the six total — none blocking.
- `docs/pipeline-orchestrator.md`'s `--ship` run-order section is updated to describe the new gate.
