# PR Body: reroute-from-implement - Allow --reroute once implementation has begun

## Summary

- `canon run <id> --reroute` now accepts a task whose implement phase is in progress or blocked, whose code review is blocked at the loop cap, or whose code review already ran in the current loop (a review round or a pre-flight rejection). Those tasks were refused before, so the only way out was hand-editing `status.json` or running `reset-code-review`, which threw away the review evidence.
- An implement task with no review activity in the current loop is still refused. No implementation round has started there, so the change is a spec or plan revision.
- A bundle may include an approved implement-pending sibling alongside a qualifying task, but only when both share the same non-empty task branch. This covers a route-back where code review approved one member and sent the other back.
- Admission comes from one predicate in `src/orchestrator/state.ts`, used by the reroute gate and the spec-gate note. The old phase-set constant is gone.
- The banner and rejection message show implement's and code review's status. The loop-cap message names amending the spec and running `--reroute`, alongside the `reset-code-review` path.
- Reroute prompts no longer assume the prior implementation round finished. They cover unfinished original ACs and earlier amendment rounds, ground the work in the worktree diff, and use `handoff.md` only when it has been filled in. Non-exempt tasks are pointed at their newest archived review.
- Reverses the predecessor task's "no reroute from implement" non-goal. The reasoning is recorded in `docs/decisions.md`.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Test run (handoff, round 2): 1720 tests, 1719 pass, 1 skipped. The skip is inferred to be the worktree-gated `.git/` write test in `tests/run-task-safety.test.ts`, which does not run in a linked worktree. The code-review run reported 1722 passing with none skipped. I have not reconciled the two counts.
- Two `--ship` tests in `tests/run-task-ship.test.ts` failed once under load and passed in isolation. I have not confirmed whether they fail on `main`.
- The red-first rows for the loop-cap and route-back admission cases were run against the base commit before the fix. Both failed at the old phase gate.
- Reviewers: read the prompt changes in `src/orchestrator/prompts/templates/implement-reroute.md` and `plan-reroute.md` against the partial-round scope. The golden file changes only the existing reroute keys, plus one new resumed-variant key.
- Open: the implement and plan reroute prompts name the archived review but do not yet tell the agent to open it. A cold-Codex review rated this P2 and the foreman ranked it non-blocking. Decide before merge whether to add a read step.
- Known follow-ups are listed in `tasks/reroute-from-implement/done.md` under Open Questions.
