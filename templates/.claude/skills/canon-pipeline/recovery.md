# Pipeline Snag Recovery

Patterns from real production use for when the pipeline gets stuck. Use them as first response, not last resort.

## Contents

- Auto-block on `spec_review` or `code_review` (loop cap hit)
- Same finding surviving 2+ rounds (possible model/effort ceiling — try a size bump)
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

## Findings keep clustering in the same mechanism (possible model/effort ceiling — try a size bump)

**Distinguish this from healthy convergence first.** Most multi-round tasks are fine — each round closing findings scattered across genuinely different, previously-untouched parts of the diff is normal iterative discovery, not a sizing problem. A task can turn out to have more real, distinct bugs than the spec anticipated, spread across the change — a smaller model finding and fixing every one of them across many rounds is healthy, not evidence of undersizing. Raising the loop cap (above) is the right tool for that shape.

**The actual signal is messier than "the same finding comes back."** Codex rarely leaves a finding flatly unfixed — the more common failure is whack-a-mole: the fix for round N's finding introduces or exposes a *new* problem in the same component in round N+1, or (since review is non-deterministic) a fresh lens simply notices something else nearby that was there all along. Either way, this is hard to tell apart in the moment from healthy scope discovery — you often can't be sure which it is until after the fact. The pattern worth watching for isn't "identical finding recurs," it's: **two-plus consecutive rounds keep producing new findings clustered in the same file or mechanism**, as opposed to new findings landing in different, previously-clean parts of the diff. Same neighborhood repeatedly, not same finding literally.

**Suggested response when that clustering shows up**, before burning a third bare cap-raise on the same tier: bump the task's `task_size` up **one** step (S→M, M→L, L→XL) so the *next* implement round and the *next* code_review round run at that tier's settings, then resume. Model, effort, and budget all scale with size, but not every single step moves all three — check `docs/pipeline-orchestrator.md`'s Codex Model/Effort Matrix for what your specific step actually changes before assuming it swapped to a stronger model:

```bash
canon task set <task-id> task_size <next-tier>
canon run <task-id>
```

Per `docs/pipeline-orchestrator.md`'s `canon task set` notes, this takes effect on the very next `canon run` — no restart of the run needed, and the change survives across the remaining phases of this task only (it doesn't alter sizing defaults for future tasks). Step up one tier at a time rather than jumping straight to XL — this is an experiment, not a fix you know works, and a task that turns out fine at M shouldn't get billed at XL rates on a hunch.

**If the clustering task is part of a bundle, resume with the full original ID list, not just that one task.** Bundle membership is whatever IDs you pass on the invocation — there's no persisted membership — and the tier is resolved as the max size across whichever IDs you pass. Bumping one member's `task_size` and then resuming with only that ID drops the others out of the bundle for that run, against a branch they still share; resume all of them together so the tier bump actually applies to the shared review and preflight doesn't reject sibling-owned changes as unaccounted for:

```bash
canon task set <task-id-1> task_size <next-tier>
canon run <task-id-1> <task-id-2> <task-id-3>
```

`delicate` is not the lever here — it's a blast-radius flag (see the sizing guide above), not an interchangeable "make it stronger" switch, and reaching for it as a substitute for a size bump has real gotchas: it forces `effectiveSize` to XL for model selection but never changes the loop-cap bracket (which stays keyed to nominal `task_size`), and if the task was ever launched under `--full-send`, setting `delicate` on it makes every later `canon run` die without `--force` — `status.full_send` persists once set, regardless of whether you pass `--full-send` again. Use `task_size` for this; reserve `delicate` for genuine blast-radius calls.

**Already at XL and still clustering?** There's no stronger tier to escalate to — canon's already spending its best model/effort on this task. That's a different, stronger signal than "try a bigger model": it's worth treating as a probable spec or architecture problem rather than a capability one — consider whether the mechanism actually needs a `spec_gap` verdict and a reroute (see Phase Routing + Auto-Block in `docs/pipeline-orchestrator.md`) instead of another implement round at the same tier.

**If the task is already auto-blocked, the size bump alone won't move it — pair it with a cap raise above the current count.** The loop cap is keyed off *nominal* `task_size`: bumping one tier only changes the cap's *bracket* when the step crosses M→L (3 → 5); S→M and L→XL stay in the same bracket. And even a bracket increase doesn't help if the persisted iteration count already meets or exceeds the new cap. Set `MAX_REVIEW_LOOPS` above the current count in the same invocation, regardless of which step you're taking:

```bash
canon task set <task-id> task_size <next-tier>
MAX_REVIEW_LOOPS=<current-count + 1 or more> canon run <task-id>
```

This is the same env var from the plain loop-cap fix above — the difference here is you're also changing the model tier for that next round, not just extending the budget on the existing one.

**Why this is worth trying despite being an ambiguous signal:** canon's own code review is already an expensive multi-lens stack per round — a cold-Codex diff pass plus a Claude foreman that spawns an anchored lens and a cold lens and synthesizes all three. Spending that same expensive stack a third time against a mechanism that's kept generating findings for two rounds running is a worse bet than trying the escalation once, even without certainty it's a genuine ceiling rather than a legitimately gnarly piece of code. There is no controlled comparison proving a stronger model holds a mechanism's whole picture better than mini/Sonnet does — canon has hit this same kind of unprovable-in-aggregate tuning question before (see the M-vs-L `spec_review` effort hypothesis in `docs/pipeline-orchestrator.md`'s Codex Model/Effort Matrix section) and treated it as a hypothesis to act on cheaply rather than something to prove first.

**Log the outcome.** Whichever way it goes, append a line to `tasks/<id>/notes.md` noting whether the bump broke the clustering or the same mechanism kept generating findings at the higher tier too. That's how this graduates from anecdote to evidence — if bumps keep breaking the clustering, it's worth writing up as a durable pattern in `docs/lessons-learned.md`; if bumps keep *not* helping, that's worth knowing too before recommending this more broadly.

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
