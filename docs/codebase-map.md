# Codebase Map

> Quick-reference for agents. Start here to find the right file, then read `docs/architecture.md` for context.

## How to use this doc

This is a fast index, not a tutorial. Each row points an agent at the canonical file for an area of functionality. The goal: an agent looking at "where do I add X?" can scan this map and find the file in seconds, instead of grepping the whole repo.

Keep entries terse — one row per file/area, with at most a one-line note. Long explanations belong in `docs/patterns.md` or inline code comments.

**Refresh discipline**: When a task moves or renames a canonical file, update this map in the same PR. The QA phase scans for stale entries and flags them.

> **canon-ai is its own product.** This file describes the canon-ai repo itself (the framework's own internals), not a downstream project that adopts canon. When dropped into a downstream repo, `docs/codebase-map.md` is rewritten to describe that project.

---

## Entry Points

| What | Where |
|---|---|
| Workflow source of truth | `AGENTS.md` |
| Claude (architect/reviewer) guide | `CLAUDE.md` |
| Codex (implementer) guide | `CODEX.md` |
| Project pitch + adoption guide | `README.md` |
| Current pipeline status / known gaps | `STATUS.md` |
| Per-task state machine | `tasks/_templates/status.json` |

## Pipeline Orchestration

| What | Where | Notes |
|---|---|---|
| Orchestrator (phases, agent invocation, auto-commit, reroute) | `scripts/run-task.ts` | ~5K lines; the load-bearing file |
| Pure routing policy (tier, sizing, model/effort, loop caps) | `scripts/pipeline-policy.ts` | Side-effect-free; table-driven; tested in isolation |
| Task management helper (status.json updates, phase transitions) | `scripts/task.sh` | jq-driven; agents and humans both use it |
| Phase routing logic (phase order, transitions) | `scripts/run-task.ts` (`PHASE_ORDER`, `runPhase()`, `checkAndRoute()`) | |
| Auto-commit after implement (verifies handoff vs. dirty tree) | `scripts/run-task.ts` (`autoCommitCode()`) | |
| Pre-flight gate before code review (validation outcomes, AC coverage) | `scripts/run-task.ts` (`validateHandoff()`) | |
| Handoff Changes-table parser | `scripts/run-task.ts` (`parseHandoffFiles()`) | Regex-based; extracts backtick-wrapped paths |

## Task Lifecycle Artifacts

Every task lives in `tasks/<TASK-ID>/`. Templates live in `tasks/_templates/`.

| What | Where | Author |
|---|---|---|
| Task state machine | `tasks/_templates/status.json` | Updated by whichever agent acts |
| Spec template | `tasks/_templates/spec.md` | Claude writes; Codex reviews (full tier) |
| Spec review template | `tasks/_templates/spec-review.md` | Codex |
| Plan template | `tasks/_templates/plan.md` | Claude (after spec approval) |
| Implementation handoff template | `tasks/_templates/handoff.md` | Codex |
| Code review template (2-stage) | `tasks/_templates/review.md` | Claude |
| QA / human-facing summary template | `tasks/_templates/done.md` | Claude |
| Per-task scratchpad | `tasks/_templates/notes.md` | Any agent, any phase |

## Protected Docs (Institutional Memory)

These must stay current — agents read them at session start (per phase rules in `CLAUDE.md` / `CODEX.md`).

| What | Where | Purpose |
|---|---|---|
| System overview, tech stack | `docs/architecture.md` | First read when orienting |
| File locations (this doc) | `docs/codebase-map.md` | Fast index |
| Settled architectural decisions | `docs/decisions.md` | Don't re-debate without strong cause |
| Patterns + Known Pitfalls | `docs/patterns.md` | Pitfalls auto-injected into Codex implement prompts |
| Product / framework context | `docs/product-context.md` | What canon-ai is, who it's for |
| Pipeline mechanics reference | `docs/pipeline-orchestrator.md` | Flags, env vars, model matrix, reroute, auto-block |
| Distilled lessons across tasks | `docs/lessons-learned.md` | Promoted from per-task notes during QA |
| Pipeline health log | `docs/task-quality-log.md` | Spec review outcomes, dropped ACs, failure phases |
| Per-invocation telemetry | `docs/pipeline-invocations.md` | Auto-appended by `run-task.ts` (duration + tokens) |

## Tests

| What | Where | Notes |
|---|---|---|
| Pipeline policy table tests | `tests/pipeline-policy.test.ts` | Tier, sizing, model matrix, loop caps |
| Handoff/git porcelain parser | `tests/run-task-parse-porcelain.test.ts` | Edge cases for git status parsing |
| Handoff validation logic | `tests/run-task-validation.test.ts` | `validateHandoff()` cases |

Run via `npm test` (uses node `--test` runner with `tsx` import hook). Test files import directly from `scripts/`.

## Configuration

| What | Where | Notes |
|---|---|---|
| Node/TS project metadata, npm scripts | `package.json` | `test`, `type-check`, `task`, `run-task` scripts |
| ESLint flat config | `eslint.config.mjs` | `@typescript-eslint/recommendedTypeChecked`, `projectService: true` |
| TypeScript config (strict, ES2022, NoEmit) | `tsconfig.json` | `scripts/` and `tests/` only |
| Claude permissions + SessionStart hook | `.claude/settings.json` | Auto-shows in-progress tasks at session start |
| Codex CLI features (multi-agent, shell snapshot) | `.codex/config.toml` | |
| Custom canon hooks (placeholder) | `.canon/hooks/README.md` | |
| Worktree dirs allowed for agent CWD | `.claude/settings.json` `additionalDirectories` | `../dev-worktrees` |
| Git ignores | `.gitignore` | |

## Public Assets (README only)

| What | Where |
|---|---|
| Logo | `public/canon-logo.webp` |
| Framework diagram | `public/canon-framework.webp` |

## Feature Wiring Maps

> Common changes that touch multiple files. Use as starting checklists, not exhaustive.

**Add a new pipeline phase**:
> `scripts/pipeline-policy.ts` (if it has model/effort needs) → `scripts/run-task.ts` (`PHASE_ORDER`, `runPhase()` switch, `checkAndRoute()` switch, `canPhaseAdvance()` switch) → `scripts/task.sh` (`cmd_phase()` validation) → `tasks/_templates/status.json` → `AGENTS.md` (handoff sequence + workflow diagram) → `docs/pipeline-orchestrator.md`

**Add a new validation check (handoff or pre-flight gate)**:
> `scripts/run-task.ts` (`validateHandoff()` or new validator function) → relevant test in `tests/run-task-validation.test.ts` → `tasks/_templates/handoff.md` (if it adds a new section) → `docs/patterns.md` (Known Pitfalls if motivated by a real incident)

**Change pipeline tier or sizing rules**:
> `scripts/pipeline-policy.ts` (the matrix) → `tests/pipeline-policy.test.ts` → `AGENTS.md` (Pipeline Tiers section) → `docs/pipeline-orchestrator.md` (model/effort matrix)

**Change model selection**:
> `scripts/pipeline-policy.ts` (`claudeMatrix`, `codexMatrix`) → env var docs in `docs/pipeline-orchestrator.md` → `tests/pipeline-policy.test.ts`

**Add a new task-template field or section**:
> `tasks/_templates/<file>.md` → orchestrator parser if structured (e.g., `parseHandoffFiles()`) → relevant section in `AGENTS.md` (handoff protocol) and `CLAUDE.md` / `CODEX.md` (authorship rules)

**Promote a lesson into canon**:
> `tasks/<id>/notes.md` (raw) → `docs/lessons-learned.md` (distilled, during QA) → eventually `docs/patterns.md` Known Pitfalls or `docs/decisions.md` if it becomes a rule

## Agent Config

| What | Where | Notes |
|---|---|---|
| Workflow source of truth | `AGENTS.md` | All agents follow this |
| Claude instructions | `CLAUDE.md` | Architect + reviewer context |
| Codex instructions | `CODEX.md` | Implementer context |
| Agent permissions | `.claude/settings.json` | Allowlisted commands |
| Codex config | `.codex/config.toml` | Multi-agent + shell snapshot |
| Task artifacts | `tasks/` | Per-task specs, plans, reviews |
