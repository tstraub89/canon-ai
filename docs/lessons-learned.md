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

### Always cross-check committed state with `git diff HEAD`, not just `git status`, after a programmatic commit

*(2026-05-08, source: canon-on-canon dogfood, fixed inline 2026-05-08)*

Programmatic auto-commit functions that rely on `git status --porcelain` for their pre-flight checks (is-this-file-dirty, is-this-file-staged, etc.) can silently drop a real working-tree change if status reports a file as clean when it isn't. Causes vary — index races, partial recovery from earlier failures, worktree env issues — but the common shape is: the file has uncommitted changes on disk yet `git status` doesn't list it as dirty. The pre-commit checks all pass; the commit lands without the file; the pipeline advances without the actual implementation. To catch this defensively, run a post-commit `git diff HEAD --name-only -- <handoff files>` and abort if any handoff file's working-tree state still differs from HEAD. `git diff HEAD` queries the merkle tree directly rather than the status cache, so it's reliable even when status is unreliable. Canonical example: post-commit verification block in `autoCommitCode()` in `scripts/run-task/main.ts`. Surfaced via canon-on-canon iteration 3 of `handoff-verifier` (status.json was committed but `scripts/run-task.ts` and `tests/run-task-validation.test.ts` — which had real on-disk changes — were silently dropped from the commit).

### `--ship` must verify local task branch is fully pushed before destroying it

*(2026-05-08, source: canon-on-canon dogfood, fixed inline 2026-05-08)*

`--ship` ends by tearing down the worktree and deleting the local task branch — anything not on origin at that point is unreachable afterward. Don't trust the merge step alone to handle this; if the merge step misses an open PR for any reason (gh transient hiccup, draft state, query parsing quirk), the destruction still runs and unpushed local commits become dangling. Always pre-flight: for each `task/<id>` branch that exists locally, verify `local HEAD == origin HEAD`. If diverged, abort with a clear "push first, then re-run" message. Cross-check separately that no open PR exists for the branch when the merge step returned nothing. Canonical example: `assertTaskBranchPushed()` and `assertNoOpenPRForTask()` in `scripts/run-task/main.ts`, called at the top of `shipTasks()`. Surfaced via canon-on-canon dogfood — iteration 3's commits were on local task branch only, never pushed, then `--ship` deleted them.

### Refactor specs need numerical structural caps, not just behavioral goals

*(2026-05-09, source: split-run-task, in-flight observation)*

When a refactor spec targets smaller-tier models (mini-Codex etc.), behavioral goals like "`main.ts` is the orchestration loop, the rest goes to modules" are not enough — smaller models can do every individual extraction correctly while losing the *global invariant* across a long task. The failure mode is structural, not reasoning: the model understands the goal, but can't simultaneously hold "the duplicates have to *die*" and "extract these 80 functions to their new homes" across many turns of a 4500-line refactor. The result: new module files materialize correctly but the original file gets cloned alongside them, leaving two parallel implementations and the orchestration code calling the duplicates rather than the imports.

Prescriptive fix: for refactors targeting any model where the task spans more than ~1000 LOC of mutation, the spec should include **numerical caps** (e.g., "`main.ts` must be ≤ 400 lines after the change"), **explicit allow-lists** for what stays in the gutted file ("only `main()`, the four switches, and top-level error handling — see file:line refs"), and **explicit deletion expectations** ("for every function listed in AC-2 as moving to a module, its original definition in `scripts/run-task.ts` MUST be removed; reviewer greps for its name in `main.ts` post-refactor and fails the AC if it appears"). This pairs with the existing CLAUDE.md "Name effects to DELETE, not just effects to add" rule but applies it at the *whole-file boundary* level, not the per-effect level.

Diagnostic for next time: if a refactor reroutes on a "clone, not split" finding, the spec was under-prescriptive on structural invariants — not the model under-capable on reasoning. A spec patch with caps + allow-lists + deletion expectations is the recovery; bumping the model is the more expensive option that may not even be needed. Worth A/B'ing on the next big refactor if budget allows.

Canonical example: `tasks/_archive/split-run-task/review.md` Round 1, Stage 1 Finding 1 — first iteration produced a `main.ts` of 4574 lines (larger than the 4545-line original) with ~80 duplicate utility functions. AC-2's "orchestration loop only" boundary was qualitative, not numerical, and Codex held the extraction discipline but not the deletion discipline. **Status: not yet generalized to a second task — promote to CLAUDE.md spec-writing rules of thumb after the next big refactor confirms the pattern.**

### Use `--name-status` not `--name-only` when building path sets from git diff

*(2026-05-08, source: handoff-verifier)*

When comparing a set of file paths against `git diff` output, use `--name-status -M` rather than `--name-only -M`. With `--name-only`, rename detection (`-M`) is active but only the post-image (new) path is emitted — the pre-image (old) path is suppressed. Any code that builds a path set from the diff output and then checks whether a given path is "in the diff" will false-positive on the pre-image path of renamed files. With `--name-status`, rename lines appear as `R<score>\told\tnew` and you must explicitly expand both sides into the path set to treat renames symmetrically. The canonical implementation is `verifyHandoffAgainstDiffFromData()` in `scripts/run-task/validation.ts`. This bit `handoff-verifier` in round 3 after passing round 1 cleanly — `autoCommitCode()` already accepted the pre-image as a valid handoff entry, so the verifier had to match that contract.

### Verify internal function names exist before referencing them in spec ACs

*(2026-05-09, source: split-run-task)*

When a spec names a specific internal function or symbol as part of an AC (e.g., "the four phase-aware switches: `PHASE_ORDER`, `runPhase`, `checkAndRoute`, `canPhaseAdvance`"), verify each name exists in the codebase before finalizing the spec. A name that doesn't exist causes Codex to implement against the actual code shape, creating a mismatch between the AC text and the implementation — which cascades into ambiguous code-review findings and unnecessary doc corrections. The failure mode is subtle because Codex will typically implement the correct thing and note the discrepancy, but the review loop then has to adjudicate whether the AC was wrong or the implementation. Prevention: grep for any function or symbol the spec names before marking spec done. Surfaced in `split-run-task` — `canPhaseAdvance()` appeared in AC-3 and `docs/patterns.md` as a fourth phase switch but did not exist anywhere in the codebase.
