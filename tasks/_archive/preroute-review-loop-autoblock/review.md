# Code Review: preroute-review-loop-autoblock

> Reviewer: Claude | Spec: `tasks/preroute-review-loop-autoblock/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.
>
> **Prior cycle.** This task was rerouted from `human_review` after the pre-amendment code review returned `changes_requested` (+ `spec_gap`). That cycle's full two-round review is preserved verbatim at `review-prior-1.md`; its F1/F2/F3/F4/F5/F11/F13 findings were absorbed into the spec's `## Amendment` section (R2-1, R2-2, R2-3, F11, F13) and are re-verified below rather than re-litigated.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

Both Claude lenses re-ran the gate independently rather than trusting the handoff. All checks are real:

| Check | Handoff claim | Independently re-run | Verdict |
|---|---|---|---|
| `npm run lint` | Pass | Pass (exit 0) | Real |
| `npm run type-check` | Pass | Pass (exit 0) | Real |
| `npm test` | Pass | Pass — **1099/1099**, 0 fail | Real |
| `npm run build` + `git diff --exit-code -- dist/` | Pass | `dist/` reproduces byte-identical to a fresh build (`diff -rq` empty) | Real |
| `npm run docs-refs-check` | Pass | `All refs OK` | Real |
| `npm run sync-templates:check` | Pass | `All canon-managed files in sync` | Real |

The usually-expected `run-task-safety` "main die exits" worktree-guard failure did **not** occur — the suite is fully green.

**Handoff Changes table vs. actual diff**: 24 changed files, all declared, none undeclared. Both handoff Deviations are legitimate (`dist/cli/index.js` is a necessary consequence of the `src/task/index.ts` changes; the AC-18 QA-invocation assertion lives in the safety suite because that is where the real-git `main()` harness is).

**Non-Goals**: all 9 held. Verified individually — `pipeline-policy.ts` untouched, no new `status.json` field, `checkAndRoute()` untouched, `promptSpecRevision` selection at `phases/spec.ts:26` unchanged, `rerouteFromHumanReview()` untouched, both the `spec_gap` and pre-flight-infrastructure auto-blocks untouched (`code-review.ts:279` only swaps an identically-valued count argument), `taskResetSpecReview()` untouched, no reset-helper symmetry cleanup.

**Test-integrity audit**: exactly one pre-existing behavioral assertion was inverted (`tests/watch.test.ts` "classifyAttach: auto_block wins even when the pid is live") — that inversion is what AC-20(C) mandates red-first, and the fixture was corrected from a nonsensical shape (`implement: blocked`) to the real one. No test deleted, no assertion loosened. The spec's two named vacuity traps are genuinely closed: the fake agents log every invocation (`setupInvocationLoggingCliTools` replaces the silent `exit 0` stubs), and every phase-name assertion extracts the resume clause with an anchored capture group and compares by **equality**, avoiding the `spec`-is-a-substring-of-`spec_review` trap.

**Stage 1 result: PASS.** Proceeding to Stage 2.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `spec`-entry block before Claude | Met | `phases/spec.ts:19-24` precedes both `runClaude` calls; safety-suite test asserts empty invocation log, exit 2, `spec_review` blocked, escalation appended. |
| AC-2: `implement`-entry block before Codex | Met | `phases/implement.ts:36-41` sits above `commitTaskArtifactsToBase` (`:55`) and `ensureBranch` (`:62`). Both cases (iterations-at-cap; 1 iter + 2 pre-flight) assert empty log, exit 2, blocked, escalation, and `git rev-parse main` unchanged. |
| AC-3: persisted state names the revision phase current | Met | Both fixtures end `status==='spec'`/`'implement'`, revision `pending`, review `blocked`. (Assertion-strength caveat — N12.) |
| AC-4: raised-cap resume runs the revision first | Met | Exactly one agent invocation; `--expect spec`/`--expect implement` clear the guard, `--expect spec_review`/`--expect code_review` die with the `main.ts:3457` message; review phase still `blocked`. Exit code correctly not asserted. |
| AC-5: bare resume re-blocks for free | Met | Second `main()` call on the blocked fixtures: exit 2, log still empty, `escalations.length===2`, `auto_block_count===2`. |
| AC-6: one evaluator per loop, sole source of threshold/formula/ordering/wording | Met | (a) `Spec review hit`/`Code review hit` each appear exactly once, at `review-loop.ts:61`/`:87`; (b) all four phase modules import their evaluator; (c) cap−1/cap/cap+1 unit test; (d) pair test present. Prior cycle's F5 (counter formula still duplicated in `spec-review.ts`) is fixed. See D9 on the "differ **only** in the resume-order clause" wording. |
| AC-7: per-task combine then max; spec loop reads its own counter | Met | A(2,0)+B(0,2) vs cap 3 → no block; (2,1) → blocks. `evaluateSpecReviewLoop` reads `phases.spec_review.iterations_current_loop ?? iterations ?? 0` (`review-loop.ts:11-17`), never `TaskContext.iterations_current_loop`; both directions tested. |
| AC-8 (as superseded by AC-24) | Met | Both builders lead with `MAX_REVIEW_LOOPS=<n> canon run <ids>`, then the per-task reset command; index-ordering asserted in both states. |
| AC-9: no hand-edit instruction | Met | `doesNotMatch /iterations_current_loop\s*=/` and `/phases\.\w+\.status\s*=/` on both builders **and** on the persisted `escalations[].reason`. |
| AC-10: reason names the phase a resume actually runs first | Met | `resumeOrderClause` (`review-loop.ts:26-34`), state-derived. Tests capture the clause with `` /Resuming after raising the cap runs `([a-z_]+)`/ `` and assert equality — the word-boundary trap the spec calls out is avoided. Prior cycle's F1 (the contradicting unconditional sentence) is fixed. |
| AC-11: review-entry backstops retained, reason true for their own state | Met | `spec-review.ts:91-96` and `code-review.ts:239-244`. Spec half via subprocess fixture; code half via the `deps` seam with `events` deep-equalling `['verifyBranch']` (no reviewer invoked). |
| AC-12: `checkAndRoute()` unchanged | Met | No `getMaxReviewLoops`/evaluator reference in `main.ts`; both `routeBackTo` calls still unconditional; `run-task-reroute-preflight.test.ts` untouched and green. |
| AC-13: no first-pass or reroute false block (cap ≥ 1) | Met | Evaluator negatives with `iterations_total` at cap+4; plus a real `rerouteFromHumanReview()` subprocess test feeding the rerouted status into the evaluator. The `??` (not `||`) keeps a real `0` from falling through to the legacy alias. |
| AC-14: `docs/BACKLOG.md` records the `promptSpecRevision` defect | Met | Entry present with mechanism, evidence, and direction; `docs-refs-check` passes. **See D10 — this deferral has real cost.** |
| AC-15: `docs/pipeline-orchestrator.md` + mirror | Met | Both edits present; mirror re-synced. |
| AC-16: `reset-code-review` accepts exactly one more state | Met | `src/task/index.ts:1111-1118` + `:1128-1130`. (a) full end-state assertion incl. preserved `iterations_total`/`auto_block_count` and `review-prior-*.md` archive; (b) the two pre-existing tests unmodified; (c) rejection case for `implement` current + `code_review` **pending**. Prior cycle's F3 (`in_progress` acceptance) fixed. Implementation is strictly narrower than the AC — N4. |
| AC-17: advertised reset runs against the genuinely-persisted block state | Met | `taskCmd([...])` invoked in-process inside the **same test and same fixture** as AC-1/AC-2, before cleanup — the round-4 correction honored. |
| AC-18: `--force` accept completes the deferred predecessor | Met | `src/task/index.ts:735-756`. All five cases: (a) code + spec mirrors, with the follow-on `main()` run logging `['claude']` (QA) and no Codex; (b) `in_progress` negative → no write, `Next phase: implement`; (c) two-incomplete negative → `Next phase: plan`; (d) divergent bundle refused atomically with both `status.json` byte-identical after. |
| AC-19: accept write unchanged outside two named exceptions | Met, with caveat | No test in the 1088–1913 range modified; suite green. The divergence refusal reaches further than exception (2) as literally worded — N3. |
| AC-20: watch classification gated on liveness, not phase identity | Met | All five fixtures (A/B/C/D/E) across `classifyAttach`, `classifyIdle`, `orchestratorStillProgressing`, and `watchCmd --until`. `orchestratorStillProgressing` correctly *deletes* its `findFirstBlockedPhase` check rather than reordering it. Untested edge — N7. |
| AC-21: degenerate `MAX_REVIEW_LOOPS` values | Met | Shared `parseMaxReviewLoops` (`env.ts:14-27`, imported by `policy.ts:26`) validates the **raw string** with `/^-?\d+$/` before any truncating parse, so `1.5`/`2junk` are rejected rather than truncated. `isUsableCap` floor now `cap >= 0`. Subprocess config tests at both surfaces; checkpoint-level `cap=0, count=0 → blocked` for both evaluators; `pipeline-policy.test.ts:92` unmodified. Prior cycle's F4 fixed. |
| AC-22: `recovery.md` Phase-mismatch no longer prescribes a reset | Met | Section reworded; no `reset-spec-review` in it; the "Auto-block" section it now points at does carry a `--step`-free cap-raise command. Mirror synced. Prior cycle's F13 (adopter-shipped surface) fixed. |
| AC-23: `architecture.md` + `product-context.md` reworded | Met | Both edits present; `product-context.md:76` names both reset commands; `docs-refs-check` passes. |
| AC-24: no `--step` in builders or the doc recovery block | Met | Neither builder contains `--step`; `docs/pipeline-orchestrator.md:369` reads `MAX_REVIEW_LOOPS=5 canon run <id>`; new plain-run integration test drives `spec` → `spec_review` to `approved` in one process logging `['claude','codex']`. Prior cycle's F11 fixed. |

**All 24 ACs met.** The Stage 2 findings below are quality/correctness items outside the AC set, not AC failures.

## Stage 2 — Code Quality

### Findings

**F1 — `code-bug` — `canon task reset-code-review` performs an undisclosed `implement → done` write, and all four surfaces that describe the command omit it.** *(flagged by cold-Claude; verified by the foreman)* — `src/task/index.ts:1130`, `:1146-1148`; `scripts/run-task/review-loop.ts:92`

`taskResetCodeReview()` now writes `implement.status = 'done'` (`:1130`) — AC-16-mandated and correct. But its success message (`:1146-1148`) reports only:

```
Reset <id>: code_review → pending (iter_current_loop=0, iterations=0, preflight_rejections_current_loop=0, verdict cleared, claude_review session dropped)
```

Its sibling — the helper this write explicitly mirrors, per spec.md:69 — *does* disclose the equivalent write (`src/task/index.ts:1096`):

```
Reset <id>: spec → done, spec_review → pending (iter=0, verdict cleared, claude_spec session dropped)
```

Four surfaces describe `reset-code-review` and **none** mentions the `implement` write: the success message above; `buildCodeReviewReason` ("run `canon task reset-code-review <id>` to archive the prior review and clear the loop-local counters" — `review-loop.ts:92`); `docs/pipeline-orchestrator.md`'s new rescope block; and `docs/product-context.md:76` ("both archive the prior review, zero loop counters, and preserve lifetime `iterations_total`").

Failure scenario: an operator hits a `code_review` loop-cap block at the new `implement` entry. The block message offers two options; they take the advertised "rescope" fallback. The command silently marks the just-rejected implementation accepted-as-is, so the next `canon run` dispatches `code_review` and re-reviews the byte-identical diff that just failed three rounds — with a fresh full loop budget — instead of re-implementing. The operator who wanted a re-implementation had to raise the cap instead, and no surface told them.

This is not cosmetic: it is the operator's only signal distinguishing the two divergent recovery paths this task creates. The spec's own Known Risks (spec.md:181) asserts the mitigation already exists — *"an operator who wanted a re-implementation rather than a re-review must raise the cap instead. The two paths are distinguished in the reason text (AC-8)"* — but AC-8 only pins command **ordering**, so the claimed distinction was never encoded and does not ship.

Fixable at `implement` altitude; no spec change and no AC violated (AC-8 constrains ordering; AC-9 forbids only `phases.` hand-edit instructions; AC-6(d) constrains what varies *between states*, so a state-independent clause is fine):

1. Add the predecessor write to the reset's success message, mirroring `taskResetSpecReview()`.
2. Add one clause to `buildCodeReviewReason` naming what the reset does to the implementation — that it accepts the current implementation as-is and the next run re-reviews rather than re-implements.
3. Cheap and optional: the same clarity in `docs/product-context.md:76` and the orchestrator recovery block.

**F2 — `code-bug` (minor, same surface as F1) — the rewritten code-review block message drops operator guidance the old one carried.** *(flagged by cold-Claude)* — `scripts/run-task/review-loop.ts:86-94`

Two things present in the pre-change message at `code-review.ts` are gone: the artifact pointer *"Read `tasks/<id>/review.md` — if the same finding keeps recurring, the spec or approach may need revisiting rather than another implementation pass"*, and the concrete pre-flight example *"(e.g., Validation Outcomes rows using prose labels instead of backticked check keys)"*. The new text retains only "the handoff format itself may be wrong."

The `spec_review` sibling **kept** its equivalent pointer ("Read the latest spec-review.md"), so the two builders are now asymmetric in precisely the dimension AC-6 centralized them to keep aligned. No AC mandates the content, so this is a guidance regression rather than an AC failure — but it is on the same string as F1 and costs nothing to restore in the same pass.

### Nits (non-blocking)

- **N1 — duplicate `MAX_REVIEW_LOOPS` warning.** *(2 lenses; both reproduced it empirically)* `scripts/run-task/env.ts:14-27` + `policy.ts:26`. `policy.ts` imports `env.ts` and both evaluate a module-level `config` calling `parseMaxReviewLoops`, so one invalid value prints the warning twice per process. The new tests use `assert.match`, which cannot see the duplication (N11).
- **N2 — `classifyIdle`'s `probeAlive: (pid) => boolean = () => false` default.** *(2 lenses)* `src/cli/commands/watch.ts:326`. Silently restores pre-fix over-firing at any caller that omits it, on a function whose entire point is now liveness gating; `classifyAttach` deliberately has no default. No live bug (`watchCmd` always passes the real prober), but it also means the pre-existing `classifyIdle: auto_block when any phase is blocked` test now passes on the hardcoded-dead default rather than exercising real logic. Prefer a required parameter.
- **N3 — bundle-divergence refusal is not gated on `options.force`.** *(2 lenses)* `src/task/index.ts:750-756`. AC-19 scopes exception (2) to bundles diverging "after applying (1) independently", and (1) is `--force`-only; the check fires on plain bundled accepts too. Fail-closed, and arguably *required* for the AC-18 derived-message fix to be sound on the non-force path — but it is a write-path behavior change outside the two named exceptions and belongs in a handoff Deviations row.
- **N4 — `taskResetCodeReview`'s extra `implement.status === 'pending'` conjunct.** `src/task/index.ts:1114`. Strictly narrower than AC-16's predicate (`code_review` blocked + derived current phase `implement`) and safer — it rejects an interrupted `in_progress` implementation, which was the prior cycle's F3. Undocumented tightening; belongs in Deviations.
- **N5 — two structural asymmetries at the new call sites.** *(2 lenses)* `phases/spec.ts:22` calls `autoBlockPhase(…, 'spec_review', …)` directly while `spec-review.ts:94` routes the identical write through the `autoBlockSpecReview()` wrapper that exists to centralize it. Separately, `code-review.ts` takes `getMaxReviewLoops` through injectable `deps` while the new `implement.ts` gate imports it directly, so `runImplementPhase`'s cap cannot be stubbed in a unit test — the prior cycle already adjudicated that second half as a design preference rather than a defect, and nothing has changed that.
- **N6 — the `MAX_REVIEW_LOOPS=0` sentinel is undocumented and its message is incoherent.** *(residue of D1)* A brand-new task under cap 0 blocks at first `spec` entry with *"Spec review hit 0 changes_requested iterations in a row (limit: 0). Pipeline auto-blocked before the next spec revision."* — nonsense for a task with no prior revision. `docs/pipeline-orchestrator.md:263`/`:358` never mention the `0` sentinel or the new invalid-value warning/fallback.
- **N7 — `classifyAttach` with a blocked marker + live PID + *stale* heartbeat.** *(anchored; adjacent to cold-Claude's race finding)* `src/cli/commands/watch.ts:291-320`. Control falls past the liveness gate to the `inProgress` check and returns `death` (or `nothing_to_watch`), so the initial attach still refuses a healthy cap-raised resume — exit 4 instead of exit 3. AC-20(A)/(C) both use `makeHeartbeat(1234)` (fresh), so this window is untested. The polling loop is correctly fixed.
- **N8 — PID reuse now gates block reporting.** *(2 lenses)* `watch.ts:97-101`, `:416-424`. A stale-but-alive `.canon-pid` (PID recycled after a SIGKILL that skipped cleanup, or a second canon process) makes a genuine auto-block invisible: `--until` burns to timeout (exit 5) instead of exiting `0 reason=until`, and scripts keying on exit 3 mis-branch. The spec chose liveness knowingly (spec.md:244 argues a blocked task *never* has a live orchestrator); this is the residual where that premise fails.
- **N9 — `parseMaxReviewLoops` edges.** *(2 lenses)* `env.ts:14-23`. Empty string returns `null` silently while whitespace-only warns; `"99999999999999999999"` → `1e20` passes `Number.isInteger` as an effectively-infinite cap; `+5` and `1e3` are rejected. None is harmful; the empty-vs-whitespace asymmetry is the only one worth a line.
- **N10 — the `--until` liveness test uses `--timeout 0s`.** *(cold-Claude)* `tests/watch.test.ts:491-516`. `withinTimeout()` fires on the first loop iteration, so the test proves only that the **pre-attach** `phaseSettled` returned false. That assertion *is* red-first-valid (pre-fix it exits `0 reason=until`), so this is a coverage limit rather than a vacuous test — the polling `phaseSettled` calls at `:606`/`:662` are unexercised.
- **N11 — `assert.match` on stderr in the new config tests** (`tests/pipeline-policy.test.ts:18-34`) passes on a superstring, so N1's duplicate emission is invisible. These also spawn 8 tsx subprocesses across two files for what is now a directly-testable exported pure function.
- **N12 — AC-3's `assert.equal(blocked.status, 'spec')`** reads back a top-level value the fixture already pre-set to the same string, so it cannot distinguish "the block re-derived the current phase" from "nothing touched `status.status`". Behavior is genuinely correct (`writeStatusToFile` recomputes it, `state.ts:380`); only AC-4's `--expect` guard would catch a regression here.
- **N13 — plain `canon task accept <id> code_review` is unusable from the block state with no pointer to `--force`.** *(cold-Claude; lineage: prior cycle's F2 spec-gap)* At the new block, `implement` is `pending`, so `priorIncompletePhases()` throws `prior phases not done: implement`. The amendment deliberately routed this through `--force` (R2-1 / AC-18) — one of the three options prior-cycle F2 offered — but declined the second ("document the `--force` path"), so no message or doc mentions it. Worth a sentence in the reason text or the orchestrator doc.
- **N14 — uncommitted `docs/pipeline-invocations.md` telemetry** rows sit in the working tree from this task's own run. Outside the reviewed diff, but a tracked non-`tasks/` file that must land or be reverted before `canon run --pr`'s base-drift gate.

## Dismissed Cold Findings

- **Dismissed (cold-Codex): "Skip the cap check on initial phase entry — `MAX_REVIEW_LOOPS=0` auto-blocks before generating the spec" (P2)** — spec-intended, with explicit evidence cited. spec.md:99 (AC-13) states *"A cap of exactly `0` is the deliberate immediate-block sentinel governed by AC-21(b), **not a first-pass exemption** — this AC does not apply to it"*, and spec.md:283 (AC-21) requires `0` to *"reach `evaluateSpecReviewLoop`/`evaluateCodeReviewLoop` unfiltered, and actually block"*, naming the `cap=0, count=0 → blocked: true` test as red-first against `isUsableCap()`'s old `cap >= 1` floor. `defaultMaxReviewLoops` never returns `0`, so this requires a deliberate operator override of a value the project already documents as a "suicidal override" (`tests/pipeline-policy.test.ts:92`). The anchored lens reached the same conclusion independently and explicitly disagreed with the P2 call. **Residue kept as N6** — the relocation does move *where* `0` bites (first `spec` entry rather than first `spec_review` entry), and no doc or message explains the sentinel.
- **Dismissed (cold-Claude): `revisionPhaseNotDone` should use `some()`, not `every()` (P3)** — spec.md:59 mandates `every()` by name, citing `docs/patterns.md` "Bundle-gate conditions must use `every()`, not `some()`, on per-task flags", and notes the mixed bundle is unreachable because `assertSamePhase()` (`main.ts:237`, called before every dispatch) refuses it outright. Same dismissal as the prior cycle.
- **Dismissed (cold-Claude): `taskResetCodeReview`'s `implement → done` "silently discards the deferred re-implementation" as a design defect (P1)** — the *write* is AC-16-mandated (spec.md:102) and explicitly risk-accepted at spec.md:181. Only the **non-disclosure** survives, promoted to F1.
- **Dismissed (cold-Claude): `--until code_review` falsely reports `reason=until` on a stale blocked marker after a `--step` resume (P2)** — AC-20(B) and (D) mandate exactly this rule ("a `blocked` phase plus no live PID is always terminal, regardless of phase identity"), and AC-20(D) names it the load-bearing regression case. The genuine residue — a completed revision never clears the review phase's stale `blocked` marker — is escalated for QA below rather than treated as a bug.
- **Dismissed (cold-Claude): unbounded `escalations` growth / `auto_block_count` increment on every no-op resume (P3)** — spec.md:178 Known Risks: *"deliberately not deduplicated, consistent with the project rule that counters are never reset or suppressed."*
- **Dismissed (cold-Claude): `implement → done` and the `--force` predecessor write bypass `checkPhaseGate` (P2 ×2)** — both mirror the pre-existing `taskResetSpecReview()` `spec → done` write that spec.md:69 explicitly makes the model; `--force` bypasses gates by design (it already skips `priorIncompletePhases()`); and the reachable state always has a `handoff.md` on disk, since `code_review` can only carry loop counters after `implement` ran at least once.
- **Dismissed (cold-Claude): `autoBlockPhase`'s `if (phaseEntry)` guard and its lack of bundle rollback (P3 ×2)** — `scripts/run-task/state.ts:399-418` is unchanged by this diff; only new call sites were added. The scaffold always creates phase entries, so the missing-entry path is not reachable in practice.
- **Dismissed (cold-Claude): `isUsableCap` fails open on NaN/negative (P3)** — not a regression. The pre-change comparison `worstTask.combined >= codeReviewLoopCap` was likewise `false` for a `NaN` cap, so the guard failed open before too; AC-21 now normalizes every reachable input at both parse sites.
- **Dismissed (cold-Claude): ambiguous-PID now wins over `auto_block` (exit 2 vs 3) (P3)** — AC-20(E) mandates exactly this reorder and calls it red-first against today's behavior; spec.md:248 explains why (a stale block marker was skipping the refusal-to-attach guard).
- **Dismissed (cold-Claude): the inverted `classifyAttach` watch test is a test-integrity weakening (P3)** — AC-20(C) mandates the inversion red-first, and the fixture was corrected from a nonsensical shape (`implement: blocked`) to the real one. The anchored lens audited this independently and agreed. The dropped `result.phase` assertion is immaterial once the classification is `live`.
- **Dismissed (anchored): AC-6(d) requires the two reasons to "differ **only** in the resume-order clause", but two clauses are state-dependent** — the second state-dependent clause (`blockTimingClause`) is the **required fix for the prior cycle's F1 `code-bug`** (`review-prior-1.md:93-105`), where the hard-coded "Pipeline auto-blocked before the next spec revision" was false at the backstop and contradicted its own resume clause inside the same persisted string. That review also recorded that AC-6(d)'s `stripResumeClause` prefix-equality assertion *"actively requires the defective sentence to stay state-independent"*, so relaxing it was mandatory to fix F1. Correct resolution of a prior finding, not an undocumented deviation.
- **Dismissed for this round (cold-Claude): the cap-raised spec recovery lands in `runSpecPhase`'s first-write branch, not the revision branch (P2)** — verified real and correctly diagnosed: `routeBackTo('spec')` clears `spec_review.verdict`, `hasChangesRequested` (`phases/spec.ts:26`) keys on it, so the deferred revision receives `promptSpec` with `resumeId: null` and re-authors from scratch. But it is **pre-existing**, explicitly Non-Goaled (spec.md:79), recorded in `docs/BACKLOG.md` per AC-14, and flagged for the human at the spec gate (spec.md:186) — the human approved the spec with that deferral in it. It is not a defect of this diff. **Escalated below rather than dropped**, because it materially blunts this task's headline spec-loop recovery.

## For the Human / QA

Two items that are not `implement`-altitude fixes but should not ship unremarked:

1. **The spec loop's cap-raise recovery is degraded by the deferred `promptSpecRevision` bug.** This task's headline promise is "raise the cap → the deferred spec revision runs first." That deferred revision currently receives the *first-write* prompt with no resumed session, so Claude re-authors the spec rather than addressing the review findings. The code-loop side is fine (`shouldUseImplementRevision()` keys off counters). The deferral is a deliberate, human-approved spec decision with a backlog entry — but that backlog item is now load-bearing for a recovery path this task ships and documents, which raises its priority above "adjacent defect found while tracing."
2. **A completed revision never clears the review phase's stale `blocked` marker.** After a cap-raised `--step` resume runs the deferred revision to completion, `code_review` still reads `blocked` until the review phase sets `in_progress`. AC-20 deliberately makes "blocked marker + no live orchestrator = terminal", so in that window `canon watch --until code_review` reports settled for a phase that never ran. Consistent with the spec as written; worth confirming in QA that the operator-visible sequence reads sensibly end to end.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

**Must fix before ship**: F1 and F2 only. Both sit on the same operator-guidance surface (`buildCodeReviewReason` plus `taskResetCodeReview`'s success message) and together are roughly a three-line change across two files, plus an assertion. **Do not rewrite anything else** — all 24 ACs are met, the validation gate is genuinely green (1099/1099, `dist/` reproducible), the prior cycle's F1/F3/F4/F5/F11/F13 are each independently confirmed fixed, and every other finding is a non-blocking nit recorded above.

**Why F1 blocks rather than riding to QA**: `reset-code-review` is one of exactly two recovery paths this task creates and advertises, and it performs a material state write — accepting a rejected implementation as-is — that no surface discloses, while the sibling helper it is modeled on discloses the identical write. The spec's Known Risks assumes that disclosure already exists. Shipping it costs the next operator a full review cycle and a silently blessed implementation, and the fix is trivial and zero-risk.

**Nits worth folding in while the file is open** (optional, no re-review needed): N1 (duplicate warning), N2 (`classifyIdle` default), N5 (`autoBlockSpecReview` wrapper bypass). N3 and N4 need only a handoff Deviations row, not a code change.

---

## Round 2 — re-review after iteration 2

Iteration 2 (handoff `## Iteration 2 — addressing review round 1`) was correctly scoped to Round 1's two blocking findings. Both are genuinely fixed. This round's findings are (a) a new instance of an old defect class introduced *by* the F1 fix, and (b) the half of F1 that was left on the other loop.

### Stage 1 — Spec Compliance (gate)

#### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

The iteration-2 "Re-run validation" table is a **partial** re-run — it covers lint, type-check, affected unit tests (86), build, docs-refs, and `git diff --check`, but not full `npm test` or `sync-templates:check`. The anchored lens therefore re-ran the complete gate from scratch rather than accepting the subset:

| Check | Re-run result | Verdict |
|---|---|---|
| `npm run lint` | exit 0 | Real |
| `npm run type-check` | exit 0 | Real |
| `npm test` | **1099 pass / 0 fail / 0 skipped** | Real |
| `npm run build` + dist reproducibility | rebuilt; `git status --porcelain -- dist` empty **and** `diff -rq` vs a pre-build copy identical | Real |
| `npm run docs-refs-check` | `All refs OK` | Real |
| `npm run sync-templates:check` | `All canon-managed files in sync` | Real |
| `git diff --check` | clean | Real |

The partial re-run turned out to be harmless — the full gate is green — but it was a gap in the handoff, not a justified skip. Changing a message string can break assertions anywhere in the suite; the full run is what proves it did not.

Every iteration-2 edit named in the handoff Changes table is actually committed (`a96b733`); no claimed edit was silently dropped. The only dirty non-`tasks/` file is `docs/pipeline-invocations.md` (see N14). All 9 Non-Goals still hold. Test integrity: no test deleted or loosened; `watch.test.ts` went 22 → 30 tests.

#### Acceptance Criteria Check

**All 24 ACs remain Met.** Re-derived from scratch, not carried over. Only the ACs that iteration 2 could plausibly have disturbed are restated here; the rest are unchanged from Round 1's table and were re-verified green.

| AC | Status | Notes |
|---|---|---|
| AC-6 | Met (6(d) literal deviation on record) | `review-loop.ts:61`/`:87` still the only definition sites; all four phase modules import their evaluator. The pair test at `tests/run-task-code-review.test.ts:358` still passes because both added strings are state-independent — which is also how it fails to catch F3. |
| AC-8 (as superseded by AC-24) | Met | Verified by **executing** both builders in all four states: the `MAX_REVIEW_LOOPS` index precedes the reset-command index every time (code primary 373<614, code backstop 424<665, spec primary 267<372, spec backstop 317<422). The new trailing "raise the cap instead" back-reference does not disturb this, since `indexOf` takes the first occurrence. |
| AC-9 | Met | `doesNotMatch /iterations_current_loop\s*=/` and `/phases\.\w+\.status\s*=/` hold against all four executed strings. The added text introduces no `phases.` assignment. |
| AC-10 | Met for the resume clause | `resumeOrderClause` is untouched and still state-derived, anchored-capture asserted. But see **F3** — the added text reintroduces an unconditional resume-order promise *outside* that clause. |
| AC-16 | Met | Verified that **no** test anywhere asserted the old `taskResetCodeReview` success string, so the F1 message change broke nothing; `tests/task-cli.test.ts:850`/`:895` still unmodified. |
| AC-24 | Met | No `--step` in `review-loop.ts` or the orchestrator recovery block. |

**Stage 1 result: PASS.**

#### Round 1 blocking findings — fix verification

| Round 1 finding | Status | Evidence |
|---|---|---|
| **F1(1)** reset success message discloses the predecessor write | **Fixed** | `src/task/index.ts:1147` now prints `Reset <id>: implement → done, code_review → pending (…)`, mirroring `taskResetSpecReview()`'s shape at `:1096`. Accurate against the code (`:1128-1130`). Pinned by `tests/task-cli.test.ts:958`, which required capturing stdout the prior test discarded. |
| **F1(2)** `buildCodeReviewReason` names what the reset does to the implementation | **Fixed, with a new defect** | `review-loop.ts:96-98` adds the clause. Correct in the revision-entry state; **wrong at the backstop** — see F3. |
| **F1(3)** doc surfaces | Not done (Round 1 marked optional) | Now folded into F4's scope, because two lenses independently flagged a *fifth* surface that ships to adopters. |
| **F2** restore the `review.md` pointer and the pre-flight example | **Fixed** | `review-loop.ts:89-90` and `:94`. Confirmed present in **both** state variants by executing the evaluator. Pinned at `tests/run-task-code-review.test.ts:393-394`. |

### Stage 2 — Code Quality

#### Findings

**F3 — `code-bug` — the F1 fix reintroduces the defect class it was fixing: a state-independent sentence that is false at the backstop and contradicts its own resume clause in the same persisted string.** *(found by the foreman during fix-verification; independently confirmed by the anchored lens, which executed the builder)* — `scripts/run-task/review-loop.ts:96-98`; test at `tests/run-task-code-review.test.ts:392-398`

`buildCodeReviewReason`'s new trailing clause is concatenated into the **state-independent** body:

```
… Resetting accepts the current implementation as-is, so the next run re-reviews it
rather than re-implementing; raise the cap instead if you want another implementation pass.
```

The first half is true in both states. The second half is not. Executed backstop string (`implement.status === 'done'`, `code_review` blocked and current):

```
… Pipeline auto-blocked at the `code_review` entry backstop after `implement` already
completed its revision. … raise the cap instead if you want another implementation pass.
Resuming after raising the cap runs `code_review` directly; `implement` already
completed its revision.
```

Two adjacent sentences in one persisted `escalations[].reason` tell the operator opposite things. Failure scenario: at a backstop block the operator wants a re-implementation, reads "raise the cap instead", raises it and resumes — `code_review` runs, not `implement`. They burn a full review round and get no implementation pass. (Strictly, an implementation pass is *eventually* reachable if that review returns `changes_requested`; the sentence is wrong about ordering, not about ultimate possibility. The contradiction with the very next sentence is the defect.)

This is the same shape as the **prior cycle's F1** (`review-prior-1.md:93-105`), which this task blocked on and which the round-4 spec revision exists to close. AC-10 encodes it: *"never an unconditional promise that a revision runs next."*

**The new test pins the defect.** `tests/run-task-code-review.test.ts:392` loops over `[codePending.reason, codeDone.reason]` — both states — and line 397 asserts `/raise the cap instead if you want another implementation pass/i` in each. `codeDone` is the backstop fixture (`implementStatus: 'done'`, line 368). So a correct fix goes red on this assertion. That is precisely what the prior cycle recorded about the `stripResumeClause` assertion: *"the test that was supposed to pin it cannot… Fixing the code without relaxing that assertion will fail the suite."* Same trap, reproduced one clause over. A test that locks in wrong output is a test-integrity finding, which is why this blocks rather than riding to QA.

Fix: move the trailing half into the state-dependent path (present it when `revisionNotDone`, omit or invert it at the backstop), and change line 397 from the both-states loop to a state-discriminating pair.

**F4 — `code-bug` — the disclosure fix was applied to the code loop only; the spec loop still carries the exact defect Round 1 blocked on, and the class now spans five surfaces.** *(flagged by 2 lenses: anchored + cold-Claude, both rating it materially harmful)* — `scripts/run-task/review-loop.ts:65-66`; `.claude/skills/canon-pipeline/recovery.md:31`; `docs/product-context.md:76`; `docs/pipeline-orchestrator.md:374-381`

`taskResetSpecReview()` performs the identical predecessor write — `spec.status = 'done'` (`src/task/index.ts:1087`), unconditionally — with the identical consequence: at a `spec_review` revision-entry block, `spec.status === 'pending'` **is** the deferred revision, so the advertised reset discards it and the next run re-reviews the byte-identical spec that just failed N rounds. `buildSpecReviewReason` still says only:

```
… run canon task reset-spec-review <id> to archive the prior review, clear the loop
counters, and drop the stored Claude session.
```

No mention that it accepts the current spec as-is. That is Round 1's F1, verbatim, on the other loop. It also re-opens the builder asymmetry that F2 objected to — the two reasons now disagree in exactly the dimension AC-6 centralizes them to keep aligned.

Partially mitigating, and the reason this is a smaller F1 than the original: the spec-side reset command's own success message *does* disclose (`Reset <id>: spec → done, spec_review → pending`). But that fires **after** the write, and the block reason is what the operator reads while *choosing* between cap-raise and reset.

**Close the class, don't patch the next site.** Counting surfaces that describe a reset without its predecessor write: `buildSpecReviewReason`; `recovery.md:31` "Path B — stale-context reset" (**ships to adopters** via the `templates/` mirror — flagged by both lenses); `docs/product-context.md:76`; `docs/pipeline-orchestrator.md:374-381`. Round 1 fixed one site and found three; this round finds four more. Per this project's own rule — *a cross-cutting invariant belongs in one shared helper, not patched per call site; at ≥3 sites, extract* — the fix is a single parameterized clause consumed by **both** reason builders, plus a one-line update to each of the three prose surfaces in the same pass. A second copy-paste into `buildSpecReviewReason` would leave the class open for a fourth round.

#### Nits (non-blocking)

Carried forward and unresolved (Round 1 scoped iteration 2 to F1/F2, so these were correctly deferred, not missed):

- **N1 — duplicate `MAX_REVIEW_LOOPS` warning.** *(2 lenses, both re-reproduced it empirically this round)* `env.ts:150` and `policy.ts:26` each evaluate a module-level `config` calling `parseMaxReviewLoops`, and `policy.ts` imports `env.js` — one invalid value prints two identical warnings. `tests/pipeline-policy.test.ts:18-34` uses `assert.match`, which cannot see it.
- **N2 — `classifyIdle`'s `probeAlive = () => false` default.** *(2 lenses)* `src/cli/commands/watch.ts:326`. `classifyAttach` deliberately has none. The pre-existing `classifyIdle: auto_block when any phase is blocked` test now passes via the hardcoded-dead default rather than real liveness logic.
- **N5 — `phases/spec.ts:22` bypasses the `autoBlockSpecReview` wrapper.** *(2 lenses)* Verified harmless today — the wrapper is a pure one-line pass-through — but the two spec-loop block sites diverge the moment it gains behavior.
- **N12 / N14** unchanged: AC-3's `assert.equal(blocked.status, 'spec')` reads back a fixture-set value; `docs/pipeline-invocations.md` is still dirty (+22 lines, tracked, non-`tasks/`) and **will trip `canon run --pr`'s base-drift gate** regardless of this verdict.
- **N3 / N4 resolved as asked** — both now have handoff iteration-2 Deviations rows. No code change was required.

New this round:

- **N15 — the recovery narrative is now muddied by the trailing back-reference.** `review-loop.ts:86-99` reads: read review → raise cap (command) → pre-flight note → reset (command) → "actually, raise the cap instead if you want re-implementation" → resume order. AC-8's index assertion still holds, but the "reset is the demoted fallback" framing it intends is blurred. Folding F3's fix in is a chance to reorder.
- **N16 — the recovery command is sentence-terminated, so it copy-pastes wrong.** *(cold-Claude)* `review-loop.ts:64`/`:92` render `MAX_REVIEW_LOOPS=<n> canon run task-a.` — the trailing period abuts the command. The pre-AC-24 text was em-dash delimited. `tests/run-task-code-review.test.ts:258` pins the current shape.
- **N17 — orchestrator death mid-revision is now misreported as `auto_block`.** *(cold-Claude)* With a stale `code_review: blocked` marker and the orchestrator SIGKILLed during a resumed `implement`, `classifyAttach` returns `auto_block` at `code_review` instead of `death` with its `run canon run <id> to resume` hint. Not a regression (a blocked marker beat the death branch on `main` too), but this design makes the window a whole implement phase rather than momentary. An `in_progress`-phase discriminator would fix it without violating AC-20(D), whose fixture uses `implement: pending`.
- **N18 — `maxIter` is now a redundant second derivation.** *(cold-Claude)* `phases/code-review.ts:238` reduces over the same tasks the evaluator already walks, surviving only to feed the `iteration ${maxIter + 1}` log line at `:297`, while the evaluator already returns `count`. Two counters for one quantity.
- **N19 — coverage for "the `implement` phase itself is blocked" was repurposed away.** *(cold-Claude)* `tests/watch.test.ts:104`'s fixture changed from `implement: blocked` to `implement: in_progress` + `code_review: blocked`. Verified that `implement: blocked` is genuinely reachable (`phases/implement.ts:128` calls `autoBlockPhase(taskIds, 'implement', …)`). Largely re-homed by AC-20(B), which covers the same blocked-and-current + dead-PID shape for `code_review`; recorded as coverage hygiene, not a gap.
- **N20 — test-helper regex escaping is fragile.** *(cold-Claude)* `tests/pipeline-policy.test.ts:48` and `tests/run-task-harness.test.ts:345` use `raw.replace('.', '\\.')`, which escapes only the first dot and no other metacharacter. Adding a case like `'1+'` or `'1.2.3'` would throw or mis-match.

### Dismissed Cold Findings — Round 2

- **Dismissed (cold-Codex): no findings returned.** Cold-Codex reported the branch clean against `main` with the full suite, lint, type-check, build, and dist-consistency all passing — consistent with both Claude lenses' independent re-runs. Recorded for completeness; a silent cold lens is not treated as evidence of a clean diff.
- **Dismissed (cold-Claude): `--until` falsely settles on a stale `blocked` marker during the launch window, exit 0 (rated P0/high).** Verified against `main`: the pre-change `isPhaseSettled` (`git show main:src/cli/commands/watch.ts:97-100`) returned `true` for `blocked` **unconditionally**, with no liveness input at all. In the launch window (`resolvedPid == null`) the new code produces the identical result. This is an unimproved pre-existing gap, not a regression — the diff strictly narrows when a `blocked` phase counts as settled. AC-20 also mandates the "blocked + no live orchestrator ⇒ terminal" rule the launch window falls into, and spec.md:250 explicitly leaves threading liveness into `isPhaseSettled`'s call sites as a plan-phase call. Real residual, but not this diff's defect.
- **Dismissed (cold-Claude): the stale-blocked check ordered ahead of `ctx.launchWindow` makes plain `canon watch` report a false `auto_block` (P2).** Same verification: on `main` the blocked check ran *first and unconditionally*, ahead of the launch-window branch. Identical outcome before and after. Not a regression.
- **Dismissed (cold-Claude): PID reuse can mask a genuine auto-block (P2).** This is Round 1's N8, now flagged by both lenses across rounds. The spec chose liveness knowingly and argued the premise at spec.md:244 (every `autoBlockPhase` call site is followed by `process.exit(2)` in the same synchronous stack, so a genuinely blocked task has no live orchestrator). PID recycling is the acknowledged hole in that premise. Retained as a standing nit, not a new finding.
- **Dismissed (cold-Claude): `taskResetCodeReview`'s message claims "implement → done" even on the `code_review`-current path where implement was already done (P3).** The message describes the resulting end state, not a delta, and is exactly the shape of the sibling it was required to mirror — `taskResetSpecReview` has always printed `spec → done` unconditionally on the same no-op path. The objection would equally condemn the pre-existing helper. This is the fix Round 1 asked for.
- **Dismissed (cold-Claude): `accept --force` on an `in_progress` implementation lets the next implementation ship unreviewed (P2, test-integrity framing).** AC-18(b) mandates this exact negative case and its `Next phase: implement` message. The downstream consequence — implement completes, `code_review` is already `done`, `deriveTopLevelStatus` advances to `qa` — is inherent to `--force` accept semantics and is pre-existing: `--force` has always skipped `priorIncompletePhases()`, so this outcome was reachable before this task.
- **Dismissed (cold-Claude): `rerouteFromHumanReview`'s `allCodeReviewBlocked` predicate was not taught the new blocked-at-implement shape (P3).** Spec-considered and deliberate. spec.md *Interaction Dependencies*: *"Today a loop-cap block satisfies the phase conjunct at `main.ts:2351` but fails `someSpecGap`; after this change it fails both… Refused before, refused after — the documented recovery for a loop-cap block is cap-raise or reset, not reroute."*
- **Dismissed (cold-Claude): `revisionPhaseNotDone` should use `some()`, not `every()` (P3).** spec.md:59 mandates `every()` by name, citing `docs/patterns.md` "Bundle-gate conditions must use `every()`, not `some()`, on per-task flags", and notes mixed bundles are refused upstream by `assertSamePhase()`. Same dismissal as Round 1.
- **Dismissed (cold-Claude): `isUsableCap` fails open on NaN/negative (P3).** Not a regression — the pre-change comparison `worstTask.combined >= codeReviewLoopCap` was likewise `false` for a `NaN` cap. AC-21 now normalizes every reachable env input.
- **Dismissed (cold-Claude): `autoBlockPhase` skips the mutation when the phase entry is absent (P3).** `state.ts:399-418` is unchanged by this diff; only call sites were added. The scaffold always creates every phase entry.
- **Dismissed (cold-Claude): empty `tasks` array + `cap === 0` blocks on the synthetic `perTask[0]` fallback with an empty task id (P3).** `review-loop.ts:143`. The dispatch path never invokes a phase with zero tasks; `assertSamePhase` and `buildPipelineState` both require at least one. Defensive-branch cosmetics.
- **Dismissed (cold-Claude): the bundled-accept divergence check is an unannounced regression for divergent bundles (P3).** This is Round 1's N3, and iteration 2 added the handoff Deviations row Round 1 asked for. Fail-closed and arguably required for AC-18's derived-message fix to be sound on the non-force path.
- **Dismissed (cold-Claude): non-`--force` `canon task accept <id> code_review` throws `prior phases not done: implement` from the block state (P2).** Round 1's N13. The amendment deliberately routed this through `--force` (R2-1 / AC-18). Retained as a standing nit; the discoverability half remains unaddressed by design.
- **Dismissed (anchored): AC-6(d)'s literal "differ **only** in the resume-order clause" is not met — two clauses vary.** Adjudicated in Round 1: the second state-dependent clause is the mandated fix for the prior cycle's F1. Not made worse by iteration 2. On record as a decision, not an unremarked deviation.

### For the Human / QA — carried forward unchanged

Both Round 1 items still stand and are unaffected by iteration 2:

1. **The spec loop's cap-raise recovery is degraded by the deferred `promptSpecRevision` bug** (`phases/spec.ts:26`, backlogged per AC-14) — a cap-raised spec-loop resume hands Claude the first-write prompt with `resumeId: null`, so it re-authors rather than revises. The code loop is fine. Human-approved deferral, not a defect of this diff — but note F4 compounds it: on the spec loop, *both* advertised recovery paths currently lead somewhere other than "address the review findings against the existing spec."
2. **A completed revision never clears the review phase's stale `blocked` marker**, so after a `--step` resume `canon watch --until code_review` reports settled for a phase that never ran. N17 is the same root cause on the death path.

### Final Verdict — Round 2

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

**Must fix before ship**: F3 and F4 only. Everything else above is a nit or dismissed. Stage 1 is clean, all 24 ACs are met, the gate is genuinely green (1099/1099, `dist/` byte-reproducible), and Round 1's F1 and F2 are both really fixed and really pinned.

**Scope of the fix** — one file plus two test edits, and one line in each of three prose surfaces:
1. `scripts/run-task/review-loop.ts` — extract the reset-semantics disclosure into a **single clause helper consumed by both** reason builders (parameterized by loop), and make the "raise the cap instead if you want another <revision>" half **state-dependent** so it does not appear at the backstop.
2. `tests/run-task-code-review.test.ts:392-398` — change the both-states loop into a state-discriminating pair for that one assertion; keep the F2 assertions in the both-states loop where they belong.
3. `.claude/skills/canon-pipeline/recovery.md:31` (+ re-sync the `templates/` mirror), `docs/product-context.md:76`, `docs/pipeline-orchestrator.md:374-381` — name the predecessor write.

**Why this blocks rather than riding to QA.** Two reasons, and the second is the decisive one. First, consistency: Round 1 ruled this exact defect a blocking `code-bug` on the code loop, and F4 is the same defect on the spec loop — approving it now would apply a looser bar to the identical thing. Second, the test: F3's defective string is asserted in both states by a green test, so "fold it in at QA" is actively obstructed — a later fixer hits a red suite and may conclude the fix is wrong. That is the same trap the prior cycle documented, and it is what converts F3 from a wording nit into something worth one more cycle.

**A note on iteration count.** This is the third code-review round across two cycles, and the same class — *an operator-facing surface that does not disclose a state write, or promises a resume order that is false in one state* — has now produced findings in every one. That is the "same bug class at a new location, round after round" signal, and it is why F4 asks for one shared clause across both loops rather than a second copy-paste. If iteration 3 closes the class rather than the instance, this converges; if it patches only the two named sites, expect a fourth round on the next surface.

---

## Round 3 — re-review after iteration 3

Iteration 3 closed the class at the code layer, which is what Round 2 asked for. Both blocking findings are fixed, verified by **executing** the evaluator in all four states rather than reading the source.

### Stage 1 — Spec Compliance (gate)

#### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

Round 2 flagged iteration 2's re-run table as a *partial* gate. **That gap is closed** — iteration 3's table covers the full gate, including `npm test` and `sync-templates:check`. Re-run independently anyway:

| Check | Re-run result | Verdict |
|---|---|---|
| `npm run lint` | exit 0 | Real |
| `npm run type-check` | exit 0 | Real |
| `npm test` | **1099 pass / 0 fail / 0 skipped** | Real |
| `npm run build` + dist reproducibility | rebuilt; `git status --porcelain -- dist` empty **and** `diff -rq` vs pre-build copy identical | Real |
| `npm run docs-refs-check` | `All refs OK` | Real |
| `npm run sync-templates:check` | `All canon-managed files in sync` | Real |
| `git diff --check` | clean | Real |

`git diff a96b733 cc1b3da` matches the iteration-3 Changes table exactly — 6 source/prose files plus `dist/scripts/run-task.js`, nothing dropped, nothing undeclared. All 9 Non-Goals hold. Across the whole branch exactly one test declaration was ever deleted (the AC-20(C)-mandated inversion, adjudicated in Round 1); iteration 3 removed two assertions and added six — net strengthening. Both named vacuity traps remain closed.

**Stage 1 result: PASS.**

#### Acceptance Criteria Check

**All 24 ACs Met**, rebuilt from scratch by the anchored lens. AC-8, AC-9, AC-10, AC-21 and AC-24 were verified by *executing* all four reason strings (spec/code × revision-pending/revision-done) rather than by reading source — the `MAX_REVIEW_LOOPS`-before-reset index ordering holds in all four (267<372, 317<422, 373<614, 424<665), no `phases.` token appears in any, `--step` appears in none, and `cap=0, count=0` blocks in both evaluators.

#### Round 2 blocking findings — fix verification

| Round 2 finding | Status | Evidence |
|---|---|---|
| **F3** — the reset clause was state-independent; its trailing half was false at the backstop and contradicted the adjacent resume clause | **Fixed** | The clause moved into `resetSemanticsClause()` (`review-loop.ts:51-64`), which appends "Raise the cap instead if you want the deferred `<revision>` to run before review." **only** when `revisionNotDone`. Executed backstop string no longer contains it; the self-contradiction is gone in every state. |
| **F3 (test half)** — the both-states loop pinned the defective text | **Fixed** | `tests/run-task-code-review.test.ts:402-405` is now a state-discriminating quartet (`match` on pending, `doesNotMatch` on done, for both loops). The F2 artifact/pre-flight assertions correctly stayed in the both-states loop at `:393-397`. No assertion was weakened — the removed phrase was replaced by an equal-strength one. |
| **F4** — disclosure existed only on the code loop; ≥3 surfaces open | **Fixed, as class closure not a patch** | `resetSemanticsClause(revisionPhase, reviewPhase, revisionNotDone)` derives both the artifact noun and the revision noun from its parameters and is consumed by `buildSpecReviewReason:74` and `buildCodeReviewReason:102`. There is no second copy anywhere. Both loops now disclose, pinned for all four states. All three prose surfaces Round 2 named landed and were checked for accuracy against the code: `recovery.md:31` (+ regenerated mirror), `product-context.md:76`, `pipeline-orchestrator.md:381`. |

This is the outcome Round 2 asked for: one shared clause, not a second copy-paste.

### Stage 2 — Code Quality

**No surviving `code-bug` or `spec-gap` findings.** Per this round's synthesis discipline, wording-only and cleanup items are recorded below but do not drive the verdict.

#### Nits and follow-ups (non-blocking)

- **N21 — the `reset-code-review` command-table row is now stale because of this diff.** *(anchored)* `docs/pipeline-orchestrator.md:122` describes the command as zeroing counters, clearing verdict, archiving `review.md`, and dropping the session — with no mention of the `implement → done` write this task adds at `src/task/index.ts:1128-1130`. Unlike the `reset-spec-review` row above it (pre-existing incompleteness), this row went stale *because of* this change, and the file is canon-owned with a live adopter mirror. One sentence plus `npm run sync-templates`. The strongest remaining item; folded here rather than blocked on because the code-layer class closure — the thing that prevents recurrence — did ship, and Round 2's own warning was against spending a round per newly-enumerated prose surface.
- **N22 — `recovery.md`'s "Phase mismatch" section is now narrower than its heading.** *(cold-Claude)* The section covers "pipeline routes to `spec` when you expected `spec_review`", which happens on *every* ordinary revision round, but the rewritten Cause and Fix now address only the cap-block case; "raise the cap and resume" does not apply when no block occurred. AC-22 is satisfied (it required only that the section stop prescribing a counter reset). Adopter-shipped.
- **N23 — `docs/architecture.md:174` and `src/cli/index.ts:74`** also describe the reset commands without the predecessor write. Internal-only, no adopter mirror, and both defer to the recovery section. Full class inventory: 7 surfaces, 5 now disclose.
- **N24 — stale comment.** *(cold-Claude)* `src/cli/commands/watch.ts:407-414` still says an auto-block is one of the "real stop" conditions, directly above the body where the `findFirstBlockedPhase` check was deleted.
- **N25 — `reset-code-review` refuses when `implement.status === 'in_progress'`.** *(cold-Claude, P2 as filed — downgraded)* Verified the premise and it does not reach the loop-cap block state: the guard at `phases/implement.ts:36` runs **before** `taskPhase(…, 'implement', 'in_progress')` at `:72`, so a loop-cap block always leaves `implement: pending`. The `in_progress` variant arises only from a killed process mid-implement, which is an interrupted-run state, not a block state — so `pipeline-orchestrator.md`'s "Both reset commands run directly from the loop-cap block state" is accurate as written. Refusing is the deliberate N4 narrowing (declaring partial work done would bypass the implementation gate), it fails closed with a clear message, and recovery exists (raise the cap, or `canon task phase <id> implement pending`).
- **Test-strength items**: `assert.notEqual(..., 'auto_block')` at `tests/watch.test.ts:347` asserts only what the result is *not*; F3's new guards anchor on the full replacement phrase rather than the broader `/raise the cap instead/i` (verified safe — neither backstop string contains "instead" anywhere), so they pin the instance rather than the class; `assert.match` on stderr still cannot see N1's duplicate warning; `raw.replace('.', '\\.')` escapes only the first dot.
- **Standing, unchanged**: N1 (duplicate `MAX_REVIEW_LOOPS` warning, both lenses again), N2 (`classifyIdle`'s `probeAlive = () => false` default, both lenses again), N3/N4 (Deviations rows present, no code change needed), N5 (`autoBlockSpecReview` wrapper bypass), N6, N7, N8, N9, N12, N13, N16, N17, N19, N20. Plus new: `policy.ts:26` now pulls `env.ts`'s module-load side effects (a `git rev-parse` spawn and a `package.json` read) into every consumer.
- **N18 withdrawn — my Round 2 finding was wrong.** I recorded `maxIter` in `phases/code-review.ts:238` as a redundant re-derivation surviving only to feed a log line. Verified against source this round: it also feeds the metrics `iteration` field at `:305` and `:334` and, load-bearingly, gates session resumption at `:329` (`const reviewResumeId = maxIter > 0 ? resumeId : null`). `codeReviewCheck.count` is reviewer rounds **plus** pre-flight rejections — a different quantity — so substituting it would make a task with 0 reviewer rounds but ≥1 pre-flight rejection try to resume a review session that never existed. Do not "fix" this.
- **N14 — operational, independent of this verdict.** `docs/pipeline-invocations.md` is still dirty (+25 lines, up from +22), tracked, non-`tasks/`, and is the only such file. It **will** trip `canon run --pr`'s base-drift gate. It must land or be reverted before the PR step.

### Dismissed Cold Findings — Round 3

- **Dismissed (cold-Codex): "Clear the stale review block after a stepped revision" (P2)** — and **Dismissed (cold-Claude): the same behavior (P2)**. Cross-model agreement, so dismissed only on explicit spec evidence: **AC-4 requires the marker to persist** — *"the agent log records exactly one `claude` invocation and `phases.spec_review.status` is still `blocked` (never `in_progress`)"* (spec.md:90) — so cold-Codex's proposed fix (clear the review phase to `pending` when the deferred revision starts or completes) would directly violate an approved AC and break the continuation contract AC-3/AC-4 establish. Its alternative ("make watch distinguish this deferred state") is the half **AC-20** settled deliberately on liveness, explicitly rejecting phase-identity gating (spec.md:250, and AC-20(D) names the phase-identity rule the load-bearing regression case). Confirmed the marker is genuinely never cleared until the review phase runs, and that `deriveTopLevelStatus` still advances correctly to `code_review`, so the pipeline itself is unaffected. **Escalated to QA below** — third round, two model families.
- **Dismissed (cold-Claude): `accept --force` can mark `code_review` done while `implement`/`plan` is pending, so the next implementation ships unreviewed (P2).** AC-18(b) and (c) mandate these exact negative cases and their printed `Next phase` lines. The downstream skip is inherent to `--force` semantics and pre-existing — `--force` has always bypassed `priorIncompletePhases()` — so this diff normalizes and tests a hazard it did not create. Same dismissal as Round 2.
- **Dismissed (cold-Claude): PID reuse can mask a genuine auto-block (P2).** Standing N8, flagged by both lenses across rounds. spec.md:244 argues the premise (every `autoBlockPhase` call site is followed by `process.exit(2)` in the same synchronous stack — re-verified this round across all 7 call sites, including the 2 new ones). PID recycling is the acknowledged hole in that premise, not a new defect.
- **Dismissed (cold-Claude): `reset-code-review` throws for `implement.status === 'in_progress'` with no documented recovery (P2).** Downgraded to N25 above — the state is unreachable from a loop-cap block, since the guard precedes the `in_progress` write.
- **Dismissed (cold-Claude): `MAX_REVIEW_LOOPS="-0"` yields cap `-0` and blocks immediately (P3).** `-0 === 0` in JS, and cap `0` blocking immediately is the documented "suicidal override" AC-21 requires (`tests/pipeline-policy.test.ts:92`, unmodified). `-0` behaving as `0` is correct, not a defect.
- **Dismissed (cold-Claude): `MAX_REVIEW_LOOPS=0` blocks a brand-new task at `spec` with text that names a revision that never happened (P3).** Standing N6. Spec-mandated: AC-13 carves cap `0` out by name as "the deliberate immediate-block sentinel… not a first-pass exemption", and AC-21(b) requires it to reach the evaluators and block.
- **Dismissed (cold-Claude): the plain raised-cap test never asserts a revision prompt or resumed session, so it passes with the wrong-prompt bug live (P3, test integrity).** AC-24 specifies phase-transition and invocation assertions, not prompt selection; asserting prompt selection would require fixing the backlogged `promptSpecRevision` defect, which Non-Goals excludes. The test asserts nothing false — its name is broader than its assertions. Naming nit, not compromised integrity.
- **Dismissed (cold-Claude): `taskResetCodeReview` prints "implement → done" even when implement was already done (P3).** The message states end state, not a delta, and mirrors the sibling it was required to mirror — `taskResetSpecReview` has always printed `spec → done` unconditionally on the same no-op path. This is precisely the fix Round 1 demanded. Same dismissal as Round 2.
- **Dismissed (cold-Claude): `--until` exits `0 reason=until` for a genuinely blocked phase (P3).** AC-20(B) and (D) mandate exactly this, and `tests/watch.test.ts` pins it per those ACs.
- **Dismissed (cold-Claude): ambiguous-PID now precedes the blocked check, flipping exit 3 → exit 2 (P3).** AC-20(E) mandates the reorder and calls it red-first against today's behavior; spec.md:248 explains why (a stale block marker was skipping the refusal-to-attach guard).
- **Dismissed (cold-Claude): `revisionPhaseNotDone` should use `some()` (P3).** Third time. spec.md:59 mandates `every()` by name, citing `docs/patterns.md`, and notes mixed bundles are refused upstream by `assertSamePhase()`.
- **Dismissed (cold-Claude): `autoBlockPhase` skips the mutation when the phase entry is absent (P3).** `state.ts:399-418` unchanged by this diff; only call sites added. The scaffold always creates every phase entry.
- **Dismissed (anchored): AC-6(d)'s literal "differ **only** in the resume-order clause" is now violated by three clauses.** Both extra state-dependent clauses were *mandated fixes* — `blockTimingClause` for the prior cycle's F1, `resetSemanticsClause` for Round 2's F3. Adjudicated across Rounds 1–2 and unchanged. Recorded as an accumulated spec-text deviation deserving a one-line spec amendment, not a code change.

### For the Human / QA

1. **The `promptSpecRevision` deferral now has three consumers pointing at it.** *(flagged by both lenses again this round)* Iteration 3 added a *second* explicit "deferred spec revision" promise to the spec-loop reason. Both promises are literally true about which phase runs and false about what it does — `routeBackTo('spec')` clears the verdict `phases/spec.ts:26` keys on, so the deferred revision gets `promptSpec` with `resumeId: null` and re-authors from scratch. On the spec loop, all three advertised paths now land somewhere other than "address the review findings against the existing spec." Human-approved deferral with a `docs/BACKLOG.md:854` entry — but this diff increased exposure to it, and it deserves promotion rather than another quiet carry-forward.
2. **`canon watch --until <review-phase>` reports a phase that never ran as settled** after a cap-raised `--step` resume. Spec-mandated (AC-4 + AC-20(B)) and therefore dismissed above, but flagged now by two model families across two rounds. Mitigating: `--step` is in the synchronous set (`main.ts:3423`, `isSynchronousMode`) and never auto-detaches, and the orchestrator doc states plainly that a foreground `--step` needs no `canon watch` — so the combination that triggers it is one the docs already say is unnecessary. Worth a backlog entry rather than a spec amendment.
3. **`docs/pipeline-invocations.md` must land or be reverted before `canon run --pr`.**

### Final Verdict — Round 3

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Stage 1 clean, all 24 ACs met, full gate independently re-run and green (1099/1099, `dist/` byte-reproducible), and both Round 2 blocking findings genuinely fixed — verified by executing the evaluator in all four states, not by reading the diff. Zero surviving correctness bugs and zero spec gaps.

**Why this converged.** Round 2 predicted: close the class and this ends; patch the instance and expect a fourth round on the next surface. Iteration 3 closed the class at the code layer with one shared parameterized helper, which is why the residual items are now documentation completeness rather than new instances of the defect. N21 is the one item I would fold in during QA — a single sentence on `docs/pipeline-orchestrator.md:122` plus `npm run sync-templates`, since that row went stale because of this diff and ships to adopters.

**One correction to my own Round 2 record**: N18 was wrong. `maxIter` is not a redundant re-derivation — it gates review-session resumption at `phases/code-review.ts:329`. Do not act on it.
