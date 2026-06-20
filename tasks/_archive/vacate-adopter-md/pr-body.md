## Summary

- Removed `AGENTS.md` and `CLAUDE.md` from `DELIMITED` in `src/lib/canon-owned.ts` (now an empty list), so `canon upgrade` and the pre-commit sync hook no longer touch adopter agent files. The delimiter machinery (`mergeDelimited`, marker constants, upgrade/sync loops) is retained as a dormant no-op for future use.
- Deleted the `templates/` copies of `CLAUDE.md` and `AGENTS.md` so `canon init` no longer scaffolds either file. Pre-existing files are detected via a direct presence check and read as project context without alteration. `canon doctor` no longer hard-fails on absent agent files; the CI git-install smoke no longer asserts the two files exist after `canon init`.
- Added `tools/strip-canon-block.mjs` — a non-shipped migration utility for existing adopters whose files carry a legacy `<!-- canon:start -->…<!-- canon:end -->` block. Strips the block, preserves all content outside it, refuses to write when the git tree is dirty (fails closed even when `git status` itself errors), and supports `--check`/`--dry-run` mode. Covered by `tests/strip-canon-block.test.ts`.
- Slimmed canon-ai's own root `CLAUDE.md` and `AGENTS.md` to ambient operator context; delimiter markers removed. Cleared pipeline startup helpers (`CLAUDE_STARTUP`, `CODEX_STARTUP`, resumed-session note) of agent-file read instructions — rules arrive via injected per-phase prompts, and the instruction dangled in fresh adopter repos where neither file exists. Comprehensive AC-13 reference sweep updated README, docs, shipped skills, and their `templates/` mirrors so no shipped surface still describes these files as canon-managed.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` (876 pass, 1 skipped; golden regenerated with `UPDATE_GOLDENS=1 npm test`)
- [x] `npm run docs-refs-check`
- [x] `npm run build` (`src/` and `scripts/run-task/` changed; both `dist/` artifacts rebuilt and committed)

Additional checks:

- [x] `npm run sync-templates:check` — all canon-managed mirrors in sync
- [x] `npm pack --dry-run` — `tools/strip-canon-block.mjs` absent from tarball (AC-9)
- [x] `git grep` sweep — no delimiter markers in root agent files, no `checkAgentFile` in src/tests/dist, no agent-file refs in `scripts/run-task/prompts/`, no stale managed/scaffolded framing in README/docs/skills/templates (AC-10, AC-16, AC-A2, AC-13)

## Notes

- **Breaking change.** `canon upgrade` no longer merges into `CLAUDE.md` or `AGENTS.md`. Adopters with a legacy canon block in those files should run `node tools/strip-canon-block.mjs` (available in the repo; not published to npm) to strip the inert block. The tool is idempotent and refuses to write on a dirty tree.
- **Delimited machinery stays.** `mergeDelimited`, the marker constants, and the upgrade/sync loops remain; adding a future file back to `DELIMITED` requires only its path entry — no code change.
- **CI is the runtime check for AC-17.** The two `test -f` smoke asserts are removed from `.github/workflows/ci.yml`; the subsequent `canon doctor` step passes because `checkAgentFile` was removed (AC-16). CI on this branch is the end-to-end verification for that AC.
- **Scope deviation.** The AC-13 stale-reference sweep was originally scoped to root docs and skills, but `docs-refs-check` also validates shipped scaffold templates (`templates/docs/*.md`). Updating those four mirrors was required to keep the full suite green; documented as a deviation in the handoff.
- **Human Test Plan** (spec §"Human Test Plan"): migration tool strip/no-op/idempotency/dirty-tree-refusal, `canon init` no-scaffold and no-alter, `canon doctor` no-fail, `canon upgrade` no-touch, canon-ai slim read-through (always-on norms all present), and `npm pack --dry-run` confirming the tool is not published.
