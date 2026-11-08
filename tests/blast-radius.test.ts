import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    BYTE_CAP,
    CANDIDATE_CAP,
    PER_ENTRY_LIMIT,
    TOKEN_CAP,
    buildBlastRadiusBlock,
    extractSpecTokens,
    gitGrep,
} from '../src/orchestrator/blast-radius.js';

const TASK_ID = 'blast-radius-fixture';

type Fixture = {
    root: string;
    taskIds: string[];
    writeFile(relativePath: string, contents: string): void;
    cleanup(): void;
};

function specMarkdown(input: {
    affected?: string[];
    amendment?: string;
    design?: string;
    ac?: string;
}): string {
    const affected = input.affected ?? [];
    return [
        '# Fixture spec',
        '',
        ...(input.amendment ? ['## Amendment', '', input.amendment, ''] : []),
        '## Design',
        '',
        input.design ?? '',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        ...affected.map(file => `| \`${file}\` | fixture |`),
        '',
        ...(input.ac ? ['## Acceptance Criteria', '', input.ac, ''] : []),
    ].join('\n');
}

function createFixture(input: {
    affected?: string[];
    amendment?: string;
    design?: string;
    ac?: string;
    files?: Record<string, string>;
} = {}): Fixture {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-test-'));
    const tasksRoot = path.join(root, 'tasks');
    const taskDir = path.join(tasksRoot, TASK_ID);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'spec.md'), specMarkdown(input));
    fs.writeFileSync(path.join(taskDir, 'status.json'), JSON.stringify({ id: TASK_ID, worktree: false }));
    for (const [relativePath, contents] of Object.entries(input.files ?? {})) {
        const absolute = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, contents);
    }
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '-A'], { cwd: root });
    const previousTasksRoot = process.env.CANON_TASKS_DIR_OVERRIDE;
    process.env.CANON_TASKS_DIR_OVERRIDE = tasksRoot;

    return {
        root,
        taskIds: [TASK_ID],
        writeFile(relativePath, contents) {
            const absolute = path.join(root, relativePath);
            fs.mkdirSync(path.dirname(absolute), { recursive: true });
            fs.writeFileSync(absolute, contents);
            execFileSync('git', ['add', '-A'], { cwd: root });
        },
        cleanup() {
            if (previousTasksRoot === undefined) delete process.env.CANON_TASKS_DIR_OVERRIDE;
            else process.env.CANON_TASKS_DIR_OVERRIDE = previousTasksRoot;
            fs.rmSync(root, { recursive: true, force: true });
        },
    };
}

function referenceSection(block: string): string {
    const start = block.indexOf('### Files referencing Affected Files');
    if (start < 0) return '';
    const next = block.indexOf('\n### ', start + 1);
    return block.slice(start, next < 0 ? undefined : next);
}

function listedPaths(section: string): string[] {
    return section.split('\n').flatMap(line => {
        const labelEnd = line.indexOf(':');
        if (labelEnd < 0) return [];
        return [...line.slice(labelEnd + 1).matchAll(/`([^`]+)`/g)].map(match => match[1]);
    });
}

function identifierSection(block: string): string {
    const start = block.indexOf('### Files containing spec-named identifiers');
    return start < 0 ? '' : block.slice(start);
}

void test('reference entries find module specifiers and file-name mentions while excluding scope files', () => {
    const fixture = createFixture({
        affected: ['lib/foo.ts', 'lib/bar.ts'],
        files: {
            'lib/foo.ts': 'export const target = true;\n',
            'lib/bar.ts': "import x from './foo.js';\n",
            'lib/a.ts': "import x from './foo.js';\n",
            'app/b.ts': "import x from '../lib/foo';\n",
            'docs/x.md': 'The module is implemented in foo.ts.\n',
            'docs/plain.md': 'foo is a plain word here.\n',
        },
    });
    try {
        const block = buildBlastRadiusBlock(fixture.taskIds, fixture.root);
        const refs = referenceSection(block);
        const paths = listedPaths(refs);
        for (const file of ['lib/a.ts', 'app/b.ts', 'docs/x.md']) assert.ok(paths.includes(file), `${file} should be listed`);
        for (const file of ['docs/plain.md', 'lib/foo.ts', 'lib/bar.ts']) assert.ok(!paths.includes(file), `${file} should not be listed`);
    } finally {
        fixture.cleanup();
    }
});

void test('identifier entries search amendments, calls, and flags while excluding paths, words, and directory entries', () => {
    const fixture = createFixture({
        affected: ['lib/foo.ts', 'vendor/'],
        amendment: 'The amended behavior uses `amendOnlyToken`.',
        design: 'Call `parseWidget()` with `--dry-run`, while `lib/foo.ts` documents `true`; inspect `URLParser`, `JSONValue`, and `HTTPServer` too.',
        files: {
            'lib/foo.ts': 'export function parseWidget() {}\n',
            'src/use.ts': 'parseWidget(x);\n',
            'api/url-parser.ts': 'URLParser(value);\n',
            'api/json-value.ts': 'JSONValue(value);\n',
            'api/http-server.ts': 'HTTPServer(value);\n',
            'docs/cli.md': 'Pass --dry-run to inspect without writing.\n',
            'vendor/w.ts': 'parseWidget(x);\n',
            'docs/am.md': 'amendOnlyToken\n',
            'docs/t.md': 'true\n',
        },
    });
    try {
        const block = buildBlastRadiusBlock(fixture.taskIds, fixture.root);
        const identifiers = identifierSection(block);
        assert.match(identifiers, /`parseWidget`: `src\/use\.ts`/);
        assert.match(identifiers, /`URLParser`: `api\/url-parser\.ts`/);
        assert.match(identifiers, /`JSONValue`: `api\/json-value\.ts`/);
        assert.match(identifiers, /`HTTPServer`: `api\/http-server\.ts`/);
        assert.match(identifiers, /`--dry-run`: `docs\/cli\.md`/);
        assert.match(identifiers, /`amendOnlyToken`: `docs\/am\.md`/);
        assert.doesNotMatch(identifiers, /`vendor\/w\.ts`|`lib\/foo\.ts`|`docs\/t\.md`/);
        assert.doesNotMatch(identifiers, /- `true`:/);

        const extracted = extractSpecTokens([
            '## Amendment', '`olderToken`',
            '## Amendment Round 2', '`newestToken`',
            '## Design', '`parseWidget()` `PascalCase` `snake_case` `URLParser` `JSONValue` `HTTPServer` `Widget` `true` `lib/foo.ts`',
        ].join('\n'));
        assert.deepEqual(extracted.amendment, ['newestToken', 'olderToken']);
        assert.deepEqual(extracted.design, ['parseWidget', 'PascalCase', 'snake_case', 'URLParser', 'JSONValue', 'HTTPServer', 'Widget']);
    } finally {
        fixture.cleanup();
    }
});

void test('task artifacts and linguist-generated files are excluded from results', () => {
    const fixture = createFixture({
        design: 'Use `parseWidget()`.',
        files: {
            '.gitattributes': 'gen/out.js linguist-generated\n',
            'gen/out.js': 'parseWidget(x);\n',
            'src/use.ts': 'parseWidget(x);\n',
        },
    });
    try {
        fixture.writeFile('tasks/other/spec.md', '# parseWidget(x)\n');
        const block = buildBlastRadiusBlock(fixture.taskIds, fixture.root);
        const identifiers = identifierSection(block);
        assert.match(identifiers, /`src\/use\.ts`/);
        assert.doesNotMatch(identifiers, /`gen\/out\.js`|`tasks\/other\/spec\.md`/);
    } finally {
        fixture.cleanup();
    }
});

void test('each identifier entry is capped and reports the omitted file count', () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 12; index += 1) files[`hits/file-${index}.ts`] = 'manyHits\n';
    const fixture = createFixture({ design: '`manyHits`', files });
    try {
        const block = buildBlastRadiusBlock(fixture.taskIds, fixture.root);
        const entry = identifierSection(block).split('\n').find(line => line.startsWith('- `manyHits`:')) ?? '';
        assert.equal((entry.match(/`hits\/file-/g) ?? []).length, PER_ENTRY_LIMIT);
        assert.match(entry, /\+2 more/);
    } finally {
        fixture.cleanup();
    }
});

void test('amendment identifiers take priority over the token cap', () => {
    const tokens = Array.from({ length: 25 }, (_, index) => `designToken${String(index).padStart(2, '0')}`);
    const files: Record<string, string> = { 'src/amended.ts': 'lateAmendToken\n' };
    for (const [index, token] of tokens.entries()) files[`src/design-${String(index).padStart(2, '0')}.ts`] = `${token}\n`;
    const fixture = createFixture({
        amendment: '`lateAmendToken`',
        design: tokens.map(token => `\`${token}\``).join(' '),
        files,
    });
    try {
        const block = buildBlastRadiusBlock(fixture.taskIds, fixture.root);
        const lines = identifierSection(block).split('\n').filter(line => line.startsWith('- `'));
        assert.ok(lines.some(line => line.startsWith('- `lateAmendToken`:')));
        assert.equal(lines.length, TOKEN_CAP);
        assert.ok(!lines.some(line => line.startsWith('- `designToken19`:')));
    } finally {
        fixture.cleanup();
    }
});

void test('the whole map stays within its byte cap and reports truncated entries', () => {
    const tokens = Array.from({ length: 20 }, (_, index) => `longToken${String(index).padStart(2, '0')}`);
    const files: Record<string, string> = {};
    for (const token of tokens) {
        for (let index = 0; index < 10; index += 1) {
            files[`deep/nested/directory/structure/${token}-file-${String(index).padStart(2, '0')}-padding.ts`] = `${token}\n`;
        }
    }
    const fixture = createFixture({ design: tokens.map(token => `\`${token}\``).join(' '), files });
    try {
        const block = buildBlastRadiusBlock(fixture.taskIds, fixture.root);
        assert.ok(Buffer.byteLength(block) <= BYTE_CAP);
        const keptEntries = identifierSection(block).split('\n').filter(line => line.startsWith('- `longToken'));
        const truncation = block.match(/- … (\d+) more entries omitted to stay under the size limit\./);
        assert.ok(keptEntries.length > 0, 'at least one identifier entry should survive truncation');
        assert.ok(keptEntries.length < tokens.length, 'the oversized fixture should omit some identifier entries');
        assert.ok(truncation);
        assert.equal(Number(truncation[1]), TOKEN_CAP - keptEntries.length);
    } finally {
        fixture.cleanup();
    }
});

void test('empty maps, non-git roots, missing roots, and git failures fail open', () => {
    const fixture = createFixture();
    const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-non-git-'));
    try {
        assert.equal(buildBlastRadiusBlock(fixture.taskIds, fixture.root), '');
        assert.equal(buildBlastRadiusBlock(fixture.taskIds, nonGit), '');
        assert.equal(buildBlastRadiusBlock(fixture.taskIds, path.join(nonGit, 'missing')), '');

        fixture.writeFile(`tasks/${TASK_ID}/spec.md`, specMarkdown({
            affected: ['lib/foo.ts'],
            design: 'Call `parseWidget()`.',
        }));
        fixture.writeFile('lib/foo.ts', 'export const foo = 1;\n');
        fixture.writeFile('refs/caller.ts', "import { foo } from '../lib/foo.js';\nparseWidget(foo);\n");

        const priorPath = process.env.PATH;
        const priorFailureCommand = process.env.CANON_BLAST_RADIUS_TEST_GIT_ARGS;
        const realGit = (priorPath ?? '').split(path.delimiter).map(directory => path.join(directory, 'git'))
            .find(candidate => fs.existsSync(candidate));
        assert.ok(realGit, 'the test process must be able to resolve git');
        const failingGit = path.join(nonGit, 'git');
        fs.writeFileSync(failingGit, [
            '#!/usr/bin/env node',
            "const { spawnSync } = require('node:child_process');",
            'const [realGit, failCommand] = process.env.CANON_BLAST_RADIUS_TEST_GIT_ARGS.split("\\n");',
            'if (process.argv[2] === failCommand) { process.stderr.write("simulated git failure\\n"); process.exit(2); }',
            'const result = spawnSync(realGit, process.argv.slice(2), { encoding: "utf8" });',
            'if (result.stdout) process.stdout.write(result.stdout);',
            'if (result.stderr) process.stderr.write(result.stderr);',
            'process.exit(result.status ?? 2);',
            '',
        ].join('\n'), { mode: 0o755 });
        process.env.PATH = `${nonGit}${path.delimiter}${priorPath ?? ''}`;
        try {
            for (const command of ['grep', 'check-attr']) {
                process.env.CANON_BLAST_RADIUS_TEST_GIT_ARGS = `${realGit}\n${command}`;
                assert.doesNotThrow(() => buildBlastRadiusBlock(fixture.taskIds, fixture.root));
                assert.equal(buildBlastRadiusBlock(fixture.taskIds, fixture.root), '');
            }
        } finally {
            if (priorPath === undefined) delete process.env.PATH;
            else process.env.PATH = priorPath;
            if (priorFailureCommand === undefined) delete process.env.CANON_BLAST_RADIUS_TEST_GIT_ARGS;
            else process.env.CANON_BLAST_RADIUS_TEST_GIT_ARGS = priorFailureCommand;
        }
    } finally {
        fixture.cleanup();
        fs.rmSync(nonGit, { recursive: true, force: true });
    }
});

void test('the explicit root controls which tracked files appear in the map', () => {
    const fixture = createFixture({
        affected: ['lib/foo.ts'],
        files: { 'lib/foo.ts': 'export const foo = 1;\n' },
    });
    const repoA = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-root-a-'));
    const repoB = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-root-b-'));
    try {
        for (const root of [repoA, repoB]) {
            execFileSync('git', ['init', '-q'], { cwd: root });
            fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
            fs.writeFileSync(path.join(root, 'lib/foo.ts'), 'export const foo = 1;\n');
        }
        fs.writeFileSync(path.join(repoB, 'caller.ts'), "import x from './foo.js';\n");
        execFileSync('git', ['add', '-A'], { cwd: repoA });
        execFileSync('git', ['add', '-A'], { cwd: repoB });
        assert.match(buildBlastRadiusBlock(fixture.taskIds, repoB), /`caller\.ts`/);
        assert.equal(buildBlastRadiusBlock(fixture.taskIds, repoA), '');
    } finally {
        fixture.cleanup();
        fs.rmSync(repoA, { recursive: true, force: true });
        fs.rmSync(repoB, { recursive: true, force: true });
    }
});

void test('blast-radius framing strings are adopter-neutral and role-neutral', () => {
    const tokens = Array.from({ length: 20 }, (_, index) => `longToken${String(index).padStart(2, '0')}`);
    const files: Record<string, string> = {
        'lib/widget.ts': 'export const widget = true;\n',
        'refs/caller.ts': "import widget from '../lib/widget.js';\n",
    };
    for (const token of tokens) {
        for (let index = 0; index < 10; index += 1) {
            files[`deep/nested/directory/structure/${token}-file-${String(index).padStart(2, '0')}-padding.ts`] = `${token}\n`;
        }
    }
    const fixture = createFixture({
        affected: ['lib/widget.ts'],
        design: tokens.map(token => `\`${token}\``).join(' '),
        files,
    });
    try {
        const block = buildBlastRadiusBlock(fixture.taskIds, fixture.root);
        assert.ok(block.length > 0);
        assert.match(block, /### Files referencing Affected Files/);
        assert.match(block, /### Files containing spec-named identifiers/);
        assert.match(block, /- … \d+ more entries omitted to stay under the size limit\./);
        assert.match(block, /`refs\/caller\.ts`/);
        assert.doesNotMatch(block, /src\/|scripts\/|tests\/|templates\/|Codex|Claude/);
    } finally {
        fixture.cleanup();
    }
});

void test('a grep whose file list overflows the buffer drops only that entry', () => {
    const files: Record<string, string> = { 'lib/other.ts': 'rareToken\n' };
    for (let index = 0; index < 50; index += 1) files[`common/file-${String(index).padStart(2, '0')}.ts`] = 'commonToken\n';
    const fixture = createFixture({ files });
    try {
        assert.deepEqual(gitGrep(fixture.root, ['-F', '-w'], 'commonToken', 64), []);
        assert.deepEqual(gitGrep(fixture.root, ['-F', '-w'], 'rareToken', 64), ['lib/other.ts']);
        assert.equal(gitGrep(fixture.root, ['-F', '-w'], 'commonToken').length, 50);
    } finally {
        fixture.cleanup();
    }
});

void test('entries past the candidate cap count toward the remainder without an attribute check', () => {
    const files: Record<string, string> = { '.gitattributes': 'gen/** linguist-generated\n', 'src/use.ts': 'manyToken\n' };
    for (let index = 0; index < 5; index += 1) files[`gen/out-${index}.js`] = 'manyToken\n';
    for (let index = 0; index < CANDIDATE_CAP + 3; index += 1) files[`z/file-${String(index).padStart(4, '0')}.ts`] = 'manyToken\n';
    const fixture = createFixture({ design: '`manyToken`', files });
    try {
        const block = buildBlastRadiusBlock(fixture.taskIds, fixture.root);
        // 5 generated paths are dropped; the 3 paths past the cap are counted, not checked.
        const remaining = 1 + CANDIDATE_CAP + 3 - PER_ENTRY_LIMIT;
        assert.match(block, new RegExp(`\`manyToken\`: \`src/use\\.ts\`, .*\\+${remaining} more$`, 'm'));
        assert.doesNotMatch(block, /gen\/out-/);
    } finally {
        fixture.cleanup();
    }
});
