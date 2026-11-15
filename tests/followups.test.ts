import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyTracked, formatShipFollowups, parseFollowups } from '../src/orchestrator/followups.js';

function followups(body: string): string {
    return `# QA Summary\n\n## Open Questions\n\nNo decision pending.\n\n## Follow-ups\n\n${body}\n\n## Quality Log\n`;
}

const header = '| Category | Follow-up | Tracked |\n|---|---|---|';

void test('parseFollowups returns category, text and each tracked state from a valid table', () => {
    const result = parseFollowups(followups([
        header,
        '| risk | needs a check | untracked |',
        '| nit | deferred cleanup | dropped |',
        '| scope | update the guide | post-ship |',
        '| correctness | filed item | https://example.test/1 |',
        '| scope | issue reference | #42 |',
        '| observation | linked issue | [issue](https://example.test/2) |',
        '| scope | tracked task | task:follow-up-task |',
    ].join('\n')));
    assert.deepEqual(result, {
        kind: 'rows',
        rows: [
            { category: 'risk', text: 'needs a check', tracked: 'untracked' },
            { category: 'nit', text: 'deferred cleanup', tracked: 'dropped' },
            { category: 'scope', text: 'update the guide', tracked: 'post-ship' },
            { category: 'correctness', text: 'filed item', tracked: 'tracked' },
            { category: 'scope', text: 'issue reference', tracked: 'tracked' },
            { category: 'observation', text: 'linked issue', tracked: 'tracked' },
            { category: 'scope', text: 'tracked task', tracked: 'tracked' },
        ],
    });
});

void test('parseFollowups accepts None. and a header-only table as zero rows', () => {
    assert.deepEqual(parseFollowups(followups('None.')), { kind: 'rows', rows: [] });
    assert.deepEqual(parseFollowups(followups('None')), { kind: 'rows', rows: [] });
    assert.deepEqual(parseFollowups(followups(header)), { kind: 'rows', rows: [] });
});

void test('parseFollowups rejects None. when other visible content is present', () => {
    for (const body of ['None.\n- follow up item', '- follow up item\nNone.', 'Notes.\nNone.']) {
        assert.deepEqual(parseFollowups(followups(body)), {
            kind: 'unparseable',
            reason: '`None.` must be the only visible content line',
        });
    }
});

void test('parseFollowups distinguishes a missing section from an empty section', () => {
    assert.deepEqual(parseFollowups('# QA Summary\n\n## Open Questions\n\nNone.\n'), { kind: 'missing' });
    assert.deepEqual(parseFollowups(followups('')), { kind: 'unparseable', reason: 'no table and no `None.` line' });
});

void test('parseFollowups rejects an unexpected header and a row with the wrong number of cells', () => {
    const badHeader = parseFollowups(followups('| Topic | Text | State |\n|---|---|---|\n| risk | item | untracked |'));
    assert.equal(badHeader.kind, 'unparseable');
    if (badHeader.kind === 'unparseable') assert.match(badHeader.reason, /header on line/);

    const badRow = parseFollowups(followups(`${header}\n| risk | item | untracked | extra |`));
    assert.equal(badRow.kind, 'unparseable');
    if (badRow.kind === 'unparseable') {
        assert.match(badRow.reason, /line \d+ has 4 cells, expected 3/);
        assert.match(badRow.reason, /escape a literal pipe as \\\|/);
    }
});

void test('classifyTracked handles exact states, references, and fail-safe untracked values', () => {
    for (const [cell, expected] of [
        [' `POST-SHIP` ', 'post-ship'],
        [' Dropped ', 'dropped'],
        ['https://example.test/item', 'tracked'],
        ['#7', 'tracked'],
        ['[issue](https://example.test/3)', 'tracked'],
        ['TASK:follow-up-task', 'tracked'],
        ['', 'untracked'],
        ['untracked (needs issue)', 'untracked'],
        ['follow-up-task', 'untracked'],
        ['tbd', 'untracked'],
        ['task:', 'untracked'],
        ['task:Foo Bar', 'untracked'],
        ['#42, #43', 'untracked'],
        ['owner/repo#42', 'untracked'],
        ['dropped (reason)', 'untracked'],
    ] as const) {
        assert.equal(classifyTracked(cell), expected, cell);
    }
});

void test('parseFollowups keeps unknown categories as written and unescapes literal pipes in cells', () => {
    const result = parseFollowups(followups(`${header}\n| wontfix-category | left \\| right | untracked |`));
    assert.deepEqual(result, {
        kind: 'rows',
        rows: [{ category: 'wontfix-category', text: 'left | right', tracked: 'untracked' }],
    });
});

void test('parseFollowups ignores fenced and commented tables', () => {
    const fenced = followups(`\`\`\`md\n${header}\n| risk | hidden | untracked |\n\`\`\``);
    assert.deepEqual(parseFollowups(fenced), { kind: 'unparseable', reason: 'no table and no `None.` line' });

    const commented = followups(`<!--\n${header}\n| risk | hidden | untracked |\n-->\nNone.`);
    assert.deepEqual(parseFollowups(commented), { kind: 'rows', rows: [] });

    const fencedWithNone = followups(`\`\`\`md\n${header}\n| risk | hidden | untracked |\n\`\`\`\nNone.`);
    assert.deepEqual(parseFollowups(fencedWithNone), { kind: 'rows', rows: [] });
});

void test('parseFollowups uses the last Follow-ups heading', () => {
    const markdown = `# QA Summary\n\n## Follow-ups\n\n${header}\n| risk | first section | untracked |\n\n## Notes\n\nMiddle.\n\n## Follow-ups\n\nNone.\n`;
    assert.deepEqual(parseFollowups(markdown), { kind: 'rows', rows: [] });
});

void test('parseFollowups rejects prose-only content, multiple tables, and a table plus None.', () => {
    assert.equal(parseFollowups(followups('Consider doing more later.')).kind, 'unparseable');
    assert.equal(parseFollowups(followups(`${header}\n| risk | first | untracked |\n\n${header}\n| risk | second | untracked |`)).kind, 'unparseable');
    assert.equal(parseFollowups(followups(`${header}\n| risk | first | untracked |\n\nNone.`)).kind, 'unparseable');
    assert.equal(parseFollowups(followups('| Category | Follow-up | Tracked |\n| x | y |')).kind, 'unparseable');
});

void test('formatShipFollowups groups both blocks by task and omits empty blocks', () => {
    const rows = [
        {
            taskId: 'task-a',
            rows: [
                { category: 'risk', text: 'decide this', tracked: 'untracked' as const },
                { category: 'scope', text: 'write this later', tracked: 'post-ship' as const },
                { category: 'nit', text: 'dropped', tracked: 'dropped' as const },
            ],
        },
        { taskId: 'task-b', rows: [{ category: 'observation', text: 'also decide this', tracked: 'untracked' as const }] },
    ];
    const both = formatShipFollowups(rows);
    assert.deepEqual(both, [
        'Post-ship follow-ups:',
        '  task-a:',
        '    - [scope] write this later',
        '  Write these in the post-ship docs commit (backlog entries or doc fixes).',
        '',
        'Untracked follow-ups:',
        '  task-a:',
        '    - [risk] decide this',
        '  task-b:',
        '    - [observation] also decide this',
        '  Put these to the human: file now, write post-ship, or drop.',
    ]);
    assert.equal(formatShipFollowups([{ taskId: 'task-a', rows: [rows[0].rows[0]] }]).filter(line => line === 'Untracked follow-ups:').length, 1);
    assert.equal(formatShipFollowups([{ taskId: 'task-a', rows: [rows[0].rows[2]] }]).length, 0);
    assert.deepEqual(formatShipFollowups([]), []);
});
