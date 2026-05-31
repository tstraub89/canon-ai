# Plan: adopter-gitignore-sync

> Written by: Claude

## Nits addressed (from spec-review `approved_with_nits`)

1. **Stale `Docs Impact` reference** — `docs/pipeline-orchestrator.md` appears as a candidate in the spec's Docs Impact section despite AC-12 explicitly excluding it. Implementation must not touch that file.
2. **`templates/.gitignore` in `ADOPTER_SHIPPED_PATHS`** — plan includes adding `'templates/.gitignore'` to the `ADOPTER_SHIPPED_PATHS` array in `tests/cli.test.ts` (Step 8f).

---

## Step 1 — Create `src/lib/canon-block.ts` (AC-1, AC-2)

**File**: `src/lib/canon-block.ts` (new)

Export three things:

### 1a. `CANON_GITIGNORE_BLOCK` constant (AC-2)

```
# canon:start
# This block is managed by canon. Edits are overwritten on `canon upgrade`.
tasks/**/.canon-pid
tasks/**/.canon-run.log
tasks/**/.heartbeat.json
# canon:end
```

The constant must end with a trailing newline. Use `tasks/**/` (not `tasks/*/`) — survives the `tasks/<id>/ → tasks/_archive/<id>/` rename.

### 1b. `upsertCanonBlock(content: string, block: string): string | null` (AC-1)

Pure string function — no I/O, no throws.

**Marker line rule** (exact anchoring from AC-1):
- Start marker regex: `/^[ \t]*# canon:start[ \t]*$/m`
- End marker regex: `/^[ \t]*# canon:end[ \t]*$/m`

A line like `# canon:start is canon's marker` does NOT match (trailing non-whitespace content).

**Implementation approach**: split on `\n`, iterate to find marker lines by index, then slice/rejoin. This avoids regex-replace off-by-one on newlines.

**Four cases** (in order):
1. Both start and end markers found (start index < end index): replace lines from start-marker-line through end-marker-line inclusive with the lines of `block`. Preserve lines before start-marker and lines after end-marker verbatim. Return rejoined string.
2. Start marker found but no end marker found after it (malformed): return `null`.
3. No start marker (end marker may exist anywhere — treated as adopter content): append `block` to `content`. If `content` is non-empty and doesn't already end with a blank line, insert one blank separator line between content and block. Return the combined string.
4. `content` is empty/falsy: return `block` directly.

**Split/join note**: work with `content.split('\n')` and `block.trimEnd().split('\n')` so there is no double-trailing-newline. Final result must end with exactly one `\n`.

### 1c. `extractCanonBlock(content: string): string | null` (AC-14)

Exported helper. Given file content, find the `# canon:start` … `# canon:end` region (inclusive of both marker lines) and return it as a string (with trailing newline). Returns `null` if absent or malformed (start without end). Used by the AC-14 root-`.gitignore` self-hosting guard test.

Reuse the same marker-finding logic from `upsertCanonBlock` (extract a shared `findMarkerLines(lines: string[]): { startIdx: number; endIdx: number } | null | 'malformed'` private helper if that keeps the code clean — but do not export it).

---

## Step 2 — Update root `.gitignore` (AC-6)

**File**: `.gitignore` (canon-ai-dev's own)

The three runtime patterns currently appear at lines 28–34 with a multi-line hand-added comment block above them. Replace the comment+patterns block with `CANON_GITIGNORE_BLOCK` exactly.

**Lines to remove** (the comment starting at "# Runtime liveness signal..." through `tasks/**/.canon-run.log`):
```
# Runtime liveness signal written by the orchestrator every 30s; see
# scripts/run-task/heartbeat.ts. Never committed — staleness is the signal
# that the orchestrator is dead, so a stale file in CI would be misleading.
# Glob is `tasks/**/...` rather than `tasks/*/...` so files survive the
# tasks/<id>/ → tasks/_archive/<id>/ rename that shipTasks performs at
# task completion; the one-level pattern would otherwise stop matching
# after archiving and stale runtime files could be committed into the
# archive directory. (Codex PR #113 P2.)
tasks/**/.heartbeat.json
# Detached orchestrator state — see scripts/run-task/detach.ts.
# .canon-pid:     PID of a running detached orchestrator (one line).
# .canon-run.log: combined stdout + stderr of the detached run; can grow.
# Both are runtime-only; nothing committed depends on them.
tasks/**/.canon-pid
tasks/**/.canon-run.log
```

**Replace with**:
```
# canon:start
# This block is managed by canon. Edits are overwritten on `canon upgrade`.
tasks/**/.canon-pid
tasks/**/.canon-run.log
tasks/**/.heartbeat.json
# canon:end
```

Everything else in root `.gitignore` (`node_modules`, `build`, `.env`, `*.log`, `# Pipeline scratch` section, etc.) stays untouched.

**Post-edit verify**: `grep -c 'tasks/\*\*/\.canon-pid' .gitignore` must return `1`.

---

## Step 3 — Create `templates/.gitignore` (AC-6, AC-7)

**File**: `templates/.gitignore` (new)

Content is exactly `CANON_GITIGNORE_BLOCK` (with trailing newline, nothing else). This is block-only — no general ignores.

---

## Step 4 — Update `src/cli/commands/init.ts` (AC-3)

**File**: `src/cli/commands/init.ts`

### 4a. Add imports

```ts
import { readFileSync } from 'fs';
import { upsertCanonBlock, CANON_GITIGNORE_BLOCK } from '../../lib/canon-block.js';
```

(`readFileSync` may already be imported — check and add only if missing. `existsSync`, `writeFileSync`, `mkdirSync` are already imported.)

### 4b. Add `.gitignore` handling after `scaffoldTemplates`

Insert immediately after the `scaffoldTemplates(cwd, templatesDir)` call (before `writeCanonVersion`):

```ts
// Ensure the canon runtime-file block is present in .gitignore.
// Not done via scaffoldTemplates (skip-if-exists means existing .gitignores
// would never receive the block); handled explicitly here.
const gitignorePath = join(cwd, '.gitignore');
const existingGitignore = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, 'utf8')
    : '';
const gitignoreResult = upsertCanonBlock(existingGitignore, CANON_GITIGNORE_BLOCK);
if (gitignoreResult === null) {
    console.warn(
        'warning: .gitignore has an unclosed `# canon:start` marker — ' +
        'add a matching `# canon:end` line manually, then re-run `canon init`.'
    );
} else if (gitignoreResult !== existingGitignore) {
    mkdirSync(dirname(gitignorePath), { recursive: true });
    writeFileSync(gitignorePath, gitignoreResult);
}
```

`dirname` is already imported from `'path'`. The malformed-block path logs a warning and continues — it does NOT abort init.

---

## Step 5 — Update `src/cli/commands/upgrade.ts` (AC-4)

**File**: `src/cli/commands/upgrade.ts`

### 5a. Add import

```ts
import { upsertCanonBlock, CANON_GITIGNORE_BLOCK } from '../../lib/canon-block.js';
```

### 5b. Add `malformed` to `UpgradeResult`

```ts
export interface UpgradeResult {
    upgraded: string[];
    unchanged: string[];
    skipped: string[];
    wouldUpgrade: string[];
    dirtyRefused: string[];
    malformed: string[];  // .gitignore with # canon:start but no # canon:end
}
```

Initialize `const malformed: string[] = []` at the top of `runUpgrade` and include it in all `return` statements (there are three: the `--check` early return, the dirty-refuse early return, and the final return).

### 5c. Add `.gitignore` step in `runUpgrade`

Place after the `.canon/version` block (line ~224), before the dirty-detection pass. This ensures the `.gitignore` `WriteOp` (if any) participates in the dirty-detection and force/check logic:

```ts
// --- .gitignore: canon runtime-file block ---
const gitignoreRel = '.gitignore';
const gitignorePath = join(cwd, gitignoreRel);
const existingGitignore = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, 'utf8')
    : '';
const desiredGitignore = upsertCanonBlock(existingGitignore, CANON_GITIGNORE_BLOCK);

if (desiredGitignore === null) {
    // Malformed block: # canon:start present, no # canon:end.
    // --force does NOT override malformed — cannot auto-resolve safely.
    malformed.push(gitignoreRel);
} else if (desiredGitignore === existingGitignore) {
    unchanged.push(gitignoreRel);
} else {
    pending.push({ rel: gitignoreRel, projectPath: gitignorePath, content: desiredGitignore });
}
```

**Empty-file edge**: `upsertCanonBlock('', block)` must return `block` (Step 1 case 4) — the `.gitignore` absent case collapses to `existingGitignore === ''`, which won't equal `desiredGitignore`, so it enters `pending`. Correct.

### 5d. Surface `malformed` in `upgradeCmd`

In the `--check` branch (around line 290), add after the `dirtyRefused` block:

```ts
if (result.malformed.length > 0) {
    console.log('Malformed (manual fix needed):');
    for (const f of result.malformed)
        console.log(`  ⚠ ${f} — \`# canon:start\` has no \`# canon:end\`; add it manually, then re-run upgrade`);
    console.log('');
}
```

In the non-check normal output (around line 330, after `skipped`), add the same block.

---

## Step 6 — Update `src/cli/commands/doctor.ts` (AC-5)

**File**: `src/cli/commands/doctor.ts`

### 6a. New exported function `checkRuntimeFilesGitignored(cwd: string): Check`

Model after `checkLocalSettingsGitignored` (line 467). Place immediately after it.

```ts
const RUNTIME_PATTERNS = [
    'tasks/**/.canon-pid',
    'tasks/**/.canon-run.log',
    'tasks/**/.heartbeat.json',
];

export function checkRuntimeFilesGitignored(cwd: string): Check {
    const label = 'runtime files .gitignored';
    const gitignorePath = join(cwd, '.gitignore');

    if (!existsSync(gitignorePath)) {
        return {
            label,
            status: 'warn',
            detail: 'no .gitignore found — run `canon upgrade` to add the canon runtime block',
        };
    }

    const lines = readFileSync(gitignorePath, 'utf8').split('\n').map(l => l.trim());
    const missing = RUNTIME_PATTERNS.filter(p => !lines.includes(p));

    if (missing.length === 0) return { label, status: 'pass', detail: 'all runtime patterns present' };

    return {
        label,
        status: 'warn',
        detail: `missing runtime pattern(s): ${missing.join(', ')} — run \`canon upgrade\` to add them`,
    };
}
```

`readFileSync` is already imported in `doctor.ts` (check — it is: line 2 has `readFileSync`). `existsSync` is also already imported.

### 6b. Register in `doctorCmd`

In `doctorCmd`'s `configChecks` array (line ~612), add after `checkLocalSettingsGitignored(cwd)`:

```ts
checkRuntimeFilesGitignored(cwd),
```

---

## Step 7 — Update `scripts/sync-canon-templates.mjs` (AC-7, AC-8)

**File**: `scripts/sync-canon-templates.mjs`

### 7a. Import block constant

Add to the existing import at line 6:

```js
import { CANON_GITIGNORE_BLOCK } from '../src/lib/canon-block.ts';
```

(`tsx` already handles `.ts` imports from `.mjs` — existing `canon-owned.ts` import at line 6 proves this.)

### 7b. Add `.gitignore` sync step in `buildSyncPlan`

After the `DELIMITED_SYNC` loop (after line ~270, before the canon-internal-leak scan pass):

```js
// --- .gitignore: constant-source model (AC-7) ---
// Source of truth: CANON_GITIGNORE_BLOCK constant. Not merged from root .gitignore.
// templates/.gitignore must equal the constant exactly.
{
    const gitignoreTargetRel = 'templates/.gitignore';
    const gitignoreTargetPath = join(repoRoot, gitignoreTargetRel);
    if (!existsSync(gitignoreTargetPath)) {
        // Absent target is drift (first-create), not an error — the constant is the source.
        plan.push({ kind: 'gitignore', sourceRel: null, targetRel: gitignoreTargetRel, nextContent: CANON_GITIGNORE_BLOCK });
    } else {
        const current = readFileSync(gitignoreTargetPath, 'utf8');
        if (current !== CANON_GITIGNORE_BLOCK) {
            plan.push({ kind: 'gitignore', sourceRel: null, targetRel: gitignoreTargetRel, nextContent: CANON_GITIGNORE_BLOCK });
        }
    }
}
```

**Do NOT** use `mergeDelimitedForSync` (HTML markers only). **Do NOT** add `.gitignore` to `DELIMITED_SYNC` or `WHOLESALE_SYNC`.

### 7c. Update `describePlanEntry` to handle `kind: 'gitignore'`

```js
if (entry.kind === 'gitignore') {
    return '[gitignore] templates/.gitignore differs from canon-block constant';
}
```

### 7d. AC-8 — no special-casing needed

The `.gitignore` block content contains no backtick refs to `scripts/run-task/` paths. The existing canon-internal-leak scan passes only over `WHOLESALE_SYNC` and `DELIMITED_SYNC` entries, not the new `gitignore` plan entries — no false positive. Codex confirms by running `npm run sync-templates:check` in the handoff.

---

## Step 8 — Update `tests/cli.test.ts` (AC-9, AC-10, AC-11, AC-14)

**File**: `tests/cli.test.ts`

### 8a. Add imports

```ts
import { upsertCanonBlock, extractCanonBlock, CANON_GITIGNORE_BLOCK } from '../src/lib/canon-block.js';
import { checkRuntimeFilesGitignored } from '../src/cli/commands/doctor.js';
```

### 8b. AC-9 — `upsertCanonBlock` unit tests (7 cases)

```
'upsertCanonBlock: empty/falsy content → returns just the block'
'upsertCanonBlock: content without marker → block appended, original preserved above'
'upsertCanonBlock: content with existing canon block → block replaced, before/after preserved'
'upsertCanonBlock: idempotent — applying twice yields the same result as once'
'upsertCanonBlock: near-miss marker line (trailing text after # canon:start) is not treated as marker'
'upsertCanonBlock: malformed block (start without subsequent end) → null'
'upsertCanonBlock: orphan end marker (no preceding start) → block appended, orphan end preserved'
```

For (c): `content = 'before\n# canon:start\nold\n# canon:end\nafter\n'`. Assert result starts with `'before\n'`, contains the new block, ends with `'\nafter\n'`.

For (e): `content = '# canon:start is canon\'s marker\nsome content\n'`. Assert result is not null (fell through to append-case) and contains original content plus the block.

For (f): `content = 'existing\n# canon:start\n# no end here'`. Assert `upsertCanonBlock(content, anyBlock) === null`.

For (g): `content = 'adopter stuff\n# canon:end\nmore stuff\n'`. Assert `upsertCanonBlock(content, block)` is not null, contains both the original content and the block appended.

### 8c. AC-10 — `checkRuntimeFilesGitignored` tests (3 cases)

Use `withTempDir`:

```
'checkRuntimeFilesGitignored: all three patterns present → pass'
'checkRuntimeFilesGitignored: .gitignore absent → warn'
'checkRuntimeFilesGitignored: one pattern missing → warn naming it'
```

For "all present": `fs.writeFileSync(path.join(dir, '.gitignore'), CANON_GITIGNORE_BLOCK)`. Assert `status === 'pass'`.

For "one missing": write `.gitignore` with only two patterns. Assert `status === 'warn'` and detail names the missing one.

### 8d. AC-11 — `runUpgrade` `.gitignore` tests (5 cases)

Each test needs a real git repo. Use `withTempDir` + `spawnSync('git', ['init'], { cwd: dir })` + `spawnSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir })`.

The `runUpgrade` call uses the real package dir: `runUpgrade(dir, packageDir)` where `packageDir = path.join(REPO_ROOT, 'dist')` or the source package dir — use `path.join(WORKTREE_ROOT, 'src', '..', '..')` → actually just pass the canon package directory. Use the existing pattern: look at how other `runUpgrade` calls in the test file are set up to find `pkgDir`.

```
(a) 'runUpgrade .gitignore: adopter without block → block inserted; appears in upgraded'
(b) 'runUpgrade .gitignore: already current → unchanged'
(c) 'runUpgrade .gitignore: dirty without --force → dirtyRefused, nothing written'
(d) 'runUpgrade .gitignore: --check on missing block → wouldUpgrade, nothing written'
(e) 'runUpgrade .gitignore: malformed (start, no end) → malformed bucket; --force does not override'
```

For (c): write `.gitignore` to disk, `git add .gitignore`, then append a character to make it dirty (working tree diverges from index).

For (e): test twice — first with default options, then with `{ force: true }`. Both must have `.gitignore` in `result.malformed` and the file must be unchanged.

Also for (e): verify that the rest of the queue still executes (create a DELIMITED file like `AGENTS.md` without the block in the temp dir, and assert it is in `upgraded` or `unchanged` even when `.gitignore` is malformed).

### 8e. AC-14 — root `.gitignore` self-hosting guard

```ts
void test('root .gitignore contains canon block matching CANON_GITIGNORE_BLOCK', () => {
    const content = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
    const extracted = extractCanonBlock(content);
    assert.equal(extracted, CANON_GITIGNORE_BLOCK);
});
```

(`REPO_ROOT` is already imported from `'../scripts/run-task/env.js'` at line 28.)

### 8f. Add `templates/.gitignore` to `ADOPTER_SHIPPED_PATHS`

In the `ADOPTER_SHIPPED_PATHS` array (~line 1447), add `'templates/.gitignore'` after `'templates/CODEX.md'` (or at the end of the template entries, before the dist entries).

---

## Step 9 — Update `tests/sync-canon-templates.test.ts` (AC-13)

**File**: `tests/sync-canon-templates.test.ts`

### 9a. Add import

```ts
import { CANON_GITIGNORE_BLOCK } from '../src/lib/canon-block.js';
```

### 9b. Extend `seedCanonFixture`

After the `DELIMITED_SYNC` seeding loop (after line ~57), add:

```ts
// Seed templates/.gitignore to the constant so the new .gitignore sync step
// doesn't fire on every existing test's exact-drift-list assertion.
writeFile(root, 'templates/.gitignore', CANON_GITIGNORE_BLOCK);
// Root .gitignore is NOT seeded — sync script reads the constant, not root.
```

### 9c. Add three new `.gitignore` sync tests (AC-13)

```
'gitignore sync: templates/.gitignore differs from constant → checkSync lists it; applySync rewrites to constant'
'gitignore sync: templates/.gitignore already equals constant → checkSync returns [], applySync is no-op'
'gitignore sync: templates/.gitignore absent → checkSync lists it (first-create); findSyncErrors returns []; applySync creates it with constant content'
```

For (a): seed fixture; overwrite `templates/.gitignore` with `'stale content\n'`; assert `checkSync(root)` includes `'templates/.gitignore'`; call `applySync(root)`; assert file content equals `CANON_GITIGNORE_BLOCK`.

For (b): seed fixture; assert `checkSync(root)` does not include `'templates/.gitignore'`; assert `applySync(root)` does not include `'templates/.gitignore'`.

For (c): seed fixture; `fs.unlinkSync(path.join(root, 'templates/.gitignore'))`; assert `checkSync(root)` includes `'templates/.gitignore'`; assert `findSyncErrors(root)` does not include any entry mentioning `.gitignore`; call `applySync(root)`; assert file exists and content equals `CANON_GITIGNORE_BLOCK`.

---

## Step 10 — Update `docs/codebase-map.md` (AC-12)

**File**: `docs/codebase-map.md`

Add an entry for the new gitignore-management surface near the `init` / `upgrade` / `doctor` CLI surface documentation. Content (exact wording to match the project's style):

> **`.gitignore` runtime block** — `src/lib/canon-block.ts` defines `CANON_GITIGNORE_BLOCK` (the `# canon:start`/`# canon:end` block for three orchestrator runtime files: `.canon-pid`, `.canon-run.log`, `.heartbeat.json` under `tasks/**/`) and exports `upsertCanonBlock` / `extractCanonBlock`. Three touchpoints: `canon init` (`src/cli/commands/init.ts`) creates/upserts on fresh adopt; `canon upgrade` (`src/cli/commands/upgrade.ts`) refreshes via the `pending` queue for existing adopters; `canon doctor` (`checkRuntimeFilesGitignored` in `src/cli/commands/doctor.ts`) warns when patterns are missing.

**Do NOT touch `docs/pipeline-orchestrator.md`** — it is in `CANON_OWNED` (editing it would require updating `templates/docs/pipeline-orchestrator.md`, which is out of scope).

---

## Step 11 — Build + validation

After all source edits:

1. `npm run lint`
2. `npm run type-check`
3. `npm test`
4. `npm run sync-templates:check` (must be clean — AC-7/AC-8)
5. `npm run docs-refs-check`
6. `npm run build` → commit updated `dist/cli/index.js` alongside source changes

---

## Implementation order

Implement in dependency order to avoid import errors mid-build:

1. `src/lib/canon-block.ts` (all other files depend on this)
2. Root `.gitignore` edit
3. `templates/.gitignore` (new)
4. `src/cli/commands/init.ts`
5. `src/cli/commands/upgrade.ts`
6. `src/cli/commands/doctor.ts`
7. `scripts/sync-canon-templates.mjs`
8. `tests/cli.test.ts`
9. `tests/sync-canon-templates.test.ts`
10. `docs/codebase-map.md`
11. Build + run all validators
