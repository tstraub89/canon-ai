# Lessons Learned

> Distilled cross-task insights. The QA phase appends entries here when a task surfaces a reusable insight that would have changed how a *different* task was approached.

## How to use this doc

This file accumulates over the lifetime of the project. Entries land here from two paths:

1. **QA distillation (automated, append-only)**: At the end of each task, the QA phase reads `tasks/<id>/notes.md` (raw scratchpad observations from any phase) and asks "would this have changed how a *different* task was approached?" If yes, it **appends** one entry for that task. If no, the detail stays in `notes.md` only. QA never edits, prunes, promotes, or reorganizes existing entries — appending its own task's entry is the only write it makes to this file.

2. **Lessons sweep (human-initiated and human-approved only)**: Promoting entries into permanent docs and pruning the buffer is a **human decision**. Agents never perform it autonomously, and no entry count ever auto-triggers it. Two occasions call for a sweep: (a) when this file exceeds ~15 entries — the QA phase notices and *signals* it with a one-line note in the task's `done.md`, but does not act; and (b) at the end of a release milestone — a human-recognized occasion, since the QA phase has no notion of release boundaries and emits no signal for it. Either way, a human runs the sweep when they choose to:
   - **Promote durable truths** to the right permanent doc — `docs/patterns.md` (a pitfall), `docs/decisions.md` (a settled decision), or `AGENTS.md` / `CLAUDE.md` (a workflow / spec / review rule). Then prune the entry here.
   - **Prune task-specific entries** that turned out not to generalize. Just delete them — the detail lives in the task's `notes.md` and the git history of this file.

The goal: this file is a *staging area*, not a permanent archive. Entries that prove durable get promoted by a human; entries that don't get pruned by a human. The total count stays manageable. Tombstones from past promotions are not preserved — `git log docs/lessons-learned.md` is the audit trail.

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

When a record references another by ID, computed fields (caches, transforms, ephemeral selections) calibrated for the old reference can survive an ID swap and produce stale-data bugs that are visible to users but invisible in logs. The fix: reset every derived field at every site that writes the ID — there's no single chokepoint for this. Canonical reset rule: reset derived state at every writer of the ID field. Grep all writers of the ID field before adding a new one.

---

> **TODO[canon]: Real entries land here as tasks ship. New projects start with this file mostly empty — that's fine. The discipline is: after every task QA, ask the "would this have changed how a different task was approached?" question, and only write if yes.**

---

<!-- Buffer swept 2026-06-21 (post internal-leak-gate-and-matrix-sync ship; 16 entries reviewed). Promotions → docs/patterns.md: (1) declare templates/ mirrors in BOTH spec Affected Files AND handoff Changes table (merged from 3 entries); (2) git-batch exit-128 bisection; (3) strip flags from re-exec child argv; (4) write-safety guards fail closed on probe error. Folded into the existing "Worktree runs: read files from the active checkout" pattern: the two REPO_ROOT-vs-process.cwd() test-file-read entries. Pruned (already-covered / spec_review- or CI-caught / generic / niche): docs-refs-check-in-Validation-Required (already in docs/architecture.md §Validation), git-grep-pathspec-excludes (generic git), QA-end-gate-AC-inversion, removing-scaffold-then-rescope-doctor/CI, ownership-sweep-includes-templates/docs, single-task-flag-out-of-types.ts, bare-:N-citation-suffix (mitigated by the :~ fix), fake-git-log-success-fixture, exit-hook-natural-exit. Kept in buffer: the per-task-prompt-variant entry below (borderline — re-evaluate next sweep). Prior entries are in git history. -->

### Per-task prompt variant requires both the state field AND template wording alignment

*(2026-06-11, source: recovery-surface-hardening)*

When adding per-task variant behavior to a shared template's prompt, storing the state is necessary but not sufficient — the template's generic wording must also defer to the per-task line, or the generic clause overrides the per-task customization entirely. Concrete case: the `reroute_exempt` implementation stored `reroute_exempt_prior_verdict` so prompts could render approved vs. failing flavors, but the `implement-reroute.md` template still had a generic "exempt task only re-verifies shared behavior" clause that would override the per-task failing-sibling line for any exempt task. The fix was a template change that makes the generic clause defer to whatever per-task line was injected. Pattern: when a spec adds state for conditional rendering, immediately audit every template that displays that state for a generic fallback clause that would negate it.
