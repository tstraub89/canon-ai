---
name: canon-init
description: Use right after running `canon init` on a fresh repo, or when canon's scaffold docs (`docs/product-context.md`, `docs/architecture.md`, `docs/codebase-map.md`, `docs/decisions.md`, `docs/patterns.md`) still contain `<placeholder>` text or "TBD" stubs. Triggers on "fill in the canon docs", "set up canon for this project", "go from scaffold to real content", or explicit `/canon-init` invocation. Run once per project lifecycle.
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

Before doing anything else, check whether `AGENTS.md` or `CLAUDE.md` exists in the project root. If either is present, note it — they are adopter-owned; canon does not insert, merge, or read managed content into them. Note any team conventions, terminology, or pitfalls you find from the codebase and docs — you'll need them in Phase 4.

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

For the section-by-section breakdown of what goes in each doc — `docs/product-context.md`, `docs/architecture.md`, `docs/codebase-map.md`, `docs/decisions.md`, `docs/patterns.md`, and `docs/lessons-learned.md` — see [write-guide.md](write-guide.md). Read it once at the start of Phase 4, then write each doc.

---

## Phase 5 — Set up Claude permissions (optional)

By default, Claude Code prompts on every `git`, `gh`, `codex`, and `canon` subprocess. Canon ships with a recommended allowlist that eliminates the prompts.

1. Run `canon doctor` and read the `.claude/settings.json` line under "Config". The detail tells you whether the recommended canon perms are present, partially present, or absent.
2. If anything's missing, ask the project owner: *"Want me to add canon's recommended permission allowlist to `.claude/settings.json`? I'll preserve your existing entries."*
3. If yes:
   - Read `.claude/settings.json` if it exists (or start from `{}`).
   - Merge canon's recommended entries into `permissions.allow` — the full block is below. Preserve all existing entries; only add what's missing.

     ```json
     {
       "permissions": {
         "allow": [
           "Bash(git *)", "Bash(gh *)", "Bash(sed *)", "Bash(awk *)",
           "Bash(ls *)", "Bash(find *)", "Bash(fd *)", "Bash(cat *)",
           "Bash(head *)", "Bash(tail *)", "Bash(grep *)", "Bash(rg *)",
           "Bash(wc *)", "Bash(echo *)", "Bash(tr *)", "Bash(xargs *)",
           "Bash(tee *)", "Bash(jq *)",
           "Bash(npm run *)", "Bash(npm test)", "Bash(npm test *)",
           "Bash(npm audit)", "Bash(npm audit *)", "Bash(npm ci)", "Bash(npm ci *)",
           "Bash(npx canon *)", "Bash(npx tsc *)", "Bash(canon *)", "Bash(codex *)",
           "Skill(canon-init)", "Skill(canon-spec)", "Skill(canon-spec:*)",
           "Skill(canon-pipeline)", "Skill(canon-pipeline:*)",
           "Skill(canon-status)", "Skill(canon-status:*)",
           "Skill(canon-changelog)", "Skill(canon-changelog:*)",
           "Skill(canon-spec-review)", "Skill(canon-spec-review:*)"
         ]
       }
     }
     ```

     The shell-tool entries are for pipeline composition (e.g. `cat foo.json | jq '.bar'`), not raw file reads — built-in Read/Glob/Grep stay preferred.
   - Write back with 2-space indentation.
4. If no, skip — canon works without it; every `canon run` will just prompt per subprocess.

This is purely ergonomics. The committed `.claude/settings.json` is project-level (shared with the team). Personal "full send" overrides belong in `.claude/settings.local.json` (gitignored).

---

## Phase 6 — Stage and summarize

Stage all written docs (and `.claude/settings.json` if Phase 5 modified it):

```bash
git add docs/ 2>/dev/null
[ -f .claude/settings.json ] && git add .claude/settings.json
git status --short
```

Then print a summary:

- Which docs were filled (list them)
- Whether the Claude permissions allowlist was updated
- Any sections left intentionally thin, and why
- Next step: `git diff --staged` to review, then commit when satisfied
- How to run the pipeline once you have a task ready: `canon run <id>`

---

## Related

- `/canon-spec` — author the first task once scaffold docs are filled.
- `/canon-status` — verify the project's task state.
- `/canon-pipeline` — once a task exists, drive it through the pipeline.
- `AGENTS.md` / `CLAUDE.md` — adopter-owned; generate them with the built-in `/init` (Claude Code or Codex) when you don't already have them.
- `docs/pipeline-orchestrator.md` — pipeline internals for when tasks are running.
