# Plan: fix-staged-deletion-autocommit-and-dir-refs

> Spec verdict: approved_with_nits. The one nit (Docs Impact vs. Affected Files scope
> for `docs/patterns.md`) is resolved in Step 6 below: it's a QA-phase documentation
> note, not an implement-phase edit, per Codex's spec-review interpretation. Do not
> add `docs/patterns.md` to the handoff Changes table for this task.

## Step 1 — New shared helper in `src/orchestrator/git.ts`

Add `import fs from 'node:fs';` to the top of `src/orchestrator/git.ts` (not currently
imported there; `path` and `spawnSync` already are).

Add a new exported function, near `filterGitIgnoredPaths` (both are path-classification
helpers used by staging code):

```ts
/**
 * Drops paths from `paths` that are absent from both the working tree and the
 * index — an already-staged deletion, the source side of a staged rename, or a
 * directory removed wholesale with `git rm -r`. `git add -A -- <path>` rejects
 * such a pathspec with "did not match any files" and fails the whole bulk add;
 * there is nothing left to stage for these paths because the removal is already
 * recorded. Every other path is kept, including an unstaged deletion (still in
 * the index), a `git rm --cached` file still on disk, a directory with
 * remaining tracked content, and an untracked new file.
 *
 * Batches the index check into one `git ls-files` call, but the drop/keep
 * decision is still per-path. If the batched `ls-files` call itself errors,
 * fail closed toward "keep" (return `paths` unchanged) rather than guess —
 * an incorrectly dropped path silently omits real content from the commit.
 *
 * Working-tree presence uses `lstat`, not `fs.existsSync`, so an untracked
 * broken symlink is kept, not dropped (`existsSync` follows symlinks and
 * would report `false` for a broken one).
 */
export function filterStageablePaths(paths: readonly string[], cwd: string): string[] {
    if (paths.length === 0) return [];

    const lsResult = spawnSync('git', ['ls-files', '-z', '--', ...paths], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (lsResult.error || lsResult.status !== 0) return [...paths];
    const indexedPaths = lsResult.stdout.split('\0').filter(Boolean);

    return paths.filter(candidate => {
        const normalized = candidate.endsWith('/') ? candidate.slice(0, -1) : candidate;
        const hasIndexEntry = indexedPaths.some(
            indexed => indexed === normalized || indexed.startsWith(`${normalized}/`),
        );
        if (hasIndexEntry) return true;
        try {
            fs.lstatSync(path.join(cwd, candidate));
            return true;
        } catch {
            return false;
        }
    });
}
```

Why this shape covers every AC-6 pinned case:
- Staged deletion (`git rm x`): `x` has no index entry (removed) and no working-tree
  entry (removed) → dropped.
- Staged rename source/dest (`git mv old new`): `old` has no index entry and no
  disk entry → dropped. `new` has a disk entry → kept, regardless of index state.
- Directory removed with `git rm -r dir`: no index entries under `dir/` and the
  directory itself is gone from disk → dropped.
- Directory with remaining tracked content: the directory still exists on disk
  (lstat succeeds) → kept, independent of the index check.
- Unstaged deletion (plain `rm x`, x still tracked): no disk entry, but `x` is
  still in the index → kept.
- `git rm --cached x` (index entry gone, file still on disk): lstat succeeds →
  kept.
- Modified / untracked new file: on disk → kept.

## Step 2 — `autoCommitCode` in `src/orchestrator/main.ts`

Export the function (currently `function autoCommitCode(...)`, not exported —
needed as the test seam for Step 5's real-git tests):

```ts
export function autoCommitCode(taskIds: string[], cwd = REPO_ROOT): void {
```

Leave the `settledDeletions` computation (~lines 485–508, the pre-stage "missing"
check) untouched — it still decides whether a handoff path absent from the
working tree is acceptable because a commit on this branch already touched it.

Replace the staging block (~lines 546–554):

```ts
    const stageable = handoffFiles.filter(f => !settledDeletions.has(f));
    if (stageable.length === 0) {
        verifyHandoffFilesCommitted(taskIds, cwd, handoffFiles);
        splitCli.info('All handoff files are already settled in history — skipping auto-commit.');
        return;
    }
    const addResult = splitGit.gitSafeAt(cwd, 'add', '-A', '--', ...stageable);
    if (!addResult.ok) die(`Failed to stage files: ${addResult.stderr || 'unknown error'}`);
```

with:

```ts
    const stageable = splitGit.filterStageablePaths(handoffFiles, cwd);
    if (stageable.length > 0) {
        const addResult = splitGit.gitSafeAt(cwd, 'add', '-A', '--', ...stageable);
        if (!addResult.ok) die(`Failed to stage files: ${addResult.stderr || 'unknown error'}`);
    }
```

No early return: when `stageable` is empty (the deletion-only case, AC-1), the
function must fall through into the existing post-stage checks
(`preCheck`/`remaining`/`stagedAfter`/commit) so the already-staged removal gets
committed. `findUncoveredTrackedChanges` and `findStagedFilesOutsideHandoff`
already treat any path present in `allHandoffFiles` as covered/expected, so a
staged-but-not-re-added deletion doesn't trip either check (verified by reading
`src/orchestrator/validation.ts:733` and `:747` — both key off `handoffFiles`
membership, not off whether `git add` was just called).

This makes `grep -c "already settled in history" src/orchestrator/main.ts` print
`0` (AC-7). `settledDeletions` itself stays declared and populated — it's still
read at the pre-stage "missing" check — so no unused-variable lint issue.

## Step 3 — `commitQaArtifacts` in `src/orchestrator/main.ts` (~line 950)

Insert a filter call before the per-path add loop:

```ts
    const stageableStagePaths = splitGit.filterStageablePaths([...stagePaths], cwd);
    for (const relPath of stageableStagePaths) {
        const exclusions = nodeModulesExclusionArgs(relPath, exemptNodeModulesPaths);
        const addResult = gitSafeAt(cwd, 'add', '-A', '--', relPath, ...exclusions);
        if (!addResult.ok) {
            die(`QA-end commit aborted: failed to stage ${relPath}: ${addResult.stderr || 'unknown error'}`);
        }
    }
```

`stagePaths` is a `Set<string>` built by `buildHumanReviewStagePaths` — spread it
before passing to the helper.

## Step 4 — `commitHumanReviewFiles` in `src/orchestrator/main.ts` (~line 1413)

Same change, same pattern. Leave the `affectedManagedDocs.has(relPath)` WARNING
loop (~lines 1378–1385) iterating over the **unfiltered** `stagePaths` — it's
informational only, not a git operation, and a managed doc that's a staged
deletion still deserves the warning.

```ts
    const stageableStagePaths = splitGit.filterStageablePaths([...stagePaths], cwd);
    for (const relPath of stageableStagePaths) {
        const exclusions = nodeModulesExclusionArgs(relPath, exemptNodeModulesPaths);
        const addResult = gitSafeAt(cwd, 'add', '-A', '--', relPath, ...exclusions);
        if (!addResult.ok) {
            die(`Human review commit aborted: failed to stage ${relPath}: ${addResult.stderr || 'unknown error'}`);
        }
    }
```

## Step 5 — Tests in `tests/run-task-safety.test.ts` (AC-1 to AC-5)

Add a helper next to `runCommitQaArtifactsInline` (~line 1253), which already
establishes the "import main.ts in a subprocess, call the exported function
directly with an explicit `cwd`" pattern used for functions that can call
`die()` → `process.exit(1)` (unsafe to call in-process — it would kill the test
runner):

```ts
function runAutoCommitCodeInline(taskId: string, cwd: string): { status: number | null; stderr: string; stdout: string } {
    return runNodeInline([
        `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
        `.then(m => { m.autoCommitCode([${JSON.stringify(taskId)}], ${JSON.stringify(cwd)}); })`,
        `.catch(err => { console.error(err); process.exit(1); });`,
    ].join('\n'), childEnvWithoutTasksOverride(), cwd);
}
```

Important: do **not** drive these through `checkAndRoute('implement', ...)`.
`checkAndRoute` revalidates implement evidence via `checkImplementEvidence`
before dispatching to `autoCommitCode` (see the existing tests around line 7344
and line 7495), and that revalidation only recognizes an unstaged deletion
(`git ls-files --deleted`) or an already-committed deletion (`base...HEAD`
diff) as valid evidence — not a staged-but-uncommitted deletion, which is
exactly AC-1's fixture. Driving through `checkAndRoute` would fail on an
unrelated gate before ever reaching the code this task changes. Call
`autoCommitCode` directly instead — it's the narrower, correct seam.

Reuse the existing `makeGitFixture`, `writeTaskStatus`, `makeCompleteStatus`,
and `writeImplementEvidenceFixture` helpers already in this file (the last one
is exactly the fixture the existing "checkAndRoute honors deletion-only
implement evidence" test at line ~7495 uses — same shape, different call path).
`writeImplementEvidenceFixture`'s hardcoded `spec.md` Affected Files content
(`package.json`) is inert for these tests: `autoCommitCode` never reads
`spec.md`; only `validateHandoffAgainstSpec` (a different, unrelated gate) does,
and that checks Validation Required vs. Validation Outcomes, not Affected Files
vs. Changes. No spec.md customization needed.

### AC-1 — staged deletion only (red-first)

```ts
void test('autoCommitCode commits an already-staged deletion instead of failing the bulk add', () => {
    withTempDir('run-task-autocommit-staged-deletion-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'task-a';
        const tasksRoot = path.join(localDir, 'tasks');

        fs.writeFileSync(path.join(localDir, 'dead.ts'), 'export const dead = true;\n', 'utf8');
        gitIn(localDir, 'add', 'dead.ts');
        gitIn(localDir, 'commit', '-m', 'add dead.ts');
        gitIn(localDir, 'rm', 'dead.ts');

        writeImplementEvidenceFixture(tasksRoot, taskId, ['`dead.ts`']);
        writeTaskStatus(tasksRoot, taskId, makeCompleteStatus(taskId, ''));

        const result = runAutoCommitCodeInline(taskId, localDir);
        assert.equal(result.status, 0, result.stderr);

        const status = execFileSync('git', ['status', '--porcelain=v1', '-uall'], { cwd: localDir, encoding: 'utf8' });
        assert.equal(status, '');
        const nameStatus = execFileSync(
            'git', ['show', '--name-status', '--pretty=format:', 'HEAD'], { cwd: localDir, encoding: 'utf8' },
        ).trim();
        assert.equal(nameStatus, 'D\tdead.ts');
    });
});
```

Confirm red-first by running this test against pre-fix code first: `result.status`
is non-zero and `result.stderr` matches `/pathspec .*did not match any files/`.
Record both the pre-fix failure text and the post-fix pass in the handoff's
Validation Outcomes notes (AC-10).

### AC-2 — staged deletion alongside an edit

Same fixture, plus a second tracked file edited (not staged) before the call:

```ts
fs.writeFileSync(path.join(localDir, 'keep.ts'), 'export const keep = 1;\n', 'utf8');
gitIn(localDir, 'add', 'keep.ts');
gitIn(localDir, 'commit', '-m', 'add keep.ts');
fs.writeFileSync(path.join(localDir, 'keep.ts'), 'export const keep = 2;\n', 'utf8');
// ...git rm dead.ts as above...
writeImplementEvidenceFixture(tasksRoot, taskId, ['`dead.ts`', '`keep.ts`']);
```

Assert one new commit whose `git show --name-status` contains both `D\tdead.ts`
and `M\tkeep.ts` (order-independent — split on `\n` and compare as a set).

### AC-3 — staged rename

```ts
fs.writeFileSync(path.join(localDir, 'keep.ts'), 'export const keep = 1;\n', 'utf8');
gitIn(localDir, 'add', 'keep.ts');
gitIn(localDir, 'commit', '-m', 'add keep.ts');
gitIn(localDir, 'mv', 'keep.ts', 'moved.ts');
writeImplementEvidenceFixture(tasksRoot, taskId, ['`keep.ts`', '`moved.ts`']);
```

Assert (post-fix): `result.status === 0`; `git ls-tree -r HEAD --name-only`
does not contain `keep.ts` and does contain `moved.ts`.

### AC-4 — unstaged deletion (regression guard, not red-first)

```ts
fs.writeFileSync(path.join(localDir, 'dead.ts'), 'export const dead = true;\n', 'utf8');
gitIn(localDir, 'add', 'dead.ts');
gitIn(localDir, 'commit', '-m', 'add dead.ts');
fs.rmSync(path.join(localDir, 'dead.ts'));   // plain rm, not `git rm` — stays in the index
writeImplementEvidenceFixture(tasksRoot, taskId, ['`dead.ts`']);
```

Assert `result.status === 0` and `git show --name-status HEAD` contains
`D\tdead.ts`, both before and after the fix (this path already worked; it's
here to pin that the new helper doesn't regress it).

### AC-5 — QA-end commit, red-first

Use the existing `writeQaArtifacts` and `runCommitQaArtifactsInline` helpers
(already in this file, ~lines 1245 and 1253) with a real telemetry-file
deletion:

```ts
void test('commitQaArtifacts commits a staged deletion of a telemetry file', () => {
    withTempDir('run-task-qa-end-staged-deletion-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'task-a';

        fs.mkdirSync(path.join(localDir, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), 'telemetry\n', 'utf8');
        gitIn(localDir, 'add', 'docs/pipeline-invocations.md');
        gitIn(localDir, 'commit', '-m', 'add telemetry file');
        gitIn(localDir, 'rm', 'docs/pipeline-invocations.md');

        writeQaArtifacts(localDir, taskId);

        const result = runCommitQaArtifactsInline(taskId, localDir);
        assert.equal(result.status, 0, result.stderr);

        const status = execFileSync('git', ['status', '--porcelain=v1', '-uall'], { cwd: localDir, encoding: 'utf8' });
        assert.equal(status, '');
        const nameStatus = execFileSync('git', ['show', '--name-status', '--pretty=format:', 'HEAD'], { cwd: localDir, encoding: 'utf8' });
        assert.match(nameStatus, /(?:^|\n)D\tdocs\/pipeline-invocations\.md(?:\n|$)/);
    });
});
```

Pre-fix, `result.status` is non-zero and `result.stderr` matches
`/failed to stage docs\/pipeline-invocations\.md/`.

## Step 6 — Helper unit tests in `tests/run-task-validation.test.ts` (AC-6)

Add `filterStageablePaths` to the existing `from '../src/orchestrator/git.js'`
import (currently only `parseNameStatusOutput`). Use `execFileSync('git', ...)`
directly against a `withTempDir`-created real repo (this file already has both
`withTempDir` at line 70 and `execFileSync` imported at line 3).

Cover every case enumerated in Step 1's helper doc comment: staged deletion
dropped; staged rename source dropped and destination kept; a directory
removed with `git rm -r` dropped; a directory that still has a tracked file
kept; an unstaged deletion kept; a `git rm --cached` file still on disk kept; a
modified file kept; an untracked new file kept. One `git init` fixture can back
several of these `void test(...)` blocks, or combine related cases into one
test with several assertions — match this file's existing granularity (most
tests here assert one behavior each).

## Step 7 — `scripts/docs-refs-check.mjs` (AC-8)

The plain backtick-ref pass (~lines 761–776 — matches `` `target` `` not
followed by `` in ` `` or `` §" ``, i.e. distinct from the "symbol in path"
pass at ~778 and the section-ref/anchor-link passes below it) currently gates
on file-only:

```js
const targetPath = resolveRepoRelative(repoRoot, target);
if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    addFinding(sourceFile, lineNumber, refText, 'missing file');
}
```

Change to accept an existing directory too:

```js
const targetPath = resolveRepoRelative(repoRoot, target);
const targetExists = fs.existsSync(targetPath)
    && (fs.statSync(targetPath).isFile() || fs.statSync(targetPath).isDirectory());
if (!targetExists) {
    addFinding(sourceFile, lineNumber, refText, 'missing file');
}
```

Do **not** touch the other three `isFile()` gates in this function (the
"symbol in path" pass ~789, the section-ref candidate resolution ~817, the
anchor-link pass ~889) — per the spec's Decision 3 and Non-Goals, only the
plain backtick-ref pass changes. Trailing-slash refs are already skipped
earlier by `isPlaceholderTarget` and need no change.

Then copy the file to `templates/scripts/docs-refs-check.mjs` (or run
`npm run sync-templates`, which regenerates every `CANON_OWNED` mirror
including this one) so AC-9's `npm run sync-templates:check` passes.

## Step 8 — Tests in `tests/docs-refs-check.test.ts` (AC-8)

Follow the existing `makeTempRepo` / `writeFile` / `runChecks` pattern (see
`backtick file-path refs: existing path passes` at line 55). Three cases:

```ts
void test('backtick file-path refs: existing directory without trailing slash passes', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/backtick-dir.md', 'See `scripts/fixture-dir`.\n');
            writeFile(root, 'scripts/fixture-dir/placeholder.ts', 'export const x = 1;\n');
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});

void test('backtick file-path refs: missing directory still fails', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/backtick-missing-dir.md', 'See `scripts/no-such-dir`.\n');
        },
        root => {
            assert.deepEqual(runChecks(root), [
                { file: 'docs/backtick-missing-dir.md', line: 1, ref: '`scripts/no-such-dir`', reason: 'missing file' },
            ]);
        },
    );
});

void test('symbol-in-file refs: an existing directory as the carrier still fails (file-only)', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/symbol-dir.md', 'See `fixtureSymbol` in `scripts/fixture-dir`.\n');
            writeFile(root, 'scripts/fixture-dir/placeholder.ts', 'export const fixtureSymbol = 1;\n');
        },
        root => {
            assert.deepEqual(runChecks(root), [
                { file: 'docs/symbol-dir.md', line: 1, ref: '`fixtureSymbol` in `scripts/fixture-dir`', reason: 'missing file' },
            ]);
        },
    );
});
```

Run the first test against pre-fix code to confirm it's red-first (fails with
`reason: 'missing file'` today); the other two must already pass unchanged
(they pin the boundary — a genuinely missing directory, and the sibling pass
that must stay file-only).

## Step 9 — Docs, validation, build

- `docs/patterns.md`: append one sentence to the "Use `--name-status`, not
  `--name-only`" pitfall area, or add a short new pitfall entry, noting that
  all three staging call sites now route through `filterStageablePaths` so a
  path removed through the index never reaches `git add`. This is a QA-phase
  documentation note per the spec-review nit — do **not** add it to the
  handoff's Changes table; it's not part of this task's Affected Files.
- Run in order: `npm run lint`, `npm run type-check`, `npm test`, `npm run
  build` (commit the resulting `dist/` changes — `dist/orchestrator/run-task.js`
  and `dist/cli/index.js` per the spec's Affected Files), `npm run
  docs-refs-check`, `npm run sync-templates:check`.
- Confirm `npm test` reports none of this task's new tests as skipped (AC-10).
  These fixtures are real temp-dir git repos, not gated on `gitDirWritable` or
  any probe of the canon-ai checkout's own `.git` — if the sandbox can't create
  temp git repos at all, that's a blocker to report, not something to skip
  around.
