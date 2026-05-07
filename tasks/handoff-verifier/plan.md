# Plan: handoff-verifier — Verify handoff matches git diff

## Nits addressed (from spec-review)

AC-5's wording conflated `autoCommitArtifacts()` (which runs in the later artifact-commit path, after `human_review`) with the pre-code-review diff. The exemption constant comment must clarify that `autoCommitArtifacts()` paths are irrelevant here — only paths that `autoCommitCode()` might commit before `code_review` need exemption. Per Codex's spec_review investigation, the current implementation commits only files in the handoff Changes table, and `handoff.md` itself is not pre-committed, so the exemption set is expected to be empty. The constant exists as a forward-compatibility seam, not a populated list.

---

## Implementation Steps

### Step 1 — Define the exemption constant near `parseHandoffFiles`

In `scripts/run-task.ts`, immediately after `parseHandoffFiles` (line ~2483), add:

```typescript
/**
 * Paths that appear in the pre-code-review diff but are not Codex-authored
 * content. Files matching these are exempt from the "diff has file not in
 * handoff" direction of verifyHandoffAgainstDiff.
 *
 * autoCommitCode() stages only files listed in handoff.md Changes tables,
 * so in canon-ai's current implementation this set is empty. The constant
 * exists as a forward-compatibility seam — add entries empirically if new
 * orchestrator-managed paths start appearing in the pre-review diff.
 *
 * Note: autoCommitArtifacts() runs in the later artifact-commit path (after
 * human_review), not the implement phase — its paths never appear in the
 * pre-code-review diff and do not need exemption here.
 */
const HANDOFF_DIFF_EXEMPT_PATHS: ReadonlySet<string> = new Set([]);
```

This is the single source of truth for exempt paths — no scattered string literals elsewhere.

### Step 2 — Implement `verifyHandoffAgainstDiff` with injectable seam

Add the function immediately after the `HANDOFF_DIFF_EXEMPT_PATHS` constant. Export it so tests can import it directly.

Signature:
```typescript
export function verifyHandoffAgainstDiff(
    taskIds: string[],
    baseRef: string,
    cwd: string,
    options?: {
        injectedDiffFiles?: string[];               // test seam: bypass git diff shell-out
        injectedHandoffFiles?: Map<string, string[]>; // test seam: bypass fs reads
    }
): string[]
```

Implementation logic:
1. **Build bundle handoff set** — for each `taskId`, use `options?.injectedHandoffFiles?.get(taskId) ?? parseHandoffFiles(taskId)`. Accumulate into a `Map<string, string[]>` (taskId → files) and a flat `Set<string>` (bundle-wide union).
2. **Get diff files** — if `options?.injectedDiffFiles` is provided, use it directly. Otherwise, run `gitSafeAt(cwd, 'diff', `${baseRef}...HEAD`, '--name-only', '-M')` and split stdout on newlines, filtering empty strings. On git failure, return `['git diff failed: <stderr>']` as a single issue (don't throw — let the caller surface it).
3. **Direction 1 (handoff → diff)** — for each `taskId` and each file in that task's handoff list: if the file is **not** in the diff set, push `[${taskId}] handoff→diff: "${file}" listed in handoff but not in diff`.
4. **Direction 2 (diff → handoff)** — for each file in the diff set: if it's **not** in `HANDOFF_DIFF_EXEMPT_PATHS` and **not** in the bundle-wide handoff union, push `diff→handoff: "${file}" in diff but not in any bundle handoff`.
5. Return the collected issues (empty = clean).

Edge cases to handle cleanly:
- **Empty diff + empty handoff** → both sets empty → no issues → pass.
- **Empty diff + non-empty handoff** → all handoff files flagged as direction-1 issues.
- **Non-empty diff + empty handoff** → all diff files (minus exempt) flagged as direction-2 issues.
- A file listed in task A's handoff that appears in the diff is not flagged even if task B's handoff doesn't list it — the union semantics handle this correctly.

### Step 3 — Modify `runPhase('code_review')` pre-flight

The insertion point is **after** the existing per-task `validateHandoff()` loop and **before** the `if (preflightFailed.length > 0)` block (currently around lines 3620–3625 in `scripts/run-task.ts`).

Change the `preflightFailed` type to carry bundle issues separately:
```typescript
const preflightFailed: Array<{ taskId: string; issues: string[]; bundleIssues?: string[] }> = [];
```

After the per-task loop, before the existing `if (preflightFailed.length > 0)` block, add:
```typescript
const activeCwd = getActiveCwd(taskIds);
const baseRef = getBaseBranch(taskIds);
const bundleIssues = verifyHandoffAgainstDiff(taskIds, baseRef, activeCwd);
if (bundleIssues.length > 0) {
    warn('Bundle-wide handoff verification FAILED:');
    for (const issue of bundleIssues) warn(`  ${issue}`);
    for (const t of tasks) {
        const existing = preflightFailed.find(p => p.taskId === t.taskId);
        if (existing) {
            existing.bundleIssues = bundleIssues;
        } else {
            preflightFailed.push({ taskId: t.taskId, issues: [], bundleIssues });
        }
    }
}
```

### Step 4 — Update the review.md write to show bundle issues under a distinct header

The existing rejection write (around line 3629) builds `reviewContent` from `issues`. Destructure `bundleIssues` from each entry and render it under a clearly labeled section (satisfying AC-8). Replace the existing `reviewContent` construction inside the `if (preflightFailed.length > 0)` block:

```typescript
for (const { taskId, issues, bundleIssues } of preflightFailed) {
    for (const issue of issues) warn(`  [${taskId}] ${issue}`);
    const perTaskSection = issues.length > 0
        ? `${issues.map(i => `- ${i}`).join('\n')}\n`
        : '';
    const bundleSection = bundleIssues && bundleIssues.length > 0
        ? `\n### Bundle-Level Handoff Verification\n\n` +
          `The following issues span all bundle members (a file in the diff is unaccounted\n` +
          `for in all handoffs, or a file claimed in a handoff is absent from the diff):\n\n` +
          `${bundleIssues.map(i => `- ${i}`).join('\n')}\n`
        : '';
    const reviewContent =
        `# Code Review: ${taskId}\n\n` +
        `## Validation Gate\n\n` +
        `**BLOCKED — pre-flight rejected handoff before full review:**\n\n` +
        perTaskSection +
        bundleSection +
        `\n## Verdict\n\n- [x] **Changes requested** — fix the above and resubmit handoff.\n`;
    fs.writeFileSync(path.join(taskDirFor(taskId), 'review.md'), reviewContent);
    runTaskShFor(taskId, 'phase', taskId, 'code_review', 'done', 'changes_requested');
}
```

Note: the `warn` loop above emits only per-task issues, because bundle issues were already warned in Step 3. Do not double-emit.

### Step 5 — Add tests in `tests/run-task-validation.test.ts`

Add the import alongside the existing one:
```typescript
import { validateHandoffAgainstSpec, verifyHandoffAgainstDiff } from '../scripts/run-task.ts';
```

Add a `makeHandoffMap` helper:
```typescript
function makeHandoffMap(entries: Record<string, string[]>): Map<string, string[]> {
    return new Map(Object.entries(entries));
}
```

Write these test rows (all use `injectedDiffFiles` and `injectedHandoffFiles` — no git process, no disk I/O):

1. **Positive — handoff and diff agree (single task)**
   `injectedHandoffFiles: makeHandoffMap({ 'task-a': ['src/foo.ts'] })`, `injectedDiffFiles: ['src/foo.ts']`
   Expected: `[]`

2. **Negative — handoff claims file not in diff**
   `injectedHandoffFiles: makeHandoffMap({ 'task-a': ['src/foo.ts', 'src/bar.ts'] })`, `injectedDiffFiles: ['src/foo.ts']`
   Expected: one issue containing `handoff→diff`, `src/bar.ts`, and `task-a`

3. **Negative — diff has file not in handoff**
   `injectedHandoffFiles: makeHandoffMap({ 'task-a': ['src/foo.ts'] })`, `injectedDiffFiles: ['src/foo.ts', 'src/baz.ts']`
   Expected: one issue containing `diff→handoff` and `src/baz.ts`

4. **Positive — bundle: file in task-A's handoff satisfies diff even though not in task-B's**
   `injectedHandoffFiles: makeHandoffMap({ 'task-a': ['src/foo.ts'], 'task-b': ['src/bar.ts'] })`, `injectedDiffFiles: ['src/foo.ts', 'src/bar.ts']`
   Expected: `[]`

5. **Positive — empty diff and empty handoff**
   `injectedHandoffFiles: makeHandoffMap({ 'task-a': [] })`, `injectedDiffFiles: []`
   Expected: `[]`

Use `assert.deepEqual(issues, [])` for positive cases. For negative cases, use `assert.equal(issues.length, 1)` then `assert.ok(issues[0].includes('handoff→diff'))` / `assert.ok(issues[0].includes('diff→handoff'))` and `assert.ok(issues[0].includes('src/bar.ts'))` etc.

`taskIds` can be arbitrary (e.g. `['task-a']`) since they are only used as keys into `injectedHandoffFiles`. `baseRef` and `cwd` are also arbitrary when `injectedDiffFiles` is provided — use `'main'` and `'.'` as placeholders.

---

## Validation

After implementation:
- `npm run type-check` — must pass
- `npm test` — must pass (all existing tests + new rows)

---

## Files Changed

| File | Change |
|---|---|
| `scripts/run-task.ts` | Add `HANDOFF_DIFF_EXEMPT_PATHS` constant and exported `verifyHandoffAgainstDiff`; extend `runPhase('code_review')` pre-flight with the new call; update `preflightFailed` type and review.md render to carry and display bundle issues under distinct header |
| `tests/run-task-validation.test.ts` | Add import for `verifyHandoffAgainstDiff`; add `makeHandoffMap` helper; add 5 test rows covering positive, both negative directions, bundle union, and empty-diff cases |
