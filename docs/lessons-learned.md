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

### A grep AC's exception list growing across review rounds signals mis-scoping, not under-specification

*(2026-08-20, source: relax-reroute-gate-post-implement)*

When a spec AC verifies "no live surface states the old rule" via a repo-wide grep, and each `spec_review` round finds one more class of hit that needs to be excused (round 3: two leave-as-is classes; round 4: a third, pointing at a fourth), the temptation is to add the newly-found exception and move on. That pattern does not converge — `relax-reroute-gate-post-implement` measured it directly: `docs/BACKLOG.md` alone carried roughly a dozen more co-occurrences of the swept term, all dated history. The fix is not another exception; it's replacing the enumerated exception list with a small number of closed-form rules the grep's *scope* is defined by (e.g., "dated/historical records are categorically excluded" and "within live files, only prose stating a precondition counts, not any mention of the term"). The tell: if a grep AC's leave-as-is list grew on two consecutive rounds, stop adding a third exception and instead ask what closed-form rule would have excluded the whole class from the start.

---

<!-- Buffer swept 2026-08-22 (3 entries reviewed: 1 promoted, 1 kept in buffer, 1 pruned).
     Promotion → docs/patterns.md: "Operator-facing text is often rendered by independently-authored duplicates — grep the surface class" as a new pitfall + Trigger Table row (from the duplicate-presentation-surfaces entry; strengthened by a second same-week instance in archive-review-on-reroute's dual review.md prompt pointers).
     Kept in buffer: the grep-AC-exception-list-growth entry — adjacent to two existing canon-spec SKILL rules (≥3-iterations read-content, permitted-to-remain buckets); re-evaluate for a one-sentence SKILL graft if it recurs.
     Pruned: the post-mutation-message entry — near-truism, single task pair, adjacent territory already covered by patterns.md's state-dependent-operator-message pitfall; detail survives in tasks/_archive/relax-reroute-gate-post-implement/notes.md.
     Prior entries are in git history. -->

<!-- Buffer swept 2026-08-11 (14 entries reviewed: 12 promoted, 2 pruned; buffer now empty).
     Promotions → .claude/skills/canon-spec/SKILL.md rules of thumb: (1) the "≥3 spec_review iterations" bullet rewritten to read round *content* not count — new-structural-case vs narrowing-an-existing-one — and to prefer dropping the mechanism class / deferring to a layer that already owns the concern over another round of hardening (merged from the review-verdict-freshness-guard, stable-validation-ids, and fix-installed-provenance-version entries); (2) "Behavioral contracts, not mechanics" extended with the code-altitude symptom and the non-binding Implementation Notes remedy (update-install-root-provenance); (3) "Codebase-wide term renames" extended with the paraphrase-sweep and permitted-to-remain-bucket checks (allow-comma-separated-multipath-cells + default-codex-models-to-5-6-generation); (4) new bullet: enumerate every caller and classify agent-vs-orchestrator execution context before asserting a mechanism (reconcile-qa-quality-log-summary).
     Promotions → docs/patterns.md: three-gate rename reconciliation as a new pitfall + Trigger Table row (relocate-orchestrator-to-src); state-dependent operator-message clause builder + state-varying test pair as a new pitfall (preroute-review-loop-autoblock); worktree realpath canonicalization and confirm-the-tool-can-produce-the-state as Test-writing-pitfalls bullets.
     Promotion → docs/architecture.md Validation table: `npm test -- <file>` does not scope, with the correct direct-runner invocation. NOTE: the source entry attributed this to Vitest and prescribed `npx vitest run` — this repo has never used Vitest (`node --test`), so the corrected command was verified by execution before promoting; the table's own runner command was also stale (missing the md-loader import).
     Pruned: the literal-AC-vs-tested-invariant entry (kept borderline at the last sweep, no recurrence in ~1 month, and its only real home is the implement prompt template, not a doc); the guardrail-prompt-calibration entry (already promoted — docs/decisions.md "Guardrail prompts carry an implicit model-strength calibration").
     CARRIER NOTE: the spec-writing rules-of-thumb block is triplicated — `.claude/skills/canon-spec/SKILL.md` (conversational `/canon-spec`) plus `src/orchestrator/prompts/templates/spec.md` and `spec-revision.md`, which the *pipeline's own* spec phases render. This commit carries only the internal-docs half of the sweep; the four rules above land in a separate adopter-visible PR (SKILL + mirror + both prompt templates + prompt goldens + `dist/`), so they are deliberately pruned from this buffer rather than dropped. Carrier coverage is NOT uniform across those four: (1), (2) and (4) reach all three carriers, but (3) — the `Codebase-wide term renames` extension — is **skill-only**, because that base rule has never existed in the phase prompts and importing the whole rule family there would exceed a sweep's scope. So a pipeline-authored spec does not get the paraphrase-sweep or permitted-to-remain checks; only a spec authored through `/canon-spec` does. Closing that gap is a separate decision, not an oversight.
     Prior entries are in git history. -->

<!-- Buffer swept 2026-07-16 (16 entries reviewed). Promotions → docs/patterns.md: (1) multi-surface guidance rules need every-tier author-side homes + full predicate at every occurrence (merged from the two spec-bugfix-diagnosis-rule entries); (2) trackedness classifier checks dirty/status before ls-files; (3) gate exemptions apply before every decision reading the same dirty set; (4) env-override-after-import and placeholder-fixture-invalidation as Test-writing-pitfalls bullets; (5) worktree-routing regression test for new status.json writers folded into the "Worktree runs" pitfall; (6) the no-mirror inverse case folded into the "Declare templates/ mirrors" pitfall; (7) getScopedDiff-excludes-task-artifacts folded as a corollary into the blanket-stash pitfall. Promotion → .claude/skills/canon-spec/SKILL.md rules of thumb: per-family invariant gates for codebase-wide renames. Pruned (borderline-no-recurrence / niche / test-pinned): per-task-prompt-variant (kept borderline last sweep, no recurrence), past-pending-warning-predicate, review.md-citation-hygiene, preserved-dirt-restore-point (pinned by AC-11 test in shipped --ship code). Kept in buffer: two entries for re-evaluation at the next sweep — both were resolved by the 2026-08-11 sweep above (one promoted, one pruned), and the buffer is now empty. Prior entries are in git history. -->

