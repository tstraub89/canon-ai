# Plan: canon-docs-dedup — Eliminate templates/-root drift via sync script + pre-commit/CI gate

> Written by: Claude | Task size: M (full-tier)

## Spec-review nits incorporated

- **Nit 1 (AGENTS.md freshness)**: Step 11 explicitly includes AGENTS.md as a freshness target (inside the delimited region), not just CLAUDE.md.
- **Nit 2 (AC-7 adopter check)**: Step 8 verifies that canon's install does not add hook config to an adopter's `package.json` or create/modify the adopter's `.git/hooks/pre-commit` — framed as "pre-existing adopter hooks are untouched."
- **Notes [plan] — handoff Changes table**: All modified `templates/` files must be listed in `handoff.md`'s Changes table. The pipeline's `verifyHandoffAgainstDiff()` pre-flight (code_review entry) checks the committed diff against the handoff allow-list; unlisted templates/ files fail the gate.

---

## Architecture decisions

**Sync script language: TypeScript (`scripts/sync-canon-templates.ts`) run via `tsx`**

The spec suggests `.mjs` (following the `docs-refs-check.mjs` pattern). However, the constraint that "the sync script must import `CANON_OWNED` directly" is most cleanly satisfied by TypeScript — `tsx` is already a devDep, and the test suite already uses `tsx` for running TS scripts. Writing it as `.ts` avoids the need for a companion `.d.ts` type-declaration bridge between a `.mjs` and `src/`.

**Shared constants in `src/lib/canon-owned.ts`**

`CANON_OWNED` and `DELIMITED` are extracted from `upgrade.ts` into a new shared module. Both `upgrade.ts` and the sync script import from there, ensuring one source of truth.

**Delimiter merge logic: inline in sync script**

`mergeDelimited()` in `upgrade.ts` takes `(templateContent, projectContent)` and returns `[templateStart...canon:end] + [projectTail]`. The sync script needs the same logic with root playing the "template" role: `mergeDelimitedForSync(rootContent, templatesContent)`. Since the sync script exports pure functions for testability, inlining a ~15-line equivalent is cleaner than exposing `mergeDelimited` through the shared module.

**No module-load-time `REPO_ROOT`-derived constants**

Per `docs/patterns.md` "Module-load-time path constants that reference repo files are a test-pollution hazard" pitfall: exported functions take `repoRoot: string` as a parameter. `REPO_ROOT` is computed only inside the CLI entry block.

---

## Ordered steps

### Step 1 — Extend `CANON_OWNED` (AC-14)

**File**: `src/cli/commands/upgrade.ts` (before constants are extracted in Step 2)

Add `'scripts/docs-refs-check.mjs.d.ts'` to the `CANON_OWNED` array, immediately after `'scripts/docs-refs-check.mjs'`:

```typescript
    'scripts/docs-refs-check.mjs',
    'scripts/docs-refs-check.mjs.d.ts',
```

`CANON_OWNED` now has 17 entries. Verify by reading the array.

---

### Step 2 — Extract shared constants into `src/lib/canon-owned.ts` (NEW)

Create `src/lib/canon-owned.ts` that exports the full 17-entry `CANON_OWNED` array (including the new `'scripts/docs-refs-check.mjs.d.ts'` entry from Step 1) and the `DELIMITED` array:

```typescript
export const CANON_OWNED = [
    '.canon/README.md',
    '.claude/skills/canon-init/SKILL.md',
    '.claude/skills/canon-spec/SKILL.md',
    '.claude/skills/canon-pipeline/SKILL.md',
    '.claude/skills/canon-status/SKILL.md',
    '.claude/skills/canon-changelog/SKILL.md',
    '.canon/templates/status.json',
    '.canon/templates/spec.md',
    '.canon/templates/plan.md',
    '.canon/templates/handoff.md',
    '.canon/templates/spec-review.md',
    '.canon/templates/review.md',
    '.canon/templates/done.md',
    '.canon/templates/notes.md',
    'docs/pipeline-orchestrator.md',
    'scripts/docs-refs-check.mjs',
    'scripts/docs-refs-check.mjs.d.ts',
] as const;

// Agent files with canon:start/end delimiters — sync only the canon-owned region.
export const DELIMITED = ['AGENTS.md', 'CLAUDE.md', 'CODEX.md'] as const;
```

Update `src/cli/commands/upgrade.ts`:
- Add import at the top: `import { CANON_OWNED, DELIMITED } from '../../lib/canon-owned.js';`
- Delete the inline `const CANON_OWNED = [...]` block (currently lines 26–49) and the inline `const DELIMITED = [...]` line (currently line 21).
- Keep `CANON_END`, `CANON_START_RE`, `HEADER_ONLY_SYNC`, `mergeDelimited`, and all other logic untouched.

Verify: `npm run type-check` passes; `npm run lint` passes.

---

### Step 3 — Write `scripts/sync-canon-templates.ts` (NEW, ~180 lines)

**Exports (pure functions — no module-load-time REPO_ROOT constants):**

```typescript
export const WHOLESALE_SYNC: readonly string[]  // [...CANON_OWNED, '.codex/config.toml']
export const DELIMITED_SYNC: readonly string[]  // DELIMITED

// Returns merged content: root's canon-region + templatesContent's outside-delimiter tail.
// Mirrors upgrade.ts mergeDelimited() semantics — root plays the "template" role.
// Returns null if either file is missing the canon:start or canon:end marker.
export function mergeDelimitedForSync(rootContent: string, templatesContent: string): string | null

// Returns list of drifted paths (empty = in sync). Reads from disk; does not write.
export function checkSync(repoRoot: string): string[]

// Applies sync root → templates/. Returns list of paths that were changed.
export function applySync(repoRoot: string): string[]
```

**`mergeDelimitedForSync` implementation** (~15 lines):

```typescript
const CANON_END = '<!-- canon:end -->';
const CANON_START_RE = /<!-- canon:start[^>]* -->/;

export function mergeDelimitedForSync(
    rootContent: string,
    templatesContent: string,
): string | null {
    if (!CANON_START_RE.test(rootContent)) return null;
    if (!CANON_START_RE.test(templatesContent)) return null;
    const rootEnd = rootContent.indexOf(CANON_END);
    const templatesEnd = templatesContent.indexOf(CANON_END);
    if (rootEnd === -1 || templatesEnd === -1) return null;
    return (
        rootContent.slice(0, rootEnd + CANON_END.length) +
        templatesContent.slice(templatesEnd + CANON_END.length)
    );
}
```

**`applySync` / `checkSync` logic:**

Wholesale (for each `rel` in `WHOLESALE_SYNC`):
- Root source: `path.join(repoRoot, rel)`. If missing, warn to stderr and skip (no crash).
- Templates target: `path.join(repoRoot, 'templates', rel)`.
- Ensure parent dir exists before writing: `mkdirSync(dirname(target), { recursive: true })`.
- Compare bytes; write target only if different (`applySync`), or collect path if different (`checkSync`).

In-delimiter (for each `rel` in `DELIMITED_SYNC`):
- Read root file and templates file.
- Call `mergeDelimitedForSync(rootContent, templatesContent)`.
- If `null` returned, warn to stderr and skip.
- Compare merged result to current templates content; write or collect accordingly.

**`--check` stderr format**: one line per drifted path, e.g.:
```
[wholesale] templates/scripts/docs-refs-check.mjs differs from scripts/docs-refs-check.mjs
[delimited] templates/AGENTS.md in-delimiter region differs from AGENTS.md
```

**`--stage` mode**: calls `applySync(REPO_ROOT)`, then for each modified path calls `spawnSync('git', ['add', templatesRelPath], { cwd: repoRoot })`. No-op if `applySync` returns empty array.

**CLI dispatch** (runs only when `import.meta.url === pathToFileURL(process.argv[1]).href`):
- Parse `process.argv` for `--check`, `--stage`.
- Compute `REPO_ROOT` from `import.meta.url` here (not at module load).
- Call the appropriate exported function; exit with appropriate code.

---

### Step 4 — Write `tests/sync-canon-templates.test.ts` (NEW, ~150 lines)

String-fixture based; import exported pure functions from `../scripts/sync-canon-templates.ts`.

**Required test cases per AC-6:**

1. **Wholesale sync direction**: fixture where `templates/docs/pipeline-orchestrator.md` content differs from `docs/pipeline-orchestrator.md`. `checkSync` reports the path. `applySync` produces byte-equal files. `checkSync` again → empty array.

2. **In-delimiter sync preserves outside-delimiter content**:
   - Root in-delimiter = "root-canon-content"; templates in-delimiter = "stale-content"; templates outside-delimiter = "adopter-tail".
   - `mergeDelimitedForSync(root, templates)` → result contains "root-canon-content" and "adopter-tail", does NOT contain "stale-content".
   - Root outside-delimiter = "root-tail". `mergeDelimitedForSync(root, templates)` → "root-tail" does NOT appear in result (root's outside-delimiter content is discarded).
   - Templates in-delimiter diverged → `checkSync` reports drift → `applySync` reverts in-delimiter to match root; outside-delimiter tail preserved.

3. **`--check` exit behavior**: `checkSync` returns non-empty array for drifted fixture; empty array for clean fixture.

4. **Idempotence**: `applySync` on fixture; run again → returns empty array (no paths modified).

5. **`mergeDelimitedForSync` returns null on missing markers**: root missing `<!-- canon:start -->` → null; templates missing `<!-- canon:end -->` → null.

**Regression test for pre-commit + pipeline auto-commit interaction** (spec Known Risks):

Add one integration test using a real-git fixture (follow `tests/run-task-safety.test.ts` real-git-fixture + subprocess pattern):
1. `git init` a temp dir; set up `docs/pipeline-orchestrator.md` + `templates/docs/pipeline-orchestrator.md`.
2. Install the pre-commit hook (write directly to `.git/hooks/pre-commit`).
3. Stage a change to `docs/pipeline-orchestrator.md`.
4. Run `git commit -m "test"`.
5. Assert `git log -1 --name-only` includes `templates/docs/pipeline-orchestrator.md`.

Use non-gitignored fixture filenames (e.g., `fixture-pipeline-orchestrator.md`) per `docs/patterns.md` "Porcelain-delta tests need non-gitignored fixture paths" pitfall.

---

### Step 5 — Update `package.json`

1. **Add npm scripts** (under `"scripts"`):
   ```json
   "sync-templates": "tsx scripts/sync-canon-templates.ts",
   "sync-templates:check": "tsx scripts/sync-canon-templates.ts --check"
   ```

2. **Add `simple-git-hooks` to `devDependencies`** (use `npm show simple-git-hooks version` to get current stable; add at appropriate semver range, e.g. `"^2.11.1"`).

3. **Add hook config block** (top-level key):
   ```json
   "simple-git-hooks": {
     "pre-commit": "npm run sync-templates -- --stage"
   }
   ```

4. **Add `postinstall` script** for automatic hook registration:
   ```json
   "postinstall": "npx simple-git-hooks"
   ```
   If a `postinstall` already exists, append `&& npx simple-git-hooks`.

---

### Step 6 — Run `npm install` to regenerate `package-lock.json`

```bash
npm install
```

Commit `package.json` + `package-lock.json` together (do not hand-edit the lockfile). Verify hook installed: `cat .git/hooks/pre-commit` should show the pre-commit command.

---

### Step 7 — Update `.github/workflows/ci.yml`

**Two changes:**

1. **Add the sync check step** between `npm run type-check` and `npm run docs-refs-check` (currently around line 60):
   ```yaml
   - run: npm run type-check
   - run: npm run sync-templates:check
   - run: npm run docs-refs-check
   ```

2. **Update `paths:` filters** (both `push:` and `pull_request:` blocks) so CI runs on changes to canon-managed files that are currently excluded. Use the same positive-re-include pattern as `tasks/_templates/**`.

   After the existing `- '!AGENTS.md'` / `- '!CLAUDE.md'` / `- '!CODEX.md'` lines, add:
   ```yaml
   - 'AGENTS.md'
   - 'CLAUDE.md'
   - 'CODEX.md'
   ```
   Also add `- 'docs/pipeline-orchestrator.md'` after the `- '!docs/**'` exclusion line (re-includes this specific CANON_OWNED doc so CI catches drift on doc-only pushes that bypass the hook).

   > GitHub Actions evaluates `paths:` filters in order; a trailing positive entry after a `!` exclusion re-includes it. This is identical to the `tasks/_templates/**` pattern already in this file.

---

### Step 8 — Run initial sync (AC-1 diffs)

```bash
npm run sync-templates
```

Expected diff per spec Decision > Initial sync:
- `templates/docs/pipeline-orchestrator.md` — updated (3 missing paragraphs from PRs #96/#97/#99)
- `templates/scripts/docs-refs-check.mjs` — updated (`isNoisySourceFile` 3-class vs 2-class drift from PR #101)
- `templates/scripts/docs-refs-check.mjs.d.ts` — **NEW file** (wholesale copy of root `scripts/docs-refs-check.mjs.d.ts`)
- `templates/AGENTS.md` — in-delimiter region updated (2 line changes: line 184 pedagogical example + line 275 missing validation-matrix row)
- `templates/CLAUDE.md` — no diff (pre-aligned)
- `templates/CODEX.md` — no diff (already in sync)
- All other WHOLESALE_SYNC entries — no diff

Immediately verify: `npm run sync-templates:check` must exit 0.

**Adopter verification for AC-7 nit**: verify that canon's `postinstall` and hook setup do NOT add `simple-git-hooks` config or write `.git/hooks/pre-commit` into an adopter project. Confirm by inspecting `canon init`'s template output (`src/cli/commands/init.ts`) — it walks `templates/` wholesale; `package.json` and `.git/` are not in `templates/`, so hook config never reaches adopters.

**Include ALL modified templates/ files in the handoff Changes table** (required for `verifyHandoffAgainstDiff()` to pass at code_review entry).

---

### Step 9 — Update `CLAUDE.md` (AC-12)

Add a subsection titled **"Canon-managed file convention"** under "Spec-writing rules of thumb" (or immediately after it). Content per AC-12:

- Root is the source of truth for canon-managed content. Editing a `templates/` file directly for a canon-managed path is silently overwritten by the next `--apply` run.
- Canon-managed paths are defined in `WHOLESALE_SYNC` and `DELIMITED_SYNC` in `scripts/sync-canon-templates.ts`, which imports the lists from `src/lib/canon-owned.ts`.
- The pre-commit hook (`npm run sync-templates -- --stage`) applies changes and auto-stages the `templates/` copies in the same commit as any root edit.
- CI's `npm run sync-templates:check` step is the safety net for `--no-verify` bypasses.
- New canon-managed files must be added to `CANON_OWNED` in `src/lib/canon-owned.ts` (wholesale) or `DELIMITED` (in-delimiter). The sync script picks them up automatically.
- First-time contributors must run `npm install` to register the pre-commit hook via `simple-git-hooks`.
- The corresponding `templates/CLAUDE.md` update to this paragraph rides along via in-delimiter sync in the same commit — no manual edit to `templates/CLAUDE.md` needed.

---

### Step 10 — Freshness passes: AGENTS.md, docs/codebase-map.md, docs/architecture.md

**`AGENTS.md`** (edit ONLY inside `<!-- canon:start -->...<!-- canon:end -->`):

Under "Docs Freshness" or an appropriate workflow section, add a short paragraph:
> Root is the source of truth for canon-managed content. `templates/` copies are derived via `scripts/sync-canon-templates.ts` (`npm run sync-templates`). The pre-commit hook syncs automatically; CI's `sync-templates:check` step is the safety net. New canon-managed files must be added to `WHOLESALE_SYNC` or `DELIMITED_SYNC` in that script (see `src/lib/canon-owned.ts`).

The corresponding `templates/AGENTS.md` in-delimiter update rides along via sync in the same commit.

**`docs/codebase-map.md`**:
- Register `scripts/sync-canon-templates.ts` (enforces root↔templates/ sync).
- Register `src/lib/canon-owned.ts` (shared CANON_OWNED / DELIMITED constants).
- Register `tests/sync-canon-templates.test.ts`.
- Mention `simple-git-hooks` under dev tooling / hooks.

**`docs/architecture.md`** (Validation section):
- Add `npm run sync-templates:check` — "templates sync gate; must exit 0."
- Under CI subsection, note: "sync-templates:check runs between type-check and docs-refs-check."

---

### Step 11 — Validation run

```bash
npm run lint
npm run type-check
npm run sync-templates:check     # must exit 0
npm run docs-refs-check          # must still return "All refs OK"
npm run build
npm test                         # includes tests/sync-canon-templates.test.ts
```

Manual `npm pack` check per spec Validation Required:
```bash
npm pack --dry-run
```
Verify tarball lists `templates/docs/pipeline-orchestrator.md`, `templates/scripts/docs-refs-check.mjs`, `templates/scripts/docs-refs-check.mjs.d.ts`, `templates/AGENTS.md`, `templates/CLAUDE.md`, `templates/CODEX.md` as regular files.

---

## Handoff requirements

**Changes table must include ALL of:**

| File | Change |
|---|---|
| `src/lib/canon-owned.ts` | NEW — shared CANON_OWNED + DELIMITED constants |
| `src/cli/commands/upgrade.ts` | Import from `../../lib/canon-owned.js`; delete inline CANON_OWNED + DELIMITED |
| `scripts/sync-canon-templates.ts` | NEW — sync script |
| `tests/sync-canon-templates.test.ts` | NEW — test coverage |
| `package.json` | sync-templates scripts + simple-git-hooks devDep + hook config + postinstall |
| `package-lock.json` | Regenerated by npm install |
| `.github/workflows/ci.yml` | sync-templates:check step + paths filter updates |
| `templates/docs/pipeline-orchestrator.md` | Initial sync (3 paragraphs) |
| `templates/scripts/docs-refs-check.mjs` | Initial sync (isNoisySourceFile 3-class fix) |
| `templates/scripts/docs-refs-check.mjs.d.ts` | NEW — wholesale copy of root |
| `templates/AGENTS.md` | Initial in-delimiter sync (2 line changes) |
| `templates/CLAUDE.md` | No diff expected (pre-aligned), but sync guard now covers it |
| `templates/CODEX.md` | No diff expected, but sync guard now covers it |
| `CLAUDE.md` | New "Canon-managed file convention" paragraph (AC-12) |
| `AGENTS.md` | Freshness pass — workflow note inside delimited region |
| `docs/codebase-map.md` | Freshness pass |
| `docs/architecture.md` | Freshness pass |

**`done.md` must include** (per AC-13): a memory-update todo item: "Remove or rewrite `feedback_canon_delimited_files_template_parallel_edit` in `~/.claude/projects/.../memory/` to point at the new structural gate (operator runs post-merge)."
