# Code Review: implement-done-evidence-guard

> Reviewer: Claude | Spec: `tasks/implement-done-evidence-guard/spec.md`
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
| AC-1: stale `implement: done` + empty handoff → does not advance, recovery runs, exits 2 on failure, phase reverts to `in_progress`, sessions preserved, evidence failure logged with resume pointer | Met | `checkAndRoute` gates the stale-done at `main.ts:2761-2772`; reverts via `taskPhase`; `recoverPhaseForTask` is entered. Test at line 3501 asserts exit 2, "Retry completed but handoff evidence is still missing/invalid", absence of "Retry succeeded", `implement.status === 'in_progress'`, `sessions.codex === 'resume-1234567890'`. |
| AC-2: fresh `canon run <id>` invocation (no Codex exit in that process) sees the same stale-done behavior | Met | Same test spawns a fresh `node` subprocess against pre-seeded stale state — no Codex exit in that process. The stale-done gate fires identically. |
| AC-3: valid handoff evidence honored, healthy path unchanged | Met | Test at line 3594 seeds `implement: done` with valid handoff, asserts exit 0, no Retry log (`doesNotMatch /Retry/`), phase stays `done`. |
| AC-4: retry ends with `done` but evidence still bad → no "Retry succeeded", phase reverts to `in_progress`, exits 2 | Met | `recoverPhaseForTask:2729-2735` rechecks `checkImplementEvidence` after retry `'done'`; test at line 3501 asserts "Retry completed but handoff evidence is still missing/invalid" and `doesNotMatch /Retry succeeded/`. |
| AC-5: retry ends with `done` + valid evidence → "Retry succeeded" logged, pipeline proceeds | Met | Test at line 3652 seeds stale-done, fake codex writes valid handoff on retry, asserts "Retry succeeded — 'task-a' implement is now done." |
| AC-6: evidence gate exists once in `checkImplementEvidence`, shared by `tryEvidenceAdvance` and both new call sites | Met | `checkImplementEvidence` defined once at `main.ts:2502-2561`; called from `tryEvidenceAdvance:2566`, `checkAndRoute:2762`, and `recoverPhaseForTask:2730`. |

### Dropped Sections Check

- [x] Non-goals respected — no new gates on other phases, auto-commit gates untouched, no retry-count changes.
- [x] Known Risks addressed — false-revert risk mitigated by reusing exact `tryEvidenceAdvance` gates; worktree-aware path via `taskDirFor` confirmed in `checkImplementEvidence:2523-2532`; gate is local file read only (no network or git calls).
- [x] Human Test Plan satisfiable — the stale-done scenario is exercised deterministically by the test suite; the three steps map to the implemented recovery flow.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, focused implementation. `checkImplementEvidence` is a well-scoped extraction that correctly reuses all four gates from the original `tryEvidenceAdvance` including the gitignore exemption logic and worktree-aware root resolution. The stale-done gate in `checkAndRoute` and the post-retry recheck in `recoverPhaseForTask` slot neatly into the existing recovery flow. Session preservation is verified to work through both the direct revert and the retry-revert paths. No behavioral changes on the healthy path.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- `optional cleanup/nit` (cold lens): `tests/run-task-safety.test.ts:3510` — `writeImplementEvidenceFixture(tasksRoot, 'task-a', ['package.json'])` is called and immediately overwritten by `writeImplementEvidenceFixture(tasksRoot, taskId, [])` at line 3540. The first call is dead code; the test's intent (start with an empty handoff) is correctly achieved by the second. Could confuse future test readers. Same dead-call pattern appears at line 3661/3706.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- `Dismissed (cold)`: bundle loop `statuses[i]` stale after stale-done recovery — the `continue` at line 2772 skips all downstream loop code for that iteration, and the final `statuses = taskIds.map(splitState.readStatus)` re-read at line 2789 corrects state before any verdict/iteration checks. No consumer of stale `statuses[i]` exists between lines 2766 and 2789 on the recovery path.
- `Dismissed (cold)`: non-implement phases have no post-retry artifact recheck — spec Non-Goals explicitly limit this change to `implement`; other phases are out of scope.
- `Dismissed (cold)`: `taskPhase` rollback under an already-`done` field — `taskPhase` uses the canonical state writer which rederives the top-level `status` pointer; no precondition prevents a `done → in_progress` write. Confirmed correct by test assertion at line 3589.

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
