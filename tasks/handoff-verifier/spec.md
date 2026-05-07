# Spec: handoff-verifier — Verify handoff matches git diff

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

The pipeline already verifies handoffs against the **dirty tree** pre-commit (`autoCommitCode()` in `scripts/run-task.ts`), and runs a Stage-0 pre-flight at code-review entry (`validateHandoff()`) that checks Validation Outcomes and AC Coverage tables. But there is no **post-commit** check that the committed diff actually matches what the handoff Changes table claims.

The original incident class is documented in `docs/patterns.md` and `CLAUDE.md`: edges where edits slip past the pre-commit checks (manual mid-implement commits, the supervising orchestrator getting confused about state, bundle-mode interactions) leave the reviewer with a stale understanding of what changed. The reviewer's manual workaround today is "always run `git diff` to confirm what's there." That workaround is a memory tax on the reviewer that a code-level check could remove.

This task adds the missing layer: independent verification at the code-review phase boundary that the handoff Changes table and the actual committed diff agree.

## Decision

Extend `validateHandoff()` with a new sub-check, `verifyHandoffAgainstDiff()`, that cross-references the handoff Changes table(s) against `git diff <baseRef>...HEAD --name-only -M` for the task. Two directions, both reportable:

1. A file in the handoff Changes table that is **not** in the diff → handoff hallucinated or the change was reverted post-handoff. Issue.
2. A file in the diff that is **not** in any handoff Changes table → silent edit, the original incident class. Issue.

On failure, reuse the existing rejection path in `runPhase('code_review')`: write the rejection reason into `review.md`, mark `code_review.status = "done"` with `verdict = "changes_requested"`, route back to implement. Codex addresses the mismatch (typically by amending the handoff to match the diff or by reverting/re-doing the unintended changes).

## Non-Goals

- **Auto-correcting mismatches.** First cut is strict — issues are reported, not silently fixed. (Auto-correct, à la the `_verify_against_batch` pattern from prior LLM-pipeline work, can come later if we find it useful.)
- **A new pipeline phase.** Extends the existing `validateHandoff()` pre-flight; no new phase, no `PHASE_ORDER` change, no new template.
- **Verifying the *content* of changes.** The check is file-level presence/absence only. We are not validating that the *substance* of a change matches the handoff's description.
- **Replacing or modifying `autoCommitCode()`.** That function continues to do its pre-commit dirty-tree check unchanged. The new check is defense-in-depth at a different boundary.
- **Cross-iteration state tracking.** The check runs every time `validateHandoff()` runs (every code-review entry) — no new iteration accounting.

## Acceptance Criteria

- [ ] **AC-1**: A new function `verifyHandoffAgainstDiff(taskIds: string[], baseRef: string)` returns `string[]` — empty when handoff and diff agree, populated with one issue message per mismatch when they don't.
- [ ] **AC-2**: For each file in any task's handoff Changes table (parsed via the existing `parseHandoffFiles()` helper), the function verifies it appears in `git diff <baseRef>...HEAD --name-only -M`. If absent, an issue message names the file and which task's handoff claimed it.
- [ ] **AC-3**: For each file in `git diff <baseRef>...HEAD --name-only -M`, the function verifies it appears in at least one task's handoff Changes table — except for explicitly exempt paths (see AC-5). If a non-exempt file is missing from all handoffs, an issue message names the file.
- [ ] **AC-4**: `validateHandoff()` (or whichever existing aggregator runs at code-review entry) calls `verifyHandoffAgainstDiff()` and concatenates its issues into the returned list. Existing rejection logic in `runPhase('code_review')` handles a non-empty list with no further changes.
- [ ] **AC-5**: Orchestrator-managed artifacts that don't belong in the handoff Changes table by convention are exempt from the "diff has file not in handoff" check. At minimum: `tasks/<id>/handoff.md` itself, and any other artifacts the orchestrator commits as part of the implement-phase commit. Exemption list is documented inline as a constant.
- [ ] **AC-6**: At least three test rows in `tests/run-task-validation.test.ts`: a positive case (handoff matches diff, no issues), a negative case for each direction (handoff lists file not in diff; diff has file not in handoff). Tests use a synthetic / fixture-style approach — no real git operations required if a thin abstraction makes that practical.
- [ ] **AC-7**: `validateHandoff()`'s public signature is unchanged. Existing callers continue to work.
- [ ] **AC-8**: When the new check fails, the rejection reason in `review.md` explicitly identifies which direction failed (handoff→diff or diff→handoff) and which files. Reviewer-readable.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task.ts` | Add `verifyHandoffAgainstDiff()` near `parseHandoffFiles()`. Call it from `validateHandoff()`. Define an inline exemption-list constant for orchestrator-managed paths. |
| `tests/run-task-validation.test.ts` | Add positive + negative test rows per AC-6. |

### Interaction Dependencies

- `parseHandoffFiles()` (existing, around `run-task.ts:2464–2483`): reused for parsing. Do not reimplement Changes-table parsing.
- `autoCommitCode()` (existing, around `run-task.ts:2549–2739`): unchanged. The new check is a *second* layer that runs after auto-commit has landed. Together they form a two-layer guard (pre-commit + post-commit).
- `validateHandoff()` (existing, around `run-task.ts:3622`): aggregator that the new check joins. Existing checks (Validation Outcomes table, AC Coverage table, required-checks-from-spec) run first; the new check is appended.
- `runPhase('code_review')` (existing, around `run-task.ts:3601–3681`): unchanged. Its existing handling of non-empty `validateHandoff()` results writes the rejection.

### Data Model Changes

None. No new fields in `status.json`, no new artifact templates, no new phase. Extends an existing function's behavior only.

### Resolving the base ref

The new function needs the task's baseline commit to compute the diff. The orchestrator already tracks this — `autoCommitCode()` uses it for its own checks. The implementation should use the same resolution path (e.g., the task's `base_branch` resolved to the commit where the task's branch diverged). Document the resolution inline; do not hand-roll a new mechanism.

## Validation Required

- [x] Type checking (`npm run type-check`)
- [x] Unit tests (`npm test`)

(No lint configured; no build step; no E2E surface. See `docs/architecture.md` Validation matrix for canon-ai's bindings.)

## Docs Impact

- `docs/patterns.md` — the new check is a concrete instance of the "Validation Gate Discipline" pattern. Worth updating Quick Reference table (and possibly Known Pitfalls) to mention the new check once it lands.
- `docs/architecture.md` — the "Boundaries & Contracts" section currently mentions `autoCommitCode()` and `validateHandoff()`. Add a sentence about the post-commit cross-check forming a second layer.

## Known Risks

- **`handoff.md` exemption is load-bearing**: the orchestrator commits `tasks/<id>/handoff.md` as part of the implement-phase commit, but Codex doesn't list its own handoff in the Changes table. Without an exemption, every task fails the check. The implementation must hardcode this exemption (and any similar orchestrator-managed artifacts). This is the easiest way to break the verifier silently — verify the exemption list is correct early.
- **baseRef detection**: getting the wrong base ref produces wildly wrong diffs (too wide → false positives, too narrow → missed issues). Reuse the same resolution as `autoCommitCode()` to avoid two divergent implementations.
- **Renamed files**: `git diff --name-only` without `-M` reports renamed files as separate add+delete pairs, which would confuse the cross-check. Use `-M` to get rename detection. Document why if you don't.
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
