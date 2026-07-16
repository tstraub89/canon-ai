# Code Review: review-verdict-freshness-guard

> Reviewer: Claude | Spec: `tasks/review-verdict-freshness-guard/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

Handoff Validation Outcomes: lint / type-check / test (980: 979 pass, 1 expected env skip, 0 fail) / build (byte-stable, only declared bundle changed) / docs-refs-check / sync-templates:check all Pass. The anchored lens independently re-ran `npm run build` and confirmed `git diff --exit-code -- dist/` is clean (both `run-task.js` and `cli/index.js` byte-identical to committed) and the four new tests are green. AC-1's red-first claim was reproduced live: removing the park makes the regression fail `0 !== 2`.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: park + counters protected + no phantom advance (red-first) | Pass | `main.ts:3050-3055` parks (`process.exit(2)`) **before** `recoverPhaseForTask` at `:3056`. Test `run-task-safety.test.ts:4002` asserts exit 2, status stays `in_progress`, verdict `''`, and `iterations_current_loop`/`iterations_total`/`changes_requested_total` unchanged. Red-first reproduced. |
| AC-2: actionable park message | Pass | `main.ts:3051-3053` names the exit code, "no verdict was recorded this round", the recoverable causes (out-of-credits / auth / network / MCP crash), and the re-run instruction. Asserted at `run-task-safety.test.ts:4023-4031`; also asserts no retry line and no misleading completion note. |
| AC-3: benign done-phase + non-zero exit does NOT park | Pass | Park is nested inside the `phaseStatus !== 'done'` block (`main.ts:3046`). Test `:4054` seeds `done`/`approved_with_nits` + exit 1, asserts exit 0 and the "completed despite Codex exit status 1" note still prints. |
| AC-4: benign clean-exit skipped-bookkeeping still advances | Pass | Test `:4085` seeds `in_progress` + exit 0 + fresh `changes_requested`; asserts auto-advance, `verdict=changes_requested`, and all three counters +1 (matches `updateReviewCounters`). |
| AC-5: `spec_review`-only scope (no over-broadening) | Pass | Predicate `main.ts:2904` gated on `phase === 'spec_review' && codexExitStatus !== 0`. Test `:4135` structurally asserts true for `spec_review`/exit≠0, false for `spec_review`/exit 0 and for `code_review`/`plan`/`implement`/`qa`, plus a clean `code_review` recovery integration that behaves as today. |
| AC-6: recovery docs updated | Pass | `docs/pipeline-orchestrator.md:358` documents the park, fail-closed rationale, done/clean exceptions, and benign-sub-case tradeoff; `templates/docs/pipeline-orchestrator.md` mirror byte-identical (`sync-templates:check` clean). |
| AC-7: patterns pitfall | Pass | `docs/patterns.md:204` adds the "non-zero agent exit is not a completed review" pitfall naming `shouldParkCrashedReview()` and required placement before `recoverPhaseForTask()`. |
| AC-8: backlog cross-ref + deferred-freshness follow-up | Pass | `docs/BACKLOG.md:872` adds the shared "agent-failure ≠ phase success" cross-reference on Bug 2; `:875` records the deferred in-band per-invocation verdict-freshness item (tighten `extractCheckedVerdict` to a structural locator, then add per-invocation freshness). |
| AC-9: build determinism | Pass | Handoff reports byte-stable rebuild; anchored lens re-verified `git diff --exit-code -- dist/` clean. `dist/scripts/run-task.js` regenerated and declared; `dist/cli/index.js` unchanged (`validation.ts` untouched). Test-only `setLastCodexExitStatusForTest` is tree-shaken from the runtime bundle. |

### Dropped Sections Check

- [x] Non-goals respected — no in-band freshness attempted, no `extractCheckedVerdict`/`checkRerouteEvidence`/`updateReviewCounters` changes, no `code_review` park, no agent-wrapper `process.exit` refactor, no output-signature classifier, no retry/backoff.
- [x] Known Risks addressed — park precedes `recoverPhaseForTask` (AC-1); done+non-zero no-park (AC-3); scoped to `spec_review` (AC-5); the benign-sub-case regression is the human-confirmed tradeoff.
- [x] Human Test Plan satisfiable — the deterministic on-disk repro (stale `spec-review.md` + `status.json` + simulated non-zero exit) exercises exactly the outage flow.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, minimal, well-scoped hardening of a delicate orchestrator recovery path. The fix is purely additive and fail-closed: it inserts a park before the `taskPhase` → `updateReviewCounters` mutation chokepoint for one crash class and weakens no existing guard (`checkPhaseGate`, `checkRerouteEvidence`, `updateReviewCounters`, `tryEvidenceAdvance` all unchanged). The condition is a pure, unit-testable predicate; the behavioral tests drive the real `checkAndRoute` through isolated subprocesses (`runNodeInline`) so they exercise the actual exit-2 boundary and filesystem state without leaking the module-level exit status between tests. `dist/` and the `templates/` mirror are consistent with source. All three lenses (anchored Claude, cold Claude, cold Codex) independently returned an approve signal with no correctness or guardrail defects.

### Findings

#### Correctness Bugs

> Items that will cause incorrect behavior if shipped.

(none)

#### Risk / Guardrails

> Items that could cause problems under certain conditions or violate repo conventions.

(none)

#### Optional Cleanup / Nit

> Style, naming, or minor improvements. Not blocking.

- **Duplicate exit-status warning on a crashed `spec_review`** — `code-bug`? no; nit — `scripts/run-task/main.ts:3047-3053` (flagged by anchored + cold-Claude). For a crashed spec review both the pre-existing generic line (`:3048` "Codex exited with status N and 'spec_review' was not completed…") and the new park line (`:3051` "…did not complete — no verdict was recorded this round…") fire, so the operator sees the exit code twice. Purely cosmetic; the specific line adds the causes + re-run guidance the generic one lacks. Optional: suppress the generic line for the park case, or leave as-is (the generic line is shared cross-phase infrastructure and branching it only for the park adds a conditional). Non-blocking.

#### Spec Gaps

> Things Codex had to guess at because the spec was ambiguous, silent, or wrong.

(none — see the "forced 0" note under Dismissed, which is a spec-prose accuracy observation with no code impact, not an implementer-facing gap.)

### Dismissed Cold Findings

> Cold-lens findings dropped after verification. Verified cold findings are not dismissed merely for being off-AC.

- **Dismissed (cold-Claude): clean-exit-but-incomplete `spec_review` (exit 0, not `done`, stale verdict) is not parked** — This is the residual case the spec explicitly defers as a **Non-Goal** ("In-band per-invocation verdict freshness is explicitly deferred") and records in `docs/BACKLOG.md` ("Deferred: in-band per-invocation `spec_review` verdict freshness"). Spec-intended by explicit evidence; the guard keying on non-zero exit is by design.
- **Dismissed (cold-Claude): `process.exit(2)` fires mid per-task loop, so a completed earlier bundle member (index < i) may not be routed this run** — Spec-intended per the Design "Bundle mode" section: the park uses the same whole-run halt as the existing "Stopping for human review" path; completed siblings keep their state on disk and are re-evaluated idempotently on the next `canon run` (`checkAndRoute` reads `status.json` per task). No lost progress. The cold lens itself rated this low and "safe on re-run."
- **Dismissed (cold-Claude): benign case (real verdict + non-zero shutdown exit + skipped bookkeeping) now parks instead of auto-recovering** — This is the deliberate, human-gate-confirmed product tradeoff in Known Risks. The old auto-advance for this sub-case was never sound (indistinguishable from a stale-verdict crash); parking is the fail-closed correction. Not a defect.
- **Dismissed (cold-Codex): fail-closed guard is correctly scoped, preserves completed/clean-exit recovery, tests and checks pass** — This is the cold-Codex approve signal itself, not a defect to action; cross-model agreement corroborates the approve.
- **Dismissed (anchored, informational): the spec's "`code_review` is forced to `lastCodexExitStatus=0` by construction" reasoning is weaker than the actual safety** — Confirmed accurate: `main.ts:3469` derives `lastCodexExitStatus` from `phaseResult.agent === 'codex'`, not the phase name, so a codex-attributed `code_review` could carry a non-zero status. **But the code is correct regardless** — `shouldParkCrashedReview` gates on the explicit `phase === 'spec_review'`, which can never fire for `code_review`. This is a spec-prose accuracy note with zero code impact (the implementation is more robust than the spec's argument), not a spec gap or code bug.
- **Dismissed (anchored, informational): AC-3 does not explicitly assert the one-shot retry was not invoked; AC-5's `code_review`+non-zero path is covered by the unit predicate rather than a full `checkAndRoute` integration** — Both are structurally guaranteed (done phase skips the not-`done` block containing the retry; `shouldParkCrashedReview('code_review', 1) === false` is directly asserted) and match the spec's stated verification approach. Coverage is adequate; these are optional test-strengthening ideas, not gaps.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

> All nine ACs Met, Stage 1 gate passed, no code-bugs and no spec-gaps across all three lenses. The single surviving finding is a cosmetic duplicate-log nit (flagged by two lenses) that may ship as-is or be cleaned up at the implementer's discretion.

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
- [ ] Spec gap

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
