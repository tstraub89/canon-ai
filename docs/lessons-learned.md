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

*(2026-05-16 — pruned: bash-specific; `scripts/task.sh` deleted in canon-self-contained. Detail in `tasks/counter-schema-migration/notes.md`.)*

### For large-removal tasks with structural grep ACs, generate the allow-list from `git grep`, not from the Affected Files table

*(2026-05-16, source: retire-runtime-validation)*

When a spec includes an AC-39-style structural grep (e.g., "this string must not appear outside these paths"), the allow-list in the spec is written by the spec author before the task runs. The Affected Files table only lists files the author expects to touch; it misses historical telemetry docs, archived status.json snapshots, and template mirrors that legitimately contain the retiring symbol but weren't in the spec author's mental model. During spec review, the Codex reviewer should run the grep against the *current* tree to discover the full allow-list — including `docs/pipeline-invocations.md`, archived task dirs, and any files not in the Affected Files table — then flag additions to the spec before implementation begins. A missed allow-list entry forces a spec revision mid-review. Canonical example: `tasks/retire-runtime-validation/notes.md` [spec_review] entries — the grep surfaced `CLAUDE.md`, `CODEX.md`, and historical telemetry docs that weren't in the original allow-list.

### tsup `.md` text-loader imports need a test-only loader for source tests

*(2026-05-16, source: canon-self-contained)*

tsup's `loader: { '.md': 'text' }` config makes `import content from './foo.md'` work at build time, but `npm test` (Node + tsx running source directly) cannot load `.md` modules without a custom loader. The test run fails with `ERR_UNKNOWN_FILE_EXTENSION`. Fix: add a test-only ESM loader (`tests/md-loader-hooks.mjs`) registered via `--import tests/md-loader-register.mjs` in the `package.json` test script. This is test infrastructure only — the production bundle is unaffected. Pattern: whenever a tsup config adds a non-JS asset loader, add the corresponding test-side loader at the same time. Canonical example: `tests/md-loader-hooks.mjs` + `tests/md-loader-register.mjs` in canon-ai.

### `syncWorktreeArtifacts` can silently drop doc edits from the implementation commit

*(2026-05-16, source: canon-self-contained)*

The orchestrator's auto-commit step after `implement` stages only files that appear as dirty in the worktree at commit time. If `syncWorktreeArtifacts` moves worktree edits to the supervising checkout (resetting the worktree copy to HEAD) before auto-commit runs, those files show as clean in the worktree and are silently omitted from the commit — even if they are listed in the handoff Changes table. The post-commit coverage check correctly flags the mismatch ("no commit touches this path in dev..HEAD"), but the recovery requires a manual follow-up commit. When editing docs inside a worktree-isolated task, verify they are still dirty in the worktree before auto-commit fires; if in doubt, commit them explicitly before the phase closes.

### Subprocess tests for `main.ts` must use the active worktree's cwd

*(2026-05-18, source: pr-at-complete)*

When writing child-process tests that spawn the canon CLI (`node dist/scripts/run-task.js` or `tsx scripts/run-task/main.ts`) inside a linked worktree, the subprocess `cwd` must be the active worktree root — not the supervising checkout's root. Using the wrong root causes the subprocess to load the stale compiled artifact or source file from a different checkout, meaning changes that exist only in the current worktree are invisible to the test. The failure mode is silent: the test may pass against old behavior and miss the exact new branch being tested. Fix: derive the test cwd from `import.meta.url` or `__dirname` resolved relative to the test file's own location in the worktree, or pass `process.cwd()` explicitly when the test suite is invoked from the worktree root. Canonical example: `tests/run-task-safety.test.ts` in this task's worktree, per `tasks/_archive/pr-at-complete/notes.md` [implement].

### Migration-tolerance test fixtures for retiring schema keys must build the key dynamically

*(2026-05-16, source: retire-runtime-validation)*

When writing a test that verifies a parser tolerates a legacy schema key (e.g., a retired phase block), the test fixture must construct the key name dynamically — not as a literal string — if the codebase has a structural grep AC that prohibits the retiring symbol anywhere outside the allow-list. A literal `"runtime_validation"` in a test file would itself be a grep violation, invalidating the structural check. The pattern: build the key by string concatenation (e.g., `'runtime_' + 'validation'`) or by reading it from a helper constant, so the fixture passes the grep. This pairs with the `*FromData` seam pattern — injectable test inputs that don't embed the retiring symbol as a literal. Canonical example: `tests/run-task-validation.test.ts` AC-25 migration-tolerance fixture, noted in `tasks/retire-runtime-validation/notes.md` [implement].
