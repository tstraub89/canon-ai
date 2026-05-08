# QA Summary: handoff-verifier — Verify handoff matches git diff

> Written by: Claude | Date: 2026-05-07

## What Changed

A post-commit verification step was added to the code-review pre-flight. Previously the pipeline checked that the handoff Changes table matched the dirty working tree *before* the auto-commit, but had no guard at the code-review boundary to confirm the committed diff still matched the handoff. This task closes that gap.

The new check runs once per pipeline invocation, after the existing per-task validation loop and before any rejection writes. It compares the union of all bundle members' handoff Changes tables against the actual committed diff in two directions: files the handoff claims that aren't in the diff, and files in the diff that no handoff mentions. Failures are written to every bundle member's review file under a clearly labelled bundle-level section and route the bundle back to implement via the existing changes-requested path.

## Files Changed

| File | What changed |
|---|---|
| `scripts/run-task.ts` | Added `HANDOFF_DIFF_EXEMPT_PATHS` constant, `verifyHandoffAgainstDiff()` (runtime), and `verifyHandoffAgainstDiffFromData()` (test seam). Extended code-review pre-flight to run the bundle-wide verifier once and merge its issues into each affected task's preflight entry. |
| `tests/run-task-validation.test.ts` | Five new test rows via the injected-data seam: positive match, handoff→diff negative, diff→handoff negative, bundle-union behavior, and empty diff+handoff. |
| `tasks/handoff-verifier/status.json` | Pipeline state advanced through implement. |

## How to Test

1. **Happy path**: run any task through the pipeline normally. Code review should proceed without a handoff-verification rejection. Check `tasks/<id>/review.md` — no bundle-level section should appear.
2. **Handoff hallucination**: between implement and code_review, edit `tasks/<id>/handoff.md` to add a fake row claiming a file changed that didn't. Resume the pipeline. Expected: code_review rejects; `review.md` names the file as "in handoff but not in diff."
3. **Silent edit**: between implement and code_review, manually edit a file not in the handoff and commit it. Resume the pipeline. Expected: code_review rejects; `review.md` names the file as "in diff but not in any bundle handoff."
4. **Bundle**: run two tasks bundled. Confirm a file listed in one member's handoff is not flagged as missing from the bundle.
5. After step 2 or 3: confirm the orchestrator routes back to implement, Codex corrects the handoff (or reverts the change), and code_review passes on the second try.

## Test Results

| Check | Result | Notes |
|---|---|---|
| Type-check | Pass | |
| Unit tests | Pass | 63 tests, 5 new |
| Lint | N/A | No linter configured for canon-ai |
| Build | N/A | No build step; scripts run via `tsx` |

Code review verdict: **Approved with nits**. No correctness bugs, no risk/guardrail findings. Two optional nits (duplicate log banners in bundle-failure path; no test for nonempty `HANDOFF_DIFF_EXEMPT_PATHS`) and one spec-accuracy gap (docs described `parseHandoffFiles()` as accepting an array; actual signature is single-ID). None block shipping.

## Decisions Made

- **Test seam as a separate exported function** (`verifyHandoffAgainstDiffFromData`) rather than threading injectable parameters through the public `verifyHandoffAgainstDiff()` signature. Keeps the public API exact per spec while making synthetic-data tests practical.
- **Exemption list is currently empty.** The orchestrator's auto-commit only stages files already listed in the handoff Changes table, so no orchestrator-managed paths land in the diff before code_review. The constant exists as a forward-compatibility seam and single source of truth.

## Open Questions

(Both review nits were folded inline before shipping — see "Inline Nit Fixes" below.)

## Inline Nit Fixes (post-review, pre-ship)

Per human direction at the spec gate to fold review nits inline:

1. **Duplicate "FAILED" log banner** — removed the bundle-specific banner in the code-review pre-flight (`scripts/run-task.ts`). The outer aggregation banner already logs each issue with a `[bundle:taskId]` prefix; the inner banner was double-emitting the same content. 2 lines deleted, no logic change. Tests still pass (63/63).
2. **Spec wording inaccuracy** — corrected `tasks/handoff-verifier/spec.md` Known Risks bullet that claimed `parseHandoffFiles()` accepts an array of task IDs. Actual signature is single-ID (call once per task and union, per AC-2). 1-line wording fix; AC-2 itself was already accurate.

## Environment Gap (separate follow-up)

A real harness gap surfaced during this run, worth tracking as a separate canon task: the worktree was created without `node_modules`, and Codex hit `@esbuild/darwin-arm64` missing during validation. Codex worked through it via creative `tar`-from-cache restoration, but the proper fix is the orchestrator running `npm install` (or a project-agnostic equivalent that detects `package.json`, `requirements.txt`, etc.) on worktree creation. Symlinking project-specific resources (`.env`, `node_modules`, etc.) is one possible approach. Not in scope for this task.

---

## Proposed Changelog

This is a **minor** bump — a new validation gate is added to the code-review pre-flight with no breaking changes to existing workflow, templates, or `status.json` schema. Per decisions.md, minor bumps require human review before the changelog/version-bump commit lands.

```markdown
## [next] — 2026-05-07

### Added

- Post-commit handoff verification at code-review pre-flight: the pipeline now
  cross-checks the committed diff against every bundle member's handoff Changes
  table and rejects with a labelled bundle-level finding when they diverge —
  catching both hallucinated handoff entries and silent edits not mentioned in
  any handoff.
```

**Proposed version bump**: minor (e.g., `0.x.0 → 0.(x+1).0`). Please review the changelog copy above and confirm before the version-bump commit lands.
