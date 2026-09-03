## Summary

- Move canon's default task-worktree location from a sibling directory (`../dev-worktrees/<id>`) to an in-repo, gitignored one (`.canon/worktrees/<id>`) — no more unexplained folder next to the project, no more collisions between two canon-adopting repos sitting side by side, and no more separate trust/directory grants for Codex/Claude to reach worktrees outside the repo.
- Worktree resolution itself is unchanged (still by branch/content, wherever registered); what's new is two pre-phase refusals in `canon run`: one for a task whose worktree is still outside the new root (names the old path, the new root, and both fixes), and one for a registered worktree whose directory was deleted by hand (names it and gives exact `git worktree add -f` / `git worktree remove --force` commands — no auto-prune, no auto-recreate).
- `canon task` commands still read/write an unmigrated task's true state from the main checkout; only running it, and invoking canon from inside the old worktree, are refused.
- Breaking change for existing adopters, documented in `CHANGELOG.md` under `[Unreleased]`, intended as a rider on the 3.0.0 open-source launch.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Went through 5 spec revisions and 6 amendment review rounds before implementation — the tricky part was resolving worktrees the same way regardless of location while still refusing to *run* an unmigrated task. Root-scoping the lookup itself was tried first and rejected: it silently misroutes the canonical first-worktree state (blank branch in the main-checkout `status.json` by design) to the main checkout instead of refusing loudly. The fix that stuck is a single new check at the `canon run` entry, with resolution left completely alone.
- Also replaced automatic pruning of a hand-deleted worktree's stale git registration with a loud refusal plus two explicit remedy commands — auto-pruning turned out to risk erasing the only evidence of where a task's state lives, and auto-recreating from the branch can't restore uncommitted post-implement work anyway.
- Known, accepted gap (tracked as a backlog follow-up, not blocking this PR): the missing-worktree check only verifies the directory exists on disk, not that it's intact — a partially corrupted worktree (partial `rm`, disk damage) would still pass. Narrow trigger, same as pre-existing behavior, called out explicitly during code review.
- Full test suite, lint, type-check, build, template sync, and docs-refs-check all pass. No UI surface, so no E2E run.
