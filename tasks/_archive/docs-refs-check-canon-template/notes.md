# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[spec_review] `runUpgrade()` reads CANON_OWNED files from `pkgDir/templates/<rel>` only; adding a new entry outside that tree needs a template copy or a lookup change.
[spec_review] `.github/workflows/ci.yml` path filters skip doc-only PRs, so a new docs gate step will not run on the changes it is meant to police unless the triggers change too.
[spec_review] `docs/architecture.md` currently requires a full build for `src/**` changes, so `src/cli/commands/upgrade.ts` cannot be marked "build N/A" in the spec.
[spec_review] `README.md` and `templates/**` are already covered by `ci.yml`, so the new docs-only workflow duplicates `docs-refs-check` on those paths unless the path list is narrowed.
[implement] `npm run docs-refs-check` still surfaces 6 pre-existing refs in `CLAUDE.md`, `docs/decisions.md`, `docs/lessons-learned.md`, `docs/pipeline-orchestrator.md`, and `README.md`; those files are outside this task's Affected Files table, so I left them for follow-up rather than widening scope.
[implement-revision] The gate is easier to keep green when intentionally-retired or absent targets are rewritten as prose instead of path citations; the validator only needs one stale path to fail the whole check.
[implement-revision] Round 3 review text repeated the pre-flight validation complaint even though `spec.md` already has `## Validation Required`; re-check the spec before treating that finding as authoritative.

