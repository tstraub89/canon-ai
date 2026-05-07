# Canon

> **The law your agents work under.**
>
> A spec-first, multi-agent coding pipeline you drop into any repo.

---

## What this is

Canon is an opinionated workflow framework for AI-driven software development. It encodes a hard-won discipline — accumulated over many shipped features and many post-mortems — into scripts, templates, and rules that two AI agents (an architect and an implementer) operate under, with a human as the final arbiter.

The goal: make AI coding agents reliably ship correct, on-spec, well-reviewed work without constant babysitting. Not "the agents do everything" — **the agents do the right thing, and the human catches what they miss, and over time the rules absorb every miss so the next miss never happens**.

That accumulation is the canon. The rules in `AGENTS.md`, the patterns in `docs/patterns.md`, the decisions in `docs/decisions.md` — they're not documentation, they're *enforcement*. Agents read them at session start. The pipeline injects relevant excerpts into prompts. Spec authorship and code review check against them. When a rule is violated and a bug ships, the lesson goes into `docs/lessons-learned.md` and eventually gets promoted into the canon, so the next agent can't make the same mistake.

## Why it exists

LLMs are extraordinary at writing code. They're mediocre at:

- **Knowing when to ask vs. assume**
- **Holding the full context of a project's conventions in their head over a long session**
- **Catching their own scope creep, dropped requirements, or silent regressions**
- **Distinguishing settled architectural decisions from open questions**

Canon is what happens when you treat those failure modes as engineering problems instead of "well, AI is what it is" shrugs. Each one gets a structural answer:

| Failure mode | Canon's answer |
|---|---|
| Agent jumps to implementation before requirements are clear | **Spec phase** before code, written conversationally with grilling for non-trivial tasks |
| Agent silently drops a requirement | **Two-stage code review** — Stage 1 is a spec-compliance gate that fails the whole review if any AC is missing from the cross-reference table |
| Agent reinvents an existing pattern | **`docs/patterns.md` trigger table** + Known Pitfalls injected into implement prompts |
| Agent re-debates a settled decision | **`docs/decisions.md`** — agents read, don't re-propose |
| Agent forgets a past mistake | **`docs/lessons-learned.md`** — distilled cross-task wisdom that promotes into permanent rules over time |
| Reviews loop forever on the same disagreement | **Auto-block on runaway review loops** — 3 rounds for S/M, 5 for L/XL, then escalate to human |
| Spec drift between conversation and pipeline | **File-based handoff protocol** — every artifact lives in `tasks/<id>/`, no copy-pasting |
| Sensitive surfaces (auth, payments) get refactored on theoretical grounds | **`delicate: true` flag** that promotes the task to highest-effort tier and triggers extra review discipline |

## How it works

Canon orchestrates two AI coding CLIs:

- **Claude Code** (Anthropic) plays the **architect**: writes specs, reviews code, writes QA summaries.
- **Codex CLI** (OpenAI) plays the **implementer**: reviews specs (full-tier tasks), writes code, writes handoff reports.

A **human** is the product owner: approves specs, runs final behavioral tests, ships.

The orchestrator (`scripts/run-task.ts`, ~4000 lines) drives this. For each task:

```
spec → spec_review → human gate → plan → implement → code_review → qa → human_review
```

…with automatic loops on `changes_requested` verdicts, model/effort scaling by task size, optional git-worktree isolation, session resumption across phases, and auto-block on runaway loops. See `docs/pipeline-orchestrator.md` for the full mechanics.

The pipeline supports two tiers:

- **Fast tier** (small tasks): spec + plan in one Claude session, skip Codex spec review, human gate replaces it.
- **Full tier** (medium / large / delicate tasks): every phase runs separately, Codex reviews specs before they reach the human.

A single command runs a task end-to-end through the whole pipeline:

```bash
npx tsx scripts/run-task.ts <task-id>
```

`--step --expect <phase>` runs one phase with a phase-mismatch guard. `--ship` archives a finished task. Multiple task IDs in one invocation = bundle mode.

## Architecture: two layers

Canon is two products in one repo, in different states of completion:

### Layer 1: The Scaffold *(this is what's shipping today)*

The portable structure: orchestration scripts, task templates, agent rules (`AGENTS.md` / `CLAUDE.md` / `CODEX.md`), knowledge corpus templates (`docs/patterns.md`, `docs/decisions.md`, etc.), config files for both CLIs.

**Drop this into any repo and, after filling in the project-specific scaffolding, you have:**

- A working multi-agent pipeline that runs spec → review → implement → review → QA without intervention
- Templates for every artifact the pipeline produces
- The discipline (low-padding communication norms, two-stage code review, code-is-canonical, etc.) baked into the agent rules
- A knowledge corpus structure (`docs/patterns.md`, `docs/decisions.md`, `docs/codebase-map.md`) you fill in as your project's conventions emerge

The "after filling in the project-specific scaffolding" caveat matters: canon-ai ships ~48 `TODO[canon]:` markers across the docs and a few in the orchestrator. The pipeline runs without them, but agent prompts will be referencing empty validation matrices and missing patterns until you populate them.

**What you don't get from Layer 1:**

- Pre-populated `docs/patterns.md` / `docs/decisions.md` / `docs/codebase-map.md` for *your* codebase. Those are the institutional-memory docs that make canon valuable, and they have to be project-specific. Layer 1 ships them as detailed templates with `TODO[canon]` markers.

### Layer 2: The Bootstrap CLI *(future — not built yet)*

A setup CLI that points at an existing repo and uses Claude to analyze it and *generate the initial knowledge corpus* — codebase map, settled decisions surfaced from git history and code, the obvious patterns that are already canonical.

This is the product hypothesis worth validating: *can we collapse the 6-month "fill in your patterns.md as you go" cold start into a single bootstrap run?*

Layer 1 is required for Layer 2 to work; Layer 2 is what makes Layer 1 actually useful on day one.

## Current scope

✅ **Built and working in canon-ai today:**

- `scripts/run-task.ts` — full pipeline orchestrator with phase routing, worktree isolation, session resumption, auto-block, bundle mode, --reroute, --ship
- `scripts/pipeline-policy.ts` — pure policy module (tier/sizing/model/effort matrix), table-tested
- `scripts/task.sh` — task lifecycle helper (new / list / status / phase / reset-spec-review / post-merge-sync / release-init), genericized for non-Node projects
- `tasks/_templates/` — eight artifact templates (status, spec, spec-review, plan, handoff, review, done, notes)
- `AGENTS.md` / `CLAUDE.md` / `CODEX.md` — workflow rules and per-agent guidance
- `docs/` — knowledge corpus templates with detailed scaffolding
- `.codex/config.toml` / `.claude/settings.json` — agent CLI configs
- 58 unit tests passing (`npm test`)

🚧 **Stubbed with `TODO[canon]:` markers — fill in for your project:**

- Validation matrix in `AGENTS.md` (which checks apply to which change types)
- Implementation Rules sections in `AGENTS.md` (state, styling, perf, testing, gating, assets, analytics — project-specific)
- Codebase Navigation in `CLAUDE.md` and Validation Checklist in `CODEX.md`
- All `docs/*.md` content (the templates teach you the format; the substance is yours)
- Project name (defaults to your `package.json` "name" field, or set `CANON_PROJECT_NAME`)

❌ **Not in scope for MVP — phase 2:**

- The Layer 2 bootstrap CLI (codebase analyzer that auto-populates `docs/`)
- Skills extraction (Claude Code-specific `/pipeline`, `/spec`, `/status` commands)
- Adapters for other agentic CLIs (Gemini CLI, Aider, etc.) — assumed Claude Code + Codex CLI for now
- Pre-built docs-check / external-API-citation tooling (project-specific in original)
- Per-language project bootstrappers (Python / Rust / Go variants)

## Getting started

> ⚠️ **Pre-MVP**: Layer 1 works mechanically but the experience of using canon in a fresh project hasn't been validated. The first real test of the abstraction is its dogfooding adoption.

```bash
# 1. Clone canon-ai into your project (or copy the relevant files manually)
git clone git@github.com:tstraub89/canon-ai.git
cp -r canon-ai/{scripts,tasks,docs,AGENTS.md,CLAUDE.md,CODEX.md,.codex,.claude,.canon} your-project/
cd your-project

# 2. Install the orchestrator's deps (TypeScript + tsx + node:test)
npm install --save-dev tsx typescript @types/node

# 3. Set the project name (or rely on your package.json "name" field)
export CANON_PROJECT_NAME="your-project"

# 4. Verify the pipeline scripts run
npm test

# 5. Fill in the knowledge corpus
# Open each docs/*.md and replace TODO[canon] markers with project content.
# At minimum: AGENTS.md "Validation Matrix" and "Implementation Rules" sections.

# 6. Create your first task
./scripts/task.sh new my-first-task "Description"

# 7. Write a spec conversationally with Claude (in tasks/my-first-task/spec.md),
# then invoke the pipeline:
npx tsx scripts/run-task.ts my-first-task
```

Expect a calibration period. The first several tasks will surface conventions worth writing into `docs/patterns.md` and `docs/decisions.md` — that's the point of those files. The rate of new pattern/decision entries should taper off as the canon accumulates. The exact number of tasks before things feel stable is project-specific; canon hasn't been validated across enough projects to give a confident range.

## The canon philosophy

The metaphor matters. A *canon* is a body of accumulated, authoritative work — the texts that define a tradition. It accrues over time. New work is judged against it. Once something is canonical, you don't re-debate it.

That's exactly what `docs/patterns.md`, `docs/decisions.md`, and `AGENTS.md` are. They start small. They grow as the project ships features and absorbs lessons. They become more authoritative over time. And the more authoritative they are, the better the agents perform — because the agents stop having to guess.

The implication for product strategy: **the value of canon compounds with use**. A 6-month-old canon repo on a real project is dramatically more useful than a fresh canon repo on a fresh project. That's where Layer 2's bootstrap CLI matters — it tries to short-circuit the cold start by generating an initial canon from existing code.

## Roadmap

**Phase 1 (now)**: Layer 1 ships. Validate the abstraction by using canon-ai on at least one fresh project. Measure friction. Iterate the templates.

**Phase 2 (next)**: The bootstrap CLI. `canon init` on an existing repo runs Claude over the codebase, generates initial `docs/codebase-map.md` (file inventory + feature wiring), surfaces obvious decisions from git history into `docs/decisions.md`, and identifies recurring patterns into `docs/patterns.md`. The hypothesis: this collapses the 6-month "fill in your canon as you go" cold start.

**Phase 3 (research)**: Make the implementer slot pluggable — adapter interface for Codex CLI, Gemini CLI, Aider, others. Architect slot stays Claude Code (skills are load-bearing). Validate that the same task produces working code through any adapter.

**Phase 4 (research)**: Productize. Hosted bootstrap service? Per-language scaffolds? Marketplace for `docs/patterns.md` starter packs (Next.js patterns, Rails patterns, etc.)? TBD based on Phase 2 validation.

## License

Proprietary. See `LICENSE`. This may eventually open-source — that decision lives downstream of Phase 2 validation.

## Origin

Canon is the result of pulling the multi-agent pipeline out of [GalleryPlanner](https://gallery-planner.com), where it was developed and refined over several months of shipping features. The discipline encoded here was earned the hard way — every rule corresponds to a bug that shipped because the rule wasn't there yet.

That's the asset. The scripts are easy. The accumulated discipline is the moat.
