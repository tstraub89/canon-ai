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

When work on `dev` produces framework improvements (script changes, bug fixes, new tooling), port them to `main` via a staging branch and PR.

**Use `git checkout origin/dev -- <files>`, not cherry-pick.** Because the two branches have permanently diverged histories, cherry-picking a dev commit always produces three-way merge conflicts in `package.json`, `package-lock.json`, and any file that has independent edits on both branches. Copying file state directly bypasses the merge entirely.

```bash
# 1. Fetch latest and create a staging branch off current main tip
git fetch origin
git checkout -b port/<version-or-description> origin/main

# 2. Copy the framework files from dev (no merge, no conflicts)
git checkout origin/dev -- \
  AGENTS.md CLAUDE.md CODEX.md \
  package.json package-lock.json \
  scripts/ \
  tasks/_templates/ \
  tests/ \
  tsconfig.json
# Add docs/pipeline-orchestrator.md or other framework docs if changed:
# git checkout origin/dev -- docs/pipeline-orchestrator.md

# 3. Commit and push
git commit -m "chore: port <description> to main"
git push -u origin port/<version-or-description>

# 4. Open a PR from port/<...> → main and merge after review
gh pr create --base main --title "chore: port <description> to main"
```

**What to include**: scripts, templates, agent policy docs, stub docs (only framework-level changes), `tasks/_templates/`, `tests/`, `package.json`, `package-lock.json`.

**What to exclude** (never copy these from dev): `CHANGELOG.md`, `DEVELOPMENT.md`, filled-in `docs/` (architecture, codebase-map, decisions, patterns, etc.), `tasks/` outside `_templates/`.

`docs/` needs judgment — stub/template files belong on main, filled-in canon-ai-specific files do not. When in doubt, diff `origin/main:docs/<file>` against `origin/dev:docs/<file>` and only port if the change is to the template structure, not to canon-ai-specific content.

## Git Hook Setup

A `pre-merge-commit` hook blocks accidental merges between `main` and `dev`. Install it once after cloning:

```bash
npm run setup-hooks
```

This symlinks `scripts/git-hooks/pre-merge-commit` into `.git/hooks/`.
