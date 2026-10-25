# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
[plan] AC-1a choice: `task set` task_size/boolean cases read TASK_SET_FIELD_VALUES directly (no separate agreement assertion).
[plan] registry.ts imports COMPLETION_ARGS from completion.ts, so completion.ts must not import the registry at runtime (ESM TDZ cycle); completionCmd takes the registry as a parameter from src/cli/index.ts.
[plan] TASK_SUBCOMMAND_ARGS entries are one-liners; inline `completion` breaks four HINT_SITES snippets (line.includes match). Plan shortens those snippets (file is in Affected Files) rather than a merged side-record. RUN_ARGS metadata goes on its own line — no snippet edit.
[plan] tcsh per-command flags via `C/-/` backquoted awk reading $COMMAND_LINE (no `!` allowed — history expansion). Not node, so AC-5 holds.
[plan] fish absent on the planning machine; fish checks verify only in CI.
[implement] `/bin/bash` is GNU Bash 3.2.57; the full smoke table passed under both `bash` and `/bin/bash`.
[implement] Fish is not installed locally, so its parse check skipped with a diagnostic; CI installs fish and treats its absence as failure.
[implement] The tcsh script uses its embedded awk program to choose flags by active command path. `tcsh -f -n` and loading the generated file with `source` both passed.
[implement] AC-6 proof checks were exercised: filtering value flags from the bash renderer failed on synthetic `--zz-value`; adding `--bogus-flag` failed the undeclared-flag assertion. Both temporary mutations were reverted and the focused suite passed.
[implement] The linked-worktree task-id fixture ran successfully for bash and zsh; no sandbox skip was needed.
[implement-revision] Bash splits `--flag=value` into the flag, `=`, and value in `COMP_WORDS`; keep the value pending across the standalone `=` token so the following value does not shift positional slots.
[implement-revision] Fish was not installed in this environment. Added syntax and runtime smoke checks that skip locally with a diagnostic and fail if fish is absent in CI; CI installs fish before running the suite.
[implement-revision] Bash completion candidates must be emitted one per line before safe `read -r` filtering; joining the generated model values on one line broke prefix completion after removing `compgen -W`.
[implement-revision] tcsh embeds awk inside the slash-delimited `C/-/` completion form; avoid slash characters in the embedded program, even when they are valid awk regex syntax.
