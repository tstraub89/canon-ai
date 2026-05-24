# Implementation Patterns

> Concrete patterns from the actual codebase. Follow these when implementing similar functionality. This prevents agents from inventing new patterns when established ones exist.

## How to use this doc

This is the project's hard-won implementation knowledge. It has two main sections:

1. **Trigger Table** — at the top, an index agents skim to jump to the relevant section. If your task touches an area listed here, the pointed-at section is likely load-bearing for what you're doing.
2. **Known Pitfalls** — failure modes that have bitten the project before, with the rule that prevents them. The orchestrator pre-injects task-relevant pitfalls into Codex's implement prompt; agents still need this file open for spec authorship and code review.

> **Layering rule.** This file is **project-specific** — it holds patterns and pitfalls unique to canon-ai's own internals (or, for adopters, unique to their stack). **Canon-supplied universal rules** (agent discipline, harness behavior, spec/review rules of thumb) live in [`AGENTS.md`](../AGENTS.md), [`CLAUDE.md`](../CLAUDE.md), and [`CODEX.md`](../CODEX.md). If you're tempted to add a rule here that would apply to *every* canon project, it belongs in policy, not patterns.

> **canon-ai is a CLI orchestrator.** Patterns here are about modifying canon-ai's own harness internals (orchestrator scripts, templates, validation gates). When dropped into a downstream project, this file is rewritten for that project's stack.

## Trigger Table — Scan This First

| Area touched | Section in this file | Key files |
|---|---|---|
| Adding/changing a pipeline phase | Phase Addition Discipline | `scripts/run-task/main.ts`, `scripts/pipeline-policy.ts`, `scripts/task.sh`, `.canon/templates/status.json` |
| Modifying `pipeline-policy.ts` | Pure Policy + Test Discipline | `scripts/pipeline-policy.ts`, `tests/pipeline-policy.test.ts` |
| Modifying `status.json` shape | State Schema Discipline | `.canon/templates/status.json`, parsers in `scripts/run-task/state.ts`, `scripts/run-task/git.ts`, `scripts/run-task/validation.ts`, `scripts/task.sh` `cmd_phase()` |
| Adding/modifying a validation gate | Validation Gate Discipline | `scripts/run-task/validation.ts`, `scripts/run-task/git.ts`, `scripts/run-task/main.ts`, `tests/run-task-validation.test.ts` |
| Lint / TS suppression / `any` | Lint & Type Safety Policy | (rule, no canonical file) |

## Patterns

### Pure Policy + Test Discipline

**Files**: `scripts/pipeline-policy.ts`, `tests/pipeline-policy.test.ts`

**When to apply**: Any change that touches tier detection, sizing, model/effort matrices, or loop-cap defaults.

**The pattern**:
- `pipeline-policy.ts` is **side-effect-free**. No I/O, no env reads, no filesystem. Inputs are passed; outputs are returned. Env-var resolution lives in `scripts/run-task/env.ts`; the module receives a fully resolved `PolicyConfig`.
- Decisions are **table-driven**. Matrices keyed off `TaskSize` × `Phase`. Adding a new branch means adding a table cell, not chaining `if`s.
- **Every routing decision has a corresponding test row** in `pipeline-policy.test.ts`. A change to `pipeline-policy.ts` without a corresponding test update is a Stage 1 review failure — the table-driven structure exists *so* tests can cover every cell, and skipping the test means coverage drift.

**Anti-pattern**: writing routing logic directly in `scripts/run-task/main.ts` (`if (size === 'XL' || delicate) ...`). Routing drift was the original motivation for extracting this module — don't reintroduce it.

### Phase Addition Discipline

**Files**: `scripts/run-task/main.ts`, `scripts/run-task/phases/*.ts`, `scripts/pipeline-policy.ts`, `scripts/task.sh`, `.canon/templates/status.json`

**When to apply**: Anytime a new phase is added to the pipeline (e.g., a new validation gate that warrants its own phase rather than being a sub-step within an existing one).

**The pattern**: Adding a phase touches the orchestrator's phase-aware switches in `scripts/run-task/main.ts`:
1. `PHASE_ORDER` constant (defines the linear sequence)
2. `runPhase()` switch (dispatches to the agent invocation)
3. `checkAndRoute()` switch (decides what happens after the phase completes)

Plus:
5. `scripts/task.sh` `cmd_phase()` validation list (so the helper accepts the new phase name)
6. `.canon/templates/status.json` (add the new phase entry with a default `status` and `agent`)
7. If the phase has model/effort needs distinct from existing phases: add it to the matrices in `pipeline-policy.ts` and `tests/pipeline-policy.test.ts`
8. Document in `AGENTS.md` (handoff sequence + workflow diagram) and any agent-specific implications in `CLAUDE.md` / `CODEX.md`

**Anti-pattern**: updating only one or two of the switch statements. Missing one produces silent skipping (the orchestrator routes past the phase without running it) or inconsistent routing state.

### State Schema Discipline

**Files**: `.canon/templates/status.json`, parsers in `scripts/run-task/state.ts`, `scripts/run-task/git.ts`, `scripts/run-task/validation.ts`, `scripts/task.sh` `cmd_phase()`

**When to apply**: Adding a new field to `status.json`, renaming an existing field, or changing the type/shape of a field.

**The pattern**: A status.json change must update three locations atomically:
1. `.canon/templates/status.json` — the schema source of truth (and what new tasks are scaffolded from)
2. Parsers in `scripts/run-task/state.ts`, `scripts/run-task/git.ts`, and `scripts/run-task/validation.ts` — anything that reads or writes the field. The orchestrator and `parseStatus()`-style helpers both need updates.
3. `scripts/task.sh` `cmd_phase()` — if the field affects phase transitions, the helper needs to know about it.

For breaking changes (renames, type changes), also: add a migration shim that detects the old shape and either fails loudly or transforms it. Tasks may be in flight when the change lands.

**Anti-pattern**: updating the template but not the parser, or vice versa. The result is silent state corruption (parser writes the new field but old runs read the old field, or vice versa).

### Validation Gate Discipline

**Files**: `scripts/run-task/validation.ts`, `scripts/run-task/git.ts`, `scripts/run-task/main.ts`, `tests/run-task-validation.test.ts`

**When to apply**: Adding a new pre-flight check at a phase boundary (e.g., "the handoff Changes table must match the post-commit `git diff`").

**The pattern**:
- **Per-task checks**: extend `validateHandoff()` (returns a list of issue strings; non-empty = gate fail) or join the `autoCommitCode()` cross-checks. Both are well-tested entry points in `scripts/run-task/validation.ts` and `scripts/run-task/main.ts`.
- **Bundle-wide checks**: add a sibling function at the same call site (after the per-task loop in the `code_review` pre-flight block). `verifyHandoffAgainstDiff()` is the canonical example — it takes `taskIds: string[]` so it can compute a union across bundle members. Expose a `*FromData` test seam so tests don't need a real git repo.
- **Tests are mandatory.** Any new validation rule needs a positive case (passing handoff) and a negative case (failing handoff) in `run-task-validation.test.ts`. Edge cases (empty tables, malformed markdown) need explicit test rows.
- **Failure modes are documented.** A gate that fails should write a clear rejection message to `review.md` (or equivalent) explaining what to fix. Vague failures waste review iterations.

**Anti-pattern**: adding a check inline in the middle of `runPhase('code_review')` without a test seam. Both `validateHandoff()` and `verifyHandoffAgainstDiff()` expose seams — any new sibling should too.

### Lint & Type Safety Policy

> Always-applicable rules. *(Same content lives in `AGENTS.md` for canonical reference; reproduced here for convenience when a contributor is reading patterns mid-task.)*

Suppressing lint or type errors is a last resort, not a convenience escape hatch. Each suppression hides a diagnostic that exists to catch real bugs.

**Lint suppression comments**: never add a suppression without a same-line justification explaining why the rule is wrong for this specific case. If you can't write that justification, the rule is right and the code needs to change.

**`any` / dynamic typing**: `any` propagates silently — once it enters a call chain, every downstream consumer loses type safety. When the shape is truly unknown at the boundary (CLI subprocess output, JSON parsing of agent artifacts), type as `unknown` and narrow explicitly.

## Known Pitfalls

> Hard-won lessons specific to canon-ai's internals. Universal agent-discipline pitfalls (handoff verification, test discipline, name-effects-to-delete, etc.) live in [`CLAUDE.md`](../CLAUDE.md). Universal harness-behavior pitfalls (don't hand-edit `status.json`, parallel run-task safety, etc.) live in `CLAUDE.md` Quick Refs and the Validation Matrix in [`AGENTS.md`](../AGENTS.md).

### Adding a phase that updates only some switch statements is a silent-skip footgun.

`scripts/run-task/main.ts` has the phase-aware switches (`PHASE_ORDER`, `runPhase()`, `checkAndRoute()`). All of them must gain a case for the new phase. Missing `runPhase()` → the phase appears in order but nothing runs. Missing `checkAndRoute()` → the orchestrator can't decide what comes next. **The failure modes are subtle** — the pipeline may appear to make progress while silently skipping the new phase. Use the Phase Addition Discipline checklist above; reviewers should grep for the phase name across the switches in `main.ts` before approving.

### Modifying `pipeline-policy.ts` without a matching test row is silent coverage drift.

The module is small enough that contributors sometimes treat it as "just data" and skip the test update. But the table-driven structure exists *so* tests can cover every cell — `tests/pipeline-policy.test.ts` is the only thing that catches drift between the matrix's intent and its actual values. A change to a matrix cell without a corresponding test row is a Stage 1 review failure.

### Treat the `delicate` flag as load-bearing for the orchestrator's *own* surfaces.

When working on canon-ai's harness, `delicate: true` should be set for any task that modifies the orchestrator's hot path (phase routing, auto-commit, validation gates, pipeline policy, status.json schema, worktree machinery). See `docs/product-context.md` "delicate flag — project-specific domains" for the canon-ai list. The bar is "an undetected bug here corrupts every task that runs after the change lands" — true for almost every harness modification.

### Don't introduce orchestrator state that lives only in memory across phases.

The architectural decision (see `docs/decisions.md` "File-based handoffs between phases") makes resumability and observability load-bearing. Adding in-memory state that bridges phase boundaries — even seemingly innocuous things like "remember the validation result so we don't recompute it" — breaks both. New cross-phase state goes in a file under `tasks/<id>/` with a documented schema in `.canon/templates/`.

### Release-merge `dev` → `main` via PR; cherry-pick for out-of-band fixes.

Since v1.0.0, `main` is the published `canon-ai` npm package and `dev` is the staging branch — both carry the same canon-ai content shape, so they no longer structurally diverge the way the pre-v1 template/dev split did. **Normal release flow**: open a PR from `dev` → `main` with the version bump and `CHANGELOG.md` entry; merge it. The release-merge is the supported path; raw `git merge dev` on `main` works too but a PR is preferred for review/CI hygiene.

**Cherry-pick is still the right tool for out-of-band fixes** that need to land on one branch ahead of the next release-merge — e.g., a hotfix authored on `main` that should also be on `dev` so it doesn't regress on the next merge, or a fix authored on `dev` that needs to land on `main` for an urgent patch release without sweeping in unrelated in-flight work.

When a single change needs both branches outside a release:
1. Author on whichever branch is convenient.
2. `git cherry-pick <SHA>` to the other branch.
3. Push both.

### Use `--name-status`, not `--name-only`, when building path sets from `git diff`

When parsing `git diff -M` output to build a set of changed paths, use `--name-status` instead of `--name-only`. With `--name-only`, rename detection is active but only the post-image path is emitted — the pre-image path is silently suppressed. Any code that checks "is this path in the diff" will false-negative on the pre-image of a renamed file. With `--name-status`, rename lines appear as `R<score>\told\tnew`; expand both sides into the path set. Canonical implementation: `verifyHandoffAgainstDiffFromData()` in `scripts/run-task/validation.ts`.

### Never use blanket `git stash` / `git clean` inside a pipeline phase

After `implement` closes and `autoCommitCode()` runs, only the source files listed in the handoff Changes table are committed. Task artifacts — `tasks/<id>/handoff.md`, `tasks/<id>/notes.md`, `tasks/<id>/status.json` — sit uncommitted in the worktree by design. A blanket `git stash --include-untracked`, `git clean -fd`, or any equivalent that sweeps the worktree will erase them; subsequent worktree → supervising sync then propagates the erasure and permanently loses handoff history. Any phase that needs to clean up after itself must compute a pre/post `git status --porcelain=v1 -uall` delta (`postDirty \ preDirty`) and touch only paths in that delta. Explicitly exclude anything under `tasks/` from the cleanup set regardless of what the delta contains. The `PIPELINE_TELEMETRY_FILES` registry in `scripts/run-task/worktree.ts` is the right reference for what the orchestrator considers off-limits to phase-level cleanup.

### Operator git surgery on a task branch between phases discards uncommitted pipeline state

Surfaced 2026-05-23 during prepr-base-drift-check's ship cycle. Same root cause class as the blanket-stash pitfall above, different trigger. The implement-phase commit (auto-commit by the orchestrator) commits ONLY the source/test/dist files from the handoff Changes table. Task artifacts (`handoff.md`, `review.md`, `done.md`, `notes.md`) and status.json updates from code_review, qa, and human_review accumulate uncommitted in the worktree until `commitHumanReviewFiles` fires at `--push` / `--pr` time. Operator `git reset --hard <pre-current-commit>` (or `git checkout HEAD~N`, or `git stash drop`, or any operation that discards working-tree state) between QA-end and `--pr` reverts status.json to its scaffold-commit version — implement reads as "pending," dispatch routes back to implement, Codex re-runs and overwrites the post-QA artifacts. Recovery is tedious: re-mark phases via `canon task phase <id> <phase> done [verdict]` for implement / code_review / qa, restore artifact files from REPO_ROOT's lazy mirror, then re-run `--pr`.

Rule: **don't `git reset --hard`, `git checkout HEAD~N`, `git stash drop`, or any equivalent on a task branch between QA-end and `--ship`.** If you need to drop a stray commit, prefer `git revert <sha>` — it writes a new commit that reverses the target rather than rewriting history, so the prior tip stays reachable. (`git revert` does modify the working tree and can conflict with uncommitted state; if you have uncommitted pipeline progress, stash explicitly to a named ref first or accept that the revert may surface a conflict you have to resolve by hand.) If the task branch is already corrupted, the recovery path is `canon task phase` to re-mark phases — the post-QA artifacts in REPO_ROOT's mirror are the source of truth for `done.md` / `handoff.md` / `review.md`. The structural fix (commit pipeline state at QA-end so it survives operator git surgery) is tracked in BACKLOG.

### Editing managed docs inside a worktree-isolated task — verify dirty before phase close

The orchestrator's `autoCommitCode()` stages only files that appear dirty in the worktree at commit time. If `syncWorktreeArtifacts` (or any pre-commit sync step) moves worktree edits to the supervising checkout — resetting the worktree copy to HEAD — before auto-commit runs, those files show as clean in the worktree and are silently omitted from the commit, even when they're listed in the handoff Changes table. The post-commit coverage check flags the mismatch ("no commit touches this path in `dev..HEAD`"), but recovery requires a manual follow-up commit. When editing protected docs (`docs/decisions.md`, `docs/codebase-map.md`, `docs/patterns.md`, etc.) inside a worktree-isolated task, run `git status` in the worktree before the phase closes and explicitly commit anything that came up clean unexpectedly.

### When adding a code path on a shared surface, route it through the existing safety queue

When a feature adds a new write/lookup that touches a surface another feature already governs (a queue, a gate, a guard, an allowlist), the new path must flow through the existing infrastructure — never spawn a parallel one. Two real instances from the v1.2.0 release shipping in separate PRs: (1) `canon upgrade` header-only sync (PR #80) wrote directly to disk and pushed to `upgraded[]`, bypassing the `pending` → dirty-refusal → `--check` / `--force` flow that PR #79 added on the same `runUpgrade()` function — Codex P1 on the release PR. (2) `findOpenPRNumber` (PR #75) didn't base-filter even after PR #77 added base-filtering to its sibling `findMergedPRNumber` — Codex P2 on the same release PR. The pattern: when extending a function with a new write/check, grep for the existing queue/guard inside it and join, don't fork. When adding a sibling helper to an existing one, check whether every invariant the original holds applies to the sibling too.

### "Clean tree" is not a proxy for "origin matches HEAD"

`git status --porcelain` returning empty means no uncommitted edits — it does not mean origin is in sync with HEAD. Local commits made after a previous push will leave a clean tree but a divergent origin. Any code path that uses "clean tree" as a proxy for "nothing to push" will silently drop those commits. Canonical fix: always run `git push origin <branch>` before checking remote state; the push is idempotent (no-op when origin already matches the tip, pushes the difference otherwise) and is cheaper than the bug it prevents. The same rule applies symmetrically: "origin/<branch> exists" is not a proxy for "origin matches HEAD" either, and the local remote-tracking ref can be stale if a prior fetch failed. Canonical example: the PR-exists branch of `commitHumanReviewFiles()` in `scripts/run-task/main.ts` always pushes before reporting the existing PR (Codex P1 on release PR #82).

### Bundle-gate conditions must use `every()`, not `some()`, on per-task flags

When a feature applies per-task in a bundle and a task-level flag controls whether a safety check is skipped, the skip condition must require ALL tasks to opt in (`statuses.every(s => s.flag)`), not just one (`statuses.some(s => s.flag)`). Using `some()` means a single opted-in task silently disables the check for every task in the bundle — including tasks the human never opted in. The bug is structurally invisible: it only manifests in mixed-bundle invocations, not single-task runs. Canonical example: `spec-review.ts` full-send gate, fixed from `some` to `every` in the full-send-mode task. Prevention: whenever writing a bundle-level dispatch branch gated on a per-task flag, default to `every()` and explicitly justify it if `some()` is ever chosen.

### `getAffectedFiles` uses three-dot diff semantics — it does not surface base-advancement

`getAffectedFiles` in `scripts/run-task/git.ts` uses a three-dot diff (`git diff <base>...<branch>`) — it reports files the task branch changed *since the merge base*. That is the correct semantic for "what did this branch contribute?" (handoff validation, coverage checks). It does **not** surface files where the base branch advanced without the task branch following. Any gate that answers "how does the task branch's tree compare to current base?" cannot reuse `getAffectedFiles`; it needs a two-dot helper (`git diff <base> HEAD`). Canonical implementation: `getTreeDriftFiles` in `scripts/run-task/git.ts`, added in the prepr-base-drift-check task. When spec-writing a new gate, verify which diff semantic is correct before naming a helper — two-dot and three-dot silently produce wrong results if confused.

### Test-writing pitfalls (canon-specific git/worktree gotchas)

- **Porcelain-delta tests need non-gitignored fixture paths.** `git status --porcelain -uall` doesn't surface gitignored files by design. Tests verifying scoped delta cleanup that write `*.tmp` files (or other extensions matching `.gitignore` patterns) will find an empty delta and pass vacuously — never exercising the cleanup path. Use names that aren't gitignored: `fixture-output.txt`, `test-check-artifact.log`.
- **Subprocess tests for `main.ts` must use the active worktree's cwd.** When tests spawn the canon CLI (`node dist/scripts/run-task.js` or `tsx scripts/run-task/main.ts`) inside a linked worktree, subprocess `cwd` must be the active worktree root — not the supervising checkout's root. The wrong root loads stale compiled artifacts or source files from a different checkout, so changes that exist only in the current worktree are invisible to the test. Failure is silent (the test passes against old behavior). Derive cwd from `import.meta.url` / `__dirname` resolved relative to the test file, or pass `process.cwd()` explicitly when the suite is invoked from the worktree root.
- **Migration-tolerance fixtures for retiring schema keys must build the key dynamically.** When testing that a parser tolerates a legacy schema key (e.g., a retired phase block), the fixture must construct the key by concatenation (`'runtime_' + 'validation'`) or read it from a helper constant — never as a literal — if the codebase has a structural grep AC prohibiting the retiring symbol outside an allow-list. A literal occurrence in the test file would itself violate the grep, invalidating the structural check. Pairs with the `*FromData` injectable-input pattern.
- **`commitHumanReviewFiles()` reads module-level `cliArgs` — tests that need flag behavior must route through `main()`.** `commitHumanReviewFiles()` in `scripts/run-task/main.ts` reads the module-level `cliArgs` object that `parseArgs()` populates when `main()` is invoked. Tests calling `commitHumanReviewFiles()` directly cannot set `cliArgs` from outside the module — they must spawn `main()` with the appropriate argv. Follow the subprocess pattern in `tests/run-task-safety.test.ts` (real-git fixture + subprocess invocation) when adding tests for any flag-gated branch.
- **Module-load-time path constants that reference repo files are a test-pollution hazard.** When a module computes a file path from `REPO_ROOT` at load time (`const METRICS_FILE = path.join(REPO_ROOT, 'docs/...')`), any test that spawns a child process importing canon modules writes to the real repo file. The fix: add a `CANON_*_FILE_OVERRIDE` env-var pattern so spawned test processes can redirect writes to a temp path. Add a suite-end `git status -s docs/` cleanliness assert that catches any future path of this kind. Canonical pattern: `getMetricsFile()` with `CANON_METRICS_FILE_OVERRIDE` in `scripts/run-task/metrics.ts`.

## Quick Reference: "I Want To..."

| I want to... | Section above | Start at |
|---|---|---|
| Add a new pipeline phase | Phase Addition Discipline | `scripts/run-task/main.ts` `PHASE_ORDER` |
| Change which model a phase uses | Pure Policy + Test Discipline | `scripts/pipeline-policy.ts` |
| Add a new per-task validation check at code_review entry | Validation Gate Discipline | `scripts/run-task/validation.ts` `validateHandoff()` |
| Add a new bundle-wide validation check at code_review entry | Validation Gate Discipline | `scripts/run-task/validation.ts` `verifyHandoffAgainstDiff()` (canonical sibling example) |
| Add a new field to status.json | State Schema Discipline | `.canon/templates/status.json` |
| Update phase status from a script | (see CLAUDE.md Quick Refs) | `./scripts/task.sh phase` |
| Run multiple related tasks together | (see CLAUDE.md Quick Refs — bundle mode) | `npx tsx scripts/run-task.ts a b c` |
