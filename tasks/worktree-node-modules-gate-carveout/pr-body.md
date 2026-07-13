## Summary

- Fix a hard-stop where canon's own worktree `node_modules` symlink could block the QA-end and human-review commit gates on projects whose `.gitignore` uses the trailing-slash `node_modules/` style instead of canon's own bare `node_modules` style (adopter report: #197).
- Both gates now exempt a top-level `node_modules` porcelain entry only when a filesystem probe confirms it's exactly canon's own symlink resolving to the main checkout's `node_modules` — a real file, real directory, or wrong-target symlink still blocks the gate exactly as before.
- Hardened `ensureWorktree()`'s setup guard to be `lstat`-based instead of `fs.existsSync`, so re-running setup on a worktree that already has the symlink never throws `EEXIST`.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` (963 tests: 962 pass, 1 skipped)
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` — `dist/scripts/run-task.js` changed)

## Notes

- The exemption is deliberately narrow and write-inert: it only affects which files get *classified* as expected/unexpected dirt at the commit boundary. Staging itself is untouched — `buildHumanReviewStagePaths()` never emits `node_modules`, so the symlink can never actually be committed even if the classifier ever misfired.
- The human-review gate needed the exemption applied earlier than I first expected: `commitHumanReviewFiles()` has three separate decisions (a clean-tree retry, a no-dirty-to-commit check, and a no-stage-to-commit check) that all key off the raw dirty-file count, not just the allowlist filter. Filtering only at the allowlist step would have traded today's error for a different "nothing to stage" error on a symlink-only tree — the underlying stuck state would have survived. The exemption is applied upstream of all three.
- Added real-git fixture tests for both gitignore styles (trailing-slash vs. bare) since they behave differently at the `git status` level — a fixture using canon's own bare-`node_modules` style would pass without ever exercising the fix.
- Code review flagged that the same bug class is theoretically reachable at a third spot — the implement-phase auto-commit gates — but only in a narrow corner (an implement step that produces an empty handoff table on a trailing-slash-style repo), and that surface was an explicit non-goal for this task. Filed as a suggested follow-up rather than pulled in here.
- Rebuilt and committed `dist/scripts/run-task.js` since the source changes touch `scripts/run-task/**`, which our build contract requires to stay in sync.
