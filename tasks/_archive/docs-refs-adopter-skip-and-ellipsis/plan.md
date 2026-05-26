# Plan: docs-refs-adopter-skip-and-ellipsis

> Written by: Claude | Implements: `tasks/docs-refs-adopter-skip-and-ellipsis/spec.md`

## Approach

Four-file change: both copies of `docs-refs-check.mjs` (root + templates mirror), the `.d.ts` ambient declaration, and the test file. All logic changes are additive — new constant, new parameter, new short-circuit — so the existing behavior is preserved when `NOISY_SOURCE_PATHS` is empty and no options are passed.

Both script copies must receive identical new code. The pre-existing `isNoisySourceFile` carve-out difference between the two copies (root has a three-clause regex; templates has a simpler two-clause one) is left alone — that's `canon-docs-dedup`'s scope.

---

## Pre-flight

Before any edits, capture the current diff between the two script copies as a baseline for AC-5:

```bash
diff scripts/docs-refs-check.mjs templates/scripts/docs-refs-check.mjs > /tmp/pre-change-diff.txt
```

---

## Step 1 — Add `NOISY_SOURCE_PATHS` constant to `scripts/docs-refs-check.mjs`

File: `scripts/docs-refs-check.mjs`

Insert immediately after the closing `});` of the `VALID_DIRS` block (after line 44), mirroring the `VALID_DIRS` adopter-edit comment style:

```javascript
// Adopters: extend after `canon upgrade` to skip archive/log conventions
// (e.g., 'docs/archive', 'docs/personas', 'docs/changelogs.md').
// Entries match the repo-relative POSIX path of each source file by:
//   - exact match: skip just that file ('docs/changelogs.md' skips only that file)
//   - directory prefix: 'docs/archive' skips every file under 'docs/archive/'
// Trailing slashes on entries are normalized away, so 'docs/archive' and
// 'docs/archive/' behave identically.
const NOISY_SOURCE_PATHS = [];
```

---

## Step 2 — Add `...` short-circuit to `isPlaceholderTarget` in `scripts/docs-refs-check.mjs`

File: `scripts/docs-refs-check.mjs`

Add as the **first** check in `isPlaceholderTarget` (currently at line 181), before the existing `if (/[<>\[\]\*\?]/.test(target))` check:

```javascript
function isPlaceholderTarget(target) {
    if (target.includes('...')) return true;
    if (/[<>\[\]\*\?]/.test(target)) return true;
    // ... rest unchanged
```

This catches `src/...`, `<dir>/.../file.ts`, and any ellipsis-bearing pattern regardless of segment position.

---

## Step 3 — Extend `isNoisySourceFile` in `scripts/docs-refs-check.mjs`

File: `scripts/docs-refs-check.mjs`

Change signature from `isNoisySourceFile(relPath)` to `isNoisySourceFile(relPath, skipPaths = [])` and prepend the adopter-skip guard before the existing canon-universal checks:

```javascript
function isNoisySourceFile(relPath, skipPaths = []) {
    if (skipPaths.some(entry => {
        const norm = entry.endsWith('/') ? entry.slice(0, -1) : entry;
        return relPath === norm || relPath.startsWith(norm + '/');
    })) return true;
    return (
        relPath === 'docs/BACKLOG.md' ||
        /(?:^|\/)templates\/(?:.*\/)?(spec|plan)\.md$/.test(relPath) ||
        /^tasks\/[^/]+\/(spec|plan)\.md$/.test(relPath)
    );
}
```

The three canon-universal conditions are preserved verbatim (same text as the current root copy).

---

## Step 4 — Thread `skipPaths` through `findBrokenRefs` and `runChecks` in `scripts/docs-refs-check.mjs`

File: `scripts/docs-refs-check.mjs`

**4a.** Change `findBrokenRefs(repoRoot)` to `findBrokenRefs(repoRoot, options = {})`. Add as the first statement in the function body (before `const findings = []`):

```javascript
const skipPaths = options.skipPaths ?? NOISY_SOURCE_PATHS;
```

**4b.** In the `for (const sourceFile of markdownFiles)` loop, change:

```javascript
if (isNoisySourceFile(relSourceFile)) continue;
```

to:

```javascript
if (isNoisySourceFile(relSourceFile, skipPaths)) continue;
```

**4c.** Change `runChecks(repoRoot)` to `runChecks(repoRoot, options = {})` and pass options through:

```javascript
export function runChecks(repoRoot, options = {}) {
    return findBrokenRefs(repoRoot, options);
}
```

---

## Step 5 — Update the export in `scripts/docs-refs-check.mjs`

File: `scripts/docs-refs-check.mjs`

Change the bottom-of-file export from:

```javascript
export { VALID_DIRS, main };
```

to:

```javascript
export { VALID_DIRS, NOISY_SOURCE_PATHS, main };
```

---

## Step 6 — Mirror all edits to `templates/scripts/docs-refs-check.mjs`

File: `templates/scripts/docs-refs-check.mjs`

Apply Steps 1–5 identically to `templates/scripts/docs-refs-check.mjs`, **with one constraint**: the pre-existing `isNoisySourceFile` body in `templates/` uses a simpler two-clause form (`docs/BACKLOG.md` + `/(spec|plan)\.md$/` regex). Leave those two clauses as-is. Only add the new `skipPaths` parameter and the guard block at the top, matching the structure in Step 3 but preserving the templates-copy's existing conditions:

```javascript
function isNoisySourceFile(relPath, skipPaths = []) {
    if (skipPaths.some(entry => {
        const norm = entry.endsWith('/') ? entry.slice(0, -1) : entry;
        return relPath === norm || relPath.startsWith(norm + '/');
    })) return true;
    return (
        relPath === 'docs/BACKLOG.md' ||
        /\/(spec|plan)\.md$/.test(relPath)      // templates/ copy's existing simpler regex
    );
}
```

After applying, verify AC-5:

```bash
diff scripts/docs-refs-check.mjs templates/scripts/docs-refs-check.mjs > /tmp/post-change-diff.txt
diff /tmp/pre-change-diff.txt /tmp/post-change-diff.txt
```

The second diff must show only **removed** context (the new shared code that was different before is now the same). Zero new lines of drift introduced.

---

## Step 7 — Update `scripts/docs-refs-check.mjs.d.ts`

File: `scripts/docs-refs-check.mjs.d.ts`

The current declaration is:

```typescript
export function runChecks(repoRoot: string): Finding[];
```

Replace with:

```typescript
export function runChecks(repoRoot: string, options?: { skipPaths?: readonly string[] }): Finding[];
export const NOISY_SOURCE_PATHS: string[];
```

`NOISY_SOURCE_PATHS` is declared `string[]` (mutable), not `readonly string[]`, because AC-6 case (e) mutates it via `.push()` and `.length = 0`.

---

## Step 8 — Add five test cases to `tests/docs-refs-check.test.ts`

File: `tests/docs-refs-check.test.ts`

**8a.** Update the import to include `NOISY_SOURCE_PATHS`:

```typescript
import { runChecks, NOISY_SOURCE_PATHS } from '../scripts/docs-refs-check.mjs';
```

**8b.** Append the five test cases after the last existing test. All fixtures use `scripts/nonexistent.ts` as the broken backtick ref — it's in `VALID_DIRS` but won't exist in the temp tree.

**Case (a) — directory-prefix skip + segment-boundary negative control:**

```typescript
void test('NOISY_SOURCE_PATHS: directory-prefix skip silences files under that tree, not adjacent names', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/archive/old.md', 'See `scripts/nonexistent.ts`.\n');
            writeFile(root, 'docs/archive-notes/file.md', 'See `scripts/nonexistent.ts`.\n');
        },
        root => {
            const findings = runChecks(root, { skipPaths: ['docs/archive'] });
            assert.equal(findings.length, 1);
            assert.equal(findings[0].file, 'docs/archive-notes/file.md');
        },
    );
});
```

`docs/archive-notes/` is a regular directory the walker descends into. The `+ '/'` boundary in `relPath.startsWith(norm + '/')` prevents `docs/archive` from matching `docs/archive-notes/file.md`.

**Case (b) — exact-file skip + overmatch negative control:**

```typescript
void test('NOISY_SOURCE_PATHS: exact-file skip silences only that file, not paths that string-start-with it', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/changelogs.md', 'See `scripts/nonexistent.ts`.\n');
            writeFile(root, 'docs/changelogs.md-notes/file.md', 'See `scripts/nonexistent.ts`.\n');
        },
        root => {
            const findings = runChecks(root, { skipPaths: ['docs/changelogs.md'] });
            assert.equal(findings.length, 1);
            assert.equal(findings[0].file, 'docs/changelogs.md-notes/file.md');
        },
    );
});
```

`docs/changelogs.md-notes/` is a directory whose name contains `.md`. The walker descends into it (`walkMarkdownTree` only excludes `node_modules`, `dist`, `_archive`-under-tasks, and hidden dirs) and visits `file.md` inside. The path `docs/changelogs.md-notes/file.md` string-starts-with `docs/changelogs.md` but is neither equal to it nor prefixed by `docs/changelogs.md/`, so the sloppy-startsWith trap is caught.

**Case (c) — trailing-slash normalization:**

```typescript
void test('NOISY_SOURCE_PATHS: trailing slash on entry is normalized away', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/archive/old.md', 'See `scripts/nonexistent.ts`.\n');
        },
        root => {
            assert.deepEqual(runChecks(root, { skipPaths: ['docs/archive/'] }), []);
        },
    );
});
```

**Case (d) — ellipsis placeholder:**

```typescript
void test('isPlaceholderTarget: backtick ref containing ... is treated as placeholder', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/ellipsis.md', 'See `src/...`.\n');
        },
        root => {
            assert.deepEqual(runChecks(root), []);
        },
    );
});
```

**Case (e) — default `NOISY_SOURCE_PATHS` is consulted by no-options `runChecks`:**

```typescript
void test('NOISY_SOURCE_PATHS: module-level constant is consulted when runChecks is called with no options', () => {
    makeTempRepo(
        root => {
            writeFile(root, 'docs/archive/old.md', 'See `scripts/nonexistent.ts`.\n');
        },
        root => {
            NOISY_SOURCE_PATHS.push('docs/archive');
            try {
                assert.deepEqual(runChecks(root), []);
            } finally {
                NOISY_SOURCE_PATHS.length = 0;
            }
            // After restore: empty default does not skip — proves cleanup worked
            assert.equal(runChecks(root).length, 1);
        },
    );
});
```

---

## Step 9 — Validate

Run in order:

```bash
npm run lint
npm run type-check
npm test
node scripts/docs-refs-check.mjs
```

All must pass. `node scripts/docs-refs-check.mjs` must exit 0 with `All refs OK` (AC-7) — canon's own tree is unaffected because `NOISY_SOURCE_PATHS` defaults to `[]` and there are no ellipsis paths in current docs.

---

## Rollback Plan

Pure additive changes. Reverting is a `git revert` of the single implementation commit. No data migration, no schema change, no behavior change for existing callers (`runChecks(root)` with no options and empty `NOISY_SOURCE_PATHS` is identical to the current behavior).
