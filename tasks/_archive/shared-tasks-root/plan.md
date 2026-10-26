# Implementation Plan: shared-tasks-root

> Written by: Claude | Implements: `tasks/shared-tasks-root/spec.md`

## Approach

Add one side-effect-free module, `src/lib/project-root.ts`, that owns project-root resolution, the tasks/templates dir helpers, the boolean task-id rule and the task-entry predicate. Route `env.ts` (`REPO_ROOT`), `src/task/templates.ts`, the scan/scaffold sites in `src/task/index.ts`, and `doctor` through it. The three "absolute means override" sites switch to an explicit override check and keep their literal `tasks` defaults. Spec review verdict was `approved` with no nits, so nothing carries over from review.

**Feasibility check**

- **Exists:** confirmed by grep. `tasksRoot()` / `templatesRoot()` / `taskTemplateOverrideRoot()` / `resolveTaskTemplateSource()` are in `src/task/templates.ts:10-33`. `resolveRepoRoot()` is in `src/orchestrator/env.ts:26-56` and is the only `spawnSync` user in that file. In `src/task/index.ts`: `validateTaskId` :80, `taskDirFromRoot` :89, `taskDirForCwd` :93, `taskRootForGate` :105, `currentBranchOrEmpty` :161, `remoteDefaultBranchOrEmpty` :168, `listTemplateFiles` :174, `taskNew` :226, `taskList` :281, `resolveMainCheckoutRoot` :1275 (sole caller `resolveExpectedTreeForCtx` :678), `isPipelineOwnedAcceptPath` :1230, `nudgeShippableTasks` :1451. The re-export `export { taskTemplateOverrideRoot }` is at :22, and its only importer is `src/cli/commands/upgrade.ts:7,144`. Also found: `checkActiveOrchestrators` (`src/cli/commands/doctor.ts:632`), `doctorCmd` :723, the `runCanonCliIn` subprocess helper (`tests/cli.test.ts:67`), and the `TSX_LOADER` spawn pattern (`tests/task-cli.test.ts:2877`).
- **Real path:** `src/cli/index.ts` → `taskCmd` (`index.ts:1652`) → `assertManagedInvocationRoot()` (`state.ts:93`, which compares `--show-toplevel` with `REPO_ROOT`) → handler. Per-task reads go `resolveTaskCwd()` → `taskDirForRepoRoot()` (`TASKS_DIR = REPO_ROOT/tasks`) → `REPO_ROOT`. Two existing behaviors matter. First, `REPO_ROOT` is already main-checkout-anchored from subdirs and linked worktrees (parent of the common dir), so per-task reads already work there; only enumeration, scaffold and templates are cwd-relative. Second, with the new resolver a separate-git-dir main tree gets `REPO_ROOT` = working tree. Today it is the gitdir's parent, which makes `classifyInvocationRoot` return `foreign-worktree` and `die()`. So the AC-15 subprocess test exercises that guard too. The re-scaffold path `rescaffoldReview` → `scaffoldTaskArtifact` → `resolveTaskTemplateSource` gets fixed by templates.ts alone, so `review-archive.ts` needs **no change**.
- **Callers:** `tasksRoot()` is called from `taskDirFromRoot`, `taskDirForCwd`, `taskRootForGate`, `taskList`, `isPipelineOwnedAcceptPath`, `nudgeShippableTasks` and `taskTemplateOverrideRoot`, all handled in Steps 3–4. `templatesRoot()` is called from `listTemplateFiles` and `taskNew` (Step 4). `taskTemplateOverrideRoot()` is called from `upgrade.ts` (Step 6) and templates.ts. `resolveMainCheckoutRoot` has one caller (:680). `checkActiveOrchestrators(cwd)` is called from `doctorCmd` and `tests/cli.test.ts:3941-4030`. Those tests either pass a dir with no `tasks/` and no override, or set the override, and both still work with Step 5's signature. `currentBranchOrEmpty()` is also called from post-merge-sync (:1342, :1347), which keeps the default cwd. `validateTaskId`'s throwing contract does not change. `REPO_ROOT` behavior changes only for (a) separate-git-dir or submodule main trees, now the toplevel, and (b) non-git directories, now cwd instead of canon's install dir. `context.ts`, `canon-snapshot.ts` (`cwd: REPO_ROOT`), `metrics.ts`, `git.ts` and `worktree.ts` all mean "the project", so both changes are corrections. `__dirname` stays exported for `canon-snapshot.ts:78`.
- **Tests that can fail:** each prescribed regression test fails on pre-fix code for the reason below.
  - AC-1: pre-fix, `tasksRoot()='tasks'` resolves to `<sub>/tasks`, so the output is `No tasks found.`
  - AC-2: pre-fix, `templatesRoot()` is `<sub>/.canon/templates`, so it errors and leaves `<sub>/tasks/<id>` behind.
  - AC-3: pre-fix, `mkdirSync` runs before `listTemplateFiles()`, so the dir is left behind.
  - AC-4: pre-fix, `REPO_ROOT` is the install dir, so `status` errors with `No status.json found`.
  - AC-5: guards against a regression rather than failing pre-fix. It fails if any of the three sites uses the absolute tasks dir.
  - AC-6: pre-fix, the list enumerates the worktree's own `tasks/` and misses `late-task`.
  - AC-7: pre-fix, the task is written into the worktree's `tasks/` and `base_branch=task/<other>`.
  - AC-9: pre-fix, the subdir templates are missing, so it takes the `no-template` warning path.
  - AC-10: pre-fix, doctor from a subdir reports `.canon/templates/` missing and finds no `tasks/`.
  - AC-11: pre-fix, the subdir path is wrong.
  - AC-15 separate-git-dir unit case: fails on a parent-of-common-dir implementation. The AC-15 subprocess case also dies pre-fix in the foreign-worktree guard.
- **Predicates:**
  - `isValidTaskId`: same regex and the same `..` rule. Rejects `''`, `_x`, `.x`, `Upper` and `a..b`.
  - `isTaskEntry`: the name must pass `isValidTaskId`, and `statSync` must say it is a directory. A stat error (ENOENT, a dangling symlink) returns false. A file with a valid name returns false.
  - Override: treat empty-string `CANON_TASKS_DIR_OVERRIDE` as unset (truthiness), matching `state.ts:97,294`. A relative override resolves with `path.resolve()` against `process.cwd()`. `upgrade.ts` keeps the spec's literal `?? 'tasks'` form (AC-9 "unchanged").
  - Main vs linked tree: compare `realpath(gitDir) === realpath(commonDir)`. In the main tree, run `--show-toplevel`, and if that fails (cwd inside `.git`, a bare repo) fall back to `dirname(commonDir)`. In a linked tree, use `dirname(commonDir)`. If git fails, use the `cwd` argument.
- **Scope:** every changed file is in Affected Files. `review-archive.ts` is listed as "only if needed" and is not needed. `templates/docs/patterns.md` is a separate adopter scaffold rather than a sync mirror of `docs/patterns.md` (the files differ, and neither is in `CANON_OWNED`), so `sync-templates` is unaffected.
- **Async/stateful:** everything is synchronous. The resolver is evaluated per call (AC-4). `REPO_ROOT` stays an import-time constant (Known Risk: in-process tests). No new state is introduced.

**Decisions recorded (unattended session):**

1. At the three override sites, a relative `CANON_TASKS_DIR_OVERRIDE` now resolves against cwd (`path.resolve(override)`). That matches `taskDirFor`/`statusFileFor` in `state.ts`, which join the raw override, and the spec's tasks-dir definition. Before, it resolved under `resolveTaskCwd()` or the git toplevel. No test or doc uses a relative override (all 217 test usages are absolute temp paths).
2. `checkActiveOrchestrators(cwd)` keeps its `cwd` parameter and enumerates `tasksDir(cwd)`, which is the override when set and `<cwd>/tasks` otherwise. `doctorCmd` passes the resolved project root. This honors the override and keeps the existing direct-call tests valid without the doctor reading canon-ai's real `tasks/` during the suite.
3. `resolveTaskTemplateSource()` takes an optional `projectRoot`, so `taskNew` resolves git once rather than twice per template.

## Steps

### Step 1: New module `src/lib/project-root.ts`

Files: `src/lib/project-root.ts`

Imports only `node:child_process`, `node:fs` and `node:path`. Nothing from `src/task/` or `src/orchestrator/`, to avoid an import cycle through `env.ts` → `state.ts`. No top-level side effects.

```ts
export function resolveProjectRoot(cwd: string = process.cwd()): string {
    const dirs = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'],
        { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (dirs.error || dirs.status !== 0) return path.resolve(cwd);
    const [gitDir, commonDir] = (dirs.stdout ?? '').trim().split('\n').map(s => s.trim());
    if (!gitDir || !commonDir) return path.resolve(cwd);
    if (safeRealpath(gitDir) !== safeRealpath(commonDir)) return path.dirname(commonDir); // linked worktree
    const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const toplevel = top.error || top.status !== 0 ? '' : (top.stdout ?? '').trim();
    return toplevel || path.dirname(commonDir);
}
export function tasksDirOverride(): string | null   // resolved CANON_TASKS_DIR_OVERRIDE, or null when unset/empty
export function tasksDir(projectRoot: string = resolveProjectRoot()): string  // tasksDirOverride() ?? join(projectRoot, 'tasks')
export function templatesDir(projectRoot: string = resolveProjectRoot()): string  // join(projectRoot, '.canon', 'templates')
export function isValidTaskId(id: string): boolean  // /^[a-z0-9][a-z0-9._-]*$/ && !id.includes('..')
export function isTaskEntry(tasksDirPath: string, name: string): boolean  // isValidTaskId(name) && statSync(join).isDirectory(), false on error
```

Copy the local `safeRealpath` (realpath, falling back to the input on error). Don't import it from `src/task/index.ts`. Put a short header comment explaining the main-tree vs linked-tree split and the non-git fallback, and why parent-of-common-dir is wrong for separate-git-dir and submodule main trees. This module is the only place outside comments and `completion.ts` where `--git-common-dir` may appear (AC-12).

The output of the two-flag `rev-parse` call is one path per line. Keep `--show-toplevel` as a separate call: inside `.git`, the combined call exits 128 after printing the first two lines (verified with git 2.56).

### Step 2: `env.ts` uses the shared resolver

Files: `src/orchestrator/env.ts`

- Delete `resolveRepoRoot()` and its `__dirname` fallback.
- Set `export const REPO_ROOT = resolveProjectRoot();`.
- Drop the now-unused `spawnSync` import, which lint would otherwise flag.
- Keep `__filename` and `__dirname` exported.
- Replace the long comment with 2–3 lines: `REPO_ROOT` is the supervising main checkout, resolved by `src/lib/project-root.ts`; it is frozen at import; per-task routing goes through `resolveTaskCwd()`. Keep the PR #42 rationale about not using the active worktree's toplevel, condensed.

`TASKS_DIR` and `WORKTREES_ROOT` are unchanged.

### Step 3: `src/task/templates.ts` resolves from the project root

Files: `src/task/templates.ts`

```ts
export function tasksRoot(projectRoot?: string): string { return tasksDir(projectRoot); }
export function templatesRoot(projectRoot?: string): string { return templatesDir(projectRoot); }
export function taskTemplateOverrideRoot(projectRoot?: string): string { return path.join(tasksRoot(projectRoot), '_templates'); }
export function resolveTaskTemplateSource(basename: string, projectRoot: string = resolveProjectRoot()): string | null { /* same body, pass projectRoot through */ }
```

(`tasksDir(undefined)` hits the default parameter, so passing `projectRoot` through is fine.) `scaffoldTaskArtifact` and `isPristineTaskArtifact` keep their signatures and use the default. The `Re-scaffolded review.md from ${path.relative(process.cwd(), source)}` message at `index.ts:1158` already prints relative to cwd, so from the root it is byte-identical (`.canon/templates/review.md`), and from a subdir it prints `../.canon/templates/review.md` (cosmetic Known Risk).

### Step 4: `src/task/index.ts`

Files: `src/task/index.ts`

1. **Id rule.** `validateTaskId` keeps its two distinct error messages. Restructure it as `if (isValidTaskId(id)) return;`, then reproduce the existing branch order (regex failure message first, then the `..` message), so the messages are byte-identical. Import `isValidTaskId`, `isTaskEntry`, `resolveProjectRoot`, `tasksDir` and `tasksDirOverride` from `../lib/project-root.js`.
2. **Three override sites.** Make the override check explicit and use the literal `'tasks'` default. Do **not** use `tasksRoot()` or `tasksDir()` here.
   ```ts
   function taskDirForCwd(_cwd: string, taskId: string): string {
       const override = tasksDirOverride();
       return override ? path.join(override, taskId) : path.join(resolveTaskCwd(taskId), 'tasks', taskId);
   }
   function taskRootForGate(cwd: string): string {
       return tasksDirOverride() ?? path.join(cwd, 'tasks');
   }
   // isPipelineOwnedAcceptPath:
   const rootAbsolute = tasksDirOverride() ?? path.resolve(repoRootForPaths, 'tasks');
   ```
   Add a one-line comment at each site: "explicit override check — the shared tasks dir is absolute and must not replace worktree routing".
3. **`taskDirFromRoot(taskId, root = tasksRoot())`** returns `path.join(root, taskId)`. It now resolves to the main checkout's tasks dir.
4. **`currentBranchOrEmpty(cwd?: string)` / `remoteDefaultBranchOrEmpty(cwd?: string)`.** Pass `{ cwd }` through to `runGit`. Post-merge-sync callers stay argument-less.
5. **`listTemplateFiles(root = templatesRoot())`.** Same body and error message.
6. **`taskNew` reorder.** Compute `projectRoot = resolveProjectRoot()` once.
   - `taskDir = taskDirFromRoot(id, tasksRoot(projectRoot))`.
   - Existence check, with the message path given by `displayPath(taskDir)`.
   - `const templateFiles = listTemplateFiles(templatesRoot(projectRoot));`. This throws before any `mkdir` (AC-3).
   - Base branch: `currentBranchOrEmpty(projectRoot) || 'main'` and `remoteDefaultBranchOrEmpty(projectRoot)`. The warning text is unchanged. In the main checkout this is the same branch as today (AC-7 risk note).
   - `mkdirSync`, then the loop using `resolveTaskTemplateSource(basename, projectRoot) ?? path.join(templatesRoot(projectRoot), basename)`.
   - `printCreatedTask(id, displayPath(taskDir), baseBranch)`. Note that `printCreatedTask` calls `fs.readdirSync(taskDir)`, so either pass both the absolute dir and the display string, or read from the absolute dir. Don't `readdirSync` a relative display path.

   Add `displayPath(p)`:
   ```ts
   function displayPath(p: string): string { return path.relative(safeRealpath(process.cwd()), safeRealpath(p)) || '.'; }
   ```
   Realpath is applied on both sides because of macOS `/var` vs `/private/var`. `safeRealpath` already exists at :1283 and handles a not-yet-existing leaf. From the root this yields `tasks/<id>` (AC-11 byte-identical, so `tests/task-cli.test.ts:338` passes). From a subdir it yields `../tasks/<id>`.
7. **`taskList`.** `const root = tasksRoot();`. Replace the `_archive`/`_templates` filter with `if (!isTaskEntry(root, entry)) continue;`, placed before the orphan check. The rest is unchanged, and rows still read through `taskDirForCwd(process.cwd(), entry)` → `resolveTaskCwd`. Do not bypass it.
8. **`nudgeShippableTasks`.** `const root = tasksRoot();`, `if (!isTaskEntry(root, entry)) continue;`. Status reads stay `path.join(root, entry, 'status.json')` (Non-Goal).
9. **Remove `resolveMainCheckoutRoot`** and its doc comment. `resolveExpectedTreeForCtx` returns `resolveProjectRoot()`. Trim the comment block at :668-677 so it no longer says "through `--git-common-dir`"; say "the shared project-root resolver (`src/lib/project-root.ts`)" instead.
10. **Remove the `export { taskTemplateOverrideRoot } from './templates.js';` re-export** (:22). Its only importer, upgrade.ts, stops using it in Step 6. Grep `tests/` first. If a test imports it from `src/task/index.js`, keep the re-export.

After these edits, `grep -n "'_archive'\|'_templates'" src/task/index.ts` must be empty (AC-8).

### Step 5: `doctor.ts`

Files: `src/cli/commands/doctor.ts`

- `doctorCmd`: `const cwd = resolveProjectRoot();`. Every project check already takes `cwd`, so nothing else changes. Leave env checks alone.
- `checkActiveOrchestrators(cwd, now)`: `const tasksDirPath = tasksDir(cwd);` (override when set, else `<cwd>/tasks`). Replace `if (id === '_archive') continue;` with `if (!isTaskEntry(tasksDirPath, id)) continue;`. Keep the JSDoc and note that it honors `CANON_TASKS_DIR_OVERRIDE`.
- Afterwards, `grep -n "'_archive'\|'_templates'" src/cli/commands/doctor.ts` is empty.

### Step 6: `upgrade.ts` stale-override path

Files: `src/cli/commands/upgrade.ts`

Change :144 to `const overrideRootAbs = resolve(cwd, process.env.CANON_TASKS_DIR_OVERRIDE ?? 'tasks', '_templates');` and drop the `taskTemplateOverrideRoot` import (:7). The existing `runUpgrade staleOverrides` tests (`tests/cli.test.ts:2096-2200`) must pass unchanged.

### Step 7: Tests

Files: `tests/project-root.test.ts`, `tests/task-cli.test.ts`, `tests/cli.test.ts`, `tests/completion.test.ts`

**Shared subprocess env.** Each new subprocess test builds its env from `process.env` with these deleted: `CANON_TASKS_DIR_OVERRIDE`, `CANON_WORKTREES_ROOT`, `CANON_SKIP_PHASE_GATE`, and `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_INDEX_FILE`. The pipeline or hooks may set these, and a leftover override would make every test pass vacuously. Spawn as `spawnSync(process.execPath, ['--import', TSX_LOADER, path.join(WORKSPACE_ROOT, 'src', 'cli', 'index.ts'), ...args], { cwd, env, encoding: 'utf8' })`, following `tests/task-cli.test.ts:2877`. Put it in a small `runCli(cwd, args)` helper in `task-cli.test.ts`. Fixtures are created with `fs.mkdtempSync(path.join(os.tmpdir(), …))`, never under the repo (Known Risk). Init repos with `git init -b main`, set `user.email`/`user.name`, and make one commit, following `tests/task-cli.test.ts:503-516`.

**Fixture task.** Write `status.json` with the existing `makeStatus(id, overrides)` helper (`tests/task-cli.test.ts:72`).

`tests/project-root.test.ts` (new). Use `process.chdir` with try/finally restore, and compare with `fs.realpathSync` on both sides.
- An ordinary repo: from `<repo>/sub/deep`, `resolveProjectRoot()` returns `<repo>` (AC-15).
- `git init --separate-git-dir <x>/gitdir <x>/work`, with cwd `<x>/work/sub`: returns `<x>/work`, and `assert.notEqual` against `<x>` (AC-15; this fails on parent-of-common-dir).
- A linked worktree `git worktree add <x>/wt` from `<x>/wt/sub` returns the main checkout (AC-15).
- Non-git, `mkdtemp` under `os.tmpdir()`: returns that dir (AC-4).
- Per-call evaluation: chdir into repo A, call; chdir into repo B, call; the results differ and match each repo (AC-4).
- `resolveProjectRoot(explicitCwd)` honors the argument.
- `tasksDir()`: an absolute override is returned; a relative override resolves against cwd; `''` is treated as unset → `<root>/tasks`. `templatesDir()` is `<root>/.canon/templates`.
- `isTaskEntry` (AC-8). Accepts a valid task dir. Rejects `_archive`, `_templates` and `_anything` dirs; `.DS_Store` as a file **and** as a dir; a regular file named `valid-id`; an `Upper` dir; and a missing name.
- `isValidTaskId` accepts `a`, `a.b-c_d` and `0x`, and rejects `''`, `a..b`, `-a` and `a/b`.

`tests/task-cli.test.ts` (subprocess unless noted):
- **AC-1:** repo with `tasks/t1/status.json` (`worktree:false`). Run `task list` with cwd `<repo>/sub`. Assert status 0 and stdout matches `/\bt1\b/`.
- **AC-2 + AC-11:** repo with `.canon/templates` copied from `WORKSPACE_ROOT/.canon/templates` (as in `:321`). Run `task new sub-made 'Sub made'` with cwd `<repo>/sub`. Assert `<repo>/tasks/sub-made/spec.md` exists, `<repo>/sub/tasks` does not exist, and stdout includes `Created task: ../tasks/sub-made`. Repeat the same command and assert stderr includes `Task directory ../tasks/sub-made already exists`.
- **AC-3** (in-process is fine): a temp non-git dir with no `.canon/templates`, no override, `withCwd`. `assert.throws(() => taskNew(['no-tpl', 'X']), /templates directory not found/)`, then assert `tasks/no-tpl` does not exist (and `tasks/` is absent too).
- **AC-4:** a non-git temp dir with `.canon/templates` copied. Run `task new demo Demo`. `task status demo` returns 0. `task set demo title Renamed` returns 0, and `./tasks/demo/status.json` has `title === 'Renamed'`. `task list` stdout contains `demo`. Assert no non-git fixture path is created under `WORKSPACE_ROOT`.
- **AC-5:** fixture `repo` with the worktree at the **default** managed location `<repo>/.canon/worktrees/rt` (branch `task/rt`), so `assertManagedInvocationRoot` classifies it `canon-worktree`. Use no `CANON_WORKTREES_ROOT`, and add `.canon/worktrees/` to `<repo>/.git/info/exclude`.
  - Both `<repo>/tasks/rt/status.json` and `<worktree>/tasks/rt/status.json` hold `makeStatus('rt', { worktree: true, branch: 'task/rt', task_size: 'S', human_spec_gate: false })` with `phases.spec.status = 'in_progress'`.
  - `<repo>/tasks/rt/spec.md` is the unfilled template (`renderTaskTemplate`-equivalent: copy `.canon/templates/spec.md`). `<worktree>/tasks/rt/spec.md` is filled content. `isTemplateUnfilled` (`src/orchestrator/validation.ts:833`) treats content as unfilled exactly when it still contains the raw task-id placeholder, so the main copy is the raw `.canon/templates/spec.md` copied unrendered, and the worktree copy is any text without that placeholder.
  - Run `task set rt task_size L` from cwd = worktree and `task set rt task_size XL` from cwd = repo. Assert that the worktree copy ends at `XL` and the main copy stays `S`.
  - With `CANON_SKIP_PHASE_GATE` unset, run `task phase rt spec done` from the worktree. Assert status 0, the worktree `phases.spec.status === 'done'`, and the main copy still `in_progress`.
  - Second fixture (or reset): the main copy filled and the worktree copy unfilled. The same command exits non-zero with `unfilled template`. This proves the gate reads the worktree.
  - The existing `task set routes writes to the task worktree status.json` (:503) and the worktree accept tests stay unchanged.
- **AC-6:** the AC-5-style fixture. After `git worktree add`, create `<repo>/tasks/late-task/status.json` (`worktree:false`). The `rt` worktree copy has a different current phase from the main copy (for example worktree `implement` in_progress and main `plan`). Run `task list` from cwd = worktree. Assert both `late-task` and `rt` appear, and that the `rt` row shows the worktree copy's phase.
- **AC-7:** the same fixture with `.canon/templates` in `<repo>` and the main checkout on `main`. Run `task new from-wt 'From wt'` (no `--base`) from cwd = worktree. Assert that `<repo>/tasks/from-wt/status.json` exists with `base_branch === 'main'`, that `<worktree>/tasks/from-wt` does not exist, and that `task status from-wt` from the worktree returns 0.
- **AC-9:** repo with `.canon/templates` (including `review.md`). Create task `rr` with `codeReviewBlockedStatus('rr')` (:1084) and a non-pristine `review.md`. Run `task reset-code-review rr` with cwd `<repo>/sub`. Assert status 0, stdout matches `Re-scaffolded review.md from ../.canon/templates/review.md`, and the new `review.md` equals `renderTaskTemplate(<repo>/.canon/templates/review.md, 'rr', <title>)` (import it from `../src/task/templates.js`).
- **AC-15 subprocess:** a separate-git-dir fixture (`git init -b main --separate-git-dir <x>/gitdir <x>/work`, plus a commit) with `<x>/work/tasks/sg/status.json`. Run `task list` from `<x>/work/sub`. Assert status 0 and `sg` in stdout. Pre-fix this dies in the foreign-worktree guard, or reports no tasks.

`tests/cli.test.ts`:
- **AC-10:** a git fixture repo with `.canon/templates` copied and `tasks/live/status.json` built by `statusWithInProgressPhase()` (:3934) with no heartbeat. Run `runCanonCliIn(<repo>, ['doctor'], env)` and `runCanonCliIn(<repo>/sub, ['doctor'], env)`, using the stripped env above. The exit code may be non-zero because env checks such as missing binaries can fail, so don't assert on it. Slice stdout from the `Canon setup` heading to the end, and assert the two slices are equal. Also assert the subdir slice contains the `.canon/templates/` check line as a pass (match on the label `checkTemplates` emits; read `doctor.ts:239`) and `orchestrator live` with a warn icon.

`tests/completion.test.ts`:
- **AC-8 pin:** import `validateTaskId` from `../src/task/index.js`. For `_x`, `_archive`, `_templates`, `.x` and `.DS_Store`, assert `assert.throws(() => validateTaskId(id))`. Add a comment that this keeps the shell scripts' `_*`/`.*` filter equivalent to the id rule.

### Step 8: Docs

Files: `docs/patterns.md`, `docs/codebase-map.md`

- In the `docs/patterns.md` "Worktree runs" section (:144-146), append one sentence after the paragraph. Enumeration and scaffolding (`canon task list`, `canon task new`, `doctor`, template lookups) resolve through `resolveProjectRoot()` in `src/lib/project-root.ts`, so `canon task new` scaffolds into the main checkout's `tasks/` from any directory, including a subdirectory or a task worktree. Per-task reads and writes still go through `resolveTaskCwd()`.
- Replace the `docs/patterns.md` pitfall bullet at :270 (`git rev-parse --git-common-dir` depends on checkout type) with these points:
  - The shared resolver `resolveProjectRoot()` (`src/lib/project-root.ts`) is the one place that reads the git common dir. `REPO_ROOT` uses it.
  - Main working tree (git dir equals common dir after realpath): `--show-toplevel`. That is correct for ordinary, separate-git-dir and submodule checkouts.
  - Linked worktree: the parent of the common dir.
  - Non-git: the current directory.
  - Linked worktrees of separate-git-dir or submodule checkouts remain unsupported, because git does not record that main working tree.
- In `docs/codebase-map.md`, add a row after the `src/lib/pipeline-policy.ts` row (:51): `| Project root / tasks dir resolution | src/lib/project-root.ts | resolveProjectRoot(), tasksDir(), templatesDir(), isValidTaskId(), isTaskEntry(); side-effect-free, no task/orchestrator imports |`. Also update the `env.ts` row (:69) to say `REPO_ROOT` comes from it.

### Step 9: Build and validate

Files: `dist/cli/index.js`, `dist/orchestrator/run-task.js`

Run `npm run build && npm run type-check && npm run lint && npm test`, then `npm run docs-refs-check`, `npm run sync-templates:check`, and `git diff --exit-code tests/completion.golden.json`. Commit the rebuilt `dist/`. AC-12 grep:

```
grep -rn -- '--git-common-dir' src | grep -v '^src/lib/project-root.ts' | grep -v '^src/cli/commands/completion.ts'
```

Every remaining hit must be a comment.

## Testing Plan

- **Unit:** `tests/project-root.test.ts` (resolver branches, per-call evaluation, override, predicate, id rule) and the `tests/completion.test.ts` id-rule pin.
- **Subprocess/E2E:** `tests/task-cli.test.ts` covers AC-1, AC-2/11, AC-4, AC-5, AC-6, AC-7, AC-9 and AC-15, plus AC-3 in-process. `tests/cli.test.ts` covers AC-10. These must be subprocesses: `REPO_ROOT` is frozen at import (Known Risk).
- **Regression:** the existing suites pass unchanged, specifically `task new creates a task…` (:319, message `tasks/new-task`), the worktree-routing test (:503), the accept tests, `checkActiveOrchestrators` (:3941+), `runUpgrade staleOverrides` (:2096+) and `completion.golden.json`.
- **Manual:** the spec's Human Test Plan (QA / human).

## Rollback Plan

Revert the commit. No data or format migration is involved: task dirs, `status.json` and templates keep their location and shape. The only user-visible differences are task-dir paths printed relative to the shell directory and invalid-name dirs no longer listed. Both disappear on revert.

## Reroute Plan

### Round Scope

This round covers the implement-round-1 amendment (AC-16, AC-17, and the amended AC-4), plus the original ACs the handoff left Partial: AC-5 (the no-override, gate-on worktree fixture) and AC-9 (a `reset-code-review` subprocess run from a subdirectory). The amendment review is `approved` with no nits. There is no archived code review for this round.

Everything else from the original plan is implemented in the worktree and is **not** re-planned. That covers Steps 1–3, Step 4 (all items), Steps 5, 6 and 8, and the AC-1/2/3/6/7/8/10/11/12/14/15 tests, which the handoff marks Met.

**Feasibility check**

- **Exists:** confirmed by reading the code.
  - `resolveProjectRoot()` in `src/lib/project-root.ts` contains the legacy branch to remove: the `const legacy = spawnSync('git', ['rev-parse', '--git-common-dir'], …)` block.
  - `taskCmd()` is at `src/task/index.ts:1646`. Its order is `handlePreScan` → `assertManagedInvocationRoot()` (:1655) → `switch`, and its `catch` prints `error.message` and calls `exit(1)`.
  - `setupFakeGit()` is at `tests/run-task-safety.test.ts:87`. Its `--git-common-dir` branch is at :93 and its `--show-toplevel` branch at :97. An unknown argv hits the trailing `unexpected git args` → `exit 1`.
  - `runFakeMain()` is at :599. It sets `FAKE_GIT_COMMON_DIR=<localDir>/.git` and `FAKE_GIT_ACTIVE_TOPLEVEL=cwd`. `runHumanReviewMain()` is at :1852 and sets `FAKE_GIT_COMMON_DIR='.git'` (relative), with cwd = `harness.dir` and no `FAKE_GIT_ACTIVE_TOPLEVEL`.
  - These non-git `task new` fixtures exist: `tests/task-cli.test.ts:319` (`task new creates a task from templates…`) and :434 (`task new rejects invalid task IDs`); `tests/run-task-canon-snapshot.test.ts:432` (`taskNew stamps canon provenance…`); and the outside-git success test `task commands outside git share the current directory tasks root` in `tests/project-root.test.ts`, which now contradicts amended AC-4.
- **Real path:** `src/cli/index.ts` → `taskCmd` → (new) git probe → `assertManagedInvocationRoot()` → handler. `env.ts` evaluates `REPO_ROOT = resolveProjectRoot()` at import for every command, including the orchestrator `main()` that the fake-git harnesses run. So the fake git must answer the combined call `rev-parse --path-format=absolute --git-dir --git-common-dir`. Today it doesn't. That is why the legacy fallback kept the `invocation-root refusal runs before missing-worktree detection` test (:5017) green: that test needs REPO_ROOT=`localDir` while cwd=`old-worktree`.
- **Callers:**
  - `resolveProjectRoot()` keeps its signature and its return value for every real-git case. Its callers are `env.ts`, `templates.ts`, `index.ts` (`taskNew`, `resolveExpectedTreeForCtx`) and `doctor.ts`.
  - For a git wrapper that does not implement the combined form, the resolver now returns `path.resolve(cwd)` instead of the common dir's parent. The only such wrapper in the suite is `setupFakeGit` (`tests/run-task-signals.test.ts` mentions `--git-common-dir` only in a comment, at :20). The fake is updated in Step 2.
  - `taskCmd`'s new refusal affects every in-process and subprocess caller whose cwd is non-git. I read `tests/recovery-hints.test.ts` (`makeRepo`, a git repo), the task-cli help and flag tests (cwd `WORKSPACE_ROOT`), and run-task-safety :10406/:10439 (real git fixtures), and all of these are inside git. Direct `taskNew()` calls bypass `taskCmd`, so they are not refused.
- **Tests that can fail:**
  - The AC-4 refusal test fails on the current worktree code, where `task new` exits 0 and creates `./tasks`.
  - The AC-16 probe unit test fails until the probe export exists.
  - AC-17: once the legacy branch is removed, the :5017 invocation-order test fails until the fake answers the combined argv. That is the red/green pair for Step 2.
  - AC-5 fails if any of the three override sites uses the absolute tasks dir. The inverse fixture, with the main copy filled and the worktree copy unfilled, fails if the gate reads the main copy.
  - AC-9 fails pre-fix (templates missing from the subdir → `no-template` warning).
- **Predicates:** the probe sets `inGit = true` only when the combined `rev-parse` exits 0 **and** returns two non-empty lines. Everything else gives `inGit = false` and `root = path.resolve(cwd)`: a spawn error, a non-zero status, empty stdout, or only one line. Other states:
  - Inside `.git`, the two-flag call succeeds, so `inGit = true`. `--show-toplevel` fails there and the root falls back to `dirname(commonDir)`. This is unchanged.
  - In a bare repo, `inGit = true`. That is out of scope and unchanged.
  - An empty-string `CANON_TASKS_DIR_OVERRIDE` is already treated as unset.
- **Scope:** every file below is in the original or amendment Affected Files: `src/lib/project-root.ts`, `src/task/index.ts`, `tests/run-task-safety.test.ts`, `tests/project-root.test.ts`, `tests/task-cli.test.ts`, `tests/run-task-canon-snapshot.test.ts`, and `dist/*`. `src/orchestrator/state.ts` stays untouched (AC-16). The stale comment in `tests/run-task-signals.test.ts:20` is outside scope, so leave it.
- **Async/stateful:** N/A. The probe is synchronous, runs per call, and holds no state.

**Decisions recorded (unattended session):**

1. **Refusal placement.** The refusal runs after `handlePreScan` and before `assertManagedInvocationRoot()`. `--help`, `-h` and unknown-option errors have no filesystem effects, so they keep working outside git. Every subcommand path, including unknown subcommands, hits the refusal before any task logic. This satisfies AC-16's "before any subcommand logic", because pre-scan is argument parsing rather than subcommand logic.
2. **No override exemption.** The refusal fires outside git even when `CANON_TASKS_DIR_OVERRIDE` is set, because AC-4 says "every `canon task` subcommand" and gives no exemption.
3. **Error text.** `canon task requires a git repository; run it inside one (git init)`, which is the spec's example verbatim. It goes through the existing `catch` (thrown `Error`) → stderr, exit 1.
4. **Probe API.** Add `probeProjectRoot(cwd)` returning `{ root, inGitRepository }`. `resolveProjectRoot(cwd)` becomes `probeProjectRoot(cwd).root`, and `isInsideGitRepository(cwd)` becomes `probeProjectRoot(cwd).inGitRepository`. Both forms are allowed by AC-16. `taskCmd` uses `isInsideGitRepository()`.

### Step R1: Resolver probe, and remove the legacy fallback (AC-16, AC-17)

Files: `src/lib/project-root.ts`

- Delete the `legacy` block. When the combined call fails or returns fewer than two non-empty lines, return `{ root: path.resolve(cwd), inGitRepository: false }`.
- Move the body into `export function probeProjectRoot(cwd: string = process.cwd()): { root: string; inGitRepository: boolean }`. Keep the main-tree vs linked-tree logic unchanged, with `inGitRepository: true` on both git branches.
- Add `export function resolveProjectRoot(cwd = process.cwd()): string { return probeProjectRoot(cwd).root; }` and `export function isInsideGitRepository(cwd = process.cwd()): boolean { return probeProjectRoot(cwd).inGitRepository; }`.
- Update the header comment: outside git, or when git cannot answer the combined query, the root is cwd and the probe reports no repository.
- Check: `grep -n -- "--git-common-dir" src/lib/project-root.ts` shows only the combined argv, which also passes `--git-dir`, plus comments (AC-17).

### Step R2: Teach the fake git the combined argv (AC-17)

Files: `tests/run-task-safety.test.ts`

- In `setupFakeGit`, before the existing `--git-common-dir` branch, add a branch for `rev-parse --path-format=absolute --git-dir --git-common-dir` (match `$2`, `$3` and `$4`) that runs when `FAKE_GIT_COMMON_DIR` is non-empty. Make the common dir absolute against `$PWD` (`case "$FAKE_GIT_COMMON_DIR" in /*) c="$FAKE_GIT_COMMON_DIR";; *) c="$PWD/$FAKE_GIT_COMMON_DIR";; esac`), then print `${FAKE_GIT_DIR:-$c}` and `$c`, one per line, and `exit 0`. Keep the old single-field branch, because nothing in `src/` calls it any more but it is harmless. Removing it is optional.
- In `runFakeMain`, set `FAKE_GIT_DIR` only when `cwd !== harness.localDir`, to `path.join(harness.localDir, '.git', 'worktrees', path.basename(cwd))`. That makes git-dir differ from the common dir, so the resolver takes the linked-tree branch and returns `localDir`, the same result the legacy path gave. With cwd = `localDir`, git-dir equals the common dir, so the resolver takes the main-tree branch, and `--show-toplevel` → `FAKE_GIT_ACTIVE_TOPLEVEL` = `localDir`.
- `runHumanReviewMain` needs no change. With relative `.git` the fake prints `<harness.dir>/.git` twice. `--show-toplevel` is unanswered (exit 1), so the resolver falls back to `dirname` → `harness.dir`, as before.
- Verify: `invocation-root refusal runs before missing-worktree detection` (:5017) and `entry worktree enumeration failure refuses closed with git stderr` (:5031) pass, and the whole file passes.

### Step R3: Outside-git refusal in `taskCmd` (AC-4, AC-16)

Files: `src/task/index.ts`

- Import `isInsideGitRepository` from `../lib/project-root.js`.
- In `taskCmd`, between the `handlePreScan` branch and `assertManagedInvocationRoot()`, add:
  `if (!isInsideGitRepository()) throw new Error('canon task requires a git repository; run it inside one (git init)');`
  The existing `catch` prints the message and exits 1. This is the only refusal site: no per-subcommand checks, and no changes to `taskNew` or `resolveTaskCwd()`.
- `src/orchestrator/state.ts` must show no diff (`git diff <base> -- src/orchestrator/state.ts` empty).

### Step R4: Tests for the amendment

Files: `tests/project-root.test.ts`, `tests/task-cli.test.ts`, `tests/run-task-canon-snapshot.test.ts`

- `tests/project-root.test.ts`:
  - **Delete** `task commands outside git share the current directory tasks root`. Amended AC-4 inverts its contract, and the replacement is in task-cli below.
  - Add a probe test (AC-16/17). In a non-git temp dir, `probeProjectRoot(dir)` returns `{ root: path.resolve(dir), inGitRepository: false }` and `isInsideGitRepository(dir) === false`. At a git repo root and in its `sub/`, `isInsideGitRepository` is `true` and the root is the repo. Cover the git-failure case too: point `PATH` at a temp dir whose `git` script exits 1 (wrap in a try/finally restoring `process.env.PATH`), and assert that `probeProjectRoot(<a real repo>)` gives `inGitRepository: false` and `root === path.resolve(<repo>)`, so a failing git takes the non-git path and does not fall back to a legacy query.
  - Add the AC-4 per-call test with `process.chdir`. chdir into repo A and call `resolveProjectRoot()`, then chdir into repo B and call it again. Each result equals its repo's realpath. Restore cwd in `finally`. The existing explicit-argument case does not cover the chdir wording.
  - Move `task new reports missing templates without leaving a task directory` (AC-3) into a temp git repo: `git init -q -b main` in `root` before the `chdir`. The assertions stay unchanged.
- `tests/task-cli.test.ts`:
  - Add an **AC-4 refusal** subprocess test. Use a non-git `fs.mkdtempSync(os.tmpdir())` dir with `.canon/templates` copied, so that only the git requirement can cause a refusal, and the stripped env (the same delete-list the existing new tests use). For each of `['task','new','demo','Demo']`, `['task','status','demo']`, `['task','set','demo','title','X']` and `['task','list']`, assert `status === 1`, that stderr matches `/canon task requires a git repository/`, and that `fs.existsSync(<dir>/tasks) === false`.
  - Add `git init -q -b main` to the fixtures of `task new creates a task from templates and rejects existing tasks` (:319) and `task new rejects invalid task IDs` (:434). The other assertions stay unchanged, including `/Task directory tasks\/new-task already exists/`. `--base dev` is explicit, so the base-branch logic is unaffected.
- `tests/run-task-canon-snapshot.test.ts`: in `taskNew stamps canon provenance into the seeded status.json` (:432), run `spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root })` after `mkdtemp`. Use the file's existing git helper if it has one. The assertions stay unchanged.

### Step R5: Unfinished original ACs

Files: `tests/task-cli.test.ts`

- **AC-5:** implement exactly the original plan's Step 7 AC-5 bullet. The handoff marks it Partial and the fixture was never added.
  - The fixture worktree sits at the default `<repo>/.canon/worktrees/rt` (excluded via `.git/info/exclude`). Both copies of `status.json` have `phases.spec.status = 'in_progress'` and `human_spec_gate: false`.
  - `task set rt task_size L` from the worktree, then `task set rt task_size XL` from the repo. The worktree copy ends at `XL` and the main copy stays at its seed.
  - With `CANON_SKIP_PHASE_GATE` deleted from env, `task phase rt spec done` from the worktree exits 0. The main `spec.md` is the raw unrendered `.canon/templates/spec.md` and the worktree `spec.md` is filled text. Afterwards the worktree copy is `done` and the main copy is still `in_progress`.
  - The inverse fixture (main filled, worktree unfilled) exits non-zero, with stderr matching the gate's unfilled-template message. Take the exact text from the gate's error in `src/task/index.ts` rather than assuming it.
  - Reuse the stripped-env `invoke` pattern from the existing `task list and task new from a managed worktree…` test.
- **AC-9:** implement the original plan's Step 7 AC-9 bullet. Use a git repo with `.canon/templates`, task `rr` seeded with `codeReviewBlockedStatus('rr')`, and a non-pristine `review.md`. Run `task reset-code-review rr` as a subprocess with cwd `<repo>/sub`. Assert:
  - exit 0;
  - stdout matches `Re-scaffolded review.md from ../.canon/templates/review.md`;
  - the new `review.md` equals `renderTaskTemplate(<repo>/.canon/templates/review.md, 'rr', <title>)`.

### Step R6: Build and validate

Files: `dist/cli/index.js`, `dist/orchestrator/run-task.js`

Run `npm run build && npm run type-check && npm run lint && npm test`, then `npm run docs-refs-check`, `npm run sync-templates:check` and `git diff --exit-code tests/completion.golden.json`.

Grep checks:
- AC-12: `grep -rn -- '--git-common-dir' src | grep -v '^src/lib/project-root.ts' | grep -v '^src/cli/commands/completion.ts'`. Comments only.
- AC-17: `grep -n -- "'--git-common-dir'" src/lib/project-root.ts`. The only hit is in the combined argv, alongside `'--git-dir'`.
- AC-16: `git diff <base> --stat -- src/orchestrator/state.ts`. Must be empty.

If the full suite surfaces another non-git `canon task` fixture in a file outside Affected Files, don't widen scope. Record it as a `[scope]` blocker in the handoff.

Update `handoff.md` AC rows for AC-4, AC-5, AC-9, AC-16 and AC-17. Remove the AC-4 `[scope]` blocker (resolved by the amendment), and drop the legacy-fallback deviation row (reverted by AC-17).
