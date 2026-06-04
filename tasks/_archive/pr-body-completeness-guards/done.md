# Completion Summary: pr-body-completeness-guards — canon doctor validates pr-body.md template + reject blank pr-body.md before use

> For the human. This is what you need to know.

## What Changed

Two graceful-degradation gaps in the 1.9.0 `qa-drafts-pr-body` feature are fixed before the release cuts.

**`canon doctor` now validates the `pr-body.md` scaffold template.** `EXPECTED_TEMPLATES` in `src/cli/commands/doctor.ts` now includes `'pr-body.md'`. On a stale install missing `.canon/templates/pr-body.md`, `canon doctor` emits a warning naming the file — it previously passed silently, causing `canon task new` to omit the scaffold and the problem to surface only when `--pr` ran. A drift guard (new test) derives the expected set from `CANON_OWNED` and asserts every `.canon/templates/` entry appears in `EXPECTED_TEMPLATES`, so a future template addition that misses the doctor list fails CI immediately.

**Blank `pr-body.md` now falls back instead of opening an empty PR body.** `isPrBodyTemplate()` in `scripts/run-task/validation.ts` returns `true` when content is empty or whitespace-only. A truncated or partially-failed QA write that produces a blank file previously passed the predicate as a "real body" and `--pr` would open a PR with an empty description. It now falls back to the repo template the same way a stub or missing file does.

## Files Changed

- `src/cli/commands/doctor.ts` — added and exported `'pr-body.md'` in `EXPECTED_TEMPLATES`
- `scripts/run-task/validation.ts` — `isPrBodyTemplate()` returns `true` for empty/whitespace-only content
- `tests/cli.test.ts` — missing `pr-body.md` warn test + all-templates pass test + `CANON_OWNED`-derived drift guard
- `tests/run-task-validation.test.ts` — blank/whitespace `isPrBodyTemplate()` unit tests + `resolveQaPrBody` blank-file fallback end-to-end test
- `dist/cli/index.js` — rebuilt (carries updated `EXPECTED_TEMPLATES` into CLI bundle)
- `dist/scripts/run-task.js` — rebuilt (carries blank-body guard into task runner bundle)

## How to Test

1. On a repo missing `.canon/templates/pr-body.md`, run `canon doctor` → it now warns that `pr-body.md` is missing. Before this fix it passed silently.
2. Create a task, blank out its `tasks/<id>/pr-body.md` (empty file), run `canon run <id> --pr` → the PR opens using the fallback (repo template / `--fill`), not with an empty body.
3. Normal case unchanged: a task with a properly authored `pr-body.md` still uses it for `--pr`.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | All new coverage passes; full suite clean |
| `npm run build` | Pass | Rebuilt both `dist/` artifacts; postbuild normalized 1 file |
| `npm run sync-templates:check` | not_configured | No canon-owned template files changed |
| E2E | not_configured | Spec marked N/A |

## Human Verification Required

None.

## Decisions Made

- `EXPECTED_TEMPLATES` is now exported so the drift-guard test can import it rather than duplicate the list — exporting one half of the invariant is simpler than embedding both halves in the test.
- "Blank" is defined as `content.trim() === ''`. A file with only newlines or spaces counts as blank, consistent with the existing stub-sentinel approach.
- Bundle `resolveQaPrBody` behavior is explicitly unchanged — the bundle fallback returns before `isPrBodyTemplate` is ever called, so the blank-content guard only affects single-task runs.

## Open Questions

None.

## Proposed Changelog

Entries belong in the **1.9.0 Fixed** section (same release; both gaps are in the `qa-drafts-pr-body` feature shipping in that version). No version bump — add to the existing 1.9.0 Fixed block.

```markdown
- **`canon doctor` now warns when the `pr-body.md` scaffold template is missing.** Stale installs missing `.canon/templates/pr-body.md` passed `canon doctor` silently, causing `canon task new` to omit the pr-body scaffold. A drift guard ties the doctor template list to `CANON_OWNED` so future template additions cannot silently skip the check.
- **A blank `pr-body.md` no longer opens a PR with an empty body.** A truncated or partially-failed QA write produces an empty file; `--pr` now treats it as unfilled and falls back to the repo PR template, the same way a missing or stub file does.
```
