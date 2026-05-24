# Plan: docs-refs-check-canon-template

> Written by: Claude | Task size: M | Tier: full

## Spec-review nit (approved_with_nits)

The reviewer flagged that AC-9b's prose could be read as allowing the new `docs-refs-check.yml` workflow to trigger on `README.md` and `templates/**`, which already trigger `ci.yml`. **Addressed in Step 8:** the workflow's `paths:` block is the strict inverse of `ci.yml`'s exclude list — it MUST NOT include `README.md`, `templates/**`, `scripts/**`, or `src/**`.

---

## Implementation Steps

Steps 1–9 build the deliverables in dependency order. Step 10 runs the gate on the real tree and repairs drift. Step 11 validates everything and confirms `dist/` is committed clean.

---

### Step 1 — Write `scripts/docs-refs-check.mjs`

Create `scripts/docs-refs-check.mjs`. The script is adapted from `tstraub89/gallery_wall`'s `scripts/docs-refs-check.mjs` (~310 LOC). Implement it in Node.js ESM, no external dependencies.

**Top of file:**
```js
#!/usr/bin/env node
/**
 * docs-refs-check.mjs
 *
 * Validates broken references in markdown docs. Adapted from
 * tstraub89/gallery_wall scripts/docs-refs-check.mjs with attribution.
 *
 * Checks four ref classes in markdown files:
 *   1. Backtick file-path refs: `path/to/file.ts`
 *   2. Symbol-in-file refs:    `SYMBOL` in `path/to/file.ts`
 *   3. Section refs:           `path.md` §"Heading Name"
 *   4. Markdown anchor links:  [text](#anchor) and [text](path.md#anchor)
 *
 * ADOPTER NOTE: Edit VALID_DIRS below after `canon upgrade` brings this
 * script to match your top-level directory layout.
 *
 * Intentionally-broken refs (forward refs to not-yet-created symbols) should
 * use a reference style that doesn't match these four patterns — e.g. plain
 * prose rather than `Symbol` in `file.ts` form.
 */
```

**`VALID_DIRS` constant (near top, after the header comment):**
```js
const VALID_DIRS = new Set([
  'src', 'scripts', 'tests', 'docs', 'public', 'tasks',
  '.github', '.canon', '.claude', '.codex', 'templates',
]);
```

**Markdown file walking logic** (AC-4):
- Collect all `.md` files under `docs/`, `tasks/` (excluding `tasks/_archive/`), `templates/`
- Also include root-level: `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `README.md`
- EXCLUDE: `node_modules/`, `dist/`, `.canon/templates/*.md` (parameterized templates), any hidden dirs not in `VALID_DIRS`
- Walk using `fs.readdirSync` + recursion; derive repo root from `import.meta.url`

**Four ref validators** (AC-2):

1. **Backtick file-path refs** — regex over each line to find `` `path/to/file.ext` `` patterns. For each match: extract first path segment; if that segment is in `VALID_DIRS`, verify `fs.existsSync(path.join(repoRoot, match))`. Error if file missing. Avoid false-positives: only flag when the first segment is in `VALID_DIRS` and the value contains a `/` or a recognized file extension.

2. **Symbol-in-file refs** — regex: `` /`([^`]+)`\s+in\s+`([^`]+)`/g ``. For each match: verify the file exists, then verify `\bSYMBOL\b` appears in the file's contents. Error if file missing or symbol not found.

3. **Section refs** — regex: `` /`([^`]+\.md)`\s+§"([^"]+)"/g ``. For each match: verify file exists, then scan its lines for a heading (`#`, `##`, etc.) with the exact text. Error if file missing or heading not found.

4. **Markdown anchor links** — regex for `[text](#anchor)` and `[text](path.md#anchor)` patterns. For same-file anchors resolve against the current file; for cross-file anchors resolve the path then check for a heading whose slug matches. Use GitHub-style slugification (lowercase, strip punctuation except `-`, replace spaces with `-`). Skip `http://`/`https://` links entirely. Error if target heading doesn't resolve.

**Output format** (AC-5): one line per broken ref on stderr: `<source-file>:<line>: <ref-text> — <error reason>`. Exit 0 when no errors; exit 1 when any error found. Print a summary line at the end: `Found N broken ref(s)` on stderr, or `All refs OK` on stdout.

**Export surface for tests**: implement the core logic in an exported async function `runChecks(repoRoot)` that returns an array of finding objects `{ file, line, ref, reason }`. The `main()` entry point calls `runChecks`, prints findings, and sets exit code. This makes Step 2's unit tests able to call `runChecks` directly without subprocess overhead for most cases.

**Known limitation** (document in header): the `\bSYMBOL\b` regex for symbol-in-file checks matches inside comments and strings — a comment like `// See OldFunctionName` would falsely satisfy a `` `OldFunctionName` in `file.ts` `` ref even if the function was renamed. Acceptable for v1; AST parsing would be required to tighten this.

---

### Step 2 — Write `tests/docs-refs-check.test.ts`

Create `tests/docs-refs-check.test.ts`. Follow the Node built-in `node:test` runner pattern used by all other test files. See `tests/run-task-validation.test.ts:1-5` for the import header; see lines 31-46 for the `fs.mkdtempSync` fixture isolation pattern.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runChecks } from '../scripts/docs-refs-check.mjs';
```

Create temp fixture directories using `fs.mkdtempSync(path.join(os.tmpdir(), 'docs-refs-check-'))`. Use `fs.rmSync(dir, { recursive: true, force: true })` in a `finally` block.

**Required test cases (AC-2):**

For each of the four ref classes, one positive + one negative:

```
backtick file-path: valid ref → 0 findings
backtick file-path: missing file → 1 finding with file:line:reason
symbol-in-file: symbol exists in file → 0 findings
symbol-in-file: symbol missing from file → 1 finding
section ref: heading exists in target md → 0 findings
section ref: heading missing from target md → 1 finding
anchor link (same-file): heading exists → 0 findings
anchor link (same-file): heading missing → 1 finding
anchor link (cross-file): heading exists → 0 findings
anchor link (cross-file): heading missing → 1 finding
```

**Required test cases (AC-5):**

```
clean fixture (no markdown files with refs) → runChecks returns [], process exits 0
fixture with one broken ref → runChecks returns 1 finding, process exits 1 when run as subprocess
```

For the exit-code tests, use `execFileSync` / `spawnSync` on `node scripts/docs-refs-check.mjs` with the fixture directory, similar to how `tests/run-task-validation.test.ts` invokes external processes.

Fixture file naming: use non-gitignored names (`fixture-target.ts`, `fixture-doc.md`, `test-source.ts`) — per `docs/patterns.md` "Porcelain-delta tests need non-gitignored fixture paths."

---

### Step 3 — Update `package.json`

Two changes (AC-6, AC-7):

1. Add `"docs-refs-check"` npm script in the `scripts` block at `package.json:17`:
```json
"docs-refs-check": "node scripts/docs-refs-check.mjs",
```
Keep all existing scripts (`build`, `postbuild`, `test`, `type-check`, `lint`) unchanged.

2. Expand `files` array from `["dist/", "templates/", "CHANGELOG.md"]` to `["dist/", "templates/", "scripts/", "CHANGELOG.md"]`.

The expanded `files` array ships ALL of `scripts/` in the npm package, including the orchestrator (`scripts/run-task/`), `scripts/task.sh`, etc. Per the spec, this is intentional — no secrets, no dev-only content, and it supports future canon-shipped utility scripts.

---

### Step 4 — Update `src/cli/commands/upgrade.ts` CANON_OWNED

In `src/cli/commands/upgrade.ts` at the `CANON_OWNED` array (lines 26-45), append one entry with a comment (AC-8):

```typescript
    // First canon-managed file outside .canon/, .claude/, and docs/pipeline-orchestrator.md.
    // Future canon-shipped utility scripts follow this same pattern.
    'scripts/docs-refs-check.mjs',
```

No other logic changes to `upgrade.ts`. The new entry inherits the existing dirty-file refusal, `--force` override, and `--check` preview behavior automatically.

This file change causes `tsup` to emit a new `dist/` bundle (Step 5).

---

### Step 5 — Build `dist/` and commit alongside `src/` change

After Step 4, run `npm run build`. The `upgrade.ts` change produces a new `dist/cli/index.js`. Commit the `dist/` deltas in the same commit as the `src/cli/commands/upgrade.ts` change.

Per `docs/architecture.md:137`: CI runs `git diff --exit-code -- dist/` and fails if `dist/` is stale. Do not commit `upgrade.ts` without its corresponding `dist/` update.

---

### Step 6 — Create `templates/scripts/docs-refs-check.mjs` (byte-identical mirror)

Create `templates/scripts/docs-refs-check.mjs` with identical content to `scripts/docs-refs-check.mjs` (AC-8b).

`runUpgrade()` at `src/cli/commands/upgrade.ts:223-242` resolves every `CANON_OWNED` entry against `pkgDir/templates/<rel>`. Without this mirror, `canon upgrade` silently no-ops for the new entry. Verify with `diff scripts/docs-refs-check.mjs templates/scripts/docs-refs-check.mjs` (must produce empty output).

Per the `feedback_canon_delimited_files_template_parallel_edit` convention: both files must change in the same commit on any future edit.

---

### Step 7 — Update `.github/workflows/ci.yml`

In the `test` job's steps, insert a new step after `npm run type-check` (line ~59) and before `npm run build` (line ~60) (AC-9):

```yaml
      - run: npm run type-check
      - run: npm run docs-refs-check      # NEW: fast static-content gate
      - run: npm run build
```

No other changes to `ci.yml` — path filters, concurrency group, matrix, and all other steps are unchanged.

---

### Step 8 — Create `.github/workflows/docs-refs-check.yml`

Create the new workflow file (AC-9b). This handles doc-only PRs that `ci.yml` skips via its path filters.

**Addressing the spec-review nit**: The `paths:` block must be the **strict inverse** of `ci.yml`'s exclude list — the entries at `ci.yml:12-20` and `26-34`. Do NOT include `README.md`, `templates/**`, `scripts/**`, or `src/**` — those paths are NOT excluded by `ci.yml` and therefore already run `npm run docs-refs-check` via the `ci.yml` step added in Step 7. Including them here would trigger double-execution.

`ci.yml`'s exclude paths (the list this workflow mirrors):
- `!AGENTS.md` → include `AGENTS.md`
- `!CLAUDE.md` → include `CLAUDE.md`
- `!CODEX.md` → include `CODEX.md`
- `!docs/**` → include `docs/**`
- `!tasks/**` (re-includes `tasks/_templates/**`) → include `tasks/**`, exclude `!tasks/_templates/**`
- `!.agent/**` → include `.agent/**`
- `!.github/**/*.md` → include `.github/**/*.md`

Full workflow file:

```yaml
name: docs-refs-check

on:
  pull_request:
    branches: [main, 'release/**', dev]
    paths:
      - 'AGENTS.md'
      - 'CLAUDE.md'
      - 'CODEX.md'
      - 'docs/**'
      - 'tasks/**'
      - '!tasks/_templates/**'
      - '.agent/**'
      - '.github/**/*.md'

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  docs-refs-check:
    name: docs-refs-check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: '24.x'
          cache: 'npm'
      - run: npm ci
      - run: npm run docs-refs-check
```

No `npm run build`, `npm test`, or smoke install — just `npm ci` + the gate. Keeps doc-only PR CI under ~30 seconds.

---

### Step 9 — Documentation updates

All four edits are doc-only; no `dist/` regeneration needed.

**9a. `docs/architecture.md` Validation table** (AC-10)

In the Validation table at lines 132-141, add a new row after "Cross-platform":

```markdown
| Docs references | `npm run docs-refs-check` (= `node scripts/docs-refs-check.mjs`) — validates broken refs in markdown docs (file paths, symbols, sections, anchor links). Required for any change touching `docs/`, `tasks/`, `templates/`, or root-level agent files; also required when source files referenced from docs are renamed or moved. |
```

**9b. `docs/architecture.md` CI section** (AC-13)

After the existing CI section body (lines 145-157), append:

```markdown
**Adopter opt-in for `docs-refs-check`**: canon does not ship `.github/workflows/` files to adopter repos. To gate on this in your own pipeline, add `- run: npm run docs-refs-check` to your CI workflow. The script ships via `canon upgrade` to `<repo>/scripts/docs-refs-check.mjs`; add `"docs-refs-check": "node scripts/docs-refs-check.mjs"` to your `package.json` `scripts` to invoke it.
```

**9c. `AGENTS.md` Validation Matrix** (AC-11)

In the Validation Matrix table (lines 273-282), add a new row:

```markdown
| Docs / markdown | Docs references check |
```

**9d. `docs/codebase-map.md`** (AC-12)

In the scripts section (around line 31-44), add a row for the new validator. If a "Validators" or "Utility scripts" section exists, add it there; otherwise add alongside the existing `scripts/` entries:

```markdown
| Docs-refs validator | `scripts/docs-refs-check.mjs` | Standalone Node ESM script: walks markdown surface, validates file-path/symbol/section/anchor refs, exits non-zero on broken refs. Canon-managed; ships to adopters via `canon upgrade`. |
```

**9e. `CHANGELOG.md`** (AC-16)

In the `[1.4.0] Added` block, add:

```markdown
- **`docs-refs-check` script + CI gate.** New utility script at `scripts/docs-refs-check.mjs` validates markdown ref hygiene (broken file paths, symbol-in-file refs, section refs, anchor links). Wired into canon-ai's own CI between type-check and test. Ships to adopters via `canon upgrade`; adopters opt in by adding `npm run docs-refs-check` to their own workflow. Originally written for `tstraub89/gallery_wall`; adapted with attribution.
```

---

### Step 10 — Run docs-refs-check; fix surfaced drift

After the script is written (Step 1), run:
```bash
node scripts/docs-refs-check.mjs
```

Inspect every finding. For each:
- Stale file path (file moved/renamed) → update the reference in the source doc.
- Stale symbol-in-file (function renamed) → update the symbol name.
- Stale section ref (heading text changed) → update the heading reference.
- Stale anchor link (slug changed) → update the anchor.

Commit all fixes as a SEPARATE commit from the implementation commit. Message: `fix(docs): repair stale refs surfaced by docs-refs-check`.

If finding count > 15: stop, append to `tasks/docs-refs-check-canon-template/notes.md` with `[implement]` prefix, and surface for human reroute decision (AC-15).

If finding count = 0: no cleanup commit needed; AC-15 is trivially satisfied.

---

### Step 11 — Final validation

Run the full suite in order:

```bash
npm run lint
npm run type-check
npm run docs-refs-check
npm test
npm run build
git diff --exit-code -- dist/
```

All must exit 0. If `git diff --exit-code -- dist/` fails: commit the new deltas (should have been caught in Step 5, but double-check). All six commands green = implementation complete.

---

## File Summary

| File | Change | Step |
|---|---|---|
| `scripts/docs-refs-check.mjs` | NEW — adapted from GP with attribution | 1 |
| `tests/docs-refs-check.test.ts` | NEW — four ref-class + exit-code tests | 2 |
| `package.json` | Add npm script + expand `files` | 3 |
| `src/cli/commands/upgrade.ts` | Add `'scripts/docs-refs-check.mjs'` to `CANON_OWNED` | 4 |
| `dist/` | Regenerated from `upgrade.ts` change | 5 |
| `templates/scripts/docs-refs-check.mjs` | NEW — byte-identical mirror | 6 |
| `.github/workflows/ci.yml` | Insert `docs-refs-check` step between type-check and build | 7 |
| `.github/workflows/docs-refs-check.yml` | NEW — doc-only PR gate | 8 |
| `docs/architecture.md` | Validation row + CI adopter paragraph | 9a, 9b |
| `AGENTS.md` | Validation Matrix row | 9c |
| `docs/codebase-map.md` | Validator row | 9d |
| `CHANGELOG.md` | `[1.4.0] Added` entry | 9e |
| Stale-ref docs (TBD at runtime) | Fix broken refs surfaced by Step 10 | 10 |

## Key Constraints

- `scripts/docs-refs-check.mjs` and `templates/scripts/docs-refs-check.mjs` must be byte-identical. Any future edit must touch both in the same commit.
- `dist/` deltas from Step 5 must be committed in the same commit as `src/cli/commands/upgrade.ts`.
- Step 10's drift-fix commit must be a SEPARATE commit from the implementation commit — keeps the PR diff readable.
- The `docs-refs-check.yml` `paths:` block is exactly the strict inverse of `ci.yml`'s exclude list: `{AGENTS.md, CLAUDE.md, CODEX.md, docs/**, tasks/** (!tasks/_templates/**), .agent/**, .github/**/*.md}`. No other paths.
