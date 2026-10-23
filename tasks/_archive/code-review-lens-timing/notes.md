# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
[plan] tool_use_id path: result event `message.content[]` tool_result block `.tool_use_id`; notification top-level `tool_use_id`. Not re-verified against a local capture (none found); fixtures encode it, mismatch degrades to Tokens `-`.
[plan] Chose `parent_tool_use_id == null` (absent counts top-level) and dedupe by tool_use_id across resume-fallback attempts.
[plan] Task dir already held stub handoff/review/done/metrics/pr-body at plan phase; left untouched.
[implement] `parent_tool_use_id == null` treats an omitted parent field as top-level, matching the spec's non-null nested exclusion; results with no recoverable tool_use_id still record with `-` tokens.
