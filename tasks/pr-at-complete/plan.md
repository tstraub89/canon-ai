# Implementation Plan: pr-at-complete

> Written by: Claude | Implements: `tasks/pr-at-complete/spec.md`

## Approach

Two related changes in `scripts/run-task/main.ts`, one new test surface, and a CHANGELOG entry. Both code changes share the existing helpers (`findOpenPRNumber`, `createDraftPRForTask`, `commitHumanReviewFiles`, `gitSafeAt`); no new infrastructure required.

The state-aware `complete`-no-flags message is the main new logic. Extract it into a pure helper that takes resolved branch/PR signals and returns the formatted block — that makes AC-8's per-state tests cheap (no process mocking required).

The idempotent-PR branch in `commitHumanReviewFiles` sits as a new conditional **above** the existing `openPR === null` retry path, so the open-PR case wins.

## Steps

### Step 1: Extend dispatch in `runPhase()` to handle `complete`

Files: `scripts/run-task/main.ts` (around `:1244`)

The existing block:

```ts
if ((phase as Phase) === 'human_review') {
    const taskIds = tasks.map(t => t.taskId);
    if (cliArgs.push || cliArgs.pr) {
        const cwd = splitWorktree.getActiveCwd(taskIds);
        commitHumanReviewFiles(taskIds, cwd);
        process.exit(0);
    }

    // "no push requested" message...
    process.exit(0);
}
```

Change the guard so it also matches `complete`:

```ts
if (phase === 'human_review' || phase === 'complete') {
    const taskIds = tasks.map(t => t.taskId);
    if (cliArgs.push || cliArgs.pr) {
        const cwd = splitWorktree.getActiveCwd(taskIds);
        commitHumanReviewFiles(taskIds, cwd);
        process.exit(0);
    }

    // Branch on phase for the no-flag message:
    if (phase === 'human_review') {
        printHumanReviewBanner(taskIds); // existing message body extracted to helper
    } else {
        printCompleteStateBanner(taskIds);
    }
    process.exit(0);
}
```

`phase` is typed `CurrentPhase` per `:1214` (which is `Phase | 'complete'`); TypeScript narrows correctly when comparing to either string literal — no cast needed. Drop the existing `(phase as Phase) === 'human_review'` cast as part of this.

### Step 2: Extract the human-review "no push requested" message to a helper

Files: `scripts/run-task/main.ts`

The existing inline message (lines `:1252-1263`) moves into a helper for symmetry with the new `complete` helper:

```ts
function printHumanReviewBanner(taskIds: string[]): void {
    console.log('');
    console.log('════════════════════════════════════════════════════════');
    console.log('  HUMAN REVIEW — no push requested.');
    console.log('');
    console.log('  Done files:');
    for (const taskId of taskIds) {
        console.log(`  tasks/${taskId}/done.md`);
    }
    console.log('');
    console.log('  Re-run with --push to commit task artifacts and push, or --pr to also create a draft PR.');
    console.log('════════════════════════════════════════════════════════');
    console.log('');
}
```

No behavior change for the `human_review` path. Pure refactor.

### Step 3: Add state-aware `complete` banner with pure formatter

Files: `scripts/run-task/main.ts`

Add two helpers:

```ts
export type CompleteState =
    | { kind: 'open_pr'; branch: string; prNum: number; prUrl: string }
    | { kind: 'pushed_no_pr'; branch: string; baseBranch: string }
    | { kind: 'unpushed'; branch: string; baseBranch: string };

export function formatCompleteStateBanner(taskIds: string[], state: CompleteState): string {
    const body = (() => {
        switch (state.kind) {
            case 'open_pr':
                return `  Open PR: #${state.prNum} (${state.prUrl})\n  Next:    \`canon run ${taskIds.join(' ')} --ship\` to merge + archive.`;
            case 'pushed_no_pr':
                return `  Branch ${state.branch} is on origin but no open PR.\n  Next:    \`canon run ${taskIds.join(' ')} --pr\` to (re)open the draft PR, or\n           \`canon run ${taskIds.join(' ')} --ship\` if the work is already merged to ${state.baseBranch}.`;
            case 'unpushed':
                return `  Local branch ${state.branch} is not on origin.\n  Next:    \`canon run ${taskIds.join(' ')} --pr\` to push and open a draft PR.\n           (For a no-PR flow: merge to ${state.baseBranch} manually, push, then run --ship.)`;
        }
    })();
    return [
        '',
        '════════════════════════════════════════════════════════',
        '  TASK COMPLETE — already past human_review.',
        '',
        body,
        '════════════════════════════════════════════════════════',
        '',
    ].join('\n');
}

function printCompleteStateBanner(taskIds: string[]): void {
    // Dedupe by branch — bundle tasks typically share one branch.
    const branches = [...new Set(taskIds.map(id => resolveTaskBranchName(id)))];
    for (const branch of branches) {
        // Look up which tasks live on this branch (preserves bundle membership in messages).
        const tasksOnBranch = taskIds.filter(id => resolveTaskBranchName(id) === branch);
        const state = inspectCompleteState(branch, tasksOnBranch);
        console.log(formatCompleteStateBanner(tasksOnBranch, state));
    }
}

function inspectCompleteState(branch: string, taskIds: string[]): CompleteState {
    const baseBranch = splitGit.getBaseBranch(taskIds);
    const remoteExists = gitSafeAt(REPO_ROOT, 'rev-parse', '--verify', `origin/${branch}`).ok;
    if (!remoteExists) {
        return { kind: 'unpushed', branch, baseBranch };
    }
    const prNum = ghAvailable ? findOpenPRNumber(branch) : null;
    if (prNum === null) {
        return { kind: 'pushed_no_pr', branch, baseBranch };
    }
    const prUrl = lookupPRUrl(branch, prNum);
    return { kind: 'open_pr', branch, prNum, prUrl };
}

function lookupPRUrl(branch: string, prNum: number): string {
    // Prefer gh's canonical URL; fall back to constructed form on failure.
    if (ghAvailable) {
        const result = splitGit.runCommand('gh', ['pr', 'view', String(prNum), '--json', 'url', '--jq', '.url']);
        if (result.ok && result.stdout.trim()) return result.stdout.trim();
    }
    // Fallback: parse origin remote, build URL by hand.
    const remoteResult = splitGit.runCommand('git', ['remote', 'get-url', 'origin']);
    if (remoteResult.ok) {
        const match = remoteResult.stdout.trim().match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
        if (match) return `https://github.com/${match[1]}/${match[2]}/pull/${prNum}`;
    }
    return `(PR #${prNum})`;
}
```

`formatCompleteStateBanner` is the pure unit-testable surface (per AC-8). `printCompleteStateBanner` / `inspectCompleteState` / `lookupPRUrl` are the impure callers.

### Step 4: Idempotent existing-PR branch in `commitHumanReviewFiles`

Files: `scripts/run-task/main.ts` (`:537-549`)

The current block:

```ts
if (dirtyEntries.length === 0 && cliArgs.pr) {
    const branchResult = gitSafeAt(cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
    const branchName = branchResult.ok ? branchResult.stdout.trim() : '';
    if (branchName) {
        const remoteRef = gitSafeAt(cwd, 'rev-parse', '--verify', `origin/${branchName}`);
        const openPR = ghAvailable ? findOpenPRNumber(branchName) : null;
        if (remoteRef.ok && openPR === null) {
            info(`--pr retry detected: tree clean, branch ${branchName} on origin, no open PR. Creating PR only.`);
            createDraftPRForTask(taskIds, branchName);
            return;
        }
    }
}
```

Add the existing-PR branch **above** the existing `openPR === null` check:

```ts
if (dirtyEntries.length === 0 && cliArgs.pr) {
    const branchResult = gitSafeAt(cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
    const branchName = branchResult.ok ? branchResult.stdout.trim() : '';
    if (branchName) {
        const remoteRef = gitSafeAt(cwd, 'rev-parse', '--verify', `origin/${branchName}`);
        const openPR = ghAvailable ? findOpenPRNumber(branchName) : null;
        if (remoteRef.ok && openPR !== null) {
            const prUrl = lookupPRUrl(branchName, openPR);
            info(`Existing draft PR: #${openPR} (${prUrl})`);
            return;
        }
        if (remoteRef.ok && openPR === null) {
            info(`--pr retry detected: tree clean, branch ${branchName} on origin, no open PR. Creating PR only.`);
            createDraftPRForTask(taskIds, branchName);
            return;
        }
    }
}
```

This handles AC-4 (open-PR case) and AC-5 (re-runs are no-ops). It applies at both `human_review` and `complete` because `commitHumanReviewFiles` is the shared handler.

### Step 5: Tests

Files: `tests/run-task-safety.test.ts` (extend) or `tests/run-task-complete-state.test.ts` (new file — preferred for grouping)

Add tests against the pure formatter:

```ts
import { formatCompleteStateBanner } from '../scripts/run-task/main.js';

void test('formatCompleteStateBanner: open_pr state mentions PR number and URL', () => {
    const banner = formatCompleteStateBanner(['my-task'], {
        kind: 'open_pr', branch: 'task/my-task', prNum: 42, prUrl: 'https://github.com/x/y/pull/42',
    });
    assert.match(banner, /Open PR: #42/);
    assert.match(banner, /https:\/\/github\.com\/x\/y\/pull\/42/);
    assert.match(banner, /--ship.*merge \+ archive/);
});

void test('formatCompleteStateBanner: pushed_no_pr suggests --pr and --ship', () => {
    const banner = formatCompleteStateBanner(['t'], {
        kind: 'pushed_no_pr', branch: 'task/t', baseBranch: 'dev',
    });
    assert.match(banner, /no open PR/);
    assert.match(banner, /--pr/);
    assert.match(banner, /--ship if the work is already merged to dev/);
});

void test('formatCompleteStateBanner: unpushed mentions local-only and points at --pr / manual merge', () => {
    const banner = formatCompleteStateBanner(['t'], {
        kind: 'unpushed', branch: 'task/t', baseBranch: 'dev',
    });
    assert.match(banner, /not on origin/);
    assert.match(banner, /--pr to push/);
    assert.match(banner, /merge to dev manually/);
});

void test('formatCompleteStateBanner: bundle task IDs join in command suggestion', () => {
    const banner = formatCompleteStateBanner(['a', 'b'], {
        kind: 'open_pr', branch: 'task/a', prNum: 1, prUrl: 'https://github.com/x/y/pull/1',
    });
    assert.match(banner, /canon run a b --ship/);
});
```

For the dispatch test (AC-8 first bullet): if it requires significant process-level mocking, document in handoff and rely on the Human Test Plan for end-to-end verification. The pure formatter tests above lock in the user-facing message contract.

### Step 6: CHANGELOG entry

Files: `CHANGELOG.md`

Under the existing `## [1.1.4] — unreleased` block, add to `### Fixed`:

```md
- **`canon run <id> --pr` no longer crashes when the task is at `complete`.** Two related fixes: (1) `runPhase()` now handles the `complete` phase via the same `--pr`/`--push` path as `human_review` instead of dying with `Unknown phase: complete`; (2) `commitHumanReviewFiles()`'s idempotent retry path now detects an already-open PR and returns the existing PR URL instead of dying. `canon run <id>` with no flags at `complete` prints a state-aware status message (open PR / pushed-no-PR / unpushed) with the recommended next command. Closes [#72](https://github.com/tstraub89/canon-ai/issues/72).
```

### Step 7: Rebuild dist/

Files: `dist/scripts/run-task.js`, `dist/cli/index.js`

`npm run build` regenerates both. The new `postbuild` normalize step (merged in #74) ensures reproducibility regardless of worktree symlinking.

## Testing Plan

- **Unit**: 4 new tests on `formatCompleteStateBanner` (per Step 5). Full suite passes via `npm test`.
- **Lint**: `npm run lint` — no new patterns; existing shape.
- **Type-check**: `npm run type-check` — `CompleteState` union type and new helpers must satisfy `tsc`.
- **Build**: `npm run build` — `dist/` regenerates, postbuild normalizes paths.
- **Manual smoke**: per the spec's Human Test Plan. The three state branches each need observation in a real `complete`-status task.
- **E2E**: N/A.
