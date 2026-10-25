# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
[plan] AC-1a choice: `task set` task_size/boolean cases read TASK_SET_FIELD_VALUES directly (no separate agreement assertion).
[plan] registry.ts imports COMPLETION_ARGS from completion.ts, so completion.ts must not import the registry at runtime (ESM TDZ cycle); completionCmd takes the registry as a parameter from src/cli/index.ts.
[plan] TASK_SUBCOMMAND_ARGS entries are one-liners; inline `completion` breaks four HINT_SITES snippets (line.includes match). Plan shortens those snippets (file is in Affected Files) rather than a merged side-record. RUN_ARGS metadata goes on its own line — no snippet edit.
[plan] tcsh per-command flags via `C/-/` backquoted awk reading $COMMAND_LINE (no `!` allowed — history expansion). Not node, so AC-5 holds.
[plan] fish absent on the planning machine; fish checks verify only in CI.
