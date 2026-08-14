# Contributing to canon-ai

Thanks for your interest. canon-ai is a TypeScript/Node CLI that scaffolds a
spec-driven, multi-agent coding pipeline into other repositories — and dogfoods
that same pipeline on itself. That shapes how contributions flow.

## Ground rules

- **Bugs and feature requests**: open a GitHub issue. Include the canon version
  (`canon --version`), your Node version, and — for pipeline bugs — the task's
  `status.json` and the relevant `tasks/<id>/` artifacts if you can share them.
- **Small fixes** (typos, error-message wording, doc corrections): a direct PR
  is welcome.
- **Behavioral changes**: open an issue first. canon-ai's behavior is governed
  by settled decisions in `docs/decisions.md` — proposals that re-litigate a
  settled decision need a reason the original rationale no longer holds.

## Development setup

Prerequisites: Node 24.x, git. Claude Code and Codex CLI are only needed to
run the pipeline itself, not to build or test.

```bash
git clone https://github.com/tstraub89/canon-ai.git
cd canon-ai
npm ci
npm run build
npm test
```

## Before you open a PR

Run the full validation set — CI enforces all of it:

```bash
npm run build        # tsup bundle; dist/ is committed and diffed in CI
npm run type-check
npm run lint         # covers src/, scripts/, and tests/
npm test
npm run sync-templates:check
npm run docs-refs-check
```

Two repo-specific rules that trip newcomers:

- **`dist/` is committed.** CI fails any PR whose `dist/` doesn't match a fresh
  build. Rebuild as part of the same commit that changes `src/`.
- **`templates/` is a derived mirror.** For canon-managed files, edit the root
  copy and run `npm run sync-templates` (the pre-commit hook also does this) —
  never edit `templates/<file>` directly. The managed set lives in
  `src/lib/canon-owned.ts`.

## Adopter-scope rule for user-facing strings

Every string in `src/` that reaches an adopter at runtime — CLI output, errors,
warnings, and the agent prompt templates in
`src/orchestrator/prompts/templates/` — must make sense in an arbitrary repo.
Don't reference canon-ai's own tree (`src/**`, `tests/**`, `templates/` as a
path) or files `canon init` doesn't scaffold. See `AGENTS.md` §Adopter Scope
for the full test; a leakage test in `tests/cli.test.ts` enforces part of it.

## Review expectations

Maintainer changes go through canon's own pipeline (spec → implement →
multi-lens code review → QA). External PRs get a maintainer review plus an
automated review pass; expect findings to be direct and specific — that's the
project's communication norm, not hostility. Lead with what you changed and
why; note anything you couldn't test.

## License

By contributing, you agree your contributions are licensed under the
[MIT License](LICENSE).
