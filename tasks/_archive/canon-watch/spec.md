# Spec: canon-watch — `canon watch <id>`, blocking observer for detached pipeline runs

> Written by: Claude | Review by: Codex
> Status: draft
> Size: L · delicate: false · base: release/v1.8

> **Spec contract note:** The Acceptance Criteria below state required **behavior and contracts**. Implementation mechanics — exact function signatures, the pure-core / impure-loop split, internal seams, precise constant names — are deliberately left to plan/implement. Verification is consolidated in the **Testing Matrix** section (not repeated per-AC). Where an AC says "matching `stop`'s X," the existing behavior of X is the contract.

## Problem

`canon run <id>` **auto-detaches** whenever stdout is not a TTY (`shouldAutoDetach`, `scripts/run-task/detach.ts`) — always true inside Claude Code's Bash tool, CI, and piped invocations. The parent prints a PID + log path and exits in ~1s; the real pipeline runs on in a separate process group (by design — that's what survives harness pgroup kills on session resume).

The consequence: the operator session has **no join point** on the detached work. The harness's native "notify when this background command finishes" fires immediately (the parent already exited), not when the phase settles. Today's only monitoring surfaces are `tail -f tasks/<id>/.canon-run.log` (never returns), `canon doctor` (point-in-time snapshot), and `canon task status <id>` (full JSON, needs parsing). None *block until the next decision point and tell you why they stopped* — so operators hand-roll fragile poll loops (inline JSON parsing, magic status strings, fixed sleeps, no death detection, no exit-code contract). This task replaces that with a first-class blocking observer.

## Decision

Add a top-level **`canon watch <id>`** command: a read-only observer that attaches to an already-detached orchestrator, blocks until it goes idle (or a crash / timeout / early `--until` fires), then classifies `status.json` and exits with a code + a single machine-parseable summary line.

- **Model — join on the orchestrator.** `watch` blocks while a live orchestrator works and returns the moment it stops. The detached child's lifetime already encodes the run shape (`--step` exits after one phase; a full run exits at the next checkpoint; completion exits; a crash leaves a stale liveness signal). No new "progress" concept.
- **Requires a live run.** With no live orchestrator at invocation, `watch` does not block — it classifies the current state and exits non-zero. Finished tasks aren't watchable; use `canon task status` for those.
- **Exit-code contract** (branch on `$?` fast, read the line for detail): `0` healthy stop (checkpoint / complete / `--step` step-done) · `2` hard error (bad usage, nothing-to-watch, unreadable state, launch-window timeout) · `3` auto-block · `4` death · `5` `--timeout` elapsed.
- **Summary line** — always the final **stdout** line, stable `key=value`, e.g. `state=human_review reason=checkpoint phase=qa→human_review verdict=approved pid=48213`.
- **Output split** — stdout carries only the summary line (clean capture); all progress (attach line, phase transitions, heartbeat-age ticks) and the `--follow` log stream go to **stderr**.
- **`--until <phase>`** returns early (exit `0`, `reason=until`) when the named phase settles.
- **`--timeout <dur>`** optional cap (`30s`, `10m`, bare seconds); default none.
- **Shared run-context resolver (root fix).** The orphan-tolerant task-dir + pid/heartbeat resolution `watch` needs is already implemented twice — in `doctor` and `stop`. Extract it into one audited helper all three consume, so orphan-worktree and missing-pid resolution has exactly one correct home and the bug class can't recur per-consumer. Per-command *policy* (doctor's liveness report, stop's signal escalation, watch's classify/poll) stays in each command; only the resolution primitives are shared.

## Non-Goals

- **No launching.** `watch` only observes. A combined `canon run --watch` is deferred as a fast-follow — the standalone command is the essential primitive (enables re-attaching after a resume kills the watcher).
- **No mutation.** `watch` never writes `status.json`, never changes the git working tree, never signals the orchestrator (that's `canon stop`). Read-only git *inspection* (e.g. `git worktree list`) is fine.
- **No "wait for a run to appear."** `watch` does not poll for a not-yet-started run (that invites an infinite hang). Launch→watch ordering is operator-controlled.
- **No new liveness mechanism.** Reuse the existing heartbeat + `.canon-pid` + `status.json` signals and the existing stale threshold as-is.
- **No wedge detection.** A live-but-stuck orchestrator (fresh heartbeat, no phase progress) is caught only by `--timeout`.
- **No `stop`/`doctor` changes beyond the shared-primitive extraction.** The migration swaps resolution primitives only — no other refactors, no CLI-output changes, no change to `stop`'s signal/escalation behavior.

## Acceptance Criteria

- [ ] **AC-1 — Command registration.** `canon watch <id>` is dispatched in `src/cli/index.ts` to `watchCmd` in a new `src/cli/commands/watch.ts`, with a `canon watch` block added to `printHelp()` (flags + exit-code/summary-line contract). `canon watch` with no id exits `2` with usage; the existing unknown-command path is unchanged.
- [ ] **AC-2 — Attach-time classification (require a live run).** Using the shared resolver (AC-9) — never `resolveTaskCwd()`, which `die()`s on orphaned-worktree state — `watch` returns by this precedence (most-specific real state first; it never blocks on a non-live run):
  1. any phase `status === "blocked"` → exit `3` (`auto_block`), even if the orchestrator is mid-shutdown.
  2. orchestrator **live** (resolved pid alive **and** non-stale heartbeat) → block and watch (AC-3).
  3. **launch window** (`.canon-pid` alive, first heartbeat not yet written) → bounded wait (AC-5), not death/nothing-to-watch.
  4. `status.json` `in_progress` but no live process → exit `4` (`death`) with a `run \`canon run <id>\` to resume` hint.
  5. otherwise (settled phase / `complete` / all-`pending`) → exit `2` (`nothing_to_watch`), pointing at `canon task status`.
- [ ] **AC-3 — Idle classification while attached.** Polling on a fixed interval (~3s), when the orchestrator goes idle (pid dead, or heartbeat removed by clean shutdown) `watch` classifies the settled state: `human_review`→`checkpoint` (0); `complete`→`complete` (0); a `blocked` phase→`auto_block` (3); an intermediate settled phase (`done` or `changes_requested`) with later phases still `pending` — the `--step` case →`step_done` (0, carrying `verdict` when `changes_requested`); still `in_progress`→`death` (4). **Death is concluded only after a grace re-read** (re-resolve once more after a poll interval): this avoids the race where the orchestrator's final `status.json` write lands just after its heartbeat is removed.
- [ ] **AC-4 — `--until <phase>`.** Returns early (exit `0`, `reason=until`) the moment the named phase settles (`done`/`changes_requested`/`blocked`), without waiting for full idle. An invalid phase (not in `PHASE_ORDER`) exits `2` (`usage_error`) before attaching.
- [ ] **AC-5 — Launch-window wait.** When the resolver reports the launch-window state, `watch` waits for the first heartbeat instead of misreporting — **reusing `stop`'s existing launch-window poller and timeout** (`waitForHeartbeat`, `STOP_WAIT_DEFAULT_MS`, `STOP_WAIT_POLL_INTERVAL_MS`), not a reimplementation. `detachAndExit` writes no bootstrap heartbeat, so this window is real. Outcomes: heartbeat appears → resume AC-2 classification (typically → live → block); `.canon-pid` dies during the wait → exit `4` (`death`); deadline elapses with no heartbeat → exit `2` (`launch_window_timeout`) with a startup-crash hint.
- [ ] **AC-6 — Output split.** stdout receives exactly one line: the summary line. Progress (attach line, phase-pointer transitions, periodic heartbeat-age tick) goes to stderr. `--follow`/`-f` additionally tail-streams the run log to stderr.
- [ ] **AC-7 — Summary line + read-failure refusal.** Every exit prints exactly one stable `key=value` summary line to stdout, keys `state` + `reason` (+ `phase`/`verdict`/`pid` when applicable). If `status.json` or `.heartbeat.json` is unreadable or corrupt, `watch` refuses rather than guesses: exit `2`, `reason=read_error`, with a stderr line naming the file, the underlying cause, and how to recover. The `reason` vocabulary is documented in `--help` and `docs/pipeline-orchestrator.md`.
- [ ] **AC-8 — `--timeout`.** Accepts `<int>s` / `<int>m` / bare integer seconds; elapsing while still attached → exit `5` (`timeout`). Absent → no cap.
- [ ] **AC-9 — Shared run-context resolver.** A new `scripts/run-task/run-context.ts` houses the orphan-tolerant resolution extracted from `doctor` (`readStatusForCheck`/`resolveHeartbeatDir`) and `stop` (`taskDirFor`/`probeAlive`): a tolerant task-dir resolver, an EPERM-tolerant pid-liveness probe, and a `gatherRunContext(taskId)` returning the task dir, a tagged `status.json` read, a tagged heartbeat read, and the **resolved live pid** — preferring `.canon-pid`, falling back to a fresh `heartbeat.pid`, **matching `stop`'s existing CASE C and CASE D pid selection** — plus the launch-window flag. Status reads go through a new `readStatusFromPath` in `state.ts` (export `validateStatus` for reuse) so resolution never needs `resolveTaskCwd()`. `watch`'s classification is a **pure function over a resolved-context snapshot** (no disk/processes/timers — fully unit-testable); the impure poll loop owns the re-reads (the grace re-read of AC-3 and the launch-window wait of AC-5 happen by re-resolving and re-invoking the pure core on the fresh snapshot). The resolver is injectable (read/clock impls) for tests.
- [ ] **AC-10 — `doctor` migrated, output unchanged.** `doctor` consumes the shared resolver (its old private helpers reimplemented on it or removed). `canon doctor`'s "Active orchestrators" output — pass/warn lines, wording, stale-vs-missing detail — is byte-identical.
- [ ] **AC-11 — `stop` migrated, signals unchanged.** `stop`'s `taskDirFor`/`probeAlive` are replaced by the shared primitives. Its CASE A–D decision, launch-window wait, and SIGTERM→SIGKILL escalation are untouched; the pid signalled for every case is identical before and after. **Highest regression risk in the task** — a wrong pid signals an unrelated process.
- [ ] **AC-12 — Read-only.** No writes: no `status.json` mutation, no git working-tree change, no signals (only the `0` liveness probe). Read-only git inspection (the resolver's `git worktree list` via `isOrphanedWorktreeState`) is allowed.
- [ ] **AC-13 — `dist/` rebuilt.** `npm run build` is run and the regenerated `dist/` committed, so `npm run build && git diff --exit-code -- dist/` is clean.

## Testing Matrix

Verification for all ACs is consolidated here. New unit tests are **pure** (no real disk/processes/timers, via injected impls — same style as `tests/stop.test.ts`).

**`tests/run-context.test.ts` (the resolver, AC-9):**
- orphaned-worktree fixture → resolver returns the REPO_ROOT task dir, does not throw;
- pid fallback: `.canon-pid` missing / heartbeat fresh → uses `heartbeat.pid`; `.canon-pid` present-but-dead / heartbeat fresh → uses `heartbeat.pid` (CASE C + CASE D);
- launch-window detection: `.canon-pid` alive + heartbeat missing → launch-window flagged, not live;
- EPERM from the probe ⇒ treated as alive.

**`tests/watch.test.ts` (decision core + CLI, AC-1–AC-8):**
- each attach-time branch (auto-block, live, launch-window, death, nothing-to-watch);
- each idle branch (checkpoint, complete, auto_block, step_done incl. `changes_requested` verdict, death);
- grace re-read: heartbeat-gone + `in_progress` then settled → resolves to the settled classification, **not** death;
- launch-window wait: heartbeat-appears / pid-dies / timeout → correct exit code + summary;
- read-failure: unreadable/corrupt status or heartbeat → exit `2`, `reason=read_error`;
- `--until`: target settles → return; invalid phase → exit `2`;
- `--timeout` duration parser (valid + rejected forms); deadline reached → exit `5`;
- summary-line format across the `reason` vocabulary; default-mode stdout is exactly one line;
- bundle: multi-id heartbeat resolves the shared log under `task_ids[0]` while classifying the requested id.

**Migration regression gate (the proof behavior is preserved — AC-10/AC-11):**
- `tests/stop.test.ts` (CASE A–D, launch-window wait, refuse paths, signal escalation) passes **unmodified** (except mechanical rewiring of references to removed helper names);
- doctor's `checkActiveOrchestrators` coverage in `tests/cli.test.ts` passes **unmodified**;
- add a characterization test only if the extraction touches a pid-selection/output path the existing suite does not already exercise.

**Full suite:** `npm test`, `npm run lint`, `npm run type-check`, `npm run build` all clean; `dist/` committed.

## Design

### Shared run-context resolver (the root fix)

Three earlier `spec_review` rounds all rediscovered one gap: `watch`'s attach-time resolution must mirror the orphan-worktree + missing-pid tolerance `doctor` and `stop` already implement. The fix is to stop re-specifying it and extract it once (`scripts/run-task/run-context.ts`):

| Today (duplicated) | After |
|---|---|
| `doctor.readStatusForCheck` (orphan-tolerant status read) | `gatherRunContext` → tagged status read (via `readStatusFromPath`) |
| `doctor.resolveHeartbeatDir` / `stop.taskDirFor` (orphan-tolerant dir) | tolerant task-dir resolver |
| `stop.probeAlive` (EPERM-tolerant liveness) | shared pid-liveness probe |
| `stop` CASE C/D `.canon-pid`→`heartbeat.pid` selection | `gatherRunContext` → resolved live pid |

`doctor` and `stop` are refactored onto the shared primitives with **no observable behavior change** (the existing suites are the gate). `watch` consumes the resolver directly and so cannot get orphan/pid resolution wrong — there's nothing left to re-implement. This is the structural reason the finding class can't recur; it is *not* a scope expansion of `watch`'s observable behavior.

### Classification precedence (the authority)

AC-2's ordering is the single source of truth for attach-time decisions: **blocked (3) → live (block) → launch-window (wait) → death (4) → nothing-to-watch (2)**. Most-specific real state first, so "no live process" never masks a more specific outcome. `watch` only ever *blocks* on a live, non-blocked run.

### Liveness, clean-exit, and the launch window

- **Live** = resolved pid alive (`process.kill(pid,0)`) **and** heartbeat not stale (`isHeartbeatStale`, existing `HEARTBEAT_STALE_AFTER_MS`). Pid-liveness is primary; staleness is the tie-breaker (covers pid reuse).
- **Clean shutdown deletes `.heartbeat.json`** — so a vanished heartbeat mid-watch means "this leg finished," classify `status.json`. A *present but stale* heartbeat (or dead pid) with `status.json` `in_progress` means crash → death, but only after the AC-3 grace re-read.
- **Launch window** — `detachAndExit` writes no bootstrap heartbeat, so `.canon-pid` can be alive before the first heartbeat. `stop` already waits this out (`waitForHeartbeat`); `watch` reuses that poller rather than reinventing it.

### Affected Files

| File | Change |
|---|---|
| `src/cli/commands/watch.ts` | **New.** `watchCmd` (arg parse, poll loop, `--follow` streamer) + the pure decision core. |
| `src/cli/index.ts` | Dispatch `case 'watch'` + `printHelp()` block. |
| `scripts/run-task/run-context.ts` | **New (AC-9).** Shared resolver: tolerant task-dir resolver, pid-liveness probe, `gatherRunContext` + its types. The single audited home for orphan + pid resolution; injectable for tests. |
| `scripts/run-task/state.ts` | **Export `validateStatus`** (currently private) **and add `readStatusFromPath(statusFile, taskIdForErrors?)`** (`JSON.parse` + `validateStatus`, against an arbitrary path; `taskId` feeds only diagnostic messages). Refactor `readStatus` to delegate to it. No behavior change for existing callers. |
| `src/cli/commands/doctor.ts` | **Refactor (AC-10).** Consume the shared resolver; "Active orchestrators" output unchanged. |
| `src/cli/commands/stop.ts` | **Refactor (AC-11).** Swap `taskDirFor`/`probeAlive` for shared primitives; CASE A–D / wait / escalation untouched; per-case signal target identical. Highest regression risk. |
| `scripts/run-task/detach.ts` | *(no change)* — import source for `runLogPathFor(taskDir)` (the canonical run-log path resolver for `--follow` and log-pointer stderr lines). Don't re-hardcode the filename. |
| `tests/run-context.test.ts` | **New.** Resolver unit tests (per the Testing Matrix). |
| `tests/watch.test.ts` | **New.** Decision-core + CLI unit tests (per the Testing Matrix). |
| `tests/stop.test.ts` | *(modify only if needed)* — rewire references to removed helper names; behavioral assertions unchanged (migration gate). |
| `tests/cli.test.ts` | *(modify only if needed)* — rewire doctor helper-name references; behavioral assertions unchanged (migration gate). |
| `dist/` | Rebuilt CLI bundle (directory-form matches subpaths; CI gates `git diff --exit-code -- dist/`). |
| `docs/pipeline-orchestrator.md` | *(QA phase, protected doc)* Document `canon watch` — exit-code table, summary keys, the `canon run`→`canon watch` two-step. |
| `templates/docs/pipeline-orchestrator.md` | *(QA phase, auto-synced)* Pre-commit hook mirror of `docs/pipeline-orchestrator.md`; declared so the `--pr` base-drift gate allows the synced delta. |
| `docs/codebase-map.md` | *(QA phase, protected doc)* Add `canon watch` + the new files to the CLI command map. |
| `CLAUDE.md` | *(QA phase)* One-liner steering operators to `canon watch` instead of a hand-rolled poller. |
| `templates/CLAUDE.md` | *(QA phase)* Auto-synced mirror of the root `CLAUDE.md` edit (pre-commit hook). |

### Data Model Changes

None. `watch` reads `status.json`, `.heartbeat.json`, `.canon-pid`, `.canon-run.log`; defines no new persisted shape. `HeartbeatRecord` (incl. `task_ids[]`) and `StatusJson` are consumed as-is.

## Validation Required

- [x] `npm run lint` (`eslint scripts/ tests/ src/`)
- [x] `npm run type-check` (`tsc -p tsconfig.json --noEmit`)
- [x] `npm test` (`node --test --import tsx tests/*.test.ts`) — full suite clean, existing `stop`/`doctor` suites **unmodified**
- [x] `npm run build` — and commit the regenerated `dist/`
- [ ] E2E — N/A (no browser/E2E suite)

Also CI-gated if docs/templates change: `npm run sync-templates:check`, `npm run docs-refs-check`.

## Known Risks

- **Heartbeat-removal / final-status-write race** → mitigated by the AC-3 grace re-read; pid-liveness is the primary signal.
- **PID reuse** → require *both* pid-alive and a non-stale heartbeat for "live"; bounded blast radius (at worst blocks until `--timeout` or staleness).
- **Live-but-wedged orchestrator** → not detected beyond `--timeout` (a Non-goal); note in help.
- **Bundle log location** → the shared log lives under `task_ids[0]`, not necessarily the watched id; resolve via the heartbeat's `task_ids[0]`.
- **`stop` refactor signals the wrong process (highest risk)** → AC-11 forbids behavior change and leans on the existing `stop` suite (CASE A–D, wait, refuse) passing unmodified. Bounded, operator-visible blast radius, so **not `delicate`** — flip `delicate: true` if you'd rather upgrade the review-model tier for the `stop` path.
- **`doctor` output drift** → AC-10 pins output unchanged against the existing doctor tests.

## Human Test Plan

1. Start a task in the background (`canon run <some-task>`) — it prints a PID + log path and returns immediately.
2. Run `canon watch <some-task>`. Expected: an "attached" line, then it stays running, showing each phase transition with an occasional "heartbeat Ns ago" reassurance.
3. Let it reach a stopping point (human checkpoint or completion). Expected: `watch` returns on its own with one final summary line saying where it ended up; exit status `0` for a healthy stop.
4. Run `canon watch <a-finished-task>`. Expected: it does **not** hang — says there's nothing to watch, points at `canon task status`, exits non-zero.
5. *(Optional)* Start a run, kill the background pipeline process in another terminal, re-run `canon watch <task>`. Expected: reports the orchestrator died, says to re-run `canon run`.
6. *(Optional)* `canon watch <task> --until plan` → returns as soon as the plan phase settles.
7. *(Optional)* `canon watch <task> -f` → live log streams by, then the same single summary line at the end.
8. **Regression:** `canon doctor` still reports active orchestrators exactly as before; `canon stop <task>` still stops a detached run (and still refuses the ambiguous cases). Confirms the shared-resolver migration preserved behavior.

## Amendment

> Round 1 reroute. Two P2 findings from Codex's PR-level review of commit `b2869a3`. Both are implementation gaps against the contracts above — address both, re-run validation; the rest of the spec is unchanged.

### RF-1 — `watch` must mirror `stop`'s PID-disagreement refusal
`gatherRunContext`'s `resolvedPid` (`scripts/run-task/run-context.ts`) currently selects `.canon-pid` whenever it is alive, without checking it agrees with a live `heartbeat.pid`. When a stale `.canon-pid` has been reused by an unrelated live process **and** `.heartbeat.json` is `found`/fresh with a **different** live pid, the resolver returns the unrelated `.canon-pid` and `classifyAttach` treats the fresh heartbeat as liveness proof for it — attaching to / reporting the wrong process. This is exactly the "both alive but disagree" PID-reuse ambiguity that `stop` **refuses** (its CASE D "ambiguous state" path).
**Required:** detect the mismatch — `.canon-pid` alive **and** `heartbeat.pid` alive **and** `canonPid !== heartbeat.pid` — and do **not** resolve to `.canon-pid` or report `live`. Mirror `stop`'s policy. *Recommended mechanic:* refuse with exit `2` and a stderr diagnostic naming both pids (a dedicated `reason=ambiguous_pid`, or the existing `read_error` shape) rather than guessing. Agreeing pids, the CASE C `.canon-pid`-dead/heartbeat-fresh fallback, and the launch-window case are unaffected. Add a `run-context.test.ts` case for both-alive-disagree.

### RF-2 — emit phase-pointer transitions during a live run
In the attached live branch (non-`--follow`), each poll prints only the heartbeat-age tick and `continue`s (`src/cli/commands/watch.ts`); it never tracks the prior phase or emits a transition line. A normal detached run that advances phase while the heartbeat stays fresh therefore shows **no** transitions in default mode — violating **AC-6** ("one line per detected phase-pointer transition") and the Decision's output-split promise, which is the command's headline UX.
**Required:** track the previous phase pointer (`deriveTopLevelStatus` / the displayed phase) across polls and emit a stderr transition line (e.g. `spec_review → plan`) whenever it changes, independent of `--follow`. The heartbeat-age tick stays. Add a `watch.test.ts` case asserting a transition line is emitted when the polled phase changes.
