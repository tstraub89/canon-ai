# Spec: watch-late-attach-crash — Late watch attach reports a crashed run as death

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

GitHub issue #95, a follow-up to #76 (`watch-crash-not-step-done`, PR #96). That task taught `classifyIdle()` in `src/cli/commands/watch.ts` to recognize a crashed run. When the current phase is `pending`/`in_progress` after a `done` phase, it reports `death` with a reason if either holds:

- the runtime files survived with a dead pid;
- the run log's newest exit marker is non-zero and not older than `status.json` (one-second tolerance).

`classifyIdle()` only runs when watch was attached *before* the orchestrator exited. When `canon watch <id>` starts after the run has already died (the common "check on a detached run later" case), the first classification is `classifyAttach()`. It never looks at that evidence:

- current phase `in_progress` → `death` with only the generic hint "run `canon run <id>` to resume", with no reason;
- current phase `pending` after a `done` phase (the exact crash shape from #76: a phase transition was written, then the next session died) → falls through to `nothing_to_watch`, exit 2, with "Use `canon task status <id>`…". The operator isn't told the run crashed.

**Confirmed mechanism (deterministic, executed on current `main`).** Since #17 (PR #97), an agent-session failure parks the phase `blocked`, and a late attach already reports `auto_block`, so agent failures are covered. What remains is every other way the orchestrator dies after a phase transition: `die()` paths such as a failed post-implement auto-commit, uncaught exceptions, and SIGKILL.

Repro: a detached full-auto run in a scratch repo with a failing pre-commit hook. The implement phase finished, then `autoCommitCode` died. The task was left with implement `done`, code_review `pending`, and the main-checkout `.canon-run.log` ending in `■ orchestrator exit code=1 [reason=Auto-commit failed: pre-commit: …]`. Starting `canon watch demo` afterwards printed `state=code_review reason=nothing_to_watch` and exited 2, because the run goes through `classifyAttach()`'s final return.

## Decision

1. **Share the crash-evidence check.** Extract the evidence logic from `classifyIdle()` into one exported helper in `src/cli/commands/watch.ts`. It returns a crash reason string, or null when there's no evidence:
   - (a) `ctx.resolvedPid` is non-null and not alive: reason "orchestrator died without a clean exit (runtime files left behind)";
   - (b) the newest exit marker across `runLogCandidateDirs(...)` is non-zero and not older than `status.json` by more than the existing one-second tolerance: reason "orchestrator exited non-zero: <marker reason>".
   
   `classifyIdle()` calls the helper and keeps its current behavior exactly. The existing #76 tests must pass unchanged.
2. **Use it on attach.** In `classifyAttach()`, after the live / blocked / launch-window checks and before the existing `in_progress` → `death` and final `nothing_to_watch` returns, when the task's current phase (first non-`done` phase) is `pending` or `in_progress`, call the helper. The primary task id comes from the heartbeat if one is readable, else the watched task id.
   - If it returns a reason, return `death` carrying both the reason and the existing resume hint.
   - If it returns null, fall through to today's returns unchanged: `in_progress` → `death` with the generic hint; otherwise `nothing_to_watch`.
3. **Print the reason.** `reportInitialFailure()`'s `death` case prints the reason line in the same `canon watch: orchestrator exited non-zero: … ; run \`canon run <id>\` to resume` shape the idle path uses, when a reason is present. Without a reason it prints today's hint only. The stdout summary line stays `state=<state> reason=death` and the exit code stays `4`.

## Non-Goals

- Not changing `classifyIdle()` behavior, the marker parser, candidate-directory resolution, or the freshness tolerance.
- Not finding a bundle *primary's* log when watching a secondary member late, with no heartbeat left to name the primary. The candidates are the watched task's own locations; record that limit in Known Risks rather than solving it here.
- Not changing `human_review` / `complete` / blocked handling on attach.
- No new exit codes, reasons or flags.

## Acceptance Criteria

- [ ] AC-1 (red-first regression): a `tests/watch.test.ts` test calls `classifyAttach` with spec_review `done`, plan `pending`, no heartbeat, `canonPid`/`resolvedPid` null, and a temp task dir whose `.canon-run.log` ends with a fresh `■ orchestrator exit code=1 [reason=claude session exited 1 …] at <ISO>` marker. It asserts `kind: 'death'` with the reason. It fails on pre-fix code (`nothing_to_watch`).
- [ ] AC-2: same shape with no run log and no runtime files still returns `nothing_to_watch`, verified by a unit test.
- [ ] AC-3: same shape with a `code=0` marker, or a non-zero marker older than `status.json` beyond the tolerance, returns `nothing_to_watch`, verified by unit tests.
- [ ] AC-4: plan `in_progress` with a fresh non-zero marker returns `death` carrying the marker reason. Plan `in_progress` with no evidence returns `death` with the generic hint, as today. Unit tests for both.
- [ ] AC-5 (`watchCmd` end-to-end): a `watchCmd` test whose first gathered context matches AC-1 exits `4`. Stdout is the `state=… reason=death` summary line, and stderr contains the marker reason and `canon run <id>`.
- [ ] AC-6 (structural): `classifyIdle()` and `classifyAttach()` both call the shared helper. The non-zero-marker freshness comparison appears once in `watch.ts`, verified by grep in the handoff. All existing `tests/watch.test.ts` tests pass unchanged.
- [ ] AC-7: `docs/pipeline-orchestrator.md` exit-code `4` row (or the sentence after the summary-line block) states that the crash evidence applies whether watch was attached before or after the run exited. The template mirror is regenerated, and `npm run sync-templates:check` passes.
- [ ] AC-8: full validation suite passes (see Validation Required), and `dist/` is rebuilt and committed.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/cli/commands/watch.ts` | Shared crash-evidence helper; `classifyIdle()` uses it; `classifyAttach()` uses it before its final returns; attach `death` carries an optional reason and `reportInitialFailure()` prints it. |
| `tests/watch.test.ts` | AC-1 to AC-5. |
| `docs/pipeline-orchestrator.md` | AC-7 wording. |
| `templates/docs/pipeline-orchestrator.md` | Mirror, regenerated by `npm run sync-templates` (never hand-edited). |
| `dist/cli/index.js` | Rebuilt bundle from `npm run build`; committed, do not revert. |

### Interaction Dependencies

- `AttachClassification`'s `death` variant gains an optional `reason`. Every `switch` over it (`reportInitialFailure`, any summary helper) must still compile and behave the same without a reason.
- `gatherRunContext()` is unchanged.

### Data Model Changes

None persisted.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`: run the full suite. A check means the suite runs clean, not just that new tests were added.
- [x] `npm run build`
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`

## Docs Impact

`docs/pipeline-orchestrator.md` (edited, AC-7). No protected doc is expected to go stale.

## Known Risks

- **Bundle secondary, late attach.** With no heartbeat, a secondary member's candidates don't include the primary's log, so its crash still reads `nothing_to_watch`. This is a narrow case; it is documented, not fixed.
- **Stale marker from an older run.** The freshness guard is reused unchanged (AC-3), so a crash marker older than the latest state write is ignored, exactly as on the idle path.
- **`state` field mismatch.** `classifyAttach()` reports `status.status` while `classifyIdle()` derives a summary state. Keep each function's existing state choice; don't unify them here.

## Human Test Plan

1. Start a full-auto run on a scratch task and make the planning agent fail, without watching it.
2. After it has stopped, start watching the task.
3. Expected: the watcher says the run crashed (exit code 4) and shows the failure reason and the resume command, instead of "nothing to watch".
4. Watch a task that simply finished a single step earlier.
5. Expected: still "nothing to watch" (exit code 2).

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
