# Implementation Handoff: scope-review-diff

> Author: Codex | Spec: `tasks/scope-review-diff/spec.md` | Plan: `tasks/scope-review-diff/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

| File | What Changed |
|---|---|
| `scripts/run-task/git.ts` | Added `getScopedDiff()` plus a UTF-8-safe byte truncation helper so the orchestrator can precompute `git diff {baseBranch}...HEAD` in the active worktree and return `null` on git failure. |
| `scripts/run-task/phases/code-review.ts` | Resolved `baseBranch` and `activeCwd` once, computed the scoped diff before invoking Claude, passed both into the prompt builder, and reused the same active cwd for worktree sync and review invocation. |
| `scripts/run-task/prompts/index.ts` | Updated `promptCodeReview()` to accept the resolved base branch and optional precomputed diff, while preserving a backward-compatible fallback for older one-argument call sites. |
| `scripts/run-task/prompts/templates/code-review-round-1.md` | Replaced the live `git diff` instruction with a conditional inline diff block, including the exact 50 000-byte truncation note and the original command fallback when no diff is available. |
| `scripts/run-task/prompts/templates/code-review-round-n.md` | Added the same conditional inline diff block for re-review rounds and removed the "or read the changed files directly" fallback text. |
| `tasks/scope-review-diff/notes.md` | Appended a short implementation note about the temporary backward-compatibility fallback in `promptCodeReview()`. |

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

Precompute the review diff in the orchestrator so Claude receives the task delta as prompt data instead of being asked to reconstruct it from the current worktree. That removes the noisy-worktree failure mode from the review path while preserving the existing fallback when git itself fails.

The implementation resolves the base branch once in `phases/code-review.ts`, uses `getActiveCwd(taskIds)` so worktree mode scopes the diff to the active task checkout, and renders the diff inline in both round-1 and round-N templates. When the diff is larger than 50 000 bytes, the prompt includes the truncated prefix plus the exact handoff-table remainder note from the spec.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Used `gitSafeAtRaw()` in `getScopedDiff()` instead of `gitSafeAt()` | The raw helper preserves the full untrimmed diff bytes so the 50 000-byte cap is measured against the actual command output rather than a trimmed string. | None |
| Kept `promptCodeReview()` backward-compatible with an optional `baseBranch` fallback | Existing test call sites still invoke `promptCodeReview(state)` with the old arity; keeping the fallback avoided a test-only type-check break while the code-review phase still passes the resolved base branch explicitly. | None |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: When `git diff {baseBranch}...HEAD` succeeds and produces ≤ 50 000 bytes, the round-1 code review prompt contains the full diff inline, preceded by a "Task diff against {baseBranch}" header. The instruction to run `git diff` is removed from the round-1 template. | Met | `scripts/run-task/phases/code-review.ts` now precomputes the diff; `scripts/run-task/prompts/templates/code-review-round-1.md` renders the inline diff block and only falls back to the command instruction when no diff is available. |
| AC-2: When the diff exceeds 50 000 bytes, the injected diff is truncated at the byte limit and followed by a note: "Diff truncated at 50 000 bytes — read changed files listed in handoff.md Changes table directly for the remainder." | Met | `scripts/run-task/git.ts` truncates the diff to the byte cap; both code-review templates emit the exact truncation note from the spec. |
| AC-3: When `git diff` fails (non-zero exit, git unavailable, etc.), the prompt falls back to the original instruction telling the agent to run `git diff {baseBranch}...HEAD` itself. No pipeline error is raised. | Met | `getScopedDiff()` returns `null` on git failure and the templates render the original instruction path instead of throwing. |
| AC-4: The round-N code review prompt also includes the pre-computed diff (same AC-1/AC-2/AC-3 behavior). The "or read the changed files directly" fallback text is removed from the round-N template. | Met | `scripts/run-task/prompts/templates/code-review-round-n.md` now uses the same conditional diff block and no longer mentions the changed-files-directly fallback. |
| AC-5: The diff is computed using `getActiveCwd(taskIds)` so worktree-mode runs correctly scope to the task branch rather than the main checkout. | Met | `scripts/run-task/phases/code-review.ts` resolves `activeCwd` once via `getActiveCwd(taskIds)` and passes it to `getScopedDiff()`. |
| AC-6: `npm run type-check` passes with no new errors. | Met | Passed after the backward-compatible `promptCodeReview()` fallback was added. |
| AC-7: `npm run lint` passes with no new errors. | Met | Passed on the final code state. |

## Edge Cases Considered

- Git failure now produces `null` rather than a hard error, so the prompt still launches with the original instruction path.
- Truncation is byte-based, not line-based, so the injected diff stays within the context cap even for large diffs.
- The code-review phase uses the same resolved base branch for preflight bundle checks, prompt rendering, and diff computation so the task cannot drift between those steps.
- Existing `promptCodeReview(state)` call sites still compile because the prompt builder keeps a compatibility fallback while the orchestrator path uses the explicit branch value.

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
| `npm run lint` | Pass | Ran against the final code state after the diff injection changes. |
| `npm run type-check` | Pass | Passed after making `promptCodeReview()` backward-compatible for existing test call sites. |
| `Unit tests` | deferred_by_spec | Spec explicitly says no new unit tests are required for this change. |
| `Build` | deferred_by_spec | Spec marks build as not required because the project is `NoEmit` and type-check covers build correctness. |
| `E2E` | not_configured | Spec marks E2E as not applicable. |

## Runtime Validation Outcomes

> Authored by the orchestrator after Codex's implement phase. Codex did not run these checks.

| Check | Result | Elapsed | Notes |
|---|---|---|---|
| `orchestrator-phase-smoke` | Pass | 0.0s | exit code 0 |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>`

