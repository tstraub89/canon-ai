## Summary

- Task worktrees only ever linked the repo-root `node_modules`. In an npm-workspaces monorepo (`"workspaces": ["apps/*", "packages/*"]`), per-workspace dependencies that npm didn't hoist to the root were never linked, so a worktree was missing modules until someone ran a full install by hand — confirmed on a real adopter repo. Worktree setup now discovers every eligible workspace directory from the root `package.json` and links each one's `node_modules` the same way it already links the root's.
- Both containment directions are checked: a workspace path must resolve inside the repo on the source side and inside the worktree on the destination side, since a task branch can commit a workspace path as a symlink pointing outside the worktree while the main checkout has an ordinary directory there.
- The QA-end and human-review dirty-tree gates are widened so a verified per-workspace symlink is exempt the same way the root symlink already was — but only while a distinct task worktree is active. Any dirty path whose final segment is exactly `node_modules` is now rejected before staging everywhere, regardless of whether the repo declares workspaces.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` or `scripts/run-task/` changed)

## Notes

- This went through six code-review rounds and one spec amendment. The linker half (workspace discovery, containment, per-workspace linking) has been stable since round 2. Most of the churn was in the gate-widening half: three rounds each found a different way for a non-exempt `node_modules` path to ride a directory-form Affected Files prefix into a commit instead of aborting. That got fixed structurally — one shared classifier (`classifyHumanReviewPath`) now drives both the allowlist and the staging decision, instead of three functions each normalizing paths on their own.
- One real spec contradiction surfaced along the way: the AC requiring every non-exempt `node_modules` path to abort, and the AC requiring no-workspaces repos to see zero behavior change, directly conflict for a final-segment-`node_modules` path in a no-workspaces repo. Resolved by an amendment naming the rejection as a deliberate, strictly-safer exception — it can only newly reject a path pre-task code would have silently staged, never newly admit one. Verified directly against pre-task behavior, not just read.
- The spec's human test plan (start a task in a real npm-workspaces monorepo, confirm dependencies resolve with no install step, confirm nothing leaks outside the worktree) needs a real adopter repo and hasn't been run by an agent — worth doing before merge if a suitable test repo is handy.
- Two small follow-ups came out of review that I'm not blocking this PR on: the human-review abort message for a rejected `node_modules` path still describes the older directory-prefix remedy instead of naming the actual rule, and the root `node_modules` link isn't repaired on worktree reuse (only workspace links are) — so a rerun can report success while the root link is still missing. Neither commits bad data or bypasses a safety check; they're operator-signal gaps worth a small follow-up task.
- I owe a `docs/BACKLOG.md` line for the chokepoint-refactor note and the accumulated non-blocking review nits — flagged during review but not yet written.
