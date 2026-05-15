# Implementation Plan: markdown-table-parser

> Written by: Claude | Implements: `tasks/markdown-table-parser/spec.md`

## Approach

Land the parser first as a self-contained module with its own unit tests. Then retrofit the four call sites in `validation.ts` one at a time, running `npm test` after each retrofit to confirm the existing validation tests still pass with byte-identical diagnostics. The retrofit order is intentional: simplest call site first, most-tested call site last.

The parser is intentionally minimal — no class, no options object, no logging side effects. One exported function plus one or two small internal helpers (escape-aware split, separator-row detection). Keep total module size under ~80 lines.

## Steps

### Step 1: Write the parser module and its unit tests

Files: `scripts/run-task/markdown-table.ts` (new), `tests/markdown-table.test.ts` (new)

Module exports a single function:

```ts
export function parseTable(
    markdown: string,
    sectionHeading: string,
): Array<Record<string, string>>;
```

Algorithm follows the spec's "Parser shape (reference, not contract)" section. Implementation notes:

- **Section discovery**: split `markdown` on `\n`. Find the line matching exactly `## ${sectionHeading}` (after trimming trailing whitespace; leading whitespace is not expected on H2 lines). Case-sensitive.
- **Section bounds**: from the heading line, scan forward to the next line matching `/^# /` or `/^## /`, or end of input. The table must live within that range.
- **Table discovery**: within the range, find the first line whose `trimStart()` starts with `|`. If none, return `[]`.
- **Escape handling**: pre-process each table line by replacing literal `\|` with a sentinel (e.g. `\x00`). Split on `|`. Restore sentinel → `|`. This avoids regex lookbehind portability concerns and handles `\\|` (literal backslash followed by un-escaped pipe) correctly because we only replace exact `\|` sequences.
- **Cell normalization**: after split, drop the first and last cells if both are empty/whitespace-only (handles standard `| a | b |` form with outer pipes). Trim each remaining cell.
- **Header row**: the first table line is the header. Non-empty cells become column names. If any column name repeats, last write wins (don't error — lossy-tolerant).
- **Separator detection**: a row is a separator if every cell after trimming matches `/^:?-+:?$/`. Skip the separator row if found immediately after the header; otherwise don't skip (some artifacts may omit it).
- **Data rows**: for each subsequent line whose `trimStart()` starts with `|`: split, drop outer empties, map first N cells to column names (where N = header count). Missing trailing cells map to `""`. Extras drop. Append the resulting object.
- **Table terminator**: first line whose `trimStart()` does not start with `|` ends the table. Also stops on next H1/H2.

Unit tests in `tests/markdown-table.test.ts`. Cover every AC-6 case:
- **Basic parse**: 3-row, 3-column table → returns 3 objects with correct column→cell mapping.
- **Escaped pipe**: cell content `foo \| bar` → cell text is `foo | bar`, column boundaries respected.
- **Mixed escape edge cases**: `\\|` (un-escaped pipe after literal backslash) splits columns. `\\\|` (literal backslash followed by escaped pipe) produces cell text `\|`.
- **Missing section**: section heading not present → `[]`.
- **Empty section**: heading present, no table below before next H2 or EOF → `[]`.
- **Separator-row skip**: standard separator `|---|---|---|` skipped. Aligned variants `|:--|:-:|--:|` also skipped. A non-separator first-row-after-header is NOT skipped.
- **Too-few cells**: row with fewer cells than header → trailing columns return `""`. Row still appears in output.
- **Too-many cells**: row with more cells than header → extras dropped. Row still appears in output.
- **Table termination**: prose paragraph after the data rows correctly ends the table; next section's content not slurped.
- **No outer pipes**: `a | b | c` form (no leading/trailing pipe) — out of scope; behavior is undefined. Add a comment but no test.

Run `npm test` and confirm new tests pass. Run `npm run lint` and `npm run type-check`.

### Step 2: Retrofit `parseValidationOutcomeRows` (simplest call site)

Files: `scripts/run-task/validation.ts`

Replace the body of `parseValidationOutcomeRows` (currently `scripts/run-task/validation.ts:91-110`):

```ts
export function parseValidationOutcomeRows(handoffPath: string): ValidationOutcomeRow[] {
    try {
        const content = fs.readFileSync(handoffPath, 'utf8');
        const rows = parseTable(content, 'Validation Outcomes');
        return rows.map(row => ({
            check: row['Check'] ?? '',
            result: row['Result'] ?? '',
            notes: row['Notes'] ?? '',
        }));
    } catch {
        return [];
    }
}
```

Add `import { parseTable } from './markdown-table.js';` at the top.

Verify the column names match the live template. From `tasks/_templates/handoff.md` section `## Validation Outcomes`, confirm headers are `| Check | Result | Notes |` (or similar). Adjust the `row[...]` keys to match.

Run `npm test`. The `tests/run-task-validation.test.ts` suite must still pass. If any test fails with a `Cannot read property` or similar, the column name in the template doesn't match — fix the key.

### Step 3: Retrofit `parseHandoffFiles`

Files: `scripts/run-task/validation.ts`

Replace the body of `parseHandoffFiles` (currently `scripts/run-task/validation.ts:208-227`):

```ts
export function parseHandoffFiles(taskId: string): string[] {
    const handoffPath = path.join(taskDirFor(taskId), 'handoff.md');
    let content: string;
    try {
        content = fs.readFileSync(handoffPath, 'utf8');
    } catch {
        return [];
    }
    const rows = parseTable(content, 'Changes');
    const files: string[] = [];
    for (const row of rows) {
        // First column. Cell text contains the backticked path; extract.
        const firstColName = Object.keys(row)[0];
        if (!firstColName) continue;
        const cellText = row[firstColName] ?? '';
        const match = cellText.match(/`([^`]+)`/);
        if (match?.[1]) files.push(match[1]);
    }
    return files;
}
```

Note: the post-extraction (backticked path) stays as caller logic, not pushed into the parser.

Run `npm test`. Check the `parseHandoffFiles`-using tests in `tests/run-task-validation.test.ts` still pass.

### Step 4: Retrofit `checkAcCoveragePlaceholders`

Files: `scripts/run-task/validation.ts`

Replace the body of `checkAcCoveragePlaceholders` (currently `scripts/run-task/validation.ts:12-44`):

```ts
const AC_STATUS_PLACEHOLDER = 'Met / Partial / Not met';

export function checkAcCoveragePlaceholders(handoffContent: string): string[] {
    const rows = parseTable(handoffContent, 'AC Coverage');

    // Section/table missing
    const sectionMissing = /## AC Coverage/.test(handoffContent) === false;
    if (sectionMissing) return ['AC Coverage section is missing'];
    if (rows.length === 0) return ['AC Coverage table is missing or contains no AC rows'];

    // Verify at least one row has an AC-N identifier in any column.
    const hasAcRow = rows.some(row => {
        const firstCol = Object.values(row)[0] ?? '';
        return /AC-\d+/i.test(firstCol);
    });
    if (!hasAcRow) return ['AC Coverage table is missing or contains no AC rows'];

    // Status column placeholder check
    const allPlaceholder = rows.every(row => (row['Status'] ?? '') === AC_STATUS_PLACEHOLDER);
    if (allPlaceholder) {
        return ['AC Coverage table only contains template placeholder rows (Status "Met / Partial / Not met") — fill in actual AC statuses'];
    }
    return [];
}
```

Critical: the diagnostic strings must match exactly what the current implementation produces. Compare against `scripts/run-task/validation.ts:14, 18, 32, 41` and preserve byte-identical strings.

If the AC Coverage section's Status column is named something other than `Status`, adjust accordingly (verify in `tasks/_templates/handoff.md`).

Run `npm test`. Existing AC coverage tests must pass with the same diagnostic strings.

### Step 5: Retrofit the bare `Fail` regex in `validateHandoff`

Files: `scripts/run-task/validation.ts`

In `validateHandoff` (around `scripts/run-task/validation.ts:46-61`), replace the regex check:

```ts
// BEFORE:
if (/\|\s*Fail\s*\|/i.test(content)) {
    issues.push('Validation Outcomes table has one or more Fail results');
}

// AFTER:
const validationRows = parseTable(content, 'Validation Outcomes');
const hasFailRow = validationRows.some(row => (row['Result'] ?? '').toLowerCase() === 'fail');
if (hasFailRow) {
    issues.push('Validation Outcomes table has one or more Fail results');
}
```

Verify column name from the live template.

Run `npm test`. The `Fail`-detection tests in `tests/run-task-validation.test.ts` must still pass with the same diagnostic.

### Step 6: Final validation

Run all three checks one more time from REPO_ROOT:

```bash
npm run lint
npm run type-check
npm test
```

All three must be clean. The handoff's Validation Outcomes table records all three as `pass`.

## Testing Plan

- **Unit**: New `tests/markdown-table.test.ts` covers parser behavior per AC-6.
- **Regression**: Existing `tests/run-task-validation.test.ts` must pass unchanged (AC-7). If any test needs a fixture update because the new parser is correctly handling a case the old code mishandled, document the divergence in the handoff under *Deviations from Plan*.
- **Manual**: None required for this task. The validation is fully mechanical.

## Rollback Plan

Pure refactor with no schema, config, or behavior changes (when diagnostics are preserved). Rollback is `git revert` of the implementation commit. No data migration concerns. No protected docs touched. No downstream task depends on this *yet* (1a-2 will be the first consumer after this lands).
