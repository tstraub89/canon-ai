import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { METRICS_SKELETON, recordMetric } from '../src/orchestrator/metrics.js';
import { writeQualityLogForTask } from '../src/orchestrator/quality-log.js';
import { applyTelemetryFold, foldLessonsFragment, foldTelemetryFragments, planTelemetryFold, sharedTelemetryDocsTouched } from '../src/orchestrator/telemetry-fold.js';
import { parseTable } from '../src/orchestrator/markdown-table.js';
import { formatMergeFailureMessage, parseAllowedMergeMethods } from '../src/orchestrator/main.js';
import type { StatusJson } from '../src/orchestrator/types.js';
import {
    TSX_LOADER,
    MD_LOADER,
    MAIN_HREF,
    withTempDir,
    gitIn,
    gitRawIn,
    makeGitFixture,
    setupFakeTools,
    setupGitDeleteRace,
    setupGitArchiveFailure,
    runCanon,
    makeStatus,
    makeHumanReviewStatus,
    writeTaskFiles,
    backupEntries,
    readStatusFile,
    branchExists,
    prepareShipFixture,
    prepareSharedWorktreeShipFixture,
    prepareShipOverrideFixture,
    expectArchivedAndDeleted,
    markTaskWorktree,
    readRel,
    writeRel,
    makeTmpDir,
    qualityDoc,
    telemetryFragments,
} from './run-task-ship-helpers.js';


void test('allowed merge-method response requires all three boolean fields', () => {
    const parsed = parseAllowedMergeMethods('{"squashMergeAllowed":false,"rebaseMergeAllowed":true,"mergeCommitAllowed":false}');
    assert.deepEqual(parsed, { ok: true, allowed: { squash: false, rebase: true, merge: false } });
    assert.deepEqual(parseAllowedMergeMethods('{"squashMergeAllowed":true,"rebaseMergeAllowed":true}'), { ok: false });
    assert.deepEqual(parseAllowedMergeMethods('not json'), { ok: false });
});

void test('merge failure message reports partial progress only when an earlier PR merged', () => {
    const common = { prNum: 12, stderr: 'merge queue pending', taskIds: ['example-task'] };
    const noEarlierMerge = formatMergeFailureMessage({ ...common, mergedEarlier: [] });
    const earlierMerged = formatMergeFailureMessage({ ...common, mergedEarlier: [11] });
    assert.match(noEarlierMerge, /No local cleanup ran/);
    assert.match(noEarlierMerge, /re-run `canon run example-task --ship`/);
    assert.doesNotMatch(noEarlierMerge, /base branch has not been pulled/);
    assert.match(earlierMerged, /PR #11 already merged; the base branch has not been pulled yet/);
});

void test('--ship does not resolve an invalid provider pin', () => {
    withTempDir('run-task-ship-invalid-pin-', dir => {
        const taskId = 'ship-invalid-pin';
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 110 },
            providers: { [taskId]: 'bogus' },
        });

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(result.stdout + result.stderr, /Invalid provider/);
        expectArchivedAndDeleted(localDir, taskId, branch);
    });
});

void test('--ship does not refuse a bundle whose provider pins differ', () => {
    withTempDir('run-task-ship-mixed-pins-', dir => {
        const taskIds = ['ship-pins-a', 'ship-pins-b'];
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, taskIds, {
            prNumbers: { [taskIds[0]]: 111, [taskIds[1]]: 111 },
            providers: { [taskIds[0]]: 'claude' },
        });

        const result = runCanon(localDir, [...taskIds, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(result.stdout + result.stderr, /Cannot run a mixed-provider bundle/);
        for (const taskId of taskIds) {
            assert.ok(fs.existsSync(path.join(localDir, 'tasks', '_archive', taskId)));
            assert.ok(!fs.existsSync(path.join(localDir, 'tasks', taskId)));
        }
        assert.equal(branchExists(localDir, branch), false);
    });
});

void test('--ship still refuses a malformed status.json cleanly', () => {
    withTempDir('run-task-ship-bad-status-', dir => {
        const taskId = 'ship-bad-status';
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 112 },
        });
        const statusPath = path.join(localDir, 'tasks', taskId, 'status.json');
        const status = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as Record<string, unknown>;
        status.branch = 'bad branch';
        fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.equal(result.status, 1);
        assert.match(result.stderr, /branch/);
        assert.doesNotMatch(result.stderr, /^\s+at /m);
        assert.ok(fs.existsSync(path.join(localDir, 'tasks', taskId)));
        assert.equal(branchExists(localDir, branch), true);
    });
});

void test('--ship bundle secondary resolves to the shared worktree, not REPO_ROOT', () => {
    withTempDir('run-task-ship-shared-worktree-', dir => {
        const taskIds = ['ship-shared-primary', 'ship-shared-secondary'];
        const { localDir, branch, tip, fakeTools } = prepareSharedWorktreeShipFixture(dir, taskIds as [string, string], {
            prNumber: 210,
            secondaryRepoBaseBranch: 'release/v1',
        });

        const result = runCanon(localDir, [...taskIds, '--ship'], fakeTools, {
            FAKE_GH_OPEN_PR_NUMBER: '210',
            FAKE_GH_PR_HEAD: branch,
            FAKE_GH_PR_BASE: 'main',
            FAKE_GH_PR_URL: 'https://github.com/example/repo/pull/210',
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.equal(result.status, 0, result.stderr);
        for (const taskId of taskIds) {
            assert.ok(fs.existsSync(path.join(localDir, 'tasks', '_archive', taskId)));
            assert.ok(!fs.existsSync(path.join(localDir, 'tasks', taskId)));
        }
    });
});

void test('--ship honors CANON_TASKS_DIR_OVERRIDE when resolving ship cwd', () => {
    withTempDir('run-task-ship-override-cwd-', dir => {
        const taskId = 'ship-override-cwd';
        const { localDir, branch, tip, fakeTools, tasksRoot } = prepareShipOverrideFixture(dir, taskId, {
            prNumber: 211,
            repoBaseBranch: 'release/v1',
            overrideBaseBranch: 'main',
        });

        assert.equal(readStatusFile(localDir, taskId).base_branch, 'release/v1');
        assert.equal(readStatusFile(path.dirname(tasksRoot), taskId).base_branch, 'main');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GH_OPEN_PR_NUMBER: '211',
            FAKE_GH_PR_HEAD: branch,
            FAKE_GH_PR_BASE: 'main',
            FAKE_GH_PR_URL: 'https://github.com/example/repo/pull/211',
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.equal(result.status, 0, result.stderr);
    });
});

for (const [method, flag] of [['squash', '--squash'], ['rebase', '--rebase'], ['merge', '--merge']] as const) {
    void test(`--ship merges with ${method} and deletes the remote branch itself`, () => {
        withTempDir(`run-task-ship-${method}-delete-`, dir => {
            const taskId = `ship-${method}-delete`;
            const { localDir, originDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
                deleteRemote: false,
            });
            if (method !== 'squash') writeRel(localDir, '.canon/config.json', `${JSON.stringify({ ship: { merge_method: method } })}\n`);
            const ghLog = path.join(dir, 'gh.log');

            const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
                FAKE_GH_LOG: ghLog,
                FAKE_GH_OPEN_PR_NUMBER: '107',
                FAKE_GH_MERGED_PR_NUMBER: '107',
                FAKE_GH_PR_HEAD: branch,
                FAKE_GH_PR_BASE: 'main',
                FAKE_GH_HEAD_REF_OID: tip,
            });

            assert.equal(result.status, 0, result.stderr);
            const log = fs.readFileSync(ghLog, 'utf8');
            assert.match(log, new RegExp(`^pr merge 107 ${flag}$`, 'm'));
            for (const otherFlag of ['--squash', '--rebase', '--merge']) {
                if (otherFlag !== flag) assert.doesNotMatch(log, new RegExp(`^pr merge 107 ${otherFlag}$`, 'm'));
            }
            assert.doesNotMatch(log, /--delete-branch/);
            assert.match(result.stdout, new RegExp(`Deleted remote branch ${branch}\\.`));
            assert.doesNotMatch(result.stdout + result.stderr, /tolerated/);
            assert.equal(gitIn(originDir, 'branch', '--list', branch), '');
            expectArchivedAndDeleted(localDir, taskId, branch);
        });
    });
}

void test('--ship pre-flight refuses unreadable or disallowed merge settings before local changes', () => {
    const cases: Array<{ name: string; env: Record<string, string>; expected: RegExp; keepRemoteBranch?: boolean }> = [
        { name: 'disallowed method', env: { FAKE_GH_ALLOWED_METHODS: 'squash' }, expected: /rebase.*ship\.merge_method.*squash/, keepRemoteBranch: true },
        { name: 'unreadable repository settings', env: { FAKE_GH_REPO_VIEW_FAIL: '1' }, expected: /could not read the repository's merge settings/ },
        { name: 'malformed repository settings', env: { FAKE_GH_REPO_VIEW_MALFORMED: '1' }, expected: /could not read the repository's merge settings/ },
        { name: 'failed open PR listing', env: { FAKE_GH_PR_LIST_FAIL: '1' }, expected: /could not read the open-PR listing.*re-running `--ship` is safe/ },
        { name: 'malformed open PR listing', env: { FAKE_GH_PR_LIST_MALFORMED: '1' }, expected: /could not read the open-PR listing.*re-running `--ship` is safe/ },
    ] as const;
    for (const scenario of cases) {
        withTempDir(`ship-preflight-${scenario.name.replaceAll(' ', '-')}-`, dir => {
            const taskId = 'preflight-task';
            const suffix = '| sibling | pre-implement | row |\n';
            const tmpDir = makeTmpDir(dir);
            const ghLog = path.join(dir, 'gh.log');
            const { localDir, branch, fakeTools } = prepareShipFixture(dir, [taskId], {
                deleteRemote: !scenario.keepRemoteBranch,
                initialFiles: {
                    'docs/pipeline-invocations.md': METRICS_SKELETON,
                    'docs/task-quality-log.md': '# Quality log\n',
                    'docs/lessons-learned.md': '# Lessons\n',
                },
            });
            const fetchHeadPath = path.join(localDir, '.git', 'FETCH_HEAD');
            if (scenario.keepRemoteBranch) fs.writeFileSync(fetchHeadPath, 'preflight sentinel\n', 'utf8');
            writeRel(localDir, '.canon/config.json', `${JSON.stringify({ ship: { merge_method: 'rebase' } })}\n`);
            markTaskWorktree(localDir, taskId);
            fs.appendFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), suffix, 'utf8');
            const branchBefore = gitIn(localDir, 'branch', '--show-current');
            const taskDir = path.join(localDir, 'tasks', taskId);
            const taskBefore = Object.fromEntries(fs.readdirSync(taskDir).sort().map(name => [name, fs.readFileSync(path.join(taskDir, name), 'utf8')]));
            const statusBefore = readRel(localDir, `tasks/${taskId}/status.json`);

            const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
                TMPDIR: tmpDir,
                FAKE_GH_LOG: ghLog,
                FAKE_GH_OPEN_PR_NUMBER: '107',
                FAKE_GH_PR_HEAD: branch,
                FAKE_GH_PR_BASE: 'main',
                FAKE_GH_PR_STATE: 'OPEN',
                ...scenario.env,
            });

            assert.notEqual(result.status, 0, scenario.name);
            assert.match(result.stderr, scenario.expected, scenario.name);
            const log = fs.readFileSync(ghLog, 'utf8');
            assert.doesNotMatch(log, /pr merge/);
            if (scenario.name.includes('open PR listing')) assert.doesNotMatch(log, /repo view/);
            else assert.match(log, /repo view/);
            assert.equal(gitIn(localDir, 'branch', '--show-current'), branchBefore);
            if (scenario.keepRemoteBranch) assert.equal(fs.readFileSync(fetchHeadPath, 'utf8'), 'preflight sentinel\n');
            assert.equal(readRel(localDir, 'docs/pipeline-invocations.md'), METRICS_SKELETON + suffix);
            assert.deepEqual(backupEntries(tmpDir), []);
            assert.equal(readRel(localDir, `tasks/${taskId}/status.json`), statusBefore);
            const taskAfter = Object.fromEntries(fs.readdirSync(taskDir).sort().map(name => [name, fs.readFileSync(path.join(taskDir, name), 'utf8')]));
            assert.deepEqual(taskAfter, taskBefore);
        });
    }
});

void test('--ship tolerates remote branch already gone during stale-remote cleanup', () => {
    withTempDir('run-task-ship-remote-delete-race-', dir => {
        const taskId = 'ship-remote-delete-race';
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            deleteRemote: false,
        });
        const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
        setupGitDeleteRace(fakeTools, realGit);

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_MERGED_PR_NUMBER: '106',
            FAKE_GH_PR_HEAD: branch,
            FAKE_GH_PR_BASE: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
            FAKE_GIT_DELETE_REMOTE_REF: branch,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /No-op delete; continuing cleanup/);
        expectArchivedAndDeleted(localDir, taskId, branch);
    });
});

for (const flag of ['', '--ship', '--reroute', '--dry-run', '--pr', '--push', '--full-send']) {
    void test(`malformed docs config refuses ${flag || 'plain run'} before state or heartbeat writes`, () => {
        withTempDir('run-config-invalid-', dir => {
            const { localDir } = makeGitFixture(dir);
            const fakeTools = path.join(dir, 'fake-tools');
            setupFakeTools(fakeTools);
            writeTaskFiles(localDir, 'config-test', makeHumanReviewStatus('config-test', 'main'));
            writeRel(localDir, '.canon/config.json', '{');
            const statusPath = path.join(localDir, 'tasks/config-test/status.json');
            const before = fs.readFileSync(statusPath, 'utf8');
            const result = runCanon(localDir, ['config-test', ...(flag ? [flag] : [])], fakeTools);
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /\.canon\/config.json.*not valid JSON/);
            assert.equal(fs.readFileSync(statusPath, 'utf8'), before);
            for (const file of ['.heartbeat.json', '.canon-pid']) assert.equal(fs.existsSync(path.join(localDir, 'tasks/config-test', file)), false);
        });
    });
}

void test('unknown docs config key warns once and dry-run proceeds', () => {
    withTempDir('run-config-unknown-', dir => {
        const { localDir } = makeGitFixture(dir);
        const fakeTools = path.join(dir, 'fake-tools');
        setupFakeTools(fakeTools);
        writeTaskFiles(localDir, 'config-test', makeHumanReviewStatus('config-test', 'main'));
        writeRel(localDir, '.canon/config.json', '{"docsFreshness":{},"docs_freshness":{"protected_docs":[]}}');
        const result = runCanon(localDir, ['config-test', '--dry-run'], fakeTools);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /unknown key.*docsFreshness.*docs_freshness.protected_docs/);
        assert.equal((result.stderr.match(/unknown key/g) ?? []).length, 1);
    });
});

for (const mainInvalid of [true, false]) {
    void test(`ship config source: main ${mainInvalid ? 'invalid' : 'valid'}, worktree opposite`, () => {
        withTempDir('ship-config-source-', dir => {
            const { localDir, fakeTools } = prepareSharedWorktreeShipFixture(dir, ['config-a', 'config-b'], { prNumber: 601 });
            const worktreeDir = path.join(dir, 'worktrees/config-a');
            writeRel(localDir, '.canon/config.json', mainInvalid ? '{' : '{}');
            writeRel(worktreeDir, '.canon/config.json', mainInvalid ? '{}' : '{');
            const statusPath = path.join(localDir, 'tasks/config-a/status.json');
            const before = fs.readFileSync(statusPath, 'utf8');
            // No PR evidence is supplied: a valid config can reach later ship checks safely.
            const result = runCanon(localDir, ['config-a', 'config-b', '--ship'], fakeTools, { CANON_WORKTREES_ROOT: path.join(dir, 'worktrees') });
            if (mainInvalid) {
                assert.notEqual(result.status, 0);
                assert.match(result.stderr, /\.canon\/config.json.*not valid JSON/);
                assert.equal(fs.readFileSync(statusPath, 'utf8'), before);
            } else assert.doesNotMatch(result.stderr, /\.canon\/config.json is invalid/);
        });
    });
}

for (const kind of ['mapped', 'flag-only', 'malformed'] as const) {
    void test(`ship consumer reloads config: ${kind}`, () => {
        withTempDir('ship-config-consumer-', dir => {
            const { localDir } = makeGitFixture(dir, { 'docs/custom.md': 'original\n' });
            // Import first, then mutate the file: this exercises the consumer independently of startup.
            const raw = kind === 'malformed' ? '{' : JSON.stringify({ docs_freshness: kind === 'mapped'
                ? { paths: { 'api/**': ['docs/custom.md'] } }
                : { flag_only: ['docs/custom.md'] } });
            const result = spawnSync(process.execPath, ['--import', MD_LOADER, '--import', TSX_LOADER, '-e',
                `import fs from 'node:fs'; import(${JSON.stringify(MAIN_HREF)}).then(m => {
                    fs.mkdirSync('.canon', { recursive: true });
                    fs.writeFileSync('.canon/config.json', ${JSON.stringify(raw)});
                    fs.appendFileSync('docs/custom.md', 'stale edit\\n');
                    m.classifyAndPreserveSharedDocDirt();
                });`,
            ], { cwd: localDir, encoding: 'utf8' });
            assert.notEqual(result.status, 0);
            if (kind === 'malformed') assert.match(result.stderr, /\.canon\/config.json.*not valid JSON/);
            else {
                assert.match(result.stderr, /--ship aborted: uncommitted shared-doc edits/);
                assert.match(result.stderr, /docs\/custom.md/);
            }
            assert.equal(readRel(localDir, 'docs/custom.md'), 'original\nstale edit\n');
        });
    });
}

for (const worktreeInvalid of [true, false]) {
    void test(`dry-run config source: worktree ${worktreeInvalid ? 'invalid' : 'valid'}, main opposite`, () => {
        withTempDir('run-config-worktree-source-', dir => {
            const { localDir, fakeTools } = prepareSharedWorktreeShipFixture(dir, ['config-a', 'config-b'], { prNumber: 602 });
            const worktreeDir = path.join(dir, 'worktrees/config-a');
            writeRel(localDir, '.canon/config.json', worktreeInvalid ? '{}' : '{');
            writeRel(worktreeDir, '.canon/config.json', worktreeInvalid ? '{' : '{}');
            const statusPath = path.join(worktreeDir, 'tasks/config-a/status.json');
            const before = fs.readFileSync(statusPath, 'utf8');
            const result = runCanon(localDir, ['config-a', '--dry-run'], fakeTools, { CANON_WORKTREES_ROOT: path.join(dir, 'worktrees') });
            assert.equal(result.status === 0, !worktreeInvalid, result.stderr);
            if (worktreeInvalid) assert.match(result.stderr, /\.canon\/config.json.*not valid JSON/);
            else assert.doesNotMatch(result.stderr, /\.canon\/config.json is invalid/);
            assert.equal(fs.readFileSync(statusPath, 'utf8'), before);
        });
    });
}

for (const [name, doc] of [
    ['non-ASCII', 'docs/café.md'],
    ['quote', 'docs/a"quote.md'],
    ['tab', 'docs/control\tname.md'],
    ['newline', 'docs/control\nname.md'],
] as const) {
    for (const kind of ['protected', 'mapped', 'flag-only'] as const) {
        void test(`ship rejects git-quoted ${name} configured doc (${kind})`, () => {
            withTempDir('ship-quoted-configured-doc-', dir => {
                const { localDir } = makeGitFixture(dir, { [doc]: 'original\n' });
                gitIn(localDir, 'config', 'core.quotePath', 'true');
                const docsConfig = kind === 'protected' ? { protected: [doc] }
                    : kind === 'mapped' ? { paths: { 'api/**': [doc] } }
                    : { flag_only: [doc] };
                writeRel(localDir, '.canon/config.json', JSON.stringify({ docs_freshness: docsConfig }));
                fs.appendFileSync(path.join(localDir, doc), 'dirty correction\n');
                const before = gitRawIn(localDir, 'status', '--porcelain=v1', '-uall', '--', doc);
                assert.match(before, /^ M "docs\//);
                const result = spawnSync(process.execPath, ['--import', MD_LOADER, '--import', TSX_LOADER, '-e',
                    `import(${JSON.stringify(MAIN_HREF)}).then(m => m.classifyAndPreserveSharedDocDirt());`,
                ], { cwd: localDir, encoding: 'utf8' });
                assert.notEqual(result.status, 0, `ship must abort on ${kind} doc dirt: ${JSON.stringify(doc)}`);
                assert.match(result.stderr, /--ship aborted: uncommitted shared-doc edits/);
                assert.ok(result.stderr.includes(doc), result.stderr);
                assert.equal(fs.readFileSync(path.join(localDir, doc), 'utf8'), 'original\ndirty correction\n');
                assert.equal(gitRawIn(localDir, 'status', '--porcelain=v1', '-uall', '--', doc), before);
            });
        });
    }
}

void test('--ship folds all fragments, reconciles legacy quality rows, rewrites refs and stages all logs', () => {
    withTempDir('ship-fold-', dir => {
        const taskId = 'fold-task';
        const sharedQuality = qualityDoc(taskId, 'changes_requested', 'legacy', 'preserve') +
            `\n| 2026-01-02 | ${taskId} | S | approved | 1 | 1 | 0 | 0 | No | stray | extra |\n`;
        const { localDir, tip, branch, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 101 },
            initialFiles: {
                'docs/pipeline-invocations.md': METRICS_SKELETON,
                'docs/task-quality-log.md': sharedQuality,
                'docs/lessons-learned.md': '# Lessons Learned\n\nLegacy entry.\n',
            },
            taskFiles: telemetryFragments(taskId),
        });
        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED', FAKE_GH_BASE_REF_NAME: 'main', FAKE_GH_HEAD_REF_OID: tip,
        });
        assert.equal(result.status, 0, result.stderr);
        expectArchivedAndDeleted(localDir, taskId, branch);
        const metrics = readRel(localDir, 'docs/pipeline-invocations.md');
        assert.equal(metrics.match(/\| Timestamp \|/g)?.length, 1);
        assert.equal(metrics.match(/^\|---/gm)?.length, 1);
        assert.match(metrics, /\| spec \|[^\n]*\n\|[^\n]*\| plan \|[^\n]*\n\s*$/);
        const quality = readRel(localDir, 'docs/task-quality-log.md');
        const rows = parseTable(quality, 'Log');
        assert.equal(rows.length, 1);
        assert.equal(rows[0]['Spec verdict'], 'changes_requested');
        assert.equal(rows[0].Adopter, 'extra');
        assert.equal(rows[0].Notes, `see tasks/_archive/${taskId}/done.md`);
        assert.doesNotMatch(quality.split('## Periodic Reviews')[1], /fold-task/);
        assert.match(readRel(localDir, 'docs/lessons-learned.md'), /Legacy entry\.[\s\S]*### Lesson for fold-task[\s\S]*tasks\/_archive\/fold-task\/notes\.md\.\n$/);
        for (const name of ['metrics.md', 'quality-log.md', 'lessons.md']) {
            assert.equal(fs.existsSync(path.join(localDir, 'tasks/_archive', taskId, name)), false);
        }
        const committedDocs = gitIn(localDir, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD', '--', 'docs').split('\n').sort();
        assert.deepEqual(committedDocs, ['docs/lessons-learned.md', 'docs/pipeline-invocations.md', 'docs/task-quality-log.md']);
        assert.equal(gitIn(localDir, 'log', '-1', '--format=%s'), `chore: archive ${taskId}`);
    });
});

void test('--ship failed fold preserves docs, fragments and review status; retry succeeds', () => {
    withTempDir('ship-fold-fail-', dir => {
        const taskId = 'fold-retry';
        const initialFiles = {
            'docs/pipeline-invocations.md': METRICS_SKELETON,
            'docs/task-quality-log.md': '# malformed shared quality table\n',
            'docs/lessons-learned.md': '# Lessons\n',
        };
        const fragments = telemetryFragments(taskId);
        const { localDir, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles, taskFiles: fragments, syncBase: true,
        });
        // No local branch is also a supported merge-proof path.
        gitIn(localDir, 'branch', '-D', `task/${taskId}`);
        const before = readRel(localDir, `tasks/${taskId}/status.json`);
        const first = runCanon(localDir, [taskId, '--ship'], fakeTools);
        assert.notEqual(first.status, 0);
        assert.match(first.stderr, /could not fold task telemetry fragments/);
        for (const [file, content] of Object.entries({ ...initialFiles, ...fragments })) assert.equal(readRel(localDir, file), content);
        assert.equal(readRel(localDir, `tasks/${taskId}/status.json`), before);
        assert.equal(fs.existsSync(path.join(localDir, 'tasks/_archive', taskId)), false);
        writeRel(localDir, 'docs/task-quality-log.md', qualityDoc('legacy', 'approved', 'unchanged'));
        const retry = runCanon(localDir, [taskId, '--ship'], fakeTools);
        assert.equal(retry.status, 0, retry.stderr);
        assert.ok(fs.existsSync(path.join(localDir, 'tasks/_archive', taskId)));
    });
});

void test('--ship failed fold restores preserved sibling telemetry dirt before aborting', () => {
    withTempDir('ship-fold-fail-dirt-', dir => {
        const taskId = 'fold-fail-dirt';
        const suffix = '| sibling | pre-implement | row |\n';
        const tmpDir = makeTmpDir(dir);
        const initialFiles = {
            'docs/pipeline-invocations.md': METRICS_SKELETON,
            'docs/task-quality-log.md': '# malformed shared quality table\n',
            'docs/lessons-learned.md': '# Lessons\n',
        };
        const { localDir, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles, taskFiles: telemetryFragments(taskId), syncBase: true,
        });
        gitIn(localDir, 'branch', '-D', `task/${taskId}`);
        markTaskWorktree(localDir, taskId);
        fs.appendFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), suffix, 'utf8');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, { TMPDIR: tmpDir });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /could not fold task telemetry fragments/);
        const backupPath = result.stdout.match(/backup: (.+)/)?.[1]?.trim();
        assert.ok(backupPath, result.stdout);
        assert.equal(fs.existsSync(backupPath), false);
        assert.equal(readRel(localDir, 'docs/pipeline-invocations.md'), METRICS_SKELETON + suffix);
    });
});

void test('--ship failed merge restores preserved telemetry dirt before aborting', () => {
    withTempDir('ship-merge-fail-dirt-', dir => {
        const taskId = 'merge-fail-dirt';
        const suffix = '| sibling | pre-implement | row |\n';
        const tmpDir = makeTmpDir(dir);
        const { localDir, branch, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles: {
                'docs/pipeline-invocations.md': METRICS_SKELETON,
                'docs/task-quality-log.md': '# Quality log\n',
                'docs/lessons-learned.md': '# Lessons\n',
            },
        });
        markTaskWorktree(localDir, taskId);
        fs.appendFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), suffix, 'utf8');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            TMPDIR: tmpDir,
            FAKE_GH_OPEN_PR_NUMBER: '107',
            FAKE_GH_PR_HEAD: branch,
            FAKE_GH_PR_BASE: 'main',
            FAKE_GH_PR_STATE: 'OPEN',
            FAKE_GH_MERGE_FAIL: '1',
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Failed to merge PR #107/);
        const backupPath = result.stdout.match(/backup: (.+)/)?.[1]?.trim();
        assert.ok(backupPath, result.stdout);
        assert.equal(fs.existsSync(backupPath), false);
        assert.equal(readRel(localDir, 'docs/pipeline-invocations.md'), METRICS_SKELETON + suffix);
        assert.match(result.stderr, /no local cleanup ran/i);
        assert.match(result.stderr, /re-run `canon run .* --ship`/);
    });
});

void test('fold rolls back partial replacements and partial fragment deletion on I/O failure', t => {
    withTempDir('fold-rollback-', dir => {
        for (const [file, content] of Object.entries(telemetryFragments('rollback'))) writeRel(dir, file, content);
        writeRel(dir, 'docs/pipeline-invocations.md', METRICS_SKELETON);
        const plan = planTelemetryFold(dir, ['rollback'], id => path.join(dir, 'tasks', id));
        const originalRename = fs.renameSync;
        let calls = 0;
        const renameMock = t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
            calls += 1;
            if (calls === 2) throw new Error('forced rename failure');
            originalRename(from, to);
        });
        assert.throws(() => applyTelemetryFold(plan), /forced rename failure/);
        renameMock.mock.restore();
        const checkRestored = () => {
            assert.equal(readRel(dir, 'docs/pipeline-invocations.md'), METRICS_SKELETON);
            assert.equal(fs.existsSync(path.join(dir, 'docs/task-quality-log.md')), false);
            assert.equal(fs.existsSync(path.join(dir, 'docs/lessons-learned.md')), false);
            for (const fragment of plan.fragments) assert.equal(fs.readFileSync(fragment.path, 'utf8'), fragment.content);
            assert.deepEqual(fs.readdirSync(path.join(dir, 'docs')), ['pipeline-invocations.md']);
        };
        checkRestored();
        const originalUnlink = fs.unlinkSync;
        const unlinkMock = t.mock.method(fs, 'unlinkSync', (file: fs.PathLike) => {
            if (String(file) === plan.fragments[1].path) throw new Error('forced deletion failure');
            originalUnlink(file);
        });
        assert.throws(() => applyTelemetryFold(plan), /forced deletion failure/);
        unlinkMock.mock.restore();
        checkRestored();
        foldTelemetryFragments(dir, ['rollback'], id => path.join(dir, 'tasks', id));
        assert.equal(plan.fragments.some(fragment => fs.existsSync(fragment.path)), false);
    });
});

void test('--ship creates absent shared docs from fragments, while legacy missing fragments stay compatible', () => {
    withTempDir('ship-fold-create-', dir => {
        const taskId = 'create-logs';
        const { localDir, fakeTools } = prepareShipFixture(dir, [taskId], { syncBase: true, taskFiles: telemetryFragments(taskId) });
        gitIn(localDir, 'branch', '-D', `task/${taskId}`);
        const result = runCanon(localDir, [taskId, '--ship'], fakeTools);
        assert.equal(result.status, 0, result.stderr);
        assert.match(readRel(localDir, 'docs/pipeline-invocations.md'), /\| create-logs \|/);
        assert.equal(parseTable(readRel(localDir, 'docs/task-quality-log.md'), 'Log')[0].Task, taskId);
        assert.match(readRel(localDir, 'docs/lessons-learned.md'), /^# Lessons Learned/);
    });
    withTempDir('ship-fold-legacy-', dir => {
        const taskId = 'legacy-logs';
        const docs = {
            'docs/pipeline-invocations.md': METRICS_SKELETON,
            'docs/task-quality-log.md': qualityDoc(taskId, 'approved', `tasks/${taskId}/done.md`),
            'docs/lessons-learned.md': `# Lessons\n\ntasks/${taskId}/notes.md\n`,
        };
        const { localDir, fakeTools } = prepareShipFixture(dir, [taskId], { syncBase: true, taskFiles: docs });
        gitIn(localDir, 'branch', '-D', `task/${taskId}`);
        const result = runCanon(localDir, [taskId, '--ship'], fakeTools);
        assert.equal(result.status, 0, result.stderr);
        for (const [file, content] of Object.entries(docs)) assert.equal(readRel(localDir, file), content.replaceAll(`tasks/${taskId}/`, `tasks/_archive/${taskId}/`));
    });
});

void test('--pr warns for every shared telemetry doc changed but still opens the PR', () => {
    withTempDir('pr-telemetry-warning-', dir => {
        const { localDir } = makeGitFixture(dir);
        const fakeTools = path.join(dir, 'tools');
        setupFakeTools(fakeTools);
        const taskId = 'warning-task';
        const branch = `task/${taskId}`;
        gitIn(localDir, 'checkout', '-b', branch);
        writeTaskFiles(localDir, taskId, makeHumanReviewStatus(taskId, branch));
        for (const file of ['pipeline-invocations.md', 'task-quality-log.md', 'lessons-learned.md']) writeRel(localDir, `docs/${file}`, '# Legacy log\n');
        gitIn(localDir, 'add', 'docs', 'tasks');
        gitIn(localDir, 'commit', '-m', 'legacy telemetry');
        const result = runCanon(localDir, [taskId, '--pr'], fakeTools, {
            FAKE_GH_STATE_FILE: path.join(dir, 'gh-state'), FAKE_GH_CREATE_NUMBER: '101',
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /Parallel tasks will conflict there/);
        for (const file of ['pipeline-invocations.md', 'task-quality-log.md', 'lessons-learned.md']) assert.ok(result.stderr.includes(`docs/${file}`));
        assert.equal(fs.readFileSync(path.join(localDir, 'tasks', taskId, '.pr-number'), 'utf8'), '101');
    });
});

void test('parallel branches write no shared logs and both ship after a real squash merge without conflicts', () => {
    withTempDir('ship-parallel-fragments-', dir => {
        const { localDir } = makeGitFixture(dir);
        const fakeTools = path.join(dir, 'tools');
        setupFakeTools(fakeTools);
        const base = gitIn(localDir, 'rev-parse', 'HEAD');
        const envKeys = ['CANON_METRICS_FILE_OVERRIDE', 'CANON_QUALITY_LOG_FILE_OVERRIDE', 'CANON_TASKS_DIR_OVERRIDE'];
        const previous = envKeys.map(key => process.env[key]);
        envKeys.forEach(key => { delete process.env[key]; });
        try {
            for (const id of ['parallel-a', 'parallel-b']) {
                const branch = `task/${id}`;
                gitIn(localDir, 'checkout', '-b', branch, base);
                const status = makeStatus(id, branch);
                writeTaskFiles(localDir, id, status);
                recordMetric({ taskId: id, activeCwd: localDir, phase: 'qa', agent: 'claude', model: 'test', durationMs: 100, status: 'ok' });
                writeQualityLogForTask(id, localDir, path.join(localDir, 'tasks', id, 'done.md'), status as unknown as StatusJson);
                writeRel(localDir, `tasks/${id}/lessons.md`, `### Lesson ${id}\n\nReusable insight.\n`);
                gitIn(localDir, 'add', 'tasks');
                gitIn(localDir, 'commit', '-m', `finish ${id}`);
                assert.equal(gitIn(localDir, 'diff', `${base}...HEAD`, '--', 'docs/pipeline-invocations.md', 'docs/task-quality-log.md', 'docs/lessons-learned.md'), '');
            }
        } finally {
            envKeys.forEach((key, index) => {
                if (previous[index] === undefined) delete process.env[key];
                else process.env[key] = previous[index];
            });
        }
        gitIn(localDir, 'checkout', 'main');
        for (const id of ['parallel-a', 'parallel-b']) {
            // The second squash runs against base after A's fold + archive commit.
            gitIn(localDir, 'merge', '--squash', `task/${id}`);
            gitIn(localDir, 'commit', '-m', `merge ${id}`);
            gitIn(localDir, 'push', 'origin', 'main');
            gitIn(localDir, 'branch', '-D', `task/${id}`);
            const result = runCanon(localDir, [id, '--ship'], fakeTools);
            assert.equal(result.status, 0, result.stderr);
        }
        const metrics = readRel(localDir, 'docs/pipeline-invocations.md');
        const lessons = readRel(localDir, 'docs/lessons-learned.md');
        const rows = parseTable(readRel(localDir, 'docs/task-quality-log.md'), 'Log');
        for (const id of ['parallel-a', 'parallel-b']) {
            assert.ok(metrics.includes(`| ${id} |`));
            assert.ok(lessons.includes(`### Lesson ${id}`));
            assert.equal(rows.filter(row => row.Task === id).length, 1);
        }
    });
});

void test('fold skips empty lessons and metrics, consumes no-row quality, and preserves argument order', () => {
    withTempDir('fold-empty-', dir => {
        const empty = {
            'tasks/empty/metrics.md': METRICS_SKELETON,
            'tasks/empty/lessons.md': ' \n\t',
            'tasks/empty/quality-log.md': qualityDoc('other', 'approved', 'no matching task'),
        };
        for (const [file, content] of Object.entries(empty)) writeRel(dir, file, content);
        assert.deepEqual(foldTelemetryFragments(dir, ['empty'], id => path.join(dir, 'tasks', id)), []);
        assert.equal(fs.existsSync(path.join(dir, 'docs')), false);
        assert.deepEqual(fs.readdirSync(path.join(dir, 'tasks/empty')), []);
        for (const id of ['second', 'first']) {
            for (const [file, content] of Object.entries(telemetryFragments(id))) writeRel(dir, file, content);
        }
        foldTelemetryFragments(dir, ['first', 'second'], id => path.join(dir, 'tasks', id));
        const metrics = readRel(dir, 'docs/pipeline-invocations.md');
        const lessons = readRel(dir, 'docs/lessons-learned.md');
        assert.ok(metrics.indexOf('| first |') < metrics.indexOf('| second |'));
        assert.ok(lessons.indexOf('Lesson for first') < lessons.indexOf('Lesson for second'));
        assert.deepEqual(sharedTelemetryDocsTouched(['src/example.ts', 'docs/lessons-learned.md']), ['docs/lessons-learned.md']);
        assert.deepEqual(sharedTelemetryDocsTouched([]), []);
    });
});

void test('lessons fold drops title headings above the first entry and keeps entry content verbatim', () => {
    const shared = '# Lessons Learned\n\nLegacy entry.\n';
    const fragment = [
        '# Lessons', '', '## From QA', '', '### Lesson one', '', '```inline``` span, then an example:', '',
        '```', '# keep this shell comment', '```', '', '````md', '```sh', '# keep nested', '```', '````', '',
        '## keep this heading inside an entry', '', '### Lesson two', '', 'Body.', '',
    ].join('\n');
    const folded = foldLessonsFragment(shared, fragment);
    assert.ok(folded);
    assert.doesNotMatch(folded, /^# Lessons$/m);
    assert.doesNotMatch(folded, /^## From QA$/m);
    assert.match(folded, /Legacy entry\.\n\n---\n\n### Lesson one\n/);
    assert.ok(folded.endsWith(`${fragment.slice(fragment.indexOf('### Lesson one')).trim()}\n`), 'entries fold verbatim');
    assert.equal(foldLessonsFragment(shared, '# Lessons\n'), null);
    const indented = foldLessonsFragment(shared, '  # Lessons\n\n   ## From QA\n\n ### Lesson\n\n    # indented code stays\n');
    assert.ok(indented);
    assert.doesNotMatch(indented, /Lessons$|From QA/m);
    assert.match(indented, /---\n\n### Lesson\n\n    # indented code stays\n$/);
});

for (const mode of ['rename', 'commit', 'push'] as const) {
    void test(`--ship post-fold failure hint: ${mode}`, () => {
        withTempDir(`ship-post-fold-${mode}-`, dir => {
            const taskId = `post-fold-${mode}`;
            const initialFiles: Record<string, string> = {
                'docs/pipeline-invocations.md': METRICS_SKELETON,
                'docs/task-quality-log.md': qualityDoc('other', 'approved', 'existing'),
                'docs/lessons-learned.md': '# Lessons\n',
            };
            if (mode === 'rename') initialFiles[`tasks/_archive/${taskId}/sentinel.md`] = 'Keep the archive destination non-empty.\n';
            const { localDir, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
                initialFiles, taskFiles: telemetryFragments(taskId), prNumbers: { [taskId]: 411 },
            });
            if (mode !== 'rename') {
                const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
                setupGitArchiveFailure(fakeTools, realGit, mode);
            }
            const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
                FAKE_GH_PR_STATE: 'MERGED', FAKE_GH_BASE_REF_NAME: 'main', FAKE_GH_HEAD_REF_OID: tip,
            });
            assert.notEqual(result.status, 0);
            assert.match(readRel(localDir, 'docs/pipeline-invocations.md'), /\| spec \|/);
            assert.match(readRel(localDir, 'docs/lessons-learned.md'), new RegExp(`### Lesson for ${taskId}`));
            assert.equal(fs.existsSync(path.join(localDir, 'tasks', taskId, 'metrics.md')), false);
            assert.match(result.stderr, /Failure after the telemetry fold/);
            for (const file of ['pipeline-invocations.md', 'task-quality-log.md', 'lessons-learned.md']) assert.ok(result.stderr.includes(`docs/${file}`));
            assert.match(result.stderr, /fragments were already deleted/i);
            assert.match(result.stderr, /do not reset/i);
            if (mode === 'push') {
                assert.match(result.stderr, /local.*chore: archive/);
                assert.match(result.stderr, /not pushed/);
                assert.match(result.stderr, /simulated archive push failure/);
                assert.doesNotMatch(result.stderr, /as uncommitted/);
                assert.equal(gitIn(localDir, 'log', '-1', '--format=%s'), `chore: archive ${taskId}`);
            } else {
                assert.match(result.stderr, /uncommitted \(possibly staged\)/);
                assert.doesNotMatch(result.stderr, /which was not pushed/);
                if (mode === 'rename') assert.ok(fs.existsSync(path.join(localDir, 'tasks', taskId)));
                else assert.match(result.stderr, /failed to commit archive changes/);
            }
        });
    });
}
