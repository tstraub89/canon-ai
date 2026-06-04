# Implementation Plan: pr-body-completeness-guards

> Written by: Claude | Implements: `tasks/pr-body-completeness-guards/spec.md`

## Step 1 — P2: doctor validates `pr-body.md` (AC-1)

File: `src/cli/commands/doctor.ts` (`EXPECTED_TEMPLATES`, line ~20).

Add `'pr-body.md'` to the `EXPECTED_TEMPLATES` array. No other change to `checkTemplates` — it already filters `EXPECTED_TEMPLATES` against `.canon/templates/` and returns a `warn` listing the missing files, so adding the entry makes a missing `pr-body.md` surface in that warning automatically.

## Step 2 — P3: `isPrBodyTemplate` treats blank content as unfilled (AC-3)

File: `scripts/run-task/validation.ts` (`isPrBodyTemplate`, line ~661).

After the `readFileSync` (which already returns `true` on read error), add: if `content.trim() === ''` return `true`. Then the existing `PR_BODY_TEMPLATE_SENTINELS.some(...)` check runs for non-blank content. Net effect: empty/whitespace-only → `true` (treated as unfilled → `resolveQaPrBody` falls back); filled non-sentinel body → `false` (used); sentinel stub → `true`; missing file → `true` (unchanged).

## Step 3 — Tests

`tests/cli.test.ts` (doctor tests live here):
- **AC-1**: `checkTemplates` against a temp `.canon/templates/` with `pr-body.md` removed → `status: 'warn'`, detail contains `pr-body.md`; with all present → `status: 'pass'`.
- **AC-2 (drift guard)**: import `CANON_OWNED` from `src/lib/canon-owned.ts`; derive the `.canon/templates/` basenames from it (filter entries starting with `.canon/templates/`, take `path.basename`); assert each is in `EXPECTED_TEMPLATES`. Do **not** hardcode the template list. This fails if a future canon-owned template is added without updating `EXPECTED_TEMPLATES`.

`tests/run-task-validation.test.ts`:
- **AC-3**: `isPrBodyTemplate` on temp files — empty `''` → `true`; whitespace-only `'  \n\t'` → `true`; real filled body (non-blank, no sentinel) → `false`; sentinel-bearing stub → `true`; nonexistent path → `true`.
- **AC-4**: `resolveQaPrBody([taskId], cwd)` with a single task whose `tasks/<id>/pr-body.md` is blank → `{ kind: 'fallback', ... }` (not `body-file`). (Bundle path already returns fallback before the predicate — no test needed there per Known Risks.)

Match the existing describe/it style and temp-dir helpers in each test file.

## Step 4 — Validate + rebuild dist

- `npm run lint`
- `npm run type-check`
- `npm test` (new tests + full suite green)
- `npm run build` — commit the rebuilt `dist/`. `doctor.ts` → `dist/cli/index.js`; `validation.ts` → `dist/scripts/run-task.js` (and the build may also touch `dist/cli/index.js` via shared chunks — commit whatever changes). Confirm `git diff --stat -- dist/` shows only expected bundle changes, then `git diff --exit-code -- dist/` is clean after commit.

## Notes

- Both `dist/cli/index.js` and `dist/scripts/run-task.js` are declared in Affected Files for the `--pr` base-drift gate; commit whichever the build actually changes.
- No changes to `resolveQaPrBody`'s structure, the sentinel list, the `--pr` resolution order, or QA's authoring step (Non-Goals).
