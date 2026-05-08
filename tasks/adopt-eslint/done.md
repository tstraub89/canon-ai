# QA Summary: adopt-eslint

**Task**: Adopt ESLint with typescript-eslint recommendedTypeChecked
**Date**: 2026-05-08
**Status**: Approved — ship as-is

---

## What Changed

ESLint is now wired into the repo as a mandatory validation gate. The implementation adds `eslint` and `typescript-eslint` as devDependencies, creates `eslint.config.mjs` at the root using the `recommendedTypeChecked` rule set with `projectService: true` for type-aware linting, and registers a `lint` script in `package.json`. All 48 pre-existing violations were fixed in code — no suppressions.

**Violations fixed:**
- `tests/pipeline-policy.test.ts`, `tests/run-task-parse-porcelain.test.ts`, `tests/run-task-validation.test.ts` — 41 `no-floating-promises` violations: every top-level `test()` / `it()` registration call prefixed with `void`. Nested test registrations were left untouched.
- `scripts/run-task.ts` — 7 violations: `JSON.parse` calls cast with `as typeof event`, two redundant `as object` casts removed, and `_PHASE_STATUS_VALUES` / `_VERDICT_VALUES` renamed with `_` prefix with their `typeof` references updated atomically.

Documentation updated: `docs/architecture.md` Validation table linting row replaced from "N/A" with `npm run lint`; `docs/codebase-map.md` configuration table gained an `eslint.config.mjs` entry.

## Files Changed

- `package.json` — added `eslint` + `typescript-eslint` devDependencies; added `lint` script
- `package-lock.json` — updated lock
- `eslint.config.mjs` — new flat config with `recommendedTypeChecked` and `projectService: true`
- `scripts/run-task.ts` — 7 lint fixes + `isPhaseStatus`/`isVerdict` runtime guards (see Decisions)
- `tests/pipeline-policy.test.ts` — `void` on all top-level `test()` registrations
- `tests/run-task-parse-porcelain.test.ts` — `void` on all top-level `test()` registrations
- `tests/run-task-validation.test.ts` — `void` on all top-level `test()` registrations
- `docs/architecture.md` — Validation table linting row rewritten
- `docs/codebase-map.md` — `eslint.config.mjs` row added to configuration table

## How to Test

1. Run `npm run lint` — should complete with no errors.
2. Run `npm test` — all 66 tests should pass.
3. Run `npm run type-check` — should pass.
4. Introduce a deliberate lint violation in any file (e.g., add an unused variable), run `npm run lint`, confirm it reports an error, then revert.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass — exits 0, no errors or warnings |
| `npm run type-check` | Pass — exits 0 |
| `npm test` | Pass — 66 tests, 0 failures |
| Build | N/A — no build step |
| E2E | N/A — no UI surface |

All three checks verified locally during code review.

## Decisions Made

**Codex added `isPhaseStatus()` / `isVerdict()` runtime guards** — a documented deviation from the spec's exact fix prescription. The `_` prefix convention suppresses `no-unused-vars` for variables with runtime use, but ESLint still flags a variable that appears only in type positions (e.g., `typeof _PHASE_STATUS_VALUES`). Codex resolved this by also using the const arrays at runtime inside narrow type-guard functions. This simultaneously eliminates the lint error and hardens the code against malformed `status.json` values — the guards now reject unexpected strings rather than passing them through. Reviewed and accepted as a strict improvement with no AC impact.

## Open Questions

None. The spec explicitly defers CI wiring to the `add-ci` task (currently in spec_review).

---

## Proposed Changelog

**Proposed version bump**: `0.1.0 → 0.2.0` (minor)

**Rationale**: New feature — establishes `npm run lint` as a required validation gate. Per `docs/decisions.md`, a "new validation gate" is a minor bump. No breaking changes; adopters gain a new script and config file, existing workflows unaffected.

**Draft entry** (human finalizes copy; changelog + version-bump commit lands separately from code):

```markdown
## [0.2.0] — 2026-05-08

### Added

- ESLint with `@typescript-eslint/recommendedTypeChecked` is now the repo's lint gate. Run `npm run lint` (= `eslint scripts/ tests/`) — required for all changes. Config lives in `eslint.config.mjs`. All 48 pre-existing violations were fixed in code; the lint command exits clean from a standing start.
```
