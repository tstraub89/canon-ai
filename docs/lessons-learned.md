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

<!-- Buffer swept 2026-07-16 (16 entries reviewed). Promotions → docs/patterns.md: (1) multi-surface guidance rules need every-tier author-side homes + full predicate at every occurrence (merged from the two spec-bugfix-diagnosis-rule entries); (2) trackedness classifier checks dirty/status before ls-files; (3) gate exemptions apply before every decision reading the same dirty set; (4) env-override-after-import and placeholder-fixture-invalidation as Test-writing-pitfalls bullets; (5) worktree-routing regression test for new status.json writers folded into the "Worktree runs" pitfall; (6) the no-mirror inverse case folded into the "Declare templates/ mirrors" pitfall; (7) getScopedDiff-excludes-task-artifacts folded as a corollary into the blanket-stash pitfall. Promotion → .claude/skills/canon-spec/SKILL.md rules of thumb: per-family invariant gates for codebase-wide renames. Pruned (borderline-no-recurrence / niche / test-pinned): per-task-prompt-variant (kept borderline last sweep, no recurrence), past-pending-warning-predicate, review.md-citation-hygiene, preserved-dirt-restore-point (pinned by AC-11 test in shipped --ship code). Kept in buffer: the two entries below — re-evaluate next sweep. Prior entries are in git history. -->

### When a literal AC conflicts with an already-tested behavioral invariant, preserve the invariant and narrow the fix

*(2026-07-13, source: upgrade-destination-classification)*

A late-added AC can be worded more broadly than the spec author intended, especially when it's inserted during spec_review to close a gap ("this file should refuse the same as any other managed target") without re-checking it against the suite's existing tested contracts for that specific file. Concrete case: AC-13 asked `scripts/docs-refs-config.mjs` to refuse untracked-existing content "the same as any other managed target" — read fully literally, that would also make a *tracked-clean* customized config overwritable whenever its content diverged from the shipped template, silently destroying committed adopter customizations that an existing, passing test explicitly protected (the exact bug class the task was fixing, reintroduced for one file). At plan time, the resolution was to keep the "adopter fully owns tracked-clean content forever" invariant untouched and satisfy the AC's literal test scenario (untracked + non-identical) narrowly, documenting the interpretation and isolating it to one branch so a human or reviewer could redirect cheaply if they disagreed. Rule: before implementing a broadly-worded AC, grep the existing suite for tests already protecting the specific surface it touches; if the literal reading would flip a passing test's asserted behavior, narrow the implementation to the AC's concrete scenario and flag the interpretation rather than guessing which one wins.

### When a mechanism keeps failing for the same structural reason across rounds, drop the mechanism class instead of iterating within it

*(2026-07-16, source: review-verdict-freshness-guard)*

When successive spec_review rounds reject different designs for the same underlying incompatibility — not new bugs in the current attempt, but the same root conflict resurfacing in a new shape — the fix is usually to abandon the whole mechanism class rather than refine it again. Concrete case: round 1 rejected a whole-file fingerprint (can't prove the *verdict* is fresh, only that the file changed); round 2 rejected verdict-scope invalidation on two structural grounds (the parser has no `## Verdict`-section locator, so proving invalidation is impossible to verify; and invalidating the latest scope destroys completed-round history the artifact is required to preserve). Both rejections shared one root: any *in-band* freshness mechanism — one that makes the shared, cumulative, append-only artifact self-describe its own freshness — fights the parser's loose grammar and the artifact's history-preservation contract at the same time. Chasing maximal in-band soundness was itself what expanded scope each round. Round 3 pivoted to a fail-closed park that reads no artifact at all on the crash path, and every prior structural objection evaporated by construction. Rule: at the 3+-round scope-expansion checkpoint, before proposing another refinement, check whether the last two rejections share a structural root; if they do, ask whether eliminating the mechanism class that root lives in is cheaper than patching around it again.

### A "retired wording is gone" AC needs a semantic sweep, not just the primary rejection string

*(2026-07-17, source: allow-comma-separated-multipath-cells)*

When a spec ACs a grep for "the old wording is gone everywhere," the first-draft grep pattern tends to key off the literal string from the primary code path (e.g. the parser's own rejection message) and misses paraphrased occurrences elsewhere that describe the same retired behavior in different words. Concrete case: the initial AC-9 grep targeted `multiple paths in one cell|one path per (row|line)`, which caught the parser and its tests, but `docs/BACKLOG.md` described the same retired constraint as `rejects >1 backtick` and `single-path-per-row` — different phrasing, same stale claim — and slipped through spec_review's first pass. The fix was widening the regex after a human/Codex re-read of the affected docs, not adding more exact-phrase variants blind. Rule: when an AC greps for retired wording across `docs/`/templates/prose surfaces (not just code identifiers), read every file the change touches for paraphrases of the retired claim before finalizing the grep pattern — an exact-string grep only proves the literal phrase is gone, not that the retired behavior is undocumented everywhere.
