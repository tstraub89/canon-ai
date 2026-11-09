# PR Body: review-artifact-refs-fixup - Code review: citation rule and docs-refs fix-up for review.md

## Summary

- Code review now gets the same citation rule and reference fix-up that implement and QA already have. A backticked example path in `review.md` that is not a repository file is fixed right after the reviewer finishes, instead of stopping `--pr` later.
- The fix-up also runs after the one-shot recovery session, which can write the final `review.md`. It does not run after a blocked review.
- A fix pass that changes the checked verdict, or edits any file other than the review, auto-blocks code review for the bundle. Routing does not continue.
- `scripts/docs-refs-check.mjs` now skips unsuffixed `review-cold-codex.md` and archived `review-prior-N.md` files. The live `review.md` stays checked.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Tests for the fix-up, verdict and scope guards, recovery writer, and no-session warning are in `tests/run-task-safety-scaffold-push.test.ts`. Two AC-2 and AC-10 tests were confirmed to fail on the base commit before the fix.
- Judgment calls not explicitly confirmed in spec review:
  - Reviewer-blocked reviews skip the fix-up and keep the existing stop. I chose this because a blocked review is not a finished record. Alternative: run the fix-up before the stop.
  - A verdict mismatch after a fix pass auto-blocks code review rather than warning. Alternative: warn and continue.
  - The fix-up runs before the full-send scope check and verdict routing, so an early `spec_gap` stop still gets it. Alternative: run it only in the post-phase path.
  - Code review auto-blocks on fix-up stops instead of exiting plainly. A plain exit would send the next run straight to QA with the verdict unchecked.
  - The recovery session also gets a fix-up when it completes code review. Alternative: fix-up only after the reviewer session.
  - `review-cold-codex.md` is exempt from the checker, like its run-N siblings. Alternative: include it in the fix-up.
  - Archived `review-prior-N.md` is exempt from the checker. The cost is that references inside archives are not checked. Alternative: fix up the blocked review before reset.
- Non-blocking review nits (no `AgentSessionError` test, no recovery-path outside-edit test, a small helper cleanup) are not addressed in this PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
