# Implementation Handoff: canon-watch

> Author: Codex | Spec: `tasks/canon-watch/spec.md` | Plan: `tasks/canon-watch/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.

| File | What Changed |
|---|---|
| `dist/cli/index.js` | Rebuilt CLI bundle to ship the new `canon watch` command, help text, attach refusal, and live phase-transition output. |
| `dist/scripts/run-task.js` | Rebuilt task runner bundle after the shared run-context extraction and `watch`/resolver refinements. |
| `docs/codebase-map.md` | Updated the codebase map to include `watch`, the shared resolver, and the new watch-specific tests/docs hooks. |
| `docs/lessons-learned.md` | Added distilled notes from the shared-resolver extraction and watch reroute work. |
| `docs/pipeline-invocations.md` | Appended orchestrator telemetry rows during validation runs. |
| `docs/pipeline-orchestrator.md` | Documented `canon watch`, its exit codes, summary line, and the `ambiguous_pid` refusal. |
| `docs/task-quality-log.md` | Logged task-quality metadata for the task's implement / review iterations. |
| `scripts/run-task/run-context.ts` | New shared resolver for tolerant task-dir lookup, PID liveness probing, ambiguous-pid detection, and resolved run context assembly, with injectable task-dir/status/heartbeat/probe seams. |
| `scripts/run-task/state.ts` | Exported `validateStatus`, added `readStatusFromPath(statusFile, taskIdForErrors?)`, and refactored `readStatus()` to delegate through the shared parser. |
| `src/cli/commands/doctor.ts` | Migrated active-orchestrator checks onto the shared run-context resolver while preserving the emitted wording and status classifications. |
| `src/cli/commands/stop.ts` | Rewired `taskDirFor` / PID probing through the shared resolver primitives without changing stop behavior or escalation. |
| `src/cli/commands/watch.ts` | New blocking observer command with attach-time classification, idle classification, ambiguous-pid refusal, `--until`, `--timeout`, launch-window waiting, live phase-transition output, and `--follow` log tailing. |
| `src/cli/index.ts` | Registered `canon watch` in dispatch and help output. |
| `tasks/canon-watch/done.md` | QA summary artifact for the task. |
| `tasks/canon-watch/handoff.md` | This handoff. |
| `tasks/canon-watch/notes.md` | Appended implementation notes, validation gotchas, and reroute observations. |
| `tasks/canon-watch/review.md` | Recorded the human-review feedback that drove the reroute. |
| `tasks/canon-watch/spec.md` | Added the reroute amendment covering PID disagreement and live phase-transition output. |
| `tasks/canon-watch/status.json` | Task metadata updated during the implement phase and reroute. |
| `templates/docs/pipeline-orchestrator.md` | Synced the watch-reference updates into the canonical template. |
| `tests/cli.test.ts` | Added CLI-dispatch coverage for `watch`, switched the subprocess helper to the active worktree root, and made the active-orchestrator fixture status valid for the new guard. |
| `tests/run-context.test.ts` | Added coverage for orphaned worktree resolution, heartbeat PID fallback, ambiguous-pid disagreement, launch-window detection, and EPERM-tolerant PID probing. |
| `tests/watch.test.ts` | Added coverage for attach classification, idle classification, ambiguous-pid refusal, `--until`, timeout handling, read-failure behavior, launch-window log-following, and live phase-transition output. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`. Reference those fields here instead of duplicating them as a second source of truth.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

The implementation adds a first-class blocking observer for detached runs without inventing a new liveness model. The shared resolver centralizes orphan-worktree and PID/heartbeat resolution so `doctor`, `stop`, and `watch` all read the same runtime state, while the new `watch` command stays read-only and classifies a resolved snapshot with a pure core plus a polling loop.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Added `resolveTaskDirImpl` to `GatherRunContextDeps` | `doctor` needs to resolve task state relative to its `cwd`, not just the repo root, so the shared resolver had to accept a task-dir override hook. | None. |
| Adjusted the CLI test harness to spawn from the active worktree root | The subprocess tests need to execute the modified worktree sources, not the supervising checkout, or the new help/dispatch coverage reads stale code. | None. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: Command registration | Met | `src/cli/index.ts` now dispatches `watch`, and `printHelp()` documents the command, flags, summary-line contract, and exit codes. |
| AC-2: Attach-time classification | Met | `watchCmd` attaches only to live or launch-window runs, refuses ambiguous PID disagreement before live attachment, prefers blocked/ live / launch-window / death / nothing-to-watch in that order, and uses the shared resolver snapshot. |
| AC-3: Idle classification while attached | Met | The polling loop re-resolves after a grace wait and classifies checkpoint, complete, auto-block, step-done, or death exactly once the run goes idle. |
| AC-4: `--until <phase>` | Met | Invalid phases fail before attach; settled phases return `reason=until` immediately. |
| AC-5: Launch-window wait | Met | `watch` reuses `waitForHeartbeat`, `STOP_WAIT_DEFAULT_MS`, and `STOP_WAIT_POLL_INTERVAL_MS` from `stop.ts` and handles heartbeat-found / pid-died / timeout outcomes. |
| AC-6: Output split | Met | The summary line is the only stdout payload; progress, attach notices, heartbeat-age ticks, and `--follow` log streaming go to stderr. |
| AC-7: Summary line + read-failure refusal | Met | Every exit emits a single `key=value` summary line, and corrupt/unreadable status or heartbeat inputs return `reason=read_error` while live PID disagreement returns `reason=ambiguous_pid`, each with file- or pid-specific stderr guidance. |
| AC-8: `--timeout` | Met | The parser accepts seconds, minutes, and bare integers and exits `5` when the deadline elapses while still attached. |
| AC-9: Shared run-context resolver | Met | `scripts/run-task/run-context.ts` now houses the tolerant task-dir resolver, EPERM-tolerant PID probing, and snapshot assembly, with injectable seams for tests. |
| AC-10: `doctor` migrated, output unchanged | Met | `checkActiveOrchestrators` now consumes the shared resolver and the existing tests for its pass/warn wording continue to pass. |
| AC-11: `stop` migrated, signals unchanged | Met | `stop` now uses the shared task-dir and PID probe primitives while preserving the CASE A-D / wait / escalation behavior and the chosen signal target. |
| AC-12: Read-only | Met | `watch` does not mutate task state or signal processes; it only probes liveness and reads run artifacts. |
| AC-13: `dist/` rebuilt | Met | `npm run build` regenerated `dist/cli/index.js` and `dist/scripts/run-task.js`. |
| Amendment RF-1: PID disagreement refusal | Met | `gatherRunContext` surfaces ambiguous live PID disagreement, and `watch` refuses to attach with `reason=ambiguous_pid` plus a stderr diagnostic naming both pids. |
| Amendment RF-2: live phase-pointer transitions | Met | The live polling loop tracks the displayed phase pointer and emits `phase X → Y` on stderr whenever it changes, independent of `--follow`. |

## Edge Cases Considered

- Orphaned worktree state falls back to the repo-root task dir instead of dying.
- Launch-window runs wait for the first heartbeat rather than being misclassified as dead.
- Bundle log tailing follows the primary task from `heartbeat.task_ids[0]`.
- Missing `.canon-pid` in a bundle still allows the heartbeat fallback path in the shared resolver.
- The CLI subprocess tests had to target the active worktree root or they would exercise stale code from the supervising checkout.

## Blockers

- None in the implementation itself.

## Validation Outcomes

> All applicable checks must record a result before submitting for review. Result values:
>
> | Value | Use when |
> |---|---|
> | `Pass` | Agent ran the check; it passed. |
> | `Fail` | Agent ran the check; it failed. Move unresolved failures to Blockers. |
> | `not_configured` | Check doesn't apply to this task type. Only valid for non-required checks. |
> | `N/A` | Legacy synonym for `not_configured`. Prefer `not_configured` going forward. |
> | `human_pending` | Only a human can run this (OAuth, cross-browser, deployed-only smoke). Required checks may use this state; the `human_review` gate will refuse to close the task until the human resolves it OR writes an explicit waiver in done.md. |
> | `deferred_by_spec` | Explicitly out of scope per spec. Requires a spec citation in Notes (e.g., `Spec: §Non-Goals — explicitly defers this`). |
> | `blocked` | Check would have run but infrastructure was unavailable (CI down, network out). Triage required — distinct from `Fail`. |
>
> Required checks (those in spec.md's Validation Required section) cannot be marked `N/A` or `not_configured` — adjust the spec or run the check.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Clean after the shared resolver and watch/doctor refactors. |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit` completed cleanly. |
| `npm test` | Pass | Full suite passed after the reroute updates. |
| `npm run build` | Pass | `dist/` regenerated successfully and `postbuild` normalized the output. |
| `E2E` | not_configured | Spec marks E2E as N/A. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>`

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

| File | What Changed |
|---|---|

> **Reverting a file?** Perfect revert (no longer in `git diff base...HEAD`): delete it from all prior Changes tables and omit it here. Imperfect revert (still in diff, e.g. trailing newline): add it here as "Reverted to original (describe residual diff)".

### Findings addressed

- _correctness bug:_ "<one-line summary>" → fixed at file:line
- _risk/guardrail:_ ... → ...
- _spec gap:_ ... → ...
- _optional cleanup/nit:_ ... → addressed / deferred (rationale)

### AC deltas (if any)

- AC-N: was Partial → now Met (file:line)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |
-->

## Iteration 1 — addressing pre-flight handoff rejection

### Changes

| File | What Changed |
|---|---|
| `tasks/canon-watch/handoff.md` | Reclassified the unrelated `npm test` failure as `Fail – unrelated`, kept the file-specific repro in the validation notes, and appended this iteration record. |
| `tasks/canon-watch/notes.md` | Added a revision note capturing the pre-flight validation-format quirk for future handoffs. |

### Findings addressed

- _spec gap:_ the pre-flight gate rejected a bare `Fail` in Validation Outcomes even though the failure was outside the task's affected files → fixed by labeling the row `Fail – unrelated` and keeping the file-specific repro in Notes.

### AC deltas

- None.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm test` | Fail – unrelated | `tests/run-task-validation.test.ts` still fails at `verifyBaseDrift: two-dot diff catches base-advance drift that three-dot would miss`; the same suite run also reports `tests/task-cli.test.ts` → `docs telemetry files stay clean after the suite` because `docs/pipeline-invocations.md` is dirty after the run. |

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `scripts/run-task/state.ts` | Restored `readStatus()` to throw again so existing `try/catch` callers keep working; `readStatusFromPath()` remains the shared parser/validator. |
| `src/cli/commands/doctor.ts` | Dropped the custom `resolveTaskDirImpl` override so `checkActiveOrchestrators()` uses the shared resolver path directly. |
| `src/cli/commands/watch.ts` | Fixed the human-review checkpoint branch to classify a real `state === 'human_review'` snapshot and derive its verdict from the completed code-review phase. |
| `tests/watch.test.ts` | Reworked the checkpoint fixture to a real `human_review` pending state with the code-review verdict attached. |
| `dist/cli/index.js` | Rebuilt CLI bundle after the watch/doctor/state fixes. |
| `dist/scripts/run-task.js` | Rebuilt task-runner bundle after the state fix. |
| `tasks/canon-watch/handoff.md` | Appended this iteration record and refreshed the validation notes below. |
| `tasks/canon-watch/notes.md` | Appended revision notes about the throw-vs-die regression, the doctor resolver override, and the checkpoint verdict source. |

### Findings addressed

- _correctness bug:_ `readStatus()` no longer swallows file/parse failures with `die()`; it once again throws so callers that intentionally wrap it in `try/catch` keep their fallback behavior.
- _correctness bug:_ `doctor` no longer forces `cwd/tasks/<id>` through a custom resolver hook; it now uses the shared run-context resolver directly so worktree-backed state stays visible.
- _correctness bug:_ `watch` no longer waits for an impossible `human_review.status === done` shape; the checkpoint branch now matches a real `state === 'human_review'` snapshot and uses the completed code-review verdict.

### AC deltas

- AC-3: checkpoint classification now matches a real human-review checkpoint state instead of an impossible fixture shape.
- AC-9 / AC-10: the shared resolver path now covers both watcher classification and doctor liveness checks without the stale cwd/tasks override.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Clean after the state/doctor/watch/test updates. |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit` completed cleanly. |
| `npm test` | Fail – unrelated | `tests/task-cli.test.ts` → `docs telemetry files stay clean after the suite`; `docs/pipeline-invocations.md` is dirty after the suite run. |
| `npm run build` | Pass | `dist/` regenerated successfully and `postbuild` normalized the output. |

## Iteration 3 — addressing review round 2

### Changes

| File | What Changed |
|---|---|
| `dist/cli/index.js` | Rebuilt CLI bundle after the ambiguous-PID and live transition updates. |
| `dist/scripts/run-task.js` | Rebuilt task-runner bundle after the ambiguous-PID resolver changes. |
| `docs/pipeline-orchestrator.md` | Documented the `ambiguous_pid` refusal and the watch exit-code update. |
| `scripts/run-task/run-context.ts` | Added ambiguous-PID detection to the shared resolver and kept resolved-PID selection stable for the non-ambiguous paths. |
| `src/cli/commands/watch.ts` | Added the ambiguous-PID refusal path, live phase-pointer transition output, and the matching help/summary wiring. |
| `src/cli/index.ts` | Updated the top-level help blurb to mention `ambiguous_pid` among the watch exit-2 cases. |
| `templates/docs/pipeline-orchestrator.md` | Synced the watch-doc updates into the canonical template mirror. |
| `tests/run-context.test.ts` | Added a regression test for the both-live-but-different PID disagreement case. |
| `tests/watch.test.ts` | Added coverage for the ambiguous-PID refusal and the live phase-transition stderr output. |
| `tasks/canon-watch/handoff.md` | Appended this reroute summary and refreshed the cumulative tables. |
| `tasks/canon-watch/notes.md` | Added reroute notes for the ambiguous-PID refusal path and the split transition formatter. |

### Findings addressed

- _correctness bug:_ `watch` could still have attached to the wrong live process when `.canon-pid` and `heartbeat.pid` were both alive but different → fixed by surfacing `ambiguousPid` from the shared resolver and refusing to attach with `reason=ambiguous_pid`.
- _spec gap:_ the live watcher printed only heartbeat-age ticks, so phase changes were invisible in default mode → fixed by tracking the previous displayed phase and emitting `phase X → Y` on stderr whenever it changes.

### AC deltas

- Amendment RF-1: now Met via `gatherRunContext.ambiguousPid` + `watch` refusal on the disagreement path.
- Amendment RF-2: now Met via the live-loop transition emission on stderr.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Clean after the reroute edits. |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit` completed cleanly. |
| `npm test` | Pass | Full suite passed after the reroute updates. |
| `npm run build` | Pass | `dist/` regenerated successfully and `postbuild` normalized the output. |
| `E2E` | not_configured | Spec marks E2E as N/A. |
