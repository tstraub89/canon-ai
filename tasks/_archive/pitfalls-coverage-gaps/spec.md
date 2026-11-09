# Spec: pitfalls-coverage-gaps — Prose-only Known Pitfalls and directory Affected Files

> Written by: Claude | Review by: spec reviewer
> Status: draft

> **Full-send mode**: This spec was produced in full-send mode.

## Problem

`path-scoped-pitfalls` (PR #160) replaced the whole-section `## Known Pitfalls` injection with `buildRelevantPitfalls` in `src/orchestrator/pitfalls.ts`. Its code review left two coverage gaps open, and both are still present on `main`.

1. **A prose-only Known Pitfalls section injects nothing.** `knownPitfallEntries` (`src/orchestrator/pitfalls.ts:172`) collects only H3 entries. An adopter whose `## Known Pitfalls` is plain prose, bullets, or blockquotes with no `###` headings gets no full entry, no title and no mention. The previous builder injected that section verbatim, so for these adopters the change silently removed every pitfall from the implement prompt. Confirmed by reading `knownPitfallEntries` and `selectPitfallsInternal` (`:616` onward): outside H3 entries, Known Pitfalls content reaches the block only as index-table rows, or as a section target when an index row names the Known Pitfalls H2 itself and its keys match.
2. **A directory Affected File selects nothing beneath it.** `tokenMatches(token, filePath)` (`:268`) matches when the token equals the file, the token is a directory prefix of the file, or the token is a glob matching the file. It never matches when the *Affected File* is a directory (`src/orchestrator/`, legal in the spec manifest contract) and the token is a path inside it. A spec listing `src/orchestrator/` therefore gets no pitfall citing `src/orchestrator/git.ts`, and no Trigger Table row keyed on that file. Every channel goes through `tokenMatches` (direct entries, linked-doc entries, index-row keys, lessons), so all four miss.

Both are deterministic: fixed inputs take the same branch every run.

## Decision

1. **Prose-only fallback.** Decided per Known Pitfalls H2: when such a section has no H3 entries, its body becomes one entry titled with the section heading. Its body is the text below the heading line (the heading itself does not count) with the index tables (as Amendment 1 of `path-scoped-pitfalls` defines them: the tables directly under the H2) and all blockquote paragraphs removed. Blockquotes are author guidance by the scaffold's convention (its `TODO[canon]` and "Pitfall format" notes), so an adopter that deletes the scaffold example before writing a pitfall gets no boilerplate. If what remains is blank, there is no entry. The entry is injected in full regardless of Affected Files, under its own subsection whose heading and one-line framing say it is included regardless of the task's files (it is not listed under the "cite your files" subsection, and the existing framing line for selected entries is unchanged). Under the cap it is demoted with the direct-match channel, after lessons, section targets and linked-doc entries; within that channel the existing largest-first order applies. When the section has at least one H3, behavior is unchanged: text before the first H3 is not an entry.
2. **Directory Affected Files.** A path-like token also matches an Affected File that is a directory (ends in `/`) when:
   - the token is a path inside that directory (the token starts with it), or
   - the token is a glob that some path inside the directory could match, judged segment by segment with no filesystem I/O: each directory segment must match the glob's segment at the same depth, and a `**` glob segment matches any remaining depth. For example, `src/**/*.ts` and `src/a/**` match `src/a/`; `src/ab/**` and the root-level `*.md` do not.

   The change lives in the shared token matcher, so it applies to every channel.

## Judgment Calls

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| Fixing the prose-only gap | Inject the prose body in full, unconditionally | Show only a title line ("Known Pitfalls — read docs/patterns.md") | The previous builder injected this text verbatim; a title alone still drops every rule for these adopters | `Author` |
| Fallback scope | Only when the section has no H3 at all | Also inject the preamble before the first H3 | Sections with H3 entries already select by relevance; their preamble is usually guidance about the section, and in the split-docs layout it is already short | `Author` |
| Glob vs directory | Segment-wise "could some path inside match" test | Require the glob to match some real file under the directory (filesystem walk) | No I/O in the matcher; a literal-prefix test would match every directory for a leading-wildcard glob | `Author` |
| Blockquotes in a prose-only section | Excluded from the fallback body | Inject them too | The scaffold keeps its TODO and format guidance in blockquotes; injecting them would put boilerplate in every prompt of a fresh adopter | `Author` |
| Where the fallback renders | Its own subsection, labeled as included regardless of files | Under the "cite your files" subsection | That heading and the framing line would be false for an unconditional entry | `Author` |

## Non-Goals

- No change to H3-entry selection, index-table parsing, target-cell detection, the cap, or the demotion order.
- No `canon doctor` warning for prose-only sections.
- No change to how `extractAffectedFiles` normalizes entries; directory entries already keep their trailing `/`.
- No change to `src/orchestrator/blast-radius.ts`.
- No basename or symbol matching.

## Acceptance Criteria

- [ ] AC-1: Prose-only fallback (red-first). A `docs/patterns.md` fixture whose `## Known Pitfalls` has two paragraphs of prose, one blockquote, one index table directly under the H2, and no H3 yields a block containing the prose in full, under a subsection labeled as included regardless of the task's files, both with no Affected Files and with an unrelated Affected File. The blockquote does not appear. Verify with a unit test in `tests/pitfalls.test.ts` that fails on current `main`.
- [ ] AC-1b: Fallback boundaries. The index table's rows appear in the area index and not inside the injected prose. A section holding only an index table and blockquotes yields no prose entry (the scaffold's `## Known Pitfalls` with its example H3 removed is one such fixture). A section with H3 entries plus a preamble does not inject the preamble. Verify with unit tests.
- [ ] AC-2: Prose-only under the cap. When the block exceeds the cap, the prose entry is demoted with the direct matches (after lessons, section targets and linked-doc entries) and appears as its title line. Verify with a unit test using a small cap.
- [ ] AC-3: Directory Affected File. With Affected File `src/a/`:
  - an entry citing `` `src/a/b.ts` `` is injected in full (direct);
  - a Trigger Table row keyed on `` `src/a/b.ts` `` is marked matched and its section target injected;
  - a Known Pitfalls index row keyed on `` `src/a/**` `` makes its linked doc matched;
  - a lesson citing `` `src/a/b.ts` `` is injected;
  - an index row keyed on `` `src/**/*.ts` `` is matched;
  - an entry citing `` `src/ab/c.ts` `` or `` `src/z.ts` ``, and index rows keyed on `` `src/ab/**` `` or `` `*.md` ``, are not.
  
  Verify with unit tests, written first; the first case fails on current `main`.
- [ ] AC-4: Existing behavior holds. The full `tests/pitfalls.test.ts` suite and the implement goldens pass without regeneration: the golden fixture's Known Pitfalls has H3 entries and no directory Affected File, so neither change reaches it. If regeneration turns out to be needed, the handoff explains the diff. Verify by running `npm test`.
- [ ] AC-5: Docs. The relevance-selection wording in `docs/patterns.md` "How to use this doc", its scaffold `templates/docs/patterns.md`, and `README.md` and the canon-init write guide (root and mirror) mention that a Known Pitfalls section without `###` entries is injected whole except its blockquotes, and that a directory in Affected Files selects pitfalls citing paths inside it. Verify by reading them.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/pitfalls.ts` | Prose-only fallback entry; directory-aware token matching |
| `tests/pitfalls.test.ts` | Red-first tests for AC-1 to AC-3 |
| `docs/patterns.md` | "How to use this doc" wording |
| `templates/docs/patterns.md` | Same wording (init scaffold, not a managed mirror) |
| `.claude/skills/canon-init/write-guide.md`, `templates/.claude/skills/canon-init/write-guide.md` | Pitfall selection wording: prose-only sections and directory Affected Files |
| `README.md` | Pitfall injection wording |
| `dist/` | Rebuilt bundle (tracked) |

### Implementation Notes (non-binding)

- `rowMatches` and every direct/linked/lesson check call `tokenMatches(token, file)`, so the directory rule belongs there.
- The fallback entry can reuse `DocEntry` with the H2 heading; make sure span-based dedup does not treat it as covering index-table rows or other sections.

### Interaction Dependencies

- `post-ship-cleanup` also edits `src/orchestrator/pitfalls.ts` (separator dash count, env-var handling), the "How to use this doc" paragraph of `docs/patterns.md`, `templates/docs/patterns.md`, and the canon-init write guide. This task ships first; the cleanup task starts from the new `main`.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite runs clean
- [x] `npm run build`
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`

## Docs Impact

The docs in Affected Files.

## Known Risks

- **Broad directories.** A spec listing `src/` matches most pitfalls and rows; the cap and demotion bound it.
- **Large prose sections.** A long prose-only section always rides along; under the cap it is demoted with direct matches. The old builder stopped at a `---` rule; the fallback reads to the next H2.
- **Dedup by span.** An H2-titled fallback entry could be treated as covering index-table content; AC-1b checks that the rows stay in the area index only.
- **Blockquote-only pitfalls.** An adopter who writes prose-only pitfalls entirely as blockquotes gets none injected; the docs (AC-5) say blockquotes in Known Pitfalls are author guidance and are not injected.

## Human Test Plan

1. In a project whose pitfalls section is plain prose with no sub-headings, run a small task.
2. Expected: the implementer's prompt contains that prose.
3. Run a task whose spec lists a whole folder as an affected file.
4. Expected: pitfalls about files inside that folder appear in full.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it
- [x] Affected Files uses exactly one `### Affected Files` heading under `## Design`, one file per row
- [x] Plan steps (fast tier) reference actual names (N/A: full tier)
- [x] Replacement framing (N/A: additive fixes)
- [x] Non-Goals rules out the tempting expansions
- [x] Symbols named exist (`knownPitfallEntries`, `tokenMatches`, `rowMatches`, `selectPitfallsInternal`, `buildRelevantPitfalls`, `extractAffectedFiles`)
- [x] Known Risks covers the trickiest ACs
- [x] Human Test Plan uses product language only
- [x] Validation Required has a checked entry
- [x] (Bug fixes) Problem states the confirmed mechanism (code trace, deterministic); AC-1 and AC-3 are red-first
- [x] (Refactors) N/A
- [x] *Judgment Calls* lists every judgment call
