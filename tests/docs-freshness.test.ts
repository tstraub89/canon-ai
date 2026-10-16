import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_PROTECTED_DOCS, loadDocsFreshnessConfig, matchesDocsGlob, parseDocsFreshnessConfig, resolveDocsFreshness, type DocsFreshnessConfig } from '../src/orchestrator/docs-freshness.js';

void test('defaults and replacement protected sets', () => {
    const defaults = resolveDocsFreshness(null, []);
    for (const key of ['protected', 'admitted', 'configured', 'promptEditable'] as const) {
        assert.deepEqual(defaults[key], DEFAULT_PROTECTED_DOCS);
        assert.ok(!defaults[key].includes('docs/pipeline-orchestrator.md'));
    }
    assert.deepEqual(defaults.promptFlagged, []);
    assert.deepEqual(resolveDocsFreshness({ protected: [] }, []).configured, []);
    assert.deepEqual(resolveDocsFreshness({ protected: ['custom.md'] }, []).protected, ['custom.md']);
});

const mappedConfig: DocsFreshnessConfig = {
    protected: ['protected.md', 'flag-protected.md'],
    paths: { 'api/**': ['mapped.md', 'flag-mapped.md'], '**/*.ts': ['mapped.md'] },
    flagOnly: ['flag-protected.md', 'flag-mapped.md', 'flag-neither.md'],
};
for (const [name, diff, editable, flagged] of [
    ['match', ['api/index.ts'], ['protected.md', 'mapped.md'], ['flag-protected.md', 'flag-mapped.md']],
    ['no match', ['README.md'], ['protected.md'], ['flag-protected.md']],
    ['dot directory', ['api/.internal/x.ts'], ['protected.md', 'mapped.md'], ['flag-protected.md', 'flag-mapped.md']],
    ['boundary', ['apix/x.js'], ['protected.md'], ['flag-protected.md']],
    ['excluded tasks and telemetry', ['tasks/x/spec.md', 'docs/lessons-learned.md'], ['protected.md'], ['flag-protected.md']],
    ['failed diff', null, ['protected.md'], ['flag-protected.md']],
] as const) {
    void test(`resolver: ${name}`, () => {
        const result = resolveDocsFreshness(mappedConfig, diff);
        assert.deepEqual(result.admitted, ['protected.md', 'mapped.md']);
        assert.deepEqual(result.configured, ['protected.md', 'flag-protected.md', 'mapped.md', 'flag-mapped.md', 'flag-neither.md']);
        assert.deepEqual(result.promptEditable, editable);
        assert.deepEqual(result.promptFlagged, flagged);
        assert.deepEqual(result.unevaluatedMappedDocs, diff === null ? ['mapped.md', 'flag-mapped.md'] : []);
    });
}
void test('everything glob matches dot-only diff and excludes pipeline paths before matching', () => {
    const config = { protected: [], paths: { '**': ['all.md'] } };
    for (const file of ['.github/workflows/ci.yml', '.claude/skills/x/SKILL.md', '.env.example']) {
        assert.deepEqual(resolveDocsFreshness(config, [file]).promptEditable, ['all.md']);
    }
    for (const file of ['tasks/t/spec.md', 'docs/lessons-learned.md', 'docs/task-quality-log.md', 'docs/pipeline-invocations.md']) {
        assert.deepEqual(resolveDocsFreshness(config, [file]).promptEditable, []);
    }
});
for (const [glob, file, matches] of [
    ['src/**/*.{ts,tsx}', 'src/index.ts', true],
    ['src/**/*.{ts,tsx}', 'src/.internal/a.tsx', true],
    ['src/**/*.{ts,tsx}', 'src/a.js', false],
    ['docs/*.md', 'docs/sub/x.md', false],
    ['docs/?.md', 'docs/x.md', true],
    ['docs/?.md', 'docs/xx.md', false],
    ['a[1].md', 'a[1].md', true],
] as const) void test(`glob ${glob} against ${file}`, () => assert.equal(matchesDocsGlob(glob, file), matches));

for (const [value, problem] of [
    ['{', /not valid JSON/], ['null', /top level/], ['[]', /top level/],
    ['{"docs_freshness":[]}', /docs_freshness.*must be an object/],
    ['{"docs_freshness":{"protected":"docs/x.md"}}', /protected.*array/],
    ['{"docs_freshness":{"flag_only":[""]}}', /flag_only.*array/],
    ['{"docs_freshness":{"protected":[42]}}', /protected.*array/],
    ['{"docs_freshness":{"paths":[]}}', /paths.*object/],
    ['{"docs_freshness":{"paths":{"api/**":"docs/x.md"}}}', /paths\["api\/\*\*"\].*array/],
    ...['/docs/x.md', 'C:\\docs\\x.md', 'docs/../x.md', 'docs/*.md', 'docs/x?.md', 'docs/[x].md', 'docs/{x,y}.md'].map(doc => [JSON.stringify({ docs_freshness: { protected: [doc] } }), new RegExp(doc.includes('..') || doc.includes(':') || doc.startsWith('/') ? 'repo-relative' : 'glob characters')] as const),
    ...['', '/api/**', './api/**', 'api/../**'].map(glob => [JSON.stringify({ docs_freshness: { paths: { [glob]: [] } } }), /paths key/] as const),
    ...['protected', 'flag_only', 'paths'].map(key => [JSON.stringify({ docs_freshness: { [key]: key === 'paths' ? { '**': ['docs/lessons-learned.md'] } : ['docs/lessons-learned.md'] } }), /docs\/lessons-learned.md.*telemetry/] as const),
    [JSON.stringify({ docs_freshness: { protected: ['tasks/x/spec.md'] } }), /tasks\/x\/spec.md.*task artifact/],
    [JSON.stringify({ docs_freshness: { flag_only: ['./docs/lessons-learned.md'] } }), /telemetry/],
    ...[':doc.md', ':(exclude)doc.md'].map(doc => [JSON.stringify({ docs_freshness: { flag_only: [doc] } }), /must not start with ":"/] as const),
    ...['docs/', '.', './', 'docs\\', 'docs/.', 'docs\\.'].map(doc => [JSON.stringify({ docs_freshness: { paths: { '**': [doc] } } }), /not a directory/] as const),
] as const) {
    void test(`invalid config ${value}`, () => {
        const loaded = parseDocsFreshnessConfig(value);
        assert.equal(loaded.ok, false);
        if (loaded.ok) return;
        assert.match(loaded.message, /\.canon\/config\.json/);
        assert.match(loaded.message, problem);
    });
}
void test('empty config and unknown-only config resolve defaults and return warnings', () => {
    for (const raw of ['{}', '{"docs_freshness":{}}', '{"docsFreshness":{}}']) {
        const loaded = parseDocsFreshnessConfig(raw);
        assert.ok(loaded.ok);
        assert.deepEqual(resolveDocsFreshness(loaded.config, []).protected, DEFAULT_PROTECTED_DOCS);
    }
    const unknown = parseDocsFreshnessConfig('{"docsFreshness":{},"docs_freshness":{"protected_docs":[]}}');
    assert.ok(unknown.ok);
    assert.deepEqual(unknown.unknownKeys, ['docsFreshness', 'docs_freshness.protected_docs']);
});
void test('loader distinguishes absent file, unreadable config, and a later invalid edit', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-freshness-'));
    try {
        assert.deepEqual(loadDocsFreshnessConfig(root), { ok: true, source: 'defaults', config: null, unknownKeys: [] });
        fs.mkdirSync(path.join(root, '.canon/config.json'), { recursive: true });
        assert.equal(loadDocsFreshnessConfig(root).ok, false);
        fs.rmdirSync(path.join(root, '.canon/config.json'));
        fs.writeFileSync(path.join(root, '.canon/config.json'), '{}');
        assert.equal(loadDocsFreshnessConfig(root).ok, true);
        fs.writeFileSync(path.join(root, '.canon/config.json'), '{');
        assert.equal(loadDocsFreshnessConfig(root).ok, false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

void test('equivalent doc path spellings are normalized before set subtraction', () => {
    const loaded = parseDocsFreshnessConfig(JSON.stringify({ docs_freshness: {
        protected: ['./docs/reference.md', 'docs//reference.md'], flag_only: ['docs/reference.md'],
    } }));
    assert.ok(loaded.ok);
    const sets = resolveDocsFreshness(loaded.config, []);
    assert.deepEqual(sets.configured, ['docs/reference.md']);
    assert.deepEqual(sets.admitted, []);
    assert.deepEqual(sets.promptFlagged, ['docs/reference.md']);
});

void test('repeated stars in one segment stay bounded on a nonmatching name', () => {
    const glob = 'docs/' + '*'.repeat(10) + 'x.md';
    const started = Date.now();
    assert.equal(matchesDocsGlob(glob, 'docs/' + 'a'.repeat(26) + '.md'), false);
    assert.ok(Date.now() - started < 1000);
    assert.equal(matchesDocsGlob(glob, 'docs/abcx.md'), true);
    assert.equal(matchesDocsGlob('a**b', 'axyzb'), true);
    const runs = '*a'.repeat(30) + 'b';
    const runsStarted = Date.now();
    assert.equal(matchesDocsGlob(runs, 'a'.repeat(200)), false);
    assert.ok(Date.now() - runsStarted < 1000);
    assert.equal(matchesDocsGlob(runs, 'a'.repeat(40) + 'b'), true);
});

void test('consecutive globstars stay bounded on a deep nonmatching path', () => {
    const moduleUrl = new URL('../src/orchestrator/docs-freshness.ts', import.meta.url).href;
    const result = spawnSync(process.execPath, [
        '--import', path.join(process.cwd(), 'node_modules/tsx/dist/loader.mjs'),
        '--input-type=module', '-e',
        `import { matchesDocsGlob } from ${JSON.stringify(moduleUrl)};
        const glob = '**/'.repeat(30) + 'target.md';
        const prefix = 'deep/'.repeat(30);
        console.log(JSON.stringify([
            matchesDocsGlob(glob, prefix + 'other.md'),
            matchesDocsGlob(glob, prefix + 'target.md'),
        ]));`,
    ], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '[false,true]');
});
