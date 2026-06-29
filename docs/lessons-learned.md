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

### In tiered pipelines, reviewer-enforced rules need author-side homes too

*(2026-06-25, source: spec-bugfix-diagnosis-rule)*

A rule that names a reviewer checkpoint as its enforcement point gives false confidence to authors on tiers where that reviewer doesn't run. Concrete case: the bug-fix mechanism-confirmation rule lived only in the `spec_review` prompt; fast-tier (S, non-delicate) bug fixes skip `spec_review`, so the rule silently reached nobody on the exact tier most likely to ship an unverified premise. Fix: home the rule on the author-facing surfaces (skill + template) and frame it as the author's own obligation — with an explicit call-out that the reviewer may not run — rather than as a thing a reviewer will catch. Grep for "reviewer will catch" / "spec_review will" in any guidance targeting a fast-tier audience.

### Multi-surface escape clauses must carry the full predicate in every occurrence

*(2026-06-25, source: spec-bugfix-diagnosis-rule)*

When the same conditional escape clause appears across multiple guidance surfaces, every occurrence must state the full predicate — not a shortened form. Dropping even one conjunct silently widens the escape. Concrete case: the within-reason escape required "environment-bound AND a faithful repro is impractical"; one surface rendered only "if a direct test is impractical," which would have let any hard-to-test case skip verification. Code review caught this as a spec_gap before ship. Rule: when a spec defines an escape predicate with multiple conjuncts, add a verification step that greps all target surfaces for the shorter single-conjunct form and rejects any hit.

### Task artifacts are uncommitted at code_review time — `getScopedDiff()` naturally excludes them

*(2026-06-26, source: code-review-codex-lens)*

When designing a review or validation step that should see only source changes (not task docs), there is no need to filter out `spec.md`, `plan.md`, `handoff.md`, `notes.md`, or `status.json`. Canon's `autoCommitCode()` stages only handoff-table source files (`main.ts:512`, `:605`–`:614`); task artifacts commit at QA-end. Because `getScopedDiff()` uses `git diff <base>...HEAD` (committed range only), the entire `tasks/<id>/` directory is simply absent from the diff at code_review time. Concrete case: spec_review raised a "spec-blindness" blocker assuming `handoff.md` would appear in the cold review diff — it doesn't. Verify this assumption by checking `autoCommitCode()` in `main.ts` if it comes up again; do not add artifact-filtering construction, which would make a cold review more spec-blind than intended and break same-surface symmetry with the other lenses.

### New task-state mutators need a worktree-routing regression test — the decisions doc rule is necessary but not sufficient

*(2026-06-28, source: task-metadata-helpers)*

When adding a new function that writes to a task's `status.json`, the "use `taskDirFor()`" rule in `docs/decisions.md` exists but is easy to violate in practice: Codex still used `taskDirFromRoot()` in the first iteration, which silently writes the supervising-checkout copy instead of the active worktree copy. The pattern: add a regression test that exercises a task with both a repo-root copy and a worktree copy of `status.json` and asserts only the worktree copy changes. Without that specific test shape, the bug passes all other validation checks undetected. Code review surfaced this as a correctness bug in round 1; the fix was adding the worktree-routing test alongside the resolver change. Reference: `tests/task-cli.test.ts` worktree-routing fixture added in iteration 2.

### Env-override tests must set the env var after import — not at module load time

*(2026-06-28, source: canon-snapshot-robustness)*

When testing a function that resolves a configuration value from an env var at call time, the test must mutate `process.env` AFTER the module import and BEFORE the call. If the production code accidentally captures the env var at module load (e.g. `const REPO = process.env.X ?? DEFAULT` at top level), a test that sets the var before import will pass while the production bug goes undetected. Concrete case: `captureCanonSnapshot()` was designed to resolve `CANON_UPSTREAM_REPO` at call time; the spec's AC-1 explicitly required the call-time guarantee, and the tests set `process.env` post-import to enforce it. Apply this shape to any future env-override test.

### Key past-pending warnings off actual phase state, not the cached top-level status pointer

*(2026-06-29, source: task-metadata-helpers)*

When adding a "warn if the task is already in progress" check to a mutator, use `status.phases` phase progress rather than the cached top-level `status` field. A freshly scaffolded task has all phases at `pending` but its top-level `status` already reads `spec` (the first phase in the pipeline); a check on the top-level pointer fires a spurious warning on every newly-created task. The correct predicate is "any phase has a non-pending state." Concrete case: `taskSet()` initially considered using the top-level pointer, but the implementation correctly keyed off phase state; the spec called out this distinction explicitly. Apply the same predicate to any future mutator that needs a "warn once in flight" check.

### Review artifacts need the same citation hygiene as docs and handoffs

*(2026-06-29, source: canon-snapshot-robustness)*

Path-like prose in `tasks/*/review.md` files is subject to `docs-refs-check` even though review artifacts are not part of the implementation surface. A phrase like "see tasks/&lt;id&gt;/spec.md Non-Goals" that references a path under a `validDirs` directory will trip the checker if the path is broken or the file is renamed — the same way a backtick ref in a handoff or doc would. Fix: apply the same "backtick path = a live reference" discipline in review.md files, or use prose/markdown-link form to describe non-code targets. Concrete case: `tasks/canon-snapshot-robustness/review.md` had a broken non-goal citation that tripped `docs-refs-check` in the reroute pass; cleaned in Iteration 3.

### For codebase-wide term renames, use per-family invariant gates — not enumeration lists

*(2026-06-27, source: add-xs-tier)*

When a spec renames or replaces a policy term across a large codebase, hand-enumerated grep lists produce round-over-round scope-expansion in spec review: each round surfaces a *new label family* (a different string shape for the same stale concept), not a missed instance of the same family. The fix is to identify every distinct string family up front via a structural sweep, then express each family's post-change invariant as an unambiguous zero-result grep gate. For Family A (fast-tier identity), a brittle literal-shape list still missed three separator variants; the solution was a word-bounded PCRE invariant (`\bS[\s,)\x60]*non-delicate`) that catches all separator forms and cannot match the post-change term. For Family C (size-set enumerations where the old string is a substring of the new), zero-result gating is structurally impossible — verify each surface positively by targeted ACs instead. Document the asymmetry in the spec so reviewers don't mis-read it as a gap. Concrete case: 7 spec_review rounds before the invariant-gate design converged; the structural per-family decomposition was the fix.
