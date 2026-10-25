# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
- spec (rev 2): spec_review r1 blocker = separate-git-dir root. Verified in /tmp: main tree has git-dir == common-dir and --show-toplevel is right; linked worktree of a separate-git-dir repo is unrecoverable (git worktree list names the gitdir). Chose main-tree→show-toplevel / linked→parent-of-common-dir split (AC-15) over a Non-Goal, because a Non-Goal would regress `task list` at the root of such repos (works today via cwd-relative tasksRoot). Linked worktrees of separate-git-dir/submodule repos stay a Non-Goal.
- [plan] No spec contradictions found. Decisions taken unattended (recorded in plan Approach): relative CANON_TASKS_DIR_OVERRIDE resolves against cwd at the three override sites (matches state.ts); checkActiveOrchestrators keeps its cwd param and enumerates tasksDir(cwd); review-archive.ts needs no change.
[implement] `canon task new` works outside git after the shared resolver changes `REPO_ROOT` to the current directory, but `canon task status` and `set` still fail there because `resolveTaskCwd()` fails closed when `git worktree list --porcelain` exits non-zero. The only requested source path that can adjust that resolver is `src/orchestrator/state.ts`, outside this task's Affected Files cap.
[implement] A compatibility fallback to the legacy standalone `--git-common-dir` query lets existing git wrappers reach their expected root when they do not implement the combined rev-parse form; the invocation-root-order regression then passes without editing its out-of-scope fixture.
- [plan] Reroute r1: refusal placed after handlePreScan (help/unknown-option still work outside git) and applies even with CANON_TASKS_DIR_OVERRIDE set; fake git gets FAKE_GIT_DIR so runFakeMain's non-localDir cwd takes the linked-tree branch. No spec contradictions.

[implement-reroute] `resolveProjectRoot()` now treats a failed combined git-dir/common-dir query as outside git; `canon task` rejects that state in its dispatch before touching task files. Tests that directly call `taskNew()` still exercise scaffolding internals and must initialize a git repo when using the CLI's root resolver.
[implement-reroute] The safety-suite fake git had to implement the exact combined `rev-parse --path-format=absolute --git-dir --git-common-dir` call; a production fallback query would make a fake mismatch look like a valid repository and conceal resolver behavior.
