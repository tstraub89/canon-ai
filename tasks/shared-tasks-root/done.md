# Completion Summary: shared-tasks-root — Resolve tasks/ and templates from the repo root in every command

> For the human. This is what you need to know.

## What Changed

Most `canon task` commands and `canon doctor` used to look for `tasks/` and `.canon/templates` in whatever directory you ran them from. From a `docs/` folder, `canon task list` printed "No tasks found." and `canon task new` failed or left an empty folder behind. Now they all resolve from the repository's root, so they behave the same from any subdirectory. A task created from inside a task's working copy lands in the main checkout and gets the main branch as its base. `canon task` also refuses to run outside a git repository, with one clear error and no files created; before, `new` succeeded there and later commands failed with a confusing message. Directories under `tasks/` whose names are not valid task ids no longer show up as task rows.

## Files Changed

- `src/lib/project-root.ts` — new shared resolver for the project root, the tasks and templates directories, and the task-id rule.
- `src/orchestrator/env.ts` — `REPO_ROOT` comes from the shared resolver; the install-directory fallback is gone.
- `src/task/templates.ts` — task and template paths resolve from the project root.
- `src/task/index.ts` — task scans and scaffolding use the shared root; `new` checks for templates before creating a directory; the outside-git refusal runs before any subcommand; messages print paths relative to the current directory.
- `src/cli/commands/doctor.ts` — project checks run from the project root; the active-orchestrator check uses the shared task-entry rule.
- `src/cli/commands/upgrade.ts` — the stale-override scan stays anchored to the directory it was run from.
- `tests/project-root.test.ts` (new), `tests/task-cli.test.ts`, `tests/cli.test.ts`, `tests/completion.test.ts`, `tests/run-task-safety.test.ts`, `tests/run-task-canon-snapshot.test.ts` — regression and unit tests for the resolver, worktree routing, outside-git refusal, doctor, and the shell-completion id rule.
- `docs/patterns.md`, `docs/codebase-map.md` — document the shared resolver and main-checkout scaffolding.
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt.

## How to Test

1. In this repository, change into `docs/` and run `canon task list`. Expected: the in-progress tasks appear, the same as from the top of the repo.
2. From `docs/`, create a throwaway task with `canon task new`. Expected: it appears in the repo's task list, and no `tasks/` folder appears inside `docs/`. Delete the throwaway task afterwards.
3. In an empty folder outside any git repository, run `canon task list` or `canon task new`. Expected: canon refuses with a message saying it needs a git repository, exits with an error, and creates nothing.
4. From `docs/`, run `canon doctor`. Expected: the same project-check results as from the top of the repo.
5. Inside a task's working copy (after implementation has started), run `canon task list`, then create a throwaway task. Expected: the list matches the one from the top of the repo, and the new task shows up there too. Delete it afterwards.

## Test Results

These come from the implementation handoff's latest validation table (iteration 2), except docs-refs-check, which QA re-ran this session.

| Check | Result |
|---|---|
| `npm run lint` | Pass (handoff, iteration 2) |
| `npm run type-check` | Pass (handoff, iteration 2) |
| `npm test` | Pass: 1,660 passed, 1 skipped, 1,661 total (handoff, iteration 2) |
| `npm run build` | Pass (handoff, iteration 2) |
| `npm run docs-refs-check` | Pass on QA re-run. The handoff's iteration-2 run failed on a nonexistent fixture path in `tasks/shared-tasks-root/review.md`; the current run reports "All refs OK." |
| `npm run sync-templates:check` | Pass (handoff, iteration 2) |
| `tests/completion.golden.json` unchanged | Pass (handoff, iteration 2) |

No `deferred_by_spec` rows. QA did not re-run lint, type-check, the test suite, or build.

## Human Verification Required

None. No validation check is left as `human_pending`.

Pre-merge checklist items QA could not confirm:
- Version correct: not decided. The release step picks the bump tier, and QA did not propose one.
- Changelog updated: not yet. The proposed entry below is text only, for the release step.
- PR body current: drafted in `tasks/shared-tasks-root/pr-body.md`; re-check it after any edits.
- Final CI/CD checks green: not checked. Run `gh pr checks` after `--pr` opens the draft.
- Final diff matches spec intent: QA read the spec, the handoff, and the diff summary, not every line of the diff.

## Proposed Changelog

- **`canon task` and `canon doctor` work from any subdirectory of a repository.** `canon task list`, `new`, `status`, and `set`, and `canon doctor`, read `tasks/` and `.canon/templates` from the repository root instead of the current directory. `canon task new` from inside a task's working copy creates the task in the main checkout, and its base branch is the main checkout's branch, not the working copy's.
- **`canon task` refuses to run outside a git repository.** It prints one error that names the requirement and exits with an error without creating `tasks/`. Before, `canon task new` succeeded outside git and later commands failed.
- **Directories under `tasks/` whose names aren't valid task ids no longer appear in `canon task list`.**

## Decisions Made

- **Outside-git refusal, not outside-git support.** The spec's first version tried to make `canon task` work outside git. Implement round 1 showed that needed a non-git branch in worktree resolution, and the spec was amended to refuse up front instead (AC-4, AC-16). That is a behavior change for anyone who ran `canon task` outside git, but no task file format changed.
- **Separate-git-dir main checkouts are supported; their linked worktrees are not.** The project root is the working-tree top level when run from the main checkout (AC-15). Linked worktrees of separate-git-dir and submodule repositories stay unsupported, as the spec's Non-Goals say.
- **`doctor` reports on the main checkout even when run from a task's worktree.** This is intended per the spec, so a task branch that edits skills, settings, or docs will not change what doctor checks there.
- **Per-task routing is unchanged.** Worktree status reads and writes still go through the existing per-task routing (AC-5, AC-6, AC-7 cover this).

## Open Questions

- Follow-up for a future task: support linked worktrees of separate-git-dir and submodule repositories. The spec leaves this out on purpose.
- The `review-cold-codex*.md` files in the task folder are untracked and were not created by QA. They are pipeline artifacts for the human to decide on.
- The shipped changelog bullet count and wording are for the release step and the human to finalize.

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: Yes
- Dropped ACs: 1
- Validation gaps: 0
- Notes: First spec_review round blocked on the separate-git-dir root; implement was rerouted once after a human spec amendment for outside-git scope; code review caught an AC-5 gap (phase from main checkout untested), fixed in iteration 2.
