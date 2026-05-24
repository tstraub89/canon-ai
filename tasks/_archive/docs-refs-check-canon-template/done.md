# QA Summary: docs-refs-check-canon-template

> Task: Ship `docs-refs-check` as canon-shipped script + canon-ai CI gate
> QA by: Claude | Date: 2026-05-24

## What Changed

A new utility script, `scripts/docs-refs-check.mjs`, validates four classes of markdown reference drift across canon-ai-dev's docs:

1. **Backtick file-path refs** — `` `path/to/file.ts` `` where the path doesn't exist
2. **Symbol-in-file refs** — `` `SYMBOL` in `path/file.ts` `` where the file or symbol is missing
3. **Section refs** — `` `path.md` §"Heading Name" `` where the heading doesn't exist
4. **Markdown anchor links** — `[text](#anchor)` or `[text](path.md#anchor)` where the anchor doesn't resolve

The script is wired into canon-ai-dev's own CI in two places: a step in the existing `ci.yml` test job (covers code-touching PRs) and a new `docs-refs-check.yml` workflow (covers doc-only PRs that `ci.yml`'s path filters skip).

The script ships to adopters via `canon upgrade` (new `CANON_OWNED` entry). Adopters opt in by adding `npm run docs-refs-check` to their own workflow file — canon doesn't manage adopter workflow files.

Six pre-existing stale refs were surfaced by the gate's first run and fixed in this same PR by rewriting the stale path citations as prose guidance.

## Files Changed

| File | Change |
|---|---|
| `scripts/docs-refs-check.mjs` | NEW. ~310 LOC validator with attribution header, `VALID_DIRS`, four ref-class checks, and `file:line: ref — reason` error format. |
| `templates/scripts/docs-refs-check.mjs` | NEW. Byte-identical mirror so `canon upgrade` can resolve the `CANON_OWNED` lookup. |
| `scripts/docs-refs-check.mjs.d.ts` | NEW. Ambient type declaration for the ESM module (keeps lint/type-check clean). |
| `tests/docs-refs-check.test.ts` | NEW. Covers all four ref classes (positive + negative) and exit-code semantics using `fs.mkdtempSync` fixtures. |
| `package.json` | Adds `"docs-refs-check"` npm script; expands `"files"` to include `"scripts/"`. |
| `src/cli/commands/upgrade.ts` | Adds `'scripts/docs-refs-check.mjs'` to `CANON_OWNED` with the first-script-outside-canon-dirs comment. |
| `dist/cli/index.js` | Regenerated to reflect the `upgrade.ts` change. |
| `.github/workflows/ci.yml` | Adds `npm run docs-refs-check` step between type-check and test. |
| `.github/workflows/docs-refs-check.yml` | NEW. Runs only `npm ci` + `npm run docs-refs-check` on doc-only PRs. |
| `docs/architecture.md` | Adds validation row + adopter CI opt-in paragraph. |
| `AGENTS.md` | Adds validation-matrix row for the new "Docs references" category. |
| `docs/codebase-map.md` | Adds entry pointing at `scripts/docs-refs-check.mjs`. |
| `CHANGELOG.md` | Adds the 1.4.0 release note (AC-16). |
| `CLAUDE.md` | Stale ref cleanup — PR-template note rewritten to prose. |
| `docs/decisions.md` | Stale ref cleanup — retired `runtime_validation` path citations rewritten. |
| `docs/lessons-learned.md` | Stale ref cleanup — stale helper-path citation rewritten. |
| `docs/pipeline-orchestrator.md` | Stale ref cleanup — post-merge hook note rewritten to prose. |
| `README.md` | Stale ref cleanup — local-settings guidance rewritten to prose. |

## How to Test

1. From `release/v1.4` with this task merged, run `npm run docs-refs-check` from the repo root. Expected: exits 0 and prints `All refs OK`.

2. Temporarily edit any high-density doc (e.g., `docs/codebase-map.md`) to add `` `scripts/nonexistent-file.ts` ``. Run `npm run docs-refs-check`. Expected: non-zero exit; one line to stderr with `file:line: ref — reason`. Revert the edit.

3. Open a draft PR that touches only `docs/` or `AGENTS.md` (no `src/`, no `tests/`) with a deliberate stale ref. Confirm the new `docs-refs-check.yml` workflow runs and fails. Revert and confirm the workflow passes.

4. Run `npm pack --dry-run` and verify `scripts/docs-refs-check.mjs` appears in the package file list.

5. In a downstream test repo, run `canon upgrade` and verify `scripts/docs-refs-check.mjs` lands at `<repo>/scripts/docs-refs-check.mjs`.

## Test Results

All automated checks passed:

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` (419 tests, including new `docs-refs-check` suite) | Pass |
| `npm run docs-refs-check` (against canon-ai-dev's own docs) | Pass — `All refs OK` after stale-ref cleanup |
| `npm run build` + `git diff --exit-code -- dist/` | Pass |

Human test steps 1–5 above are pending at human_review.

## Decisions Made

- **Skips `docs/BACKLOG.md`, `templates/`, and `tasks/*/{spec,plan}.md`**: These surfaces are dominated by scaffolding and template placeholders; scanning them produces expected false positives. Live docs are covered; template stubs are not.
- **Added `scripts/docs-refs-check.mjs.d.ts`**: An ambient type declaration was needed for the ESM module import to be lint- and type-check-clean without suppressions. It ships in `scripts/` because that directory is intentionally in the npm tarball after the `files` expansion.
- **Pre-existing stale refs converted to prose rather than added to an allowlist**: The validator has no allowlist mechanism for "intentionally broken" refs. The correct pattern is prose guidance rather than path citations when the target doesn't exist or has been intentionally retired.
- **Two-workflow CI approach**: `ci.yml` skips doc-only PRs by design (cheap CI); `docs-refs-check.yml` fills the gap. The two workflows together cover the union of PR surfaces with no overlap.

## Open Questions

None. All 17 ACs are met. The parked `worktree-canonical-task-state` task will run through this gate once unparked — if that refactor introduces stale refs in protected docs, the gate will catch them at CI.

---

## Proposed Changelog

The CHANGELOG.md entry was added as part of AC-16 in the same task diff. The wording, already in `[1.4.0] Added`:

> **`docs-refs-check` script + CI gate.** New utility script at `scripts/docs-refs-check.mjs` validates markdown ref hygiene (broken file paths, symbol-in-file refs, section refs, anchor links). Wired into canon-ai's own CI between type-check and test. Ships to adopters via `canon upgrade`; adopters opt in by adding `npm run docs-refs-check` to their own workflow. Originally written by tstraub89/gallery_wall; adapted with attribution.

**Proposed version bump**: no new bump needed — this task targets `[1.4.0]` which is already unreleased. The entry above already lands in the existing `1.4.0` block.

Human should verify the wording before the release ships.
