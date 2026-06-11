# Spec: orchestrator-exit-logging — Durable exit/crash log line for every orchestrator death

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

When the orchestrator dies, the run log frequently ends mid-stream with no indication of *why* — making silent deaths forensic dead-ends. Two confirmed incidents in the current BACKLOG entry ("A Claude pipeline session that exhausts its `--max-budget-usd` cap kills the entire orchestrator", `docs/BACKLOG.md` Harness Bugs):

- 2026-06-08 (`operator-review-recovery`, twice): a Claude session exhausted its budget; `runClaude`'s failure ladder called `process.exit` deep inside the agent wrapper. The run log ends mid-assistant-text — no exit line, no reason, phase left `in_progress`.
- 2026-06-09 (`v1.11-harness-cleanup`): a **detached** orchestrator (PPID=1) died silently mid-`implement` — a Codex-side non-zero exit, so not the budget trigger at all. Undiagnosable after the fact; the BACKLOG note graduates the exit logger from "nice-to-have" to load-bearing.

The full fix (typed failure returns instead of `process.exit` in every agent wrapper, phase parking, retry-with-raised-budget) is deliberately deferred to v1.12 as its own delicate task. This task ships only fix (c) from that entry: **no orchestrator exit may be silent.**

Today: `die()` (`scripts/run-task/cli.ts:3-6`) logs to stderr before exiting, but the ~30 other `process.exit` sites (agent failure ladders in `agents/claude.ts:184-194` / `agents/codex.ts:88-90`, `git.ts:27-29`, phase auto-blocks, success paths) exit with whatever was or wasn't printed; an uncaught exception or unhandled rejection produces Node's default stderr dump with no canon-framed final line; and there is no single "the orchestrator is exiting because X" marker an operator or `canon doctor` can grep for.

## Decision

Every orchestrator process exit writes one final, grep-able line to the run's log destination (stdout/stderr, which detach mode already appends to `tasks/<id>/.canon-run.log`):

1. **Exit marker on every exit path.** A `process.on('exit', code => ...)` handler writes a single synchronous line of the shape: `■ orchestrator exit code=<N> [reason=<reason>] at <ISO timestamp>`. It must be registered at the **top of `main()`, before `parseArgs` and `checkDeps`** — both can `die()` on bad arguments or missing dependencies (`main.ts:2981-2985`), and those early exits must be marked too; registering only inside `bootHeartbeatWithHooks` (`main.ts:3015`) would leave them silent. A module-level `setExitReason(reason)` helper lets call sites that know why they're exiting (the agent failure ladders, auto-block paths, `die()`) record a reason string before exiting; paths that never set one still get the code + timestamp line.
2. **Reasons on the known kill paths.** The agent failure ladders set a reason for each branch that exits the process: **Claude** (`agents/claude.ts:~184-194`) — spawn error, stalled, non-zero exit, signal — e.g. `claude session exited 1 (possible budget exhaustion — see CLAUDE_BUDGET)` for the non-zero path, since budget exhaustion is the known common cause there; **Codex** (`agents/codex.ts:~88-90`) — spawn error, stalled, signal only. Codex non-zero exit deliberately does **not** `process.exit` (the runner warns and returns, and `checkAndRoute` handles it via `lastCodexExitStatus`) — no reason is set there; if the orchestrator later exits because recovery failed, that exit path carries its own reason. `die()` sets the reason to its message. Phase auto-block and success exits set short reasons.
3. **Crash visibility.** `process.on('uncaughtException')` and `process.on('unhandledRejection')` handlers log the error + stack through the same marker mechanism, then exit non-zero. No swallowing — the handlers must not allow the process to continue.

This is additive logging only: no exit code changes, no control-flow changes, no phase-state changes. The v1.12 blast-radius refactor builds on these markers.

## Non-Goals

- **Not** the typed-failure/park-the-phase refactor (BACKLOG Bug 2, deferred to v1.12). `process.exit` sites stay where they are; they just stop being silent.
- No change to which exit codes are used, no new retry behavior, no budget changes (budget-by-tier shipped in 1.11.0).
- No SIGKILL coverage — unloggable by definition; the heartbeat + `canon doctor` staleness detection remains the backstop for that class.
- No changes to `canon watch` classification or the heartbeat protocol.

## Acceptance Criteria

- [ ] AC-1: A successful single-phase run's log ends with an exit marker line containing `code=0` and an ISO timestamp.
- [ ] AC-2: When the Claude CLI exits non-zero during a phase, the log's final marker line includes the nonzero code and a reason naming the claude session failure. For the Codex ladder, the process-exiting branches (spawn error, stall, signal) each produce a reason naming the failure class; a Codex non-zero exit produces **no** marker by itself (the process does not exit there — `checkAndRoute` handles it).
- [ ] AC-3: `die()` exits produce a marker line whose reason contains the die message — including `die()` calls fired during argument parsing or dependency checks, before any phase work (verified with e.g. an invalid-task-id invocation).
- [ ] AC-4: An uncaught exception (and, separately, an unhandled rejection) in the orchestrator produces a marker line plus the error stack in the log, and the process exits 1 (matching Node's default for an uncaught exception) — verified with a test fixture that injects a throw.
- [ ] AC-5: The marker line survives `process.exit` invoked from any depth — it is present in the captured log for every AC-1/2/3/4 case. (Implementation constraint, not separately tested: Node `exit` handlers silently drop async work, so the write must be synchronous.)
- [ ] AC-6: Exactly one marker line per process exit (the handler must not double-fire when both an exception handler and the exit handler run).
- [ ] AC-7: Existing exit codes are unchanged for every path touched, and the new crash handlers pin theirs (assert in tests for: success exit 0, auto-block exit 2, agent non-zero passthrough, uncaughtException/unhandledRejection exit 1).

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | Register exit/uncaughtException/unhandledRejection handlers at the top of `main()` (before `parseArgs`/`checkDeps` at ~2981-2985, so early `die()` exits are marked); set reasons at the auto-block/success exit sites |
| `scripts/run-task/cli.ts` | `die()` records its message as the exit reason before `process.exit(1)` |
| `scripts/run-task/agents/claude.ts` | Failure ladder (~184-194) sets reason per failure class before each `process.exit` |
| `scripts/run-task/agents/codex.ts` | Failure ladder (~88-90) sets reason per failure class before each `process.exit` |
| `scripts/run-task/phases/implement.ts` | Set exit reason at the auto-block `process.exit(2)` site (~122) |
| `scripts/run-task/phases/code-review.ts` | Set exit reason at the auto-block `process.exit(2)` sites (~242, ~279) |
| `scripts/run-task/phases/spec-review.ts` | Set exit reason at the spec-gate exit (~52) and auto-block site (~85) |
| `tests/run-task-safety.test.ts` | Marker assertions per AC-1/2/3/7 via the fake-executable subprocess pattern; crash-fixture test for AC-4 |
| `docs/pipeline-orchestrator.md` | Optional one-liner documenting the exit-marker line (see Docs Impact) — declared here so the base-drift gate allows it if QA writes it |
| `dist/scripts/run-task.js` | Regenerated by `npm run build` |
| `dist/cli/index.js` | Regenerated by `npm run build` (shared cli.ts/agent chunks bundle into the CLI entry) — declared defensively |

Mechanics note: where the reason-state helper lives (cli.ts, a new tiny module, or main.ts export) is deferred to plan — the contract is just "any module that calls `process.exit` can set a reason first, and the boot-registered handler reads it."

### Interaction Dependencies

- Existing `process.on('exit')` handlers (`stopAllHeartbeats`, `cleanupCanonPids` at `main.ts:2958/2967`) — ordering must not break them; the marker line should fire alongside, and all three must stay synchronous.
- Detach mode (`detach.ts:162-185`): the log fd is the child's stdio in append mode, so a synchronous stderr write in the exit handler lands in `.canon-run.log` — no detach changes needed, but AC-2's test should exercise a detached-style (non-TTY) run.
- `canon doctor` / heartbeat: unchanged; the marker complements staleness detection.

### Data Model Changes

None.

## Validation Required

- [x] `lint` (`npm run lint`)
- [x] `type-check` (`npm run type-check`)
- [x] `unit tests` (`npm test`) — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `build` (`npm run build`) — commit `dist/` deltas
- [x] `sync-templates:check` (`npm run sync-templates:check`)

## Docs Impact

`docs/pipeline-orchestrator.md` — optionally a one-liner under the silent-death/doctor material: "every orchestrator exit writes a final `■ orchestrator exit` line to the run log; a log that ends without one means the process was killed un-catchably (SIGKILL/OOM)." QA's discretion.

## Known Risks

- **Exit-handler constraints:** Node `exit` handlers must be synchronous; any async work is silently dropped. AC-5 pins this. Keep the handler to a single write.
- **Double-fire:** an uncaught exception handler that logs and then calls `process.exit` will also trigger the `exit` handler — the reason mechanism must ensure one coherent marker, not two conflicting ones (AC-6).
- **Reason staleness:** a reason set early (e.g. by a recovered path that didn't exit) could leak into a later unrelated exit. Setting the reason immediately before the exit call at each site avoids this; reviewer should check no site sets a reason on a non-exiting path.

## Human Test Plan

1. Run a small task pipeline to a normal stopping point, then open the run log. Expected: the last line is a clearly marked "orchestrator exit" line with a code and timestamp.
2. Interrupt a run by making the agent fail (the test suite simulates this). Expected: the log's final line names which agent session failed and why, instead of ending mid-stream.
3. After any future silent-looking death: check the log tail. Expected: either a final exit line explaining it, or its absence tells you the process was killed externally — both are now diagnostic signals.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]` (not `- [ ]`). `- [ ]` is a placeholder; the spec author flips required checks to `- [x]` before marking spec done. The orchestrator's code_review pre-flight blocks if no `[x]` items are present.
