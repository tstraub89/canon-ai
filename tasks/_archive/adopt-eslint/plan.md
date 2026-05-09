# Plan: Adopt ESLint with typescript-eslint recommendedTypeChecked

> Tier: M (full tier) | Written by: Claude after Codex spec review (approved_with_nits)

---

## Spec-review nits incorporated

Two nits from `spec-review.md` inform implementation:

1. **`docs/architecture.md` linting row**: Replace the **entire cell** (not just the `N/A` token). The current text reads "N/A — no linter currently configured. `tsc --strict` catches most of what a linter would. Adding one is a future task." — every word of that must be gone. The replacement cell is exactly: `` `npm run lint` (= `eslint scripts/ tests/`) — required for all changes ``

2. **Human test plan test count**: The spec's Human Test Plan mentions "58 tests" (AC says 66). The actual top-level `test()`/`it()` count across the three test files is 38 (8 + 19 + 11). These counts are stale and should not be validated against. Instead, run `npm test` before and after all changes and confirm the **exit code is 0** and the reported count does not change between the two runs.

---

## Steps

### Step 1 — Install packages

```bash
npm install --save-dev eslint typescript-eslint
```

Adds `eslint` and `typescript-eslint` to `devDependencies` and regenerates `package-lock.json`. Verify both appear under `devDependencies` in `package.json` after the install.

---

### Step 2 — Create `eslint.config.mjs`

Create `eslint.config.mjs` at the repo root with this exact content:

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

No other rules, no other ignores. The `projectService: true` option enables type-aware linting.

---

### Step 3 — Add `"lint"` script to `package.json`

In the `"scripts"` block of `package.json`, add:

```json
"lint": "eslint scripts/ tests/"
```

The final scripts block should look like:

```json
"scripts": {
  "test": "node --test --import tsx tests/**/*.test.ts",
  "type-check": "tsc -p tsconfig.json --noEmit",
  "task": "./scripts/task.sh",
  "run-task": "tsx scripts/run-task.ts",
  "lint": "eslint scripts/ tests/"
}
```

---

### Step 4 — Fix violations in `scripts/run-task.ts`

Seven violations across four locations. Apply from lowest to highest line number to avoid drift.

#### 4a. Lines 40–41 — `@typescript-eslint/no-unused-vars` (rename + update type aliases)

Current lines 40–45:
```ts
const PHASE_STATUS_VALUES = ['pending', 'in_progress', 'done', 'changes_requested', 'blocked'] as const;
const VERDICT_VALUES = ['approved', 'approved_with_nits', 'changes_requested', 'needs_re_review'] as const;

type PhaseStatus = (typeof PHASE_STATUS_VALUES)[number];
type Verdict = (typeof VERDICT_VALUES)[number] | '';
```

Add `_` prefix to both constant names AND their `typeof` references (both edits are required — TypeScript will error if only one is made):
```ts
const _PHASE_STATUS_VALUES = ['pending', 'in_progress', 'done', 'changes_requested', 'blocked'] as const;
const _VERDICT_VALUES = ['approved', 'approved_with_nits', 'changes_requested', 'needs_re_review'] as const;

type PhaseStatus = (typeof _PHASE_STATUS_VALUES)[number];
type Verdict = (typeof _VERDICT_VALUES)[number] | '';
```

#### 4b. Line 2070 — `@typescript-eslint/no-unsafe-assignment` (first `onLine`)

`event` is declared as `Record<string, unknown>`. `JSON.parse` returns `any`; assigning it to the typed variable is flagged.

Current:
```ts
let event: Record<string, unknown>;
try { event = JSON.parse(line); } catch { return; }
```

Fix — add cast on the `JSON.parse` call:
```ts
let event: Record<string, unknown>;
try { event = JSON.parse(line) as typeof event; } catch { return; }
```

`as typeof event` resolves to `as Record<string, unknown>`. The `formatLiveTick(event)` call on the next line needs no change.

#### 4c. Line 2216 — `@typescript-eslint/no-unsafe-assignment` (second `onLine`)

The second `onLine` closure (around line 2209) has `event` typed as a specific struct:
```ts
let event: {
    type?: string;
    thread_id?: string;
    item?: { type?: string; text?: string; name?: string };
    usage?: { input_tokens?: number; output_tokens?: number };
};
try { event = JSON.parse(line); } catch { return; }
```

Same fix as 4b:
```ts
try { event = JSON.parse(line) as typeof event; } catch { return; }
```

#### 4d. Line 2217 — `@typescript-eslint/no-unnecessary-type-assertion`

On the line immediately after 4c:
```ts
const tick = formatLiveTick(event as Record<string, unknown>);
```

The specific struct type is assignable to `Record<string, unknown>`; the cast is redundant. Remove it:
```ts
const tick = formatLiveTick(event);
```

#### 4e. Line 2998 — `@typescript-eslint/no-unnecessary-type-assertion` (×2)

Current:
```ts
if (value && typeof value === 'object' && 'url' in (value as object) && 'section' in (value as object)) {
```

After `typeof value === 'object'`, TypeScript narrows `value` to `object`. Remove both redundant casts:
```ts
if (value && typeof value === 'object' && 'url' in value && 'section' in value) {
```

---

### Step 5 — Fix `no-floating-promises` violations in test files

All violations are top-level `test()` and `it()` calls. The `node:test` runner collects registrations without the caller awaiting them; `void` is the correct idiomatic fix.

**Rule**: prefix the outer registration call with `void`. Do NOT add `void` inside the callback body.

```ts
// before
test('description', () => { ... });
it('description', async () => { ... });

// after
void test('description', () => { ... });
void it('description', async () => { ... });
```

#### 5a. `tests/pipeline-policy.test.ts` — 8 top-level registrations

Add `void` to every `test(` / `it(` call at column 0 (top level).

#### 5b. `tests/run-task-parse-porcelain.test.ts` — 19 top-level registrations

Add `void` to every `test(` / `it(` call at column 0.

#### 5c. `tests/run-task-validation.test.ts` — 11 top-level registrations

Add `void` to every `test(` / `it(` call at column 0.

**Nested `it()` calls inside a test callback do NOT get `void`** — only top-level registrations do. After editing all three files, run `npm run lint` to confirm the rule is fully satisfied.

---

### Step 6 — Update `docs/architecture.md` Validation table Linting row

Locate line 134, the Linting row in the Validation table:

```
| Linting | N/A — no linter currently configured. `tsc --strict` catches most of what a linter would. Adding one is a future task. |
```

Replace the **entire row** with:

```
| Linting | `npm run lint` (= `eslint scripts/ tests/`) — required for all changes |
```

The entire old cell text must be gone — no fragment of "no linter currently configured" or "future task" may remain.

---

### Step 7 — Update `docs/codebase-map.md` Configuration table

Locate the Configuration table (lines ~83–91). Add a new row for `eslint.config.mjs` after the `tsconfig.json` row (keep config files grouped):

```
| ESLint flat config | `eslint.config.mjs` | `@typescript-eslint/recommendedTypeChecked`, `projectService: true` |
```

---

### Step 8 — Validate

Run all three checks. Each must pass before writing the handoff.

```bash
npm run lint        # exits 0, no errors or warnings
npm run type-check  # exits 0
npm test            # exits 0; reported count matches pre-change run
```

If `npm run lint` reports any violations not covered by this plan: do NOT suppress with `eslint-disable`. Fix the code. If a suppression is genuinely the right call, include a same-line justification on the same line as the comment explaining exactly why the rule is wrong for that call site.

---

## Testing Plan

- **Lint**: `npm run lint` exits 0 with zero errors/warnings (established by this task).
- **Type-check**: `npm run type-check` exits 0 — verifies the `_` renames and cast removals don't break TypeScript.
- **Unit tests**: `npm test` exits 0 with the same count as before the changes — verifies `void` additions don't break test registration behavior.

## Rollback Plan

All changes are additive or cosmetic. To revert: remove `eslint` and `typescript-eslint` from `devDependencies`, delete `eslint.config.mjs`, remove the `"lint"` script, undo the code fixes in `run-task.ts` and the three test files, and revert the two doc rows. No data migration concerns.
