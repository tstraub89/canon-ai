# Spec: code-review-lens-timing — Record per-lens duration and tokens for code_review sub-agents

> Written by: Claude | Review by: Codex
> Status: draft

> **Full-send mode**: This spec was produced in full-send mode.

## Problem

GitHub issue #62. A task's metrics fragment (`tasks/<id>/metrics.md`, folded into `docs/pipeline-invocations.md` at `--ship`) gets one row per agent invocation. For `code_review`, cold-Codex has its own row, but the Claude side is a single foreman row. The anchored and cold-Claude lenses run as sub-agents inside the foreman's session, so their cost is invisible. Lens-shape decisions (round scope, which lenses run) can only be judged at the foreman level.

`runClaude` (`src/orchestrator/agents/claude.ts`) reads the `claude -p --output-format stream-json --verbose` stream through its `onLine` handler. It keeps assistant text and the final `result` event's session id and usage, and drops everything else.

The issue's first step was to confirm what the stream exposes. A captured run (Claude Code 2.1.309, one foreground `Agent` tool call) shows:

- A `system` event with `subtype: "task_started"` carries the sub-agent's `task_id`, the spawning `tool_use_id` and `subagent_type`.
- A `system` event with `subtype: "task_notification"` carries the same `tool_use_id`, a `status`, and an `output_file`: a path (a symlink) to the sub-agent's own JSONL transcript.
- The sub-agent's result arrives as a `type: "user"` event with `parent_tool_use_id: null`, whose content holds the `tool_result` for that `tool_use_id`. The event also carries a top-level `tool_use_result` object with `status` (`"completed"`), `agentType`, `resolvedModel`, `totalDurationMs` and `totalTokens`.
- The sub-agent's own assistant turns are not in the stream. Only its prompt appears, as a `user` event whose `parent_tool_use_id` is the spawning `tool_use_id`.

`totalTokens` is **not** cumulative. It equals the sub-agent's final turn's usage (input + cache creation + cache read + output). Real multi-turn sub-agent results in local Claude Code session transcripts confirm it: an Explore run with 10 tool uses reported `totalTokens` 80024, which is exactly its last turn's usage. The session row's Tokens cell is the cumulative `result.usage` sum, so `totalTokens` would put a different quantity in the same column. The cumulative figure is recoverable from the transcript at `output_file`: summing `message.usage` (input + cache creation + cache read + output) over its assistant entries, counting each `message.id` once, gave 41688 for the captured single-turn run, matching the harness's own figure.

The foreman's final `result` usage covered only the foreman's own turns in the capture, so a lens row and the foreman row do not double count.

The foreman spawns its lenses with `subagent_type` `code-review-anchored` and `code-review-cold`, so `agentType` identifies the lens.

This is a feature, not a bug fix; no red-first test applies.

## Decision

When a non-interactive Claude session's stream contains a **top-level** sub-agent result (a `user` event with `parent_tool_use_id: null` and a `tool_use_result` object with a string `agentType` and a numeric `totalDurationMs`), `runClaude` records one extra metrics row per such result, in the same table, after the session's own row:

- Task, Phase and Iter: the session's.
- Agent: `claude:<agentType>` (for code_review: `claude:code-review-anchored`, `claude:code-review-cold`). The Agent cell is escaped like the Model cell, since the value now comes from outside data.
- Model: `resolvedModel` when it is a string, otherwise the session's model.
- Duration: `totalDurationMs`.
- Tokens: the cumulative sum from the sub-agent's transcript, found through the `task_notification` event with the same `tool_use_id` and read after the session ends. Each assistant entry's `message.usage` contributes input + cache creation + cache read + output, counting each `message.id` once. If there is no matching notification, the file cannot be read, or the sum is 0, Tokens is `-`. `totalTokens` is never used.
- Status: `ok` when `status` is `"completed"`, otherwise `failed`.
- Timestamp: the time the row is written, at the session's end, like every other row.

Nested sub-agents (results whose event has a non-null `parent_tool_use_id`) get no row. A lens row's tokens therefore cover the lens's own turns only, not any sub-agent it spawned.

This is generic: any phase whose Claude session spawns sub-agents gets the rows, not only code_review. The table keeps its nine columns, so folded rows in adopter files stay the same width. The session's own row is unchanged. Sub-agent results are collected across both attempts of the resume-not-found fallback and recorded once.

## Non-Goals

- No new column and no separate telemetry file.
- No change to the cold-Codex row or the session row's values.
- No per-tool timing for ordinary tools (Read, Bash); only sub-agent results that carry `agentType`.
- No rows for nested sub-agents, and no attribution of a nested sub-agent's tokens to its parent lens.
- No rows for interactive sessions, which have no stream.
- No persistence of the raw stream or the sub-agent transcripts.
- No edit to this repository's own `docs/pipeline-invocations.md` header; `canon upgrade` refreshes it from the template.

## Acceptance Criteria

- [ ] AC-1: a non-interactive `runClaude` call with metrics context, whose stream contains one top-level sub-agent result (`agentType: "code-review-anchored"`, `status: "completed"`, a `resolvedModel`, `totalDurationMs: 476392`, `totalTokens: 999`) plus a matching `task_notification` whose `output_file` points to a fixture transcript with two assistant turns (one `message.id` repeated across two entries), writes two rows to the metrics fragment: first the session row with Agent `claude` (as today), then a row with Agent `claude:code-review-anchored`, the same Task, Phase and Iter, Model equal to `resolvedModel`, Duration `476.4s`, Tokens equal to the transcript's deduplicated two-turn sum (not 999), Status `ok`. Verified by a test with a fake `claude` binary that prints a stream-json event sequence modeled on the captured run, reading the fragment back.
- [ ] AC-2: two top-level sub-agent results in one stream (`code-review-anchored` then `code-review-cold`) produce two sub-agent rows in stream order, each with its own values. Verified by the same harness.
- [ ] AC-3: a sub-agent result with a `status` other than `"completed"` gets Status `failed`; one with no string `resolvedModel` gets the session's model; one with no matching `task_notification`, an unreadable `output_file`, or a transcript whose sum is 0 gets Tokens `-`. Verified by test cases for each.
- [ ] AC-4: these produce no extra row: a `user` event with a `tool_result` but no `tool_use_result`; a `tool_use_result` without a string `agentType`; one without a numeric `totalDurationMs`; and a sub-agent result whose event has a non-null `parent_tool_use_id` (nested). A malformed line is ignored as today. Verified by a test whose stream has only such events and asserts exactly one row (the session's).
- [ ] AC-5: the sub-agent rows are written even when the session fails after the sub-agent finished (the session row has Status `failed`), and recording never throws: a metrics write or transcript read failure only warns or yields `-`. Verified by a test where the fake `claude` emits a sub-agent result and then exits non-zero.
- [ ] AC-6: an `agentType` containing `|` or a newline is escaped in the Agent cell, so the row keeps nine cells. Verified by a test.
- [ ] AC-7: the metrics header note says sub-agent rows use `claude:<agent type>` in the Agent column, that their tokens are the sub-agent's own cumulative usage, and that they are separate from (not included in) the session row. The note is identical in `METRICS_SKELETON` and in the `templates/docs/pipeline-invocations.md` header that `canon upgrade` syncs to adopters. `docs/pipeline-orchestrator.md` says the same where it describes the metrics fragment. Verified by a test asserting the skeleton's note lines equal the template header's, and by reading the doc diff.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/agents/claude.ts` | Collect top-level sub-agent results and notifications in `onLine`; sum transcript usage; record their rows after the session row |
| `src/orchestrator/types.ts` | Widen `MetricEntry.agent` to accept `claude:<agentType>` |
| `src/orchestrator/metrics.ts` | Skeleton note about sub-agent rows; escape the Agent cell |
| `templates/docs/pipeline-invocations.md` | Same header note as the skeleton (adopter header sync source; not a generated mirror) |
| `tests/metrics.test.ts` | AC-7 skeleton/template header equality; Agent-cell escaping |
| `tests/claude-subagent-metrics.test.ts` | New: AC-1 to AC-6 through a fake `claude` binary and fixture transcripts |
| `docs/pipeline-orchestrator.md` | Describe sub-agent rows |
| `templates/docs/pipeline-orchestrator.md` | Generated mirror |
| `dist/orchestrator/run-task.js` | Rebuilt bundle |
| `dist/cli/index.js` | Rebuilt bundle, if the build changes it |

### Interaction Dependencies

- `--ship` folds fragment rows into `docs/pipeline-invocations.md` without checking columns (`foldMetricsFragment`), so the extra rows fold as is.
- No code parses the Agent column of the metrics tables (grep for consumers of `metrics.md` and `pipeline-invocations.md` finds only writers, the fold, and path exemptions).
- The stream fields and the transcript layout come from Claude Code, not a documented contract. A future harness that drops or renames them produces no sub-agent rows or `-` tokens, which AC-3 and AC-4 make the safe failure.
- `canon upgrade` refreshes the header of an adopter's `docs/pipeline-invocations.md` from `templates/docs/pipeline-invocations.md` (`HEADER_ONLY_SYNC` in `src/cli/commands/upgrade.ts`). The fold at `--ship` copies only fragment rows, so the template header is where the note reaches the persistent log.

### Data Model Changes

`MetricEntry.agent` widens from `'claude' | 'codex'` to also accept `` `claude:${string}` `` (AC-1 depends on it; type-check covers it). No `status.json` change.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite
- [x] `npm run build`
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`

## Docs Impact

`docs/pipeline-orchestrator.md` is edited (AC-7). `docs/architecture.md` §Telemetry says `metrics.md` "records every agent invocation", which stays true with sub-agent rows; QA checks it. `docs/codebase-map.md` describes `metrics.ts` only by file.

## Known Risks

- **Harness drift.** `tool_use_result`, `task_notification.output_file` and the transcript format are Claude Code output, observed on 2.1.309. If they change, rows stop appearing or show `-` tokens (AC-3, AC-4) rather than breaking the run.
- **Transcript timing.** The transcript is read after the session ends; a harness that deletes it on exit would yield `-`. The capture's transcript persisted under the user's Claude projects directory.
- **Double counting.** If a later harness folds sub-agent usage into the `result` event's usage, adding lens rows to the foreman row would double count. The captured run shows it does not today; the header note says lens rows are separate.
- **Nested sub-agents.** A lens that spawns its own sub-agent undercounts in its row (its child's tokens are in no row). The foreman charter tells lenses to spawn none, so this is a documented limit, not a likely case.
- **Resumed sessions.** A resumed foreman session that spawns lenses again produces new rows each run, which is correct: each row is one invocation.

## Human Test Plan

1. Run a task through code review.
2. Open the task's metrics log.
3. Expected: next to the code-review row for the main reviewer there are rows for the anchored and cold reviewers, each with its own duration and token count.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A, full tier
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) N/A — feature
- [x] (Refactors) N/A
