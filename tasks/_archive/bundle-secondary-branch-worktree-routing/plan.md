# Plan: bundle-secondary-branch-worktree-routing

> Spec verdict: `approved_with_nits`. The one nit (performance risk — scan runs once per `resolveTaskCwd` call, not once per phase) is addressed in Step 1 below by explicitly *not* adding an in-memory cache (see rationale in Step 1.3).

## Order of work

1. `scripts/run-task/state.ts` — new tri-state worktree enumeration helper + ownership scan + `resolveTaskCwd` wiring (Change 1).
2. `scripts/run-task/git.ts` — `ensureBranch` first-implement bootstrap loop rewrite (Change 2).
3. `docs/patterns.md` — new Known Pitfalls entry (root-only, no `templates/` mirror).
4. `tests/run-task-safety.test.ts` — AC-1 real-git regression test, AC-4(a)-(f) negative tests, `FAKE_GIT_WORKTREE_LIST_FAIL` lever.
5. Build + validation: `npm run lint`, `npm run type-check`, `npm test`, `npm run build`, `npm run docs-refs-check`, commit `dist/` artifacts.

Do the source changes (1–2) before the tests (4) even though the spec's AC-1 is "red-first" — write the test body against pre-fix code first only if you want to see it fail; either order is acceptable as long as the final diff has both the fix and passing tests. Given the complexity here, implementing the fix first and writing tests against the finished behavior is lower-risk; just don't skip verifying AC-1 truly fails on a stash of the pre-fix `state.ts`/`git.ts` if you want the red-first evidence (optional but recommended given this is a `delicate: true` task).

---

## Step 1 — `scripts/run-task/state.ts`

### 1.1 Add a tri-state worktree enumeration helper

Add this near the top of the file, after `effectiveWorktreesRoot()` and before `findExistingWorktreeForBranch` (or right after it — either location is fine, just keep worktree-listing helpers together):

```ts
type WorktreeBranchEntry = { path: string; branch: string | null };
type WorktreeEnumerationResult =
    | { ok: true; worktrees: WorktreeBranchEntry[] }
    | { ok: false };

function listWorktreesWithBranches(): WorktreeEnumerationResult {
    const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0) return { ok: false };

    const worktrees: WorktreeBranchEntry[] = [];
    let currentPath: string | null = null;
    let currentBranch: string | null = null;
    const flush = () => {
        if (currentPath && currentPath !== REPO_ROOT) {
            worktrees.push({ path: currentPath, branch: currentBranch });
        }
    };
    for (const line of (result.stdout ?? '').split('\n')) {
        if (line.startsWith('worktree ')) {
            flush();
            currentPath = line.slice('worktree '.length).trim();
            currentBranch = null;
        } else if (line.startsWith('branch refs/heads/')) {
            currentBranch = line.slice('branch refs/heads/'.length).trim();
        }
    }
    flush();
    return { ok: true, worktrees };
}
```

This is deliberately a **separate** helper from `findExistingWorktreeForBranch` above it — that function collapses "git failed" and "not found" into the same `null` return (fine for its own non-empty-branch die path, which already treats "not found" as fatal), but the new empty-`branch` scan must distinguish "enumeration failed" from "enumeration succeeded, zero worktrees relevant" (AC-3 outcome (ii) vs (iv)). Don't try to make `findExistingWorktreeForBranch` share this helper — it stays byte-identical per the spec's Affected Files (this task doesn't touch it).

Note the `flush()`-on-next-`worktree`-line pattern (plus a final flush after the loop) captures every block including the last one, and naturally produces `branch: null` for a detached-HEAD worktree (no `branch refs/heads/…` line appears in its block) — satisfying the Known Risks note about detached HEAD never satisfying the branch-equality test.

### 1.2 Add the ownership scan

Add directly below the helper above:

```ts
type WorktreeOwnershipScan =
    | { outcome: 'matched'; worktreePath: string }
    | { outcome: 'ambiguous'; worktreePaths: string[] }
    | { outcome: 'enumeration-failed' }
    | { outcome: 'present-but-invalid'; worktreePath: string; error: string }
    | { outcome: 'no-match' };

function scanWorktreesForSecondaryOwnership(taskId: string): WorktreeOwnershipScan {
    const enumeration = listWorktreesWithBranches();
    if (!enumeration.ok) return { outcome: 'enumeration-failed' };

    const matches: string[] = [];
    for (const { path: worktreePath, branch: checkedOutBranch } of enumeration.worktrees) {
        const candidateStatusPath = path.join(worktreePath, 'tasks', taskId, 'status.json');
        if (!fs.existsSync(candidateStatusPath)) continue;

        let candidate: StatusJson;
        try {
            candidate = readStatusFromPath(candidateStatusPath, taskId);
        } catch (err) {
            return {
                outcome: 'present-but-invalid',
                worktreePath,
                error: err instanceof Error ? err.message : String(err),
            };
        }

        if (candidate.worktree !== true) continue;
        if (checkedOutBranch === null) continue; // detached HEAD — can never match
        const candidateBranch = candidate.branch?.trim() ?? '';
        if (candidateBranch && candidateBranch === checkedOutBranch) {
            matches.push(worktreePath);
        }
    }

    if (matches.length === 1) return { outcome: 'matched', worktreePath: matches[0] };
    if (matches.length >= 2) return { outcome: 'ambiguous', worktreePaths: matches };
    return { outcome: 'no-match' };
}
```

Key points to get right (each maps to an AC/Known Risk):
- **Fail-closed on the first present-but-invalid candidate** — return immediately, don't keep scanning. It doesn't matter whether other candidates would have matched or been ambiguous; a present-but-invalid candidate must *always* result in `die()`, so short-circuiting is correct and simplest (AC-3, AC-4(f)).
- **`readStatusFromPath`, never raw `JSON.parse`** — this is what makes a schema-invalid `branch: 123` throw instead of silently reading as garbage (AC-4(f2)). `readStatusFromPath` takes an explicit path and doesn't call `resolveTaskCwd`/`statusFileFor`, so no recursion (AC-5).
- **Candidate's own `worktree === true` required** — rejects a stale/divergent branch whose committed `status.json` says `worktree: false` with a branch that happens to equal the checked-out branch (AC-4(c)).
- **`fs.existsSync` gates the read** — an absent candidate is a plain skip, never invalid (this is what makes bootstrap-time scans return `no-match` rather than dying, since inherited copies haven't been written yet).
- Do **not** call `readStatus`/`writeStatus`/`statusFileFor`/`taskDirFor` anywhere in this function or the one above — AC-5 is verified by grep.

### 1.3 Wire the scan into `resolveTaskCwd` — and do NOT add a cache

Replace the body of `resolveTaskCwd` (currently `state.ts:83-108`) with:

```ts
export function resolveTaskCwd(taskId: string): string {
    const worktreesRoot = effectiveWorktreesRoot();
    const directWorktree = path.join(worktreesRoot, taskId);
    const directStatus = path.join(directWorktree, 'tasks', taskId, 'status.json');
    if (fs.existsSync(directStatus)) return directWorktree;

    const statusPath = path.join(taskDirForRepoRoot(taskId), 'status.json');
    try {
        const parsed = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as Pick<StatusJson, 'worktree' | 'branch'>;
        if (parsed.worktree === true) {
            const branch = parsed.branch?.trim() ?? '';
            if (branch) {
                const existing = findExistingWorktreeForBranch(branch);
                if (existing) return existing;
                die(
                    `Worktree for task '${taskId}' is expected but missing.\n` +
                    `  Looked for ${directWorktree} and a worktree for branch '${branch}'.\n` +
                    `  Restore or recreate the worktree before continuing.`,
                );
            }

            const scan = scanWorktreesForSecondaryOwnership(taskId);
            switch (scan.outcome) {
                case 'matched':
                    return scan.worktreePath;
                case 'ambiguous':
                    die(
                        `Multiple worktrees claim ownership of task '${taskId}':\n` +
                        scan.worktreePaths.map(p => `  - ${p}`).join('\n') +
                        `\n  Only one worktree may record this task's branch. Resolve manually before continuing.`,
                    );
                    break;
                case 'enumeration-failed':
                    die(`Could not enumerate git worktrees while resolving task '${taskId}' ('git worktree list --porcelain' failed).`);
                    break;
                case 'present-but-invalid':
                    die(
                        `Task '${taskId}' has an unreadable status.json in worktree ${scan.worktreePath}: ${scan.error}\n` +
                        `  Fix or remove that file before continuing — ownership cannot be determined.`,
                    );
                    break;
                case 'no-match':
                    break;
            }
        }
    } catch {
        // No readable status metadata — fall through to the main checkout.
    }
    return REPO_ROOT;
}
```

This sits entirely **inside** the existing `parsed.worktree === true` block, on the sibling **empty-branch** sub-path next to the existing non-empty-branch `die()` (AC-7 — that `die()` block is untouched, just above the new scan). A `worktree: false` task never reaches this code (AC-4(b)/(c) both require this).

**On the spec-review nit (performance):** the reviewer correctly noted `resolveTaskCwd` is called far more often than "once per phase" — every `readStatus`/`writeStatus`, every heartbeat tick, etc. **Do not respond to this by adding a memoized/cached enumeration result.** `docs/patterns.md` already has a standing pitfall against exactly this shape of fix ("Don't introduce orchestrator state that lives only in memory across phases") — a cached `git worktree list` result would go stale the moment a worktree is created or torn down mid-process (which is exactly what happens during the bootstrap loop this task is fixing), reintroducing a subtler version of the bug this task removes. `git worktree list --porcelain` is a fast, local, read-only git plumbing command (no network, no lock contention with concurrent readers) — the accepted cost is one extra subprocess spawn per empty-branch resolution, which only happens for worktree-mode secondaries before their branch is recorded. This is a **known**, accepted tradeoff — do not add caching, invalidation, or memoization as part of this task.

### 1.4 No changes to `isOrphanedWorktreeState`, `taskDirFor`, `statusFileFor`, `validateStatus`, `validateBranchField`, `readStatus`, `writeStatus`, `deriveTopLevelStatus`, `storeSessionId`, `getStoredSessionId`, `autoBlockPhase`.

`readStatusFromPath` and `writeStatusToFile` already exist unchanged (`state.ts:156-179`) and are exported — Step 2 imports them into `git.ts`.

---

## Step 2 — `scripts/run-task/git.ts`

### 2.1 Import update

Change line 7:

```ts
import { readStatus, taskDirForRepoRoot, writeStatus } from './state.js';
```

to:

```ts
import { readStatus, readStatusFromPath, taskDirForRepoRoot, writeStatus, writeStatusToFile } from './state.js';
```

`readStatus`/`writeStatus` stay in use elsewhere in this file (top of `ensureBranch`, the reuse branch, the non-worktree branch) — only the first-implement worktree loop switches to the explicit-path variants.

### 2.2 Rewrite the first-implement worktree block

Replace the current block (`git.ts:283-302`):

```ts
if (useWorktree) {
    // ... comment ...
    assertRepoRootCleanBeforeFirstWorktree(options.force === true);
    ensureWorktree(taskIds[0], branchName, baseBranch);
    for (const taskId of taskIds) {
        const s = readStatus(taskId);
        s.branch = branchName;
        writeStatus(taskId, s);
    }
    try {
        tickAllHeartbeats();
    } catch {
        // Best-effort: a heartbeat refresh must never abort worktree creation.
    }
    info(`Branch recorded: ${branchName} (worktree mode — main checkout untouched)`);
    return;
}
```

with:

```ts
if (useWorktree) {
    // First-implement worktree case: create task/<id> directly in the
    // worktree from baseBranch. Never mutate the main checkout's HEAD —
    // that would violate the documented isolation model where the main
    // checkout stays on the base branch while implementation, review, and
    // qa run in ../dev-worktrees/<id>/.
    assertRepoRootCleanBeforeFirstWorktree(options.force === true);
    const leaderWorktree = ensureWorktree(taskIds[0], branchName, baseBranch);
    // Write every member's branch to an override-aware, resolver-free
    // destination — never readStatus/writeStatus, which would route a
    // secondary through resolveTaskCwd's empty-branch scan before this
    // very loop has populated the worktree copies it depends on (see
    // docs/patterns.md's bundle-secondary-worktree-routing pitfall).
    // Secondaries first, leader last: the leader's branch is the durable
    // "bootstrap complete" marker (implement.ts's worktreeAlreadyCreated,
    // this file's reuse-path branch check above) — writing it last keeps
    // that marker from going true before every member has a recorded
    // branch, without adding new crash-recovery machinery.
    const orderedTaskIds = [...taskIds.slice(1), taskIds[0]];
    for (const taskId of orderedTaskIds) {
        const destination = process.env.CANON_TASKS_DIR_OVERRIDE
            ? path.join(process.env.CANON_TASKS_DIR_OVERRIDE, taskId, 'status.json')
            : path.join(leaderWorktree, 'tasks', taskId, 'status.json');
        const s = readStatusFromPath(destination, taskId);
        s.branch = branchName;
        writeStatusToFile(destination, s);
    }
    try {
        tickAllHeartbeats();
    } catch {
        // Best-effort: a heartbeat refresh must never abort worktree creation.
    }
    info(`Branch recorded: ${branchName} (worktree mode — main checkout untouched)`);
    return;
}
```

Notes:
- `leaderWorktree` is captured from `ensureWorktree`'s **return value**, not re-derived as `WORKTREES_ROOT/<leader>` — `ensureWorktree` can return an existing worktree at a non-conventional path if one already exists for that branch (`worktree.ts:146-150`).
- The log line at the end is unchanged text — it's now actually true for every member, not just the leader (AC-8). No further edit needed there.
- The reuse block above this one (`git.ts:262-277`, the `if (primaryStatus.branch)` branch) is completely untouched.
- `path` is already imported in this file (`git.ts:2`); no new import needed for `path.join`.

---

## Step 3 — `docs/patterns.md`

Add a new entry at the end of the `## Known Pitfalls` section (after the last entry, "A non-zero agent exit is not a completed review — recovery must park, not read the artifact", `docs/patterns.md:224-226`), before `## Quick Reference: "I Want To..."`:

```markdown
### A bundle secondary must be resolved by worktree content, never by a mutable main-checkout write

`ensureBranch`'s first-implement worktree bootstrap creates **one** worktree named after the bundle leader (`dev-worktrees/<leader>/`), which inherits every member's `tasks/<id>/status.json` from base. A secondary task has no worktree of its own — its `resolveTaskCwd` resolution must find the leader's worktree by *content*, not by writing a branch hint into the secondary's main-checkout copy (that was the original bug: the write landed in `REPO_ROOT` because resolution needs the branch set to find the worktree, but the write is what sets it — a chicken-and-egg that dirtied main on every bundle run).

The fix: `resolveTaskCwd` (`scripts/run-task/state.ts`) scans existing git worktrees via `git worktree list --porcelain` and treats a worktree as owning the task only when its **own** `tasks/<taskId>/status.json` reads cleanly, records `worktree === true`, **and** its `branch` equals that worktree's own checked-out branch. All three conditions matter: content alone would false-match an unrelated worktree that merely inherited the task dir from base; `worktree === true` alone would false-match a stale divergent branch that happens to share a branch name. The scan fails closed — not skip-to-`REPO_ROOT` — on two distinct failure modes: `git worktree list` erroring/exiting non-zero (enumeration-failed), and a present candidate `status.json` that exists but doesn't validate (malformed JSON or a schema-invalid field like a non-string `branch`) — either would otherwise silently re-route a secondary's writes back to main. `ensureBranch`'s companion bootstrap loop writes every member's branch directly to `<leaderWorktree>/tasks/<member>/status.json` (or the `CANON_TASKS_DIR_OVERRIDE` root when set) via `readStatusFromPath`/`writeStatusToFile` — never `readStatus`/`writeStatus`, which would re-enter this same resolver for a secondary before the loop has populated the copy the scan depends on.

Anti-pattern: caching the `git worktree list` result across `resolveTaskCwd` calls to save the repeated subprocess cost. `resolveTaskCwd` is called far more often than once per phase (every status read/write, every heartbeat tick), but a worktree can be created or torn down mid-process — see "Don't introduce orchestrator state that lives only in memory across phases" above. The subprocess is cheap and local; accept the repeated cost rather than risk a stale cache silently reproducing the original bug in a new form.
```

**Do not** declare a `templates/` mirror row for this edit. `docs/patterns.md` is absent from `CANON_OWNED`/`DELIMITED` in `src/lib/canon-owned.ts`, so `sync-canon-templates.mjs` does not mirror it — `templates/docs/patterns.md` is a generic init scaffold, unrelated to this file. Declaring a mirror row here would be rejected at the `code_review` handoff-diff preflight (see the existing "Declare `templates/` mirrors…" pitfall, `docs/patterns.md:189-198`).

---

## Step 4 — `tests/run-task-safety.test.ts`

Add all new tests in this file, near the existing worktree/`resolveTaskCwd`/`ensureBranch` tests (around `state.ts`/`git.ts:1000-1400` — see the existing bundle-heartbeat test at `:1008`, reuse-path test at `:1153`, secondary-routing test at `:1272`, and orphan-die test at `:1325`).

### 4.1 `FAKE_GIT_WORKTREE_LIST_FAIL` lever

In `setupFakeGit` (`tests/run-task-safety.test.ts:50-202`), extend the existing `worktree list --porcelain` branch (currently lines 178-183):

```sh
if [ "${1:-}" = "worktree" ] && [ "${2:-}" = "list" ] && [ "${3:-}" = "--porcelain" ]; then
  if [ "${FAKE_GIT_WORKTREE_LIST_FAIL:-}" = "1" ]; then
    printf "%s\n" "simulated worktree list failure" >&2
    exit 1
  fi
  if [ -n "${FAKE_GIT_WORKTREE_LIST_FILE:-}" ] && [ -f "$FAKE_GIT_WORKTREE_LIST_FILE" ]; then
    cat "$FAKE_GIT_WORKTREE_LIST_FILE"
  fi
  exit 0
fi
```

Mirrors the existing `FAKE_GIT_FAIL_COMMIT` / `FAKE_GIT_DRIFT_DIFF_FAIL` lever pattern already in this function (lines 105-108, 124-127).

### 4.2 AC-1 — real-git wrong-main-write regression test

New test, real git (not fake-git), following the `makeGitFixture` pattern used by e.g. `commitQaArtifacts commits task artifacts...` (`:1578`):

```ts
void test('ensureBranch records a bundle secondary\'s branch in the worktree, never main', () => {
    withTempDir('run-task-safety-bundle-wrong-main-', dir => {
        const { localDir } = makeGitFixture(dir);
        const worktreesRoot = path.join(dir, 'worktrees');

        const leaderId = 'bundle-leader';
        const secondaryId = 'bundle-secondary';
        const taskBranch = `task/${leaderId}`;

        writeTaskStatus(path.join(localDir, 'tasks'), leaderId, {
            title: leaderId, base_branch: 'main', branch: '', worktree: true, phases: {},
        });
        writeTaskStatus(path.join(localDir, 'tasks'), secondaryId, {
            title: secondaryId, base_branch: 'main', branch: '', worktree: true, phases: {},
        });
        gitIn(localDir, 'add', 'tasks');
        gitIn(localDir, 'commit', '-m', 'task artifacts pre-pipeline');

        const result = runNodeInline([
            "import { ensureBranch } from './scripts/run-task/git.js';",
            `ensureBranch(${JSON.stringify([leaderId, secondaryId])});`,
        ].join('\n'), childEnvWithoutTasksOverride({ CANON_WORKTREES_ROOT: worktreesRoot }), localDir);
        assert.equal(result.status, 0, result.stderr);

        // (a) worktree copy has the branch
        const leaderWorktree = path.join(worktreesRoot, leaderId);
        const worktreeSecondaryStatus = JSON.parse(
            fs.readFileSync(path.join(leaderWorktree, 'tasks', secondaryId, 'status.json'), 'utf8'),
        ) as { branch?: string };
        assert.equal(worktreeSecondaryStatus.branch, taskBranch);

        // (b) main checkout's secondary copy is untouched
        const mainSecondaryStatus = JSON.parse(
            fs.readFileSync(path.join(localDir, 'tasks', secondaryId, 'status.json'), 'utf8'),
        ) as { branch?: string };
        assert.equal(mainSecondaryStatus.branch, '');
        const mainStatus = execFileSync('git', ['status', '--porcelain', '--', `tasks/${secondaryId}/status.json`], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.equal(mainStatus, '');

        // (c) resolveTaskCwd(secondary) resolves to the leader's worktree
        const resolveResult = runNodeInline([
            "import { resolveTaskCwd } from './scripts/run-task/state.js';",
            `console.log(resolveTaskCwd(${JSON.stringify(secondaryId)}));`,
        ].join('\n'), childEnvWithoutTasksOverride({ CANON_WORKTREES_ROOT: worktreesRoot }), localDir);
        assert.equal(resolveResult.status, 0, resolveResult.stderr);
        assert.equal(resolveResult.stdout.trim(), leaderWorktree);
    });
});
```

Notes:
- `childEnvWithoutTasksOverride(...)` is essential here (not `withFakeGitEnv`/`CANON_TASKS_DIR_OVERRIDE`) — the whole point of AC-1 is proving real-git main-checkout behavior without the override fast-path masking it.
- `cwd: localDir` on both `runNodeInline` calls makes `REPO_ROOT` (resolved at subprocess module-load time via `git rev-parse --git-common-dir`, `env.ts:9-40`) resolve to `localDir`, and `WORKTREES_ROOT` resolve via `CANON_WORKTREES_ROOT` to the sibling `worktreesRoot` — matching the pattern in `runEnsureWorktreeInline` (`:714-725`).
- No `package.json` in the fixture, so `ensureWorktree`'s node_modules symlink step is skipped (same as other plain-`makeGitFixture` tests).
- **Red-first check (recommended, not required by the test itself):** stash your `state.ts`/`git.ts` changes and re-run this test — it should fail at the `(a)` assertion (worktree copy's `branch` still `''`) and the `(b)` assertion (main's secondary copy shows `branch: 'task/bundle-leader'` and is dirty per `git status --porcelain`), while `(c)` still passes pre-fix (per the spec's Problem section, step 4). Restore your changes afterward.

### 4.3 AC-4(a) — inherited-dir no-false-match

An unrelated worktree on a different branch that merely inherited `tasks/<taskId>/` from base (empty or mismatched `branch`) must not be matched:

```ts
void test('resolveTaskCwd does not false-match an unrelated worktree that only inherited the task dir', () => {
    withTempDir('run-task-safety-scan-inherited-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'scan-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId, base_branch: 'main', branch: '', worktree: true, phases: {},
        });

        const otherWorktree = path.join(dir, 'unrelated-worktree');
        fs.mkdirSync(path.join(otherWorktree, 'tasks', taskId), { recursive: true });
        fs.writeFileSync(
            path.join(otherWorktree, 'tasks', taskId, 'status.json'),
            JSON.stringify({ worktree: true, branch: '' }) + '\n',
            'utf8',
        );

        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${otherWorktree}`,
            'HEAD abc123',
            'branch refs/heads/some-other-branch',
            '',
        ].join('\n'), 'utf8');

        withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, () => {
            const cwd = resolveTaskCwd(taskId);
            assert.equal(cwd, REPO_ROOT);
        });
    });
});
```

### 4.4 AC-4(b) — main-copy `worktree: false` not scanned

Uses a stale worktree at a **non-by-id path** (critical — see spec AC-4(b) — otherwise the pre-existing direct-by-id fast-path at `state.ts:85-87` would resolve it regardless of the main flag, proving nothing):

```ts
void test('resolveTaskCwd does not scan worktrees when main records worktree: false', () => {
    withTempDir('run-task-safety-scan-worktree-false-main-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'non-worktree-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId, base_branch: 'main', branch: '', worktree: false, phases: {},
        });

        // Deliberately NOT at worktreesRoot/<taskId>/ — a non-by-id path so the
        // by-id fast path can't short-circuit and mask the gating this test proves.
        const staleWorktree = path.join(dir, 'stale-worktree');
        fs.mkdirSync(path.join(staleWorktree, 'tasks', taskId), { recursive: true });
        fs.writeFileSync(
            path.join(staleWorktree, 'tasks', taskId, 'status.json'),
            JSON.stringify({ worktree: true, branch: 'stale-branch' }) + '\n',
            'utf8',
        );

        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${staleWorktree}`,
            'HEAD abc123',
            'branch refs/heads/stale-branch',
            '',
        ].join('\n'), 'utf8');

        withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, () => {
            const cwd = resolveTaskCwd(taskId);
            assert.equal(cwd, REPO_ROOT);
        });
    });
});
```

### 4.5 AC-4(c) — candidate `worktree: false` not matched

Same shape as 4.4 but main's own status is `worktree: true, branch: ''` (so the scan *does* run), and the candidate's own `status.json` records `worktree: false` with a branch that equals the worktree's checked-out branch — must still be a skip, not a match:

```ts
void test('resolveTaskCwd does not match a worktree whose own status.json records worktree: false', () => {
    withTempDir('run-task-safety-scan-candidate-worktree-false-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'candidate-worktree-false';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId, base_branch: 'main', branch: '', worktree: true, phases: {},
        });

        const candidateWorktree = path.join(dir, 'candidate-worktree');
        fs.mkdirSync(path.join(candidateWorktree, 'tasks', taskId), { recursive: true });
        fs.writeFileSync(
            path.join(candidateWorktree, 'tasks', taskId, 'status.json'),
            JSON.stringify({ worktree: false, branch: 'candidate-branch' }) + '\n',
            'utf8',
        );

        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${candidateWorktree}`,
            'HEAD abc123',
            'branch refs/heads/candidate-branch',
            '',
        ].join('\n'), 'utf8');

        withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, () => {
            const cwd = resolveTaskCwd(taskId);
            assert.equal(cwd, REPO_ROOT);
        });
    });
});
```

### 4.6 AC-4(d) — multi-match → die

Two independent worktrees, each self-consistently matching (own `worktree: true`, own `branch` equal to their own checked-out branch). Expect `die()`, so use `runNodeInline` (subprocess) rather than a direct call:

```ts
void test('resolveTaskCwd dies naming candidates when two worktrees both claim ownership', () => {
    withTempDir('run-task-safety-scan-ambiguous-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'ambiguous-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId, base_branch: 'main', branch: '', worktree: true, phases: {},
        });

        const worktreeOne = path.join(dir, 'worktree-one');
        const worktreeTwo = path.join(dir, 'worktree-two');
        for (const [wt, branch] of [[worktreeOne, 'branch-one'], [worktreeTwo, 'branch-two']] as const) {
            fs.mkdirSync(path.join(wt, 'tasks', taskId), { recursive: true });
            fs.writeFileSync(
                path.join(wt, 'tasks', taskId, 'status.json'),
                JSON.stringify({ worktree: true, branch }) + '\n',
                'utf8',
            );
        }

        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${worktreeOne}`, 'HEAD abc123', 'branch refs/heads/branch-one', '',
            `worktree ${worktreeTwo}`, 'HEAD def456', 'branch refs/heads/branch-two', '',
        ].join('\n'), 'utf8');

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { resolveTaskCwd } from './scripts/run-task/state.js';",
            `resolveTaskCwd(${JSON.stringify(taskId)});`,
        ].join('\n'), env));

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Multiple worktrees claim ownership/);
        assert.match(result.stderr, new RegExp(worktreeOne.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.match(result.stderr, new RegExp(worktreeTwo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });
});
```

### 4.7 AC-4(e) — enumeration failure → die

```ts
void test('resolveTaskCwd dies when git worktree list enumeration fails', () => {
    withTempDir('run-task-safety-scan-enum-fail-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'enum-fail-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId, base_branch: 'main', branch: '', worktree: true, phases: {},
        });

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FAIL: '1',
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { resolveTaskCwd } from './scripts/run-task/state.js';",
            `resolveTaskCwd(${JSON.stringify(taskId)});`,
        ].join('\n'), env));

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Could not enumerate git worktrees/);
    });
});
```

### 4.8 AC-4(f1)/(f2) — present-but-invalid → die

Two sub-cases as two separate `test()` blocks (reads more clearly in failure output than one parameterized loop):

```ts
void test('resolveTaskCwd dies when a candidate status.json is present but unparseable', () => {
    withTempDir('run-task-safety-scan-invalid-json-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'invalid-json-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId, base_branch: 'main', branch: '', worktree: true, phases: {},
        });

        const candidateWorktree = path.join(dir, 'candidate-worktree');
        fs.mkdirSync(path.join(candidateWorktree, 'tasks', taskId), { recursive: true });
        fs.writeFileSync(path.join(candidateWorktree, 'tasks', taskId, 'status.json'), '{ not valid json', 'utf8');

        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${candidateWorktree}`, 'HEAD abc123', 'branch refs/heads/some-branch', '',
        ].join('\n'), 'utf8');

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { resolveTaskCwd } from './scripts/run-task/state.js';",
            `resolveTaskCwd(${JSON.stringify(taskId)});`,
        ].join('\n'), env));

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /unreadable status\.json/);
    });
});

void test('resolveTaskCwd dies when a candidate status.json has a schema-invalid branch field', () => {
    withTempDir('run-task-safety-scan-invalid-schema-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'invalid-schema-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId, base_branch: 'main', branch: '', worktree: true, phases: {},
        });

        const candidateWorktree = path.join(dir, 'candidate-worktree');
        fs.mkdirSync(path.join(candidateWorktree, 'tasks', taskId), { recursive: true });
        fs.writeFileSync(
            path.join(candidateWorktree, 'tasks', taskId, 'status.json'),
            JSON.stringify({ worktree: true, branch: 123 }) + '\n',
            'utf8',
        );

        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${candidateWorktree}`, 'HEAD abc123', 'branch refs/heads/some-branch', '',
        ].join('\n'), 'utf8');

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { resolveTaskCwd } from './scripts/run-task/state.js';",
            `resolveTaskCwd(${JSON.stringify(taskId)});`,
        ].join('\n'), env));

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /unreadable status\.json/);
        assert.match(result.stderr, /expected string, got number/);
    });
});
```

(The exact match text for `validateBranchField`'s thrown message is `Invalid branch in task '<id>': expected string, got number. Edit status.json.` — see `state.ts:117-121`. Adjust the regex if you word the die-message wrapper differently, but keep an assertion that the underlying validation reason surfaces, not just a generic "invalid" string.)

### 4.9 Confirm untouched-by-code, re-verified-by-run existing tests

No code changes needed for these — just confirm they still pass after Steps 1–2 (they exercise paths this task declares unchanged):
- `ensureBranch ticks active heartbeats into every bundled worktree task dir after first worktree creation` (`:1008`) — AC-2/AC-6, override-root destination for both members.
- `ensureBranch bypasses dirty source guard when worktree branch is already recorded` (`:1153`) — reuse path, untouched.
- `resolveTaskCwd routes worktree-backed secondary tasks to the primary worktree` (`:1272`) — non-empty main branch, old main-hint path, untouched.
- `resolveTaskCwd fails closed when a worktree-backed task has no available worktree` (`:1325`) — AC-7, non-empty branch + no worktree → die, untouched.

---

## Step 5 — Validation

Run in order, fixing forward on any failure before moving to the next:

1. `npm run lint`
2. `npm run type-check`
3. `npm test` (full suite — includes all new AC-1/AC-4 tests plus every pre-existing test)
4. `npm run build` — then `git diff --exit-code -- dist/` must be clean; both `dist/cli/index.js` and `dist/scripts/run-task.js` are expected to change (Affected Files) since `resolveTaskCwd` is bundled via `src/task/index.ts` → `src/cli`, and `scripts/run-task/**` bundles into `dist/scripts/run-task.js`.
5. `npm run docs-refs-check` — required because `docs/patterns.md` changed.

## Handoff notes for Codex

- Affected Files in the handoff table: `scripts/run-task/state.ts`, `scripts/run-task/git.ts`, `tests/run-task-safety.test.ts`, `docs/patterns.md`, `dist/cli/index.js`, `dist/scripts/run-task.js`. No `templates/patterns.md` row (Step 3 note).
- This task is `delicate: true` (worktree machinery) — treat `resolveTaskCwd` and `ensureBranch` changes as hot-path or-else-corrupts-every-task-after risk; don't take shortcuts on the fail-closed branches to make tests pass faster.
- Do not touch `scripts/run-task/git.ts:262-277` (the reuse block) or `scripts/run-task/worktree.ts` `findExistingWorktreeForBranch` — both stay byte-identical per spec Non-Goals.
- Do not add any caching/memoization around the new `git worktree list --porcelain` call (Step 1.3).
