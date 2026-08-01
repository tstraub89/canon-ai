# Code Review: preroute-review-loop-autoblock

> Reviewer: Claude | Spec: `tasks/preroute-review-loop-autoblock/spec.md`
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

Both Claude lenses re-ran the gate independently rather than trusting the handoff. All checks are real:

| Check | Handoff claim | Independently re-run | Verdict |
|---|---|---|---|
| `npm run lint` | Pass | Pass | Real |
| `npm run type-check` | Pass | Pass | Real |
| `npm test` | Pass (1080/0/1 skipped) | Pass (1081/0/0) | Real |
| `npm run build` + `git diff --exit-code -- dist/` | Pass | `dist/` reproduces byte-identical | Real |
| `npm run docs-refs-check` | Pass | `All refs OK` | Real |
| `npm run sync-templates:check` | Pass | `All canon-managed files in sync` | Real |

**Red-first claims re-verified**, not accepted on assertion. The anchored lens reverted each source file to `main` in turn, ran the new tests, and restored (tree confirmed byte-identical afterward):

| Reverted | Pre-fix result |
|---|---|
| `phases/spec.ts` | AC-1/AC-5 fail: `actual: ['claude'], expected: []` |
| `phases/implement.ts` | AC-2(a)/(b) fail: `actual: ['codex'], expected: []` |
| `phases/spec.ts` / `phases/implement.ts` | AC-4 fail: exit `0` vs `2`; `['codex','codex']` vs `['codex']` |
| `phases/spec-review.ts` | AC-9/AC-10(b)/AC-11 fail: resume clause `undefined` |
| `src/task/index.ts` | AC-16(a)/AC-17 fail: `Current phase: implement.` |

This closes the spec's two largest stated test-integrity risks: the fake agents genuinely log (green tests observe `['claude']`/`['codex']`, so the empty-log assertions are live, not vacuous), and the AC-10 phase-name assertions capture a full backticked token via `` /runs `([a-z_]+)`/ `` + `assert.equal`, so the `spec`-is-a-substring-of-`spec_review` trap is avoided.

**Handoff Changes table vs. actual diff**: all 14 changed files declared, none undeclared.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `spec`-entry block before Claude | Met | `tests/run-task-safety.test.ts:4699` — empty agent log, exit 2, `spec_review` blocked, escalation `phase: spec_review`. Red-first re-verified. |
| AC-2: `implement`-entry block before Codex | Met | `tests/run-task-safety.test.ts:4760` (case a) + `:4838` (case b, 1 iter + 2 preflight). Both assert empty log, exit 2, `code_review` blocked, escalation appended, and `git rev-parse main` unchanged. Fixture is `worktree:false`, so `commitTaskArtifactsToBase` *would* have run pre-fix — the no-commit assertion is live. Red-first re-verified. |
| AC-3: persisted state names the revision phase current | Met | Same two tests: `status==='spec'`/`'implement'`, revision phase `pending`, review phase `blocked`. |
| AC-4: raised-cap resume runs the revision first | Met | `tests/run-task-safety.test.ts:4894` + `:4952`. Exactly one agent invocation; `--expect spec`/`--expect implement` pass the guard; `--expect spec_review`/`--expect code_review` die with the `main.ts:3457` message and zero invocations; review phase still `blocked`. Exit code correctly not asserted. |
| AC-5: bare resume re-blocks for free | Met | Second `runReviewLoopMain` call inside the AC-1/AC-2 tests: exit 2, log still empty, `escalations.length===2`, `auto_block_count===2`. Red-first re-verified. |
| AC-6: one evaluator per loop, sole source of threshold/formula/ordering/wording | **Partial** | (a) `Spec review hit`/`Code review hit` each appear exactly once, both in `review-loop.ts`. (b) all four phase modules import from `../review-loop.js`. (c) cap−1/cap/cap+1 covered. (d) pair-test present. **But** the counter formula is still duplicated inline at `spec-review.ts:91-99` (F5), and AC-6(d)'s prefix-equality assertion structurally enshrines F1. |
| AC-7: per-task combine, then max; spec loop reads its own counter | Met | Mixed bundle A(2,0)/B(0,2) vs cap 3 → no block, count 2; single (2,1) → blocks. Spec-loop inverse pair proves the spec evaluator does not read `TaskContext.iterations_current_loop`. Legacy-alias branch untested (F7). |
| AC-8: cap-raise leads, reset is the fallback, per task | Met | `indexOf('MAX_REVIEW_LOOPS') < indexOf('reset-*-review')` on both builders; reset commands are `.map(id => …).join('; ')`. |
| AC-9: no hand-edit instruction | Met | `doesNotMatch /iterations_current_loop\s*=/` and `/phases\.\w+\.status\s*=/` on both builders and on the persisted backstop reason. Red-first re-verified against the old `spec-review.ts` text. |
| AC-10: reason names the phase a resume actually runs first; never an unconditional revision promise | **Not met** | The resume *clause* is correct and state-derived in all four states. But the sentence two clauses earlier is hard-coded and unconditional — see F1. Flagged by two lenses, reproduced by the foreman. |
| AC-11: review-entry backstops retained, reason true for their own state | Met | Code half: `tests/run-task-code-review.test.ts:390` (deps seam, `events===['verifyBranch']`, exit 2, top-level `code_review`, resume clause names `code_review`). Spec half: `tests/run-task-safety.test.ts:4869` (subprocess, `revisionDone` fixture, top-level `spec_review`). Red-first re-verified. Caveat: the *reason as a whole* is not true for the backstop state (F1). |
| AC-12: `checkAndRoute()` unmodified | Met | Scoped grep of `checkAndRoute` finds no `getMaxReviewLoops`/`evaluate*ReviewLoop`; `git diff main...HEAD -- tests/run-task-reroute-preflight.test.ts` is empty; both `routeBackTo` calls confirmed unconditional at `main.ts:3110-3112` / `3187-3195`. |
| AC-13: inert on first pass and reroute | Met | Evaluators return no-block at counters 0 with `iterations_total` at cap+4 for both loops; `tests/run-task-safety.test.ts:5010` drives the real `rerouteFromHumanReview()` then asserts zeroed loop counters and preserved `iterations_total===7`. Weakest of the new tests (F10). |
| AC-14: BACKLOG entry for `promptSpecRevision` | Met | `docs/BACKLOG.md:854-858` under `## 🐛 Harness Bugs`, with mechanism + evidence + suggested direction; no prompt-selection code change (`phases/spec.ts:26` still keys on the verdict). |
| AC-15: `docs/pipeline-orchestrator.md` + mirror | Met | `:358` reworded to "reaches or exceeds" with revision-entry primary / review-entry backstop; `:372-380` documents cap-raised ordering, free re-block, both reset commands, and "no intermediate phase edit". Mirror synced. See F6 for the command-table row that was not updated. |
| AC-16: `reset-code-review` one-state widening | Met (with an unanalyzed third state) | `tests/task-cli.test.ts:915` (accept + full end-state incl. preserved `iterations_total`/`auto_block_count`, archive, session drop) and `:963` (rejects `implement`-current with `code_review` `pending`). Existing tests at `:850`/`:895` byte-unmodified. Red-first re-verified. But `implement: in_progress` is also accepted and was never analyzed — F3. |
| AC-17: advertised reset runs against genuinely-persisted block state | Met | `taskCmd(['reset-spec-review'\|'reset-code-review', id])` invoked in-process inside the AC-1/AC-2 fixtures' own lifetime, in the file that creates them, before cleanup. No cross-file ordering dependency. Code half red-first re-verified. |

### Dropped Sections Check

- [x] Non-goals respected — `checkAndRoute()` untouched, no new `status.json` field, no `promptSpecRevision` fix, no reset-helper symmetry cleanup, `taskResetSpecReview()` unchanged.
- [ ] Known Risks addressed or documented as accepted — the spec's *Interaction Dependencies* claims to have **enumerated** every gate broken by the relocation ("enumerated rather than sampled, because rounds 3 and 4 were both instances of this one class"). It missed `taskAccept`'s `priorIncompletePhases()` gate — see F2.
- [x] Human Test Plan satisfiable — steps 1–9 map onto the shipped behavior, except step 3's "which step runs first … must be the one that actually runs", which F1 partially violates at the backstop.

### Stage 1 Verdict

- [ ] **Pass** — proceed to Stage 2
- [x] **Fail** — skip Stage 2, final verdict below is `Changes requested`

AC-10 is not met and AC-6 is partial. Stage 2 findings are recorded anyway (rather than deferred) because the failing AC is narrow and localized — the surrounding implementation is sound and is not "about to change" wholesale. The correctness bugs and the spec gaps are the items that must be resolved; everything below them is graded and separable.

## Stage 2 — Code Quality

### Summary

The core relocation is well built. Moving the cap checkpoint to the revision phase's entry, keeping `routeBackTo` untouched as the continuation contract, and factoring one evaluator per loop into `scripts/run-task/review-loop.ts` is the right shape — and the shared-evaluator structure demonstrably works: both call sites agree on threshold, counter formula, and recovery ordering, which is exactly what rounds 2–4 of spec review were arguing toward. The test suite is unusually strong for this codebase: the agent-invocation logging is real, the phase-name assertions are token-anchored rather than substring-matched, and AC-17 exercises the advertised recovery against genuinely-persisted state. Every red-first claim in the handoff survived independent re-verification.

Two things did not land. First, the round-4 defect — an unconditional promise about what runs next, persisted into `escalations[].reason` — was fixed in the resume clause but reproduced verbatim one sentence earlier, and the AC-6(d) pair-test structurally cannot catch it because it *requires* that sentence to be state-independent. Second, the spec's claim to have closed the "gate on the derived current phase" bug class by enumeration is falsified: `canon task accept` is refused from both new block states, which is the same failure the round-3 finding surfaced on `reset-code-review`, at a call site the enumeration did not reach.

### Findings

#### Correctness Bugs

**F1 — `code-bug` — the reason's second sentence contradicts its own resume clause at the backstop.** *(flagged by 2 lenses: anchored + cold-Claude; reproduced by the foreman)* — `scripts/run-task/review-loop.ts:42`, `:69`

`buildSpecReviewReason` hard-codes `Pipeline auto-blocked before the next spec revision.` and `buildCodeReviewReason` hard-codes `Pipeline auto-blocked before the next re-implementation.` — unconditionally, in both states. At the review-entry backstop these are false, and the same persisted string then says the opposite. Foreman-reproduced output for `spec.status='done'`, `spec_review` at cap:

```
Spec review hit 3 changes_requested iterations in a row (limit: 3). Pipeline auto-blocked
before the next spec revision. […] Resuming after raising the cap runs `spec_review`
directly; `spec` already completed its revision.
```

and the mirror for the code loop (`before the next re-implementation` … ``runs `code_review` directly; `implement` already completed its revision``).

AC-10 requires the reason to "never [make] an unconditional promise that a revision runs next," and AC-10(b) requires the backstop reason to not "promise a revision first." `autoBlockPhase` (`state.ts:399-416`) persists this into `escalations[].reason`, so the contradiction is durable operator guidance, not console noise. This is precisely the defect class the round-4 spec revision exists to close, reproduced one clause earlier in the same string.

The test that was supposed to pin it cannot: `tests/run-task-code-review.test.ts:734`'s `stripResumeClause` assertion requires the *entire* pre-clause prefix to be byte-identical across the `pending`/`done` pair — so it actively requires the defective sentence to stay state-independent. Fixing the code without relaxing that assertion will fail the suite.

*Fix direction*: derive the "auto-blocked before …" sentence from `revisionNotDone` alongside the resume clause (one helper, both sentences), and narrow AC-6(d)'s pair assertion from whole-prefix equality to the tokens it actually cares about — iteration count, cap, and the recovery commands in order.

**F2 — `spec-gap` — `canon task accept <ids> <review-phase>` is refused from both new block states.** *(flagged by cold-Claude; empirically confirmed by the foreman)* — `src/task/index.ts:381-385` (gate), `:687-693` (call site)

`taskAccept` runs `priorIncompletePhases(status, phaseArg)` and throws when any earlier phase is not `done`. The relocation leaves the revision phase `pending`, so the prior phase is incomplete by construction. Foreman-verified on a fixture with `implement: pending` / `code_review: blocked`:

```
Error: cannot accept code_review for 't1' — prior phases not done: implement
```

Flipping the same fixture to the *pre-change* block shape (`implement: done`) makes the identical command succeed (`Accepted t1: code_review → done. Next phase: qa.`). The spec loop has the identical hole (`prior phases not done: spec`).

This is a real regression in a documented recovery: `canon task accept <ids> code_review --reason "<why>"` is the bless path at `docs/pipeline-orchestrator.md:355` and `:176`. It is the third option a human has at a loop-cap block — "this is good enough, sanction it and move on" — and it is now reachable only via `--force`, which simultaneously disables the verdict-existence guard at `src/task/index.ts:708-719`.

Why this is `spec-gap` and not `code-bug`: the spec never names `taskAccept`, and the fix is a semantics decision the implementer should not make alone — widening `priorIncompletePhases` for a `blocked` review phase changes `canon task accept` behavior for *every* review phase, and the alternative (document that the bless path now requires `--force`) is equally a product call. What makes it worth halting for is that the spec explicitly claimed this class was closed by enumeration; `priorIncompletePhases` is a phase-status gate broken by the relocation in exactly the way `taskResetCodeReview`'s precondition was (the round-3 finding), and the enumeration only swept `deriveTopLevelStatus()` consumers.

#### Risk / Guardrails

**F3 — `code-bug` — `reset-code-review` also accepts `implement: in_progress` and silently marks partial work `done`.** *(flagged by anchored; sharpened by cold-Claude)* — `src/task/index.ts:1086-1090`, `:1101-1103`

The widened conjunct is `currentPhase === 'implement' && code_review.status === 'blocked'`. `currentPhase === 'implement'` is satisfied by `implement.status` ∈ {`pending`, `in_progress`, `blocked`}, not just `pending`. The spec analyzed exactly two states (`code_review`-current → no-op; new state with `implement: pending`) and AC-16(c) only pins the `code_review: pending` axis, so the `in_progress` axis went unanalyzed.

*Failure scenario*: revision-entry block leaves `implement: pending` / `code_review: blocked`. Operator raises the cap and resumes; `runImplementPhase` sets `implement: in_progress` (`implement.ts:72`) while `code_review` stays `blocked` for the entire implement window — nothing clears it until `runCodeReviewPhase` writes `in_progress`. Codex crashes or the operator interrupts. The operator then takes the message's other advertised option, `canon task reset-code-review <id>` → **accepted**, and it writes `implement.status = 'done'`, declaring a half-written implementation complete and routing straight to review of partial work.

Compounding: the write is raw, not routed through `taskPhase()`, so `checkPhaseGate('implement')`'s `handoff.md` artifact requirement (`scripts/run-task/validation.ts:875`, and lines 898-912) never runs. In the pre-flight-driven case the block message itself calls out ("If repeated failures were all pre-flight, the handoff format itself may be wrong"), a still-malformed `handoff.md` gets declared complete, pre-flight rejects again, and the loop restarts with counters zeroed. The raw-write shape is inherited from `taskResetSpecReview()`'s `spec → done` and the spec cites that as precedent, so the bypass itself is pre-existing — the *newly reachable* `in_progress` state is not.

*Fix direction*: tighten the conjunct to `status.phases.implement?.status === 'pending'` and add the `in_progress` rejection case alongside AC-16(c)'s.

**F4 — `code-bug` — the `>=` → `<` inversion turns a degenerate cap from "guard silently off" into "every task bricked at its first revision phase."** *(flagged by anchored; foreman-reproduced)* — `scripts/run-task/review-loop.ts:84`, `:119`

The refactor rewrote `if (count >= cap) block` as `if (count < cap) return no-block; …block`. These are not equivalent under `NaN`. `MAX_REVIEW_LOOPS` is parsed with a bare `Number.parseInt` and never validated (`policy.ts:25`, `env.ts:136`), and `pipeline-policy.ts` uses `config.maxReviewLoops ?? default`, so `NaN` survives to the evaluator. Foreman-reproduced:

```
cap=NaN  spec blocked= true | code blocked= true
cap=0    spec blocked= true | code blocked= true
```

Pre-change, `0 >= NaN` was `false` → inert. Post-change, `0 < NaN` is `false` → falls through and blocks. Every task then hard-stops at its `spec`/`implement` entry with zero agent invocations and a reason reading `limit: NaN`, whose advertised recovery is "raise the cap" — which the operator believes they already did. `MAX_REVIEW_LOOPS=0` (a truthy string, so it wins over the size-aware default) similarly now blocks the *first* spec authoring and the *first* implement, where pre-change the spec at least got written before the review-entry block.

Both failure modes require operator misconfiguration and both were already wrong pre-change — the relocation changed *which* wrong. Ranked here rather than as a nit because the post-change failure is total and the message is unactionable. The clean fix is validating `MAX_REVIEW_LOOPS` (`Number.isInteger(n) && n >= 1`) at parse time; restoring the `>=` comparison is the one-token mitigation that at least reverts to prior semantics.

**F5 — `code-bug` (AC-6 partial) — the counter formula the evaluator is meant to own is still duplicated inline.** *(flagged by 2 lenses)* — `scripts/run-task/phases/spec-review.ts:91-99`

`maxSpecIter` still recomputes `iterations_current_loop ?? iterations ?? 0` maxed over tasks — the exact formula AC-6 requires the evaluator to be "the sole source" of. It survives only to feed the telemetry `iteration: maxSpecIter` at `:118`, and `specReviewCheck.count` is the identical value. Change `specReviewIterations()` and this copy silently does not follow, so the metrics row and the cap decision would disagree about which round is running. (`code-review.ts:238`'s `maxIter` is a genuinely different quantity — reviewer rounds only, no pre-flight — and is not the same problem.)

*Fix direction*: either use `specReviewCheck.count` for the telemetry field, or export `specReviewIterations` and call it.

#### Optional Cleanup / Nit

**F6 — the `implement → done` write is invisible to the operator in both the success message and the command-table doc.** *(flagged by 2 lenses)* — `src/task/index.ts:1119-1121`, `docs/pipeline-orchestrator.md:122` (+ mirror)

`taskResetSpecReview`'s success line says `spec → done` (`:1071`); `taskResetCodeReview`'s does not mention `implement` at all. The command-table row at `:122` enumerates every other field the helper touches ("Zeroes the loop-local review counters, clears verdict, archives the prior `review.md`, and drops the stored `sessions.claude_review` ID") but not this one. The spec's own Known Risks call the write out as "a real state write on the new one" — the operator gets no signal that a pending re-implementation was just cancelled. Compounds F3. (`:121`'s `reset-spec-review` row has the pre-existing equivalent omission, so one edit fixes both.)

**F7 — the legacy-alias fallback is never exercised.** *(flagged by 2 lenses)* — `scripts/run-task/review-loop.ts:11` vs. `tests/run-task-code-review.test.ts:153-160`

`reviewLoopContext()` always writes *both* `iterations` and `iterations_current_loop`, so deleting `?? task.status.phases.spec_review?.iterations` would not fail a single test — even though AC-7 names preserving it as a requirement. A legacy `status.json` with only `iterations` would then read as `0` and never block, silently disabling the guard for exactly the old tasks most likely to have burned rounds. One fixture omitting `iterations_current_loop` closes it.

**F8 — `evaluateCodeReviewLoop([])` throws while `evaluateSpecReviewLoop([])` returns cleanly.** *(flagged by 2 lenses; foreman-reproduced)* — `scripts/run-task/review-loop.ts:114-119`

`perTask.reduce(fn, perTask[0])` supplies `undefined` as the explicit initial value on an empty array, so `worst.combined` throws `TypeError: Cannot read properties of undefined`. Unreachable from the two production call sites (`taskIds` is validated non-empty upstream) and inherited verbatim from the deleted `code-review.ts:255`, but the function is now an exported shared API with its own unit-test surface, and its sibling handles the same input.

**F9 — two spellings for the same block operation.** *(flagged by 2 lenses)* — `scripts/run-task/phases/spec.ts:22` vs. `phases/spec-review.ts:103`

`spec.ts` calls `autoBlockPhase(taskIds, 'spec_review', …)` directly; `spec-review.ts` routes through the `autoBlockSpecReview()` wrapper, which is currently only that call. Identical today; if the wrapper ever gains a step (clearing `sessions.codex_spec_review`, stamping the artifact), the spec-entry call site silently skips it. Route both through the wrapper, or drop it.

**F10 — the reroute-inertness test stops short of the production path.** *(flagged by anchored)* — `tests/run-task-safety.test.ts:5010`

It drives the real `rerouteFromHumanReview()` (good) but then hand-builds a `TaskContext` and calls `evaluateCodeReviewLoop` directly instead of entering `runImplementPhase`. It therefore cannot catch a regression where the *checkpoint* reads a different counter than the *evaluator* — precisely the "Wrong counter for the spec loop" risk the spec names. AC-13 permits "integration or state-level", so this is compliant; it is just the weakest of the new tests.

**F11 — `--step` makes the advertised cap-raise a two-invocation recovery, and neither the message nor the docs say so.** *(flagged by cold-Claude)* — `scripts/run-task/review-loop.ts:44`, `:71`; `docs/pipeline-orchestrator.md:372`

Both builders advertise `MAX_REVIEW_LOOPS=<n> canon run <ids> --step`. Under the relocation, `--step` runs exactly one phase — the revision — and exits; the operator must re-export `MAX_REVIEW_LOOPS` for the follow-up invocation or the backstop blocks again *after* a full agent session was spent. Pre-change this was one invocation, because the block sat at the review entry. The behavior is spec-intended (AC-4 pins it), so this is a wording finding: drop `--step` from the recommendation (a plain `canon run <ids>` runs both phases in one process with the env var already set), or state that the variable must be present for both steps.

**F12 — integration fixtures never exercise the size-aware default cap at the new call sites.** *(flagged by cold-Claude)* — `tests/run-task-safety.test.ts:848`

Every fixture injects `MAX_REVIEW_LOOPS` explicitly, so if `getMaxReviewLoops`'s policy lookup regressed for a size class, the new implement/spec gates would silently stop firing in real runs while all tests stay green.

#### Spec Gaps

**F2 (above) — `canon task accept` refused from both new block states.** Restated here as the spec-gap of record: the spec's *Interaction Dependencies* enumeration closed the `deriveTopLevelStatus()`-consumer class but not the phase-status-gate class that `priorIncompletePhases()` belongs to, and it is the same failure shape as the round-3 finding.

**F13 — three operator-guidance surfaces outside the spec's Docs Impact are now stale or actively wrong.** *(flagged by cold-Claude; all three foreman-verified)*

The spec's Docs Impact states "`docs/architecture.md`, `docs/codebase-map.md`, `docs/decisions.md`, `docs/product-context.md` — none expected to go stale." That is falsified, and a fourth surface the spec did not consider at all is the most dangerous:

- `.claude/skills/canon-pipeline/recovery.md:37` — the section "Phase mismatch — pipeline routes to `spec` when you expected `spec_review`" now describes the new block's *exact* symptom (foreman-confirmed: the block leaves the derived phase at `spec`, and `tests/run-task-safety.test.ts` pins that `--expect spec_review` dies). Its prescribed Fix is `canon task reset-spec-review <task-id>`, which zeroes `iterations_current_loop` — directly contradicting "**Never reset the iteration counter** to bypass the cap. Counter is durable signal" three lines earlier in the same file. Its stated Cause (`spec_review.verdict === 'changes_requested'` still set) is also wrong for this state. This file has a `templates/` mirror, so it ships to adopters.
- `docs/architecture.md:174` — "Manual intervention required (reset phase + `iterations_current_loop`; see recovery below)" is the exact `status.json` hand-edit AC-9 removed from the emitted message, and it still implies the block fires at the review phase. `:82` likewise says spec_review "routes back to spec (or auto-blocks if cap hit)".
- `docs/product-context.md:76` — "reset the relevant phase via `canon task phase <id> <phase> pending`" and names only `reset-code-review`.

Classified `spec-gap` rather than `code-bug` because the spec affirmatively told the implementer these files were fine. Whether to sweep them in this task or file a follow-up is the human's call — but `recovery.md` prescribes an action this project has a standing rule against, for a state this task creates.

### Dismissed Cold Findings

- **Dismissed (cold-Claude)**: *`revisionPhaseNotDone` uses `every()` where `some()` is semantically correct* — the spec explicitly chose `every()` and cites `docs/patterns.md` "Bundle-gate conditions must use `every()`, not `some()`, on per-task flags" (spec *Decision*, paragraph beginning "The single thing that legitimately differs"). The mixed-bundle case cold-Claude constructs is refused by `assertSamePhase()` (`main.ts:237`, called at `:3453`) before any phase runs, which the spec also names. Explicit spec evidence, so this is not a silent cross-lens dismissal.
- **Dismissed (cold-Claude)**: *loop-cap-blocked tasks no longer surface as blocked in `canon task list`* — the spec names this surface explicitly in *Interaction Dependencies* ("three display surfaces that print whatever the true current phase is — `derivePhase()` for `canon task list` … accurate rather than stale — no AC, no code change, but named here so it is a decision rather than an oversight"). The added claim that the row previously "paired with the escalation" does not hold: `derivePhase()` returns `deriveTopLevelStatus()`, a phase *name*, never a status — no blocked indicator existed in `task list` before this change either.
- **Dismissed (cold-Claude)**: *the message calls it "the deferred revision" but `promptSpecRevision` never fires, so a from-scratch rewrite runs* — the claim about prompt selection is correct, but AC-10 requires the reason to name the *phase* a resume runs first, and `spec` is that phase; it does rewrite the spec. The prompt-selection defect is separately recorded at `docs/BACKLOG.md:854-858` per AC-14 and explicitly non-goaled. Not a defect in this diff.
- **Dismissed (cold-Claude)**: *`stripResumeClause` equality assertion is near-tautological* — correct as stated, but the real problem with that assertion is not that it is weak, it is that it enshrines F1. Folded into F1 rather than dismissed on the merits.
- **Dismissed (cold-Claude)**: *`runImplementPhase` has no `deps` seam, unlike `code-review.ts`* — a design preference, not a defect. `runImplementPhase` has no `deps` parameter today for any of its behavior; adding one for this gate alone is out of scope, and the spec required the checkpoint above `commitTaskArtifactsToBase`/`ensureBranch`, which the subprocess test verifies directly.
- **Dismissed (cold-Codex)**: no findings were returned. Type checking, linting, and the full suite passed on its run — consistent with both Claude lenses' independent re-runs. Recorded for completeness; a clean cold-Codex lens is not treated as evidence of a clean diff.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

**Must fix before ship**: F1 (AC-10 not met — the unconditional "auto-blocked before the next revision" sentence, plus the AC-6(d) assertion that enshrines it), F3 (`reset-code-review` accepting `implement: in_progress`), F4 (degenerate-cap inversion), F5 (duplicated counter formula, AC-6 partial).

**Flagged for the human, not fixable at `implement`**: F2 and F13 are `spec-gap`. F2 is the one that matters — `canon task accept` is a documented recovery that this relocation silently broke in exactly the way the round-3 finding broke `reset-code-review`, and the spec claimed that class was closed by enumeration. Whether to widen the accept gate, document the `--force` path, or defer is a spec decision. F13's `recovery.md` entry now prescribes counter-zeroing for a state this task creates, against a standing project rule; it ships to adopters via the `templates/` mirror.

---

## Round 2 — verifying iteration 2's response to round 1

### Stage 1 — Validation Gate and Acceptance Criteria Re-Check

**A note on the handoff's two `Fail` rows.** Codex's Iteration-2 Validation Outcomes table reported `npm test` **Fail (6 failures)** and `npm run docs-refs-check` **Fail**, attributing both to a malformed multi-location citation in the reviewer-owned `review.md`. That attribution was correct and honest. The defect was mine: Round 1's F3 paragraph cited `scripts/run-task/validation.ts` with a `:875, 898-912` suffix, which `docs-refs-check` parses as a literal path. Cold-Codex flagged it as P1. The foreman fixed the citation (and the echoed copy in `review-cold-codex.md`) before this round's lenses ran. Codex was right not to edit a reviewer-owned artifact, and right to flag rather than silently pass.

The anchored lens confirmed the attribution was not a cover for a real regression: `git diff HEAD -- scripts/ src/ tests/ dist/ docs/ templates/` is empty, so the tree it validated is byte-identical to the tree that now passes. Same code + fixed artifact = green.

| Check | Handoff (Iter 2) | Independently re-run | Verdict |
|---|---|---|---|
| `npm run lint` | Pass | Pass | Real |
| `npm run type-check` | Pass | Pass | Real |
| `npm test` | Fail – unrelated (6) | **Pass — 1082/0/0** | Attribution honest; resolved |
| `npm run build` + `git diff --exit-code -- dist/` | Pass | Pass — byte-identical | Real |
| `npm run docs-refs-check` | Fail – unrelated | **`All refs OK`** | Attribution honest; resolved |
| `npm run sync-templates:check` | Pass | Pass | Real |

**Test integrity re-verified from scratch.** The anchored lens reverted each changed file in turn and restored byte-identical. The round-2 tests are genuinely red-first: reverting `review-loop.ts` to iteration 1 fails 2 tests (F4's `limit: NaN` block at count 0, and F1's `auto-blocked before the next spec revision` string present in the `done`-state reason); reverting the `src/task/index.ts` conjunct fails the F3 in-progress rejection; reverting `phases/spec.ts` + `phases/implement.ts` to `main` still fails the 5 original pre-route tests.

**Handoff Iteration-2 Changes table**: commit `643cda5` touches exactly the seven files declared. Nothing undeclared, nothing missing.

| AC | Status | Notes |
|---|---|---|
| AC-1 – AC-5 | Met (unchanged from round 1) | `tests/run-task-safety.test.ts:4699`, `:4760`, `:4838`, `:4912`, `:4964`. All red-first re-verified against `main`. |
| AC-6 | **Partial → Met** | F5 duplicate deleted; telemetry consumes `specReviewCheck.count` (`spec-review.ts:109`). `review-loop.ts:61`/`:87` are the only two reason-definition sites repo-wide. `code-review.ts:238`'s `maxIter` confirmed a genuinely different quantity — it also drives `reviewResumeId` at `:329`. |
| AC-7 | Met, coverage strengthened | Legacy-alias branch now exercised by a fixture that `delete`s `iterations_current_loop` (F7 fix). |
| AC-8, AC-9 | Met | Now asserted on **both** state variants, not just one. |
| AC-10 | **Not met → Met** | `blockTimingClause()` (`review-loop.ts:36-49`) derives the timing sentence from the same `revisionNotDone` fact as the resume clause. The `stripResumeClause` whole-prefix assertion that previously enshrined the defect was correctly relaxed to `startsWith(opening)` plus explicit `match`/`doesNotMatch` on the timing sentence. Red-first re-verified. |
| AC-11 | Met | Both backstop reasons now internally consistent. |
| AC-12 – AC-15 | Met (unchanged from round 1) | `checkAndRoute` untouched; reroute-preflight test byte-unmodified. |
| AC-16 | **Met (hardened)** | `src/task/index.ts:1086-1092` now requires `implement.status === 'pending'`. Existing tests at `tests/task-cli.test.ts:850`/`:895` byte-unmodified. |
| AC-17 | Met (unchanged from round 1) | Red-first re-verified. |

**Stage 1 verdict: pass.** All 17 ACs met.

### Verifying Round 1 findings

- _code-bug F1 (unconditional block-timing sentence):_ → **addressed** (`review-loop.ts:36-49`; AC-10 now Met). The paired test-assertion relaxation was also done correctly, which was the part most likely to be missed.
- _spec-gap F2 (`canon task accept` refused):_ → **partially withdrawn, and re-grounded — see R2-1.** My round-1 evidence was wrong.
- _code-bug F3 (`reset-code-review` accepting `implement: in_progress`):_ → **addressed** (`src/task/index.ts:1088`). The narrowing also closes `implement: blocked`, which the anchored lens confirmed is separately reachable via the hallucination auto-block at `phases/implement.ts:128`. Strictly better than requested.
- _code-bug F4 (degenerate-cap inversion):_ → **addressed but in the wrong direction — see R2-3.**
- _code-bug F5 (duplicate counter formula):_ → **addressed**; AC-6 now Met.
- _F7 (legacy alias untested), F8 (empty-array throw):_ → **addressed**, both as claimed.
- _F6, F9, F10, F11, F12 (nits):_ → still open, correctly deferred. Carried forward below.
- _spec-gap F13 (stale operator guidance):_ → still open, **legitimately blocked on scope**. All three surfaces re-verified stale. Codex's refusal to widen past the Affected Files table is correct canon discipline, not avoidance.

### Stage 2 — New and re-grounded findings

#### R2-1 — `spec-gap` — the bless path reports success, persists a state that re-implements *(flagged by cold-Claude + cold-Codex; foreman re-verified; corrects Round 1 F2)*

`src/task/index.ts:687-693`, `:708-719`

**First, the correction.** Round 1 claimed `canon task accept <id> code_review --reason` "worked pre-change and is now refused." That was wrong, and the anchored lens caught why: my fixture set `code_review.verdict = 'changes_requested'`, but `routeBackTo()` clears the verdict on the target phase and every downstream phase (`main.ts:2564-2567`), so the state a loop-cap block actually persists has `verdict: ''`. Codex identified this same subtlety in its Iteration-2 note. Re-run against a faithful fixture:

| State | `--reason` only | `--force` |
|---|---|---|
| Pre-change (`implement: done`) | Refused — *no review verdict exists to sanction* | Accepted → `implement=done`, top-level `qa` |
| Post-change (`implement: pending`) | Refused — *prior phases not done: implement* | Accepted → `implement=**pending**`, top-level `**implement**` |

So the no-`--force` path was **already** refused before this change, just by a different guard. Round 1's "silently broke a working recovery" framing does not hold, and I withdraw it.

**What does hold** is the `--force` path — the only one that ever worked. Post-change it prints:

```
Accepted t1: code_review → done.
  Next phase: qa. Run `canon run t1` to continue.
```

while persisting `implement: pending`, so `deriveTopLevelStatus()` returns `implement`. The operator blessed the review to *skip* further work; the next `canon run` starts a full Codex re-implementation instead of QA. The success message is false about the very next thing that happens, and the wasted agent cycle is precisely the cost this task exists to prevent.

Altitude is `spec-gap`, and Codex's refusal to guess was correct. The fix requires choosing between: mark the pending revision `done` (mirroring `taskResetCodeReview`'s `implement → done`), refuse even under `--force`, or print the derived next phase rather than the assumed one. Each has different semantics for the deferred revision. The binding spec authorizes none of them.

#### R2-2 — `spec-gap` — `canon watch` reports a healthy resume as blocked, exit 3, for the whole revision phase *(flagged by cold-Claude; foreman verified structurally)*

`src/cli/commands/watch.ts:282`, `:332`, `:497`, `:670`

Nothing clears `code_review.status = 'blocked'` when a cap-raised resume runs: `runImplementPhase` sets only `implement` to `in_progress`, and `code_review` is untouched until `runCodeReviewPhase` starts. AC-4's own tests pin this (`spec_review.status` is still `blocked` after a successful resume).

`findFirstBlockedPhase()` scans **all** of `PHASE_ORDER`, and both `classifyAttach` and `classifyIdle` return `{kind: 'auto_block', state: 'blocked'}` **before** reaching the liveness probe. `auto_block` maps to `exit(3)`. So while Codex is actively re-implementing with a live PID and a fresh heartbeat, `canon watch <id>` prints `state=blocked reason=auto_block phase=code_review` and exits 3 — for the duration of the longest phase in the pipeline. Pre-change the blocked marker sat on the phase that resume ran first, so it cleared within milliseconds.

This is the **third instance of one class**: the relocation persists `<review phase> = blocked` while a *different* phase is current, and consumers that scan phase **statuses** — rather than the derived current phase — misread it. The first instance was Codex's round-3 spec-review finding (`taskResetCodeReview`'s precondition, fixed by AC-16); the second is R2-1; this is the third. The spec's *Interaction Dependencies* enumeration was built to close this class, but it swept `deriveTopLevelStatus()` consumers and phase-*name* display surfaces — it checked `watch.ts:128` (the phase pointer) and concluded watch was fine, missing the phase-status scanner 150 lines away. Per canon's own rule that a recurring bug class is a design signal rather than a next-instance fix, the amendment should state the contract for this state shape once, and enumerate phase-status consumers as well as current-phase consumers.

#### R2-3 — `spec-gap` — the degenerate-cap fix silently disables the guardrail *(flagged by anchored S2-1 + cold-Claude; 2 lenses)*

`scripts/run-task/review-loop.ts:7-9`

`isUsableCap()` resolves Round 1's F4, but by making the evaluator **inert** rather than by rejecting the bad input. `MAX_REVIEW_LOOPS` is still `Number.parseInt`'d with no validation (`policy.ts:25`, `env.ts:136`) and passed through unclamped.

- `MAX_REVIEW_LOOPS=abc` → `NaN` → both loops' cap guards are off at **all four checkpoints** for the whole run, with no warning. Matches `main`, so not a regression — but this task exists to strengthen exactly this guardrail, and the fix codifies the silence.
- `MAX_REVIEW_LOOPS=0` or `-1` → **regression vs `main`**, which blocked (`0 >= 0`). Now inert. An operator setting `0` to mean "no more retries" gets unlimited retries instead.

Fail-open is the wrong direction for a runaway-loop guard, and the operator setting this variable is by definition already recovering from a runaway loop. Classified `spec-gap` rather than `code-bug` because the correct fix — validate at parse time and fail loud, or `warn()` and fall back to the size-aware default — lives in `policy.ts` / `env.ts`, outside the spec's Affected Files, and the spec specifies no degenerate-cap semantics. A local patch that blocks on `cap <= 0` but stays inert on `NaN` would be incoherent.

#### Carried forward — nits, none blocking

- **F6** — `implement → done` still invisible in `reset-code-review`'s success line and `docs/pipeline-orchestrator.md:122`, unlike `taskResetSpecReview`'s message which does say `spec → done`.
- **F11** *(cold-Claude escalated to high; anchored and Round 1 both rank it a nit — recorded as a nit)* — the message advertises `MAX_REVIEW_LOOPS=<n> canon run <ids> --step`, but `--step` runs only the revision and exits; the operator must re-export the variable for the second invocation or the backstop re-blocks after a full agent session. One-token fix: drop `--step`. Worth riding along in the amendment.
- **F9** — `phases/spec.ts:22` calls `autoBlockPhase` directly while `spec-review.ts:94` uses the `autoBlockSpecReview` wrapper.
- **F10, F12** — reroute-inertness test stops short of the production path; fixtures always inject `MAX_REVIEW_LOOPS`, so the size-aware default is never exercised at the new call sites.
- **New (cold-Claude)** — `reset-code-review`'s rejection message still reads *"only operates on tasks currently at code_review. Current phase: implement"* even though the command now does operate from `implement`, just not that sub-state.
- **New (cold-Claude)** — `blockedAtImplementEntry` checks only two phase statuses, so a hand-set `code_review blocked` while implement is pending also unlocks the reset. Requires deliberate operator action to create an incoherent state.
- **New (anchored S2-2)** — the `perTask[0] ?? { taskId: '', … }` sentinel is safe only because `isUsableCap` guarantees `cap >= 1`; relax that and the reason names an empty task ID. An explicit empty-array early return would state the invariant locally.
- **New (anchored S2-3)** — AC-6(d)'s literal "differ **only** in the resume-order clause" is **superseded by AC-10**, which requires the timing clause to vary too. The implementation resolved the tension in AC-10's favour, correctly. Recorded as AC-text-superseded, not an implementation deviation.
- **New (anchored S2-4)** — AC-10(b)'s negative is pinned at the evaluator level but not asserted against the persisted `escalations[].reason`; one `doesNotMatch` line in each backstop test would satisfy the AC literally.

### Dismissed Cold Findings

- **Dismissed (cold-Claude)**: *`reset-code-review` marks `implement` done with no evidence gate from a state where the revision never ran* — spec-intended and explicitly stated: "**raise the cap** to re-run the deferred revision, **reset** to keep the current work product and get a fresh review of it" (*Decision*), with Known Risks adding "an operator who wanted a *re-implementation* rather than a re-review must raise the cap instead." The `checkPhaseGate` bypass mirrors `taskResetSpecReview()`'s `spec → done`, which the spec cites as precedent.
- **Dismissed (cold-Claude)**: *`--reroute` has no branch for the new block shape* — the spec analyzed this exactly: "Today a loop-cap block satisfies the phase conjunct at `main.ts:2351` but fails `someSpecGap`; after this change it fails both. Refused before, refused after." The diagnostic wording is imprecise for the new shape, which is a nit, not the refusal being wrong.
- **Dismissed (cold-Claude)**: *escalations grow unboundedly on repeated resumes* — spec-intended: "deliberately not deduplicated, consistent with the project rule that counters are never reset or suppressed" (*Known Risks*).
- **Dismissed (cold-Claude)**: *`revisionPhaseNotDone` uses `every()` where `some()` is correct* — dismissed in Round 1 on explicit spec evidence citing `docs/patterns.md` "Bundle-gate conditions must use `every()`"; `assertSamePhase()` refuses mixed bundles before any phase runs. Unchanged.
- **Dismissed (cold-Claude)**: *the spec-entry guard can wedge a first-ever spec write on legacy counter shapes* — `iterations` is documented in-code as the legacy alias for the **loop-local** counter, so a value at or above the cap means a live loop, not lifetime history. Blocking is correct there.
- **Dismissed (cold-Claude)**: *test-integrity — `expectedBlocked = count >= cap` mirrors the implementation; the reroute test's final assertion is arithmetically forced; no end-to-end test of resume through the review phase* — real observations, but coverage shape rather than integrity violations. The threshold test sweeps cap−1/cap/cap+1 so it is not vacuous, and AC-4 deliberately specifies `--step` scoping with the invocation count as the load-bearing assertion.
- **Dismissed (cold-Codex)**: *[P1] malformed path citation in `review.md:133`* — **valid and already fixed by the foreman.** Recorded rather than carried: the defect was in a reviewer-owned artifact, not in the diff, and it was the sole cause of the handoff's two `Fail` rows.
- **Dismissed (cold-Codex)**: *[P2] preserve review acceptance from the new block state* — **not dismissed on the merits; promoted to R2-1**, with the `--force` failure mode as the surviving, verified core.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [x] Spec gap

Every code-level item Round 1 blocked on — F1, F3, F4, F5 — is genuinely fixed, with red-first tests independently re-verified by revert. All 17 ACs are met and the full gate is green. No surviving finding is fixable at `implement` altitude.

The three surviving items are all spec decisions, and two of them (R2-1, R2-2) are the **same class**: the relocation persists `<review phase> = blocked` while a different phase is current, and consumers that scan phase *statuses* misread that state. Counting Codex's round-3 spec-review finding, that class has now produced three instances at three call sites. The spec's enumeration was built to close it and swept only current-phase consumers. Rather than patch the third site, the amendment should state the contract for this state shape once and enumerate phase-status consumers alongside current-phase consumers — `taskAccept`'s `priorIncompletePhases`, `watch.ts`'s `findFirstBlockedPhase`, and anything else that reads `phases[*].status` directly.

Routing to `implement` would send Codex back for one wording fix (F11's `--step`) while three spec decisions stayed open — and Codex already correctly declined to guess at two of them. Halting is the right route. Suggested amendment scope: the state-shape consumer contract (R2-1, R2-2), degenerate-cap policy in `policy.ts` / `env.ts` (R2-3), the F13 doc surfaces including the adopter-shipping `recovery.md` mirror, and the `--step` wording as a rider.
