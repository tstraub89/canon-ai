# Implementation Handoff: reset-preflight-counter-on-changes-requested

> Author: Codex | Spec: `tasks/reset-preflight-counter-on-changes-requested/spec.md` | Plan: `tasks/reset-preflight-counter-on-changes-requested/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.

| File | What Changed |
|---|---|
| `src/task/index.ts` | Reset `preflight_rejections_current_loop` when a real `changes_requested` or `needs_re_review` verdict is recorded through `updateReviewCounters`. |
| `scripts/run-task/types.ts` | Updated the `PhaseEntry.preflight_rejections_current_loop` comment to describe reset on any real review verdict. |
| `tests/run-task-counter-schema.test.ts` | Added counter assertions for the pre-flight-then-real-review path and a sibling `needs_re_review` regression test. |
| `tests/run-task-prompts.test.ts` | Added focused assertions for the review-findings vs. pre-flight prompt routing branches. |
| `dist/cli/index.js` | Regenerated bundle output from `npm run build`. |
| `dist/scripts/run-task.js` | Regenerated bundle output from `npm run build`. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`. Reference those fields here instead of duplicating them as a second source of truth.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

`taskPhasePreflightRejected` already tracks pure pre-flight streaks separately from real review iterations. The bug was that a subsequent real non-approving review round incremented the review counters but left the pre-flight streak nonzero, so the next implement prompt kept routing to pre-flight instructions. The implementation mirrors the existing approval reset in the non-approving real-review branch, preserving monotonic totals while clearing only the loop-local streak once an actual review has run.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| _(none)_ | Implemented the plan as written. | None |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: pre-flight rejection followed by real `changes_requested` resets current pre-flight counter and counts one real iteration | Met | `updateReviewCounters` clears `preflight_rejections_current_loop` in the `changes_requested` branch; the existing `taskPhasePreflightRejected followed by a real changes_requested round counts only the real round` test now asserts the reset. |
| AC-2: same reset for `needs_re_review` | Met | Added `taskPhasePreflightRejected followed by a real needs_re_review round resets preflight counter`. |
| AC-3: approved / approved_with_nits reset preserved | Met | Existing `approved real review resets preflight_rejections_current_loop alongside iterations` test passed in focused and full suite runs. |
| AC-4: monotonic totals are not reset | Met | The AC-1 test still asserts `iterations_total === 1` and `changes_requested_total === 2`, and now also asserts `preflight_rejections_total === 1`. |
| AC-5: pure pre-flight streak unaffected | Met | Existing `taskPhasePreflightRejected bumps preflight_rejections counters for auto-block visibility` test passed with `preflight_rejections_current_loop === 3`. |
| AC-6: prompt routing selects review-findings when pre-flight counter is 0, and pre-flight branch when counter is nonzero | Met | Added two `promptImplementRevisions` branch-selection tests in `tests/run-task-prompts.test.ts`. |

## Edge Cases Considered

- Pure pre-flight loops still do not call `updateReviewCounters`, so their `preflight_rejections_current_loop` streak continues to accumulate for the auto-block safeguard.
- `needs_re_review` shares the non-approving real-review branch and is covered by a dedicated regression test.
- Monotonic totals (`preflight_rejections_total`, `changes_requested_total`, `iterations_total`) remain cumulative; only the loop-local pre-flight streak is cleared.
- `spec_review` continues to use the same shared counter helper without phase-specific branching; the reset remains a harmless no-op there because spec review has no pre-flight gate.

## Blockers

- None.

## Validation Outcomes

> All applicable checks must record a result before submitting for review. Result values:
>
> | Value | Use when |
> |---|---|
> | `Pass` | Agent ran the check; it passed. |
> | `Fail` | Agent ran the check; it failed. Move unresolved failures to Blockers. |
> | `not_configured` | Check doesn't apply to this task type. Only valid for non-required checks. |
> | `N/A` | Legacy synonym for `not_configured`. Prefer `not_configured` going forward. |
> | `human_pending` | Only a human can run this (OAuth, cross-browser, deployed-only smoke). Required checks may use this state; the `human_review` gate will refuse to close the task until the human resolves it OR writes an explicit waiver in done.md. |
> | `deferred_by_spec` | Explicitly out of scope per spec. Requires a spec citation in Notes (e.g., `Spec: §Non-Goals — explicitly defers this`). |
> | `blocked` | Check would have run but infrastructure was unavailable (CI down, network out). Triage required — distinct from `Fail`. |
>
> Required checks (those in spec.md's Validation Required section) cannot be marked `N/A` or `not_configured` — adjust the spec or run the check.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Completed successfully. |
| `npm run type-check` | Pass | Completed successfully. |
| `npm test` | Pass | Full suite completed: 701 pass, 1 skip, 0 fail. |
| `npm run build` | Pass | Completed successfully and regenerated `dist/cli/index.js` and `dist/scripts/run-task.js`. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [x] Branch is current with `origin/<base>` (verified `origin/release/v1.9` is an ancestor of HEAD; task branch has no upstream configured)

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

| File | What Changed |
|---|---|

> **Reverting a file?** Perfect revert (no longer in `git diff base...HEAD`): delete it from all prior Changes tables and omit it here. Imperfect revert (still in diff, e.g. trailing newline): add it here as "Reverted to original (describe residual diff)".

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
