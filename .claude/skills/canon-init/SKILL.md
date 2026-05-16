---
name: canon-init
description: Fill canon scaffold docs with real project content. Reads the codebase, confirms inferences, grills on product and team context, then writes all docs. Run once after `canon init` to go from stubs to project-specific content.
argument-hint: ""
allowed-tools: Read Glob Grep Write Edit Agent Bash(git add *) Bash(git status *)
effort: high
---

# Canon Init Grill

This skill fills your canon scaffold docs with real project content. Expected output: filled `docs/product-context.md`, `docs/architecture.md`, `docs/codebase-map.md`, `docs/decisions.md`, `docs/patterns.md` — no placeholders, no "TBD".

Follow these phases in order. Do not skip or combine phases.
**⛔ STOP** points require the project owner's explicit confirmation before continuing.

---

## Phase 0 — Check for existing canon files

CLAUDE.md is already loaded. Before doing anything else:

- If `CODEX.md` exists, read it.
- If `AGENTS.md` exists, read it.

For each file, scan for content **below** the `<!-- canon:end -->` delimiter. That content is project-specific and must be preserved. Note what you find — you'll need it in Phase 4.

---

## Phase 1 — Explore the codebase

Delegate codebase exploration to an Explore sub-agent via the Agent tool. Prompt it to read and return:

- `package.json` (or equivalent build file): name, description, main dependencies, scripts
- `README.md`: product description, setup summary
- `src/` or equivalent source root: top-level directory structure with one-line descriptions per directory
- Config files: `tsconfig.json`, `eslint.config.*`, `.env.example`, `Dockerfile`, `docker-compose.*`, `vercel.json`, any CI workflow files (`.github/workflows/`)
- Test setup: runner, test file patterns, any global fixtures or helpers
- Auth mechanism: how are users authenticated? (JWT, sessions, OAuth, Clerk, NextAuth, Passport, etc.)
- Database / ORM: what data layer is used? (Prisma, Drizzle, TypeORM, raw SQL, none, etc.)

Ask the sub-agent to return:
- **Tech stack**: language + version, framework, major libraries
- **Auth**: mechanism and the file where session/token logic lives
- **Database**: ORM or client, where the schema is defined
- **Testing**: test runner, where tests live, any E2E framework
- **Deployment**: platform and config file(s)
- **Source structure**: top-level module map — each directory with a one-line description
- **CI**: workflow files present, what gates block merges (or "no CI found")
- **Surprises**: anything non-obvious that a new contributor or AI agent would need to know

Synthesize the findings before proceeding. You do not need to re-read files the sub-agent already read.

---

## Phase 2 — Confirm inferences

**⛔ STOP — present your inferences and wait for the project owner to confirm before grilling.**

List what you inferred from the codebase:

- Tech stack (language, framework, key libraries with versions)
- Auth mechanism
- Database / ORM
- Test runner and file conventions
- Deployment target
- Anything uncertain or ambiguous — flag these explicitly

Say: "Confirming these before I ask questions — correct anything that's wrong or missing."

Wait for explicit confirmation.

---

## Phase 3 — Grill on gaps

Ask questions **one at a time**. For every question, state your **recommended answer** (infer from the codebase where possible). Wait for the project owner to confirm, redirect, or override before moving to the next question.

Do not ask a question the codebase already answered. Continue until you have enough to fill every section in every stub doc.

Topics to cover — skip any that the codebase already answered:

**Product identity**
- What does this product do, in one sentence?
- Who are the primary users?
- What are the 2–4 core user workflows?

**Business model** *(skip if not applicable)*
- Free vs. paid tiers? What's gated behind paid?
- What are the "paid surfaces" that regression-test guardrails should protect?

**Delicate surfaces**
- Which areas have unbounded blast radius if broken? (auth flows, billing, payments, data migrations, security-critical logic)
- These become the project's `delicate: true` domain examples in `docs/product-context.md`.

**Team conventions**
- Branch naming convention?
- PR process — required approvals, review channels?
- Anything the pipeline should know about how the team works?

**Known pitfalls**
- What footguns exist in this codebase that a fresh agent session would likely step on?
- Any recent incidents or regressions worth calling out?

**Terminology** *(only if relevant)*
- Are any domain nouns overloaded or easily confused? (e.g., "workspace" vs. "project" vs. "account")

---

## Phase 4 — Write the docs

Write every stub doc with real, project-specific content. No placeholders. No "TBD". If you realize you're missing information for a section mid-write, ask one targeted question before writing that section.

### `docs/product-context.md`
- **Product Overview**: 1–2 paragraph elevator pitch
- **Core Concepts & Terminology**: fill the glossary table with real terms; remove example rows
- **Primary User Flows**: 2–4 concrete flows the codebase supports
- **`delicate` flag domain examples**: the project-specific surfaces confirmed in the grill
- **Free vs. Paid Feature Split**: fill if applicable; remove this section if the product has no tiers
- **Business Rules**: non-obvious product rules (trial periods, data retention, geo restrictions, etc.); omit if none
- **Voice & Tone**: fill if there are user-facing copy conventions; remove if not relevant

### `docs/architecture.md`
- **Tech Stack**: fill the bullet list from confirmed inferences
- **High-Level Architecture**: a short block diagram or prose description of the major pieces
- **Data Flow**: walk through what happens for the most common user action (input → state mutation → persistence → external services)
- **Boundaries & Contracts**: API schema location, storage layer interface, any worker protocols
- **Validation table**: bind each category to the actual `npm run ...` (or equivalent) command; mark N/A with rationale for categories that don't apply
- **CI**: describe what runs on push and what blocks merges; state "no CI configured" if absent
- **Cross-Cutting Concerns**: fill only the subsections that exist in this project (auth lifecycle, error tracking, feature flags, i18n, accessibility)

### `docs/codebase-map.md`
- **Entry Points**: app entry point, core type definitions, global config, routes/navigation
- **State & Data**: fill with real file paths and one-line descriptions
- **UI / Components**: fill if this project has a UI; remove section if purely backend
- **Workers / Background**: fill if applicable; remove if not
- **API / Backend**: fill if applicable
- **Tests**: real test directory paths
- **Config**: real config file paths agents might need to edit
- **Feature Wiring Maps**: replace the placeholder wiring maps with 2–3 real feature trails specific to this project (e.g., "add a new API endpoint", "add a gated feature")

### `docs/decisions.md`
- At least 3–5 entries covering major settled decisions: why this stack, why this auth approach, key architectural choices. Include the rationale, not just the decision.

### `docs/patterns.md`
- Implementation patterns the team has settled on: at least one per major layer (API, data, UI if applicable)
- **Known Pitfalls** section: fill with footguns from the grill session and codebase exploration
- Leave the template structure intact; fill each section that applies

### `docs/lessons-learned.md`
- Add any lessons surfaced during the grill (confirmed incidents, footguns, past regressions)
- Leave empty rather than fabricate — this doc grows over time with real tasks

### Agent config files — merge protocol

If any of `AGENTS.md`, `CLAUDE.md`, `CODEX.md` had project-specific content below `<!-- canon:end -->` (noted in Phase 0):

1. For each custom section, classify it:
   - **Redundant with canon** → drop it (canon handles this structurally)
   - **Project-specific addition** → keep it below `<!-- canon:end -->`
   - **Conflict with canon** → surface it to the project owner and wait for a decision before writing
2. Rewrite the file: canon block unchanged between its delimiters, project additions below `<!-- canon:end -->`.
3. Never modify content between `<!-- canon:start -->` and `<!-- canon:end -->`.

---

## Phase 5 — Set up Claude permissions (optional)

By default, Claude Code prompts on every `git`, `gh`, `codex`, and `canon` subprocess. Canon ships with a recommended allowlist that eliminates the prompts.

1. Run `canon doctor` and read the `.claude/settings.json` line under "Config". The detail tells you whether the recommended canon perms are present, partially present, or absent.
2. If anything's missing, ask the project owner: *"Want me to add canon's recommended permission allowlist to `.claude/settings.json`? I'll preserve your existing entries."*
3. If yes:
   - Read `.claude/settings.json` if it exists (or start from `{}`).
   - Merge canon's recommended entries into `permissions.allow` — see the project README "Skip the permission prompts" section for the full block. Preserve all existing entries; only add what's missing.
   - Write back with 2-space indentation.
4. If no, skip — canon works without it; every `canon run` will just prompt per subprocess.

This is purely ergonomics. The committed `.claude/settings.json` is project-level (shared with the team). Personal "full send" overrides belong in `.claude/settings.local.json` (gitignored).

---

## Phase 6 — Stage and summarize

Stage all written docs (and `.claude/settings.json` if Phase 5 modified it):

```bash
git add docs/ AGENTS.md CLAUDE.md CODEX.md 2>/dev/null
[ -f .claude/settings.json ] && git add .claude/settings.json
git status --short
```

Then print a summary:

- Which docs were filled (list them)
- Whether the Claude permissions allowlist was updated
- Any sections left intentionally thin, and why
- Next step: `git diff --staged` to review, then commit when satisfied
- How to run the pipeline once you have a task ready: `canon run <id>` (or `npx tsx scripts/run-task.ts <id>` without global install)
