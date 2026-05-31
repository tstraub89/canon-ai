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

### When multiple CLI commands duplicate a tolerance-critical resolution path, extract it once

*(2026-05-30, source: canon-watch)*

When multiple CLI commands independently implement the same "tolerant resolution" pattern — orphan-worktree fallback, EPERM-tolerant PID probing, `.canon-pid` → `heartbeat.pid` fallback — each copy drifts independently. The `canon-watch` spec discovered that `doctor`, `stop`, and the new `watch` command all needed the same orphan-worktree + PID resolution logic, with each existing command having its own private copy that differed subtly. The fix: extract `scripts/run-task/run-context.ts` as the single audited home for `gatherRunContext()`, inject read/clock/probe impls for testing, and migrate all three consumers onto it. Before writing a new consumer of any tolerance-critical path, grep for existing implementations in sibling commands — if 2+ already exist, extract before adding a third.

### Utility functions with multiple consumers must throw, not die

*(2026-05-30, source: canon-watch)*

When a utility function (e.g., `readStatus()`) is called by multiple consumers with different error-handling policies, it must throw on failure — not call `die()` / `process.exit()`. An initial revision converted `readStatus()` to `die()` to match the new `readStatusFromPath()` helper; this broke callers that intentionally wrap it in `try/catch` for fallback behavior (e.g., `doctor`'s active-orchestrator check, which falls back to a stale-read heuristic on parse failure). `die()` is appropriate at command-invocation boundaries where a failed read is always fatal; `throw` is required anywhere callers may need to handle the failure themselves. Check callers for `try/catch` before converting any shared utility from throw to die.

### Sync test fixtures must seed every sync target, or exact-drift-list assertions break

*(2026-05-30, source: adopter-gitignore-sync)*

When `sync-canon-templates.mjs` adds a new dedicated sync step (e.g., a `.gitignore` constant-source step), the test fixture in `tests/sync-canon-templates.test.ts` must also seed the corresponding file in `seedCanonFixture()`. Without the seed, the new sync step reports the absent file as "drift" on every test run, breaking the exact-drift-list assertions used by all existing tests (`['templates/docs/pipeline-orchestrator.md']`, etc.). The `adopter-gitignore-sync` spec caught this during `spec_review` and extended `seedCanonFixture` to include `templates/.gitignore`. Prevention: when adding a sync step in the `.mjs`, immediately find `seedCanonFixture` in the test file and add the matching seed line — it's a one-liner that prevents cascading assertion rewrites.

### Self-hosting guard tests must read the active checkout root, not REPO_ROOT

*(2026-05-30, source: adopter-gitignore-sync)*

When writing a test that reads a file the current task modified ("self-hosting guard" — verifying the canonical file matches the code constant), use the active checkout root (`process.cwd()` or equivalent at test time) rather than `REPO_ROOT`. In linked worktree runs, `REPO_ROOT` intentionally resolves to the supervising checkout, which does not have the task branch's changes; the guard would silently read the pre-change file and pass against stale content. `adopter-gitignore-sync` AC-14 hit this: `extractCanonBlock` run against `REPO_ROOT/.gitignore` in a worktree would have read the old file without the canon block. Since `process.cwd()` equals `REPO_ROOT` in a normal non-worktree checkout, using the active root is safe in both environments. Document this choice as an explicit deviation in `handoff.md` so reviewers understand the REPO_ROOT divergence is intentional.

### Export a path-injectable loader when a module loads a sibling config at import time

*(2026-05-31, source: docs-refs-adopter-config)*

When a module loads a sibling config file at module-init (e.g., via `new URL('./docs-refs-config.mjs', import.meta.url)`), the load happens against the *checker's install location* — not the repo being checked. Unit tests that exercise absence or malformed-config paths then need to control which path is loaded; without an injectable seam they either read the real sibling (defeating the absent-config test) or require the real file to be absent (fragile). The fix: export the loader with a path parameter (`loadAdopterConfig(path)`) so tests can point it at temp fixtures. The module-level load retains its original form for the no-argument fallback and the exported symbol values; tests call the exported function directly. Without the seam, AC coverage for absence and malformed-config requires monkey-patching the module or the filesystem — both are fragile and hard to reason about. Prevention: before writing absence/malformed-config tests for any module-init load, ask "can I pass a path to the loader?" — if not, add the injectable form before writing tests.

### Parse structured author-facing input cell-by-cell with explicit rejection, not permissive whole-string regex

*(2026-05-19, source: handoff-changes-table-strict-parser — v1.3.0 release)*

When parsing a structured field where each cell has a defined shape (e.g., a markdown table column expected to contain exactly one backtick-quoted path), a permissive `` /`([^`]+)`/ `` regex run against the whole cell silently extracts whatever first match it finds and discards the rest. The v1.3.0 handoff parser hit this: a malformed cell like `` `sitemap.xml`, `llms.txt` `` silently extracted only `sitemap.xml` (a non-existent root path) and dropped the real `public/sitemap.xml` referenced elsewhere. The handoff passed parsing but downstream commit / coverage checks failed with cryptic "missing file" diagnostics — the actual contract violation (multiple paths in one cell) was invisible. Strict parsers anchor each cell to exactly one expected shape and reject malformed cells with the specific reason at the parse boundary. When adding a parser for any author-facing structured field, prefer strict per-cell validation over permissive whole-string regex; "silently drop data" is much worse than "loud rejection at parse time." Canonical example: `parseHandoffPathCell` in `scripts/run-task/validation.ts`, which anchors to either `` `path` `` or `[path](url)` and rejects combined rows, wildcards, and unfilled `<...>` placeholders.
