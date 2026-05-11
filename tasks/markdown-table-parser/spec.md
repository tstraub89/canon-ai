# Spec: markdown-table-parser — Structured-table parser utility

> Written by: Claude | Review by: human (fast tier — S non-delicate)
> Status: draft

## Problem

The orchestrator reads structured information embedded in markdown tables — AC Coverage, Validation Outcomes, the Handoff Changes list — using ad-hoc regex and positional splits scattered across `scripts/run-task/validation.ts`. The AC Coverage check alone has failed in four distinct ways across past iterations (history in `docs/BACKLOG.md` § "Structured-table parser utility for orchestrator reads"). Each new structured-table artifact (architect-review four-question table, per-row audit verdicts in 1a-2's invariant gate) will recur the same brittleness unless the orchestrator has a single small parser to route every table read through.

The current state has four ad-hoc parses in `scripts/run-task/validation.ts`:
1. `checkAcCoveragePlaceholders` (line 12-44) — splits on `|` with positional column extraction; doesn't handle `\|` escapes.
2. `parseValidationOutcomeRows` (line 91-110) — positional column extraction.
3. `parseHandoffFiles` (line 208-227) — regex extraction from the first column only.
4. The bare `/\|\s*Fail\s*\|/i.test(content)` regex inside `validateHandoff` (line 52) — runs against the full file, not a parsed table.

The round-3 AC parser failure (escaped `\|` in cell content) shifted column boundaries and produced a false negative. The current (round 4) AC parser dodges that by counting placeholder rows by literal substring, which has a theoretical false positive if a handoff's prose quotes the template phrase elsewhere on the same line.

## Decision

Add a single small markdown-table parser utility at `scripts/run-task/markdown-table.ts`. Replace the four ad-hoc parses above with calls to the new utility. The parser is lossy-tolerant by design: every line that looks like a data row produces an entry in the output, with cells mapped to header column names by position. Missing trailing cells return empty strings; extra cells beyond the header count are dropped. Callers compose specific checks (e.g. "row has a Status value") against the parsed structure.

This is the markdown-only enforcement mechanism that lets future phases (1a-2 invariant gates, architect-review, audits) demand "the agent must complete this artifact before phase advancement" without resorting to JSON sidecars. The orchestrator can refuse to advance on missing or malformed rows by checking the parsed structure rather than by regex.

## Non-Goals

- **Stable validation IDs** (e.g. `VAL-1` in spec → `VAL-1` in handoff). Explicitly out of scope here — it's the follow-on entry in the BACKLOG (when the parser lands, follow it with a small ID-emitting spec template + ID-matching handoff parser). This spec only ships the parser plus retrofits.
- **JSON-sidecar artifact format**. The BACKLOG entry settles markdown-only with this parser as the enforcement mechanism; do not introduce JSON outputs from the parser or alongside the markdown.
- **Strict-mode parser** that throws on malformed rows. The parser is lossy-tolerant; strict semantics belong in the gate framework (1a-2), not in the parser itself.
- **Schema validation** (column-presence checks, value-domain checks). The parser turns markdown into structured rows; callers decide what's valid.
- **Multi-line cell content**. Markdown tables don't support it. Lines that don't start with `|` end the table.
- **Behavior change in existing validation diagnostics.** Retrofitted callers must produce the same diagnostic strings as today (existing test coverage in `tests/run-task-validation.test.ts` must still pass without modification beyond what the parser-induced refactor requires).

## Acceptance Criteria

- [ ] AC-1: New module `scripts/run-task/markdown-table.ts` exports `parseTable(markdown: string, sectionHeading: string): Array<Record<string, string>>`. Section heading match is case-sensitive on the H2 line (`## <sectionHeading>`). When the section is missing or contains no table, returns `[]`.
- [ ] AC-2: Parser handles escaped pipes (`\|`) in cell content correctly — a cell containing `foo \| bar` does not shift column boundaries. The escape sequence is unescaped to a literal `|` in the returned cell text.
- [ ] AC-3: Parser is lossy-tolerant: every line starting with `|` after the separator row produces a row in the output. Cells map to column names by position. Missing trailing columns return `""`. Extra cells beyond the header count are dropped (un-escaped pipe in content is the likely cause; preserving them would re-introduce literal pipes into cell text).
- [ ] AC-4: The separator row (`|---|---|---|` and variants like `|:--|:-:|--:|`) is detected and skipped — not returned as a data row.
- [ ] AC-5: Retrofitted: `checkAcCoveragePlaceholders` uses `parseTable(content, 'AC Coverage')` and checks the Status column on parsed rows. `parseValidationOutcomeRows` uses `parseTable(content, 'Validation Outcomes')`. `parseHandoffFiles` uses `parseTable(content, 'Changes')` and post-extracts the backticked path from the first column. The bare `/\|\s*Fail\s*\|/i` regex in `validateHandoff` is replaced by a parsed-row check on Validation Outcomes (`row['Result'] === 'Fail'` or equivalent — verify exact column name in the live template).
- [ ] AC-6: New `tests/markdown-table.test.ts` covers: basic table parse with named columns, escaped-pipe handling, missing-section returns `[]`, separator-row skipping, too-few-cells row returns empty trailing columns, too-many-cells row drops extras, mixed alignment in separator row, and "section heading exists but no table follows" returns `[]`.
- [ ] AC-7: Existing `tests/run-task-validation.test.ts` passes unchanged. Diagnostic strings produced by the retrofitted `validateHandoff` / `checkAcCoveragePlaceholders` / `parseValidationOutcomeRows` / `parseHandoffFiles` paths are identical to today's.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/markdown-table.ts` | NEW. Export `parseTable(markdown, sectionHeading): Array<Record<string, string>>`. ~30-50 lines incl. escape handling. |
| `scripts/run-task/validation.ts` | Retrofit `checkAcCoveragePlaceholders`, `parseValidationOutcomeRows`, `parseHandoffFiles`, and the bare `Fail` regex in `validateHandoff` to use the new parser. Inline pipe-split code in these functions is removed. |
| `tests/markdown-table.test.ts` | NEW. Unit tests per AC-6. |
| `tests/run-task-validation.test.ts` | No changes expected. If a test fixture needs updating because the parser correctly handles a case the old code didn't (e.g., an escape sequence that previously caused a false negative), update the fixture and call it out in the handoff. |

### Interaction Dependencies

- **1a-2 invariant gate framework** (next-after-next task in the Wave 3 cluster): will call `parseTable` directly for verdict-extraction from handoff/review tables. This task lands the parser; 1a-2 consumes it.
- **`canon dogfood-report`** (future): will read `docs/task-quality-log.md` rows via this parser.
- **Future architect-review phase**: per-question verdict table will use this parser.

### Data Model Changes

None. Parser operates on existing markdown artifacts; no schema changes, no `status.json` changes.

### Parser shape (reference, not contract)

```ts
export function parseTable(
    markdown: string,
    sectionHeading: string,
): Array<Record<string, string>>;
```

Algorithm:
1. Find the H2 section line `## <sectionHeading>` (exact, case-sensitive). If not found, return `[]`.
2. From that line, scan forward until the next H1/H2 line or end of file.
3. Within that range, find the first line starting with `|`. If none, return `[]`.
4. That line is the header. Parse cell names by splitting on `|` (respecting `\|` escapes), trimming, filtering empty leading/trailing entries from outer pipes.
5. The next line should be a separator (cells matching `^:?-+:?$` after trim). If it is, skip it. If it isn't, continue without skipping (some artifacts may not have separator).
6. For each subsequent line starting with `|`: split on `|` (respecting escapes), trim, drop outer empty entries. Map first N cells to header column names; missing trailing cells map to `""`; extras drop. Append `{ [colName]: cellText }` to output.
7. Stop on first line not starting with `|` or on next H1/H2.
8. Return the array.

Pipe-escape handling: a literal `\|` in cell content does not split columns and is unescaped to `|` in the returned cell text. Implementation: split on a regex that doesn't match preceded backslashes, or pre-process by replacing `\|` with a sentinel, then split, then restore.

### Handoff section heading reference

Verified against `tasks/_templates/handoff.md` at spec-write time:
- `## Changes` — file-listing table (used by `parseHandoffFiles`).
- `## AC Coverage` — AC table (used by `checkAcCoveragePlaceholders`).
- `## Validation Outcomes` — validation rows (used by `parseValidationOutcomeRows` and the `Fail` check).

If the live template diverges from these headings by the time this task implements, defer to the live template and note the divergence in the handoff.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` (covers both new and existing test files)

Build, E2E, Migration runner: N/A (no compile step; no UI; no schema change).

## Docs Impact

None. Internal-only refactor. The parser is implementation detail; no public-facing doc changes required.

## Known Risks

- **Diagnostic-string equivalence**: AC-7 requires existing diagnostics to be byte-identical. The retrofitted functions must construct the same error strings as today, even though the underlying parsing is different. Watch for subtle differences in how empty cells, whitespace-only cells, and missing rows produce diagnostics.
- **`parseHandoffFiles` post-extraction**: This function pulls a backticked path from the first column. The retrofit still needs that post-extraction step — `parseTable` returns the cell text including backticks; the caller strips them. Don't push that logic into the parser.
- **The "Fail" detection retrofit**: The current bare regex matches `| Fail |` anywhere in the file. The retrofit must produce the same diagnostic ("Validation Outcomes table has one or more Fail results") on the same inputs. Verify by running the existing test suite — if any test fixture has a `Fail` row outside the Validation Outcomes section that the regex caught but the parser doesn't, that's a difference worth surfacing in the handoff (almost certainly a false positive the parser correctly avoids, but call it out).
- **`tests/run-task-validation.test.ts` unchanged**: AC-7 says these tests should pass unchanged. If a test fails after the retrofit, prefer fixing the retrofit over modifying the test — the test encodes the diagnostic contract.
- **Pipe-escape edge cases**: Cell content with `\\|` (literal backslash followed by un-escaped pipe) is a column boundary, not an escape. Cell content with `\\\|` (literal backslash followed by escaped pipe) is a literal `\|` in output. The split regex must handle these correctly. Test these explicitly in `tests/markdown-table.test.ts`.

## Human Test Plan

The product owner is the developer running canon-ai. The validation is mechanical (existing tests pass + new parser tests pass) — no UI to test, no behavior to manually verify.

1. After the pipeline completes, run `npm test` from the repo root. Expected: all tests pass (existing + new `markdown-table.test.ts`).
2. Run `npm run lint` and `npm run type-check`. Expected: clean.
3. Spot-check `scripts/run-task/markdown-table.ts` exists and is reasonably small (under ~100 lines — parser plus minimal helpers).
4. Spot-check `scripts/run-task/validation.ts` no longer contains `.split('|')` patterns in `checkAcCoveragePlaceholders`, `parseValidationOutcomeRows`, or `parseHandoffFiles`. Expected: those split-on-pipe calls are replaced by `parseTable(...)` calls.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it
- [x] Affected Files lists specific files with specific change descriptions
- [x] Plan steps will be written in the conversational plan phase (this is a fast-tier S task)
- [x] Known Risks covers the main failure modes
- [x] Human Test Plan uses product-level steps (run commands, check files exist)
- [x] Validation Required has lint, type-check, unit tests checked
