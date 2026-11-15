## Summary

- Follow-ups that QA records now live in a `## Follow-ups` table in done.md, with a category, the item, and a Tracked state. The QA gate rejects a done.md without a readable table, and the table can be `None.` when there is nothing to list.
- The human decides each untracked follow-up at human_review, before `--pr`: file it now, write it after merge, drop it, or fix it in this task. The decision goes in the Tracked cell, so it ships in the task's PR.
- `--ship` prints two blocks after the final "Shipped" line: post-ship items for the post-ship docs commit, and undecided items to put to the human. It never prompts, files, edits, commits, or changes the exit code. Canon does not file issues or write to a backlog.
- A QA stdout salvage that fails the new gate now warns and leaves qa not done. It no longer crashes the run.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Nits from code review are listed as untracked follow-ups, not filtered. They are meant to be decided as one batch at human_review.
- Judgment calls not confirmed during spec review:
  - A missing or unparseable Follow-ups section fails the QA gate, so QA repairs it. The alternative was a warning at `--ship`, which comes too late for QA to fix.
  - Unclear Tracked values count as untracked, so they stay visible. A value only counts as tracked when it is a URL, an exact `#<n>`, a markdown link, or `task:<id>`.
  - A task-id reference must use the explicit `task:<id>` prefix. A bare id is ambiguous with free text such as `tbd`.
  - The two blocks print after the final "Shipped" line, with rows read before the archive step.
  - The category vocabulary is fixed at six values. Unknown categories are still listed as written.
  - Each Docs drift item also gets a `scope` / `post-ship` row, so the operator works from one list.
  - The QA rules are checked by a one-off replay on past tasks, not by an automated test with a recorded model run. The replay is listed in the Human Test Plan.
