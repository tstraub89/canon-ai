import { DEFAULT_PROTECTED_DOCS } from '../src/orchestrator/docs-freshness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { REPO_ROOT } from '../src/orchestrator/env.js';
import { buildHumanReviewStagePaths, commitQaArtifacts } from '../src/orchestrator/main.js';
import { ensureBranch, ensureCheckedOutBaseBranch, findDirtyRepoRootSourcePaths } from '../src/orchestrator/git.js';
import { commitArchiveChanges, stageArchiveChanges } from '../src/orchestrator/main.js';
import { resolveTaskCwd } from '../src/orchestrator/state.js';
import { classifyNodeModulesLinkFromData, isContainedIn, resolveWorkspaceDirs } from '../src/orchestrator/worktree.js';
import {
    WORKTREE_ROOT,
    canonicalizeTestPath,
    withTempDir,
    writeTaskStatus,
    setupFakeGit,
    setupFakeCliTools,
    withFakeGitEnv,
    runNodeInline,
    runMainInline,
    childEnvWithoutTasksOverride,
    gitIn,
    makeGitFixture,
    makeBootstrappedTaskWorktreeFixture,
    makeNodeModulesGateFixture,
    makeWorkspaceResolverFixture,
    captureConsoleError,
    makeWorkspaceNodeModulesGateFixture,
    makeEnsureWorktreeNodeModulesFixture,
    makeHumanReviewPendingStatus,
    makeCompleteStatus,
    writeAffectedFilesSpec,
    combinedOutput,
    writeQaArtifacts,
    runCommitQaArtifactsInline,
    runAutoCommitCodeInline,
    runEnsureWorktreeInline,
    runIsExemptNodeModulesEntryInline,
    writeImplementEvidenceFixture,
    makeAutoCommitFixture,
    latestNameStatuses,
    commitIgnoreRules,
    gitDirWritable,
} from './run-task-safety-helpers.js';


void test('autoCommitCode still commits a tracked file that matches an ignore rule', () => {
    withTempDir('run-task-autocommit-tracked-ignored-', dir => {
        const localDir = makeAutoCommitFixture(dir, { 'settings.cfg': 'a=1\n' }, ['`settings.cfg`']);
        commitIgnoreRules(localDir, '*.cfg\n');
        fs.writeFileSync(path.join(localDir, 'settings.cfg'), 'a=2\n', 'utf8');

        const result = runAutoCommitCodeInline('task-a', localDir);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(latestNameStatuses(localDir), new Set(['M\tsettings.cfg']));
    });
});

void test('autoCommitCode accepts a listed task artifact that matches the base', () => {
    withTempDir('run-task-autocommit-identical-artifact-', dir => {
        const localDir = makeAutoCommitFixture(dir, { 'a.ts': 'export const a = 1;\n' }, ['`a.ts`', '`tasks/task-a/spec.md`']);
        fs.writeFileSync(path.join(localDir, 'a.ts'), 'export const a = 2;\n', 'utf8');

        const result = runAutoCommitCodeInline('task-a', localDir);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(latestNameStatuses(localDir), new Set(['M\ta.ts']));
    });
});

void test('autoCommitCode accepts a listed own task artifact that does not exist, beside a dirty source file', () => {
    withTempDir('run-task-autocommit-missing-own-artifact-', dir => {
        const localDir = makeAutoCommitFixture(dir, { 'a.ts': 'export const a = 1;\n' }, ['`a.ts`', '`tasks/task-a/never-written.md`']);
        fs.writeFileSync(path.join(localDir, 'a.ts'), 'export const a = 2;\n', 'utf8');

        const result = runAutoCommitCodeInline('task-a', localDir);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(latestNameStatuses(localDir), new Set(['M\ta.ts']));
    });
});

void test('autoCommitCode does not exempt another bundle member\'s artifact listed in a handoff', () => {
    withTempDir('run-task-autocommit-foreign-artifact-', dir => {
        const localDir = makeAutoCommitFixture(dir, { 'a.ts': 'export const a = 1;\n' }, ['`a.ts`', '`tasks/task-b/spec.md`']);
        gitIn(localDir, 'checkout', 'main');
        const tasksRoot = path.join(localDir, 'tasks');
        writeImplementEvidenceFixture(tasksRoot, 'task-b', ['`a.ts`']);
        writeTaskStatus(tasksRoot, 'task-b', makeCompleteStatus('task-b', 'task/task-a'));
        gitIn(localDir, 'add', '--', 'tasks/task-b');
        gitIn(localDir, 'commit', '-m', 'second bundle member');
        gitIn(localDir, 'checkout', '-B', 'task/task-a', 'main');
        fs.writeFileSync(path.join(localDir, 'a.ts'), 'export const a = 2;\n', 'utf8');

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            `.then(m => { m.autoCommitCode(['task-a', 'task-b'], ${JSON.stringify(localDir)}); })`,
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), childEnvWithoutTasksOverride(), localDir);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /tasks\/task-b\/spec\.md — no commit touches this path/);
    });
});

void test('autoCommitCode restores the pre-existing index when git add fails partway', () => {
    withTempDir('run-task-autocommit-add-failure-reset-', dir => {
        const localDir = makeAutoCommitFixture(dir, { 'a.ts': 'export const a = 1;\n' }, ['`a.ts`', '`vendor/kept.ts`']);
        fs.mkdirSync(path.join(localDir, 'vendor'));
        fs.writeFileSync(path.join(localDir, 'vendor', 'kept.ts'), 'export const k = 1;\n', 'utf8');
        gitIn(localDir, 'add', 'vendor/kept.ts');
        gitIn(localDir, 'commit', '-m', 'track vendored file');
        // A tracked file under an ignored directory: `git add` stages it but
        // exits 1, after already staging `a.ts`.
        commitIgnoreRules(localDir, 'vendor/\n');
        // Version 2 of a.ts is staged before auto-commit runs and version 3 is
        // only in the working tree. A failed add must leave version 2 staged.
        fs.writeFileSync(path.join(localDir, 'a.ts'), 'export const a = 2;\n', 'utf8');
        gitIn(localDir, 'add', 'a.ts');
        fs.writeFileSync(path.join(localDir, 'a.ts'), 'export const a = 3;\n', 'utf8');
        fs.writeFileSync(path.join(localDir, 'vendor', 'kept.ts'), 'export const k = 2;\n', 'utf8');
        // An intent-to-add entry has no blob in the index tree; it must survive too.
        fs.writeFileSync(path.join(localDir, 'a-planned.ts'), 'export const p = 1;\n', 'utf8');
        gitIn(localDir, 'add', '-N', 'a-planned.ts');

        const result = runAutoCommitCodeInline('task-a', localDir);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Failed to stage files/);
        assert.equal(execFileSync('git', ['ls-files', '--', 'a-planned.ts'], { cwd: localDir, encoding: 'utf8' }), 'a-planned.ts\n');
        assert.equal(
            execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: localDir, encoding: 'utf8' }),
            'a.ts\n',
        );
        assert.equal(execFileSync('git', ['show', ':a.ts'], { cwd: localDir, encoding: 'utf8' }), 'export const a = 2;\n');
    });
});

void test('checkAndRoute commits a staged deletion for a non-worktree implement task', () => {
    withTempDir('run-task-routed-staged-deletion-', dir => {
        const localDir = makeAutoCommitFixture(dir, { 'dead.ts': 'export const dead = true;\n' }, ['`dead.ts`']);
        const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: localDir, encoding: 'utf8' }).trim();
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);
        gitIn(localDir, 'rm', 'dead.ts');

        const moduleUrl = pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href;
        const result = runNodeInline([
            `import(${JSON.stringify(moduleUrl)})`,
            ".then(m => m.checkAndRoute('implement', ['task-a']))",
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), childEnvWithoutTasksOverride({
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }), localDir);

        assert.equal(result.status, 0, result.stderr);
        const status = JSON.parse(fs.readFileSync(path.join(localDir, 'tasks/task-a/status.json'), 'utf8')) as {
            phases: { implement: { status: string } };
        };
        assert.equal(status.phases.implement.status, 'done');
        assert.equal(execFileSync('git', ['rev-list', '--count', `${before}..HEAD`], { cwd: localDir, encoding: 'utf8' }).trim(), '1');
        assert.deepEqual(latestNameStatuses(localDir), new Set(['D\tdead.ts']));
        assert.equal(execFileSync('git', ['status', '--porcelain=v1', '-uall'], { cwd: localDir, encoding: 'utf8' }), '');
    });
});

void test('implement evidence recognizes a removed path paired with an intent-to-add rename', () => {
    withTempDir('run-task-evidence-intent-rename-', dir => {
        const localDir = makeAutoCommitFixture(dir, { 'old.ts': 'export const value = 1;\n' }, ['`old.ts`']);
        fs.renameSync(path.join(localDir, 'old.ts'), path.join(localDir, 'new.ts'));
        gitIn(localDir, 'add', '-N', 'new.ts');

        const detected = execFileSync('git', ['diff', 'HEAD', '--name-only', '--diff-filter=D'], {
            cwd: localDir, encoding: 'utf8',
        });
        assert.equal(detected, '');
        const withoutRenames = execFileSync('git', ['diff', 'HEAD', '--name-only', '--no-renames', '--diff-filter=D'], {
            cwd: localDir, encoding: 'utf8',
        }).trim();
        assert.equal(withoutRenames, 'old.ts');

        const moduleUrl = pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href;
        const result = runNodeInline([
            `import(${JSON.stringify(moduleUrl)})`,
            ".then(m => { const evidence = m.tryEvidenceAdvance('task-a', 'implement');",
            '  if (!evidence.advanced) { console.error(evidence.note); process.exit(2); } })',
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), childEnvWithoutTasksOverride(), localDir);

        assert.equal(result.status, 0, result.stderr);
    });
});

void test('autoCommitCode commits staged deletion and edit together', () => {
    withTempDir('run-task-autocommit-staged-mixed-', dir => {
        const localDir = makeAutoCommitFixture(dir, {
            'dead.ts': 'export const dead = true;\n',
            'keep.ts': 'export const keep = 1;\n',
        }, ['`dead.ts`', '`keep.ts`']);
        const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: localDir, encoding: 'utf8' }).trim();
        gitIn(localDir, 'rm', 'dead.ts');
        fs.writeFileSync(path.join(localDir, 'keep.ts'), 'export const keep = 2;\n');

        const result = runAutoCommitCodeInline('task-a', localDir);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(execFileSync('git', ['rev-list', '--count', `${before}..HEAD`], { cwd: localDir, encoding: 'utf8' }).trim(), '1');
        assert.deepEqual(latestNameStatuses(localDir), new Set(['D\tdead.ts', 'M\tkeep.ts']));
    });
});

void test('autoCommitCode commits both sides of a staged rename', () => {
    withTempDir('run-task-autocommit-staged-rename-', dir => {
        const localDir = makeAutoCommitFixture(dir, { 'old.ts': 'export const value = 1;\n' }, [
            '`old.ts`', '`new.ts`',
        ]);
        gitIn(localDir, 'mv', 'old.ts', 'new.ts');

        const result = runAutoCommitCodeInline('task-a', localDir);
        assert.equal(result.status, 0, result.stderr);
        const tree = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: localDir, encoding: 'utf8' }).split('\n');
        assert.ok(!tree.includes('old.ts'));
        assert.ok(tree.includes('new.ts'));
    });
});

void test('autoCommitCode still stages an unstaged deletion', () => {
    withTempDir('run-task-autocommit-unstaged-deletion-', dir => {
        const localDir = makeAutoCommitFixture(dir, { 'dead.ts': 'export const dead = true;\n' }, ['`dead.ts`']);
        fs.rmSync(path.join(localDir, 'dead.ts'));

        const result = runAutoCommitCodeInline('task-a', localDir);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(latestNameStatuses(localDir), new Set(['D\tdead.ts']));
    });
});

void test('commitQaArtifacts commits a staged deletion of a telemetry file', () => {
    withTempDir('run-task-qa-end-staged-deletion-', dir => {
        const { localDir } = makeGitFixture(dir);
        fs.mkdirSync(path.join(localDir, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), 'telemetry\n');
        gitIn(localDir, 'add', 'docs/pipeline-invocations.md');
        gitIn(localDir, 'commit', '-m', 'add telemetry file');
        const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: localDir, encoding: 'utf8' }).trim();
        gitIn(localDir, 'rm', 'docs/pipeline-invocations.md');
        writeQaArtifacts(localDir, 'task-a');

        const result = runCommitQaArtifactsInline('task-a', localDir);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(execFileSync('git', ['rev-list', '--count', `${before}..HEAD`], { cwd: localDir, encoding: 'utf8' }).trim(), '1');
        assert.ok(latestNameStatuses(localDir).has('D\tdocs/pipeline-invocations.md'));
        assert.ok([...latestNameStatuses(localDir)].some(entry => entry.startsWith('A\ttasks/task-a/')));
        assert.equal(execFileSync('git', ['status', '--porcelain=v1', '-uall'], { cwd: localDir, encoding: 'utf8' }), '');
    });
});

void test('ensureBranch creates a task branch from the declared release base, not main', () => {
    withTempDir('run-task-safety-branch-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const logPath = path.join(dir, 'git.log');
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'main\n');
        setupFakeGit(fakeGitDir);

        const taskId = 'release-task';
        const taskBranch = `task/${taskId}`;
        const taskStatus = {
            title: taskId,
            base_branch: 'release/v1',
            branch: '',
            worktree: false,
            phases: {},
        };
        writeTaskStatus(tasksRoot, taskId, taskStatus);

        withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: logPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'release/v1',
            FAKE_GIT_TASK_BRANCH: taskBranch,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        }, () => {
            ensureBranch([taskId]);
        });

        const log = fs.readFileSync(logPath, 'utf8').trim().split('\n');
        assert.ok(log.includes('rev-parse --abbrev-ref HEAD'));
        assert.ok(log.includes('show-ref --verify --quiet refs/heads/release/v1'));
        assert.ok(log.indexOf('checkout release/v1') < log.indexOf(`checkout -b ${taskBranch}`));

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as { branch?: string };
        assert.equal(updated.branch, taskBranch);
    });
});

void test('findDirtyRepoRootSourcePaths allows task artifacts and telemetry only', () => {
    const dirty = findDirtyRepoRootSourcePaths([
        ' M tasks/example/spec.md',
        '?? tasks/example/handoff.md',
        ' M docs/pipeline-invocations.md',
        ' M docs/task-quality-log.md',
        ' M docs/lessons-learned.md',
        '?? .canon/provenance.json',
        ' M .canon/version',
        ' M src/feature.ts',
        '?? scripts/local-check.ts',
        '',
    ].join('\n'));

    assert.deepEqual(dirty, ['.canon/version', 'src/feature.ts', 'scripts/local-check.ts']);
});

void test('ensureBranch rejects first worktree creation when REPO_ROOT has dirty source files', () => {
    withTempDir('run-task-safety-worktree-dirty-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const logPath = path.join(dir, 'git.log');
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'release/v1\n');
        setupFakeGit(fakeGitDir);

        const taskId = 'dirty-worktree-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'release/v1',
            branch: '',
            worktree: true,
            phases: {},
        });

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: logPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'release/v1',
            FAKE_GIT_TASK_BRANCH: `task/${taskId}`,
            FAKE_GIT_STATUS_OUTPUT: ' M src/dirty.ts',
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { ensureBranch } from './src/orchestrator/git.js';",
            `ensureBranch(${JSON.stringify([taskId])});`,
        ].join('\n'), env));

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Worktree creation aborted/);
        assert.match(result.stderr, /src\/dirty\.ts/);

        const log = fs.readFileSync(logPath, 'utf8');
        assert.doesNotMatch(log, /worktree add/);
    });
});

void test('ensureBranch allows first worktree creation when only task artifacts and telemetry are dirty', () => {
    withTempDir('run-task-safety-worktree-allowed-dirty-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const logPath = path.join(dir, 'git.log');
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'release/v1\n');
        setupFakeGit(fakeGitDir);

        const taskId = 'allowed-dirty-worktree';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'release/v1',
            branch: '',
            worktree: true,
            phases: {},
        });

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: logPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'release/v1',
            FAKE_GIT_TASK_BRANCH: `task/${taskId}`,
            FAKE_GIT_STATUS_OUTPUT: [
                ' M tasks/allowed-dirty-worktree/spec.md',
                ' M docs/pipeline-invocations.md',
            ].join('\n'),
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { ensureBranch } from './src/orchestrator/git.js';",
            `ensureBranch(${JSON.stringify([taskId])});`,
        ].join('\n'), env));

        assert.equal(result.status, 0, result.stderr);
        const log = fs.readFileSync(logPath, 'utf8');
        assert.ok(log.includes(`worktree add -b task/${taskId} ${path.join(worktreesRoot, taskId)} release/v1`));
        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as { branch?: string };
        assert.equal(updated.branch, `task/${taskId}`);
    });
});

void test('ensureBranch ticks active heartbeats into the worktree task dir after first worktree creation', () => {
    withTempDir('run-task-safety-worktree-heartbeat-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const logPath = path.join(dir, 'git.log');
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'release/v1\n');
        setupFakeGit(fakeGitDir);

        const taskId = 'heartbeat-worktree-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'release/v1',
            branch: '',
            worktree: true,
            phases: {},
        });

        const sourceTaskDir = path.join(tasksRoot, taskId);
        const worktreeTaskDir = path.join(worktreesRoot, taskId, 'tasks', taskId);
        const sourceHeartbeatFile = path.join(sourceTaskDir, '.heartbeat.json');
        const worktreeHeartbeatFile = path.join(worktreeTaskDir, '.heartbeat.json');

        assert.ok(!fs.existsSync(worktreeHeartbeatFile), 'worktree heartbeat must not exist before worktree creation');

        const childScript = [
            "import fs from 'node:fs';",
            "import path from 'node:path';",
            "import { startHeartbeat } from './src/orchestrator/heartbeat.js';",
            "import { ensureBranch } from './src/orchestrator/git.js';",
            `const taskId = ${JSON.stringify(taskId)};`,
            `const worktreesRoot = ${JSON.stringify(worktreesRoot)};`,
            `const sourceHeartbeatFile = ${JSON.stringify(sourceHeartbeatFile)};`,
            `const sourceTaskDir = ${JSON.stringify(sourceTaskDir)};`,
            "let suppressFlip = false;",
            "const handle = startHeartbeat([taskId], () => {",
            "  if (suppressFlip) return sourceTaskDir;",
            "  const worktreeStatusFile = path.join(worktreesRoot, taskId, 'tasks', taskId, 'status.json');",
            "  return fs.existsSync(worktreeStatusFile)",
            "    ? path.join(worktreesRoot, taskId, 'tasks', taskId)",
            "    : sourceTaskDir;",
            "}, { intervalMs: 999_999 });",
            "try {",
            "  if (!fs.existsSync(sourceHeartbeatFile)) throw new Error('initial heartbeat missing before worktree creation');",
            "  ensureBranch([taskId]);",
            "  suppressFlip = true;",
            "} finally {",
            "  handle.stop();",
            "}",
            "console.log(`CHILD_PID:${process.pid}`);",
        ].join('\n');

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: logPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'release/v1',
            FAKE_GIT_TASK_BRANCH: `task/${taskId}`,
            FAKE_GIT_WORKTREE_STATUS_SOURCE: path.join(sourceTaskDir, 'status.json'),
            FAKE_GIT_WORKTREE_TASK_ID: taskId,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline(childScript, env));

        assert.equal(result.status, 0, result.stderr);
        const childPidMatch = result.stdout.match(/CHILD_PID:(\d+)/);
        assert.ok(childPidMatch, `child pid marker missing from stdout: ${result.stdout}`);
        const childPid = Number(childPidMatch[1]);
        assert.ok(fs.existsSync(worktreeHeartbeatFile), 'worktree heartbeat must be written by the creation-path tick');
        const record = JSON.parse(fs.readFileSync(worktreeHeartbeatFile, 'utf8')) as { pid: number; last_update_ms: number };
        assert.equal(record.pid, childPid);
        assert.ok(Date.now() - record.last_update_ms < 1_000);

        const log = fs.readFileSync(logPath, 'utf8');
        assert.match(log, /worktree add -b task\/heartbeat-worktree-task/);
    });
});

void test('ensureBranch ticks active heartbeats into every bundled worktree task dir after first worktree creation', () => {
    withTempDir('run-task-safety-worktree-bundle-heartbeat-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const logPath = path.join(dir, 'git.log');
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'release/v1\n');
        setupFakeGit(fakeGitDir);

        const primaryTaskId = 'bundle-heartbeat-primary';
        const secondaryTaskId = 'bundle-heartbeat-secondary';
        const taskIds = [primaryTaskId, secondaryTaskId];
        const taskBranch = `task/${primaryTaskId}`;
        const sourcePrimaryTaskDir = path.join(tasksRoot, primaryTaskId);
        const primaryWorktreeTaskDir = path.join(worktreesRoot, primaryTaskId, 'tasks', primaryTaskId);
        const secondaryWorktreeTaskDir = path.join(worktreesRoot, primaryTaskId, 'tasks', secondaryTaskId);

        writeTaskStatus(tasksRoot, primaryTaskId, {
            title: primaryTaskId,
            base_branch: 'release/v1',
            branch: '',
            worktree: true,
            phases: {},
        });
        writeTaskStatus(tasksRoot, secondaryTaskId, {
            title: secondaryTaskId,
            base_branch: 'release/v1',
            branch: '',
            worktree: true,
            phases: {},
        });

        const childScript = [
            "import fs from 'node:fs';",
            "import path from 'node:path';",
            "import { startHeartbeat } from './src/orchestrator/heartbeat.js';",
            "import { ensureBranch } from './src/orchestrator/git.js';",
            `const taskIds = ${JSON.stringify(taskIds)};`,
            `const primaryTaskId = ${JSON.stringify(primaryTaskId)};`,
            `const tasksRoot = ${JSON.stringify(tasksRoot)};`,
            `const worktreesRoot = ${JSON.stringify(worktreesRoot)};`,
            `const sourcePrimaryTaskDir = ${JSON.stringify(sourcePrimaryTaskDir)};`,
            `const primaryWorktreeTaskDir = ${JSON.stringify(primaryWorktreeTaskDir)};`,
            `const secondaryWorktreeTaskDir = ${JSON.stringify(secondaryWorktreeTaskDir)};`,
            "const resolveTaskDir = (taskId) => {",
            "  const sourceStatusPath = path.join(tasksRoot, taskId, 'status.json');",
            "  if (taskId === primaryTaskId && fs.existsSync(path.join(primaryWorktreeTaskDir, 'status.json'))) {",
            "    return primaryWorktreeTaskDir;",
            "  }",
            "  if (fs.existsSync(sourceStatusPath)) {",
            "    const status = JSON.parse(fs.readFileSync(sourceStatusPath, 'utf8'));",
            "    if (status.worktree === true && String(status.branch ?? '').trim()) {",
            "      return path.join(worktreesRoot, primaryTaskId, 'tasks', taskId);",
            "    }",
            "  }",
            "  return path.join(tasksRoot, taskId);",
            "};",
            "startHeartbeat(taskIds, resolveTaskDir, { intervalMs: 999_999 });",
            "if (!fs.existsSync(sourcePrimaryTaskDir + '/.heartbeat.json')) throw new Error('initial primary heartbeat missing before worktree creation');",
            "if (!fs.existsSync(path.join(tasksRoot, taskIds[1], '.heartbeat.json'))) throw new Error('initial secondary heartbeat missing before worktree creation');",
            "ensureBranch(taskIds);",
            "for (const taskId of taskIds) {",
            "  const worktreeHeartbeatFile = path.join(worktreesRoot, primaryTaskId, 'tasks', taskId, '.heartbeat.json');",
            "  if (!fs.existsSync(worktreeHeartbeatFile)) throw new Error(`${taskId} worktree heartbeat missing after branch recording`);",
            "  const record = JSON.parse(fs.readFileSync(worktreeHeartbeatFile, 'utf8'));",
            "  if (record.pid !== process.pid) throw new Error(`${taskId} heartbeat pid mismatch`);",
            "  if (Date.now() - record.last_update_ms >= 1_000) throw new Error(`${taskId} heartbeat stale after branch recording`);",
            "}",
            "console.log(`CHILD_PID:${process.pid}`);",
        ].join('\n');

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: logPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'release/v1',
            FAKE_GIT_TASK_BRANCH: taskBranch,
            FAKE_GIT_WORKTREE_STATUS_SOURCE: path.join(sourcePrimaryTaskDir, 'status.json'),
            FAKE_GIT_WORKTREE_TASK_ID: primaryTaskId,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline(childScript, env));

        const log = fs.readFileSync(logPath, 'utf8');
        assert.ok(log.includes(`worktree add -b ${taskBranch} ${path.join(worktreesRoot, primaryTaskId)} release/v1`));
        assert.equal(result.status, 0, result.stderr);
        const childPidMatch = result.stdout.match(/CHILD_PID:(\d+)/);
        assert.ok(childPidMatch, `child pid marker missing from stdout: ${result.stdout}`);
        const childPid = Number(childPidMatch[1]);
        for (const taskId of taskIds) {
            const worktreeHeartbeatFile = path.join(worktreesRoot, primaryTaskId, 'tasks', taskId, '.heartbeat.json');
            assert.ok(fs.existsSync(worktreeHeartbeatFile), `${taskId} worktree heartbeat must exist after branch recording`);
            const record = JSON.parse(fs.readFileSync(worktreeHeartbeatFile, 'utf8')) as { pid: number; last_update_ms: number };
            assert.equal(record.pid, childPid);
            assert.ok(Date.now() - record.last_update_ms < 1_000);
        }
        const updatedPrimary = JSON.parse(fs.readFileSync(path.join(tasksRoot, primaryTaskId, 'status.json'), 'utf8')) as { branch?: string };
        const updatedSecondary = JSON.parse(fs.readFileSync(path.join(tasksRoot, secondaryTaskId, 'status.json'), 'utf8')) as { branch?: string };
        assert.equal(updatedPrimary.branch, taskBranch);
        assert.equal(updatedSecondary.branch, taskBranch);
    });
});

void test('ensureBranch force-bypasses dirty source guard for first worktree creation', () => {
    withTempDir('run-task-safety-worktree-dirty-force-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const logPath = path.join(dir, 'git.log');
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'release/v1\n');
        setupFakeGit(fakeGitDir);

        const taskId = 'force-dirty-worktree';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'release/v1',
            branch: '',
            worktree: true,
            phases: {},
        });

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: logPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'release/v1',
            FAKE_GIT_TASK_BRANCH: `task/${taskId}`,
            FAKE_GIT_STATUS_OUTPUT: ' M src/dirty.ts',
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { ensureBranch } from './src/orchestrator/git.js';",
            `ensureBranch(${JSON.stringify([taskId])}, { force: true });`,
        ].join('\n'), env));

        assert.equal(result.status, 0, result.stderr);
        const log = fs.readFileSync(logPath, 'utf8');
        assert.ok(log.includes(`worktree add -b task/${taskId} ${path.join(worktreesRoot, taskId)} release/v1`));
    });
});

void test('ensureBranch bypasses dirty source guard when worktree branch is already recorded', () => {
    withTempDir('run-task-safety-worktree-existing-dirty-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const logPath = path.join(dir, 'git.log');
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'release/v1\n');
        setupFakeGit(fakeGitDir);

        const taskId = 'existing-dirty-worktree';
        const taskBranch = `task/${taskId}`;
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'release/v1',
            branch: taskBranch,
            worktree: true,
            phases: {},
        });

        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${path.join(worktreesRoot, taskId)}`,
            'HEAD abc123',
            `branch refs/heads/${taskBranch}`,
            '',
        ].join('\n'), 'utf8');

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: logPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'release/v1',
            FAKE_GIT_TASK_BRANCH: taskBranch,
            FAKE_GIT_STATUS_OUTPUT: ' M src/dirty.ts',
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { ensureBranch } from './src/orchestrator/git.js';",
            `ensureBranch(${JSON.stringify([taskId])});`,
        ].join('\n'), env));
        assert.equal(result.status, 0, result.stderr);

        const log = fs.readFileSync(logPath, 'utf8');
        assert.doesNotMatch(log, /status --porcelain=v1 -uall/);
        assert.doesNotMatch(log, /worktree add/);
        assert.match(log, /worktree list --porcelain/);
    });
});

void test('ensureCheckedOutBaseBranch switches to the declared base before shipping', () => {
    withTempDir('run-task-safety-ship-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const logPath = path.join(dir, 'git.log');
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/release-task\n');
        setupFakeGit(fakeGitDir);

        const taskId = 'release-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'release/v1',
            branch: `task/${taskId}`,
            worktree: false,
            phases: {},
        });

        withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: logPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'release/v1',
            FAKE_GIT_TASK_BRANCH: `task/${taskId}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        }, () => {
            const base = ensureCheckedOutBaseBranch([taskId]);
            assert.equal(base, 'release/v1');
        });

        const log = fs.readFileSync(logPath, 'utf8').trim().split('\n');
        assert.ok(log.includes('rev-parse --abbrev-ref HEAD'));
        assert.ok(log.includes('show-ref --verify --quiet refs/heads/release/v1'));
        assert.ok(log.includes('checkout release/v1'));
    });
});

void test('commitArchiveChanges stops before push when archive commit fails', () => {
    withTempDir('run-task-safety-archive-', dir => {
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const logPath = path.join(dir, 'git.log');
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'main\n');
        setupFakeGit(fakeGitDir);

        withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: logPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'main',
            FAKE_GIT_TASK_BRANCH: 'task/example',
            FAKE_GIT_DIFF_OUTPUT: 'tasks/example/status.json',
            FAKE_GIT_FAIL_COMMIT: '1',
        }, () => {
            stageArchiveChanges(['tasks/example']);
            const result = commitArchiveChanges(['example'], 'main');
            assert.deepEqual(result, { committed: false, stderr: 'commit failed' });
        });

        const log = fs.readFileSync(logPath, 'utf8');
        assert.match(log, /add -A -- tasks\/example/);
        assert.match(log, /diff --cached --name-only/);
        assert.match(log, /commit -m chore: archive example/);
        assert.doesNotMatch(log, /push origin main/);
    });
});

void test('ensureBranch records a bundle secondary\'s branch in the worktree, never main', () => {
    withTempDir('run-task-safety-bundle-wrong-main-', dir => {
        const { localDir } = makeGitFixture(dir);
        const worktreesRoot = path.join(dir, 'worktrees');
        const leaderId = 'bundle-leader';
        const secondaryId = 'bundle-secondary';
        const taskBranch = `task/${leaderId}`;

        writeTaskStatus(path.join(localDir, 'tasks'), leaderId, {
            title: leaderId,
            base_branch: 'main',
            branch: '',
            worktree: true,
            phases: {},
        });
        writeTaskStatus(path.join(localDir, 'tasks'), secondaryId, {
            title: secondaryId,
            base_branch: 'main',
            branch: '',
            worktree: true,
            phases: {},
        });
        gitIn(localDir, 'add', 'tasks');
        gitIn(localDir, 'commit', '-m', 'task artifacts pre-pipeline');

        const gitModuleUrl = pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/git.ts')).href;
        const ensureResult = runNodeInline([
            `import(${JSON.stringify(gitModuleUrl)})`,
            `.then(m => { m.ensureBranch(${JSON.stringify([leaderId, secondaryId])}); })`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({ CANON_WORKTREES_ROOT: worktreesRoot }), localDir);
        assert.equal(ensureResult.status, 0, ensureResult.stderr);

        const leaderWorktree = path.join(worktreesRoot, leaderId);
        const worktreeSecondaryStatus = JSON.parse(
            fs.readFileSync(path.join(leaderWorktree, 'tasks', secondaryId, 'status.json'), 'utf8'),
        ) as { branch?: string };
        assert.equal(worktreeSecondaryStatus.branch, taskBranch);

        const mainSecondaryStatus = JSON.parse(
            fs.readFileSync(path.join(localDir, 'tasks', secondaryId, 'status.json'), 'utf8'),
        ) as { branch?: string };
        assert.equal(mainSecondaryStatus.branch, '');
        const mainStatus = execFileSync('git', ['status', '--porcelain', '--', `tasks/${secondaryId}/status.json`], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.equal(mainStatus, '');

        const stateModuleUrl = pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/state.ts')).href;
        const resolveResult = runNodeInline([
            `import(${JSON.stringify(stateModuleUrl)})`,
            `.then(m => { console.log(m.resolveTaskCwd(${JSON.stringify(secondaryId)})); })`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({ CANON_WORKTREES_ROOT: worktreesRoot }), localDir);
        assert.equal(resolveResult.status, 0, resolveResult.stderr);
        assert.equal(resolveResult.stdout.trim(), fs.realpathSync(leaderWorktree));
    });
});

void test('resolveTaskCwd routes worktree-backed secondary tasks to the primary worktree', () => {
    withTempDir('run-task-safety-worktree-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/shared\n');
        setupFakeGit(fakeGitDir);

        const primaryTaskId = 'task-a';
        const secondaryTaskId = 'task-b';
        const primaryWorktree = path.join(worktreesRoot, primaryTaskId);
        fs.mkdirSync(path.join(primaryWorktree, 'tasks', primaryTaskId), { recursive: true });
        fs.writeFileSync(path.join(primaryWorktree, 'tasks', primaryTaskId, 'status.json'), '{}\n', 'utf8');

        writeTaskStatus(tasksRoot, primaryTaskId, {
            title: primaryTaskId,
            base_branch: 'main',
            branch: 'task/shared',
            worktree: true,
            phases: {},
        });
        writeTaskStatus(tasksRoot, secondaryTaskId, {
            title: secondaryTaskId,
            base_branch: 'main',
            branch: 'task/shared',
            worktree: true,
            phases: {},
        });

        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${primaryWorktree}`,
            'HEAD abc123',
            'branch refs/heads/task/shared',
            '',
        ].join('\n'), 'utf8');

        withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, () => {
            const cwd = resolveTaskCwd(secondaryTaskId);
            assert.equal(cwd, primaryWorktree);
        });
    });
});

void test('resolveTaskCwd does not false-match an unrelated worktree that only inherited the task dir', () => {
    withTempDir('run-task-safety-scan-inherited-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'scan-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'main',
            branch: '',
            worktree: true,
            phases: {},
        });

        const otherWorktree = path.join(dir, 'unrelated-worktree');
        writeTaskStatus(path.join(otherWorktree, 'tasks'), taskId, {
            worktree: true,
            branch: '',
            phases: {},
        });
        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${otherWorktree}`,
            'HEAD abc123',
            'branch refs/heads/some-other-branch',
            '',
        ].join('\n'), 'utf8');

        withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, () => {
            assert.equal(resolveTaskCwd(taskId), REPO_ROOT);
        });
    });
});

void test('resolveTaskCwd does not scan worktrees when main records worktree: false', () => {
    withTempDir('run-task-safety-scan-worktree-false-main-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'non-worktree-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'main',
            branch: '',
            worktree: false,
            phases: {},
        });

        const staleWorktree = path.join(dir, 'stale-worktree');
        writeTaskStatus(path.join(staleWorktree, 'tasks'), taskId, {
            worktree: true,
            branch: 'stale-branch',
            phases: {},
        });
        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${staleWorktree}`,
            'HEAD abc123',
            'branch refs/heads/stale-branch',
            '',
        ].join('\n'), 'utf8');

        withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, () => {
            assert.equal(resolveTaskCwd(taskId), REPO_ROOT);
        });
    });
});

void test('resolveTaskCwd does not match a worktree whose own status.json records worktree: false', () => {
    withTempDir('run-task-safety-scan-candidate-worktree-false-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'candidate-worktree-false';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'main',
            branch: '',
            worktree: true,
            phases: {},
        });

        const candidateWorktree = path.join(dir, 'candidate-worktree');
        writeTaskStatus(path.join(candidateWorktree, 'tasks'), taskId, {
            worktree: false,
            branch: 'candidate-branch',
            phases: {},
        });
        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${candidateWorktree}`,
            'HEAD abc123',
            'branch refs/heads/candidate-branch',
            '',
        ].join('\n'), 'utf8');

        withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, () => {
            assert.equal(resolveTaskCwd(taskId), REPO_ROOT);
        });
    });
});

void test('resolveTaskCwd dies naming candidates when two worktrees both claim ownership', () => {
    withTempDir('run-task-safety-scan-ambiguous-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'ambiguous-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'main',
            branch: '',
            worktree: true,
            phases: {},
        });

        const worktreeOne = path.join(dir, 'worktree-one');
        const worktreeTwo = path.join(dir, 'worktree-two');
        for (const [worktreePath, branch] of [[worktreeOne, 'branch-one'], [worktreeTwo, 'branch-two']] as const) {
            writeTaskStatus(path.join(worktreePath, 'tasks'), taskId, {
                worktree: true,
                branch,
                phases: {},
            });
        }
        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${worktreeOne}`,
            'HEAD abc123',
            'branch refs/heads/branch-one',
            '',
            `worktree ${worktreeTwo}`,
            'HEAD def456',
            'branch refs/heads/branch-two',
            '',
        ].join('\n'), 'utf8');

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { resolveTaskCwd } from './src/orchestrator/state.js';",
            `resolveTaskCwd(${JSON.stringify(taskId)});`,
        ].join('\n'), env));

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Multiple worktrees claim ownership/);
        assert.ok(result.stderr.includes(worktreeOne));
        assert.ok(result.stderr.includes(worktreeTwo));
    });
});

void test('resolveTaskCwd dies when git worktree list enumeration fails', () => {
    withTempDir('run-task-safety-scan-enum-fail-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'enum-fail-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'main',
            branch: '',
            worktree: true,
            phases: {},
        });

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FAIL: '1',
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { resolveTaskCwd } from './src/orchestrator/state.js';",
            `resolveTaskCwd(${JSON.stringify(taskId)});`,
        ].join('\n'), env));

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Could not enumerate git worktrees/);
    });
});

void test('resolveTaskCwd dies when a candidate status.json is present but unparseable', () => {
    withTempDir('run-task-safety-scan-invalid-json-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'invalid-json-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'main',
            branch: '',
            worktree: true,
            phases: {},
        });
        const candidateWorktree = path.join(dir, 'candidate-worktree');
        const candidateTaskDir = path.join(candidateWorktree, 'tasks', taskId);
        fs.mkdirSync(candidateTaskDir, { recursive: true });
        fs.writeFileSync(path.join(candidateTaskDir, 'status.json'), '{ not valid json', 'utf8');

        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${candidateWorktree}`,
            'HEAD abc123',
            'branch refs/heads/some-branch',
            '',
        ].join('\n'), 'utf8');
        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { resolveTaskCwd } from './src/orchestrator/state.js';",
            `resolveTaskCwd(${JSON.stringify(taskId)});`,
        ].join('\n'), env));

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /unreadable status\.json/);
    });
});

void test('resolveTaskCwd dies when a candidate status.json has a schema-invalid branch field', () => {
    withTempDir('run-task-safety-scan-invalid-schema-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'invalid-schema-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'main',
            branch: '',
            worktree: true,
            phases: {},
        });
        const candidateWorktree = path.join(dir, 'candidate-worktree');
        writeTaskStatus(path.join(candidateWorktree, 'tasks'), taskId, {
            worktree: true,
            branch: 123,
            phases: {},
        });

        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${candidateWorktree}`,
            'HEAD abc123',
            'branch refs/heads/some-branch',
            '',
        ].join('\n'), 'utf8');
        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { resolveTaskCwd } from './src/orchestrator/state.js';",
            `resolveTaskCwd(${JSON.stringify(taskId)});`,
        ].join('\n'), env));

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /unreadable status\.json/);
        assert.match(result.stderr, /expected string, got number/);
    });
});

void test('resolveTaskCwd fails closed when a worktree-backed task has no available worktree', () => {
    withTempDir('run-task-safety-worktree-missing-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'main\n');
        setupFakeGit(fakeGitDir);

        const taskId = 'orphaned-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'main',
            branch: 'task/orphaned',
            worktree: true,
            phases: {},
        });

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { resolveTaskCwd } from './src/orchestrator/state.js';",
            `console.log(resolveTaskCwd(${JSON.stringify(taskId)}));`,
        ].join('\n'), env));

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Worktree for task 'orphaned-task' is expected but missing/);
    });
});

void test('getActiveCwd fails closed when a worktree-backed bundle has no available worktree', () => {
    withTempDir('run-task-safety-worktree-active-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'bundle-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'main',
            branch: 'task/bundle',
            worktree: true,
            phases: {},
        });

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { getActiveCwd } from './src/orchestrator/worktree.js';",
            `console.log(getActiveCwd(${JSON.stringify([taskId])}));`,
        ].join('\n'), env));

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Worktree for task 'bundle-task' is expected but missing/);
    });
});

void test('REPO_ROOT stays anchored to the supervising checkout when imported from a linked worktree', {
    skip: gitDirWritable ? false : '.git/ writes are restricted in this environment (sandbox or linked worktree)',
}, () => {
    withTempDir('run-task-root-regression-', dir => {
        const worktreeDir = path.join(dir, 'linked-worktree');
        const addResult = spawnSync('git', ['worktree', 'add', '--detach', worktreeDir, 'HEAD'], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
        });
        assert.equal(addResult.status, 0, addResult.stderr ?? addResult.stdout ?? 'git worktree add failed');

        try {
            const result = runNodeInline([
                `import(${JSON.stringify(pathToFileURL(path.join(process.cwd(), 'src/orchestrator/env.ts')).href)})`,
                '.then(m => { console.log(m.REPO_ROOT); })',
                '.catch(err => { console.error(err); process.exit(1); });',
            ].join(''), process.env, worktreeDir);

            assert.equal(result.status, 0, result.stderr);
            assert.equal(result.stdout.trim(), REPO_ROOT);
        } finally {
            spawnSync('git', ['worktree', 'remove', '--force', worktreeDir], {
                cwd: REPO_ROOT,
                encoding: 'utf8',
            });
        }
    });
});

void test('classifyNodeModulesLinkFromData decision table', () => {
    const expected = '/repo/node_modules';
    assert.equal(
        classifyNodeModulesLinkFromData({ lstatKind: 'symlink', resolvedTarget: expected, expectedTarget: expected }),
        'verified-symlink',
    );
    assert.equal(
        classifyNodeModulesLinkFromData({ lstatKind: 'file', resolvedTarget: null, expectedTarget: expected }),
        'not-exempt',
    );
    assert.equal(
        classifyNodeModulesLinkFromData({ lstatKind: 'directory', resolvedTarget: null, expectedTarget: expected }),
        'not-exempt',
    );
    assert.equal(
        classifyNodeModulesLinkFromData({ lstatKind: 'symlink', resolvedTarget: '/other/node_modules', expectedTarget: expected }),
        'not-exempt',
    );
    assert.equal(
        classifyNodeModulesLinkFromData({ lstatKind: 'missing', resolvedTarget: null, expectedTarget: expected }),
        'not-exempt',
    );
});

void test('classifyNodeModulesLinkFromData fails closed on probe errors', () => {
    assert.equal(
        classifyNodeModulesLinkFromData({ lstatKind: 'error', resolvedTarget: null, expectedTarget: '/repo/node_modules' }),
        'not-exempt',
    );
    assert.equal(
        classifyNodeModulesLinkFromData({ lstatKind: 'symlink', resolvedTarget: null, expectedTarget: '/repo/node_modules' }),
        'not-exempt',
    );
    assert.equal(
        classifyNodeModulesLinkFromData({ lstatKind: 'symlink', resolvedTarget: '/repo/node_modules', expectedTarget: null }),
        'not-exempt',
    );
});

void test('resolveWorkspaceDirs selects the exact eligible npm workspace set', () => {
    const cases: Array<{ name: string; workspaces: unknown; expected: string[] }> = [
        { name: 'recursive glob', workspaces: ['packages/**'], expected: ['packages/a', 'packages/b'] },
        { name: 'multiple patterns', workspaces: ['packages/*', 'apps/*'], expected: ['apps/app', 'packages/a', 'packages/b'] },
        { name: 'literal', workspaces: ['packages/a'], expected: ['packages/a'] },
        { name: 'overlap', workspaces: ['packages/*', 'packages/a'], expected: ['packages/a', 'packages/b'] },
        { name: 'legacy object', workspaces: { packages: ['packages/*'] }, expected: ['packages/a', 'packages/b'] },
        { name: 'no match', workspaces: ['nope/*'], expected: [] },
        { name: 'empty array', workspaces: [], expected: [] },
        { name: 'non-collection', workspaces: 'packages/*', expected: [] },
        { name: 'non-string entry', workspaces: [42, 'packages/a'], expected: ['packages/a'] },
    ];
    withTempDir('run-task-workspace-resolver-', dir => {
        for (const fixtureCase of cases) {
            const caseDir = path.join(dir, fixtureCase.name.replaceAll(' ', '-'));
            fs.mkdirSync(caseDir, { recursive: true });
            const { repoRoot } = makeWorkspaceResolverFixture(caseDir, fixtureCase.workspaces);
            const actual = resolveWorkspaceDirs(repoRoot);
            assert.deepEqual(actual, fixtureCase.expected, fixtureCase.name);
            for (const workspace of actual) {
                assert.equal(path.isAbsolute(workspace), false);
                assert.notEqual(workspace, '');
                assert.notEqual(workspace, '.');
                assert.equal(workspace.split('/').includes('..'), false);
                assert.equal(workspace.split('/').includes('node_modules'), false);
            }
        }

        const absentDir = path.join(dir, 'absent');
        const { repoRoot: absentRoot } = makeWorkspaceResolverFixture(absentDir, []);
        fs.writeFileSync(path.join(absentRoot, 'package.json'), '{"name":"fixture"}\n', 'utf8');
        assert.deepEqual(resolveWorkspaceDirs(absentRoot), []);

        const invalidDir = path.join(dir, 'invalid-package-json');
        const { repoRoot: invalidRoot } = makeWorkspaceResolverFixture(invalidDir, ['packages/*']);
        fs.writeFileSync(path.join(invalidRoot, 'package.json'), '{not json', 'utf8');
        assert.deepEqual(resolveWorkspaceDirs(invalidRoot), []);
    });
});

void test('resolveWorkspaceDirs skips negations while retaining positive matches', () => {
    withTempDir('run-task-workspace-negation-', dir => {
        const { repoRoot } = makeWorkspaceResolverFixture(dir, ['!packages/a', 'packages/*']);
        const captured = captureConsoleError(() => resolveWorkspaceDirs(repoRoot));
        assert.deepEqual(captured.result, ['packages/a', 'packages/b']);
        assert.match(captured.stderr, /!packages\/a/);
    });
});

void test('resolveWorkspaceDirs enforces lexical and realpath source containment', () => {
    withTempDir('run-task-workspace-source-containment-', dir => {
        const { repoRoot, outsideRoot } = makeWorkspaceResolverFixture(
            dir,
            ['packages/*', '../outside/ext'],
        );
        const prefixSibling = `${repoRoot}-evil`;
        fs.mkdirSync(path.join(outsideRoot, 'ext'), { recursive: true });
        fs.writeFileSync(path.join(outsideRoot, 'ext/package.json'), '{"name":"outside"}\n', 'utf8');
        fs.mkdirSync(prefixSibling, { recursive: true });
        fs.writeFileSync(path.join(prefixSibling, 'package.json'), '{"name":"escape"}\n', 'utf8');
        fs.symlinkSync(prefixSibling, path.join(repoRoot, 'packages/escape'));
        fs.symlinkSync(path.join(outsideRoot, 'missing'), path.join(repoRoot, 'packages/dangling'));

        const captured = captureConsoleError(() => resolveWorkspaceDirs(repoRoot));
        assert.deepEqual(captured.result, ['packages/a', 'packages/b']);
        assert.match(captured.stderr, /\.\.\/outside\/ext/);
        assert.match(captured.stderr, /packages\/escape/);
        for (const workspace of captured.result) {
            assert.equal(path.isAbsolute(workspace), false);
            assert.equal(workspace.split('/').includes('..'), false);
            assert.equal(workspace.split('/').includes('node_modules'), false);
        }
    });
});

void test('isContainedIn compares canonical path segments and fails closed', () => {
    withTempDir('run-task-contained-in-', dir => {
        const root = path.join(dir, 'wt');
        const nested = path.join(root, 'packages/a');
        const sibling = path.join(dir, 'wt-evil');
        fs.mkdirSync(nested, { recursive: true });
        fs.mkdirSync(sibling, { recursive: true });
        assert.equal(isContainedIn(nested, root), true);
        assert.equal(isContainedIn(root, root), false);
        assert.equal(isContainedIn(sibling, root), false);
        assert.equal(isContainedIn(path.join(dir, 'missing'), root), false);
        assert.equal(isContainedIn(nested, path.join(dir, 'missing-root')), false);
    });
});

void test('workspace node_modules exemption rejects staged entries before probing', () => {
    withTempDir('run-task-workspace-staged-predicate-', dir => {
        const taskId = 'task-a';
        const { worktreeDir, repoWorkspaceModules } =
            makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        fs.symlinkSync(repoWorkspaceModules, path.join(worktreeDir, 'packages/a/node_modules'));

        const result = runIsExemptNodeModulesEntryInline({
            raw: 'A  packages/a/node_modules',
            indexStatus: 'A',
            worktreeStatus: ' ',
            paths: ['packages/a/node_modules'],
        }, worktreeDir);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), 'false');
    });
});

void test('buildHumanReviewStagePaths includes only task artifacts, telemetry, and affected managed docs', () => {
    const paths = buildHumanReviewStagePaths(['task-a'], new Set(['docs/codebase-map.md', 'docs/patterns.md']), [
        {
            raw: '?? tasks/task-a/handoff.md',
            indexStatus: '?',
            worktreeStatus: '?',
            paths: ['tasks/task-a/handoff.md'],
        },
        {
            raw: ' M docs/architecture.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['docs/architecture.md'],
        },
        {
            raw: ' M docs/codebase-map.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['docs/codebase-map.md'],
        },
        {
            raw: ' M docs/decisions.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['docs/decisions.md'],
        },
        {
            raw: ' M docs/patterns.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['docs/patterns.md'],
        },
        {
            raw: ' M docs/lessons-learned.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['docs/lessons-learned.md'],
        },
        {
            raw: '?? node_modules',
            indexStatus: '?',
            worktreeStatus: '?',
            paths: ['node_modules'],
        },
    ]);

    assert.deepEqual(paths, [
        'tasks/task-a',
        'docs/lessons-learned.md',
        'docs/codebase-map.md',
        'docs/patterns.md',
    ]);
});

void test('buildHumanReviewStagePaths with full managed-doc set includes only dirty QA-end paths', () => {
    const paths = buildHumanReviewStagePaths(['task-a'], new Set(DEFAULT_PROTECTED_DOCS), [
        {
            raw: ' M tasks/task-a/done.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['tasks/task-a/done.md'],
        },
        {
            raw: ' M tasks/task-a/pr-body.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['tasks/task-a/pr-body.md'],
        },
        {
            raw: ' M docs/codebase-map.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['docs/codebase-map.md'],
        },
        {
            raw: ' M docs/lessons-learned.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['docs/lessons-learned.md'],
        },
    ]);

    assert.ok(paths.includes('tasks/task-a'));
    assert.ok(paths.includes('docs/codebase-map.md'));
    assert.ok(paths.includes('docs/lessons-learned.md'));
    assert.ok(!paths.includes('docs/decisions.md'), 'non-dirty managed docs must not be staged from a hardcoded root list');
});

void test('buildHumanReviewStagePaths stages a QA-touched managed doc absent from Affected Files', () => {
    const paths = buildHumanReviewStagePaths(['task-b'], new Set(DEFAULT_PROTECTED_DOCS), [
        {
            raw: ' M docs/decisions.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['docs/decisions.md'],
        },
    ]);

    assert.deepEqual(paths, ['docs/decisions.md']);
});

void test('commitQaArtifacts commits task artifacts, telemetry, and managed docs from the active worktree', () => {
    withTempDir('run-task-qa-end-real-git-', dir => {
        const { localDir } = makeGitFixture(dir);
        writeQaArtifacts(localDir, 'task-a');
        fs.mkdirSync(path.join(localDir, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'docs', 'codebase-map.md'), 'qa doc freshness\n', 'utf8');
        fs.writeFileSync(path.join(localDir, 'docs', 'lessons-learned.md'), 'qa telemetry\n', 'utf8');

        commitQaArtifacts(['task-a'], localDir);

        const status = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.equal(status, '');
        const subject = execFileSync('git', ['log', '-1', '--pretty=%s'], {
            cwd: localDir,
            encoding: 'utf8',
        }).trim();
        assert.equal(subject, 'chore: QA artifacts for task-a');
    });
});

void test('commitQaArtifacts exempts the verified node_modules worktree symlink', () => {
    withTempDir('run-task-nm-qa-end-', dir => {
        const taskId = 'task-a';
        const { worktreeDir, repoModulesFixture } = makeNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        fs.symlinkSync(repoModulesFixture, path.join(worktreeDir, 'node_modules'));
        writeQaArtifacts(worktreeDir, taskId);

        const result = runCommitQaArtifactsInline(taskId, worktreeDir);
        assert.equal(result.status, 0, result.stderr);

        const status = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.equal(status, '?? node_modules\n');
        const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--name-only'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.doesNotMatch(tree, /(?:^|\n)node_modules(?:\n|$)/);
        const subject = execFileSync('git', ['log', '-1', '--pretty=%s'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        }).trim();
        assert.equal(subject, 'chore: QA artifacts for task-a');
    });
});

void test('commitQaArtifacts exempts verified root and workspace node_modules symlinks', () => {
    withTempDir('run-task-workspace-nm-qa-end-', dir => {
        const taskId = 'task-a';
        const { worktreeDir, repoModulesFixture, repoWorkspaceModules } =
            makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        fs.symlinkSync(repoModulesFixture, path.join(worktreeDir, 'node_modules'));
        fs.symlinkSync(repoWorkspaceModules, path.join(worktreeDir, 'packages/a/node_modules'));
        const porcelainBefore = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelainBefore, /^\?\? node_modules$/m);
        assert.match(porcelainBefore, /^\?\? packages\/a\/node_modules$/m);
        writeQaArtifacts(worktreeDir, taskId);

        const result = runCommitQaArtifactsInline(taskId, worktreeDir);
        assert.equal(result.status, 0, result.stderr);

        const porcelainAfter = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.equal(porcelainAfter, '?? node_modules\n?? packages/a/node_modules\n');
    });
});

void test('commitQaArtifacts excludes a verified workspace symlink that resolves inside tasks/<id>', () => {
    // Regression for a PR-review finding on worktree-workspace-node-modules-links:
    // when an eligible workspace resolves inside `tasks/<id>` itself (an unusual
    // but valid workspace glob like `tasks/*`), the verified node_modules symlink
    // must still be excluded from the `git add -A -- tasks/<id>` sweep. Pre-fix,
    // commitQaArtifacts had no exclusion mechanism at all on that add, so the
    // exempt symlink rode the sweep into the index and the post-staging
    // final-segment check aborted the commit with the symlink left staged.
    withTempDir('run-task-workspace-in-taskdir-', dir => {
        const taskId = 'task-a';
        const { localDir } = makeGitFixture(dir);
        const branch = `task/${taskId}`;
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        fs.mkdirSync(worktreesRoot, { recursive: true });
        fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
            name: 'fixture',
            workspaces: ['tasks/*'],
        }), 'utf8');
        fs.mkdirSync(path.join(localDir, 'tasks', taskId), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'tasks', taskId, 'package.json'), '{"version":"1.0.0"}\n', 'utf8');
        fs.writeFileSync(path.join(localDir, '.gitignore'), 'node_modules/\n', 'utf8');
        gitIn(localDir, 'add', 'package.json', '.gitignore');
        gitIn(localDir, 'commit', '-m', 'fixture setup');
        gitIn(localDir, 'push', 'origin', 'main');

        const repoWorkspaceModules = path.join(localDir, 'tasks', taskId, 'node_modules');
        fs.mkdirSync(repoWorkspaceModules, { recursive: true });
        fs.writeFileSync(path.join(repoWorkspaceModules, 'marker.txt'), 'workspace install\n', 'utf8');

        gitIn(localDir, 'worktree', 'add', worktreeDir, '-b', branch);
        writeQaArtifacts(worktreeDir, taskId);
        fs.symlinkSync(repoWorkspaceModules, path.join(worktreeDir, 'tasks', taskId, 'node_modules'));

        const porcelainBefore = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelainBefore, /^\?\? tasks\/task-a\/node_modules$/m);
        assert.match(porcelainBefore, /^\?\? tasks\/task-a\/handoff\.md$/m);

        const result = runCommitQaArtifactsInline(taskId, worktreeDir);
        assert.equal(result.status, 0, result.stderr);

        const porcelainAfter = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.equal(porcelainAfter, '?? tasks/task-a/node_modules\n');
        const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--name-only'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.doesNotMatch(tree, /node_modules/);
        assert.match(tree, /^tasks\/task-a\/handoff\.md$/m);
    });
});

void test('commitQaArtifacts resolves workspace patterns at most once per dirty-tree evaluation', () => {
    withTempDir('run-task-workspace-resolver-once-', dir => {
        const taskId = 'task-a';
        const { localDir, worktreeDir, repoWorkspaceModules } =
            makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
            name: 'fixture',
            workspaces: ['!packages/a', 'packages/*'],
        }), 'utf8');
        fs.symlinkSync(repoWorkspaceModules, path.join(worktreeDir, 'packages/a/node_modules'));
        writeQaArtifacts(worktreeDir, taskId);
        fs.writeFileSync(path.join(worktreeDir, 'stray-one.txt'), 'one\n', 'utf8');
        fs.writeFileSync(path.join(worktreeDir, 'stray-two.txt'), 'two\n', 'utf8');

        const result = runCommitQaArtifactsInline(taskId, worktreeDir);
        assert.notEqual(result.status, 0);
        assert.equal(
            (result.stderr.match(/Ignoring unsupported negated workspace pattern: !packages\/a/g) ?? []).length,
            1,
        );
    });
});

void test('workspace gate predicate rejects escaping and unresolvable destinations without blocking root evaluation', () => {
    withTempDir('run-task-workspace-gate-containment-', dir => {
        const taskId = 'task-a';
        const { worktreeDir, repoModulesFixture, repoWorkspaceModules } =
            makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        fs.symlinkSync(repoModulesFixture, path.join(worktreeDir, 'node_modules'));
        const outsideWorkspace = `${worktreeDir}-evil`;
        fs.mkdirSync(outsideWorkspace, { recursive: true });
        fs.symlinkSync(repoWorkspaceModules, path.join(outsideWorkspace, 'node_modules'));
        fs.rmSync(path.join(worktreeDir, 'packages/a'), { recursive: true, force: true });
        fs.symlinkSync(outsideWorkspace, path.join(worktreeDir, 'packages/a'));

        const workspaceEntry = {
            raw: '?? packages/a/node_modules',
            indexStatus: '?',
            worktreeStatus: '?',
            paths: ['packages/a/node_modules'],
        };
        const escaped = runIsExemptNodeModulesEntryInline(workspaceEntry, worktreeDir);
        assert.equal(escaped.status, 0, escaped.stderr);
        assert.equal(escaped.stdout.trim(), 'false');

        const rootEntry = {
            raw: '?? node_modules',
            indexStatus: '?',
            worktreeStatus: '?',
            paths: ['node_modules'],
        };
        const root = runIsExemptNodeModulesEntryInline(rootEntry, worktreeDir);
        assert.equal(root.status, 0, root.stderr);
        assert.equal(root.stdout.trim(), 'true');

        fs.rmSync(path.join(worktreeDir, 'packages/a'));
        fs.symlinkSync(path.join(dir, 'missing-workspace'), path.join(worktreeDir, 'packages/a'));
        const dangling = runIsExemptNodeModulesEntryInline(workspaceEntry, worktreeDir);
        assert.equal(dangling.status, 0, dangling.stderr);
        assert.equal(dangling.stdout.trim(), 'false');
    });
});

void test('gate exempts the canonical destination of an in-repo symlinked workspace', () => {
    withTempDir('run-task-workspace-canonical-destination-', dir => {
        const taskId = 'task-a';
        const { localDir } = makeGitFixture(dir);
        fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
            name: 'fixture',
            workspaces: ['packages/*'],
        }), 'utf8');
        fs.writeFileSync(path.join(localDir, '.gitignore'), 'node_modules/\n', 'utf8');
        fs.mkdirSync(path.join(localDir, 'packages'), { recursive: true });
        fs.mkdirSync(path.join(localDir, 'modules/a'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'modules/a/package.json'), '{"name":"a"}\n', 'utf8');
        fs.symlinkSync('../modules/a', path.join(localDir, 'packages/a'));
        gitIn(localDir, 'add', '.gitignore', 'package.json', 'packages/a', 'modules/a/package.json');
        gitIn(localDir, 'commit', '-m', 'symlinked workspace fixture');
        fs.mkdirSync(path.join(localDir, 'node_modules'), { recursive: true });
        fs.mkdirSync(path.join(localDir, 'modules/a/node_modules'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'modules/a/node_modules/marker.txt'), 'workspace install\n', 'utf8');

        const branch = `task/${taskId}`;
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        const setup = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(setup.status, 0, setup.stderr);
        const canonicalLink = path.join(worktreeDir, 'modules/a/node_modules');
        assert.equal(fs.lstatSync(canonicalLink).isSymbolicLink(), true);
        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /^\?\? modules\/a\/node_modules$/m);
        writeQaArtifacts(worktreeDir, taskId);

        const result = runCommitQaArtifactsInline(taskId, worktreeDir);
        assert.equal(result.status, 0, result.stderr);
        const after = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.equal(after, '?? modules/a/node_modules\n?? node_modules\n');
    });
});

void test('gate exempts a verified workspace symlink when git C-quotes the path', () => {
    withTempDir('run-task-workspace-quoted-path-', dir => {
        const taskId = 'task-a';
        const { localDir } = makeGitFixture(dir);
        fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
            name: 'fixture',
            workspaces: ['packages/*'],
        }), 'utf8');
        fs.writeFileSync(path.join(localDir, '.gitignore'), 'node_modules/\n', 'utf8');
        const workspace = 'packages/café';
        fs.mkdirSync(path.join(localDir, workspace), { recursive: true });
        fs.writeFileSync(path.join(localDir, workspace, 'package.json'), '{"name":"cafe"}\n', 'utf8');
        gitIn(localDir, 'add', '.gitignore', 'package.json', workspace);
        gitIn(localDir, 'commit', '-m', 'unicode workspace fixture');
        fs.mkdirSync(path.join(localDir, 'node_modules'), { recursive: true });
        fs.mkdirSync(path.join(localDir, workspace, 'node_modules'), { recursive: true });

        const branch = `task/${taskId}`;
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        const setup = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(setup.status, 0, setup.stderr);
        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /packages\/caf\\303\\251\/node_modules/);
        writeQaArtifacts(worktreeDir, taskId);

        const result = runCommitQaArtifactsInline(taskId, worktreeDir);
        assert.equal(result.status, 0, result.stderr);
    });
});

void test('gate treats an untracked workspace path containing a rename separator as one path', () => {
    withTempDir('run-task-workspace-arrow-path-', dir => {
        const taskId = 'task-a';
        const { localDir } = makeGitFixture(dir);
        const workspace = 'packages/a -> b';
        fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
            name: 'fixture',
            workspaces: ['packages/*'],
        }), 'utf8');
        fs.writeFileSync(path.join(localDir, '.gitignore'), 'node_modules/\n', 'utf8');
        fs.mkdirSync(path.join(localDir, workspace), { recursive: true });
        fs.writeFileSync(path.join(localDir, workspace, 'package.json'), '{"name":"arrow"}\n', 'utf8');
        gitIn(localDir, 'add', '.gitignore', 'package.json', workspace);
        gitIn(localDir, 'commit', '-m', 'arrow workspace fixture');
        fs.mkdirSync(path.join(localDir, 'node_modules'), { recursive: true });
        fs.mkdirSync(path.join(localDir, workspace, 'node_modules'), { recursive: true });

        const branch = `task/${taskId}`;
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        const setup = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(setup.status, 0, setup.stderr);
        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /^\?\? "packages\/a -> b\/node_modules"$/m);
        writeQaArtifacts(worktreeDir, taskId);

        const result = runCommitQaArtifactsInline(taskId, worktreeDir);
        assert.equal(result.status, 0, result.stderr);
    });
});

void test('gate decodes selectively quoted workspace paths when core.quotepath is false', () => {
    withTempDir('run-task-workspace-selective-quote-', dir => {
        const taskId = 'task-a';
        const { localDir } = makeGitFixture(dir);
        gitIn(localDir, 'config', 'core.quotepath', 'false');
        const workspace = 'packages/café"q';
        fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
            name: 'fixture',
            workspaces: ['packages/*'],
        }), 'utf8');
        fs.writeFileSync(path.join(localDir, '.gitignore'), 'node_modules/\n', 'utf8');
        fs.mkdirSync(path.join(localDir, workspace), { recursive: true });
        fs.writeFileSync(path.join(localDir, workspace, 'package.json'), '{"name":"cafe"}\n', 'utf8');
        gitIn(localDir, 'add', '.gitignore', 'package.json', workspace);
        gitIn(localDir, 'commit', '-m', 'selectively quoted workspace fixture');
        fs.mkdirSync(path.join(localDir, 'node_modules'), { recursive: true });
        fs.mkdirSync(path.join(localDir, workspace, 'node_modules'), { recursive: true });

        const branch = `task/${taskId}`;
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        const setup = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(setup.status, 0, setup.stderr);
        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /packages\/café\\"q\/node_modules/);
        writeQaArtifacts(worktreeDir, taskId);

        const result = runCommitQaArtifactsInline(taskId, worktreeDir);
        assert.equal(result.status, 0, result.stderr);
    });
});

void test('gate compares normalized Unicode workspace paths', () => {
    withTempDir('run-task-workspace-normalized-path-', dir => {
        const taskId = 'task-a';
        const { localDir } = makeGitFixture(dir);
        const workspace = 'packages/cafe\u0301';
        fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
            name: 'fixture',
            workspaces: ['packages/*'],
        }), 'utf8');
        fs.mkdirSync(path.join(localDir, workspace), { recursive: true });
        fs.writeFileSync(path.join(localDir, workspace, 'package.json'), '{"name":"cafe"}\n', 'utf8');
        gitIn(localDir, 'add', 'package.json', workspace);
        gitIn(localDir, 'commit', '-m', 'decomposed workspace fixture');
        fs.mkdirSync(path.join(localDir, 'node_modules'), { recursive: true });
        fs.mkdirSync(path.join(localDir, workspace, 'node_modules'), { recursive: true });

        const branch = `task/${taskId}`;
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        const setup = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(setup.status, 0, setup.stderr);
        const result = runIsExemptNodeModulesEntryInline({
            raw: '?? packages/café/node_modules',
            indexStatus: '?',
            worktreeStatus: '?',
            paths: ['packages/café/node_modules'],
        }, worktreeDir);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), 'true');
    });
});

void test('commitHumanReviewFiles pushes a tree dirty only with the verified node_modules symlink', () => {
    withTempDir('run-task-nm-human-review-', dir => {
        const taskId = 'task-a';
        const { worktreesRoot, worktreeDir, branch, repoModulesFixture } =
            makeNodeModulesGateFixture(dir, taskId, 'node_modules/\n');

        const status = { ...makeHumanReviewPendingStatus(taskId, branch), worktree: true };
        writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
        writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), taskId, []);
        gitIn(worktreeDir, 'add', 'tasks');
        gitIn(worktreeDir, 'commit', '-m', 'qa artifacts');

        fs.symlinkSync(repoModulesFixture, path.join(worktreeDir, 'node_modules'));

        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            `.then(m => {`,
            `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--push'];`,
            `  return m.main();`,
            `})`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }), worktreeDir);

        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(result.stderr, /outside the human_review allowlist/);
        assert.doesNotMatch(result.stderr, /no allowed dirty files found to stage/);

        const remoteRef = execFileSync('git', ['ls-remote', 'origin', branch], {
            cwd: worktreeDir,
            encoding: 'utf8',
        }).trim();
        assert.ok(remoteRef.length > 0, 'branch was not pushed to origin');
    });
});

void test('commitHumanReviewFiles treats N verified node_modules symlinks as a clean tree', () => {
    withTempDir('run-task-workspace-nm-human-review-', dir => {
        const taskId = 'task-a';
        const { worktreesRoot, worktreeDir, branch, repoModulesFixture, repoWorkspaceModules } =
            makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');

        const status = { ...makeHumanReviewPendingStatus(taskId, branch), worktree: true };
        writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
        writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), taskId, []);
        gitIn(worktreeDir, 'add', 'tasks');
        gitIn(worktreeDir, 'commit', '-m', 'qa artifacts');
        fs.symlinkSync(repoModulesFixture, path.join(worktreeDir, 'node_modules'));
        fs.symlinkSync(repoWorkspaceModules, path.join(worktreeDir, 'packages/a/node_modules'));
        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /^\?\? node_modules$/m);
        assert.match(porcelain, /^\?\? packages\/a\/node_modules$/m);

        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);
        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            `.then(m => {`,
            `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--push'];`,
            `  return m.main();`,
            `})`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }), worktreeDir);

        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(result.stderr, /outside the human_review allowlist/);
        assert.doesNotMatch(result.stderr, /no allowed dirty files found to stage/);
        const remoteRef = execFileSync('git', ['ls-remote', 'origin', branch], {
            cwd: worktreeDir,
            encoding: 'utf8',
        }).trim();
        assert.ok(remoteRef.length > 0, 'branch was not pushed to origin');
    });
});

void test('commitHumanReviewFiles never lets an Affected Files directory prefix allow a node_modules entry', () => {
    withTempDir('run-task-workspace-nm-prefix-reject-', dir => {
        const taskId = 'task-a';
        const { worktreesRoot, worktreeDir, branch } =
            makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        const status = { ...makeHumanReviewPendingStatus(taskId, branch), worktree: true };
        writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
        writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), taskId, ['`packages/`']);
        gitIn(worktreeDir, 'add', 'tasks');
        gitIn(worktreeDir, 'commit', '-m', 'qa artifacts');

        const wrongTarget = path.join(dir, 'wrong-workspace-target');
        fs.mkdirSync(wrongTarget, { recursive: true });
        fs.symlinkSync(wrongTarget, path.join(worktreeDir, 'packages/a/node_modules'));
        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /^\?\? packages\/a\/node_modules$/m);

        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);
        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            `.then(m => {`,
            `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--push'];`,
            `  return m.main();`,
            `})`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }), worktreeDir);

        assert.notEqual(result.status, 0, 'directory prefix unexpectedly allowed node_modules');
        assert.match(result.stderr, /outside the human_review allowlist/);
        const after = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(after, /^\?\? packages\/a\/node_modules$/m);
    });
});

for (const variant of ['ineligible', 'task-branch', 'staged'] as const) {
    void test(`directory prefixes reject ${variant} node_modules entries`, () => {
        withTempDir(`run-task-workspace-nm-prefix-${variant}-`, dir => {
            const taskId = `task-${variant}`;
            const { worktreesRoot, worktreeDir, branch, repoWorkspaceModules } =
                makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
            const status = { ...makeHumanReviewPendingStatus(taskId, branch), worktree: true };
            writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
            writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), taskId, ['`packages/`']);
            gitIn(worktreeDir, 'add', 'tasks');
            gitIn(worktreeDir, 'commit', '-m', 'qa artifacts');

            let rejectedPath: string;
            if (variant === 'ineligible') {
                rejectedPath = 'packages/notapkg/nested/node_modules';
                const wrongTarget = path.join(dir, 'ineligible-target');
                fs.mkdirSync(wrongTarget, { recursive: true });
                fs.symlinkSync(wrongTarget, path.join(worktreeDir, rejectedPath));
            } else if (variant === 'task-branch') {
                rejectedPath = 'packages/c/node_modules';
                fs.mkdirSync(path.join(worktreeDir, 'packages/c'), { recursive: true });
                fs.writeFileSync(path.join(worktreeDir, 'packages/c/package.json'), '{"name":"c"}\n', 'utf8');
                const wrongTarget = path.join(dir, 'task-branch-target');
                fs.mkdirSync(wrongTarget, { recursive: true });
                fs.symlinkSync(wrongTarget, path.join(worktreeDir, rejectedPath));
            } else {
                rejectedPath = 'packages/a/node_modules';
                fs.symlinkSync(repoWorkspaceModules, path.join(worktreeDir, rejectedPath));
                gitIn(worktreeDir, 'add', '-f', rejectedPath);
            }

            const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
                cwd: worktreeDir,
                encoding: 'utf8',
            });
            assert.match(porcelain, new RegExp(`^(?:\\?\\?|A ) ${rejectedPath.replaceAll('/', '\\/')}$`, 'm'));

            const fakeBins = path.join(dir, 'fake-bins');
            fs.mkdirSync(fakeBins, { recursive: true });
            setupFakeCliTools(fakeBins);
            const result = runNodeInline([
                `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
                `.then(m => {`,
                `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--push'];`,
                `  return m.main();`,
                `})`,
                `.catch(err => { console.error(err); process.exit(1); });`,
            ].join('\n'), childEnvWithoutTasksOverride({
                CANON_WORKTREES_ROOT: worktreesRoot,
                PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            }), worktreeDir);

            assert.notEqual(result.status, 0, `${variant} node_modules unexpectedly passed`);
            assert.match(result.stderr, /outside the human_review allowlist/);
            assert.match(result.stderr, /node_modules/);
            const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--name-only'], {
                cwd: worktreeDir,
                encoding: 'utf8',
            });
            assert.doesNotMatch(tree, /node_modules/);
        });
    });
}

void test('directory-prefix staging tolerates an ignored real workspace install beside an exempt link', () => {
    withTempDir('run-task-workspace-nm-prefix-mixed-', dir => {
        const taskId = 'task-a';
        const { localDir, worktreesRoot, worktreeDir, branch, repoWorkspaceModules } =
            makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        const status = { ...makeHumanReviewPendingStatus(taskId, branch), worktree: true };
        writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
        writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), taskId, ['`packages/`']);
        gitIn(worktreeDir, 'add', 'tasks');
        gitIn(worktreeDir, 'commit', '-m', 'qa artifacts');

        fs.mkdirSync(path.join(localDir, 'packages/b/node_modules'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'packages/b/package.json'), '{"name":"b"}\n', 'utf8');
        fs.mkdirSync(path.join(worktreeDir, 'packages/b/node_modules'), { recursive: true });
        fs.writeFileSync(path.join(worktreeDir, 'packages/b/node_modules/marker.txt'), 'local install\n', 'utf8');
        fs.symlinkSync(repoWorkspaceModules, path.join(worktreeDir, 'packages/a/node_modules'));
        fs.writeFileSync(path.join(worktreeDir, 'packages/a/generated.ts'), 'export {};\n', 'utf8');

        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /^\?\? packages\/a\/generated\.ts$/m);
        assert.match(porcelain, /^\?\? packages\/a\/node_modules$/m);
        assert.doesNotMatch(porcelain, /packages\/b\/node_modules/);

        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);
        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            `.then(m => {`,
            `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--push'];`,
            `  return m.main();`,
            `})`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }), worktreeDir);

        assert.equal(result.status, 0, result.stderr);
        const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--name-only'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(tree, /^packages\/a\/generated\.ts$/m);
        assert.doesNotMatch(tree, /node_modules/);
    });
});

void test('directory-form staging normalizes a C-quoted non-ASCII prefix', () => {
    withTempDir('run-task-human-review-dirform-unicode-prefix-', dir => {
        const taskId = 'task-a';
        const { worktreesRoot, worktreeDir, branch } =
            makeNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        const status = { ...makeHumanReviewPendingStatus(taskId, branch), worktree: true };
        writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
        writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), taskId, ['`café/`']);
        gitIn(worktreeDir, 'add', 'tasks');
        gitIn(worktreeDir, 'commit', '-m', 'qa artifacts');
        fs.mkdirSync(path.join(worktreeDir, 'café'), { recursive: true });
        fs.writeFileSync(path.join(worktreeDir, 'café/build.js'), 'export {};\n', 'utf8');

        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /^\?\? "caf\\303\\251\/build\.js"$/m);

        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);
        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            `.then(m => {`,
            `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--push'];`,
            `  return m.main();`,
            `})`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }), worktreeDir);

        assert.equal(result.status, 0, result.stderr);
        const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--name-only', '-z'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        }).split('\0');
        assert.equal(tree.includes('café/build.js'), true);
    });
});

void test('directory-prefix staging does not sweep canon workspace links into the commit', () => {
    withTempDir('run-task-workspace-nm-prefix-stage-', dir => {
        const taskId = 'task-a';
        const { worktreesRoot, worktreeDir, branch, repoWorkspaceModules } =
            makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        const status = { ...makeHumanReviewPendingStatus(taskId, branch), worktree: true };
        writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
        writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), taskId, ['`packages/`']);
        gitIn(worktreeDir, 'add', 'tasks');
        gitIn(worktreeDir, 'commit', '-m', 'qa artifacts');

        fs.symlinkSync(repoWorkspaceModules, path.join(worktreeDir, 'packages/a/node_modules'));
        fs.writeFileSync(path.join(worktreeDir, 'packages/a/allowed-source.ts'), 'export {};\n', 'utf8');
        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /^\?\? packages\/a\/allowed-source\.ts$/m);
        assert.match(porcelain, /^\?\? packages\/a\/node_modules$/m);

        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);
        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            `.then(m => {`,
            `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--push'];`,
            `  return m.main();`,
            `})`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }), worktreeDir);

        assert.equal(result.status, 0, result.stderr);
        const after = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(after, /^\?\? packages\/a\/node_modules$/m);
        const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--name-only'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(tree, /^packages\/a\/allowed-source\.ts$/m);
        assert.doesNotMatch(tree, /node_modules/);
    });
});

void test('commitHumanReviewFiles still blocks a force-staged node_modules symlink', () => {
    withTempDir('run-task-nm-human-review-staged-', dir => {
        const taskId = 'task-a';
        const { worktreesRoot, worktreeDir, branch, repoModulesFixture } =
            makeNodeModulesGateFixture(dir, taskId, 'node_modules/\n');

        const status = { ...makeHumanReviewPendingStatus(taskId, branch), worktree: true };
        writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
        writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), taskId, []);
        gitIn(worktreeDir, 'add', 'tasks');
        gitIn(worktreeDir, 'commit', '-m', 'qa artifacts');

        fs.symlinkSync(repoModulesFixture, path.join(worktreeDir, 'node_modules'));
        // Force-stage past .gitignore, e.g. an accidental `git add -f node_modules`.
        // Even though the symlink is otherwise verified, a *staged* node_modules
        // is a deliberate departure from canon's own untracked worktree symlink
        // and must still trip the normal allowlist check, not be waved through.
        gitIn(worktreeDir, 'add', '-f', 'node_modules');

        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            `.then(m => {`,
            `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--push'];`,
            `  return m.main();`,
            `})`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }), worktreeDir);

        assert.notEqual(result.status, 0, 'force-staged node_modules unexpectedly passed');
        assert.match(result.stderr, /outside the human_review allowlist/);
        assert.match(result.stderr, /node_modules/);

        const remoteRef = execFileSync('git', ['ls-remote', 'origin', branch], {
            cwd: worktreeDir,
            encoding: 'utf8',
        }).trim();
        assert.equal(remoteRef.length, 0, 'branch should not have been pushed');
    });
});

void test('commitQaArtifacts still rejects non-exempt node_modules entries', () => {
    for (const variant of ['file', 'directory', 'wrong-target-symlink'] as const) {
        withTempDir(`run-task-nm-negative-${variant}-`, dir => {
            const taskId = `task-${variant}`;
            const gitignoreRule = variant === 'directory' ? null : 'node_modules/\n';
            const { worktreeDir } = makeNodeModulesGateFixture(dir, taskId, gitignoreRule);
            const nodeModulesPath = path.join(worktreeDir, 'node_modules');
            if (variant === 'file') {
                fs.writeFileSync(nodeModulesPath, 'not a symlink\n', 'utf8');
            } else if (variant === 'directory') {
                fs.mkdirSync(nodeModulesPath, { recursive: true });
                fs.writeFileSync(path.join(nodeModulesPath, 'pkg.json'), '{}\n', 'utf8');
            } else {
                const wrongTarget = path.join(dir, 'somewhere-else');
                fs.mkdirSync(wrongTarget, { recursive: true });
                fs.symlinkSync(wrongTarget, nodeModulesPath);
            }
            writeQaArtifacts(worktreeDir, taskId);

            const result = runCommitQaArtifactsInline(taskId, worktreeDir);
            assert.notEqual(result.status, 0, `${variant} unexpectedly passed`);
            assert.match(result.stderr, /QA-end commit aborted: working tree has dirty files outside the QA-end allowlist/);
        });
    }
});

void test('workspace node_modules gate rejects staged, real, wrong-target, and ineligible entries', () => {
    for (const variant of ['staged', 'directory', 'wrong-target', 'ineligible'] as const) {
        withTempDir(`run-task-workspace-nm-negative-${variant}-`, dir => {
            const taskId = `task-${variant}`;
            const gitignoreRule = variant === 'directory' ? null : 'node_modules/\n';
            const { worktreeDir, repoWorkspaceModules } =
                makeWorkspaceNodeModulesGateFixture(dir, taskId, gitignoreRule);
            let candidate: string;
            if (variant === 'ineligible') {
                candidate = path.join(worktreeDir, 'packages/notapkg/nested/node_modules');
                fs.symlinkSync(repoWorkspaceModules, candidate);
            } else {
                candidate = path.join(worktreeDir, 'packages/a/node_modules');
                if (variant === 'directory') {
                    fs.mkdirSync(candidate, { recursive: true });
                    fs.writeFileSync(path.join(candidate, 'marker.txt'), 'real directory\n', 'utf8');
                } else if (variant === 'wrong-target') {
                    const wrongTarget = path.join(dir, 'wrong-target');
                    fs.mkdirSync(wrongTarget, { recursive: true });
                    fs.symlinkSync(wrongTarget, candidate);
                } else {
                    fs.symlinkSync(repoWorkspaceModules, candidate);
                    gitIn(worktreeDir, 'add', '-f', 'packages/a/node_modules');
                }
            }
            writeQaArtifacts(worktreeDir, taskId);
            const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
                cwd: worktreeDir,
                encoding: 'utf8',
            });
            if (variant === 'directory') {
                assert.match(porcelain, /^\?\? packages\/a\/node_modules\/marker\.txt$/m);
            } else if (variant === 'ineligible') {
                assert.match(porcelain, /^\?\? packages\/notapkg\/nested\/node_modules$/m);
            } else if (variant === 'staged') {
                assert.match(porcelain, /^A  packages\/a\/node_modules$/m);
            } else {
                assert.match(porcelain, /^\?\? packages\/a\/node_modules$/m);
            }

            const result = runCommitQaArtifactsInline(taskId, worktreeDir);
            assert.notEqual(result.status, 0, `${variant} unexpectedly passed`);
            assert.match(result.stderr, /outside the QA-end allowlist/);
        });
    }
});

void test('workspace gate predicate classifies an exact real-directory entry as non-exempt', () => {
    withTempDir('run-task-workspace-nm-directory-predicate-', dir => {
        const taskId = 'task-a';
        const { worktreeDir } = makeWorkspaceNodeModulesGateFixture(dir, taskId, null);
        fs.mkdirSync(path.join(worktreeDir, 'packages/a/node_modules'), { recursive: true });
        fs.writeFileSync(path.join(worktreeDir, 'packages/a/node_modules/marker.txt'), 'real directory\n', 'utf8');
        const result = runIsExemptNodeModulesEntryInline({
            raw: '?? packages/a/node_modules',
            indexStatus: '?',
            worktreeStatus: '?',
            paths: ['packages/a/node_modules'],
        }, worktreeDir);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), 'false');
    });
});

void test('workspace node_modules exemption is disabled when no distinct worktree is active', () => {
    withTempDir('run-task-workspace-nm-no-worktree-', dir => {
        const taskId = 'task-a';
        const { localDir, repoWorkspaceModules } =
            makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        const outsideTarget = path.join(dir, 'adopter-workspace-modules');
        fs.mkdirSync(outsideTarget, { recursive: true });
        fs.rmSync(repoWorkspaceModules, { recursive: true, force: true });
        fs.symlinkSync(outsideTarget, repoWorkspaceModules);
        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /^\?\? packages\/a\/node_modules$/m);
        writeQaArtifacts(localDir, taskId);

        const result = runCommitQaArtifactsInline(taskId, localDir);
        assert.notEqual(result.status, 0, 'no-worktree workspace symlink unexpectedly passed');
        assert.match(result.stderr, /outside the QA-end allowlist/);
    });
});

void test('root node_modules exemption remains unchanged when no distinct worktree is active', () => {
    withTempDir('run-task-root-nm-no-worktree-', dir => {
        const taskId = 'task-a';
        const { localDir, repoModulesFixture } =
            makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        const outsideTarget = path.join(dir, 'adopter-root-modules');
        fs.mkdirSync(outsideTarget, { recursive: true });
        fs.rmSync(repoModulesFixture, { recursive: true, force: true });
        fs.symlinkSync(outsideTarget, repoModulesFixture);
        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /^\?\? node_modules$/m);
        writeQaArtifacts(localDir, taskId);

        const result = runCommitQaArtifactsInline(taskId, localDir);
        assert.equal(result.status, 0, result.stderr);
        const after = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.equal(after, '?? node_modules\n');
    });
});

void test('bare node_modules gitignore rule hides the symlink from porcelain entirely', () => {
    withTempDir('run-task-nm-noslash-', dir => {
        const { worktreeDir, repoModulesFixture } = makeNodeModulesGateFixture(dir, 'task-a', 'node_modules\n');
        fs.symlinkSync(repoModulesFixture, path.join(worktreeDir, 'node_modules'));

        const status = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.doesNotMatch(status, /node_modules/);
    });
});

void test('bare node_modules gitignore rule hides nested workspace symlinks entirely', () => {
    withTempDir('run-task-workspace-nm-noslash-', dir => {
        const { worktreeDir, repoWorkspaceModules } =
            makeWorkspaceNodeModulesGateFixture(dir, 'task-a', 'node_modules\n');
        fs.symlinkSync(repoWorkspaceModules, path.join(worktreeDir, 'packages/a/node_modules'));
        const status = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.doesNotMatch(status, /node_modules/);
    });
});

void test('ensureWorktree creates and reuses canon node_modules symlinks without clobbering other entries', () => {
    for (const variant of ['missing', 'verified-symlink', 'file', 'directory'] as const) {
        withTempDir(`run-task-ensure-wt-nm-${variant}-`, dir => {
            const taskId = `task-${variant}`;
            const { localDir, worktreesRoot, worktreeDir, branch, repoModulesFixture } =
                makeEnsureWorktreeNodeModulesFixture(dir, taskId, variant);

            const result = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
            assert.equal(result.status, 0, result.stderr);

            const nodeModulesPath = path.join(worktreeDir, 'node_modules');
            const stat = fs.lstatSync(nodeModulesPath);
            if (variant === 'missing' || variant === 'verified-symlink') {
                assert.equal(stat.isSymbolicLink(), true);
                assert.equal(fs.realpathSync(nodeModulesPath), fs.realpathSync(repoModulesFixture));
            } else if (variant === 'file') {
                assert.equal(stat.isFile(), true);
                assert.equal(fs.readFileSync(nodeModulesPath, 'utf8'), 'tracked file\n');
            } else {
                assert.equal(stat.isDirectory(), true);
                assert.equal(fs.readFileSync(path.join(nodeModulesPath, 'pkg.json'), 'utf8'), '{}\n');
            }
        });
    }
});

void test('ensureWorktree prunes a hand-deleted worktree before reusing its branch', () => {
    withTempDir('run-task-ensure-wt-prune-', dir => {
        const taskId = 'task-prune';
        const { localDir, worktreesRoot, worktreeDir, branch } =
            makeEnsureWorktreeNodeModulesFixture(dir, taskId, 'missing');

        const first = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(first.status, 0, first.stderr);
        assert.equal(fs.existsSync(worktreeDir), true);
        fs.rmSync(worktreeDir, { recursive: true, force: true });
        const staleList = execFileSync('git', ['worktree', 'list', '--porcelain'], {
            cwd: localDir,
            encoding: 'utf8',
        });
        const canonicalWorktreeDir = path.join(canonicalizeTestPath(worktreesRoot), taskId);
        assert.match(staleList, new RegExp(`worktree ${canonicalWorktreeDir.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`));

        const second = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(second.status, 0, second.stderr);
        assert.equal(fs.existsSync(worktreeDir), true);
        const repairedList = execFileSync('git', ['worktree', 'list', '--porcelain'], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.doesNotMatch(repairedList, /prunable/);
    });
});

void test('canon run refuses a hand-deleted registered canon worktree', () => {
    withTempDir('run-task-missing-canon-worktree-', dir => {
        const taskId = 'missing-canon-worktree';
        const { localDir, worktreeDir, branch } = makeBootstrappedTaskWorktreeFixture(dir, taskId);
        const mainStatusPath = path.join(localDir, 'tasks', taskId, 'status.json');
        const worktreeStatusPath = path.join(worktreeDir, 'tasks', taskId, 'status.json');
        const mainStatus = JSON.parse(fs.readFileSync(mainStatusPath, 'utf8')) as { branch: string; worktree: boolean };
        const worktreeStatus = JSON.parse(fs.readFileSync(worktreeStatusPath, 'utf8')) as {
            branch: string;
            phases: Record<string, { status: string }>;
        };
        assert.equal(mainStatus.branch, '');
        assert.equal(worktreeStatus.branch, branch);
        worktreeStatus.phases.implement.status = 'done';
        worktreeStatus.phases.code_review.status = 'pending';
        fs.writeFileSync(worktreeStatusPath, `${JSON.stringify(worktreeStatus, null, 2)}\n`, 'utf8');
        fs.rmSync(worktreeDir, { recursive: true, force: true });
        const before = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: localDir, encoding: 'utf8' });
        assert.match(before, new RegExp(`worktree .*${taskId}`));

        const env = childEnvWithoutTasksOverride();
        delete env.CANON_WORKTREES_ROOT;
        const result = runMainInline(taskId, [], env, localDir);
        const output = combinedOutput(result);
        assert.notEqual(result.status, 0);
        assert.ok(output.includes(canonicalizeTestPath(worktreeDir)));
        assert.match(output, new RegExp(`branch: ${branch.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`));
        assert.match(output, /git worktree add -f/);
        assert.match(output, /git worktree remove --force/);
        assert.doesNotMatch(output, /ENOENT|\n\s+at .*\(/);
        const after = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: localDir, encoding: 'utf8' });
        assert.match(after, new RegExp(`worktree .*${taskId}`));
        for (const runtimeFile of ['.canon-pid', '.heartbeat.json', '.canon-run.log']) {
            assert.equal(fs.existsSync(path.join(localDir, 'tasks', taskId, runtimeFile)), false);
            assert.equal(fs.existsSync(path.join(worktreeDir, 'tasks', taskId, runtimeFile)), false);
        }
    });
});
