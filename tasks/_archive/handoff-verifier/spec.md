# Spec: handoff-verifier — Verify handoff matches git diff

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

The pipeline already verifies handoffs against the **dirty tree** pre-commit (`autoCommitCode()` in `scripts/run-task.ts`), and runs a Stage-0 pre-flight at code-review entry (`validateHandoff()`) that checks Validation Outcomes and AC Coverage tables. But there is no **post-commit** check that the committed diff actually matches what the handoff Changes table claims.

The original incident class is documented in `docs/patterns.md` and `CLAUDE.md`: edges where edits slip past the pre-commit checks (manual mid-implement commits, the supervising orchestrator getting confused about state, bundle-mode interactions) leave the reviewer with a stale understanding of what changed. The reviewer's manual workaround today is "always run `git diff` to confirm what's there." That workaround is a memory tax on the reviewer that a code-level check could remove.

This task adds the missing layer: independent verification at the code-review phase boundary that the handoff Changes table and the actual committed diff agree.

## Decision

Add a new bundle-aware function `verifyHandoffAgainstDiff(taskIds: string[], baseRef: string)` that cross-references the union of all bundle members' handoff Changes tables against the diff entries returned by `git diff <baseRef>...HEAD --name-status -M`, with rename pairs (`R<score>\told\tnew`) expanded so both pre-image and post-image paths participate in matching (per AC-2a). Two directions, both reportable:

1. A file in *any* task's handoff Changes table that is **not** in the diff → handoff hallucinated or the change was reverted post-handoff. Issue.
2. A file in the diff that is **not** in any task's handoff Changes table → silent edit, the original incident class. Issue.

The check is **bundle-aware by construction** — a file listed only in task A's handoff must not be flagged as missing from task B's. This is why the function takes `taskIds: string[]`, not a single `taskId`.

**Where it runs**: in `runPhase('code_review')`'s pre-flight block, *after* the existing per-task `validateHandoff()` loop and *before* the rejection-write step. It runs **once per pipeline invocation**, not once per task. `validateHandoff(taskId: string)` is unchanged — it keeps its single-task contract for the existing implement-phase auto-advance caller (`tryEvidenceAdvance`), which does not need bundle context.

On failure, reuse the existing rejection path: the bundle-wide issues are appended to *every* bundle member's `review.md` rejection (since a "file in diff but in no handoff" finding cannot be cleanly attributed to one task and the entire bundle reroutes to implement together anyway — see AC-4 for the exact attribution rule). Each task's `code_review.status = "done"` with `verdict = "changes_requested"`, routing the bundle back to implement. Codex addresses the mismatch (typically by amending the handoff to match the diff or by reverting/re-doing the unintended changes).

## Non-Goals

- **Auto-correcting mismatches.** First cut is strict — issues are reported, not silently fixed. (Auto-correct, à la the `_verify_against_batch` pattern from prior LLM-pipeline work, can come later if we find it useful.)
- **A new pipeline phase.** Extends the existing `validateHandoff()` pre-flight; no new phase, no `PHASE_ORDER` change, no new template.
- **Verifying the *content* of changes.** The check is file-level presence/absence only. We are not validating that the *substance* of a change matches the handoff's description.
- **Replacing or modifying `autoCommitCode()`.** That function continues to do its pre-commit dirty-tree check unchanged. The new check is defense-in-depth at a different boundary.
- **Cross-iteration state tracking.** The check runs every time `validateHandoff()` runs (every code-review entry) — no new iteration accounting.

## Acceptance Criteria

- [ ] **AC-1**: A new function `verifyHandoffAgainstDiff(taskIds: string[], baseRef: string)` returns `string[]` — empty when the union of handoffs and the diff agree, populated with one issue message per mismatch when they don't. The function takes the full bundle's task IDs in one call so it can compute a bundle-wide union of Changes-table files.
- [ ] **AC-2**: For each file `F` in any bundle member's handoff Changes table (collected via the existing `parseHandoffFiles()` helper, called once per task ID and unioned), `F` must appear in the bundle-wide **diff path set**. The path set is built from `git diff <baseRef>...HEAD --name-status -M` where each rename line `R<score>\told\tnew` contributes BOTH `old` and `new` to the path set (per AC-2a). If `F` is absent from the expanded path set, an issue message names `F` and the claiming task (e.g., `[task-id] handoff→diff: F listed in handoff but not in diff`).
- [ ] **AC-2a** (rename handling): The diff is enumerated via `git diff <baseRef>...HEAD --name-status -M`, NOT `--name-only -M`. With `--name-only`, even when `-M` enables rename detection, only the post-image (new) path is emitted — so a handoff that lists the pre-image (old) path of a renamed file produces a false-positive `handoff→diff` issue. With `--name-status`, rename lines `R<score>\told\tnew` are parsed and BOTH paths are added to the diff path set, treating renames symmetrically: handoff listing either side is "covered." `autoCommitCode()` already accepts the pre-image path as a valid handoff entry for renames, so the verifier must match that contract.
- [ ] **AC-3**: For each diff entry (a simple change for `M`/`A`/`D`/`C`, or a rename pair for `R`), the entry must be "covered" by the bundle handoff or the exempt list. Coverage rules: a simple entry with path `P` is covered iff `P` is in some bundle handoff OR `P` is in `HANDOFF_DIFF_EXEMPT_PATHS`. A rename entry `(old, new)` is covered iff EITHER `old` OR `new` is in some bundle handoff (or both are in the exempt list). Uncovered entries produce one issue per entry; for renames, the issue references both `old` and `new` paths so the reviewer can disambiguate (e.g., `diff→handoff: rename old → new — neither path in any bundle handoff`).
- [ ] **AC-4**: `runPhase('code_review')`'s pre-flight (in `scripts/run-task.ts`) calls `verifyHandoffAgainstDiff(taskIds, baseRef)` exactly once after the existing per-task `validateHandoff()` loop and before the rejection-write step. If it returns a non-empty list, those bundle-wide issues are appended to **every** bundle member's `preflightFailed` entry (each task's `review.md` rejection includes them) and the bundle reroutes via the existing `runTaskShFor(taskId, 'phase', taskId, 'code_review', 'done', 'changes_requested')` path. Per-task `validateHandoff()` issues continue to be attributed only to the task they came from.
- [ ] **AC-5**: Files that appear in the pre-code-review diff but are not Codex-authored content (i.e., orchestrator-managed paths the implement-phase commit may include) are exempt from the "diff has file not in handoff" check. The exemption list is documented inline as a constant; the implementer determines the canonical entries empirically from what `autoCommitCode()` lands in the diff. Two clarifications carried forward from spec review: (a) `autoCommitArtifacts()` runs in the *later* artifact-commit path (after `human_review`) and is **not** part of the pre-code-review diff — paths it manages do not need exemption here. (b) Per Codex's spec_review note in `notes.md`, `tasks/<id>/handoff.md` is not committed before code_review and therefore does not appear in the diff to be exempted. The exemption set may end up empty in canon-ai's current implementation; the constant exists as a forward-compatibility seam, with the single source of truth (no scattered string literals) as a hard rule.
- [ ] **AC-6**: At least three test rows in `tests/run-task-validation.test.ts`: a positive case (handoff matches diff, no issues), a negative case for each direction (handoff lists file not in diff; diff has file not in handoff). Tests use a synthetic / fixture-style approach with the diff input passed in (or stubbed) rather than running real `git diff` in the test — the implementation should expose a thin seam (e.g., the `git diff` call factored into a helper that tests can stub, or the function accepting an injected diff list) to make this practical.
- [ ] **AC-7**: `validateHandoff(taskId: string)`'s public signature is unchanged. The new bundle-wide check is **not** plumbed through it; it is a sibling check called separately from the code-review pre-flight. Existing callers (`tryEvidenceAdvance` and the per-task pre-flight loop) continue to work without modification.
- [ ] **AC-8**: When the new check fails, the rejection reason in each affected task's `review.md` explicitly identifies which direction failed (`handoff→diff` or `diff→handoff`) and which files. Bundle-wide issues are clearly marked as bundle-level (e.g., a header line distinguishing them from per-task `validateHandoff()` issues). Reviewer-readable.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task.ts` | Add `verifyHandoffAgainstDiff(taskIds: string[], baseRef: string): string[]` near `parseHandoffFiles()`. Call it from the `case 'code_review'` pre-flight in `runPhase()`, after the per-task `validateHandoff()` loop. Define an inline exemption-list constant for orchestrator-managed paths. Modify the existing `preflightFailed` aggregation to merge bundle-wide issues into each task's entry. |
| `tests/run-task-validation.test.ts` | Add positive + negative test rows per AC-6. May require a small refactor seam (e.g., factoring the `git diff` shell-out into a helper, or making the diff list an injectable parameter on `verifyHandoffAgainstDiff`) so tests don't need a real git repo. |

### Interaction Dependencies

- `parseHandoffFiles()` (existing, around `run-task.ts:2464–2483`): reused for parsing each bundle member's Changes table. Do not reimplement.
- `autoCommitCode()` (existing, around `run-task.ts:2549–2739`): unchanged. The new check is a *second* layer that runs after auto-commit has landed. Together they form a two-layer guard (pre-commit + post-commit). Use `autoCommitCode`'s file-collection logic (the `allHandoffFiles` set built from `parseHandoffFiles(taskId)` per task) as the model for the bundle-wide union — same data, different consumer.
- `validateHandoff(taskId)` (existing, around `run-task.ts:1007–1024`): unchanged. Continues to run per-task in the existing pre-flight loop and from `tryEvidenceAdvance`. The new bundle-wide check is **not** routed through it.
- `runPhase('code_review')` (existing, around `run-task.ts:3601–3692`): the modification site. The existing pre-flight loop builds `preflightFailed` per task; the new call adds a bundle-wide phase that, on failure, appends the bundle-wide issues to each entry (creating entries for tasks that had no per-task issues). The downstream `review.md` write + `runTaskShFor(...'changes_requested')` calls are unchanged.
- `getBaseBranch(taskIds)` (existing, used by `autoCommitCode` around `run-task.ts:2607`): the canonical baseRef resolution. Reuse it — do not reimplement.

### Data Model Changes

None. No new fields in `status.json`, no new artifact templates, no new phase. Extends an existing function's behavior only.

### Resolving the base ref

The new function needs the task's baseline commit to compute the diff. The orchestrator already tracks this — `autoCommitCode()` uses `getBaseBranch(taskIds)` for its own checks. The pre-flight call site must use the same helper (passing `taskIds`, the bundle, not a single ID) so the bundle's shared base branch is used. Document the resolution inline; do not hand-roll a new mechanism.

### Where the diff comes from

The diff is taken in the **active pipeline cwd** — `getActiveCwd(taskIds)` — not `REPO_ROOT`. In worktree mode the post-implement commit lands in the worktree, so a `git diff` rooted at `REPO_ROOT` would see nothing. Use the same cwd-resolution as `autoCommitCode()` and the existing code-review artifact sync block (around `run-task.ts:3646–3662`).

## Validation Required

- [x] Type checking (`npm run type-check`)
- [x] Unit tests (`npm test`)

(No lint configured; no build step; no E2E surface. See `docs/architecture.md` Validation matrix for canon-ai's bindings.)

## Docs Impact

- `docs/patterns.md` — the new check is a concrete instance of the "Validation Gate Discipline" pattern. Worth updating Quick Reference table (and possibly Known Pitfalls) to mention the new check once it lands.
- `docs/architecture.md` — the "Boundaries & Contracts" section currently mentions `autoCommitCode()` and `validateHandoff()`. Add a sentence about the post-commit cross-check forming a second layer.

## Known Risks

- **Exemption set determination is load-bearing**: getting it wrong silently breaks the verifier. The implementer must empirically determine what the orchestrator actually commits between `<baseRef>` and `HEAD` before code_review, and exempt anything that's not Codex-authored content. Per Codex's spec_review investigation, this set may be empty in canon-ai's current implementation (`autoCommitCode()` only stages files in the handoff Changes table; `handoff.md` itself is not pre-committed). Verify empirically rather than assuming — silent breakage is the failure mode.
- **baseRef detection**: getting the wrong base ref produces wildly wrong diffs (too wide → false positives, too narrow → missed issues). Reuse the same resolution as `autoCommitCode()` to avoid two divergent implementations.
- **Renamed files (load-bearing — Round 1 missed this)**: `git diff --name-only -M` enables rename *detection* but still only emits the post-image (new) path. A handoff that lists the pre-image (old) path of a renamed file — which `autoCommitCode()` accepts as valid — would false-positive on the `handoff→diff` check. The fix is `git diff --name-status -M` and explicit rename-pair handling per AC-2a / AC-3: parse `R<score>\told\tnew` lines, expand to both paths in the diff set, and treat rename pairs symmetrically (covering either side covers both). Without symmetric handling, every task that renames a file will trip the verifier.
- **Bundle mode**: with multiple tasks bundled, multiple `handoff.md` files exist. The verifier must collect Changes-table entries from *all* of them before deciding whether a diffed file is "in some handoff." `parseHandoffFiles()` already accepts an array of task IDs — use that path.
- **Empty-diff edge case**: a task that legitimately changed nothing (e.g., the spec turned out to be a no-op once Codex investigated) produces an empty diff and an empty Changes table. Should pass cleanly. Test for this.
- **Performance**: spawning `git diff` adds a subprocess call to `validateHandoff()`. Should be fast enough at canon-ai's scale, but worth noting if `validateHandoff()` is in a hot path.

## Human Test Plan

> Steps for the product owner. Run after the task ships.

1. Run a normal task end-to-end through the pipeline. **Expected**: `code_review` proceeds without comment about handoff mismatches; the new check is silent when everything matches. Confirm by inspecting `tasks/<id>/review.md` — no rejection from the verifier.

2. Pause a task between implement and code_review. Edit `tasks/<id>/handoff.md` to add a fake row to the Changes table claiming a file changed that didn't. Resume the pipeline. **Expected**: code_review rejects, `review.md` names the fake file and identifies it as "in handoff but not in diff."

3. Pause a task between implement and code_review. Manually edit a file that the handoff doesn't list (e.g., touch a comment in an unrelated source file and commit it). Resume the pipeline. **Expected**: code_review rejects, `review.md` names the unlisted file and identifies it as "in diff but not in handoff."

4. After (2) or (3), confirm the orchestrator routes back to implement (existing behavior — verifying it still works with the new check in place). Codex re-implements (correcting the handoff or reverting the change), code_review re-runs, and the verifier passes on the second try.

5. Run a bundled task (two task IDs to one `run-task.ts` invocation). Confirm the verifier checks both tasks' handoffs together and doesn't flag files listed in one bundle member's handoff just because they're missing from another's.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (test names, file checks, output shape)
- [x] Affected Files lists specific files with specific change descriptions
- [x] Plan steps reference actual function/file names from the codebase (`parseHandoffFiles`, `autoCommitCode`, `validateHandoff`, `runPhase('code_review')`)
- [x] Known Risks covers failure modes for the trickiest ACs (exemption list, baseRef, rename, bundle, empty diff)
- [x] Human Test Plan uses product language (no code, no file names beyond the touchable artifacts)
- [x] Validation Required has at least one entry checked
