import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTable, parseAllTablesH3 } from '../scripts/run-task/markdown-table.js';

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
