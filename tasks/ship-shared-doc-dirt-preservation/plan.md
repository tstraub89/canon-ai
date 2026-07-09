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
