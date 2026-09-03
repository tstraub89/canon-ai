# Done: worktree-root-in-repo

## Summary

Canon's default location for a task's isolated git worktree moves from a sibling directory next to the repo (`../dev-worktrees/<id>`) to an in-repo, gitignored folder (`.canon/worktrees/<id>`). This removes an unexplained folder that used to appear beside a project after its first task, stops two side-by-side canon-adopting repos from colliding on the same worktree root, and removes the need to separately grant Codex/Claude trust or directory access to a location outside the repo. Worktree *resolution* (how canon finds a task's existing worktree) is completely unchanged — it still works by branch and by content, wherever a worktree happens to be registered. What's new is two loud, pre-phase refusals in `canon run`: one when a task's worktree still lives outside the new default root (naming the old path, the new root, and both fixes), and one when a task's worktree registration exists in git but the directory itself was deleted by hand (naming the missing worktree and giving the exact `git worktree add -f` / `git worktree remove --force` commands to resolve it — canon does not auto-prune or auto-recreate). `canon task` commands still work against an unmigrated task's true state from the main checkout; only running it, and only invoking canon from *inside* the old worktree, are refused. This is a breaking change for adopters, documented in the Unreleased changelog, intended to ship alongside canon-ai's 3.0.0 open-source launch.

## Files Changed

- `.gitignore`, `templates/.gitignore`, `src/lib/canon-block.ts` — added `.canon/worktrees/` to the managed ignore block.
- `src/orchestrator/env.ts` — default worktree root is now `<repo>/.canon/worktrees`; override semantics via `CANON_WORKTREES_ROOT` unchanged.
- `src/orchestrator/worktree.ts` — `ensureWorktree()` now runs `git worktree prune` (fail-soft) before deciding to create or reuse a worktree.
- `src/orchestrator/state.ts`, `src/orchestrator/main.ts` — new `canon run` refusal for a task resolved outside the effective worktrees root; new repo-wide refusal for any registered-but-missing `task/*` worktree, with `--dry-run`/`--ship`/test-override exemptions and fail-closed git enumeration; one sentence appended to the existing invocation-root refusal covering a pre-3.0.0 worktree.
- `src/orchestrator/git.ts` — comment only, removed the old default path name.
- `tests/run-task-safety.test.ts`, `tests/cli.test.ts` — new and updated coverage (see handoff AC table for the full list).
- `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` — new layout, migration behavior, both refusal messages, tooling/clean caveats.
- `docs/patterns.md`, `docs/codebase-map.md` — path-form and legacy-grant annotation updates.
- `CHANGELOG.md` — Unreleased breaking-adopter entry.
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt.

## How to Test

1. On a scratch copy of any canon-adopting project, upgrade canon and open the project's ignore file — the canon-managed block should list the worktrees folder alongside the existing runtime entries.
2. Create a task and run it through its first implementation phase — a per-task workspace folder appears inside the project's `.canon` folder, nothing new appears beside the project, and `git status` in the main checkout stays clean.
3. Delete that workspace folder by hand and re-run the task — canon stops before doing anything, names the missing workspace, and gives one command to restore it and one to discard it; run the restore command and re-run, and the message no longer appears.
4. On a project with a task workspace still in the old sibling folder from before upgrading, try to run that task — canon refuses immediately (before any agent starts), naming the old folder, the new expected location, and both fixes; the same happens for a dry-run preview.
5. List tasks from the project folder — the unmigrated task still shows its real phase. Advance its phase by hand from the project folder and re-check — the change lands in the workspace where the task actually lives.
6. Open a terminal inside that old sibling workspace and try any canon command — it refuses and tells you to run from the project folder, acknowledging the folder is one canon itself created under the previous default.
7. Finish shipping that unmigrated task after approval — it merges and archives normally, leaving the old sibling folder behind for manual cleanup.
8. Move an old sibling workspace into the new location, run `git worktree repair`, and run the task again — it runs normally.
9. Set the worktrees-location override (`CANON_WORKTREES_ROOT`) to a sibling folder and run a fresh task — the workspace appears there exactly as before this change, no refusal.
10. Run `canon doctor` — passes with the ignore rule present; remove the worktrees line from the ignore file and re-run — it names the missing entry and points to the upgrade command.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | ESLint completed cleanly. |
| `npm run type-check` | Pass | TypeScript completed cleanly. |
| `npm test` | Pass | 1,201 passed, 0 failed, 1 expected environment skip. |
| `npm run build` | Pass | Both declared dist bundles rebuilt; reproducible on a second rebuild. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | All references valid. |
| E2E | deferred_by_spec | Spec: Validation Required — no UI surface. |

## Human Verification Required

None. All Validation Outcomes checks recorded a definitive result (`Pass` or `deferred_by_spec` with a spec citation); no `human_pending` checks remain.

**Handoff Validation pre-merge checklist:**
- [ ] Version correct — N/A at QA; version bump is human-owned at release time (no version bump in this task, per spec Non-Goals).
- [ ] Changelog updated if needed — Unreleased entry present; see Proposed Changelog below for the human to finalize.
- [ ] PR body current — see `tasks/worktree-root-in-repo/pr-body.md`.
- [ ] Final CI/CD checks green — confirm at PR time.
- [ ] Final diff matches spec intent — confirmed against AC Coverage table in handoff.md; one operator-accepted spec_gap (see Decisions Made below).

## Decisions Made

- **Root-scoping resolution was rejected in favor of a single refusal at `canon run`'s entry.** Spec revisions 1–3 tried narrowing worktree lookup itself to the new root; three review rounds each found a different consumer or lifecycle state that narrowing broke, and round 3 showed it silently misroutes the canonical first-worktree state to the main checkout instead of refusing loudly. Revision 4 dropped that mechanism class entirely: resolution stays location-blind everywhere, and one new refusal lives at the `canon run` entry.
- **The "no legacy fallback" guarantee was narrowed to "no legacy run."** `canon task phase/accept` on an unmigrated task still read and write its true state in the old worktree from the main checkout; only *running* the task, and invoking canon *from inside* the old worktree, are refused.
- **Auto-prune of hand-deleted worktree registrations was replaced with a refusal.** An amendment (round 3 of code review, `spec_gap`) found that pruning before resolution can erase the only evidence of a canonical worktree and silently route blank-branch task state to the main checkout, and that recreating a worktree from its branch cannot restore uncommitted post-implement artifacts. Canon now refuses and names two explicit remedy commands instead of acting automatically.
- **Operator-accepted code_review spec_gap (not a dropped AC).** The missing-worktree detector checks only that the worktree path exists on disk; a partially corrupted worktree (e.g., a `rm` that removed some but not all files, or disk damage) would pass the existence check but still be broken. This is a narrow trigger, identical to pre-existing behavior before this task, and was accepted by the operator via `canon task accept` as a tracked backlog follow-up (worktree healthiness beyond existence) rather than blocking this task on it.

## Open Questions

- None raised by implementation or review beyond the accepted spec_gap above, which is tracked as a backlog follow-up, not an open question for this task.

## Proposed Changelog

> **Breaking (adopters):** New task worktrees now default to `.canon/worktrees/<id>/` inside the repository. A task still living at the old `../dev-worktrees/<id>` root refuses to run until you move it to `.canon/worktrees/<id>/` and run `git worktree repair`, or pin `CANON_WORKTREES_ROOT=../dev-worktrees`. `--ship` still merges and archives an unmigrated task but leaves its old directory and registration behind. If a task worktree directory is deleted by hand, `canon run` (except `--dry-run` and `--ship`) now stops before any phase, names each missing worktree, and gives `git worktree add -f <path> <branch>` to restore it or `git worktree remove --force <path>` to discard its registration; anything not yet committed to the branch was lost with the directory, and canon prunes or recreates nothing at this entry check. Project tooling that walks the repository with root-anchored `**/` globs should exclude `.canon/worktrees/`; `git clean -ffdx` (double force) or removing `.canon` destroys in-flight worktrees, while plain `git clean -fdx` skips them. `canon` commands run from inside an unmigrated worktree directory are refused and must be run from the main checkout instead.

This entry already exists verbatim in `CHANGELOG.md` under `[Unreleased] → ### Changed` (written during implementation, per the amended AC-12 text replacement); it is reproduced here for the human's final review/finalization pass.

## Quality Log
- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Breaking-change worktree-root move; code_review sanctioned via operator override for a narrow, pre-existing, backlog-tracked worktree-healthiness gap (existence check vs. corruption), not a dropped AC.
