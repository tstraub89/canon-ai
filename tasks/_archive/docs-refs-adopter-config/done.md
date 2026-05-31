# QA Summary: docs-refs-adopter-config

> Move adopter-tunable docs-refs-check arrays into a non-clobbered config file

## What Changed

`scripts/docs-refs-check.mjs` is a canon-owned file — `canon upgrade` overwrites it wholesale on every run. But it contained three arrays whose comments explicitly told adopters to edit them after each upgrade (`NOISY_SOURCE_PATHS`, `VALID_DIRS`, `MARKDOWN_ROOT_DIRS`). These two facts are a contradiction: upgrades silently dropped adopter customizations on a slow fuse (the loss only surfaces when a future file lands under a dropped path, producing green-CI-at-upgrade / red-CI-a-week-later skew). Gallery Wall hit this on 2026-05-25.

This task resolves it by splitting the three arrays out of the canon-owned checker into a separate adopter-owned file that `canon upgrade` never touches. The checker loads the sibling config at startup, merges it with canon defaults (union semantics), and degrades gracefully to defaults if the config is absent or malformed. The `canon upgrade` command now detects first-time adopters (pre-split checker, no config yet), scaffolds the config, and prints a move-your-entries instruction before updating the checker on the next run — no JS parsing of the old file, no silent data loss. `canon init` scaffolds the config automatically for new adopters.

## Files Changed

- `scripts/docs-refs-check.mjs` — split adopter arrays into merged canon defaults + optional sibling config load; added `loadAdopterConfig` / `mergeAdopterConfig` helpers; preserved `VALID_DIRS` and `NOISY_SOURCE_PATHS` exports holding effective merged values. **Post-review hardening (Codex-reviewed):** `loadAdopterConfig` is now a thin pass-through with `mergeAdopterConfig` as the single per-key validator, so a partial config file (exporting only some of the three keys) is honored instead of dropped wholesale — closing the all-or-nothing path the code review flagged, which would otherwise have re-introduced the silent-drop bug class this task removes. Covered by a new "partial config file" test.
- `scripts/docs-refs-config.mjs` — **new** canon-ai-dev-owned config; re-adds `templates` to effective allow-lists (canon-ai-dev's own check still covers `templates/`)
- `templates/scripts/docs-refs-config.mjs` — **new** adopter scaffold with empty arrays and explanatory comments; scaffolded by `canon init`; not in `CANON_OWNED`
- `scripts/docs-refs-check.mjs.d.ts` — updated declarations: `AdopterConfig`, `loadAdopterConfig`, `mergeAdopterConfig`, explicit `VALID_DIRS` export
- `templates/scripts/docs-refs-check.mjs` — auto-synced mirror of updated root checker
- `templates/scripts/docs-refs-check.mjs.d.ts` — auto-synced mirror of updated root declaration
- `src/cli/commands/upgrade.ts` — safe cutover: pre-split repos get config scaffolded + checker deferred + move-your-entries message; `--check` reflects the plan; dirty-refusal / `--force` apply to scaffolded config write
- `tests/docs-refs-check.test.ts` — new loader/merge coverage: each array, absent config, malformed config (syntax error + wrong shape), export symbol shapes
- `tests/cli.test.ts` — new upgrade cutover coverage: pre-split → halt + scaffold, post-cutover → normal, `--check` plan, dirty-refusal / `--force`
- `docs/architecture.md` — adopter opt-in note and validation matrix updated to point at `scripts/docs-refs-config.mjs`
- `docs/codebase-map.md` — new row for the config file
- `dist/cli/index.js` — rebuilt bundle for the `upgrade` command changes

## How to Test

### Automated

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` (669 tests) | Pass |
| `npm run build` | Pass |
| `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |
| E2E | not_configured (CLI-only repo) |

### Manual (Human Test Plan)

If you have an adopter repo (e.g. Gallery Wall) running the old checker:

1. Add custom skip entries to the checker in the old format and commit.
2. Upgrade canon to this version and run `canon upgrade`.
3. **Expect:** canon reports it created `scripts/docs-refs-config.mjs` and did NOT update the checker yet. It prints a move-your-entries instruction.
4. Copy your custom entries from the old checker into the new `scripts/docs-refs-config.mjs`.
5. Run `canon upgrade` again. **Expect:** checker updates normally; your custom entries survive in the config.
6. Run `npm run docs-refs-check`. **Expect:** same behavior as before — custom skip entries honored.
7. Run `canon upgrade` again (any future upgrade). **Expect:** config file untouched; your entries survive forever.
8. On a fresh `canon init`. **Expect:** `scripts/docs-refs-config.mjs` scaffolded automatically with empty arrays and explanatory comments.

## Human Verification Required

None.

## Decisions Made

- **Safe-halt cutover over auto-extraction.** Parsing the adopter's JS array literals in `upgrade.ts` was rejected — it reproduced the exact silent-data-loss bug class it was meant to fix. The extra `canon upgrade` re-run at migration time is the accepted cost.
- **Additive union semantics (not override).** Adopter config entries supplement canon defaults rather than replace them, preventing an adopter from accidentally losing baseline coverage.
- **`templates` removed from canon defaults.** Adopter repos don't have `templates/` dirs; canon-ai-dev's own committed config re-adds it explicitly.
- **Module-init load with injectable test seam.** Config is loaded once at module init and merged before any `runChecks` call, keeping `runChecks` synchronous. The exported `loadAdopterConfig(path)` helper lets tests exercise absence and malformed-config paths against temp fixtures.

## Open Questions

None.

---

## Proposed Changelog

**Target section:** `[1.8.0] — unreleased`

**Proposed version bump:** No additional bump — this ships as part of the accumulating 1.8.0 release. Rationale: this is a minor addition + bug fix (no breaking change to the external API or any `canon` command contract).

```markdown
### Fixed

- **`canon upgrade` no longer silently drops adopter customizations to `docs-refs-check`.** The three adopter-tunable arrays lived in a canon-owned file that upgrade overwrites wholesale. Existing adopters get their checker left untouched, a new `scripts/docs-refs-config.mjs` scaffolded with defaults, and a printed instruction to move their custom entries before re-running upgrade. No silent data loss.

### Added

- **`scripts/docs-refs-config.mjs` — adopter-owned docs-refs config.** Exports optional `noisySourcePaths`, `validDirs`, and `markdownRootDirs` arrays merged (union) with canon defaults at startup. Degrades gracefully when absent or malformed. `canon init` scaffolds it automatically; `canon upgrade` never overwrites it.
```
