# Developing Canon

This file documents how canon-ai itself is developed. It lives only on `dev` and is not part of the portable framework shipped on `main`.

## Branch Strategy

Canon-ai maintains two permanently divergent branches:

| Branch | Purpose |
|---|---|
| `main` | Portable framework — scripts, templates, policy docs, and stub docs that adopters copy into their repo |
| `dev` | Canon-ai dogfooding — everything on main plus filled-in docs (`architecture.md`, `codebase-map.md`, etc.), `CHANGELOG.md`, and task artifacts for canon's own development |

**These branches never merge in either direction.** They diverge intentionally and a direct merge would corrupt both.

### What belongs on `main`

- `scripts/` — orchestrator, task helpers, pipeline policy
- `tasks/_templates/` — task artifact templates
- `AGENTS.md`, `CLAUDE.md`, `CODEX.md` — agent policy (project-agnostic)
- `docs/` — stub/template versions of all docs (with `TODO[canon]` placeholders)
- `.canon/hooks/README.md` — hook system documentation
- `.claude/settings.json`, `.codex/config.toml` — agent config templates
- `tests/`, `tsconfig.json`, `package.json` — framework test harness and tooling
- `README.md`, `LICENSE`

### What stays on `dev` only

- Filled-in `docs/` (architecture, codebase-map, product-context, decisions, patterns, etc.)
- `CHANGELOG.md`
- `tasks/` (excluding `_templates/`) — all task artifacts from canon's own pipeline runs
- `DEVELOPMENT.md` (this file)

### Syncing changes to `main`

When work on `dev` produces framework improvements (script changes, bug fixes, new tooling), port them to `main` via a staging branch and PR. The staging branch lets you strip dev-only file changes before the commit lands on `main`.

```bash
# 1. Create a staging branch off main (not dev)
git checkout -b port/<version-or-description> main

# 2. Cherry-pick the release commit (or commits) from dev
git cherry-pick --no-commit <commit-sha>

# 3. Unstage and discard any dev-only file changes
git restore --staged CHANGELOG.md && git checkout -- CHANGELOG.md
# Repeat for any filled-in docs, task artifacts, or DEVELOPMENT.md if touched

# 4. Commit and push
git commit -m "chore: port <description> to main"
git push -u origin port/<version-or-description>

# 5. Open a PR from port/<...> → main and merge after review
```

**What to include in the PR**: scripts, templates, agent policy docs (`AGENTS.md`, `CLAUDE.md`, `CODEX.md`), stub docs under `docs/` (only if the change is framework-level — e.g. a new section added to a template file), `tasks/_templates/`, `tests/`, `package.json`.

**What to exclude**: `CHANGELOG.md`, `DEVELOPMENT.md`, filled-in `docs/` (architecture, codebase-map, decisions, etc.), `tasks/` outside `_templates/`, any canon-ai-specific telemetry or pipeline-invocations files.

Never cherry-pick commits that only touch dev-only files — those have nothing to land on `main`.

## Git Hook Setup

A `pre-merge-commit` hook blocks accidental merges between `main` and `dev`. Install it once after cloning:

```bash
npm run setup-hooks
```

This symlinks `scripts/git-hooks/pre-merge-commit` into `.git/hooks/`.
