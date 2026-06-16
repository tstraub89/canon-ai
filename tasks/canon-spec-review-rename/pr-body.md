## Summary

- Renamed the pre-pipeline spec-preview skill from `/canon-review` to `/canon-spec-review` to align the command name with the pipeline phase it pre-empts (`spec_review`) and to disambiguate it from `/canon-inline-review` (code-diff review).
- Updated every load-bearing reference in lockstep: live skill directory and templates mirror, `CANON_OWNED` manifest, `canon doctor` health check and permission grants, README catalog and allowlist block, four sibling skills (`canon-init`, `canon-pipeline`, `canon-spec`, `canon-status`), `docs/pipeline-orchestrator.md`, forward-looking dev docs, local settings, and rebuilt `dist/cli/index.js`. Behavior is unchanged.
- Existing adopters who run `canon upgrade` should manually remove `.claude/skills/canon-review/` afterward — `canon upgrade` is additive-only and will not remove the stale directory. The `[Unreleased]` CHANGELOG entry explains this.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt `dist/cli/index.js`; no `src/` logic change — bundle updated for `RECOMMENDED_ALLOW`, `skillNames`, and `CANON_OWNED` entries only)

## Notes

- The orphaned `templates/.claude/skills/canon-review/` mirror was removed explicitly via `git rm` — the sync tool copies by path and does not prune orphaned directories.
- Two pre-existing nits noted in code review are not addressed here: a weak `/canon-spec/` regex in `tests/cli.test.ts:432` (predates this PR) and an empty untracked dir residue for the deleted old skill on the local filesystem (no CI or adopter impact).
- `npm run sync-templates:check` verified the templates mirror is consistent; the old mirror dir is absent.
