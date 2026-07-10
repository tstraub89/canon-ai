# Implementation Plan: ship-shared-doc-dirt-preservation

> Written by: Claude | Implements: `tasks/ship-shared-doc-dirt-preservation/spec.md`
> Spec review verdict: **approved with nits**.

## Nit disposition

The one spec-review nit (Problem section's example list implies `docs/lessons-learned.md` is a "managed doc") is wording-only. The actual constants in `scripts/run-task/worktree.ts:9-24` are authoritative and this plan follows them: `docs/lessons-learned.md` is `PIPELINE_TELEMETRY_FILES`, not `PIPELINE_MANAGED_DOCS`. No spec change needed — do not second-guess the constants against the Problem section's prose.

## Approach

Replace the blanket `checkout HEAD -- ...presentSharedDocs` discard at `scripts/run-task/main.ts:2063-2072` with a pre-merge classify-then-act gate. Classification is pure (new `*FromData` functions in `validation.ts`, mirroring the existing `verifyBaseDivergenceFromData` pure/impure split); the impure git/fs orchestration stays in `main.ts` since it isn't itself a validation gate — it mutates the working tree (backup + revert + later re-append). The two-phase structure (classify everything, then act only if nothing aborted) is what makes AC-3's "no backup written, nothing reverted, if any file fails classification" true by construction rather than by careful ordering discipline.

## Step 0 — Orientation (read before editing)

- `scripts/run-task/worktree.ts:9-24` — `PIPELINE_TELEMETRY_FILES` (3 files), `PIPELINE_MANAGED_DOCS` (6 files), `PIPELINE_SHARED_DOCS` (union of both).
- `scripts/run-task/main.ts:2063-2079` — the block being replaced and the `orphanedStatusPaths` block immediately after it, which **must stay byte-identical and stay immediately after** the new code (Non-Goal in spec).
- `scripts/run-task/main.ts:2222-2246` — `rewriteArchivedTaskRefs()` call, `stagedPaths` construction, `commitArchiveChanges()` call, and the tail of `shipTasks()`. The re-append step goes right after the `archiveCommit.stderr` check.
- `scripts/run-task/validation.ts:1544-1578` — `verifyBaseDivergenceFromData` / `verifyBaseDivergence` is the closest existing precedent for this task's pure/impure split: a pure `*FromData` function that returns a formatted message, wrapped by an impure function that does the git I/O. Follow this shape.
- `scripts/run-task/git.ts:42-52` — `gitSafeAt` **trims** stdout; `gitSafeAtRaw` does **not**. Use `gitSafeAtRaw` when reading `HEAD:<path>` content — byte-for-byte comparison against the working copy is load-bearing (AC-2, AC-3, AC-8). The trimming variant would corrupt the pure-append check for files whose HEAD/working trailing whitespace doesn't happen to match after trimming.
- Existing test precedent: `tests/run-task-ship.test.ts:814-834` (`--ship orphaned worktree state reads the sidecar without crashing`) is the pattern for triggering the worktree-mode code path in a test — it writes `status.worktree = true` directly into `status.json` post-fixture-setup, without an actual `git worktree` on disk. `isOrphanedWorktreeState()` (`scripts/run-task/state.ts:66`) then makes `resolveShipCwd()` return `REPO_ROOT`, so the whole ship flow runs against `localDir` as both "REPO_ROOT" and the task's file location. Every new integration test in this plan reuses that trick.

## Step 1 — Pure classification helpers in `scripts/run-task/validation.ts`

Append these near the end of the file, after `verifyBaseDivergence` (line 1579). They are the `*FromData` seam AC-8 requires — side-effect-free, no `fs`/`git` calls.

```ts
export type SharedDocClass = 'managed' | 'telemetry';

export type SharedDocClassification =
    | { verdict: 'clean' }
    | { verdict: 'preserve'; suffix: string }
    | { verdict: 'abort'; reason: string };

/**
 * Classifies one shared doc's dirt. `headContent === null` means the HEAD
 * copy could not be read (untracked, or the read probe failed) — fail closed
 * for both classes rather than guessing. A working copy identical to HEAD is
 * `clean` regardless of class (the file showed up in the present-on-disk scan
 * but isn't actually dirty). Managed-doc dirt always aborts — only operators
 * write these files, so silent discard is never acceptable. Telemetry dirt is
 * preservable only when it's a byte-for-byte pure append over HEAD.
 */
export function classifySharedDocDirtFromData(
    docClass: SharedDocClass,
    headContent: string | null,
    workingContent: string,
): SharedDocClassification {
    if (headContent !== null && workingContent === headContent) {
        return { verdict: 'clean' };
    }
    if (docClass === 'managed') {
        return {
            verdict: 'abort',
            reason: headContent === null
                ? 'present on disk but not readable at HEAD (untracked?) — cannot verify it is safe to leave in place'
                : 'has uncommitted edits',
        };
    }
    if (headContent === null) {
        return {
            verdict: 'abort',
            reason: 'present on disk but not readable at HEAD (untracked?) — cannot verify pure-append safety',
        };
    }
    if (workingContent.startsWith(headContent)) {
        return { verdict: 'preserve', suffix: workingContent.slice(headContent.length) };
    }
    return {
        verdict: 'abort',
        reason: 'uncommitted edits are not a pure append over HEAD content — cannot safely preserve',
    };
}

export type SharedDocEntryInput = {
    relPath: string;
    docClass: SharedDocClass;
    headContent: string | null;
    workingContent: string;
};

export type SharedDocSetVerdict =
    | { ok: true; preserve: { relPath: string; suffix: string }[] }
    | { ok: false; abortedFiles: { relPath: string; reason: string }[] };

/**
 * Strict two-phase gate: classifies every entry, and if ANY aborts, the
 * overall verdict is abort — no partial preserve list, no mutation implied
 * anywhere. Callers must not act on `preserve` unless `ok === true`.
 */
export function classifySharedDocSetFromData(entries: readonly SharedDocEntryInput[]): SharedDocSetVerdict {
    const preserve: { relPath: string; suffix: string }[] = [];
    const abortedFiles: { relPath: string; reason: string }[] = [];
    for (const entry of entries) {
        const result = classifySharedDocDirtFromData(entry.docClass, entry.headContent, entry.workingContent);
        if (result.verdict === 'abort') {
            abortedFiles.push({ relPath: entry.relPath, reason: result.reason });
        } else if (result.verdict === 'preserve') {
            preserve.push({ relPath: entry.relPath, suffix: result.suffix });
        }
    }
    if (abortedFiles.length > 0) return { ok: false, abortedFiles };
    return { ok: true, preserve };
}

export function buildSharedDocAbortMessage(abortedFiles: readonly { relPath: string; reason: string }[]): string {
    const list = abortedFiles.map(f => `  - ${f.relPath}: ${f.reason}`).join('\n');
    return [
        '--ship aborted: uncommitted shared-doc edits could not be safely resolved before merging:',
        list,
        '',
        'Recovery: commit or stash your edits, then re-run --ship.',
        '--force does not bypass this gate.',
    ].join('\n');
}
```

Notes:
- `classifySharedDocDirtFromData` does not derive `docClass` from `PIPELINE_MANAGED_DOCS`/`PIPELINE_TELEMETRY_FILES` internally — the caller (main.ts) passes it in, per AC-8's "inputs: file class, HEAD content, working content."
- The AC-8 test row "empty suffix" is naturally covered by the `clean` branch: a working copy identical to HEAD never reaches the `preserve` branch with `suffix: ''`, because the identical-content check runs first. Write the unit test to confirm `workingContent === headContent` yields `{ verdict: 'clean' }`, not `{ verdict: 'preserve', suffix: '' }` — don't special-case an empty-suffix branch elsewhere.

## Step 2 — Wire the classification into `scripts/run-task/main.ts`

### 2a. Add the `node:os` import

```ts
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
```

### 2b. Replace the blanket-discard block (lines 2063-2072)

Old:

```ts
    // Worktree-mode tasks should leave no REPO_ROOT task-state mirror dirty under
    // the worktree-canonical model. Keep this as a legacy/backstop cleanup for
    // stale supervising-checkout shared-doc dirt before the merge pull.
    if (taskIds.some(id => taskSnapshot(id).worktree)) {
        const presentSharedDocs = splitWorktree.PIPELINE_SHARED_DOCS
            .filter(relPath => fs.existsSync(path.join(REPO_ROOT, relPath)));
        if (presentSharedDocs.length > 0) {
            splitGit.gitSafe('checkout', 'HEAD', '--', ...presentSharedDocs);
        }
    }
```

New:

```ts
    // Worktree-mode tasks should leave no REPO_ROOT task-state mirror dirty under
    // the worktree-canonical model. Pre-merge classification distinguishes stale
    // mirror dirt (safe to preserve/revert) from live foreign dirt (managed-doc
    // edits, non-pure-append telemetry) that must abort before anything merges.
    let preservedSharedDocDirt: PreservedTelemetryEntry[] = [];
    if (taskIds.some(id => taskSnapshot(id).worktree)) {
        preservedSharedDocDirt = classifyAndPreserveSharedDocDirt();
    }
```

Leave the `orphanedStatusPaths` block that follows completely untouched (Non-Goal).

### 2c. Add the orchestration function

Insert immediately before `function shipTasks(taskIds: string[]): void {` (so it reads as a helper for the function that calls it):

```ts
type PreservedTelemetryEntry = { relPath: string; suffix: string; backupPath: string };

/**
 * Pre-merge classification for shared-doc dirt in the supervising checkout,
 * called only when at least one shipped task is worktree-mode. Two-phase
 * gate: classify every present PIPELINE_SHARED_DOCS file before mutating any
 * of them (`classifySharedDocSetFromData` aborts the whole set if any file
 * aborts). Managed-doc dirt, or telemetry dirt that isn't a pure append over
 * HEAD, dies here before the merge. Safe pure-append telemetry dirt is backed
 * up to disk and reverted to HEAD here; the caller re-appends it after the
 * archive commit lands (see the commitArchiveChanges call site below) so a
 * sibling task's pending rows never land inside THIS task's archive commit.
 */
function classifyAndPreserveSharedDocDirt(): PreservedTelemetryEntry[] {
    const present = splitWorktree.PIPELINE_SHARED_DOCS.filter(relPath =>
        fs.existsSync(path.join(REPO_ROOT, relPath)));
    if (present.length === 0) return [];

    const managedDocs: readonly string[] = splitWorktree.PIPELINE_MANAGED_DOCS;
    const entries = present.map(relPath => {
        const docClass: splitValidation.SharedDocClass = managedDocs.includes(relPath) ? 'managed' : 'telemetry';
        const workingContent = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
        // gitSafeAtRaw (not gitSafeAt/gitSafe) — those trim stdout, which would
        // corrupt the byte-for-byte pure-append comparison below.
        const headResult = splitGit.gitSafeAtRaw(REPO_ROOT, 'show', `HEAD:${relPath}`);
        return { relPath, docClass, headContent: headResult.ok ? headResult.stdout : null, workingContent };
    });

    const verdict = splitValidation.classifySharedDocSetFromData(entries);
    if (!verdict.ok) {
        die(splitValidation.buildSharedDocAbortMessage(verdict.abortedFiles));
    }
    if (verdict.preserve.length === 0) return [];

    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-ship-shared-doc-backup-'));
    const preserved: PreservedTelemetryEntry[] = [];
    for (const { relPath, suffix } of verdict.preserve) {
        const backupPath = path.join(backupDir, relPath.replace(/[\\/]/g, '__'));
        fs.writeFileSync(backupPath, suffix, 'utf8');
        info(`Preserving uncommitted ${relPath} dirt during --ship — backup: ${backupPath}`);
        splitGit.gitSafe('checkout', 'HEAD', '--', relPath);
        preserved.push({ relPath, suffix, backupPath });
    }
    return preserved;
}
```

`die()` returns `never`, so TypeScript narrows `verdict` to `{ ok: true; preserve: ... }` for the rest of the function — no cast needed (same pattern used elsewhere in this file for other `{ ok, ... }` result objects).

### 2d. Re-append after the archive commit (near line 2232)

Old:

```ts
    const archiveCommit = commitArchiveChanges(taskIds, baseBranch, stagedPaths);
    if (archiveCommit.stderr) {
        die(`--ship aborted: failed to commit archive changes: ${archiveCommit.stderr}`);
    }
```

New (insert the loop immediately after):

```ts
    const archiveCommit = commitArchiveChanges(taskIds, baseBranch, stagedPaths);
    if (archiveCommit.stderr) {
        die(`--ship aborted: failed to commit archive changes: ${archiveCommit.stderr}`);
    }

    // Re-apply preserved telemetry dirt now that the archive commit (which
    // stages docs/lessons-learned.md and docs/task-quality-log.md via
    // rewriteArchivedTaskRefs()) has landed. Re-appending any earlier would
    // fold a sibling task's pending telemetry into THIS task's archive commit
    // and push it upstream — see the spec's "Known Risks" section.
    for (const { relPath, suffix, backupPath } of preservedSharedDocDirt) {
        fs.appendFileSync(path.join(REPO_ROOT, relPath), suffix, 'utf8');
        fs.rmSync(backupPath, { force: true });
        info(`Re-applied preserved ${relPath} dirt as uncommitted changes (backup removed).`);
    }
```

This runs unconditionally after the `archiveCommit.stderr` check (not gated on `archiveCommit.committed`) — the tasks directory move always stages something, so `commitArchiveChanges` always either commits or the run has already died above.

## Step 3 — Docs: `docs/pipeline-orchestrator.md`

Two edits to the `## Shipping & Post-Merge Reconciliation` section (around line 451-463):

1. Insert a new paragraph after the existing "**Note on merge strategy**" paragraph (line 455) and before the numbered run-order paragraph:

```markdown
**Shared-doc dirt at `--ship`**: when at least one shipped task is worktree-mode, the supervising checkout can carry uncommitted `PIPELINE_SHARED_DOCS` dirt — most commonly a sibling task's pre-implement telemetry rows (spec/spec_review run before that task's worktree exists, so their `recordMetric()` writes land in the supervising checkout instead). Dirty `PIPELINE_MANAGED_DOCS` always abort `--ship` before anything merges — the error names each dirty file and instructs commit-or-stash; `--force` does not bypass this. Dirty `PIPELINE_TELEMETRY_FILES` are preserved only when the uncommitted content is a byte-for-byte pure append over the HEAD copy: the suffix is backed up to disk, the working copy is reverted to HEAD, and — after the archive commit lands — the suffix is re-appended as an uncommitted change. Non-append telemetry dirt, or a telemetry file that can't be read at HEAD (untracked), aborts pre-merge exactly like a managed-doc conflict. Nothing is ever silently discarded.
```

2. Renumber and extend the run-order sentence (line 457) to fold in the new first step and note the deferred re-append:

Old:
```
`--ship` runs in this order: (1) verify local `<base>` has no commits ahead of `origin/<base>` unless `--allow-divergent-base` is passed, (2) merge any open PR for the task branch via `gh pr merge --squash --delete-branch`, (3) pull or fast-forward the base branch when needed, (4) run any project-specific post-merge hook under `.canon/hooks/`, (5) prove the task's merge before local branch deletion, (6) `git worktree remove --force` if a worktree was active, (7) archive `tasks/<id>/` to `tasks/_archive/<id>/` in the main checkout, (8) clean up local branches. **`--ship` fails closed if `handoff.md` is missing** — a task cannot be archived without validation evidence. Similarly, closing `human_review` without a `handoff.md` present fails with an explicit error rather than silently succeeding.
```

New:
```
`--ship` runs in this order: (1) when any shipped task is worktree-mode, classify dirty `PIPELINE_SHARED_DOCS` in the supervising checkout (see "Shared-doc dirt at `--ship`" above), (2) verify local `<base>` has no commits ahead of `origin/<base>` unless `--allow-divergent-base` is passed, (3) merge any open PR for the task branch via `gh pr merge --squash --delete-branch`, (4) pull or fast-forward the base branch when needed, (5) run any project-specific post-merge hook under `.canon/hooks/`, (6) prove the task's merge before local branch deletion, (7) `git worktree remove --force` if a worktree was active, (8) archive `tasks/<id>/` to `tasks/_archive/<id>/` in the main checkout and commit the archive move, re-applying any preserved telemetry dirt from step 1 as uncommitted changes once that commit lands, (9) clean up local branches. **`--ship` fails closed if `handoff.md` is missing** — a task cannot be archived without validation evidence. Similarly, closing `human_review` without a `handoff.md` present fails with an explicit error rather than silently succeeding.
```

After this edit, either let the pre-commit sync hook regenerate `templates/docs/pipeline-orchestrator.md`, or run `npm run sync-templates` yourself — **do not hand-edit `templates/docs/pipeline-orchestrator.md`**. Verify with `npm run sync-templates:check`. List both `docs/pipeline-orchestrator.md` and `templates/docs/pipeline-orchestrator.md` in the handoff Changes table (the spec's Affected Files table already lists both).

## Step 4 — Unit tests: `tests/run-task-validation.test.ts` (AC-8)

Add the new names to the existing import block from `'../scripts/run-task/validation.js'` (around line 19-41):

```ts
import {
    // ...existing imports...
    buildSharedDocAbortMessage,
    classifySharedDocDirtFromData,
    classifySharedDocSetFromData,
} from '../scripts/run-task/validation.js';
```

Add tests after the `verifyBaseDivergence` block (after line ~1943, before the `classifyPreflightBlockersFromData` tests resume). Cover every row AC-8 asks for:

```ts
void test('classifySharedDocDirtFromData: pure append over HEAD is preserved with the correct suffix', () => {
    const result = classifySharedDocDirtFromData('telemetry', 'base content\n', 'base content\nappended row\n');
    assert.deepEqual(result, { verdict: 'preserve', suffix: 'appended row\n' });
});

void test('classifySharedDocDirtFromData: working copy identical to HEAD is clean, not dirty', () => {
    const result = classifySharedDocDirtFromData('telemetry', 'same content\n', 'same content\n');
    assert.deepEqual(result, { verdict: 'clean' });
    const managedResult = classifySharedDocDirtFromData('managed', 'same content\n', 'same content\n');
    assert.deepEqual(managedResult, { verdict: 'clean' });
});

void test('classifySharedDocDirtFromData: modifying an existing line is not a pure append and aborts', () => {
    const result = classifySharedDocDirtFromData('telemetry', 'row-1\nrow-2\n', 'row-1-modified\nrow-2\n');
    assert.equal(result.verdict, 'abort');
    assert.match((result as { reason: string }).reason, /not a pure append/);
});

void test('classifySharedDocDirtFromData: missing HEAD content (untracked) aborts for telemetry', () => {
    const result = classifySharedDocDirtFromData('telemetry', null, 'untracked content\n');
    assert.equal(result.verdict, 'abort');
    assert.match((result as { reason: string }).reason, /untracked/);
});

void test('classifySharedDocDirtFromData: managed-doc dirt always aborts regardless of shape', () => {
    const pureAppendShape = classifySharedDocDirtFromData('managed', 'base\n', 'base\nextra\n');
    assert.equal(pureAppendShape.verdict, 'abort');
    assert.match((pureAppendShape as { reason: string }).reason, /uncommitted edits/);
});

void test('classifySharedDocDirtFromData: managed doc with unreadable HEAD content aborts, does not silently pass', () => {
    const result = classifySharedDocDirtFromData('managed', null, 'some content\n');
    assert.equal(result.verdict, 'abort');
});

void test('classifySharedDocSetFromData: mixed set — one aborting file yields overall abort verdict', () => {
    const verdict = classifySharedDocSetFromData([
        { relPath: 'docs/pipeline-invocations.md', docClass: 'telemetry', headContent: 'base\n', workingContent: 'base\nrow\n' },
        { relPath: 'docs/patterns.md', docClass: 'managed', headContent: 'p\n', workingContent: 'p\nedit\n' },
    ]);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
        assert.equal(verdict.abortedFiles.length, 1);
        assert.equal(verdict.abortedFiles[0].relPath, 'docs/patterns.md');
    }
});

void test('classifySharedDocSetFromData: all-clean/preserve set returns ok with the preserve list', () => {
    const verdict = classifySharedDocSetFromData([
        { relPath: 'docs/pipeline-invocations.md', docClass: 'telemetry', headContent: 'base\n', workingContent: 'base\nrow\n' },
        { relPath: 'docs/patterns.md', docClass: 'managed', headContent: 'p\n', workingContent: 'p\n' },
    ]);
    assert.deepEqual(verdict, { ok: true, preserve: [{ relPath: 'docs/pipeline-invocations.md', suffix: 'row\n' }] });
});

void test('buildSharedDocAbortMessage: names each file, its reason, and the recovery instruction', () => {
    const message = buildSharedDocAbortMessage([
        { relPath: 'docs/patterns.md', reason: 'has uncommitted edits' },
    ]);
    assert.match(message, /docs\/patterns\.md/);
    assert.match(message, /has uncommitted edits/);
    assert.match(message, /commit or stash/);
    assert.match(message, /--force does not bypass/);
});
```

## Step 5 — Integration tests: `tests/run-task-ship.test.ts` (AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-11)

### 5a. Extend `prepareShipFixture` with an optional doc-seeding hook

The fixture always builds the task branch from a bare `main` (README + `.gitignore` only) — the shared docs under test don't exist yet. Add an additive `seedSharedDocs` option so tests can commit an initial doc version to `main` *before* the task branch is cut (so both `main` and the task branch inherit it identically, matching how these canon-managed docs actually exist in a real project from `canon init` onward).

In `prepareShipFixture` (`tests/run-task-ship.test.ts:326-376`), add the field to the options type:

```ts
    options: {
        prNumbers?: Record<string, unknown>;
        mergeToOrigin?: boolean;
        deleteRemote?: boolean;
        syncBase?: boolean;
        advanceRemote?: boolean;
        materializeAdvancedHead?: boolean;
        seedSharedDocs?: Record<string, string>;
    } = {},
```

And insert this block right after `setupFakeTools(fakeTools);` and before `const branch = \`task/${taskIds[0]}\`;`:

```ts
    if (options.seedSharedDocs) {
        for (const [relPath, content] of Object.entries(options.seedSharedDocs)) {
            fs.mkdirSync(path.dirname(path.join(localDir, relPath)), { recursive: true });
            fs.writeFileSync(path.join(localDir, relPath), content, 'utf8');
            gitIn(localDir, 'add', relPath);
        }
        gitIn(localDir, 'commit', '-m', 'seed shared docs');
        gitIn(localDir, 'push', 'origin', 'main');
    }
```

This must run while `localDir` is still checked out on `main` (before the `checkout -b branch` line) — do not move it after.

### 5b. Add a small helper to flip a task to worktree mode post-fixture

Add near `writePrNumberSidecar` (or anywhere in the helpers section):

```ts
function markTaskWorktree(localDir: string, taskId: string): void {
    const statusPath = path.join(localDir, 'tasks', taskId, 'status.json');
    const status = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as Record<string, unknown>;
    status.worktree = true;
    fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}
```

This mirrors the existing inline pattern at `tests/run-task-ship.test.ts:820-823` (the "orphaned worktree" test) — extracted since 6+ new tests need it.

### 5c. New tests — append at the end of the file (after the last existing test, line 910)

```ts
void test('--ship preserves a sibling task\'s pending telemetry rows as uncommitted dirt (AC-2)', () => {
    withTempDir('run-task-ship-telemetry-preserve-', dir => {
        const taskId = 'ship-telemetry-preserve';
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 301 },
            seedSharedDocs: { 'docs/pipeline-invocations.md': '# Pipeline Invocations\n\nexisting row\n' },
        });
        markTaskWorktree(localDir, taskId);
        const telemetryPath = path.join(localDir, 'docs', 'pipeline-invocations.md');
        fs.appendFileSync(telemetryPath, 'sibling task pending row\n', 'utf8');
        const dirtyContent = fs.readFileSync(telemetryPath, 'utf8');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.equal(result.status, 0, result.stderr);
        expectArchivedAndDeleted(localDir, taskId, branch);
        assert.equal(fs.readFileSync(telemetryPath, 'utf8'), dirtyContent);
        const status = gitIn(localDir, 'status', '--porcelain', '--', 'docs/pipeline-invocations.md');
        assert.match(status, /docs\/pipeline-invocations\.md/);
        assert.equal(gitIn(localDir, 'show', 'HEAD:docs/pipeline-invocations.md'), '# Pipeline Invocations\n\nexisting row');
    });
});

void test('--ship mixed shared-doc dirt: managed-doc dirt aborts before any mutation (AC-3)', () => {
    withTempDir('run-task-ship-mixed-dirt-', dir => {
        const taskId = 'ship-mixed-dirt';
        const ghLog = path.join(dir, 'gh.log');
        const backupRoot = path.join(dir, 'tmp-backups');
        fs.mkdirSync(backupRoot, { recursive: true });
        const { localDir, branch, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 302 },
            seedSharedDocs: {
                'docs/pipeline-invocations.md': '# Pipeline Invocations\n\nexisting row\n',
                'docs/patterns.md': '# Patterns\n\nexisting pattern\n',
            },
        });
        markTaskWorktree(localDir, taskId);
        fs.appendFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), 'pending row\n', 'utf8');
        fs.appendFileSync(path.join(localDir, 'docs', 'patterns.md'), 'operator edit\n', 'utf8');
        const telemetryDirty = fs.readFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), 'utf8');
        const managedDirty = fs.readFileSync(path.join(localDir, 'docs', 'patterns.md'), 'utf8');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_LOG: ghLog,
            TMPDIR: backupRoot,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /docs\/patterns\.md/);
        assert.equal(fs.readFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), 'utf8'), telemetryDirty);
        assert.equal(fs.readFileSync(path.join(localDir, 'docs', 'patterns.md'), 'utf8'), managedDirty);
        assert.ok(!fs.existsSync(ghLog) || !fs.readFileSync(ghLog, 'utf8').includes('merge'));
        assert.deepEqual(fs.readdirSync(backupRoot), []);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship refuses managed-doc dirt and --force does not bypass it (AC-4)', () => {
    for (const force of [false, true]) {
        withTempDir(`run-task-ship-managed-dirt-${force ? 'force' : 'plain'}-`, dir => {
            const taskId = force ? 'ship-managed-dirt-force' : 'ship-managed-dirt';
            const ghLog = path.join(dir, 'gh.log');
            const { localDir, branch, fakeTools } = prepareShipFixture(dir, [taskId], {
                prNumbers: { [taskId]: 303 },
                seedSharedDocs: { 'docs/patterns.md': '# Patterns\n\nexisting pattern\n' },
            });
            markTaskWorktree(localDir, taskId);
            fs.appendFileSync(path.join(localDir, 'docs', 'patterns.md'), 'operator edit\n', 'utf8');
            const dirtyContent = fs.readFileSync(path.join(localDir, 'docs', 'patterns.md'), 'utf8');

            const args = force ? [taskId, '--ship', '--force'] : [taskId, '--ship'];
            const result = runCanon(localDir, args, fakeTools, { FAKE_GH_LOG: ghLog });

            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /docs\/patterns\.md/);
            assert.match(result.stderr, /commit or stash/);
            assert.equal(fs.readFileSync(path.join(localDir, 'docs', 'patterns.md'), 'utf8'), dirtyContent);
            assert.ok(!fs.existsSync(ghLog) || !fs.readFileSync(ghLog, 'utf8').includes('merge'));
            expectTaskAndBranchSurvive(localDir, taskId, branch);
        });
    }
});

void test('--ship aborts when telemetry dirt is not a pure append (AC-5)', () => {
    withTempDir('run-task-ship-non-append-', dir => {
        const taskId = 'ship-non-append';
        const ghLog = path.join(dir, 'gh.log');
        const { localDir, branch, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 304 },
            seedSharedDocs: { 'docs/task-quality-log.md': '# Task Quality Log\n\nrow-1\nrow-2\n' },
        });
        markTaskWorktree(localDir, taskId);
        const target = path.join(localDir, 'docs', 'task-quality-log.md');
        fs.writeFileSync(target, '# Task Quality Log\n\nrow-1-modified\nrow-2\n', 'utf8');
        const dirtyContent = fs.readFileSync(target, 'utf8');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, { FAKE_GH_LOG: ghLog });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /docs\/task-quality-log\.md/);
        assert.equal(fs.readFileSync(target, 'utf8'), dirtyContent);
        assert.ok(!fs.existsSync(ghLog) || !fs.readFileSync(ghLog, 'utf8').includes('merge'));
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship aborts when a telemetry file is untracked at HEAD (AC-6)', () => {
    withTempDir('run-task-ship-untracked-telemetry-', dir => {
        const taskId = 'ship-untracked-telemetry';
        const ghLog = path.join(dir, 'gh.log');
        const { localDir, branch, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 305 },
        });
        markTaskWorktree(localDir, taskId);
        const target = path.join(localDir, 'docs', 'task-quality-log.md');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, 'untracked content\n', 'utf8');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, { FAKE_GH_LOG: ghLog });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /docs\/task-quality-log\.md/);
        assert.equal(fs.readFileSync(target, 'utf8'), 'untracked content\n');
        assert.ok(!fs.existsSync(ghLog) || !fs.readFileSync(ghLog, 'utf8').includes('merge'));
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship backs up preserved telemetry dirt to disk and removes it after a successful ship (AC-7)', () => {
    withTempDir('run-task-ship-backup-lifecycle-', dir => {
        const taskId = 'ship-backup-lifecycle';
        const backupRoot = path.join(dir, 'tmp-backups');
        fs.mkdirSync(backupRoot, { recursive: true });
        const { localDir, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 306 },
            seedSharedDocs: { 'docs/pipeline-invocations.md': '# Pipeline Invocations\n\nexisting row\n' },
        });
        markTaskWorktree(localDir, taskId);
        fs.appendFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), 'pending row\n', 'utf8');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
            TMPDIR: backupRoot,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Preserving uncommitted docs\/pipeline-invocations\.md dirt.*backup: (\S+)/);
        const match = result.stdout.match(/backup: (\S+)/);
        assert.ok(match, 'expected a logged backup path');
        assert.ok(!fs.existsSync(match[1]), 'backup file should be removed after a successful ship');
    });
});

void test('--ship preserves lessons-learned/task-quality-log dirt without folding it into the archive commit (AC-11)', () => {
    withTempDir('run-task-ship-archive-preserve-', dir => {
        const taskId = 'ship-archive-preserve';
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 307 },
            seedSharedDocs: {
                'docs/lessons-learned.md': `# Lessons Learned\n\nSee tasks/${taskId}/notes.md for details.\n`,
                'docs/task-quality-log.md': `# Task Quality Log\n\nSee tasks/${taskId}/notes.md.\n`,
            },
        });
        markTaskWorktree(localDir, taskId);
        fs.appendFileSync(path.join(localDir, 'docs', 'lessons-learned.md'), 'sibling pending lesson\n', 'utf8');
        fs.appendFileSync(path.join(localDir, 'docs', 'task-quality-log.md'), 'sibling pending qa row\n', 'utf8');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.equal(result.status, 0, result.stderr);
        expectArchivedAndDeleted(localDir, taskId, branch);

        const archivedLessons = `# Lessons Learned\n\nSee tasks/_archive/${taskId}/notes.md for details.\n`;
        const archivedQuality = `# Task Quality Log\n\nSee tasks/_archive/${taskId}/notes.md.\n`;
        assert.equal(gitIn(localDir, 'show', 'HEAD:docs/lessons-learned.md'), archivedLessons.trim());
        assert.equal(gitIn(localDir, 'show', 'HEAD:docs/task-quality-log.md'), archivedQuality.trim());

        assert.equal(
            fs.readFileSync(path.join(localDir, 'docs', 'lessons-learned.md'), 'utf8'),
            `${archivedLessons}sibling pending lesson\n`,
        );
        assert.equal(
            fs.readFileSync(path.join(localDir, 'docs', 'task-quality-log.md'), 'utf8'),
            `${archivedQuality}sibling pending qa row\n`,
        );

        const status = gitIn(localDir, 'status', '--porcelain', '--',
            'docs/lessons-learned.md', 'docs/task-quality-log.md');
        assert.match(status, /docs\/lessons-learned\.md/);
        assert.match(status, /docs\/task-quality-log\.md/);
    });
});
```

Implementation gotchas worth flagging up front (don't rediscover these mid-implementation):

- `gitIn(...)` (the test helper, not the production code) calls `.trim()` on the whole `execFileSync` result, which strips a leading `" "` from ` M path` porcelain lines, not just trailing whitespace. Don't assert an exact `^ M path$` porcelain match through `gitIn` — assert the path substring is present instead (as done above), or bypass `gitIn` and call `spawnSync` directly if an exact status-code assertion is ever needed.
- `TMPDIR` is how Node's `os.tmpdir()` is overridden on POSIX (this repo's CI and dev machines). It is passed through `runCanon`'s `env` parameter like any other var. Don't try to predict `os.tmpdir()`'s default value in a test — always override it when a test needs to inspect backup-file paths (AC-3, AC-7).
- The seeded shared docs must be committed to `main` **before** the task branch is cut (`prepareShipFixture` creates the branch as `task/<id>` off `main`). Committing them after branch creation would leave `main` without them, and the later `git checkout main` mid-ship would delete the file from the working tree entirely (main's tree never had it) instead of exercising the real "shared doc that already exists in every canon project" scenario the spec is testing.
- For AC-3/4/5/6, `FAKE_GH_LOG` is unset unless passed — checking `!fs.existsSync(ghLog) || !...includes('merge')` covers both "gh was never invoked" (expected here, since classification runs before any `gh` call) and "gh was invoked for something other than `pr merge`."

## Step 6 — Validation

Run in this order (matches the spec's Validation Required):

1. `npm run lint`
2. `npm run type-check`
3. `npm test` — confirm both new AC-2/3/4/5/6/7/11 integration tests and the AC-8 unit tests pass, and that no existing `run-task-ship.test.ts` / `run-task-validation.test.ts` test regressed (the `prepareShipFixture` signature change is additive-only — every existing call site omits `seedSharedDocs` and is unaffected).
4. `npm run build` — required because `scripts/run-task/main.ts` and `scripts/run-task/validation.ts` changed; commit the resulting `dist/cli/index.js` and `dist/scripts/run-task.js` diffs and list them in the handoff Changes table.
5. `npm run docs-refs-check`
6. `npm run sync-templates:check` — should pass without manual `templates/` edits if the pre-commit hook ran; if it didn't (e.g., running checks standalone before commit), run `npm run sync-templates` first.

## Handoff Changes table — expected entries

- `scripts/run-task/validation.ts` — new pure classification helpers.
- `scripts/run-task/main.ts` — replaced blanket discard, new orchestration function, re-append step, `node:os` import.
- `docs/pipeline-orchestrator.md` — new paragraph + renumbered run-order sentence.
- `templates/docs/pipeline-orchestrator.md` — generated mirror.
- `tests/run-task-validation.test.ts` — new unit tests + import additions.
- `tests/run-task-ship.test.ts` — extended `prepareShipFixture`, new `markTaskWorktree` helper, 7 new integration tests.
- `dist/cli/index.js`, `dist/scripts/run-task.js` — rebuild output.

## Out of scope (per spec Non-Goals — do not touch)

- `orphanedStatusPaths` cleanup block (`main.ts:2074-2079`) — stays byte-identical.
- What `commitArchiveChanges` stages/commits for `docs/lessons-learned.md` / `docs/task-quality-log.md` — unchanged; the preserved suffix is layered on afterward, never committed.
- Relocating pre-implement telemetry writes out of `REPO_ROOT` — separate future task.
- `--pr` / `--push` — no shared-doc discard exists there today; none is added.
- Non-worktree ships — trigger condition (`taskIds.some(id => taskSnapshot(id).worktree)`) is unchanged.
- No interactive confirm-to-discard prompt — aborts are hard failures with guidance.

## Testing Plan

- **Unit**: `tests/run-task-validation.test.ts` — 9 new tests covering `classifySharedDocDirtFromData`, `classifySharedDocSetFromData`, `buildSharedDocAbortMessage` (Step 4 / AC-8).
- **Integration**: `tests/run-task-ship.test.ts` — 7 new tests covering AC-2, AC-3, AC-4 (×2 via `--force` loop), AC-5, AC-6, AC-7, AC-11 (Step 5).
- **Manual**: not required pre-merge; the spec's Human Test Plan is for post-ship operator verification in a real canon-managed project, out of scope for this implement phase.

## Rollback Plan

Pure revert of the `main.ts` / `validation.ts` diff restores the pre-existing blanket-discard behavior (data-loss bug included) — no data migration, no schema change, no `status.json` shape change. The backup files this change writes live under `os.tmpdir()` and are self-cleaning on success; a crash mid-window leaves an orphaned backup file that is harmless to delete manually (it only ever contains a suffix of a telemetry doc, never source code).

## Reroute Plan

### Context

The final amendment review verdict is **approved with nits** (`spec-review.md`'s last "Amendment Review" block). The two nits are spec-wording-only (AC-7's label should say "Amendment A6," not "A5"; Known Risks should say "this amendment," not "Amendment, round 2") — no spec edit is needed to implement against them.

The code currently on this branch (per `handoff.md`) predates the amendment entirely — it implements the pre-amendment design the amendment's Blocking findings were filed against. Confirmed directly in `scripts/run-task/main.ts`:

- `commitArchiveChanges(taskIds, baseBranch, stagedPaths)` (`main.ts:1887-1905`) still does staging (`git add -A` loop), the cached-diff check, `git commit`, and `git push` all inside one function — the exact shape the amendment's first Blocking finding (round-2 review) said made A1 unimplementable as originally worded.
- The call site (`main.ts:2274-2283`) still calls `commitArchiveChanges(...)` first and only re-appends the preserved suffix in a loop *after* it returns — the exact ordering the amendment's second Blocking finding said reintroduces a narrowed data-loss window on commit/push failure.
- `docs/pipeline-orchestrator.md:457,459` still documents "after the archive commit lands the suffix is re-appended" — the stale timing the amendment's third Blocking finding flagged against AC-10.

So this round's delta is exactly implementing A1–A6 as written in the spec's `## Amendment` section: split the seam, move the re-append between staging and commit, add the two crash-safety regression tests (A2, A3), update the one existing caller of the old 3-arg `commitArchiveChanges`, and fix the doc wording. Everything from the original plan (Steps 0–6 above) that isn't touched by this delta stands as implemented — this section does not re-plan the classification helpers, the abort paths, or AC-2/3/4/5/6/7/8/9/11 test bodies, which are unaffected by the seam split.

### Delta

**1. Split the seam in `scripts/run-task/main.ts` (A1).**

Replace `commitArchiveChanges` (`main.ts:1887-1905`) with two exported functions:

```ts
export function stageArchiveChanges(stagedPaths: readonly string[]): void {
    for (const p of stagedPaths) gitSafe('add', '-A', '--', p);
}

export function commitArchiveChanges(
    taskIds: string[],
    baseBranch: string,
): { committed: boolean; stderr?: string } {
    const staged = gitSafe('diff', '--cached', '--name-only');
    if (!staged.stdout.trim()) return { committed: false };

    const label = taskIds.length === 1 ? taskIds[0] : taskIds.join(', ');
    const commitResult = gitSafe('commit', '-m', `chore: archive ${label}`);
    if (!commitResult.ok) {
        return { committed: false, stderr: commitResult.stderr || 'unknown error' };
    }

    info(`Pushing ${baseBranch}...`);
    git('push', 'origin', baseBranch);
    return { committed: true };
}
```

`stagedPaths` is dropped from `commitArchiveChanges`'s signature per the amendment's Scope note — it moves entirely into `stageArchiveChanges`.

**2. Reorder the call site (`main.ts:2264-2283`) (A1).**

Old (current code):

```ts
    rewriteArchivedTaskRefs(taskIds);

    const stagedPaths: string[] = taskIds.flatMap(id => [ /* ... */ ]);
    const archiveCommit = commitArchiveChanges(taskIds, baseBranch, stagedPaths);
    if (archiveCommit.stderr) {
        die(`--ship aborted: failed to commit archive changes: ${archiveCommit.stderr}`);
    }

    for (const { relPath, suffix, backupPath } of preservedSharedDocDirt) {
        fs.appendFileSync(path.join(REPO_ROOT, relPath), suffix, 'utf8');
        fs.rmSync(backupPath, { force: true });
        info(`Re-applied preserved ${relPath} dirt as uncommitted changes; backup removed.`);
    }
```

New:

```ts
    rewriteArchivedTaskRefs(taskIds);

    const stagedPaths: string[] = taskIds.flatMap(id => [ /* unchanged */ ]);
    stageArchiveChanges(stagedPaths);

    // Re-apply preserved telemetry dirt now that this task's archive move is
    // staged (still suffix-free at this point — the suffix lands only in the
    // working tree, never in the index `stageArchiveChanges` just captured).
    // Re-appending here, before commit, means a sibling task's pending rows
    // never land inside THIS task's archive commit — see spec Amendment.
    for (const { relPath, suffix, backupPath } of preservedSharedDocDirt) {
        fs.appendFileSync(path.join(REPO_ROOT, relPath), suffix, 'utf8');
        fs.rmSync(backupPath, { force: true });
        info(`Re-applied preserved ${relPath} dirt as uncommitted changes; backup removed.`);
    }

    const archiveCommit = commitArchiveChanges(taskIds, baseBranch);
    if (archiveCommit.stderr) {
        die(`--ship aborted: failed to commit archive changes: ${archiveCommit.stderr}`);
    }
```

Note the `die()` on commit failure now runs *after* the re-append, so the suffix is already back in the working tree when the process exits — this is what makes A2 pass. `stagedPaths` itself and everything before `rewriteArchivedTaskRefs` are untouched.

**3. Update the one existing caller of the old 3-arg form: `tests/run-task-safety.test.ts:1107` (per Amendment Scope).**

Old:

```ts
            const result = commitArchiveChanges(['example'], 'main', ['tasks/example']);
            assert.deepEqual(result, { committed: false, stderr: 'commit failed' });
```

New:

```ts
            stageArchiveChanges(['tasks/example']);
            const result = commitArchiveChanges(['example'], 'main');
            assert.deepEqual(result, { committed: false, stderr: 'commit failed' });
```

Add `stageArchiveChanges` to the import at `tests/run-task-safety.test.ts:23`:

```ts
import { commitArchiveChanges, stageArchiveChanges } from '../scripts/run-task/main.js';
```

The existing log assertions right after (`add -A -- tasks/example`, then `diff --cached --name-only`, then `commit -m chore: archive example`, no push) still hold in the same order — `stageArchiveChanges` now emits the `add` line and `commitArchiveChanges` emits the rest. No fixture change needed (`FAKE_GIT_FAIL_COMMIT: '1'` from `setupFakeGit`, already present at `tests/run-task-safety.test.ts:1105`, still drives the failure).

**4. New regression tests in `tests/run-task-ship.test.ts` (A2, A3).**

These need a real-`git` passthrough wrapper that fails one specific command, following the existing `setupGitDeleteRace` precedent (`tests/run-task-ship.test.ts:169-177`) rather than `run-task-safety.test.ts`'s fully-fake git (this suite drives real git repos via `makeGitFixture`/`prepareShipFixture`). Grep-confirmed unique match targets: `git commit -m "chore: archive <id>"` is the only commit call with that message prefix anywhere in `shipTasks()`'s call graph, and `git push origin <baseBranch>` with exactly 3 args (no `-u`/`--delete`) is the only such call — every other push in `main.ts` passes `-u`/`--set-upstream`/`--delete` (`main.ts:1239,1337,1552`). Add near `setupGitDeleteRace`:

```ts
function setupGitArchiveFailure(scriptDir: string, realGit: string, mode: 'commit' | 'push'): void {
    const guard = mode === 'commit'
        ? [
            'if [ "${1:-}" = "commit" ] && [ "${2:-}" = "-m" ]; then',
            '  case "${3:-}" in',
            '    "chore: archive "*)',
            '      printf "%s\\n" "simulated archive commit failure" >&2',
            '      exit 1',
            '      ;;',
            '  esac',
            'fi',
        ]
        : [
            'if [ "${1:-}" = "push" ] && [ "${2:-}" = "origin" ] && [ $# -eq 3 ]; then',
            '  printf "%s\\n" "simulated archive push failure" >&2',
            '  exit 1',
            'fi',
        ];
    writeExecutable(scriptDir, 'git', [
        ...guard,
        `exec ${JSON.stringify(realGit)} "$@"`,
    ]);
}
```

Add after the existing AC-11 test (end of file):

```ts
void test('--ship preserves telemetry in the working tree when the archive commit fails (A2)', () => {
    withTempDir('run-task-ship-archive-commit-fail-', dir => {
        const taskId = 'ship-archive-commit-fail';
        const { localDir, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 308 },
            seedSharedDocs: { 'docs/pipeline-invocations.md': '# Pipeline Invocations\n\nexisting row\n' },
        });
        markTaskWorktree(localDir, taskId);
        fs.appendFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), 'pending row\n', 'utf8');

        const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
        setupGitArchiveFailure(fakeTools, realGit, 'commit');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /failed to commit archive changes/);
        assert.equal(
            fs.readFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), 'utf8'),
            '# Pipeline Invocations\n\nexisting row\npending row\n',
        );
    });
});

void test('--ship preserves telemetry in the working tree when the archive push fails (A3)', () => {
    withTempDir('run-task-ship-archive-push-fail-', dir => {
        const taskId = 'ship-archive-push-fail';
        const { localDir, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 309 },
            seedSharedDocs: { 'docs/pipeline-invocations.md': '# Pipeline Invocations\n\nexisting row\n' },
        });
        markTaskWorktree(localDir, taskId);
        fs.appendFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), 'pending row\n', 'utf8');

        const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
        setupGitArchiveFailure(fakeTools, realGit, 'push');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /simulated archive push failure/);
        assert.equal(
            fs.readFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), 'utf8'),
            '# Pipeline Invocations\n\nexisting row\npending row\n',
        );
    });
});
```

A3 relies on `git('push', ...)` (`git.ts:32-36`) throwing on non-zero exit, which propagates uncaught out of `main()` in the `runCanon` test harness's `.catch(error => { console.error(error); process.exit(1); })` (`tests/run-task-ship.test.ts:188`) — so `result.status !== 0` and the thrown message lands in `result.stderr`. Unlike A2, there is no `die()` call to word the message; assert on the fake git's own stderr text instead.

**5. Regression check only — no new code (A4).**

Re-run the existing AC-2 (`--ship preserves a sibling task's pending telemetry rows...`), AC-3 (mixed-dirt abort), and AC-11 (archive-staged telemetry preserved without absorption) tests after the steps above land. They must pass unmodified — the reordering changes *when* re-append happens relative to commit/push, not the happy-path or abort-path outcomes those three tests assert on. If any of the three needs an edit to pass, that's a signal the reorder broke something the amendment didn't intend to change — stop and re-examine before adjusting the test.

**6. Docs: `docs/pipeline-orchestrator.md` (AC-10, as amended).**

Two edits to the `## Shipping & Post-Merge Reconciliation` section:

`docs/pipeline-orchestrator.md:457` — replace "the suffix is backed up to disk, the working copy is reverted to HEAD, and after the archive commit lands the suffix is re-appended as an uncommitted change" with "the suffix is backed up to disk, the working copy is reverted to HEAD, and — after the archive changes are staged but before they are committed — the suffix is re-appended as an uncommitted change."

`docs/pipeline-orchestrator.md:459` — replace step (9) "commit archive changes, re-append preserved telemetry dirt as uncommitted supervising-checkout changes, and clean up local branches" with "stage archive changes, re-append preserved telemetry dirt as uncommitted supervising-checkout changes, commit and push the archive changes, and clean up local branches."

After editing, let the pre-commit sync hook regenerate `templates/docs/pipeline-orchestrator.md`, or run `npm run sync-templates`; verify with `npm run sync-templates:check`. List both paths in the handoff Changes table.

**7. Rebuild and validate.**

`scripts/run-task/main.ts` changed again, so `npm run build` must be re-run and the `dist/cli/index.js` / `dist/scripts/run-task.js` diffs (whichever actually change) committed. Full order, same as the spec's amendment validation line: `npm run lint`, `npm run type-check`, `npm test` (confirm A2/A3 pass and A4's three pre-existing tests still pass), `npm run build`, `npm run docs-refs-check`, `npm run sync-templates:check`.

### Handoff Changes table — expected entries for this round

- `scripts/run-task/main.ts` — seam split (`stageArchiveChanges` + slimmed `commitArchiveChanges`), reordered call site.
- `tests/run-task-safety.test.ts` — updated caller + import for the new 2-function seam.
- `tests/run-task-ship.test.ts` — new `setupGitArchiveFailure` helper, two new tests (A2, A3).
- `docs/pipeline-orchestrator.md` — corrected re-append timing in two places.
- `templates/docs/pipeline-orchestrator.md` — generated mirror.
- `dist/cli/index.js`, `dist/scripts/run-task.js` — rebuild output (whichever changes).

### Out of scope for this round (per Amendment Scope)

- `scripts/run-task/validation.ts` and its classification helpers — unaffected; the amendment doesn't change classification, only the re-append timing relative to staging/commit.
- No new files, no schema change, no change to *what* gets staged or committed — only *which function performs which step* and what runs between them (Amendment, Scope paragraph).
- AC-7's original "backup survives push failure" wording is already superseded in spec.md by A6 — no further spec edit needed; A2/A3 above are what makes that superseding claim true in code.

## Reroute Plan Round 2

### Context

Amendment Round 2's final verdict is **approved with nits** (`spec-review.md`'s last "Amendment Review Round 2" block). The one nit is non-blocking and test-construction-only (A7's porcelain-code example is slightly off — see Step 4 below); no further spec edit is needed to implement against it.

The code currently on this branch (confirmed by reading the actual files, not just `handoff.md`) implements Round 1 (A1–A6) only — `handoff.md`'s AC Coverage table stops at A6 and never mentions A7–A11. Confirmed directly:

- `classifySharedDocDirtFromData(docClass, headContent, workingContent)` in `scripts/run-task/validation.ts:1587` still takes the pre-Round-2 3-argument shape (`headContent: string | null`, `workingContent: string` — non-nullable). `SharedDocEntryInput` (`validation.ts:1618`) still has no `porcelainCode` field and `workingContent: string`.
- `classifyAndPreserveSharedDocDirt()` in `scripts/run-task/main.ts:1940-1956` still derives dirt from `fs.existsSync` (the present-filter Round 2 replaces) plus a per-file `fs.readFileSync` + `gitSafeAtRaw(REPO_ROOT, 'show', 'HEAD:...')` content comparison — no batched `git status --porcelain` call, no porcelain-code gate.
- `tests/run-task-validation.test.ts:227,234,241,248,255,264-281` still call the old 3-arg form, exactly matching the spec's "Known callers to update" table.

So this round's delta is implementing Round 2's amendment as written: replace the `fs.existsSync`-plus-content-diff detection with a batched `git status --porcelain=v1` call, gate classification on the resulting 2-character code (only `' M'` reaches the existing content check; everything else — staged changes, deletions, renames, untracked — aborts for both file classes), widen the `*FromData` seam to take `porcelainCode`, update the known test callers, and add the new A7–A10 integration/unit coverage. Everything from the original plan (Steps 0–6) and Round 1's delta that isn't touched here stands as implemented — this section does not re-plan the classification-verdict shape (`clean`/`preserve`/`abort`), the abort-message builder, the two-phase set gate, the `stageArchiveChanges`/`commitArchiveChanges` seam split, or AC-2/3/4/5/6/7/8/9/11/A1-A6, none of which Round 2 touches.

**Reusable seam found during orientation — not in the spec, but load-bearing for this delta**: `scripts/run-task/git.ts:373` already exports `parsePorcelainEntries(output: string): PorcelainEntry[]`, returning `{ raw, indexStatus, worktreeStatus, paths }` per line, with rename lines (`'...  -> ...'`) already split into `paths: [oldPath, newPath]`. `indexStatus + worktreeStatus` is exactly the 2-character porcelain code the amendment specifies (e.g. `' M'`, `'M '`, `'??'`... concatenating `'?' + '?'` for untracked). Reuse this directly instead of writing new porcelain-parsing logic in `main.ts` — it is already used at 7 other call sites in `main.ts` for the same `git status --porcelain=v1` output shape.

### Delta

**1. Widen the pure classification seam in `scripts/run-task/validation.ts` (AC-8 as amended, A10).**

Replace the `classifySharedDocDirtFromData` signature and body (`validation.ts:1587-1611`):

```ts
export function classifySharedDocDirtFromData(
    docClass: SharedDocClass,
    porcelainCode: string | null,
    headContent: string | null,
    workingContent: string | null,
): SharedDocClassification {
    if (porcelainCode === null) {
        return { verdict: 'clean' };
    }
    if (porcelainCode !== ' M') {
        return {
            verdict: 'abort',
            reason: `git status shows this path as '${porcelainCode.trim()}' — only a plain unstaged ` +
                'modification is eligible for preservation; staged changes, deletions, untracked files, ' +
                'and renames abort',
        };
    }
    // From here down: porcelainCode === ' M' — original content-diff logic, unchanged.
    // main.ts only ever passes workingContent: null when porcelainCode !== ' M' (see step 2), so this
    // branch is unreachable in practice; narrow defensively rather than asserting, since the type is
    // honestly nullable at the signature boundary.
    if (workingContent === null) {
        return {
            verdict: 'abort',
            reason: 'present on disk but not readable at HEAD (untracked?) — cannot verify pure-append safety',
        };
    }
    if (headContent !== null && workingContent === headContent) {
        return { verdict: 'clean' };
    }
    if (docClass === 'managed') {
        return {
            verdict: 'abort',
            reason: headContent === null
                ? 'present on disk but not readable at HEAD (untracked?) — cannot verify it is safe to leave in place'
                : 'has uncommitted edits',
        };
    }
    if (headContent === null) {
        return {
            verdict: 'abort',
            reason: 'present on disk but not readable at HEAD (untracked?) — cannot verify pure-append safety',
        };
    }
    if (workingContent.startsWith(headContent)) {
        return { verdict: 'preserve', suffix: workingContent.slice(headContent.length) };
    }
    return {
        verdict: 'abort',
        reason: 'uncommitted edits are not a pure append over HEAD content — cannot safely preserve',
    };
}
```

Widen `SharedDocEntryInput` (`validation.ts:1618-1623`):

```ts
export type SharedDocEntryInput = {
    relPath: string;
    docClass: SharedDocClass;
    porcelainCode: string | null;
    headContent: string | null;
    workingContent: string | null;
};
```

`classifySharedDocSetFromData` (`validation.ts:1626-1639`) needs one added argument in its call to `classifySharedDocDirtFromData` — pass `entry.porcelainCode` as the new second positional arg; everything else in that function (the abort/preserve aggregation loop) is untouched. `buildSharedDocAbortMessage` is untouched (it only ever consumes `{ relPath, reason }`, already produced correctly by the new abort branch).

**2. Replace `fs.existsSync`-plus-content-diff detection with a batched porcelain call in `scripts/run-task/main.ts` (AC-1 as amended, AC-8, A7-A9).**

Replace `classifyAndPreserveSharedDocDirt()`'s detection block (`main.ts:1940-1956`, everything before `const verdict = ...`):

```ts
function classifyAndPreserveSharedDocDirt(): PreservedTelemetryEntry[] {
    const statusResult = splitGit.gitSafeAtRaw(
        REPO_ROOT, 'status', '--porcelain=v1', '-uall', '--', ...splitWorktree.PIPELINE_SHARED_DOCS,
    );
    const porcelainByPath = new Map<string, string>();
    for (const entry of splitGit.parsePorcelainEntries(statusResult.stdout)) {
        const code = entry.indexStatus + entry.worktreeStatus;
        for (const p of entry.paths) porcelainByPath.set(p, code);
    }

    const dirty = splitWorktree.PIPELINE_SHARED_DOCS.filter(relPath => porcelainByPath.has(relPath));
    if (dirty.length === 0) return [];

    const managedDocs: readonly string[] = splitWorktree.PIPELINE_MANAGED_DOCS;
    const entries = dirty.map(relPath => {
        const docClass: splitValidation.SharedDocClass = managedDocs.includes(relPath) ? 'managed' : 'telemetry';
        const porcelainCode = porcelainByPath.get(relPath) ?? null;
        if (porcelainCode !== ' M') {
            // Not the safe shape — no content read needed, nothing to preserve.
            return { relPath, docClass, porcelainCode, headContent: null, workingContent: null };
        }
        const workingContent = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
        const headResult = splitGit.gitSafeAtRaw(REPO_ROOT, 'show', `HEAD:${relPath}`);
        return {
            relPath,
            docClass,
            porcelainCode,
            headContent: headResult.ok ? headResult.stdout : null,
            workingContent,
        };
    });
    // (rest of the function — classifySharedDocSetFromData call through the backup loop — is unchanged)
```

Notes:
- This drops the old `fs.existsSync` present-filter entirely — a path absent from the porcelain map (fully clean, matches HEAD in both index and worktree) never enters `entries`, exactly matching the pre-Round-2 "zero-`present` fast path" behavior for the truly-clean case. A path that's dirty-but-deleted-from-the-working-tree (a case `fs.existsSync` would have silently skipped, AC-9's gap) now surfaces via its porcelain code (`' D'`) and reaches the entries array, closing that gap.
- `git status --porcelain=v1 -- <paths>` reports explicitly-named files individually regardless of the `-u` setting (the `-u` flag only governs untracked-*directory* expansion) — `-uall` is included only for consistency with every other `git status --porcelain=v1` call site in this file, not because it's load-bearing here.
- Rename lines produce `paths: [oldPath, newPath]` from `parsePorcelainEntries` — both get mapped to the same code, so a rename is caught whichever side is the `PIPELINE_SHARED_DOCS` entry (the old path, in practice, since the new path is a project-defined constant unlikely to also be in that list).
- Reads (`fs.readFileSync` + `gitSafeAtRaw ... show`) now happen only for the `' M'` subset, not for every dirty file — a smaller, more precise read set than Round 1's, and it naturally skips a read attempt for a deleted file (which would have thrown on `fs.readFileSync`).

**3. Update the known test callers in `tests/run-task-validation.test.ts` (per spec's "Known callers to update" table).**

Apply exactly the table from the spec's Amendment Round 2 section, at the confirmed current line numbers:

| Line | Change |
|---|---|
| 227 | `classifySharedDocDirtFromData('telemetry', 'base\n', 'base\nrow\n')` → `classifySharedDocDirtFromData('telemetry', ' M', 'base\n', 'base\nrow\n')` — same expected result |
| 234 | `classifySharedDocDirtFromData('telemetry', 'base\n', 'base\n')` → `classifySharedDocDirtFromData('telemetry', null, 'base\n', 'base\n')` — same expected result (`{ verdict: 'clean' }`) |
| 241 | `classifySharedDocDirtFromData('telemetry', 'base\n', 'changed\n')` → `classifySharedDocDirtFromData('telemetry', ' M', 'base\n', 'changed\n')` — same expected result |
| 248 | `classifySharedDocDirtFromData('managed', 'base\n', 'base\nedit\n')` → `classifySharedDocDirtFromData('managed', ' M', 'base\n', 'base\nedit\n')` — same expected result |
| 255 | `classifySharedDocDirtFromData('telemetry', null, 'row\n')` → `classifySharedDocDirtFromData('telemetry', '??', null, 'row\n')` — **expected result changes** to `{ verdict: 'abort', reason: "git status shows this path as '??' — only a plain unstaged modification is eligible for preservation; staged changes, deletions, untracked files, and renames abort" }` |
| 264-281 | both entries in the `classifySharedDocSetFromData` set-test array gain `porcelainCode: ' M'` — same expected verdict |

Add one new unit test (the spec's "New test needed" paragraph) for the still-relevant defensive fallback the old line-255 test used to cover:

```ts
void test('classifySharedDocDirtFromData aborts when HEAD is unreadable even though porcelain says safe-shape', () => {
    assert.deepEqual(
        classifySharedDocDirtFromData('telemetry', ' M', null, 'row\n'),
        { verdict: 'abort', reason: 'present on disk but not readable at HEAD (untracked?) — cannot verify pure-append safety' },
    );
});
```

**4. A10 unit coverage: one row per practical porcelain code.**

Add unit rows (near the tests updated in step 3) for every code A10 lists, plus the `'MM'` variant the review's non-blocking nit flagged:

```ts
void test('classifySharedDocDirtFromData aborts every porcelain code except the safe plain-unstaged-edit shape', () => {
    const unsafeCodes = ['A ', 'M ', 'D ', ' D', 'R ', '??', 'MM'];
    for (const code of unsafeCodes) {
        const result = classifySharedDocDirtFromData('telemetry', code, 'base\n', 'base\nrow\n');
        assert.equal(result.verdict, 'abort', `expected abort for code ${JSON.stringify(code)}`);
    }
});
```

`'MM'` (index differs from HEAD **and** worktree differs from index) is the code the spec-review's final non-blocking nit found when constructing A7's fixture by directly overwriting the working-tree file after `git add` (rather than using `git checkout`/`git reset`, which would touch the index too and produce a fully-clean file instead) — see step 5. It aborts under the same "only `' M'` is safe" rule as every other non-safe code; no special case needed, but it's worth an explicit row since it's the code A7's real fixture actually produces.

**5. A7 (staged-only edit on a managed doc aborts) and A8 (same, on telemetry) — integration tests in `tests/run-task-ship.test.ts`.**

Per the review's non-blocking nit: construct the "staged edit, working tree back at HEAD" fixture by staging via `git add`, then overwriting the working-tree file directly with the HEAD content via `fs.writeFileSync` (not `git checkout -- <path>` or `git reset`, both of which would also reset the index and produce a fully clean file — losing the staged-only shape entirely). This produces porcelain code `'MM'` in practice, not `' M'` as an earlier draft of the amendment's prose assumed — that's fine, since Round 2's rule aborts every code except `' M'`, so the test's abort assertion holds regardless of the exact 2-character code. Don't assert an exact porcelain code string in the test; assert the abort behavior (non-zero exit, file named in the error, no `pr merge` invoked, content unchanged).

Append after the existing A2/A3 tests (end of file, after line 1232):

```ts
void test('--ship aborts a staged-only edit on a managed doc rather than silently absorbing it (A7)', () => {
    withTempDir('run-task-ship-staged-managed-', dir => {
        const taskId = 'ship-staged-managed';
        const ghLog = path.join(dir, 'gh.log');
        const { localDir, branch, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 310 },
            seedSharedDocs: { 'docs/patterns.md': '# Patterns\n\nexisting pattern\n' },
        });
        markTaskWorktree(localDir, taskId);
        const target = path.join(localDir, 'docs', 'patterns.md');
        const headContent = fs.readFileSync(target, 'utf8');
        fs.writeFileSync(target, `${headContent}staged edit\n`, 'utf8');
        gitIn(localDir, 'add', 'docs/patterns.md');
        fs.writeFileSync(target, headContent, 'utf8'); // working tree back at HEAD; index still staged

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, { FAKE_GH_LOG: ghLog });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /docs\/patterns\.md/);
        assert.ok(!fs.existsSync(ghLog) || !fs.readFileSync(ghLog, 'utf8').includes('merge'));
        assert.equal(gitIn(localDir, 'diff', '--cached', '--', 'docs/patterns.md').length > 0, true);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship aborts a staged-only edit on a telemetry file, fail-closed (A8)', () => {
    withTempDir('run-task-ship-staged-telemetry-', dir => {
        const taskId = 'ship-staged-telemetry';
        const ghLog = path.join(dir, 'gh.log');
        const { localDir, branch, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 311 },
            seedSharedDocs: { 'docs/pipeline-invocations.md': '# Pipeline Invocations\n\nexisting row\n' },
        });
        markTaskWorktree(localDir, taskId);
        const target = path.join(localDir, 'docs', 'pipeline-invocations.md');
        const headContent = fs.readFileSync(target, 'utf8');
        fs.writeFileSync(target, `${headContent}staged row\n`, 'utf8');
        gitIn(localDir, 'add', 'docs/pipeline-invocations.md');
        fs.writeFileSync(target, headContent, 'utf8');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, { FAKE_GH_LOG: ghLog });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /docs\/pipeline-invocations\.md/);
        assert.ok(!fs.existsSync(ghLog) || !fs.readFileSync(ghLog, 'utf8').includes('merge'));
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});
```

**6. A9 (working-tree deletion of a tracked shared doc aborts) — integration test.**

```ts
void test('--ship aborts a working-tree deletion of a tracked shared doc rather than silently restoring or staging it (A9)', () => {
    withTempDir('run-task-ship-deleted-doc-', dir => {
        const taskId = 'ship-deleted-doc';
        const ghLog = path.join(dir, 'gh.log');
        const { localDir, branch, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 312 },
            seedSharedDocs: { 'docs/decisions.md': '# Decisions\n\nexisting decision\n' },
        });
        markTaskWorktree(localDir, taskId);
        fs.rmSync(path.join(localDir, 'docs', 'decisions.md'));

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, { FAKE_GH_LOG: ghLog });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /docs\/decisions\.md/);
        assert.ok(!fs.existsSync(ghLog) || !fs.readFileSync(ghLog, 'utf8').includes('merge'));
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});
```

`docs/decisions.md` is used here (rather than `docs/patterns.md`, already used by other fixtures in this file) only to avoid seeding-content collisions across tests in the same suite; any `PIPELINE_MANAGED_DOCS` entry works identically for this AC.

**7. Regression check only — no new code (A4, still applies).**

Re-run AC-2, AC-3, AC-11 (Round 1's regression set) plus A2/A3 (Round 1's crash-safety set) after the steps above land — all five must still pass unmodified, since Round 2 only changes *how* dirt is detected (porcelain-gated), not the classify/backup/revert/re-append behavior once a file is classified `preserve`. If any of the five needs an edit, stop and re-examine — Round 2 isn't supposed to touch that path.

**8. Rebuild and validate.**

`scripts/run-task/main.ts` and `scripts/run-task/validation.ts` both changed, so `npm run build` must be re-run and the changed `dist/` bundle(s) committed. Full order: `npm run lint`, `npm run type-check`, `npm test` (confirm A7-A10 and the updated/added unit rows pass, and AC-2/3/11/A2/A3 still pass unmodified), `npm run build`, `npm run docs-refs-check`, `npm run sync-templates:check`.

Per A11, `docs/pipeline-orchestrator.md` and the spec's own Design/Known Risks sections are already updated in place (the spec-review record confirms this landed before final approval) — no doc edit is needed in this round; `docs-refs-check` is run only because it's in the standard validation list, not because this round touches `docs/pipeline-orchestrator.md`.

### Handoff Changes table — expected entries for this round

- `scripts/run-task/validation.ts` — widened `classifySharedDocDirtFromData` signature (porcelain-gated), widened `SharedDocEntryInput`.
- `scripts/run-task/main.ts` — `classifyAndPreserveSharedDocDirt()` detection rewritten to a batched `git status --porcelain=v1` call gated on the 2-character code.
- `tests/run-task-validation.test.ts` — updated known callers (6 call sites), 1 new defensive-fallback test, 1 new porcelain-code-sweep test.
- `tests/run-task-ship.test.ts` — 3 new integration tests (A7, A8, A9).
- `dist/cli/index.js`, `dist/scripts/run-task.js` — rebuild output (whichever changes).

### Out of scope for this round (per Amendment Round 2 Scope)

- `docs/pipeline-orchestrator.md` / `templates/docs/pipeline-orchestrator.md` — not touched this round (A11's doc updates already landed pre-approval, per the Context section above).
- The `stageArchiveChanges`/`commitArchiveChanges` seam split and the re-append call-site ordering (Round 1's A1-A6) — unaffected; Round 2 only changes upstream detection, not what happens once a file is classified `preserve`.
- Rename-aware recovery — explicitly non-goal per the spec's Round 2 "Non-Goals addition"; a rename's porcelain code is never `' M'`, so it aborts like any other unsafe state.
