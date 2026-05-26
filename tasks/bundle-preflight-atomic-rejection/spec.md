# Spec: bundle-preflight-atomic-rejection — Pre-flight rejection of bundled tasks must be all-or-nothing

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

`runCodeReviewPhase` in [`scripts/run-task/phases/code-review.ts`](scripts/run-task/phases/code-review.ts) runs the pre-flight handoff validator before invoking Claude. When the pre-flight detects failures, the code iterates over `preflightFailed` (the subset of tasks whose handoffs failed validation) and applies `taskPhasePreflightRejected` only to those tasks. Bundle siblings that passed pre-flight are left at their pre-review status (typically `pending`).

This breaks bundle atomicity. Canon's bundle invariant is "every task in a bundle moves through every phase together" — implement produces one shared commit, code_review runs as one Claude session against the cumulative diff, code_review reroutes route the entire bundle back to implement together. The pre-flight rejection path splits a bundle: failing tasks land at `code_review.status = done, verdict = changes_requested`, while clean tasks stay at `pending`.

Downstream consequences observed via static analysis:

1. **`checkAndRoute` triggers `recoverPhaseForTask` on the clean tasks** (gate at `scripts/run-task/main.ts:2313` fires when `phaseStatus !== 'done'`). That path invokes `tryEvidenceAdvance`, then a one-shot retry that runs Claude for *just the clean task* — not as part of the original bundle. Cross-task interaction findings (the whole point of bundle review) are missed.
2. **Mixed verdicts in one bundle**: failing tasks have `changes_requested` from the orchestrator pre-flight; clean tasks may get `approved` from the solo Claude retry. The bundle reroute logic (`anyChangesRequested` in `scripts/run-task/main.ts:2378`) still routes the bundle back to implement together — but the artifacts diverge (one BLOCKED `review.md`, one normal one with Stage 1 + findings). Operator-facing telemetry is inconsistent.
3. **Counter semantics**: failing tasks have `preflight_rejections_current_loop` incremented; clean tasks may have `iterations_current_loop` incremented by their solo Claude retry. Bundle siblings end up with divergent per-loop counters even though they share a single implement commit.

This is pre-existing behavior — predates the recent pre-flight rejection fix — but became visible during that fix's Codex review round 8 ("Pre-flight rejection needs to advance or reject the whole bundle atomically, not only the failing subset").

## Decision

When the pre-flight handoff validator fails for **any** task in a bundle, treat it as an **atomic bundle rejection**:

- All bundle tasks get `taskPhasePreflightRejected('code_review')` applied — failing tasks AND clean tasks share the rejection.
- All bundle tasks get a `review.md` written. Failing tasks get the existing BLOCKED block with their per-task validation issues. Clean tasks get a brief "bundle pre-flight rejected — no per-task issues; see sibling tasks' review.md" stub so the artifact exists and the bundle's audit trail is symmetric.
- Bundle rerouting via existing `checkAndRoute` logic kicks in naturally (any `changes_requested` verdict in the bundle reroutes the whole bundle to implement — no changes needed there).
- On the implement reroute, the existing `shouldUseImplementRevision` / `promptImplementRevisions` pre-flight branch routes Codex to address the pre-flight findings.

The clean-task counter bump is semantically defensible: a clean task in a bundle that got pre-flight rejected DID have a code-review attempt — it just got blocked by a sibling's handoff. Counting the attempt accurately reflects pipeline state for the auto-block cap.

## Non-Goals

- **Changing bundle semantics elsewhere.** This fix only affects the pre-flight rejection path. Bundle behavior in implement, code_review (post-pre-flight), QA, and human_review is unchanged.
- **Changing single-task pre-flight behavior.** A single-task "bundle" with a pre-flight rejection already had atomic rejection (trivially — one task). This fix is invisible for single-task pipelines.
- **Re-running Claude for the clean tasks alone.** The current bug routes through `recoverPhaseForTask` which spawns a solo Claude retry. This fix eliminates that path entirely by ensuring all bundle tasks reach `status = done` after pre-flight.
- **Preventing clean tasks' counter from being bumped.** Some readers may feel that incrementing `preflight_rejections_current_loop` for a "clean" task is misleading. We accept this — see Decision §3.
- **Splitting bundle review.md content.** The clean tasks' `review.md` is a stub pointing at sibling artifacts; we do NOT replicate the failing tasks' BLOCKED content into clean tasks' files. Each task's review.md remains task-scoped.
- **Re-architecting bundle pre-flight to support per-task partial advancement.** That would require keeping the bundle moving forward on some tasks while blocking others — incompatible with canon's "bundle moves together" invariant, and outside this task's scope.

## Acceptance Criteria

### Detection and routing

- [ ] **AC-1**: When `runCodeReviewPhase` detects `preflightFailed.length > 0` in a bundle of N tasks (N ≥ 2), ALL N tasks receive `taskPhasePreflightRejected('code_review')`, not just the failing subset.
- [ ] **AC-2**: After the pre-flight rejection path completes, all N bundle tasks have `phases.code_review.status === 'done'` and `phases.code_review.verdict === 'changes_requested'`.
- [ ] **AC-3**: `checkAndRoute` does NOT trigger `recoverPhaseForTask` for any bundle task (because all have `phases.code_review.status === 'done'`).
- [ ] **AC-4**: `checkAndRoute`'s code_review reroute logic routes the entire bundle back to implement. Existing behavior — verify with a regression test.

### Per-task `review.md` artifacts

- [ ] **AC-5**: Failing tasks (those in `preflightFailed`) receive a `review.md` matching the existing BLOCKED format — same content shape as before this fix.
- [ ] **AC-6**: Clean tasks (those NOT in `preflightFailed`) receive a `review.md` with this stub shape:
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
- [ ] **AC-7**: The clean-task stub does NOT contain a `## Stage 1` heading (so `bundleHasRealPriorReview` in `scripts/run-task/prompts/index.ts` correctly identifies it as not-a-real-review).
- [ ] **AC-8**: When a clean task already has a real `review.md` from a prior round (e.g. Round 1 changes_requested → fixed → Round 2 attempted but bundle hit pre-flight), the new bundle-rejection stub is APPENDED rather than overwriting the prior content. Append heading: `## Bundle Pre-Flight Rejection (round <N>) — sibling task(s) failed`. Heading does NOT start with `## Round` (mirrors the existing pre-flight append guard against `extractCheckedVerdict` confusion).

### Counter semantics

- [ ] **AC-9**: All N bundle tasks have `phases.code_review.preflight_rejections_current_loop` incremented by 1, and `phases.code_review.preflight_rejections_total` incremented by 1.
- [ ] **AC-10**: All N bundle tasks have `phases.code_review.changes_requested_total` incremented by 1.
- [ ] **AC-11**: None of the bundle tasks have `phases.code_review.iterations_current_loop` or `phases.code_review.iterations_total` bumped (pre-flight is not a Claude review round — same invariant as the per-task helper).

### Auto-block

- [ ] **AC-12**: The existing per-task auto-block check (`iterations_current_loop + preflight_rejections_current_loop` per task, max across bundle) trips correctly when persistent pre-flight failures hit the cap on ANY bundle task. No new auto-block logic is needed — this AC verifies the existing logic still works under bundle-atomic rejection.

### Tests

- [ ] **AC-13**: New tests cover all of:
  - Bundle of 2 tasks, one fails pre-flight → both get pre-flight applied, both have `review.md`, clean task's `review.md` doesn't contain `## Stage 1`
  - Bundle of 3 tasks, one fails pre-flight → all 3 get pre-flight applied
  - Bundle of 2 tasks, both pass pre-flight → existing behavior unchanged (Claude runs normally)
  - Bundle of 2 tasks where clean task has prior real `review.md` → bundle-rejection stub appends, doesn't stomp
  - Single-task "bundle" with pre-flight failure → existing behavior unchanged (functionally identical to current code path)

  Codex picks the test file location — extend an existing bundle test file rather than creating a new one if a fit exists; see Spec-writing rules of thumb in CLAUDE.md.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/phases/code-review.ts` | Refactor the pre-flight rejection loop: enumerate ALL `tasks` (not just `preflightFailed`); for each, write the appropriate `review.md` (BLOCKED for failing, bundle-stub for clean) and call `taskPhasePreflightRejected`. The failing-task subset is still computed for the per-task BLOCKED content. |
| `tests/<existing-or-new>-bundle-preflight*.test.ts` | Tests per AC-13. Codex picks the file: extend a feature-named existing test file if one fits, otherwise create `tests/run-task-bundle-preflight.test.ts`. |
| `dist/scripts/run-task.js` | Build-generated. Regenerated by `npm run build`. |
| `dist/cli/index.js` | Build-generated. Regenerated by `npm run build` (transitive — `code-review.ts` import chain reaches the CLI bundle). |

### Interaction Dependencies

- **`taskPhasePreflightRejected`** in `src/task/index.ts` — used for both failing and clean tasks. No change to the helper itself.
- **`bundleHasRealPriorReview`** in `scripts/run-task/prompts/index.ts` — must correctly identify clean tasks' bundle-rejection stub as not-a-real-Stage-1. The stub deliberately omits `## Stage 1` heading per AC-7.
- **`extractCheckedVerdict`** in `scripts/run-task/validation.ts` — the clean-task stub's `## Verdict` block has `- [x] **Changes requested**`. `extractSectionBodies` skips it (no `## Round` heading); scope falls to entire content; regex matches `Changes requested`. Consistent with status.json.
- **`shouldUseImplementRevision`** in `scripts/run-task/phases/implement.ts` — already routes through the pre-flight branch when `preflight_rejections_current_loop > 0`. All bundle tasks satisfy this after the fix, so implement-revision applies bundle-wide naturally.
- **`promptImplementRevisions`** in `scripts/run-task/prompts/index.ts` — emits the pre-flight branch; the prompt's `reviewLines` points each task at its own `review.md`, which works regardless of whether content is BLOCKED-block or bundle-stub.

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

- **Bundle reroute can feel heavy for "one bad sibling" cases.** If a 3-task bundle reroutes because one task's handoff was malformed, all 3 implements re-run together. In practice this is the same shared-implement-commit pattern canon already uses — Codex re-runs implement once for the whole bundle, fixes the failing task's handoff, and the bundle proceeds. Token cost is bounded.
- **Clean-task counter bump could mislead future analysis.** `preflight_rejections_current_loop` for a "clean" task includes bumps the task itself didn't cause. Anyone analyzing per-task pre-flight history needs to know this. Mitigation: extend the `taskPhasePreflightRejected` docstring to note the bundle case; consider whether `docs/pipeline-orchestrator.md` needs a sentence on the convention.
- **Append-vs-stomp logic for clean tasks** (AC-8) mirrors the failing-task path's append logic from the prior pre-flight fix. Same `## Stage 1` detection determines append vs stomp. The risk: clean tasks rarely have prior real reviews in practice (because the bundle would have approved together previously), so this code path is exercised less often than the failing-task one. Test the append path explicitly per AC-13's "prior real review" case.
- **Test isolation.** Bundle tests need to set up multiple `tasks/<id>/` directories with consistent shared-branch state. Look at `tests/run-task-counter-schema.test.ts`'s `withTempTasks` helper for the pattern.

## Human Test Plan

> Steps for the product owner. Behavior-focused, not implementation-focused.

1. **Create a 2-task bundle locally** (use any two pending tasks in the repo). Manually corrupt one task's `handoff.md` Validation Outcomes table (e.g., remove the required `lint` row). Trigger `canon run <task1> <task2>` past implement.
2. **Confirm both tasks land at "done" with verdict "changes_requested"** via `canon task status <task1>` and `canon task status <task2>`.
3. **Confirm both tasks have a `review.md`.** The corrupted task's should contain the validation-gate BLOCKED block listing the missing `lint` row. The clean task's should contain the bundle-rejection stub pointing at the corrupted sibling.
4. **Confirm both tasks reroute to implement** on the next pipeline pass. Inspect `phases.implement.status` — should be `pending` (reset by reroute logic).
5. **Regression check single-task path**: re-run a single task whose handoff is corrupted (no bundle siblings). Confirm behavior matches v1.5.x — only that task gets the BLOCKED `review.md`, status flow unchanged.
6. **Quality-log audit after 3-5 bundle pipelines**: confirm telemetry rows correctly distinguish "atomic bundle pre-flight" vs "normal bundle code-review reroute" — if not, file a follow-up for telemetry annotation.

---

## Spec Quality Checklist

- [x] Every AC states a verifiable outcome (file:line, status field, content shape)
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Known Risks covers failure modes for the trickiest ACs (counter semantics, append vs stomp, test isolation)
- [x] Human Test Plan uses behavior language only
- [x] Validation Required has at least one `- [x]` entry
