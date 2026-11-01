import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { shouldParkCrashedReview } from '../src/orchestrator/main.js';
import { evaluateCodeReviewLoop } from '../src/orchestrator/review-loop.js';
import type { StatusJson, TaskContext } from '../src/orchestrator/types.js';
import { taskCmd } from '../src/task/index.js';
import {
    WORKTREE_ROOT,
    withTempDir,
    writeTaskStatus,
    setupFakeGit,
    setupFakeCliTools,
    setupInvocationLoggingCliTools,
    installDocsRefsChecker,
    prepareImplementFixupFixture,
    nonScaffoldCommits,
    countResumes,
    prepareQaFixupFixture,
    readAgentInvocations,
    makeReviewLoopStatus,
    writeReviewLoopFixture,
    runReviewLoopMain,
    withFakeGitEnv,
    runNodeInline,
    childEnvWithoutTasksOverride,
    gitIn,
    makeGitFixture,
    baseDriftEnv,
    makeBaseDriftFixture,
    makeCompleteStatus,
    writeReviewRecoveryTask,
    writeAffectedFilesSpec,
    setupHumanReviewHarness,
    runHumanReviewCommit,
    runHumanReviewMain,
    combinedOutput,
} from './run-task-safety-helpers.js';


void test('commitHumanReviewFiles base-drift gate accepts files listed in Affected Files', () => {
    withTempDir('run-task-base-drift-allowed-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`docs/codebase-map.md`']);

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_DRIFT_FILES: 'docs/codebase-map.md',
            FAKE_GIT_STATUS_OUTPUT: ' M tasks/task-a/done.md',
            FAKE_GIT_DIFF_OUTPUT: 'tasks/task-a/done.md',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(combinedOutput(result), /base-drift detected/);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(gitLog, /^commit /m);
    });
});

void test('commitHumanReviewFiles base-drift gate dies on drift outside the allowlist', () => {
    withTempDir('run-task-base-drift-die-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`src/orchestrator/main.ts`']);

        // Use a non-managed-doc drift file: DEFAULT_PROTECTED_DOCS like
        // docs/decisions.md are auto-allowlisted once qa.status === 'done'
        // (BACKLOG #994), which the harness's makeCompleteStatus already sets.
        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_DRIFT_FILES: 'docs/BACKLOG.md',
            FAKE_GIT_STATUS_OUTPUT: ' M tasks/task-a/done.md',
            FAKE_GIT_DIFF_OUTPUT: 'tasks/task-a/done.md',
        });

        assert.notEqual(result.status, 0);
        const output = combinedOutput(result);
        assert.match(output, /docs\/BACKLOG\.md/);
        assert.match(output, /--force/);
        assert.match(output, /PIPELINE_TELEMETRY_FILES/);
        assert.match(output, /Affected Files/);
        assert.match(output, /git checkout origin\/main -- <path>/);
        assert.match(output, /git revert <sha>/);
        assert.doesNotMatch(output, /git checkout HEAD --/);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(gitLog, /^commit [\s\S]*^reset --soft abc123$/m);
        assert.doesNotMatch(gitLog, /^push /m);
    });
});

void test('commitHumanReviewFiles base-drift gate warns and proceeds with --force', () => {
    withTempDir('run-task-base-drift-force-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`src/orchestrator/main.ts`']);

        const result = runNodeInline([
            "import { main } from './src/orchestrator/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--push', '--force'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${harness.fakeGitDir}${path.delimiter}${harness.fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: harness.tasksRoot,
            FAKE_GIT_LOG: harness.gitLogPath,
            FAKE_GIT_CURRENT_BRANCH: harness.currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_BASE_BRANCH: 'main',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GIT_DRIFT_FILES: 'docs/BACKLOG.md',
            FAKE_GIT_STATUS_OUTPUT: ' M tasks/task-a/done.md',
            FAKE_GIT_DIFF_OUTPUT: 'tasks/task-a/done.md',
        });

        assert.equal(result.status, 0, result.stderr);
        const output = combinedOutput(result);
        assert.match(output, /--force override: base-drift detected/);
        assert.match(output, /docs\/BACKLOG\.md/);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(gitLog, /^commit /m);
        assert.match(gitLog, /^push -u origin task\/task-a$/m);
    });
});

void test('base-drift --force warns about merge conflicts and proceeds', () => {
    withTempDir('run-task-base-drift-force-conflict-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        const result = runHumanReviewMain(harness, ['--push', '--force'], {
            FAKE_GIT_MERGE_TREE_STATUS: '1',
            FAKE_GIT_MERGE_TREE_CONFLICTS: 'docs/patterns.md,src/a.ts',
        });
        assert.equal(result.status, 0, result.stderr);
        const output = combinedOutput(result);
        assert.match(output, /--force override: merge conflicts with origin\/main/);
        assert.match(output, /docs\/patterns\.md/);
        assert.match(output, /src\/a\.ts/);
        const log = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(log, /^push -u origin task\/task-a$/m);
        assert.doesNotMatch(log, /^reset --soft/m);
    });
});

void test('base-drift --force reports clean base advance without override warning', () => {
    withTempDir('run-task-base-drift-force-base-advance-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        const result = runHumanReviewMain(harness, ['--push', '--force'], {
            FAKE_GIT_DRIFT_FILES: 'docs/BACKLOG.md',
            FAKE_GIT_AFFECTED_FILES: '',
        });
        assert.equal(result.status, 0, result.stderr);
        const output = combinedOutput(result);
        assert.match(output, /advanced on 1 file .*merge cleanly/);
        assert.doesNotMatch(output, /--force override/);
        assert.match(fs.readFileSync(harness.gitLogPath, 'utf8'), /^push -u origin task\/task-a$/m);
    });
});

void test('base-drift unsupported merge-tree warns and proceeds', () => {
    withTempDir('run-task-base-drift-unsupported-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        const result = runHumanReviewMain(harness, ['--push'], {
            FAKE_GIT_MERGE_TREE_STATUS: '129',
            FAKE_GIT_MERGE_TREE_ERROR: 'usage: git merge-tree --write-tree',
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(combinedOutput(result), /2\.38[\s\S]*Conflicts were not checked/);
        assert.match(fs.readFileSync(harness.gitLogPath, 'utf8'), /^push -u origin task\/task-a$/m);
    });
});

for (const force of [false, true]) {
    void test(`base-drift merge-tree errors fail closed (force=${force})`, () => {
        withTempDir('run-task-base-drift-probe-error-', dir => {
            const harness = setupHumanReviewHarness(dir, ['task-a']);
            const result = runHumanReviewMain(harness, force ? ['--push', '--force'] : ['--push'], {
                FAKE_GIT_MERGE_TREE_STATUS: '128',
                FAKE_GIT_MERGE_TREE_ERROR: 'fatal: simulated merge-tree failure',
            });
            assert.notEqual(result.status, 0);
            assert.match(combinedOutput(result), /could not check for merge conflicts/);
            assert.match(combinedOutput(result), /fatal: simulated merge-tree failure/);
            assert.match(combinedOutput(result), /cannot be bypassed with --force/);
            const log = fs.readFileSync(harness.gitLogPath, 'utf8');
            assert.match(log, /^commit [\s\S]*^reset --soft abc123$/m);
            assert.doesNotMatch(log, /^push /m);
        });
    });
}

void test('base-drift abort explains failed soft reset and gives manual recovery', () => {
    withTempDir('run-task-base-drift-reset-failure-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        const result = runHumanReviewMain(harness, ['--push'], {
            FAKE_GIT_MERGE_TREE_STATUS: '128',
            FAKE_GIT_MERGE_TREE_ERROR: 'fatal: simulated merge-tree failure',
            FAKE_GIT_RESET_SOFT_FAIL: '1',
        });
        assert.notEqual(result.status, 0);
        assert.match(combinedOutput(result), /Could not undo the human_review commit/);
        assert.match(combinedOutput(result), /git reset --soft abc123/);
        assert.doesNotMatch(fs.readFileSync(harness.gitLogPath, 'utf8'), /^push /m);
    });
});

for (const force of [false, true]) {
    void test(`commitHumanReviewFiles fails closed when only the task-changed diff fails (force=${force})`, () => {
        withTempDir('run-task-affected-diff-fail-', dir => {
            const harness = setupHumanReviewHarness(dir, ['task-a']);
            const worktreesRoot = path.join(dir, 'worktrees');
            fs.mkdirSync(path.join(worktreesRoot, 'task-a'), { recursive: true });
            const status = makeCompleteStatus('task-a', 'task/task-a');
            status.worktree = true;
            writeTaskStatus(harness.tasksRoot, 'task-a', status);
            const env = {
                FAKE_GIT_DRIFT_FILES: 'docs/BACKLOG.md',
                FAKE_GIT_AFFECTED_DIFF_FAIL: '1',
                FAKE_GIT_AFFECTED_DIFF_ERROR: 'fatal: simulated three-dot diff failure',
                FAKE_GIT_STATUS_OUTPUT: ' M tasks/task-a/done.md',
                FAKE_GIT_DIFF_OUTPUT: 'tasks/task-a/done.md',
            };
            const result = force ? runNodeInline([
                "import { main } from './src/orchestrator/main.ts';",
                "process.argv = ['node', 'canon', 'task-a', '--push', '--force'];",
                "main().catch(err => { console.error(err); process.exit(1); });",
            ].join('\n'), {
                ...process.env,
                PATH: `${harness.fakeGitDir}${path.delimiter}${harness.fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
                CANON_TASKS_DIR_OVERRIDE: harness.tasksRoot,
                CANON_WORKTREES_ROOT: worktreesRoot,
                FAKE_GIT_LOG: harness.gitLogPath,
                FAKE_GIT_CURRENT_BRANCH: harness.currentBranchPath,
                FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
                FAKE_GIT_REMOTE_EXISTS: '1',
                FAKE_GIT_BASE_BRANCH: 'main',
                FAKE_GIT_TASK_BRANCH: 'task/task-a',
                ...env,
            }) : runHumanReviewCommit(harness, ['task-a'], env);
            assert.notEqual(result.status, 0);
            const output = combinedOutput(result);
            assert.match(output, /task-changed files could not be computed against origin\/main/);
            assert.match(output, /fatal: simulated three-dot diff failure/);
            assert.match(output, /cannot be bypassed with --force/);
            assert.match(output, /Drifted files:[\s\S]*docs\/BACKLOG\.md/);
            assert.doesNotMatch(output, /could not compute base-drift diff|git rebase|base advanced|src\//);
            const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
            assert.match(gitLog, /^diff origin\/main HEAD --name-status -M -z$/m);
            assert.match(gitLog, /^diff origin\/main\.\.\.HEAD --name-status -M -z$/m);
            assert.match(gitLog, /^commit [\s\S]*^reset --soft abc123$/m);
            assert.doesNotMatch(gitLog, /^push /m);
        });
    });
}

void test('commitHumanReviewFiles base-drift gate fails closed when tree diff fails', () => {
    withTempDir('run-task-base-drift-diff-fail-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_DRIFT_DIFF_FAIL: '1',
            FAKE_GIT_DRIFT_DIFF_ERROR: 'fatal: simulated tree diff failure',
            FAKE_GIT_STATUS_OUTPUT: ' M tasks/task-a/done.md',
            FAKE_GIT_DIFF_OUTPUT: 'tasks/task-a/done.md',
        });

        assert.notEqual(result.status, 0);
        const output = combinedOutput(result);
        assert.match(output, /could not compute base-drift diff against origin\/main/);
        assert.match(output, /fatal: simulated tree diff failure/);
        assert.match(output, /cannot be bypassed with --force/);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(gitLog, /^commit [\s\S]*^reset --soft abc123$/m);
        assert.doesNotMatch(gitLog, /^push /m);
    });
});

void test('commitHumanReviewFiles base-drift gate passes when the base advances on non-overlapping files', () => {
    withTempDir('run-task-base-drift-mode1-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const { localDir, originDir } = makeGitFixture(dir);
        writeTaskStatus(tasksRoot, 'task-a', makeCompleteStatus('task-a', 'task/demo'));
        writeAffectedFilesSpec(tasksRoot, 'task-a', ['`src/orchestrator/main.ts`']);

        gitIn(localDir, 'checkout', '-b', 'task/demo');
        const taskFile = path.join(localDir, 'src', 'orchestrator', 'main.ts');
        fs.mkdirSync(path.dirname(taskFile), { recursive: true });
        fs.writeFileSync(taskFile, 'export {};\n', 'utf8');
        gitIn(localDir, 'add', 'src/orchestrator/main.ts');
        gitIn(localDir, 'commit', '-m', 'task change');
        fs.mkdirSync(path.join(localDir, 'tasks', 'task-a'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'tasks', 'task-a', 'done.md'), 'done\n', 'utf8');

        const thirdPartyDir = path.join(dir, 'third-party');
        execFileSync('git', ['clone', '-b', 'main', originDir, thirdPartyDir], { stdio: 'ignore' });
        gitIn(thirdPartyDir, 'config', 'user.email', 'third@example.com');
        gitIn(thirdPartyDir, 'config', 'user.name', 'Third Party');
        // Use docs/BACKLOG.md (not in DEFAULT_PROTECTED_DOCS) so the gate fires —
        // managed-doc paths are auto-allowlisted at qa.status === 'done'.
        const baseAdvanceFile = path.join(thirdPartyDir, 'docs', 'BACKLOG.md');
        fs.mkdirSync(path.dirname(baseAdvanceFile), { recursive: true });
        fs.writeFileSync(baseAdvanceFile, 'third-party content\n', 'utf8');
        gitIn(thirdPartyDir, 'add', 'docs/BACKLOG.md');
        gitIn(thirdPartyDir, 'commit', '-m', 'third-party base advance');
        gitIn(thirdPartyDir, 'push', 'origin', 'main');

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            `.then(m => { process.argv = ['node', 'canon', 'task-a', '--push']; return m.main(); })`,
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), baseDriftEnv(dir, tasksRoot), localDir);

        assert.equal(result.status, 0, result.stderr);
        const output = combinedOutput(result);
        assert.match(output, /advanced on 1 file outside this task's Affected Files; they merge cleanly/);
        assert.doesNotMatch(output, /base-drift detected|conflicts with origin/);
        assert.match(execFileSync('git', ['ls-remote', '--heads', originDir, 'task/demo'], { encoding: 'utf8' }), /task\/demo$/m);
    });
});

void test('commitHumanReviewFiles base-drift allows another task artifacts on the base', () => {
    withTempDir('run-task-base-drift-other-task-', dir => {
        const fixture = makeBaseDriftFixture(dir, {
            taskFiles: { 'src/example.ts': 'export {};\n' },
            declared: ['`src/example.ts`'],
        });
        fixture.thirdParty(baseDir => {
            fs.mkdirSync(path.join(baseDir, 'tasks/other-id'), { recursive: true });
            fs.writeFileSync(path.join(baseDir, 'tasks/other-id/spec.md'), '# Other\n', 'utf8');
            fs.writeFileSync(path.join(baseDir, 'tasks/other-id/status.json'), '{}\n', 'utf8');
        });
        fs.mkdirSync(path.join(fixture.localDir, 'tasks/task-a'), { recursive: true });
        fs.writeFileSync(path.join(fixture.localDir, 'tasks/task-a/done.md'), 'done\n', 'utf8');
        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            ".then(m => { process.argv = ['node', 'canon', 'task-a', '--push']; return m.main(); })",
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), baseDriftEnv(dir, fixture.tasksRoot), fixture.localDir);
        assert.equal(result.status, 0, result.stderr);
        assert.match(combinedOutput(result), /advanced on 2 files outside this task's Affected Files; they merge cleanly/);
    });
});

void test('commitHumanReviewFiles aborts on a real conflict and undoes its human_review commit', () => {
    withTempDir('run-task-base-drift-conflict-', dir => {
        const fixture = makeBaseDriftFixture(dir, {
            seedFiles: { 'docs/patterns.md': 'a\nb\nc\n' },
            taskFiles: { 'docs/patterns.md': 'TASK\nb\nc\n' },
            declared: ['`docs/patterns.md`'],
        });
        fixture.thirdParty(baseDir => fs.writeFileSync(path.join(baseDir, 'docs/patterns.md'), 'BASE\nb\nc\n', 'utf8'));
        fs.mkdirSync(path.join(fixture.localDir, 'tasks/task-a'), { recursive: true });
        fs.writeFileSync(path.join(fixture.localDir, 'tasks/task-a/done.md'), 'done\n', 'utf8');
        const pre = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture.localDir, encoding: 'utf8' }).trim();
        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            ".then(m => { process.argv = ['node', 'canon', 'task-a', '--push']; return m.main(); })",
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), baseDriftEnv(dir, fixture.tasksRoot), fixture.localDir);
        assert.notEqual(result.status, 0);
        assert.match(combinedOutput(result), /conflicts with origin\/main/);
        assert.match(combinedOutput(result), /docs\/patterns\.md/);
        assert.match(combinedOutput(result), /git rebase origin\/main/);
        assert.match(combinedOutput(result), /human_review commit was undone/);
        assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture.localDir, encoding: 'utf8' }).trim(), pre);
        assert.equal(execFileSync('git', ['ls-remote', '--heads', fixture.originDir, 'task/demo'], { encoding: 'utf8' }).trim(), '');
    });
});

void test('commitHumanReviewFiles reports conflict and scope drift together', () => {
    withTempDir('run-task-base-drift-conflict-scope-', dir => {
        const fixture = makeBaseDriftFixture(dir, {
            seedFiles: { 'docs/patterns.md': 'a\nb\nc\n' },
            taskFiles: { 'docs/patterns.md': 'TASK\nb\nc\n', 'src/extra.ts': 'export {};\n' },
            declared: ['`docs/patterns.md`'],
        });
        fixture.thirdParty(baseDir => fs.writeFileSync(path.join(baseDir, 'docs/patterns.md'), 'BASE\nb\nc\n', 'utf8'));
        fs.mkdirSync(path.join(fixture.localDir, 'tasks/task-a'), { recursive: true });
        fs.writeFileSync(path.join(fixture.localDir, 'tasks/task-a/done.md'), 'done\n', 'utf8');
        const pre = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture.localDir, encoding: 'utf8' }).trim();
        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            ".then(m => { process.argv = ['node', 'canon', 'task-a', '--push']; return m.main(); })",
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), baseDriftEnv(dir, fixture.tasksRoot), fixture.localDir);
        assert.notEqual(result.status, 0);
        assert.match(combinedOutput(result), /conflicts with origin\/main/);
        assert.match(combinedOutput(result), /not in the spec's Affected Files[\s\S]*src\/extra\.ts/);
        assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture.localDir, encoding: 'utf8' }).trim(), pre);
    });
});

void test('human_review conflict in a dirty admitted doc is undone and rerunnable', () => {
    withTempDir('run-task-base-drift-dirty-doc-', dir => {
        const fixture = makeBaseDriftFixture(dir, {
            seedFiles: { 'docs/patterns.md': 'a\nb\nc\n' },
            declared: ['`docs/patterns.md`'],
        });
        const thirdPartyDir = path.join(dir, 'third-party');
        execFileSync('git', ['clone', '-b', 'main', fixture.originDir, thirdPartyDir], { stdio: 'ignore' });
        gitIn(thirdPartyDir, 'config', 'user.email', 'third@example.com');
        gitIn(thirdPartyDir, 'config', 'user.name', 'Third Party');
        fs.writeFileSync(path.join(thirdPartyDir, 'docs/patterns.md'), 'BASE\nb\nc\n', 'utf8');
        gitIn(thirdPartyDir, 'commit', '-am', 'base edit');
        gitIn(thirdPartyDir, 'push', 'origin', 'main');
        fs.writeFileSync(path.join(fixture.localDir, 'docs/patterns.md'), 'TASK\nb\nc\n', 'utf8');
        const pre = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture.localDir, encoding: 'utf8' }).trim();
        const invoke = () => runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            ".then(m => { process.argv = ['node', 'canon', 'task-a', '--push']; return m.main(); })",
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), baseDriftEnv(dir, fixture.tasksRoot), fixture.localDir);
        const blocked = invoke();
        assert.notEqual(blocked.status, 0);
        assert.match(combinedOutput(blocked), /conflicts with origin\/main/);
        assert.match(combinedOutput(blocked), /docs\/patterns\.md/);
        assert.match(combinedOutput(blocked), /human_review commit was undone/);
        assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture.localDir, encoding: 'utf8' }).trim(), pre);
        assert.match(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: fixture.localDir, encoding: 'utf8' }), /docs\/patterns\.md/);
        assert.equal(execFileSync('git', ['ls-remote', '--heads', fixture.originDir, 'task/demo'], { encoding: 'utf8' }).trim(), '');

        gitIn(thirdPartyDir, 'revert', '--no-edit', 'HEAD');
        gitIn(thirdPartyDir, 'push', 'origin', 'main');
        const resumed = invoke();
        assert.equal(resumed.status, 0, resumed.stderr);
        assert.notEqual(execFileSync('git', ['ls-remote', '--heads', fixture.originDir, 'task/demo'], { encoding: 'utf8' }).trim(), '');
        assert.match(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: fixture.localDir, encoding: 'utf8' }), /^chore: add task artifacts for task-a\s*$/);
        assert.match(execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: fixture.localDir, encoding: 'utf8' }), /docs\/patterns\.md/);
    });
});

void test('human_review gate probes the recorded commit after a pre-commit hook rewrite', () => {
    withTempDir('run-task-base-drift-hook-conflict-', dir => {
        const fixture = makeBaseDriftFixture(dir, {
            seedFiles: { 'docs/patterns.md': 'a\nb\nc\n' },
            declared: ['`docs/patterns.md`'],
        });
        fixture.thirdParty(baseDir => fs.writeFileSync(path.join(baseDir, 'docs/patterns.md'), 'BASE\nb\nc\n', 'utf8'));
        fs.writeFileSync(path.join(fixture.localDir, 'docs/patterns.md'), 'a\nb\nTASK\n', 'utf8');
        fs.mkdirSync(path.join(fixture.localDir, 'tasks/task-a'), { recursive: true });
        fs.writeFileSync(path.join(fixture.localDir, 'tasks/task-a/done.md'), 'done\n', 'utf8');
        const hooks = path.join(dir, 'hooks');
        fs.mkdirSync(hooks, { recursive: true });
        fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\nsed \'1s/.*/HOOK/\' docs/patterns.md > docs/patterns.md.tmp && mv docs/patterns.md.tmp docs/patterns.md && git add docs/patterns.md\n', { mode: 0o755 });
        gitIn(fixture.localDir, 'config', 'core.hooksPath', hooks);
        const pre = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture.localDir, encoding: 'utf8' }).trim();
        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            ".then(m => { process.argv = ['node', 'canon', 'task-a', '--push']; return m.main(); })",
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), baseDriftEnv(dir, fixture.tasksRoot), fixture.localDir);
        assert.notEqual(result.status, 0);
        assert.match(combinedOutput(result), /conflicts with origin\/main/);
        assert.match(combinedOutput(result), /docs\/patterns\.md/);
        assert.match(combinedOutput(result), /human_review commit was undone/);
        assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture.localDir, encoding: 'utf8' }).trim(), pre);
        assert.equal(execFileSync('git', ['ls-remote', '--heads', fixture.originDir, 'task/demo'], { encoding: 'utf8' }).trim(), '');
    });
});

void test('clean-tree --pr retries still block on an allowlisted conflict without changing HEAD', () => {
    withTempDir('run-task-base-drift-clean-conflict-', dir => {
        const fixture = makeBaseDriftFixture(dir, {
            seedFiles: { 'docs/patterns.md': 'a\nb\nc\n' },
            taskFiles: { 'docs/patterns.md': 'TASK\nb\nc\n' },
            declared: ['`docs/patterns.md`'],
        });
        fixture.thirdParty(baseDir => fs.writeFileSync(path.join(baseDir, 'docs/patterns.md'), 'BASE\nb\nc\n', 'utf8'));
        const pre = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture.localDir, encoding: 'utf8' }).trim();
        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            ".then(m => { process.argv = ['node', 'canon', 'task-a', '--pr']; return m.main(); })",
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), baseDriftEnv(dir, fixture.tasksRoot), fixture.localDir);
        assert.notEqual(result.status, 0);
        assert.match(combinedOutput(result), /conflicts with origin\/main/);
        assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture.localDir, encoding: 'utf8' }).trim(), pre);
        assert.equal(execFileSync('git', ['ls-remote', '--heads', fixture.originDir, 'task/demo'], { encoding: 'utf8' }).trim(), '');
    });
});

void test('commitHumanReviewFiles unions affected managed docs across bundled tasks', () => {
    withTempDir('run-task-human-review-bundle-union-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a', 'task-b']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`docs/codebase-map.md`']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-b', ['`docs/patterns.md`']);

        const result = runHumanReviewCommit(harness, ['task-a', 'task-b'], {
            FAKE_GIT_STATUS_OUTPUT: [' M docs/codebase-map.md', ' M docs/patterns.md'].join('\n'),
            FAKE_GIT_DIFF_OUTPUT: ['docs/codebase-map.md', 'docs/patterns.md'].join('\n'),
        });

        assert.equal(result.status, 0, result.stderr);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(gitLog, /^add -A -- docs\/codebase-map\.md$/m);
        assert.match(gitLog, /^add -A -- docs\/patterns\.md$/m);
        assert.match(gitLog, /^commit /m);
    });
});

void test('commitHumanReviewFiles warns on malformed affected-file rows without allowing the placeholder', () => {
    withTempDir('run-task-human-review-malformed-row-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`docs/codebase-map.md`', '`<path>`']);

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M docs/codebase-map.md',
            FAKE_GIT_DIFF_OUTPUT: 'docs/codebase-map.md',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(combinedOutput(result), /task-a spec\.md Affected Files row malformed/);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(gitLog, /^add -A -- docs\/codebase-map\.md$/m);
        assert.doesNotMatch(gitLog, /<path>/);
    });
});

void test('commitHumanReviewFiles does not allow non-managed affected-file entries', () => {
    withTempDir('run-task-human-review-source-out-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`src/orchestrator/main.ts`']);

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M src/orchestrator/main.ts',
            FAKE_GIT_DIFF_OUTPUT: '',
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /working tree has dirty files outside the human_review allowlist/);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.doesNotMatch(gitLog, /^commit /m);
        assert.doesNotMatch(gitLog, /^add -A -- src\/orchestrator\/main\.ts$/m);
    });
});

void test('commitHumanReviewFiles filters mixed managed and non-managed affected-file entries per path', () => {
    withTempDir('run-task-human-review-mixed-filter-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', [
            '`docs/codebase-map.md`',
            '`tests/run-task-safety.test.ts`',
        ]);

        const managedResult = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M docs/codebase-map.md',
            FAKE_GIT_DIFF_OUTPUT: 'docs/codebase-map.md',
        });

        assert.equal(managedResult.status, 0, managedResult.stderr);
        assert.match(combinedOutput(managedResult), /WARNING: docs\/codebase-map\.md/);

        const sourceResult = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M tests/run-task-safety.test.ts',
            FAKE_GIT_DIFF_OUTPUT: '',
        });

        assert.notEqual(sourceResult.status, 0);
        assert.match(sourceResult.stderr, /working tree has dirty files outside the human_review allowlist/);
    });
});

void test('main full-send tail fails closed when human_review gate rejects the task', () => {
    withTempDir('run-task-full-send-gate-fail-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const status = makeCompleteStatus('task-a', 'task/task-a');
        const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
        phases.qa = { status: 'done', agent: 'claude' };
        phases.human_review = { status: 'pending', agent: 'human' };
        status.full_send = false;
        status.human_spec_gate = true;
        writeTaskStatus(tasksRoot, 'task-a', status);

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './src/orchestrator/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--full-send'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
        });

        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /handoff\.md|human_review|gate/i);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            phases?: { human_review?: { status?: string } };
        };
        assert.equal(updated.phases?.human_review?.status, 'pending');

        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.doesNotMatch(gitLog, /^push /m);
    });
});

void test('main --full-send rejects multi-branch bundles before gate or PR creation', () => {
    withTempDir('run-task-full-send-bundle-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const taskA = makeCompleteStatus('task-a', 'task/task-a');
        const taskB = makeCompleteStatus('task-b', 'task/task-b');
        for (const [taskId, status] of [['task-a', taskA], ['task-b', taskB]] as const) {
            const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
            phases.qa = { status: 'done', agent: 'claude' };
            phases.human_review = { status: 'pending', agent: 'human' };
            status.full_send = false;
            status.human_spec_gate = true;
            writeTaskStatus(tasksRoot, taskId, status);
        }

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './src/orchestrator/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', 'task-b', '--full-send'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
        });

        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /Full-send tail aborted: bundle spans multiple branches/);

        const statusA = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            full_send?: boolean;
            phases?: { human_review?: { status?: string } };
        };
        const statusB = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-b', 'status.json'), 'utf8')) as {
            full_send?: boolean;
            phases?: { human_review?: { status?: string } };
        };
        assert.equal(statusA.full_send, true);
        assert.equal(statusB.full_send, true);
        assert.equal(statusA.phases?.human_review?.status, 'pending');
        assert.equal(statusB.phases?.human_review?.status, 'pending');

        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.doesNotMatch(gitLog, /^push /m);
    });
});

void test('main rejects hand-edited full_send plus delicate without --force', () => {
    withTempDir('run-task-full-send-hand-edit-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const status = makeCompleteStatus('task-a', 'task/task-a');
        const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
        phases.qa = { status: 'done', agent: 'claude' };
        phases.human_review = { status: 'pending', agent: 'human' };
        status.delicate = true;
        status.full_send = true;
        status.human_spec_gate = false;
        writeTaskStatus(tasksRoot, 'task-a', status);

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './src/orchestrator/main.ts';",
            "process.argv = ['node', 'canon', 'task-a'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
        });

        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /--full-send on delicate task 'task-a' requires --force/);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            full_send?: boolean;
            phases?: { human_review?: { status?: string } };
        };
        assert.equal(updated.full_send, true);
        assert.equal(updated.phases?.human_review?.status, 'pending');

        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.doesNotMatch(gitLog, /^push /m);
    });
});

void test('main full-send tail fails closed when draft PR creation fails', () => {
    withTempDir('run-task-full-send-pr-fail-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        fs.mkdirSync(path.join(worktreesRoot, 'task-a'), { recursive: true });
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const status = makeCompleteStatus('task-a', 'task/task-a');
        status.worktree = true;
        const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
        phases.qa = { status: 'done', agent: 'claude' };
        phases.human_review = { status: 'pending', agent: 'human' };
        status.full_send = false;
        status.human_spec_gate = true;
        writeTaskStatus(tasksRoot, 'task-a', status);
        fs.writeFileSync(path.join(tasksRoot, 'task-a', 'handoff.md'), [
            '# Implementation Handoff: task-a',
            '',
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `lint` | Pass | ok |',
            '',
        ].join('\n'), 'utf8');

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './src/orchestrator/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--full-send'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GH_PR_CREATE_FAIL: '1',
            FAKE_GH_PR_CREATE_ERROR: 'draft PR creation failed',
        });

        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /draft PR creation failed/);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            phases?: { human_review?: { status?: string } };
        };
        assert.equal(updated.phases?.human_review?.status, 'pending');

        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.match(gitLog, /^push -u origin task\/task-a$/m);
    });
});

void test('main --reroute clears full_send', () => {
    withTempDir('run-task-reroute-full-send-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const status = makeCompleteStatus('task-a', 'task/task-a');
        const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
        phases.human_review = { status: 'pending', agent: 'human' };
        status.full_send = true;
        status.human_spec_gate = false;
        writeTaskStatus(tasksRoot, 'task-a', status);
        const worktreesRoot = path.join(dir, 'worktrees');
        writeTaskStatus(path.join(worktreesRoot, 'task-a', 'tasks'), 'task-a', status);
        // This fixture sets CANON_TASKS_DIR_OVERRIDE, so taskDirFor intentionally
        // reads the override root; production worktree-mode reroute reads the
        // active worktree's spec.
        const amendmentSpec = [
            '# Spec',
            '',
            '## Amendment',
            '',
            'Reroute spec amendment for the full_send regression test.',
            '',
        ].join('\n');
        fs.writeFileSync(path.join(tasksRoot, 'task-a', 'spec.md'), amendmentSpec, 'utf8');
        fs.writeFileSync(path.join(worktreesRoot, 'task-a', 'tasks', 'task-a', 'spec.md'), amendmentSpec, 'utf8');

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './src/orchestrator/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--reroute'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stdout, /full_send cleared/);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            full_send?: boolean;
            phases?: {
                spec_review?: { status?: string };
                plan?: { status?: string };
                implement?: { status?: string };
                code_review?: { status?: string };
                qa?: { status?: string };
                human_review?: { status?: string };
            };
        };
        assert.equal(updated.full_send, false);
        assert.equal(updated.phases?.spec_review?.status, 'pending');
        assert.equal(updated.phases?.plan?.status, 'pending');
        assert.equal(updated.phases?.implement?.status, 'pending');
        assert.equal(updated.phases?.code_review?.status, 'pending');
        assert.equal(updated.phases?.qa?.status, 'pending');
        assert.equal(updated.phases?.human_review?.status, 'pending');
    });
});

void test('checkAndRoute parks a crashed Codex spec_review before stale-verdict recovery', () => {
    withTempDir('spec-review-crash-park-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const taskId = 'task-crash';
        writeReviewRecoveryTask(tasksRoot, taskId, 'spec_review', 'in_progress', 'changes_requested', {
            current: 1,
            total: 2,
            changesRequested: 1,
        });

        const result = runNodeInline([
            "import { checkAndRoute, setLastCodexExitStatusForTest } from './src/orchestrator/main.ts';",
            'setLastCodexExitStatusForTest(1);',
            `await checkAndRoute('spec_review', [${JSON.stringify(taskId)}]);`,
        ].join('\n'), {
            ...process.env,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        });

        assert.equal(result.status, 2);
        assert.match(result.stderr, /status 1/);
        assert.match(result.stderr, /did not complete/i);
        assert.match(result.stderr, /no verdict was recorded this round/i);
        assert.match(result.stderr, /out-of-credits/);
        assert.match(result.stderr, /auth/);
        assert.match(result.stderr, /network/);
        assert.match(result.stderr, /MCP crash/);
        assert.match(result.stderr, /canon run task-crash/);
        assert.doesNotMatch(result.stderr, /Attempting one-shot retry/);
        assert.doesNotMatch(result.stderr, /completed despite Codex exit status/);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: {
                spec_review?: {
                    status?: string;
                    verdict?: string;
                    iterations_current_loop?: number;
                    iterations_total?: number;
                    changes_requested_total?: number;
                };
            };
        };
        assert.equal(updated.phases?.spec_review?.status, 'blocked');
        const durable = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as StatusJson;
        assert.equal(durable.phases.spec_review?.auto_block_count, 1);
        assert.equal(durable.escalations?.length, 1);
        assert.equal(durable.escalations?.at(-1)?.phase, 'spec_review');
        assert.equal(durable.escalations?.at(-1)?.iteration_count, 1);
        assert.match(durable.escalations.at(-1)!.reason, /canon run task-crash/);
        assert.equal(updated.phases?.spec_review?.verdict, '');
        assert.equal(updated.phases?.spec_review?.iterations_current_loop, 1);
        assert.equal(updated.phases?.spec_review?.iterations_total, 2);
        assert.equal(updated.phases?.spec_review?.changes_requested_total, 1);
    });
});

void test('checkAndRoute accepts a self-bookkept spec_review despite a trailing non-zero Codex exit', () => {
    withTempDir('spec-review-done-nonzero-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const taskId = 'task-done';
        writeReviewRecoveryTask(tasksRoot, taskId, 'spec_review', 'done', 'approved_with_nits', {
            current: 0,
            total: 1,
            changesRequested: 0,
        });

        const result = runNodeInline([
            "import { checkAndRoute, setLastCodexExitStatusForTest } from './src/orchestrator/main.ts';",
            'setLastCodexExitStatusForTest(1);',
            `await checkAndRoute('spec_review', [${JSON.stringify(taskId)}]);`,
        ].join('\n'), {
            ...process.env,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /completed despite Codex exit status 1/);
        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: { spec_review?: { status?: string; verdict?: string } };
        };
        assert.equal(updated.phases?.spec_review?.status, 'done');
        assert.equal(updated.phases?.spec_review?.verdict, 'approved_with_nits');
    });
});

void test('checkAndRoute still auto-advances a clean-exit spec_review from its fresh verdict', () => {
    withTempDir('spec-review-clean-recovery-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const taskId = 'task-fresh';
        writeReviewRecoveryTask(tasksRoot, taskId, 'spec_review', 'in_progress', 'changes_requested', {
            current: 0,
            total: 1,
            changesRequested: 1,
        });

        const result = runNodeInline([
            "import { checkAndRoute, setLastCodexExitStatusForTest } from './src/orchestrator/main.ts';",
            'setLastCodexExitStatusForTest(0);',
            `await checkAndRoute('spec_review', [${JSON.stringify(taskId)}]);`,
        ].join('\n'), {
            ...process.env,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /Auto-advanced 'spec_review'/);
        assert.match(result.stderr, /verdict=changes_requested/);
        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: {
                spec?: { status?: string };
                spec_review?: {
                    status?: string;
                    verdict?: string;
                    iterations_current_loop?: number;
                    iterations_total?: number;
                    changes_requested_total?: number;
                };
            };
        };
        assert.equal(updated.phases?.spec?.status, 'pending');
        assert.equal(updated.phases?.spec_review?.status, 'pending');
        assert.equal(updated.phases?.spec_review?.verdict, '');
        assert.equal(updated.phases?.spec_review?.iterations_current_loop, 1);
        assert.equal(updated.phases?.spec_review?.iterations_total, 2);
        assert.equal(updated.phases?.spec_review?.changes_requested_total, 2);
    });
});

void test('crashed-review park is spec_review-only and code_review recovery remains unchanged', () => {
    assert.equal(shouldParkCrashedReview('spec_review', 1), true);
    assert.equal(shouldParkCrashedReview('spec_review', 0), false);
    for (const phase of ['code_review', 'plan', 'implement', 'qa'] as const) {
        assert.equal(shouldParkCrashedReview(phase, 1), false);
    }

    withTempDir('code-review-clean-recovery-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const taskId = 'task-code-review';
        writeReviewRecoveryTask(tasksRoot, taskId, 'code_review', 'in_progress', 'approved');

        const result = runNodeInline([
            "import { checkAndRoute, setLastCodexExitStatusForTest } from './src/orchestrator/main.ts';",
            'setLastCodexExitStatusForTest(0);',
            `await checkAndRoute('code_review', [${JSON.stringify(taskId)}]);`,
        ].join('\n'), {
            ...process.env,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /Auto-advanced 'code_review'/);
        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: { code_review?: { status?: string; verdict?: string } };
        };
        assert.equal(updated.phases?.code_review?.status, 'done');
        assert.equal(updated.phases?.code_review?.verdict, 'approved');
    });
});

void test('main blocks a capped spec loop before revision, re-blocks on resume, and its advertised reset works', { concurrency: false }, () => {
    withTempDir('preroute-spec-loop-cap-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'spec-loop-cap';
        const cap = 3;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'spec_review', cap);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        const agentLog = path.join(localDir, 'agent-invocations.log');

        const first = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap);
        assert.deepEqual(readAgentInvocations(agentLog), []);
        assert.equal(first.status, 2, combinedOutput(first));

        const blocked = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            status?: string;
            escalations?: Array<{ phase?: string; reason?: string }>;
            phases?: {
                spec?: { status?: string };
                spec_review?: { status?: string; auto_block_count?: number };
            };
        };
        assert.equal(blocked.status, 'spec');
        assert.equal(blocked.phases?.spec?.status, 'pending');
        assert.equal(blocked.phases?.spec_review?.status, 'blocked');
        assert.equal(blocked.phases?.spec_review?.auto_block_count, 1);
        assert.equal(blocked.escalations?.length, 1);
        assert.equal(blocked.escalations?.[0]?.phase, 'spec_review');
        const firstResumePhase = blocked.escalations?.[0]?.reason?.match(/Resuming after raising the cap runs `([a-z_]+)`/)?.[1];
        assert.equal(firstResumePhase, 'spec');

        const resumed = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap);
        assert.equal(resumed.status, 2, combinedOutput(resumed));
        assert.deepEqual(readAgentInvocations(agentLog), []);
        const reblocked = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            escalations?: unknown[];
            phases?: { spec_review?: { auto_block_count?: number } };
        };
        assert.equal(reblocked.escalations?.length, 2);
        assert.equal(reblocked.phases?.spec_review?.auto_block_count, 2);

        const specReset = blocked.escalations?.[0]?.reason?.match(/canon task (reset-spec-review) ([^\s;]+)/);
        assert.ok(specReset, blocked.escalations?.[0]?.reason);
        assert.equal(specReset[2], taskId);
        assert.ok(combinedOutput(first).includes(`canon task ${specReset[1]} ${specReset[2]}`));
        withFakeGitEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot }, () => {
            taskCmd([specReset[1], specReset[2]]);
        });
        const reset = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            status?: string;
            sessions?: { claude_spec?: string };
            phases?: {
                spec?: { status?: string };
                spec_review?: { status?: string; iterations?: number; iterations_current_loop?: number; verdict?: string };
            };
        };
        assert.equal(reset.status, 'spec_review');
        assert.equal(reset.phases?.spec?.status, 'done');
        assert.equal(reset.phases?.spec_review?.status, 'pending');
        assert.equal(reset.phases?.spec_review?.iterations, 0);
        assert.equal(reset.phases?.spec_review?.iterations_current_loop, 0);
        assert.equal(reset.phases?.spec_review?.verdict, '');
        assert.equal(reset.sessions?.claude_spec, undefined);
        assert.equal(fs.existsSync(path.join(tasksRoot, taskId, 'spec-review-prior-1.md')), true);
    });
});

void test('main blocks a capped code loop before implementation side effects, re-blocks, and its advertised reset works', { concurrency: false }, () => {
    withTempDir('preroute-code-loop-cap-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'code-loop-cap';
        const cap = 3;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', cap);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        const agentLog = path.join(localDir, 'agent-invocations.log');
        const baseTipBefore = execFileSync('git', ['rev-parse', 'main'], { cwd: localDir, encoding: 'utf8' }).trim();

        const first = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap);
        assert.equal(first.status, 2, combinedOutput(first));
        assert.deepEqual(readAgentInvocations(agentLog), []);
        assert.equal(
            execFileSync('git', ['rev-parse', 'main'], { cwd: localDir, encoding: 'utf8' }).trim(),
            baseTipBefore,
        );

        const blocked = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            status?: string;
            escalations?: Array<{ phase?: string; reason?: string }>;
            phases?: {
                implement?: { status?: string };
                code_review?: {
                    status?: string;
                    iterations_total?: number;
                    auto_block_count?: number;
                };
            };
        };
        assert.equal(blocked.status, 'implement');
        assert.equal(blocked.phases?.implement?.status, 'pending');
        assert.equal(blocked.phases?.code_review?.status, 'blocked');
        assert.equal(blocked.phases?.code_review?.auto_block_count, 1);
        assert.equal(blocked.escalations?.length, 1);
        assert.equal(blocked.escalations?.[0]?.phase, 'code_review');
        const firstResumePhase = blocked.escalations?.[0]?.reason?.match(/Resuming after raising the cap runs `([a-z_]+)`/)?.[1];
        assert.equal(firstResumePhase, 'implement');

        const resumed = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap);
        assert.equal(resumed.status, 2, combinedOutput(resumed));
        assert.deepEqual(readAgentInvocations(agentLog), []);
        const reblocked = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            escalations?: unknown[];
            sessions?: { claude_review?: string };
            phases?: {
                code_review?: {
                    iterations_total?: number;
                    auto_block_count?: number;
                };
            };
        };
        assert.equal(reblocked.escalations?.length, 2);
        assert.equal(reblocked.phases?.code_review?.auto_block_count, 2);
        const preservedTotal = reblocked.phases?.code_review?.iterations_total;
        const preservedAutoBlocks = reblocked.phases?.code_review?.auto_block_count;

        const codeReset = blocked.escalations?.[0]?.reason?.match(/canon task (reset-code-review) ([^\s;]+)/);
        assert.ok(codeReset, blocked.escalations?.[0]?.reason);
        assert.equal(codeReset[2], taskId);
        assert.ok(combinedOutput(first).includes(`canon task ${codeReset[1]} ${codeReset[2]}`));
        withFakeGitEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot }, () => {
            taskCmd([codeReset[1], codeReset[2]]);
        });
        const reset = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            status?: string;
            sessions?: { claude_review?: string };
            phases?: {
                implement?: { status?: string };
                code_review?: {
                    status?: string;
                    iterations?: number;
                    iterations_current_loop?: number;
                    iterations_total?: number;
                    preflight_rejections_current_loop?: number;
                    auto_block_count?: number;
                    verdict?: string;
                };
            };
        };
        assert.equal(reset.status, 'code_review');
        assert.equal(reset.phases?.implement?.status, 'done');
        assert.equal(reset.phases?.code_review?.status, 'pending');
        assert.equal(reset.phases?.code_review?.iterations, 0);
        assert.equal(reset.phases?.code_review?.iterations_current_loop, 0);
        assert.equal(reset.phases?.code_review?.preflight_rejections_current_loop, 0);
        assert.equal(reset.phases?.code_review?.verdict, '');
        assert.equal(reset.phases?.code_review?.iterations_total, preservedTotal);
        assert.equal(reset.phases?.code_review?.auto_block_count, preservedAutoBlocks);
        assert.equal(reset.sessions?.claude_review, undefined);
        assert.equal(fs.existsSync(path.join(tasksRoot, taskId, 'review-prior-1.md')), true);
    });
});

void test('main runs the first spec write when MAX_REVIEW_LOOPS=0 on a genuinely fresh task', { concurrency: false }, () => {
    // MAX_REVIEW_LOOPS=0 is a valid, tested "no retries after review requests
    // changes" override (tests/pipeline-policy.test.ts) -- not "no work at
    // all". A fresh task's spec_review.iterations_current_loop is 0, same as
    // a capped-out task's threshold, so gating the revision-entry checkpoint
    // on count >= cap alone would also block the very first spec write.
    // Real Codex PR finding (src/orchestrator/phases/implement.ts; mirrored
    // here on the spec side).
    withTempDir('preroute-spec-zero-cap-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'spec-zero-cap';
        const cap = 0;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'spec_review', 0);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        const agentLog = path.join(localDir, 'agent-invocations.log');

        const first = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap);
        assert.equal(first.status, 0, combinedOutput(first));
        assert.notDeepEqual(readAgentInvocations(agentLog), []);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: { spec?: { status?: string }; spec_review?: { status?: string } };
        };
        assert.equal(updated.phases?.spec?.status, 'done');
    });
});

void test('main runs the first implement pass when MAX_REVIEW_LOOPS=0 on a genuinely fresh task', { concurrency: false }, () => {
    withTempDir('preroute-code-zero-cap-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'code-zero-cap';
        const cap = 0;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', 0);
        // writeReviewLoopFixture's spec.md has no Validation Required
        // section -- fine for the block-path tests it was built for, but
        // this test lets implement actually run to completion, and
        // checkPhaseGate('implement') requires that section to be present
        // with at least one `[x]`-checked item.
        fs.appendFileSync(
            path.join(tasksRoot, taskId, 'spec.md'),
            '\n## Validation Required\n\n- [x] `npm test`\n',
            'utf8',
        );
        // writeReviewLoopFixture's handoff.md claims initial-fixture.txt
        // changed (matching makeGitFixture's own tracked file of that
        // name), but the fake codex agent normally only flips status.json
        // -- it never actually touches the file. The orchestrator (not the
        // agent) owns staging and committing, so give the fake agent a
        // real, uncommitted working-tree edit to leave behind, matching
        // what handoff.md claims and what a real agent would do.
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        fs.writeFileSync(path.join(fakeBins, 'codex'), [
            '#!/bin/sh',
            'if [ "${1:-}" = "--version" ]; then printf "%s\\n" "fake-agent 1.0"; exit 0; fi',
            'printf "%s\\n" "codex" >> "$FAKE_AGENT_LOG"',
            'printf "fixture\\n" > initial-fixture.txt',
            'if [ -n "${FAKE_AGENT_COMPLETE_PHASE:-}${FAKE_AGENT_COMPLETE_SEQUENCE:-}" ]; then node "$FAKE_AGENT_COMPLETER"; fi',
            'exit 0',
        ].join('\n'), { mode: 0o755 });
        const agentLog = path.join(localDir, 'agent-invocations.log');

        const first = runReviewLoopMain(
            localDir, tasksRoot, fakeBins, taskId, cap, [], { FAKE_AGENT_COMPLETE_PHASE: 'implement' },
        );
        assert.equal(first.status, 0, combinedOutput(first));
        assert.deepEqual(readAgentInvocations(agentLog), ['codex']);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: { implement?: { status?: string } };
        };
        assert.equal(updated.phases?.implement?.status, 'done');
    });
});

void test('implement docs-refs fix-up resumes Codex before the auto-commit hook', { concurrency: false }, () => {
    withTempDir('artifact-fixup-implement-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'artifact-fixup-implement';
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', 0);
        fs.appendFileSync(path.join(tasksRoot, taskId, 'spec.md'), '\n## Validation Required\n\n- [x] `npm test`\n');
        // Fixture-only self-listing row makes the fixed handoff part of the auto-commit,
        // allowing this test to verify the committed artifact blob.
        fs.writeFileSync(path.join(tasksRoot, taskId, 'handoff.md'), fs.readFileSync(path.join(tasksRoot, taskId, 'handoff.md'), 'utf8')
            .replace('| `initial-fixture.txt` | fixture |', `| \`initial-fixture.txt\` | fixture |\n| \`tasks/${taskId}/handoff.md\` | fixed artifact |`));
        installDocsRefsChecker(localDir, { hook: true });
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        const editScript = path.join(dir, 'implement-artifact-edit.mjs');
        fs.writeFileSync(editScript, [
            "import fs from 'node:fs';",
            `const file = ${JSON.stringify(path.join(tasksRoot, taskId, 'handoff.md'))};`,
            "fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('`src/removed-by-task.ts`', '[src/removed-by-task.ts](src/removed-by-task.ts)'));",
        ].join('\n'));
        fs.writeFileSync(path.join(fakeBins, 'codex'), [
            '#!/bin/sh',
            'if [ "${1:-}" = "--version" ]; then printf "%s\\n" "fake-agent 1.0"; exit 0; fi',
            'printf "%s\\n" "codex" >> "$FAKE_AGENT_LOG"',
            'node -e \'require("fs").appendFileSync(process.env.FAKE_AGENT_ARGV_LOG, JSON.stringify({agent:"codex",argv:process.argv.slice(1),cwd:process.cwd()})+"\\n")\' "$@"',
            'is_resume=0; for arg in "$@"; do if [ "$arg" = "resume" ]; then is_resume=1; fi; done',
            'if [ "$is_resume" = "1" ]; then node "$FAKE_AGENT_EDIT_SCRIPT"; exit 0; fi',
            'printf "fixture\\n" > initial-fixture.txt',
            'if [ -n "${FAKE_AGENT_SEED_FILE:-}" ]; then printf "\\nSee \\`src/removed-by-task.ts\\` for details.\\n" >> "$FAKE_AGENT_SEED_FILE"; fi',
            'if [ -n "${FAKE_AGENT_COMPLETER:-}" ]; then node "$FAKE_AGENT_COMPLETER"; fi',
            'printf \'{"type":"thread.started","thread_id":"implement-session-for-fixup"}\\n\'',
            'exit 0',
        ].join('\n'), { mode: 0o755 });
        const argvLog = path.join(dir, 'implement-agent-argv.jsonl');
        const result = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, 3, [], {
            FAKE_AGENT_COMPLETE_PHASE: 'implement',
            FAKE_AGENT_SEED_FILE: path.join(tasksRoot, taskId, 'handoff.md'),
            FAKE_AGENT_EDIT_SCRIPT: editScript,
            FAKE_AGENT_ARGV_LOG: argvLog,
            FAKE_AGENT_LOG: path.join(dir, 'implement-agent-invocations.log'),
        });
        assert.equal(result.status, 0, combinedOutput(result));
        assert.match(result.stdout, /Artifact fix-up \(attempt 1\/2\)/);
        assert.match(fs.readFileSync(path.join(tasksRoot, taskId, 'handoff.md'), 'utf8'), /\[src\/removed-by-task\.ts\]\(src\/removed-by-task\.ts\)/);
        const committedHandoff = execFileSync('git', ['show', `HEAD:tasks/${taskId}/handoff.md`], { cwd: localDir, encoding: 'utf8' });
        assert.match(committedHandoff, /\[src\/removed-by-task\.ts\]\(src\/removed-by-task\.ts\)/);
        assert.doesNotMatch(committedHandoff, /`src\/removed-by-task\.ts`/);
        assert.equal(execFileSync('git', ['show', 'HEAD:initial-fixture.txt'], { cwd: localDir, encoding: 'utf8' }), 'fixture\n');
        const entries = fs.readFileSync(argvLog, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { argv: string[] });
        assert.equal(entries.filter(entry => entry.argv.includes('resume') && entry.argv.includes('implement-session-for-fixup')).length, 1);
        const status = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as { status: string; phases: { implement: { status: string } } };
        assert.equal(status.status, 'code_review');
        assert.equal(status.phases.implement.status, 'done');
    });
});

void test('implement docs-refs fix-up retries twice then preserves the rejecting-hook failure', { concurrency: false }, () => {
    withTempDir('artifact-fixup-implement-fallback-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'artifact-fixup-implement-fallback';
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', 0);
        fs.appendFileSync(path.join(tasksRoot, taskId, 'spec.md'), '\n## Validation Required\n\n- [x] `npm test`\n');
        installDocsRefsChecker(localDir, { hook: true });
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        fs.writeFileSync(path.join(fakeBins, 'codex'), [
            '#!/bin/sh',
            'if [ "${1:-}" = "--version" ]; then printf "%s\\n" "fake-agent 1.0"; exit 0; fi',
            'printf "%s\\n" "codex" >> "$FAKE_AGENT_LOG"',
            'node -e \'require("fs").appendFileSync(process.env.FAKE_AGENT_ARGV_LOG, JSON.stringify(process.argv.slice(1))+"\\n")\' -- "$@"',
            'is_resume=0; for arg in "$@"; do if [ "$arg" = "resume" ]; then is_resume=1; fi; done',
            'if [ "$is_resume" = "1" ]; then exit 0; fi',
            'printf "fixture\\n" > initial-fixture.txt',
            'if [ -n "${FAKE_AGENT_SEED_FILE:-}" ]; then printf "\\nSee \\`src/removed-by-task.ts\\` for details.\\n" >> "$FAKE_AGENT_SEED_FILE"; fi',
            'node "$FAKE_AGENT_COMPLETER"',
            'printf \'{"type":"thread.started","thread_id":"fallback-implement-session"}\\n\'',
            'exit 0',
        ].join('\n'), { mode: 0o755 });
        const argvLog = path.join(dir, 'agent-argv.jsonl');
        const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: localDir, encoding: 'utf8' }).trim();
        const result = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, 3, [], {
            FAKE_AGENT_COMPLETE_PHASE: 'implement',
            FAKE_AGENT_SEED_FILE: path.join(tasksRoot, taskId, 'handoff.md'),
            FAKE_AGENT_ARGV_LOG: argvLog,
            FAKE_AGENT_LOG: path.join(dir, 'agent-invocations.log'),
        });
        const output = combinedOutput(result);
        assert.equal(result.status, 1, output);
        assert.match(output, /after 2 fix-up attempts/);
        assert.match(output, /tasks\/artifact-fixup-implement-fallback\/handoff\.md:.*missing file/);
        assert.match(output, /Auto-commit failed:/);
        const entries = fs.readFileSync(argvLog, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]);
        assert.equal(entries.filter(argv => argv.includes('resume') && argv.includes('fallback-implement-session')).length, 2);
        const status = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases: { implement: { status: string }; code_review: { preflight_rejections_current_loop: number; iterations_current_loop: number } };
        };
        assert.equal(status.phases.implement.status, 'done');
        assert.equal(status.phases.code_review.preflight_rejections_current_loop, 0);
        assert.equal(status.phases.code_review.iterations_current_loop, 0);
        assert.deepEqual(nonScaffoldCommits(localDir, headBefore), []);
    });
});

void test('implement docs-refs fix-up makes no resume for unrelated, absent-session, and non-owned findings', { concurrency: false }, () => {
    withTempDir('artifact-fixup-no-resume-', root => {
        const unrelated = prepareImplementFixupFixture(path.join(root, 'unrelated'), 'artifact-fixup-unrelated-hook', { artifactFinding: 'none', session: true, hook: 'fail' });
        assert.equal(unrelated.result.status, 1, combinedOutput(unrelated.result));
        assert.match(combinedOutput(unrelated.result), /Auto-commit failed:/);
        assert.equal(countResumes(unrelated.argvLog), 0);

        const noSession = prepareImplementFixupFixture(path.join(root, 'no-session'), 'artifact-fixup-no-session', { artifactFinding: 'handoff', session: false, hook: 'checker' });
        assert.equal(noSession.result.status, 1, combinedOutput(noSession.result));
        assert.match(combinedOutput(noSession.result), /no codex session is available/i);
        assert.match(combinedOutput(noSession.result), /Auto-commit failed:/);
        assert.equal(countResumes(noSession.argvLog), 0);

        const unrelatedFinding = prepareImplementFixupFixture(path.join(root, 'review-only'), 'artifact-fixup-review-only', { artifactFinding: 'review', session: true, hook: 'checker' });
        assert.equal(unrelatedFinding.result.status, 1, combinedOutput(unrelatedFinding.result));
        assert.match(combinedOutput(unrelatedFinding.result), /Auto-commit failed:/);
        assert.match(combinedOutput(unrelatedFinding.result), /tasks\/artifact-fixup-review-only\/review\.md:.*missing file/);
        assert.equal(countResumes(unrelatedFinding.argvLog), 0);

        const checkerAbsent = prepareImplementFixupFixture(path.join(root, 'checker-absent'), 'artifact-fixup-checker-absent', {
            artifactFinding: 'handoff', session: true, hook: 'absent',
        });
        const checkerAbsentOutput = combinedOutput(checkerAbsent.result);
        assert.equal(checkerAbsent.result.status, 0, checkerAbsentOutput);
        assert.equal(countResumes(checkerAbsent.argvLog), 0);
        assert.equal(execFileSync('git', ['show', 'HEAD:initial-fixture.txt'], { cwd: checkerAbsent.localDir, encoding: 'utf8' }), 'fixture\n');
    });
});

void test('implement docs-refs fix-up stops on edits outside its artifacts and catches failed resumes locally', { concurrency: false }, () => {
    withTempDir('artifact-fixup-scope-', root => {
        for (const [taskId, target] of [
            ['artifact-fixup-dirty-source', 'initial-fixture.txt'],
            ['artifact-fixup-status-edit', 'tasks/artifact-fixup-status-edit/status.json'],
        ]) {
            const dir = path.join(root, taskId);
            const editScript = path.join(dir, 'edit.mjs');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(editScript, `import fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(target)}, '\\nchanged by fix-up');\n`);
            const fixture = prepareImplementFixupFixture(dir, taskId, { artifactFinding: 'handoff', session: true, hook: 'checker', resumeScript: editScript });
            const output = combinedOutput(fixture.result);
            assert.equal(fixture.result.status, 1, output);
            assert.match(output, /changed files outside its own artifacts/);
            assert.match(output, new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
            assert.deepEqual(nonScaffoldCommits(fixture.localDir, fixture.headBefore), []);
        }

        const commitDir = path.join(root, 'committed-edit');
        const commitScript = path.join(commitDir, 'commit-edit.mjs');
        fs.mkdirSync(commitDir, { recursive: true });
        fs.writeFileSync(commitScript, [
            "import fs from 'node:fs';",
            "import { execFileSync } from 'node:child_process';",
            "fs.writeFileSync('clean-tracked.txt', 'changed and committed by fix session\\n');",
            "execFileSync('git', ['add', 'clean-tracked.txt']);",
            "execFileSync('git', ['commit', '--no-verify', '-m', 'agent out-of-scope commit'], { stdio: 'ignore' });",
        ].join('\n'));
        const committedEdit = prepareImplementFixupFixture(commitDir, 'artifact-fixup-committed-edit', {
            artifactFinding: 'handoff', session: true, hook: 'checker', resumeScript: commitScript, commitCleanFile: true,
        });
        const committedOutput = combinedOutput(committedEdit.result);
        assert.equal(committedEdit.result.status, 1, committedOutput);
        assert.match(committedOutput, /changed files outside its own artifacts/);
        assert.match(committedOutput, /\[git HEAD\]/);
        assert.equal(nonScaffoldCommits(committedEdit.localDir, committedEdit.headBefore).length, 1);
        assert.equal(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: committedEdit.localDir, encoding: 'utf8' }).trim(), 'agent out-of-scope commit');
        assert.equal(execFileSync('git', ['show', 'HEAD:clean-tracked.txt'], { cwd: committedEdit.localDir, encoding: 'utf8' }), 'changed and committed by fix session\n');

        const failedDir = path.join(root, 'failed-resume');
        const failed = prepareImplementFixupFixture(failedDir, 'artifact-fixup-failed-resume', {
            artifactFinding: 'handoff', session: true, hook: 'fail', failResume: true,
        });
        const failedOutput = combinedOutput(failed.result);
        assert.equal(failed.result.status, 1, failedOutput);
        assert.match(failedOutput, /Codex exited with status 7/);
        assert.match(failedOutput, /Auto-commit failed:/);
        const failedStatus = JSON.parse(fs.readFileSync(path.join(failed.tasksRoot, 'artifact-fixup-failed-resume/status.json'), 'utf8')) as {
            phases: { implement: { status: string } };
        };
        assert.equal(failedStatus.phases.implement.status, 'done');
        assert.equal(countResumes(failed.argvLog), 1);
    });
});

void test('QA artifact fix-up warns after two failures and continues when no session exists', { concurrency: false }, () => {
    withTempDir('artifact-fixup-qa-fallbacks-', root => {
        const neverFixed = prepareQaFixupFixture(path.join(root, 'never-fixed'), 'artifact-fixup-qa-never-fixed', { session: true });
        const neverOutput = combinedOutput(neverFixed.result);
        assert.equal(neverFixed.result.status, 0, neverOutput);
        assert.match(neverOutput, /after 2 fix-up attempts/);
        assert.match(neverOutput, /tasks\/artifact-fixup-qa-never-fixed\/done\.md:.*missing file/);
        assert.match(neverOutput, /human_review/);
        assert.equal(countResumes(neverFixed.argvLog), 2);
        const neverStatus = JSON.parse(fs.readFileSync(path.join(neverFixed.tasksRoot, 'artifact-fixup-qa-never-fixed/status.json'), 'utf8')) as { phases: { qa: { status: string } } };
        assert.equal(neverStatus.phases.qa.status, 'done');
        assert.ok(execFileSync('git', ['show', 'HEAD:tasks/artifact-fixup-qa-never-fixed/done.md'], { cwd: neverFixed.localDir, encoding: 'utf8' }));

        const noSession = prepareQaFixupFixture(path.join(root, 'no-session'), 'artifact-fixup-qa-no-session', {});
        const noSessionOutput = combinedOutput(noSession.result);
        assert.equal(noSession.result.status, 0, noSessionOutput);
        assert.match(noSessionOutput, /no claude session is available/i);
        assert.match(noSessionOutput, /human_review/);
        assert.equal(countResumes(noSession.argvLog), 0);
        const noSessionStatus = JSON.parse(fs.readFileSync(path.join(noSession.tasksRoot, 'artifact-fixup-qa-no-session/status.json'), 'utf8')) as { phases: { qa: { status: string } } };
        assert.equal(noSessionStatus.phases.qa.status, 'done');
        assert.ok(execFileSync('git', ['show', 'HEAD:tasks/artifact-fixup-qa-no-session/done.md'], { cwd: noSession.localDir, encoding: 'utf8' }));
    });
});

void test('QA fix-up catches a failed resume locally and guards non-artifact edits', { concurrency: false }, () => {
    withTempDir('artifact-fixup-qa-guard-', root => {
        const failed = prepareQaFixupFixture(path.join(root, 'failed'), 'artifact-fixup-qa-failed', { session: true, failResume: true });
        const failedOutput = combinedOutput(failed.result);
        assert.equal(failed.result.status, 0, failedOutput);
        assert.match(failedOutput, /Artifact fix-up session failed/);
        assert.equal(countResumes(failed.argvLog), 1);
        const failedStatus = JSON.parse(fs.readFileSync(path.join(failed.tasksRoot, 'artifact-fixup-qa-failed/status.json'), 'utf8')) as { status: string; phases: { qa: { status: string } } };
        assert.equal(failedStatus.status, 'human_review');
        assert.equal(failedStatus.phases.qa.status, 'done');
        assert.ok(execFileSync('git', ['show', 'HEAD:tasks/artifact-fixup-qa-failed/done.md'], { cwd: failed.localDir, encoding: 'utf8' }));

        const escaped = prepareQaFixupFixture(path.join(root, 'escaped'), 'artifact-fixup-qa-scope', { session: true, editOutside: true });
        const escapedOutput = combinedOutput(escaped.result);
        assert.equal(escaped.result.status, 1, escapedOutput);
        assert.match(escapedOutput, /changed files outside its own artifacts/);
        assert.match(escapedOutput, /initial-fixture\.txt/);
        assert.equal(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: escaped.localDir, encoding: 'utf8' }).trim(), '2');
    });
});

void test('main blocks a code loop when reviewer plus pre-flight attempts reach the cap', { concurrency: false }, () => {
    withTempDir('preroute-code-loop-combined-cap-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'code-loop-combined-cap';
        const cap = 3;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', 1, 2);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        const agentLog = path.join(localDir, 'agent-invocations.log');
        const baseTipBefore = execFileSync('git', ['rev-parse', 'main'], { cwd: localDir, encoding: 'utf8' }).trim();

        const result = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap);
        assert.equal(result.status, 2, combinedOutput(result));
        assert.deepEqual(readAgentInvocations(agentLog), []);
        assert.equal(
            execFileSync('git', ['rev-parse', 'main'], { cwd: localDir, encoding: 'utf8' }).trim(),
            baseTipBefore,
        );
        const blocked = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            status?: string;
            escalations?: Array<{ phase?: string }>;
            phases?: { code_review?: { status?: string } };
        };
        assert.equal(blocked.status, 'implement');
        assert.equal(blocked.phases?.code_review?.status, 'blocked');
        assert.equal(blocked.escalations?.at(-1)?.phase, 'code_review');
    });
});

void test('force-accepting a pre-route code-review block makes the follow-on run enter QA without Codex', { concurrency: false }, () => {
    withTempDir('preroute-code-loop-force-accept-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'code-loop-force-accept';
        const cap = 3;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', cap);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        const agentLog = path.join(localDir, 'agent-invocations.log');

        assert.equal(runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap).status, 2);
        assert.deepEqual(readAgentInvocations(agentLog), []);

        const taskModuleHref = pathToFileURL(path.join(WORKTREE_ROOT, 'src', 'task', 'index.ts')).href;
        const accepted = runNodeInline([
            `import(${JSON.stringify(taskModuleHref)})`,
            `.then(m => m.taskAccept([${JSON.stringify(taskId)}], 'code_review', { force: true, reason: 'operator accepted current implementation' }))`,
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), {
            ...process.env,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        }, localDir);
        assert.equal(accepted.status, 0, combinedOutput(accepted));
        assert.match(accepted.stdout, /Next phase: qa/);

        const qaRun = runReviewLoopMain(
            localDir,
            tasksRoot,
            fakeBins,
            taskId,
            cap,
            ['--expect', 'qa'],
            { FAKE_AGENT_COMPLETE_PHASE: 'qa' },
        );
        assert.deepEqual(readAgentInvocations(agentLog), ['claude'], combinedOutput(qaRun));
    });
});

void test('spec-review entry retains the capped-loop backstop and persists state-accurate recovery text', { concurrency: false }, () => {
    withTempDir('spec-review-loop-backstop-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'spec-review-backstop';
        const cap = 3;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'spec_review', cap, 0, true);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);

        const result = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap);
        assert.equal(result.status, 2, combinedOutput(result));
        assert.deepEqual(readAgentInvocations(path.join(localDir, 'agent-invocations.log')), []);
        const blocked = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            status?: string;
            escalations?: Array<{ reason?: string }>;
            phases?: { spec_review?: { status?: string } };
        };
        assert.equal(blocked.status, 'spec_review');
        assert.equal(blocked.phases?.spec_review?.status, 'blocked');
        const reason = blocked.escalations?.at(-1)?.reason ?? '';
        assert.equal(reason.match(/Resuming after raising the cap runs `([a-z_]+)`/)?.[1], 'spec_review');
        assert.doesNotMatch(reason, /iterations_current_loop\s*=/);
        assert.doesNotMatch(reason, /phases\.spec_review\.status\s*=/);
    });
});

void test('raising the spec-loop cap resumes the deferred spec phase before spec_review', { concurrency: false }, () => {
    withTempDir('preroute-spec-loop-raised-cap-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'spec-loop-raised-cap';
        const cap = 3;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'spec_review', cap);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        const agentLog = path.join(localDir, 'agent-invocations.log');

        assert.equal(runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap).status, 2);
        const resumed = runReviewLoopMain(
            localDir,
            tasksRoot,
            fakeBins,
            taskId,
            cap + 1,
            ['--expect', 'spec'],
            { FAKE_AGENT_COMPLETE_PHASE: 'spec' },
        );
        assert.deepEqual(readAgentInvocations(agentLog), ['claude']);
        assert.doesNotMatch(combinedOutput(resumed), /--expect spec but current phase/);
        const afterResume = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: { spec_review?: { status?: string } };
        };
        assert.equal(afterResume.phases?.spec_review?.status, 'blocked');
    });

    withTempDir('preroute-spec-loop-wrong-expect-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'spec-loop-wrong-expect';
        const cap = 3;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'spec_review', cap);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        assert.equal(runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap).status, 2);

        const wrongExpect = runReviewLoopMain(
            localDir,
            tasksRoot,
            fakeBins,
            taskId,
            cap + 1,
            ['--expect', 'spec_review'],
        );
        assert.match(combinedOutput(wrongExpect), /--expect spec_review but current phase is spec/);
        assert.deepEqual(readAgentInvocations(path.join(localDir, 'agent-invocations.log')), []);
    });
});

void test('a plain raised-cap run completes the deferred spec revision and following review in one process', { concurrency: false }, () => {
    withTempDir('preroute-spec-loop-raised-cap-full-run-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'spec-loop-raised-cap-full-run';
        const cap = 3;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'spec_review', cap);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        const agentLog = path.join(localDir, 'agent-invocations.log');

        assert.equal(runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap).status, 2);
        const statusPath = path.join(tasksRoot, taskId, 'status.json');
        const blocked = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as StatusJson;
        blocked.human_spec_gate = true;
        fs.writeFileSync(statusPath, `${JSON.stringify(blocked, null, 2)}\n`, 'utf8');

        const resumed = runReviewLoopMain(
            localDir,
            tasksRoot,
            fakeBins,
            taskId,
            cap + 1,
            [],
            { FAKE_AGENT_COMPLETE_SEQUENCE: 'spec,spec_review' },
            false,
        );
        assert.equal(resumed.status, 0, combinedOutput(resumed));
        assert.deepEqual(readAgentInvocations(agentLog), ['claude', 'codex']);
        const completed = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as StatusJson;
        assert.equal(completed.phases.spec?.status, 'done');
        assert.equal(completed.phases.spec_review?.status, 'done');
        assert.equal(completed.phases.spec_review?.verdict, 'approved');
    });
});

void test('raising the code-loop cap resumes implement before code_review', { concurrency: false }, () => {
    withTempDir('preroute-code-loop-raised-cap-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'code-loop-raised-cap';
        const cap = 3;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', cap);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        const agentLog = path.join(localDir, 'agent-invocations.log');

        assert.equal(runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap).status, 2);
        const resumed = runReviewLoopMain(
            localDir,
            tasksRoot,
            fakeBins,
            taskId,
            cap + 1,
            ['--expect', 'implement'],
            { FAKE_AGENT_COMPLETE_PHASE: 'implement' },
        );
        assert.deepEqual(readAgentInvocations(agentLog), ['codex']);
        assert.doesNotMatch(combinedOutput(resumed), /--expect implement but current phase/);
        const afterResume = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: { code_review?: { status?: string } };
        };
        assert.equal(afterResume.phases?.code_review?.status, 'blocked');
    });

    withTempDir('preroute-code-loop-wrong-expect-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'code-loop-wrong-expect';
        const cap = 3;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', cap);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        assert.equal(runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap).status, 2);

        const wrongExpect = runReviewLoopMain(
            localDir,
            tasksRoot,
            fakeBins,
            taskId,
            cap + 1,
            ['--expect', 'code_review'],
        );
        assert.match(combinedOutput(wrongExpect), /--expect code_review but current phase is implement/);
        assert.deepEqual(readAgentInvocations(path.join(localDir, 'agent-invocations.log')), []);
    });
});

void test('a human reroute clears loop-local code-review attempts before implement entry', { concurrency: false }, () => {
    withTempDir('reroute-review-loop-inert-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'reroute-loop-inert';
        const worktreesRoot = path.join(localDir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        const status = makeReviewLoopStatus(taskId, 'code_review', 3, 2) as StatusJson;
        status.branch = `task/${taskId}`;
        status.worktree = true;
        status.phases.implement!.status = 'done';
        status.phases.code_review!.status = 'done';
        status.phases.code_review!.verdict = 'approved';
        status.phases.qa!.status = 'done';
        status.phases.human_review!.status = 'pending';
        status.status = 'human_review';
        writeTaskStatus(path.join(localDir, 'tasks'), taskId, status);
        writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
        fs.writeFileSync(path.join(worktreeDir, 'tasks', taskId, 'spec.md'), [
            '# Spec',
            '',
            '## Amendment',
            '',
            'Reroute fixture amendment.',
            '',
        ].join('\n'), 'utf8');

        const mainHref = pathToFileURL(path.join(WORKTREE_ROOT, 'src', 'orchestrator', 'main.ts')).href;
        const result = runNodeInline([
            `import(${JSON.stringify(mainHref)})`,
            '.then(m => {',
            '  m.setCliArgsForTest({ force: false });',
            `  m.rerouteFromHumanReview([${JSON.stringify(taskId)}]);`,
            '})',
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
        }), localDir);
        assert.equal(result.status, 0, combinedOutput(result));

        const rerouted = JSON.parse(
            fs.readFileSync(path.join(worktreeDir, 'tasks', taskId, 'status.json'), 'utf8'),
        ) as StatusJson;
        assert.equal(rerouted.phases.code_review?.iterations_current_loop, 0);
        assert.equal(rerouted.phases.code_review?.preflight_rejections_current_loop, 0);
        assert.equal(rerouted.phases.code_review?.iterations_total, 7);
        const context: TaskContext = {
            taskId,
            title: taskId,
            specReviewVerdict: rerouted.phases.spec_review?.verdict ?? '',
            iterations: rerouted.phases.code_review?.iterations ?? 0,
            iterations_current_loop: rerouted.phases.code_review?.iterations_current_loop ?? 0,
            iterations_total: rerouted.phases.code_review?.iterations_total ?? 0,
            rerouteCount: rerouted.phases.implement?.reroute_count ?? 0,
            status: rerouted,
        };
        assert.equal(evaluateCodeReviewLoop([context], 3).blocked, false);
    });
});

void test('checkAndRoute commits QA artifacts for every task in a completed QA bundle', () => {
    withTempDir('run-task-qa-bundle-commit-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        for (const taskId of ['task-a', 'task-b']) {
            const status = makeCompleteStatus(taskId, 'task/task-a');
            const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
            phases.qa = { status: 'done', agent: 'claude' };
            phases.human_review = { status: 'pending', agent: 'human' };
            writeTaskStatus(tasksRoot, taskId, status);
        }

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');
        const gitLogPath = path.join(dir, 'git.log');
        const qualityLogPath = path.join(dir, 'task-quality-log.md');

        const result = runNodeInline([
            "import { checkAndRoute } from './src/orchestrator/main.ts';",
            '(async () => {',
            "  await checkAndRoute('qa', ['task-a', 'task-b']);",
            '})().catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_QUALITY_LOG_FILE_OVERRIDE: qualityLogPath,
            FAKE_GIT_LOG: gitLogPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_BASE_BRANCH: 'main',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GIT_STATUS_OUTPUT: [
                ' M tasks/task-a/done.md',
                ' M tasks/task-b/review.md',
                ' M docs/codebase-map.md',
            ].join('\n'),
            FAKE_GIT_DIFF_OUTPUT: [
                'tasks/task-a/done.md',
                'tasks/task-b/review.md',
                'docs/codebase-map.md',
            ].join('\n'),
        });

        assert.equal(result.status, 0, result.stderr);
        const gitLog = fs.readFileSync(gitLogPath, 'utf8');
        assert.match(gitLog, /^add -A -- tasks\/task-a$/m);
        assert.match(gitLog, /^add -A -- tasks\/task-b$/m);
        assert.match(gitLog, /^add -A -- docs\/codebase-map\.md$/m);
        assert.match(gitLog, /^commit -m chore: QA artifacts for task-a, task-b$/m);
        assert.doesNotMatch(gitLog, /^push /m);
    });
});

void test('checkAndRoute commits QA artifacts after evidence-advancing qa to done', () => {
    withTempDir('run-task-qa-evidence-commit-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const taskId = 'task-a';
        const status = makeCompleteStatus(taskId, 'task/task-a');
        const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
        phases.qa = { status: 'in_progress', agent: 'claude' };
        phases.human_review = { status: 'pending', agent: 'human' };
        writeTaskStatus(tasksRoot, taskId, status);
        const taskDir = path.join(tasksRoot, taskId);
        fs.writeFileSync(path.join(taskDir, 'done.md'), '# QA Summary: task-a\n\nReady.\n', 'utf8');
        const qualityLogPath = path.join(dir, 'task-quality-log.md');

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');
        const gitLogPath = path.join(dir, 'git.log');

        const result = runNodeInline([
            "import { checkAndRoute } from './src/orchestrator/main.ts';",
            '(async () => {',
            `  await checkAndRoute('qa', [${JSON.stringify(taskId)}]);`,
            '})().catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_QUALITY_LOG_FILE_OVERRIDE: qualityLogPath,
            FAKE_GIT_LOG: gitLogPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_BASE_BRANCH: 'main',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GIT_STATUS_OUTPUT: ' M tasks/task-a/done.md',
            FAKE_GIT_DIFF_OUTPUT: 'tasks/task-a/done.md',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /Auto-advanced 'qa' for 'task-a'/);
        const updated = JSON.parse(fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8')) as {
            phases?: { qa?: { status?: string } };
        };
        assert.equal(updated.phases?.qa?.status, 'done');
        const qualityLog = fs.readFileSync(qualityLogPath, 'utf8');
        assert.match(qualityLog, /\| task-a \|/);
        const gitLog = fs.readFileSync(gitLogPath, 'utf8');
        assert.match(gitLog, /^add -A -- tasks\/task-a$/m);
        assert.match(gitLog, /^commit -m chore: QA artifacts for task-a$/m);
        assert.doesNotMatch(gitLog, /^push /m);
    });
});
