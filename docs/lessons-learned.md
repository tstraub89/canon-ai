# Lessons Learned

> Distilled cross-task insights. The QA phase appends entries here when a task surfaces a reusable insight that would have changed how a *different* task was approached.

## How to use this doc

This file accumulates over the lifetime of the project. Entries land here from two paths:

1. **QA distillation**: At the end of each task, Claude reads `tasks/<id>/notes.md` (raw scratchpad observations from any phase) and asks "would this have changed how a *different* task was approached?" If yes, an entry lands here. If no, the detail stays in `notes.md` only.

2. **Lessons sweep** (periodic, not every task): when this file exceeds ~15 entries OR at the end of a release milestone, scan all entries and:
   - **Promote durable truths** to the right permanent doc — `docs/patterns.md` (a pitfall), `docs/decisions.md` (a settled decision), or `AGENTS.md` (a workflow rule). Leave a tombstone here pointing to the new home.
   - **Prune task-specific entries** that turned out not to generalize. Just delete them — the detail lives in the task's `notes.md`.

The goal: this file is a *staging area*, not a permanent archive. Entries that prove durable get promoted. Entries that don't get pruned. The total count stays manageable.

## Entry format

Each lesson is a short paragraph with this shape:

```markdown
### Short imperative title naming the rule

*(date YYYY-MM-DD, source: TASK-ID or `manual`)*

The rule, then the failure mode it prevents (specific incident if recent), then the concrete prevention (what to grep for, what to verify, where the canonical example lives). Reference symbols/files via the `` `SYMBOL` in `path/file.ts` `` form.
```

The title is the lesson — a future reader scanning headings should learn the rule from titles alone. Resist the urge to make it cute or descriptive of the bug; name the *rule that prevents the bug*.

## Example entry

### Always reset derived state when source identifier changes

*(2026-04-12, source: feat-photo-swap)*

When a record references another by ID, computed fields (caches, transforms, ephemeral selections) calibrated for the old reference can survive an ID swap and produce stale-data bugs that are visible to users but invisible in logs. The fix: reset every derived field at every site that writes the ID — there's no single chokepoint for this. Canonical reset helper: `resetDerivedFields()` in `src/utils/state.ts`. Grep all writers of the ID field before adding a new one.

---

### handoff.md is read from disk by the verifier, not from the committed diff

*(2026-05-07, source: handoff-verifier)*

`handoff.md` is written to disk in the worktree during the implement phase but is **not committed** before code_review — only the Codex-authored source files listed in the handoff Changes table land in the auto-commit. Any tool that cross-checks the handoff against `git diff` must read the handoff file directly from disk (`tasks/<id>/handoff.md`) rather than expecting it to appear as a changed file in the diff. Getting this backwards produces a false "in diff but not in handoff" finding for `handoff.md` itself. Canonical example: `verifyHandoffAgainstDiff()` in `scripts/run-task.ts`.

> **TODO[canon]: Real entries land here as tasks ship. New projects start with this file mostly empty — that's fine. The discipline is: after every task QA, ask the "would this have changed how a different task was approached?" question, and only write if yes.**
