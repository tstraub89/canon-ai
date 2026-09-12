---
name: canon-sweep
description: Use when the human asks to sweep, triage, or prune `docs/lessons-learned.md` — phrases like "sweep the lessons buffer", "let's do a lessons sweep", "promote or prune lessons learned", or explicit `/canon-sweep` invocation. Human-invoked only. A QA "buffer exceeds ~15 entries" note in a task's `done.md` or a just-closed release milestone are reasons to *suggest* a sweep to the human, never to start one. The skill proposes a verdict and the exact promoted text per entry and writes nothing until the human confirms. Not for appending new lessons (the QA phase does that) or for editing task notes.
allowed-tools: Read Glob Grep Edit Write Bash(git log *) Bash(git status *) Bash(git branch *) Bash(git diff *) Bash(git show *) Bash(git worktree list) Bash(canon task list)
effort: medium
---

# Lessons Sweep

Use this skill to triage the lessons-learned buffer: decide, entry by entry, whether each one is promoted into a permanent doc, kept in the buffer, or pruned. The buffer is a staging area, not an archive. The sweep exists to keep it small and to keep the permanent docs from bloating.

**Promotion is rare.** Every line promoted is read by every agent on every future task, so it must earn that recurring cost. Most entries end as keep or prune. But the threshold that prompted the sweep is a reason to pay attention, not a target: never manufacture a prune to hit a count.

## When to use

- The human asks for a sweep.
- You notice a reason to suggest one: a task's `done.md` carries the QA signal that the buffer exceeds ~15 entries, or a release milestone just closed. Suggest it in one line and wait. Never start a sweep on your own.

## Preconditions

Triage (Steps 1 to 3) is read-only and can run from any checkout. Before **applying** anything (Step 4), run this preflight and stop if any check fails:

- `git status` is clean and `git branch --show-current` is a dedicated non-default branch.
- `git worktree list` shows the current directory as the main working tree, not a linked worktree. A task worktree is where a pipeline edits code; shared docs must not change there.
- `canon task list` shows no task with a phase in progress. A pipeline running in another worktree would otherwise pick up or collide with the sweep's edits to shared docs at merge time. If one is in flight, wait for it to reach `human_review` or stop it before applying. The sweep touches shared docs and should ship as its own small change through the normal review path.

Read before triaging:

1. `docs/lessons-learned.md` in full, including the HTML sweep comments at the bottom. They record what was kept with a re-evaluation condition and what was already promoted; they are the cheapest way to avoid redoing work.
2. The candidate destinations, so you can check coverage: `docs/patterns.md`, `docs/decisions.md`, `docs/architecture.md`, and the project's agent instruction files (`AGENTS.md`, `CLAUDE.md`) if it keeps them.
3. `git log docs/lessons-learned.md` since the last sweep comment, and the task IDs shipped in that window, so you can tell "did not recur" from "had no chance to recur."

## Step 1 — Triage every entry

Walk each entry through this sequence. Stop at the first stage that decides it, and write a one-line reason.

### Stage A — Is it already settled? → Prune

- **Already covered.** Grep the permanent docs for the concept, not the exact words. A restatement of an existing pitfall, decision, or rule is a prune.
- **Obsolete.** The code path, tool, or convention it describes no longer exists.
- **Self-evident.** A competent agent with no doc at all would already do this. Reminders of general good practice are not lessons.
- **Its prevention has landed.** A test, lint check, or gate now enforces it, or a tracked follow-up (an issue, a backlog item the project actually works from) has explicitly taken ownership. A note in a sweep comment is not ownership; do not prune an unresolved structural lesson on the promise of a future test.

### Stage B — Is the evidence sufficient? → Evaluate promotion

Promotion is on the table when either holds:

- **Recurrence.** It has bitten at least twice, in independent tasks. Check archived task notes and prior sweep comments for the second occurrence before claiming it.
- **Severity.** It bit once, but the cost of one more occurrence clearly exceeds the recurring cost of a rule read on every task. Say why in the reason.

And both of these hold:

- **Surprising or project-specific.** The reader could not have derived it from general experience.
- **Not already absorbed.** If an existing rule can take it as a clause, that is still a promotion, as an extension (Step 2). Only a brand-new rule requires that no nearby rule exists.

If the evidence is sufficient, go to Step 2 to pick the carrier. If it is not, fall through.

### Stage C — Otherwise → Keep, with a condition

- **Happened once, not severe.** Leave it and see whether it bites again.
- **Borderline and adjacent to an existing rule.** Note which rule, so the next sweep can decide on a one-clause graft without re-reading.
- **Kept before, with no chance to recur.** If no task since the last sweep touched the area the lesson is about, the absence of recurrence is not evidence. Keep it. Prune on "no recurrence" only when there was relevant exposure and it still did not bite, or the human decides to let it go. This never applies to an unresolved structural lesson: one whose prevention is a test, lint check, or gate that has not landed and has no tracked owner stays until it does (Stage A), regardless of recurrence.

A kept entry always carries an explicit condition: "re-evaluate if X recurs in a different task" or "prune at the next sweep if tasks touching Y ship without hitting this." "Keep, unsure" is not a verdict.

## Step 2 — Choose the smallest carrier

Promotion does not mean "write a new rule." Choose the lightest form that would have prevented the incident, in this order of preference:

1. **A comment at the site.** If the trap is local to one function, file, or config block, a one-line comment where the next person will trip is better than a rule read by every agent on every task.
2. **A test, lint check, or gate.** If the lesson can be enforced mechanically, prefer that over prose. If writing it is out of scope for the sweep, the entry stays in the buffer until the check lands or a tracked follow-up owns it (Stage A).
3. **Extending an existing rule.** Add a clause, a trigger-table row, or a second example to a rule that already exists. This is the most common shape of a real promotion.
4. **A new rule.** Only when no existing rule is close enough to absorb it. Keep it to the rule and its concrete prevention; cut the story of how it was discovered.

When the carrier is a doc, match the doc to the kind of truth:

| Kind of lesson | Home |
|---|---|
| A pitfall: something that looks right and silently isn't | `docs/patterns.md` (and its trigger table, if the project keeps one) |
| A settled decision or an explicit rule the project has chosen | `docs/decisions.md` |
| A command, validation, or environment gotcha | `docs/architecture.md`, validation section |
| A workflow rule every agent must know on every task, no matter what it is working on | The project's agent instruction files, if it keeps them. This is the highest bar: those files load into every session, so a rule lands here only when it is unconditionally load-bearing |

Rules of thumb for the promoted text:

- **Write the rule, not the war story.** Title names the rule. Body is rule, failure mode in one sentence, concrete prevention. Drop dates, task IDs, and the narrative of discovery; those stay in the buffer's git history.
- **Generalize past the incident.** The promoted form should read correctly to someone working on an unrelated feature. If it only makes sense with the original task in mind, it is not ready.
- **Verify anything executable.** If the entry prescribes a command, flag, or path, run it or check it exists before promoting. The buffer can carry an error for weeks; a permanent doc will carry it for years.
- **Lessons about the pipeline itself go upstream.** If the lesson is about canon's own behavior rather than this project's code, it belongs in a report to the canon-ai maintainers, not in this project's docs. Canon-managed files are overwritten on upgrade, so a rule written into one is lost. If this repository *is* the canon-ai source, upstream is here: the promotion lands in the managed file's authoritative copy and follows the project's own mirror-sync workflow.
- **A rule in the wrong home is nearly as bad as no rule.** Agents read docs just in time; a spec rule buried in a pitfalls doc is never read at spec time.

## Step 3 — Propose before writing

Present the human with a verdict table before touching any file:

```
| # | Entry (title) | Verdict | Carrier / condition | Why (one line) |
```

**For every promote row, also show the exact text you intend to add and exactly where it goes** (file and section, or the existing rule being extended, with the new clause in place). The permanent rule is the most consequential output of the sweep; the human approves the words, not just the classification.

Then ask for approval with `AskUserQuestion`, offering: approve all, approve with changes (the human names which rows to flip or which text to edit), or stop. Do not write until the human has confirmed. If the human flips a verdict or rewrites a rule, accept it and move on.

## Step 4 — Apply

Run the preflight above, then for each approved row:

- **Promote:** land the approved carrier, then delete the entry from the buffer. For a doc, make the edit exactly as approved. For a site comment, write the comment at the approved location. For a test, lint check, or gate, the entry leaves the buffer only once the check is actually in place; if it is deferred, the row is a keep, not a promote.
- **Prune:** delete the entry.
- **Keep:** leave the entry in place, byte for byte.

Then update the HTML sweep comments at the bottom of `docs/lessons-learned.md`. Add one comment for this sweep in the same shape as the existing ones:

```html
<!-- Buffer swept YYYY-MM-DD (N entries reviewed: A promoted, B kept in buffer, C pruned).
     Promotions → <destination>: <what was added, one line each>.
     Kept in buffer: <entry> — re-evaluate if <condition>.
     Pruned: <entry> — <reason>.
     Unresolved follow-ups: <structural fixes not yet landed, upstream reports not yet filed>.
     Prior entries are in git history. -->
```

Keep the comment block bounded, or it becomes the archive this file says it is not. Carry forward only what the next sweep needs: the current keep conditions and any unresolved follow-ups. Drop older comments whose promotions and prunes are fully settled; git history retains them.

## Step 5 — Hand off

Report to the human:

- the counts, and the number of entries remaining in the buffer. If it is still near or above the QA signal threshold, say why (approved keeps, unresolved structural follow-ups) rather than treating that as a failure;
- each promotion and where it landed;
- each follow-up that needs a decision: a test to write, an issue to file upstream, an entry waiting on ownership;
- the verification you ran on any command or path you promoted.

Do not commit. The human decides how the change ships, and it should get an independent review like any other below-pipeline edit.

## What this skill does not do

- Append new lessons. That is the QA phase's job, and its entry format is its own concern.
- Set the sweep threshold. The buffer's own "How to use" section owns that.
- Rewrite or reorganize entries it is keeping.
- Start a sweep without a human asking.
