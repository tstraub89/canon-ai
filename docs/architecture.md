# Architecture

> System overview. The 30,000-foot view of how the project is structured. Agents read this when orienting for the first time, when the task touches core data flow, or when the task crosses architectural boundaries.

## How to use this doc

This is the *map* of the codebase, not a tutorial on building features. It should answer questions like:

- What's the tech stack?
- How does data flow from user input to persistent storage?
- Where do major boundaries live?
- What are the load-bearing libraries / frameworks the project depends on?

Anything that would change if you migrated to a different framework belongs here. Patterns within the framework belong in `docs/patterns.md`.

> **canon-ai is a CLI orchestrator, not a web/app product.** This doc describes canon-ai's own internals. When dropped into a downstream repo, this file is rewritten for that project.

---

## Tech Stack

- **Language**: TypeScript (strict, ES2022, ESM) — `tsconfig.json`
- **Runtime**: Node.js 24.x — `package.json` `engines`
- **Test runner**: Node built-in `node --test` with `tsx` import hook for direct TS execution
- **Type checker**: `tsc --noEmit` for fast validation; `tsup` (via `npm run build`) emits the published CLI bundle in `dist/` from `src/`. Orchestrator scripts run directly via `tsx` without a build step.
- **Shell helpers**: bash + `jq` for status.json updates (`scripts/task.sh`)
- **External CLIs the orchestrator drives**: `claude` (Anthropic CLI), `codex` (OpenAI Codex CLI), `git`, `gh`
- **Persistence**: filesystem only — `status.json` files and markdown artifacts under `tasks/<id>/`
- **State machine**: `status.json` per task, with phases as nodes (see `.canon/templates/status.json`)
- **Concurrency model**: one pipeline at a time per repo. Multi-task runs use `bundle mode` (multiple task IDs to one orchestrator invocation), not parallel orchestrators.
- **Isolation**: optional git worktree per task (status flag `worktree: true`) — keeps the supervising orchestrator's checkout shielded from in-flight implementation edits.
- **CI**: GitHub Actions via `.github/workflows/ci.yml`. Triggers on push and PR to `main` and `dev`, runs on Node 24.x with `npm ci`, `npm audit --omit=dev`, `npm run lint`, `npm run type-check`, `npm test`, and `npm run build`.

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Human                                                        │
│   ↕ (chat with conversational Claude)                         │
│   ↕ (reviews spec at gate; tests against done.md)             │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│  Conversational Claude (architect)                            │
│   • Writes spec.md (in tasks/<id>/) — grill mode for full tier│
│   • Invokes orchestrator after spec gate                      │
│   • Monitors progress                                         │
└──────────────────────────────────────────────────────────────┘
        │ npx tsx scripts/run-task.ts <id>
        ▼
┌──────────────────────────────────────────────────────────────┐
│  Orchestrator (scripts/run-task/main.ts via scripts/run-task.ts) │
│   • Reads status.json → determines current phase              │
│   • Resolves model/effort/loop-cap via pipeline-policy.ts     │
│   • Spawns agent CLIs (claude / codex) with per-phase prompts │
│   • Auto-commits code after implement passes validation       │
│   • Validates handoff at code_review entry                    │
│   • Reroutes on changes_requested; auto-blocks on loop cap    │
└──────────────────────────────────────────────────────────────┘
        │
        ├──── invokes ────┐                       ┌──── invokes ────┐
        ▼                 ▼                       ▼                 ▼
┌─────────────────┐  ┌─────────────────┐   ┌─────────────────┐  ┌─────────────────┐
│  Claude CLI     │  │  Codex CLI      │   │  git / gh       │  │  filesystem     │
│  (spec, plan,   │  │  (spec_review,  │   │  (branch mgmt,  │  │  (status.json,  │
│   review, qa)   │  │   implement)    │   │   worktree,     │  │   artifacts in  │
│                 │  │                 │   │   commits)      │  │   tasks/<id>/)  │
└─────────────────┘  └─────────────────┘   └─────────────────┘  └─────────────────┘
```

The orchestrator is a long-running TypeScript process. It spawns agent CLIs as subprocesses, reads their stdout/stderr, parses structured artifacts they wrote to disk, advances phase state, and loops until the task reaches `human_review`.

## Data Flow

### One-task lifecycle (full tier)

1. **Human + conversational Claude** discuss the problem. Claude creates `tasks/<id>/` with templated artifacts via `./scripts/task.sh new <id> <title>`. Status starts at `phases.spec.status = "pending"`.
2. **Spec authorship** happens in the conversation. Claude writes `spec.md` and updates status (`phases.spec.status = "done"`).
3. **Human spec gate**: human reads `spec.md`, signals approval. Claude invokes `npx tsx scripts/run-task.ts <id>`.
4. **Orchestrator boots**: reads `status.json`, derives current phase (`spec_review`), resolves policy from `pipeline-policy.ts` (tier=full, model=codex-mini medium effort, etc.).
5. **Codex spec review**: orchestrator spawns `codex exec` with the spec-review prompt and the spec file. Codex writes `spec-review.md`. Orchestrator parses verdict; if `changes_requested`, increments iteration count and routes back to spec (or auto-blocks if cap hit).
6. **Plan**: orchestrator spawns Claude with the plan prompt. Claude writes `plan.md`.
7. **Implement**: orchestrator spawns Codex with the implement prompt + spec + plan. Codex edits files in the worktree (or main checkout if `worktree: false`), writes `handoff.md`. Orchestrator runs hallucination check.
8. **Auto-commit**: `autoCommitCode()` parses every handoff Changes table → `allHandoffFiles` set. Verifies dirty tree matches handoff (every dirty file is listed; every listed file exists). Stages and commits with task-titled message.
9. **Code review**: orchestrator runs `validateHandoff()` pre-flight (no `Fail` rows, AC coverage table populated, all required validations present). If pass, spawns Claude with the review prompt. Claude writes `review.md` (Stage 1 + Stage 2). On `changes_requested`, routes back to implement.
10. **QA**: Claude writes `done.md`, distills `notes.md` into `lessons-learned.md` entries, appends row to `task-quality-log.md`.
11. **Human review**: human tests against `done.md`, marks `phases.human_review.status = "done"`.

### State persistence

All state is files. There is no in-memory shared state between phases — every transition reads/writes the filesystem. This is what makes session resumption possible: re-running `run-task.ts <id>` from a cold start picks up wherever `status.json` last was.

### Telemetry

After every agent invocation, the orchestrator appends a row to `docs/pipeline-invocations.md` (duration + tokens). During QA, Claude appends a row to `docs/task-quality-log.md` (spec review iterations, dropped ACs, validation gaps). Both files are append-only; rotation is manual.

## Boundaries & Contracts

### `status.json` is the state machine contract

Every artifact in `tasks/<id>/` is markdown for human consumption; `status.json` is the only structured contract between phases. Schema lives in `.canon/templates/status.json`:

- Top-level `status` is **derived** — it points at the first non-`done` phase. Hand-editing it produces inconsistent state. Use `./scripts/task.sh phase` instead.
- Each phase has at least `{ status, agent }`. Review phases also have `{ verdict, iterations }`.
- `task_size` (`S | M | L | XL`) and `delicate` (boolean) are set at task creation; both feed `pipeline-policy.ts` to choose tier, model, and loop cap.

### File-based handoff (not in-memory)

Agents do not pass data to each other through memory or stdout. Every handoff is a markdown file with a stable name (`spec.md`, `handoff.md`, `review.md`, etc.) and a documented schema (the `.canon/templates/` versions). Codex parses `spec.md` headings; Claude parses `handoff.md`'s Changes table via regex (`parseHandoffFiles()` in `scripts/run-task/validation.ts`). The orchestrator parses verdict lines.

This is deliberate. File-based handoff means:
- Sessions can be resumed cold (re-running `run-task.ts` recovers full state).
- Humans can read everything an agent saw.
- Bugs in one phase don't poison another phase via in-memory leakage.

### Agent CLI subprocess contract

The orchestrator drives agent CLIs as subprocesses (`claude` and `codex`). It does not call APIs directly. This means:
- Agent prompt construction is the orchestrator's job.
- Agent output goes to disk; the orchestrator parses files, not stdout.
- The CLIs handle session continuity, model selection at the CLI level, and credentials.

### Worktree boundary (when enabled)

When `worktree: true`, the orchestrator creates a git worktree for the task. The supervising `run-task.ts` process runs from the main checkout; agent CLIs (especially `codex` during implement) run with CWD set to the worktree. Edits land in the worktree until merge. The supervisor's view of `scripts/`, `AGENTS.md`, etc. is shielded — this is what makes canon-on-canon work safely.

## Validation

`AGENTS.md` §"Validation Matrix" defines the canon-supplied **categories** of check that apply to different change types. The bindings below say what each category means concretely for canon-ai.

| Category (from AGENTS.md) | canon-ai binding |
|---|---|
| Linting | `npm run lint` (= `eslint scripts/ tests/ src/`) — required for all changes |
| Type checking | `npm run type-check` (= `tsc -p tsconfig.json --noEmit`) |
| Unit tests | `npm test` (= `node --test --import tsx tests/*.test.ts`) |
| Full build | `npm run build` (= `tsup`) — emits the published `canon-ai` CLI bundle. Required for any change touching `src/` (the published package surface). |
| End-to-end tests | N/A — no UI surface, no end-to-end runtime to test against. The orchestrator's behavior is exercised by unit tests on `pipeline-policy.ts` and parsers in `scripts/run-task/git.ts` and `scripts/run-task/validation.ts`. |
| Prerender / sitemap / feed | N/A — no static-site or content-distribution surface. |
| Migration runner | N/A — `status.json` schema changes are manual. When the schema changes, update `.canon/templates/status.json`, update parsers in `scripts/run-task/state.ts`, `scripts/run-task/git.ts`, and `scripts/run-task/validation.ts`, and add a row to `tests/run-task-validation.test.ts`. |
| Cross-platform | Node 24.x is the supported version (declared in `package.json` `engines`). CI runs 24.x via `.github/workflows/ci.yml`. |

**Spec authors**: when filling a task's "Validation Required" section, reference the categories that apply. The orchestrator and reviewers cross-check against this table to know what command corresponds to what category.

## CI

CI is configured via `.github/workflows/ci.yml`.

**Triggers**: push to `main` or `dev`, and pull requests targeting `main` or `dev`. Doc-only commits (`docs/**`, `tasks/**`, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `scripts/task.sh`, `.agent/**`, `.github/**/*.md`) are skipped via `paths-ignore`.

**Matrix**: Node 24.x only.

**Each job runs in order**: `npm ci` → `npm audit --omit=dev` → `npm run lint` → `npm run type-check` → `npm test` → `npm run build`.

**Concurrency**: runs on the same `github.ref` cancel in-flight runs when a new push lands.

**To make CI a hard merge gate**: in GitHub → Settings → Branches, add a protection rule for `main` and `dev` with required status check `test (24.x)`. Until configured, CI is informational only.

## Cross-Cutting Concerns

### Session resumption

Anthropic's `claude` CLI supports `--resume <session-id>`. The orchestrator stores per-task session IDs in `status.json` (`sessions` field) so re-runs continue the same conversation rather than starting cold. Codex sessions are similar.

### Auto-block / reroute

Two mechanisms halt or redirect the pipeline:
- **`autoBlockPhase()`**: when `MAX_REVIEW_LOOPS` is hit on `spec_review` or `code_review`. Sets phase status to `blocked`, appends to `task-quality-log.md`, exits with code 2. Manual intervention required (reset phase + `iterations_current_loop`; see recovery below). Lifetime counters (`iterations_total`, `auto_block_count`) are never reset.
- **`routeBackTo()`**: on `changes_requested` verdicts. Flips the target phase and all downstream to `pending`. Loop re-enters the routed phase next iteration.

### Validation gates

Three gates protect the implement → review boundary:
- **`autoCommitCode()`** (pre-commit): cross-checks dirty tree against handoff Changes table both directions. Fails if files aren't accounted for.
- **`validateHandoff()`** (pre-review, per-task): rejects handoffs with `Fail` validation outcomes, missing AC coverage tables, or skipped required checks.
- **`verifyHandoffAgainstDiff()`** (pre-review, bundle-wide): post-commit cross-check that the committed diff matches the union of all bundle members' handoff Changes tables — catches hallucinated handoff entries and silent edits that slipped past the pre-commit check.

### Concerns that don't apply

The template includes auth/session/feature-flag/i18n/accessibility sections from app projects. canon-ai is a CLI orchestrator with no end-user UI, no auth surface, no localization, no accessibility surface. None of those apply.
