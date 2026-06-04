# Spec: pr-body-completeness-guards — canon doctor validates pr-body.md template + reject blank pr-body.md before use

> Written by: Claude | Review by: Codex (fast-tier: spec_review auto-approves; human approved spec conversationally)
> Status: draft

## Problem

The qa-drafts-pr-body feature (PR #130, landing in 1.9.0) added `.canon/templates/pr-body.md` to `CANON_OWNED` and made `--pr` resolve `tasks/<id>/pr-body.md`. Local Codex review of the 1.9.0 release diff (#132) found two gaps in that new code:

- **P2 — `canon doctor` doesn't validate the new template.** `checkTemplates` (`src/cli/commands/doctor.ts`) only checks `EXPECTED_TEMPLATES`, which is `spec.md, plan.md, handoff.md, review.md, done.md, spec-review.md, notes.md, status.json` — `pr-body.md` is missing. A stale install lacking `.canon/templates/pr-body.md` passes `canon doctor`, so `canon task new` silently omits the pr-body scaffold and the problem only surfaces later when `--pr` falls back. The list also has no guard against future drift from the canon-owned template set.

- **P3 — a blank `pr-body.md` is treated as a real body.** `isPrBodyTemplate` (`scripts/run-task/validation.ts`) returns `true` only when the content includes a known stub sentinel (or the read throws). An empty or whitespace-only file reads as `''`, matches no sentinel → returns `false` → `resolveQaPrBody` returns `{ kind: 'body-file' }` and `--pr` passes it to `gh pr create --body-file`, opening the PR with an **empty body** instead of falling back. A truncated or partially-failed QA write produces exactly this.

Both are graceful-degradation gaps in a feature debuting in 1.9.0; fixing before the cut means they never reach adopters.

## Decision

- **P2:** Add `'pr-body.md'` to `EXPECTED_TEMPLATES` so `checkTemplates` warns when the scaffold template is missing. Add a **drift-guard test** asserting `EXPECTED_TEMPLATES` covers every canon-owned `.canon/templates/` entry (the source of truth in `src/lib/canon-owned.ts`), so a future template addition can't silently skip the doctor check again.
- **P3:** `isPrBodyTemplate` treats empty or whitespace-only content as "template/unfilled" (return `true`), so a blank `pr-body.md` falls back at `--pr` instead of producing an empty PR body. Keep the existing sentinel and read-error behavior unchanged.

Mechanics deferred to implementation; the contracts above are what matter.

## Non-Goals

- Not changing the `--pr` body resolution order, the sentinel list, or the bundle-mode fallback.
- Not changing `resolveQaPrBody`'s shape — only the predicate it depends on (`isPrBodyTemplate`) gets the blank-content guard.
- Not adding `pr-body.md` content validation beyond "non-blank" (e.g. no template-completeness parsing of the body itself).
- No changes to QA's pr-body authoring step.

## Acceptance Criteria

- [ ] **AC-1 — `canon doctor` flags a missing `pr-body.md` template.** `EXPECTED_TEMPLATES` includes `'pr-body.md'`; with `.canon/templates/pr-body.md` absent, `checkTemplates` returns a `warn` naming `pr-body.md` (matching the existing missing-template behavior). *Verify:* a `checkTemplates` test with `pr-body.md` removed asserts `status: 'warn'` and that the detail names `pr-body.md`; with all templates present, `status: 'pass'`.
- [ ] **AC-2 — Drift guard: `EXPECTED_TEMPLATES` covers the canon-owned template set, derived from `CANON_OWNED`.** A test **derives** the canon-owned `.canon/templates/` basenames from the `CANON_OWNED` array in `src/lib/canon-owned.ts` (the single source of truth) and asserts each appears in `EXPECTED_TEMPLATES`. The test **must not** hardcode a second list of template names — hardcoding re-introduces the very drift this guard exists to close. *Verify:* the test imports/derives from `CANON_OWNED`, and fails if a canon-owned `.canon/templates/` entry is added without updating `EXPECTED_TEMPLATES` (it would have caught this P2). If `CANON_OWNED` is not cleanly importable into the test, derive the set by reading the array's `.canon/templates/` entries at test time rather than restating them.
- [ ] **AC-3 — Blank `pr-body.md` is treated as unfilled (falls back).** `isPrBodyTemplate` returns `true` for an empty file and for a whitespace-only file. *Verify:* unit tests for empty (`''`) and whitespace-only (`'  \n\t'`) content return `true`; a real filled body (no sentinel, non-blank) still returns `false`; a sentinel-bearing stub still returns `true`; a missing file still returns `true` (read-error path unchanged).
- [ ] **AC-4 — `resolveQaPrBody` falls back on a blank file end-to-end.** With a single task whose `pr-body.md` is empty/whitespace-only, `resolveQaPrBody` returns `{ kind: 'fallback', ... }`, not `{ kind: 'body-file' }`. *Verify:* a `resolveQaPrBody` test with a blank `pr-body.md` asserts the fallback resolution (reason may be the stub-template reason).

## Design

### Affected Files

| File | Change |
|---|---|
| `src/cli/commands/doctor.ts` | Add `'pr-body.md'` to `EXPECTED_TEMPLATES` (AC-1). |
| `scripts/run-task/validation.ts` | `isPrBodyTemplate`: after reading, return `true` when `content.trim() === ''` (blank → unfilled), before the sentinel check; sentinel/read-error paths unchanged (AC-3). |
| `tests/cli.test.ts` | `checkTemplates` missing-`pr-body.md` warn test (AC-1) + drift-guard test asserting `EXPECTED_TEMPLATES` ⊇ canon-owned `.canon/templates/` set (AC-2). |
| `tests/run-task-validation.test.ts` | `isPrBodyTemplate` blank-content tests + unchanged-path assertions (AC-3); `resolveQaPrBody` blank-file fallback test (AC-4). |
| `dist/cli/index.js` | Regenerated by `npm run build` — the `doctor.ts` (`EXPECTED_TEMPLATES`) change bundles into the CLI entry, so this rebuilds. Declared for the `--pr` base-drift gate. (`validation.ts` itself bundles into `dist/scripts/run-task.js`; commit whatever `dist/` files the build actually touches — both are declared so either is accepted.) |
| `dist/scripts/run-task.js` | Regenerated by `npm run build` — `validation.ts` bundles into it. Declared for the `--pr` base-drift gate. |

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm test` — new tests + full suite
- [x] `npm run type-check`
- [x] `npm run build` — rebuild + commit `dist/` (both `dist/cli/index.js` and `dist/scripts/run-task.js`); CI's `git diff --exit-code -- dist/` must stay clean
- [ ] `npm run sync-templates:check` — N/A (no canon-owned doc/skill/template content changed; `EXPECTED_TEMPLATES` is source, not a template file)
- [ ] E2E — N/A

## Known Risks

- **Drift-guard test coupling**: AC-2 reads the canon-owned template set from `CANON_OWNED`. The test must derive the `.canon/templates/` basenames from that array (single source of truth), not hardcode a second list — otherwise it just moves the drift problem. If `CANON_OWNED` isn't cleanly importable from the test, assert the inverse (every `EXPECTED_TEMPLATES` entry is canon-owned) plus an explicit `pr-body.md ∈ EXPECTED_TEMPLATES` assertion.
- **Whitespace definition**: "blank" = `content.trim() === ''`. A file with only a newline or spaces must count as blank. AC-3 pins this.
- **Bundle path is unaffected by the P3 fix**: `resolveQaPrBody` returns the bundle fallback at its `taskIds.length !== 1` early return *before* it ever calls `isPrBodyTemplate`, so the blank-content guard changes only the single-task path. No bundle behavior rides along (AC-4 covers single-task; bundle is structurally out of reach of the predicate).
- **Low blast radius**: two ~1-line predicate/list changes + tests. `isPrBodyTemplate` only gates `--pr` body selection (already a fallback-rich path); `EXPECTED_TEMPLATES` only affects a doctor warning. No core pipeline path changes.

## Human Test Plan

1. On a repo missing `.canon/templates/pr-body.md`, run `canon doctor` → it now warns that `pr-body.md` is missing (before this fix it passed silently).
2. Create a task, blank out its `tasks/<id>/pr-body.md` (empty file), run `--pr` → the PR opens using the fallback (repo template / `--fill`), not with an empty body.
3. Normal case unchanged: a task with a properly authored `pr-body.md` still uses it for `--pr`.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it
- [x] Affected Files lists specific files with specific change descriptions (incl. both `dist/` artifacts)
- [x] Plan steps reference actual symbols — `EXPECTED_TEMPLATES` / `checkTemplates` / `isPrBodyTemplate` / `resolveQaPrBody` / `CANON_OWNED`
- [x] Known Risks covers the trickiest parts (drift-guard single-source, whitespace definition)
- [x] Human Test Plan uses product/behavior language
- [x] Validation Required entries marked `- [x]` (incl. dist rebuild)
