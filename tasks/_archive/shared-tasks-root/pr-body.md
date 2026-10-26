# PR Body: shared-tasks-root - Resolve tasks/ and templates from the repo root in every command

## Summary

- `canon task list`, `new`, `status`, and `set`, and `canon doctor`, now find `tasks/` and `.canon/templates` at the repository root, so they behave the same from a subdirectory. Before, `canon task list` from `docs/` printed "No tasks found."
- `canon task new` checks for templates before it creates a directory, so a failed run no longer leaves an empty task folder behind.
- `canon task new` from inside a task's working copy creates the task in the main checkout, and its base branch is the main checkout's branch, not the working copy's.
- `canon task` refuses to run outside a git repository, with one error and no files created.
- Directories under `tasks/` whose names aren't valid task ids are skipped by the task scans.
- One shared project-root resolver replaces the duplicate lookup in `src/task/index.ts` and the install-directory fallback in `src/orchestrator/env.ts`.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Per-task status routing is unchanged. Worktree-phase writes and gate reads still go through the existing routing; the tests cover the worktree and main-checkout cases.
- A main checkout whose git directory sits outside the working tree (`git init --separate-git-dir`) now resolves to its working tree. Linked worktrees of separate-git-dir and submodule repositories are still unsupported.
- `canon doctor` run from a task worktree now checks the main checkout's skills, settings, and docs, not the worktree's.
- Follow-up not filed: linked-worktree support for separate-git-dir and submodule repositories.
