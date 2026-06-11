# Completion Summary: orchestrator-exit-logging — Durable exit/crash log line for every orchestrator death

> For the human. This is what you need to know.

## What Changed

Previously, when the orchestrator died — from a budget-exhausted Claude session, a Codex spawn failure, an uncaught exception, or anything else — the run log would simply end mid-stream with no final line. Diagnosing what happened required piecing together partial logs and guessing the cause.

Every orchestrator process exit now writes one synchronous, grep-able marker line to the run log before the process ends:

```
■ orchestrator exit code=<N> [reason=<reason>] at <ISO timestamp>
```

Key behaviors:
- **Normal exits** (success, auto-block, non-recovery) get a code + timestamp. Known failure paths also get a `reason` string (e.g., "claude session exited 1 (possible budget exhaustion — see CLAUDE_BUDGET)").
- **`die()` calls** — including early argument-parsing and dependency failures before any phase work — carry the die message as the reason.
- **Crash handlers** (`uncaughtException`, `unhandledRejection`) log the error + stack, then exit 1 with a marker. Exactly one marker per exit.
- **Codex non-zero exits** do not themselves exit the orchestrator (they're handled by `checkAndRoute`), so no marker fires there — consistent with existing behavior.

The handler is registered at the very top of `main()`, before `parseArgs` and `checkDeps`, ensuring early exits are covered. The write is synchronous (`fs.writeSync`) so it survives `process.exit` called from any depth. Detach mode's log file already captures stderr, so the marker lands in `.canon-run.log` automatically.

The spec's optional `docs/pipeline-orchestrator.md` one-liner was added (see Decisions).

## Files Changed

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | `registerExitHandlers()` call at top of `main()`; exit reasons on auto-block/success exit sites |
| `scripts/run-task/cli.ts` | `registerExitHandlers()`, `setExitReason()`, `patchedProcessExit`, synchronous exit-marker writer, crash handlers; `die()` stamping |
| `scripts/run-task/agents/claude.ts` | Exit reasons on each Claude failure branch |
| `scripts/run-task/agents/codex.ts` | Exit reasons on spawn/stall/signal branches; non-zero exit branch left as warn-and-return |
| `tests/run-task-safety.test.ts` | Exit-marker assertions for AC-1/2/3/4/7; crash-fixture tests |
| `dist/cli/index.js` | Rebuilt |
| `dist/scripts/run-task.js` | Rebuilt |

## Test Results

| Check | Result |
|---|---|
| `lint` | Pass |
| `type-check` | Pass |
| `unit tests` | Pass — 830 passed, 1 skipped, 0 failed |
| `build` | Pass |
| `sync-templates:check` | Pass |

All 7 ACs met. Code review: **Approved with nits** (one round, no correctness bugs or risk items).

Open nits (optional, not blocking):
- The exit-logging tests explicitly assert `code=0` and `code=1` markers but not `code=2` (auto-block/recovery-fail). The marker IS written on code=2 exits (confirmed by the stale-done test asserting exit code 2 separately), but a direct `assert.match(markers[0], /code=2/)` in the stale-done test would tighten the AC-7 coverage.
- `--help` invocation sets `setExitReason('help requested')` before exit, producing a marker in the run log on intentional help requests. In normal orchestrator operation `--help` is never used; the marker adds minor noise in the rare case an operator does invoke it. Could omit the reason on the `--help` path.

## Human Verification Required

None.

## Decisions Made

- Exit-reason state and the marker writer live in `cli.ts` rather than a new `exit-marker.ts` module, avoiding an extra module and import cycle given that `cli.ts` already sits on the `die()`/agent-wrapper critical path.
- Phase auto-block files (`implement.ts`, `code-review.ts`, `spec-review.ts`) do not get explicit `setExitReason` calls — the `patchedProcessExit` fallback emits `process.exit code=2`, which is sufficient per spec; no AC requires a descriptive reason at those sites.
- Added one-liner to `docs/pipeline-orchestrator.md` under the silent-death/doctor material (spec listed this as optional): "Every orchestrator exit writes a final `■ orchestrator exit` line to the run log; a log that ends without one means the process was killed un-catchably (SIGKILL/OOM)."

## Open Questions

None.

## Proposed Changelog

Target release: **1.11.1** (patch — additive logging, no exit code changes, no control-flow changes).

Proposed bullet for `[1.11.1] — Fixed`:

> **Every orchestrator exit now writes a grep-able final line to the run log.** When a pipeline run ends — successfully, on an auto-block, on an agent failure, or on a crash — the last line of `.canon-run.log` is now `■ orchestrator exit code=<N> [reason=<reason>] at <timestamp>`. Logs that end without this line mean the process was killed externally (SIGKILL/OOM), which is itself a diagnostic signal. Uncaught exceptions and unhandled rejections also log the error and stack before exiting.
