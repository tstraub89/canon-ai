# Spec: path-scoped-pitfalls — Inject only pitfalls and lessons relevant to Affected Files

> Written by: Claude | Review by: spec reviewer
> Status: draft

> **Full-send mode**: This spec was produced in full-send mode.

## Problem

The implement and implement-reroute prompts (and park-resume, which renders the fresh implement prompt) inject the entire `## Known Pitfalls` section of `docs/patterns.md` verbatim, through `buildKnownPitfalls` in `src/orchestrator/context.ts`. Two failures follow.

- **Dilution in canon-ai.** The section is about 51 KB across 31 entries. Every implement run carries all of it, whatever files the task touches, so the few entries that bear on the change sit among dozens that don't.
- **Nothing useful reaches the implementer in a split-docs layout.** An adopter with a large pitfall corpus has split it into per-area docs (for example `docs/pitfalls/state.md` and `docs/pitfalls/build.md`). Its `## Known Pitfalls` section is deliberately only an index table, `| Read this doc | Before touching |`, mapping each doc to path globs such as `` `app/src/store/**` `` or to prose areas such as "any new effect or timer — cross-cutting". The implementer gets only that index and has to open the right docs itself.

`docs/patterns.md` and the adopter scaffold `templates/docs/patterns.md` both already claim "The orchestrator pre-injects task-relevant pitfalls". Today that claim is false.

`docs/lessons-learned.md` is never injected. The startup text asks agents to skim it, so lessons that name the exact files being changed rarely reach the implementer.

Both layouts already carry the data needed for path relevance, with no new syntax:
- pitfall and lesson entries are H3 sections whose prose cites repository paths;
- `docs/patterns.md` has a Trigger Table (`Area touched` | `Section` or `Section / doc` | `Key files`) mapping key files to named sections or docs;
- the split-docs layout's Known Pitfalls index table maps docs to path globs.

Some entries cite no full path. In canon-ai, about 5 of 31 cite only basenames or symbols, for example "Bundle-gate conditions must use `every()`, not `some()`". Path matching cannot select those, so for them the remedy is a shorter block in which their imperative title still appears.

## Decision

Replace `buildKnownPitfalls` with a builder that selects content by relevance to the tasks' **spec** Affected Files, obtained through `extractAffectedFiles(taskId)` for each task in the bundle. It does not use the `affectedFiles` parameter of the prompt builders, which holds the committed branch diff and is empty on a fresh pass. All docs are read from the active checkout.

**Definitions.**
- **Path-like token:** a backticked span or markdown-link target that contains `/` or a glob character (`*`). A trailing `:line` or `:line-line` suffix is stripped. Bare basenames (`main.ts`) and symbols (`runPhase()`) are not path-like tokens.
- **Match:** a path-like token matches an Affected File when it equals the file, is a directory prefix ending in `/`, or is a glob that matches the file.
- **Path resolution:** backticked paths are repository-relative. Markdown-link targets resolve relative to the linking doc's directory.
- **Entry:** an H3 section, with fenced code blocks ignored. Known Pitfalls entries are the H3s between `## Known Pitfalls` and the next H2 or H1 in `docs/patterns.md`, plus all H3s of a linked pitfall doc. Lesson entries are the H3s in `docs/lessons-learned.md`, except those under the H2s "How to use this doc" and "Entry format", or under an H2 starting with "Example".
- **Index tables:** the table(s) under the `docs/patterns.md` heading that starts with "Trigger Table", and the table(s) inside `## Known Pitfalls`. Other tables (for example a Quick Reference table) are not index tables.
- **Row target and keys:** in an index-table row, the target cell holds one or more `;`-separated items. Each item is either a markdown doc path (a linked pitfall doc), a `doc §Section` reference, or a section name. Parenthetical prose inside an item is ignored. The row's keys are the path-like tokens in its other cells. A section name resolves to the `docs/patterns.md` H2 or H3 whose heading equals it case-insensitively. If no heading equals it, it resolves to the shortest heading that starts with it. A `doc §Section` reference resolves to that section of that doc, and does not make the doc a linked pitfall doc. `docs/patterns.md` itself is never a linked pitfall doc.

**The injected block.**
1. **Selected entries and sections, in full.** Each is injected once, at its highest-priority channel. An H3 inside an injected H2 counts as injected. The channels, highest priority first:
   - **Direct:** a Known Pitfalls entry (including a linked pitfall doc's entry) whose text contains a token that matches an Affected File.
   - **Linked doc:** for an index row whose key matches, a linked-doc target makes that doc matched. Its directly matching entries are already covered above. Its other entries go to the title index under an "open this doc" line.
   - **Section target:** for an index row whose key matches, each section or `doc §Section` target is injected in full.
   - **Lessons:** lesson entries whose text contains a matching token, under their own subheading.
2. **Area index.** Every index-table row becomes one line: its targets and its area/keys text. Rows whose key matched are marked. Rows with no keys (cross-cutting rows) appear like any other row. The implementer can still look up files it discovers mid-task.
3. **Title index.** Every Known Pitfalls entry not injected in full, grouped by file, as a one-line title.

A channel with no source simply contributes nothing. Examples: no `## Known Pitfalls` section, no Trigger Table, no lessons file. The block is empty only when every part is empty.

**Cap.** The block has a fixed byte cap. If it is over, full entries are demoted to title lines, in this order: lessons, then section targets, then linked-doc entries, then direct matches. If titles and the area index alone still exceed the cap, the title index is truncated per file with a "+N more in <file>" line, then area-index rows with a count. A truncation note reports what was demoted or dropped.

## Judgment Calls

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| How relevance is expressed | Inferred from paths in entry prose and existing index tables; no new syntax | Front-matter or tag lines on each entry | Zero migration for canon-ai and existing adopters; the data already exists in both layouts | `Human` |
| A matched linked doc | Its directly matching entries in full, plus all its titles and an "open this doc" line | Inject the whole doc | One linked doc in the motivating layout is about 31 KB; titles plus a pointer keep the rule visible without the bulk | `Human` |
| Trigger Table section targets | Injected in full when a key matches, including Patterns sections (not only pitfalls) | Pitfalls only | The Trigger Table already declares those sections load-bearing for those files | `Human` |
| Startup reading list | Unchanged | Drop the "skim lessons-learned" line now that matching lessons are injected | `toResumePrompt` strips startup blocks by exact text, so editing them risks silent breakage; trimming is a follow-up | `Human` |
| Index tables in the block | Every index row as a one-line area index, matched rows marked | Only cross-cutting rows as pointers | Keeps the lookup table for files found mid-task, and removes a separate cross-cutting rule | `Author` |
| Unmatched lessons | Not listed | A title index for lessons too | Lessons are a swept staging buffer; listing them every run adds noise, and the startup line covers skimming | `Author` |
| Bare file-name tokens | Not path-like (never match; a row with only such keys is a keyless row) | Match on basename | Generic basenames (`index.ts`, `types.ts`) would match unrelated entries in any repo | `Author` |
| Which tables count | The Trigger Table and tables inside Known Pitfalls | Every table in `docs/patterns.md` | Quick-reference tables point at operator docs, not implementation rules | `Author` |
| Byte cap | A fixed constant (around 24 KB), no new user-facing env var | A `MAX_PITFALLS_BYTES` env var | `MAX_CONTEXT_BYTES` governs the file preload only; a constant avoids a new config surface | `Author` |
| Test seam for the docs root | A test-only env override for the docs root (lessons and linked docs), in the existing `CANON_PATTERNS_MD_PATH` style | Thread a docs-root parameter through every implement prompt builder | The golden harness already uses this override style | `Author` |
| Scaffold pitfall format | Change the adopter scaffold's "Pitfall format" to one H3 per pitfall that cites full repository paths | Leave the scaffold's blockquote-under-category format | The current scaffold makes each category one "entry", so path selection and the title index would not work for scaffolded adopters | `Author` |

## Non-Goals

- No tag, front-matter, or annotation syntax.
- No change to the startup text (`CODEX_STARTUP`, `CLAUDE_IMPLEMENTER_STARTUP`, `CLAUDE_STARTUP`, `QA_STARTUP`) or to `toResumePrompt`.
- No change to which prompts carry the block: fresh implement (and park-resume, which renders it) and implement-reroute.
- No change to the lessons-learned entry format, to QA's lessons writing, or to `/canon-sweep`.
- No use of the docs-freshness `paths` config for relevance.
- No edits to any adopter's own docs.
- Neither this spec nor its docs name any private adopter project (AGENTS.md §Boundaries). Fixtures use neutral names.

## Acceptance Criteria

- [ ] AC-1: Replace `buildKnownPitfalls` with the relevance-selecting builder. `buildKnownPitfalls` must not exist after. `promptImplement` and `promptImplementReroute` call the new builder in its place, and it reads Affected Files via `extractAffectedFiles`. Verify with `git grep -n "buildKnownPitfalls" -- src tests` returning nothing, plus a unit test showing a task whose spec lists `src/a/b.ts` selects an entry citing it when the prompt builder's `affectedFiles` argument is `[]`.
- [ ] AC-2: Direct match. A Known Pitfalls fixture has entries citing `` `src/a/b.ts` ``, `` `src/a/` ``, and `` `src/z/q.ts` ``, and the Affected File is `src/a/b.ts`. The first two appear in full, and the third appears only as a title. Verify with a unit test.
- [ ] AC-3: Linked doc through a glob. A Known Pitfalls index row `` | `docs/pitfalls/state.md` | `app/src/store/**`, settings persistence | `` with Affected File `app/src/store/editor.ts` injects that doc's entries citing a matching path in full. Its other entries appear as titles under a line telling the implementer to open `docs/pitfalls/state.md`. With Affected File `app/src/ui/x.ts`, the doc contributes titles only, and the row still appears in the area index. A row linking `[state](pitfalls/state.md)` from `docs/patterns.md` resolves to `docs/pitfalls/state.md`. Verify with unit tests.
- [ ] AC-4: Area index. Every index-table row appears as one line with its targets and area text. A keyless row such as `` | `docs/pitfalls/effects.md` | Any new effect or timer — cross-cutting | `` appears regardless of Affected Files. A Trigger Table row with a section target and `—` in its key cell also appears. Matched rows are marked. Verify with unit tests.
- [ ] AC-5: Section targets. Trigger Table row `| Changing the queue | Queue Discipline; Retry Rules | `src/queue/worker.ts` |` with Affected File `src/queue/worker.ts` injects the full sections "Queue Discipline" (an H2) and "Retry Rules (backoff)" (an H3, by prefix). When the doc has both "Testing" and "Testing Utilities" headings, target "Testing" resolves to "Testing". A target cell `` Mobile Rules; `docs/pitfalls/touch.md` `` yields one section target and one linked doc. A target `` `docs/patterns.md` §Testing `` resolves to the Testing section only, and lists no other `docs/patterns.md` titles. Verify with unit tests.
- [ ] AC-6: Dedup. An entry that is both a direct match and a section target appears in full once. An H3 inside an injected H2 section is not repeated and is not in the title index. Verify with a unit test.
- [ ] AC-7: Lessons. In a lessons fixture, an entry citing the Affected File is injected in full under a lessons subheading. An entry citing an unrelated path does not appear. An "Example entry" H3 citing the Affected File does not appear. A fenced `### Heading` is not an entry. Verify with a unit test.
- [ ] AC-8: Token rules. A basename (`` `b.ts` ``), a symbol (`` `runPhase()` ``), or a plain word (`` `true` ``) never matches. `` `src/a/b.ts:12-30` `` matches as `src/a/b.ts`. Verify with a unit test.
- [ ] AC-9: Cap. When selected full text exceeds the cap, the block stays under it, demoting in the order lessons, section targets, linked-doc entries, direct matches, and a truncation line reports the count. When titles and the area index alone exceed the cap, titles truncate per file with "+N more in <file>". Verify with unit tests.
- [ ] AC-10: Independent channels. A missing `docs/patterns.md` and a missing lessons file together yield an empty string. A patterns doc with a Trigger Table but no `## Known Pitfalls` still injects matching section targets. A matching lesson is injected when `docs/patterns.md` is missing. A linked doc that does not exist is skipped without throwing. With no Affected Files, the block holds only the area index and title index. Verify with unit tests.
- [ ] AC-11: Docs are read from the active checkout. `CANON_PATTERNS_MD_PATH` still overrides the patterns doc, and a new test-only override sets the docs root for lessons and backticked linked-doc paths. Verify with unit tests using a temporary docs root.
- [ ] AC-12: The golden fixture spec is restructured to `## Design` / `### Affected Files`, with fixture paths that do not exist in the canon-ai tree. `tests/fixtures/patterns.stub.md` gains one entry citing a fixture path and one that doesn't, and the golden test points the docs-root override at a fixture directory. The regenerated `promptImplement_fresh`, `promptImplementReroute`, and `promptImplementReroute_resumed` snapshots show the matching entry in full and the other as a title. A second plain `npm test` after `UPDATE_GOLDENS=1` passes. Verify by running both.
- [ ] AC-13: On canon-ai's real `docs/patterns.md`, a task whose only Affected File is `src/orchestrator/git.ts` gets both of these in full, not demoted:
  - the "`getAffectedFiles` uses three-dot diff semantics…" pitfall (its body cites `src/orchestrator/git.ts`);
  - the "Validation Gate Discipline" section (via the Trigger Table row whose Key files list `src/orchestrator/git.ts`).
  
  Verify with a unit test reading the real file, asserting on the headings.
- [ ] AC-14: Docs describe the new behavior:
  - `docs/patterns.md` and `templates/docs/patterns.md` "How to use this doc" describe relevance selection.
  - `templates/docs/patterns.md`'s "Pitfall format" and "Example pitfall" show one H3 per pitfall citing full repository paths, and its placeholder category headings are replaced by that format.
  - The canon-init write guide and its mirror tell adopters to cite full paths or globs in each pitfall, and to index split pitfall docs in a Known Pitfalls table that maps each doc to path globs. Its wording names no canon-internal paths.
  - `README.md` describes pitfalls as selected by relevance.
  - `docs/codebase-map.md` updates the Patterns row and adds the new module.
  - `docs/pipeline-orchestrator.md` (and its mirror) describes the `CANON_PATTERNS_MD_PATH` scope and the new test-only override.
  
  Verify by reading them, and with `npm run docs-refs-check` and `npm run sync-templates:check`. The scaffold `templates/docs/patterns.md` is not a managed mirror, so its parity with `docs/patterns.md` is checked by reading.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/pitfalls.ts` | New module: relevance-selecting builder (entries, index tables, token matching, dedup, area index, title index, cap) |
| `src/orchestrator/context.ts` | Remove `buildKnownPitfalls` and its now-unused `getActiveCwd` import |
| `src/orchestrator/prompts/index.ts` | `promptImplement` and `promptImplementReroute` call the new builder |
| `tests/pitfalls.test.ts` | New unit tests for AC-1 through AC-11 and AC-13 |
| `tests/fixtures/patterns.stub.md` | Add a matching and a non-matching entry |
| `tests/fixtures/pitfalls-docs/` | New fixture docs root (lessons, linked pitfall doc) for the golden test |
| `tests/run-task-prompts.test.ts` | Golden fixture spec restructured to `## Design` / `### Affected Files`; docs-root override |
| `tests/run-task-prompts.golden.json` | Regenerated snapshots |
| `docs/patterns.md` | "How to use this doc" describes relevance selection |
| `templates/docs/patterns.md` | Same wording, plus the one-H3-per-pitfall format and example (init scaffold, not a managed mirror) |
| `.claude/skills/canon-init/write-guide.md`, `templates/.claude/skills/canon-init/write-guide.md` | Pitfall authoring guidance: cite full paths or globs; index split docs with path globs |
| `README.md` | Pitfall injection wording |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | `CANON_PATTERNS_MD_PATH` row scope; new test-only override row |
| `docs/codebase-map.md` | Patterns row and new-module row |
| `dist/` | Rebuilt bundle (builders are bundled by tsup; `dist/` is tracked) |

### Implementation Notes (non-binding; plan and implement own these)

- `matchesDocsGlob(pattern, filePath)` in `src/orchestrator/docs-freshness.ts` takes the glob first, and does not treat a trailing-`/` directory as a prefix. Keep the prefix rule separate.
- Detect the target cell by content (a doc path or a section name that resolves), not by column name.
- Keep the block heading distinct from the old "Known Codebase Pitfalls (from docs/patterns.md…)" heading.

### Interaction Dependencies

- `implementer-blast-radius-map` changes the same prompt builders and goldens, and is expected to ship first. Rebase on it and regenerate the goldens once.
- `docs/lessons-learned.md` is a pipeline telemetry file that `--ship` folds into the base copy. A worktree's lessons can lag the base by unshipped tasks. This is acceptable for advisory context.
- The anchored code-review lens reads `docs/patterns.md` via its Trigger Table independently. Unchanged.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build`
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`

## Docs Impact

- The docs listed in Affected Files.
- `.claude/skills/canon-spec/SKILL.md` asks spec authors to cite relevant pitfalls. Under this design, a complete Affected Files list also decides which pitfalls the implementer sees. QA may add a line.

## Known Risks

- **Silent omission.** A pitfall that matters but cites no full path, or cites a sibling path, never appears in full. Its title stays visible, and the startup line still asks agents to read `docs/patterns.md`.
- **Table variety.** Adopters' tables differ in column names and order. Content-based target detection keeps it layout-agnostic. Unresolvable items are skipped and the row still appears in the area index.
- **Prefix collisions.** Exact heading matches beat prefixes, and the shortest prefix wins (AC-5).
- **Broad globs.** A `**` row matches everything. Linked docs inject only directly matching entries plus titles, and the cap backstops the rest.
- **Large split corpora.** Titles plus the area index can approach the cap. Truncation with counts (AC-9) bounds them.
- **Golden churn.** Implement goldens change. The restructured fixture also changes the state header's "Relevant files" line. Review the regenerated diff.

## Human Test Plan

1. Run a small task that changes one file named in a known pitfall.
2. Open the implementer's prompt in the run log.
3. Expected: that pitfall appears in full, the other pitfalls appear as one-line titles, and the pitfalls section is a fraction of its former length.
4. Expected: when a lesson mentions the changed file, it appears too.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files uses exactly one `### Affected Files` heading under `## Design`, with one file per row. Each row has a specific change description.
- [x] Plan steps (fast tier) reference actual function/file names from the codebase (N/A: full tier)
- [x] If this spec replaces existing behavior: framed as one replacement with a grep AC (AC-1)
- [x] Non-Goals rules out the most tempting scope expansions; load-bearing exclusions are backed by ACs (AC-7, AC-8, AC-10)
- [x] Symbols named in ACs actually exist in the codebase (`buildKnownPitfalls`, `promptImplement`, `promptImplementReroute`, `extractAffectedFiles`, `matchesDocsGlob`, `toResumePrompt`, `CANON_PATTERNS_MD_PATH` grep-verified)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) N/A: feature
- [x] (Refactors) N/A: feature
- [x] *Judgment Calls* lists every judgment call the spec makes
