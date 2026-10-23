# Completion Summary: code-review-lens-timing — Record per-lens duration and tokens for code_review sub-agents

> For the human. This is what you need to know.

## What Changed

When Claude runs a review with sub-agents, the metrics log now gets one extra row per sub-agent, placed right after the session's own row. For code review that means the anchored reviewer and the cold reviewer each get a row with their own duration, model, and token count, so their cost is no longer hidden inside the foreman's single row. Each row's tokens are that sub-agent's own usage, read from its transcript, and they are not added to the session row. The log table keeps its nine columns. Nested sub-agents get no row, and a sub-agent whose timing or transcript is missing shows `-` for tokens instead of failing the run. Recording never stops a run.

## Files Changed

- `src/orchestrator/agents/claude.ts` — collects top-level sub-agent results and their transcript pointers from the stream, and writes the lens rows after the session row.
- `src/orchestrator/types.ts` — allows the `claude:<agent type>` form in the metrics agent field.
- `src/orchestrator/metrics.ts` — escapes the Agent cell and adds the sub-agent note to the metrics header skeleton.
- `templates/docs/pipeline-invocations.md` — same header note, so `canon upgrade` brings it to adopters.
- `docs/pipeline-orchestrator.md` and `templates/docs/pipeline-orchestrator.md` — describe the sub-agent rows.
- `tests/metrics.test.ts` — checks that the header note matches the template and that the Agent cell is escaped.
- `tests/claude-subagent-metrics.test.ts` — new; runs the sub-agent cases through a fake `claude` binary and fixture transcripts.
- `dist/orchestrator/run-task.js` — rebuilt bundle.

## How to Test

1. Run a task through code review on a repo with canon's pipeline.
2. Open the task's `metrics.md` once the review finishes.
3. Expected: after the `code_review` row for `claude`, there are rows for `claude:code-review-anchored` and `claude:code-review-cold`, each with its own duration and token count. The `claude` row's tokens are unchanged.
4. After `--ship`, `docs/pipeline-invocations.md` holds the same rows.

## Test Results

These results come from the implement phase (recorded in `tasks/code-review-lens-timing/handoff.md`). QA did not re-run them.

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass (1,562 passed, 1 skipped, 0 failed) |
| `npm run build` | Pass |
| `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |

Code review (`tasks/code-review-lens-timing/review.md`) passed Stage 1 on all seven ACs and returned "Approved with nits."

## Human Verification Required

None.

The spec's Human Test Plan (a real code review on a live run, then checking the metrics log) has not been run. The field names come from one captured Claude Code 2.1.309 run, and the tests use fixtures modeled on it. See Open Questions.

## Proposed Changelog

- **Each Claude sub-agent in a pipeline phase now gets its own metrics row.** `docs/pipeline-invocations.md` shows the anchored and cold `code_review` reviewers separately, each with its own duration and tokens, so review cost can be judged per reviewer. The `claude` row's totals are unchanged.

This is a new capability and does not change existing rows or columns, so no breaking change is involved. The bump tier is for the release step to decide.

## Decisions Made

- Sub-agent rows use the Agent value `claude:<agent type>` and are placed after the session row. Their tokens are the sub-agent's own cumulative usage, read from its transcript. `totalTokens` from the stream is not used because it reports only the final turn.
- Lens tokens are not added to the foreman row. The header note says the rows are separate, to avoid double counting.
- A result with no `parent_tool_use_id` field counts as top-level (`== null`). Nested results get no row.
- Results are deduplicated across the resume-not-found fallback attempts and recorded once.
- Transcript, notification, and metrics-write failures only produce `-` or a warning. They never fail the run.

## Open Questions

- **Real-harness check.** The stream field paths (`tool_use_result`, the `tool_use_id` location in `content`, `task_notification.output_file`) come from one captured run and are encoded in fixtures. A real code review run (the spec's Human Test Plan) should confirm that lens rows appear with non-`-` tokens. If Claude Code changes these fields, the rows will show `-` tokens rather than break.
- **Review nits, not addressed.** (1) The test "deduplicates results across resume fallback" does not exercise dedup, since its first attempt emits no duplicate; rename it or add a duplicate. (2) When a result has no `tool_use_id`, the dedup guard is skipped; that row still records with `-` tokens. (3) The outer `try/catch` around the lens-row loop is effectively dead code. Ship as-is or address before merge.
- **Cold-Codex review artifact.** `tasks/code-review-lens-timing/review-cold-codex.md` is empty (0 bytes). `review-cold-codex-run-1.md` holds the only cold-Codex output ("no actionable bugs"). Decide whether the empty file should be removed before commit. I did not delete it.
- **Pre-merge checklist** (not confirmed in QA): PR body current (drafted, see `tasks/code-review-lens-timing/pr-body.md`); final CI green; final diff matches spec intent (reviewed in code review, not re-checked here). Version and changelog are not applicable until the release step.

## Quality Log
- Spec verdict: approved_with_nits
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Stream field paths are verified only against fixtures from one captured run; a live code review run is still needed.

Maintenance: lessons-learned.md plus this task's fragment have 23 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").
