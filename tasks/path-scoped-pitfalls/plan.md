# Implementation Plan: path-scoped-pitfalls

> Written by: Claude | Implements: `tasks/path-scoped-pitfalls/spec.md`

## Approach

Add a new module `src/orchestrator/pitfalls.ts` with two layers:

- a **pure core**, `selectPitfalls(input)`. It takes doc texts plus a doc reader and the Affected Files, and returns the block string. Unit tests drive AC-2 through AC-10 through it with no filesystem.
- a **thin I/O wrapper**, `buildRelevantPitfalls(taskIds)`. It resolves the docs root, reads `docs/patterns.md` (or `CANON_PATTERNS_MD_PATH`) and `docs/lessons-learned.md`, unions `extractAffectedFiles(taskId)` across the bundle, and calls the core.

`promptImplement` and `promptImplementReroute` switch to the wrapper. `buildKnownPitfalls` and its `getActiveCwd` import leave `context.ts`. Park-resume inherits the change because it renders `promptImplement(state, 'fresh', …)`.

This mirrors the `blast-radius.ts` shape: a module-level test-only env constant, exported caps, and a resolver that falls back to `getActiveCwd(taskIds)`.

**Feasibility check**
- **Exists:** checked by grep: `buildKnownPitfalls` (`src/orchestrator/context.ts:70`), `extractAffectedFiles` (`context.ts:16`, delegating to `parseAffectedFilesFromSpec` in `validation.ts:1162`), `matchesDocsGlob(pattern, filePath)` (`docs-freshness.ts:173`, exported), `getActiveCwd` (`worktree.ts:40`), `BLAST_RADIUS_ROOT_ENV` pattern (`blast-radius.ts:11`), `promptImplementParkResume` (`prompts/index.ts:371`), and the golden harness (`tests/run-task-prompts.test.ts`, `before()` at ~205, `CANON_PATTERNS_MD_PATH` set at 221). `markdown-table.ts` exports no general H2/H3 section splitter usable here. `extractSectionBodies` is regex-on-H2 only, so the module writes its own small fence-aware line scanner.
- **Real path:** `runImplement` (`phases/implement.ts`) → `promptImplement` / `promptImplementReroute` / `promptImplementParkResume` → `render('implement.md' | 'implement-reroute.md', { pitfallsBlock })`. Templates already interpolate `{{{pitfallsBlock}}}` unescaped (`implement.md:5`, `implement-reroute.md:7`), so the templates do not change. Nothing on the path does relevance selection today. The old builder slices the whole Known Pitfalls H2 by regex.
- **Callers:** `buildKnownPitfalls` has exactly two callers (`prompts/index.ts:360`, `:531`) and no test references. The new function's contract matches the old one: it returns a string, `''` when empty, and lets `getActiveCwd` throw (the old code computed the path outside its `try`, so a fail-closed worktree error propagated; keep that).
- **Tests that can fail:** AC-1: the spec lists `src/a/b.ts` and the builder receives `affectedFiles=[]`. A builder that reads the prompt argument instead of `extractAffectedFiles` selects nothing and fails. AC-12: the old builder dumps the stub verbatim with the old heading, so the regenerated golden differs (the non-matching entry would appear in full). AC-13: the old builder injects everything with no title index, so the assertion that a non-matching pitfall appears only as a title line fails. Lessons on the real file: the literal spec rule selects zero lessons (see contradiction below), and the real-file lessons assertion catches it.
- **Predicates:** path-like token: contains `/` or `*`, after stripping `:N` / `:N-M`. Empty, whitespace-only, and URL tokens (`http://`, `https://`, `mailto:`) are rejected. A token with spaces is rejected (prose in backticks). Match: equality; dir prefix only when the token ends with `/`; glob only when it contains `*` (via `matchesDocsGlob(token, file)`). Leading `./` is normalized on both sides. Empty Affected Files means no matches, so the block is area index plus titles (AC-10). Section-name resolution: exact case-insensitive match first, else the shortest `startsWith`. No match means skipped, and an empty name is never a prefix.
- **Scope:** every file the steps touch is in the spec's Affected Files. The new fixture dir is `tests/fixtures/pitfalls-docs/`. `dist/` is rebuilt.
- **Async/stateful:** N/A (synchronous, pure apart from reads).

**Spec contradiction (recorded in `notes.md`, spec unchanged).** The spec excludes lesson H3s "under an H2 starting with Example". In the real `docs/lessons-learned.md`, and in the scaffold, no H2 follows `## Example entry`. Every real lesson sits under it, separated only by `---` lines, so the literal rule selects no lessons at all. **Interpretation:** an excluded H2's scope ends at the next H1/H2, or at the first `---` thematic-break line outside a fence, whichever comes first. H3s after that break are lesson entries. Step 2 implements this, AC-7's fixture mirrors the real layout, and the AC-13 test pins it on the real file.

**Spec-review nit (park-resume coverage).** Step 7 adds an assertion that `promptImplementParkResume(baseState)` contains the new heading and the matching stub entry in full. It extends the existing park-resume test rather than adding a golden.

**Choices left open by the spec** (also in notes): within a channel, demotion takes the largest entry first, with ties going to the later document position. Block heading: `## Relevant Pitfalls and Lessons (selected by spec Affected Files)`, which is distinct from the old `Known Codebase Pitfalls` heading. Env name: `CANON_PITFALLS_DOCS_ROOT`. Cap: `PITFALLS_BYTE_CAP = 24 * 1024`.

## Steps

### Step 1: Token extraction and matching primitives

Files: `src/orchestrator/pitfalls.ts` (new)

```ts
export const PITFALLS_DOCS_ROOT_ENV = 'CANON_PITFALLS_DOCS_ROOT'; // test-only, like BLAST_RADIUS_ROOT_ENV
export const PITFALLS_BYTE_CAP = 24 * 1024;
export const PITFALLS_HEADING = '## Relevant Pitfalls and Lessons (selected by spec Affected Files)';
```

- `pathTokens(text: string, docRepoPath: string): string[]`. Ignore fenced code blocks (lines between ```` ``` ```` / `~~~` fences). Collect backticked spans (`` /`([^`\n]+)`/g ``) as repo-relative paths. Collect markdown-link targets (`/\]\(([^)\s]+)\)/g`, minus any `#anchor`) resolved with `path.posix.normalize(path.posix.join(path.posix.dirname(docRepoPath), target))`. Drop targets that escape the root (start with `..`) or are URLs. Strip `:\d+(-\d+)?$`, then keep only tokens that pass `isPathLike` (contains `/` or `*`, no whitespace, not a URL). Directory tokens keep their trailing `/` after normalization (re-append it, as in `toRepoRelative` in `blast-radius.ts:63`).
- `tokenMatches(token, file)`: `token === file`, or `token.endsWith('/') && file.startsWith(token)`, or `token.includes('*') && matchesDocsGlob(token, file)`. Import `matchesDocsGlob` from `./docs-freshness.js`. Do not change it. The prefix rule stays here, per the spec's implementation note.
- `docRepoPath` for `docs/patterns.md` is always the logical `'docs/patterns.md'`, even when `CANON_PATTERNS_MD_PATH` points elsewhere. That way `[state](pitfalls/state.md)` resolves to `docs/pitfalls/state.md` (AC-3).

### Step 2: Markdown entry and section scanner

Files: `src/orchestrator/pitfalls.ts`

- `scanHeadings(markdown)`: a fence-aware line walk returning `{ level, text, start, end }` for H1–H3. `end` is the next heading of the same or higher level. A `### ` inside a fence is not a heading (AC-7).
- `knownPitfallEntries(patterns)`: the H3s between `## Known Pitfalls` and the next H1/H2. Each entry is `{ doc: 'docs/patterns.md', title, body }`, where `body` is the full H3 text including the heading line.
- `docEntries(text, docPath)`: all H3s of a linked pitfall doc.
- `lessonEntries(lessons)`: all H3s except those in an excluded scope. Excluded H2s are `How to use this doc`, `Entry format`, and any H2 starting with `Example`. **An excluded scope ends at the next H1/H2 or at the first `---` thematic-break line outside a fence** (see the spec contradiction in Approach).
- `sectionByName(patterns, name)`: over the patterns doc's H2 and H3 headings, try an exact case-insensitive match, else the shortest heading that `startsWith` the name (case-insensitive). Return the full section text (an H2 includes its H3s) or `null`.
- `tablesUnder(patterns, predicate)`: the table blocks inside the H2 whose heading starts with `Trigger Table`, plus the tables inside `## Known Pitfalls`. Reuse `scanTableBlocks` / `computeCommentHiddenLines` from `markdown-table.ts` if their signatures fit. Otherwise split rows with the local `normalizeCells` logic (export `normalizeCells` from `markdown-table.ts` only if the module needs it; that file is not in Affected Files, so prefer a local `|`-split helper that respects escaped `\|`). Skip header and separator rows. Ignore other tables, such as Quick Reference.

### Step 3: Index rows (targets and keys)

Files: `src/orchestrator/pitfalls.ts`

For each index row, detect the **target cell by content**, not by column name. Take the first cell whose `;`-split items, with parentheticals stripped by `/\([^)]*\)/g`, contain at least one resolvable target:

- a markdown doc path (a backticked `*.md` token or a link target ending `.md`) means a **linked doc**. `docs/patterns.md` itself is never a linked doc.
- `` `doc.md` §Section `` means a **doc-section target** (`{ doc, section }`). It does not make the doc linked. If `doc` is `docs/patterns.md`, resolve against the patterns text. Otherwise read the doc and resolve the section there.
- otherwise a plain section name that `sectionByName` resolves.

If no cell yields a resolvable item, the row's target cell is its first cell. It still lists in the area index with no targets resolved (Known Risks "Table variety"). **Keys** are the `pathTokens` of every other cell. A row whose keys are empty (for example `—`, prose, or only basenames) is keyless. It still appears in the area index and never matches (AC-4, AC-8).

`IndexRow = { line: string /* targets — area text */, targets: Target[], keys: string[], matched: boolean }`. `matched` is true when some key matches some Affected File.

### Step 4: Selection, dedup, and rendering

Files: `src/orchestrator/pitfalls.ts`

```ts
export type PitfallsInput = {
    patterns: string | null;          // null = missing doc
    lessons: string | null;
    readDoc: (repoPath: string) => string | null; // null = missing; never throws
    affectedFiles: readonly string[];
    cap?: number;
};
export function selectPitfalls(input: PitfallsInput): string
```

1. Build the candidate list. Each item is `{ key /* doc + start line */, doc, title, body, channel }`, with channel priority **direct < linked < section < lesson** (lower is higher priority):
   - **Direct:** Known Pitfalls entries, plus every entry of every linked doc named by *any* index row, whose `pathTokens` match an Affected File.
   - **Linked doc:** for each matched row's linked-doc target, mark the doc matched. Its non-direct entries go to the title index under a line `Open \`<doc>\` — it covers files this task touches.` The doc is read via `readDoc`, and a `null` result skips it (AC-10).
   - **Section target:** for each matched row's section and doc-section targets, add the resolved section in full.
   - **Lessons:** lesson entries with a matching token.
2. **Dedup** by span. A candidate whose span lies inside an already-selected span is dropped. Process channels in priority order, so a direct entry wins over the same H3 as a section target (AC-6). If a section-target H2 is selected and contains an H3 already selected as direct, keep the H2, drop the inner H3 from the direct list, and count it as injected (AC-6: "An H3 inside an injected H2 counts as injected"). Implement this as: after collecting all, remove any candidate whose `[start,end)` in the same doc is contained in another selected candidate's span. Every H3 contained in a selected span is excluded from the title index.
3. **Title index:** every Known Pitfalls entry and linked-doc entry not injected in full, as `- <title>`, grouped under `**<doc>**`. Matched linked docs get the "Open …" line above their group. Unmatched linked docs (AC-3: Affected File `app/src/ui/x.ts`) contribute their titles only. **Section targets from `docs/patterns.md §X` contribute no other patterns titles beyond the Known Pitfalls list** (AC-5). Lessons never enter the title index.
4. **Area index:** one line per index row in document order, `- <targets> — <area/key text>`, with ` **(matches this task)**` appended when `matched`.
5. **Render:**
   ```
   ## Relevant Pitfalls and Lessons (selected by spec Affected Files)

   <one-line framing: selected by matching spec Affected Files against paths cited in docs; titles below are the rest — open the doc when a title applies>

   ### Pitfalls and patterns that cite your files      (direct + linked + section, document order)
   <full bodies, emitted with their original heading levels>
   ### Lessons that cite your files
   ### Area index
   ### Other pitfalls (titles only)
   <truncation note, if any>
   ```
   Wrap the injected bodies in the block so they stay readable. Keep their original heading levels: the old builder also emitted raw H3s under an H2, and a raw H2 section target (for example `## Patterns`-level) can appear. Accept that. Omit any empty subsection. Return `''` when all parts are empty (AC-10). Prefix and suffix match the old builder's `\n…\n\n` framing so the surrounding template spacing is unchanged.

### Step 5: Cap and demotion

Files: `src/orchestrator/pitfalls.ts`

Measure with `Buffer.byteLength(rendered)`. While the block exceeds `cap`, demote one full entry to a title line, in channel order **lessons → section targets → linked-doc entries → direct**. Within a channel, demote the largest body first (ties: later document position). Demoted Known Pitfalls and linked-doc entries join their doc's title group. Demoted lessons and sections become `- <title> (demoted to fit)` lines in a "Demoted to fit the cap" list. Count demotions.

If nothing full remains and the block is still over: truncate the title index per file, keeping the first K titles per doc and replacing the rest with `- +N more in <doc>`. Shrink K from the max down to 0. Then truncate the area index from the end with `- +N more index rows`. Close with one note line, for example `_Pitfalls block capped at 24 KB: 3 full entries shown as titles; 12 titles and 0 index rows dropped._` (AC-9).

Re-render after each change. This is simple O(n²) work over at most a few hundred entries, which is fine.

### Step 6: I/O wrapper and wiring

Files: `src/orchestrator/pitfalls.ts`, `src/orchestrator/context.ts`, `src/orchestrator/prompts/index.ts`

```ts
export function resolvePitfallsDocsRoot(taskIds: string[]): string {
    return process.env[PITFALLS_DOCS_ROOT_ENV] || getActiveCwd(taskIds);
}
export function buildRelevantPitfalls(taskIds: string[]): string {
    const root = resolvePitfallsDocsRoot(taskIds);           // may throw, as before
    const patternsPath = process.env.CANON_PATTERNS_MD_PATH ?? path.join(root, 'docs/patterns.md');
    const affectedFiles = [...new Set(taskIds.flatMap(id => extractAffectedFiles(id)).map(normalizeRepoPath))];
    return selectPitfalls({
        patterns: readOrNull(patternsPath),
        lessons: readOrNull(path.join(root, 'docs/lessons-learned.md')),
        readDoc: repoPath => isInside(root, repoPath) ? readOrNull(path.join(root, repoPath)) : null,
        affectedFiles,
    });
}
```

- `readOrNull` catches read errors and returns `null`. Wrap the `selectPitfalls` call in `try { } catch { return ''; }`, matching the old builder's catch-all for parse failures, but keep `resolvePitfallsDocsRoot` outside the `try`.
- `isInside` rejects absolute paths and paths containing `..` (as `isSafeRepoPath` does in `context.ts`).
- Import `extractAffectedFiles` from `./context.js`. `blast-radius.ts` already does this, so it adds no import cycle: `context.ts` does not import `pitfalls.ts`.
- `context.ts`: delete `buildKnownPitfalls` (lines 70–80) and the `getActiveCwd` import at line 10 (now unused; confirm with lint).
- `prompts/index.ts`: change the import (line 9) and both call sites (360, 531) to `buildRelevantPitfalls(taskIds)`.
- Verify: `git grep -n "buildKnownPitfalls" -- src tests` is empty (AC-1).

### Step 7: Unit tests

Files: `tests/pitfalls.test.ts` (new)

Pure-core tests call `selectPitfalls` with inline fixture strings and a `readDoc` backed by a `Record<string,string>`. One `test()` per AC, with table-driven rows where cases share a shape (patterns.md "Slow Test Discipline"; no subprocesses).

- **AC-1:** a temp tasks dir via `CANON_TASKS_DIR_OVERRIDE`, a spec with `## Design` / `### Affected Files` listing `` `src/a/b.ts` ``, `CANON_PATTERNS_MD_PATH` pointing at a temp patterns doc citing it, and `PITFALLS_DOCS_ROOT_ENV` set to the temp root. Call `promptImplement(state, 'fresh', [], 'main')` and assert the entry body is present. Restore env in `finally`, as at `run-task-prompts.test.ts:549-555`.
- **AC-2:** the three entries. The first two appear in full, and `src/z/q.ts`'s entry appears as `- <title>` only (assert its body text is absent).
- **AC-3:** the glob row, the matched and unmatched cases, and the `[state](pitfalls/state.md)` link case.
- **AC-4:** a keyless linked-doc row, plus a Trigger row with `—` keys. Both appear with no Affected Files, and the matched row carries the marker.
- **AC-5:** the queue row with H2 `Queue Discipline` and H3 `Retry Rules (backoff)`, Testing vs Testing Utilities, `Mobile Rules; \`docs/pitfalls/touch.md\``, and `` `docs/patterns.md` §Testing ``, asserting no other patterns titles are added beyond the Known Pitfalls ones.
- **AC-6:** an entry that is both direct and a section target appears once (count occurrences of its body). An H3 inside an injected H2 is neither repeated nor in the titles.
- **AC-7:** the lessons fixture **mirroring the real layout**: `## How to use this doc`, `## Entry format` with a fenced `### Heading`, `## Example entry` with an example H3 citing the file, then `---`, then a real lesson H3 citing the file and one citing an unrelated path. Expect only the real matching lesson.
- **AC-8:** a table of tokens: `` `b.ts` ``, `` `runPhase()` ``, `` `true` `` never match, and `` `src/a/b.ts:12-30` `` matches.
- **AC-9:** a small `cap` override with entries in all four channels. Assert the block is ≤ the cap, demotion order (lessons gone first, direct last), and the note's count. A second case has many titles and a tiny cap and expects the `+N more in <doc>` line.
- **AC-10:** `patterns: null, lessons: null` gives `''`. A Trigger Table with no Known Pitfalls injects the section. Missing patterns plus a matching lesson injects the lesson. A missing linked doc doesn't throw. Empty affected files gives only the area and title indexes.
- **AC-11:** the wrapper with a temp root via `PITFALLS_DOCS_ROOT_ENV` holding `docs/lessons-learned.md` and `docs/pitfalls/x.md`, with `CANON_PATTERNS_MD_PATH` still honored.
- **AC-13:** the wrapper's core on the **real** `docs/patterns.md` and `docs/lessons-learned.md` (read with `fs` from the repo root) with `affectedFiles: ['src/orchestrator/git.ts']` and the default cap. Assert the heading `` ### `getAffectedFiles` uses three-dot diff semantics `` and `### Validation Gate Discipline` appear in the full-body subsection, not in the titles or demoted list. Assert the block has no truncation note. Assert at least one real lesson citing `src/orchestrator/git.ts` is selected, which pins the lessons-scope interpretation. Measured today, the selection is ~12 KB against a 24 KB cap.

### Step 8: Golden fixture and park-resume nit

Files: `tests/fixtures/patterns.stub.md`, `tests/fixtures/pitfalls-docs/docs/lessons-learned.md` (new), `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json`

- `goldenTemplate` (`run-task-prompts.test.ts:40`): change `'## Affected Files'` to `'### Affected Files'` under the existing `## Design`. Add a row `` | `fixture/widget/core.ts` | fixture change | `` (this path does not exist in canon-ai, so `buildContextBlock` and blast-radius scanning skip it). The bundle test at ~741 reuses this template, which is fine.
- `patterns.stub.md`: keep the existing stub entry. Add `### Fixture pitfall citing the widget` with a body citing `` `fixture/widget/core.ts` ``, and `### Fixture pitfall citing elsewhere` with a body citing `` `fixture/other/thing.ts` ``.
- `tests/fixtures/pitfalls-docs/docs/lessons-learned.md`: a minimal lessons file with one lesson citing `fixture/widget/core.ts`, laid out after `## Example entry` + `---` like the real file.
- In `before()`, save and set `process.env[PITFALLS_DOCS_ROOT_ENV] = path.resolve('tests/fixtures/pitfalls-docs')`. Restore it in `after()` with the same save/restore idiom as `previousBlastRadiusRoot`.
- Park-resume nit: in the existing park-resume test (~488), add `assert.ok(parkResume.includes(PITFALLS_HEADING))` and an assertion that the widget pitfall body is present.
- Regenerate: `UPDATE_GOLDENS=1 npm test`, then plain `npm test` twice. Review the golden diff. Only the `promptImplement_fresh`, `promptImplementReroute`, `promptImplementReroute_resumed` (and any implement-family keys) pitfalls blocks plus the state header's "Relevant files" line should change. Any other key changing is a bug; investigate it before accepting.

### Step 9: Docs

Files: `docs/patterns.md`, `templates/docs/patterns.md`, `.claude/skills/canon-init/write-guide.md`, `templates/.claude/skills/canon-init/write-guide.md`, `README.md`, `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md`, `docs/codebase-map.md`

- `docs/patterns.md` "How to use this doc" item 2: replace "pre-injects task-relevant pitfalls" with what actually happens. The implementer's prompt carries in full the pitfalls, the Trigger Table sections, and the lessons that cite a file in the spec's Affected Files (full path, `dir/`, or glob), plus every other pitfall title and a one-line index of the tables. So cite full repository paths in each entry.
- `templates/docs/patterns.md`: the same wording. Rewrite "Pitfall format" and "Example pitfall" so each pitfall is its own H3 whose title is the rule and whose body cites full repository paths or globs. Remove the `Browser & Platform Quirks` and `State Management` placeholder H3s. Mention the optional split-docs layout: a Known Pitfalls table `| Read this doc | Before touching |` mapping each doc to path globs. Keep the `TODO[canon]` marker. Name no canon-internal paths (`scripts/docs-refs-check.mjs` is already named as "shipped by canon"; leave that).
- `write-guide.md` (root; the hook or `npm run sync-templates` mirrors it): under `docs/patterns.md`, add that each pitfall is one H3 citing full repository paths or globs, and that split pitfall docs are indexed in a Known Pitfalls table mapping each doc to path globs. Use adopter-neutral wording.
- `README.md:62`: change the table cell to "Known Pitfalls and lessons selected by the spec's Affected Files, injected into implement prompts".
- `docs/pipeline-orchestrator.md:304`: change the `CANON_PATTERNS_MD_PATH` row to "Overrides the patterns doc the implement prompts select pitfalls from (lessons and linked pitfall docs still resolve from the docs root)." Add a row `` `CANON_PITFALLS_DOCS_ROOT` | active checkout | Test-only: root for `docs/lessons-learned.md` and linked pitfall docs in the implement prompts' pitfalls block. `` Then run `npm run sync-templates` and check that the mirror matches.
- `docs/codebase-map.md:125`: change the Patterns row to "Pitfalls, Trigger Table sections, and lessons selected by spec Affected Files and injected into implementer prompts (`src/orchestrator/pitfalls.ts`)". Add a module row for `src/orchestrator/pitfalls.ts` next to the `blast-radius.ts` row (grep for it to find the table).
- Optional per Docs Impact: `.claude/skills/canon-spec/SKILL.md` is **not** in Affected Files, so don't edit it. Leave it to QA.

### Step 10: Build and validate

`npm run build` (`dist/` is tracked, so stage it), then `npm run type-check`, `npm run lint`, `npm test`, `npm run docs-refs-check`, and `npm run sync-templates:check`. In a Claude/Codex worktree, run `npm ci` first if `node_modules` is missing.

## Testing Plan

- **Unit:** `tests/pitfalls.test.ts` covers AC-1 through AC-11 and AC-13 (Step 7), including the lessons-scope interpretation on the real file.
- **Golden:** the restructured fixture plus the docs-root override cover AC-12, and the park-resume assertion covers the spec-review nit (Step 8).
- **E2E:** none. Human Test Plan step 2 (open the implementer prompt in the run log) is the end-to-end check.

## Open Questions (unattended session; interpretations chosen)

- Lessons scope after `## Example entry` ends at the first `---` (see Approach). If the human prefers a different rule (for example "only the first H3 under an Example H2"), only `lessonEntries` and the AC-7 fixture change.
- Within-channel demotion goes largest first. This is not specified; it's an author choice.

## Reroute Plan

### Round Scope

Scope: Amendment 1 (A: Known Pitfalls index-table scope; B: target-cell precedence), AC-15 and AC-16, and the two round-3 spec gaps in `review-prior-1.md` (A and B), which the amendment supersedes. All other prior findings are already resolved in the worktree (rounds 1–2 verified addressed in `review-prior-1.md`) or are optional nits / human-decision risks (legacy H3-less Known Pitfalls stays as the spec defines it; not re-planned). Steps 1–10 of the original plan are implemented; only the index-table classifier, target-cell selection, their tests, one guidance sentence, and `dist/` change this round.

- **Exists:** grep-verified in `src/orchestrator/pitfalls.ts`: `markdownTablesInSection` (:324, returns `{ startLine, endLine, rows }`, header row discarded), `isIndexTable` (:365), `tableRowsInSection` (:374), `knownPitfallEntries` (:169, strips `indexLines` from entry bodies), `buildIndexRows` (:480, five-tuple scoring with `remainingPathKeys`), `compareTargetCellScores` (:317), `parseTargetFromItem` (:415), `parseDocPathItem` (:400), `splitTargetItems` (:449), `sectionHeading` (:158). Tests: `tests/pitfalls.test.ts` AC-4 test (:78, includes `indexAfterEntry` and `unresolvableIndex` cases), Lint/glob-key test (:106), AC-13 real-doc test (:382).
- **Real path:** `buildRelevantPitfalls` → `selectPitfalls` → `selectPitfallsInternal` → `buildIndexRows` (area index + section/linked targets) and `knownPitfallEntries` (direct-match bodies). Both route through `isIndexTable`; that is the only classifier to replace.
- **Callers:** `isIndexTable` — `knownPitfallEntries` and `tableRowsInSection` only (removed). `tableRowsInSection` — `buildIndexRows` only. `markdownTablesInSection` — those two plus nothing else; adding a `header` field is additive. `compareTargetCellScores` — `buildIndexRows` only (removed). No export changes; `selectPitfalls`/`buildRelevantPitfalls` contracts unchanged.
- **Tests that can fail:** listed per test in Step 3; each new AC-15/AC-16 case except the "exact beats prefix" fallback pin fails at HEAD (`f8af39d`). That one passes at HEAD because the current tuple already ranks exact over prefix; it is a pin, not red-first.
- **Predicates:** header hint = first header cell matching `/\b(?:sections?|docs?)\b|read this/i` (word match, case-insensitive; plurals accepted — judgment call, see below). "Section in this file", "Section / doc", "Read this doc", "Section" match; "Before touching", "Key files", "Keys", "Area", "Documentation" do not. Header with zero data rows → no rows. Hinted cell that resolves nothing → row still listed, `targets: []`. Single-cell malformed rows keep the existing `cells.length === 1` path. "Before its first H3": tables whose `startLine` is in `[H2 line, first H3 line within the H2)`; no H3 → the whole H2. A table under an H4 before the first H3 counts as index (no H3 yet).
- **Scope:** every file below is in Affected Files (`src/orchestrator/pitfalls.ts`, `tests/pitfalls.test.ts`, `.claude/skills/canon-init/write-guide.md` + its `templates/` mirror via sync, `dist/`). Goldens should not change (the stub has no tables).
- **Async/stateful:** N/A (pure, synchronous).

**Spec-review nit (dangling "AC-4 fixture's nested table" reference).** Interpretation: it means the `### Entry with an explanatory table` fixture inside the AC-4 test (`tests/pitfalls.test.ts:79`), which round 3 found was changed to a path-free table. Restore a path token there (a non-matching one, `` `src/z/q.ts` ``) so the "entry table is not an index" assertion would fail under a content classifier. Recorded in `notes.md`.

### Step R1: Classify Known Pitfalls index tables by position (Amendment A, AC-15)

File: `src/orchestrator/pitfalls.ts`

- Add `header: string[]` to `MarkdownTable`; set it from the parsed header row in `markdownTablesInSection`.
- New `knownPitfallsIndexTables(doc, section)`: `markdownTablesInSection(doc, section)` filtered to tables with `startLine < firstH3Line`, where `firstH3Line` is the `startLine` of the first level-3 heading with `start` inside `[section.start, section.end)`, or `section.endLine` if none.
- `tableRowsInSection`: Known Pitfalls sections use `knownPitfallsIndexTables`; Trigger Table sections keep every table at any depth (unchanged rule). Return tables (with headers), not flattened rows, so Step R2 can read the header per table. Drop the `readDoc` parameter.
- Delete `isIndexTable` and its comment at :381.
- `knownPitfallEntries`: drop the `indexLines` stripping and the `readDoc` parameter; entry body = `headingBody(patterns, heading)`. Index tables are now never inside an H3 span, so nothing needs stripping. Update the call site in `selectPitfallsInternal`. Run lint for newly unused params/imports.

### Step R2: Header-hint target column with fixed content fallback (Amendment B, AC-16)

File: `src/orchestrator/pitfalls.ts` (`buildIndexRows`)

Per table: `hintIndex = table.header.findIndex(cell => TARGET_HEADER_HINT.test(stripMarkdown(cell)))` (strip backticks/`*` before testing). Per row:

1. **Hint** (`hintIndex >= 0` and the row has that cell): target cell = `hintIndex`. Targets = resolved `parseTargetFromItem` items of that cell (prefix resolution allowed here). Nothing resolved → `targets: []`, row still listed.
2. **Fallback** (no hint), in order, leftmost wins within each tier:
   - (a) a cell with an item that is a doc path (`parseDocPathItem` non-null, not `docs/patterns.md`) or a `§` reference (the existing `docSection` regex in `parseTargetFromItem` — factor it into `isDocSectionItem(item)`);
   - (b) a cell with an item whose `parseTargetFromItem` result is a section/doc-section with `specificity === 2` (exact heading);
   - (c) a cell with an item that resolves by prefix (`specificity === 0`).
   No tier matches → target cell 0 with no targets (current behavior). Tier (a) is syntactic: an unreadable linked doc still wins the cell (the doc is then skipped at selection, as AC-10 requires). A `*.md` glob is not a doc path (`parseDocPathItem` rejects `*`), so it stays a key.
3. Keys = `pathTokens` of every cell except the target cell; line rendering, `matched`, and `IndexRow` unchanged.

Delete `compareTargetCellScores`, the five-tuple score, and the `remainingPathKeys` reduction. `ParsedTarget.specificity` stays (used by tiers b/c); the linked value `1` is no longer compared and can stay. Add `const TARGET_HEADER_HINT = /\b(?:sections?|docs?)\b|read this/i;` near the other constants with a one-line comment that it mirrors Amendment B.

### Step R3: Tests

File: `tests/pitfalls.test.ts`. Inline fixtures via `matchingInput` / `tablePatterns`; `readDoc` from a `Record`.

- **AC-4 test edits** (existing, :78):
  - Fixture's explanatory table row becomes `` | `src/z/q.ts` | transformed value | ``. Replace the `doesNotMatch(/source value|transformed value/)` assertion with: the `### Area index` subsection contains no `transformed value`, and `- Entry with an explanatory table` appears under the titles. Fails at HEAD: `isIndexTable` sees the path token and moves the row into the area index.
  - `indexAfterEntry`: rewrite to pin "not supported": the table after `### Existing entry` is entry content, so with Affected File `src/a/b.ts` the entry is injected in full (`EXISTING_ENTRY_BODY` present in the full-body subsection) and no area-index line for `docs/pitfalls/effects.md` appears. Remove the old trailing-index assertions.
  - `unresolvableIndex`: move the table directly under `## Known Pitfalls` (before `### Existing entry`). Header `| Area | Section | Keys |` hints column 2, so assert `- Future section — Unmapped area — \`src/a/b.ts\` **(matches this task)**`.
- **New `test('AC-15: Known Pitfalls index tables are only those before the first H3')`:**
  - `### Worker retries` with body text plus `| File | Why |` / `` | `src/queue/worker.ts` | retries re-enter | ``; Affected `src/queue/worker.ts`. Assert the full entry, including the table row, is under `### Pitfalls and patterns that cite your files`, and no area-index line contains `retries re-enter`. Fails at HEAD (table classified as index, stripped, entry shows only as a title).
  - A table directly under `## Known Pitfalls` before any H3: `| Area | Notes |` / `| Legacy area | ask the owner |`, then an H3 entry. Assert `### Area index` contains `Legacy area — ask the owner`. Fails at HEAD (no signal → dropped).
- **New `test('AC-16: target column comes from the header hint, then a fixed content precedence')`:**
  - Lint row: covered by the existing :106 test and AC-13; leave unchanged, must stay green.
  - State row: `## Known Pitfalls` with `| Area | Read this doc | Key files |` / `` | State | `docs/pitfalls/state.md` | `app/src/store/**` | ``, plus `## State Management Rules` with `STATE_MGMT_SENTINEL`. `readDoc` returns a state doc with `### Store writes` citing `` `app/src/store/editor.ts` `` and `### Other state rule` citing nothing. Affected `app/src/store/editor.ts`. Assert the "Open `docs/pitfalls/state.md`" line, `Store writes` body in full, `Other state rule` as a title, and `STATE_MGMT_SENTINEL` absent. Fails at HEAD (area cell "State" wins by `remainingPathKeys`).
  - Exact-area row: `tablePatterns('| Area touched | Section | Key files |…| Testing | Fixture Rules | \`src/a/b.ts\` |', '## Testing\n\nTESTING_SENTINEL\n\n## Fixture Rules\n\nFIXTURE_SENTINEL\n')`. Assert `FIXTURE_SENTINEL` present and `TESTING_SENTINEL` absent. Fails at HEAD (leftmost tie-break picks "Testing").
  - No-hint fallback, doc beats exact: `| A | B | C |` / `` | Exact Heading | `docs/pitfalls/x.md` | `src/a/b.ts` | `` with `## Exact Heading` + sentinel and a readable `docs/pitfalls/x.md`. Assert the Open line for `docs/pitfalls/x.md` and the sentinel absent. Fails at HEAD (`remainingPathKeys` favors cell 1).
  - No-hint fallback, exact beats prefix: `` | Retry | Queue Discipline | `src/a/b.ts` | `` with `## Retry Rules (backoff)` and `## Queue Discipline` sentinels. Assert Queue Discipline injected, Retry Rules not. Pin only: passes at HEAD.
- Run the AC-3, AC-5, Lint/glob-key, AC-9, AC-10, AC-13 tests unchanged; all use hinted headers (`Read this doc`, `Section`, `Section / doc`) and must stay green. If one fails, investigate before editing its assertion.

### Step R4: Guidance restatement

Files: `.claude/skills/canon-init/write-guide.md` (root; mirror via `npm run sync-templates`)

Line 57: change "add a Known Pitfalls table mapping each doc…" to "add a table directly under the Known Pitfalls heading, before the H3 entries, with a `Read this doc` column, mapping each doc to the paths or globs that should trigger it." This brings the guide in line with Amendment A/B and with `templates/docs/patterns.md:79`, which already says this (no change there). `docs/patterns.md` "How to use this doc" does not restate table placement; no change.

### Step R5: Build and validate

`npm run build` (stage `dist/`), `npm run type-check`, `npm run lint`, `npm test` (twice; goldens must not change — if `tests/run-task-prompts.golden.json` moves, investigate), `npm run sync-templates:check`, `npm run docs-refs-check`. Record each new test's HEAD-failure status in the handoff's Self-Check (round 2 flagged a missing Self-Check), marking the exact-beats-prefix case as a pin.

### Judgment Calls (this round)

| Call | Chosen | Why |
|---|---|---|
| Header hint word match | `\b(?:sections?\|docs?)\b` plus the phrase "read this", case-insensitive | Spec says "the word"; plurals ("Sections", "Docs") are the obvious variant and harmless. "Documentation" does not match. |
| Doc-path tier in the fallback | Syntactic, regardless of readability | Amendment B ranks by what the cell "holds"; AC-10 already handles a missing linked doc at selection time. |
| H4 before first H3 in Known Pitfalls | Its tables are index tables | "Before its first H3" is positional; no H3 has started. |
