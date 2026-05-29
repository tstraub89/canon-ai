# Lessons Learned

> Distilled cross-task insights. The QA phase appends entries here when a task surfaces a reusable insight that would have changed how a *different* task was approached.

## How to use this doc

This file accumulates over the lifetime of the project. Entries land here from two paths:

1. **QA distillation**: At the end of each task, Claude reads `tasks/<id>/notes.md` (raw scratchpad observations from any phase) and asks "would this have changed how a *different* task was approached?" If yes, an entry lands here. If no, the detail stays in `notes.md` only.

2. **Lessons sweep** (periodic, not every task): when this file exceeds ~15 entries OR at the end of a release milestone, scan all entries and:
   - **Promote durable truths** to the right permanent doc — `docs/patterns.md` (a pitfall), `docs/decisions.md` (a settled decision), or `AGENTS.md` / `CLAUDE.md` (a workflow / spec / review rule). Then prune the entry here.
   - **Prune task-specific entries** that turned out not to generalize. Just delete them — the detail lives in the task's `notes.md` and the git history of this file.

The goal: this file is a *staging area*, not a permanent archive. Entries that prove durable get promoted. Entries that don't get pruned. The total count stays manageable. Tombstones from past promotions are not preserved — `git log docs/lessons-learned.md` is the audit trail.

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

### Refactor specs need numerical structural caps, not just behavioral goals

*(2026-05-09, source: split-run-task, in-flight observation)*

When a refactor spec targets smaller-tier models (mini-Codex etc.), behavioral goals like "`main.ts` is the orchestration loop, the rest goes to modules" are not enough — smaller models can do every individual extraction correctly while losing the *global invariant* across a long task. The failure mode is structural, not reasoning: the model understands the goal, but can't simultaneously hold "the duplicates have to *die*" and "extract these 80 functions to their new homes" across many turns of a 4500-line refactor. The result: new module files materialize correctly but the original file gets cloned alongside them, leaving two parallel implementations and the orchestration code calling the duplicates rather than the imports.

Prescriptive fix: for refactors targeting any model where the task spans more than ~1000 LOC of mutation, the spec should include **numerical caps** (e.g., "`main.ts` must be ≤ 400 lines after the change"), **explicit allow-lists** for what stays in the gutted file ("only `main()`, the four switches, and top-level error handling — see file:line refs"), and **explicit deletion expectations** ("for every function listed in AC-2 as moving to a module, its original definition in `scripts/run-task.ts` MUST be removed; reviewer greps for its name in `main.ts` post-refactor and fails the AC if it appears"). This pairs with the existing CLAUDE.md "Name effects to DELETE, not just effects to add" rule but applies it at the *whole-file boundary* level, not the per-effect level.

Diagnostic for next time: if a refactor reroutes on a "clone, not split" finding, the spec was under-prescriptive on structural invariants — not the model under-capable on reasoning. A spec patch with caps + allow-lists + deletion expectations is the recovery; bumping the model is the more expensive option that may not even be needed. Worth A/B'ing on the next big refactor if budget allows.

Canonical example: `tasks/_archive/split-run-task/review.md` Round 1, Stage 1 Finding 1 — first iteration produced a `main.ts` of 4574 lines (larger than the 4545-line original) with ~80 duplicate utility functions. AC-2's "orchestration loop only" boundary was qualitative, not numerical, and Codex held the extraction discipline but not the deletion discipline. **Status: not yet generalized to a second task — promote to CLAUDE.md spec-writing rules of thumb after the next big refactor confirms the pattern.**

### Parallel sub-agent integration audit at release-PR boundaries

*(2026-05-18, source: release v1.2.0 — Codex independent PR-level review on #82)*

The pitfall itself ("when adding a code path on a shared surface, route it through the existing safety queue") is in `docs/patterns.md`. The *workflow* lesson worth keeping here: on any release PR that bundles ≥3 task PRs touching shared surfaces, run a parallel sub-agent integration audit — one agent per touched surface — *before* squash-merging. The integration audit caught two real instances on the v1.2.0 release PR that neither task-level Codex reviews nor CI flagged (`canon upgrade` header-only sync bypassing the dirty-refusal queue; `findOpenPRNumber` not base-filtering while its sibling did). Each surface read in isolation looked correct; the bugs lived in the interaction. **Status: workflow used once on v1.2.0. The `/canon-review` skill (1.5.0) generalizes the parallel-sub-agent shape but for spec review, not release PR. Promote to a "Pre-release review checklist" in `docs/release-process.md` after the second release PR formally re-runs the audit.**

### Extract a private REPO_ROOT-only resolver to break a self-reference cycle rather than threading an explicit cwd through all callers

*(2026-05-25, source: worktree-canonical-task-state)*

When rewiring a resolver function (`taskDirFor`) to route through another resolver (`resolveTaskCwd`), check whether the second resolver calls the first — if it does, the naive rewire creates infinite recursion. The fix is to extract a private function that hard-codes the pre-rewire behavior (REPO_ROOT-anchored lookup), use it inside the inner resolver to break the cycle, and let the public function use the new routing for everyone else. The previous attempt on the same codebase (parser-cwd task) threaded an explicit `cwd` parameter through callers instead; Codex spec_review ran 3 rounds catching missed call sites before the task was abandoned. The private-function approach is ~4 lines and requires zero call-site changes. When you see "route X through resolver Y but Y already calls X," reach for the private-function extraction, not parameter threading.

### Adding a `CliArgs` field touches three files — list all three in Affected Files

*(2026-05-29, source: base-divergence-gate)*

`CliArgs` is defined in `scripts/run-task/types.ts`; `scripts/run-task/cli.ts` only imports it. Any spec that adds a field to `CliArgs` must list both `types.ts` (type definition) **and** `cli.ts` (parser + usage text) in Affected Files — missing `types.ts` causes a type-check block before Codex can prove the implementation compiles. A third file is also in scope: `tests/run-task-cli.test.ts` asserts the full parsed object shape, so a new field that changes the return type of `parseArgs()` will fail the existing parser shape tests. Omitting it from Affected Files triggers the "outside spec scope" deviation noted in the handoff. Prevention: before finalizing any spec that adds a CLI flag, grep for `CliArgs` in `types.ts` and check `tests/run-task-cli.test.ts` for a parser-shape snapshot test — both are cheap finds. Canonical spec: `base-divergence-gate` AC-4.

### Parse structured author-facing input cell-by-cell with explicit rejection, not permissive whole-string regex

*(2026-05-19, source: handoff-changes-table-strict-parser — v1.3.0 release)*

When parsing a structured field where each cell has a defined shape (e.g., a markdown table column expected to contain exactly one backtick-quoted path), a permissive `` /`([^`]+)`/ `` regex run against the whole cell silently extracts whatever first match it finds and discards the rest. The v1.3.0 handoff parser hit this: a malformed cell like `` `sitemap.xml`, `llms.txt` `` silently extracted only `sitemap.xml` (a non-existent root path) and dropped the real `public/sitemap.xml` referenced elsewhere. The handoff passed parsing but downstream commit / coverage checks failed with cryptic "missing file" diagnostics — the actual contract violation (multiple paths in one cell) was invisible. Strict parsers anchor each cell to exactly one expected shape and reject malformed cells with the specific reason at the parse boundary. When adding a parser for any author-facing structured field, prefer strict per-cell validation over permissive whole-string regex; "silently drop data" is much worse than "loud rejection at parse time." Canonical example: `parseHandoffPathCell` in `scripts/run-task/validation.ts`, which anchors to either `` `path` `` or `[path](url)` and rejects combined rows, wildcards, and unfilled `<...>` placeholders.
