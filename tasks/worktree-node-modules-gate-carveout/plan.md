# Implementation Plan: worktree-node-modules-gate-carveout

> Written by: Claude | Implements: `tasks/worktree-node-modules-gate-carveout/spec.md`
> Spec verdict: approved (no nits)

## Approach

One shared, pure decision-table classifier in `scripts/run-task/worktree.ts`, colocated
with the symlink-creation code it also protects. Both commit gates in `main.ts` filter
their `dirtyEntries` through an fs-probe wrapper around that classifier; `ensureWorktree()`
uses the same wrapper for its idempotent setup guard. No staging-path changes anywhere —
the exemption is purely about which porcelain entries count as "dirty," never about what
gets `git add`ed. This keeps the fix to three small, well-scoped edits (one new
pure+probe pair, two call-site filters, one setup-guard rewrite) instead of duplicating
symlink-verification logic at each call site.

## Steps

### Step 1: Pure classifier + fs-probe wrapper

Files: `scripts/run-task/worktree.ts`

Add directly above `ensureWorktree()` (after `findExistingWorktreeForBranch`, currently
ending at line 88):

```ts
export type NodeModulesLstatKind = 'missing' | 'file' | 'directory' | 'symlink' | 'error';

export type NodeModulesLinkInputs = {
    lstatKind: NodeModulesLstatKind;
    resolvedTarget: string | null;
    expectedTarget: string | null;
};

/**
 * Pure decision table (no fs/git access): a `node_modules` entry is the
 * verified canon symlink only when lstat confirms it is a symlink AND both
 * sides resolve to the same real path. Any other lstat kind, or any probe
 * failure represented as `null` (readlink/realpath threw), fails closed to
 * 'not-exempt' — never silently exempt a foreign file, directory,
 * wrong-target symlink, or unreadable path.
 */
export function classifyNodeModulesLinkFromData(input: NodeModulesLinkInputs): 'verified-symlink' | 'not-exempt' {
    if (input.lstatKind !== 'symlink') return 'not-exempt';
    if (input.resolvedTarget === null || input.expectedTarget === null) return 'not-exempt';
    return input.resolvedTarget === input.expectedTarget ? 'verified-symlink' : 'not-exempt';
}

function probeNodeModulesLstatKind(candidatePath: string): NodeModulesLstatKind {
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(candidatePath);
    } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'error';
    }
    if (stat.isSymbolicLink()) return 'symlink';
    if (stat.isDirectory()) return 'directory';
    return 'file';
}

function realpathOrNull(candidatePath: string): string | null {
    try {
        return fs.realpathSync(candidatePath);
    } catch {
        return null;
    }
}

/**
 * fs-probe wrapper, colocated with the symlink creation it protects.
 * `repoRoot` must always be the supervising checkout (REPO_ROOT), even when
 * `candidatePath` is inside an active worktree — this is the deliberate
 * exception to the "use the active checkout, not REPO_ROOT" worktree rule
 * in docs/patterns.md, not a violation of it: the root install genuinely
 * lives at REPO_ROOT.
 */
export function probeNodeModulesEntry(
    candidatePath: string,
    repoRoot: string,
): { verdict: 'verified-symlink' | 'not-exempt'; lstatKind: NodeModulesLstatKind; resolvedTarget: string | null } {
    const lstatKind = probeNodeModulesLstatKind(candidatePath);
    const resolvedTarget = lstatKind === 'symlink' ? realpathOrNull(candidatePath) : null;
    const expectedTarget = realpathOrNull(path.join(repoRoot, 'node_modules'));
    const verdict = classifyNodeModulesLinkFromData({ lstatKind, resolvedTarget, expectedTarget });
    return { verdict, lstatKind, resolvedTarget };
}
```

`classifyNodeModulesLinkFromData` is the AC-8 seam: no fs, no git, pure data in/out, full
decision table testable in isolation (this is the `*FromData` pattern from
`docs/patterns.md` §Validation Gate Discipline — see `classifySharedDocDirtFromData` in
`validation.ts` for the closest existing precedent). `probeNodeModulesEntry` is the only
place that touches the filesystem; both `main.ts`'s gates and `worktree.ts`'s own
`ensureWorktree()` call it. `fs`, `path`, `REPO_ROOT`, and `die` are already imported at
the top of `worktree.ts` — no new imports needed for this file.

### Step 2: `ensureWorktree()` idempotent setup guard (AC-7)

Files: `scripts/run-task/worktree.ts`

Replace the current symlink block (currently lines 126–130):

```ts
    const wtModules = path.join(wt, 'node_modules');
    if (fs.existsSync(repoPackageJson) && !fs.existsSync(wtModules)) {
        fs.symlinkSync(repoModulesSrc, wtModules);
        info('Symlinked node_modules into worktree.');
    }
```

with:

```ts
    const wtModules = path.join(wt, 'node_modules');
    if (fs.existsSync(repoPackageJson)) {
        const probe = probeNodeModulesEntry(wtModules, REPO_ROOT);
        switch (probe.lstatKind) {
            case 'missing':
                fs.symlinkSync(repoModulesSrc, wtModules);
                info('Symlinked node_modules into worktree.');
                break;
            case 'symlink':
                if (probe.verdict === 'not-exempt') {
                    die(
                        `Worktree setup aborted: ${wtModules} is a symlink but does not resolve to ` +
                        `${repoModulesSrc} (found: ${probe.resolvedTarget ?? 'unresolvable target'}). ` +
                        `Remove or fix the stray symlink before retrying.`
                    );
                }
                // verified-symlink: already correctly linked from a prior run — no-op.
                break;
            case 'file':
            case 'directory':
                // A real adopter-installed node_modules is legitimate — never clobber it.
                break;
            case 'error':
                die(`Worktree setup aborted: could not inspect ${wtModules} (lstat failed).`);
                break;
        }
    }
```

This covers AC-7(a)–(d): missing → create; verified symlink → no-op (no `EEXIST`, unlike
today's `fs.existsSync`-based guard on a dangling symlink); real dir/file → skip silently
(today's behavior preserved); wrong-target symlink → explicit fail-closed `die()` naming
the path and the found target. `case 'error'` also fails closed (not explicitly required
by AC-7, but consistent with the "write-safety guards fail closed" pitfall in
`docs/patterns.md`).

### Step 3: `commitQaArtifacts()` in `main.ts` (AC-1)

Files: `scripts/run-task/main.ts`

Add a helper near `humanReviewAllowedPath()` (around line 700):

```ts
function isExemptNodeModulesEntry(entry: PorcelainEntry, cwd: string): boolean {
    if (entry.paths.length !== 1 || entry.paths[0] !== 'node_modules') return false;
    return splitWorktree.probeNodeModulesEntry(path.join(cwd, 'node_modules'), REPO_ROOT).verdict === 'verified-symlink';
}
```

`entry.paths.length !== 1` excludes rename pairs — the exemption is exact-path-only per
AC-3. `main.ts` already imports `* as splitWorktree from './worktree.js'`, has a
module-level `PorcelainEntry` type alias (line 51), and a `REPO_ROOT` constant (line 28) —
no new imports needed.

Then change the `unexpected` filter inside `commitQaArtifacts()` (currently lines 825–827):

```ts
    const unexpected = dirtyEntries.filter(entry =>
        !entry.paths.every(filePath => humanReviewAllowedPath(taskIds, affectedManagedDocs, filePath))
    );
```

to:

```ts
    const unexpected = dirtyEntries.filter(entry =>
        !isExemptNodeModulesEntry(entry, cwd) &&
        !entry.paths.every(filePath => humanReviewAllowedPath(taskIds, affectedManagedDocs, filePath))
    );
```

Nothing else in `commitQaArtifacts()` changes. Per the spec's Interaction Dependencies
note, this gate's no-stage case is a graceful `return` (line 838), not a `die`, and QA-end
always has task artifacts to stage — filtering only at this one classification point is
sufficient here (unlike Step 4).

### Step 4: `commitHumanReviewFiles()` in `main.ts` (AC-2)

Files: `scripts/run-task/main.ts`

This is the load-bearing change per the spec: the exemption must apply **upstream** of
three decisions, not just the allowlist filter, or a symlink-only tree trades today's
"outside the allowlist" abort for a "no allowed dirty files found to stage" abort.

Change the `dirtyEntries` assignment (currently line 1213):

```ts
    const dirtyEntries = splitGit.parsePorcelainEntries(dirtyResult.stdout);
```

to:

```ts
    const dirtyEntries = splitGit.parsePorcelainEntries(dirtyResult.stdout)
        .filter(entry => !isExemptNodeModulesEntry(entry, cwd));
```

This single change is sufficient: the filtered `dirtyEntries` feeds the clean-tree
push/PR retry check (line 1220, `dirtyEntries.length === 0`), the no-dirty `die` (line
1249), the `unexpected` allowlist filter (line 1253, which now never even sees the
symlink entry), and `buildHumanReviewStagePaths()` / the no-stage `die` (line 1279). A
tree dirty only because of the verified symlink now has `dirtyEntries.length === 0` after
filtering, so it takes the existing clean-tree push/PR-retry branch at line 1220 — exactly
the behavior the spec requires.

**Do not** instead patch only line 1253 in isolation — that is the exact trap the spec's
Known Risks section calls out: it fixes the allowlist message but leaves the no-stage
`die` at line 1279 wedged with a different error on a symlink-only tree.

No changes to `buildHumanReviewStagePaths()`, staging, or the pre/post staged-set guards —
`node_modules` was never a stage-able path and stays that way (AC-6 requires this to
remain true; it already holds structurally, since that function only ever adds
`tasks/<id>`, `PIPELINE_TELEMETRY_FILES` entries, affected managed docs, and affected
directory prefixes to its output set).

### Step 5: Tests

Files: `tests/run-task-safety.test.ts`

Add `probeNodeModulesEntry` and `classifyNodeModulesLinkFromData` to the existing
`worktree.js` import (currently `import { PIPELINE_MANAGED_DOCS } from '../scripts/run-task/worktree.js';`, around line 25) for the AC-4/AC-8 pure unit tests. Most other tests
below drive the gates end-to-end and don't need this import.

#### Shared fixture shape (AC-1, AC-2, AC-3, AC-5, AC-6, AC-7)

These ACs all need a **real linked git worktree**, because `REPO_ROOT` resolves via `git
rev-parse --git-common-dir` from whatever directory the code runs in (see `env.ts`
`resolveRepoRoot()`) — a plain fixture directory with no worktree relationship to a
"supervising checkout" can't reproduce the REPO_ROOT-vs-worktree split the bug depends on.
Build on `makeGitFixture()` (already in this file) plus `CANON_WORKTREES_ROOT`, the same
override `runShipTask()` already uses (see the `main --ship ... worktree: true` test,
around line 2293) so `resolveTaskCwd()` / `getActiveCwd()` find the worktree via the fast
`worktreesRoot/<taskId>` existence check, without depending on the `findExistingWorktreeForBranch` fallback.

Add a shared helper:

```ts
function makeNodeModulesGateFixture(
    dir: string,
    taskId: string,
    gitignoreRule: string | null, // e.g. 'node_modules/\n', 'node_modules\n', or null for no rule
): { localDir: string; originDir: string; worktreesRoot: string; worktreeDir: string; branch: string; repoModulesFixture: string } {
    const { localDir, originDir } = makeGitFixture(dir);
    fs.writeFileSync(path.join(localDir, 'package.json'), '{"name":"fixture"}\n', 'utf8');
    if (gitignoreRule !== null) {
        fs.writeFileSync(path.join(localDir, '.gitignore'), gitignoreRule, 'utf8');
        gitIn(localDir, 'add', '.gitignore', 'package.json');
    } else {
        gitIn(localDir, 'add', 'package.json');
    }
    gitIn(localDir, 'commit', '-m', 'fixture setup');
    gitIn(localDir, 'push', 'origin', 'main');

    const repoModulesFixture = path.join(localDir, 'node_modules');
    fs.mkdirSync(repoModulesFixture, { recursive: true });
    fs.writeFileSync(path.join(repoModulesFixture, 'marker.txt'), 'root install\n', 'utf8');

    const branch = `task/${taskId}`;
    const worktreesRoot = path.join(dir, 'worktrees');
    const worktreeDir = path.join(worktreesRoot, taskId);
    fs.mkdirSync(worktreesRoot, { recursive: true });
    gitIn(localDir, 'worktree', 'add', worktreeDir, '-b', branch);

    return { localDir, originDir, worktreesRoot, worktreeDir, branch, repoModulesFixture };
}
```

(`package.json` is committed into the fixture so `ensureWorktree()`'s
`fs.existsSync(repoPackageJson)` guard engages in the AC-7 tests; it's harmless for the
other ACs, which call the commit gates directly, not `ensureWorktree()`.)

The whole fixture directory (`dir`) is discarded by `withTempDir`'s `rmSync` at the end of
each test — no explicit `git worktree remove` is required for cleanup.

#### AC-1 (red-first QA-end regression)

```ts
void test('commitQaArtifacts exempts the verified node_modules worktree symlink', () => {
    withTempDir('run-task-nm-qa-end-', dir => {
        const { worktreeDir, repoModulesFixture } = makeNodeModulesGateFixture(dir, 'task-a', 'node_modules/\n');
        fs.symlinkSync(repoModulesFixture, path.join(worktreeDir, 'node_modules'));
        writeQaArtifacts(worktreeDir, 'task-a');

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'scripts/run-task/main.ts')).href)})`,
            `.then(m => { m.commitQaArtifacts(['task-a'], ${JSON.stringify(worktreeDir)}); })`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride(), worktreeDir);
        assert.equal(result.status, 0, result.stderr);

        const status = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.equal(status, '?? node_modules\n'); // AC-6: still dirty, never staged
        const subject = execFileSync('git', ['log', '-1', '--pretty=%s'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        }).trim();
        assert.equal(subject, 'chore: QA artifacts for task-a');
    });
});
```

Note this test runs `commitQaArtifacts` inside a **subprocess** whose own `process.cwd()`
is `worktreeDir`, unlike the existing direct in-process `commitQaArtifacts commits task
artifacts...` test (~line 1381). That existing test can stay direct because it never
depends on `REPO_ROOT`; this one must, because `REPO_ROOT` needs to resolve to the
*fixture's* `localDir`, not the real canon-ai-dev repo the test runner itself lives in.
Follow the `runNodeInline(..., worktreeDir)` + absolute-URL-import pattern already used by
the `setupDivergentBaseRepo` / `main --push blocks...` test (~line 2637).

**Red-first**: before landing Steps 1–4, run this test against the pre-fix code and record
in the handoff that it fails with "QA-end commit aborted: working tree has dirty files
outside the QA-end allowlist" naming `?? node_modules`. After Steps 1–4 land, it must pass.

#### AC-2 (human-review boundary — symlink-only tree proceeds)

Build the same fixture, but commit the task artifacts into the worktree branch *first*
(simulating "QA-end already committed") so the working tree is dirty **only** because of
the symlink, then drive `main()` with `--push`:

```ts
void test('commitHumanReviewFiles pushes a tree dirty only with the verified node_modules symlink', () => {
    withTempDir('run-task-nm-human-review-', dir => {
        const { worktreesRoot, worktreeDir, branch, repoModulesFixture } =
            makeNodeModulesGateFixture(dir, 'task-a', 'node_modules/\n');

        const status = { ...makeHumanReviewPendingStatus('task-a', branch), worktree: true };
        writeTaskStatus(path.join(worktreeDir, 'tasks'), 'task-a', status);
        writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), 'task-a', []);
        gitIn(worktreeDir, 'add', 'tasks');
        gitIn(worktreeDir, 'commit', '-m', 'qa artifacts');

        fs.symlinkSync(repoModulesFixture, path.join(worktreeDir, 'node_modules'));

        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'scripts/run-task/main.ts')).href)})`,
            `.then(m => {`,
            `  process.argv = ['node', 'canon', 'task-a', '--push'];`,
            `  return m.main();`,
            `})`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }), worktreeDir);

        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(result.stderr, /outside the human_review allowlist/);
        assert.doesNotMatch(result.stderr, /no allowed dirty files found to stage/);

        const remoteRef = execFileSync('git', ['ls-remote', 'origin', branch], {
            cwd: worktreeDir,
            encoding: 'utf8',
        }).trim();
        assert.ok(remoteRef.length > 0, 'branch was not pushed to origin');
    });
});
```

Implementation notes:
- `main()` is used deliberately instead of calling `commitHumanReviewFiles()` directly, per
  the `docs/patterns.md` pitfall — `commitHumanReviewFiles()` reads module-level `cliArgs`,
  which only `parseArgs()` (invoked from `main()`) populates with `push: true`.
- `makeHumanReviewPendingStatus()` already exists in this file; override `worktree: true`
  (it defaults to `false` via `makeCompleteStatus()`).
- `base_branch: 'main'` (inherited from `makeCompleteStatus`) matches the fixture's
  default branch.
- `--push` (not `--pr`) avoids needing a `gh` stub, per the spec's AC-2 guidance.

**Red-first**: run this against pre-fix code first; it must fail at the no-stage-paths
`die` ("no allowed dirty files found to stage"), not the allowlist message — record this in
the handoff. That specific failure mode is what proves the upstream-filter fix in Step 4
is necessary, not just a Step-3-style filter at the allowlist check alone.

#### AC-3 (negative cases still block, exact-path only)

Three variations on the AC-1 fixture, each asserting the existing `die()` still fires
(drive via the same subprocess `commitQaArtifacts` pattern as AC-1):

- **(a) regular file**: `fs.writeFileSync(path.join(worktreeDir, 'node_modules'), 'not a symlink\n')` instead of `fs.symlinkSync(...)`. Use `'node_modules/\n'` (a plain file isn't matched by a directory-only ignore rule, so it shows as `?? node_modules`).
- **(b) real directory**: build with `gitignoreRule: null` (no rule at all — required so the directory isn't hidden from porcelain), then `fs.mkdirSync(path.join(worktreeDir, 'node_modules')); fs.writeFileSync(path.join(worktreeDir, 'node_modules', 'pkg.json'), '{}\n')`. **Note for implementer**: with `-uall`, git reports the *contents* of an untracked directory individually (`?? node_modules/pkg.json`), not the bare directory name — so this porcelain entry never even reaches the new exact-path predicate (`entry.paths[0] === 'node_modules'` is false for `'node_modules/pkg.json'`); it's blocked by the pre-existing allowlist logic exactly as before. This test is a regression guard confirming that unchanged behavior, not a test that exercises the new classifier — don't spend time trying to force git to report a bare `node_modules` path for a real directory under `-uall`, it won't.
- **(c) wrong-target symlink**: `fs.symlinkSync(path.join(dir, 'somewhere-else'), path.join(worktreeDir, 'node_modules'))` where `somewhere-else` is an unrelated fixture directory (create it with `fs.mkdirSync`).

Each asserts `result.status !== 0` and stderr matches `/outside the QA-end allowlist/`.

#### AC-4 (fail closed on probe error) + AC-8 (full decision table) — pure unit tests

```ts
void test('classifyNodeModulesLinkFromData decision table', () => {
    const expected = '/repo/node_modules';
    assert.equal(classifyNodeModulesLinkFromData({ lstatKind: 'symlink', resolvedTarget: expected, expectedTarget: expected }), 'verified-symlink');
    assert.equal(classifyNodeModulesLinkFromData({ lstatKind: 'file', resolvedTarget: null, expectedTarget: expected }), 'not-exempt');
    assert.equal(classifyNodeModulesLinkFromData({ lstatKind: 'directory', resolvedTarget: null, expectedTarget: expected }), 'not-exempt');
    assert.equal(classifyNodeModulesLinkFromData({ lstatKind: 'symlink', resolvedTarget: '/other/node_modules', expectedTarget: expected }), 'not-exempt');
    assert.equal(classifyNodeModulesLinkFromData({ lstatKind: 'missing', resolvedTarget: null, expectedTarget: expected }), 'not-exempt');
});

void test('classifyNodeModulesLinkFromData fails closed on a probe error (AC-4)', () => {
    assert.equal(
        classifyNodeModulesLinkFromData({ lstatKind: 'error', resolvedTarget: null, expectedTarget: '/repo/node_modules' }),
        'not-exempt',
    );
    // Probe error on the *target* resolution side (symlink lstat succeeded, realpath of
    // either side failed) must also fail closed:
    assert.equal(
        classifyNodeModulesLinkFromData({ lstatKind: 'symlink', resolvedTarget: null, expectedTarget: '/repo/node_modules' }),
        'not-exempt',
    );
});
```

Together these two tests cover AC-8's full decision table (verified symlink / file /
directory / wrong-target symlink / probe error) and AC-4 explicitly.

#### AC-5 (both ignore styles, no vacuous pass)

```ts
void test('bare node_modules gitignore rule hides the symlink from porcelain entirely', () => {
    withTempDir('run-task-nm-noslash-', dir => {
        const { worktreeDir, repoModulesFixture } = makeNodeModulesGateFixture(dir, 'task-a', 'node_modules\n');
        fs.symlinkSync(repoModulesFixture, path.join(worktreeDir, 'node_modules'));

        const status = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.doesNotMatch(status, /node_modules/);
    });
});
```

No gate call needed — this only pins down git's own ignore semantics, guarding against a
future fixture accidentally using canon-ai's own no-slash style and passing vacuously (the
trap flagged in the spec's Known Risks).

#### AC-6 (symlink never staged)

Two parts:

1. Extend the AC-1 test with a `git ls-tree` assertion that the commit's tree doesn't
   contain `node_modules`:
   ```ts
   const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--name-only'], { cwd: worktreeDir, encoding: 'utf8' });
   assert.doesNotMatch(tree, /node_modules/);
   ```
   (AC-1's `status` assertion of `'?? node_modules\n'` already covers "working tree still
   shows `?? node_modules` afterward.")
2. Add a case to the existing `buildHumanReviewStagePaths` test block (~line 1286),
   mixing a `{ raw: '?? node_modules', indexStatus: '?', worktreeStatus: '?', paths: ['node_modules'] }` entry into the input, and assert `'node_modules'` is absent from the
   returned array. This is a pass-through assertion pinning an invariant that already holds
   structurally — no source change is needed to make it true, but AC-6 requires the test to
   exist.

#### AC-7 (idempotent setup)

`ensureWorktree()` reads the real `REPO_ROOT`/`WORKTREES_ROOT` module constants, so these
need the same subprocess + `CANON_WORKTREES_ROOT` pattern, calling `ensureWorktree`
directly (imported from `worktree.js`) inside the subprocess, with `localDir` as the
subprocess cwd (so `REPO_ROOT` resolves to `localDir` itself, matching a non-worktree
supervising checkout):

```ts
void test('ensureWorktree is idempotent against a pre-existing verified symlink', () => {
    withTempDir('run-task-ensure-wt-idempotent-', dir => {
        const { localDir, worktreesRoot } = makeNodeModulesGateFixture(dir, 'task-a', 'node_modules/\n');
        const branch = 'task/task-a';
        const worktreeDir = path.join(worktreesRoot, 'task-a');

        const callEnsure = () => runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'scripts/run-task/worktree.ts')).href)})`,
            `.then(m => { m.ensureWorktree(${JSON.stringify('task-a')}, ${JSON.stringify(branch)}); })`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({ CANON_WORKTREES_ROOT: worktreesRoot }), localDir);

        // makeNodeModulesGateFixture already created the worktree+branch via `git
        // worktree add -b`, so a first ensureWorktree() call hits the early
        // `fs.existsSync(wt)` return, not the symlink guard. Remove the worktree
        // registration first so this test exercises symlink-guard idempotency, not
        // worktree-creation idempotency (already covered by existing worktree tests):
        execFileSync('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: localDir });
        execFileSync('git', ['branch', '-D', branch], { cwd: localDir });

        const first = callEnsure();
        assert.equal(first.status, 0, first.stderr); // (a) missing -> created
        const second = callEnsure();
        assert.equal(second.status, 0, second.stderr); // (b) verified symlink -> no-op, no EEXIST
    });
});
```

Plus two more variations for **(c)** (after the first `callEnsure()`, replace
`worktreeDir/node_modules` with a real directory containing a file, then call
`ensureWorktree` again — assert exit 0 and the directory is untouched) and **(d)** (after
the first `callEnsure()`, remove the symlink and replace it with one pointing at an
unrelated directory, then call `ensureWorktree` again — assert non-zero exit and stderr
matches `/does not resolve to/` naming the path and the found target).

**Implementer check**: confirm `ensureWorktree` is exported from `worktree.ts` (it already
is) and that the fixture's `package.json` (added in `makeNodeModulesGateFixture`) is
present so the `fs.existsSync(repoPackageJson)` guard in `ensureWorktree()` engages.

#### AC-8 (pure classifier seam)

Fully covered by the AC-4/decision-table tests above — no additional test required.

## Testing Plan

- **Unit**: `classifyNodeModulesLinkFromData` decision table (AC-4, AC-8);
  `buildHumanReviewStagePaths` never-emits-node_modules case (AC-6).
- **Integration** (real git fixtures, `tests/run-task-safety.test.ts`): AC-1 (QA-end
  red-first regression), AC-2 (human-review symlink-only push), AC-3 (three negative
  cases), AC-5 (no-slash companion), AC-6 (ls-tree check), AC-7 (four `ensureWorktree`
  idempotency cases).
- **Manual**: none beyond the Human Test Plan in the spec, which QA/human-review will
  exercise against the shipped build.

Run in order after implementation:
1. `npm run lint`
2. `npm run type-check`
3. `npm test` (full suite — confirm no regressions in existing `commitQaArtifacts` /
   `commitHumanReviewFiles` / `buildHumanReviewStagePaths` tests, which exercise the
   unchanged non-exempt paths)
4. `npm run build`

## Docs (optional, QA's call)

Per the spec's Docs Impact section, one sentence in `docs/pipeline-orchestrator.md` where
the QA-end/human-review allowlist is described, noting the verified-symlink carve-out, is a
nice-to-have — not required for this task. Do not add anything to `docs/patterns.md` for
this task; the fix itself removes the need for a pitfall entry about the bug.

## Notes / things to double-check while implementing

- `probeNodeModulesEntry`'s second argument is **always** `REPO_ROOT`, never the active
  worktree cwd, in both call sites (`main.ts`'s gates and `worktree.ts`'s own
  `ensureWorktree()`, where it's already the natural local constant). Don't "fix" this to
  use the active checkout — see the spec's Interaction Dependencies section for the
  explicit rationale (this is the deliberate inversion of the usual worktree rule, not a
  violation of it).
- Verify `effectiveWorktreesRoot()` in `state.ts` honors `CANON_WORKTREES_ROOT` the same
  way `WORKTREES_ROOT` in `env.ts` does, before relying on the fast `resolveTaskCwd` path
  in the AC-2/AC-7 fixtures.
- If any test needs `gh` on PATH and doesn't already have it stubbed, use
  `setupFakeCliTools(fakeBins)` (already used elsewhere in this file) rather than adding a
  new stub.

## Rollback Plan

Pure additive change to two gate functions plus one setup guard — no schema, no data
migration, no state persisted across runs. Revert is a plain `git revert` of the
implementation commit; the only externally-visible behavior that reverts is the carve-out
itself (adopters with the trailing-slash ignore style go back to hitting the original
QA-end/human-review abort described in the Problem section).
