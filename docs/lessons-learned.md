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

### ~~Use `--name-status` not `--name-only` when building path sets from git diff~~

*(promoted to `docs/patterns.md` "Known Pitfalls" — 2026-05-11)*

### ~~Verify internal function names exist before referencing them in spec ACs~~

*(promoted to `CLAUDE.md` "Spec-writing rules of thumb" — 2026-05-11)*

### Never use blanket git stash/clean inside a pipeline phase

*(2026-05-11, source: runtime-validation-phase)*

After `implement` closes and `autoCommitCode()` runs, only the source files listed in the handoff Changes table are committed. Task artifacts — `tasks/<id>/handoff.md`, `tasks/<id>/notes.md`, `tasks/<id>/status.json` — are typically uncommitted dirty files in the worktree. A blanket `git stash --include-untracked`, `git clean -fd`, or similar invocation will erase them; `syncWorktreeArtifacts()` then propagates the erasure to the main checkout, permanently losing handoff history.

Fix: any phase that needs to clean up after itself must use a pre/post `git status --porcelain=v1 -uall` delta (`postDirty \ preDirty`) and only touch paths in that delta. Explicitly exclude anything under `tasks/` from the cleanup set regardless of what the delta contains. Never use `git stash` or `git clean` in orchestrator-phase code. Canonical implementation: `scripts/run-task/phases/runtime-validation.ts` AC-11 scoped cleanup.

### Use `git rev-parse --show-toplevel` for repo root in linked worktrees

*(2026-05-11, source: runtime-validation-phase)*

In a linked worktree, `git rev-parse --git-common-dir` resolves to the supervising checkout's `.git` parent — not the active worktree. Any phase that needs paths local to the active worktree (artifact directories, cwd resolution, `package.json` location) must use `git rev-parse --show-toplevel` instead. The common-dir form is correct only when you explicitly want the supervising repo's root (e.g., reading canon's own policy files). See `scripts/run-task/env.ts` — `REPO_ROOT` was patched from common-dir to show-toplevel in this task.

### Porcelain-delta cleanup tests must use non-gitignored fixture paths

*(2026-05-11, source: runtime-validation-phase)*

`git status --porcelain -uall` does not surface gitignored files by design. Tests that verify scoped delta cleanup by writing `*.tmp` files (or other extensions matching `.gitignore` patterns) will find an empty delta and pass vacuously — they never actually exercise the cleanup path. Write fixture files with names that are not gitignored (e.g., `fixture-output.txt`, `test-check-artifact.log`) so `git status` surfaces them in the delta and the cleanup assertion has something to verify.

### "No new unit tests" does not mean skip the existing test suite

*(2026-05-15, source: scope-review-diff)*

When a spec's Validation Required section notes "no new unit tests required," that applies to authoring — not to running. Codex interpreted the deferred-unit-tests note as license to skip `npm test` entirely, so changes to prompt templates (which have golden-output regression coverage) reached CI with stale snapshots. The fix is in the spec: always include `npm test` as a checked validation item. Reserve the "no new tests required" note as a parenthetical explaining why the spec doesn't add cases — never as justification for skipping the run. Concrete check: if `tests/` exists and `npm test` is a valid command, it is always required regardless of whether new test files are being added.

### Shell scripts that lack a CANON_TASKS_DIR_OVERRIDE need a real tasks/ subtree in the test cwd

*(2026-05-11, source: counter-schema-migration)*

`scripts/task.sh` reads paths relative to the cwd and does not honor `CANON_TASKS_DIR_OVERRIDE`. Tests that exercise its jq logic (e.g., counter verdict transitions, reset helpers) must therefore run from a temp cwd that contains a `tasks/` subtree — typically a minimal mirror of the worktree's own `tasks/` directory created with `mkdtempSync`. Creating the temp root inside `process.cwd()` (the current worktree) keeps it writable in sandbox environments. The test fixture should symlink `worktreesRoot/<taskId> → process.cwd()` so any path that resolves through the worktrees root also lands in the writable sandbox. Without this setup, the shell path exercises file-not-found failures instead of the intended counter logic.
