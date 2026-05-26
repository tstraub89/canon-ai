# QA Summary: orchestrator-survive-sighup

> Task: Orchestrator survives SIGHUP from dying supervising shell
> QA by: Claude | Date: 2026-05-25

## What Changed

Before this fix, closing the terminal (or any event that killed the supervising bash session) sent SIGHUP down the process group to the orchestrator. Node's default SIGHUP action is to terminate the process, so the orchestrator died silently — no log line, no SIGTERM-on-stall, just an abrupt cut in the log file. The stall timer inside the orchestrator died with it, so the 10-minute hung-agent safeguard was also gone.

Two minimal changes fix the root cause:

1. **SIGHUP handler** (`scripts/run-task.ts`): `process.on('SIGHUP', ...)` installed at module top-level (before any phase work), logging one `WARN` line and returning. SIGINT behavior is untouched — the orchestrator still terminates on Ctrl-C.

2. **Child stdin severed from the supervising tty** (`scripts/run-task/agents/stream.ts`): `stdio[0]` changed from `'inherit'` to `'ignore'`. Codex and Claude pass prompts as CLI args; neither reads from stdin. `'ignore'` gives them immediate EOF on stdin and prevents SIGHUP-induced hangs on a half-closed tty pipe.

Both children's stdout/stderr capture and the existing stall timer are untouched. After the fix, SIGHUP from a dying parent shell logs a warning and the orchestrator continues; if Codex truly hangs, the stall timer still fires SIGTERM and writes a `stalled` log line as designed.

## Files Changed

| File | Change |
|---|---|
| `scripts/run-task.ts` | SIGHUP handler at module top-level; `import.meta.url` guard added so the module is importable by tests without auto-running `main()` |
| `scripts/run-task/agents/stream.ts` | `stdio: ['inherit', 'pipe', 'pipe']` → `stdio: ['ignore', 'pipe', 'pipe']` |
| `tests/run-task-signals.test.ts` | New file — two cases: SIGHUP survival (asserts `exitCode === null` after 200ms) and SIGINT still terminates (asserts `signal === 'SIGINT'`) |
| `docs/patterns.md` | New Known Pitfalls entry covering pre-fix failure mode, post-fix behavior, and BACKLOG pointer for deferred detach/heartbeat work |
| `docs/BACKLOG.md` | Orchestrator-death entry annotated: "survival fix shipped 2026-05-25; detach mode and heartbeat-detection layer remain open"; checkbox stays open |
| `dist/scripts/run-task.js` | Rebuilt bundle reflecting the above source changes |

## How to Test

Follow the spec's Human Test Plan:

1. Run `npm run build`. Start a long canon pipeline run. Note the orchestrator PID.
2. **Kill the parent shell** (close the terminal window, or `kill <bash-pid>`). In another terminal: `pgrep -fl "canon|run-task"` — the orchestrator should still be listed.
3. `tail -f /tmp/canon-run-*.log` — should show a `WARN: SIGHUP received; ignoring...` line at the moment the parent shell died, then continued Codex/Claude output.
4. Let the task finish or kill the orchestrator with `kill <pid>`.
5. **Counter-test**: send `kill -INT <orchestrator-pid>` instead. The orchestrator must exit (SIGINT unchanged).

## Test Results

All validation checks passed in a single implementation pass:

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` (includes new `run-task-signals.test.ts`) | Pass |
| `npm run build` | Pass |
| `npm run docs-refs-check` | Pass |

Code review: approved_with_nits (no changes_requested; nit was cosmetic). No reroute.

## Decisions Made

- **Self-signal harness over full pipeline spawn**: The test imports `scripts/run-task.ts` directly and sends signals to itself, rather than spawning a child that runs a full pipeline. The spec explicitly allowed this ("or a focused harness that loads the same SIGHUP-handler module") and it keeps the test stable and fast.

- **`import.meta.url` guard**: Added around the direct `main()` invocation so the entry module can be imported by the signal test without auto-running the pipeline. The SIGHUP handler installs at module top-level before the guard, so it's in place regardless of import context.

## Open Questions / Remaining Work

None for this task. The BACKLOG entry remains open for the explicitly deferred follow-on work:
- **Detach mode** (`--detach` flag, PID files, daemon-style operation)
- **Heartbeat-detection layer** (periodic liveness writes to catch SIGKILL, machine sleep, network partition)

Both are filed under `docs/BACKLOG.md` §"🐛 Harness Bugs" — "Orchestrator dies with supervising bash".

---

## Proposed Changelog

Audience: canon-ai contributors and adopters watching for behavior changes between installed versions.

**Add to `## [1.5.0] — unreleased` → `### Fixed` section:**

> **Orchestrator survives SIGHUP from dying supervising shell.** When Claude Code's bash session ends (conversation-resume, terminal close, network drop), SIGHUP no longer kills the orchestrator. A `WARN` line lands in the run log; the existing 10-minute stall timer remains armed and continues to be the detection layer for hung agents. SIGINT (Ctrl-C) behavior is unchanged. Detach mode and heartbeat detection remain in the backlog.

**Proposed version bump**: No new bump — this is a `Fixed` addition to the current unreleased 1.5.0 block. SemVer classification: patch (bug fix, no behavior change beyond fixing the silent-death failure mode). 1.5.0 will carry this fix when released.
