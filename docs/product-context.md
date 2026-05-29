# Product Context

> Source of truth for user-visible behavior, terminology, and product rules. Agents read this when their task touches user-facing logic.

## How to use this doc

This file documents the *product*, not the *code*. It exists because:

1. Code shows *what* happens, not *why* the user sees it that way.
2. Terminology drift causes confusion (one part of the system says "task," another says "job" for the same thing).
3. Business rules need a single source of truth that's not buried in conditional code.

Rule of thumb: if a non-engineer needed to understand canon-ai, they should be able to read this doc and get a complete picture without reading code.

> **canon-ai's "user" is a developer.** There is no end-user UI, no consumer surface, no auth, no billing. The product is the framework itself. Sections below adapt accordingly.

---

## Product Overview

**canon-ai is an opinionated, spec-first, multi-agent coding pipeline.** It's a TypeScript orchestrator plus a corpus of workflow rules and templates that two AI agents (an architect and an implementer) operate under, with a human as the final arbiter.

The thesis: LLMs are excellent at writing code and bad at four specific things — knowing when to ask vs. assume; holding the full context of a project's conventions; catching their own scope creep, dropped requirements, or silent regressions; and distinguishing settled architectural decisions from open questions. canon-ai treats those failure modes as engineering problems and gives each one a structural answer (cross-review, file-based handoffs, validation gates, two-stage code review, accumulated `lessons-learned.md` that gets promoted into canon).

**Who it's for**: developers who want AI agents to ship correct, on-spec, well-reviewed work without constant babysitting — and who are willing to invest in the discipline (writing clear specs, accumulating lessons, treating canon's docs as enforcement rather than reference).

**The accumulation is the canon.** Each rule in `AGENTS.md`, each pattern in `docs/patterns.md`, each pitfall — they're not documentation, they're *enforcement*. Agents read them at session start. The pipeline injects relevant excerpts into prompts. When a rule is violated and a bug ships, the lesson goes into `lessons-learned.md` and eventually gets promoted into canon, so the next agent can't make the same mistake.

## Core Concepts & Terminology

| Term | Definition |
|---|---|
| **Task** | A unit of work tracked under `tasks/<id>/`. Has a spec, plan, implementation, review, QA, and human-review phases. |
| **Phase** | One stage of a task's lifecycle (`spec`, `spec_review`, `plan`, `implement`, `code_review`, `qa`, `human_review`). |
| **Spec** | The contract for what a task accomplishes. Written by Claude (architect), reviewed by Codex (full tier) or by the human (fast tier). Approved before implementation begins. |
| **Plan** | The implementation steps Claude lays out after spec approval. References specific files and existing patterns. |
| **Handoff** | The artifact Codex writes after implementing — what files changed, what ACs were met, what validation outcomes are. The reviewer reads this alongside the diff. |
| **Review** | Two-stage code review by Claude. Stage 1 verifies spec compliance (gate); Stage 2 assesses code quality (only if Stage 1 passes). |
| **Verdict** | The review outcome: `approved`, `approved_with_nits`, `changes_requested`, or `needs_re_review`. |
| **Done** | The QA artifact Claude writes after review passes — plain-English summary, files changed, test plan for the human. |
| **Tier** | The level of orchestrator effort applied. Fast tier (S non-delicate) collapses spec+plan and skips Codex spec review. Full tier (M/L/XL or any delicate) runs the complete workflow. |
| **Task size** | `S` (trivial), `M` (default, contained), `L` (substantial), `XL` (large or sensitive). Drives tier, model, effort, and loop caps via `pipeline-policy.ts`. |
| **Delicate** | A boolean flag that promotes a task's effective size to XL, regardless of nominal size. For surfaces where regressions have unbounded blast radius (auth, billing, persistent storage, or — for canon-ai itself — the orchestrator's own routing logic). |
| **Bundle mode** | Multiple task IDs passed to one `run-task.ts` invocation. Tasks share a tier, share a review loop, and reroute together on `changes_requested`. |
| **Worktree** | A separate git working tree (and branch) for a task, isolating its edits from the supervising orchestrator's view. Default-on; opt-out is a per-task flag. |
| **Reroute** | Sending a task back to an earlier phase (`changes_requested` on review) so an agent can re-do work. |
| **Auto-block** | Halting the pipeline when `MAX_REVIEW_LOOPS` is exceeded. Requires manual intervention to resume. |
| **Conversational Claude** | The Claude session the human chats with directly. Writes specs, invokes the pipeline, monitors progress. Distinct from pipeline Claude sessions, which the orchestrator spawns for plan / review / QA. |
| **Pipeline Claude** | A Claude session spawned by `run-task.ts` for a specific phase (plan, code_review, qa). Does not interact with the human directly. |
| **The canon** | The accumulated rules in `AGENTS.md`, `docs/patterns.md`, `docs/decisions.md`, `docs/lessons-learned.md` — the doctrine all agents work under. |

## Primary User Flows

### Flow 1: Adopt canon-ai in a new repo (downstream user)

1. Install the package: `npm install -D canon-ai` (or global). This pulls in the `canon` CLI plus bundled templates, skills, and orchestrator scripts.
2. Run `canon init` in the target repo. It scaffolds `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `.canon/` (templates, README), and the `docs/` stubs with `TODO[canon]` markers, and installs the `/canon-init` Claude Code skill.
3. From Claude Code, run `/canon-init`. The skill grills on project context (stack, domain, delicate surfaces, voice) and fills the scaffolded docs with project-specific content.
4. Create the first task: `canon task new <id> <title>`. Write a spec conversationally with Claude (or invoke `/spec`).
5. Run the pipeline: `canon run <id>`.

> Run `canon upgrade` periodically to sync canon-owned files (templates, skills, `.canon/README.md`) to the installed package version. Project-owned overrides in `tasks/_templates/` are preserved.

### Flow 2: Run a task (the standard pipeline lifecycle)

1. **Human + conversational Claude** discuss the problem. Claude grills on shape and decomposition (full tier) or asks clarifying questions (fast tier), then writes `spec.md` in `tasks/<id>/`.
2. **Human reads spec, approves at the spec gate.** Claude invokes `canon run <id>`.
3. **Pipeline runs**: spec_review (full tier) → plan → implement → code_review → qa, with auto-reroute on `changes_requested` and auto-block on loop-cap hits.
4. **Human tests against `done.md`**, marks `phases.human_review.status = "done"`.
5. Task artifacts get archived; lessons distilled into `lessons-learned.md`.

### Flow 3: Recover from a stuck pipeline

1. Pipeline halts (auto-block, manual Ctrl+C, or unexpected error).
2. Human inspects `tasks/<id>/status.json` and the latest artifact written.
3. Resolve manually: reset the relevant phase via `canon task phase <id> <phase> pending`, or set `iterations_current_loop` back to 0 if a loop cap was hit (preserves `iterations_total` and `auto_block_count`), or escalate to a human reroute.
4. Re-run `canon run <id>`. The orchestrator picks up from the new phase state.

### Flow 4: Self-improvement (canon-on-canon)

1. canon-ai's own `dev` branch is the staging/work-in-progress branch for pipeline improvements.
2. Tasks that modify the orchestrator (`scripts/run-task/`, `pipeline-policy.ts`, templates, `AGENTS.md`) run through canon-ai's own pipeline on `dev`, with worktree isolation so the supervising orchestrator is shielded from edits to itself mid-run.
3. Trivial tweaks (≤ ~10 lines, no logic change) may still be inline; non-trivial changes go through the full pipeline.
4. Releases merge `dev` → `main` with a version bump and `CHANGELOG.md` entry. `main` is the published `canon-ai` npm package — what adopters get when they `npm install`.

## Tiers, Sizes, and Authorization

(See `scripts/pipeline-policy.ts` for the authoritative matrix; this is the human-readable summary.)

- **Fast tier**: `S` non-delicate. Spec+plan in one Claude session. Codex spec review skipped (human gate replaces it). Lower model effort.
- **Full tier**: anything `M`, `L`, `XL`, or `delicate`. Spec and plan in separate Claude sessions. Codex runs spec review. Higher model effort scaling with size; XL/delicate uses the full Codex model at `xhigh` effort.

### `delicate` flag — project-specific domains

Canon's general definition (from `CLAUDE.md`): `delicate: true` is for surfaces where a regression has **unbounded blast radius** — an undetected bug is materially harder to recover from than a normal bug. The list below names the canon-ai-specific surfaces where this applies.

- **Orchestrator phase-routing logic** (`scripts/run-task/main.ts`: `PHASE_ORDER`, `runPhase()`, `checkAndRoute()`). A bug here corrupts every task that runs after the change lands.
- **Auto-commit logic** (`autoCommitCode()`). Wrong files staged, missed handoff entries, or bypassed checks lead to invisible regressions in code review.
- **Validation gates** (`validateHandoff()`, future pre-flight checks). A buggy gate either rejects valid work (blocking everyone) or accepts invalid work (silent corruption).
- **Pipeline policy** (`scripts/pipeline-policy.ts`). Wrong tier, wrong model, wrong loop cap — these affect cost, latency, and reliability for every subsequent task.
- **Status.json schema or parser changes** (`.canon/templates/status.json` + parsers in `scripts/run-task/validation.ts` and `scripts/run-task/state.ts`). A schema break in flight can leave in-progress tasks unrunnable.
- **Worktree machinery** (worktree creation, sync, cleanup). Bugs here corrupt git state in ways that are slow to detect and expensive to recover from.

Adopters of canon-ai add their own project-specific delicate domains to this list (typically: auth, billing, payments, persistent-storage migrations, security-relevant cryptography, regulated-data handling like PHI or PII).

## Free vs Paid

> Not applicable. canon-ai is currently proprietary, single-tier, and not commercially distributed. If a future product (e.g., a hosted bootstrap service) ships, this section gets a real entry.

## Business Rules

- **Repo visibility**: canon-ai is a private GitHub repository. The `canon-ai` npm package ships from `main`. Future open-source release would be a separate decision.
- **Branch policy**: `dev` is the work-in-progress branch where pipeline improvements land first; `main` is the release branch and the source of the published `canon-ai` npm package. Releases merge `dev` → `main` with a version bump and `CHANGELOG.md` entry. Cross-branch sync still uses cherry-pick for canon-supplied changes outside a release (see `docs/patterns.md`).
- **Changelog**: `CHANGELOG.md` lives on both branches and ships with the package. Audience is canon-ai contributors and adopters who want to know what changed between versions. Format follows Keep a Changelog conventions.
- **License**: Proprietary (`LICENSE` file at repo root). Reconsidered when/if a public release happens.

## Voice & Tone

canon-ai ships an opinionated communication norm for agents. From `AGENTS.md`:

> Lead with the finding, not a cushion. Drop non-load-bearing praise — "great work overall, but…" adds noise. Hedge only when uncertainty is real; omit hedging words ("might", "possibly") when it isn't. End at the last substantive sentence; no trailing pleasantries. Disagreement is signal — push back on specs and reviews you disagree with, and say why.

This applies to: spec authorship, code review, handoff writing, QA summaries, and inter-agent communication. **What's not flexible**: agents must surface real disagreement rather than yielding to politeness. The human must hear about risks and tradeoffs rather than getting filtered output. *Tone preference can be adjusted per project; honest signal is canon discipline.*

## Roadmap (Brief)

- **Current state**: v1.0.0 shipped (2026-05-15). canon-ai is an installable npm package with a `canon` CLI (init, doctor, upgrade, update, run, task), bundled Claude Code skills (`/spec`, `/pipeline`, `/status`, `/changelog`, `/canon-init`), template overrides via `tasks/_templates/`, and a unit suite run by `npm test`. Many canon-on-canon tasks have shipped through the full pipeline (see `tasks/_archive/`). External adopters provide dogfood feedback driving the next hardening pass.
- **Near-term**: Adopters extend validation by wiring real checks through project scripts (`package.json` or equivalent), which Codex runs during the `implement` phase under canon's `--sandbox workspace-write` baseline. Continued hardening of the executable/declared canon boundary surfaced by external dogfooding (per `docs/decisions.md` "Declared Canon vs Executable Canon").
- **Future**: Additional agent-CLI adapters (Gemini, Aider). Public release decision.

(See `docs/pipeline-orchestrator.md` for orchestrator mechanics.)
