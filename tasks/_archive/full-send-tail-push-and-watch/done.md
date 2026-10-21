# Completion Summary: full-send-tail-push-and-watch — Full-send tail pushes canon scaffold commits; watch reports a dead tail

> For the human. This is what you need to know.

## What Changed

Two fixes to `canon run --full-send`, which is part 1 of issue #104. Part 2 (the `--ship` branch-delete ordering) is separate and not in this task.

First, a full-send run that dies in its final tail (after QA, while it opens the draft PR) is now reported by `canon watch` as a death with the reason, exit 4. Before, it looked like a normal stop for review. This applies only to full-send tasks sitting at pending `human_review`. A tail that is still running keeps `watch` blocking, even when its heartbeat has gone stale during a slow git or `gh` call.

Second, the full-send tail now pushes the local base branch's unpushed commits before the base-divergence gate, but only when every one of them is a canon scaffold commit. A scaffold commit has an exact scaffold subject and changes only `tasks/` paths or pipeline telemetry files. Renames count as a delete plus an add, and merge commits never qualify. The tail pushes the checked tip SHA, not the branch name, so an operator commit made during the tail is not published. If any other commit is unpushed, nothing is pushed and the divergence gate stops the run as before. A rejected push or a failed fetch or probe stops the tail with a clear message and pushes nothing. The "Scaffold committed to local <base>" hint now prints only when unpushed scaffold commits actually exist, with full-send wording under full-send.

Plain `--pr`, `--push`, and `--ship` behavior is unchanged.

## Files Changed

- `src/cli/commands/watch.ts` — full-send pending-`human_review` death and live-tail classification for attach and idle paths.
- `src/orchestrator/main.ts` — full-send tail pushes the checked base tip SHA when every unpushed commit qualifies; fails closed on fetch, probe, or push errors.
- `src/orchestrator/git.ts` — scaffold-subject, parent-count, and changed-path classification (rename detection off), plus a no-fetch probe for the hint.
- `src/orchestrator/phases/implement.ts` — scaffold hint prints only when safe unpushed scaffold commits exist; full-send wording.
- `tests/watch.test.ts` — dead-tail death, `code=0` and non-full-send controls, late attach, live-tail precedence (including the no-marker variant).
- `tests/run-task-safety.test.ts` — real-git full-send push (including a byte-identical copy), six unsafe-commit variants, rejected push, listing-probe failure, concurrent operator commit injection, scaffold hint cases.
- `docs/pipeline-orchestrator.md` and `templates/docs/pipeline-orchestrator.md` — watch exit-code rows, `--full-send` row, scaffold and divergence paragraphs.
- `README.md` — full-send base push paragraph.
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt bundles.

## How to Test

1. Start a full-send run on a task and let it finish without pushing the base branch yourself.
2. Expected: the draft PR opens. The run log lists the scaffold commits (task files and telemetry only) that canon pushed to the base branch.
3. Make an unrelated commit on the base branch without pushing it, then start another full-send run.
4. Expected: the run stops before opening the PR and tells you to push the base branch. Your commit is not pushed.
5. Force a full-send run to fail at the very end (for example, a deliberate conflict) while watching it.
6. Expected: watch reports that the run died and shows the reason, instead of a normal stop for review.
7. Expected for a protected base: if the base push is rejected, the run stops at the push with a hint to push or merge the commits manually and re-run. No PR is opened.

## Test Results

Latest recorded results from `tasks/full-send-tail-push-and-watch/handoff.md` (Iteration 4 re-run), plus one check QA re-ran.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Iteration 4 re-run. |
| `npm run type-check` | Pass | Iteration 4 re-run. |
| `npm test` | Pass | 1,531 passed, 1 skipped. Includes the real-git full-send push tests. |
| `npm run build` | Pass | Last run in Iteration 2. Later iterations changed only tests and task artifacts, not `src/`. |
| `npm run sync-templates:check` | Pass | Last run in Iteration 2; the template mirror has not changed since. |
| `npm run docs-refs-check` | Pass | QA re-ran it on this worktree: "All refs OK." The handoff's Iteration 4 row shows `Fail – unrelated` (a reference in the review artifact). That row is superseded by the current clean run. |
| E2E | not_configured | Spec marks E2E N/A. |

Acceptance criteria status at the last handoff: AC-1 through AC-10 are recorded as Met in the Iteration 2 and 3 deltas. Two red-first runs were not recorded: AC-1 and AC-2 were judged red against the old code by construction, not run against it.

## Human Verification Required

None.

Unconfirmed items from the handoff pre-merge checklist:
- [ ] Version correct: not decided here. The version bump happens at the release step.
- [ ] Changelog updated: the proposed entry below still needs the release step and your approval.
- [ ] PR body current: `tasks/full-send-tail-push-and-watch/pr-body.md` is drafted; the PR is not open yet.
- [ ] Final CI/CD checks green: not verified. No PR exists yet.
- [ ] Final diff matches spec intent: code review's final verdict was "Approved with nits". Your read of the diff against the spec's Decision 2 content rule is still the human check.

## Proposed Changelog

- **`canon watch` reports a full-send run that died after QA as a death, not a clean stop.** A run that crashed while opening its draft PR now shows `reason=death` and exits 4, with the reason on stderr. A tail that is still running keeps watch blocking.
- **`--full-send` pushes unpushed scaffold commits to the base branch before opening the draft PR.** It pushes only commits whose subject is the scaffold subject and that change only task artifacts and pipeline telemetry. If any other commit is unpushed on the base branch, nothing is pushed and the run stops, as before. A rejected push stops the run with a hint to push or merge manually.
- **The "Scaffold committed" hint prints only when unpushed scaffold commits exist.** Under `--full-send` it says what the tail will push.

## Decisions Made

- **Guard by content, not by who made the commit.** The spec's first three revisions tried to record which commits canon created. Spec review kept rejecting that as scope expansion, and the operator overruled it. The push guard is an exact subject match plus a path rule (only `tasks/` and telemetry files), and it pushes the checked tip SHA. An operator-made commit that passes the same rules carries only task artifacts or telemetry, so pushing it is accepted.
- **Rename detection is off for the path check.** A rename from outside `tasks/` into it counts as a delete plus an add, so the outside path still blocks the push. Copies need no special rule, because the source path does not change and the guard does not audit file contents under `tasks/`.
- **Merge commits never qualify.**
- **Fetch failure now dies in the full-send tail.** Plain `--pr` still warns and skips on a failed fetch. The PR push needs the network anyway, so failing closed under full-send is accepted.
- **Push runs before the docs-refs, base-drift, and dirty-tree gates.** A later gate can abort after the scaffold commits are already on origin. Those commits carry only task artifacts and telemetry, and a re-run needs them pushed anyway.
- **`commitTaskArtifactsToBase` does not return whether it committed.** The spec's Affected Files asked for it. No caller needs it, because the hint keys on the unpushed-commit probe, which also counts commits left by an earlier call. The handoff records this deviation.
- **Known accepted risks** (spec Known Risks): base-branch CI or deploy may run on scaffold-only pushes; a protected base now fails at the push with a better message, but the PR still does not open there.

## Open Questions

- **Protected base branches.** On a repo that rejects direct pushes to base, the tail now stops at the push with a manual-push hint. Is that the right fallback, or should a protected-base run open the PR from a branch instead? That is a follow-up task, not part of this change.
- **Escalations on this task.** `status.json` records two auto-blocks that were cleared before QA: spec review hit three `changes_requested` rounds, and code review hit three rounds. Both were resolved, and the escalation records are kept for the audit trail.
- **Scaffold commits with telemetry rows from other tasks.** The absorb commit can carry telemetry rows from other tasks that were dirty at the time. The spec accepts this. Confirm you're fine with it.

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 4
- Validation gaps: 2
- Notes: Spec review rounds 1–3 escalated the scaffold guard into provenance tracking; operator overruled and the guard became a content rule. Code review found AC-5–AC-8 negative-path regressions missing in round 1, fixed in Iteration 2; red-first runs for AC-1 and AC-2 were never executed.

Maintenance: lessons-learned.md plus this task's fragment have 18 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").
