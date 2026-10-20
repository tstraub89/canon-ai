# Spec: watch-crash-not-step-done — Watch reports a crashed full-auto run as death, not step_done

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

GitHub issue #76. A detached full-auto `canon run` whose plan-phase Claude session failed on an expired OAuth token exited, and `canon watch` reported the dead run as healthy: `state=plan reason=step_done phase=spec_review→plan`, exit code 0. An operator or agent driving the run reads that as one phase finishing normally and waits, instead of seeing a crash.

**Confirmed mechanism (deterministic, by code trace).** The watch poll loop in `src/cli/commands/watch.ts` reaches `classifyIdle()` only once `orchestratorStillProgressing()` has returned false, which happens as soon as the resolved orchestrator pid is dead or missing. `classifyIdle()` then checks blocked, `human_review` and `complete`, and reaches this branch:

- current phase status `pending` or `in_progress`, and `findPreviousDonePhase()` finds an earlier `done` phase → return `step_done`.

Nothing on that branch looks for crash evidence. The status shape after a crash right after a phase transition (previous phase `done`, current phase `pending`/`in_progress`) matches it exactly, so a crash is reported as `step_done` before the `death` fallback is reached. The existing test `classifyIdle: step_done shows the transition for a done phase` (implement done, code_review pending, no heartbeat, no pid) shows the classifier returns `step_done` for a dead run with no pid evidence at all.

**Why pid evidence alone does not fix it.** `bootHeartbeatWithHooks()` in `src/orchestrator/main.ts` registers `process.on('exit')` cleanup that removes `.heartbeat.json` and `.canon-pid`. Every `process.exit` path runs it: a clean `--step` exit, `die()`, the agent-wrapper exits, uncaught exceptions. So after the OAuth crash (an agent-wrapper `process.exit(1)`), the runtime files are gone and the run state looks identical to a clean step exit. Only SIGKILL/OOM leaves the files behind.

**Evidence that does survive.** `registerExitHandlers()` in `src/orchestrator/cli.ts` writes exactly one line per process exit, `■ orchestrator exit code=<N> [reason=<reason>] at <ISO timestamp>`, to fd 2. For a detached run fd 2 is the task's `.canon-run.log` (`runLogPathFor()` in `src/orchestrator/detach.ts`), opened in append mode, so the last marker in the file is the most recent detached run's exit. A `--step` run never detaches (it stays foreground), so it never writes to `.canon-run.log`; a clean full-auto stop at a gate exits `0`.

## Decision

Before `classifyIdle()` returns `step_done` on the "current phase pending/in_progress after a done phase" branch, check for crash evidence. Report `death` instead when either holds:

1. **Runtime files left behind.** `ctx.resolvedPid` is non-null. `classifyIdle()` is only reached with that pid dead, and a clean exit removes both runtime files, so a surviving pid record means the process did not exit cleanly.
2. **A non-zero exit marker newer than the task state.** The task's `.canon-run.log` exists, its last `■ orchestrator exit code=<N> …` line has `N ≠ 0`, and the marker's timestamp is not older than the task's `status.json` mtime (one-second tolerance for filesystem timestamp granularity). The timestamp guard stops a stale crash marker from an earlier detached run from overriding a later clean foreground `--step` run that advanced the state.

When neither holds, `step_done` is reported as today. That keeps a clean `--step` exit and a full-auto clean stop at a gate (exit `0`) on `step_done`.

The `death` classification for a crash-marker case carries the marker's reason. `watchCmd` prints it as a separate **stderr diagnostic** before the summary line (for example `canon watch: orchestrator exited non-zero: claude session exited 1 …; run \`canon run <id>\` to resume`). The stdout summary line contract is unchanged: still `state=<state> reason=death [pid=<pid>]`, no new key, no new reason name. For the runtime-files-left-behind case there is no marker reason, so the diagnostic says the orchestrator died without a clean exit.

"Non-zero" means any marker whose code is not `0`, including the non-numeric `signal:<NAME>` codes written when a run is terminated by a signal (the stop command, Ctrl-C, `kill`). A run terminated by signal mid-phase therefore reports `death` with the termination reason, rather than a false `step_done`.

The marker parsing goes in one small exported helper, so it can be unit-tested without a filesystem walk. The helper reads the run log and returns the last marker's code, reason and timestamp, or null when the log or marker is absent or malformed.

## Non-Goals

- Not changing how or when the orchestrator writes the exit marker, heartbeat or pid files. No new runtime file.
- Not changing the `changes_requested` branch of `classifyIdle()` (a settled reviewer verdict is a real stop).
- Not changing `classifyAttach()`, the launch-window `pid-died` path, or the blocked/`auto_block` path.
- Not keeping the orchestrator alive after an agent failure. That is issue #17, a separate task. Once it lands, many agent failures will park `blocked` and classify as `auto_block`. This task covers every crash that still ends the process.
- No new CLI flags, exit codes or reason names. `death` / exit `4` already exist.

## Acceptance Criteria

- [ ] AC-1 (red-first regression): a new `tests/watch.test.ts` test builds a `classifyIdle` context with spec_review `done`, plan `in_progress`, `heartbeatResult` missing, `canonPid`/`resolvedPid` null, and a temp task dir whose `.canon-run.log` ends with `■ orchestrator exit code=1 [reason=claude session exited 1 (possible budget exhaustion — see CLAUDE_BUDGET)] at <ISO>`, timestamped after `status.json`'s mtime. It asserts `kind: 'death'` and that the reason is carried. The test fails on pre-fix code (which returns `step_done`) and passes after.
- [ ] AC-2: same status shape with `resolvedPid` set to a pid the probe reports dead (runtime files left behind) classifies as `death`, verified by a unit test.
- [ ] AC-3: the clean-step shape still classifies as `step_done`: no run log, no runtime files. The existing test `classifyIdle: step_done shows the transition for a done phase` keeps passing unchanged.
- [ ] AC-4: a run log whose last marker is `code=0` (a full-auto clean stop at the spec gate, for example) still classifies as `step_done`, verified by a unit test.
- [ ] AC-5: a run log whose last marker has `code=1` but whose timestamp is older than `status.json`'s mtime by more than the tolerance (a later foreground `--step` run advanced the state) classifies as `step_done`, verified by a unit test.
- [ ] AC-6: with several markers in the log, only the last one decides. Earlier non-zero markers followed by a final `code=0` marker give `step_done`. A malformed or truncated final line is ignored in favour of the last well-formed marker, and a log with no well-formed marker is treated as absent. Each case is covered by a unit test of the parsing helper.
- [ ] AC-7: `watchCmd` end-to-end: a `watchCmd` test whose gathered context and task dir match AC-1 exits with code `4`, and the final stdout line is exactly the stable summary shape with `reason=death` (not `step_done`) and no extra keys. Existing `watchCmd` tests keep passing.
- [ ] AC-8: in the AC-7 test, captured stderr contains one `canon watch:` diagnostic that includes the marker's reason text and the resume hint, and stdout contains only the summary line. A second `watchCmd` case with a `signal:SIGTERM` marker (reason `terminated by SIGTERM …`) also exits `4` and surfaces that reason on stderr.
- [ ] AC-9: `docs/pipeline-orchestrator.md` exit-code table row for `0` no longer implies any dead run with a done previous phase is a step-done. It states that `0` is reported for `--step` step-done only when no crash evidence exists. The `4` row mentions that a non-zero exit marker in the run log counts as a crash, and the summary-line prose notes that for a crash the failure reason is printed on stderr (the summary line itself is unchanged). `npm run sync-templates:check` passes (mirror regenerated).
- [ ] AC-10: full validation suite passes (see Validation Required).

## Design

### Affected Files

| File | Change |
|---|---|
| `src/cli/commands/watch.ts` | In `classifyIdle()`, gate the pending/in_progress-after-done `step_done` return on the two crash-evidence checks; carry the exit reason on the idle `death` classification; `watchCmd` prints it as a stderr diagnostic in the idle `death` case. `summarizeIdle()`, `SummaryLine` and `formatSummaryLine()` are unchanged. |
| `src/orchestrator/run-context.ts` | Add the exported exit-marker parsing helper (or put it in `watch.ts` if that keeps imports simpler, but there must be one helper, not two parsers). Expose what `classifyIdle()` needs (task dir / run-log path, `status.json` mtime) via `RunContext` or an injectable dep so unit tests can supply them. |
| `tests/watch.test.ts` | Regression and branch tests for AC-1 to AC-8. |
| `docs/pipeline-orchestrator.md` | Exit-code table wording (AC-9). The `templates/` mirror is regenerated by the sync hook. |
| `templates/docs/pipeline-orchestrator.md` | Mirror of the above, regenerated by `npm run sync-templates` (never hand-edited). |

### Interaction Dependencies

- `gatherRunContext()` is also used by `canon stop` and `canon doctor` heartbeat checks. Additive fields only; do not change existing field semantics.
- The exit-marker format is owned by `writeExitMarker()` in `src/orchestrator/cli.ts`. The parser must match its exact shape (`■ orchestrator exit code=<N> [reason=<text>] at <ISO>`). Reasons are already collapsed onto one line there.
- Issue #17 (a concurrent task) will make most agent failures park `blocked` and exit `2`. Those classify as `auto_block` before this branch is reached, so this task does not conflict with it.

### Data Model Changes

None persisted. `RunContext` and the `death` idle classification gain optional fields.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`: run the full suite. A check means the suite runs clean, not just that new tests were added.
- [x] `npm run build`
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`

## Docs Impact

`docs/pipeline-orchestrator.md` (edited, see AC-9). `docs/codebase-map.md` entries for watch/run-context are descriptive and should stay accurate. No protected doc is expected to go stale.

## Known Risks

- **Stale marker from an earlier run.** Handled by the `status.json` mtime guard (AC-5). The residual gap is a crash that happens without any status write after an older clean foreground step run: the marker is newer, so `death` is reported, which is correct.
- **Clock/mtime granularity.** Marker timestamps are millisecond ISO, while mtimes on some filesystems are second-granular. Hence the one-second tolerance. A marker within tolerance of the status write counts as newer (prefer reporting a crash over hiding one).
- **Large run logs.** Detached logs can grow across many runs. Read only the tail (for example the last 64 KiB) to find the last marker; don't load unbounded files.
- **Summary-line stability.** Agents parse the stdout line; the reason deliberately travels on stderr only. Any new summary key is out of scope.
- **A non-zero exit that is a deliberate stop** (for example "Stopping for human review", exit `2`, without a `blocked` phase) will now report `death` with its reason, not `step_done`. That is more truthful: a human is needed, and the reason line says why.

## Human Test Plan

1. Start a full-auto run on a scratch task, and make the planning agent fail partway through (for example by temporarily breaking the agent's login).
2. Watch the task.
3. Expected: the watcher reports the run as crashed (exit code 4), and shows the failure reason from the run log, not "step done".
4. Run a single phase with step mode on another task and watch it afterwards.
5. Expected: it still reports a normal step completion (exit code 0).

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) *Problem* states the confirmed mechanism and how it was confirmed; *Acceptance Criteria* includes a red-first regression-test AC
- [x] (Refactors) N/A
