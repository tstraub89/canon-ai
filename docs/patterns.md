# Implementation Patterns

> Concrete patterns from the actual codebase. Follow these when implementing similar functionality. This prevents agents from inventing new patterns when established ones exist.

## How to use this doc

This is the project's hard-won implementation knowledge. It has two main sections:

1. **Trigger Table** — at the top, an index agents skim to jump to the relevant section. If your task touches an area listed here, the pointed-at section is likely load-bearing for what you're doing.
2. **Known Pitfalls** — failure modes that have bitten the project before, with the rule that prevents them. The orchestrator pre-injects task-relevant pitfalls into Codex's implement prompt; agents still need this file open for spec authorship and code review.

> **canon-ai is a CLI orchestrator.** Patterns here are about modifying canon-ai itself (orchestrator, templates, validation gates). Projects that adopt canon rewrite this file for their own stack.

## Trigger Table — Scan This First

| Area touched | Section in this file | Key files |
|---|---|---|
| Adding/modifying orchestrator phase logic | Pipeline Phase Changes / Orchestrator Hot Path | `scripts/run-task.ts` |
| Adding a new pipeline phase | Pipeline Phase Changes | `scripts/run-task.ts`, `scripts/pipeline-policy.ts`, `scripts/task.sh`, `tasks/_templates/status.json`, `AGENTS.md` |
| Changing tier / sizing / model selection | Policy Module Changes | `scripts/pipeline-policy.ts`, `tests/pipeline-policy.test.ts` |
| Modifying handoff / review templates | Template Changes | `tasks/_templates/handoff.md`, `tasks/_templates/review.md` |
| Adding a validation gate | Validation Gates | `scripts/run-task.ts` (`validateHandoff()`, `autoCommitCode()`) |
| Status.json shape changes | State Machine Changes | `tasks/_templates/status.json`, `scripts/task.sh`, orchestrator parsers |
| Working with git worktrees | Worktree Operations | `scripts/run-task.ts` worktree helpers, `scripts/task.sh resolve_task_cwd()` |
| Spec authorship for orchestration changes | Spec Discipline (canon-on-canon) | `tasks/_templates/spec.md` |
| Lint / TS suppression / `any` | Lint & Type Safety Policy | (rule, no canonical file) |

## Patterns

### Pure Routing Policy in `pipeline-policy.ts`

**Files**: `scripts/pipeline-policy.ts`, `tests/pipeline-policy.test.ts`

**When to use**: Anything that decides *which* model, effort, tier, or loop cap to use for a phase or task.

**The pattern**:
- Pure functions only — no I/O, no env var reads, no filesystem. Inputs are passed; outputs are returned.
- Table-driven — matrices for phase × size keyed off `TaskSize`, not chained `if`s.
- Every routing decision is testable in isolation. Add a row to `pipeline-policy.test.ts` for any new branch.
- Env-var resolution and legacy-shim warnings stay in `run-task.ts`. The policy module receives a fully resolved `PolicyConfig`.

**Anti-pattern**: scattering routing logic across `run-task.ts` with inline `if (size === 'XL' || delicate) ...`. Drift is guaranteed; tests can't cover it. If you find yourself writing routing logic outside `pipeline-policy.ts`, extract it.

### File-Based Handoff (Not In-Memory)

**Files**: everything in `tasks/_templates/`, `scripts/run-task.ts` parsers (`parseHandoffFiles()`, etc.)

**When to use**: Anytime one phase needs to communicate state to the next phase.

**The pattern**: Every cross-phase contract is a file with a documented schema in `tasks/_templates/`. Markdown for human-readable artifacts, `status.json` for structured state. The orchestrator parses files, not stdout. Agents don't share memory.

This is what makes session resumption work. Re-running `run-task.ts <id>` from a cold start picks up wherever the filesystem says the task is.

**Anti-pattern**: passing data through agent stdout, environment variables, or in-memory orchestrator state across a phase boundary. Add a new template section instead.

### `task.sh phase` Over Hand-Editing `status.json`

**Files**: `scripts/task.sh` (`cmd_phase()`)

**When to use**: Any time you need to update phase status from outside the orchestrator (manual recovery, conversational Claude marking spec done, post-merge cleanup).

**The pattern**: `./scripts/task.sh phase <id> <phase> <status> [verdict]`. The helper:
- Validates phase order (prior phases must be `done`).
- Re-derives the top-level `.status` pointer from `.phases`.
- Routes to the worktree's `status.json` if a worktree exists.
- Increments `.iterations` for review phases on `changes_requested` / `needs_re_review`.

**Anti-pattern**: `jq '.phases.spec.status = "done"' status.json > tmp && mv tmp status.json`. Hand-edits skip the top-level-pointer rederivation; the dispatcher then routes from the wrong phase. **This is the most common silent-corruption source for status.json.**

### One Pipeline at a Time; Bundle Mode for Related Work

**Files**: `scripts/run-task.ts` (bundle mode handling)

**When to use**: When you have multiple related tasks that should ship together.

**The pattern**: Pass multiple task IDs to one `run-task.ts` invocation: `npx tsx scripts/run-task.ts task-a task-b task-c`. All tasks are processed together per phase (one agent session each phase). The tier is determined by the most complex task; any M/L/XL/delicate pulls the bundle to full tier. Code-review `changes_requested` reroutes the whole bundle to implement.

**Anti-pattern**: starting two parallel `run-task.ts` invocations on different branches. They corrupt each other's git state, status.json, and auto-commit logic. The pipeline assumes serialized git operations.

### Worktree Isolation for Implement-Phase Edits

**Files**: `scripts/run-task.ts` worktree helpers, `tasks/_templates/status.json` (`worktree: true`)

**When to use**: Default. Set `worktree: true` (the template default) unless you have a specific reason not to.

**The pattern**: The orchestrator runs from the main checkout. `codex` during implement runs with CWD set to the worktree. Edits land in the worktree until merge. The supervisor's view of `scripts/`, `AGENTS.md`, etc. is shielded — this is what makes canon-on-canon work safely.

**Anti-pattern**: editing the same file in both the main checkout and the worktree during the same task. Merge conflicts on completion, and the orchestrator's mid-run state can desync from the on-disk reality. Pick one — usually the worktree.

## Lint & Type Safety Policy

> Always-applicable rules.

Suppressing lint or type errors is a last resort, not a convenience escape hatch. Each suppression hides a diagnostic that exists to catch real bugs.

**Lint suppression comments**: Never add a suppression without a same-line justification explaining why the rule is wrong for this specific case. If you can't write that justification, the rule is right and the code needs to change.

**`any` / dynamic typing**: `any` propagates silently — once it enters a call chain every downstream consumer loses type safety. When the shape is truly unknown at the boundary (CLI subprocess output, JSON parsing of agent artifacts), type as `unknown` and narrow explicitly.

## Known Pitfalls

> Hard-won lessons. Violating them causes subtle bugs.

### Don't hand-edit `status.json`'s top-level `status` field.

The top-level `.status` pointer is **derived** from `.phases` (first non-`done` phase wins). Hand-editing it produces inconsistent state — `.status` says one phase, `.phases` says another, and the dispatcher routes based on the top-level pointer. The orchestrator may then run the wrong phase, or skip phases. Always go through `./scripts/task.sh phase <id> <phase> <status>`, which updates `.phases` and rederives the pointer atomically. If you're scripting around this, call `cmd_phase()` in `scripts/task.sh` rather than reimplementing.

### Don't run two `run-task.ts` invocations in parallel.

The orchestrator assumes serialized git operations: it auto-commits, switches branches, manages worktrees. Two parallel invocations on the same repo (or even on different branches that share git state) corrupt each other's status.json, leave half-staged commits, and produce uninterpretable conflicts. **Bundle mode is the mechanism for processing related tasks together** — pass multiple IDs to one invocation. If you genuinely need parallel work, use separate clones.

### Don't edit the same file in both the main checkout and the worktree mid-task.

When `worktree: true`, edits should happen in the worktree. The supervising orchestrator reads from the main checkout (shielding itself from in-flight changes). If you also edit in the main checkout, the merge at task completion produces conflicts and can desync the orchestrator's mid-run state. Pick one location — usually the worktree.

### Commit manual changes before invoking `run-task.ts`.

The orchestrator spawns fresh agent sessions that read the working tree from disk. If you have uncommitted edits when you kick off `run-task.ts`, those edits become indistinguishable from agent-authored ones; auto-commit will sweep them into the implement commit, the review will assess them as Codex's work, and the handoff Changes table won't list them. **Commit (or stash) before invoking.**

### Verify handoff claims against the actual diff.

The handoff Changes table is what `autoCommitCode()` and `validateHandoff()` parse to know what should have changed. There are edge cases where edits can slip past these checks — e.g., a manual mid-implement commit that bypasses `autoCommitCode()`'s pre-checks. **As a reviewer, do not trust the Changes table — run `git diff <baseRef>...HEAD` (or `git diff HEAD -- <file>` for spot checks) and confirm what's listed matches what's there.** If you spot a mismatch, that's a Stage 1 finding (handoff did not represent the work accurately), not a Stage 2 nit.

### Reviewer diffs against the task baseline, not `main`, on shared release branches.

When work happens on a shared release branch many commits ahead of `main`, diffing against `main` attributes unrelated work to the current task. The task's baseline is recorded in `status.json`. Diff against that, not `main`, when reviewing.

### Tests change only when intended behavior changes.

If a test fails after a code change and the spec didn't plan a behavior change, **the code is broken — not the test.** Don't update the test to pass against the regression. This is a Stage 2 `correctness bug` even if the test "looks updated to match new code." Behavior changes belong in the spec; tests track behavior.

### Test files are per-feature, not per-helper.

Before naming a new test file in a spec, list existing test files. Consolidate new helpers into one feature-named test file rather than creating a new one per helper. canon-ai currently has three test files; that's plenty for the orchestrator's surface area.

### Name effects to DELETE, not just effects to add.

When a spec replaces a behavior rather than adding alongside, explicitly say "delete lines X–Y" or "remove the old `[function-name]` call." If the spec only describes the new behavior, Codex may leave the old one in place and a silent-no-op regression survives the whole pipeline. **Pair every "Add" bullet with a matching "Remove" bullet when the change supersedes prior code.**

### Delicate-task review must audit cross-cutting guards at every mutation entry point.

When a `delicate: true` task refactors a state/data layer or a phase-routing surface, explicitly verify that all cross-cutting guards (validation, auto-block, reroute, worktree boundary checks) still hold at *every* mutation chokepoint after the refactor — not just at the call sites the spec called out. The orchestrator has many invocation paths; one missed branch can disable a guard silently.

### Don't bypass `--no-verify` or `--no-gpg-sign` to make commits land.

Hooks are doing work. If a pre-commit hook fails, the failure is the signal — fix the underlying issue. `--amend` after a hook failure modifies the *previous* commit (the one that succeeded), not the one that just failed. That can destroy work. Make a new commit after the fix instead.

### Strong-semantic flag names need full-scope sign-off before narrow scoping.

When a flag uses a term that naturally implies full constraint (`delicate`, `locked`, `frozen`, `synced`), the human will read the strong meaning by default. Spec'ing it narrowly creates a hidden mismatch — the flag-name says "all guards apply" but the code only applies a subset. Either verify what the name means *in full*, or pick a less load-bearing name.

## Quick Reference: "I Want To..."

| I want to... | Follow this pattern | Start at |
|---|---|---|
| Add a new pipeline phase | Pipeline Phase Changes (Trigger Table) | `scripts/run-task.ts` `PHASE_ORDER` |
| Change which model a phase uses | Policy Module Changes | `scripts/pipeline-policy.ts` |
| Add a new validation check at code_review entry | Validation Gates | `scripts/run-task.ts` `validateHandoff()` |
| Update phase status from a script | `task.sh phase` Over Hand-Editing | `./scripts/task.sh phase` |
| Add a new structured field to handoff | Template Changes + parser update | `tasks/_templates/handoff.md`, `parseHandoffFiles()` |
| Run multiple related tasks together | Bundle mode | `npx tsx scripts/run-task.ts a b c` |
