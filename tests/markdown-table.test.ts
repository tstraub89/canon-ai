import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTable, parseAllTablesH3, scanAllTables } from '../scripts/run-task/markdown-table.js';

void test('parseTable maps named columns in a basic markdown table', () => {
    const rows = parseTable([
        '## People',
        '',
        '| Name | Role | Notes |',
        '|---|---|---|',
        '| Ada | Engineer | leads |',
        '| Bea | Designer | ships |',
        '',
    ].join('\n'), 'People');

    assert.deepEqual(rows, [
        { Name: 'Ada', Role: 'Engineer', Notes: 'leads' },
        { Name: 'Bea', Role: 'Designer', Notes: 'ships' },
    ]);
});

void test('parseTable keeps escaped pipes inside a cell and preserves boundary cases', () => {
    const rows = parseTable(String.raw`
## Escapes

| Left | Middle | Right |
|---|---|---|
| foo \| bar | baz | qux |
| keep \\| split | second | third |
| keep \\\| literal | second | third |
`, 'Escapes');

    assert.deepEqual(rows, [
        { Left: 'foo | bar', Middle: 'baz', Right: 'qux' },
        { Left: 'keep \\', Middle: 'split', Right: 'second' },
        { Left: 'keep \\| literal', Middle: 'second', Right: 'third' },
    ]);
});

void test('parseTable returns [] when the section heading is missing', () => {
    const rows = parseTable([
        '## Other Section',
        '',
        '| Name | Value |',
        '|---|---|',
        '| alpha | beta |',
        '',
    ].join('\n'), 'Missing Section');

    assert.deepEqual(rows, []);
});

void test('parseTable skips separator rows, including mixed alignment variants', () => {
    const rows = parseTable([
        '## Alignment',
        '',
        '| Left | Middle | Right |',
        '|:--|:-:|--:|',
        '| a | b | c |',
        '',
    ].join('\n'), 'Alignment');

    assert.deepEqual(rows, [
        { Left: 'a', Middle: 'b', Right: 'c' },
    ]);
});

void test('parseTable fills missing trailing cells with empty strings', () => {
    const rows = parseTable([
        '## Short Row',
        '',
        '| One | Two | Three |',
        '|---|---|---|',
        '| 1 | 2 |',
        '',
    ].join('\n'), 'Short Row');

    assert.deepEqual(rows, [
        { One: '1', Two: '2', Three: '' },
    ]);
});

void test('parseTable drops extra cells beyond the header count', () => {
    const rows = parseTable([
        '## Long Row',
        '',
        '| One | Two | Three |',
        '|---|---|---|',
        '| 1 | 2 | 3 | 4 |',
        '',
    ].join('\n'), 'Long Row');

    assert.deepEqual(rows, [
        { One: '1', Two: '2', Three: '3' },
    ]);
});

void test('parseTable returns [] when a section heading exists but no table follows', () => {
    const rows = parseTable([
        '## Empty Section',
        '',
        'This section has prose, but no table.',
        '',
        '## Next Section',
        '',
        '| Name | Value |',
        '|---|---|',
        '| x | y |',
        '',
    ].join('\n'), 'Empty Section');

    assert.deepEqual(rows, []);
});

// --- parseAllTablesH3 ---

void test('parseAllTablesH3 returns rows from a single table (same as parseTableH3)', () => {
    const rows = parseAllTablesH3([
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/foo.ts` | update |',
        '| `src/bar.ts` | add |',
        '',
    ].join('\n'), 'Affected Files');

    assert.deepEqual(rows, [
        { File: '`src/foo.ts`', Change: 'update' },
        { File: '`src/bar.ts`', Change: 'add' },
    ]);
});

void test('parseAllTablesH3 collects rows from two tables separated by a blank line', () => {
    const rows = parseAllTablesH3([
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/a.ts` | update |',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/b.ts` | add |',
        '',
    ].join('\n'), 'Affected Files');

    assert.deepEqual(rows, [
        { File: '`src/a.ts`', Change: 'update' },
        { File: '`src/b.ts`', Change: 'add' },
    ]);
});

void test('parseAllTablesH3 collects rows from two tables separated by a bold sub-heading', () => {
    const rows = parseAllTablesH3([
        '### Affected Files',
        '',
        '**Core**',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/core.ts` | update |',
        '',
        '**Tests**',
        '',
        '| File | Change |',
        '|---|---|',
        '| `tests/core.test.ts` | add |',
        '',
    ].join('\n'), 'Affected Files');

    assert.deepEqual(rows, [
        { File: '`src/core.ts`', Change: 'update' },
        { File: '`tests/core.test.ts`', Change: 'add' },
    ]);
});

void test('parseAllTablesH3 stops at the next H3 heading and does not collect sibling rows', () => {
    const rows = parseAllTablesH3([
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/a.ts` | update |',
        '',
        '### Other Section',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/b.ts` | should not appear |',
        '',
    ].join('\n'), 'Affected Files');

    assert.deepEqual(rows, [
        { File: '`src/a.ts`', Change: 'update' },
    ]);
});

void test('parseAllTablesH3 returns [] when the heading is absent', () => {
    const rows = parseAllTablesH3([
        '### Other Section',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/a.ts` | update |',
        '',
    ].join('\n'), 'Affected Files');

    assert.deepEqual(rows, []);
});

void test('scanAllTables finds every table with its nearest preceding heading', () => {
    const tables = scanAllTables([
        '# Doc',
        '',
        '| Orphan | Col |',
        '|---|---|',
        '| a | b |',
        '',
        '## Changes',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| `src/a.ts` | update |',
        '',
        'Some prose.',
        '',
        '### Changes Added For Coverage',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| `src/b.ts` | earlier round |',
        '',
    ].join('\n'));

    assert.equal(tables.length, 3);
    assert.equal(tables[0].heading, '# Doc');
    assert.deepEqual(tables[0].headerCells, ['Orphan', 'Col']);
    assert.equal(tables[1].heading, '## Changes');
    assert.deepEqual(tables[1].rows, [{ File: '`src/a.ts`', 'What Changed': 'update' }]);
    assert.equal(tables[2].heading, '### Changes Added For Coverage');
    assert.deepEqual(tables[2].rows, [{ File: '`src/b.ts`', 'What Changed': 'earlier round' }]);
});

void test('scanAllTables skips table-shaped lines inside fenced code blocks', () => {
    const tables = scanAllTables([
        '## Notes',
        '',
        'Example of the expected format:',
        '',
        '```markdown',
        '| File | What Changed |',
        '|---|---|',
        '| `src/example-only.ts` | fenced example — not a coverage claim |',
        '```',
        '',
        'Command output:',
        '',
        '~~~',
        '| File | What Changed |',
        '| `src/other-example.ts` | also fenced |',
        '~~~',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| `src/real.ts` | real table after the fences |',
        '',
    ].join('\n'));

    assert.equal(tables.length, 1);
    assert.deepEqual(tables[0].rows, [{ File: '`src/real.ts`', 'What Changed': 'real table after the fences' }]);
});

void test('scanAllTables does not close a backtick fence on a tilde marker (or vice versa)', () => {
    const tables = scanAllTables([
        '```',
        '~~~',
        '| File | What Changed |',
        '|---|---|',
        '| `src/still-fenced.ts` | tilde line does not close a backtick fence |',
        '```',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| `src/real.ts` | outside |',
        '',
    ].join('\n'));

    assert.equal(tables.length, 1);
    assert.deepEqual(tables[0].rows, [{ File: '`src/real.ts`', 'What Changed': 'outside' }]);
});

void test('scanAllTables skips tables inside HTML comment blocks and blockquotes', () => {
    const tables = scanAllTables([
        '## Guide',
        '',
        '> | Value | Use when |',
        '> |---|---|',
        '> | Pass | it passed |',
        '',
        '<!--',
        '### Scaffold',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| `src/example.ts` | commented out |',
        '-->',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| `src/real.ts` | visible |',
        '',
    ].join('\n'));

    assert.equal(tables.length, 1);
    assert.equal(tables[0].heading, '## Guide');
    assert.deepEqual(tables[0].rows, [{ File: '`src/real.ts`', 'What Changed': 'visible' }]);
});
