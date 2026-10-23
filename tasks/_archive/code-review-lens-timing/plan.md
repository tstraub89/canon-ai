# Implementation Plan: code-review-lens-timing

> Written by: Claude | Implements: `tasks/code-review-lens-timing/spec.md`

## Approach

Extend `runClaude`'s existing `onLine` handler (`src/orchestrator/agents/claude.ts`) to collect top-level sub-agent results and `task_notification` events, then record one extra `recordMetric` row per result in the `finally` block, after the session row. The table keeps nine columns; only the Agent cell value changes (`claude:<agentType>`).

**Spec-review nit (field path).** The result event is `{ type: 'user', parent_tool_use_id: null, message: { content: [ { type: 'tool_result', tool_use_id, ... } ] }, tool_use_result: { status, agentType, resolvedModel, totalDurationMs, totalTokens } }`. The spawning `tool_use_id` is read from the first `message.content[]` block with `type === 'tool_result'` and a string `tool_use_id`. `task_notification` is `{ type: 'system', subtype: 'task_notification', tool_use_id, status, output_file }` (top-level `tool_use_id`). The tests' fixture stream uses exactly these paths; a result with no readable `tool_use_id` simply gets Tokens `-`.

**Feasibility check**
- **Exists:** `runClaude`, `onLine`, `streamProcess`, `recordMetric`, `METRICS_SKELETON`, `MetricEntry`, `HEADER_ONLY_SYNC` (`src/cli/commands/upgrade.ts`), and the fake-binary-on-PATH test pattern (`tests/run-task-code-review.test.ts` "runClaude headless preamble") all found by search. I could not find a local captured stream to re-verify the field paths; they come from the spec's capture (see Gaps).
- **Real path:** non-interactive `runClaude` → `attempt()` → `streamProcess(..., onLine)`; rows are written in the single outer `finally` that already calls `recordMetric` for the session row. `attempt()` may run twice (resume-not-found fallback), so collections must live in the outer `runClaude` scope, not per attempt. No existing code on the path records anything sub-agent related.
- **Callers:** `recordMetric` callers only gain an optional wider `agent` type (no behavior change). `runClaude` signature and return value are unchanged. Nothing parses the Agent column (spec grep; re-grep `Agent` consumers of `metrics.md`/`pipeline-invocations.md` in the implement phase).
- **Tests that can fail:** each test drives a fake `claude` that prints stream-json lines; without the change no second row exists, so AC-1/2/3/5/6 fail. AC-4's test is a negative (asserts exactly one row), so it must be paired with a positive control stream in the same file (AC-1) to avoid vacuity.
- **Predicates:** `agentType` string and non-empty? (spec: string; treat `''` as a string, still a row, cell `claude:`); `totalDurationMs` must be `typeof number && Number.isFinite` (0 allowed, NaN/string rejected); `parent_tool_use_id` must be strictly `null` (an absent field is not nested — treat `=== null || === undefined` as top-level only if spec fixture omits it; spec says `null`, so use `event.parent_tool_use_id == null`... decision: **`== null`**, recorded in notes); `status === 'completed'` → ok else failed; token sum 0 or unreadable → `-`; same `message.id` counted once, entries without `message.id` counted each.
- **Scope:** every file below is in the spec's Affected Files.
- **Async/stateful:** transcript read happens after the session ends (`finally`), synchronously via `fs.readFileSync` inside try/catch; recording must never throw out of `finally` (it would mask the session error). Resume fallback: collections shared across both attempts; dedupe results by `tool_use_id` (fall back to no dedupe when absent) so one result is recorded once. No cancellation concerns beyond the stall/exit paths already throwing before `finally`.

## Steps

### Step 1: Widen the agent type

Files: `src/orchestrator/types.ts`

`MetricEntry.agent: 'claude' | 'codex' | \`claude:${string}\``.

### Step 2: Escape the Agent cell and update the skeleton note

Files: `src/orchestrator/metrics.ts`

- In `recordMetric` replace `${entry.agent}` with `${safeCell(entry.agent)}` (the existing `safeCell` already escapes `|` and newlines).
- Add to `METRICS_SKELETON` (after the Tokens note line, before the blank line) one note line, e.g.:
  `> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent \`claude:<agent type>\`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.`
  Keep this a single line so the test in Step 6 can compare note lines.

### Step 3: Mirror the note into the adopter header

Files: `templates/docs/pipeline-invocations.md`

Add the identical line at the same position (this is the `HEADER_ONLY_SYNC` source, not a generated mirror; edit it directly). The repo's own `docs/pipeline-invocations.md` header is a Non-Goal; do not touch it.

### Step 4: Collect and record sub-agent rows

Files: `src/orchestrator/agents/claude.ts`

1. Above `attempt`, in `runClaude` scope: `const subagentResults: Array<{ toolUseId: string | null; agentType: string; resolvedModel: string | null; durationMs: number; ok: boolean }> = []` and `const notificationFiles = new Map<string, string>()` (tool_use_id → output_file).
2. In `onLine`, after the existing `result` branch, add:
   - `event.type === 'system' && event.subtype === 'task_notification'` with string `tool_use_id` and string `output_file` → `notificationFiles.set(...)`.
   - `event.type === 'user' && event.parent_tool_use_id == null` and `event.tool_use_result` is an object with `typeof agentType === 'string'` and a finite numeric `totalDurationMs` → derive `toolUseId` from the first `message.content[]` block with `type === 'tool_result'` and string `tool_use_id`; skip if `toolUseId` is already in `subagentResults` (resume fallback duplicate); push.
   Do not read `totalTokens`.
3. Add a small helper (module-level, exported for unit tests only if needed) `sumTranscriptTokens(file: string): number | undefined`: `readFileSync` in try/catch → split lines → `JSON.parse` each in try/catch (skip bad lines) → for `entry.type === 'assistant'` (or any entry with `message.usage`) take `message.usage`; dedupe by `message.id` with a `Set` (entries lacking an id always count); sum `input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens`; return `undefined` when the total is 0 or on any error.
4. In the outer `finally`, after the session `recordMetric`, inside `if (metricsContext)` and wrapped in its own `try/catch` that only `warn`s:
   ```ts
   for (const r of subagentResults) {
       const file = r.toolUseId ? notificationFiles.get(r.toolUseId) : undefined;
       recordMetric({ ...metricsContext, agent: `claude:${r.agentType}`, model: r.resolvedModel ?? model,
           durationMs: r.durationMs, status: r.ok ? 'ok' : 'failed', tokens: file ? sumTranscriptTokens(file) : undefined });
   }
   ```
   This is in `finally`, so rows are written when the session throws (AC-5). `metricsContext.iteration`/`taskId`/`phase` carry through via the spread.
5. Interactive path is unchanged (returns before any stream exists; `subagentResults` stays empty).

### Step 5: Docs

Files: `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md`

At the `PIPELINE_TELEMETRY_FILES` bullet (line ~342) add a sentence: a non-interactive Claude session that spawns sub-agents also writes one `claude:<agent type>` row per top-level sub-agent (duration from the harness, tokens from the sub-agent's own transcript, `-` when unavailable), separate from the session row. Edit the root only; the pre-commit hook / `npm run sync-templates` regenerates the `templates/` mirror (do not hand-edit). Declare the mirror in the handoff Changes table.

### Step 6: Tests

Files: `tests/metrics.test.ts`, `tests/claude-subagent-metrics.test.ts` (new)

- `tests/metrics.test.ts`: (a) skeleton note lines (lines starting `>`) equal those in `templates/docs/pipeline-invocations.md` (read from `process.cwd()` per the worktree pitfall in `docs/patterns.md`); (b) `recordMetric` with `agent: 'claude:a|b\nc'` yields a row that, after unescaping `\|`, has nine cells (split on `/(?<!\\)\|/`).
- `tests/claude-subagent-metrics.test.ts`: helper writes a fake `claude` node script into a temp dir put first on `PATH` (pattern from `run-task-code-review.test.ts` "runClaude headless preamble"), whose body prints the given stream-json lines to stdout (and optionally `process.exit(1)`); set `CANON_METRICS_FILE_OVERRIDE` to a temp file **after** import and restore in `finally`; call `runClaude(prompt, false, null, 'sonnet', 'medium', '1', { taskId: 'example-task', phase: 'code_review', iteration: 2 }, dir)` and read rows back (filter lines starting `| 20`). Fixture transcripts are written to the temp dir (JSONL, assistant entries with `message.id` + `message.usage`). Cases:
  - AC-1: init event, `task_started`, `task_notification` (`output_file` → fixture with two turns, one `message.id` repeated on two entries), user result event (`totalTokens: 999`), `result` event. Assert two rows in order, row 2 Agent `claude:code-review-anchored`, Model = `resolvedModel`, Duration `476.4s`, Tokens = deduped sum (compute the expectation by hand in the test), Status `ok`, Iter `2`.
  - AC-2: anchored then cold → two sub-agent rows in order.
  - AC-3 (one case each): `status: 'failed'` → `failed`; no `resolvedModel` → session model; no notification / missing file / transcript summing 0 → `-`.
  - AC-4: stream with only non-qualifying events (`tool_result` without `tool_use_result`; no string `agentType`; no numeric `totalDurationMs`; non-null `parent_tool_use_id`; a malformed line) → exactly one row.
  - AC-5: sub-agent result then `process.exit(1)` → `runClaude` rejects with `AgentSessionError`; fragment has the session row `failed` plus the sub-agent row. Also point `CANON_METRICS_FILE_OVERRIDE` at an unwritable path to assert no throw from recording (warn only).
  - AC-6: `agentType: 'x|y\nz'` → row keeps nine cells.
  - Resume fallback: first attempt (with `--resume`) prints "No conversation found with session ID" and exits 1, second emits the result once → exactly one sub-agent row.

### Step 7: Build and validate

Files: `dist/orchestrator/run-task.js`, `dist/cli/index.js` (generated)

Run `npm run build` (dist is tracked), then `npm run lint && npm run type-check && npm test && npm run sync-templates:check && npm run docs-refs-check`. Per `docs/patterns.md`, run tests from the worktree root; `npm ci` first if `node_modules` is absent. Checks that cannot run must be reported as such in the handoff, not as passed.

## Testing Plan

- **Unit**: `tests/metrics.test.ts` (header equality, Agent-cell escaping); `tests/claude-subagent-metrics.test.ts` (AC-1 to AC-6 plus resume-fallback dedupe) through a fake `claude` binary.
- **E2E**: none; Human Test Plan is a real code_review run.

## Gaps / decisions (also in `notes.md`)

- Field paths for `tool_use_id` in the result event come from the spec's capture and standard Anthropic message shape; no local capture was re-verified in this phase. The fixtures encode them, so a mismatch degrades to Tokens `-`, not a crash.
- Nested check uses `parent_tool_use_id == null` (absent counts as top-level); spec says "non-null → nested", this keeps absent-field harnesses producing rows.
- Dedupe of results by `tool_use_id` across resume-fallback attempts is an implementation choice for the spec's "recorded once".
- Pre-existing task dir contained stub `handoff.md`/`review.md`/`done.md`/`metrics.md`/`pr-body.md` at plan phase; left untouched.
