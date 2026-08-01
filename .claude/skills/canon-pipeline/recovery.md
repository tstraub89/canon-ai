# Pipeline Snag Recovery

Patterns from real production use for when the pipeline gets stuck. Use them as first response, not last resort.

## Contents

- Auto-block on `spec_review` or `code_review` (loop cap hit)
- Phase mismatch — pipeline routes to `spec` when you expected `spec_review`
- `--ship` refuses: wrong phase
- Local branch diverged from origin after a squash-merge
- Parallel task PRs conflict on `tasks/<id>/*` at merge time
- Agent auth 401 mid-pipeline

---

## Auto-block on `spec_review` or `code_review` (loop cap hit)

When the loop cap is hit, the pipeline writes an `escalations[]` entry and stops. Two paths:

**Path A — authorize more loops (simple cap bump):**
```bash
MAX_REVIEW_LOOPS=6 canon run <task-id>
```

**Path B — stale-context reset** (use when the latest review flagged phrases that no longer exist in the spec — a session-resume staleness artifact):
```bash
canon task reset-spec-review <task-id>
MAX_REVIEW_LOOPS=6 canon run <task-id>
```

`reset-spec-review` marks `spec` done — accepting the current spec as-is — archives the existing review file as `*-prior-<N>.md` (so the next pass doesn't re-emit the same complaints), resets the review phase to pending, clears verdict and iteration counter, and drops the session ID. The next run re-reviews without another spec revision; raise the cap instead when the deferred spec revision should run before review.

Stop the reviewer loop once findings turn wording-only. Self-grep for flagged phrases in the current spec/code before running another expensive review pass.

**Never reset the iteration counter** to bypass the cap. Counter is durable signal of how many review rounds the task has burned — losing it hides cost from future operators.

## Phase mismatch — pipeline routes to `spec` when you expected `spec_review`

Cause: the loop-cap checkpoint now sits at the revision phase's own entry (see "Auto-block" above), so after a `spec_review` block, `spec` really is the correct next phase — it's the deferred revision, not a stale verdict.

Fix: raise the cap and resume (see "Auto-block" above for the command). Never reset the loop counter just to make the phase match what you expected — that bypasses the exact cap the block exists to enforce.

## `--ship` refuses: wrong phase

Cause: squash-merge captured a pre-progression `status.json`.

Fix (artifacts are on disk — this is paperwork). Use the verdict actually checked in `tasks/<task-id>/review.md` (`approved` or `approved_with_nits`) — the phase gate rejects a verdict argument that doesn't match the artifact:
```bash
canon task phase <task-id> code_review done <verdict-from-review.md>
canon task phase <task-id> qa done
canon run <task-id> --ship
```

## Local branch diverged from origin after a squash-merge

Symptom: `git pull --ff-only origin main` fails. Local has pipeline-telemetry commits that the squash-merge absorbed.

Fix:
```bash
canon task post-merge-sync
```

If local-only commits include real source changes (not just telemetry), the helper refuses and shows what's there — decide manually (push, rebase, cherry-pick).

## Parallel task PRs conflict on `tasks/<id>/*` at merge time

Cause: while task A's pipeline ran in its worktree, auto-commits touched task-A artifacts on task B's branch too. When task A merged and archived, task B's branch still has the in-flight versions.

Fix:
```bash
cd <task-B-worktree>
git fetch origin main
git rebase -X ours origin/main   # take main's side on task-A artifact conflicts
git push --force-with-lease origin task/<task-B-id>
```

## Agent auth 401 mid-pipeline

Fix: re-auth (`claude login`), then re-invoke the same `canon run` command. The pipeline resumes from the last completed phase. If the failed phase left `status.json` in `in_progress`, roll it back first:
```bash
canon task phase <task-id> <phase> pending
canon run <task-id>
```
