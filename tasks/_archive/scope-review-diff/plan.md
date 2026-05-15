# Implementation Plan: scope-review-diff

> Written by: Claude | Implements: `tasks/scope-review-diff/spec.md`

## Approach

Add a `getScopedDiff()` helper in `git.ts`, call it in `phases/code-review.ts` before the Claude invocation (using `getActiveCwd()` for correct worktree cwd), pass the result to `promptCodeReview()` in `prompts/index.ts`, and update both Mustache templates to render the diff inline when available.

Move the `getBaseBranch()` call out of `promptCodeReview()` and into `phases/code-review.ts` so both the diff computation and the prompt builder share one resolved value.

## Steps

### Step 1: Add `getScopedDiff()` to `scripts/run-task/git.ts`

Files: `scripts/run-task/git.ts`

Add after the existing `commitsAheadOfBase` function:

```typescript
export function getScopedDiff(
    baseBranch: string,
    cwd: string,
    capBytes = 50_000,
): { diff: string; truncated: boolean } | null {
    const result = gitSafeAt(cwd, 'diff', `${baseBranch}...HEAD');
    if (!result.ok) return null;
    const raw = result.stdout;
    if (Buffer.byteLength(raw, 'utf8') <= capBytes) {
        return { diff: raw, truncated: false };
    }
    // Truncate to capBytes on a UTF-8 boundary.
    const buf = Buffer.from(raw, 'utf8').subarray(0, capBytes);
    return {
        diff: buf.toString('utf8'),
        truncated: true,
    };
}
```

Note: `gitSafeAt` already exists at line 41 of `git.ts` with signature `gitSafeAt(cwd: string, ...args: string[]): CommandResult`. Use it directly.

### Step 2: Compute diff in `scripts/run-task/phases/code-review.ts` and pass to prompt builder

Files: `scripts/run-task/phases/code-review.ts`

At the top of `runCodeReviewPhase()`, after `verifyBranch(taskIds)` and before the pre-flight checks, add:

```typescript
const baseBranch = getBaseBranch(taskIds);
const activeCwd = getActiveCwd(taskIds);
const scopedDiff = getScopedDiff(baseBranch, activeCwd);
```

Then update the `promptCodeReview(state)` call (currently line 110) to:
```typescript
promptCodeReview(state, baseBranch, scopedDiff)
```

Also update the import at the top of `phases/code-review.ts` to add `getScopedDiff` from `'../git.js'`. `getBaseBranch` is already imported there.

Remove the duplicate `getActiveCwd(taskIds)` call later in the function (the variable is now declared earlier). The existing `const activeCwd = getActiveCwd(taskIds)` at line 91 (inside the `if (isWorktreeEnabled(...))` block) should be replaced with a reference to the top-level `activeCwd`.

### Step 3: Update `promptCodeReview()` signature in `scripts/run-task/prompts/index.ts`

Files: `scripts/run-task/prompts/index.ts`

Change the function signature:
```typescript
// Before
export function promptCodeReview(state: PipelineState): string {
// After
export function promptCodeReview(
    state: PipelineState,
    baseBranch?: string,
    scopedDiff?: { diff: string; truncated: boolean } | null,
): string {
```

Inside `promptCodeReview()`, remove the `const baseBranch = getBaseBranch(...)` call (now passed in). Keep `getBaseBranch` import in case it's used elsewhere, but verify — if it's only used in this function, remove the import too.

For the round-1 path, add to the template vars:
```typescript
hasDiff: !!scopedDiff,
diffContent: scopedDiff?.diff ?? '',
diffTruncated: scopedDiff?.truncated ?? false,
baseBranch: baseBranch ?? getBaseBranch(tasks.map(t => t.taskId)), // fallback for callers not yet passing it
```

Apply the same vars to the round-N render call.

### Step 4: Update `scripts/run-task/prompts/templates/code-review-round-1.md`

Files: `scripts/run-task/prompts/templates/code-review-round-1.md`

Replace the current diff instruction line:
```
Read the actual diff: `git diff {{{baseBranch}}}...HEAD` (or read the changed files directly).
```

With:
```
{{#hasDiff}}
**Task diff against `{{{baseBranch}}}`** (pre-computed by the orchestrator — do not re-run git diff):

```diff
{{{diffContent}}}
```
{{#diffTruncated}}
> Diff truncated at 50 000 bytes — read changed files listed in handoff.md Changes table directly for the remainder.
{{/diffTruncated}}
{{/hasDiff}}
{{^hasDiff}}
Read the actual diff: `git diff {{{baseBranch}}}...HEAD`.
{{/hasDiff}}
```

### Step 5: Update `scripts/run-task/prompts/templates/code-review-round-n.md`

Files: `scripts/run-task/prompts/templates/code-review-round-n.md`

Find the line:
```
Read the actual code diff since your prior review: `git diff {{{baseBranch}}}...HEAD -- <files-from-iteration-{{priorIteration}}>` (or read the changed files directly).
```

Replace with the same `{{#hasDiff}}` / `{{^hasDiff}}` block from Step 4, but with the extra context: "Focus on files changed in iteration {{priorIteration}} — listed in the handoff.md `## Iteration {{priorIteration}}` section."

## Testing Plan

- **Unit**: None new. `getScopedDiff` is a thin wrapper around `gitSafeAt`; the underlying git helpers are already tested. Truncation logic is simple arithmetic.
- **E2E**: Not applicable.
- **Manual**: Run `npx tsx scripts/run-task.ts <task-id> --step --expect code_review` on a task that has completed implement. Verify `review.md` is written. Optionally inspect the prompt log to confirm the diff block is present.

## Rollback Plan

Pure prompt change. Reverting means removing the diff injection from the templates and `promptCodeReview()`. No data migrations, no schema changes, no persistent state affected.
