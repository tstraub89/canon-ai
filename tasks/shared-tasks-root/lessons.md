### Test whether an override is set, never whether its path is absolute

*(2026-10-25, source: shared-tasks-root)*

When a default root became absolute, three call sites that read "absolute" as "`CANON_TASKS_DIR_OVERRIDE` is set" would have sent every per-task write to the main checkout's copy, skipping worktree routing. The check must test the environment variable itself. Before making a default path absolute, grep for `isAbsolute` and absolute-path tests next to the root variable. Also remember that `path.join` with an absolute middle segment concatenates instead of replacing, so a plain join on an absolute default produces a wrong path. The worktree-routing ACs with the gate on are the guard. See `src/task/index.ts` and `tests/task-cli.test.ts`.

### Make a git test fake answer the production argv, not a production fallback

*(2026-10-25, source: shared-tasks-root)*

A fallback query added to production code so a fake git stub would pass hid a real argv mismatch and bypassed the main-working-tree rule. Fix the fake to answer the exact `rev-parse` invocation production sends, and keep production to one code path. Check that a stub's expected argv matches the call site before adding branches to satisfy it. See `tests/run-task-safety.test.ts` and `src/lib/project-root.ts`.

### Find the main checkout's root with `--show-toplevel`, not the parent of the common git dir

*(2026-10-25, source: shared-tasks-root)*

The parent of `--git-common-dir` is only the project root when the git directory sits inside the working tree. With `git init --separate-git-dir`, or in a submodule, that parent is outside the project. In the main working tree, `--git-dir` equals `--git-common-dir` and `--show-toplevel` is correct; only linked worktrees need the parent-of-common-dir branch. Canonicalize with `realpath` before comparing, because macOS temp paths are symlinked. See `resolveProjectRoot()` in `src/lib/project-root.ts`.
