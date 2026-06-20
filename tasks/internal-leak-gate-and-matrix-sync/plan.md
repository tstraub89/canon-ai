# Plan: internal-leak-gate-and-matrix-sync

> Written by: Claude | For implementation by: Codex

## Overview

Three changes: (1) extend the leak gate in `scripts/sync-canon-templates.mjs` to catch bare-basename references to internal-only prompt-template filenames; (2) fix the live `qa.md` leak in `.claude/skills/canon-changelog/SKILL.md`; (3) add a drift-guard test for the Validation Matrix; (4) encode the principle in `docs/decisions.md`. Steps must be applied atomically before running `sync-templates:check` to avoid a gate failure between the leak fix and gate extension landing separately.

---

## Step 1 — Add `readdirSync` and `fileURLToPath` to the import block of `scripts/sync-canon-templates.mjs`

**File**: `scripts/sync-canon-templates.mjs`

Change the top-of-file imports from:

```js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path, { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
```

to:

```js
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path, { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
```

---

## Step 2 — Add `INTERNAL_ONLY_TEMPLATE_BASENAMES` constant to `scripts/sync-canon-templates.mjs`

**File**: `scripts/sync-canon-templates.mjs`

Insert after the existing `CANON_INTERNAL_PATH_PREFIXES` declaration (line 25). This derives the internal-only basename set from the actual canon-ai repo (via the script's own location) at module load time, so it stays dynamic and never drifts from the directories.

```js
// Repo root of the canon-ai-dev checkout that owns this script.
// Used only to derive INTERNAL_ONLY_TEMPLATE_BASENAMES — the basenames
// of *.md files under `scripts/run-task/prompts/templates/` that have
// no counterpart in `.canon/templates/`. A bare backtick ref to one of
// these names in canon-managed content is an internal-leak: adopters
// don't have that file. Colliding names (`spec.md`, `plan.md`,
// `spec-review.md`) are deliberately NOT in this set — they name shipped
// `.canon/templates/*` files and task artifacts and are legitimate as
// bare refs in adopter-facing prose.
const CANON_AI_ROOT = path.resolve(dirname(fileURLToPath(import.meta.url)), '..');

function computeInternalOnlyBasenames(repoRoot) {
    const internalDir = join(repoRoot, 'scripts/run-task/prompts/templates');
    const canonDir = join(repoRoot, '.canon/templates');
    const internalFiles = existsSync(internalDir)
        ? readdirSync(internalDir).filter(f => f.endsWith('.md'))
        : [];
    const canonSet = new Set(
        existsSync(canonDir) ? readdirSync(canonDir).filter(f => f.endsWith('.md')) : [],
    );
    return new Set(internalFiles.filter(f => !canonSet.has(f)));
}

export const INTERNAL_ONLY_TEMPLATE_BASENAMES = computeInternalOnlyBasenames(CANON_AI_ROOT);
```

The export lets the test suite read the set directly to verify AC-3 by inspection.

---

## Step 3 — Extend `isCanonInternalTarget` in `scripts/sync-canon-templates.mjs`

**File**: `scripts/sync-canon-templates.mjs`, function `isCanonInternalTarget` (line 56).

Add the bare-basename check as the second early-return, after the existing `CANON_INTERNAL_PATH_PREFIXES.some(...)` check and before the relative-normalization block:

```js
function isCanonInternalTarget(target, sourceRel) {
    // Existing: full path prefix matching (e.g. `scripts/run-task/main.ts`)
    if (CANON_INTERNAL_PATH_PREFIXES.some(prefix => target.startsWith(prefix))) {
        return true;
    }
    // NEW: bare basename of an internal-only prompt template (no path separator).
    // e.g. `qa.md` or `implement.md` — files that live under
    // `scripts/run-task/prompts/templates/` but have no counterpart in
    // `.canon/templates/`. Colliding names (`spec.md`, `plan.md`,
    // `spec-review.md`) are excluded by the subtraction set.
    if (!target.includes('/') && INTERNAL_ONLY_TEMPLATE_BASENAMES.has(target)) {
        return true;
    }
    // Existing: source-file-relative normalization (e.g. `../scripts/run-task/main.ts`)
    if (target.startsWith('http://') || target.startsWith('https://')) return false;
    if (target.startsWith('/')) return false;
    const sourceDir = path.posix.dirname(sourceRel);
    const resolved = path.posix.normalize(path.posix.join(sourceDir, target));
    if (resolved.startsWith('..')) return false;
    return CANON_INTERNAL_PATH_PREFIXES.some(prefix => resolved.startsWith(prefix));
}
```

---

## Step 4 — Add a distinct error message helper in `scripts/sync-canon-templates.mjs`

**File**: `scripts/sync-canon-templates.mjs`

Add the helper function `describeLeakTarget(target)` immediately before `buildSyncPlan`:

```js
function describeLeakTarget(target) {
    if (!target.includes('/') && INTERNAL_ONLY_TEMPLATE_BASENAMES.has(target)) {
        return `\`${target}\` is an internal-only prompt-template filename — adopters don't have this file; reference the phase name instead of the template filename`;
    }
    return `\`${target}\` is canon-internal and must not appear in canon-managed content (adopters don't have this file; ref would break their docs-refs-check at upgrade time)`;
}
```

Then update the three `[canon-internal-leak]` error-push sites in `buildSyncPlan`. Search for `[canon-internal-leak]` to locate all three.

**Sites 1 and 2** (wholesale scan loop and delimited-region scan): replace the existing message body with the helper:

```js
errors.push(
    `[canon-internal-leak] ${relPath}:${leak.line} — ${describeLeakTarget(leak.target)}`,
);
```

**Site 3** (first-create / source-tail path): this site has extra first-create-specific context after the target description. Preserve that context — only replace the inline target description with the helper output:

```js
errors.push(
    `[canon-internal-leak] ${relPath}:${leak.line} — ${describeLeakTarget(leak.target)} in source tail would ship as ${targetRel}'s default tail on first-create (move the ref above \`<!-- canon:end -->\` only if it should be canon-managed, otherwise drop it or create ${targetRel} manually with the desired adopter-default tail)`,
);
```

---

## Step 5 — Fix the live leak: edit `.claude/skills/canon-changelog/SKILL.md` line 226

**File**: `.claude/skills/canon-changelog/SKILL.md`

Line 226 currently reads:
```
- `docs/decisions.md` §"Versioning and release policy" — project changelog scope and SemVer interpretation. Canon's general release rules (propose-only, separate bump commit, no major surprises) are inlined in `qa.md`.
```

Change to:
```
- `docs/decisions.md` §"Versioning and release policy" — project changelog scope and SemVer interpretation. Canon's general release rules (propose-only, separate bump commit, no major surprises) are enforced during canon's QA phase.
```

This removes the `qa.md` bare-basename ref while preserving the meaning that the rules are enforced at QA. Do not manually edit the `templates/` mirror — Step 8's `npm run sync-templates` handles it.

---

## Step 6 — Add leak-gate tests to `tests/sync-canon-templates.test.ts`

**File**: `tests/sync-canon-templates.test.ts`

At the top of the file, add a read of the new exported constant alongside the existing `SyncCanonTemplatesModule` type cast:

```ts
const internalOnlyBasenames = (syncCanonTemplatesRaw as unknown as {
    INTERNAL_ONLY_TEMPLATE_BASENAMES: Set<string>;
}).INTERNAL_ONLY_TEMPLATE_BASENAMES;
```

`INTERNAL_ONLY_TEMPLATE_BASENAMES` is computed at module load time from the actual canon-ai repo directories, so the temp fixture root in `withTempDir` does not need to contain those template directories — the tests just write content with the relevant bare basenames. The seam is `findSyncErrors(root)`.

Append the following two tests at the bottom of the file (after the last test at line 385):

**Test A — AC-1/AC-3: bare internal-only basenames are flagged**

```ts
void test('findSyncErrors flags bare internal-only prompt-template basenames in wholesale-synced markdown', () => {
    withTempDir(root => {
        seedCanonFixture(root);
        // qa.md and implement.md are internal-only (no counterpart in .canon/templates/)
        writeFile(
            root,
            'docs/pipeline-orchestrator.md',
            'See `qa.md` for rules and `implement.md` for the prompt.\n',
        );
        writeFile(
            root,
            'templates/docs/pipeline-orchestrator.md',
            'See `qa.md` for rules and `implement.md` for the prompt.\n',
        );

        const errors = syncCanonTemplates.findSyncErrors(root);
        assert.ok(
            errors.some(e => /\[canon-internal-leak\].*`qa\.md`/.test(e)),
            `expected [canon-internal-leak] for bare \`qa.md\`; got: ${errors.join(' | ')}`,
        );
        assert.ok(
            errors.some(e => /\[canon-internal-leak\].*`implement\.md`/.test(e)),
            `expected [canon-internal-leak] for bare \`implement.md\`; got: ${errors.join(' | ')}`,
        );
        // AC-3: implement.md (internal-only) must be in the set; spec.md (colliding) must not
        assert.ok(internalOnlyBasenames.has('implement.md'), 'implement.md must be in INTERNAL_ONLY_TEMPLATE_BASENAMES');
        assert.ok(!internalOnlyBasenames.has('spec.md'), 'spec.md must NOT be in INTERNAL_ONLY_TEMPLATE_BASENAMES');
    });
});
```

**Test B — AC-2: colliding names are NOT flagged**

```ts
void test('findSyncErrors does NOT flag bare colliding-name refs (spec.md, plan.md, spec-review.md)', () => {
    withTempDir(root => {
        seedCanonFixture(root);
        // spec.md, plan.md, spec-review.md exist in both template directories — not internal-only.
        writeFile(
            root,
            'docs/pipeline-orchestrator.md',
            'Review `spec.md`, `plan.md`, and `spec-review.md` before proceeding.\n',
        );
        writeFile(
            root,
            'templates/docs/pipeline-orchestrator.md',
            'Review `spec.md`, `plan.md`, and `spec-review.md` before proceeding.\n',
        );

        const errors = syncCanonTemplates.findSyncErrors(root);
        const leakErrors = errors.filter(e => e.startsWith('[canon-internal-leak]'));
        assert.deepEqual(
            leakErrors,
            [],
            `expected no [canon-internal-leak] errors for colliding-name bare refs; got: ${leakErrors.join(' | ')}`,
        );
    });
});
```

---

## Step 7 — Add Validation Matrix drift-guard test: `tests/validation-matrix-sync.test.ts` (new file)

**File**: `tests/validation-matrix-sync.test.ts` (create new)

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const MATRIX_HEADER = '| Change Type | Required Check Categories |';

function extractMatrix(filePath: string): string | null {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const headerIdx = lines.findIndex(l => l === MATRIX_HEADER);
    if (headerIdx === -1) return null;
    const rows: string[] = [];
    for (let i = headerIdx; i < lines.length; i++) {
        if (!lines[i].startsWith('|')) break;
        rows.push(lines[i]);
    }
    return rows.join('\n');
}

void test('Validation Matrix is byte-identical between implement.md and spec.md', () => {
    const implementPath = path.resolve('scripts/run-task/prompts/templates/implement.md');
    const specPath = path.resolve('.canon/templates/spec.md');

    const implementMatrix = extractMatrix(implementPath);
    const specMatrix = extractMatrix(specPath);

    assert.ok(
        implementMatrix !== null && implementMatrix.length > 0,
        `Validation Matrix not found in ${implementPath} — check the anchor header "${MATRIX_HEADER}"`,
    );
    assert.ok(
        specMatrix !== null && specMatrix.length > 0,
        `Validation Matrix not found in ${specPath} — check the anchor header "${MATRIX_HEADER}"`,
    );
    assert.equal(
        implementMatrix,
        specMatrix,
        'Validation Matrix has drifted between scripts/run-task/prompts/templates/implement.md and .canon/templates/spec.md — edit both files to match',
    );
});
```

The test reads from `path.resolve(...)` anchored on `process.cwd()`. Run via `npm test` from the repo root. No fixture setup needed — both files exist in the repo and neither is modified by this task.

---

## Step 8 — Sync templates mirror

Run: `npm run sync-templates`

This propagates the `.claude/skills/canon-changelog/SKILL.md` edit (Step 5) to `templates/.claude/skills/canon-changelog/SKILL.md`. The pre-commit hook stages the mirror automatically; running the command explicitly ensures the mirror is current before the validation pass.

---

## Step 9 — Add decision entry to `docs/decisions.md`

**File**: `docs/decisions.md`

Append at the end of the file (before the trailing newline, following the format of existing entries — heading, blank line, **Decision**, **Why**, **Rule**, `---`):

```markdown
## Shipped guidance must not reference orchestration internals

**Decision**: Canon-managed and shipped guidance (skills, templates, protected docs) must never reference canon orchestration internals — files under `scripts/run-task/`, `src/`, or per-phase prompt templates under `scripts/run-task/prompts/templates/` — by name. Adopters do not receive these files; a reference to one of them in shipped content produces a broken ref in the adopter's `docs-refs-check` at upgrade time.

**Why**: The v2.0.0 adopter-agent-file-redesign task shipped a skill that referenced `qa.md` (an internal per-phase prompt template) by bare basename. Adopters who upgraded got a ref their `docs-refs-check` flagged as broken. Adopters can override `.canon/templates/*` task templates — those are theirs by design — but orchestration internals are off-limits and must not appear in any content that ships to them.

**Rule**: Any backtick reference to an orchestration-internal path or an internal-only prompt-template basename in a canon-managed file is a gate failure. Use the phase name (e.g., "canon's QA phase") rather than the internal filename. The `sync-canon-templates.mjs` leak gate (`npm run sync-templates:check`) is the executable enforcement: it flags full-path refs matching `scripts/run-task/` prefixes AND bare basenames of `*.md` files that exist under `scripts/run-task/prompts/templates/` but have no counterpart in `.canon/templates/`.
```

---

## Step 10 — Validate

Run in order:

```
npm run lint
npm run type-check
npm test
npm run sync-templates:check
npm run docs-refs-check
```

All must exit 0. Key checks per AC:
- `npm test` — new tests in `tests/sync-canon-templates.test.ts` (AC-1, AC-2, AC-3) and `tests/validation-matrix-sync.test.ts` (AC-5) pass; existing leak tests (AC-4) still pass unchanged
- `npm run sync-templates:check` — exercises the extended gate end-to-end; must report no `[canon-internal-leak]` errors (AC-6, AC-7, AC-8)
- `npm run docs-refs-check` — verifies refs in `docs/decisions.md`, `.claude/skills/canon-changelog/SKILL.md`, and `templates/.claude/skills/canon-changelog/SKILL.md` are valid (AC-7, AC-9)

---

## Implementation Order Summary

| Step | File(s) | Purpose |
|---|---|---|
| 1 | `scripts/sync-canon-templates.mjs` | Add `readdirSync`, `fileURLToPath` imports |
| 2 | `scripts/sync-canon-templates.mjs` | Add `INTERNAL_ONLY_TEMPLATE_BASENAMES` constant + `computeInternalOnlyBasenames` |
| 3 | `scripts/sync-canon-templates.mjs` | Extend `isCanonInternalTarget` with bare-basename check |
| 4 | `scripts/sync-canon-templates.mjs` | Add `describeLeakTarget` helper; update 3 error-push sites in `buildSyncPlan` |
| 5 | `.claude/skills/canon-changelog/SKILL.md:226` | Remove `qa.md` ref; reference QA phase instead |
| 6 | `tests/sync-canon-templates.test.ts` | Add bare-basename positive and negative tests (AC-1, AC-2, AC-3) |
| 7 | `tests/validation-matrix-sync.test.ts` *(new)* | Drift-guard test for Validation Matrix (AC-5) |
| 8 | *(run)* `npm run sync-templates` | Auto-sync `templates/.claude/skills/canon-changelog/SKILL.md` |
| 9 | `docs/decisions.md` | Add "Shipped guidance must not reference internals" entry (AC-9) |
| 10 | *(run)* validation commands | Confirm all gates pass |

**Ordering constraint**: Steps 1–5 are the atomic core. The gate extension (steps 1–4) and the leak fix (step 5) must both land before `npm run sync-templates:check` is run. Run all validations in step 10 only after step 8 (the sync) completes.
