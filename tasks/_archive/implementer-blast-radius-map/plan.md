# Implementation Plan: implementer-blast-radius-map

> Written by: Claude | Implements: `tasks/implementer-blast-radius-map/spec.md`

## Approach

There are two independent additions, and both go into the implement prompts.

1. **Self-check block.** It is static text with one copy in each of the three implement templates. `implement.md` gates it behind a `{{#selfCheck}}` section so `promptImplementResume` (which calls `promptImplement(state, 'resume')`) omits it.
2. **Blast-radius block.** A new module, `src/orchestrator/blast-radius.ts`, computes a names-only block with `git grep`/`git check-attr` through `gitSafeAt`/`gitSafeAtRaw` (cwd-taking). The block is injected as `{{{blastRadiusBlock}}}` right after `{{{contextBlock}}}` in `implement.md` and `implement-reroute.md`. The block fails open: any error yields `''`.

The prompt goldens get a deterministic map from a test-only env override, `CANON_BLAST_RADIUS_ROOT`, in the `CANON_PATTERNS_MD_PATH` style. It points at a fixture git repository created in the prompts test's `before()`.

**Spec-review nit (park-resume coverage):** Step 7 adds an explicit assertion that the `promptImplementParkResume` output contains the map heading and the self-check. `promptImplementParkResume` wraps `promptImplement(state, 'fresh', …)`, so it inherits both with no code change.

### Feasibility check

- **Exists:** grep-verified:
  - `promptImplement`, `promptImplementParkResume`, `promptImplementResume`, `promptImplementRevisions`, `promptImplementReroute` in `src/orchestrator/prompts/index.ts`
  - `extractAffectedFiles` in `src/orchestrator/context.ts` (delegates to `parseAffectedFilesFromSpec` in `src/orchestrator/validation.ts`)
  - `gitSafeAt`, `gitSafeAtRaw` in `src/orchestrator/git.ts`
  - `getActiveCwd` in `src/orchestrator/worktree.ts`
  - `taskDirFor` in `src/orchestrator/state.ts`
  - `extractSectionBodies` in `src/orchestrator/markdown-table.ts`
  - `renderTemplate` (Mustache, escaping disabled) in `src/orchestrator/prompts/render.ts`
  - the golden harness `recordOrAssert`/`UPDATE_GOLDENS` in `tests/run-task-prompts.test.ts`
  - `.gitattributes` does not exist yet. `templates/.canon/`, `templates/.claude/`, and `templates/scripts/` exist.
- **Real path:** `canon run` → implement phase → `promptImplement`/`promptImplementParkResume`/`promptImplementReroute`/`promptImplementRevisions` → `render(template, view)`. `buildContextBlock` already preloads Affected File contents from `REPO_ROOT`. Nothing computes referrers today.
- **Callers:** no existing function changes its signature or error contract. `promptImplement` gains only view fields. `promptImplementResume` → `promptImplement(state,'resume')` must render neither the self-check nor the map (handled by the `mode` check).
- **Tests that can fail:** without the change, the new blast-radius unit tests fail on import (the module doesn't exist). The self-check presence/order assertions fail on current templates. The golden heading assertions fail because no block is rendered today. The park-resume assertion fails for the same reason.
- **Predicates:**
  - Token shape: empty and short tokens are rejected (minimum 3 chars after stripping `()`).
  - `linguist-generated` values: `set`/`true` exclude. `unset`, `unspecified`, `false`, and any other value keep the file.
  - `git grep` exit 1 with empty stderr means no matches, not an error.
  - The Affected File existence check uses `isFile()`. Missing files and directories are skipped for the References part.
  - Byte cap is measured with `Buffer.byteLength`.
- **Scope:** every file below is in the spec's Affected Files. `src/orchestrator/git.ts` is NOT in scope, so no stdin-capable git helper can be added. The spec's non-binding `git check-attr --stdin` note is replaced by passing paths as arguments in chunks (Step 1).
- **Async/stateful:** N/A. Everything is synchronous and stateless. The env override is read at call time.

### Recorded interpretations (unattended; see notes.md)

- `getActiveCwd` can `die()` (it calls `process.exit`) when a task worktree is expected but missing, so try/catch cannot make it fail-open. `buildKnownPitfalls` already calls `getActiveCwd(taskIds)` unguarded earlier in the same view object, so the map adds no new exit path. Accepted and not worked around.
- PascalCase means at least two humps (`PipelineState`). A single capitalized word (`Widget`) is not searched, because it is too generic and the noise would be high.
- The revision prompt's "per-round steps" are the `{{#hasReviewFindings}}`/`{{#hasPreflightFindings}}` sections. The self-check goes immediately before them and renders unconditionally.

## Steps

### Step 1: New module `src/orchestrator/blast-radius.ts`

Files: `src/orchestrator/blast-radius.ts`

Exports:

```ts
export const BLAST_RADIUS_ROOT_ENV = 'CANON_BLAST_RADIUS_ROOT'; // test-only override
export const BLAST_RADIUS_HEADING = '## Blast Radius (files outside Affected Files to check)';
export const BLAST_RADIUS_FRAMING = 'These files sit outside the spec\'s Affected Files. They are surfaces to check during the restatement sweep and sibling-parity self-checks, not a scope allowance: editing any of them still requires recording a Blocker in handoff.md instead of making the edit.';
export const PER_ENTRY_LIMIT = 10;
export const TOKEN_CAP = 20;
export const BYTE_CAP = 6144;

export function extractSpecTokens(specMarkdown: string): { amendment: string[]; design: string[]; ac: string[] };
export function buildBlastRadiusBlock(taskIds: string[], root: string): string;
export function resolveBlastRadiusRoot(taskIds: string[]): string; // env override ?? getActiveCwd(taskIds)
```

`buildBlastRadiusBlock` wraps its entire body in `try { … } catch { return ''; }` (AC-8).

**1a. Inputs.**
- `affected = union over taskIds of extractAffectedFiles(id)`. This is the only Affected Files source (AC-3).
- Spec text per task: `fs.readFileSync(path.join(taskDirFor(id), 'spec.md'), 'utf8')`. If the read fails, that task contributes no tokens.
- `dirEntries = affected.filter(f => f.endsWith('/'))`.
- `isExcluded(p) = affected.includes(p) || dirEntries.some(d => p.startsWith(d)) || p.startsWith('tasks/')`.

**1b. Git availability.** `gitSafeAt(root, 'rev-parse', '--is-inside-work-tree')`. If that is not ok, or stdout is not `'true'`, return `''`. A non-git dir or a missing root returns `''` here; a `spawnSync` error yields `ok:false` and also returns `''`.

**1c. Grep helper.** It runs `gitSafeAtRaw(root, 'grep', '-l', '-I', '-z', ...modeFlags, '-e', pattern)`.
- If ok: split stdout on `'\0'` and filter out empty strings.
- If `!ok && stderr === ''`: no matches, return `[]`.
- If `!ok && stderr`: throw. The outer catch omits the whole block (AC-8 "a git command fails").

Always pass the pattern via `-e` so flag tokens like `--dry-run` aren't parsed as options. `git grep` searches tracked files only. Do NOT use the REPO_ROOT-bound `git()`/`gitSafe()` (AC-9).

**1d. References part** (for each `f` of `affected`, in spec order, skipping dir entries):
- Only if `fs.statSync(path.join(root, f), { throwIfNoEntry: false })?.isFile()`.
- File-name match: `grep(['-F', '-w'], path.basename(f))`. `-w` keeps `barfoo.ts` and `foo.tsx` out.
- Stem match, unless the stem is in `GENERIC_STEMS = new Set(['index', 'types'])`: `grep(['-E'], `/${escapeEre(stem)}(\\.[A-Za-z0-9]+)?['"\`]`)`, where `stem = path.basename(f, path.extname(f))`. This catches `'./foo.js'`, `"../lib/foo"`, and `` `./foo` ``, but not the bare word `foo` (AC-3 negative). `escapeEre` escapes `\ . [ ] ( ) * + ? ^ $ | { }`.
- Union the two lists, drop `isExcluded` paths, sort, and dedupe. The entry label is `` `f` ``.

**1e. Identifiers part.**
- Tokens: call `extractSpecTokens` for each task, then merge across tasks by tier: all tasks' amendment tokens, then all Design, then all AC. Dedupe on first occurrence and truncate to `TOKEN_CAP` (AC-6, so amendment tokens win).
- Search per token: identifiers use `grep(['-F', '-w'], name)` with the trailing `()` already stripped, so the call site `parseWidget(x)` matches. Flags use `grep(['-F', '-w'], '--dry-run')`.
- Drop excluded paths. Entry label is the token as written in the spec, minus the `()`.

**1f. `extractSpecTokens(md)`.**
- Section bodies come from `extractSectionBodies` in `src/orchestrator/markdown-table.ts`:
  - amendment: `/^## Amendment\b/`, then `.reverse()` so the newest comes first;
  - design: `/^## Design\b/`;
  - ac: `/^## Acceptance Criteria\b/`.
- Within each body, scan `` /`([^`\n]+)`/g ``. For each captured `t`:
  - Flag shape: `/^--[a-z0-9][a-z0-9-]*$/` keeps `t` as is.
  - Otherwise strip one trailing `()` into `name` (`hadParens`). Keep it if `name.length >= 3` and `/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)`, and one of these holds: `hadParens`, `/[a-z0-9][A-Z]/` (camelCase or multi-hump PascalCase), or `/[A-Za-z0-9]_[A-Za-z0-9]/` (snake_case or SCREAMING_SNAKE).
  - Rejected examples: `lib/foo.ts` (charset), `true` (no shape), `Widget` (single hump).
- Dedupe within each tier.

**1g. Exclude generated files (AC-5).** Collect the union of candidate paths from 1d and 1e after `isExcluded`. Run `gitSafeAtRaw(root, 'check-attr', '-z', 'linguist-generated', '--', ...chunk)` in chunks of 200. With `-z`, the output is `path\0attr\0value\0` triples. Collect paths whose value is `set` or `true`, then remove them from every entry. Stdin isn't available because `gitSafeAt*` uses `stdio: ['ignore', …]` and `src/orchestrator/git.ts` is out of scope. A failed check-attr throws, so the block is omitted.

**1h. Render.**
- Drop entries with zero files. If both parts are empty, return `''` (AC-8).
- Entry line: `` - `<label>`: `p1`, `p2`, … `` with at most `PER_ENTRY_LIMIT` paths, then `, +N more` when there are more (AC-6).
- Layout:
  ```
  \n## Blast Radius (files outside Affected Files to check)\n\n<FRAMING>\n\n
  ### Files referencing Affected Files\n<entries>\n\n            (omit subsection if empty)
  ### Files containing spec-named identifiers\n<entries>\n\n    (omit subsection if empty)
  ```
  This matches the leading and trailing `\n` convention of `buildKnownRisks`.
- Byte cap: build the output incrementally and reserve room for the truncation line `` - … N more entries omitted to stay under the size limit. ``. When adding the next entry (and its subsection header, if needed) would push `Buffer.byteLength` over `BYTE_CAP - reserve`, stop and count every remaining entry in both parts as dropped. Then append the truncation line. Assert in tests that the final `Buffer.byteLength(block) <= BYTE_CAP`.

**1i. `resolveBlastRadiusRoot(taskIds)`.** Returns `process.env.CANON_BLAST_RADIUS_ROOT || getActiveCwd(taskIds)` (AC-9).

Imports: `fs`, `path`, `gitSafeAt`/`gitSafeAtRaw` from `./git.js`, `extractAffectedFiles` from `./context.js`, `taskDirFor` from `./state.js`, `extractSectionBodies` from `./markdown-table.js`, `getActiveCwd` from `./worktree.js`. `context.ts` already imports from `worktree.ts` and `state.ts`, so this adds no new cycle. Do not import from `prompts/`.

Source comments may name canon-ai paths. Rendered strings (heading, framing, subsection headings, truncation line) must not contain `src/`, `scripts/`, `tests/`, `templates/`, `Codex`, or `Claude` (AC-2).

### Step 2: Self-check text in the three templates

Files: `src/orchestrator/prompts/templates/implement.md`, `src/orchestrator/prompts/templates/implement-reroute.md`, `src/orchestrator/prompts/templates/implement-revisions.md`

Use this text verbatim, one copy per template. For implement-revisions only, the first sentence's timing clause reads "after you make this round's changes and before you re-run validation and append to handoff.md":

```
**Pre-handoff self-check** — after you make your changes and before you run validation and write handoff.md, check the change in this order:
1. **Test integrity.** For each test this pass added or changed to pin new or altered behavior: would it fail if the change were reverted? Does it assert the specific reason — the message, value, or state the change produces — rather than only that something failed or passed? Regenerated snapshots and pure fixture updates are exempt. Where a cheap run against the base commit confirms the failure, do it. A red-first regression-test AC still follows the red-first checkpoint; this check does not replace it.
2. **Restatement sweep.** For every contract the change alters — an operator-facing string, flag, format, heading, verdict, or config key — search the repository for other places that state the same contract, and bring them in line.
3. **Sibling parity.** For every guard, check, or branch the change adds, find the parallel paths that handle the same input — other commands, modes, entry points, or platform variants — and confirm each one either gets the same treatment or deliberately does not.

If a check finds an edit needed in a file outside the spec's Affected Files, do not make it: record it under Blockers in handoff.md.
```

Placement:
- `implement.md`: insert `{{#selfCheck}}…{{/selfCheck}}` (block plus a trailing blank line) immediately before line 42, `Run ALL applicable validation checks before writing handoff.` Put the opening/closing tags on their own lines (Mustache standalone tags) so resume output has no stray blank lines. Diff the regenerated `promptImplement_fresh` golden to confirm the spacing.
- `implement.md` line 5: `{{{risksBlock}}}{{{pitfallsBlock}}}{{{contextBlock}}}{{{blastRadiusBlock}}}`.
- `implement-reroute.md`: insert the block (unconditional) between `{{{groundingRule}}}` and `**How to approach this:**`, so it precedes step 6, `Re-run ALL applicable validation checks`. Do not renumber the list. Line 7 becomes `{{/startup}}{{{risksBlock}}}{{{pitfallsBlock}}}{{{contextBlock}}}{{{blastRadiusBlock}}}`.
- `implement-revisions.md`: insert the block (unconditional) after `{{{affectedFilesBlock}}}` and before `{{#hasReviewFindings}}` (line 8). There is no map placeholder here.

The text must not change `toResumePrompt`'s stripped startup block. It sits outside `{{{startup}}}`, and the `promptImplementReroute_resumed` golden will show it present.

### Step 3: Wire the view fields in `src/orchestrator/prompts/index.ts`

Files: `src/orchestrator/prompts/index.ts`

- Import `buildBlastRadiusBlock` and `resolveBlastRadiusRoot` from `../blast-radius.js`.
- `promptImplement`: add `selfCheck: mode === 'fresh'` and `blastRadiusBlock: mode === 'fresh' ? buildBlastRadiusBlock(taskIds, resolveBlastRadiusRoot(taskIds)) : ''`. Park-resume inherits both via `promptImplement(state, 'fresh', …)`. Resume gets neither (AC-1, AC-10).
- `promptImplementReroute`: add `blastRadiusBlock: buildBlastRadiusBlock(taskIds, resolveBlastRadiusRoot(taskIds))` for both `isResumedSession` values.
- `promptImplementRevisions`: no new fields (the block is static text in its template).

### Step 4: `.gitattributes`

Files: `.gitattributes` (new)

```
# Generated output: excluded from the implement prompt's blast-radius map and collapsed in diffs.
dist/** linguist-generated
templates/.canon/** linguist-generated
templates/.claude/** linguist-generated
templates/docs/pipeline-orchestrator.md linguist-generated
templates/scripts/** linguist-generated
```

Do not mark the other `templates/docs/*` (init scaffolds). Verify (AC-11):

```
git check-attr linguist-generated dist/cli/index.js templates/.canon/templates/spec.md templates/docs/patterns.md
```

Expect `set`, `set`, `unspecified`.

### Step 5: Docs

Files: `docs/pipeline-orchestrator.md` (root only; the pre-commit hook or `npm run sync-templates` writes `templates/docs/pipeline-orchestrator.md`), `docs/codebase-map.md`

- `docs/pipeline-orchestrator.md`: add a short paragraph near the `MAX_CONTEXT_BYTES` row's context. The suggested spot is after the Environment Variables table, or as a sentence in §"Per-Iteration Prompt Slimming" preamble; the implementer picks. Content (AC-12): the fresh and reroute implement prompts list tracked files that reference the Affected Files and files containing identifiers named in the spec, names only and capped. Tracked generated output is excluded only when it is marked `linguist-generated` in `.gitattributes`. Task artifacts under `tasks/` are always excluded. This is an adopter-facing doc, so don't cite canon-ai `src/` paths. Then run `npm run sync-templates` and `npm run sync-templates:check`.
- `docs/codebase-map.md`: add a row after "Task context extractors": `| Blast-radius map | src/orchestrator/blast-radius.ts | buildBlastRadiusBlock() — referrers of Affected Files and spec-named identifiers for implement prompts (git grep, fail-open) |` (format paths/symbols in backticks like neighboring rows).

### Step 6: Unit tests `tests/blast-radius.test.ts`

Files: `tests/blast-radius.test.ts` (new)

Fixture helper:
- `mkdtemp` a repo dir and init it with `execFileSync('git', ['init', '-q'], { cwd })` (pattern from `tests/canon-guard.test.ts:95`).
- Write the files and run `git add -A`. No commit is needed because `git grep` reads the index.
- `mkdtemp` a tasks dir with `<id>/spec.md` and `<id>/status.json` (`worktree: false`), and set `process.env.CANON_TASKS_DIR_OVERRIDE` to it so `extractAffectedFiles`/`taskDirFor` read the fixture spec. Restore it in `afterEach`/`finally`.
- Specs need `## Design` → `### Affected Files` table rows in backticks.

Tests:
- **AC-3:** Affected Files `lib/foo.ts` and `lib/bar.ts`. Tracked files:
  - `lib/a.ts` with `import x from './foo.js'`;
  - `app/b.ts` with `from '../lib/foo'`;
  - `docs/x.md` mentioning `foo.ts`;
  - `docs/plain.md` containing only `foo is a word`;
  - `lib/bar.ts` importing `./foo.js`.

  Assert the References part lists `lib/a.ts`, `app/b.ts`, and `docs/x.md`, and does not list `docs/plain.md`, `lib/foo.ts`, or `lib/bar.ts`. Scope the assertions to the References subsection text, slicing between the two `### ` headings.
- **AC-4:** spec Design mentions `` `parseWidget()` `` and `` `--dry-run` ``, `` `lib/foo.ts` ``, and `` `true` ``. An `## Amendment` section mentions `` `amendOnlyToken` ``. Affected Files includes a dir entry `vendor/`. Tracked files:
  - `src/use.ts` with `parseWidget(x)`;
  - `docs/cli.md` with `--dry-run`;
  - `vendor/w.ts` with `parseWidget`;
  - `docs/am.md` with `amendOnlyToken`;
  - `docs/t.md` with `true`.

  Assert `parseWidget`, `--dry-run`, and `amendOnlyToken` entries list the right files, `vendor/w.ts` is absent, there is no entry labeled `true` or `lib/foo.ts`, and `docs/t.md` is absent. Also unit-test `extractSpecTokens` directly for the shape filter and for amendment-newest-first order across `## Amendment` and `## Amendment Round 2`.
- **AC-5:** two files contain `parseWidget`. `.gitattributes` has `gen/out.js linguist-generated`, and `tasks/x/spec.md` contains it too. Assert `gen/out.js` and `tasks/x/spec.md` are absent and `src/use.ts` is present.
- **AC-6a:** 12 files contain `manyHits`. Assert 10 paths are listed and `+2 more` appears.
- **AC-6b:** Design and AC sections hold 25 distinct identifiers, and `## Amendment` holds `lateAmendToken`, which is also present in a tracked file. Assert `lateAmendToken` gets an entry and the identifier entry count is ≤ `TOKEN_CAP`.
- **AC-6c:** 20 tokens, each matching 10 files with long paths (for example `deep/nested/directory/structure/file-NN-padding.ts`), so the uncapped block is well over 6 KB. Assert `Buffer.byteLength(block) <= BYTE_CAP` and that it matches `/- … \d+ more entries omitted to stay under the size limit\./`.
- **AC-8:** an empty fixture repo with a spec that has no matches returns `''`. A non-git `mkdtemp` dir returns `''` and does not throw. A root path that doesn't exist also returns `''`.
- **AC-9:** two fixture repos, where only repo B contains the referrer. Pass B's path and assert it is listed. Pass A's path and assert `''`. The test's process cwd is canon-ai, so this proves that `root`, not `REPO_ROOT`/cwd, is searched.
- **AC-2 (framing half):** assert `BLAST_RADIUS_HEADING`, `BLAST_RADIUS_FRAMING`, and the subsection and truncation strings contain none of `src/`, `scripts/`, `tests/`, `templates/`, `Codex`, `Claude`.

### Step 7: Prompt tests and goldens `tests/run-task-prompts.test.ts`

Files: `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json`

- In `before()`, create a fixture git repo (`git init -q`, write `docs/widget.md` containing `fixtureWidget`, then `git add -A`). Set `process.env.CANON_BLAST_RADIUS_ROOT` to it. In `after()`, delete the env var and `rmSync` the dir.
- Add a `## Design` section (no Affected Files table) to `goldenTemplate` with one line: `` The fixture calls `fixtureWidget()`. ``. Keep the existing H2 `## Affected Files` as is, so `buildContextBlock` keeps preloading nothing from canon-ai's tree. Normalizing the fixture path isn't needed because the block lists only repo-relative paths.
- **AC-1 tests:** define `SELF_CHECK = '**Pre-handoff self-check**'`. Then:
  - Fresh `promptImplement(baseState)`: `indexOf(SELF_CHECK)` is ≥ 0 and less than `indexOf('Run ALL applicable validation checks')`. Inside the block, `Test integrity` < `Restatement sweep` < `Sibling parity`, and it contains `record it under Blockers in handoff.md`.
  - Reroute `promptImplementReroute(rerouteState)`, plus the resumed variant: the block comes before `Re-run ALL applicable validation checks`.
  - Revisions `promptImplementRevisions(iterState, [], 'main')`: the block comes before `Tasks with new review feedback:`. Also check a preflight-state variant if a fixture state exists; otherwise skip.
  - `promptImplementParkResume(baseState)` contains it.
  - `promptImplementResume(baseState)` does not.
- **AC-2:** for `provider` `mixed` and `claude`, extract the self-check block from each rendered prompt (slice from `SELF_CHECK` to `in handoff.md.` inclusive) and assert none of the six forbidden substrings appear. The existing "never contains Codex" loop over Claude prompts must keep passing.
- **AC-7/AC-10:**
  - Assert `goldens.promptImplement_fresh` and `goldens.promptImplementReroute` include `BLAST_RADIUS_HEADING`, `BLAST_RADIUS_FRAMING`, and `docs/widget.md`.
  - `goldens.promptImplementRevisions` excludes the heading.
  - `promptImplementResume(baseState)` excludes it.
  - **Nit fix:** `promptImplementParkResume(baseState)` includes the heading and `docs/widget.md`.
- Regenerate with `UPDATE_GOLDENS=1 npm test`, then run plain `npm test` again and confirm the second run passes unchanged (AC-10/AC-13). Review the golden diff: every implement key changes (self-check, plus map for fresh/reroute). Non-implement keys should not change. If one does, the `## Design` fixture line leaked somewhere unexpected, so investigate before accepting.

### Step 8: Build and validate

Files: `dist/` (rebuilt)

Run `npm run build` (the templates are bundled into `dist/`), then:

```
npm run type-check && npm run lint && npm test && npm run docs-refs-check && npm run sync-templates:check
```

Check that `git diff --stat dist/` shows only the rebuilt bundle.

## Risks / review focus

- **Mustache standalone-tag whitespace** in `implement.md`: resume output must not gain blank lines. The golden diff for the resume path, which goes through the existing tests, shows it.
- **`git grep -w` with flag tokens** matches `--dry-run-foo` too, because `-` is a non-word char. This is accepted noise and is documented in a source comment.
- **Path quoting:** use `-z` everywhere so paths with spaces or unicode aren't C-quoted.
- **Performance:** at most 20 identifier greps plus 2 greps per Affected File, plus chunked check-attr. All of it is bounded.
