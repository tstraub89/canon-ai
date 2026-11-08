# Code Review: path-scoped-pitfalls

> Reviewer: Claude | Spec: `tasks/path-scoped-pitfalls/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — the implementer reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from its lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below and a cold-Claude lens that reads only the diff. In mixed mode a third, cold-Codex lens, pre-obtained by the orchestrator as an unanchored diff review from a different model family, joins them; Claude mode has the anchored and cold-Claude lenses only. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lenses: anchored Claude (returned, `changes_requested`), cold-Claude (returned, `changes_requested`), and cold-Codex (injected; no actionable findings; reports that test, type-check, lint, sync-templates:check, and docs-refs-check pass).

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC (the spec has no red-first ACs, and the handoff says so)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `buildKnownPitfalls` replaced, both builders read Affected Files | Pass | No `buildKnownPitfalls` hits in src/tests/dist; `src/orchestrator/prompts/index.ts:361`, `:532` call `buildRelevantPitfalls` |
| AC-2: direct match, prefix, unrelated as title | Pass | `tests/pitfalls.test.ts` AC-2 |
| AC-3: linked doc via glob, open line, relative link | Pass | AC-3 test covers matched and unmatched rows and `[state](pitfalls/state.md)` |
| AC-4: area index, keyless and `—` rows, matched marker | Pass | AC-4 test |
| AC-5: section targets, exact-before-prefix, mixed cells, `doc §Section` | Partial | Behaviour is implemented, but the `§Testing` assertion is masked by another row (finding 2). Target-cell detection also misfires on short area cells (finding 1). |
| AC-6: dedup | Pass | Sentinel counts are 1 |
| AC-7: lessons, example scope, fenced heading | Pass | The example-scope reading is recorded as an `[ambiguity]` blocker in the handoff |
| AC-8: basenames/symbols don't match; `:line` stripped | Pass | AC-8 test |
| AC-9: cap and demotion order | Pass | Demotion order and the `+N more` line are asserted. The cap is soft by framing overhead at tiny caps (nit). |
| AC-10: independent channels | Pass | All five cases are covered |
| AC-11: env overrides | Pass | Temp root with `CANON_PATTERNS_MD_PATH` / `CANON_PITFALLS_DOCS_ROOT` |
| AC-12: golden fixture restructure and regen | Pass | The anchored lens re-ran pitfalls and prompts: 89/89 |
| AC-13: real docs for `src/orchestrator/git.ts` | Pass | 17,514 bytes, nothing demoted (anchored-lens manual run) |
| AC-14: doc restatements | Pass | No stale "Known Codebase Pitfalls" or "pre-injects" text outside `tasks/_archive` |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

`src/orchestrator/pitfalls.ts` is a careful, well-tested implementation of a fairly intricate selection spec. Channels, dedup, cap and independence all behave as specified. Three issues need a fix: a target-cell heuristic that both Claude lenses reproduced as injecting the wrong section, an AC-5 assertion that cannot fail for the behaviour it names, and a scaffold guidance H3 that the new selector itself treats as a pitfall entry.

### Findings

#### Correctness Bugs

1. **`code-bug` — Target cell picked by the first cell that resolves, including prefix-only matches.** Flagged by 2 lenses (anchored and cold-Claude), each with an independent reproduction. Location: `src/orchestrator/pitfalls.ts:435-444` (`buildIndexRows`), together with `sectionHeading` at `:149-158`. In the row `| Testing | Fixture Rules | tests/** |`, with a `## Testing Utilities` heading in the doc, the Area cell "Testing" resolves by prefix and becomes the target. "Testing Utilities" is injected in full and "Fixture Rules" is dropped, with no warning. The same happens with short area labels such as "State", "Build", or "Known" (which would match the whole `## Known Pitfalls`). The spec says to "detect the target cell by content" but does not say how to choose between several resolving cells, so this is within the implementer's latitude to fix. Suggested fix: rank candidate cells so that a cell whose items all resolve, by exact heading or doc path, beats a cell that resolves only by prefix. Add a regression test with the reproduction row above.
2. **`code-bug` (test integrity) — the AC-5 `doc §Section` case is not independently verified.** Location: `tests/pitfalls.test.ts:89-110`. The same fixture contains `| Testing | Testing | src/a/b.ts |`, which injects `## Testing` by itself. The `§Testing` assertions would therefore still pass if `doc §Section` parsing returned `[]`. Use a separate fixture that has only the `§Testing` row. Assert that `## Testing` is injected and that no "Open docs/patterns.md" line appears, so `§` provably does not make patterns.md a linked doc.
3. **`code-bug` — the scaffold's format guidance is itself a selectable pitfall entry.** Location: `templates/docs/patterns.md:77-81`. `### Pitfall format` sits under `## Known Pitfalls` and cites `` `app/src/store/**` ``. Every scaffolded adopter therefore sees "Pitfall format" as a pitfall title. An adopter with `app/src/store/` files gets the authoring instructions injected in full as a pitfall that "cites your files". Its "add a table under this heading" also tells adopters to put the index table inside that H3, where the H3 would absorb every index glob. Suggested fix: move the format guidance into the section's blockquote/TODO, or remove the backticked path token from it, and say "under `## Known Pitfalls`". Keep `### Reset derived state…` as the one example entry.

#### Risk / Guardrails

- **Legacy Known Pitfalls with no H3 entries now inject nothing.** Location: `src/orchestrator/pitfalls.ts:160-169`, reported by cold-Claude. An adopter whose `## Known Pitfalls` is bullets or paragraphs with no H3s and no table gets `""`. The old builder injected the whole section. This follows the spec's definition (entries are H3s) and is not blocking. The human should decide whether a cheap fallback is wanted (treat an H3-less Known Pitfalls section as one entry, or at least list it in the title index), or a CHANGELOG/upgrade note.
- **Tables inside individual pitfall entries feed the area index.** Location: `src/orchestrator/pitfalls.ts:300-336`, `:424-427`, reported by anchored. An explanatory table inside an entry adds index lines and possible false keys. This is a literal reading of "the table(s) inside `## Known Pitfalls`". It is low severity; consider limiting index tables to those not nested under an H3.
- **`selectPitfalls` swallows all exceptions.** Location: `src/orchestrator/pitfalls.ts:704-710`, reported by cold-Claude. A parser bug would silently remove all pitfalls from the prompt. A one-line stderr warning would make that visible. Low severity.
- **`isPathInsideRoot` is lexical only.** Location: `src/orchestrator/pitfalls.ts:510-515`, reported by cold-Claude. The sibling `isSafeRepoPath` in `src/orchestrator/context.ts` also checks `realpathSync`. Doc paths are repo-controlled, so the risk is small, but reusing the sibling guard would keep the two consistent.
- **AC-13 depends on the live docs.** Location: `tests/pitfalls.test.ts` AC-13, flagged by 2 lenses. The extra `lessonsStart > fullStart` assertion goes beyond AC-13, and a routine `/canon-sweep` that removes git.ts lessons could break CI. Consider dropping that assertion.

#### Optional Cleanup / Nit

- `src/orchestrator/pitfalls.ts:669-701`: the cap is soft by the size of the framing, headers, demoted list and note. At a 500-byte cap the cold lens got 776 bytes. This is immaterial at 24 KB, but the demoted-list length is unbounded.
- `src/orchestrator/pitfalls.ts:107`: the heading regex strips a trailing `#` without a preceding space, so `### Use C#` becomes "Use C". CRLF docs leave `\r` in injected bodies (`:82`). A single-line ```` ```x``` ```` opens a fence that never closes (`:93-104`).
- `src/orchestrator/pitfalls.ts:612`: `titleEntries.set(lessonsDoc.path, [])` is a no-op.
- `src/orchestrator/pitfalls.ts:721` vs `:726`: `||` vs `??` asymmetry; an empty `CANON_PATTERNS_MD_PATH` drops patterns. Inherited from the old builder.
- `src/orchestrator/pitfalls.ts:450`: area-index lines show raw relative links (`pitfalls/state.md`). The resolved path would read better.
- `src/orchestrator/pitfalls.ts:380-384`: a Known Pitfalls row that links `docs/lessons-learned.md` would bypass the lessons example exclusion.
- `tests/pitfalls.test.ts` AC-11: put `fs.rmSync` in a `finally`.
- `templates/docs/patterns.md`: the old guidance to cite symbols as `` `SYMBOL` in `path/file.ts` `` (for the docs-refs check) was dropped. Consider restoring one sentence.
- `tests/run-task-prompts.golden.json`: the state header now says "1 file(s) pre-loaded inline (0.0 KB)" for a nonexistent fixture path. Known Risks anticipated this; it is cosmetic.

#### Spec Gaps

(none blocking — see Dismissed for spec-defined matching limits worth a follow-up)

### Dismissed Cold Findings

- Dismissed (cold-Claude): directory or glob Affected Files (`src/orchestrator/`) select no pitfalls because matching is one-way. The spec §Definitions (`spec.md:32`) defines Match as token equals file, token is a directory prefix, or token is a glob matching the file, which is one-way by design. Affected Files is also one file per row by convention. The anchored lens raised the same point as a spec gap. It is recorded here as a follow-up candidate, not a defect.
- Dismissed (cold-Claude): root-level files (`package.json`) can never be selected. The spec's path-like token definition (`spec.md:31`) requires `/` or `*` and excludes bare basenames on purpose. This is a deliberate precision tradeoff and a follow-up candidate.
- Dismissed (cold-Claude): the area index always lists every row (about 4.7 KB with no Affected Files). AC-4 requires every index row to appear regardless of Affected Files, and the cap bounds the size.
- Dismissed (cold-Claude): the golden fixture change alters unrelated "Relevant files" goldens. AC-12 mandates the restructure with nonexistent fixture paths, and Known Risks anticipated the side effect. It is kept as a nit above, not test-integrity.
- Dismissed (cold-Claude): `path.resolve('tests/fixtures/pitfalls-docs')` is cwd-dependent. `npm test` always runs from the package root, as do the other fixture paths in this suite. Low confidence, not reproduced.
- Dismissed (cold-Claude): `stripLineSuffix` handles only `:N` / `:N-M`. That is exactly the spec's definition (`spec.md:31`).
- Cold-Codex: no actionable findings reported; nothing to dismiss.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement


## Round 2 — verifying iteration 1's response to round 1

**Scope:** Delta — base `7487bd2b828ef5e23c51f039735b6d86c750d5a9` — reason: small fix within the files already under review

Lenses: anchored Claude (full task diff; `changes_requested`), cold-Claude (delta only; `changes_requested`), and cold-Codex (delta only; injected; no actionable findings, focused pitfalls suite passes).

Foreman housekeeping: the round 1 text above contained backslash-escaped backticks inside code spans. `npm run docs-refs-check` read one of them as a broken ref (`review.md:65`, the "unrelated" Fail recorded in the iteration 1 handoff). I removed the escapes from those two round 1 lines; the wording is unchanged. `docs-refs-check` now reports "All refs OK".

### Stage 1 — Acceptance Criteria Re-Check

Stage 1 passes (anchored lens). The spec has no red-first ACs. The iteration section omits a Self-Check subsection; that omission is recorded as a nit below.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 1) | No `buildKnownPitfalls` references remain; both builders call `buildRelevantPitfalls` |
| AC-2 | Met (unchanged from round 1) | AC-2 test |
| AC-3 | Met | Realpath containment was added for linked docs, with a symlink test |
| AC-4 | Partial | The literal fixtures pass, but the new H3 exclusion drops index tables, including Trigger Tables grouped under H3s (finding 2) |
| AC-5 | Partial | The isolated `§Testing` fixture and the Testing/Fixture Rules collision test pass, but the new scoring regresses rows whose key cell cites a `.md` file, including canon-ai's real Lint row (finding 1) |
| AC-6 | Met (unchanged from round 1) | Dedup test |
| AC-7 | Met | The fixture now uses CRLF and includes a one-line fence; the test asserts no carriage returns |
| AC-8 | Met | Adds a C# heading case |
| AC-9 | Met | A 500-byte cap test was added, with a hard fallback |
| AC-10 | Met (unchanged from round 1) | Independence tests |
| AC-11 | Met | Cleanup is now in `finally` |
| AC-12 | Met (unchanged from round 1) | The goldens are unchanged; pitfalls plus prompts: 91/91 (anchored lens run) |
| AC-13 | Met | The test uses the real patterns doc with lessons set to null; both full entries are asserted |
| AC-14 | Met | The scaffold format guidance moved to the blockquote and the symbol-with-path sentence is restored; `sync-templates:check` passes |

### Verifying Round 1 findings

- _code-bug 1:_ the target cell was taken from the first cell that resolved by prefix → **addressed** for the reported case (`src/orchestrator/pitfalls.ts:458-475`, regression test `tests/pitfalls.test.ts:111-119`). The replacement scoring introduces new finding 1.
- _code-bug 2:_ the AC-5 `§Testing` assertion was masked → **addressed** (`tests/pitfalls.test.ts:120-128`, isolated fixture plus a no-"Open" assertion) ✓
- _code-bug 3:_ the scaffold `### Pitfall format` H3 was treated as an entry → **addressed** (`templates/docs/patterns.md:77-79`) ✓
- _risk:_ a legacy Known Pitfalls section with no H3s injects nothing → still open, by design. It is now an `[ambiguity]` Blocker in the handoff, and the human decides.
- _risk:_ tables inside entries fed the area index → addressed, but over-broad. See new finding 2.
- _risk:_ swallowed exceptions → addressed (a warning is logged and tested) ✓
- _risk:_ the root containment check was lexical only → addressed for linked docs (realpath plus test) ✓
- _risk:_ AC-13 depended on the live lessons file → addressed ✓
- _nits:_ soft cap, C# heading, CRLF, one-line fence, the no-op set, AC-11 `finally`, the symbol guidance → addressed. The `||`/`??` asymmetry, raw relative links in index lines, a lessons link bypassing the example exclusion, and the golden "0.0 KB" header remain, all optional.

### New findings (only NEW issues introduced by Iteration 1's changes)

1. **`code-bug` — target-cell scoring lets a key cell that cites a `.md` file become the target.** Flagged by 2 lenses (anchored and cold-Claude), both reproduced against canon-ai's own `docs/patterns.md`. Location: `src/orchestrator/pitfalls.ts:401-403` (linked doc path gets specificity 3) and `:465-470` (the tuple ends with ascending `index`, so the later column wins ties).
   - In the Trigger Table row "Lint / TS suppression / any — Lint & Type Safety Policy — src/orchestrator/prompts/templates/implement.md", the Key-files cell outscores the exact section name and becomes the target.
   - With Affected File `src/orchestrator/prompts/templates/implement.md`, the row loses its key and its "(matches this task)" marker, and `## Lint & Type Safety Policy` is no longer injected. At `7487bd2` it was injected.
   - The key-cell `.md` is also treated as a linked pitfall doc. A Known Pitfalls row whose "Before touching" cell is a `.md` glob flips the same way.
   - Cold-Claude adds two variants: a linked target scores 3 even when the doc cannot be read, and ties go to the rightmost column.

   Suggested fix: a cell must not win as target when doing so leaves the row with no path keys. Prefer the leftmost cell on ties, and don't let an unread or nonexistent `.md` outrank an exact section match. Add regression tests for a section cell plus a single `.md` key cell (the real Lint row shape) and for a `.md` glob in a Known Pitfalls key cell.

2. **`code-bug` — the H3 exclusion in `tableRowsInSection` drops legitimate index tables.** Flagged by 2 lenses (anchored and cold-Claude), both reproduced. Location: `src/orchestrator/pitfalls.ts:310-322`.
   - The exclusion applies to Trigger Table sections as well as Known Pitfalls. A Trigger Table grouped under H3 subheadings (an H3 named Frontend, then a table) loses every row and section target. The fixture injected the `## Rules` section at `7487bd2` and returns an empty string at HEAD.
   - A Known Pitfalls index table placed after the H3 entries is also silently dropped.
   - That breaks AC-4 ("every index-table row appears") for layouts outside the fixtures.

   Suggested fix: limit the entry-table exclusion to the Known Pitfalls section, and within it to tables inside a pitfall entry's body, not every line under any H3. Add a Trigger-Table-under-H3 regression test.

#### Risk / Guardrails (non-blocking)

- `src/orchestrator/pitfalls.ts:750-756` (anchored and cold-Claude): when the last-resort fallback fires, it replaces the whole block with one summary line. That drops every title and index pointer at once, and `utf8Prefix` can cut the summary mid-sentence. This only happens when the framing or the demoted list alone exceeds the cap, which is unlikely at 24 KB. Low.
- Iteration 1 has no Self-Check subsection for its new tests (anchored). Low.

#### Optional Cleanup / Nit

- `src/orchestrator/pitfalls.ts:673-674`: `cap: Infinity` maps to the default cap rather than "no cap". No caller passes Infinity.
- `src/orchestrator/pitfalls.ts:110-112`: a heading made only of hashes keeps "###" as its title. Negligible.
- `compareTargetCellScores` (`:303-308`): document the tuple ordering intent once finding 1 is fixed.

### Dismissed Cold Findings

- Dismissed (cold-Claude): adopters who followed the old "add a table under this heading" scaffold text lose their split-doc index. That sentence existed only on this task branch (`main` ships the older "Each entry should be a short paragraph" format with no such instruction), so no released adopter followed it. The general H3-nested-table loss is covered by finding 2.
- Dismissed (cold-Claude): the realpath guard isn't applied to the lessons and patterns reads. Those paths are fixed by canon under the docs root, not derived from doc content. Only linked-doc paths come from the docs themselves, and those are now guarded.
- Dismissed (cold-Claude): a TOCTOU gap between realpath and read. The inputs are local, repo-controlled docs, and an attacker who can swap symlinks there already controls the repo.
- Dismissed (cold-Claude): `console.warn` noise on selector failure. Round 1 asked for this visibility. It fires only on unexpected exceptions.
- Dismissed (cold-Claude): AC-13 no longer checks real lessons. Round 1 recommended dropping that assertion as sweep-fragile, and AC-7 covers lessons selection with a fixture.
- Dismissed (cold-Claude): removing `titleEntries.set(lessonsDoc.path, [])` changes map ordering. An empty title list never rendered, so the output is unchanged.
- Folded into finding 1 (not dismissed): cold-Claude's rightmost-tie-break, unreadable-linked-doc scoring, and "mixed doc-section row no longer covered" items.
- Cold-Codex: no actionable findings; nothing to dismiss. Note that both Claude lenses reproduced finding 1 and finding 2 as regressions against `7487bd2`, which the current tests do not catch.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap


## Round 3 — verifying iteration 2's response to round 2

**Scope:** Delta — base `7cc77d2ba682f0dff67539dc4e96c0aa052c0afa` — reason: small fix within the files already under review

Lenses: anchored Claude (full task diff; `changes_requested`), cold-Claude (delta only; `changes_requested`), cold-Codex (delta only; one P2). Under round 3 discipline, only correctness bugs and spec gaps drive the verdict; nits are folded in or omitted.

### Stage 1 — Acceptance Criteria Re-Check

Stage 1 passes (anchored lens). The focused suite passes 14/14, and the handoff reports all Iteration 3 validation rows as Pass. The spec has no red-first ACs.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 2) | `buildRelevantPitfalls` is used at both call sites |
| AC-2 | Partial | An entry whose path citation sits in a table inside the entry loses its direct match (spec gap A) |
| AC-3 | Partial | In a 3-column Known Pitfalls row (area, doc, keys), an area label that prefix-matches a heading outranks the linked doc (spec gap B) |
| AC-4 | Partial | Trigger Tables under H3 headings and index tables placed after entries now appear. A Known Pitfalls table without a recognized signal is dropped (spec gap A) |
| AC-5 | Met | The real Lint row and a `.md` glob key are fixed and tested (`tests/pitfalls.test.ts:107-120`, `:395-402`) |
| AC-6 | Met (unchanged from round 2) | Dedup test |
| AC-7 | Met (unchanged from round 2) | Lessons test |
| AC-8 | Met (unchanged from round 2) | Token test |
| AC-9 | Met | Demoted titles truncate with a count, and the fallback is all-or-nothing |
| AC-10 | Met (unchanged from round 2) | Independence tests |
| AC-11 | Met (unchanged from round 2) | Override test |
| AC-12 | Met (unchanged from round 2) | The goldens did not change |
| AC-13 | Met | The real-doc Lint row is now asserted |
| AC-14 | Met (unchanged from round 2) | Docs restatements |

### Verifying Round 2 findings

- _code-bug 1:_ a `.md` key cell became the target → **addressed** for the reported shapes. The real Lint row and markdown glob keys are fixed and tested. The replacement ranking (`remainingPathKeys` first) regresses the linked-doc layout (spec gap B).
- _code-bug 2:_ the H3 exclusion dropped index tables → **addressed** for Trigger Tables under H3 headings and for index tables after entries, with tests. The replacement content heuristic (`isIndexTable`) misclassifies explanatory tables (spec gap A).
- _risk:_ the fallback cut its summary mid-sentence → addressed ✓
- _risk:_ no Self-Check for the iteration's tests → still open. Not verdict-driving in round 3.

### New findings

Both surviving findings are the same bug class coming back for the third round in a row. Each iteration's content-only heuristic fixes the layout that was reported and breaks another layout that the previous rule handled. The implementer flagged the first one in the handoff as an `[ambiguity]` Blocker (`handoff.md:183`). Neither has a content-only rule in the spec that the implementer can converge on, so I classify both as spec gaps rather than sending them back for a fourth implement pass.

**A. `spec-gap` — the spec cannot tell an index table from an explanatory table inside an entry.** Flagged by 3 lenses (anchored, cold-Claude, cold-Codex P2); cross-model agreement. Location: `src/orchestrator/pitfalls.ts:172-182`, `:367-384`.
- `isIndexTable` marks a Known Pitfalls table as an index when any cell holds a path token, an em dash or "no key", or text that resolves to a heading, including by prefix.
- Effect on explanatory tables. Reproduced: a `| File | Why |` table citing src/queue/worker.ts inside `### Worker retries`, a table cell "Timer" next to a "Timer cleanup" heading, and an em-dash placeholder cell. In each case the table is stripped from the entry body and dumped into the area index. When the path citation is in the table, the entry also loses its direct match: at `7cc77d2` it was injected in full, and at HEAD it shows only as a title.
- Effect on real index tables. A top-level table with no recognized signal (an unbackticked doc path) is now dropped from the area index entirely.
- Test integrity: the AC-4 fixture was changed from a path-bearing nested table to a path-free one, which hides the first effect.
- Root cause in the spec: `spec.md:34` defines Known Pitfalls entries as every H3 between `## Known Pitfalls` and the next H2. `spec.md:35` defines index tables as "the table(s) inside `## Known Pitfalls`". A table inside an H3 entry satisfies both definitions, and nothing says which wins.
- Proposed resolution for the human: Known Pitfalls index tables are the tables directly under the H2 and before its first H3. Tables inside an H3 are always entry content. The scaffold already tells adopters to put the table "directly under `## Known Pitfalls`, before the H3 entries" (`templates/docs/patterns.md:79`). This drops support for an index table placed after the entries, which round 2 asked for; that trade-off is the human's call.

**B. `spec-gap` — the content-only rule for picking the target cell has no precedence when several cells resolve.** Flagged by 2 lenses (anchored, cold-Claude). Location: `src/orchestrator/pitfalls.ts:497-506`.
- The round 1, 2, and 3 rules (first resolving cell, then linked docs ranked highest with a rightmost tie-break, then most remaining path keys with a leftmost tie-break) each broke a real layout.
- At HEAD, a row with an area cell "State", a doc cell docs/pitfalls/state.md, and a keys cell `app/src/store/**`, next to a "State Management Rules" heading, injects that unrelated section. The linked doc's matching entry and its "Open" pointer are dropped. At `7cc77d2` the linked doc won.
- Cold-Claude also showed that leftmost tie-breaking makes an area cell that names a heading exactly beat the Section column. Rightmost tie-breaking broke the Lint row in round 2.
- Root cause in the spec: `spec.md:36` and `spec.md:131` require content-only detection ("not by column name") but give no precedence when more than one cell resolves. Known Risks (`spec.md:161`) assumes content-based detection is enough for table variety, and three rounds of regressions show it is not.
- Proposed resolution for the human, choose one:
  - (a) Use the header as a hint: a column whose header contains "Section", "doc", or "Read this" is the target cell, with content detection as the fallback for unrecognized headers.
  - (b) Write an explicit precedence into the spec. For example: count remaining keys excluding tokens that themselves parse as doc targets; then prefer an exact section or a doc path over a prefix-only section; then take the leftmost cell. Pin it with tests for the Lint row, the 3-column State row, and the area-equals-heading row.

### Dismissed Cold Findings

- Dismissed (cold-Claude): the order of the cap passes (area-index rows are trimmed before demoted titles). AC-9 orders title truncation and then area rows, and does not place demoted titles at all. The output stays within the cap. This is not a correctness bug for round 3. Note it for the spec revision if desired.
- Dismissed (cold-Claude): an explanatory table under a Trigger Table H3 is treated as an index. `spec.md:35` defines every table under the Trigger Table heading as an index table, so this follows the spec.
- Dismissed (cold-Claude): the empty fallback when even the summary exceeds the cap. This happens only at caps below about 200 bytes. The real cap is 24 KB, and returning nothing is better than a truncated heading (the round 2 concern).
- Dismissed (cold-Claude): the missing semicolon relies on ASI, and `remainingPathKeys` rescans each cell. Both are style or performance points; lint passes.
- Folded, not dismissed: cold-Claude's test-integrity point on the cap ordering test goes with the cap-order note above. The AC-4 fixture weakening is part of A. The leftmost tie-break and the dropped unrecognized table are parts of B and A.
- Cold-Codex: its P2 (an em-dash cell in an explanatory table classifies it as an index) is verified and is part of A.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [x] Spec gap

---

<!--
On re-review, append below this line:

Heading rule for ANY append to this file: only real review rounds may use a
`## Round N` heading. The verdict parser scopes to the latest `## Round` body —
an administrative block (pre-flight rejection, halt note, audit stamp) headed
`## Round …` with no verdict checkbox makes the parser return no verdict and
breaks routing. Administrative appends use a non-Round heading (e.g.
`## Pre-Flight Rejection (round N)`) and omit the verdict checkbox entirely.

## Round N — verifying iteration N-1's response to round N-1

**Scope:** Full | Delta — base `<baseBranch or prevSHA>` — reason: <trigger reason, or "delta">

### Stage 1 — Acceptance Criteria Re-Check

Re-fill this table with every AC from spec.md against the latest code. Earlier AC tables were snapshots of earlier iterations, not reusable proof. ACs whose relevant code paths did not change may be marked `Met (unchanged from round N-1)` with a one-line evidence pointer.

| AC | Status | Notes |
|---|---|---|
| AC-1: ... | Met / Partial / Not Met | ... |
| AC-2: ... | Met / Partial / Not Met | ... |

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line; AC-N now Met in table above) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
