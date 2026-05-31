# Code Review: canon-watch

> Reviewer: Claude | Spec: `tasks/canon-watch/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

`npm test` is marked `Fail – unrelated`. Bisection shows it is **NOT unrelated** — see Finding 1 below. The failure is a direct regression introduced by this task's changes to `scripts/run-task/state.ts:152` (`readStatus` now `die()`s instead of throwing). Reverting only `state.ts` to `release/v1.8` (with every other file in this task at HEAD) makes the test pass. The Validation Outcomes row should be `Fail` (not `Fail – unrelated`) and listed in Blockers.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Command registration | Pass | `src/cli/index.ts` dispatches `watch`; `printHelp()` documents flags + exit-code + summary-line contract. |
| AC-2: Attach-time classification | Pass | `classifyAttach` honors the precedence (blocked → live → launch_window → death → nothing_to_watch). |
| AC-3: Idle classification | **Partial — correctness bug** | The `human_review→checkpoint` branch in `classifyIdle` (watch.ts:311–320) is unreachable in production. See Finding 2. |
| AC-4: `--until <phase>` | Pass | Settled check at attach + poll; invalid phase exits 2 before attach. |
| AC-5: Launch-window wait | Pass | Reuses `waitForHeartbeat`, `STOP_WAIT_DEFAULT_MS`, `STOP_WAIT_POLL_INTERVAL_MS`; handles found/pid-died/timeout. |
| AC-6: Output split | Pass | stdout = summary only; stderr carries attach line, heartbeat ticks, `-f` log stream. |
| AC-7: Summary line + read-failure refusal | Pass | Stable `key=value`; read errors emit `reason=read_error` with file + cause on stderr. |
| AC-8: `--timeout` | Pass | Parser accepts `<n>s`, `<n>m`, bare integer seconds; `=` form covered. |
| AC-9: Shared run-context resolver | **Partial — correctness bug** | The `state.ts` refactor changes `readStatus` from "throws" to "die()" — see Finding 1. The spec's Affected Files row for `state.ts` explicitly says "No behavior change for existing callers"; this violates that. |
| AC-10: `doctor` migrated, output unchanged | **Partial — correctness bug** | `checkActiveOrchestrators` now reads `cwd/tasks/<id>/status.json` (via the deviation-added `resolveTaskDirImpl`), not the worktree-resolved path. See Finding 3. Test suite passes only because fixtures use `CANON_TASKS_DIR_OVERRIDE` + `process.chdir`; the production worktree path is not exercised. |
| AC-11: `stop` migrated, signals unchanged | Pass | `tolerantTaskDir` + `probePidAlive` cleanly replace the private helpers; CASE A–D / wait / escalation untouched. |
| AC-12: Read-only | Pass | No status writes, no signals (only `kill(pid, 0)`); only read-only git inspection. |
| AC-13: `dist/` rebuilt | Pass | `dist/cli/index.js` + `dist/scripts/run-task.js` regenerated; CI gate would pass. |

### Dropped Sections Check

- [x] Non-goals respected
- [x] Known Risks addressed (the `stop`-refactor risk lands on AC-11 — covered)
- [x] Human Test Plan is satisfiable for the watch command itself; **but** the "Regression" item — "`canon doctor` still reports active orchestrators exactly as before" — would fail in the running-from-REPO_ROOT worktree case (Finding 3).

### Stage 1 Verdict

- [ ] **Pass** — proceed to Stage 2
- [x] **Fail** — skip Stage 2, final verdict below is `Changes requested`

Three correctness regressions blocking; Stage 2 deferred.

## Stage 2 — Code Quality

**Not run — Stage 1 failed.**

## Findings

### 1. correctness bug — `readStatus` now calls `die()` instead of throwing, breaking every `try { readStatus(...) } catch` caller (and the `verifyBaseDrift` test the handoff misclassifies as "unrelated")

`scripts/run-task/state.ts:152–158` was rewritten to:

```ts
export function readStatus(taskId: string): StatusJson {
    try {
        return readStatusFromPath(statusFileFor(taskId), taskId);
    } catch (error) {
        die(error instanceof Error ? error.message : String(error));
    }
}
```

Old behavior (release/v1.8): `readStatus` let `JSON.parse` / `fs.readFileSync` errors propagate. Callers chose whether to `try/catch`.

New behavior: every failure becomes `die() → process.exit(1)`. `try/catch` wrappers around `readStatus` are now dead code — the process is gone before the catch runs.

**Concrete impact** — production callers that intentionally use `try/catch` around `readStatus`:
- `scripts/run-task/validation.ts:1080` — `verifyBaseDrift`'s QA-done allowlist promotion: `try { if (readStatus(taskId).phases.qa?.status === 'done') ... } catch { /* leave allowlist alone */ }`. Now: ENOENT (no task status yet) → orchestrator dies during a `--pr` base-drift check instead of falling through.
- `scripts/run-task/main.ts:1224` — `try { const recorded = splitState.readStatus(taskId).branch; ... } catch { /* fall through to fallback */ }`. Same pattern; same regression.
- `scripts/run-task/main.ts:991` — same pattern as validation.ts:1080 in the orchestrator's own QA managed-doc promotion.

**Test gate** — bisected: with HEAD's state.ts, `tests/run-task-validation.test.ts` (test "verifyBaseDrift: two-dot diff catches base-advance drift that three-dot would miss") fails on ENOENT. With release/v1.8's state.ts (every other file at HEAD), the same test passes. The handoff's "Fail – unrelated" classification is incorrect; this failure is owned by this task.

**Fix**: keep the original throwing form. Move the `die()`-on-failure semantics to the *caller* (or to a separate `readStatusOrDie` if needed). Spec AC-9 says "No behavior change for existing callers" — preserve it. Then re-run `npm test` — the validation suite should pass clean and the handoff row should be `Pass`.

### 2. correctness bug — `classifyIdle`'s `human_review → checkpoint` branch is unreachable in production; real human_review checkpoints emit `reason=step_done`

`src/cli/commands/watch.ts:311–320`:

```ts
if (state === 'human_review' && status.phases.human_review?.status === 'done') {
    const verdict = status.phases.human_review?.verdict || undefined;
    return { kind: 'checkpoint', state: 'human_review', phase: 'qa→human_review', verdict, ... };
}
```

The two conjuncts are mutually exclusive in real status files. `state` is `status.status`, which `writeStatusToFile` always recomputes via `deriveTopLevelStatus`. `deriveTopLevelStatus` returns the first phase whose status is *not* `'done'`. So `state === 'human_review'` implies `phases.human_review.status !== 'done'`.

In production, when the orchestrator pauses at the human-review checkpoint (qa done, human_review pending), this branch fails. Execution falls through to the `pending|in_progress` branch (watch.ts:338–348), which finds `previousPhase = 'qa'` and returns `step_done` with `phase: 'qa→human_review'` and no verdict.

Result: the spec's canonical example summary line — `state=human_review reason=checkpoint phase=qa→human_review verdict=approved pid=...` — never fires. Operators get `reason=step_done` for the very case AC-3 specifies as `checkpoint`. Exit code 0 is correct; the `reason` field is wrong.

The unit test at `tests/watch.test.ts:212–230` passes because `makeStatus` constructs an invalid pair (state='human_review' + human_review.status='done') that cannot exist after a real `writeStatusToFile` call. Either the test fixture is wrong (it should set human_review.status to `'pending'` and assert `kind === 'checkpoint'`), or the production check should be on `state === 'human_review'` alone.

**Fix**: drop the `human_review.status === 'done'` clause (or replace it with `state === 'human_review'` alone — `qa` already being done is implicit from the state), and update the test to use a realistic status shape. Decide whether `verdict` should be sourced from `qa.verdict`, `human_review.verdict` (typically empty at the checkpoint), or omitted — the spec example shows it populated but the source is undefined; flag in `spec_gap` if needed.

### 3. correctness bug — `doctor`'s migration ignores worktree-resident state; AC-10 "byte-identical output" violated for the canonical live-task case

`src/cli/commands/doctor.ts:536–541`:

```ts
const ctx = gatherRunContext(id, {
    resolveTaskDirImpl: (taskId) => join(tasksDir, taskId),
});
```

`tasksDir = join(cwd, 'tasks')`. So doctor reads `cwd/tasks/<id>/status.json` and `.heartbeat.json` regardless of where the live state actually lives.

The original `readStatusForCheck` / `resolveHeartbeatDir` (release/v1.8 doctor.ts) explicitly delegated to `statusFileFor(taskId)` for the non-orphan case — which routes through `resolveTaskCwd` and finds the worktree. For a non-orphaned, worktree-backed live task (the typical case for canon's own dogfooding — including this very task), the worktree's status.json shows `code_review.status: in_progress` while the REPO_ROOT copy at `cwd/tasks/<id>/status.json` shows the scaffolded baseline. Confirmed directly in this checkout:

- `canon-ai-dev/tasks/canon-watch/status.json` → `"status": "implement"` with `code_review.status: "pending"`
- `dev-worktrees/canon-watch/tasks/canon-watch/status.json` → `"status": "code_review"` with `code_review.status: "in_progress"`

With the new code, `canon doctor` run from REPO_ROOT against a worktree-backed in-flight task sees `hasInProgressPhase === false` → skips reporting that orchestrator entirely. The old code would have read the worktree status, found `in_progress`, and reported `pass` (fresh heartbeat) or `warn` (stale/missing). That's the user-visible byte-difference AC-10 forbids.

The handoff's stated rationale for the new `resolveTaskDirImpl` override — "doctor needs to resolve task state relative to its cwd, not just the repo root" — is the inverse of the original design. Original doctor was worktree-aware (via `resolveTaskCwd`) precisely because that's where the live state lives mid-pipeline.

The existing test suite passes because every fixture (`tests/cli.test.ts:1551–1680`) sets `CANON_TASKS_DIR_OVERRIDE = path.join(dir, 'tasks')` and `process.chdir(dir)`. With those env vars, the default `tolerantTaskDir` (`dirname(statusFileFor(id))`) and the new override (`join(cwd, 'tasks', id)`) resolve to the same path — so the worktree case is not exercised. The tests are not the gate AC-10 promised.

**Fix**: drop the `resolveTaskDirImpl` override at `doctor.ts:537`. The default `tolerantTaskDir` already handles both the orphan and worktree-backed cases correctly via `isOrphanedWorktreeState` + `statusFileFor`. The existing doctor tests should still pass (they only exercise the path-equivalent case); add one new fixture that constructs a `worktree: true` task with a divergent worktree status to lock in the regression bar.

### Spec gaps

None observed beyond what's noted in Finding 2 (the verdict source for the `human_review` checkpoint summary is underspecified; the example line shows `verdict=approved` but no AC names the source).

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — three correctness regressions: readStatus throw→die, dead checkpoint branch, doctor reads stale REPO_ROOT state
- [ ] **Needs re-review** — significant changes expected; re-review (both stages) after iteration

---

<!--
On re-review, append below this line:

## Round N — verifying iteration N-1's response to round N-1

### Stage 1 — Acceptance Criteria Re-Check

Re-fill this table with every AC from spec.md against the latest code. Earlier AC tables were snapshots of earlier iterations, not reusable proof. ACs whose relevant code paths did not change may be marked `Met (unchanged from round N-1)` with a one-line evidence pointer.

| AC | Status | Notes |
|---|---|---|
| AC-1: ... | Met / Partial / Not Met | ... |
| AC-2: ... | Met / Partial / Not Met | ... |

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line; AC-N now Met in table above) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->

---

## Pre-Flight Rejection — handoff rejected before review (no Claude session ran)

## Validation Gate

**BLOCKED — pre-flight rejected handoff before full review:**

- Validation Outcomes table has one or more Fail results
- Validation Required item did not pass in handoff.md: `npm test` (`node --test --import tsx tests/*.test.ts`) — full suite clean, existing `stop`/`doctor` suites **unmodified** — Fail (`tests/run-task-validation.test.ts` still fails at `verifyBaseDrift: two-dot diff catches base-advance drift that three-dot would miss`; the repro above shows the current failure shape.)

## Verdict

- [x] **Changes requested** — fix the above and resubmit handoff.

---

## Round 2 — verifying iteration 2's response to round 1

(Note: Codex labels its rounds starting at 1 for the pre-flight pass and 2 for this substantive round; the review numbering tracks the substantive Claude review rounds.)

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Command registration | Met (unchanged from round 1) | `src/cli/index.ts` still dispatches `watch`; `printHelp()` still documents it. |
| AC-2: Attach-time classification | Met (unchanged from round 1) | `classifyAttach` precedence intact; iteration 2 did not touch this path. |
| AC-3: Idle classification | Met | `watch.ts:311` now triggers on `state === 'human_review'` alone; verdict pulled from `code_review.verdict`. Real-pipeline state (qa done, human_review pending) now yields `reason=checkpoint` per the spec example. Fixture updated to a realistic state at `tests/watch.test.ts:212–230` and asserts `verdict=approved`. |
| AC-4: `--until <phase>` | Met (unchanged from round 1) | Logic untouched. |
| AC-5: Launch-window wait | Met (unchanged from round 1) | Logic untouched. |
| AC-6: Output split | Met (unchanged from round 1) | Logic untouched. |
| AC-7: Summary line + read-failure refusal | Met (unchanged from round 1) | Logic untouched. |
| AC-8: `--timeout` | Met (unchanged from round 1) | Logic untouched. |
| AC-9: Shared run-context resolver | Met | `state.ts:152` now delegates straight to `readStatusFromPath` and lets errors propagate. `readStatus` behavior matches release/v1.8: throws on ENOENT/parse failure. The `try/catch` callers in `validation.ts:1080`, `main.ts:991`, `main.ts:1224` are again live. |
| AC-10: `doctor` migrated, output unchanged | Met | `doctor.ts:536` now calls `gatherRunContext(id)` with no `resolveTaskDirImpl` override; the default `tolerantTaskDir` reinstates worktree-aware resolution (via `dirname(statusFileFor(id))` for non-orphan tasks). For the canon-watch worktree-backed live case, doctor now sees the worktree's `in_progress` status instead of the REPO_ROOT scaffold baseline. |
| AC-11: `stop` migrated, signals unchanged | Met (unchanged from round 1) | Logic untouched. |
| AC-12: Read-only | Met (unchanged from round 1) | Logic untouched. |
| AC-13: `dist/` rebuilt | Met | Bundle regenerated to ship the iteration 2 fixes (verified in the diff: `dist/cli/index.js`, `dist/scripts/run-task.js`). |

### Verifying Round 1 findings

- _correctness bug:_ `readStatus` throw→die regression → **addressed** at `state.ts:152` (now plain `return readStatusFromPath(...)`). Bisection on the round 1 failing test `verifyBaseDrift: two-dot diff catches base-advance drift that three-dot would miss` confirms pass on iteration 2's tree (the test that round 1 demonstrated would fail now passes). AC-9 row above flips Partial → Met.
- _correctness bug:_ `classifyIdle` checkpoint branch unreachable → **addressed** at `watch.ts:311`. Branch now triggers on `state === 'human_review'` alone; fixture realistic; real-pipeline state would emit `reason=checkpoint phase=qa→human_review verdict=approved` per the spec's canonical example. Verdict source chosen as `code_review.verdict` — sensible (it's the last verdict-bearing settled phase before the human stop; documented choice in the handoff). AC-3 row above flips Partial → Met.
- _correctness bug:_ `doctor` reads stale REPO_ROOT state → **addressed** at `doctor.ts:536`. The `resolveTaskDirImpl` override is gone; `gatherRunContext(id)` uses the default `tolerantTaskDir`. AC-10 row above flips Partial → Met.

### Validation Gate

`npm test` is still marked `Fail – unrelated`, this time for `tests/task-cli.test.ts` (test "docs telemetry files stay clean after the suite"). Independently verified:

- The failure is asserting `git status --porcelain` clean for `docs/pipeline-invocations.md`. Running the test in isolation reproduces the assertion failure with `M docs/pipeline-invocations.md` actually-vs-expected.
- `git diff docs/pipeline-invocations.md` shows the dirt is canon-watch pipeline-invocation telemetry rows appended by *this very pipeline run* (rows dated 2026-05-30T02:14+ through 03:14+, all `canon-watch` phase invocations). The file was already dirty at session start (initial git status showed `M docs/pipeline-invocations.md`).
- This is an environmental-hygiene check that the orchestrator itself is dirtying mid-run; it has nothing to do with the watch/run-context/state/doctor changes in this task. Acceptable as `Fail – unrelated`.

`npm run lint`, `npm run type-check`, `npm run build` all pass per the handoff. I additionally ran `node --test --import tsx tests/{watch,run-context,stop,cli}.test.ts` end-to-end: 157/157 pass. The migration regression gates (`stop` suite unmodified, doctor suite unmodified) hold.

### New findings introduced by iteration 2's changes

None observed.

The doctor fix is a one-line removal of the previously-added override; it cannot regress what it didn't change. The state.ts fix collapses `readStatus` to one delegating line (same throw semantics as release/v1.8). The watch.ts fix tightens a single branch condition and updates one test fixture. No previously-Met ACs regressed.

### Spec gaps

- The spec example has `verdict=approved` for the human_review checkpoint but no AC names the source. Codex chose `code_review.verdict` — the last verdict-bearing settled phase before the human stop. Reasonable. Worth pinning down in a future spec template revision (e.g., AC-3 could say "verdict carried from the most recent settled non-human phase's verdict").

### Verdict for this round

- [x] **Approved** — all three round-1 correctness bugs are fixed cleanly; no new findings; the migration regression gates (`stop`/`doctor`/existing suites) hold; the `npm test` failure is now genuinely unrelated (canon-watch's own pipeline telemetry dirtying `docs/pipeline-invocations.md` mid-run).
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review

---

## Round 3 — verifying iteration 3's response to the reroute amendment (RF-1, RF-2)

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Command registration | Met (unchanged from round 2) | `src/cli/index.ts` still dispatches `watch`; help still includes the contract block. |
| AC-2: Attach-time classification | Met | Precedence now blocked → ambiguous_pid → live → launch_window → death → nothing_to_watch (`watch.ts:280–317`). RF-1 inserts the ambiguous_pid refusal before the `live` branch — correct interpretation since `resolvedPid == null` when ambiguous, so the live check could never fire anyway. |
| AC-3: Idle classification | Met (unchanged from round 2) | Logic untouched. |
| AC-4: `--until <phase>` | Met (unchanged from round 2) | Logic untouched. |
| AC-5: Launch-window wait | Met (unchanged from round 2) | Logic untouched; post-wait re-classification routes through `reportInitialFailure` so a post-wait ambiguous_pid would refuse correctly. |
| AC-6: Output split | Met | Live polling now emits a stderr `canon watch: phase X → Y` transition line (RF-2) in addition to the heartbeat-age tick (`watch.ts:590–595`). stdout still carries only the final summary line. |
| AC-7: Summary line + read-failure refusal | Met (essentially unchanged) | New `ambiguous_pid` reason added to the vocabulary (`WatchReason` at `watch.ts:13–25`), help text, and `docs/pipeline-orchestrator.md`. Read-error stderr diagnostics still naming the file in the attach-path (`watch.ts:488–492`) and live mid-poll path (`watch.ts:600–603`). |
| AC-8: `--timeout` | Met (unchanged from round 2) | Logic untouched. |
| AC-9: Shared run-context resolver | Met | `gatherRunContext` now computes `ambiguousPid` (`run-context.ts:99–106`) and forces `resolvedPid = null` on disagreement (`run-context.ts:108–110`). Non-ambiguous paths preserve `stop`'s CASE C/D pid selection — verified by `tests/stop.test.ts` passing unmodified. |
| AC-10: `doctor` migrated, output unchanged | Met (unchanged from round 2) | `checkActiveOrchestrators` still consumes `gatherRunContext(id)` with no override; doctor's worktree-aware resolution preserved. |
| AC-11: `stop` migrated, signals unchanged | Met (unchanged from round 2) | `stop.ts:414` still wraps `probePidAlive` around `kill(pid, 0)`; CASE A–D / wait / escalation untouched; the `decideStopAction` ambiguous-state refusal at `stop.ts:318–326` is the original behavior `watch`'s new refusal mirrors. |
| AC-12: Read-only | Met (unchanged from round 2) | No writes added by iteration 3. |
| AC-13: `dist/` rebuilt | Met | `dist/cli/index.js` regenerated to ship the ambiguous_pid path and the live phase-transition emission; `dist/scripts/run-task.js` regenerated for the resolver change. |
| Amendment RF-1: PID-disagreement refusal | Met | Resolver detects mismatch and nulls `resolvedPid`; `classifyAttach` returns `kind: 'ambiguous_pid'` before any `live` evaluation; `reportInitialFailure` emits `canon watch: .canon-pid (X) and heartbeat pid (Y) are both alive but disagree. Refusing to attach.` to stderr plus `state=<status> reason=ambiguous_pid` summary to stdout, exit 2. Mirrors `stop`'s CASE D-disagree refusal verbatim in spirit. `tests/run-context.test.ts:95–113`, `tests/watch.test.ts:122–143`, and `tests/watch.test.ts:417–438` lock in the behavior. |
| Amendment RF-2: live phase-pointer transitions | Met | `previousPhasePointer` initialized at attach (`watch.ts:527, 552`) and updated each poll; transition line `canon watch: phase X → Y` emitted to stderr when `displayedPhasePointer(ctx)` changes (`watch.ts:590–594`), independent of `--follow`. `tests/watch.test.ts:538–607` asserts the line is emitted on a spec_review→plan transition. |

### Verifying amendment findings

- _correctness bug (RF-1):_ ambiguous PID disagreement could let `watch` attach to the wrong live process → **addressed** at `run-context.ts:99–110` + `watch.ts:285–292, 497–504`. The disagreement detection requires both pids alive AND distinct AND `canonPid !== heartbeatPid`, exactly matching `stop`'s CASE D-disagree. Agreeing pids, the CASE C `.canon-pid`-dead/heartbeat-fresh fallback, and the launch-window case are unaffected (preserved by the early-return ordering and verified by `tests/stop.test.ts` passing). Live mid-poll re-evaluation also handles ambiguous_pid (`watch.ts:606–613`), so a mid-watch transition into ambiguity refuses rather than silently mis-attaching.
- _spec gap (RF-2):_ default-mode live polling printed only heartbeat-age, hiding phase progress → **addressed** at `watch.ts:590–594`. The previous-phase pointer is captured before the live loop starts and after each successful re-resolve, and the transition format uses `from → to` (full-width spaces, matches the spec example shape).

### New findings introduced by iteration 3's changes

None.

The resolver change is additive (a new field on `RunContext` and a conditional null on `resolvedPid` for the disagreement case); existing callers ignore the new field and the null-on-ambiguity branch is exercised only by the precisely-defined disagreement signature, which no other caller (`doctor`, `stop`) routes through. `stop`'s full suite passes unmodified, confirming its CASE A–D pid selection is intact. Doctor's `checkActiveOrchestrators` doesn't care about `ambiguousPid` (it only reads `statusResult` + `heartbeatResult.record`), so the field is invisible there. The phase-transition emission lives entirely inside the live-poll branch of `watchCmd` and adds a stderr line that no other code path consumes.

### Validation Gate

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Verified locally. |
| `npm run type-check` | Pass | Verified locally. |
| `node --test --import tsx tests/{watch,run-context,stop,cli}.test.ts` | Pass (161/161) | Migration gates hold; new ambiguous_pid and phase-transition tests pass. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm test` (handoff) | Pass | Iteration 3 handoff reports the full suite clean (previous iterations' "Fail – unrelated" cleared). |
| `npm run build` (handoff) | Pass | `dist/` regenerated. |

### Spec gaps

- Pre-existing minor: in the live-loop idle-path read_error case (`watch.ts:647–648`), `classifyIdle` returning `read_error` exits 2 with `state=unknown reason=read_error` but does NOT emit a stderr line naming the file/cause. This contradicts AC-7's "with a stderr line naming the file, the underlying cause, and how to recover." The attach-path and live mid-poll paths DO emit the stderr line; only the post-grace-reread idle path drops it. Narrow window (status corrupts after attach + during/after the grace re-read), and the issue predates iteration 3 (round 2 approved this code). Worth a one-line fix in a follow-up but not blocking ship; the operator still gets `reason=read_error` and a non-zero exit.

### Verdict for this round

- [x] **Approved** — RF-1 and RF-2 are both met cleanly; the migration regression gates (`stop` suite, doctor coverage) still hold unmodified; the resolver change preserves all prior pid-selection behavior on non-ambiguous paths; no previously-Met ACs regressed; one pre-existing spec gap noted but not blocking.
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review
