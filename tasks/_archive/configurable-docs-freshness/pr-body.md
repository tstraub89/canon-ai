# PR Body: configurable-docs-freshness - Configurable QA docs freshness via .canon/config.json

## Summary

- Adds `.canon/config.json` (adopter-owned) with a `docs_freshness` block. It sets the protected docs QA keeps fresh, maps source-path globs to the docs QA must check for matching changes, and lists flag-only docs QA reports instead of editing.
- Replaces the hardcoded QA doc list and the `PIPELINE_MANAGED_DOCS` commit allowlist with one loader and one resolver. The QA prompt and the commit admission now read the same set, so they can't disagree.
- Adopter default protected set drops `docs/pipeline-orchestrator.md`, which is a canon-owned file in adopter repos. canon-ai's own `.canon/config.json` keeps all six docs, so canon-ai's behavior is unchanged.
- A malformed config stops every run command (plain run, `--ship`, `--reroute`, `--pr`, `--push`, full-send) before any state is written, and the message names the file and the problem. Unknown keys warn and the run proceeds.
- `canon doctor` gets a docs-freshness line. `canon init` does not scaffold the file, and `canon upgrade` leaves it byte-identical.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Telemetry files (`docs/lessons-learned.md` and the other pipeline telemetry files) and `tasks/` paths are rejected anywhere in `docs_freshness`. Protected telemetry would otherwise flip `--ship` classification, so the sets stay disjoint.
- `--ship` validates the main checkout's config. Other commands validate the worktree's config, so commit `.canon/config.json` to the base branch before running worktree tasks. The README says so.
- A leading `./` in a doc value is accepted and normalized. The spec's malformed list doesn't cover it, and without normalization such a path would silently never match.
- Known gap, not fixed here: the `--ship` dirt guard still mis-parses a filename containing ` -> `. Same parsing class as a bug fixed in this PR; not yet filed as a follow-up.
- The README example lists `AGENTS.md` under `flag_only` without a mapping that selects it, so that entry does nothing. Follow-up candidate.
- `npm run build` ran during implementation and was not re-run at QA. The `dist/` files should be checked by a fresh build before merge.
- Manual checks to run: the eight scenarios in the spec's Human Test Plan (config absent, mapped folder touched and untouched, flag-only doc, malformed config, unknown key, `canon upgrade`, canon-ai doctor line).
