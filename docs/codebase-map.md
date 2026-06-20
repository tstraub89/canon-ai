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
| Workflow source of truth | per-phase prompts (`scripts/run-task/prompts/`) + `docs/pipeline-orchestrator.md` |
| Claude (architect/reviewer) guide | `CLAUDE.md` — auto-loaded by Claude Code; shared overview lives in `AGENTS.md` |
| Project pitch + adoption guide | `README.md` |
| Per-task state machine | `.canon/templates/status.json` |

## Pipeline Orchestration

| What | Where | Notes |
|---|---|---|
| Orchestrator entrypoint | `scripts/run-task.ts` | Thin wrapper that invokes `scripts/run-task/main.ts` |
| Orchestrator loop, phase dispatch, auto-commit, reroute | `scripts/run-task/main.ts` | Core control flow and phase-aware switches |
| Per-phase handlers | `scripts/run-task/phases/*.ts` | One file per phase (`spec`, `spec_review`, `plan`, `implement`, `code_review`, `qa`) |
| Agent runners | `scripts/run-task/agents/*.ts` | Shared subprocess wrappers for Claude and Codex |
| Prompt builders and templates | `scripts/run-task/prompts/index.ts`, `scripts/run-task/prompts/templates/*.md` | Data prep + Mustache rendering; phase templates carry JIT operating rules for their consumers |
| CLI parsing and logging | `scripts/run-task/cli.ts` | Args, usage, `die` / `info` / `warn` |
| State I/O and session storage | `scripts/run-task/state.ts` | `status.json`, derived status, task/worktree path helpers; exports `validateStatus` and `readStatusFromPath` |
| Shared run-context resolver | `scripts/run-task/run-context.ts` | Orphan-tolerant task-dir lookup, EPERM-tolerant PID probe, `gatherRunContext()` — consumed by `watch`, `doctor`, `stop`; injectable seams for tests |
| Git plumbing and porcelain parsing | `scripts/run-task/git.ts` | Branch helpers, commits, porcelain parsers |
| Worktree management | `scripts/run-task/worktree.ts` | Worktree lifecycle, cleanup/detect helpers, `findExistingWorktreeForBranch`, and pipeline file registries |
| Validation gates and diff checks | `scripts/run-task/validation.ts` | Handoff validation, diff cross-checks, done.md salvage helpers |
| `canon watch` command | `src/cli/commands/watch.ts` | Blocking observer for detached runs — attach-time + idle classification, `--until`, `--timeout`, `--follow` |
| `canon stop` command | `src/cli/commands/stop.ts` | Gracefully terminates detached run; SIGTERM → SIGKILL; CASE A–D pid selection |
| `canon doctor` command | `src/cli/commands/doctor.ts` | Point-in-time health check: active orchestrators, stale heartbeats, worktree state, and canon discovery nudge (warns when neither file exists or neither mentions canon) |
| Canon runtime `.gitignore` block | `src/lib/canon-block.ts`, `src/cli/commands/init.ts`, `src/cli/commands/upgrade.ts`, `src/cli/commands/doctor.ts` | canon manages a `# canon:start`/`# canon:end` block in `.gitignore`; `canon upgrade` refreshes it. |
| CLI entrypoint + dispatch | `src/cli/index.ts` | `printHelp()`, top-level `switch` dispatch for all `canon` commands |
| Canon-managed template sync | `scripts/sync-canon-templates.mjs` | Root → `templates/` sync command; `--stage` re-stages changed templates files |
| Pure routing policy (tier, sizing, model/effort, loop caps) | `scripts/pipeline-policy.ts` | Side-effect-free; table-driven; tested in isolation |
| Task management helper (status.json updates, phase transitions) | `src/task/index.ts` | `taskCmd()` implementation; `src/cli/commands/task.ts` is the thin CLI wrapper |
| `canon run` CLI dispatch wrapper | `src/cli/commands/run-task.ts` | Spawns the compiled `scripts/run-task.ts` via `spawnSync`; the installed-package entry point for `canon run` |
| `canon update` command | `src/cli/commands/update.ts` | Detects install type (`local`/`global`/`npx`); drives adopter update checks |
| Phase routing logic (phase order, transitions) | `scripts/run-task/main.ts` (`PHASE_ORDER`, `runPhase()`, `checkAndRoute()`) | |
| Auto-commit after implement (verifies handoff vs. dirty tree) | `scripts/run-task/main.ts`, `scripts/run-task/git.ts`, `scripts/run-task/validation.ts` | |
| Pre-flight gate before code review (validation outcomes, AC coverage) | `scripts/run-task/validation.ts` | |
| Handoff Changes-table parser | `scripts/run-task/validation.ts` | Regex-based; extracts backtick-wrapped paths |
| Spec Affected Files parser | `scripts/run-task/validation.ts` | `parseAffectedFilesFromSpec(taskId)` — reads `### Affected Files` H3 tables from both `## Design` and `## Amendment` / `## Amendment Round N` H2 sections; used by `commitHumanReviewFiles` (managed-doc allow-list) and `verifyBaseDrift` (base-drift allow-list) |
| Base-drift + base-divergence gates (`--push`/`--pr`/`--ship`) | `scripts/run-task/validation.ts`, `scripts/run-task/git.ts` | `verifyBaseDivergence` / `verifyBaseDivergenceFromData` in `validation.ts` checks commit divergence first and blocks at `--push`, `--pr`, and `--ship`; `verifyBaseDrift` / `verifyBaseDriftFromData` remains the file-allow-list gate for `--push`/`--pr`; `getUnpushedBaseCommits` / `getTreeDriftFiles` in `git.ts` are the low-level helpers |

## Internal Orchestrator Modules

Supporting modules consumed by `scripts/run-task/main.ts` and the phase handlers. Not entry points — agents rarely need to read these directly, but they're the right place to look when tracing a specific behavior.

| What | Where | Notes |
|---|---|---|
| Type definitions | `scripts/run-task/types.ts` | `Phase`, `PhaseStatus`, `Verdict`, `PHASE_ORDER`, `StatusJson`, `CliArgs` |
| Environment constants | `scripts/run-task/env.ts` | `REPO_ROOT`, `WORKTREES_ROOT`, all env-var config; synced at module load |
| Policy config wrappers | `scripts/run-task/policy.ts` | Claude/Codex model and size getters; wraps `scripts/pipeline-policy.ts` with resolved config |
| Task context extractors | `scripts/run-task/context.ts` | `extractAffectedFiles()`, `extractAcSummary()`, `extractValidationChecks()` — feeds prompt builders |
| Signal handlers | `scripts/run-task/signals.ts` | SIGHUP survival; installed before heavy imports so the handler is always present |
| Detached-mode isolation | `scripts/run-task/detach.ts` | Process group detachment for SIGHUP-safe background runs |
| Heartbeat monitor | `scripts/run-task/heartbeat.ts` | Per-task `.heartbeat.json` writes at 30s intervals; used by `canon watch` / `canon doctor` to detect live vs. stale runs |
| Phase gate validator | `scripts/run-task/check-phase-gate.ts` | CLI wrapper around `checkPhaseGate()`; called by `canon task phase` before status writes |
| Canon snapshot | `scripts/run-task/canon-snapshot.ts` | Records and compares the canon-ai git snapshot governing a run; used for provenance stamping |
| Markdown table parser | `scripts/run-task/markdown-table.ts` | Parses markdown tables including escaped-pipe cells; used by handoff and spec parsers |
| Prompt rendering | `scripts/run-task/prompts/render.ts` | Mustache rendering with LLM-safe escape-disable; consumed by `scripts/run-task/prompts/index.ts` |
| Prompt startup constants | `scripts/run-task/prompts/helpers.ts` | `CLAUDE_STARTUP`, `CODEX_STARTUP` strings injected into every agent prompt; includes communication norms and Codex git-workflow guidance |
| Agent stream handler | `scripts/run-task/agents/stream.ts` | Child process stdout/stderr muxer with stall detection and graceful kill; shared by `claude.ts` and `codex.ts` |
| Canon-managed files whitelist | `src/lib/canon-owned.ts` | `CANON_OWNED` and `DELIMITED` lists — authoritative source for which files `canon upgrade` controls |

Prompt-template content notes:
- `scripts/run-task/prompts/templates/qa.md` carries Docs Freshness two-checkpoint guidance, Handoff Validation, Release Rules, Code-is-Canonical, and Commit Ownership inline.

## Task Lifecycle Artifacts

Every task lives in `tasks/<TASK-ID>/`. Templates live in `.canon/templates/`.

| What | Where | Author |
|---|---|---|
| Task state machine | `.canon/templates/status.json` | Updated by whichever agent acts |
| Spec template | `.canon/templates/spec.md` | Claude writes; Codex reviews (full tier) |
| Spec review template | `.canon/templates/spec-review.md` | Codex |
| Plan template | `.canon/templates/plan.md` | Claude (after spec approval) |
| Implementation handoff template | `.canon/templates/handoff.md` | Codex |
| Code review template (2-stage) | `.canon/templates/review.md` | Claude |
| QA / human-facing summary template | `.canon/templates/done.md` | Claude; changelog scope points at `docs/decisions.md` |
| QA / outward-facing PR body template | `.canon/templates/pr-body.md` | Claude |
| Per-task scratchpad | `.canon/templates/notes.md` | Any agent, any phase |

## Protected Docs (Institutional Memory)

These must stay current — the pipeline reads the protected `docs/*` corpus at session start, and phase-specific rules arrive just in time via prompt templates and skills.

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
| Per-invocation telemetry | `docs/pipeline-invocations.md` | Auto-appended by `scripts/run-task/metrics.ts` (duration + tokens) |

## Tests

| What | Where | Notes |
|---|---|---|
| Pipeline policy table tests | `tests/pipeline-policy.test.ts` | Tier, sizing, model matrix, loop caps |
| Handoff/git porcelain parser | `tests/run-task-parse-porcelain.test.ts` | Edge cases for git status parsing |
| Handoff validation logic | `tests/run-task-validation.test.ts` | `validateHandoff()` cases |
| Shared run-context resolver tests | `tests/run-context.test.ts` | Orphaned-worktree, PID fallback (CASE C/D), launch-window, EPERM |
| `canon watch` command tests | `tests/watch.test.ts` | Attach/idle branches, grace re-read, launch-window wait, `--until`, `--timeout`, read-failure, summary-line format |
| Docs refs validator | `scripts/docs-refs-check.mjs` | Markdown reference gate; run via `npm run docs-refs-check` |
| Docs refs config | `scripts/docs-refs-config.mjs` | Adopter-owned tuning surface loaded by `scripts/docs-refs-check.mjs`; canon-ai-dev re-adds `templates/` here so its own gate still scans templates. |
| Canon-managed template sync | `tests/sync-canon-templates.test.ts` | Sync direction, delimiter preservation, CLI check, hook regression |
| CLI integration tests | `tests/cli.test.ts` | `canon upgrade`, `canon init`, canon-block extraction and upsert |
| Orchestrator harness tests | `tests/run-task-harness.test.ts` | Affected-files extraction, AC summary, validation checks extraction |
| Task CLI tests | `tests/task-cli.test.ts` | `canon task` subcommand dispatch and argument validation |
| Signal + detach tests | `tests/run-task-signals.test.ts`, `tests/detach.test.ts` | SIGHUP handler registration, process group isolation |
| Heartbeat tests | `tests/heartbeat.test.ts` | Write intervals, stale-detection thresholds |
| Markdown table parser tests | `tests/markdown-table.test.ts` | Escaped pipes, empty cells, malformed rows |
| `canon stop` command tests | `tests/stop.test.ts` | CASE A–D pid selection, SIGTERM → SIGKILL sequencing |

Run via `npm test` (uses node `--test` runner with `tsx` import hook). Test files import directly from `scripts/`.

## Configuration

| What | Where | Notes |
|---|---|---|
| Node/TS project metadata, npm scripts | `package.json` | `test`, `type-check`, `task`, `run-task` scripts |
| Pre-commit sync hook | `package.json` | `simple-git-hooks` config plus `sync-templates` scripts |
| GitHub Actions CI workflow | `.github/workflows/ci.yml` | Triggers, matrix, audit, lint, type-check, test; see `docs/architecture.md` `## CI` |
| ESLint flat config | `eslint.config.mjs` | `@typescript-eslint/recommendedTypeChecked`, `projectService: true` |
| TypeScript config (strict, ES2022, NoEmit) | `tsconfig.json` | `scripts/` and `tests/` only |
| Claude permissions + SessionStart hook | `.claude/settings.json` | Auto-shows in-progress tasks at session start |
| Codex sandbox baseline | `scripts/run-task/agents/codex.ts` | `--sandbox workspace-write` passed on fresh exec |
| Custom canon hooks (placeholder) | `.canon/hooks/README.md` | |
| Worktree dirs allowed for agent CWD | `.claude/settings.json` `additionalDirectories` | `../dev-worktrees` |
| Git ignores | `.gitignore` | |
| Postinstall git-hooks setup | `scripts/install-git-hooks.mjs` | Conditional `simple-git-hooks` wrapper; skips gracefully when no `.git/` present (e.g. adopter CI) |
| Build dist/ path normalizer | `scripts/normalize-dist-paths.mjs` | Post-build step that normalizes worktree symlink path comments in `dist/` |

## Public Assets (README only)

| What | Where |
|---|---|
| Logo | `public/canon-logo.webp` |
| Framework diagram | `public/canon-framework.webp` |

## Feature Wiring Maps

> Common changes that touch multiple files. Use as starting checklists, not exhaustive.

**Add a new pipeline phase**:
> `scripts/pipeline-policy.ts` (if it has model/effort needs) → `scripts/run-task/main.ts` (`PHASE_ORDER`, `runPhase()`, `checkAndRoute()`) → `src/task/index.ts` (`VALID_PHASES`, `assertValidPhase()`) → `.canon/templates/status.json` → `docs/pipeline-orchestrator.md`

**Add a new validation check (handoff or pre-flight gate)**:
> `scripts/run-task/validation.ts` (or new validator function) → relevant test in `tests/run-task-validation.test.ts` → `.canon/templates/handoff.md` (if it adds a new section) → `docs/patterns.md` (Known Pitfalls if motivated by a real incident)

**Change pipeline tier or sizing rules**:
> `scripts/pipeline-policy.ts` (the matrix) → `tests/pipeline-policy.test.ts` → `docs/pipeline-orchestrator.md` (model/effort matrix + tier/sizing tables)

**Change model selection**:
> `scripts/pipeline-policy.ts` (`claudeMatrix`, `codexMatrix`) → env var docs in `docs/pipeline-orchestrator.md` → `tests/pipeline-policy.test.ts`

**Add a new review verdict**:
> `scripts/run-task/types.ts` (`Verdict` union) → `src/task/index.ts` (`VALID_VERDICTS` + `assertValidVerdict()` — the runtime validator diverges from the type union by design) → `src/cli/index.ts` (help text) → `scripts/run-task/validation.ts` (`extractCheckedVerdict()` regex) — all four. TypeScript compiles cleanly with only the first; `canon task phase … <new_verdict>` then fails at runtime with "unknown verdict".

**Add a new task-template field or section**:
> `.canon/templates/<file>.md` → orchestrator parser if structured (e.g., `parseHandoffFiles()` in `scripts/run-task/validation.ts`) → per-phase prompt templates in `scripts/run-task/prompts/templates/`

**Add a CLI flag / `CliArgs` field**:
> `scripts/run-task/types.ts` (the `CliArgs` type) → `scripts/run-task/cli.ts` (parser + usage text) → `tests/run-task-cli.test.ts` (asserts the full parsed-object shape) — all three. Omitting `types.ts` blocks type-check; omitting the test fails the parser-shape snapshot.

**Promote a lesson into canon**:
> `tasks/<id>/notes.md` (raw) → `docs/lessons-learned.md` (distilled & appended, during QA) → eventually `docs/patterns.md` Known Pitfalls or `docs/decisions.md` if it becomes a rule. The final hop (promotion + pruning the buffer) is a **human-run sweep**, never automated by QA — QA only appends.

## Agent Config

| What | Where | Notes |
|---|---|---|
| Operator role summary | `AGENTS.md` | Ambient operator context; reusable rules are delivered JIT via skills/prompts |
| Claude operator guide | `CLAUDE.md` | Ambient Claude context; phase rules are delivered JIT via skills/prompts |
| Agent permissions | `.claude/settings.json` | Allowlisted commands |
| Task artifacts | `tasks/` | Per-task specs, plans, reviews |
