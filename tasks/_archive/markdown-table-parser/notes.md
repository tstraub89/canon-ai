# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[implement] `npm test` fails in `tests/run-task-prompts.test.ts` before it reaches this task's code paths: `scripts/run-task/state.ts` resolves `REPO_ROOT` to `/Users/tstraub/canon-ai/canon-ai-dev`, but that path does not exist in this worktree. The failure is unrelated to `markdown-table-parser`.

[implement-revision] Bundle-level handoff verification also checks task artifacts that are dirty in the current iteration; if `handoff.md`, `review.md`, or `status.json` change, they need to be listed in the handoff Changes table alongside code files.

[implement-revision] `tests/run-task-prompts.test.ts` in this worktree fails by trying to create `/Users/tstraub/canon-ai/canon-ai-dev/tasks/prompt-fixture-a` and getting `EPERM`; that failure is unrelated to the markdown-table parser but it blocks `npm test` here.

[implement-revision] Bundle-level handoff verification only accepts files that are both in the current diff and listed in the Changes table; stale task-artifact rows like `notes.md` / `review.md` will trip preflight even if the code itself is clean.
