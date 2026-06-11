# Code Review: orchestrator-exit-logging

> Reviewer: Claude | Spec: `tasks/orchestrator-exit-logging/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from two review lenses: an anchored lens that applies the Stage 1 / Stage 2 charter below, and a cold lens that reads only the diff. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results — all five required checks (lint, type-check, unit tests, build, sync-templates:check) recorded Pass.
- [x] All checks required by the spec's "Validation Required" section were run.
- [x] No required checks were skipped without justification.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: successful single-phase run's log ends with marker containing `code=0` and ISO timestamp | Met | Test "main writes one exit marker with code=0 and an ISO timestamp on a successful single-phase run" asserts `markers.length === 1`, `code=0`, and timestamp regex `\d{4}-\d{2}-\d{2}T…Z`. |
| AC-2: Claude non-zero exits produce a marker with named reason; Codex spawn/stall/signal produce named reasons; Codex non-zero exit by itself does NOT exit the process | Met | Agent ladder test covers all four Claude paths (spawn error, stall, non-zero exit, signal) and four Codex paths (spawn error, stall, signal; non-zero exit confirmed not to exit — `codexNoExitResult.status === 0`, `stdout` contains "after-runCodex"). |
| AC-3: `die()` exits produce a marker whose reason contains the die message, including parse/dependency die paths | Met | Test "main die exits write a marker whose reason contains the die message" exercises an invalid task ID through `main()` (which calls `registerExitHandlers()` first, then `parseArgs` → `validateTaskId` → `die()`). Asserts exit 1, one marker, reason contains "Invalid task ID 'BadID'". |
| AC-4: uncaught exception and unhandled rejection each produce a marker + error stack, process exits 1 | Met | Crash-fixture test asserts exit 1, one marker with `code=1`, error message, and stack (`at .*:` pattern) for both cases. |
| AC-5: marker survives `process.exit` invoked from any depth — synchronous write | Met | Marker write uses `fs.writeSync(2, ...)` in the `process.on('exit', ...)` handler (`cli.ts:21`). AC-1/3/4 tests exercise `process.exit` from various call depths and all observe the marker. |
| AC-6: exactly one marker line per process exit | Met | Crash handlers call `setExitReason` then `process.exit(1)`; the `exit` event fires once and the `exit` handler is registered once (`exitHandlersRegistered` guard). All tests assert `markers.length === 1`. |
| AC-7: existing exit codes unchanged; new crash handlers pin theirs (success 0, auto-block 2, agent non-zero passthrough, uncaughtException/unhandledRejection 1) | Met | Exit 0 verified by success test (line 3842); exit 1 by die test (line 3859) and crash-fixture test (lines 3971, 3986); exit 2 by stale-done test (line 3579); agent non-zero passthrough verified by `claudeResult.status === 1` (line 3883) and `codexNoExitResult.status === 0` (line 3920). Note: the exit-logging-specific test suite asserts marker content for `code=0` and `code=1` but not `code=2` — the code=2 marker is emitted correctly (exit hook fires on all exits) and the exit code itself is verified; this is a minor test-completeness gap noted in Stage 2. |

### Dropped Sections Check

- [x] Non-goals respected — no typed-failure refactor, no exit code changes, no new retry behavior, no SIGKILL coverage.
- [x] Known Risks addressed — synchronous `fs.writeSync` confirmed; double-fire prevented by `exitHandlersRegistered` guard + `exitReason` reset after write; no `setExitReason` calls on non-exiting paths confirmed by diff review.
- [x] Human Test Plan satisfiable — test suite covers all three scenarios (normal stop, agent failure, future forensic use).

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean additive logging layer. `registerExitHandlers()` registers exactly once, patches `process.exit` with a reason-fallback, and installs a synchronous `exit` handler plus crash handlers — all meeting the synchronous-write constraint. Placing the call at the very top of `main()` (before `parseArgs` and `checkDeps`) ensures early `die()` paths are covered. The `setExitReason` / `patchedProcessExit` pairing correctly implements "caller-supplied reason wins, fallback for bare exits." The deviation to keep state in `cli.ts` rather than a new module is sound given the existing import graph.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- `optional cleanup/nit` (both lenses, flagged by anchored as AC-7 gap): The exit-logging test suite asserts `code=0` and `code=1` marker content explicitly, but the auto-block / recovery-fail exits (`process.exit(2)` at `main.ts:2770`, `2782`, and phase auto-block sites) rely on the `patchedProcessExit` fallback which produces `reason=process.exit code=2`. The marker IS written on all these paths (AC-5 guarantees it), and the stale-done test independently verifies exit code 2. Adding an assertion like `assert.match(markers[0] ?? '', /code=2/)` to the stale-done test would close the small gap between what AC-7 asks for ("assert in tests for auto-block exit 2") and what the current exit-logging-specific tests provide.

- `optional cleanup/nit` (cold lens): `tests/run-task-safety.test.ts:3510` and `3661` — each contains a `writeImplementEvidenceFixture` call that is immediately overwritten by a second call on line 3540 / 3706 respectively. First call is dead code; intent is correctly achieved by the second. Noted in the `implement-done-evidence-guard` review as well.

- `optional cleanup/nit` (anchored lens): `cli.ts:150` — `--help` invocation sets `setExitReason('help requested')` before `process.exit(0)`. This produces a marker in the run log even for intentional help requests. In normal orchestrator operation `--help` is never run; in the rare case an operator does use it, the marker adds minor noise to the exit-marker signal. Could instead omit the `setExitReason` call on the `--help` path so the fallback `process.exit code=0` reason fires.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- `Dismissed (cold)`: phase auto-block files (`implement.ts`, `code-review.ts`, `spec-review.ts`) have no explicit `setExitReason` calls — documented deviation; `patchedProcessExit` fallback emits `process.exit code=2`; no AC requires a descriptive reason at these sites (AC-2 covers only agent ladder paths). Deviation rationale accepted.
- `Dismissed (cold)`: `exitReason` staleness risk — confirmed clean: every `setExitReason` call in the diff is immediately followed by `process.exit`. The `recoverPhaseForTask` path does not call `setExitReason` on any non-exiting branch. This matches the Known Risks mitigation ("reviewer should check no site sets a reason on a non-exiting path").
- `Dismissed (cold)`: module-level `exitHandlersRegistered` state and re-registration — tests use `runNodeInline` subprocess isolation; no shared module state across test cases. Non-issue in production (single invocation per process).
- `Dismissed (cold)`: "Retry succeeded" test coupling to real `package.json` at `REPO_ROOT` — `REPO_ROOT` is derived from the actual repo path; `package.json` is stable in a Node.js project. Not a fragility in practice.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Needs re-review** — significant changes expected; re-review (both stages) after iteration
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

---

<!--
On re-review, append below this line:

Heading rule for ANY append to this file: only real review rounds may use a
`## Round N` heading. The verdict parser scopes to the latest `## Round` body —
an administrative block (pre-flight rejection, halt note, audit stamp) headed
`## Round …` with no verdict checkbox makes the parser return no verdict and
breaks routing. Administrative appends use a non-Round heading (e.g.
`## Pre-Flight Rejection (round N)`) and omit the verdict checkbox entirely.

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
- [ ] Spec gap

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
