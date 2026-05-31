# Plan: docs-refs-adopter-config

> Written by: Claude | Task: docs-refs-adopter-config

## Addressing spec-review nits

Three nits from `approved_with_nits`:

1. **Helper seam underspecified** — plan names the injectable test seam explicitly: `loadAdopterConfig(configPath)` + `mergeAdopterConfig(adopter)` are exported; `runChecks` gains an `adopterConfig` option so tests can override the module-level loaded config without reading the real sibling. Tests for AC-2/3/4 pass `options.adopterConfig` directly; tests for AC-5 call `loadAdopterConfig` against a temp fixture.

2. **Cutover signal in `UpgradeResult`** — plan adds `cutoversDeferred: string[]` to `UpgradeResult`. AC-8/9/10 tests assert on this field plus the `upgraded`/`wouldUpgrade` shapes.

3. **`.d.ts` typings** — plan explicitly adds `VALID_DIRS: Set<string>`, `mergeAdopterConfig`, and `loadAdopterConfig` export declarations to `scripts/docs-refs-check.mjs.d.ts`.

---

## Implementation Steps

### Step 1 — Refactor `scripts/docs-refs-check.mjs`

Replace the three adopter-owned constants and add config loading. Key changes:

**1a. Remove adopter-edit comments and the three mutable constants** (lines 14–15, 38–51, 53–60, 63). Replace with canon-universal defaults — note `templates` is intentionally absent from both:

```js
const CANON_VALID_DIRS = new Set([
  'src', 'scripts', 'tests', 'docs', 'public', 'tasks',
  '.github', '.canon', '.claude', '.codex',
]);
const CANON_NOISY_SOURCE_PATHS = [];
const CANON_MARKDOWN_ROOT_DIRS = ['docs', 'tasks'];
```

**1b. Add exported pure merge function** (no I/O; this is the AC-2/3/4 test seam):

```js
export function mergeAdopterConfig(adopter) {
  const isStringArr = v => !v || (Array.isArray(v) && v.every(x => typeof x === 'string'));
  const safeArr = v => (isStringArr(v) && v) ? v : [];
  return {
    validDirs: new Set([...CANON_VALID_DIRS, ...safeArr(adopter?.validDirs)]),
    noisySourcePaths: [...new Set([...CANON_NOISY_SOURCE_PATHS, ...safeArr(adopter?.noisySourcePaths)])],
    markdownRootDirs: [...new Set([...CANON_MARKDOWN_ROOT_DIRS, ...safeArr(adopter?.markdownRootDirs)])],
  };
}
```

**1c. Add exported async config loader** (this is the AC-5 test seam — call with a temp fixture path):

```js
export async function loadAdopterConfig(configPath) {
  if (!fs.existsSync(configPath)) return null;
  try {
    const mod = await import(pathToFileURL(configPath).href);
    const { noisySourcePaths, validDirs, markdownRootDirs } = mod;
    const isStringArr = v => !v || (Array.isArray(v) && v.every(x => typeof x === 'string'));
    if (!isStringArr(noisySourcePaths) || !isStringArr(validDirs) || !isStringArr(markdownRootDirs)) {
      return null;
    }
    return { noisySourcePaths, validDirs, markdownRootDirs };
  } catch {
    return null;
  }
}
```

**1d. Top-level await** — load the sibling config once at module init:

```js
const _SIBLING_CONFIG_PATH = new URL('./docs-refs-config.mjs', import.meta.url).pathname;
const _siblingConfig = await loadAdopterConfig(_SIBLING_CONFIG_PATH);
const _effective = mergeAdopterConfig(_siblingConfig);
```

**1e. Re-export effective constants** (preserving the exported symbol names — AC-7):

```js
export const VALID_DIRS = _effective.validDirs;               // Set<string>
export const NOISY_SOURCE_PATHS = _effective.noisySourcePaths; // string[]
```

**1f. Update `runChecks`** to accept `options.adopterConfig` override (test seam for AC-2/3/4):

```js
export function runChecks(repoRoot, options = {}) {
  const adopter = 'adopterConfig' in options ? options.adopterConfig : _siblingConfig;
  const { validDirs, noisySourcePaths, markdownRootDirs } = mergeAdopterConfig(adopter);
  return findBrokenRefs(repoRoot, { ...options, _effectiveDirs: { validDirs, noisySourcePaths, markdownRootDirs } });
}
```

**1g. Thread effective dirs through internal functions**:
- `findBrokenRefs(repoRoot, options)`: read `options._effectiveDirs` and pass `validDirs` / `noisySourcePaths` / `markdownRootDirs` down to callers instead of the module-level constants.
- `collectMarkdownFiles(repoRoot, markdownRootDirs)`: add `markdownRootDirs` parameter (second arg).
- Backtick-ref check loop (line ~455): use `validDirs` from `_effectiveDirs`, not the exported module-level `VALID_DIRS`.
- `findBrokenRefs` already passes `skipPaths` to `isNoisySourceFile`; replace that path with the effective `noisySourcePaths` from `_effectiveDirs`.

---

### Step 2 — Create `scripts/docs-refs-config.mjs` (canon-ai-dev's own config)

New file. Exports `templates` additions so canon-ai-dev's own check still covers `templates/`:

```js
// Canon-ai-dev's own docs-refs config.
// Not canon-owned — survives every `canon upgrade`.
// Add entries here that are specific to this repo's layout.
export const noisySourcePaths = [];
export const validDirs = ['templates'];
export const markdownRootDirs = ['templates'];
```

Do NOT add this file to `CANON_OWNED` or `DELIMITED` in `src/lib/canon-owned.ts` (AC-11).

---

### Step 3 — Create `templates/scripts/docs-refs-config.mjs` (adopter template)

New file in `templates/` tree, picked up by `scaffoldTemplates` in `src/cli/commands/init.ts` without any code change (it walks the whole `templates/` tree):

```js
// docs-refs-config.mjs — your adopter-owned docs-refs configuration.
// This file is NOT managed by `canon upgrade` — your additions survive every upgrade.
//
// Extend any of the arrays below to customize the docs reference checker for this repo.
// All values are unioned with canon's built-in defaults; you cannot remove a canon default.
//
// noisySourcePaths: repo-relative paths (or prefixes) to skip as ref sources.
//   E.g., 'docs/archive' skips every file under docs/archive/.
//
// validDirs: additional top-level directories whose paths are considered valid ref targets.
//   E.g., 'infra' lets the checker validate `infra/foo.ts` refs.
//
// markdownRootDirs: additional directories walked for markdown source files.
//   E.g., 'documentation' walks documentation/**/*.md for broken refs.

export const noisySourcePaths = [];
export const validDirs = [];
export const markdownRootDirs = [];
```

Do NOT add to `CANON_OWNED`. This file's purpose is different from the root `scripts/docs-refs-config.mjs`: the root one re-adds `templates` for canon-ai-dev; the template one ships to adopters with empty arrays.

---

### Step 4 — Update `scripts/docs-refs-check.mjs.d.ts`

`docs-refs-check.mjs.d.ts` is `CANON_OWNED` (line 19 of `src/lib/canon-owned.ts`). Edit the root file; the pre-commit sync hook regenerates the `templates/` mirror automatically.

Add to the `declare module '*.mjs'` block:

```ts
export const VALID_DIRS: Set<string>;

export interface AdopterConfig {
  noisySourcePaths?: string[];
  validDirs?: string[];
  markdownRootDirs?: string[];
}
export function mergeAdopterConfig(adopter: AdopterConfig | null | undefined): {
  validDirs: Set<string>;
  noisySourcePaths: string[];
  markdownRootDirs: string[];
};
export function loadAdopterConfig(configPath: string): Promise<AdopterConfig | null>;
```

Update the existing `runChecks` signature to include the `adopterConfig` option:

```ts
export function runChecks(
  repoRoot: string,
  options?: { skipPaths?: readonly string[]; adopterConfig?: AdopterConfig | null }
): Finding[];
```

---

### Step 5 — Update `src/cli/commands/upgrade.ts`

**5a. Extend `UpgradeResult`** to carry the cutover signal:

```ts
export interface UpgradeResult {
  // ... existing fields ...
  /** Files whose upgrade was deferred because a cutover migration scaffolded a prerequisite first. */
  cutoversDeferred: string[];
}
```

Initialize `const cutoversDeferred: string[] = [];` at the top of `runUpgrade` alongside the other arrays.

**5b. Cutover detection** — add after the CANON_OWNED loop (before the `.canon/version` block at line ~224):

```ts
const DOCS_REFS_CHECK_REL = 'scripts/docs-refs-check.mjs';
const DOCS_REFS_CONFIG_REL = 'scripts/docs-refs-config.mjs';

const checkerProjectPath = join(cwd, DOCS_REFS_CHECK_REL);
const configProjectPath = join(cwd, DOCS_REFS_CONFIG_REL);
const checkerOnDisk = existsSync(checkerProjectPath)
  ? readFileSync(checkerProjectPath, 'utf8') : null;
const isPreSplitShape =
  checkerOnDisk !== null &&
  !checkerOnDisk.includes('./docs-refs-config.mjs') &&
  !existsSync(configProjectPath);

if (isPreSplitShape) {
  // Remove the checker script from pending writes this run.
  const idx = pending.findIndex(op => op.rel === DOCS_REFS_CHECK_REL);
  if (idx !== -1) pending.splice(idx, 1);
  cutoversDeferred.push(DOCS_REFS_CHECK_REL);

  // Queue the config scaffold through the same pending machinery
  // so --check / dirty-refusal / --force / --no-stage stay uniform.
  const configTemplatePath = join(pkgDir, 'templates', DOCS_REFS_CONFIG_REL);
  if (existsSync(configTemplatePath)) {
    const content = readFileSync(configTemplatePath, 'utf8');
    pending.push({ rel: DOCS_REFS_CONFIG_REL, projectPath: configProjectPath, content });
  }
}
```

**5c. Update `upgradeCmd`** to print the cutover message when `cutoversDeferred` is non-empty. Add a new section in BOTH the `--check` branch (after `wouldUpgrade`) and the normal-run branch (after `upgraded`):

```ts
if (result.cutoversDeferred.length > 0) {
  console.log('Migration required (upgrade deferred for these files):');
  for (const f of result.cutoversDeferred) console.log(`  ⚡ ${f}`);
  console.log('');
  console.log('  A new scripts/docs-refs-config.mjs has been scaffolded (see "Updated" above).');
  console.log('  Move any custom NOISY_SOURCE_PATHS, VALID_DIRS, or MARKDOWN_ROOT_DIRS entries');
  console.log('  from your current scripts/docs-refs-check.mjs into scripts/docs-refs-config.mjs,');
  console.log('  then re-run `canon upgrade` to apply the script update.\n');
}
```

**5d.** Return `cutoversDeferred` in all three `return` statements of `runUpgrade` (the `--check` path at line ~265, the dirty-refusal path at line ~272, and the write path at line ~284).

---

### Step 6 — Add tests to `tests/docs-refs-check.test.ts`

Update the import at line 7 to include the new helpers:

```ts
import { NOISY_SOURCE_PATHS, VALID_DIRS, runChecks, mergeAdopterConfig, loadAdopterConfig } from '../scripts/docs-refs-check.mjs';
```

Add the following test cases (append after existing tests):

**AC-7** (assert symbol shapes — quick smoke test, no I/O):
```ts
test('VALID_DIRS is a Set', () => {
  assert.ok(VALID_DIRS instanceof Set);
});
test('NOISY_SOURCE_PATHS is an array', () => {
  assert.ok(Array.isArray(NOISY_SOURCE_PATHS));
});
```

**AC-6** (templates NOT in bare defaults; merged result includes it):
```ts
test('bare canon defaults exclude templates from validDirs and markdownRootDirs', () => {
  const merged = mergeAdopterConfig(null);
  assert.ok(!merged.validDirs.has('templates'));
  assert.ok(!merged.markdownRootDirs.includes('templates'));
});
test('adopter config re-adds templates to both sets', () => {
  const merged = mergeAdopterConfig({ validDirs: ['templates'], markdownRootDirs: ['templates'] });
  assert.ok(merged.validDirs.has('templates'));
  assert.ok(merged.markdownRootDirs.includes('templates'));
});
```

**AC-2** (noisySourcePaths skips a dir):
```ts
test('adopterConfig.noisySourcePaths skips broken refs in that dir', () => {
  makeTempRepo(
    root => {
      writeFile(root, 'docs/guide.md', 'See `docs/archive/old.ts`.\n');
      // no docs/archive/old.ts
    },
    root => {
      const withSkip = runChecks(root, { adopterConfig: { noisySourcePaths: ['docs/archive'] } });
      assert.deepEqual(withSkip, []);
      const withoutSkip = runChecks(root, { adopterConfig: null });
      assert.equal(withoutSkip.length, 1);
    },
  );
});
```

**AC-3** (validDirs extends allowed targets):
```ts
test('adopterConfig.validDirs adds an allowed dir; missing file is reported', () => {
  makeTempRepo(
    root => {
      writeFile(root, 'docs/guide.md', 'See `infra/foo.ts`.\n');
      // no infra/foo.ts
    },
    root => {
      const withDir = runChecks(root, { adopterConfig: { validDirs: ['infra'] } });
      assert.equal(withDir.length, 1); // reported missing (dir is now valid, file absent)
      const withoutDir = runChecks(root, { adopterConfig: null });
      assert.deepEqual(withoutDir, []); // skipped (dir not in allow-list)
    },
  );
});
```

**AC-4** (markdownRootDirs extends walked dirs):
```ts
test('adopterConfig.markdownRootDirs walks an added dir and reports broken refs there', () => {
  makeTempRepo(
    root => {
      writeFile(root, 'documentation/guide.md', 'See `scripts/missing-target.ts`.\n');
    },
    root => {
      const withDir = runChecks(root, { adopterConfig: { markdownRootDirs: ['documentation'] } });
      assert.equal(withDir.length, 1);
      const withoutDir = runChecks(root, { adopterConfig: null });
      assert.deepEqual(withoutDir, []); // dir not walked
    },
  );
});
```

**AC-5** (malformed config degrades gracefully — use async test):
```ts
void test('malformed config file: loadAdopterConfig returns null without throwing', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-refs-cfg-'));
  try {
    const malformedPath = path.join(tmp, 'docs-refs-config.mjs');
    fs.writeFileSync(malformedPath, 'this is not valid javascript @@@@', 'utf8');
    const result = await loadAdopterConfig(malformedPath);
    assert.equal(result, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

void test('config exporting wrong types: loadAdopterConfig returns null', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-refs-cfg-'));
  try {
    const badPath = path.join(tmp, 'docs-refs-config.mjs');
    fs.writeFileSync(badPath, 'export const noisySourcePaths = 42;\n', 'utf8');
    const result = await loadAdopterConfig(badPath);
    assert.equal(result, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

void test('absent config: loadAdopterConfig returns null', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-refs-cfg-'));
  try {
    const result = await loadAdopterConfig(path.join(tmp, 'does-not-exist.mjs'));
    assert.equal(result, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
```

---

### Step 7 — Add tests to `tests/cli.test.ts`

These use the existing `withTempDir` helper and `runUpgrade` import already at line 8.

Add a local helper for convenience (or reuse `writeFileInDir` if it already exists in the file):

```ts
function writeIn(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}
```

**AC-8** (pre-split → scaffold config + defer checker):
```ts
test('runUpgrade: pre-split shape scaffolds config and defers checker upgrade', () => {
  withTempDir(dir => {
    // Checker exists but has no config import; config file absent.
    writeIn(dir, 'scripts/docs-refs-check.mjs', '// old checker\nexport function runChecks() {}\n');
    const result = runUpgrade(dir, packageDir);
    assert.ok(result.upgraded.includes('scripts/docs-refs-config.mjs'), 'config scaffolded');
    assert.ok(fs.existsSync(path.join(dir, 'scripts/docs-refs-config.mjs')));
    assert.ok(!result.upgraded.includes('scripts/docs-refs-check.mjs'), 'checker NOT upgraded this run');
    assert.ok(result.cutoversDeferred.includes('scripts/docs-refs-check.mjs'), 'checker in cutoversDeferred');
  });
});
```

**AC-9** (post-cutover → normal upgrade, no re-trigger):
```ts
test('runUpgrade: post-cutover shape upgrades checker normally, no cutover', () => {
  withTempDir(dir => {
    // Config exists and checker already imports it.
    writeIn(dir, 'scripts/docs-refs-config.mjs', 'export const noisySourcePaths = [];\n');
    writeIn(dir, 'scripts/docs-refs-check.mjs',
      '// import ./docs-refs-config.mjs\nexport function runChecks() {}\n');
    const result = runUpgrade(dir, packageDir);
    assert.deepEqual(result.cutoversDeferred, []);
    // Checker is upgraded normally or already up-to-date
    const checkerHandled =
      result.upgraded.includes('scripts/docs-refs-check.mjs') ||
      result.unchanged.includes('scripts/docs-refs-check.mjs');
    assert.ok(checkerHandled, 'checker handled normally');
  });
});
```

**AC-10** (`--check` with pre-split shape — reports plan, nothing written):
```ts
test('runUpgrade --check: pre-split shape reports cutover plan without writing', () => {
  withTempDir(dir => {
    writeIn(dir, 'scripts/docs-refs-check.mjs', '// old checker\nexport function runChecks() {}\n');
    const result = runUpgrade(dir, packageDir, { check: true });
    assert.ok(result.wouldUpgrade.includes('scripts/docs-refs-config.mjs'), 'config in wouldUpgrade');
    assert.ok(!fs.existsSync(path.join(dir, 'scripts/docs-refs-config.mjs')), 'nothing written');
    assert.ok(result.cutoversDeferred.includes('scripts/docs-refs-check.mjs'), 'checker deferred');
    assert.ok(!result.wouldUpgrade.includes('scripts/docs-refs-check.mjs'), 'checker not in wouldUpgrade');
    assert.deepEqual(result.upgraded, []);
  });
});
```

---

### Step 8 — Update `docs/architecture.md`

Two spots:

1. **Line ~140** (docs references row in Validation table): append to the cell — "Adopter-tunable skip-lists and dir extensions go in `scripts/docs-refs-config.mjs` (adopter-owned, survives `canon upgrade`)."

2. **Line ~159** (adopter opt-in paragraph): the sentence "Adopters can opt into the docs refs gate by adding `- run: npm run docs-refs-check`..." is fine; the next sentence should add — "To customize which dirs and skip-paths the check uses, populate `scripts/docs-refs-config.mjs` (scaffolded by `canon init`)."

---

### Step 9 — Update `docs/codebase-map.md`

In the Scripts section around line 97, add a row for the new adopter config (after the docs-refs-check row):

```md
| Docs-refs adopter config | `scripts/docs-refs-config.mjs` | Adopter-owned overlay for `docs-refs-check.mjs`; not in CANON_OWNED; survives every `canon upgrade` |
```

---

### Step 10 — Build and sync

After all source edits are staged:

1. `npm run build` — regenerates `dist/cli/index.js` from the `src/cli/commands/upgrade.ts` changes. Commit the resulting `dist/` delta alongside source changes.
2. `npm run sync-templates` — stages the auto-synced mirrors `templates/scripts/docs-refs-check.mjs` and `templates/scripts/docs-refs-check.mjs.d.ts`. The pre-commit hook runs this automatically on `git commit`, but running it beforehand allows inspection before staging.

Do NOT manually edit `templates/scripts/docs-refs-check.mjs` or `templates/scripts/docs-refs-check.mjs.d.ts`.

---

### Step 11 — Confirm AC-11 (canon-owned.ts exclusion)

After all changes, confirm `scripts/docs-refs-config.mjs` does NOT appear in `CANON_OWNED` or `DELIMITED` in `src/lib/canon-owned.ts`. No code change needed — just verify absence. Then run `npm run sync-templates:check` to confirm the new config is correctly outside the sync set.

---

## Validation Checklist

Before marking implement done, confirm all of these pass:

- `npm run lint`
- `npm run type-check`
- `npm test`
- `npm run build`
- `npm run sync-templates:check`
- `npm run docs-refs-check`

## File Change Summary

| File | Action |
|---|---|
| `scripts/docs-refs-check.mjs` | Refactor: canon defaults, exported helpers, top-level await config load, thread effective dirs |
| `scripts/docs-refs-config.mjs` | Create: canon-ai-dev's config (re-adds `templates`) |
| `templates/scripts/docs-refs-config.mjs` | Create: adopter template default (empty arrays + comments) |
| `scripts/docs-refs-check.mjs.d.ts` | Update: add `VALID_DIRS`, `AdopterConfig`, `mergeAdopterConfig`, `loadAdopterConfig` |
| `src/cli/commands/upgrade.ts` | Update: cutover detection, `cutoversDeferred`, `upgradeCmd` output |
| `dist/` | Regenerated by `npm run build` (no manual edit) |
| `templates/scripts/docs-refs-check.mjs` | Auto-synced by pre-commit hook (no manual edit) |
| `templates/scripts/docs-refs-check.mjs.d.ts` | Auto-synced by pre-commit hook (no manual edit) |
| `tests/docs-refs-check.test.ts` | Add: AC-2…AC-7 loader/merge tests |
| `tests/cli.test.ts` | Add: AC-8…AC-10 cutover tests |
| `docs/architecture.md` | Update: adopter opt-in note points to config file |
| `docs/codebase-map.md` | Add: row for `scripts/docs-refs-config.mjs` |
