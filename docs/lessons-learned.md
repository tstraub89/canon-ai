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

> **TODO[canon]: Real entries land here as tasks ship. New projects start with this file mostly empty — that's fine. The discipline is: after every task QA, ask the "would this have changed how a different task was approached?" question, and only write if yes.**

---

### Refactor specs need numerical structural caps, not just behavioral goals

*(2026-05-09, source: split-run-task, in-flight observation)*

When a refactor spec targets smaller-tier models (mini-Codex etc.), behavioral goals like "`main.ts` is the orchestration loop, the rest goes to modules" are not enough — smaller models can do every individual extraction correctly while losing the *global invariant* across a long task. The failure mode is structural, not reasoning: the model understands the goal, but can't simultaneously hold "the duplicates have to *die*" and "extract these 80 functions to their new homes" across many turns of a 4500-line refactor. The result: new module files materialize correctly but the original file gets cloned alongside them, leaving two parallel implementations and the orchestration code calling the duplicates rather than the imports.

Prescriptive fix: for refactors targeting any model where the task spans more than ~1000 LOC of mutation, the spec should include **numerical caps** (e.g., "`main.ts` must be ≤ 400 lines after the change"), **explicit allow-lists** for what stays in the gutted file ("only `main()`, the four switches, and top-level error handling — see file:line refs"), and **explicit deletion expectations** ("for every function listed in AC-2 as moving to a module, its original definition in `scripts/run-task.ts` MUST be removed; reviewer greps for its name in `main.ts` post-refactor and fails the AC if it appears"). This pairs with the existing CLAUDE.md "Name effects to DELETE, not just effects to add" rule but applies it at the *whole-file boundary* level, not the per-effect level.

Diagnostic for next time: if a refactor reroutes on a "clone, not split" finding, the spec was under-prescriptive on structural invariants — not the model under-capable on reasoning. A spec patch with caps + allow-lists + deletion expectations is the recovery; bumping the model is the more expensive option that may not even be needed. Worth A/B'ing on the next big refactor if budget allows.

Canonical example: `tasks/_archive/split-run-task/review.md` Round 1, Stage 1 Finding 1 — first iteration produced a `main.ts` of 4574 lines (larger than the 4545-line original) with ~80 duplicate utility functions. AC-2's "orchestration loop only" boundary was qualitative, not numerical, and Codex held the extraction discipline but not the deletion discipline. **Status: not yet generalized to a second task — promote to CLAUDE.md spec-writing rules of thumb after the next big refactor confirms the pattern.**

### When adding a code path on a shared surface, route it through the existing safety queue

*(2026-05-18, source: release v1.2.0 — PR #82 Codex review + 3-agent integration audit)*

When a feature adds a new write, lookup, or check that touches a surface another feature already governs (a queue, gate, guard, or allowlist), the new path must flow through the existing infrastructure rather than spawning a parallel path. Two real instances from the v1.2.0 release surfaced because the features shipped in separate PRs: (1) `canon upgrade` header-only sync (PR #80) wrote directly to disk and pushed to `upgraded[]`, bypassing the `pending` → dirty-refusal → `--check` / `--force` flow that PR #79 added to the same `runUpgrade()` — Codex P1 on the release PR. (2) `findOpenPRNumber` (originally PR #75) didn't base-filter even after PR #77 added base-filtering to its sibling `findMergedPRNumber` — Codex P2 on the same release PR. The shared shape: feature B touches a surface feature A already governs, but adds its own write/lookup outside A's queue.

Diagnostic for next time: when extending a function with a new write/check, grep for the existing queue/guard inside it and join. When adding a sibling helper to an existing one, check whether every invariant the original holds applies to the sibling too. The integration-audit pattern (parallel sub-agents on each touched surface) caught two more instances on the v1.2.0 release before they shipped — worth re-using on any release PR that bundles ≥3 PRs touching shared surfaces.

**Promote to `docs/patterns.md` "Known Pitfalls" — landed there 2026-05-18 with both canonical examples**; keeping this entry for the workflow lesson (parallel sub-agent integration audit at release boundaries) until the second release confirms the workflow generalizes.

### "Clean tree" is not a proxy for "origin matches HEAD"

*(2026-05-18, source: release v1.2.0 — Codex independent PR-level review on #82)*

`git status --porcelain` returning empty means no uncommitted edits — it does *not* mean origin is in sync with HEAD. Local commits made after a previous push leave a clean tree but a divergent origin. Any code path that treats "clean tree" as a proxy for "nothing to push" will silently drop those commits. Symmetric corollary: "origin/<branch> exists" is not a proxy for "origin matches HEAD" either; the local remote-tracking ref can be stale if a prior fetch failed.

Generalization beyond this one bug: don't infer the state of one git invariant from a different git invariant. The check is cheap; do the actual check. Canonical fix on the v1.2.0 bug: always run `git push origin <branch>` before checking remote state — push is idempotent (no-op when origin already matches the tip), and is cheaper than the silent-drop bug it prevents. Canonical example: PR-exists branch of `commitHumanReviewFiles()` in `scripts/run-task/main.ts`.

**Promoted to `docs/patterns.md` "Known Pitfalls" — landed there 2026-05-18.** Keeping a stub here so the "don't infer one git invariant from another" generalization stays visible across other contexts (e.g., "branch is checked out" ≠ "worktree directory exists"; "PR exists" ≠ "PR is in the expected state").

### ~~Use `--name-status` not `--name-only` when building path sets from git diff~~

*(promoted to `docs/patterns.md` "Known Pitfalls" — 2026-05-11)*

### ~~Verify internal function names exist before referencing them in spec ACs~~

*(promoted to `CLAUDE.md` "Spec-writing rules of thumb" — 2026-05-11)*

### ~~Never use blanket git stash/clean inside a pipeline phase~~

*(promoted to `docs/patterns.md` "Known Pitfalls" — 2026-05-18 during v1.2.0 release sweep; canonical example updated from the deleted `runtime-validation.ts` to `PIPELINE_TELEMETRY_FILES`)*

### ~~Porcelain-delta cleanup tests must use non-gitignored fixture paths~~

*(promoted to `docs/patterns.md` "Known Pitfalls" → Test-writing pitfalls — 2026-05-18 during v1.2.0 release sweep)*

### ~~For large-removal tasks with structural grep ACs, generate the allow-list from `git grep`~~

*(promoted to `CLAUDE.md` "Spec-writing rules of thumb" — 2026-05-18 during v1.2.0 release sweep)*

### ~~`syncWorktreeArtifacts` can silently drop doc edits from the implementation commit~~

*(promoted to `docs/patterns.md` "Known Pitfalls" — 2026-05-18 during v1.2.0 release sweep; reframed as "Editing managed docs inside a worktree-isolated task — verify dirty before phase close")*

### ~~Subprocess tests for `main.ts` must use the active worktree's cwd~~

*(promoted to `docs/patterns.md` "Known Pitfalls" → Test-writing pitfalls — 2026-05-18 during v1.2.0 release sweep)*

### ~~Migration-tolerance test fixtures for retiring schema keys must build the key dynamically~~

*(promoted to `docs/patterns.md` "Known Pitfalls" → Test-writing pitfalls — 2026-05-18 during v1.2.0 release sweep)*
