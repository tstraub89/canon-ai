import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { makeBootstrappedTaskWorktreeFixture, runNodeInline, withTempDir, writeReviewLoopFixture, runReviewLoopMain } from './run-task-safety-helpers.js';
import { prepareShipFixture, prepareSharedWorktreeShipFixture, runCanon, setupFakeTools, writeRel, makeGitFixture } from './run-task-ship-helpers.js';

const policyHref = pathToFileURL(path.resolve('src/orchestrator/policy.ts')).href;
const backendHref = pathToFileURL(path.resolve('src/orchestrator/agents/codex.ts')).href;
const docsHref = pathToFileURL(path.resolve('src/orchestrator/docs-freshness.ts')).href;
const cleanEnv = { ...process.env, CODEX_MODEL_MINI: undefined, CODEX_MODEL_DEFAULT: undefined, CODEX_MODEL_FULL: undefined, CODEX_MODEL_DELICATE: undefined };

void test('worktree implement resolution uses main policy, rereads edits and ignores invalid worktree section', () => {
    withTempDir('codex-root-', dir => {
        const taskId = 'codex-root';
        const { localDir, worktreeDir } = makeBootstrappedTaskWorktreeFixture(dir, taskId);
        writeRel(localDir, '.canon/config.json', JSON.stringify({ codex: { models: { mini: 'main-mini' }, implement_effort: { M: 'minimal' } } }));
        writeRel(worktreeDir, '.canon/config.json', JSON.stringify({ codex: { models: { mini: 'worktree-mini' }, implement_effort: { M: 'max' } } }));
        const result = runNodeInline(`
            import fs from 'node:fs';
            import { codexBackend } from ${JSON.stringify(backendHref)};
            import { loadDocsFreshnessConfig, requireDocsFreshnessConfig } from ${JSON.stringify(docsHref)};
            const tasks = [{ status: { task_size: 'M', worktree: true } }];
            console.log(JSON.stringify(codexBackend.resolveConfig('implement', tasks)));
            fs.writeFileSync(${JSON.stringify(path.join(localDir, '.canon/config.json'))}, JSON.stringify({ codex: { models: { mini: 'edited-mini' }, implement_effort: { M: 'low' } } }));
            fs.writeFileSync('.canon/config.json', JSON.stringify({ codex: { models: false, implement_effort: { XXL: 'ultra' } } }));
            console.log(JSON.stringify(codexBackend.resolveConfig('implement', tasks)));
            // Startup uses load; spec, QA and validation use require. Neither descends into codex.
            console.log(JSON.stringify(loadDocsFreshnessConfig(process.cwd())));
            console.log(JSON.stringify(requireDocsFreshnessConfig(process.cwd())));
        `, cleanEnv, worktreeDir);
        assert.equal(result.status, 0, result.stderr);
        const rows = result.stdout.trim().split('\n').map(line => JSON.parse(line) as unknown);
        assert.deepEqual(rows[0], { model: 'main-mini', effort: 'minimal' });
        assert.deepEqual(rows[1], { model: 'edited-mini', effort: 'low' });
        assert.deepEqual(rows[2], { ok: true, source: 'file', config: null, shipMergeMethod: 'squash', unknownKeys: [] });
        assert.equal(rows[3], null);
    });
});

void test('startup dry-run ignores an invalid Codex section in the task worktree', () => {
    withTempDir('codex-worktree-start-', dir => {
        const { localDir, fakeTools } = prepareSharedWorktreeShipFixture(dir, ['codex-a', 'codex-b'], { prNumber: 603 });
        writeRel(localDir, '.canon/config.json', '{"codex":{"models":{"mini":"main-mini"}}}');
        writeRel(path.join(dir, 'worktrees/codex-a'), '.canon/config.json', '{"codex":false}');
        const result = runCanon(localDir, ['codex-a', '--dry-run'], fakeTools, { CANON_WORKTREES_ROOT: path.join(dir, 'worktrees') });
        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(result.stderr, /invalid "codex"|unknown key.*codex/);
    });
});

for (const provider of ['mixed', 'claude'] as const) {
    void test(`invalid main Codex policy stops ${provider} startup before spawn, including dry-run`, () => {
        withTempDir('codex-start-invalid-', dir => {
            const { localDir } = makeGitFixture(dir);
            const bins = path.join(dir, 'fake-tools');
            setupFakeTools(bins);
            const tasksRoot = writeReviewLoopFixture(localDir, 'codex-invalid', 'code_review', 0);
            const statusFile = path.join(tasksRoot, 'codex-invalid/status.json');
            const status = JSON.parse(fs.readFileSync(statusFile, 'utf8')) as Record<string, unknown>;
            status.provider = provider;
            fs.writeFileSync(statusFile, JSON.stringify(status));
            writeRel(localDir, '.canon/config.json', '{"codex":{"implement_effort":{"M":"ultra"}}}');
            const before = fs.readFileSync(statusFile, 'utf8');
            for (const args of [[], ['--dry-run']]) {
                const result = runReviewLoopMain(localDir, tasksRoot, bins, 'codex-invalid', 3, args);
                assert.notEqual(result.status, 0);
                assert.match(result.stderr, /codex\.implement_effort\.M.*"ultra".*none\|minimal\|low\|medium\|high\|xhigh\|max/);
                assert.equal(fs.existsSync(path.join(localDir, 'agent-invocations.log')), false);
                assert.equal(fs.readFileSync(statusFile, 'utf8'), before);
            }
        });
    });
}

void test('mid-run invalid main edit stops only the next Codex lookup', () => {
    withTempDir('codex-midrun-', root => {
        writeRel(root, '.canon/config.json', '{}');
        const result = runNodeInline(`
            import fs from 'node:fs';
            import { getCodexConfig, getClaudeConfig, getNominalSize, getEffectiveSize, getMaxReviewLoops } from ${JSON.stringify(policyHref)};
            const tasks = [{ status: { task_size: 'M' } }];
            getCodexConfig('implement', tasks);
            fs.writeFileSync('.canon/config.json', '{"codex":{"implement_effort":{"M":"ultra"}}}');
            console.log(JSON.stringify({ claude: getClaudeConfig('spec', tasks).effort, size: getNominalSize(tasks), effective: getEffectiveSize(tasks), cap: getMaxReviewLoops(tasks) }));
            getCodexConfig('implement', tasks);
            console.log('UNREACHABLE');
        `, { ...cleanEnv, MAX_REVIEW_LOOPS: undefined }, root);
        assert.notEqual(result.status, 0);
        assert.match(result.stdout, /"claude":"medium","size":"M","effective":"M","cap":3/);
        assert.match(result.stderr, /codex\.implement_effort\.M.*"ultra".*allowed efforts/);
        assert.doesNotMatch(result.stdout, /UNREACHABLE/);
    });
});

void test('Codex unknown keys warn once across startup and repeated resolutions', () => {
    withTempDir('codex-warning-', root => {
        writeRel(root, '.canon/config.json', '{"codex":{"reasoning":"high","models":{"large":"x"}}}');
        const result = runNodeInline(`
            import { requireCodexSection, getCodexConfig } from ${JSON.stringify(policyHref)};
            requireCodexSection();
            for (let n = 0; n < 3; n++) getCodexConfig('implement', [{ status: { task_size: 'M' } }]);
        `, cleanEnv, root);
        assert.equal(result.status, 0, result.stderr);
        assert.equal((result.stderr.match(/unknown key/g) ?? []).length, 1);
        assert.match(result.stderr, /codex.reasoning, codex.models.large/);
    });
});

for (const phase of ['spec_review', 'implement', 'code_review'] as const) {
    void test(`config models reach the ${phase} backend invocation path`, () => {
        withTempDir('codex-routing-', root => {
            writeRel(root, '.canon/config.json', '{"codex":{"models":{"mini":"cfg-mini","full":"cfg-full"}}}');
            const calls = path.join(root, 'calls.jsonl');
            const bins = path.join(root, 'bin');
            fs.mkdirSync(bins);
            fs.writeFileSync(path.join(bins, 'codex'), `#!${process.execPath}
require('node:fs').appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)) + '\\n');
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'review complete'}}));
console.log(JSON.stringify({type:'turn.completed'}));
`, { mode: 0o755 });
            const result = runNodeInline(`
                import { codexBackend } from ${JSON.stringify(backendHref)};
                for (const task_size of ['M', 'XL']) {
                    const tasks = [{ status: { task_size } }];
                    const request = { role: '${phase === 'spec_review' ? 'spec_reviewer' : phase === 'implement' ? 'implementer' : 'cold_reviewer'}', phase: '${phase}', tasks, cwd: process.cwd() };
                    ${phase === 'code_review'
                        ? "await codexBackend.coldReview({ ...request, baseBranch: 'main' });"
                        : "await codexBackend.run({ ...request, prompt: 'test', interactive: false, resumeId: null });"}
                }
            `, { ...cleanEnv, PATH: bins + path.delimiter + (process.env.PATH ?? '') }, root);
            assert.equal(result.status, 0, result.stderr);
            const args = fs.readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]);
            assert.deepEqual(args.map(argv => argv[argv.indexOf('-m') + 1]), ['cfg-mini', 'cfg-full']);
            assert.ok(args.every(argv => argv.includes('model_reasoning_effort=high')));
        });
    });
}

void test('--ship skips invalid main Codex settings and reaches archive', () => {
    withTempDir('codex-ship-exempt-', dir => {
        const { localDir, fakeTools, branch, tip } = prepareShipFixture(dir, ['codex-ship'], {
            initialFiles: { '.canon/config.json': '{"codex":{"implement_effort":{"M":"ultra"}}}' },
        });
        const result = runCanon(localDir, ['codex-ship', '--ship'], fakeTools, {
            FAKE_GH_MERGED_PR_NUMBER: '604', FAKE_GH_PR_HEAD: branch,
            FAKE_GH_PR_BASE: 'main', FAKE_GH_HEAD_REF_OID: tip,
        });
        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(result.stderr, /invalid "codex"|unknown key.*codex/);
        assert.ok(fs.existsSync(path.join(localDir, 'tasks/_archive/codex-ship/status.json')));
    });
});
