# Completion Summary: base-drift-conflicts-only — --pr base-drift blocks only on real merge conflicts

> For the human. This is what you need to know.

## What Changed

`--pr` and `--push` no longer stop because the base branch moved on files the task never touched. Before this change, any base-side change outside the spec's Affected Files stopped the run, which hit concurrent worktree tasks whenever a sibling task or PR merged first. Now canon checks whether the commit it is about to push would actually conflict with `origin/<base>`, using `git merge-tree`. Clean base advance prints one info line and the push continues. A real conflict, including one in an allowlisted file, aborts before the push and names the conflicted paths. The task-side scope check (files the task changed that the spec never declared) is unchanged. On a conflict or scope abort from the human_review commit, canon undoes that commit with a soft reset, so nothing is left committed or pushed. Git older than 2.38 warns and skips the conflict check. Any other probe error fails closed, and `--force` cannot bypass it.

## Files Changed

- `src/orchestrator/git.ts` — new merge-conflict probe (NUL-delimited `merge-tree` output, exit and tree-OID disambiguation).
- `src/orchestrator/validation.ts` — base-drift check returns conflicts and probe errors; conflict and scope abort messages are separate.
- `src/orchestrator/main.ts` — gate moved to just before each push and probes the recorded `HEAD`; soft-reset on dirty-path aborts; clean-advance info line; `--force` warning; fail-closed probe errors.
- `src/orchestrator/cli.ts`, `src/cli/index.ts` — `--pr`, `--push`, and `--force` help text.
- `tests/run-task-safety.test.ts` — rewritten clean-advance test; new real-git and fake-git cases for other-task artifacts, conflicts, conflict plus scope drift, the human_review commit undo (dirty doc, pre-commit hook rewrite, clean tree), re-run after undo, `--force`, and probe failures.
- `tests/run-task-validation.test.ts` — updated abort-message and result-shape assertions; merge-tree probe cases including a path with spaces.
- `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` — base-drift contract, gate timing, `--force` and `--allow-divergent-base` rows (mirror synced).
- `docs/codebase-map.md`, `docs/patterns.md` — probe helper, push-time gate, merge-tree exit semantics, Git 2.38 minimum.
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt.

## How to Test

1. Make two tasks on the same base. Merge the first task's PR, then run `--pr` on the second. Expected: the PR opens with no `--force`, and canon prints one info line saying the base advanced on N files that merge cleanly.
2. On a throwaway task, change one line in a declared file. Change the same line on `main` and push it. Run `--pr`. Expected: canon aborts before pushing, says the task conflicts with `origin/main`, lists the file, and gives merge/rebase steps. Your local HEAD is unchanged.
3. Repeat step 2 with `--force`. Expected: the run proceeds and warns that a conflict was bypassed, listing the file.
4. On a task that changed a file its spec never declared, run `--pr`. Expected: the same "not in the spec's Affected Files" abort as before.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass (re-run in QA) |
| `npm run type-check` | Pass (re-run in QA) |
| `npm test` | Pass — 1,534 tests, 1,534 passed, 0 failed, 0 skipped (re-run in QA) |
| `npm run build` | Pass (re-run in QA; `dist/` unchanged by the rebuild) |
| `npm run docs-refs-check` | Pass (re-run in QA: "All refs OK"). The implement-iteration-2 failure came from a backticked path in `review.md`, which the code-review foreman rewrote. |
| `npm run sync-templates:check` | Pass (re-run in QA) |
| Stale-wording grep (`changed only on origin`, `files changed only by base advancement`) | Pass — no hits |
| E2E | N/A — the task prompt marks E2E as N/A |

Note: the full-suite result above matches the handoff count. QA re-ran it on the final tree.

## Human Verification Required

None. No `human_pending` checks remain in the handoff's latest validation tables.

Pre-merge checklist, items QA cannot confirm:
- [ ] Version correct — the release step decides the bump tier (see Proposed Changelog).
- [ ] Changelog updated — pending the release step.
- [ ] PR body current — `tasks/base-drift-conflicts-only/pr-body.md` is drafted; re-check after any edits.
- [ ] Final CI/CD checks green — not run by QA.
- [ ] Final diff matches spec intent — the spec's Human Test Plan (steps 1–6 in `spec.md`) is the manual check for this.

## Proposed Changelog

Scope test: this changes what `--pr` and `--push` do at runtime (a base move no longer blocks; a real conflict still does), so it qualifies under `### Changed`. The fail-closed probe and the Git 2.38 warning are part of the same user-visible behavior.

- **`--pr` blocks only on real merge conflicts with the base.** A base branch that moved on files the task never touched no longer stops the run. Canon prints one line saying those files merge cleanly. A conflict with `origin/<base>`, including in a file the spec declared, still aborts before the push and names the conflicted files. The task's own out-of-scope changes still abort as before. `--force` bypasses a conflict with a warning. On Git older than 2.38, canon warns that conflicts weren't checked and proceeds.

## Decisions Made

- **Probe the commit git recorded, not a pre-commit candidate.** A pre-commit hook can rewrite the index after a candidate is built, so the gate probes `HEAD` after `git commit`. On a conflict or scope abort, canon undoes that commit with `git reset --soft` to the prior HEAD. The index and working tree are left as they were. If the reset fails, the message names the leftover commit and the manual command.
- **Every path counts toward a conflict,** including allowlisted and declared files, because a conflict in any file breaks `--ship`'s squash merge.
- **`merge-tree` exit 1 counts as conflicts only when a tree OID is printed.** Exit 1 with no OID (an unresolvable ref) is a probe error. It fails closed, and `--force` cannot bypass it.
- **Git older than 2.38** warns and proceeds. This follows the spec's Decision §4.
- **Spec change during the plan:** three fake-git tests asserted no `commit` on the dirty path. The plan replaced that with "commit, then `reset --soft`, no push" and left the spec unchanged. The spec's AC-4 says "current assertions", so this is a deliberate deviation. It is recorded in `notes.md`.

## Open Questions

- The `--force` help still lists the bypasses as "currently:" and omits the docs-refs-check bypass (`src/orchestrator/main.ts`, around the `--force` override path). Code review flagged this as a pre-existing nit (not caused by this task) and suggested a later touch. Not done here.
- The forced-path info line wording for "conflict reported with no paths" has no test pinning it. It is cosmetic.
- Adopters without PR CI get no re-validation against the new base after a clean advance. The spec accepted this, since the old gate never re-validated either.

Maintenance: `docs/lessons-learned.md` plus this task's fragment have 20 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 2
- Validation gaps: 0
- Notes: Spec_review took three rounds (two changes_requested, then approved_with_nits); code review round 1 left AC-4c and AC-7 partial, both fixed in round 2.
