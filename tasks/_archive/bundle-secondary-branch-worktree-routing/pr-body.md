## Summary

- Fix a bug where running two or more tasks together as a worktree-mode bundle wrote the second (and later) task's branch bookkeeping into the main checkout instead of the shared bundle worktree, leaving main dirty and the worktree's own copy blank
- Add a real-git regression test that reproduces the wrong-main-write bug pre-fix and proves the fix, plus a set of fail-closed negative tests for the new resolution scan (inherited directories, mismatched/false `worktree` flags, multi-match, enumeration failure, malformed/schema-invalid candidate files)
- Harden `resolveTaskCwd` so a bundle secondary is always resolved by matching a worktree's own content (its `worktree` flag + its own checked-out branch) rather than by reading a main-checkout branch hint that the very same code path was responsible for setting

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt `dist/cli/index.js` and `dist/scripts/run-task.js`; both committed)

## Notes

- The bootstrap now writes every bundle member's branch (secondaries first, leader last) directly to the resolved worktree destination, never through the resolver — this closes the chicken-and-egg where resolving a secondary's location depended on the very branch write that resolution was supposed to enable.
- A separate, already-known crash-consistency hole in the bundle bootstrap (a mid-loop process exit stranding a blank secondary) is out of scope here — it's traced to source but not reproduced, and is tracked as a follow-up in `docs/BACKLOG.md` rather than fixed on paper.
- Code review ran three lenses (anchored, cold Claude, cold Codex); the only changes-requested came from the cold Claude lens over a fail-closed `die()` tradeoff that the spec deliberately accepts (verified, not a bug) — final verdict approved with nits, all of them optional low-severity cleanups.
- Manual verification: confirmed via the new real-git test that after a two-task bundle's first implement, the worktree copy of the secondary's status file carries the shared branch, the main checkout's copy is untouched and clean, and resolving the secondary's task returns the shared worktree path.
