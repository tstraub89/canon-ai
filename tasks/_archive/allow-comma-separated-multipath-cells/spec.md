# Spec: allow-comma-separated-multipath-cells — Accept comma-separated multi-path cells in handoff Changes and spec Affected Files tables

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

The handoff/spec table-cell parser `parseHandoffPathCell` in `scripts/run-task/validation.ts` hard-rejects any first-column cell containing more than one backticked path or markdown link, with the reason `multiple paths in one cell (…) — list one path per row`. Codex routinely writes combined rows of the form `` `a.ts`, `b.ts` `` in `handoff.md` (real examples in `tasks/_archive/retire-runtime-validation/done.md`, e.g. `` `AGENTS.md`, `CLAUDE.md`, `CODEX.md` + mirrors ``), so the gate trips repeatedly and the operator has to hand-split rows to unblock the pipeline. This is recurring, confirmed-by-inspection friction, not a hypothesis: the rejection branch is `backtickGroups.length + mdLinkGroups.length > 1` in `parseHandoffPathCell`, and the operator has been paged for exactly this failure multiple times.

The strictness was intentional at the time: the pre-1.3.0 lax parser extracted only the *first* backticked token from a combined row and silently dropped the rest, which then failed the diff→handoff coverage check confusingly. Rejecting loudly was the fix for silent dropping — but the better fix is to parse the whole list. Extracting *all* comma-separated paths removes the silent-drop failure mode the strictness existed to prevent, while every downstream safety property (auto-commit staging cross-check, handoff→diff existence check, base-drift allow-list) continues to operate on the full extracted path set.

This is a deliberate gate-behavior change (a relaxation with preserved invariants), not a bug fix in the red-first sense; the regression-test obligation is covered by new acceptance tests that fail on the pre-change parser (AC-1…AC-7 are all red before the change).

## Decision

A first-column cell in the handoff `## Changes` / `### Changes` tables and the spec `### Affected Files` tables may contain **one or more** path tokens — each a backticked path or a `[label](url)` markdown link — **separated by commas**, optionally followed by a single free-text annotation after the last token. All paths in the cell are extracted and contribute to the parsed file set. Every extracted path still passes the existing per-path validation (no wildcards, no `<placeholder>`, no absolute paths, no `..` traversal). Cells that mix prose between path tokens, or juxtapose multiple tokens without comma separators, remain malformed with actionable reasons.

The comma-separated list becomes the documented, first-class format in the handoff template (not a merely-tolerated deviation), with style guidance that grouping suits tightly-coupled files (canon-managed root files with their `templates/` mirrors, generated artifacts) while unrelated files read better on separate rows.

### Cell grammar (behavioral contract)

- A cell is a sequence of one or more **tokens**, where a token is `` `path` `` or `[path](url)`, starting at the beginning of the cell (after trim).
- Consecutive tokens are separated by a comma with optional surrounding whitespace.
- After the **last** token, an optional annotation may follow (whitespace-separated), exactly as the single-path form allows today. The annotation must not contain further backticked tokens or markdown links — any additional token is a path claim and must be comma-joined into the list.
- Tokenization is sequential over the token grammar — **not** a naive `split(',')` of the raw cell — so a comma *inside* a single backtick group (`` `a,b.ts` ``) remains one literal path (today's behavior, preserved), and a comma inside the trailing annotation (`` `a.ts` fixes gate, message ``) does not create phantom tokens.
- A separator comma **promises another token**: a comma followed by anything other than a token — a dangling comma (`` `a.ts`, ``) or comma-then-prose (`` `a.ts`, `b.ts`, plus mirrors ``) — is malformed. The annotation attaches after the last token *without* a joining comma.
- Prose between tokens (`` `a.ts` regenerated, `b.ts` ``) → malformed. Tokens juxtaposed without a comma (`` `a.ts` `b.ts` ``) → malformed (comma is the only list separator). A token appearing *inside* the trailing annotation (`` `a.ts`, `b.ts` and `c.ts` ``) → malformed — it is a path claim that must be comma-joined, never silently treated as annotation.
- Per-path validation runs on each extracted path independently. A failing path yields its own malformed entry (reason names that path); passing sibling paths in the same cell are still extracted. Callers that die on any malformed entry (`autoCommitCode`) are unaffected in strictness.

## Non-Goals

- **No rename syntax in cells.** Renames stay two rows (one per side); no `old -> new` cell form is introduced.
- **No whitespace- or semicolon-delimited lists.** Comma is the only separator; `` `a.ts` `b.ts` `` without a comma stays malformed.
- **No relaxation of prose-embedded-path rejection** (`` AC-9: `sitemap.xml` passes `` stays malformed) and no relaxation of the per-path checks (wildcards, placeholders, absolute, traversal).
- **No changes to `scripts/run-task/prompts/helpers.ts`, `scripts/run-task/prompts/index.ts`, or any prompt template** — the injected prompt strings do not state a one-path-per-row rule, so `tests/run-task-prompts.golden.json` must not change.
- **No changes to rename-pair handling** (`parseDiffNameStatus`, `verifyHandoffAgainstDiffFromData` covered-path expansion) — renames never come from cell parsing.
- **No skill-file edits** (`.claude/skills/canon-*`): their Affected-Files wording ("specific files, not directories") is compatible with comma lists.

## Acceptance Criteria

- [ ] AC-1: A Changes-table cell `` `a.ts`, `b.ts` `` parses to both paths with zero malformed entries. Verify: new unit test in `tests/run-task-validation.test.ts` exercising `parseHandoffChangesRows` (red on pre-change code, which rejects with "multiple paths in one cell").
- [ ] AC-2: Mixed token kinds parse: `` [a.ts](a.ts), `b.ts` `` yields both paths. Additionally, two markdown-link tokens in a list where the **first** link's destination contains balanced parentheses — `` [a.ts](/tmp/build(x)/a.ts), [b.ts](b.ts) `` — parse to exactly `a.ts` and `b.ts`: the parens inside the first destination neither split the list nor truncate the first token. Verify: unit tests. (This case pins the separator boundary against nested markdown-link parens — the behavior formerly covered by the deleted `extractHandoffPath: markdown-link URL with parens` test, AC-8; the single-token link tests do not exercise it in a list context.)
- [ ] AC-3: A trailing annotation after the last token is accepted with all paths extracted: `` `a.ts`, `b.ts` + mirrors `` yields `a.ts` and `b.ts`. An annotation containing a comma (`` `a.ts` fixes gate, message ``) yields exactly one path. Verify: unit tests for both.
- [ ] AC-4: Structure violations are malformed, never silently reinterpreted. Four cases, each with a unit test asserting its reason: (a) prose between tokens (`` `a.ts` regenerated, `b.ts` ``); (b) comma-less juxtaposition (`` `a.ts` `b.ts` ``), reason naming the comma requirement; (c) a token inside the trailing annotation — `` `a.ts`, `b.ts` and `c.ts` `` and the markdown-link variant `` `a.ts` see [b.ts](b.ts) `` — reason stating extra paths must be comma-joined (this is the silent-drop resurrection case; the cell must NOT parse to a subset of its paths); (d) dangling/comma-then-prose (`` `a.ts`, `` and `` `a.ts`, `b.ts`, plus mirrors ``), reason stating a comma must be followed by another path token.
- [ ] AC-5: Per-path validation applies per extracted path: `` `a.ts`, `src/*.ts` `` yields `a.ts` in `files` AND a malformed entry whose reason names `src/*.ts` as a wildcard. Same structure for a `<placeholder>`, absolute, or traversal sibling (one representative test each is sufficient). Verify: unit tests.
- [ ] AC-6: A comma inside one backtick group stays a single literal path: `` `a,b.ts` `` parses to exactly one path `a,b.ts`. Verify: unit test (guards against naive `split(',')` implementations).
- [ ] AC-7: `parseAffectedFilesFromSpec` accepts comma-separated cells in `### Affected Files` tables under both `## Design` and `## Amendment` bodies, extracting all paths. Verify: unit test.
- [ ] AC-8: Replace `extractHandoffPath` with nothing — delete the function and its tests. It has zero non-test callers (`scripts/`, `src/` grep-verified), and any "first path of a multi-path cell" contract would re-encode the silent-drop semantics this task retires. Verify: `grep -rn "extractHandoffPath" scripts/ src/ tests/` returns zero hits; `extractHandoffPath` must not exist after this task.
- [ ] AC-9: The retired wording is gone from every operative guidance surface: `grep -rnE "multiple paths in one cell|one path per (row|line)|single-path-per-row|no combined paths|rejects >1 backtick" scripts/ src/ tests/ docs/ .canon/ templates/ .github/` returns zero hits. The grep pattern is broadened beyond the original three phrases specifically to catch the two `docs/BACKLOG.md` occurrences the narrower regex missed (`single-path-per-row`, `rejects >1 backtick`). Known pre-change hits, all in scope:
  - `scripts/run-task/validation.ts` — parser reason strings ("multiple paths in one cell").
  - `scripts/run-task/main.ts` — `autoCommitCode` malformed-row die message.
  - `tests/run-task-validation.test.ts` — assertion regexes on the retired reasons (AC-11).
  - `.canon/templates/handoff.md` + its `templates/` mirror — "no combined paths" wording (rewritten by AC-10, mirror regenerated).
  - `docs/BACKLOG.md` — **three** semantic occurrences in the multi-table design note, not one: (1) line ~48's present-tense claim that `parseHandoffPathCell rejects >1 backtick`; (2) line ~49's proposed warn-message parenthetical "(one path per row)"; (3) line ~51's "single-path-per-row" workaround. All three are reworded to reflect that a cell may now list comma-separated paths, **without** altering the entry's still-open core problem (the multi-table `parseTableH3` silent-drop). The *other* `parseHandoffPathCell` references in `docs/BACKLOG.md` (the deletion-handling entry near line ~789) stay untouched — they describe behavior this task does not change.

  `tasks/` is deliberately excluded from the grep — archived artifacts and this spec are historical record. The `autoCommitCode` malformed-row die message describes the accepted format (a comma-separated list of backticked paths / markdown links; no wildcards/placeholders; annotation after the last path) instead of "one path per line". Verify: grep returns zero hits + read the reworded die message and all three BACKLOG lines.
- [ ] AC-10: `.canon/templates/handoff.md` documents the comma-separated list as a first-class format in **both** table notes (the baseline `## Changes` note and the per-iteration `### Changes` note), including the style nudge (group tightly-coupled files such as `templates/` mirrors; unrelated files on separate rows) and the retained prohibitions (no wildcards, no placeholders, no prose-embedded paths). Verify: read both notes; `npm run sync-templates:check` passes (mirror `templates/.canon/templates/handoff.md` regenerated).
- [ ] AC-11: All existing single-path behaviors are regression-covered: the full `npm test` suite passes across **every** affected suite (`tests/run-task-validation.test.ts` and `tests/task-cli.test.ts` — see AC-13), with the previously-asserted rejection tests updated rather than deleted (each former "multiple paths" rejection test is replaced by its acceptance counterpart, not dropped — except the `extractHandoffPath` tests, which are deleted with the function per AC-8).
- [ ] AC-12: `npm run build` is run and the resulting `dist/cli/index.js` and `dist/scripts/run-task.js` are committed (CI enforces `git diff --exit-code -- dist/`).
- [ ] AC-13: The `tests/task-cli.test.ts` integration test `task accept refuses malformed handoff rows without --force` currently fixtures the now-**valid** comma form `` `src.txt`, `extra.txt` `` (both files committed to the work tree) and asserts `taskAccept` throws `/malformed Changes rows/`. After AC-1 that row is accepted end-to-end, so the assertion inverts. Resolve as **two** integration tests, not one: (a) an acceptance test proving the comma row flows through `taskAccept` without `--force` (both `src.txt` and `extra.txt` are covered by the diff, so `taskAccept` succeeds and does not throw `/malformed Changes rows/`); and (b) a retained refusal test whose fixture is a **genuinely** malformed row — prose between tokens (`` `src.txt` and then `extra.txt` ``) — still throwing `/malformed Changes rows/`. Both `src.txt` and `extra.txt` must exist and be committed in the acceptance case so the coverage check itself does not fail for an unrelated reason. Verify: the acceptance test is red on pre-change code (which throws today) and green after; the refusal test is green on both. `tests/task-cli.test.ts` is added to Affected Files.
- [ ] AC-14: `collectUnscannedTableHits` (the near-miss locator for file-list rows under **unrecognized** headings) retains every path in a comma-list cell, not just the first. Verify: unit test in `tests/run-task-validation.test.ts` feeding handoff content whose only file-list table sits under a non-coverage heading with a row `` `a.ts`, `b.ts` ``, asserting the returned `Map<string, string[]>` has an entry for **both** `a.ts` and `b.ts` (red on any `paths[0]`-only implementation — this is the same no-silent-subset invariant the task establishes, applied to the unscanned-table consumer).

## Design

### Affected Files

> Any protected doc Claude expects QA to touch (codebase-map, decisions, patterns, architecture, product-context, pipeline-orchestrator) must be listed here. Telemetry files (lessons-learned, task-quality-log, pipeline-invocations) are auto-committed and do not need a row.

| File | Change |
|---|---|
| `scripts/run-task/validation.ts` | `parseHandoffPathCell` implements the comma-separated token grammar and returns all extracted paths; per-path validation loop; distinct malformed reasons per failure class; `parseHandoffChangesRows`, `parseAffectedFilesFromSpec`, `collectUnscannedTableHits` consume multiple paths per ok cell; `extractHandoffPath` deleted (AC-8); docstrings updated to describe the new grammar |
| `scripts/run-task/main.ts` | Reword the `autoCommitCode` malformed-row die message (currently "Fix each row to one path per line…") to describe the comma-list format |
| `.canon/templates/handoff.md` | Both Changes-table notes document comma-separated multi-path cells as first-class, with style nudge and retained prohibitions |
| `templates/.canon/templates/handoff.md` | Generated mirror of the above (pre-commit sync) |
| `tests/run-task-validation.test.ts` | Flip the rejection assertions (`/one path per row/`, `/multiple paths in one cell/`); delete `extractHandoffPath` tests (AC-8); add AC-1…AC-7 acceptance/edge tests (incl. the AC-2 nested-parens markdown-link list case) and the AC-14 `collectUnscannedTableHits` multi-path coverage test |
| `tests/task-cli.test.ts` | Rework the `task accept refuses malformed handoff rows without --force` test whose fixture is now the valid comma form: split into an acceptance test (comma row flows through `taskAccept`) plus a retained refusal test with a genuinely-malformed fixture (AC-13) |
| `docs/BACKLOG.md` | Reword **all three** stale single-path occurrences in the multi-table design note — `rejects >1 backtick` (~line 48), the `(one path per row)` warn-message parenthetical (~line 49), and the `single-path-per-row` workaround (~line 51) — to reflect comma-list cells, leaving the entry's open multi-table problem intact (AC-9). The deletion-handling `parseHandoffPathCell` entry (~line 789) is untouched. |
| `docs/codebase-map.md` | Freshness fix (implement, alongside the parser change): line 54's "Regex-based; extracts backtick-wrapped paths" description of the handoff parser is already stale (parser handles markdown links) and this task adds multi-token comma lists. Correct it to note comma-separated backtick-path / markdown-link tokens per cell. Root-only doc (not in `CANON_OWNED`) — **no** `templates/` mirror row. |
| `dist/cli/index.js` | Rebuilt artifact (validation.ts is bundled into both entry points) |
| `dist/scripts/run-task.js` | Rebuilt artifact |

### Interaction Dependencies

All downstream consumers operate on the extracted `files[]` set and need no code change — they automatically benefit from complete extraction: `autoCommitCode` staging set (`scripts/run-task/main.ts`), implement-evidence auto-advance (`checkImplementEvidence`), `taskAccept` (`src/task/index.ts`), bundle coverage cross-check (`verifyHandoffAgainstDiff`), base-drift allow-list (`verifyBaseDrift`), human-review managed-doc allow-list (`commitHumanReviewFiles`), and the implement-prompt spec preload (`scripts/run-task/context.ts`). The load-bearing safety property — every dirty file in the handoff, every handoff file existing or committed — is enforced by those consumers, not by the cell parser, and is unchanged.

### Data Model Changes

`HandoffPathCellResult` (internal to `scripts/run-task/validation.ts`) changes shape so an ok result can carry multiple paths (exact shape is an implementation choice — e.g. `{ kind: 'ok'; paths: string[] }` plus per-path malformed entries). No persistent data, no `status.json` schema change, no template table-structure change.

## Validation Required

Universal change-type → check-category matrix (project command bindings are in `docs/architecture.md` §Validation):

| Change Type | Required Check Categories |
|---|---|
| Most changes | Linting, type checking, unit tests |
| Docs references | Docs references |
| Routes / config / build | Full build |

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build` — dist/ artifacts committed; `npm run sync-templates:check` clean
- [x] `npm run docs-refs-check` — required because this task edits `docs/BACKLOG.md`, `docs/codebase-map.md`, `.canon/templates/handoff.md`, and its `templates/` mirror; `docs/architecture.md` §Validation mandates it (and CI runs it) for any change touching `docs/`, `tasks/`, or `templates/`

## Docs Impact

`docs/codebase-map.md` is updated at implement (see Affected Files) — its line-54 parser description is stale. Remaining heads-up only: `docs/pipeline-orchestrator.md`'s Changes-table wording ("must list every changed file including both sides of renames") remains true under the new grammar; `docs/patterns.md`'s templates-mirror declaration pitfall likewise. QA should confirm neither implies one-path-per-row anywhere.

## Known Risks

- **Naive comma-splitting.** `split(',')` on the raw cell breaks two contracts at once: commas inside a backtick group (AC-6) and commas inside the trailing annotation (AC-3). The grammar must tokenize sequentially. AC-3/AC-6 tests exist specifically to make this failure red.
- **Silent widening of the malformed class.** Cells previously rejected loudly now parse — if the tokenizer mis-handles an exotic shape (e.g. annotation containing a backticked token or markdown link), a path could be silently treated as annotation, resurrecting the pre-1.3.0 silent-drop bug in a narrower form. Mitigation: any second token that is not comma-joined is malformed (never annotation), asserted directly by AC-4 case (c) — the token-in-annotation shape must reject, not parse to a subset of its paths.
- **Message-class conflation.** Validation Gate Discipline requires one message per failure class. The new malformed reasons must keep classes distinct: prose-between-tokens, missing-comma juxtaposition, and per-path failures (wildcard/placeholder/absolute/traversal, naming the offending path) each get their own reason string.
- **Docstring drift.** `parseHandoffChangesRows`'s long docstring documents the combined-row rejection rationale; leaving it stale would misinform the next maintainer. It must be updated to record that combined rows are now parsed in full (and why the old strictness is obsolete).
- **docs-refs-check on documented example paths (AC-10 / new required check).** `docs-refs-check` now runs on this task (Validation Required) and scans `.canon/templates/handoff.md`'s `templates/` mirror and `docs/BACKLOG.md`. When documenting the comma format in the handoff template, use the file's existing placeholder convention (`` `path/to/file.ext` ``), **not** invented real-looking paths — a backtick path-ref to a non-existent file under a `validDir` reads as a broken ref and fails the check (the same trap the template's own "Deleting a file?" note warns about). The BACKLOG rewordings only reword prose around existing symbol refs, so they add no new file refs.
- **Surgical BACKLOG edit.** `docs/BACKLOG.md`'s multi-table design note documents a *still-open* problem (`parseTableH3` silently drops tables 2..N). The three single-path rewordings (AC-9) must not weaken or resolve that entry — only remove the now-false "a cell may hold one path" implication. The separate deletion-handling entry (~line 789) describes behavior this task does not change and must be left untouched; broadening the AC-9 grep was chosen so it does not match that entry.

## Human Test Plan

1. Create a throwaway task and have the implementer list two changed files on a single row of the handoff changes table, separated by a comma (optionally with a short note after the second file).
2. Let the pipeline's implementation-commit step run.
3. Expected: the row is accepted and both files land in the implementation commit — no "multiple paths in one cell" rejection, no operator intervention.
4. Write a row that mixes a sentence between two file references (rather than a comma-separated list).
5. Expected: the pipeline rejects that row with a message explaining that file references must form a comma-separated list at the start of the cell, with any note coming after the last file.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes; N/A for features/refactors) — gate-behavior change; mechanism of the current rejection confirmed by direct inspection of `parseHandoffPathCell` and archived combined-row artifacts; AC-1…AC-7 are red-first on the pre-change parser
