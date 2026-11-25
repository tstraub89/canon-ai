import test from 'node:test';
import { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lookupPRByBranch, readPR, mergePR, readAllowedMergeMethods, parseAllowedMergeMethods, createDraftPR, commitSubjectsBody, parseRemoteHost, setGhRunnerForTest, setGitLogRunnerForTest, setOriginUrlReaderForTest } from '../src/orchestrator/forge.js';
import type { CommandResult } from '../src/orchestrator/types.js';

function result(stdout: string, ok = true, stderr = ''): CommandResult { return { ok, stdout, stderr }; }

beforeEach(() => setOriginUrlReaderForTest(() => result('', false, 'no origin')));
afterEach(() => {
    setGhRunnerForTest(null);
    setGitLogRunnerForTest(null);
    setOriginUrlReaderForTest(null);
});

void test('forge lists every REST page and filters an exact head and base', () => {
    const calls: string[][] = [];
    setGhRunnerForTest(argv => { calls.push(argv); return result('{"number":1,"state":"open","head":{"ref":"task/foo-extra"},"base":{"ref":"main"}}\n{"number":2,"state":"open","head":{"ref":"task/foo"},"base":{"ref":"main"}}'); });
    try {
        assert.deepEqual(lookupPRByBranch('task/foo', 'main', 'open'), { kind: 'found', number: 2 });
        assert.deepEqual(calls[0], ['api', '-X', 'GET', '--paginate', '--jq', '.[]', 'repos/{owner}/{repo}/pulls?state=open&head={owner}:task/foo&base=main&per_page=100']);
    } finally { setGhRunnerForTest(null); }
});

void test('forge listing distinguishes unreadable, malformed and empty responses', () => {
    setGhRunnerForTest(() => result('', false, 'offline'));
    assert.deepEqual(lookupPRByBranch('task/x', null, 'open'), { kind: 'unreadable', reason: 'offline' });
    setGhRunnerForTest(() => result('not json'));
    assert.equal(lookupPRByBranch('task/x', null, 'open').kind, 'unreadable');
    setGhRunnerForTest(() => result('[]'));
    assert.equal(lookupPRByBranch('task/x', null, 'open').kind, 'unreadable');
    setGhRunnerForTest(() => result(''));
    assert.deepEqual(lookupPRByBranch('task/x', null, 'open'), { kind: 'none' });
    setGhRunnerForTest(null);
});

void test('forge PR state mapping requires merged_at on a closed PR', () => {
    const states = ['open', 'closed', 'closed'];
    const merged = [null, null, '2026-01-01T00:00:00Z'];
    const calls: string[][] = [];
    setGhRunnerForTest(argv => {
        calls.push(argv);
        return result(JSON.stringify({ state: states.shift(), merged_at: merged.shift(), head: { sha: 'a'.repeat(40) }, base: { ref: 'main' }, html_url: 'https://example.test/pull/1' }));
    });
    try {
        const open = readPR(1);
        assert.equal(open.ok ? open.pr.state : null, 'OPEN');
        const closed = readPR(1);
        assert.equal(closed.ok ? closed.pr.state : null, 'CLOSED');
        const pr = readPR(1);
        assert.equal(pr.ok && pr.pr.state, 'MERGED');
        assert.deepEqual(pr.ok && pr.pr, { state: 'MERGED', headSha: 'a'.repeat(40), baseRef: 'main', url: 'https://example.test/pull/1' });
        assert.deepEqual(calls, Array.from({ length: 3 }, () => ['api', '-X', 'GET', 'repos/{owner}/{repo}/pulls/1']));
    } finally { setGhRunnerForTest(null); }
});

void test('forge pins REST merge method and repository merge fields', () => {
    const calls: string[][] = [];
    setGhRunnerForTest(argv => { calls.push(argv); return result('{"allow_squash_merge":true,"allow_rebase_merge":false,"allow_merge_commit":true}'); });
    try {
        assert.deepEqual(readAllowedMergeMethods(), { ok: true, allowed: { squash: true, rebase: false, merge: true } });
        mergePR(12, 'rebase');
        assert.deepEqual(calls, [
            ['api', '-X', 'GET', 'repos/{owner}/{repo}'],
            ['api', '-X', 'PUT', 'repos/{owner}/{repo}/pulls/12/merge', '-f', 'merge_method=rebase'],
        ]);
        assert.deepEqual(parseAllowedMergeMethods('{"allow_squash_merge":true}'), { ok: false });
    } finally { setGhRunnerForTest(null); }
});

void test('forge draft PR create sends a typed REST payload and returns the API URL', () => {
    let argv: string[] = [];
    let payload: unknown;
    setGhRunnerForTest(args => { argv = args; payload = JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')); return result('{"number":14,"html_url":"https://example.test/pull/14"}'); });
    try {
        const created = createDraftPR({ base: 'main', head: 'task/x', title: 'Task title', body: '- first commit' });
        assert.deepEqual(created, { ok: true, number: 14, url: 'https://example.test/pull/14' });
        assert.deepEqual(argv.slice(0, 4), ['api', '-X', 'POST', 'repos/{owner}/{repo}/pulls']);
        assert.equal(argv[4], '--input');
        assert.deepEqual(payload, { base: 'main', head: 'task/x', title: 'Task title', body: '- first commit', draft: true });
    } finally { setGhRunnerForTest(null); }
});

void test('commit-subject body fallback lists origin/base..branch and pins the body text', () => {
    let args: string[] = [];
    setGitLogRunnerForTest((...next) => { args = next; return result('first change\nsecond change\n'); });
    try {
        assert.deepEqual(commitSubjectsBody('task/example', 'main'), { ok: true, body: '- first change\n- second change' });
        assert.deepEqual(args, ['log', '--reverse', '--format=%s', 'origin/main..task/example']);
    } finally { setGitLogRunnerForTest(null); }
});

void test('parseRemoteHost accepts supported remote URL forms and rejects local paths', async t => {
    for (const [url, expected] of [
        ['HTTPS://GHE.Example/o/r', 'ghe.example'],
        ['http://user:pw@h:8080/o/r', 'h'],
        ['ssh://git@ghe.example:2222/o/r', 'ghe.example'],
        ['git@GHE.Example:o/r.git', 'ghe.example'],
        ['', null], ['  ', null], ['file:///tmp/origin.git', null], ['/abs/path', null], ['rel/path', null],
    ] as const) await t.test(url || 'empty URL', () => assert.equal(parseRemoteHost(url), expected, url));
});

void test('forge passes the parsed origin host to every REST call', async t => {
    const cases = [
        ['https://github.com/o/r.git', 'github.com'],
        ['git@ghe.example:o/r.git', 'ghe.example'],
        ['ssh://git@ghe.example:2222/o/r', 'ghe.example'],
        ['/tmp/local/origin.git', null],
    ] as const;
    for (const [origin, expectedHost] of cases) await t.test(origin, () => {
        const calls: string[][] = [];
        setOriginUrlReaderForTest(() => result(origin));
        setGhRunnerForTest(argv => {
            calls.push(argv);
            if (argv.includes('/pulls?')) return result('[[]]');
            if (argv.includes('/pulls/7')) return result('{"state":"open","head":{"sha":"abc"},"base":{"ref":"main"}}');
            if (argv.includes('/merge')) return result('{}');
            if (argv.at(-1) === 'repos/{owner}/{repo}') return result('{"allow_squash_merge":true,"allow_rebase_merge":true,"allow_merge_commit":true}');
            return result('{"number":7,"html_url":"https://example.test/pull/7"}');
        });
        lookupPRByBranch('task/x', 'main', 'open');
        readPR(7);
        mergePR(7, 'squash');
        readAllowedMergeMethods();
        createDraftPR({ base: 'main', head: 'task/x', title: 'Task', body: 'Body' });
        assert.equal(calls.length, 5);
        if (expectedHost) {
            assert.ok(calls.every(argv => argv[0] === 'api' && argv[1] === '--hostname' && argv[2] === expectedHost), origin);
        } else {
            assert.ok(calls.every(argv => argv[0] === 'api' && argv[1] !== '--hostname'), origin);
        }
        if (origin.startsWith('git@')) {
            assert.deepEqual(calls[1], ['api', '--hostname', 'ghe.example', '-X', 'GET', 'repos/{owner}/{repo}/pulls/7']);
        }
    });
});

