# Implementation Handoff: code-review-counter-reset-helper

> Author: Codex | Spec: `tasks/code-review-counter-reset-helper/spec.md` | Plan: `tasks/code-review-counter-reset-helper/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `src/task/index.ts` | Added `taskResetCodeReview()`, wired `reset-code-review` into `taskCmd`, exposed the new usage string, archived `review.md`, dropped `claude_review`, zeroed the loop-local code-review counters, and preserved the lifetime counters while re-deriving top-level `status`. |
| `scripts/run-task/phases/code-review.ts` | Rewrote the single-task and bundle auto-block recovery strings to point at `canon task reset-code-review <id>` instead of hand-editing `status.json`. |
| `tests/task-cli.test.ts` | Added coverage for the new helper, the `taskCmd` dispatch, the non-`code_review` guard, worktree routing, archive/session behavior, and the "iterations stays unchanged" invariant. |
| `docs/pipeline-orchestrator.md` | Refreshed the task-management table and auto-block guidance so the operator docs match the new helper instead of the old hand-edit recovery path. |
| `templates/docs/pipeline-orchestrator.md` | Synced the task-management helper docs template so the canonical operator guidance and the template mirror stay aligned. |
| `dist/cli/index.js` | Rebuilt bundle output from `src/task/index.ts`. |
| `dist/scripts/run-task.js` | Rebuilt bundle output from `src/task/index.ts` and `scripts/run-task/phases/code-review.ts`. |
| `tasks/code-review-counter-reset-helper/status.json` | Updated the task's own implement-phase state (`branch`, `implement.status`) as part of the current run. |
| `tasks/code-review-counter-reset-helper/handoff.md` | Added this implementation handoff. |

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

Mirror the existing spec-review reset helper for `code_review`, but keep the code-review-specific field set intact: zero only the current-loop counters, clear the verdict, archive the prior review, and drop the stored Claude review session. Then route the recovery message through the helper so operators stop hand-editing `status.json`, and keep the operator guide aligned with the new command.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Updated `docs/pipeline-orchestrator.md` even though it was not listed in the spec Affected Files | The doc already contained the stale hand-edit recovery guidance. Updating it keeps the operator guide consistent with the new helper and matches the spec's Docs Impact note. | None |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: A new subcommand `canon task reset-code-review <TASK-ID>` exists, dispatched from the `taskCmd` switch in `src/task/index.ts` (alongside `reset-spec-review`). Running it on a task at a `code_review` auto-block sets `phases.code_review.status = "pending"`, `iterations_current_loop = 0`, `preflight_rejections_current_loop = 0`, and `verdict = ""`. Verify by unit test asserting the post-reset `status.json` field values. | Met | `taskCmd` dispatch and usage at `src/task/index.ts:39`, `src/task/index.ts:1049-1085`, `src/task/index.ts:1423-1428`; behavior asserted in `tests/task-cli.test.ts:460-501`. |
| AC-2: The helper re-derives the top-level `status` pointer (no inconsistent state) and writes atomically — consistent with `taskResetSpecReview` / `taskPhase`. Verify by asserting the top-level `status` field after reset. | Met | `writeStatusAtomic()` re-derives `status` before the atomic rename at `src/task/index.ts:88-95`; the reset test confirms the top-level pointer stays `code_review` after the helper runs at `tests/task-cli.test.ts:489-496`. |
| AC-3: The helper routes to the **worktree** `status.json` when one exists past plan (via the same `resolveTaskCwd` / `taskDirForCwd` path the other helpers use). Verify by test with a worktree present. | Met | Uses `resolveTaskCwd()` + `taskDirForCwd()` at `src/task/index.ts:1051-1054`; worktree routing is covered by `tests/task-cli.test.ts:1568-1654`. |
| AC-4: An existing `review.md` is archived to `review-prior-N.md` (next free N) before reset; the `claude_review` session entry is dropped if present. Verify by test. | Met | Archive + session-drop logic is at `src/task/index.ts:1065-1084`; the test asserts `review-prior-1.md` exists and `sessions.claude_review` is cleared at `tests/task-cli.test.ts:486-498` and `tests/task-cli.test.ts:1645-1653`. |
| AC-5: Invalid input is rejected with a clear error: missing/unknown task id → usage/`no status.json` error; the command operates only on `code_review`. Verify by test on the error paths. | Met | Usage and `no status.json` checks live at `src/task/index.ts:1049-1063`; the tests cover empty id, missing task, and non-`code_review` rejection at `tests/task-cli.test.ts:500-520`. |
| AC-6: The `code_review` auto-block recovery message at `code-review.ts:236–238` (single-task) **and** the bundle variant (≈ line 275) are rewritten to instruct `canon task reset-code-review <id>` instead of hand-editing `status.json`. Verify by grep: the hand-edit instruction ("set phases.code_review.status = …" in status.json) no longer appears in those messages, replaced by the helper invocation. | Met | Recovery strings now point at the helper at `scripts/run-task/phases/code-review.ts:228-274`; the grep check in the working tree shows no remaining hand-edit instruction in those two message blocks. |
| AC-7: `iterations` (lifetime counter) is **not** reset by this helper — only the current-loop counters — so the durable iteration signal is preserved (per the "never reset iteration counters" durable-signal principle; the loop counter is the recovery lever, the lifetime counter is the audit trail). Verify by test asserting `iterations` is unchanged across a reset. | Met | The helper leaves `iterations` alone at `src/task/index.ts:1073-1084`; the test asserts `iterations` remains `4` after reset at `tests/task-cli.test.ts:490-494` and the worktree test covers the same invariant at `tests/task-cli.test.ts:1645-1653`. |

## Edge Cases Considered

- Preserved the lifetime `iterations` signal while zeroing only the loop-local counters that actually unblock the auto-block.
- Rejected the command when the task is not currently at derived `code_review`, so the helper does not mutate unrelated phases.
- Covered both the repo-root task path and the linked-worktree task path so the helper behaves the same way as the existing task helpers.

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
| `npm run lint` | Pass | Passed after the helper, tests, doc refresh, and bundle edits. |
| `npm run type-check` | Pass | Passed after the helper and test additions. |
| `npm test` | Pass | Full suite passed, including the new `task reset-code-review` and worktree-routing tests. |
| `npm run build` | Pass | Rebuilt `dist/cli/index.js` and `dist/scripts/run-task.js`. |
| `npm run sync-templates:check` | deferred_by_spec | Spec Validation Required marked this N/A; no canon-managed template files changed. |
| `npm run docs-refs-check` | Pass | Ran because `docs/pipeline-orchestrator.md` changed; all refs are clean. |
| E2E | deferred_by_spec | Spec Validation Required marked this N/A; there is no UI surface for this task. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>`

## Iteration 1 — addressing pre-flight rejection

### Changes

| File | What Changed |
|---|---|
| `templates/docs/pipeline-orchestrator.md` | Added the template-side task-management helper row so the bundle handoff covers the committed diff path the pre-flight gate flagged. |

### Findings addressed

- _handoff coverage bug:_ `templates/docs/pipeline-orchestrator.md` was in the branch diff but missing from the handoff Changes table → fixed by adding the row above.

### AC deltas (if any)

- None.

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `handoff coverage` | Pass | Added the missing diff path so the pre-flight gate can reconcile the branch diff with the handoff table. |

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

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
