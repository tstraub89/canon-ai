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

When work on `dev` produces framework improvements (script changes, bug fixes, new tooling), cherry-pick those commits to `main`:

```bash
git checkout main
git cherry-pick <commit-sha>
```

Never cherry-pick commits that only touch dev-only files (filled-in docs, task artifacts, CHANGELOG).

## Git Hook Setup

A `pre-merge-commit` hook blocks accidental merges between `main` and `dev`. Install it once after cloning:

```bash
npm run setup-hooks
```

This symlinks `scripts/git-hooks/pre-merge-commit` into `.git/hooks/`.
