# Spec: shared-tasks-root — Resolve tasks/ and templates from the repo root in every command

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

GitHub issue #122. Commands that scan `tasks/`, scaffold a task, or look up `.canon/templates` resolve those paths against the shell's current directory instead of the repository root. Per-task commands, the orchestrator, `watch` and `stop` already resolve correctly; this bug class is the remainder.

**Confirmed mechanism (deterministic; traced and executed on the main-branch dev build, 2026-10-25):**

- `tasksRoot()` (`src/task/templates.ts`) returns `process.env.CANON_TASKS_DIR_OVERRIDE ?? 'tasks'`, a cwd-relative path. `templatesRoot()` returns `path.join(process.cwd(), '.canon', 'templates')`. `taskTemplateOverrideRoot()` builds on `tasksRoot()`.
- `taskList()` enumerates `tasksRoot()`, and from `docs/` that is `docs/tasks`, which does not exist. Executed: `cd docs && canon task list` printed `No tasks found.` and exited 0 while the repo had in-progress tasks.
- `taskNew()` writes to `taskDirFromRoot(id)` (cwd-relative) and calls `fs.mkdirSync(taskDir)` before `listTemplateFiles()` checks for templates. Executed: `cd docs && canon task new zz-probe x` failed with `templates directory not found at …/docs/.canon/templates` and left an empty `docs/tasks/zz-probe/` behind.
- Outside a git repository, `resolveRepoRoot()` (`src/orchestrator/env.ts`) falls back to `path.resolve(__dirname, '../..')`, which is canon's own install directory. Executed in a non-git scratch directory with copied templates: `canon task new demo Demo` succeeded and wrote `./tasks/demo`, then `canon task status demo` failed with `No status.json found for task demo` because it looked under the install directory, and `canon task list` printed `No tasks found.`
- `nudgeShippableTasks()` (post-merge-sync) enumerates `tasksRoot()`, so it is cwd-relative as well. `checkActiveOrchestrators()` and `checkTemplates()` in `src/cli/commands/doctor.ts` take `doctorCmd`'s `cwd = process.cwd()`, so they are too.
- The review re-scaffold (`scaffoldTaskArtifact()` / `isPristineTaskArtifact()` in `src/orchestrator/review-archive.ts`, reached from `canon task reset-code-review` and the orchestrator's `--reroute` path) uses `resolveTaskTemplateSource()`, which is cwd-relative. The orchestrator never calls `chdir`, so it resolves against the operator's shell directory.

**Skip rules diverge.** Each caller filters `tasks/` entries differently:
- `taskList`: `entry === '_archive' || entry === '_templates'`
- `nudgeShippableTasks`: `entry === '_archive' || entry.startsWith('_')`
- `checkActiveOrchestrators`: `id === '_archive'`
- the shell completion scripts: `_*` and `.*`

`validateTaskId()` (`src/task/index.ts`) already defines the task namespace as `^[a-z0-9][a-z0-9._-]*$` with no `..`. No valid id can start with `_` or `.`, and `tasks/` holds a `.DS_Store` in practice.

**A trap the fix must avoid.** Three sites in `src/task/index.ts` read "`tasksRoot()` is absolute" as "the override is set": `taskDirForCwd()`, `taskRootForGate()` and `isPipelineOwnedAcceptPath()`. On that branch they skip `resolveTaskCwd()` routing. If the default root simply became absolute, every per-task write (including agents' `canon task phase` calls from a task worktree) would silently land in the stale main-checkout copy, which violates "Worktree-canonical task state from implement onward" in `docs/decisions.md`.

Running from inside a task worktree was traced in code, not executed. `taskList` enumerates the worktree branch's snapshot of `tasks/`, so it misses tasks created on the main checkout after the branch point. `taskNew` writes into the worktree's `tasks/`, where `resolveTaskCwd()` cannot find the task afterwards. Its implicit `base_branch` default is `currentBranchOrEmpty()`, which in a worktree is `task/<other>`.

Duplicate root resolution also exists: `resolveMainCheckoutRoot()` in `src/task/index.ts` reimplements the `env.ts` lookup with `--path-format=absolute`.

**Parent-of-common-dir is wrong when the git directory lives outside the working tree** (spec_review round 1). Both existing resolvers take `dirname(git common dir)`. Executed 2026-10-25 against `git init --separate-git-dir=<x>/gitdir <x>/work`: from `<x>/work/sub`, `--git-dir` and `--git-common-dir` both print `<x>/gitdir` and `--show-toplevel` prints `<x>/work`, so parent-of-common-dir yields `<x>`, outside the project. The same holds for a submodule, whose common dir is `<super>/.git/modules/<name>`. In a linked worktree of such a repository, git itself cannot name the main working tree: `git worktree list --porcelain` prints `worktree <x>/gitdir` as the main entry. In an ordinary repository, `--git-dir` equals `--git-common-dir` in the main checkout and differs in a linked worktree (`<common>/worktrees/<name>`). Today a separate-git-dir repository works for `canon task list` at its root only because `tasksRoot()` is cwd-relative, so a parent-of-common-dir resolver would regress it.

## Decision

Add one shared project-root resolver and one task-entry predicate, and route every scan, scaffold and template lookup through them.

- **Project root**: the main checkout's working-tree root. When the current directory is in the main working tree (git dir equals git common dir), it is that working tree's top level, which is correct for ordinary repositories, separate-git-dir repositories and submodule checkouts. When the current directory is in a linked worktree (git dir differs from the common dir), it is the parent of the common dir, as today. From a subdirectory or a linked task worktree of an ordinary repository it therefore resolves to the main checkout. Outside any git repository it resolves to the current directory, replacing the install-directory fallback. It is evaluated at call time from the current process directory, not frozen at import. `REPO_ROOT` in `env.ts` stays an import-time constant computed by the same resolver.
- **Tasks dir**: `CANON_TASKS_DIR_OVERRIDE` when set, resolved against the current directory if relative; otherwise `<project root>/tasks`.
- **Templates dir**: `<project root>/.canon/templates`. Adopter overrides live in `<tasks dir>/_templates`.
- **Task entry**: a directory under the tasks dir whose name is a valid task id. The id rule (today inside `validateTaskId()`) moves into the new module as a boolean check, and `validateTaskId()` keeps its throwing contract and messages by calling it. The new module imports nothing from `src/task/` or `src/orchestrator/`, so no import cycle forms through `env.ts`.
- **Per-task routing does not change.** Status reads and writes keep going through `resolveTaskCwd()` / `taskDirFor()`. At the three sites named above, the override-vs-default decision becomes an explicit check of whether `CANON_TASKS_DIR_OVERRIDE` is set, not a test of path absoluteness. Each no-override default keeps its current anchor with the literal segment `tasks`:
  - `taskDirForCwd`: `<resolveTaskCwd(id)>/tasks/<id>`;
  - `taskRootForGate`: `<its cwd argument>/tasks`;
  - `isPipelineOwnedAcceptPath`: `<git toplevel of its gitCwd>/tasks`.
  None of them may use the new absolute tasks dir as its default.
- **`canon task new` from anywhere** writes `<tasks dir>/<id>` in the main checkout. It checks for templates before creating any directory. Its implicit `base_branch` default comes from the branch checked out at the project root, not the shell's checkout, so a task created from inside a task worktree does not inherit `task/<other>` as its base. Paths in its success and error messages print relative to the current directory: from the repo root they are unchanged (`tasks/<id>`), and from a subdirectory they read `../tasks/<id>`.
- **`canon doctor`** runs all of its project checks against the project root, replacing `doctorCmd`'s `process.cwd()`. That covers templates, version, skills, docs freshness, settings and the rest, which is intentional: doctor checks the project install, so from a subdirectory or a task worktree it reports on the main checkout. `checkActiveOrchestrators` enumerates the shared tasks dir, so it honors `CANON_TASKS_DIR_OVERRIDE`.
- **`listTemplateFiles()` keeps its current listing semantics.** It lists only the managed `.canon/templates` files, now root-resolved. Override files are consulted only per basename, through `resolveTaskTemplateSource()`.

## Non-Goals

- Linked worktrees of a repository whose git directory lives outside its working tree (separate-git-dir, submodule). Git itself does not record that main working tree (`git worktree list` names the git dir), so the parent-of-common-dir result there stays wrong, and the `docs/patterns.md` pitfall keeps documenting it. Commands run from the main working tree of such a repository are in scope (AC-15).
- Walking up parent directories to find `tasks/` outside git.
- Changing `resolveTaskCwd()`, `taskDirFor()`, `taskDirForRepoRoot()`, `isOrphanedWorktreeState()`, or the worktree-canonical rule.
- Changing where `canon init`, `canon upgrade` and `canon update` read and write. They keep operating on the current directory. AC-9 pins `upgrade`'s override-root path.
- Rerouting `nudgeShippableTasks()` status reads through `resolveTaskCwd()`. It runs after a merge, when the main checkout's copy already holds the merged state. Only its root and filter change.
- Changing the `No tasks found.` message or its exit code.
- Changing the shell-completion scripts' generated output (`tests/completion.golden.json` must not change).
- The orchestrator's direct `CANON_TASKS_DIR_OVERRIDE` reads in `state.ts`, `main.ts`, `metrics.ts` and `git.ts`. They already resolve correctly.

## Acceptance Criteria

- [ ] AC-1 (red-first): `canon task list` run from a subdirectory of a git repository lists that repository's tasks. Regression test: a temp git repo with one task, the CLI run as a subprocess with cwd = a subdirectory and no override, asserting the task id appears. The test fails on pre-fix code (prints `No tasks found.`) and passes after.
- [ ] AC-2 (red-first): `canon task new` run from a subdirectory creates the task under the repository's `tasks/`, scaffolded from the repository's `.canon/templates`, and creates nothing under the subdirectory. Regression test asserts both the created path and the absence of `<subdir>/tasks`. It fails on pre-fix code.
- [ ] AC-3: When no templates directory is found, `canon task new` fails with its existing "templates directory not found" error and leaves no task directory behind. Verify with a test that asserts the error and the absence of `tasks/<id>`.
- [ ] AC-4 (red-first): Outside any git repository (a temp dir under `os.tmpdir()`), `canon task new <id>` followed by `canon task status <id>`, `canon task set <id> title …` and `canon task list` all operate on `./tasks`. A subprocess test asserts that `status` succeeds, that `set` changes `./tasks/<id>/status.json`, and that `list` shows the id. It fails on pre-fix code. After the change, `resolveRepoRoot()`'s `path.resolve(__dirname, '../..')` fallback no longer exists. The exported `__dirname`, which `canon-snapshot.ts` uses as the canon install path, stays. A unit test in `tests/project-root.test.ts` shows the resolver is evaluated per call: two calls after `process.chdir` into two different temp repos return the two roots.
- [ ] AC-5 (worktree routing preserved): subprocess tests with a fixture task that has both a main-checkout copy and a worktree copy of its artifacts, and no `CANON_TASKS_DIR_OVERRIDE`:
  - `canon task set` and `canon task phase`, run with cwd = the task worktree and with cwd = the main checkout, change only the worktree copy.
  - With `CANON_SKIP_PHASE_GATE` unset, `canon task phase <id> <phase> done` from the worktree passes or fails the phase gate according to the worktree's artifact. In the fixture the worktree artifact is filled and the main copy is not, so the command succeeds and the gate is shown to read the worktree.
  - The existing worktree-routing test and the worktree `accept` test in `tests/task-cli.test.ts` keep passing unchanged.
- [ ] AC-6: `canon task list`, run as a subprocess from inside a task worktree, lists the main checkout's task set, including a task created on the main checkout after the worktree branched, and reads each row's phase through the existing per-task routing. Verify with a test.
- [ ] AC-7: `canon task new`, run as a subprocess from inside a task worktree, creates the task in the main checkout's `tasks/`. Afterwards `canon task status <id>` finds it. With no `--base`, `base_branch` is the branch checked out at the main checkout. Verify with a test.
- [ ] AC-8: One exported predicate decides whether a `tasks/` entry is a task: a directory whose name passes `validateTaskId()`. `taskList`, `nudgeShippableTasks` and `checkActiveOrchestrators` all use it, and none keeps its own entry filter. A grep of `src/task/index.ts` and `src/cli/commands/doctor.ts` for the quoted literals `'_archive'` and `'_templates'` returns no matches. Unit test: the predicate accepts a valid task dir and rejects `_archive`, `_templates`, `_anything`, `.DS_Store` (as a file and as a directory), a regular file with a valid-id name, and `Upper`. A test in `tests/completion.test.ts` asserts that `validateTaskId()` rejects ids starting with `_` and `.`, which pins the shell scripts' `_*`/`.*` filter to the id rule.
- [ ] AC-9: Template lookups resolve from the project root. `resolveTaskTemplateSource()` checks `<tasks dir>/_templates/<basename>` first, then `<project root>/.canon/templates/<basename>`. `listTemplateFiles()` lists `<project root>/.canon/templates`, as today. A test runs `canon task reset-code-review` (or the `scaffoldTaskArtifact` path) with cwd = a subdirectory and asserts the re-scaffold succeeds from the root templates. `canon upgrade`'s stale-override scan (`src/cli/commands/upgrade.ts`) is edited to keep resolving to `<its cwd>/<CANON_TASKS_DIR_OVERRIDE ?? 'tasks'>/_templates`: the existing `runUpgrade` staleOverrides tests in `tests/cli.test.ts` pass unchanged.
- [ ] AC-10: `canon doctor`, run as a subprocess from a subdirectory of a fixture repo, reports the same project-check lines as from the repo root, including the `.canon/templates/` line and an active-orchestrator warning for a fixture task with an `in_progress` phase. The test goes through `doctorCmd`, not the individual check functions.
- [ ] AC-11: `canon task new` success and error messages print task paths relative to the current directory. From the repo root they are byte-identical to today's (`Created task: tasks/<id>`), so the existing assertion at `tests/task-cli.test.ts` on `Task directory tasks/new-task already exists` passes unchanged. From a subdirectory a subprocess test asserts `../tasks/<id>`.
- [ ] AC-12: One root resolver. `resolveMainCheckoutRoot()` is removed from `src/task/index.ts` and its callers use the shared resolver. Outside comments and the shell-script strings in `src/cli/commands/completion.ts`, `--git-common-dir` appears in `src/` only in the shared resolver's module (grep).
- [ ] AC-13: `tests/completion.golden.json` is unchanged, and `npm run build` produces a `dist/` that matches the committed one.
- [ ] AC-14: Docs updated. `docs/patterns.md` "Worktree runs" says that `canon task new` scaffolds into the main checkout's `tasks/` from any directory. The git-common-dir pitfall bullet names the shared resolver, its main-working-tree vs linked-worktree split, the non-git current-directory fallback, and that linked worktrees of separate-git-dir and submodule checkouts remain unsupported. `docs/codebase-map.md` lists the shared resolver module.
- [ ] AC-15: The project root is the working-tree top level, not the parent of the git directory, whenever the current directory is in the main working tree. Unit tests in `tests/project-root.test.ts`, each with cwd = a subdirectory: an ordinary repo resolves to its top level; a repo created with `git init --separate-git-dir` whose git dir is a sibling of the working tree resolves to the working tree, not the git dir's parent; a linked worktree of an ordinary repo resolves to the main checkout. A subprocess test runs `canon task list` from a subdirectory of the separate-git-dir fixture and asserts the fixture task appears. The separate-git-dir unit case fails on a parent-of-common-dir implementation.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/lib/project-root.ts` | New module: the project-root resolver (git common dir → main checkout; non-git → current directory), the tasks-dir and templates-dir helpers, the boolean task-id rule, and the task-entry predicate. No import-time side effects, and no imports from `src/task/` or `src/orchestrator/`. |
| `src/orchestrator/env.ts` | `REPO_ROOT` computed by the shared resolver; drop the `__dirname` fallback. |
| `src/task/templates.ts` | `tasksRoot()`, `templatesRoot()` and `taskTemplateOverrideRoot()` resolve from the shared helpers (absolute paths). |
| `src/task/index.ts` | Changes:<br>• `taskDirFromRoot`, `taskList` and `nudgeShippableTasks` use the shared root and predicate.<br>• `taskNew`: template check before `mkdir`, implicit base branch from the project root, cwd-relative message paths.<br>• Explicit override checks in `taskDirForCwd`, `taskRootForGate` and `isPipelineOwnedAcceptPath`, with their defaults unchanged.<br>• `validateTaskId` delegates to the shared id rule.<br>• `resolveMainCheckoutRoot` is removed in favor of the shared resolver. |
| `src/cli/commands/doctor.ts` | `doctorCmd` project checks use the resolved project root; `checkActiveOrchestrators` enumerates the shared tasks dir with the task-entry predicate. |
| `src/cli/commands/upgrade.ts` | Compute the stale-override scan path as `<cwd>/<CANON_TASKS_DIR_OVERRIDE ?? 'tasks'>/_templates` directly, instead of `resolve(cwd, taskTemplateOverrideRoot())` (AC-9). |
| `src/orchestrator/review-archive.ts` | Only if needed so the re-scaffold path picks up root-resolved templates. |
| `tests/project-root.test.ts` | New: resolver (main checkout, subdirectory, linked worktree, separate-git-dir, non-git, override) and predicate tests (AC-4, AC-8, AC-15). |
| `tests/task-cli.test.ts` | Subprocess regression tests for AC-1 to AC-7, AC-9, AC-11 and the AC-15 separate-git-dir `task list` case. |
| `tests/cli.test.ts` | AC-10 doctor subprocess test. |
| `tests/completion.test.ts` | AC-8 pin of the id rule against the `_`/`.` shell filter. |
| `docs/patterns.md` | AC-14 edits. |
| `docs/codebase-map.md` | AC-14 entry. |
| `dist/cli/index.js` | Rebuilt. |
| `dist/orchestrator/run-task.js` | Rebuilt. |

### Implementation Notes (non-binding; owned by plan/implement)

- `src/cli/index.ts` dispatches on import, and `env.ts` runs at import for every command. Keep the new module side-effect free and call it lazily from `canon task` and `doctor` code paths so in-process tests that `chdir` into temp repos resolve per call.
- One `git rev-parse --path-format=absolute --git-dir --git-common-dir --show-toplevel` call returns all three values; compare the first two (after `realpath`) to pick the main-tree or linked-worktree branch. `--path-format=absolute` avoids the relative-`.git` case. Canonicalize with `realpath` where paths are compared (`docs/patterns.md`, macOS `/var` vs `/private/var`).

### Interaction Dependencies

- Pipeline agents run `canon task phase` from the task worktree via `phaseCommands()` (`src/orchestrator/prompts/helpers.ts`). AC-5 protects this.
- `commitTaskArtifactsToBase` reads `taskDirForRepoRoot()`. After this change `task new` writes to the same place from any directory.
- Skills call `canon task list`, `new` and `set` from interactive sessions without a `cd`. They now behave the same from any directory.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` (full suite runs clean)
- [x] `npm run build`, with `dist/` matching the committed copy
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`

## Docs Impact

`docs/patterns.md` and `docs/codebase-map.md` (edited, AC-14). Heads-up for QA: `docs/architecture.md` (supervisor vs worktree roots), `docs/product-context.md` (whether `canon task` usage notes mention running from the repo root), `docs/decisions.md` (the "Worktree-canonical task state" rule; this task must not contradict it).

## Known Risks

- **Silent routing flip (AC-5).** If any of the three sites uses the absolute tasks dir as its default, worktree-phase writes, gate reads and accept's dirty-file classification all go to the main copy. Most existing tests set the override or skip the gate and would still pass. The no-override, gate-on worktree cases in AC-5 are the guard. Note that `path.join` with an absolute middle segment concatenates the two paths instead of replacing one with the other.
- **In-process tests and frozen `REPO_ROOT`.** `REPO_ROOT` is captured at import from the test runner's directory. `taskList` enumerates the per-call root but reads rows through `resolveTaskCwd()`, which falls back to `REPO_ROOT`. An in-process test that `chdir`s into a temp repo would therefore enumerate the temp repo, read rows from canon-ai, and drop every row. This is why the regression ACs require subprocesses. Do not "fix" this by bypassing `resolveTaskCwd()`.
- **Import cycle.** `env.ts` imports the new module. If that module imported `validateTaskId` from `src/task/index.ts`, it would close a cycle through `state.ts`, which is why the id rule moves into it.
- **Main-tree vs linked-worktree detection (AC-15).** Comparing git dir with common dir as strings fails on macOS symlinked temp paths unless both are canonicalized. A wrong comparison sends a linked worktree down the `--show-toplevel` branch, which returns the worktree itself and silently reintroduces the per-worktree `tasks/` split that AC-6 and AC-7 guard.
- **Doctor from a worktree** now reports on the main checkout's skills, settings and docs. A task branch that edits those files is not what doctor validates. This is intended.
- **Invalid-name directories** under `tasks/` (such as `Upper/`) no longer appear in `task list` as rows. `task new` can never create such a name.
- **Cosmetic:** `canon task reset-code-review`'s re-scaffold message prints its template path relative to the current directory, so from a subdirectory it shows `../`.
- **Pipeline self-hosting.** canon-ai's own suite runs inside a task worktree during this task's pipeline. A test that relied on cwd-relative `tasks/` without an override and with cwd at the worktree now resolves to the main checkout. Such tests need a temp repo or the override.
- **Non-git temp dirs nested in a git repo.** A test "non-git" dir created under a git checkout resolves to that checkout. Use `os.tmpdir()`.
- **`base_branch` from a worktree (AC-7).** Deriving the branch at the project root must not trip the existing implicit-base warning differently in the normal main-checkout case.

## Human Test Plan

1. In this repository, change into the docs folder and run `canon task list`. Expected: the in-progress tasks are listed, same as from the top of the repo.
2. From the docs folder, create a throwaway task with `canon task new`. Expected: it appears in the repo's task list, and no new tasks folder appears inside docs. Delete the throwaway task afterwards.
3. In an empty folder outside any git repository, scaffold canon with `canon init`, create a task, then ask for its status and list tasks. Expected: the task is found both times.
4. Run `canon doctor` from the docs folder. Expected: the same results as from the top of the repo.
5. While a task's pipeline has its own working copy (after implementation has started), go into that working copy and list tasks, then create a throwaway task. Expected: the list matches the one from the top of the repo, and the new task appears there too. Delete it afterwards.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase (N/A, full tier)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) *Problem* states the confirmed mechanism and how it was confirmed; *Acceptance Criteria* includes red-first regression-test ACs (AC-1, AC-2, AC-4)
- [x] (Refactors) N/A, bug fix
