## Summary

- Add `/canon-inline-review` skill that drives an independent second-model cross-review of below-the-pipeline work (non-trivial inline edits, XS fixes too small for a full canon task). Target selection is intent-driven — the skill reads the operator's request and conversation context to choose `--uncommitted`, `--commit <SHA>`, or `--base <branch>`; a clean working tree is detected before running so the review is never silently a no-op. Genuine ambiguity routes to `AskUserQuestion` rather than guessing.
- Collapse `CLAUDE.md`'s ~12-line cross-review how-to into a two-line norm and a pointer to the skill. The always-loaded file keeps the rule (when to cross-review, no self-review, not a spec-compliance gate); the skill owns the mechanics and loads only on demand.
- Register the skill across all required surfaces (`CANON_OWNED`, `checkSkills()`, `RECOMMENDED_ALLOW`, README permission block, `.claude/settings.json`) so it ships to adopters via `canon upgrade`, passes `canon doctor`, and keeps the README drift test green.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt `dist/cli/index.js` after `doctor.ts`/`canon-owned.ts` changes; committed)

## Notes

- `codex exec review --uncommitted` live smoke test was blocked by the Codex sandbox (`Operation not permitted (os error 1)` on app-server client init). Skill text and registration are correct; verify live invocation manually in a real working tree using the Human Test Plan in `tasks/canon-inline-review-skill/done.md`.
- The initial implementation used git-state inference for target selection (ahead-check, `git log @{u}..HEAD`). After the same edge-case class appeared across multiple review rounds, the design was rerouted to intent-from-context: the skill reads what you asked for, not what git thinks the state is.
- README drift tests in `tests/cli.test.ts` now read from `WORKTREE_ROOT` instead of `REPO_ROOT`. In a linked worktree, `REPO_ROOT` points at the supervising checkout and misses the task's README edits — required for the drift test to validate the right file.
- `.claude/settings.json` is intentionally absent from `CANON_OWNED` and has no `templates/` mirror. It carries canon-ai's machine-specific config; the adopter grant path is `RECOMMENDED_ALLOW` in `doctor.ts`.
