# Spec: Adopt ESLint with typescript-eslint recommendedTypeChecked

**Task ID**: adopt-eslint
**Size**: M
**Delicate**: false

> Written by: Claude | Review by: Codex

---

## Problem

Linting is listed as N/A in `docs/architecture.md`. The codebase has no automated style or correctness enforcement beyond `tsc --strict`. Running `@typescript-eslint/recommendedTypeChecked` against the current source surfaces 48 violations that `tsc --strict` misses — mostly unhandled promise registrations in test files and minor type-safety gaps in `run-task.ts`. Adopting ESLint closes this gap and establishes a lint gate for all future code.

---

## Decision

1. **Install `eslint` and `typescript-eslint`** as devDependencies.
2. **Create `eslint.config.mjs`** at the repo root with the `@typescript-eslint/recommendedTypeChecked` rule set and `projectService: true` for type-aware linting.
3. **Add `"lint": "eslint scripts/ tests/"` to `package.json` scripts.**
4. **Fix all 48 existing violations** so `npm run lint` exits clean. Fixes are described in detail below — Codex must follow this guidance exactly and not substitute different fixes.
5. **Update `docs/architecture.md`** Validation table — rewrite the entire Linting row. The current cell reads "N/A — no linter currently configured. `tsc --strict` catches most of what a linter would. Adding one is a future task." Replace the whole cell with: `` `npm run lint` (= `eslint scripts/ tests/`) — required for all changes ``.
6. **Update `docs/codebase-map.md`** Configuration table — add `eslint.config.mjs`.

### `eslint.config.mjs` shape

```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/'] },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
);
```

### Violation fixes — `scripts/run-task.ts` (7 violations)

**Lines 40–41 — `@typescript-eslint/no-unused-vars`**

`PHASE_STATUS_VALUES` and `VERDICT_VALUES` are `as const` arrays declared only to derive union types. They have no runtime use and ESLint flags them as unused. Fix: add a `_` prefix to both names (`_PHASE_STATUS_VALUES`, `_VERDICT_VALUES`) — `@typescript-eslint/no-unused-vars` ignores underscore-prefixed names by convention. Do not delete them; the derived types depend on them.

```ts
// before
const PHASE_STATUS_VALUES = [...] as const;
const VERDICT_VALUES = [...] as const;

// after
const _PHASE_STATUS_VALUES = [...] as const;
const _VERDICT_VALUES = [...] as const;
```

Update the `typeof` references on the lines immediately below to use the new names.

**Lines 2070, 2216 — `@typescript-eslint/no-unsafe-assignment`**

Both are `JSON.parse(line)` results assigned into typed variables. `JSON.parse` returns `any`; the assignment is flagged. Fix: add an explicit cast on the `JSON.parse` call itself.

```ts
// before
try { event = JSON.parse(line); } catch { return; }

// after
try { event = JSON.parse(line) as typeof event; } catch { return; }
```

Apply to both occurrences (the two separate `onLine` function bodies).

**Lines 2217 — `@typescript-eslint/no-unnecessary-type-assertion`**

`formatLiveTick(event as Record<string, unknown>)` — by this point `event` is already typed as `Record<string, unknown>` (or equivalent). Remove the `as` cast; pass `event` directly.

**Lines 2998 ×2 — `@typescript-eslint/no-unnecessary-type-assertion`**

```ts
'url' in (value as object) && 'section' in (value as object)
```

The `typeof value === 'object'` check on the same line narrows `value` to `object`. TypeScript has already done the narrowing; the casts are redundant. Remove both:

```ts
'url' in value && 'section' in value
```

### Violation fixes — test files (41 violations, all `@typescript-eslint/no-floating-promises`)

All violations are top-level `test(...)` and `it(...)` calls in `node:test` test suites. The `node:test` runner collects test registrations without the caller awaiting them; the returned Promises are intentionally unhandled by the test file. Fix: prefix every top-level `test(...)` and `it(...)` call with `void`.

Files affected:
- `tests/pipeline-policy.test.ts` (11 violations)
- `tests/run-task-parse-porcelain.test.ts` (~19 violations — verify exact count)
- `tests/run-task-validation.test.ts` (11 violations)

Pattern:
```ts
// before
test('description', () => { ... });
it('description', async () => { ... });

// after
void test('description', () => { ... });
void it('description', async () => { ... });
```

Apply to every `test(` / `it(` call at the top level of each test file. Do not add `void` inside test callback bodies — only to the outer `test()`/`it()` registration calls.

---

## Non-Goals

- Fixing lint violations by suppressing rules with `eslint-disable` comments (except where explicitly instructed above). Every violation must be fixed in code.
- Adding lint rules beyond `@typescript-eslint/recommendedTypeChecked`.
- Configuring auto-fix in CI or as a pre-commit hook.
- Wiring lint into the CI workflow — that is handled by the `add-ci` task.

---

## Acceptance Criteria

- [ ] `eslint`, `typescript-eslint` are in `devDependencies` in `package.json`.
- [ ] `eslint.config.mjs` exists at the repo root with the shape specified above.
- [ ] `package.json` has a `"lint"` script: `eslint scripts/ tests/`.
- [ ] `npm run lint` exits 0 with no errors or warnings.
- [ ] `npm test` still passes with the same test count (currently 66).
- [ ] `npm run type-check` still passes.
- [ ] `docs/architecture.md` Validation table Linting row updated from "N/A" to `npm run lint`.
- [ ] `docs/codebase-map.md` Configuration table has an entry for `eslint.config.mjs`.

---

## Affected Files

| File | Change |
|---|---|
| `package.json` | Add `eslint`, `typescript-eslint` to devDependencies; add `"lint"` script |
| `package-lock.json` | Updated by `npm install` |
| `eslint.config.mjs` | Create — ESLint flat config with `recommendedTypeChecked` |
| `scripts/run-task.ts` | Fix 7 violations (see Decision section for exact changes) |
| `tests/pipeline-policy.test.ts` | Add `void` to 11 top-level `test()`/`it()` calls |
| `tests/run-task-parse-porcelain.test.ts` | Add `void` to top-level `test()`/`it()` calls |
| `tests/run-task-validation.test.ts` | Add `void` to 11 top-level `test()`/`it()` calls |
| `docs/architecture.md` | Validation table Linting row |
| `docs/codebase-map.md` | Configuration table — add `eslint.config.mjs` row |

---

## Validation Required

| Category | Required? | Command |
|---|---|---|
| Linting | Yes | `npm run lint` (this task establishes it) |
| Type checking | Yes | `npm run type-check` |
| Unit tests | Yes | `npm test` |
| Full build | N/A | No build step |
| End-to-end | N/A | No UI surface |

---

## Known Risks

- **`_` prefix on `PHASE_STATUS_VALUES` / `VERDICT_VALUES`**: The `typeof` references to these names must be updated in the same edit. If the rename is done without updating the type aliases, TypeScript will catch it — but Codex must not skip the type-alias lines.
- **`as typeof event` cast**: Both `onLine` closures in `run-task.ts` have this pattern. Codex must find and fix both occurrences, not just the first one.
- **`void` placement in tests**: `void` goes on the outer `test()`/`it()` call, not inside the callback. Misplacing it (e.g., `test('x', () => { void ... })`) would suppress a different expression and leave the outer call still floating.
- **Nested `test()`/`it()` calls**: Some test callbacks may register nested `it()` calls. Those do not need `void` — only top-level registrations do. Verify by checking that `npm run lint` exits clean after the fix.

---

## Docs Impact

- `docs/architecture.md` — Validation table Linting row (explicit AC)
- `docs/codebase-map.md` — Configuration table (explicit AC)

---

## Human Test Plan

1. After the PR lands, run `npm run lint` locally — it should complete with no errors.
2. Run `npm test` — all 58 tests should still pass.
3. Run `npm run type-check` — should still pass.
4. Introduce a deliberate lint violation in any file (e.g., add an unused variable), run `npm run lint`, confirm it is reported as an error, then revert.
