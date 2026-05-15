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

### Don't `git merge` between `dev` and `main` — cherry-pick canon-supplied commits instead.

The three-layer architecture (harness + policy mirrored across branches; project context dev-only) means `dev` and `main` intentionally diverge on the descriptive docs (`docs/architecture.md`, `docs/decisions.md`, `docs/product-context.md` — main has TODO[canon] stubs for adopters; dev has canon-ai's filled content). **A whole-branch `git merge origin/main` (or vice versa) will always produce false-positive conflicts** on those files because both sides have legitimately added different content to the same structural locations. There is no clean automatic resolution — git can't tell that the divergence is *by design*.

**The right cross-branch sync pattern**: cherry-pick specific canon-supplied commits — harness changes in `scripts/`, policy changes in `AGENTS.md` / `CLAUDE.md` / `CODEX.md`, canon-supplied additions to `pipeline-orchestrator.md`, `lessons-learned.md`, etc. — between branches one at a time. The cherry-pick scope matches the layering: only canon-supplied content crosses branches; project-specific content stays put.

When canon needs a change to land on both branches:
1. Author it on whichever branch is convenient (typically dev for canon-ai self-development).
2. `git cherry-pick <SHA>` to the other branch.
3. Push both.

A future canon improvement could automate this with `.gitattributes merge=ours` on the descriptive docs (per branch) so accidental whole-branch merges no longer produce conflicts. Not in scope yet — capture this as a backlog item if it bites again.

Failure mode if violated: a `git merge` produces conflicts on every descriptive doc, the human resolves them by picking one side (always wrong because *both* sides are correct for their respective branches), and the merged branch ends up with content that's incorrect for its layer (filled content lands on main, or stubs land on dev). Recovery requires reverting the merge.

### Use `--name-status`, not `--name-only`, when building path sets from `git diff`

When parsing `git diff -M` output to build a set of changed paths, use `--name-status` instead of `--name-only`. With `--name-only`, rename detection is active but only the post-image path is emitted — the pre-image path is silently suppressed. Any code that checks "is this path in the diff" will false-negative on the pre-image of a renamed file. With `--name-status`, rename lines appear as `R<score>\told\tnew`; expand both sides into the path set. Canonical implementation: `verifyHandoffAgainstDiffFromData()` in `scripts/run-task/validation.ts`.

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
