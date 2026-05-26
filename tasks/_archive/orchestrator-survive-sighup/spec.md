# Spec: orchestrator-survive-sighup — Orchestrator survives SIGHUP from dying supervising shell

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

A `canon run <id>` invocation backgrounded inside Claude Code's bash tool died silently after ~2h10m on 2026-05-25 during the `worktree-canonical-task-state` pipeline. `pgrep -fl "canon|run-task"` returned nothing — the orchestrator process was gone. `/tmp/canon-run-worktree-canonical.log` ended mid-Codex-turn at `→ session started → turn started` with no error, no stall warning, no SIGTERM message. The operator only noticed because the user asked "what's going on, it's been a few hours."

Code inspection (2026-05-25) confirmed the smoking-gun cause:

1. **No signal handlers**: `grep "process.on" scripts/run-task.ts scripts/run-task/main.ts` returns zero hits. Node's default SIGHUP action is to terminate the process. When Claude Code's bash session ends (conversation-resume, terminal close, network drop), SIGHUP propagates down the process group from the supervising shell to the orchestrator, which dies silently.
2. **Children inherit the supervising shell's tty**: [`scripts/run-task/agents/stream.ts:30-33`](../../scripts/run-task/agents/stream.ts) spawns Codex and Claude with `stdio: ['inherit', 'pipe', 'pipe']`. The child's stdin is the supervising bash session's controlling terminal. When that tty goes away, the child may hang on a half-closed stdin pipe or be killed by the OS.
3. **The 10-minute stall timer at [`env.ts:50`](../../scripts/run-task/env.ts) lives inside the orchestrator**, so when the orchestrator dies the timer dies with it. That's why the 2h+ silence happened without any SIGTERM-on-stall log line — the guard that should have surfaced an agent stall was already dead.

The Codex session ID is durable on the Anthropic side, so `canon run <id>` resumed cleanly afterward — no work was lost. But the operator had no detection signal: the failure was indistinguishable from "Codex is thinking hard" until the operator noticed external time had passed.

This is filed as the orchestrator-process-death entry in `docs/BACKLOG.md` § "🐛 Harness Bugs".

## Decision

Stop the orchestrator from dying when the supervising bash exits. Two minimal changes:

1. **Install a SIGHUP handler in the orchestrator entry point** that logs the signal and continues. Node's default SIGHUP action becomes a no-op for the orchestrator.
2. **Sever child stdin from the supervising tty**. Change the `stdio` array in `streamProcess` so children get `'ignore'` (or a null pipe) on stdin instead of inheriting the parent's controlling terminal.

Post-fix, the failure mode "supervising shell dies during long Codex turn" becomes survivable: the orchestrator keeps running, the existing 10-minute stall timer remains armed, and if Codex truly hangs the stall timer fires SIGTERM as designed and the orchestrator exits with a logged reason — operator can see `<agent> stalled — no output for 600s. Sending SIGTERM` in the log instead of an abrupt mid-turn truncation.

The fix preserves canon's current foreground UX. Operators who want backgrounding still use `&` or Claude Code's bash-tool background mode; nothing about the user-facing CLI changes.

## Non-Goals

- **Detach mode / daemon mode / PID files / `--detach` flag**: out of scope. Backlog entry covers it as a separate polish layer; this task is the minimum survival fix.
- **Heartbeat log line / periodic liveness writes**: out of scope. The existing 10-minute stall timer becomes the detection layer once the orchestrator survives; no new heartbeat needed.
- **`canon doctor` extensions or runtime-status command**: out of scope. `canon doctor` stays scoped to environment setup. A future task may add `canon task status <id>` runtime-liveness checks.
- **"Yellow zone" warning before the stall timer SIGTERMs**: out of scope. The existing single-threshold timer is left alone; refinements are a separate task.
- **Changes to how Codex/Claude sessions are resumed**: out of scope. Session resumption already works; this task doesn't touch it.
- **Behavior change for foreground invocations**: foreground runs should continue working exactly as today. SIGINT (Ctrl-C) must still terminate the orchestrator — we only intercept SIGHUP.

## Acceptance Criteria

- [ ] AC-1: `scripts/run-task.ts` installs `process.on('SIGHUP', ...)` at module top-level (before any phase work begins). The handler writes one line to stderr via the existing `warn()` helper (so it lands in the log) and returns; it does NOT call `process.exit`.
- [ ] AC-2: After the SIGHUP handler is installed, sending SIGHUP to the Node process does not terminate it. Verified by a test that spawns `scripts/run-task.ts` (or a focused harness that loads the same SIGHUP-handler module), sends SIGHUP to the child via `process.kill(pid, 'SIGHUP')`, waits, and asserts `child.exitCode === null` after a short delay.
- [ ] AC-3: `streamProcess` at `scripts/run-task/agents/stream.ts:30` spawns children with `stdio: ['ignore', 'pipe', 'pipe']` (was `['inherit', 'pipe', 'pipe']`). No other stream-handling logic changes.
- [ ] AC-4: SIGINT (Ctrl-C) behavior is unchanged. The orchestrator still terminates on SIGINT. Verified by a test analogous to AC-2 that sends SIGINT and asserts the process exits.
- [ ] AC-5: `docs/patterns.md` "Known Pitfalls" gains a one-paragraph entry referencing this fix: pre-fix failure mode (silent death on supervising-shell exit), post-fix behavior (orchestrator survives; stall timer remains the detection layer for hung agents), and a pointer to the BACKLOG entry for the deferred detach/heartbeat work.
- [ ] AC-6: The BACKLOG entry "Orchestrator dies with supervising bash..." in `docs/BACKLOG.md` § "🐛 Harness Bugs" is updated to mark the survival fix shipped (checkbox `[x]` is NOT flipped — the entry covers detach + heartbeat too, which remain open; instead, add a parenthetical "survival fix shipped <date>; detach mode and heartbeat-detection layer remain open" at the top of the entry).

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task.ts` | Add `process.on('SIGHUP', () => { warn('SIGHUP received; ignoring (orchestrator survives supervising-shell exit).'); })` at top-level. Import `warn` from `./run-task/cli.js` if not already imported. |
| `scripts/run-task/agents/stream.ts` | Change `stdio: ['inherit', 'pipe', 'pipe']` to `stdio: ['ignore', 'pipe', 'pipe']` at line 32. No other changes to the file. |
| `tests/run-task-signals.test.ts` *(new file)* | Two cases: (a) SIGHUP-ignore — spawn a child Node process that loads the SIGHUP handler (or `scripts/run-task.ts` with a no-op task id that exits quickly), send SIGHUP, assert the process is still alive after 200ms, then SIGKILL it; (b) SIGINT-still-kills — same shape, but send SIGINT and assert the child exits within 200ms. |
| `docs/patterns.md` | Add a "Known Pitfalls" entry per AC-5. |
| `docs/BACKLOG.md` | Update the orchestrator-death entry per AC-6 (parenthetical "survival fix shipped" note; entry stays open for detach/heartbeat). |
| `dist/scripts/run-task.js` | Rebuilt bundle reflecting the source changes to `scripts/run-task.ts` and `scripts/run-task/agents/stream.ts`. Mandatory per project policy: CI runs `npm run build && git diff --exit-code -- dist/` and fails on stale `dist/`. |

### Interaction Dependencies

- **Existing stall timer at `STALL_TIMEOUT_MS` (env.ts:50, 10 min default)**: unchanged. After this fix, the stall timer becomes the load-bearing detection layer for hung agents. If the timer's threshold or behavior is wrong, this fix exposes that — but no change to the timer is part of this task.
- **`stdio: 'inherit'` on stdout/stderr**: untouched. Only stdin changes to `'ignore'`. The orchestrator's log capture (stream.ts:50-72) reads child stdout/stderr via the existing pipes; that behavior is preserved.
- **Codex / Claude CLI input mechanism**: verified during spec authoring (via `/canon-review` Agent B pass) — both `agents/codex.ts:49` and `agents/claude.ts:106` pass prompts as CLI arguments (positional arg for Codex, `-p` flag for Claude). Neither writes to `child.stdin` programmatically, and neither expects to read from stdin. Setting `stdio[0]` to `'ignore'` is safe: the children get immediate EOF on stdin, which is fine because they never read from it.

### Data Model Changes

None.

## Validation Required

- [x] `lint` (`npm run lint`)
- [x] `type-check` (`npm run type-check`)
- [x] `unit tests` (`npm test`) — suite includes new `tests/run-task-signals.test.ts`
- [x] `build` (`npm run build`) — touches `scripts/run-task.ts` and `scripts/run-task/agents/stream.ts`, both compiled into the published bundle
- [x] `docs-refs-check` (`npm run docs-refs-check`) — touches `docs/patterns.md` and `docs/BACKLOG.md`

## Docs Impact

- `docs/patterns.md` — new "Known Pitfalls" entry (AC-5).
- `docs/BACKLOG.md` — orchestrator-death entry updated to record survival fix (AC-6).

No changes to `docs/architecture.md`, `docs/codebase-map.md`, `docs/decisions.md`, `docs/product-context.md`, or `docs/pipeline-orchestrator.md`.

## Known Risks

- **SIGHUP handler installed too late**: the handler must be at module top-level (before any `await` or phase work). If it's installed inside an async function, a SIGHUP arriving during early startup could still kill the process. The implementer must install it as one of the first statements in the entry file.
- **Tests that spawn child Node processes can be flaky on slow CI**: the 200ms post-SIGHUP wait in AC-2 may need to be longer (e.g., 500ms) if CI is slow. Implementer should tune the timing based on test stability.
- **macOS-specific signal behavior**: Node's signal handling on macOS and Linux is consistent for SIGHUP/SIGINT (POSIX). No platform-specific shims expected. Windows is not a supported platform for canon (Node `engines` is 24.x; canon-ai shells out to bash/git/codex/claude, none of which work uniformly on Windows). No Windows handling needed.
- **The fix doesn't address the long-tail of silent-death modes**: SIGKILL (oom-killer, manual `kill -9`), kernel panic, machine sleep, network partition on a remote shell — none of these are fixed by SIGHUP handling. The BACKLOG entry's heartbeat-detection follow-up is the right home for those. This task explicitly accepts that remaining gap.

## Human Test Plan

1. Apply the fix on a feature branch. Run `npm run build`.
2. In one terminal, run a long-running canon task (e.g., re-trigger `canon run worktree-canonical-task-state` in spec_review iter N). Note the PID printed by canon's startup banner OR find it via `pgrep -fl "canon|run-task"`.
3. Close the terminal window (or kill the parent shell process with `kill <bash-pid>`). The orchestrator's terminal is now gone.
4. In another terminal, run `pgrep -fl "canon|run-task"`. Expected: the orchestrator is still listed — it survived SIGHUP.
5. `tail -f /tmp/canon-run-*.log` for the active task. Expected: log shows a `WARN: SIGHUP received; ignoring...` line at the moment the parent shell died, and Codex/Claude activity continues.
6. Wait for the task to finish naturally (or kill it with `kill <orchestrator-pid>`).
7. *Counter-test*: repeat steps 1-3 but use `kill -INT` (SIGINT) on the orchestrator instead of closing the terminal. Expected: the orchestrator exits cleanly. SIGINT behavior is unchanged.

If steps 4-5 show the orchestrator dying when the parent shell closes, the fix has not landed correctly. If step 7 shows the orchestrator surviving SIGINT, the handler is too broad — only SIGHUP should be intercepted.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names) — *exception: this is a developer-tooling task with no end-user product surface; the "product owner" here is the canon operator, so command-level test steps are appropriate*
- [x] Validation Required has at least one entry marked `- [x]`
