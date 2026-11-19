---
name: canon-status
description: Use when the human asks where canon tasks stand — "where are we", "pipeline status", "what's in flight", "what should I work on next", "what's blocked", or explicit `/canon-status` invocation. Also use at session start when several canon tasks may be in progress and a map of what needs attention vs. what's still running is needed. Read-only — surfaces task phase, blockers, and recommended next action across all in-progress tasks.
allowed-tools: Read Glob Grep Bash(canon task *) Bash(git branch *) Bash(git rev-list *) Bash(git log *) Bash(git status *)
effort: low
---

# Pipeline Status

```!
echo "Branch:"
git branch --show-current 2>/dev/null
echo "Unpushed commits:"
git rev-list --count HEAD --not --remotes 2>/dev/null
echo ""
canon task list 2>/dev/null || echo "(no tasks)"
```

---

## Instructions

Use Glob on `tasks/*/status.json` only to discover task IDs — skip `tasks/_archive/`. Then get each task's state with `canon task status <id>`, **not** by reading the REPO_ROOT file: for worktree tasks past plan, the REPO_ROOT copy is the stale pre-implement scaffold, and `canon task status` routes to the live worktree copy automatically.

Produce a status report with the sections below. **Omit any section that has no entries.** Don't show empty headers.

Be direct and opinionated. Don't just describe state — tell the operator what to do next and flag anything that looks wrong or worth watching.

---

### 🔴 Needs you

A task belongs here if **any** of these are true:

| Condition | Meaning |
|---|---|
| `spec.status = "done"` AND `spec_review.status = "pending"` AND `human_spec_gate = true` (fast tier, or not yet run) | Spec is ready for review |
| `spec_review.status = "done"` AND `plan.status = "pending"` (full tier halted at the spec gate; `human_spec_gate` reads `false` because the halt consumed it) | Spec reviewed, waiting on you: read `spec.md` and `spec-review.md` including the `Author` Judgment Calls rows, then re-run `canon run <id>` |
| `qa.status = "done"`, `human_review.status = "pending"`, no `.pr-number` file in the task dir | QA done, probably no PR yet; confirm on GitHub that none was opened by hand, then run `canon run <id> --pr` |
| Same state WITH `.pr-number` | Draft PR probably open; the file is only a lookup hint and keeps its number after the PR closes or merges, so confirm the PR is still open on GitHub, then wait for approval, mark ready and `canon run <id> --ship` |
| Any phase has `status = "blocked"` | Something is stuck (read the newest `escalations[]` entry for the reason; older entries are history) |

For each entry, be specific about what to do:

```
**task-id** — Title
→ [exact next action — e.g. "Read tasks/<id>/spec.md and say 'approved' to kick off the pipeline"]
```

Not just "awaiting approval" — tell them how to approve and what happens next.

---

### 🟡 In flight

Tasks where any phase has `status = "in_progress"` and no action is needed yet.

```
**task-id** — Title
→ Phase: [phase]  |  [iteration count or verdict if relevant]
```

**Flag warning signs inline:**
- `code_review.iterations_current_loop ≥ 2`: "Review looping — N rounds this cycle. Default cap is 3 for XS/S/M, 5 for L/XL."
- `spec_review.iterations_current_loop ≥ 2`: "Spec review looping — worth watching."
- `phases.<phase>.auto_block_count > 0`: "Previously auto-blocked [N] times — escalation history in tasks/<id>/status.json."
- If a task has been `in_progress` for the same phase across multiple `/canon-status` checks (infer from iteration counts and last-updated), note it: "Phase hasn't advanced — may be stalled."

If `code_review.verdict = "changes_requested"` and `implement.status = "in_progress"`, note: "Implementer iterating (round N)."

---

### 🟢 Done this branch

Tasks where `human_review.status = "done"`, which a finished `--full-send` tail sets (or an operator running `canon task phase <id> human_review done`): with an open draft PR, next is review, mark ready, `canon run <id> --ship`; with no PR, next is `canon run <id> --pr`.

```
**task-id** — Title
```

---

### Claude's take

End with 2–5 sentences that are actually useful — not a recap of what's above.

Things worth saying:
- What's the single most important thing to do right now?
- Is there anything that looks off (a task stuck in a phase, a review loop that's getting expensive, a worktree that might have diverged)?
- If all tasks are clean, say so: "Everything's moving — no action needed."
- If there's nothing in flight and nothing needs attention: "Pipeline is idle. Create a new task with `canon task new <id> "Title"`."

Don't pad. If there's nothing to say, don't say it.

---

## Related

- `/canon-spec` — author a new task when status shows the pipeline idle or "needs a next action."
- `/canon-pipeline` — drive an in-flight task forward.
- `/canon-spec-review` — pre-flight a spec before invoking the pipeline.
- `/canon-changelog` — draft release notes when status shows shipped tasks.
