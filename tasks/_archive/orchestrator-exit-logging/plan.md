# Implementation Plan: orchestrator-exit-logging

> Written by: Claude | Implements: `tasks/orchestrator-exit-logging/spec.md`

## Approach

One tiny dependency-free module owns the marker state and handlers; everything else is one-line `setExitReason(...)` calls at the known exit sites. The `process.on('exit')` handler is the single writer (AC-6's no-double-fire follows from crash handlers only *setting* the reason and exiting — never writing the marker themselves). Registration happens at the very top of `main()` so even arg-parse/dep-check `die()`s are marked.

## Steps

### Step 1: Marker module

Files: `scripts/run-task/exit-marker.ts` (new)

Exports `setExitReason(reason: string)` (module-level slot; last writer wins) and `registerExitHandlers()` (idempotent — guard with a registered flag). `registerExitHandlers` installs:
- `process.on('exit', code => fs.writeSync(2, '■ orchestrator exit code=<code> [reason=<reason>] at <ISO>\n'))` — synchronous write only, no async work (Node drops it in `exit` handlers).
- `process.on('uncaughtException', err => { setExitReason('uncaught exception: ' + message); fs.writeSync(2, stack); process.exit(1); })` and the analogous `unhandledRejection` handler — both exit 1 (Node's default for uncaught exceptions, AC-4/AC-7).
Dependency-free (only `node:fs`) so `cli.ts` and the agent wrappers can import it without cycles.

### Step 2: Register at boot, before anything can die

Files: `scripts/run-task/main.ts`

Call `registerExitHandlers()` as the first statement of `main()` — before `parseArgs` (~2981) and `checkDeps` (~2985), both of which can `die()`. Coexists with the existing `process.on('exit')` hooks registered later in `bootHeartbeatWithHooks` (~2952-2974) — handlers run in registration order; all stay synchronous. Set short reasons at main.ts's own deliberate exits: success/completion exits (e.g. ~3022, ~3173, step-mode ~3171), the unrecovered-phase exit (~2754), and the spec_gap block exit (~2879).

### Step 3: `die()` carries its message

Files: `scripts/run-task/cli.ts`

`die()` calls `setExitReason(message)` before `process.exit(1)`. This covers every `die()` site repo-wide, including arg parsing and dep checks (AC-3).

### Step 4: Agent failure ladders

Files: `scripts/run-task/agents/claude.ts`, `scripts/run-task/agents/codex.ts`

Claude (~184-194): set a reason per branch — spawn error, stalled, signal, and non-zero exit with the budget hint (`claude session exited <code> (possible budget exhaustion — see CLAUDE_BUDGET)`). Codex (~88-90): spawn error, stalled, signal only — the non-zero branch (~92-95) warns-and-returns and must NOT set a reason or exit (AC-2).

### Step 5: Auto-block exits

Files: `scripts/run-task/phases/implement.ts`, `scripts/run-task/phases/code-review.ts`, `scripts/run-task/phases/spec-review.ts`

Set short reasons (`auto-block: <phase> <why>`, `spec gate: awaiting human review`) before the `process.exit` calls at implement.ts ~122, code-review.ts ~242/~279, spec-review.ts ~52/~85.

### Step 6: Tests

Files: `tests/run-task-safety.test.ts`

Fake-executable subprocess pattern; assert on captured stderr/log:
- AC-1: healthy single-phase run ends with a marker containing `code=0` + ISO timestamp.
- AC-2: fake `claude` exits 1 → final marker has the nonzero code and a claude-session reason; fake codex killed by signal → codex reason; fake codex exits 1 → no marker fired at that moment (process continues into recovery).
- AC-3: invalid-task-id invocation → marker reason contains the die message.
- AC-4: fixture that injects a throw / rejected promise (e.g. env-gated test hook or a crafted failure) → marker + stack, exit 1.
- AC-6: exactly one `■ orchestrator exit` line per run, including the crash case.
- AC-7: assert exit codes 0 / 2 / passthrough / 1 unchanged across the touched paths.

### Step 7: Build + optional doc line

Files: `dist/scripts/run-task.js`, `dist/cli/index.js`, `docs/pipeline-orchestrator.md`

`npm run build`, commit dist deltas. Optional one-liner in the orchestrator doc (declared in Affected Files): a run log ending without a marker line means an un-catchable kill (SIGKILL/OOM).

## Testing Plan

- **Unit**: the cases in Step 6; full `npm test` for regressions.
- **E2E**: N/A.
- **Manual**: tail `tasks/<id>/.canon-run.log` after any detached run — last line should be the marker.

## Rollback Plan

Revert the commit; purely additive logging, no state or schema involvement. Worst regression from rollback is returning to silent exits.
