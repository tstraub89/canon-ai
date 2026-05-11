# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[implement] `npm test` fails in `tests/run-task-prompts.test.ts` before it reaches this task's code paths: `scripts/run-task/state.ts` resolves `REPO_ROOT` to `/Users/tstraub/canon-ai/canon-ai-dev`, but that path does not exist in this worktree. The failure is unrelated to `markdown-table-parser`.
