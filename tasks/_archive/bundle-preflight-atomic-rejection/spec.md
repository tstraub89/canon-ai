# Spec: bundle-preflight-atomic-rejection — Pre-flight rejection of bundled tasks must be all-or-nothing

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

`runCodeReviewPhase` in [`scripts/run-task/phases/code-review.ts`](scripts/run-task/phases/code-review.ts) runs the pre-flight handoff validator before invoking Claude. When the pre-flight detects failures, it classifies the blockers and calls `determinePreflightRoute` to pick one of two routes:

- **Fixable route (`'implement'`)**: at least one blocker is `format` or `regression` (including mixed fixable + blocked). The failing tasks get `taskPhasePreflightRejected('code_review')` and the bundle reroutes to implement.
- **Blocked-only route (`'auto_block'`)**: every blocker is `blocked` (infrastructure unavailable, so the required check status is unknown). `autoBlockPhase(taskIds, 'code_review', …)` + `process.exit(2)` halts the whole bundle for human triage. This is a deliberate path introduced by the archived `preflight-failure-routing` task — re-implementing cannot fix unavailable infrastructure, so it must NOT loop back to implement.

Both routes split a bundle, in different ways:

**Fixable route** — the rejection loop iterates only `preflightFailed` (the subset whose handoffs failed validation). It writes `review.md` and calls `taskPhasePreflightRejected` for those tasks only; bundle siblings that passed pre-flight are left at their pre-review status (typically `pending`). Canon's bundle invariant is "every task in a bundle moves through every phase together" — implement produces one shared commit, code_review runs as one Claude session against the cumulative diff, code_review reroutes route the entire bundle back to implement together. Here, failing tasks land at `code_review.status = done, verdict = changes_requested` while clean tasks stay at `pending`.

Downstream consequences of the fixable-route split (observed via static analysis):

1. **`checkAndRoute` triggers `recoverPhaseForTask` on the clean tasks** (gate at `scripts/run-task/main.ts:2440` fires when `phaseStatus !== 'done'`). That path invokes evidence-based auto-advance, then a one-shot retry that runs Claude for *just the clean task* — not as part of the original bundle. Cross-task interaction findings (the whole point of bundle review) are missed.
2. **Mixed verdicts in one bundle**: failing tasks have `changes_requested` from the orchestrator pre-flight; clean tasks may get `approved` from the solo Claude retry. The bundle reroute logic (`anyChangesRequested` in `scripts/run-task/main.ts:2566`) still routes the bundle back to implement together — but the artifacts diverge (one BLOCKED `review.md`, one normal one with Stage 1 + findings). Operator-facing telemetry is inconsistent.
3. **Counter semantics**: failing tasks have `preflight_rejections_current_loop` incremented; clean tasks may have `iterations_current_loop` incremented by their solo Claude retry. Bundle siblings end up with divergent per-loop counters even though they share a single implement commit.

**Blocked-only route** — `autoBlockPhase(taskIds, …)` already iterates *all* bundle task IDs, so every task's `code_review.status` is correctly set to `blocked`. But the `review.md` write loop still runs only over `preflightFailed`, so clean siblings are auto-blocked **with no `review.md` artifact at all**. The audit trail is asymmetric: a blocked task with no review.md gives the operator no record of why it halted.

This is pre-existing behavior — predates the recent pre-flight rejection fix — but became visible during that fix's Codex review round 8 ("Pre-flight rejection needs to advance or reject the whole bundle atomically, not only the failing subset").

## Decision

When the pre-flight handoff validator fails for **any** task in a bundle, the whole bundle must move atomically — every task reaches the same terminal pre-flight state and every task gets a symmetric `review.md`. The fix preserves the existing `determinePreflightRoute` split and applies bundle atomicity **within each route**. It does NOT collapse the two routes into one.

**Shared (both routes)**: the pre-flight rejection path enumerates ALL `tasks`, not just `preflightFailed`. Each task gets a `review.md`:

- **Failing tasks** (in `preflightFailed`) get the existing `buildPreflightReviewBlock(classified, route)` BLOCKED block with their per-task validation issues — unchanged content shape.
- **Clean tasks** (not in `preflightFailed`) get a route-appropriate stub (shapes defined in AC-7 and AC-11) so the artifact exists and the bundle's audit trail is symmetric. The stub deliberately omits `## Stage 1` so `bundleHasRealPriorReview` treats it as not-a-real-review, and it appends (never overwrites) when a prior real review exists.

**Route A — fixable (`route === 'implement'`)**: at least one blocker is `format` or `regression`.

- All bundle tasks get `taskPhasePreflightRejected('code_review')` applied — failing tasks AND clean tasks share the rejection (status `done`, verdict `changes_requested`).
- Bundle rerouting via existing `checkAndRoute` logic kicks in naturally (any `changes_requested` verdict in the bundle reroutes the whole bundle to implement — no changes needed there).
- On the implement reroute, the existing `shouldUseImplementRevision` / `promptImplementRevisions` pre-flight branch routes Codex to address the pre-flight findings.
- The clean-task counter bump is semantically defensible: a clean task in a bundle that got pre-flight rejected DID have a code-review attempt — it just got blocked by a sibling's handoff. Counting the attempt accurately reflects pipeline state for the auto-block cap.
- The clean-task stub's `review.md` verdict is governed by the append rule (AC-4): freshly-written stubs carry a `changes_requested` checkbox consistent with `status.json`, but a stub appended over a prior real review preserves that review's verdict for the parser — the same intentional divergence the failing-task path already produces (see *Known Risks*). The bundle still reroutes correctly because `checkAndRoute` reads the verdict from `status.json`, not the artifact.

**Route B — blocked-only (`route === 'auto_block'`)**: every blocker across all failing tasks is `blocked` (infrastructure unavailable).

- The whole bundle is auto-blocked together via the existing `autoBlockPhase(taskIds, 'code_review', …)` + `process.exit(2)`. This is preserved unchanged — `taskPhasePreflightRejected` is NOT called and the bundle does NOT reroute to implement, because re-implementation cannot restore unavailable infrastructure.
- The ONLY behavior change in this route is the symmetric artifact: clean siblings now get a human-triage stub `review.md` (AC-11) instead of being auto-blocked with no record. `autoBlockPhase` already covers all task IDs, so status semantics are unchanged; only the missing artifact is filled in.

## Non-Goals

- **Changing bundle semantics elsewhere.** This fix only affects the pre-flight rejection path. Bundle behavior in implement, code_review (post-pre-flight), QA, and human_review is unchanged.
- **Collapsing the two pre-flight routes.** The fixable (`implement`) and blocked-only (`auto_block`) routes stay distinct. Route A reroutes to implement; Route B halts for human triage and does NOT reroute. This fix applies bundle atomicity *within* each route — it does not move blocked-only failures onto the implement path (that would regress the archived `preflight-failure-routing` behavior).
- **Changing single-task pre-flight behavior.** A single-task "bundle" with a pre-flight rejection already had atomic rejection (trivially — one task), on either route. This fix is invisible for single-task pipelines.
- **Re-running Claude for the clean tasks alone.** On Route A, the current bug routes clean siblings through `recoverPhaseForTask`, which spawns a solo Claude retry. This fix eliminates that path by ensuring all bundle tasks reach `status = done` after a Route-A pre-flight rejection.
- **Preventing clean tasks' counter from being bumped (Route A).** Some readers may feel that incrementing `preflight_rejections_current_loop` for a "clean" task is misleading. We accept this — see Decision §Route A. (Route B does not call `taskPhasePreflightRejected`, so these counters are untouched there; only `auto_block_count` + an escalation are recorded, per existing `autoBlockPhase` behavior.)
- **Splitting bundle review.md content.** The clean tasks' `review.md` is a stub pointing at sibling artifacts; we do NOT replicate the failing tasks' BLOCKED content into clean tasks' files. Each task's review.md remains task-scoped.
- **Re-architecting bundle pre-flight to support per-task partial advancement.** That would require keeping the bundle moving forward on some tasks while blocking others — incompatible with canon's "bundle moves together" invariant, and outside this task's scope.

## Acceptance Criteria

### Shared (both routes)

- [ ] **AC-1**: When `runCodeReviewPhase` detects `preflightFailed.length > 0` in a bundle of N tasks (N ≥ 2), the pre-flight rejection path enumerates ALL N tasks (not just `preflightFailed`) and writes a `review.md` for each. The `preflightFailed` subset is still computed for the per-task BLOCKED content.
- [ ] **AC-2**: Failing tasks (those in `preflightFailed`) receive a `review.md` produced by `buildPreflightReviewBlock(classified, route)` — same content shape as before this fix (the implement-route BLOCKED block on Route A; the `auto_block` human-triage HALTED block on Route B).
- [ ] **AC-3**: No clean-task stub (either route) contains a `## Stage 1` heading, so `bundleHasRealPriorReview` in `scripts/run-task/prompts/index.ts` correctly identifies it as not-a-real-review.
- [ ] **AC-4**: When a clean task already has a real `review.md` from a prior round (contains a `## Stage 1` section — e.g. a prior approved Round 1 preserved by `rerouteFromHumanReview`, or Round 1 changes_requested → fixed → Round 2 attempted but bundle hit pre-flight), the clean-task stub is APPENDED rather than overwriting the prior content. The append heading does NOT start with `## Round`, so `extractCheckedVerdict` continues to read the **prior real review's verdict** rather than the appended block — mirroring the existing failing-task BLOCKED-block append (`scripts/run-task/phases/code-review.ts:176-189`). Route A append heading: `## Bundle Pre-Flight Rejection (round <N>) — sibling task(s) failed`. Route B append heading: `## Bundle Pre-Flight Halt (round <N>) — sibling infrastructure unavailable`. Because the prior verdict governs parsing in the append case, the **appended clean stub OMITS the `## Verdict` checkbox** (it would be inert and misleading); the appended block is an audit note only. This is the deliberate format-only-rejection recovery affordance: a clean task whose sibling broke can be re-advanced against its real prior verdict via `canon task phase code_review done <prior-verdict>` once the sibling is fixed, rather than being forced to re-run a passing review. See the *Known Risks* note on the intentional artifact↔status divergence.

### Route A — fixable (`determinePreflightRoute(preflightFailed) === 'implement'`)

> At least one blocker across the failing tasks is `format` or `regression` (including mixed fixable + blocked).

- [ ] **AC-5**: ALL N tasks receive `taskPhasePreflightRejected('code_review')` — failing tasks AND clean tasks, not just the failing subset.
- [ ] **AC-6**: After the Route-A path completes, all N bundle tasks have `phases.code_review.status === 'done'` and `phases.code_review.verdict === 'changes_requested'`.
- [ ] **AC-7**: Clean tasks (those NOT in `preflightFailed`) that have NO prior real `review.md` (the common case) receive a freshly-written stub with this shape. The `## Verdict` checkbox is present and authoritative ONLY in this fresh case: with no prior content and no `## Round` heading, `extractCheckedVerdict` scans the whole file and returns `changes_requested`, matching the `status.json` verdict that `taskPhasePreflightRejected` writes. (When a prior real review exists, the stub is appended WITHOUT this checkbox per AC-4.)
  ````markdown
  # Code Review: <taskId>

  ## Bundle Pre-Flight Rejection

  This task is part of a bundle whose handoff failed orchestrator pre-flight validation. No Claude review ran for the bundle.

  This task itself had no per-task pre-flight findings — the rejection was triggered by sibling task(s) in the bundle:

  - `<sibling-taskId-1>` — see `tasks/<sibling-taskId-1>/review.md`
  - `<sibling-taskId-2>` — see `tasks/<sibling-taskId-2>/review.md`

  ## Verdict

  - [x] **Changes requested** — fix the sibling task(s) above and resubmit handoff.
  ````
- [ ] **AC-8**: `checkAndRoute` does NOT trigger `recoverPhaseForTask` for any bundle task (all have `phases.code_review.status === 'done'`), and the code_review `anyChangesRequested` branch (`scripts/run-task/main.ts:2566`) routes the entire bundle back to implement. Existing routing — verify with a regression test.
- [ ] **AC-9**: All N bundle tasks have `phases.code_review.preflight_rejections_current_loop` and `phases.code_review.preflight_rejections_total` and `phases.code_review.changes_requested_total` each incremented by 1; and NONE have `phases.code_review.iterations_current_loop` or `iterations_total` bumped (pre-flight is not a Claude review round — same invariant as `taskPhasePreflightRejected`).

### Route B — blocked-only (`determinePreflightRoute(preflightFailed) === 'auto_block'`)

> Every blocker across all failing tasks is `blocked` (infrastructure unavailable).

- [ ] **AC-10**: All N bundle tasks are auto-blocked together via the existing `autoBlockPhase(taskIds, 'code_review', …)` + `process.exit(2)`: each task has `phases.code_review.status === 'blocked'`, `auto_block_count` incremented by 1, and one escalation appended. NO task receives `taskPhasePreflightRejected`, and NO task reroutes to implement. `preflight_rejections_*` and `changes_requested_total` are NOT bumped on this route.
- [ ] **AC-11**: Clean tasks (those NOT in `preflightFailed`) receive a `review.md` with this stub shape. It carries NO `Changes requested` verdict checkbox and NO `## Verdict` section — mirroring the failing-task `auto_block` block, which also has none, so a later `canon task phase code_review done <verdict>` recovery cannot read a misleading verdict from a clean sibling:
  ````markdown
  # Code Review: <taskId>

  ## Bundle Pre-Flight Halt

  This task is part of a bundle whose handoff pre-flight found only infrastructure-blocked validation rows. The required checks could not run, so no Claude review ran and re-implementation cannot resolve it.

  This task itself had no per-task pre-flight findings — the halt was triggered by sibling task(s) in the bundle:

  - `<sibling-taskId-1>` — see `tasks/<sibling-taskId-1>/review.md`
  - `<sibling-taskId-2>` — see `tasks/<sibling-taskId-2>/review.md`

  Human triage required: restore the infrastructure, update the affected sibling's `handoff.md` Validation Outcomes rows, set `phases.code_review.status = "pending"` for all bundle tasks, and re-run the pipeline.
  ````
- [ ] **AC-12**: `determinePreflightRoute` still returns `auto_block` when every blocker across all failing tasks is `blocked`, and `buildPreflightReviewBlock(classified, 'auto_block')` still produces the existing HALTED human-triage block. The existing unit test `pre-flight blocked-only route halts for human triage` (`tests/run-task-validation.test.ts`) continues to pass.

### Auto-block cap (Route A loop safety)

- [ ] **AC-13**: The existing combined-counter cap at the top of `runCodeReviewPhase` (`iterations_current_loop + preflight_rejections_current_loop` per task, max across bundle ≥ cap) still trips correctly when persistent Route-A pre-flight failures hit the cap on ANY bundle task. No new auto-block logic is needed — this AC verifies the existing logic still works under bundle-atomic rejection.

### Tests

- [ ] **AC-14**: New tests cover all of:
  - **Route A**, bundle of 2 tasks, one fails fixable pre-flight → both get `taskPhasePreflightRejected` applied (status `done`, verdict `changes_requested`), both have `review.md`, clean task's `review.md` does NOT contain `## Stage 1`
  - **Route A**, bundle of 3 tasks, one fails fixable pre-flight → all 3 get pre-flight applied
  - **Route A**, bundle of 2 tasks where the clean task has a prior real `review.md` (with `## Stage 1`) → the clean-task stub APPENDS, doesn't stomp the prior content
  - **Route A**, bundle of 2 tasks where the clean task has a **prior approved** Round-1 `review.md` (`## Stage 1` + `## Final Verdict` with `- [x] **Approved**`, no `## Round` heading) → after the bundle pre-flight rejection: (a) the prior content is preserved and the Bundle Pre-Flight Rejection block is appended under a non-`## Round` heading with NO appended `## Verdict` checkbox; (b) `extractCheckedVerdict(review.md)` still returns `approved` (the prior verdict, NOT `changes_requested`) — confirming the appended block does not hijack parsing; (c) `status.json` records `verdict === 'changes_requested'` (orchestrator-owned, set by `taskPhasePreflightRejected`); (d) the bundle still reroutes to implement (driven by `status.json`, per AC-8, not by the artifact). This pins the intentional artifact↔status divergence so a future change can't silently flip it.
  - **Route B**, bundle of 2 tasks, one fails blocked-only pre-flight → all N auto-blocked (status `blocked`, `auto_block_count` bumped), all have `review.md`, clean task's stub has NO `## Verdict` and NO `## Stage 1`, and NO task received `taskPhasePreflightRejected` (no `preflight_rejections_*` / `changes_requested_total` bump)
  - Bundle of 2 tasks, both pass pre-flight → existing behavior unchanged (Claude runs normally)
  - Single-task "bundle" with a pre-flight failure (either route) → existing behavior unchanged (functionally identical to current code path)

  Codex picks the test file location — extend an existing bundle test file rather than creating a new one if a fit exists; see Spec-writing rules of thumb in CLAUDE.md.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/phases/code-review.ts` | Refactor the pre-flight rejection block (lines ~154–214) so the `review.md` write loop enumerates ALL `tasks` (not just `preflightFailed`), writing the route-appropriate clean-task stub for siblings not in `preflightFailed` and the existing BLOCKED block for those in it. Reuse the existing append-vs-stomp logic (lines 174–189): the `## Stage 1` detector chooses append vs fresh-write, and the appended heading must NOT start with `## Round` (so `extractCheckedVerdict` keeps reading the prior verdict). Clean-stub authoring branches on (route × prior-review-present): Route A fresh = Rejection stub WITH `## Verdict — Changes requested` (AC-7); Route A append = Rejection block under a non-`## Round` heading WITHOUT a `## Verdict` checkbox (AC-4); Route B fresh/append = Halt stub, never any verdict checkbox (AC-11). The route branch is otherwise preserved: Route A (`implement`) still calls `taskPhasePreflightRejected` for ALL N tasks and returns; Route B (`auto_block`) still calls `autoBlockPhase(taskIds, …)` + `process.exit(2)` and does NOT call `taskPhasePreflightRejected`. The `preflightFailed` subset is still computed for the per-task BLOCKED content. |
| `tests/run-task-validation.test.ts` | Tests per AC-14 (both routes) — Codex extended the existing validation test file rather than creating a new one. |
| `dist/scripts/run-task.js` | Build-generated. Regenerated by `npm run build`. |
| `dist/cli/index.js` | Build-generated. Regenerated by `npm run build` (transitive — `code-review.ts` import chain reaches the CLI bundle). |

### Interaction Dependencies

- **`taskPhasePreflightRejected`** in `src/task/index.ts` — used for both failing and clean tasks on **Route A only**. No change to the helper itself. Not called on Route B.
- **`autoBlockPhase`** in `scripts/run-task/state.ts` — **Route B only**. Already iterates all `taskIds`, so every bundle task is set to `blocked` with `auto_block_count` bumped and an escalation appended. No change to the helper itself; the fix only adds the clean-task `review.md` write before the existing `autoBlockPhase(taskIds, …)` + `process.exit(2)` call.
- **`buildPreflightReviewBlock`** in `scripts/run-task/phases/code-review.ts` — already route-aware (emits the HALTED human-triage block for `auto_block`, the BLOCKED block for `implement`). Unchanged; reused for failing tasks on both routes.
- **`bundleHasRealPriorReview`** in `scripts/run-task/prompts/index.ts` — must correctly identify both clean-task stubs as not-a-real-Stage-1. Both stubs deliberately omit the `## Stage 1` heading per AC-3.
- **`extractCheckedVerdict`** in `scripts/run-task/validation.ts` — `extractSectionBodies(content, /^## Round\b/)` scopes parsing to the latest `## Round N` body when one exists; otherwise it scans the whole file and tests `Approved` BEFORE `Changes requested`. Route A clean-stub interaction, by case:
  - **Fresh (no prior review)**: the stub's `## Verdict` `- [x] **Changes requested**` is the only verdict in the file; no `## Round` heading → whole-file scope → returns `changes_requested`, matching the `status.json` verdict from `taskPhasePreflightRejected`. Consistent (AC-7).
  - **Appended over a prior real review**: the append heading is NOT `## Round`, and the appended stub omits the `## Verdict` checkbox (AC-4), so `extractCheckedVerdict` returns the **prior real review's verdict** — e.g. `approved` for a preserved round-1 approval. This intentionally diverges from `status.json` (`changes_requested`); the divergence mirrors the existing failing-task BLOCKED-block append and is the recovery affordance, NOT a bug. The bundle still reroutes correctly because `checkAndRoute` reads the verdict from `status.json` (`getVerdict`), not from the artifact. The earlier draft's claim that this stub is unconditionally "consistent with status.json" was wrong and is corrected here and in AC-4/AC-7/AC-14, and in the *Known Risks* divergence note.
  - **Route B** Halt stub has NO `## Verdict` and NO checkbox (AC-11); status is orchestrator-owned (`blocked`), and recovery is "reset to pending and re-run," so no verdict is parsed for routing.
- **`shouldUseImplementRevision`** in `scripts/run-task/phases/implement.ts` — **Route A only**. Already routes through the pre-flight branch when `preflight_rejections_current_loop > 0`. All bundle tasks satisfy this after a Route-A rejection, so implement-revision applies bundle-wide naturally. Route B never reroutes to implement, so this is not exercised there.
- **`promptImplementRevisions`** in `scripts/run-task/prompts/index.ts` — **Route A only**. Emits the pre-flight branch; the prompt's `reviewLines` points each task at its own `review.md`, which works regardless of whether content is the BLOCKED block or the clean-task Rejection stub.

### Data Model Changes

None. Schema unchanged; only the runtime application of the existing pre-flight rejection path is broadened to cover all bundle tasks.

## Validation Required

- [x] Linting (`npm run lint`)
- [x] Type checking (`npm run type-check`)
- [x] Unit tests (`npm test`) — new bundle pre-flight tests + regression check that single-task pre-flight still works
- [x] Full build (`npm run build`) — change affects `scripts/run-task/phases/code-review.ts`, which is bundled into `dist/scripts/run-task.js` and (transitively) `dist/cli/index.js`
- [x] Docs references (`npm run docs-refs-check`)
- [x] Canon-managed template sync (`npm run sync-templates:check`) — no canon-managed file changes expected, but the check verifies that

## Docs Impact

None expected. This is a refinement to existing pre-flight rejection behavior; the user-facing operator surface doesn't change. A `grep -r "only failing\|partial pre-flight"` across `docs/`, `CLAUDE.md`, `AGENTS.md`, `CODEX.md` shows no current documentation describing partial rejection, so no doc text needs updating.

## Known Risks

- **Bundle reroute can feel heavy for "one bad sibling" cases (Route A).** If a 3-task bundle reroutes because one task's handoff was malformed, all 3 implements re-run together. In practice this is the same shared-implement-commit pattern canon already uses — Codex re-runs implement once for the whole bundle, fixes the failing task's handoff, and the bundle proceeds. Token cost is bounded.
- **Clean-task counter bump could mislead future analysis (Route A).** `preflight_rejections_current_loop` for a "clean" task includes bumps the task itself didn't cause. Anyone analyzing per-task pre-flight history needs to know this. Mitigation: extend the `taskPhasePreflightRejected` docstring to note the bundle case; consider whether `docs/pipeline-orchestrator.md` needs a sentence on the convention.
- **Append-vs-stomp logic for clean tasks** (AC-4) mirrors the failing-task path's append logic from the prior pre-flight fix. Same `## Stage 1` detection determines append vs stomp, on both routes. The risk: clean tasks rarely have prior real reviews in practice (because the bundle would have approved together previously), so this code path is exercised less often than the failing-task one. Test the append path explicitly per AC-14's "prior real review" case.
- **Intentional artifact↔status divergence on append-over-approved (Route A).** A clean task can carry a prior `- [x] **Approved**` `review.md` and still be pre-flight rejected, because `rerouteFromHumanReview` (`scripts/run-task/main.ts:1930-1949`) resets `code_review.status`/`verdict` but preserves the artifact. After such a rejection, `status.json` records `changes_requested` while `extractCheckedVerdict(review.md)` still returns the prior `approved` — because the appended block uses a non-`## Round` heading and omits its own verdict checkbox (AC-4), so the parser reads the prior verdict. This is the SAME divergence the existing failing-task BLOCKED-block append produces (`code-review.ts:176-189`), and it is deliberate: a format-only rejection (often caused by a *sibling's* handoff) should not force a clean task to re-run a passing review — the human recovers against the real prior verdict via `canon task phase code_review done <prior-verdict>`, which the phase gate accepts because the arg matches the artifact. The risk is a future reader "fixing" the divergence by forcing the parser to `changes_requested` (e.g. switching the append heading to `## Round`), which would REGRESS this recovery affordance and break the prior task's documented design. AC-14's prior-approved case pins the intended behavior so that regression fails a test. NOTE: the earlier draft of this spec wrongly claimed the clean stub was unconditionally "consistent with status.json"; that claim is removed.
- **Route B must not regress to the implement path.** The blocked-only route exists precisely so infra failures don't loop implement→pre-flight→implement forever. The fix touches the shared `review.md` write loop that runs *before* the route branch, so it's easy to accidentally make Route B fall through to `taskPhasePreflightRejected` + reroute. AC-10 and AC-12 pin Route B's `blocked` status, no `taskPhasePreflightRejected` call, and the preserved `determinePreflightRoute`/`buildPreflightReviewBlock` semantics — keep the route branch structurally intact and only broaden the artifact loop.
- **Route B clean-task stub must not carry a routing verdict.** The failing-task `auto_block` block has no `## Verdict` checkbox by design; if the clean-task halt stub added a `Changes requested` checkbox, a later `canon task phase code_review done <verdict>` recovery could read a stale `changes_requested` from a clean sibling and reroute the bundle when it should stay triaged. AC-11 forbids the checkbox; test it.
- **Test isolation.** Bundle tests need to set up multiple `tasks/<id>/` directories with consistent shared-branch state. Look at `tests/run-task-counter-schema.test.ts`'s `withTempTasks` helper for the pattern.

## Human Test Plan

> Steps for the product owner. Behavior-focused, not implementation-focused.

**Fixable (implement) route — steps 1–4:**

1. **Create a 2-task bundle locally** (use any two pending tasks in the repo). Manually corrupt one task's `handoff.md` Validation Outcomes table so it produces a *fixable* blocker — e.g., remove the required `lint` row (format) or mark a check `Fail` (regression). Trigger `canon run <task1> <task2>` past implement.
2. **Confirm both tasks land at "done" with verdict "changes_requested"** via `canon task status <task1>` and `canon task status <task2>`.
3. **Confirm both tasks have a `review.md`.** The corrupted task's should contain the validation-gate BLOCKED block listing the missing `lint` row. The clean task's should contain the bundle-rejection stub pointing at the corrupted sibling.
4. **Confirm both tasks reroute to implement** on the next pipeline pass. Inspect `phases.implement.status` — should be `pending` (reset by reroute logic).
5. **Blocked-only (auto_block) route check**: create another 2-task bundle, but this time corrupt one task's handoff so its only validation problem is a `blocked` row (mark a required check `blocked` / triage-required rather than `Fail`). Trigger `canon run <task1> <task2>` past implement. Confirm: BOTH tasks land at status `blocked` (not `done`); BOTH have a `review.md` — the corrupted task's with the "infrastructure unavailable / human triage required" HALTED block, the clean task's with the "Bundle Pre-Flight Halt" stub pointing at the sibling and carrying NO "Changes requested" checkbox; and the bundle does NOT reroute to implement (`phases.implement.status` is not reset).
6. **Regression check single-task path**: re-run a single task whose handoff is corrupted (no bundle siblings). Confirm behavior matches the prior release — only that task gets the BLOCKED `review.md`, status flow unchanged, on whichever route its blocker class selects.
7. **Quality-log audit after 3-5 bundle pipelines**: confirm telemetry rows correctly distinguish "atomic bundle pre-flight" vs "normal bundle code-review reroute" — if not, file a follow-up for telemetry annotation.

---

## Spec Quality Checklist

- [x] Every AC states a verifiable outcome (file:line, status field, content shape)
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Known Risks covers failure modes for the trickiest ACs (counter semantics, append vs stomp, test isolation)
- [x] Human Test Plan uses behavior language only
- [x] Validation Required has at least one `- [x]` entry
