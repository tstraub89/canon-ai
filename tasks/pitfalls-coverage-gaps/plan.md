# Implementation Plan: pitfalls-coverage-gaps

> Written by: Claude | Implements: `tasks/pitfalls-coverage-gaps/spec.md`

## Approach

Two changes in `src/orchestrator/pitfalls.ts`: (1) a per-H2 prose fallback entry for `## Known Pitfalls` sections with no `###`, injected unconditionally under its own subsection; (2) directory-aware matching inside the shared `tokenMatches`. Tests first (red), then code, then docs, then `dist/`.

Spec review verdict `approved`; no nits to fold in.

**Feasibility check**
- **Exists:** `knownPitfallEntries` (`:172`), `knownPitfallsIndexTables` (`:353`), `tokenMatches` (`:268`), `rowMatches` (`:274`), `candidateFromEntry`, `addCandidate`, `titleGroupsFor`, `render()` inside `selectPitfallsInternal`, `matchesDocsGlob` (`docs-freshness.ts:173`) — all found by reading. `tests/pitfalls.test.ts` has helpers `matchingInput`, `tablePatterns`, `selectPitfalls`.
- **Real path:** `buildRelevantPitfalls` → `selectPitfalls` → `selectPitfallsInternal`. `patternsEntries` feeds both the direct-match loop and `titleEntries`. A demoted `direct` candidate renders as a title through `titleGroupsFor` (not the `(demoted to fit)` list, which is section/lesson only). `selectPitfalls` has no empty-Affected-Files early return, so AC-1's no-files case reaches the fallback.
- **Callers:** `tokenMatches` has one caller, `rowMatches`, which every channel (direct, linked, lessons, index rows via `buildIndexRows`) uses. `knownPitfallEntries` has one caller (`patternsEntries`). No other file calls either.
- **Tests that can fail:** AC-1/1b/2 fixtures have no H3, so current `main` returns no prose (red). AC-3's first case uses Affected `src/a/` with an entry citing `src/a/b.ts`; `main` matches none of the four conditions (red).
- **Predicates:** blank fallback body (whitespace only, or only tables/blockquotes) → no entry; H3 count 0 vs ≥1 per H2; a glob with fewer segments than the directory, or exactly as many (no segment left for a file name), never matches; `**` at any depth matches; empty path segments from trailing `/` are dropped; non-glob tokens that are not inside the directory do not match; token equal to the directory itself matches via existing equality.
- **Scope:** `docs-freshness.ts` is NOT in Affected Files, so the new glob-prefix test must be built on the exported `matchesDocsGlob` (applied to one glob segment against one directory segment), not by exporting its internals.
- **Async/stateful:** N/A (pure, synchronous).

Spec ambiguity recorded (not a contradiction): "index tables directly under the H2" — with no H3, `knownPitfallsIndexTables` treats every table in the section as an index (it filters on "before the first H3"). Strip exactly the tables that function returns, so rows shown in the area index never also appear in the prose. Logged in `notes.md`.

## Steps

### Step 1: Red-first tests

Files: `tests/pitfalls.test.ts`

Add (after existing tests, same `void test(...)` style; use `selectPitfalls(matchingInput(patterns, files))`):
- **AC-1:** patterns = `## Known Pitfalls`, two prose paragraphs, a `> blockquote`, then an index table (`| Read this doc | Before touching |` with a row), no H3. Assert with `affectedFiles = []` and with `['src/unrelated.ts']`: output contains both paragraphs, a subsection heading matching `/### Known Pitfalls \(included regardless of your files\)/`, and not the blockquote text; the prose is not under `### Pitfalls and patterns that cite your files`.
- **AC-1b:** (a) table rows appear in `### Area index` and not inside the prose subsection (split output at the subsection heading and check the next `###`); (b) section with only an index table and blockquotes (scaffold with example H3 removed) → no `included regardless` heading; (c) section with `###` entries plus a preamble paragraph → preamble text absent; (d) multi-line blockquote with a lazy continuation line is fully removed; (e) a blockquote-looking line inside a fenced code block is kept.
- **AC-2:** prose entry plus a direct match and a lesson/section candidate; pass `cap` small enough that only the prose entry must go after lessons/sections/linked are demoted; assert prose body absent and `- Known Pitfalls` present as a title line. Also assert ordering: with a cap that forces exactly the lesson/section out first, the prose body survives.
- **AC-3:** Affected `['src/a/']`. Assert injected: entry citing `` `src/a/b.ts` ``; Trigger Table row keyed `` `src/a/b.ts` `` matched with its section target body injected (copy shape from the existing AC-4 trigger-table test); Known Pitfalls index row keyed `` `src/a/**` `` opens its linked doc (use `readDoc` like the existing AC-3 test); lesson (`lessons` input) citing `src/a/b.ts`; index row keyed `` `src/**/*.ts` `` matched. Assert NOT matched: entry citing `src/ab/c.ts` and `src/z.ts`, rows keyed `src/ab/**` and `*.md`. Add extras: glob `src/a/b/**` vs dir `src/a/` matches; glob `src/a` (same depth, no file segment) and `src/*` vs dir `src/a/` — `src/*` has a second segment so it matches; `src/a/*` vs `src/a/` matches; dir `src/a/b/` vs `src/a/*` does not.

Run `npm test -- tests/pitfalls.test.ts` (or `npx tsx --test tests/pitfalls.test.ts`) and confirm the new tests fail for the stated reason before Step 2.

### Step 2: Directory-aware `tokenMatches`

Files: `src/orchestrator/pitfalls.ts`

Add a helper above `tokenMatches` and extend it:

```ts
function globCouldMatchInsideDir(glob: string, dir: string): boolean {
    const globSegments = glob.split('/').filter(Boolean);
    const dirSegments = dir.split('/').filter(Boolean);
    for (let i = 0; i < dirSegments.length; i++) {
        if (i >= globSegments.length) return false;
        if (globSegments[i] === '**') return true;
        if (!matchesDocsGlob(globSegments[i], dirSegments[i])) return false;
    }
    // Every directory segment matched; a path inside needs a further glob segment.
    return globSegments.length > dirSegments.length;
}

function tokenMatches(token: string, filePath: string): boolean {
    if (token === filePath) return true;
    if (token.endsWith('/') && filePath.startsWith(token)) return true;
    if (filePath.endsWith('/')) {
        if (token.startsWith(filePath)) return true;
        if (token.includes('*') && globCouldMatchInsideDir(token, filePath)) return true;
    }
    return token.includes('*') && matchesDocsGlob(token, filePath);
}
```

`matchesDocsGlob(segment, name)` on a single segment is a plain segment match (no `/`), so no export from `docs-freshness.ts` is needed. Note a literal-prefix glob like `src/ab/**` must fail because `ab` ≠ `a`; `*.md` fails because `*.md` ≠ `src`. Edge: a glob whose segment is `**` as the final segment with fewer segments than depth is handled by the early `**` return.

### Step 3: Prose-only fallback entry

Files: `src/orchestrator/pitfalls.ts`

1. Add optional `unconditional?: boolean` to `DocEntry` and `Candidate`; `candidateFromEntry` copies it.
2. New `proseFallbackBody(patterns, section): string`: iterate `section.startLine + 1 .. section.endLine - 1`; build a skip set from `knownPitfallsIndexTables(patterns, section)` line ranges (`startLine..endLine-1`); for lines with `patterns.outsideFence[line]` true, skip a line matching `/^ {0,3}>/` and set `inQuote`, skip following non-blank lazy-continuation lines while `inQuote`, reset `inQuote` on a blank line; lines inside fences are always kept. Join kept lines, collapse runs of 3+ newlines to 2, `trim()`.
3. In `knownPitfallEntries`, per Known Pitfalls H2: collect H3 entries as today; if none were found for this H2 (`found === 0`), compute the body and, when non-empty, push `{ doc: patterns, heading: section, title: section.text, body, unconditional: true }`.
4. In the direct loop in `selectPitfallsInternal`: `if (entry.unconditional || pathTokens(...).some(...))` → `addCandidate(candidates, candidateFromEntry(entry, 'direct', 0))`. It stays in `titleEntries` via `patternsEntries`, so when demoted it renders as its title (AC-2) and while active it is covered by its own candidate span, so no duplicate title.
5. In `render()`: `pitfallFull = full.filter(c => c.channel !== 'lesson' && !c.unconditional)`; `proseFull = full.filter(c => c.unconditional)`. After the "cite your files" section push, add:
   `### Known Pitfalls (included regardless of your files)\n\n_This section has no \`###\` entries, so it is included whole (blockquotes omitted) whatever the task's Affected Files._\n\n${proseFull.map(c => c.body).join('\n\n')}` — placed before the lessons section. Leave the global `framing` string unchanged.
6. Do not touch `DEMOTION_ORDER`: the candidate is `direct`, so it demotes with direct matches, largest-first.

Span dedup check: the candidate spans the whole Known Pitfalls H2. It cannot cover another candidate because a no-H3 section contains no other heading-based candidate; a section-target row naming the same H2 hits `addCandidate`'s same-span branch, where the existing `direct` (priority 0) wins and keeps the stripped body. Index-table rows are rendered from `indexRows`, never from candidates, so they stay in the area index (AC-1b).

### Step 4: Docs

Files: `docs/patterns.md` (line ~10), `templates/docs/patterns.md` (line ~10), `.claude/skills/canon-init/write-guide.md` (line ~57), `templates/.claude/skills/canon-init/write-guide.md`, `README.md` (line ~62)

- patterns "How to use this doc" (root and scaffold; they differ, edit each with the same sentence): append to the Known Pitfalls item: "A Known Pitfalls section with no `###` entries is injected whole, minus blockquotes (author guidance) and index tables; a directory in Affected Files selects pitfalls that cite paths inside it."
- write-guide (root first; the mirror follows via `npm run sync-templates`, and the hook mirrors it — do not hand-edit the mirror if the sync produces it): add that prose-only sections are injected whole except blockquotes, and that a directory Affected File selects entries citing paths inside it. Do not name canon-ai internals (adopter-scope rule).
- README row ~62: one clause, same facts.

Run `npm run sync-templates` then `npm run sync-templates:check`. `templates/docs/patterns.md` is a scaffold, not a managed mirror: edit it by hand.

### Step 5: Build and validate

`npm run build` (dist is tracked), `npm run type-check`, `npm run lint`, `npm test` (goldens must pass unregenerated; the golden fixture has H3 Known Pitfalls and no directory Affected File), `npm run docs-refs-check`, `npm run sync-templates:check`. Report any that cannot run as such in the handoff.

## Risks / notes for implementer

- Do not edit `src/orchestrator/docs-freshness.ts` (outside Affected Files).
- Do not hand-edit `templates/` mirrors of managed files.
- `post-ship-cleanup` also touches `pitfalls.ts` and the same docs paragraph; this task lands first, so keep diffs narrow.
