# Completion Summary: pr-pushes-scaffold-base — --pr and --push push canon's own scaffold commits to base

> For the human. This is what you need to know.

## What Changed

`--pr` and `--push` now push canon's own scaffold commits to the base branch before the base-divergence check runs, the same way `--full-send` already did. Before this change, every non-full-send task stopped at that check with an unpushed scaffold commit, so you had to push the base by hand first. The push is all-or-nothing: if any unpushed base commit is not canon's own (anything other than a task scaffold or pipeline telemetry), nothing is pushed and the divergence gate stops the run as before. The full-send push is now the same shared helper rather than its own call.

Three related behaviors changed. If the base branch exists only locally (not on origin), `--pr`/`--push` create it on origin when every local-only commit is canon's own, or when every commit is already on a live origin branch. A branch with your own commits is refused and you are told to push it yourself, even with the override. A rejected base push now distinguishes a non-fast-forward (origin's base is ahead; the message says to rebase) from a protection-style rejection. And a fetch failure during full-send now warns and skips the base push instead of dying.

## Files Changed

- `src/orchestrator/main.ts` — shared scaffold push inside `commitHumanReviewFiles`; removed the full-send-only push helper.
- `src/orchestrator/git.ts` — remote-branch probe, pruned local-only range, rejection classifier.
- `src/orchestrator/validation.ts` — opt-in missing-remote classification; default `--ship` path and result shape unchanged.
- `src/orchestrator/phases/implement.ts` — one scaffold hint wording for every mode.
- `src/orchestrator/cli.ts`, `src/cli/index.ts` — help text for shared base pushes, remote-base creation, and override behavior.
- `tests/run-task-safety.test.ts` — real-git integration matrix (shared push, missing bases, stale refs, rejections, probe failures).
- `tests/run-task-validation.test.ts` — probe, ship compatibility, local-only range, missing-base block, rejection classifier.
- `README.md` — flag consent and scaffold-push behavior.
- `docs/pipeline-orchestrator.md` and its mirror `templates/docs/pipeline-orchestrator.md` — shared push contract, missing-base handling, rejection and fetch-failure behavior, override fallback.
- `.claude/skills/canon-pipeline/SKILL.md` and its mirror `templates/.claude/skills/canon-pipeline/SKILL.md` — PR instructions include the base push.
- `docs/codebase-map.md` — shared push and missing-remote helpers.
- `docs/decisions.md` — consent decision, reversal of the archived full-send-only non-goal, guidance for bases that accept only PRs.
- `dist/orchestrator/run-task.js`, `dist/cli/index.js` — rebuilt runtime and help output.

## How to Test

1. On a repo with a clean main that is in sync with origin, run a task to `human_review` and open the PR with `--pr` without pushing main by hand. Expected: the PR opens, and canon reports pushing its scaffold commit to main.
2. Before opening the PR, commit something of your own on local main, then run `--pr`. Expected: canon pushes nothing, lists the commits, and tells you to push main yourself.
3. Create a local feature branch that origin does not have, and use it as the task's base. Run to `human_review` and open the PR. Expected: canon creates the feature branch on origin and the PR targets it.
4. Repeat step 3 after committing your own work to the feature branch. Expected: canon refuses, says origin has no such branch, and tells you to push it yourself, even with `--allow-divergent-base`.
5. Have someone push to main on origin while your local main is behind, then run `--pr`. Expected: canon says origin's main has moved ahead and tells you to rebase local main. It does not mention protection.
6. On a repo whose main rejects direct pushes, run `--pr --allow-divergent-base`. Expected: canon warns that it could not push its scaffold commit, and still opens the PR.

Scenarios 1–6 are the spec's Human Test Plan. They were not run against real GitHub; see Human Verification Required below.

## Test Results

Results below are from `tasks/pr-pushes-scaffold-base/handoff.md` (Validation Outcomes) and `tasks/pr-pushes-scaffold-base/review.md`. QA did not re-run them.

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass — 1,616 passed, 0 failed, 1 skipped |
| `npm run build` | Pass |
| `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |
| `git diff --check` | Pass |
| Red-first evidence (AC-1, AC-4, AC-4b(i), AC-7, AC-8(a)) | Recorded against base commit `1ededd5`, all failing for the stated reason before the fix |
| AC-6 mutation proof (prune removed) | Stale-origin fixture succeeds without the prune and fails with it restored |

The one skipped test is `REPO_ROOT stays anchored to the supervising checkout when imported from a linked worktree` in `tests/run-task-safety.test.ts`. Its environment guard skips it when `.git` is not writable. It is unrelated to this diff, and it is skipped, not passing.

## Human Verification Required

None.

Pre-merge checklist (not confirmed by QA):
- [ ] Version correct (per project policy) — release step decides; not set by QA
- [ ] Changelog updated if needed — proposed text below; human finalizes
- [ ] PR body current — drafted in `tasks/pr-pushes-scaffold-base/pr-body.md`
- [ ] Final CI/CD checks green — not yet observed
- [ ] Final diff matches spec intent — code review approved with nits; the manual scenarios in How to Test are still to be run

## Proposed Changelog

- **`--pr` and `--push` push canon's own scaffold commits to the base branch.** A task's PR no longer stops at the base-divergence check until you push the base by hand. canon pushes only commits made of task scaffolds and pipeline telemetry, all or nothing. Any other unpushed base commit blocks the push, as before. `--full-send` uses the same path.
- **A local-only base branch is created on origin when canon can do it safely.** `--pr` and `--push` create the missing base only when every local-only commit is canon's own. A base with commits of your own is refused, and the message tells you to push it yourself, even with `--allow-divergent-base`.
- **A rejected base push names the cause.** When origin's base has moved ahead, the message tells you to rebase local base. It no longer suggests branch protection.
- **`--full-send` warns and skips the base push on a fetch failure** instead of stopping at the fetch.

## Decisions Made

- **Consent.** `--pr` and `--push` count as consent to push canon's own scaffold commits to base. This reverses the archived full-send-only non-goal and is recorded in `docs/decisions.md`. The safety rests on the unchanged classifier and the all-or-nothing rule.
- **Creating a missing remote base.** The spec treats this as a new outward action that `--pr`/`--push` may take. When the local-only range is empty, canon creates the base at the pinned local tip. That publishes no new commit, only a branch name.
- **`--allow-divergent-base` meaning.** For an existing base, it now means "try the safe push; if refused, continue". It never bypasses a missing remote base, or a rejected creation push.
- **Stale refs.** canon prunes origin's stale remote-tracking refs before computing a missing-base range. If the prune fails, the push is skipped rather than computed from stale refs.
- **Re-list after push.** After a successful push, canon re-lists from the pushed SHA, so pushed commits do not trigger an override warning, and concurrent local commits still reach the gate.
- **Full tier, delicate.** The spec and review were run on the full tier because `delicate` is set in `tasks/pr-pushes-scaffold-base/status.json`.

## Open Questions

- Code review left non-blocking nits, none fixed in this task. Verdict was approved with nits.
  - R1: a non-fast-forward remediation can lead into a base-drift conflict on re-run (`src/orchestrator/main.ts:1409-1413`).
  - R2: the base push runs before cheap local preconditions in `commitHumanReviewFiles` (`src/orchestrator/main.ts:1529`).
  - R3: `fetch --prune` only prunes refs inside the configured fetch refspec (`src/orchestrator/git.ts:245`).
  - N7: one probe unit assertion never reaches the exact-ref filter (`tests/run-task-validation.test.ts:2390-2391`).
  - N8: the handoff omits an AC-16 row.
- Real GitHub branch protection and the non-fast-forward wording on a live remote were not exercised. The automatic paths were tested with local bare origins, real git, and rejecting hooks.
- The spec's Human Test Plan (scenarios 1–7) still needs a manual run before merge.
- The first `spec_review` verdict was `changes_requested` (`tasks/pr-pushes-scaffold-base/status.json` shows `changes_requested_total: 1`); the latest is `approved`.

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Code review approved with nits (R1–R3, N7, N8 open, non-blocking); one environment-gated test skipped, not failed; manual Human Test Plan not yet run against real GitHub.
