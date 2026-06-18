## Summary

- Relocated ~22 sole-homed pipeline operating rules from the `AGENTS.md` / `CLAUDE.md` canon blocks into the per-phase JIT surfaces that consume them (prompt templates, agent charters, startup constants, skills) — each phase now carries only its own rules, scoped rather than broadcast.
- Made the `canon task new` scaffolds self-contained: `spec.md` has the validation matrix and protected-docs list inline; `done.md` and `status.json` point at surviving project docs instead of `AGENTS.md`.
- Added an AC-11 structural test that greps presence and absence tokens and sweeps `.canon/templates/` for any remaining MD block references, so future edits can't silently re-introduce a dropped rule or cross-phase bleed.
- PR-review amendment: spec templates now carry the Human Escalation Contract's sensitive-surface trigger list (auth, billing, privacy, destructive operations, schema migrations, analytics changes); QA prompt and `done.md` scaffold no longer ask for a version bump (entry text only, per human policy decision 2026-06-18); `canon-changelog` skill description capitalization fixed to match `docs/decisions.md`.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt `dist/scripts/run-task.js`; sole dist file changed)
- [x] `npm run sync-templates:check`
- [x] AC-1 presence-token grep (all verbatim tokens present in destinations)
- [x] AC-8 absence-token grep (no spec-craft signatures in code-review surfaces; no code-review signatures in spec surfaces)
- [x] AC-13 scaffold sweep (`grep -rE 'AGENTS\.md|CLAUDE\.md' .canon/templates/` → zero matches)
- [x] `git diff main...HEAD -- AGENTS.md CLAUDE.md templates/AGENTS.md templates/CLAUDE.md` → empty (MD files unchanged)
- [x] AC-A1 escalation-trigger grep (all six terms in both spec templates)
- [x] AC-A2 version-bump request grep (no surface proposes a version)
- [x] AC-A3 changelog description capitalization

## Notes

`AGENTS.md` and `CLAUDE.md` are **unchanged** by this PR. Rules now live in both channels (the MD blocks and the JIT surfaces), making the MD blocks redundant but not yet removed. The single-source cleanup is the follow-on vacate task tracked in `docs/BACKLOG.md`.

One file outside the spec's Affected Files table was added: `scripts/run-task/prompts/index.ts`. `promptImplementResume()` had a hardcoded AGENTS.md Validation Matrix reference on a JIT resume path; leaving it would have violated AC-3. Documented as a deviation in the handoff.

The AC-11 structural test reads file content via `process.cwd()` rather than the `REPO_ROOT` constant — in a linked-worktree run, `REPO_ROOT` resolves to the supervising checkout and would read pre-task file content. `process.cwd()` is the correct scoping; documented as a deviation in the handoff.

Four optional nits from code review are non-blocking and tracked in done.md.
