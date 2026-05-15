# QA Summary: scope-review-diff

> QA by: Claude | Date: 2026-05-14

## What Changed

The code-review agent previously had to run `git diff {baseBranch}...HEAD` itself to see the task delta. In a worktree with unrelated uncommitted files, the agent could drift to the "or read the changed files directly" fallback and review the wrong files — or stall entirely without producing a `review.md`. Issue #46 documented a real incident of this failure.

The fix: the orchestrator now pre-computes `git diff {baseBranch}...HEAD` before invoking Claude for code review and injects the result directly into the prompt as static content. The agent receives the diff as data, not as an instruction to reconstruct it — all worktree noise is excluded by design.

Behavior:
- Diff ≤ 50 000 bytes: full diff injected inline, preceded by a "Task diff against `{baseBranch}`" header.
- Diff > 50 000 bytes: truncated at the byte limit with a note directing the agent to the handoff.md Changes table for the remainder.
- Git failure (non-zero exit, git unavailable): falls back to the original instruction telling the agent to run `git diff` itself. No pipeline error raised.
- Both round-1 and round-N code review prompts use the same logic. The "or read the changed files directly" text is removed from round-N.

## Files Changed

| File | Change |
|---|---|
| `scripts/run-task/git.ts` | Added `getScopedDiff()` — returns `{ diff, truncated } \| null`. Added `truncateUtf8()` so the byte cap is measured against actual command output bytes. |
| `scripts/run-task/phases/code-review.ts` | Resolves `baseBranch` and `activeCwd` once at the top of the phase, computes the scoped diff, and passes both into the prompt builder. |
| `scripts/run-task/prompts/index.ts` | Updated `promptCodeReview()` to accept `baseBranch` and optional `scopedDiff`. Backward-compatible: old one-argument call sites still compile. |
| `scripts/run-task/prompts/templates/code-review-round-1.md` | Replaced live `git diff` instruction with Mustache conditional — inline diff when available, original command instruction as fallback. |
| `scripts/run-task/prompts/templates/code-review-round-n.md` | Same conditional diff block. "Or read the changed files directly" text removed from all paths. |

## How to Test

1. Create a task with code changes and run it through the implement phase.
2. Before running code review, add an unrelated untracked file to the worktree (one not listed in handoff.md).
3. Run the pipeline to the `code_review` phase.
4. Expected: `review.md` is written correctly and addresses only the task's committed code changes — the unrelated file is not mentioned.
5. Optional verification: inspect the Claude invocation log — the prompt should contain a "Task diff against `{baseBranch}`" section with the diff inline rather than an instruction to run git.

## Test Results

| Check | Result |
|---|---|
| Lint | Pass |
| Type-check | Pass |
| Unit tests | Deferred by spec (thin wrapper; manual end-to-end is the appropriate test) |
| Build | Deferred by spec (NoEmit project; type-check covers build correctness) |
| E2E | Not applicable (no UI) |
| Runtime validation | Pass (`orchestrator-phase-smoke` exit 0) |

## Decisions Made

- **Raw bytes for truncation**: `getScopedDiff()` uses `gitSafeAtRaw()` (not `gitSafeAt()`) so the 50 000-byte cap is applied to the actual command output before any string trimming.
- **Backward-compatible arity**: `promptCodeReview()` keeps the old one-argument signature valid via an optional `baseBranch` parameter. The code-review phase always passes the resolved branch explicitly; existing test call sites that omit it continue to compile.

## Open Questions

One optional cleanup identified in code review (approved with nits, not blocking):

- `prompts/index.ts`: round-1 `hasDiff = true` branch passes the raw `baseBranch` parameter instead of `resolvedBaseBranch` to the template. The round-N path correctly uses `resolvedBaseBranch` in both branches. Not a runtime bug (the only real caller always supplies `baseBranch` explicitly when setting a non-null diff), but `promptCodeReview(state, undefined, someDiff)` would silently render an empty "Task diff against" header. Fix: replace `baseBranch` with `resolvedBaseBranch` in that branch. Low priority — address in a future pass or inline if convenient.

---

## Proposed Changelog

This is an internal orchestrator fix — no `tasks/_templates/`, `status.json` schema, or workflow behavior changes for callers. Per `docs/decisions.md`, this is a **Patch** (bug fix only, no new capability).

**Proposed version**: `0.6.1`

**Draft entry** (human finalizes phrasing before the changelog/version-bump commit):

```markdown
## [0.6.1] — 2026-05-14

### Fixed

- **Code review diff injection**: the orchestrator now pre-computes `git diff {baseBranch}...HEAD` and injects it directly into the code-review prompt, eliminating the failure mode where a noisy worktree (uncommitted unrelated files) caused the review agent to drift to the wrong fallback and stall without producing `review.md`. Diffs larger than 50 000 bytes are truncated with a note pointing the agent to the handoff Changes table. When git fails, the original command-instruction fallback is preserved. Applies to both round-1 and round-N review prompts.
```
