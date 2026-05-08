# Implementation Handoff: handoff-verifier

> Author: Codex | Spec: `tasks/handoff-verifier/spec.md` | Plan: `tasks/handoff-verifier/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

| File | What Changed |
|---|---|
| `scripts/run-task.ts` | Added `HANDOFF_DIFF_EXEMPT_PATHS`, exported `verifyHandoffAgainstDiff()` plus the test seam `verifyHandoffAgainstDiffFromData()`, and extended the `code_review` pre-flight to run the bundle-wide diff check once per invocation and write bundle-level issues into each affected `review.md`. |
| `tests/run-task-validation.test.ts` | Added direct tests for the new diff verifier through the injected-data seam: positive match, both mismatch directions, bundle union behavior, and empty-diff handling. |
| `tasks/handoff-verifier/status.json` | Advanced the task state to `implement → done` once implementation and validation completed. |

## Intent & Rationale

The new verifier closes the gap between the handoff Changes table and the actual post-commit diff. The implementation keeps `validateHandoff(taskId)` single-task for its existing caller, and adds a separate bundle-aware diff check at code-review preflight so bundle members are validated together without changing the old API.

The exemption constant is intentionally empty in canon-ai's current flow. `autoCommitCode()` only stages files already listed in the handoff Changes tables, so there are no known orchestrator-managed paths that appear in the pre-review diff and need to be exempted.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Added `verifyHandoffAgainstDiffFromData()` as a separate exported test seam instead of threading injected diff/cwd params through the public `verifyHandoffAgainstDiff()` signature. | AC-1 required the public signature to stay exact. The seam keeps the runtime API unchanged while letting tests run with synthetic diff data. | None; the public API and behavior required by the spec are unchanged. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `verifyHandoffAgainstDiff(taskIds, baseRef)` returns `string[]`; the runtime API stays exact and delegates to the injected-data seam internally. |
| AC-2 | Met | Each task’s handoff files are parsed with `parseHandoffFiles(taskId)` and checked against `git diff <baseRef>...HEAD --name-only -M`. Missing files emit `[task-id] handoff→diff` issues. |
| AC-3 | Met | Diff files are compared against the bundle-wide union of handoff files; any non-exempt file missing from the union emits `diff→handoff` issues. |
| AC-4 | Met | `runPhase('code_review')` runs the bundle-wide verifier once after the per-task `validateHandoff()` loop, merges bundle issues into each affected task’s preflight entry, and routes back through the existing changes-requested path. |
| AC-5 | Met | `HANDOFF_DIFF_EXEMPT_PATHS` is the single source of truth and currently empty. `autoCommitArtifacts()` paths are not part of the pre-code-review diff, and `handoff.md` is read from disk rather than from the diff. |
| AC-6 | Met | Added five synthetic test rows covering positive, both mismatch directions, bundle union behavior, and empty diff/handoff behavior. |
| AC-7 | Met | `validateHandoff(taskId)` is unchanged and still serves the existing callers. |
| AC-8 | Met | Bundle failures render under a distinct `Bundle-Level Handoff Verification` section in `review.md`, and the emitted issue strings include the direction markers. |

## Edge Cases Considered

- Empty diff and empty handoff pass cleanly.
- Files listed in one bundle member’s handoff are not flagged just because a sibling task doesn’t list them.
- Renames stay visible because the diff uses `-M`.
- `getActiveCwd(taskIds)` is used for the diff command so worktree runs inspect the correct checkout.
- A `git diff` failure returns a single issue string instead of throwing.

## Blockers

- None.

## Validation Outcomes

> All applicable checks must pass before submitting for review. If a check appears in spec.md's Validation Required section, it must be recorded as Pass or Fail here — do not mark a required check N/A. Use N/A only for checks that the spec did not require, and explain why in Notes. Failed checks must be fixed — do not submit with failures. Move unresolved failures to Blockers.

| Check | Result | Notes |
|---|---|---|
| `npm run type-check` | Pass | Ran successfully after restoring the local cached TypeScript toolchain in the worktree. |
| `npm test` | Pass | 63 tests passed, including the new diff-verifier rows. |
| `lint` | N/A | No linter configured for canon-ai. |
| `build` | N/A | No build step exists; scripts run through `tsx`. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>` (worktree branch has no upstream configured and is one commit ahead of `origin/dev`)

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Findings addressed

- _correctness bug:_ "<one-line summary>" → fixed at file:line
- _risk/guardrail:_ ... → ...
- _spec gap:_ ... → ...
- _optional cleanup/nit:_ ... → addressed / deferred (rationale)

### AC deltas (if any)

- AC-N: was Partial → now Met (file:line)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |
-->
