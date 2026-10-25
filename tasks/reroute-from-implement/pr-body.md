# PR Body: reroute-from-implement - Allow --reroute once implementation has begun

## Summary

- `canon run <id> --reroute` now accepts a task whose implement phase is in progress or blocked, whose code review is blocked at the loop cap, or whose code review already ran in the current loop (a review round or a pre-flight rejection). Those tasks were refused before, so the only way out was hand-editing `status.json` or running `reset-code-review`, which threw away the review evidence.
- An implement task with no review activity in the current loop is still refused. No implementation round has started there, so the change is a spec or plan revision.
- Admission now comes from one predicate in `src/orchestrator/state.ts`, used by the reroute gate and by the spec-gate note. The old phase-set constant is gone.
- The banner and the rejection message show implement's and code review's status. The loop-cap message names amending the spec and running `--reroute` as well as the `reset-code-review` path.
- Reroute prompts no longer assume the prior implementation round finished. They cover unfinished original ACs and earlier amendment rounds, ground the work in the worktree diff, and use `handoff.md` only when it has been filled in.
- Reverses the predecessor task's "no reroute from implement" non-goal. The reasoning is recorded in `docs/decisions.md`.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Test run: 1686 tests, 1685 pass, 1 skipped. The skip is probably the worktree-gated `.git/` write test in `tests/run-task-safety.test.ts`, which does not run in a linked worktree.
- Under load, two `--ship` tests in `tests/run-task-ship.test.ts` failed in one full run and passed when run alone. I have not confirmed whether they also fail on `main`.
- The red-first rows for the loop-cap and route-back admission cases were run against the base commit before the fix. Both failed at the old phase gate.
- Reviewers: please read the prompt changes in `src/orchestrator/prompts/templates/implement-reroute.md` and `plan-reroute.md` against the partial-round scope. The golden file changes only six existing reroute keys, plus one new resumed-variant key.
- Known follow-ups are listed in `tasks/reroute-from-implement/done.md` under Open Questions.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
