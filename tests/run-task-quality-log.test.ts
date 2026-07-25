import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseTable } from '../scripts/run-task/markdown-table.js';
import {
    parseQualityLogJudgmentBlock,
    serializeQualityLogCell,
    upsertQualityLogRow,
} from '../scripts/run-task/quality-log.js';

const HEADERS = [
    'Date',
    'Task',
    'Size',
    'Spec verdict',
    'Spec iter',
    'Review iter',
    'Dropped ACs',
    'Validation gaps',
    'Human reroute?',
    'Notes',
] as const;

function withTempDir<T>(fn: (dir: string) => T): T {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-log-'));
    try {
        return fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function tableDocument(
    rows: readonly string[] = [],
    headers: readonly string[] = HEADERS,
    includePeriodic = true,
): string {
    const lines = [
        '# Task Quality Log',
        '',
        '## Log',
        '',
        `| ${headers.join(' | ')} |`,
        `|${headers.map(() => '---').join('|')}|`,
        ...rows,
    ];
    if (includePeriodic) lines.push('', '## Periodic Reviews', '', '> Review notes.');
    return lines.join('\n');
}

function writeLog(dir: string, content: string): string {
    const file = path.join(dir, 'task-quality-log.md');
    fs.writeFileSync(file, content, 'utf8');
    return file;
}

function readRows(file: string): Array<Record<string, string>> {
    return parseTable(fs.readFileSync(file, 'utf8'), 'Log');
}

function rowFor(file: string, taskId: string): Record<string, string> {
    const row = readRows(file).find(candidate => candidate.Task === taskId);
    assert.ok(row, `expected a row for ${taskId}`);
    return row;
}

function captureWarnings(fn: () => void): string {
    const messages: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => messages.push(args.map(String).join(' '));
    try {
        fn();
    } finally {
        console.error = original;
    }
    return messages.join('\n');
}

void test('quality-log upsert refreshes derived counters, date, and size defaults', () => {
    withTempDir(dir => {
        const taskId = 'schedule-date-corrections';
        const file = writeLog(dir, tableDocument([
            `| 1999-01-01 | ${taskId} | S | changes_requested | 1 | 1 | 0 | 0 | No | first pass |`,
        ]));
        const expectedDate = new Date().toISOString().slice(0, 10);

        upsertQualityLogRow(file, {
            taskId,
            taskSize: 'L',
            delicate: true,
            specIterTotal: 6,
            reviewIterTotal: 2,
        }, {});

        const updated = rowFor(file, taskId);
        assert.equal(updated.Date, expectedDate);
        assert.notEqual(updated.Date, '1999-01-01');
        assert.equal(updated.Size, 'L delicate');
        assert.equal(updated['Spec iter'], '6');
        assert.equal(updated['Review iter'], '2');

        upsertQualityLogRow(file, { taskId }, {});
        const defaulted = rowFor(file, taskId);
        assert.equal(defaulted.Size, 'M');
        assert.equal(defaulted['Spec iter'], '0');
        assert.equal(defaulted['Review iter'], '0');

        upsertQualityLogRow(file, { taskId, taskSize: 'XS' }, {});
        assert.equal(rowFor(file, taskId).Size, 'XS');
    });
});

void test('quality-log upsert leaves exactly one current row after repeated writes', () => {
    withTempDir(dir => {
        const file = writeLog(dir, tableDocument());
        upsertQualityLogRow(file, {
            taskId: 'rerouted-task',
            specIterTotal: 1,
            reviewIterTotal: 1,
        }, { Notes: 'first' });
        upsertQualityLogRow(file, {
            taskId: 'rerouted-task',
            specIterTotal: 4,
            reviewIterTotal: 3,
        }, { Notes: 'second' });

        const matching = readRows(file).filter(row => row.Task === 'rerouted-task');
        assert.equal(matching.length, 1);
        assert.equal(matching[0]['Spec iter'], '4');
        assert.equal(matching[0]['Review iter'], '3');
        assert.equal(matching[0].Notes, 'second');
    });
});

void test('quality-log rows stay inside Log with periodic, anchorless, and stray fixtures', () => {
    withTempDir(dir => {
        const periodicFile = writeLog(dir, tableDocument());
        upsertQualityLogRow(periodicFile, { taskId: 'placed-task' }, {});
        const periodicContent = fs.readFileSync(periodicFile, 'utf8');
        const periodicIndex = periodicContent.indexOf('## Periodic Reviews');
        const placedIndex = periodicContent.indexOf('| placed-task |');
        assert.ok(placedIndex >= 0 && placedIndex < periodicIndex);
        assert.doesNotMatch(periodicContent.slice(periodicIndex), /\| placed-task \|/);

        const anchorlessFile = path.join(dir, 'anchorless.md');
        fs.writeFileSync(anchorlessFile, tableDocument([], HEADERS, false), 'utf8');
        upsertQualityLogRow(anchorlessFile, { taskId: 'anchorless-task' }, {});
        assert.equal(rowFor(anchorlessFile, 'anchorless-task').Task, 'anchorless-task');

        const strayFile = path.join(dir, 'stray.md');
        const stray = [
            tableDocument(),
            '| 2026-01-01 | stray-task | S | approved | 1 | 1 | 0 | 0 | No | misplaced |',
        ].join('\n');
        fs.writeFileSync(strayFile, stray, 'utf8');
        upsertQualityLogRow(strayFile, {
            taskId: 'stray-task',
            specIterTotal: 2,
            reviewIterTotal: 3,
        }, {});
        const strayContent = fs.readFileSync(strayFile, 'utf8');
        assert.equal((strayContent.match(/\| stray-task \|/g) ?? []).length, 1);
        assert.doesNotMatch(strayContent.slice(strayContent.indexOf('## Periodic Reviews')), /\| stray-task \|/);
        assert.equal(rowFor(strayFile, 'stray-task')['Spec iter'], '2');
    });
});

void test('quality-log judgment cells are supplied, preserved when omitted, and parsed from done.md', () => {
    withTempDir(dir => {
        const file = writeLog(dir, tableDocument());
        const supplied = {
            'Spec verdict': 'changes_requested',
            'Human reroute?': 'No',
            'Dropped ACs': '2',
            'Validation gaps': '1',
            'Notes': 'corrected judgment',
        } as const;
        upsertQualityLogRow(file, { taskId: 'judgment-task', specIterTotal: 2 }, supplied);
        assert.deepEqual(
            Object.fromEntries(Object.keys(supplied).map(key => [key, rowFor(file, 'judgment-task')[key]])),
            supplied,
        );

        upsertQualityLogRow(file, {
            taskId: 'judgment-task',
            specIterTotal: 5,
            reviewIterTotal: 4,
        }, {});
        const preserved = rowFor(file, 'judgment-task');
        for (const [header, value] of Object.entries(supplied)) {
            assert.equal(preserved[header], value);
        }
        assert.equal(preserved['Spec iter'], '5');
        assert.equal(preserved['Review iter'], '4');

        assert.deepEqual(parseQualityLogJudgmentBlock([
            '# QA Summary',
            '',
            '## Quality Log',
            '- Spec verdict: approved_with_nits',
            '- Human reroute?: Yes',
            '- Dropped ACs: 0',
            '- Validation gaps: 0',
            '- Notes: Latest summary',
        ].join('\n')), {
            'Spec verdict': 'approved_with_nits',
            'Human reroute?': 'Yes',
            'Dropped ACs': '0',
            'Validation gaps': '0',
            'Notes': 'Latest summary',
        });
        assert.deepEqual(parseQualityLogJudgmentBlock('# QA Summary\n\nNo block.'), {});
    });
});

void test('quality-log structural Markdown values round-trip with declared newline normalization', () => {
    withTempDir(dir => {
        const cases = [
            { taskId: 'pipe-task', raw: 'a|b', expected: 'a|b' },
            { taskId: 'backslash-pipe-task', raw: 'a\\|b', expected: 'a\\|b' },
            { taskId: 'newline-task', raw: 'a\nb', expected: 'a b' },
            { taskId: 'crlf-task', raw: 'a\r\nb', expected: 'a b' },
        ];
        const file = writeLog(dir, tableDocument());
        for (const fixture of cases) {
            upsertQualityLogRow(file, { taskId: fixture.taskId }, { Notes: fixture.raw });
            const row = rowFor(file, fixture.taskId);
            assert.equal(row.Notes, fixture.expected);
            assert.equal(Object.keys(row).length, HEADERS.length);
        }
        assert.equal(serializeQualityLogCell('a\\|b'), 'a\\\\\\|b');
    });
});

void test('quality-log placement follows header names and preserves adopter columns', () => {
    withTempDir(dir => {
        const adopterHeaders = [
            'Date',
            'Task',
            'Size',
            'Spec verdict',
            'Spec iter',
            'Team',
            'Review iter',
            'Dropped ACs',
            'Validation gaps',
            'Human reroute?',
            'Notes',
        ];
        const updateFile = writeLog(dir, tableDocument([
            '| 2026-01-01 | adopter-task | S | approved | 1 | Platform | 1 | 0 | 0 | No | old |',
        ], adopterHeaders));
        upsertQualityLogRow(updateFile, {
            taskId: 'adopter-task',
            taskSize: 'XL',
            specIterTotal: 6,
            reviewIterTotal: 2,
        }, { Notes: 'new' });
        const updated = rowFor(updateFile, 'adopter-task');
        assert.equal(updated.Team, 'Platform');
        assert.equal(updated['Spec iter'], '6');
        assert.equal(updated['Review iter'], '2');
        assert.equal(updated.Notes, 'new');

        const insertFile = path.join(dir, 'insert.md');
        fs.writeFileSync(insertFile, tableDocument([], adopterHeaders), 'utf8');
        upsertQualityLogRow(insertFile, { taskId: 'new-adopter-task' }, {});
        assert.equal(rowFor(insertFile, 'new-adopter-task').Team, '');

        const malformedFile = path.join(dir, 'malformed.md');
        const missingNotesHeaders = HEADERS.filter(header => header !== 'Notes');
        const original = tableDocument([], missingNotesHeaders);
        fs.writeFileSync(malformedFile, original, 'utf8');
        const warnings = captureWarnings(() => {
            upsertQualityLogRow(malformedFile, { taskId: 'skipped-task' }, {});
        });
        assert.match(warnings, /no well-formed '## Log' table/);
        assert.equal(fs.readFileSync(malformedFile, 'utf8'), original);
    });
});

void test('quality-log duplicate reconciliation uses earliest verdict and latest corrigible values', () => {
    withTempDir(dir => {
        const sibling = '| 2026-01-01 | sibling-task | S | approved | 1 | 1 | 0 | 0 | No | byte-stable sibling |';
        const insideFile = writeLog(dir, tableDocument([
            sibling,
            '| 2026-01-02 | duplicate-task | S | changes_requested | 1 | 1 | 0 | 0 | No | earliest |',
            '| 2026-01-03 | duplicate-task | M | approved | 2 | 2 | 1 | 1 | Yes | latest |',
        ]));
        upsertQualityLogRow(insideFile, {
            taskId: 'duplicate-task',
            specIterTotal: 7,
            reviewIterTotal: 3,
        }, {});
        const insideContent = fs.readFileSync(insideFile, 'utf8');
        assert.equal((insideContent.match(/\| duplicate-task \|/g) ?? []).length, 1);
        assert.ok(insideContent.includes(sibling));
        const inside = rowFor(insideFile, 'duplicate-task');
        assert.equal(inside['Spec verdict'], 'changes_requested');
        assert.equal(inside.Notes, 'latest');
        assert.equal(inside['Human reroute?'], 'Yes');

        const strayFile = path.join(dir, 'duplicate-stray.md');
        fs.writeFileSync(strayFile, [
            tableDocument([
                sibling,
                '| 2026-01-02 | duplicate-task | S | changes_requested | 1 | 1 | 0 | 0 | No | earliest |',
            ]),
            '| 2026-01-03 | duplicate-task | M | approved | 2 | 2 | 1 | 1 | Yes | latest stray |',
        ].join('\n'), 'utf8');
        upsertQualityLogRow(strayFile, {
            taskId: 'duplicate-task',
            specIterTotal: 8,
            reviewIterTotal: 4,
        }, {});
        const strayContent = fs.readFileSync(strayFile, 'utf8');
        assert.equal((strayContent.match(/\| duplicate-task \|/g) ?? []).length, 1);
        assert.ok(strayContent.includes(sibling));
        const reconciled = rowFor(strayFile, 'duplicate-task');
        assert.equal(reconciled['Spec verdict'], 'changes_requested');
        assert.equal(reconciled.Notes, 'latest stray');
        assert.equal(reconciled['Human reroute?'], 'Yes');
    });
});

void test('quality-log writer does not infer human reroutes or mutate attempt artifacts', () => {
    withTempDir(dir => {
        const taskId = 'ship-shared-doc-dirt-preservation';
        const file = writeLog(dir, tableDocument([
            `| 2026-01-01 | ${taskId} | S delicate | approved | 8 | 3 | 0 | 0 | No | existing |`,
            '| 2026-01-01 | sibling-task | S | approved | 1 | 1 | 0 | 0 | No | sibling |',
        ]));
        const artifacts = new Map<string, string>([
            [path.join(dir, 'status.json'), '{"phases":{"implement":{"reroute_count":2}}}\n'],
            [path.join(dir, 'spec-review.md'), '# Spec review history\n'],
            [path.join(dir, 'review.md'), '# Code review history\n'],
        ]);
        for (const [artifact, content] of artifacts) fs.writeFileSync(artifact, content, 'utf8');
        const siblingLine = readRows(file).find(row => row.Task === 'sibling-task');

        upsertQualityLogRow(file, {
            taskId,
            specIterTotal: 8,
            reviewIterTotal: 3,
        }, {});

        assert.equal(rowFor(file, taskId)['Human reroute?'], 'No');
        assert.deepEqual(readRows(file).find(row => row.Task === 'sibling-task'), siblingLine);
        for (const [artifact, content] of artifacts) {
            assert.equal(fs.readFileSync(artifact, 'utf8'), content);
        }
    });
});
