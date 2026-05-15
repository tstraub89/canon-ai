# Spec: scope-review-diff — Scope code-review diff to task delta in prompt

> Written by: Claude | Review by: human (fast tier)
> Status: approved

## Problem

The code review prompt instructs the agent to run `git diff {baseBranch}...HEAD` to inspect the task delta. In worktrees with large unrelated dirty trees (uncommitted catalog changes, generated files, etc.), the agent may fall back to the "or read the changed files directly" alternative and inadvertently inspect unrelated dirty files, causing the review session to stall or produce no `review.md` artifact. Issue #46 documents a real incident where this happened.

The root cause: the review agent is responsible for constructing the correct git command and scoping its own view of the diff. An agent running in a noisy worktree can get it wrong.

## Decision

Pre-compute `git diff {baseBranch}...HEAD` in the orchestrator before invoking Claude for code review, and inject the result into the prompt as static content. The agent receives the task delta as data rather than an instruction to execute git — eliminating all ambient worktree noise from the review input.

If the diff exceeds 50 000 bytes, truncate and append a note directing the agent to read the handoff.md Changes table for the remainder. If the git command fails entirely, fall back to the current instruction-based approach (tell the agent to run the command itself).

## Non-Goals

- Adding a `--diff-base` CLI flag.
- Failing the pipeline when the worktree is dirty.
- Pre-computing per-iteration scoped diffs for round-N review (full `baseBranch...HEAD` diff is injected for all rounds; agent focuses on iteration-N files via handoff.md as before).
- Changing which git diff command is used (`baseBranch...HEAD` three-dot syntax is correct and unchanged).

## Acceptance Criteria

- [ ] AC-1: When `git diff {baseBranch}...HEAD` succeeds and produces ≤ 50 000 bytes, the round-1 code review prompt contains the full diff inline, preceded by a "Task diff against {baseBranch}" header. The instruction to run `git diff` is removed from the round-1 template.
- [ ] AC-2: When the diff exceeds 50 000 bytes, the injected diff is truncated at the byte limit and followed by a note: "Diff truncated at 50 000 bytes — read changed files listed in handoff.md Changes table directly for the remainder."
- [ ] AC-3: When `git diff` fails (non-zero exit, git unavailable, etc.), the prompt falls back to the original instruction telling the agent to run `git diff {baseBranch}...HEAD` itself. No pipeline error is raised.
- [ ] AC-4: The round-N code review prompt also includes the pre-computed diff (same AC-1/AC-2/AC-3 behavior). The "or read the changed files directly" fallback text is removed from the round-N template.
- [ ] AC-5: The diff is computed using `getActiveCwd(taskIds)` so worktree-mode runs correctly scope to the task branch rather than the main checkout.
- [ ] AC-6: `npm run type-check` passes with no new errors.
- [ ] AC-7: `npm run lint` passes with no new errors.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/git.ts` | Add `getScopedDiff(baseBranch: string, cwd: string, capBytes: number): { diff: string; truncated: boolean } \| null` (null on git failure). |
| `scripts/run-task/phases/code-review.ts` | Call `getScopedDiff()` before invoking `promptCodeReview()`; pass result and baseBranch to the prompt builder. |
| `scripts/run-task/prompts/index.ts` | Update `promptCodeReview()` to accept `baseBranch: string` and optional `scopedDiff: { diff: string; truncated: boolean } \| null`; pass `hasDiff`, `diffContent`, `diffTruncated`, `baseBranch` template vars. |
| `scripts/run-task/prompts/templates/code-review-round-1.md` | Replace `git diff {{{baseBranch}}}...HEAD` instruction with conditional block rendering injected diff when `hasDiff` is true; retain fallback instruction when false. |
| `scripts/run-task/prompts/templates/code-review-round-n.md` | Same conditional diff block; remove "or read the changed files directly" fallback text. |

### Interaction Dependencies

- `getActiveCwd(taskIds)` in `phases/code-review.ts` already resolves the correct cwd for worktree vs non-worktree runs — `getScopedDiff()` must receive that same cwd.
- `getBaseBranch(taskIds)` is currently called inside `promptCodeReview()`. Move the call to `phases/code-review.ts` so both the diff computation and the prompt builder use the same resolved value without calling it twice.
- `renderTemplate` in `scripts/run-task/prompts/render.ts` must support Mustache boolean sections (`{{#hasDiff}}...{{/hasDiff}}`). Verify this before using conditional blocks in templates; the existing `buildImplementStateHeader` usage in `context.ts` confirms Mustache conditionals are supported.

### Data Model Changes

None. `status.json` is unchanged. The diff is ephemeral prompt context only.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [ ] Unit tests — no new unit tests are required; the diff computation is a thin wrapper around `gitSafeAt`. End-to-end behavior is validated by running a code review phase manually.
- [ ] Build — not required (NoEmit TypeScript project; type-check covers build correctness)
- [ ] E2E — not applicable (no UI)

## Docs Impact

None. Internal orchestrator change; no user-visible behavior changes to spec, handoff, or any other artifact format.

## Known Risks

- **Large diffs silently truncated**: The 50 000-byte cap is a judgment call. Too low misses code; too high bloats the context window. At ~33 bytes/char average for diffs, 50 000 bytes covers ~1 500 lines — sufficient for typical canon tasks. The truncation note and handoff fallback mitigate outliers.
- **Mustache conditional syntax**: Templates use `{{#hasDiff}}` / `{{^hasDiff}}` blocks. Confirm `renderTemplate` supports Mustache boolean sections before coding. The `stateHeader` usage in existing implement templates confirms this is supported.

## Human Test Plan

1. Create a task with code changes. Before running code review, leave unrelated uncommitted files in the worktree (e.g., add an untracked file not listed in handoff.md).
2. Run the pipeline to the code_review phase.
3. Expected: `review.md` is written correctly; the review addresses only the task's committed code changes, not the unrelated dirty file.
4. Optional verification: inspect the Claude invocation log — the prompt should contain a "Task diff" section with the diff inline, not an instruction to run git.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it
- [x] Affected Files lists specific files with specific change descriptions
- [x] Plan steps reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only
- [x] Validation Required has at least one entry checked
