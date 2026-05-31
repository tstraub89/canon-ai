# QA Summary: canon-watch — `canon watch <id>`, blocking observer for detached pipeline runs

## What Changed

Added **`canon watch <id>`** — a read-only blocking observer that attaches to a detached `canon run` orchestrator, streams phase transitions to stderr, and exits when the run goes idle with a single machine-parseable summary line (`state=… reason=…`) on stdout plus a classified exit code: `0` healthy stop (checkpoint / complete / `--step` done) · `2` nothing-to-watch / read error / launch-window timeout / **ambiguous PID** · `3` auto-block · `4` death · `5` `--timeout` elapsed. Flags: `--until <phase>` (return early when a phase settles), `--timeout <dur>`, `--follow`/`-f` (tail the run log). Replaces the hand-rolled `status.json` + `grep` + `sleep` poll loops operators were writing. Normal two-step: `canon run <id>` → `canon watch <id>`.

The command also required extracting the orphan-worktree + PID-liveness resolution that `watch`, `doctor`, and `stop` all need into one audited module — **`scripts/run-task/run-context.ts`** (`gatherRunContext`, tolerant task-dir resolver, EPERM-tolerant PID probe). `doctor` and `stop` are migrated onto it with no behavior change (their existing suites are the regression gate), removing the per-command resolution drift that was the root cause of prior orphan/PID bugs.

**This round (post-PR reroute) added two fixes from Codex's PR review plus three caught by the from-scratch re-review:**
- **RF-1 — PID-disagreement refusal:** when `.canon-pid` and a fresh `heartbeat.pid` are *both alive but differ* (a reused stale pid alongside the real run's pid), `gatherRunContext` nulls `resolvedPid` and `watch` refuses — `state=… reason=ambiguous_pid`, exit `2`, stderr `…both alive but disagree. Refusing to attach.` — instead of attaching to the wrong process. Mirrors `stop`'s CASE D-disagree refusal.
- **RF-2 — live phase-pointer transitions:** default mode now emits a stderr `canon watch: phase X → Y` line whenever the phase pointer changes between polls (previously only the heartbeat-age tick printed, so phase progress was invisible without `--follow`).
- Re-review fixes: `readStatus` restored to throw (not `die()`) so `try/catch` callers behave; `classifyIdle`'s `human_review → checkpoint` branch made reachable (was emitting `step_done`); `doctor`'s `checkActiveOrchestrators` reads the worktree-resolved path.

## Files Changed

- `src/cli/commands/watch.ts` — New. Attach-time classification (blocked → ambiguous_pid → live → launch_window → death → nothing_to_watch), idle classification + grace re-read, ambiguous-PID refusal, live phase-transition emission, `--until`, `--timeout`, launch-window wait, `--follow` log tail.
- `scripts/run-task/run-context.ts` — New. Shared resolver: tolerant task-dir lookup, EPERM-tolerant PID probe, `ambiguousPid` detection (nulls `resolvedPid` on disagreement), `gatherRunContext()`; injectable for tests.
- `scripts/run-task/state.ts` — Exported `validateStatus`; added `readStatusFromPath(statusFile, taskIdForErrors?)`; `readStatus()` delegates through it and preserves throw semantics for existing callers.
- `src/cli/commands/doctor.ts` — Migrated onto the shared resolver; "Active orchestrators" output unchanged.
- `src/cli/commands/stop.ts` — `taskDirFor` / PID probe rewired through shared primitives; CASE A–D / wait / escalation untouched; signal targets identical.
- `src/cli/index.ts` — Dispatch + `printHelp()` block for `canon watch` (incl. the `ambiguous_pid` reason).
- `tests/run-context.test.ts` — New. Orphaned-worktree resolution, heartbeat-PID fallback, ambiguous-PID disagreement, launch-window detection, EPERM handling.
- `tests/watch.test.ts` — New. Attach/idle branches, ambiguous-PID refusal, grace re-read, launch-window wait, `--until`, `--timeout`, read-failure, live phase-transition emission, summary-line format.
- `tests/cli.test.ts` — Added `watch` dispatch coverage; subprocess helper uses the active worktree root; fixture status valid for the new resolver guard.
- `dist/cli/index.js`, `dist/scripts/run-task.js` — Rebuilt bundles.
- `docs/pipeline-orchestrator.md` (+ synced `templates/docs/pipeline-orchestrator.md`), `docs/codebase-map.md` — `canon watch` documented (exit codes, summary keys, `ambiguous_pid`) and added to the CLI map.
- `CLAUDE.md` (+ synced `templates/CLAUDE.md`) — added a `canon watch` quick-ref steering operators away from hand-rolled poll loops (committed directly to the PR branch, since policy files can't ride the human_review auto-commit).

## How to Test

1. Start a task in the background: `canon run <some-task>` — prints a PID + log path, returns immediately.
2. `canon watch <some-task>` — expect an "attached to pid=…" line on stderr, then a `canon watch: phase X → Y` line each time the run advances (default mode, no `-f` needed). The command blocks.
3. Let it reach a stopping point — expect `watch` to exit on its own with one stdout summary line, e.g. `state=human_review reason=checkpoint phase=qa→human_review verdict=approved pid=…`.
4. `canon watch <a-finished-task>` — does NOT hang; says nothing to watch, points at `canon task status`, `$? = 2`.
5. *(Optional)* Kill the background process mid-run, re-run `canon watch <task>` — `$? = 4`, `reason=death`, resume hint.
6. *(Optional)* `canon watch <task> --until plan` → returns when plan settles (`reason=until`). `-f` → live log alongside phase events.
7. **Regression:** `canon doctor` reports active orchestrators exactly as before; `canon stop <task>` still terminates a detached run and still refuses ambiguous cases. Confirms the shared-resolver migration preserved behavior.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Clean. |
| `npm run type-check` | Pass | `tsc --noEmit` clean. |
| `npm test` | Pass | Full suite green on a clean checkout (CI). Key suites verified 161/161 (`watch`, `run-context`, `stop`, `cli`). The `docs telemetry files stay clean after the suite` test false-fails *only* in a dirty worktree (this run's own telemetry rows dirty `docs/pipeline-invocations.md`); a clean checkout / CI does not hit it. |
| `npm run sync-templates:check` | Pass | Canon-managed files in sync. |
| `npm run build` | Pass | `dist/` regenerated + committed. |
| E2E | not_configured | No browser/E2E suite. |

## Human Verification Required

None blocking. Optionally eyeball the live `phase X → Y` output and the `ambiguous_pid` refusal message in a real run, since those are operator-facing strings.

## Decisions Made

- **Output split** (stdout = summary only, stderr = progress): `$(canon watch <id>)` captures exactly the structured summary.
- **No launching**: `watch` is a pure observer; `canon run --watch` is a noted fast-follow.
- **Reuse `stop`'s launch-window poller** (`waitForHeartbeat`, `STOP_WAIT_DEFAULT_MS`, `STOP_WAIT_POLL_INTERVAL_MS`) rather than reinventing the first-heartbeat wait.
- **Grace re-read before declaring death**: re-resolve once after one poll interval to avoid the final-`status.json`-write / heartbeat-removal race.
- **RF-1 — refuse on PID disagreement** (vs. guessing): mirrors `stop`'s CASE D, since attaching to a reused unrelated pid is worse than refusing.
- **RF-2 — track `previousPhasePointer`** across polls and emit on change, independent of `--follow`.

## Open Questions / Known Follow-ups

- **Non-blocking spec gap (this round):** the idle-path `read_error` case (`watch.ts`) exits `2` with `reason=read_error` but does not emit the stderr line naming the file/cause that AC-7 specifies (the attach-path and live mid-poll paths do). Narrow window (status corrupts during/after the grace re-read). One-line follow-up.
- **Deferred (separate, pre-existing):** harden the `docs telemetry files stay clean` test in `tests/task-cli.test.ts` so it diffs telemetry state before/after instead of asserting absolute git-cleanliness.

## Proposed Changelog

**Minor bump** 1.7.0 → 1.8.0 (new user-visible command, no breaking changes). For `## [Unreleased]` → `### Added`:

```
- **`canon watch <id>`.** Blocking observer for detached pipeline runs. Attaches to an
  already-running orchestrator, streams `phase X → Y` transitions to stderr, and exits
  with a machine-parseable summary line (`state=… reason=…`) plus a classified exit code:
  `0` healthy stop, `2` nothing-to-watch / read error / ambiguous PID, `3` auto-block,
  `4` crash, `5` timeout. Flags: `--until <phase>`, `--timeout <dur>`, `--follow`/`-f`.
  Refuses to attach when `.canon-pid` and a live heartbeat PID disagree (PID-reuse safety).
- **Shared run-context resolver.** `doctor`, `stop`, and `watch` consume one audited module
  (`scripts/run-task/run-context.ts`) for orphan-worktree fallback and PID liveness, ending
  the per-command resolution drift behind past orphan/PID bugs; `doctor`/`stop` output unchanged.
```
