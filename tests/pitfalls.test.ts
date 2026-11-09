import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    buildRelevantPitfalls,
    PITFALLS_BYTE_CAP,
    PITFALLS_DOCS_ROOT_ENV,
    PITFALLS_HEADING,
    selectPitfalls,
} from '../src/orchestrator/pitfalls.js';

const noDocs = (): null => null;

function matchingInput(patterns: string, affectedFiles = ['src/a/b.ts'], readDoc: (repoPath: string) => string | null = noDocs): Parameters<typeof selectPitfalls>[0] {
    return { patterns, lessons: null, readDoc, affectedFiles };
}

function tablePatterns(table: string, body = ''): string {
    return `# Fixture patterns\n\n## Trigger Table\n\n${table}\n\n${body}`;
}

function withEnvironment(values: Record<string, string>, action: () => void): void {
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(values)) {
        previous.set(key, process.env[key]);
        process.env[key] = value;
    }
    try {
        action();
    } finally {
        for (const [key, value] of previous) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

function specWithAffectedFile(file: string): string {
    return `# Spec\n\n## Design\n\n### Affected Files\n\n| File | Change |\n|---|---|\n| \`${file}\` | fixture change |\n`;
}

void test('AC-2: direct path and directory matches are full; unrelated paths stay titles', () => {
    const patterns = `## Known Pitfalls\n\n### Exact file\n\nExact body cites \`src/a/b.ts\`.\n\n### Parent directory\n\nDirectory body cites \`src/a/\`.\n\n### Unrelated file\n\nUnrelated body cites \`src/z/q.ts\`.\n`;
    const output = selectPitfalls(matchingInput(patterns));
    assert.match(output, /### Exact file[\s\S]*Exact body cites `src\/a\/b\.ts`\./);
    assert.match(output, /### Parent directory[\s\S]*Directory body cites `src\/a\/`\./);
    assert.match(output, /### Other pitfalls \(titles only\)[\s\S]*- Unrelated file/);
    assert.doesNotMatch(output, /Unrelated body cites/);
});

void test('AC-1: prose-only Known Pitfalls are included regardless of affected files, without blockquotes', () => {
    const patterns = `## Known Pitfalls

First prose paragraph explains a durable rule in full.

Second prose paragraph gives the concrete check to follow.

> BLOCKQUOTE_AUTHOR_GUIDANCE
Lazy continuation belongs to the same quoted paragraph.

~~~md
> FENCED_QUOTE_TEXT_IS_PROSE
~~~

| Read this doc | Before touching |
|---|---|
| \`docs/pitfalls/area.md\` | \`src/a/**\` |
`;

    for (const affectedFiles of [[], ['src/unrelated.ts']]) {
        const output = selectPitfalls({ ...matchingInput(patterns, affectedFiles), affectedFiles });
        assert.match(output, /### Known Pitfalls \(included regardless of your files\)/);
        assert.match(output, /First prose paragraph explains a durable rule in full\./);
        assert.match(output, /Second prose paragraph gives the concrete check to follow\./);
        assert.doesNotMatch(output, /BLOCKQUOTE_AUTHOR_GUIDANCE/);
        assert.doesNotMatch(output, /Lazy continuation belongs to the same quoted paragraph\./);
        assert.match(output, /> FENCED_QUOTE_TEXT_IS_PROSE/);
        assert.doesNotMatch(output, /### Pitfalls and patterns that cite your files[\s\S]*First prose paragraph/);
    }
});

void test('AC-1: a block-level construct right after a blockquote ends it and stays in the prose', () => {
    const patterns = `## Known Pitfalls

> AUTHOR_NOTE
#### HEADING_AFTER_QUOTE
- LIST_AFTER_QUOTE
1. ORDERED_AFTER_QUOTE

> SECOND_NOTE
Lazy continuation is dropped.
- LIST_ENDS_SECOND_QUOTE
`;
    const output = selectPitfalls(matchingInput(patterns, []));
    assert.doesNotMatch(output, /AUTHOR_NOTE|SECOND_NOTE|Lazy continuation is dropped/);
    for (const kept of ['#### HEADING_AFTER_QUOTE', '- LIST_AFTER_QUOTE', '1. ORDERED_AFTER_QUOTE', '- LIST_ENDS_SECOND_QUOTE']) {
        assert.ok(output.includes(kept), `expected ${kept} in the prose fallback`);
    }
});

void test('AC-1b: prose fallback leaves index rows separate and respects H3 boundaries', () => {
    const withIndex = `## Known Pitfalls

Fallback prose stays in the prose subsection.

| Read this doc | Before touching |
|---|---|
| \`docs/pitfalls/index.md\` | \`src/a/**\` |
`;
    const indexed = selectPitfalls(matchingInput(withIndex, []));
    const proseStart = indexed.indexOf('### Known Pitfalls (included regardless of your files)');
    const areaStart = indexed.indexOf('### Area index');
    assert.ok(proseStart >= 0 && areaStart > proseStart);
    assert.match(indexed.slice(proseStart, areaStart), /Fallback prose stays in the prose subsection\./);
    assert.doesNotMatch(indexed.slice(proseStart, areaStart), /docs\/pitfalls\/index\.md/);
    assert.match(indexed.slice(areaStart), /docs\/pitfalls\/index\.md/);

    const scaffold = fs.readFileSync(path.join(process.cwd(), 'templates/docs/patterns.md'), 'utf8');
    const scaffoldStart = scaffold.indexOf('## Known Pitfalls');
    const nextSection = scaffold.indexOf('\n## ', scaffoldStart + 1);
    const scaffoldPitfalls = scaffold.slice(scaffoldStart, nextSection < 0 ? undefined : nextSection);
    const scaffoldWithoutExample = scaffoldPitfalls.replace(/\n### Reset derived state when a source identifier changes[\s\S]*$/, '');
    const tableOnly = scaffoldWithoutExample.replace(
        '## Known Pitfalls',
        '## Known Pitfalls\n\n| Read this doc | Before touching |\n|---|---|\n| `docs/pitfalls/example.md` | `src/a/**` |',
    );
    const noProse = selectPitfalls(matchingInput(tableOnly, []));
    assert.doesNotMatch(noProse, /Known Pitfalls \(included regardless/);
    assert.match(noProse, /docs\/pitfalls\/example\.md/);

    const preamble = `## Known Pitfalls

PREAMBLE_MUST_NOT_BE_INJECTED.

### H3 entry

H3_ENTRY_BODY cites \`src/a/b.ts\`.
`;
    const h3Output = selectPitfalls(matchingInput(preamble));
    assert.match(h3Output, /### H3 entry[\s\S]*H3_ENTRY_BODY/);
    assert.doesNotMatch(h3Output, /PREAMBLE_MUST_NOT_BE_INJECTED/);
});

void test('AC-2: prose fallback demotes in the direct channel after lesson, section, and linked entries', () => {
    const linkedPath = 'docs/pitfalls/directory.md';
    const linkedDoc = `# Linked\n\n### Linked direct entry\n\nLINKED_DIRECT_SENTINEL cites \`src/a/b.ts\`.\n`;
    const prose = `PROSE_FALLBACK_SENTINEL ${'long prose '.repeat(45)}`;
    const patterns = `## Trigger Table

| Area | Section / doc | Keys |
|---|---|---|
| Section target | Directory Rules | \`src/a/b.ts\` |
| Linked doc | \`docs/pitfalls/directory.md\` | \`src/a/b.ts\` |

## Directory Rules

SECTION_TARGET_SENTINEL cites \`src/a/b.ts\`.

## Known Pitfalls

### Direct matching entry

DIRECT_MATCH_SENTINEL cites \`src/a/b.ts\`.

## Known Pitfalls

${prose}
`;
    const lessons = `# Lessons\n\n### Matching lesson\n\nLESSON_SENTINEL cites \`src/a/b.ts\`.\n`;
    const output = selectPitfalls({
        patterns,
        lessons,
        readDoc: repoPath => repoPath === linkedPath ? linkedDoc : null,
        affectedFiles: ['src/a/b.ts'],
        cap: 1200,
    });
    assert.ok(Buffer.byteLength(output, 'utf8') <= 1200);
    assert.doesNotMatch(output, /PROSE_FALLBACK_SENTINEL/);
    assert.match(output, /- Known Pitfalls/);
    assert.match(output, /DIRECT_MATCH_SENTINEL/);
    assert.doesNotMatch(output, /LESSON_SENTINEL|SECTION_TARGET_SENTINEL|LINKED_DIRECT_SENTINEL/);
});

void test('AC-3: directory Affected Files match entries, index rows, linked docs, and lessons inside the directory', () => {
    const linkedPath = 'docs/pitfalls/directory.md';
    const linkedDoc = `# Directory pitfalls\n\n### Linked directory entry\n\nLINKED_DIRECTORY_ENTRY cites \`src/a/b.ts\`.\n`;
    const patterns = `## Known Pitfalls

| Read this doc | Before touching |
|---|---|
| \`docs/pitfalls/directory.md\` | \`src/a/**\` |

| Area | Section | Keys |
|---|---|---|
| Directory glob | Directory Rules | \`src/**/*.ts\` |
| Outside directory | Other Rules | \`src/ab/**\` |
| Non-matching root glob | Other Rules | \`*.md\` |

### Direct directory entry

DIRECT_DIRECTORY_ENTRY cites \`src/a/b.ts\`.

### Outside sibling entry

OUTSIDE_SIBLING_ENTRY cites \`src/ab/c.ts\`.

### Outside root entry

OUTSIDE_ROOT_ENTRY cites \`src/z.ts\`.

## Trigger Table

| Area | Section | Keys |
|---|---|---|
| Trigger directory | Trigger Rules | \`src/a/b.ts\` |

## Directory Rules

DIRECTORY_GLOB_SECTION cites \`src/a/b.ts\`.

## Trigger Rules

TRIGGER_DIRECTORY_SECTION_BODY.

## Other Rules

OTHER_RULES_SECTION_BODY.
`;
    const lessons = `# Lessons\n\n### Directory lesson\n\nDIRECTORY_LESSON cites \`src/a/b.ts\`.\n`;
    const output = selectPitfalls({
        patterns,
        lessons,
        readDoc: repoPath => repoPath === linkedPath ? linkedDoc : null,
        affectedFiles: ['src/a/'],
    });

    assert.match(output, /DIRECT_DIRECTORY_ENTRY cites `src\/a\/b\.ts`\./);
    assert.match(output, /TRIGGER_DIRECTORY_SECTION_BODY/);
    assert.match(output, /LINKED_DIRECTORY_ENTRY cites `src\/a\/b\.ts`\./);
    assert.match(output, /DIRECTORY_LESSON cites `src\/a\/b\.ts`\./);
    assert.match(output, /Directory Rules — Directory glob — `src\/\*\*\/\*\.ts` \*\*\(matches this task\)\*\*/);
    assert.match(output, /Other Rules — Outside directory — `src\/ab\/\*\*`(?! \*\*\(matches this task\)\*\*)/);
    assert.match(output, /Other Rules — Non-matching root glob — `\*\.md`(?! \*\*\(matches this task\)\*\*)/);
    assert.match(output, /`docs\/pitfalls\/directory\.md` — `src\/a\/\*\*` \*\*\(matches this task\)\*\*/);
    assert.match(output, /Trigger Rules — Trigger directory — `src\/a\/b\.ts` \*\*\(matches this task\)\*\*/);
    assert.doesNotMatch(output, /OUTSIDE_SIBLING_ENTRY cites/);
    assert.doesNotMatch(output, /OUTSIDE_ROOT_ENTRY cites/);
});

void test('AC-3: linked docs match globs, retain titles, and resolve relative markdown links', () => {
    const docPath = 'docs/pitfalls/state.md';
    const linkedDoc = `# State pitfalls\n\n### Editor persistence\n\nEditor body cites \`app/src/store/editor.ts\`.\n\n### Migration fallback\n\nMigration body cites \`app/src/migrations/state.ts\`.\n`;
    const readDoc = (repoPath: string): string | null => repoPath === docPath ? linkedDoc : null;
    const patterns = `## Known Pitfalls\n\n| Read this doc | Before touching |\n|---|---|\n| \`docs/pitfalls/state.md\` | \`app/src/store/**\`, settings persistence |\n`;
    const matched = selectPitfalls({ ...matchingInput(patterns, ['app/src/store/editor.ts'], readDoc) });
    assert.match(matched, /### Editor persistence[\s\S]*Editor body cites/);
    assert.match(matched, /Open `docs\/pitfalls\/state\.md` — it covers files this task touches\./);
    assert.match(matched, /- Migration fallback/);
    assert.doesNotMatch(matched, /Migration body cites/);
    assert.match(matched, /matches this task/);

    const unmatched = selectPitfalls({ ...matchingInput(patterns, ['app/src/ui/x.ts'], readDoc) });
    assert.doesNotMatch(unmatched, /Editor body cites/);
    assert.match(unmatched, /\*\*docs\/pitfalls\/state\.md\*\*[\s\S]*- Editor persistence[\s\S]*- Migration fallback/);
    assert.doesNotMatch(unmatched, /Open `docs\/pitfalls\/state\.md`/);
    assert.match(unmatched, /`app\/src\/store\/\*\*`/);

    const linkedPattern = `## Known Pitfalls\n\n| Read this doc | Before touching |\n|---|---|\n| [state](pitfalls/state.md) | \`app/src/store/**\` |\n`;
    const relative = selectPitfalls({ ...matchingInput(linkedPattern, ['app/src/store/editor.ts'], readDoc) });
    assert.match(relative, /### Editor persistence[\s\S]*Editor body cites/);
    assert.match(relative, /\*\*docs\/pitfalls\/state\.md\*\*/);
});

void test('AC-4: every index row stays in the area index, including keyless and matched rows', () => {
    const patterns = `## Known Pitfalls\n\n| Read this doc | Before touching |\n|---|---|\n| \`docs/pitfalls/effects.md\` | Any new effect or timer — cross-cutting |\n\n### Entry with an explanatory table\n\nThis table is part of an entry, not an index.\n\n| File | Why |\n|---|---|\n| \`src/z/q.ts\` | transformed value |\n\n## Trigger Table — Scan This First\n\n| Area | Section | Key files |\n|---|---|---|\n| No key | Shared Rules | — |\n| Affected | Shared Rules | \`src/a/b.ts\` |\n\n## Shared Rules\n\nSection body.\n`;
    const output = selectPitfalls(matchingInput(patterns));
    assert.match(output, /### Area index[\s\S]*`docs\/pitfalls\/effects\.md` — Any new effect or timer — cross-cutting/);
    const areaStart = output.indexOf('### Area index');
    const titleStart = output.indexOf('### Other pitfalls (titles only)', areaStart);
    assert.doesNotMatch(output.slice(areaStart, titleStart), /transformed value/);
    assert.match(output.slice(titleStart), /- Entry with an explanatory table/);
    assert.match(output, /Shared Rules — No key — —/);
    assert.match(output, /Shared Rules — Affected — `src\/a\/b\.ts` \*\*\(matches this task\)\*\*/);

    const triggerUnderH3 = `## Trigger Table\n\n### Frontend\n\n| Area | Section | Keys |\n|---|---|---|\n| New interface | Interface Rules | \`src/a/b.ts\` |\n\n## Interface Rules\n\nTRIGGER_TABLE_H3_SECTION\n`;
    const nestedTrigger = selectPitfalls(matchingInput(triggerUnderH3));
    assert.match(nestedTrigger, /## Interface Rules\n\nTRIGGER_TABLE_H3_SECTION/);
    assert.match(nestedTrigger, /Interface Rules — New interface — `src\/a\/b\.ts` \*\*\(matches this task\)\*\*/);

    const entryTable = `## Known Pitfalls\n\n### Existing entry\n\nEXISTING_ENTRY_BODY cites the table's \`src/a/b.ts\` path.\n\n| Read this doc | Before touching |\n|---|---|\n| \`docs/pitfalls/effects.md\` | \`src/a/b.ts\` |\n`;
    const tableInEntry = selectPitfalls(matchingInput(entryTable));
    const fullStart = tableInEntry.indexOf('### Pitfalls and patterns that cite your files');
    const areaIndexStart = tableInEntry.indexOf('### Area index');
    const fullBlock = tableInEntry.slice(fullStart, areaIndexStart < 0 ? undefined : areaIndexStart);
    assert.match(fullBlock, /### Existing entry[\s\S]*EXISTING_ENTRY_BODY[\s\S]*\| `docs\/pitfalls\/effects\.md` \| `src\/a\/b\.ts` \|/);
    assert.ok(areaIndexStart < 0 || !tableInEntry.slice(areaIndexStart).includes('docs/pitfalls/effects.md'));

    const unresolvableIndex = `## Known Pitfalls\n\n| Area | Section | Keys |\n|---|---|---|\n| Unmapped area | Future section | \`src/a/b.ts\` |\n\n### Existing entry\n\nNo matching path.\n`;
    const unresolved = selectPitfalls(matchingInput(unresolvableIndex));
    assert.match(unresolved, /Future section — Unmapped area — `src\/a\/b\.ts` \*\*\(matches this task\)\*\*/);

    const noAffectedFiles = selectPitfalls({ ...matchingInput(patterns, []), affectedFiles: [] });
    assert.match(noAffectedFiles, /`docs\/pitfalls\/effects\.md` — Any new effect or timer — cross-cutting/);
    assert.match(noAffectedFiles, /Shared Rules — No key — —/);
});

void test('AC-15: Known Pitfalls index tables stop at the first H3', () => {
    const entryTable = `## Known Pitfalls\n\n### Worker retries\n\nWorker retries can re-enter the queue.\n\n| File | Why |\n|---|---|\n| \`src/queue/worker.ts\` | retries re-enter |\n`;
    const selectedEntry = selectPitfalls(matchingInput(entryTable, ['src/queue/worker.ts']));
    const fullStart = selectedEntry.indexOf('### Pitfalls and patterns that cite your files');
    const areaStart = selectedEntry.indexOf('### Area index');
    const full = selectedEntry.slice(fullStart, areaStart < 0 ? undefined : areaStart);
    assert.match(full, /### Worker retries[\s\S]*Worker retries can re-enter the queue\.[\s\S]*`src\/queue\/worker\.ts` \| retries re-enter/);
    assert.ok(areaStart < 0 || !selectedEntry.slice(areaStart).includes('retries re-enter'));

    const noSignals = `## Known Pitfalls\n\n| Area | Notes |\n|---|---|\n| Legacy area | ask the owner |\n\n### Legacy entry\n\nLegacy body.\n`;
    const areaIndex = selectPitfalls(matchingInput(noSignals, []));
    assert.match(areaIndex, /### Area index[\s\S]*Legacy area — ask the owner/);
});

void test('AC-16: the Read this doc header hint selects the linked-doc column', () => {
    const linkedPath = 'docs/pitfalls/state.md';
    const linkedDoc = `# State pitfalls\n\n### Store writes\n\nStore writes cite \`app/src/store/editor.ts\`.\n\n### Other state rule\n\nThis rule has no matching path.\n`;
    const patterns = `## Known Pitfalls\n\n| Area | Read this doc | Key files |\n|---|---|---|\n| State | \`docs/pitfalls/state.md\` | \`app/src/store/**\` |\n\n## State Management Rules\n\nSTATE_MGMT_SENTINEL\n`;
    const output = selectPitfalls(matchingInput(patterns, ['app/src/store/editor.ts'], repoPath => repoPath === linkedPath ? linkedDoc : null));
    assert.match(output, /Open `docs\/pitfalls\/state\.md` — it covers files this task touches\./);
    assert.match(output, /### Store writes[\s\S]*Store writes cite `app\/src\/store\/editor\.ts`\./);
    assert.match(output, /- Other state rule/);
    assert.doesNotMatch(output, /STATE_MGMT_SENTINEL/);
});

void test('AC-16: Section header wins when an Area cell exactly matches another heading', () => {
    const patterns = tablePatterns(
        '| Area touched | Section | Key files |\n|---|---|---|\n| Testing | Fixture Rules | `src/a/b.ts` |',
        `## Testing\n\nTESTING_SENTINEL\n\n## Fixture Rules\n\nFIXTURE_SENTINEL\n`,
    );
    const output = selectPitfalls(matchingInput(patterns));
    assert.match(output, /FIXTURE_SENTINEL/);
    assert.doesNotMatch(output, /TESTING_SENTINEL/);
});

void test('AC-16: content fallback prefers a doc path over an exact heading', () => {
    const linkedPath = 'docs/pitfalls/x.md';
    const linkedDoc = `# Linked pitfall\n\n### Other rule\n\nNo matching file here.\n`;
    const patterns = `## Known Pitfalls\n\n| A | B | C |\n|---|---|---|\n| Exact Heading | \`docs/pitfalls/x.md\` | \`src/a/b.ts\` |\n\n## Exact Heading\n\nEXACT_HEADING_SENTINEL\n`;
    const output = selectPitfalls(matchingInput(patterns, ['src/a/b.ts'], repoPath => repoPath === linkedPath ? linkedDoc : null));
    assert.match(output, /Open `docs\/pitfalls\/x\.md` — it covers files this task touches\./);
    assert.doesNotMatch(output, /EXACT_HEADING_SENTINEL/);
});

void test('AC-16 pin: content fallback prefers an exact section over a prefix-only heading', () => {
    const patterns = `## Trigger Table\n\n| A | B | C |\n|---|---|---|\n| Retry | Queue Discipline | \`src/a/b.ts\` |\n\n## Retry Rules (backoff)\n\nRETRY_PREFIX_SENTINEL\n\n## Queue Discipline\n\nQUEUE_EXACT_SENTINEL\n`;
    const output = selectPitfalls(matchingInput(patterns));
    assert.match(output, /QUEUE_EXACT_SENTINEL/);
    assert.doesNotMatch(output, /RETRY_PREFIX_SENTINEL/);
});

void test('section cells outrank markdown paths in key cells, and markdown globs remain keys', () => {
    const lintRow = tablePatterns(
        '| Area | Section | Key files |\n|---|---|---|\n| Lint / TS suppression | Lint & Type Safety Policy | `src/orchestrator/prompts/templates/implement.md` |',
        `## Lint & Type Safety Policy\n\nLINT_POLICY_SECTION_SENTINEL\n`,
    );
    const lintOutput = selectPitfalls(matchingInput(lintRow, ['src/orchestrator/prompts/templates/implement.md']));
    assert.match(lintOutput, /## Lint & Type Safety Policy\n\nLINT_POLICY_SECTION_SENTINEL/);
    assert.match(lintOutput, /Lint & Type Safety Policy — Lint \/ TS suppression — `src\/orchestrator\/prompts\/templates\/implement\.md` \*\*\(matches this task\)\*\*/);
    assert.doesNotMatch(lintOutput, /Open `src\/orchestrator\/prompts\/templates\/implement\.md`/);

    const globKey = `## Known Pitfalls\n\n| Area | Section | Before touching |\n|---|---|---|\n| State docs | State Rules | \`docs/pitfalls/*.md\` |\n\n### State pitfall\n\nNo direct token here.\n\n## State Rules\n\nSTATE_RULES_SECTION_SENTINEL\n`;
    const globOutput = selectPitfalls(matchingInput(globKey, ['docs/pitfalls/state.md']));
    assert.match(globOutput, /## State Rules\n\nSTATE_RULES_SECTION_SENTINEL/);
    assert.match(globOutput, /State Rules — State docs — `docs\/pitfalls\/\*\.md` \*\*\(matches this task\)\*\*/);
});

void test('AC-5: section targets use exact headings before prefixes and allow mixed target cells', () => {
    const touchPath = 'docs/pitfalls/touch.md';
    const touchDoc = `# Touch\n\n### Mobile detail\n\nTouch body cites \`src/a/b.ts\`.\n`;
    const patterns = tablePatterns(
        '| Area | Section / doc | Key files |\n|---|---|---|\n| Changing queue | Queue Discipline; Retry Rules (backoff; retries) | `src/queue/worker.ts` |\n| Testing | Testing | `src/a/b.ts` |\n| Touch behavior | Mobile Rules; `docs/pitfalls/touch.md` | `src/a/b.ts` |',
        `## Queue Discipline\n\nQueue discipline body.\n\n### Retry Rules (backoff)\n\nRetry rules body.\n\n## Testing\n\nExact testing section.\n\n## Testing Utilities\n\nUtilities section must not be selected.\n\n### Testing Utilities helper\n\nThis title belongs to another section.\n\n## Mobile Rules\n\nMobile rules section.\n\n## Known Pitfalls\n\n### Unrelated pitfall title\n\nNo path here.\n`,
    );
    const output = selectPitfalls({ ...matchingInput(patterns, ['src/queue/worker.ts', 'src/a/b.ts'], repoPath => repoPath === touchPath ? touchDoc : null) });
    const fullStart = output.indexOf('### Pitfalls and patterns that cite your files');
    const fullEnd = output.indexOf('### Area index', fullStart);
    const full = output.slice(fullStart, fullEnd);
    assert.match(full, /## Queue Discipline[\s\S]*### Retry Rules \(backoff\)/);
    assert.match(full, /## Testing\n\nExact testing section\./);
    assert.doesNotMatch(full, /Testing Utilities/);
    assert.match(full, /## Mobile Rules\n\nMobile rules section\./);
    assert.match(full, /### Mobile detail[\s\S]*Touch body cites/);
    assert.match(full, /## Testing\n\nExact testing section\./);
    assert.doesNotMatch(output, /Utilities section must not be selected/);
    assert.doesNotMatch(output, /- Testing Utilities helper/);
    assert.match(output, /Unrelated pitfall title/);

    const ambiguousArea = tablePatterns(
        '| Area | Section | Key files |\n|---|---|---|\n| Testing | Fixture Rules | `tests/**` |',
        `## Testing Utilities\n\nWRONG_AREA_SECTION\n\n## Fixture Rules\n\nRIGHT_TARGET_SECTION\n`,
    );
    const ranked = selectPitfalls(matchingInput(ambiguousArea, ['tests/example.test.ts']));
    assert.match(ranked, /## Fixture Rules[\s\S]*RIGHT_TARGET_SECTION/);
    assert.doesNotMatch(ranked, /WRONG_AREA_SECTION/);
    assert.match(ranked, /Fixture Rules — Testing — `tests\/\*\*`/);

    const docSectionOnly = tablePatterns(
        '| Area | Section | Keys |\n|---|---|---|\n| Patterns | `docs/patterns.md` §Testing | `src/a/b.ts` |',
        `## Testing\n\nTESTING_SECTION_ONLY\n\n## Testing Utilities\n\nOTHER_SECTION\n\n## Known Pitfalls\n\n### Known title\n\nNo matching path.\n`,
    );
    const docSectionOutput = selectPitfalls(matchingInput(docSectionOnly));
    assert.match(docSectionOutput, /## Testing\n\nTESTING_SECTION_ONLY/);
    assert.doesNotMatch(docSectionOutput, /Open `docs\/patterns\.md`/);
    assert.match(docSectionOutput, /- Known title/);
    assert.doesNotMatch(docSectionOutput, /OTHER_SECTION/);
});

void test('AC-6: direct entries covered by a selected section render once and leave no duplicate title', () => {
    const patterns = tablePatterns(
        '| Area | Section | Key files |\n|---|---|---|\n| Change shared rules | Known Pitfalls | `src/a/b.ts` |',
        `## Known Pitfalls\n\n### Shared matching entry\n\nSHARED_SENTINEL cites \`src/a/b.ts\`.\n\n### Nested unmatched entry\n\nNESTED_SENTINEL cites \`src/z/q.ts\`.\n`,
    );
    const output = selectPitfalls(matchingInput(patterns));
    assert.equal(output.split('SHARED_SENTINEL').length - 1, 1);
    assert.equal(output.split('NESTED_SENTINEL').length - 1, 1);
    assert.doesNotMatch(output, /- Shared matching entry/);
    assert.doesNotMatch(output, /- Nested unmatched entry/);
});

void test('AC-7: matching lesson entries are injected outside the excluded example scope', () => {
    const lessons = `# Lessons Learned\n\n## How to use this doc\n\n### How-to note\n\nCites \`src/a/b.ts\`.\n\n## Entry format\n\n\`\`\`md\n### Heading\nCites \`src/a/b.ts\`.\n\`\`\`\n\n## Example entry\n\n### Example entry\n\nExample body cites \`src/a/b.ts\`.\n\n---\n\n\`\`\`js\`\`\`\n\n### Real lesson\n\nReal lesson body cites \`src/a/b.ts\`.\n\n### Unrelated lesson\n\nUnrelated body cites \`src/z/q.ts\`.\n`.replaceAll('\n', '\r\n');
    const output = selectPitfalls({ patterns: null, lessons, readDoc: noDocs, affectedFiles: ['src/a/b.ts'] });
    assert.match(output, /### Lessons that cite your files[\s\S]*### Real lesson[\s\S]*Real lesson body cites/);
    assert.doesNotMatch(output, /Example body cites/);
    assert.doesNotMatch(output, /Unrelated body cites/);
    assert.doesNotMatch(output, /### Heading/);
    assert.doesNotMatch(output, /\r/);
});

void test('AC-8: only path-like tokens match, and source line suffixes are removed', () => {
    const patterns = `## Known Pitfalls\n\n### Basename only\n\nUses \`b.ts\`.\n\n### Symbol only\n\nUses \`runPhase()\`.\n\n### Plain word only\n\nUses \`true\`.\n\n### Path with source range\n\nUses \`src/a/b.ts:12-30\`.\n\n### Preserve C# heading text\n\nUses \`src/a/b.ts\`.\n`;
    const output = selectPitfalls(matchingInput(patterns));
    assert.match(output, /### Path with source range[\s\S]*Uses `src\/a\/b\.ts:12-30`\./);
    assert.match(output, /### Preserve C# heading text/);
    assert.doesNotMatch(output, /Uses `b\.ts`/);
    assert.doesNotMatch(output, /Uses `runPhase\(\)`/);
    assert.doesNotMatch(output, /Uses `true`/);
    assert.match(output, /- Basename only/);
    assert.match(output, /- Symbol only/);
    assert.match(output, /- Plain word only/);
});

void test('AC-9: cap demotes lessons, sections, and linked entries before direct matches', () => {
    const fill = (letter: string): string => letter.repeat(850);
    const linkedPath = 'docs/pitfalls/cap.md';
    const linkedDoc = `# Linked\n\n### Linked matching rule\n\nLINKED_START \`src/a/b.ts\` ${fill('L')}\n`;
    const patterns = tablePatterns(
        '| Area | Section / doc | Keys |\n|---|---|---|\n| Section area | Large Section | `src/a/b.ts` |\n| Linked area | `docs/pitfalls/cap.md` | `src/a/b.ts` |',
        `## Large Section\n\nSECTION_START ${fill('S')}\n\n## Known Pitfalls\n\n### Direct matching rule\n\nDIRECT_START \`src/a/b.ts\` ${fill('D')}\n`,
    );
    const lessons = `# Lessons\n\n### Lesson matching rule\n\nLESSON_START \`src/a/b.ts\` ${fill('T')}\n`;
    const output = selectPitfalls({
        patterns,
        lessons,
        readDoc: repoPath => repoPath === linkedPath ? linkedDoc : null,
        affectedFiles: ['src/a/b.ts'],
        cap: 2200,
    });
    assert.ok(Buffer.byteLength(output, 'utf8') <= 2200, `output used ${Buffer.byteLength(output, 'utf8')} bytes`);
    assert.match(output, /DIRECT_START/);
    assert.doesNotMatch(output, /LESSON_START/);
    assert.doesNotMatch(output, /SECTION_START/);
    assert.doesNotMatch(output, /LINKED_START/);
    assert.match(output, /- Linked matching rule/);
    const demotedStart = output.indexOf('### Demoted to fit the cap');
    const lessonDemoted = output.indexOf('Lesson matching rule (demoted to fit)', demotedStart);
    const sectionDemoted = output.indexOf('Large Section (demoted to fit)', demotedStart);
    assert.ok(demotedStart >= 0 && lessonDemoted > demotedStart && sectionDemoted > lessonDemoted);
    assert.match(output, /3 full candidates demoted/);

    const titleRows = Array.from({ length: 20 }, (_, index) => `### Unmatched title ${index}\n\nNo path here.\n`).join('\n');
    const titleHeavy = selectPitfalls({
        patterns: `## Known Pitfalls\n\n${titleRows}`,
        lessons: null,
        readDoc: noDocs,
        affectedFiles: [],
        cap: 450,
    });
    assert.ok(Buffer.byteLength(titleHeavy, 'utf8') <= 450);
    assert.match(titleHeavy, /\+\d+ more in docs\/patterns\.md/);
    assert.match(titleHeavy, /titles and 0 index rows dropped/);

    const tinyCap = selectPitfalls({
        patterns,
        lessons,
        readDoc: repoPath => repoPath === linkedPath ? linkedDoc : null,
        affectedFiles: ['src/a/b.ts'],
        cap: 500,
    });
    assert.ok(Buffer.byteLength(tinyCap, 'utf8') <= 500, `output used ${Buffer.byteLength(tinyCap, 'utf8')} bytes`);
    assert.match(tinyCap, /Pitfalls block capped at 500 bytes/);

    const impossibleCap = selectPitfalls({ patterns, lessons, readDoc: noDocs, affectedFiles: ['src/a/b.ts'], cap: 40 });
    assert.equal(impossibleCap, '');
    assert.ok(Buffer.byteLength(impossibleCap, 'utf8') <= 40);

    const manyTargets = Array.from({ length: 30 }, (_, index) =>
        `| Target ${index} | Rule ${index} | \`src/a/b.ts\` |`,
    ).join('\n');
    const manySections = Array.from({ length: 30 }, (_, index) =>
        `## Rule ${index}\n\n${`RULE_${index}_BODY `.repeat(8)}\n`,
    ).join('\n');
    const demotedHeavy = selectPitfalls({
        patterns: tablePatterns(`| Area | Section | Keys |\n|---|---|---|\n${manyTargets}`, manySections),
        lessons: null,
        readDoc: noDocs,
        affectedFiles: ['src/a/b.ts'],
        cap: 500,
    });
    assert.ok(Buffer.byteLength(demotedHeavy, 'utf8') <= 500);
    assert.match(demotedHeavy, /demoted titles dropped/);
    assert.match(demotedHeavy, /more demoted titles/);
});

void test('AC-10: patterns, lessons, linked docs, and affected files are independent channels', () => {
    assert.equal(selectPitfalls({ patterns: null, lessons: null, readDoc: noDocs, affectedFiles: [] }), '');

    const sectionOnly = tablePatterns(
        '| Area | Section | Keys |\n|---|---|---|\n| Change | Useful section | `src/a/b.ts` |',
        `## Useful section\n\nSection-only body.\n`,
    );
    assert.match(selectPitfalls(matchingInput(sectionOnly)), /## Useful section[\s\S]*Section-only body/);

    const lessonOnly = `# Lessons\n\n### Matching lesson\n\nLesson-only body cites \`src/a/b.ts\`.\n`;
    const lessonOutput = selectPitfalls({ patterns: null, lessons: lessonOnly, readDoc: noDocs, affectedFiles: ['src/a/b.ts'] });
    assert.match(lessonOutput, /### Lessons that cite your files[\s\S]*Lesson-only body/);

    const missingDocPatterns = `## Known Pitfalls\n\n| Read this doc | Before touching |\n|---|---|\n| \`docs/pitfalls/missing.md\` | \`src/a/**\` |\n`;
    const missingOutput = selectPitfalls(matchingInput(missingDocPatterns));
    assert.match(missingOutput, /docs\/pitfalls\/missing\.md/);

    const titleOnlyPatterns = `## Trigger Table\n\n| Area | Section | Keys |\n|---|---|---|\n| Change | Useful section | \`src/z/**\` |\n\n## Useful section\n\nNot selected.\n\n## Known Pitfalls\n\n### Visible title\n\nCites \`src/z/file.ts\`.\n`;
    const titleOnly = selectPitfalls({ ...matchingInput(titleOnlyPatterns, []), affectedFiles: [] });
    assert.match(titleOnly, /### Area index/);
    assert.match(titleOnly, /### Other pitfalls \(titles only\)[\s\S]*- Visible title/);
    assert.doesNotMatch(titleOnly, /Not selected\./);
    assert.doesNotMatch(titleOnly, /### Pitfalls and patterns that cite your files/);
});

void test('unexpected selector failures warn before returning an empty block', () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    const affectedFiles = new Proxy([] as string[], {
        get(target, property, receiver) {
            if (property === 'map') throw new Error('synthetic selector failure');
            return Reflect.get(target, property, receiver) as unknown;
        },
    });
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
    try {
        const output = selectPitfalls({ patterns: null, lessons: null, readDoc: noDocs, affectedFiles });
        assert.equal(output, '');
    } finally {
        console.warn = originalWarn;
    }
    assert.match(warnings.join(' '), /Unable to select relevant pitfalls and lessons: synthetic selector failure/);
});

void test('AC-11: wrapper honors patterns override and docs-root override for lessons and linked docs', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-pitfalls-wrapper-'));
    const tasksRoot = path.join(temporary, 'tasks');
    const docsRoot = path.join(temporary, 'docs-root');
    const taskId = 'pitfalls-wrapper-fixture';
    const specDir = path.join(tasksRoot, taskId);
    const patternsOverride = path.join(temporary, 'patterns-override.md');
    fs.mkdirSync(specDir, { recursive: true });
    fs.mkdirSync(path.join(docsRoot, 'docs', 'pitfalls'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'spec.md'), specWithAffectedFile('src/entry.ts'));
    fs.writeFileSync(patternsOverride, `## Trigger Table\n\n| Area | Section / doc | Key files |\n|---|---|---|\n| Override row | \`docs/pitfalls/x.md\` | \`src/entry.ts\` |\n\n## Known Pitfalls\n\n### Patterns override entry\n\nPATTERNS_OVERRIDE_BODY cites \`src/entry.ts\`.\n`);
    fs.writeFileSync(path.join(docsRoot, 'docs', 'pitfalls', 'x.md'), `# Linked\n\n### Linked override entry\n\nLINKED_OVERRIDE_BODY cites \`src/entry.ts\`.\n`);
    fs.writeFileSync(path.join(docsRoot, 'docs', 'lessons-learned.md'), `# Lessons\n\n### Lesson override entry\n\nLESSONS_OVERRIDE_BODY cites \`src/entry.ts\`.\n`);

    try {
        withEnvironment({
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_PATTERNS_MD_PATH: patternsOverride,
            [PITFALLS_DOCS_ROOT_ENV]: docsRoot,
        }, () => {
            const output = buildRelevantPitfalls([taskId]);
            assert.match(output, /PATTERNS_OVERRIDE_BODY/);
            assert.match(output, /LINKED_OVERRIDE_BODY/);
            assert.match(output, /LESSONS_OVERRIDE_BODY/);
        });
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});

void test('linked pitfall docs cannot escape the docs root through a symlink', context => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-pitfalls-symlink-'));
    const tasksRoot = path.join(temporary, 'tasks');
    const docsRoot = path.join(temporary, 'docs-root');
    const taskId = 'pitfalls-symlink-fixture';
    const taskDir = path.join(tasksRoot, taskId);
    const patternsPath = path.join(temporary, 'patterns.md');
    const externalDoc = path.join(temporary, 'outside.md');
    const linkedPath = path.join(docsRoot, 'docs', 'pitfalls', 'escape.md');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.mkdirSync(path.dirname(linkedPath), { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'spec.md'), specWithAffectedFile('src/entry.ts'));
    fs.writeFileSync(patternsPath, '## Known Pitfalls\n\n| Read this doc | Before touching |\n|---|---|\n| `docs/pitfalls/escape.md` | `src/entry.ts` |\n');
    fs.writeFileSync(externalDoc, '# Outside\n\n### Escaped entry\n\nESCAPED_LINKED_SENTINEL cites `src/entry.ts`.\n');

    try {
        fs.symlinkSync(externalDoc, linkedPath);
    } catch {
        fs.rmSync(temporary, { recursive: true, force: true });
        context.skip('symlink creation is unavailable in this environment');
        return;
    }

    try {
        withEnvironment({
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_PATTERNS_MD_PATH: patternsPath,
            [PITFALLS_DOCS_ROOT_ENV]: docsRoot,
        }, () => {
            const output = buildRelevantPitfalls([taskId]);
            assert.doesNotMatch(output, /ESCAPED_LINKED_SENTINEL/);
            assert.match(output, /`docs\/pitfalls\/escape\.md`/);
        });
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});

void test('AC-13: canon-ai git-path pitfalls and Validation Gate Discipline stay full on the real docs', () => {
    const root = process.cwd();
    const patterns = fs.readFileSync(path.join(root, 'docs/patterns.md'), 'utf8');
    const output = selectPitfalls({ patterns, lessons: null, readDoc: noDocs, affectedFiles: ['src/orchestrator/git.ts'] });
    const fullStart = output.indexOf('### Pitfalls and patterns that cite your files');
    const areaStart = output.indexOf('### Area index');
    const fullBlock = output.slice(fullStart, areaStart);
    assert.match(fullBlock, /### `getAffectedFiles` uses three-dot diff semantics/);
    assert.match(fullBlock, /### Validation Gate Discipline/);
    assert.doesNotMatch(output, /Pitfalls block capped/);
    assert.ok(PITFALLS_BYTE_CAP >= Buffer.byteLength(output, 'utf8'));
    assert.ok(output.includes(PITFALLS_HEADING));

    const lintOutput = selectPitfalls({
        patterns,
        lessons: null,
        readDoc: noDocs,
        affectedFiles: ['src/orchestrator/prompts/templates/implement.md'],
    });
    assert.match(lintOutput, /## Lint & Type Safety Policy[\s\S]*Lint suppression comments/);
    assert.match(lintOutput, /Lint & Type Safety Policy — Lint \/ TS suppression \/ `any` — `src\/orchestrator\/prompts\/templates\/implement\.md` \*\*\(matches this task\)\*\*/);
});
