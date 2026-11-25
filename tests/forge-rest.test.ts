import test from 'node:test';
import { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lookupPRByBranch, readPR, mergePR, readAllowedMergeMethods, parseAllowedMergeMethods, createDraftPR, commitSubjectsBody, parseRemoteHost, setGhRunnerForTest, setGitLogRunnerForTest, setOriginUrlReaderForTest } from '../src/orchestrator/forge.js';
import type { CommandResult } from '../src/orchestrator/types.js';

function result(stdout: string, ok = true, stderr = ''): CommandResult { return { ok, stdout, stderr }; }

const FAKE_TOKEN = 'gho_FAKE_TOKEN_SHOULD_NOT_LEAK';

function stubGh(authHosts: string[], apiOk = true): { apiCalls: string[][]; authCalls: string[][] } {
    const apiCalls: string[][] = [];
    const authCalls: string[][] = [];
    setGhRunnerForTest(argv => {
        if (argv[0] === 'auth') {
            authCalls.push(argv);
            return authHosts.includes(argv[3] ?? '') ? result(FAKE_TOKEN) : result('', false, 'not logged in');
        }
        apiCalls.push(argv);
        if (!apiOk) return result('', false, 'HTTP 502');
        const endpoint = argv.at(-1) ?? '';
        if (endpoint.includes('/pulls?')) return result('{"number":7,"state":"open","head":{"ref":"task/x"},"base":{"ref":"main"}}');
        if (endpoint.endsWith('/pulls/7')) return result('{"state":"open","head":{"sha":"abc"},"base":{"ref":"main"}}');
        if (endpoint === 'repos/{owner}/{repo}') return result('{"allow_squash_merge":true,"allow_rebase_merge":true,"allow_merge_commit":true}');
        if (endpoint.endsWith('/merge')) return result('{}');
        return result('{"number":7,"html_url":"https://example.test/pull/7"}');
    });
    return { apiCalls, authCalls };
}

function exerciseForgeCalls(): void {
    lookupPRByBranch('task/x', 'main', 'open');
    readPR(7);
    mergePR(7, 'squash');
    readAllowedMergeMethods();
    createDraftPR({ base: 'main', head: 'task/x', title: 'Task', body: 'Body' });
}

beforeEach(() => setOriginUrlReaderForTest(() => result('', false, 'no origin')));
afterEach(() => {
    setGhRunnerForTest(null);
    setGitLogRunnerForTest(null);
    setOriginUrlReaderForTest(null);
});

void test('forge parses paginated NDJSON and filters the exact head and base', () => {
    const calls: string[][] = [];
    setGhRunnerForTest(argv => { calls.push(argv); return result('{"number":1,"state":"open","head":{"ref":"task/foo-extra"},"base":{"ref":"main"}}\n{"number":2,"state":"open","head":{"ref":"task/foo"},"base":{"ref":"main"}}'); });
    try {
        assert.deepEqual(lookupPRByBranch('task/foo', 'main', 'open'), { kind: 'found', number: 2 });
        assert.deepEqual(calls[0], ['api', '-X', 'GET', '--paginate', '--jq', '.[]', 'repos/{owner}/{repo}/pulls?state=open&head={owner}%3Atask/foo&base=main&per_page=100']);
    } finally { setGhRunnerForTest(null); }
});

void test('forge encodes the head separator so gh cannot expand branch-name placeholder words', () => {
    const calls: string[][] = [];
    setGhRunnerForTest(argv => {
        calls.push(argv);
        return result('{"number":9,"state":"open","head":{"ref":"repo-x"},"base":{"ref":"main"}}');
    });
    try {
        assert.deepEqual(lookupPRByBranch('repo-x', 'main', 'open'), { kind: 'found', number: 9 });
        assert.deepEqual(calls[0], ['api', '-X', 'GET', '--paginate', '--jq', '.[]', 'repos/{owner}/{repo}/pulls?state=open&head={owner}%3Arepo-x&base=main&per_page=100']);
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
        setOriginUrlReaderForTest(() => result(origin));
        const { apiCalls, authCalls } = stubGh(['github.com', 'ghe.example']);
        exerciseForgeCalls();
        assert.equal(apiCalls.length, 5);
        if (expectedHost) {
            assert.ok(apiCalls.every(argv => argv[0] === 'api' && argv[1] === '--hostname' && argv[2] === expectedHost), origin);
            assert.deepEqual(authCalls, [['auth', 'token', '--hostname', expectedHost]]);
        } else {
            assert.ok(apiCalls.every(argv => argv[0] === 'api' && argv[1] !== '--hostname'), origin);
            assert.deepEqual(authCalls, []);
        }
        if (origin.startsWith('git@')) {
            assert.deepEqual(apiCalls[1], ['api', '--hostname', 'ghe.example', '-X', 'GET', 'repos/{owner}/{repo}/pulls/7']);
        }
    });
});

void test('forge gates --hostname on gh auth and normalises github.com subdomains', async t => {
    const cases = [
        ['git@github-work:o/r.git', ['github.com'], null, 'github-work'],
        ['ssh://git@ssh.github.com:443/o/r.git', ['github.com'], 'github.com', 'github.com'],
        ['https://ghe.example/o/r.git', ['ghe.example'], 'ghe.example', 'ghe.example'],
        ['https://ghe.example/o/r.git', [], null, 'ghe.example'],
        ['https://api.github.com/o/r', ['github.com'], 'github.com', 'github.com'],
        ['https://notgithub.com/o/r', ['notgithub.com'], 'notgithub.com', 'notgithub.com'],
    ] as const;
    for (const [origin, authHosts, expectedHost, probeHost] of cases) await t.test(origin + ` (${expectedHost ?? 'default'})`, () => {
        setOriginUrlReaderForTest(() => result(origin));
        const { apiCalls, authCalls } = stubGh([...authHosts]);
        exerciseForgeCalls();
        assert.equal(apiCalls.length, 5);
        for (const argv of apiCalls) {
            if (expectedHost) assert.deepEqual(argv.slice(0, 3), ['api', '--hostname', expectedHost], origin);
            else assert.ok(argv[0] === 'api' && !argv.includes('--hostname'), origin);
        }
        assert.deepEqual(authCalls, [['auth', 'token', '--hostname', probeHost]]);
        if (origin.includes('ssh.github.com')) {
            assert.deepEqual(apiCalls[1], ['api', '--hostname', 'github.com', '-X', 'GET', 'repos/{owner}/{repo}/pulls/7']);
        }
    });
});

void test('forge host probe never exposes the auth token in results or output', t => {
    setOriginUrlReaderForTest(() => result('https://ghe.example/o/r.git'));
    const { apiCalls, authCalls } = stubGh(['ghe.example'], false);
    let consoleOutput = '';
    const captures = ['log', 'warn', 'error'].map(method => t.mock.method(console, method as 'log' | 'warn' | 'error', (...args: unknown[]) => { consoleOutput += args.join(' '); }));
    const lookup = lookupPRByBranch('task/x', 'main', 'open');
    const read = readPR(7);
    const merge = mergePR(7, 'squash');
    const settings = readAllowedMergeMethods();
    const created = createDraftPR({ base: 'main', head: 'task/x', title: 'Task', body: 'Body' });
    const exposed = JSON.stringify({ apiCalls, lookup, read, merge, settings, created, consoleOutput });
    assert.deepEqual(authCalls, [['auth', 'token', '--hostname', 'ghe.example']]);
    assert.equal(exposed.includes(FAKE_TOKEN), false);
    for (const capture of captures) capture.mock.restore();
});

