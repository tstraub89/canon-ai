# Implementation Plan: prepr-base-drift-check

> Written by: Claude | Implements: `tasks/prepr-base-drift-check/spec.md`

## Spec review nit addressed

Spec-review noted that AC-8's reference to "the existing `commitHumanReviewFiles` temp-repo + origin fixture pattern at line 1428" is stale — line 1428 is inside a full-send spec-gate test, not a human-review git fixture, and no real temp-origin fixture exists in `run-task-safety.test.ts`. This plan adapts:

- AC-8 (a-c): fake-git harness in `run-task-safety.test.ts` (extended with `FAKE_GIT_DRIFT_FILES` support)
- AC-8 (d) Mode 1 real-git proof: placed in `tests/run-task-validation.test.ts` inside the `describe('verifyBaseDrift', ...)` block alongside AC-9/AC-10, testing `verifyBaseDrift` directly with a real temp git repo + bare origin. This directly proves two-dot semantics without requiring a complex real-git harness inside `run-task-safety.test.ts`.

---

## Approach

Additive: new helper in `git.ts`, two new exports in `validation.ts`, one new call site in `main.ts`, help-text updates, docs update, and tests. No existing function is modified. The `*FromData` + thin-wrapper pattern mirrors the existing `verifyHandoffAgainstDiffFromData` / `verifyHandoffAgainstDiff` pair. The fake-git test harness is extended with one new env var for drift simulation.

---

## Step 1 — Add `getTreeDriftFiles` to `scripts/run-task/git.ts`

**File**: `scripts/run-task/git.ts`
**Position**: immediately after `getAffectedFiles` at line 330–334.

Add:

```typescript
export function getTreeDriftFiles(baseRef: string, cwd: string): { files: string[]; ok: boolean; stderr: string } {
    const result = gitSafeAtRaw(cwd, 'diff', baseRef, 'HEAD', '--name-status', '-M', '-z');
    if (!result.ok) {
        return { files: [], ok: false, stderr: result.stderr };
    }
    return { files: parseNameStatusOutput(result.stdout), ok: true, stderr: '' };
}
```

Key points:
- Two-dot (`baseRef HEAD`, no `...`) — the caller passes `'origin/' + baseBranch`.
- Uses `parseNameStatusOutput` (existing NUL-delimited parser at line 314). Rename records contribute both old and new paths.
- Returns `{ files: [], ok: false, stderr }` on failure so the caller can include the underlying git error in its die message, distinguishing failure from empty-diff-output.
- `getAffectedFiles` is **not modified** — its three-dot semantics remain correct for handoff validation.

---

## Step 2 — Add `verifyBaseDriftFromData` to `scripts/run-task/validation.ts`

**File**: `scripts/run-task/validation.ts`
**Position**: adjacent to `verifyHandoffAgainstDiffFromData` at line 836, placed immediately after it (before `parseDiffNameStatus` at line 887).

Add:

```typescript
export function verifyBaseDriftFromData(
    diffFiles: readonly string[],
    allowedPaths: ReadonlySet<string>,
    taskIds: readonly string[],
): string[] {
    const drift: string[] = [];
    for (const filePath of diffFiles) {
        if (allowedPaths.has(filePath)) continue;
        if (taskIds.some(id => filePath === `tasks/${id}` || filePath.startsWith(`tasks/${id}/`))) continue;
        drift.push(filePath);
    }
    return drift;
}
```

Key points:
- Pure-data: no I/O, no side effects.
- Task-dir prefix check mirrors `humanReviewAllowedPath` at `main.ts:637`.
- `allowedPaths` is the caller's pre-built set (PIPELINE_TELEMETRY_FILES union + spec Affected Files).
- Returns empty array on no drift, array of drifted paths otherwise.

---

## Step 3 — Add `verifyBaseDrift` to `scripts/run-task/validation.ts`

**File**: `scripts/run-task/validation.ts`
**Position**: adjacent to `verifyHandoffAgainstDiff` at line 903, placed immediately after it.

**Import additions** at the top of the file (update the existing `git.js` import line):

```typescript
// Before:
import { filterGitIgnoredPaths, gitSafeAtRaw, parsePorcelainEntries } from './git.js';
// After:
import { filterGitIgnoredPaths, getTreeDriftFiles, gitSafeAt, gitSafeAtRaw, parsePorcelainEntries } from './git.js';
```

Also add `warn` to the cli imports. Check whether `cli.js` is already imported in validation.ts; if not, add:

```typescript
import { warn } from './cli.js';
```

Add after `verifyHandoffAgainstDiff`:

```typescript
export function verifyBaseDrift(
    taskIds: string[],
    baseBranch: string,
    cwd: string,
): { drift: string[]; fetchFailed: boolean; diffFailed: boolean; diffError?: string } {
    const fetchResult = gitSafeAt(cwd, 'fetch', 'origin', baseBranch);
    if (!fetchResult.ok) {
        warn(
            `Could not fetch origin/${baseBranch} (${fetchResult.stderr.trim() || 'unknown'}). ` +
            `Skipping base-drift check — re-run --pr when network access is restored if you want this verified.`,
        );
        return { drift: [], fetchFailed: true, diffFailed: false };
    }

    const driftResult = getTreeDriftFiles(`origin/${baseBranch}`, cwd);
    if (!driftResult.ok) {
        return { drift: [], fetchFailed: false, diffFailed: true, diffError: driftResult.stderr };
    }

    const allowedPaths = new Set<string>(
        (PIPELINE_TELEMETRY_FILES as readonly string[]),
    );
    for (const taskId of taskIds) {
        const parsed = parseAffectedFilesFromSpec(taskId);
        for (const filePath of parsed.files) allowedPaths.add(filePath);
        for (const malformed of parsed.malformed) {
            warn(`${taskId} spec.md Affected Files row malformed: ${malformed.reason}`);
        }
    }

    const drift = verifyBaseDriftFromData(driftResult.files, allowedPaths, taskIds);
    return { drift, fetchFailed: false, diffFailed: false };
}
```

Key points:
- Fetch failure: warn (mirrors `assertOriginTaskBranchAbsent` offline tolerance at `main.ts:1219-1225`) + return `fetchFailed: true`. Warn already emitted; caller skips silently.
- Diff failure after successful fetch: return `diffFailed: true, diffError: <stderr>` without emitting a warn. The caller dies with the error.
- `PIPELINE_TELEMETRY_FILES` is already imported from `worktree.js` in `validation.ts`.
- Malformed cells: warn per task ID + exclude from allow-list, same pattern as `main.ts:914-917`.

---

## Step 4 — Wire into `commitHumanReviewFiles` in `scripts/run-task/main.ts`

**File**: `scripts/run-task/main.ts`
**Position**: inside `commitHumanReviewFiles` starting at line 901, immediately after `mirrorHumanReviewDocsToCwd(cwd)` at line 905, before the `affectedManagedDocs` Set construction at line 907.

Insert:

```typescript
    const _baseBranch = splitGit.getBaseBranch(taskIds);
    const baseDriftResult = splitValidation.verifyBaseDrift(taskIds, _baseBranch, cwd);
    if (baseDriftResult.fetchFailed) {
        // warn already emitted by verifyBaseDrift; best-effort skip
    } else if (baseDriftResult.diffFailed) {
        die(
            `--pr aborted: could not compute base-drift diff against origin/${_baseBranch}.\n` +
            `Git error: ${baseDriftResult.diffError ?? 'unknown'}\n` +
            `This failure cannot be bypassed with --force.`,
        );
    } else if (baseDriftResult.drift.length > 0 && !cliArgs.force) {
        die(
            `--pr aborted: base-drift detected. Files in the tree diff between origin/${_baseBranch}\n` +
            `and HEAD that are not in the spec's Affected Files (and not task-dir/telemetry):\n` +
            baseDriftResult.drift.map(f => `  ${f}`).join('\n') + '\n' +
            `The allowlist is: tasks/<id>/**, PIPELINE_TELEMETRY_FILES, and files listed in\n` +
            `your spec's '### Affected Files' table.\n` +
            `If this is a legitimate task change, add the path to spec.md '### Affected Files'\n` +
            `and rerun. For a rename, list BOTH the old and new paths.\n` +
            `If the drift is unexpected (cross-pipeline contamination or a third-party commit\n` +
            `landed on origin/${_baseBranch} while this pipeline was running), recover with:\n` +
            `  - rebase onto current origin/${_baseBranch} to absorb the base advance:\n` +
            `      git fetch origin ${_baseBranch} && git rebase origin/${_baseBranch}\n` +
            `  - reset a file to base's content if a stray task-branch commit introduced it:\n` +
            `      git checkout origin/${_baseBranch} -- <path> && git commit -m 'revert drift on <path>'\n` +
            `  - revert the offending commit entirely:\n` +
            `      git revert <sha>\n` +
            `Bypass with --force if you've verified the drift is intentional.`,
        );
    } else if (baseDriftResult.drift.length > 0 && cliArgs.force) {
        warn(
            `--force override: base-drift detected; proceeding at user request. Drifted files:\n` +
            baseDriftResult.drift.map(f => `  ${f}`).join('\n'),
        );
    }
    // drift.length === 0 → continue silently
```

AC-5 die message must contain these substrings (verify by grep after writing):
- `tasks/<id>/`
- `PIPELINE_TELEMETRY_FILES`
- `Affected Files`
- `git rebase origin/`
- `git checkout origin/`
- `git revert`
- `rename`
- `--force`

Must NOT contain `git checkout HEAD --`.

Key points:
- No other logic in `commitHumanReviewFiles` changes.
- `cliArgs.force` gains a new consumer here; existing consumer at `main.ts:2370` is untouched.
- `parseArgs` in `cli.ts` is NOT modified — no new flag.

---

## Step 5 — Update help text in `src/cli/index.ts` and `scripts/run-task/cli.ts`

**File**: `src/cli/index.ts`

Find the description strings for `--pr` and `--push` flags. Append to each:

```
Aborts if HEAD's tree differs from origin/<base> on files not in spec's Affected Files (bypass with --force).
```

**File**: `scripts/run-task/cli.ts`

In `printUsage()`, find the `--pr` and `--push` entries and add the same sentence. Mirror the existing line-wrapping convention for adjacent flags (check whitespace/indent in surrounding entries).

---

## Step 6 — Update `docs/pipeline-orchestrator.md`

Find `## Auto-Branch + Auto-Commit` section. After the existing content, add a subsection or paragraph:

```markdown
**Base-drift check (`--pr`/`--push` gate)**: Before committing human-review files, the orchestrator runs `git fetch origin <base>` then computes a two-dot tree diff (`git diff origin/<base> HEAD --name-status -M -z`). Any path in that diff that is not in the spec's `### Affected Files`, a task artifact directory (`tasks/<id>/`), or `PIPELINE_TELEMETRY_FILES` is flagged as drift and aborts the run with an actionable message. This gate fires inside `commitHumanReviewFiles` and catches two contamination modes: Mode 1 — a third-party commit landed on the base branch while this pipeline was running (the task branch never picked it up, so the tree diff surfaces the divergence even though the task never touched that file); and wider Mode 2 — foreign content was committed to the task branch during an earlier phase (Fix 2's dirty-tree gate didn't see it because it was already committed). Both gates run on every `--pr`/`--push`: Fix 2 stops bad content from being committed; Fix 1 stops bad commits already in branch history from being pushed and PR'd.

**Rename requirement**: When a task legitimately renames a file, both the old path and the new path must appear in the spec's `### Affected Files` table. The two-dot diff with rename detection (`-M`) surfaces both paths; listing only one side leaves the other as apparent drift.

**`--force` bypass**: `canon run <id> --pr --force` overrides the drift die with a loud warning and proceeds. `--force` does NOT bypass a diff-computation failure (when `git diff origin/<base> HEAD` itself fails — fail-closed regardless of `--force`).
```

---

## Step 7 — Add unit tests to `tests/run-task-validation.test.ts`

### 7a. Import additions

Add to the import block at the top:

```typescript
import { execSync } from 'node:child_process';
import { getTreeDriftFiles } from '../scripts/run-task/git.js';
import { verifyBaseDrift, verifyBaseDriftFromData } from '../scripts/run-task/validation.js';
```

### 7b. `describe('verifyBaseDriftFromData', ...)` — AC-7 cases (a-h)

Place after the existing `verifyHandoffAgainstDiffFromData` tests. Use Node's built-in `describe` if available, or inline as sequential `void test(...)` calls under a naming prefix.

The `allowedPaths` parameter is a `ReadonlySet<string>` built inline per test. `PIPELINE_TELEMETRY_FILES` from `worktree.ts` can be imported directly or its values hardcoded as known constants.

```
(a) verifyBaseDriftFromData([], new Set(), []) → []
(b) verifyBaseDriftFromData(['docs/codebase-map.md'], new Set(['docs/codebase-map.md']), ['task-a']) → []
(c) verifyBaseDriftFromData(['docs/decisions.md'], new Set(['docs/codebase-map.md']), ['task-a']) → ['docs/decisions.md']
(d) verifyBaseDriftFromData(['tasks/task-a/handoff.md'], new Set(), ['task-a']) → []
    (task-dir prefix match, not allowedPaths lookup)
(e) verifyBaseDriftFromData(['docs/pipeline-invocations.md'], new Set(['docs/pipeline-invocations.md']), ['task-a']) → []
    (telemetry file in allowedPaths)
(f) bundle: verifyBaseDriftFromData(['docs/codebase-map.md', 'scripts/run-task/main.ts'],
      new Set(['docs/codebase-map.md', 'scripts/run-task/main.ts']), ['task-a', 'task-b']) → []
(g) verifyBaseDriftFromData(['docs/deleted-file.md'], new Set(), ['task-a']) → ['docs/deleted-file.md']
    (deleted paths treated like any path — not in allowedPaths → drift)
(h) rename proof: diffFiles = ['old/path.ts', 'new/path.ts'], allowedPaths = new Set(['new/path.ts']), taskIds = ['task-a']
    → ['old/path.ts']   (only new path in spec → old path is drift)
```

### 7c. `describe('verifyBaseDrift', ...)` — AC-9, AC-10, and Mode 1 proof (AC-8d)

These tests use real git repos. Add a helper at the file scope (or locally) to set up a bare origin + local clone:

```typescript
function makeGitFixture(dir: string): { localDir: string; originDir: string } {
    const originDir = path.join(dir, 'origin.git');
    const localDir = path.join(dir, 'local');
    fs.mkdirSync(originDir, { recursive: true });
    execSync('git init --bare ' + originDir);
    execSync('git clone ' + originDir + ' ' + localDir, { stdio: 'ignore' });
    execSync('git -C ' + localDir + ' config user.email "test@test.com"');
    execSync('git -C ' + localDir + ' config user.name "Test"');
    fs.writeFileSync(path.join(localDir, 'initial-fixture.txt'), 'initial');
    execSync('git -C ' + localDir + ' add initial-fixture.txt');
    execSync('git -C ' + localDir + ' commit -m "initial"');
    execSync('git -C ' + localDir + ' push origin main');
    return { localDir, originDir };
}
```

Use non-gitignored fixture filename `initial-fixture.txt` per the test-writing pitfalls in `docs/patterns.md`.

Before each test that calls `verifyBaseDrift`, set `process.env.CANON_TASKS_DIR_OVERRIDE` to a temp tasks dir and restore it afterwards. Wrap in try/finally or use a helper.

**Test: AC-9 — offline fetch tolerance**
```
1. dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vbd-offline-'))
2. execSync('git init ' + dir)
3. execSync('git -C ' + dir + ' remote add origin /nonexistent/bad-url')
4. Write tasks/<task-a>/spec.md with empty Affected Files table to temp tasks dir
5. process.env.CANON_TASKS_DIR_OVERRIDE = tempTasksDir
6. result = verifyBaseDrift(['task-a'], 'main', dir)
7. assert result.fetchFailed === true
8. assert result.drift.length === 0
9. assert result.diffFailed === false
```

**Test: AC-10 — diff failure after successful fetch**
```
1. dir = fs.mkdtempSync(...)
2. { localDir, originDir } = makeGitFixture(dir)
   (origin has 'main' with one commit; local clone is up-to-date)
3. Create a new bare local repo (no commits, no HEAD):
   emptyDir = path.join(dir, 'empty-local')
   execSync('git init ' + emptyDir)
   execSync('git -C ' + emptyDir + ' remote add origin ' + originDir)
   execSync('git -C ' + emptyDir + ' fetch origin main')
   (origin/main exists as tracking ref, but no local HEAD)
4. Write tasks/<task-a>/spec.md to temp tasks dir
5. process.env.CANON_TASKS_DIR_OVERRIDE = tempTasksDir
6. result = verifyBaseDrift(['task-a'], 'main', emptyDir)
7. assert result.diffFailed === true
8. assert typeof result.diffError === 'string' && result.diffError.length > 0
9. assert result.fetchFailed === false
```

**Test: AC-8(d) — Mode 1 catch, two-dot semantics proof**
```
1. dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vbd-mode1-'))
2. { localDir, originDir } = makeGitFixture(dir)
3. Create task branch in local:
   execSync('git -C ' + localDir + ' checkout -b task/demo')
   fs.writeFileSync(path.join(localDir, 'scripts/run-task/main.ts'), 'task content')
   execSync('git -C ' + localDir + ' add scripts/')
   execSync('git -C ' + localDir + ' commit -m "task change"')
4. Simulate third-party commit advancing origin/main:
   thirdPartyDir = path.join(dir, 'third-party')
   execSync('git clone ' + originDir + ' ' + thirdPartyDir, { stdio: 'ignore' })
   execSync('git -C ' + thirdPartyDir + ' config user.email "third@test.com"')
   execSync('git -C ' + thirdPartyDir + ' config user.name "Third"')
   fs.mkdirSync(path.join(thirdPartyDir, 'docs'), { recursive: true })
   fs.writeFileSync(path.join(thirdPartyDir, 'docs/decisions.md'), 'third-party content')
   execSync('git -C ' + thirdPartyDir + ' add docs/decisions.md')
   execSync('git -C ' + thirdPartyDir + ' commit -m "third-party advance"')
   execSync('git -C ' + thirdPartyDir + ' push origin main')
5. Write spec.md for task-a: Affected Files lists 'scripts/run-task/main.ts', NOT 'docs/decisions.md'
   Spec must have a '## Design' section and '### Affected Files' table.
   Use existing writeAffectedFilesSpec pattern or write raw markdown.
   Set process.env.CANON_TASKS_DIR_OVERRIDE = tempTasksDir
6. result = verifyBaseDrift(['task-a'], 'main', localDir)
7. assert result.fetchFailed === false
   assert result.diffFailed === false
   assert result.drift includes 'docs/decisions.md'
   assert !result.drift.includes('scripts/run-task/main.ts')

Proof: if getTreeDriftFiles used three-dot diff, 'docs/decisions.md' would NOT appear in the diff
(three-dot only shows what changed on task/demo since the merge base with main, and the task never
touched docs/decisions.md). The test would fail with result.drift === []. Passing this test proves
the two-dot implementation is required.
```

Note: The `scripts/run-task/main.ts` directory may need to be created in the temp fixture: `fs.mkdirSync(path.join(localDir, 'scripts/run-task'), { recursive: true })` before writing the file.

---

## Step 8 — Extend fake git and add integration tests in `tests/run-task-safety.test.ts`

### 8a. Extend `setupFakeGit` in `tests/run-task-safety.test.ts`

In `setupFakeGit` at line 43, insert a new case in the fake git shell script to handle the base-drift two-dot diff. Insert **before** the existing `diff --cached --name-only` case (lines 85-88) so the non-cached diff case is checked first:

```javascript
'if [ "${1:-}" = "diff" ] && [ "${2:-}" != "--cached" ]; then',
'  if [ -n "${FAKE_GIT_DRIFT_FILES:-}" ]; then',
'    OLDIFS="$IFS"',
'    IFS=","',
'    for FILE in $FAKE_GIT_DRIFT_FILES; do',
'      printf "M\\0%s\\0" "$FILE"',
'    done',
'    IFS="$OLDIFS"',
'  fi',
'  exit 0',
'fi',
```

`FAKE_GIT_DRIFT_FILES` is a comma-separated list of paths. The fake git outputs each as NUL-delimited `M\0<path>\0` format, which `parseNameStatusOutput` parses correctly (since `gitSafeAtRaw` uses `encoding: 'utf8'` and NUL bytes survive the `spawnSync` + string split).

### 8b. Extend `runHumanReviewCommit` to accept `FAKE_GIT_DRIFT_FILES`

`FAKE_GIT_DRIFT_FILES` is passed via the `env` parameter to `runHumanReviewCommit` — no change to the function signature needed. Callers just include it in the env object.

### 8c. Add `describe('commitHumanReviewFiles base-drift gate', ...)` — AC-8 (a-c)

Place after existing `commitHumanReviewFiles` tests. Use `setupHumanReviewHarness` + `runHumanReviewCommit`.

**Test (a): file matches spec Affected Files → no drift, proceeds normally**
```
writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['docs/codebase-map.md'])
FAKE_GIT_DRIFT_FILES: 'docs/codebase-map.md'   ← in Affected Files, so allowedPaths includes it
FAKE_GIT_STATUS_OUTPUT: ' M docs/codebase-map.md'
Result: status === 0, no 'base-drift' in combined output
```

**Test (b): drift file not in spec → die**
```
writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['scripts/run-task/main.ts'])
FAKE_GIT_DRIFT_FILES: 'docs/decisions.md'
Result: status !== 0
combinedOutput(result) includes 'docs/decisions.md'
combinedOutput(result) includes '--force'
combinedOutput(result) includes 'PIPELINE_TELEMETRY_FILES'
combinedOutput(result) does NOT include 'git checkout HEAD --'
```

**Test (c): same drift with --force → warn and proceed**

Before implementing, check how existing tests in `run-task-safety.test.ts` inject `--force`. Search for `cliArgs.force`, `--force`, or `FORCE` in the test file to find the established pattern. If no env-var override exists, inject via `process.argv` in the inline script:

```javascript
// In runNodeInline script:
"process.argv.push('--force');",
"import { commitHumanReviewFiles } from './scripts/run-task/main.ts';",
`commitHumanReviewFiles(${JSON.stringify(taskIds)}, ${JSON.stringify(harness.dir)}, false);`,
```

The `process.argv.push('--force')` line must appear before the import if `parseArgs` runs at module load time, or before the function call if it runs lazily. Check `scripts/run-task/main.ts` and `scripts/run-task/cli.ts` to determine when `cliArgs` is populated.

```
Same spec and FAKE_GIT_DRIFT_FILES as test (b).
Add --force injection.
Result: status === 0
combinedOutput(result) includes '--force override'
combinedOutput(result) includes 'docs/decisions.md'
```

---

## Step 9 — Build

Run `npm run build` to regenerate `dist/cli/index.js` and `dist/scripts/run-task.js`. Both are in Affected Files and must be committed so CI's `git diff --exit-code -- dist/` gate passes.

---

## Validation order

1. `npm run lint`
2. `npm run type-check`
3. `npm test` — full suite; new tests must pass, no regressions
4. `npm run build` — dist must match source
5. Verify AC-5 die message substrings by reading the source string in `main.ts`: must contain `tasks/<id>/`, `PIPELINE_TELEMETRY_FILES`, `Affected Files`, `git rebase origin/`, `git checkout origin/`, `git revert`, `rename`, `--force`; must NOT contain `git checkout HEAD --`
6. Verify AC-12: run `canon --help` and `canon run --help` (or read source strings) — both `--pr` and `--push` mention base-drift and `--force`

---

## Rollback

Revert adds one die/warn path in `commitHumanReviewFiles`; all non-drifted runs are unaffected. No schema changes, no template changes, no data migration concerns.
