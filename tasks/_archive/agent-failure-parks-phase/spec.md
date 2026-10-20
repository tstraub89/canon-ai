# Spec: agent-failure-parks-phase — Agent session failures park the phase blocked instead of killing the orchestrator

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

GitHub issue #17. When a pipeline agent session fails (spawn error, stall, signal, or a non-zero Claude exit such as budget exhaustion or an expired OAuth token), the agent wrapper calls `process.exit()` inside the wrapper. The orchestrator runs agents in-process, so one failed session kills the whole (usually detached) orchestrator. The exit fires before the phase runner's post-processing and before `checkAndRoute()`. So:

- the phase is left `in_progress`;
- its artifact stays an unfilled template;
- no `escalations[]` entry is written and no stop banner is printed;
- the session ID is never stored;
- the metrics `finally` in `runClaude()` never runs, so no `failed` metric row is written.

The operator sees a dead PID and an `in_progress` phase. Observed repeatedly: budget exhaustion mid spec-revision and mid code_review foreman (2026-06-08), a detached run dying mid-implement (2026-06-09), and an expired OAuth token in the plan phase (the incident behind issue #76).

**Confirmed mechanism (deterministic, by code trace and an existing test).**

- `src/orchestrator/agents/claude.ts` `runClaude()` non-interactive `attempt()` ends in a failure ladder: `spawnError` → `process.exit(1)`, `stalled` → `process.exit(1)`, `exitCode !== 0` → `process.exit(result.exitCode)` (after `printClaudeTooOldHint`), `signal` → `process.exit(1)`. Each sets an exit reason first. The stale-`--resume` case returns before the ladder and is retried fresh. That behavior is correct and stays.
- `src/orchestrator/agents/codex.ts` `runCodex()`: `spawnError`, `stalled` and `signal` each call `process.exit(1)`. A non-zero Codex *exit code* does **not** exit: it warns and returns, and phase completion is verified from `status.json`. The issue text overstates this, and that existing return behavior is correct and stays.
- `src/orchestrator/phases/code-review.ts`: when `runColdCodexReview()` fails, it calls `setExitReason(...)` then `process.exit(1)` with no `autoBlockPhase()`, leaving `code_review` `in_progress`. Same leak, in a phase runner.
- `checkAndRoute()` in `src/orchestrator/main.ts` parks a crashed Codex `spec_review` (`shouldParkCrashedReview()`) with a warning and `process.exit(2)`, but writes no `blocked` status and no escalation.
- `retryAgentForPhase()` (`main.ts`, called from `recoverPhaseForTask()` inside `checkAndRoute()`) calls `runCodex` / `runClaude`, so a failure during recovery also kills the process.
- The existing test "Claude failure ladders set exit reasons and Codex non-zero exits do not exit by themselves" in `tests/run-task-safety.test.ts` asserts the current behavior: a fake `claude` running `exit 1` makes the process exit with status 1 and a `claude session exited 1` marker.

**Hazard that the fix must not open.** `runClaude()` writes accumulated (possibly partial) text to stdout and returns it in `ClaudeRunResult`. Today the ladder exits before any caller sees a failed result. If the wrappers simply *returned* on failure, `runQaPhase()` in `src/orchestrator/phases/qa.ts` would salvage `done.md` from a truncated session's `capturedStdout` and force `qa → done`. So a failed session must not reach phase post-processing as a normal result.

## Decision

Replace every in-wrapper `process.exit` on a non-interactive agent session failure with a typed error that the orchestrator's main loop turns into a durable park.

1. **Typed failure.** Add an exported `AgentSessionError` class (extends `Error`) in a new module `src/orchestrator/agents/errors.ts`, carrying `agent: 'claude' | 'codex'`, `kind: 'spawn_error' | 'stalled' | 'signal' | 'exit_code'`, the exit code or signal when known, and a one-line operator-facing reason. The reason text matches today's exit reasons, for example `claude session exited 1 (possible budget exhaustion — see CLAUDE_BUDGET)`.
2. **Wrappers throw instead of exiting.** In `runClaude()`'s non-interactive failure ladder, and in `runCodex()`'s `spawnError` / `stalled` / `signal` branches, throw `AgentSessionError` where `process.exit` is called today. Keep the existing side effects that come before the exit (the `printClaudeTooOldHint` call, the error `console.error`). Because throwing unwinds, `runClaude()`'s metrics `finally` now records the failed session. Codex's non-zero-exit-code return path is unchanged.
3. **Cold-Codex lens failure throws too.** The `!coldReview.success` branch in `runCodeReviewPhase()` throws `AgentSessionError` (agent `codex`) with its existing reason ("cold-Codex review could not be obtained … the code_review phase has not advanced.") instead of `process.exit(1)`.
4. **One park point.** The main loop in `main()` wraps `runPhase(currentPhase, state)` and `checkAndRoute(currentPhase, taskIds)` (which covers `retryAgentForPhase()`) in a `try/catch` that handles only `AgentSessionError`; anything else is rethrown unchanged. On catch it:
   - calls `autoBlockPhase(taskIds, currentPhase, <current iteration count>, reason)` with the **full bundle** `taskIds`, so the phase becomes `blocked` with an `escalations[]` entry on every member (see Decision 7 for members that had already completed the phase). The reason is the error's reason plus the recovery hint: "fix the cause (auth, budget — raise `CLAUDE_BUDGET`, network), then re-run `canon run <id>`";
   - prints a stop banner naming the phase, the agent, the reason and the recovery command;
   - sets the exit reason to the error's reason and exits `2`, the existing auto-block exit code.
5. **Crashed spec_review park writes the same durable state.** The `shouldParkCrashedReview()` branch in `checkAndRoute()` records its park with `autoBlockPhase()` over the full bundle `taskIds` (phase `spec_review`, reason naming the non-zero Codex exit) before its existing `process.exit(2)`, so all agent-failure stops leave `blocked` + an escalation, under the same bundle policy as Decision 7.
6. **Recovery is a plain re-run.** A plain `canon run <id>` re-enters a `blocked` phase and runs it again (verify that this holds for each phase; if any entry path refuses or misroutes a `blocked` phase that was parked by this mechanism, fix it in this task). `canon watch` already classifies a `blocked` phase with no live orchestrator as `auto_block`, exit `3`.
7. **Bundles park atomically: completed members are reopened.** A bundle runs one agent session for all members, and members record completion one at a time, so a session can fail after member A marked the phase `done` but before member B did. The park reopens A: every member's `phases.<currentPhase>.status` becomes `blocked`, including members whose status was `done`. Every member then derives the same current phase, so the advertised plain re-run (`canon run A B`) passes the same-phase check and redoes the phase for the whole bundle in one session.
   - *Why this is safe.* Every site that can raise an `AgentSessionError` into the catch runs before any bundle routing: the phase runners' agent sessions (inside `runPhase()`), and `retryAgentForPhase()`, which is reached only from the per-member completion loop at the top of `checkAndRoute()`. The verdict switch and every routing write (`routeBackTo`, reroute and loop-cap handling) come after that loop and call no agent. So at the park, a completed member has gained only its `<currentPhase>` status flag and whatever its agent wrote for that phase (artifact text, verdict, review counters); no later phase has been touched. Reopening the flag loses no routing state. A member's artifact and verdict are left in place and are overwritten by the re-run.
   - *Rejected alternative:* preserve completed members and resume only the lagging ones. That leaves the bundle split across phases, which the main loop's same-phase check refuses (`Bundle tasks are at different phases — cannot proceed`). Supporting it would need a split-resume mode in the main loop, and bundle-level routing (for example any member's `changes_requested` routing the whole bundle) assumes members finish a phase together. Out of proportion to the cost of redoing one phase for one member.

Interactive mode (`runInteractiveClaude()` and the interactive Codex path through `runCommandOrDie()` in `src/orchestrator/git.ts`) keeps exiting. The operator is at the terminal and sees the failure directly.

## Non-Goals

- No automatic retry, budget raise or backoff after a failure. The park is the whole behavior change.
- Not changing interactive-mode exits (`runInteractiveClaude`, `runCommandOrDie`).
- Not changing Codex's non-zero-exit-code return path, nor `shouldParkCrashedReview()`'s condition (still `spec_review` with a non-zero Codex exit).
- Not detecting error-typed `result` events (`is_error` / `subtype`) in Claude's stream. That is a separate truthfulness fix.
- Not storing the failed session's ID for resumption.
- Not changing loop-cap auto-blocks, the reviewer-set `code_review: blocked` handling (`stopForReviewerBlock()`), or `--reroute` / `canon task accept` semantics.
- Not changing `canon watch`. Issue #76 is a separate task (`watch-crash-not-step-done`).
- No new CLI flags, env vars or exit codes.

## Acceptance Criteria

- [ ] AC-1 (structural): `src/orchestrator/agents/claude.ts` contains no `process.exit` in the non-interactive `attempt()` failure ladder, and `src/orchestrator/agents/codex.ts` `runCodex()` contains no `process.exit` in its `spawnError` / `stalled` / `signal` branches. The only remaining `process.exit` calls in those two files are the interactive paths, verified by grep. `src/orchestrator/phases/code-review.ts` no longer calls `process.exit(1)` on a cold-Codex failure.
- [ ] AC-2 (red-first regression, unit): the existing test "Claude failure ladders set exit reasons and Codex non-zero exits do not exit by themselves" is updated. Calling `runClaude` with a fake `claude` that exits 1 now rejects with `AgentSessionError` (`agent: 'claude'`, `kind: 'exit_code'`, reason matching /claude session exited 1/) and the child process does not exit on its own. The codex spawn-error, stall and signal cases reject with `AgentSessionError` of the matching `kind`. The codex non-zero-exit case still returns and prints `after-runCodex`. The updated assertions fail against pre-fix code.
- [ ] AC-3 (end-to-end park): an integration test runs the orchestrator `main()` on a full-tier task at `plan` with a fake `claude` on `PATH` that exits 1. It asserts all of:
  - the process exits with code `2`;
  - `status.json` has `phases.plan.status === 'blocked'`;
  - `escalations` gains one entry with `phase: 'plan'` and a reason matching /claude session exited 1/ and /canon run/;
  - `auto_block_count` incremented;
  - the exit marker carries the session-failure reason.
  The test fails on pre-fix code (exit 1, phase `in_progress`, no escalation).
- [ ] AC-4 (Codex phase park): an integration test with a fake `codex` that stalls (`PIPELINE_STALL_TIMEOUT_MS` small) during `implement` parks `implement` as `blocked` with an escalation, and exits `2`.
- [ ] AC-5 (recovery): after the AC-3 park, replacing the fake `claude` with one that succeeds (writes a filled `plan.md` and runs the phase-done command, as existing plan-phase fakes do) and running `main()` again advances `plan` to `done`. No manual `canon task phase` reset is needed. Verified in the same or a follow-on test.
- [ ] AC-6 (QA salvage not reached): a unit/integration test drives `runQaPhase` with a fake `claude` that prints done.md-shaped text and then exits non-zero. `runQaPhase` rejects with `AgentSessionError`, `done.md` is not written from stdout, and `qa` is not forced to `done`.
- [ ] AC-7 (cold-Codex park): a `tests/run-task-code-review.test.ts` test where the injected `runColdCodexReview` returns `{ success: false }` asserts that `runCodeReviewPhase` rejects with `AgentSessionError` (`agent: 'codex'`), so the main loop parks `code_review` `blocked`. Existing assertions that expected `process.exit(1)` here are updated.
- [ ] AC-8 (crashed spec_review park is durable): the existing crashed-`spec_review` park tests in `tests/run-task-safety.test.ts` additionally assert that `phases.spec_review.status === 'blocked'` and that an escalation with `phase: 'spec_review'` was written. The tests for self-bookkept and clean-exit spec_review advance keep passing unchanged.
- [ ] AC-9 (non-agent errors untouched): a unit test shows that a non-`AgentSessionError` thrown from a phase runner is not converted into a park: it reaches the existing uncaught-exception handling (exit 1 with its own reason) and writes no escalation.
- [ ] AC-10 (metrics): after an AC-2-style Claude failure, the metrics file override (`CANON_METRICS_FILE_OVERRIDE`) contains a row with status `failed` for that session.
- [ ] AC-11 (docs, one home per restatement): the following describe the new behavior and none still says an agent failure kills the orchestrator or leaves the phase `in_progress`:
  - `docs/patterns.md` §"A non-zero agent exit is not a completed review — recovery must park, not read the artifact": the "a crashed Claude exits before recovery" sentence becomes the throw-and-park mechanism, plus one sentence on the bundle rule (the park reopens every member, which is safe only because no agent session runs after `checkAndRoute()`'s routing writes);
  - `docs/pipeline-orchestrator.md` §"Phase Routing + Auto-Block": a short paragraph on agent-session failures parking `blocked` (exit `2`, recover with `canon run <id>`; in a bundle every member is parked, including one that had already finished the phase, and the re-run redoes the phase for the whole bundle), and the "Crashed Codex `spec_review` parks" paragraph updated to say it now records `blocked` + escalation;
  - `docs/architecture.md` "Auto-block / reroute": correct the claim that `autoBlockPhase` exits (the callers exit);
  - `.claude/skills/canon-pipeline/recovery.md` "Agent auth 401 mid-pipeline": recovery is fix-auth then `canon run <id>`, no manual phase reset;
  - template mirrors regenerated, and `npm run sync-templates:check` passes.
- [ ] AC-12: full validation suite passes (see Validation Required).
- [ ] AC-13 (bundle partial completion, red-first): an integration test runs `main()` on a two-member full-tier bundle (A, B) at `spec_review`. The fake `codex` records A's `spec_review` as `done` / `approved` (the way existing spec_review fakes run the phase command) and then dies by a signal or stall before recording B. It asserts all of:
  - exit code `2`;
  - both A and B have `phases.spec_review.status === 'blocked'`, so A's completed review was reopened;
  - both derive `spec_review` as their current phase, and each has a new `spec_review` escalation;
  - a second `main()` run on both IDs, with a fake `codex` that records both members `done` / `approved`, gets past the same-phase check and advances both to `plan` (it does not exit 1 with "Bundle tasks are at different phases").

  A second case covers the crashed-spec_review park (Decision 5): the fake `codex` records A `done` / `approved` and then exits non-zero (no signal), leaving B incomplete. Both members end `blocked` at `spec_review` with an escalation and exit `2`. Both cases fail on pre-fix code: the first exits 1 with no park, and the second leaves A at `plan` and B at `spec_review`, so the bundle re-run dies at the same-phase check.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/agents/errors.ts` | New: `AgentSessionError` class and an `isAgentSessionError` guard. |
| `src/orchestrator/agents/claude.ts` | Non-interactive failure ladder throws `AgentSessionError` instead of `process.exit`. |
| `src/orchestrator/agents/codex.ts` | `runCodex()` spawn-error / stall / signal branches throw `AgentSessionError`. |
| `src/orchestrator/phases/code-review.ts` | Cold-Codex failure throws `AgentSessionError` instead of `process.exit(1)`. |
| `src/orchestrator/main.ts` | Main-loop `try/catch` around `runPhase` + `checkAndRoute` that parks the full bundle via `autoBlockPhase` and exits `2` for `AgentSessionError` only. `shouldParkCrashedReview()` branch records `autoBlockPhase` over the full bundle before exiting. |
| `tests/run-task-safety.test.ts` | Update the failure-ladder test (AC-2), add park and recovery integration tests (AC-3 to AC-5, AC-9 to AC-10), the QA salvage-not-reached test (AC-6), extend the crashed-spec_review tests (AC-8), and add the bundle partial-completion tests (AC-13). |
| `tests/run-task-code-review.test.ts` | Cold-Codex failure test (AC-7). |
| `docs/patterns.md` | AC-11. |
| `docs/pipeline-orchestrator.md` | AC-11. |
| `docs/architecture.md` | AC-11. |
| `.claude/skills/canon-pipeline/recovery.md` | AC-11. |
| `templates/docs/pipeline-orchestrator.md` | Mirror, regenerated by `npm run sync-templates`. |
| `templates/.claude/skills/canon-pipeline/recovery.md` | Mirror, regenerated by `npm run sync-templates`. |
| `dist/cli/index.js` | Rebuilt bundle (`npm run build`); `dist/` is committed. |
| `dist/orchestrator/run-task.js` | Rebuilt bundle (`npm run build`). |

`docs/patterns.md` and `docs/architecture.md` are not canon-managed, so they have no `templates/` mirror; do not create one.

### Interaction Dependencies

- `canon watch`: a parked phase is `blocked`, which watch already reports as `auto_block` (exit `3`). The concurrent task `watch-crash-not-step-done` changes only the non-blocked idle branch, so the two compose.
- Bundles: `autoBlockPhase()` already takes `taskIds` and sets the named phase to `blocked` on every member, overwriting `done`. Decision 7 relies on exactly that overwrite: the catch (and the crashed-spec_review park) pass the full bundle `taskIds` and do not filter out completed members.
- `retryAgentForPhase()` runs inside `checkAndRoute()`. A failure there is parked for `currentPhase`, which is the phase being recovered.
- Signal shutdown: `streamProcess()` never resolves during shutdown (`isShuttingDown()`), so an operator SIGINT/SIGTERM still goes through `signals.ts` and is not turned into a park. Do not change that.
- `lastCodexExitStatus` and session storage stay as they are on the success path.

### Data Model Changes

None to the schema. A park writes the existing `phases.<phase>.status = 'blocked'`, `auto_block_count` and `escalations[]` shapes.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`: run the full suite. A check means the suite runs clean, not just that new tests were added.
- [x] `npm run build`
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`

## Docs Impact

`docs/patterns.md`, `docs/pipeline-orchestrator.md`, `docs/architecture.md` (edited, AC-11). `docs/decisions.md` §"Cold-Codex code-review lens: orchestrator-run, sequential, hard-fail (2026-06)" stays true (the lens still hard-fails, and now parks durably); QA should confirm. `docs/codebase-map.md` may want a line for the new `agents/errors.ts`.

## Known Risks

- **Swallowing real bugs as parks.** Catching too broadly would turn programming errors into "agent failed" parks. Mitigation: catch only `AgentSessionError` (AC-9), and rethrow everything else.
- **Partial output treated as success.** Covered by throwing rather than returning (AC-6). Any caller that catches `AgentSessionError` locally would reopen this. No phase runner may catch it.
- **A blocked phase that a plain re-run does not re-enter.** Review phases have loop-cap entry checks, and `checkAndRoute()` has special handling for a reviewer-set `code_review: blocked` (`stopForReviewerBlock()`). A crash-parked `code_review` must re-run rather than hit the reviewer-block banner. AC-5 covers `plan`; the implementer must check `code_review` and `spec_review` re-entry too, and add a test if the code path differs.
- **`auto_block_count` inflation.** Each crash park increments the lifetime counter, which the quality log reads. Acceptable: a crash is a real stop.
- **Bundle reopen redoes completed work (accepted).** Under Decision 7 a member that completed the phase before the failure runs it again on re-run: one extra session's worth of work for that member, and for a review phase a fresh verdict that may differ from the discarded one. A reopened review member also keeps the counters its first verdict wrote, so a `changes_requested` recorded before the crash plus a `changes_requested` on the re-run counts two rounds toward the loop cap. Accepted as a named quirk: the crash is a real stop, and the operator can see both rounds in `spec-review.md` / `review.md`. Not fixed here.
- **A future agent call after routing would break the safety argument.** Decision 7 holds only while no agent session runs after `checkAndRoute()`'s routing writes. If one is added later, a park could reopen `<currentPhase>` on a member that routing had already moved elsewhere. AC-13's test is the tripwire for the current shape; the patterns.md entry (AC-11) states the constraint.

## Human Test Plan

1. On a scratch task, start a full-auto run and break the planning agent partway (for example by signing it out).
2. Expected: the run stops with a clear message naming the phase, the agent failure and the command to resume. The task shows as blocked (not stuck "in progress"), and the watcher reports a blocked stop rather than a crash or a normal step.
3. Sign the agent back in and start the run again with the same command.
4. Expected: the run resumes the same phase and carries on with no manual status edits.

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
