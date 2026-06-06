# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] Verdict plumbing is split between `scripts/run-task/types.ts` and the runtime `src/task/index.ts` validator; docs/codebase-map.md still points the task helper row at retired `scripts/task.sh`, which can hide required `canon task phase` updates.

[spec_review] Code-review prompt changes need both template edits and `scripts/run-task/prompts/index.ts` render wiring; artifact behavior changes also need `.canon/templates/review.md`, not just prompt templates.

[spec_review] Prompt-template tasks that change `promptCodeReview()` need the golden fixture `tests/run-task-prompts.golden.json` in scope alongside `tests/run-task-prompts.test.ts`.

[implement] No `runClaude()` runner change was needed for lens spawning; `.claude/agents` definitions inherit the foreman's selected `code_review` model/effort, so tier routing stays in pipeline policy rather than a new runner branch.

