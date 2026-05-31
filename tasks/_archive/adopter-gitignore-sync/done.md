# QA Summary: adopter-gitignore-sync

## What Changed

Canon now manages a small, clearly-marked block in adopter `.gitignore` files containing the three runtime-only patterns that the orchestrator writes during a run (`tasks/**/.canon-pid`, `tasks/**/.canon-run.log`, `tasks/**/.heartbeat.json`). Previously these were hand-added in canon-ai-dev's own `.gitignore` with no mechanism to propagate them to adopters, so adopters saw those files as untracked noise.

**How it works:** Canon owns only a `# canon:start` / `# canon:end` block. Everything outside the block in an adopter's `.gitignore` is preserved verbatim and never touched.

**New module — `src/lib/canon-block.ts`:** Exports the `CANON_GITIGNORE_BLOCK` constant (the single source of truth for the block content) and two pure helpers: `upsertCanonBlock` (appends the block if absent, replaces the existing canon block if present, returns `null` for a malformed block so callers can warn-and-skip) and `extractCanonBlock` (locates the block for the self-hosting guard test).

**`canon init`:** After scaffolding templates, explicitly upserts `.gitignore`. Creates the file if absent; appends the canon block if no block exists; replaces an existing block if the content has drifted. Idempotent. On a malformed block, logs a warning and continues without aborting template scaffolding.

**`canon upgrade`:** Adds `.gitignore` refresh through the existing `pending` write queue, so it inherits dirty-refusal, `--check`, `--force`, and `--no-stage` uniformly with all other managed files. A dirty `.gitignore` now blocks the whole upgrade op set (matching existing managed-file behavior, recoverable via `--force` or committing first). A malformed canon block is reported and not overridden by `--force`.

**`canon doctor`:** New warn-level `checkRuntimeFilesGitignored` check. Warns if `.gitignore` is absent or any of the three runtime patterns are missing, names which patterns are missing, and points adopters to `canon upgrade` as the fix.

**Templates and sync:** `templates/.gitignore` is a new block-only adopter template derived from the `CANON_GITIGNORE_BLOCK` constant. `scripts/sync-canon-templates.mjs` verifies and rewrites it directly against the constant without using `mergeDelimitedForSync` (HTML-marker-only) and without adding `.gitignore` to `DELIMITED_SYNC`.

**Self-hosting:** canon-ai-dev's own root `.gitignore` was restructured to wrap the three runtime patterns inside the same `# canon:start`/`# canon:end` block, removing the previous standalone comment+patterns so each pattern appears exactly once.

## Files Changed

| File | What Changed |
|---|---|
| `src/lib/canon-block.ts` (new) | Block constant, `upsertCanonBlock`, `extractCanonBlock` |
| `src/cli/commands/init.ts` | Explicit `.gitignore` upsert after template scaffold |
| `src/cli/commands/upgrade.ts` | `.gitignore` refresh via pending queue; malformed reporting |
| `src/cli/commands/doctor.ts` | `checkRuntimeFilesGitignored` warn check |
| `templates/.gitignore` (new) | Block-only adopter template |
| `.gitignore` | Runtime patterns moved into canon block; standalone entries removed |
| `scripts/sync-canon-templates.mjs` | Constant-sourced `.gitignore` drift detection / apply |
| `tests/cli.test.ts` | Unit tests for helper, doctor, upgrade, and self-hosting guard |
| `tests/sync-canon-templates.test.ts` | Fixture seed + sync path tests |
| `dist/cli/index.js` | Rebuilt from source |
| `docs/codebase-map.md` | Pointer to gitignore-management surface; adopter-facing upgrade note |

## Test Results

| Check | Result |
|---|---|
| Linting — `npm run lint` | Pass |
| Type checking — `npm run type-check` | Pass |
| Unit tests — `npm test` (659 pass, 1 skipped, 0 fail) | Pass |
| Build — `npm run build` | Pass |
| Docs references — `npm run docs-refs-check` | Pass |
| Template sync — `npm run sync-templates:check` | Pass |
| E2E | not_configured (no UI; N/A per spec) |

## Human Verification Required

None.

## Human Test Plan

The following CLI integration steps verify end-to-end behavior and are recommended before closing the PR:

1. **Fresh adopter, no `.gitignore`:** in a scratch repo, run `canon init`. Confirm a `.gitignore` is created with the canon block containing the three `tasks/**/…` runtime patterns and `# canon:start`/`# canon:end` markers.
2. **Fresh adopter, existing `.gitignore`:** in a scratch repo whose `.gitignore` already has `node_modules` / `.env`, run `canon init`. Confirm those entries are untouched and the canon block is appended at the end.
3. **Idempotency:** run `canon init` again. Confirm no second canon block is added.
4. **Existing adopter retrofit:** in a repo with canon installed but lacking the block, run `canon upgrade`. Confirm the block is added (reported as upgraded) and existing `.gitignore` entries are preserved.
5. **Upgrade dirty-refusal:** make an uncommitted edit to `.gitignore`, run `canon upgrade` without `--force`. Confirm it refuses. Re-run with `--force` and confirm the block is written.
6. **`--check` mode:** on a repo missing the block, run `canon upgrade --check`. Confirm it reports the file *would* be upgraded without writing anything.
7. **Doctor:** on a repo missing the patterns, run `canon doctor`. Confirm a warn-level line names the missing patterns and suggests `canon upgrade`. Add the block and re-run; confirm the check passes.
8. **Real runtime files stay ignored:** run `canon run <id>` in an adopter with the block. Confirm `git status` does not show `tasks/<id>/.canon-pid`, `.canon-run.log`, or `.heartbeat.json`.

## Decisions Made

- **Isolated `upsertCanonBlock` helper, not a generalization of `mergeDelimited`:** `mergeDelimited` only updates existing blocks and returns `null` when no block is present — fine for managed docs that `canon init` always scaffolds with a block, but wrong for `.gitignore` which exists in every adopter repo without one. The isolated helper sidesteps the INSERT problem without touching the managed-doc path.
- **`.gitignore` NOT added to `DELIMITED` or `CANON_OWNED`:** both arrays feed `runUpgrade`'s DELIMITED loop, which calls `mergeDelimited` — incompatible with the block-absent case. `.gitignore` has its own dedicated step in `runUpgrade`.
- **Constant-source model for template sync:** `templates/.gitignore` is verified against the in-code constant, not by reading root `.gitignore`. This avoids INSERT-vs-UPDATE asymmetry.
- **Malformed block is an absolute stop, even under `--force`:** `--force` overrides dirty-file refusal; it does not override a malformed canon block. An unclosed `# canon:start` cannot be auto-repaired without risking adopter content loss.
- **Block placement: append-at-end** — least intrusive to adopter structure; canon does not reorganize existing content.
- **AC-14 reads active checkout root, not `REPO_ROOT`:** In linked worktree runs, `REPO_ROOT` resolves to the supervising checkout. The test reads the worktree's own root, which equals `REPO_ROOT` in a normal checkout and is correct in worktree runs.

## Open Questions

None. All 14 ACs met; no deferred or unresolved design questions.

---

## Proposed Changelog

**Target version:** v1.8.0 (already open; add to `### Added` block)

**Proposed entry under `## [1.8.0] — unreleased` → `### Added`:**

> - **Canon manages runtime-file `.gitignore` patterns across `init`, `upgrade`, and `doctor`.** `canon init` now ensures adopter `.gitignore` contains a canon-owned `# canon:start`/`# canon:end` block with the three orchestrator runtime patterns (`tasks/**/.canon-pid`, `tasks/**/.canon-run.log`, `tasks/**/.heartbeat.json`). `canon upgrade` retrofits and refreshes the block on existing adopters (routes through the dirty-refusal queue; a malformed block is reported and never auto-repaired even under `--force`). `canon doctor` warns when the patterns are absent and names the fix. Adopter content outside the canon block is never touched.

**Rationale:** New capability for all adopters; no breaking changes. Minor bump already open at v1.8.0.
