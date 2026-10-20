# Code Review: watch-crash-not-step-done

> Reviewer: Claude | Spec: `tasks/watch-crash-not-step-done/spec.md`

Code review is synthesized by a foreman from three lenses: an anchored Claude lens (Stage 1 / Stage 2 charter), a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [ ] Validation Outcomes table has no `Fail` results — one `Fail`: `npm test`, `tests/run-task-signals.test.ts:314` (marked unrelated; the anchored lens ran it alone and it passed 9/9, so it looks load-flaky; I did not rerun the full suite)
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | Fresh non-zero marker → `death` with reason; red-first recorded in handoff |
| AC-2 | Pass | Dead resolved pid → `death`; live pid → `step_done` |
| AC-3 | Pass | Existing clean-step test unchanged |
| AC-4 | Pass | `code=0` marker stays `step_done` (own test) |
| AC-5 | Pass | Stale marker (20s older) stays `step_done` |
| AC-6 | Pass | Parser: last marker wins, truncated tail ignored, no marker → null, absent log, signal codes |
| AC-7 | Pass | `watchCmd` exits 4, stdout exactly `state=plan reason=death` |
| AC-8 | Pass | One stderr diagnostic with reason + resume hint; SIGTERM case covered |
| AC-9 | Pass | Docs rows and stderr sentence updated; mirror identical |
| AC-10 | Partial | Only failure is the unrelated `run-task-signals` test (see gate) |
| AC-11 | Partial | `dist/cli/index.js` rebuilt and matches source; the `git diff --exit-code -- dist/` freshness check must run after the pipeline-owned commit |
| AC-12′ | Pass | Regex unanchored with timestamp-at-end-of-line; unterminated-prefix, truncated-tail and boundary tests present |

### Dropped Sections Check

- [x] Non-goals respected (`classifyAttach`, `changes_requested` branch, writer untouched)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail**

## Stage 2 — Code Quality

### Summary

The change is small and matches the amended spec. The dead-pid and fresh-marker checks gate only the pending/in_progress-after-done branch. Marker parsing is one bounded-tail helper. The summary line is unchanged and the reason goes to stderr. Tests assert the intended outcomes, including the tolerance boundary. The one surviving finding is a coverage gap in a path the spec excludes.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none blocking)

#### Optional Cleanup / Nit

- `src/cli/commands/watch.ts` (idle branch): non-zero marker is ignored if something rewrote `status.json` after the crash (e.g. `canon task accept`). Already accepted in Known Risks. (anchored)
- The two trailing `death` returns in `classifyIdle` are identical (pre-existing). (anchored)

#### Spec Gaps

- **spec-gap — `classifyAttach` misses a persisted crash (flagged by cold-Codex; verified).** `src/cli/commands/watch.ts:375-379`, `classifyAttach`. If `canon watch` first starts after the orchestrator exited, with the current phase `pending` after a `done` phase, `classifyAttach` returns `nothing_to_watch` (exit 2). The exit marker is never consulted, so the crash is not reported as `death` (exit 4). `in_progress` already maps to `death` there. Severity: low-medium. It is not a false-healthy report, but the fix only works when watch was attached before the exit. The implementation matches the spec: the Non-Goals state "Not changing `classifyAttach()`". Resolving it requires the spec to decide whether the attach path should consult the marker and dead-pid evidence, which also touches AC-3 and the late-start story. Human or spec decision needed, not an implement-phase fix.

### Dismissed Cold Findings

- Dismissed (cold-Claude): crash-marker check fires when the orchestrator pid is alive (stale marker after relaunch) - `classifyIdle` is reached only after `orchestratorStillProgressing()` returns false. With a live pid and a non-null status, that is true except in `human_review`/`complete`/untrusted-blocked, none of which reach the pending/in_progress branch. Unreachable in the watch loop.
- Dismissed (cold-Claude): `changes_requested` / `human_review` / `complete` branches don't consult the marker - the spec explicitly excludes the `changes_requested` branch (a settled reviewer verdict is a real stop); the other two are checkpoint/complete states, not crash-shaped.
- Dismissed (cold-Claude): signal marker (`canon stop`, Ctrl-C) reported as death - spec-intended with explicit evidence: the Decision section says non-zero includes `signal:<NAME>` and AC-8 requires the SIGTERM case to exit 4 with the reason. A resume hint is appropriate for a run stopped mid-phase.
- Dismissed (cold-Claude): marker missed if more than 64 KiB, or any output, follows it - the writer emits the marker last in `process.on('exit')`. The spec's Known Risks prescribes the 64 KiB tail. Low confidence, no concrete failure.
- Dismissed (cold-Claude): wall-clock vs mtime fragility - spec Known Risks accepts this and sets a one-second tolerance biased toward reporting a crash. The boundary is tested.
- Dismissed (cold-Claude): dead-pid shortcut depends on every clean exit removing the runtime files - the spec's Problem section traces `process.on('exit')` cleanup for every `process.exit` path. The cold lens did not verify the claim and has no concrete counterexample.
- Dismissed (cold-Claude): test-integrity concern over real `utimesSync`/`Date.now()` timing - the tests use explicit whole-second values and fixed offsets (10s, 20s, ±1s boundary); no sleeps or races. The missing live-pid + fresh-marker test covers an unreachable path (first dismissal).

## Final Verdict

- [ ] **Approved**
- [ ] **Approved with nits**
- [ ] **Changes requested**
- [x] **Spec gap** - the implementation matches the spec; the one surviving finding (late-start watch via `classifyAttach`) needs a spec decision

---
