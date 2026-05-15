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
- Grill skill template

### What gets vendored into the adopter's repo (project-owned)
- `AGENTS.md`, `CLAUDE.md`, `CODEX.md` — wrapped in canon delimiters; project additions go below `<!-- canon:end -->`
- `docs/product-context.md`, `docs/decisions.md`, `docs/codebase-map.md`, `docs/patterns.md`, `docs/architecture.md`, `docs/lessons-learned.md`, `docs/task-quality-log.md`
- `.canon/templates/` — task scaffolding templates; adopters can customize these
- `.canon/version` — written by `canon init` / `canon upgrade` with the installed package version
- `.claude/skills/canon-init/SKILL.md` — the grill skill; updated by `canon upgrade`

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
    init.ts        # canon init — scaffold + write .canon/version
    run-task.ts    # thin wrapper → delegates to scripts/
    update.ts      # canon update — npm update or npm install -g
    upgrade.ts     # canon upgrade — sync canon blocks + .canon/version
  index.ts
templates/         # vendored layer — copied into adopter's repo on init
  .canon/
    templates/     # task scaffolding templates (adopters can customize)
  .claude/
    skills/
      canon-init/  # grill skill (canon-owned, upgraded by canon upgrade)
  AGENTS.md / CLAUDE.md / CODEX.md  # with canon:start/end delimiters
  docs/            # stub docs for the grill to fill
scripts/           # orchestrator (stays in node_modules)
```

- Add `bin: { "canon": "./dist/cli/index.js" }` to `package.json`
- Package name: `canon-ai` (or `@canon-ai/core` if monorepo scope ever needed)
- Add convenience scripts to adopter's `package.json` on init: `"canon": "canon"`

### Phase 2.5 — External Dependency Handling

Canon requires several external CLI tools that are not npm packages. The package treats them as documented prerequisites with runtime detection — not peer deps.

| Tool | When needed | Handling |
|---|---|---|
| `git` | always | hard requirement — `canon init` fails with setup instructions if missing |
| `node` 24+ | always | hard requirement |
| `jq` | `task.sh` helpers | hard requirement — `canon init` fails if missing |
| `claude` | spec, plan, review, qa phases | hard requirement — `canon init` fails if missing |
| `codex` | implement, spec_review phases | hard requirement — `canon init` fails if missing |
| `gh` | `--pr`, `--push` only | soft — passes init, fails at use with: `"--pr requires the GitHub CLI: brew install gh && gh auth login"` |

**`checkDeps()`** runs at the start of `canon init` — checks hard requirements, warns about soft ones.  
**`checkDepForFlag(flag)`** runs at the start of specific commands — `gh` is checked when `--pr` or `--push` is passed.

The canon snapshot in `status.json.canon` records `<unavailable>` for any binary that isn't found (existing behavior for `claude`/`codex` — extend to `gh`).

### Phase 3 — `canon init` Command

**Installation**: JS projects add it as a devDependency (`npm install --save-dev canon-ai`). Non-JS projects install globally (`npm install -g canon-ai`) — same as any other CLI tool. `npx canon-ai init` works for one-shot use without installing.

When the adopter runs `canon init`:

1. Run `checkDeps()` — fail fast with setup instructions for any missing hard requirement
2. Detect existing CLAUDE.md / CODEX.md / AGENTS.md
3. Scaffold: copy `templates/` contents into their repo
4. Add `canon-ai` to their `devDependencies`
5. Shell out to `claude` with the grill prompt as the starting instruction

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

`canon run <id>` delegates to scripts in `node_modules`. All existing flags pass through transparently:

```
canon run <id>
canon run <id> --step --expect <phase>
canon run <id> --pr
canon run <id> --ship
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
- Whether the grill session commits the docs or just stages them
- `canon upgrade` implementation timeline (Phase 5+ or post-MVP)

## Resolved

- **External dependency handling**: all external CLIs (`claude`, `codex`, `gh`, `jq`, `git`) are documented prerequisites with runtime detection, not npm peer deps. Hard requirements checked at `canon init`; `gh` is soft and checked at `--pr`/`--push` use. See Phase 2.5.
