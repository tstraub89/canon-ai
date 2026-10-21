# PR Body: base-drift-conflicts-only - --pr base-drift blocks only on real merge conflicts

## Summary

- `--pr` and `--push` now block on real merge conflicts with `origin/<base>` only. A base branch that moved on files this task never touched no longer aborts the run. Canon prints one info line saying those files merge cleanly.
- The conflict check runs `git merge-tree --write-tree` against the commit about to be pushed. It runs right before each push, after the human_review commit, so it probes the tree git actually recorded (including any pre-commit hook rewrite).
- A conflict aborts before pushing and lists every conflicted path, allowlisted ones included, since a conflict in any file breaks the squash merge in `--ship`. On an abort from the human_review commit, canon soft-resets that commit, so HEAD and origin are unchanged and a re-run works once the conflict is resolved.
- `--force` bypasses a conflict with a warning that names the paths. Probe errors fail closed and `--force` cannot bypass them. On Git older than 2.38 canon warns that conflicts weren't checked and proceeds.
- Task-side scope drift (files changed outside the spec's Affected Files) is unchanged.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Behavior change to know about: non-overlapping base advance no longer nudges a rebase before the PR opens. Nothing re-validates the task against the new base unless the forge runs CI on the PR.
- Git 2.38 or newer is required for the conflict check. Older Git warns and skips it.
- Manual check: the spec's Human Test Plan (two tasks on one base, a same-line conflict, an undeclared-file scope abort) has not been run yet.
