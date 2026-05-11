# Implementation Handoff: markdown-table-parser

> Author: Codex | Spec: `tasks/markdown-table-parser/spec.md` | Plan: `tasks/markdown-table-parser/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

| File | What Changed |
|---|---|
| `scripts/run-task/markdown-table.ts` | New escape-aware markdown table parser with H2 section lookup, separator-row skipping, lossy row mapping, and support for escaped pipes / missing trailing cells. |
| `scripts/run-task/validation.ts` | Retrofitted AC Coverage, Validation Outcomes, and Changes-table parsing to use `parseTable`; replaced the bare `Fail` regex with parsed Validation Outcomes row checks. |
| `tests/markdown-table.test.ts` | New parser unit tests covering named columns, escaped pipes, missing sections, separator skipping, short rows, long rows, mixed alignment, and empty sections. |

## Intent & Rationale

The orchestrator was re-parsing markdown tables with ad hoc `split('|')` logic in several places. That broke on escaped pipes and made each structured table read fragile. This task centralizes the table parsing into one small utility and keeps the downstream diagnostics byte-stable.

I implemented the parser as a character-scanning splitter instead of the plan's sentinel pre-pass. That keeps the escape handling explicit, preserves the `\\|` / `\\\|` edge cases from the spec, and avoids extra replacement bookkeeping while staying lossy-tolerant.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Used a backslash-counting table-line scanner instead of the plan's sentinel replacement step. | The scanner handles odd/even backslash runs directly, which preserves `\\|` as a real boundary and `\\\|` as a literal `\|` without intermediate placeholders. | None; parser behavior matches the ACs and the dedicated parser tests. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: New module `scripts/run-task/markdown-table.ts` exports `parseTable(markdown: string, sectionHeading: string): Array<Record<string, string>>`. Section heading match is case-sensitive on the H2 line (`## <sectionHeading>`). When the section is missing or contains no table, returns `[]`. | Met | `parseTable()` is exported from `scripts/run-task/markdown-table.ts`; the parser returns `[]` for missing headings and for sections with no table rows. |
| AC-2: Parser handles escaped pipes (`\|`) in cell content correctly — a cell containing `foo \| bar` does not shift column boundaries. The escape sequence is unescaped to a literal `|` in the returned cell text. | Met | Covered by `tests/markdown-table.test.ts` including the `foo \| bar` case and the `\\|` / `\\\|` boundary checks. |
| AC-3: Parser is lossy-tolerant: every line starting with `|` after the separator row produces a row in the output. Cells map to column names by position. Missing trailing columns return `""`. Extra cells beyond the header count are dropped (un-escaped pipe in content is the likely cause; preserving them would re-introduce literal pipes into cell text). | Met | Rows are emitted for every table line until a non-`|` line or next H1/H2; short rows fill trailing columns with `""`, long rows drop extras. |
| AC-4: The separator row (`|---|---|---|` and variants like `|:--|:-:|--:|`) is detected and skipped — not returned as a data row. | Met | The parser skips separator rows and the tests cover both standard and alignment-variant separators. |
| AC-5: Retrofitted: `checkAcCoveragePlaceholders` uses `parseTable(content, 'AC Coverage')` and checks the Status column on parsed rows. `parseValidationOutcomeRows` uses `parseTable(content, 'Validation Outcomes')`. `parseHandoffFiles` uses `parseTable(content, 'Changes')` and post-extracts the backticked path from the first column. The bare `/\|\s*Fail\s*\|/i` regex in `validateHandoff` is replaced by a parsed-row check on Validation Outcomes (`row['Result'] === 'Fail'` or equivalent — verify exact column name in the live template). | Met | `validation.ts` now routes all four reads through `parseTable()` and preserves the existing diagnostics. |
| AC-6: New `tests/markdown-table.test.ts` covers: basic table parse with named columns, escaped-pipe handling, missing-section returns `[]`, separator-row skipping, too-few-cells row returns empty trailing columns, too-many-cells row drops extras, mixed alignment in separator row, and "section heading exists but no table follows" returns `[]`. | Met | All requested cases are covered in the new test file. |
| AC-7: Existing `tests/run-task-validation.test.ts` passes unchanged. Diagnostic strings produced by the retrofitted `validateHandoff` / `checkAcCoveragePlaceholders` / `parseValidationOutcomeRows` / `parseHandoffFiles` paths are identical to today's. | Met | `tests/run-task-validation.test.ts` passes unchanged. The full `npm test` run still hits an unrelated prompt-snapshot failure outside this task's files; the validation and parser tests relevant to this change pass in isolation. |

## Edge Cases Considered

- Escaped pipes with odd/even backslash runs: `foo \| bar` stays in one cell, `\\|` becomes a real boundary, and `\\\|` survives as literal `\|`.
- Short rows: missing trailing columns are filled with `""` instead of shifting later cells left.
- Long rows: extra cells are dropped so accidental unescaped pipes do not reintroduce literal pipe text into downstream diagnostics.
- Section bounds: the parser stops at the next H1/H2 line, so tables do not bleed into the next section.

## Blockers

- `[environment]` `npm test` fails in `tests/run-task-prompts.test.ts` before it reaches this task's code paths. The stack traces to `scripts/run-task/state.ts` trying to read `/Users/tstraub/canon-ai/canon-ai-dev/tasks/prompt-fixture-a/status.json`, which does not exist in this worktree. The affected markdown-table parser tests and `tests/run-task-validation.test.ts` pass in isolation.

## Validation Outcomes

> All applicable checks must pass before submitting for review. If a check appears in spec.md's Validation Required section, it must be recorded as Pass or Fail here — do not mark a required check N/A. Use N/A only for checks that the spec did not require, and explain why in Notes. Failed checks must be fixed — do not submit with failures. Move unresolved failures to Blockers.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Clean. |
| `npm run type-check` | Pass | Clean. |
| `npm test` | Fail | Fail – unrelated: `tests/run-task-prompts.test.ts` tries to open `/Users/tstraub/canon-ai/canon-ai-dev/tasks/prompt-fixture-a/status.json`, which is absent in this worktree. `tests/markdown-table.test.ts` and `tests/run-task-validation.test.ts` pass when run directly. |
| `node --test --import tsx tests/markdown-table.test.ts tests/run-task-validation.test.ts` | Pass | Isolated parser + validation coverage for this task. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [ ] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>`

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Findings addressed

- _correctness bug:_ "<one-line summary>" → fixed at file:line
- _risk/guardrail:_ ... → ...
- _spec gap:_ ... → ...
- _optional cleanup/nit:_ ... → addressed / deferred (rationale)

### AC deltas (if any)

- AC-N: was Partial → now Met (file:line)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |
-->

## Iteration 2 — addressing review round 1

### Findings addressed

- No task-scope code finding was raised in round 1. The only blocker was the unrelated `npm test` failure in `tests/run-task-prompts.test.ts`, which is outside this task's affected files and remains documented below.

### AC deltas (if any)

- None. The parser implementation and validation retrofits are unchanged from iteration 1.

### Re-run validation (only checks that re-ran)

- None. No code changes were required for this round; the existing unrelated `npm test` blocker remains the same.

## Iteration 3 — addressing review round 2

### Findings addressed

- No task-scope code finding was raised in the review artifact available in this worktree. The only blocking issue remains the unrelated `npm test` failure in `tests/run-task-prompts.test.ts`, which is outside this task's affected files and was already documented.

### AC deltas (if any)

- None. Parser and validation code remain unchanged.

### Re-run validation (only checks that re-ran)

- None. No task-scope code changes were made in this iteration.
