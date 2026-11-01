import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
    withTempDir,
    gitIn,
    gitRawIn,
    makeGitFixture,
    setupFakeTools,
    setupGitArchiveFailure,
    runCanon,
    makeHumanReviewStatus,
    writePrNumberSidecar,
    writeTaskFiles,
    readStatusFile,
    branchExists,
    createUnrelatedCommit,
    prepareShipFixture,
    expectArchivedAndDeleted,
    expectTaskAndBranchSurvive,
    markTaskWorktree,
    sharedDocInitialFiles,
    readRel,
    writeRel,
    assertNoPrMergeInvoked,
    makeTmpDir,
    backupEntries,
} from './run-task-ship-helpers.js';


void test('--pr writes the sidecar on create path and leaves status clean', () => {
    withTempDir('run-task-ship-pr-create-', dir => {
        const { localDir } = makeGitFixture(dir);
        const fakeTools = path.join(dir, 'fake-tools');
        setupFakeTools(fakeTools);
        const taskId = 'ship-pr-create';
        const branch = `task/${taskId}`;
        gitIn(localDir, 'checkout', '-b', branch);
        writeTaskFiles(localDir, taskId, makeHumanReviewStatus(taskId, branch));

        const result = runCanon(localDir, [taskId, '--pr'], fakeTools, {
            FAKE_GH_STATE_FILE: path.join(dir, 'gh-state.txt'),
            FAKE_GH_CREATE_NUMBER: '101',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(result.stderr, /Shared telemetry docs changed/);
        assert.equal(fs.readFileSync(path.join(localDir, 'tasks', taskId, '.pr-number'), 'utf8'), '101');
        const status = readStatusFile(localDir, taskId) as { pr?: { number?: number } };
        assert.equal(status.pr, undefined);
        assert.equal(gitIn(localDir, 'status', '--porcelain'), '');
        assert.equal(gitIn(localDir, 'log', '--format=%s', '-1'), `chore: add task artifacts for ${taskId}`);
        assert.equal(gitIn(localDir, 'log', '--format=%s', '--grep=record pr.number'), '');
        assert.doesNotMatch(gitIn(localDir, 'log', '--format=%s', '-1'), /\[skip ci\]/);
    });
});

void test('--pr keeps the artifacts commit unmarked, sets upstream tracking, and reruns cleanly', () => {
    withTempDir('run-task-ship-pr-tracking-', dir => {
        const { localDir } = makeGitFixture(dir);
        const fakeTools = path.join(dir, 'fake-tools');
        setupFakeTools(fakeTools);
        const taskId = 'ship-pr-tracking';
        const branch = `task/${taskId}`;
        gitIn(localDir, 'checkout', '-b', branch);
        writeTaskFiles(localDir, taskId, makeHumanReviewStatus(taskId, branch));

        const first = runCanon(localDir, [taskId, '--pr'], fakeTools, {
            FAKE_GH_STATE_FILE: path.join(dir, 'gh-state.txt'),
            FAKE_GH_CREATE_NUMBER: '101',
            FAKE_GH_CREATE_URL: 'https://github.com/example/repo/pull/101',
        });

        assert.equal(first.status, 0, first.stderr);
        const status = readStatusFile(localDir, taskId) as { pr?: { number?: number } };
        assert.equal(status.pr, undefined);
        assert.equal(fs.readFileSync(path.join(localDir, 'tasks', taskId, '.pr-number'), 'utf8'), '101');
        assert.equal(gitIn(localDir, 'rev-parse', '--abbrev-ref', `${branch}@{upstream}`), `origin/${branch}`);
        assert.match(gitIn(localDir, 'status', '-sb'), new RegExp(`^## ${branch}\\.{3}origin/${branch}$`, 'm'));
        assert.equal(gitIn(localDir, 'status', '--porcelain'), '');
        assert.doesNotMatch(gitIn(localDir, 'log', '--format=%s', '-1'), /\[skip ci\]/);

        const second = runCanon(localDir, [taskId, '--pr'], fakeTools, {
            FAKE_GH_STATE_FILE: path.join(dir, 'gh-state.txt'),
            FAKE_GH_CREATE_NUMBER: '101',
            FAKE_GH_CREATE_URL: 'https://github.com/example/repo/pull/101',
        });

        assert.equal(second.status, 0, second.stderr);
        assert.equal(gitIn(localDir, 'rev-parse', '--abbrev-ref', `${branch}@{upstream}`), `origin/${branch}`);
        assert.match(gitIn(localDir, 'status', '-sb'), new RegExp(`^## ${branch}\\.{3}origin/${branch}$`, 'm'));
        assert.equal(gitIn(localDir, 'status', '--porcelain'), '');
    });
});

void test('--pr pins existing PR number and exits clean on re-run', () => {
    withTempDir('run-task-ship-pr-existing-', dir => {
        const { localDir } = makeGitFixture(dir);
        const fakeTools = path.join(dir, 'fake-tools');
        setupFakeTools(fakeTools);
        const taskId = 'ship-pr-existing';
        const branch = `task/${taskId}`;
        gitIn(localDir, 'checkout', '-b', branch);
        writeTaskFiles(localDir, taskId, makeHumanReviewStatus(taskId, branch));

        const env = {
            FAKE_GH_OPEN_PR_NUMBER: '77',
            FAKE_GH_PR_HEAD: branch,
            FAKE_GH_PR_BASE: 'main',
            FAKE_GH_PR_URL: 'https://github.com/example/repo/pull/77',
        };
        const first = runCanon(localDir, [taskId, '--pr'], fakeTools, env);
        assert.equal(first.status, 0, first.stderr);
        assert.equal(fs.readFileSync(path.join(localDir, 'tasks', taskId, '.pr-number'), 'utf8'), '77');
        assert.equal(gitIn(localDir, 'status', '--porcelain'), '');

        const second = runCanon(localDir, [taskId, '--pr'], fakeTools, env);
        assert.equal(second.status, 0, second.stderr);
        assert.equal(fs.readFileSync(path.join(localDir, 'tasks', taskId, '.pr-number'), 'utf8'), '77');
        assert.equal(gitIn(localDir, 'status', '--porcelain'), '');
        assert.doesNotMatch(gitIn(localDir, 'log', '--format=%s', '-1'), /\[skip ci\]/);
    });
});

void test('--pr dirty path with already-pinned open PR keeps the head unmarked', () => {
    withTempDir('run-task-ship-pr-pinned-', dir => {
        const { localDir } = makeGitFixture(dir);
        const fakeTools = path.join(dir, 'fake-tools');
        setupFakeTools(fakeTools);
        const taskId = 'ship-pr-pinned';
        const branch = `task/${taskId}`;
        gitIn(localDir, 'checkout', '-b', branch);
        writeTaskFiles(localDir, taskId, makeHumanReviewStatus(taskId, branch));
        writePrNumberSidecar(localDir, taskId, 77);
        gitIn(localDir, 'add', 'tasks');
        gitIn(localDir, 'commit', '-m', 'seed pinned PR');
        gitIn(localDir, 'push', '-u', 'origin', branch);
        fs.appendFileSync(path.join(localDir, 'tasks', taskId, 'handoff.md'), '\nlocal dirty change\n', 'utf8');

        const result = runCanon(localDir, [taskId, '--pr'], fakeTools, {
            FAKE_GH_OPEN_PR_NUMBER: '77',
            FAKE_GH_PR_HEAD: branch,
            FAKE_GH_PR_BASE: 'main',
            FAKE_GH_PR_URL: 'https://github.com/example/repo/pull/77',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.equal(fs.readFileSync(path.join(localDir, 'tasks', taskId, '.pr-number'), 'utf8'), '77');
        assert.equal(gitIn(localDir, 'status', '--porcelain'), '');
        assert.doesNotMatch(gitIn(localDir, 'log', '--format=%s', '-1'), /\[skip ci\]/);
    });
});

void test('--pr pins bundle PR number to every task', () => {
    withTempDir('run-task-ship-pr-bundle-', dir => {
        const { localDir } = makeGitFixture(dir);
        const fakeTools = path.join(dir, 'fake-tools');
        setupFakeTools(fakeTools);
        const taskIds = ['ship-pr-bundle-a', 'ship-pr-bundle-b'];
        const branch = `task/${taskIds[0]}`;
        gitIn(localDir, 'checkout', '-b', branch);
        for (const taskId of taskIds) {
            writeTaskFiles(localDir, taskId, makeHumanReviewStatus(taskId, branch));
        }

        const result = runCanon(localDir, [...taskIds, '--pr'], fakeTools, {
            FAKE_GH_OPEN_PR_NUMBER: '88',
            FAKE_GH_PR_HEAD: branch,
            FAKE_GH_PR_BASE: 'main',
        });

        assert.equal(result.status, 0, result.stderr);
        for (const taskId of taskIds) {
            const status = readStatusFile(localDir, taskId) as { pr?: { number?: number } };
            assert.equal(status.pr, undefined);
            assert.equal(fs.readFileSync(path.join(localDir, 'tasks', taskId, '.pr-number'), 'utf8'), '88');
        }
    });
});

void test('--ship proves pinned merged PR, fast-forwards, archives, and deletes local branch', () => {
    withTempDir('run-task-ship-happy-', dir => {
        const taskId = 'ship-happy';
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 101 },
        });
        assert.equal(fs.readFileSync(path.join(localDir, 'tasks', taskId, '.pr-number'), 'utf8'), '101');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /fast-forwarding/);
        expectArchivedAndDeleted(localDir, taskId, branch);
    });
});

void test('--ship preserves appended pipeline invocation dirt as uncommitted after archive', () => {
    withTempDir('run-task-ship-preserve-invocations-', dir => {
        const taskId = 'ship-preserve-invocations';
        const suffix = 'sibling pre-implement telemetry row\n';
        const tmpDir = makeTmpDir(dir);
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles: sharedDocInitialFiles(taskId),
            prNumbers: { [taskId]: 301 },
        });
        markTaskWorktree(localDir, taskId);
        fs.appendFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), suffix, 'utf8');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
            TMPDIR: tmpDir,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Preserving uncommitted docs\/pipeline-invocations\.md dirt during --ship; backup: /);
        const backupPath = result.stdout.match(/backup: (.+)/)?.[1]?.trim();
        assert.ok(backupPath);
        assert.equal(fs.existsSync(backupPath), false);
        assert.match(readRel(localDir, 'docs/pipeline-invocations.md'), new RegExp(suffix.trim()));
        assert.doesNotMatch(gitIn(localDir, 'show', 'HEAD:docs/pipeline-invocations.md'), new RegExp(suffix.trim()));
        assert.match(gitRawIn(localDir, 'status', '--porcelain', '--', 'docs/pipeline-invocations.md'), /^ M docs\/pipeline-invocations\.md\n$/);
        expectArchivedAndDeleted(localDir, taskId, branch);
    });
});

void test('--ship aborts mixed shared-doc dirt before backups or mutation', () => {
    withTempDir('run-task-ship-mixed-shared-doc-dirt-', dir => {
        const taskId = 'ship-mixed-shared-doc-dirt';
        const tmpDir = makeTmpDir(dir);
        const ghLog = path.join(dir, 'gh.log');
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles: sharedDocInitialFiles(taskId),
            prNumbers: { [taskId]: 302 },
        });
        markTaskWorktree(localDir, taskId);
        const telemetryPath = 'docs/pipeline-invocations.md';
        const managedPath = 'docs/patterns.md';
        fs.appendFileSync(path.join(localDir, telemetryPath), 'safe telemetry suffix\n', 'utf8');
        fs.appendFileSync(path.join(localDir, managedPath), 'managed edit\n', 'utf8');
        const telemetryBefore = readRel(localDir, telemetryPath);
        const managedBefore = readRel(localDir, managedPath);

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
            FAKE_GH_LOG: ghLog,
            TMPDIR: tmpDir,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /docs\/patterns\.md/);
        assertNoPrMergeInvoked(ghLog);
        assert.equal(readRel(localDir, telemetryPath), telemetryBefore);
        assert.equal(readRel(localDir, managedPath), managedBefore);
        assert.equal(backupEntries(tmpDir).length, 0);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship aborts managed shared-doc dirt and --force does not bypass it', () => {
    for (const force of [false, true]) {
        withTempDir(`run-task-ship-managed-dirt-${force ? 'force' : 'normal'}-`, dir => {
            const taskId = force ? 'ship-managed-dirt-force' : 'ship-managed-dirt';
            const ghLog = path.join(dir, 'gh.log');
            const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
                initialFiles: sharedDocInitialFiles(taskId),
                prNumbers: { [taskId]: 303 },
            });
            markTaskWorktree(localDir, taskId);
            fs.appendFileSync(path.join(localDir, 'docs', 'patterns.md'), 'operator edit\n', 'utf8');
            const before = readRel(localDir, 'docs/patterns.md');

            const result = runCanon(
                localDir,
                force ? [taskId, '--ship', '--force'] : [taskId, '--ship'],
                fakeTools,
                {
                    FAKE_GH_PR_STATE: 'MERGED',
                    FAKE_GH_BASE_REF_NAME: 'main',
                    FAKE_GH_HEAD_REF_OID: tip,
                    FAKE_GH_LOG: ghLog,
                },
            );

            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /docs\/patterns\.md/);
            assert.match(result.stderr, /commit or stash your edits/);
            assertNoPrMergeInvoked(ghLog);
            assert.equal(readRel(localDir, 'docs/patterns.md'), before);
            expectTaskAndBranchSurvive(localDir, taskId, branch);
        });
    }
});

void test('--ship aborts non-pure-append telemetry dirt before merge', () => {
    withTempDir('run-task-ship-non-append-telemetry-', dir => {
        const taskId = 'ship-non-append-telemetry';
        const ghLog = path.join(dir, 'gh.log');
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles: sharedDocInitialFiles(taskId),
            prNumbers: { [taskId]: 304 },
        });
        markTaskWorktree(localDir, taskId);
        writeRel(localDir, 'docs/pipeline-invocations.md', 'modified existing line\n');
        const before = readRel(localDir, 'docs/pipeline-invocations.md');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
            FAKE_GH_LOG: ghLog,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /not a pure append/);
        assertNoPrMergeInvoked(ghLog);
        assert.equal(readRel(localDir, 'docs/pipeline-invocations.md'), before);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship aborts untracked telemetry dirt before merge', () => {
    withTempDir('run-task-ship-untracked-telemetry-', dir => {
        const taskId = 'ship-untracked-telemetry';
        const ghLog = path.join(dir, 'gh.log');
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 305 },
        });
        markTaskWorktree(localDir, taskId);
        writeRel(localDir, 'docs/pipeline-invocations.md', 'untracked telemetry\n');
        const before = readRel(localDir, 'docs/pipeline-invocations.md');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
            FAKE_GH_LOG: ghLog,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /git status shows this path as '\?\?'/);
        assertNoPrMergeInvoked(ghLog);
        assert.equal(readRel(localDir, 'docs/pipeline-invocations.md'), before);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship preserves archive-staged telemetry dirt without committing the suffix', () => {
    withTempDir('run-task-ship-preserve-archive-telemetry-', dir => {
        const taskId = 'ship-preserve-archive-telemetry';
        const lessonsSuffix = 'sibling lesson suffix\n';
        const qualitySuffix = 'sibling quality suffix\n';
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles: sharedDocInitialFiles(taskId),
            prNumbers: { [taskId]: 306 },
        });
        markTaskWorktree(localDir, taskId);
        fs.appendFileSync(path.join(localDir, 'docs', 'lessons-learned.md'), lessonsSuffix, 'utf8');
        fs.appendFileSync(path.join(localDir, 'docs', 'task-quality-log.md'), qualitySuffix, 'utf8');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.equal(result.status, 0, result.stderr);
        const committedLessons = gitIn(localDir, 'show', 'HEAD:docs/lessons-learned.md');
        const committedQuality = gitIn(localDir, 'show', 'HEAD:docs/task-quality-log.md');
        assert.match(committedLessons, new RegExp(`tasks/_archive/${taskId}/spec\\.md`));
        assert.match(committedQuality, new RegExp(`tasks/_archive/${taskId}/review\\.md`));
        assert.doesNotMatch(committedLessons, new RegExp(lessonsSuffix.trim()));
        assert.doesNotMatch(committedQuality, new RegExp(qualitySuffix.trim()));
        assert.match(readRel(localDir, 'docs/lessons-learned.md'), new RegExp(lessonsSuffix.trim()));
        assert.match(readRel(localDir, 'docs/task-quality-log.md'), new RegExp(qualitySuffix.trim()));
        assert.match(gitRawIn(localDir, 'status', '--porcelain', '--', 'docs/lessons-learned.md'), /^ M docs\/lessons-learned\.md\n$/);
        assert.match(gitRawIn(localDir, 'status', '--porcelain', '--', 'docs/task-quality-log.md'), /^ M docs\/task-quality-log\.md\n$/);
        expectArchivedAndDeleted(localDir, taskId, branch);
    });
});

void test('--ship preserves telemetry in the working tree when the archive commit fails', () => {
    withTempDir('run-task-ship-archive-commit-fail-', dir => {
        const taskId = 'ship-archive-commit-fail';
        const suffix = 'pending row\n';
        const { localDir, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles: { 'docs/pipeline-invocations.md': '# Pipeline Invocations\n\nexisting row\n' },
            prNumbers: { [taskId]: 308 },
        });
        markTaskWorktree(localDir, taskId);
        fs.appendFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), suffix, 'utf8');

        const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
        setupGitArchiveFailure(fakeTools, realGit, 'commit');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.notEqual(result.status, 0);
        assert.doesNotMatch(result.stderr, /Failure after the telemetry fold/);
        assert.match(result.stderr, /failed to commit archive changes/);
        assert.equal(
            readRel(localDir, 'docs/pipeline-invocations.md'),
            '# Pipeline Invocations\n\nexisting row\npending row\n',
        );
    });
});

void test('--ship preserves telemetry in the working tree when the archive push fails', () => {
    withTempDir('run-task-ship-archive-push-fail-', dir => {
        const taskId = 'ship-archive-push-fail';
        const suffix = 'pending row\n';
        const { localDir, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles: { 'docs/pipeline-invocations.md': '# Pipeline Invocations\n\nexisting row\n' },
            prNumbers: { [taskId]: 309 },
        });
        markTaskWorktree(localDir, taskId);
        fs.appendFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), suffix, 'utf8');

        const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
        setupGitArchiveFailure(fakeTools, realGit, 'push');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.notEqual(result.status, 0);
        assert.doesNotMatch(result.stderr, /Failure after the telemetry fold/);
        assert.match(result.stderr, /simulated archive push failure/);
        assert.equal(
            readRel(localDir, 'docs/pipeline-invocations.md'),
            '# Pipeline Invocations\n\nexisting row\npending row\n',
        );
    });
});

void test('--ship aborts a staged-only edit on a managed doc before merge', () => {
    withTempDir('run-task-ship-staged-managed-', dir => {
        const taskId = 'ship-staged-managed';
        const ghLog = path.join(dir, 'gh.log');
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles: { 'docs/patterns.md': '# Patterns\n\nexisting pattern\n' },
            prNumbers: { [taskId]: 310 },
        });
        markTaskWorktree(localDir, taskId);
        const target = path.join(localDir, 'docs', 'patterns.md');
        const headContent = fs.readFileSync(target, 'utf8');
        fs.writeFileSync(target, `${headContent}staged edit\n`, 'utf8');
        gitIn(localDir, 'add', 'docs/patterns.md');
        fs.writeFileSync(target, headContent, 'utf8');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
            FAKE_GH_LOG: ghLog,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /docs\/patterns\.md/);
        assertNoPrMergeInvoked(ghLog);
        assert.notEqual(gitIn(localDir, 'diff', '--cached', '--', 'docs/patterns.md'), '');
        assert.equal(readRel(localDir, 'docs/patterns.md'), headContent);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship aborts a staged-only edit on a telemetry file before merge', () => {
    withTempDir('run-task-ship-staged-telemetry-', dir => {
        const taskId = 'ship-staged-telemetry';
        const ghLog = path.join(dir, 'gh.log');
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles: { 'docs/pipeline-invocations.md': '# Pipeline Invocations\n\nexisting row\n' },
            prNumbers: { [taskId]: 311 },
        });
        markTaskWorktree(localDir, taskId);
        const target = path.join(localDir, 'docs', 'pipeline-invocations.md');
        const headContent = fs.readFileSync(target, 'utf8');
        fs.writeFileSync(target, `${headContent}staged row\n`, 'utf8');
        gitIn(localDir, 'add', 'docs/pipeline-invocations.md');
        fs.writeFileSync(target, headContent, 'utf8');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
            FAKE_GH_LOG: ghLog,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /docs\/pipeline-invocations\.md/);
        assertNoPrMergeInvoked(ghLog);
        assert.notEqual(gitIn(localDir, 'diff', '--cached', '--', 'docs/pipeline-invocations.md'), '');
        assert.equal(readRel(localDir, 'docs/pipeline-invocations.md'), headContent);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship aborts a working-tree deletion of a tracked shared doc before merge', () => {
    withTempDir('run-task-ship-deleted-doc-', dir => {
        const taskId = 'ship-deleted-doc';
        const ghLog = path.join(dir, 'gh.log');
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles: { 'docs/decisions.md': '# Decisions\n\nexisting decision\n' },
            prNumbers: { [taskId]: 312 },
        });
        markTaskWorktree(localDir, taskId);
        fs.rmSync(path.join(localDir, 'docs', 'decisions.md'));

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
            FAKE_GH_LOG: ghLog,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /docs\/decisions\.md/);
        assertNoPrMergeInvoked(ghLog);
        assert.match(gitRawIn(localDir, 'status', '--porcelain', '--', 'docs/decisions.md'), /^ D docs\/decisions\.md\n$/);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship refuses pinned PR merged into the wrong base', () => {
    withTempDir('run-task-ship-wrong-base-', dir => {
        const taskId = 'ship-wrong-base';
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 102 },
        });

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'release/v1',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /not 'main'/);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship refuses branch-reuse head mismatch and --force does not bypass it', () => {
    for (const force of [false, true]) {
        withTempDir(`run-task-ship-reuse-${force ? 'force' : 'normal'}-`, dir => {
            const taskId = force ? 'ship-reuse-force' : 'ship-reuse';
            const { localDir, branch, fakeTools } = prepareShipFixture(dir, [taskId], {
                prNumbers: { [taskId]: 103 },
            });
            const staleSha = createUnrelatedCommit(localDir, branch);

            const result = runCanon(localDir, force ? [taskId, '--ship', '--force'] : [taskId, '--ship'], fakeTools, {
                FAKE_GH_PR_STATE: 'MERGED',
                FAKE_GH_BASE_REF_NAME: 'main',
                FAKE_GH_HEAD_REF_OID: staleSha,
            });

            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /not an ancestor/);
            expectTaskAndBranchSurvive(localDir, taskId, branch);
        });
    }
});

void test('--ship refuses unmerged work and base-in-sync without proof', () => {
    for (const syncBase of [false, true]) {
        withTempDir(`run-task-ship-unproven-${syncBase ? 'synced' : 'behind'}-`, dir => {
            const taskId = syncBase ? 'ship-unproven-synced' : 'ship-unproven';
            const { localDir, branch, fakeTools } = prepareShipFixture(dir, [taskId], {
                mergeToOrigin: syncBase,
                deleteRemote: true,
                syncBase,
            });

            const result = runCanon(localDir, [taskId, '--ship'], fakeTools);

            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /merge proof could not be established/);
            expectTaskAndBranchSurvive(localDir, taskId, branch);
        });
    }
});

void test('--ship legacy fallback proves merged PR by ancestor-or-equal head', () => {
    withTempDir('run-task-ship-legacy-', dir => {
        const taskId = 'ship-legacy';
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId]);

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_MERGED_PR_NUMBER: '104',
            FAKE_GH_PR_HEAD: branch,
            FAKE_GH_PR_BASE: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.equal(result.status, 0, result.stderr);
        expectArchivedAndDeleted(localDir, taskId, branch);
    });
});

void test('--ship proves behind-local branch when local tip is an ancestor of PR head', () => {
    withTempDir('run-task-ship-behind-local-', dir => {
        const taskId = 'ship-behind-local';
        const { localDir, branch, tip, prHead, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 107 },
            advanceRemote: true,
        });

        assert.notEqual(tip, prHead);
        assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', tip, prHead], { cwd: localDir }).status, 0);

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: prHead,
        });

        assert.equal(result.status, 0, result.stderr);
        expectArchivedAndDeleted(localDir, taskId, branch);
    });
});

void test('--ship treats an unmaterializable PR head as unproven', () => {
    withTempDir('run-task-ship-missing-head-', dir => {
        const taskId = 'ship-missing-head';
        const { localDir, branch, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 108 },
        });
        const missingSha = 'f'.repeat(40);

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: missingSha,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /could not be materialized locally/);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship archives without proof when local branch is already gone', () => {
    withTempDir('run-task-ship-no-branch-', dir => {
        const taskId = 'ship-no-branch';
        const { localDir, branch, fakeTools } = prepareShipFixture(dir, [taskId], { syncBase: true });
        gitIn(localDir, 'branch', '-D', branch);

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools);

        assert.equal(result.status, 0, result.stderr);
        assert.ok(fs.existsSync(path.join(localDir, 'tasks', '_archive', taskId)));
    });
});

void test('--ship bundle proof is all-or-nothing', () => {
    withTempDir('run-task-ship-bundle-proof-', dir => {
        const taskIds = ['ship-bundle-a', 'ship-bundle-b'];
        const { localDir, branch, fakeTools } = prepareShipFixture(dir, taskIds, {
            prNumbers: { [taskIds[0]]: 105, [taskIds[1]]: 105 },
        });
        const unrelatedHead = createUnrelatedCommit(localDir, branch);

        const result = runCanon(localDir, [...taskIds, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: unrelatedHead,
        });

        assert.notEqual(result.status, 0);
        for (const taskId of taskIds) {
            assert.ok(!fs.existsSync(path.join(localDir, 'tasks', '_archive', taskId)));
            assert.ok(fs.existsSync(path.join(localDir, 'tasks', taskId)));
        }
        assert.equal(branchExists(localDir, branch), true);
    });
});

void test('--ship malformed sidecar fails closed instead of trusting the cast', () => {
    withTempDir('run-task-ship-malformed-pr-', dir => {
        const taskId = 'ship-malformed-pr';
        const { localDir, branch, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 'not-a-number' },
        });
        assert.equal(fs.readFileSync(path.join(localDir, 'tasks', taskId, '.pr-number'), 'utf8'), 'not-a-number');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /merge proof could not be established/);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship orphaned worktree state reads the sidecar without crashing', () => {
    withTempDir('run-task-ship-orphaned-worktree-', dir => {
        const taskId = 'ship-orphaned-worktree';
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 109 },
        });
        const statusPath = path.join(localDir, 'tasks', taskId, 'status.json');
        const status = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as Record<string, unknown>;
        status.worktree = true;
        fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.equal(result.status, 0, result.stderr);
        expectArchivedAndDeleted(localDir, taskId, branch);
    });
});
