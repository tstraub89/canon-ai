# Canon as a Package — Design Plan

> Captured from design session 2026-05-15. Not a canon task — reference doc for implementation planning.

## Vision

`npx canon-ai init` drops into any existing repo, reads the codebase, grills the developer, and produces filled-out scaffold docs on day one. No stubs with TODOs, no manual copying. The full canon pipeline then runs via the package from `node_modules`.

---

## Key Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Primary init output | Filled scaffold docs (not stubs) | Stubs just push the hard work onto the adopter |
| Grill mechanism | Hand off to Claude Code subprocess | Piggybacks on existing `claude` install; can read the codebase natively |
| Script location | Hybrid — scripts in `node_modules`, agent-facing docs + templates vendored | Scripts are canon-owned infra; docs are project-owned and need to be visible to agents |
| Grill style | Read codebase first → targeted questions → drill down → write docs | Maximizes value; surgical questions instead of generic questionnaires |

---

## Architecture

### What lives in `node_modules` (canon-owned)
- All orchestrator scripts (`scripts/run-task/`, etc.)
- CLI binary (`canon`)
- Grill prompt template

### What gets vendored into the adopter's repo (project-owned)
- `AGENTS.md`
- `CLAUDE.md`
- `CODEX.md`
- `docs/product-context.md`
- `docs/decisions.md`
- `docs/codebase-map.md`
- `docs/patterns.md`
- `docs/architecture.md`
- `docs/lessons-learned.md`
- `docs/task-quality-log.md`
- `tasks/_templates/spec.md`

---

## Merge Protocol (existing files)

When `canon init` runs in a repo that already has CLAUDE.md / CODEX.md / AGENTS.md:

### Delimiter format

Canon-owned content is bounded by HTML comments so it's machine-readable:

```markdown
<!-- canon:start v0.6 -->
## Role
...canon's pipeline content...
## Task Workflow
...
<!-- canon:end -->

<!-- Your project additions below — canon upgrade will not touch this section -->
## Custom Rules
- ...
```

### Merge rules (written into the grill prompt)

1. Claude Code auto-loads CLAUDE.md at session start — it already has that context
2. Grill prompt explicitly instructs: **also read CODEX.md and AGENTS.md if present** before doing anything else
3. For each existing file, classify every section:
   - **Redundant with canon** → drop (canon handles it structurally)
   - **Project-specific addition** → preserve below the canon block
   - **Conflict with canon** → surface to the human, ask before deciding
4. Write merged file: canon block at top, project additions below, boundary comment between them
5. Stage the result (don't commit) — human reviews the diff before it lands

### Upgrade story

`canon upgrade` diffs/replaces only content between `<!-- canon:start -->` and `<!-- canon:end -->`. Everything below `<!-- canon:end -->` is never touched.

---

## Implementation Phases

### Phase 1 — Template Layer

Pull the stub (project-agnostic) versions of the agent-facing docs from `main` into a `templates/` directory in the package. These are what every adopter gets vendored into their repo.

- Identify which docs on `main` are already generic stubs
- Strip any canon-ai-specific content to make them fully project-agnostic
- Store under `templates/` in the package root

### Phase 1.5 — Merge Protocol Definition

- Define the delimiter format (`<!-- canon:start vX.Y -->` / `<!-- canon:end -->`)
- Write the merge classification rules into the grill prompt
- Define what `canon upgrade` is allowed to touch

### Phase 2 — Package Structure

```
src/
  cli/
    init.ts        # canon init command
    run-task.ts    # thin wrapper → delegates to scripts/
    upgrade.ts     # future: merge protocol for upgrades
  index.ts
templates/         # vendored layer — copied into adopter's repo on init
scripts/           # orchestrator (stays in node_modules)
```

- Add `bin: { "canon": "./dist/cli/index.js" }` to `package.json`
- Package name: `canon-ai` (or `@canon-ai/core` if monorepo scope ever needed)
- Add convenience scripts to adopter's `package.json` on init: `"canon": "canon"`

### Phase 3 — `canon init` Command

When the adopter runs `npx canon-ai init`:

1. Detect existing CLAUDE.md / CODEX.md / AGENTS.md
2. Scaffold: copy `templates/` contents into their repo
3. Add `canon-ai` to their `devDependencies`
4. Shell out to `claude` with the grill prompt as the starting instruction

### Phase 4 — The Grill Prompt

This is the core IP of the init experience. Instructions for the Claude Code session:

**Step 0 — Detect existing canon files**
- CLAUDE.md is already loaded at session start
- Explicitly read CODEX.md and AGENTS.md if present
- If any exist, run the merge protocol before proceeding

**Step 1 — Read the codebase**
- `package.json`, `README`, `src/` structure, config files, any existing docs
- Infer: tech stack, framework, auth pattern, DB, testing setup, deployment target

**Step 2 — Report back**
- Confirm inferences before grilling: "I see Next.js + Prisma + Postgres, deployed to Vercel, Jest for tests — confirming before I proceed"

**Step 3 — Grill on gaps**
- One question at a time, with a recommended answer
- Drill down on anything ambiguous: product rules, terminology, delicate surfaces for their project, team conventions
- Continue until all doc sections have enough content to write

**Step 4 — Write the docs**
- Fill all vendored stubs with actual project content
- Run merge protocol on any pre-existing files
- Stage everything — don't commit

### Phase 5 — CLI Wrapper for `run-task`

`canon run-task <id>` delegates to scripts in `node_modules`. All existing flags pass through transparently:

```
canon run-task <id>
canon run-task <id> --step --expect <phase>
canon run-task <id> --pr
canon run-task <id> --ship
```

Adopters never write `npx tsx node_modules/canon-ai/scripts/...`.

### Phase 6 — npm Publish Setup

- `files` field in `package.json` to include `dist/`, `templates/`, `scripts/`
- `.npmignore` for `tasks/`, `docs/`, `tests/`, dev artifacts
- Versioning: semver, `templates/` changes = minor, breaking orchestrator changes = major
- README for the package (separate from the in-repo README)

---

## Upgrade Story

```
canon upgrade
```

1. Fetches latest `canon-ai` from npm
2. Diffs new `templates/` against vendored files in the project
3. For each file: shows what changed inside the canon block, shows what would be untouched outside it
4. Human decides what to merge — no forced overwrites
5. Scripts upgrade automatically via `npm update canon-ai`

---

## Open Questions (not yet decided)

- Exact package name: `canon-ai` vs `@canon-ai/core`
- Whether `canon init` requires `claude` to be installed, or gracefully degrades to stubs + a generated prompt file the human can paste manually
- Whether the grill session commits the docs or just stages them
- `canon upgrade` implementation timeline (Phase 5+ or post-MVP)
