import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { classifyMergeOutcome, commitQaArtifacts, enableFullSend, findPullRequestTemplate, formatCompleteStateBanner, formatExistingPRMessage, resolveCanonPrBody, resolveQaPrBody } from '../src/orchestrator/main.js';
import { resolveWorkspaceDirs } from '../src/orchestrator/worktree.js';
import {
    WORKTREE_ROOT,
    TSX_LOADER,
    canonicalizeTestPath,
    withTempDir,
    writeTaskStatus,
    writeExecutable,
    setupFakeGit,
    setupFakeCliTools,
    makeFakeRunHarness,
    runFakeMain,
    runRealMainWithFakeAgents,
    withFakeGitEnv,
    runNodeInline,
    runMainInline,
    runEnsureBranchInline,
    runEnsureBundleBranchInline,
    childEnvWithoutTasksOverride,
    gitIn,
    makeGitFixture,
    makeOutOfRootTaskFixture,
    makeBootstrappedTaskWorktreeFixture,
    makeNodeModulesGateFixture,
    makeEnsureWorktreeNodeModulesFixture,
    makeEnsureWorktreeWorkspaceFixture,
    makeHumanReviewPendingStatus,
    setupDivergentBaseRepo,
    setupFullSendTailFixture,
    runFullSendTailFixture,
    makeCompleteStatus,
    writeAffectedFilesSpec,
    writeShipTaskArtifacts,
    simulateShipMergeOnOrigin,
    runShipTask,
    setupHumanReviewHarness,
    runHumanReviewCommit,
    combinedOutput,
    writeQaArtifacts,
    runEnsureWorktreeInline,
    runTeardownWorktreeInline,
    writeApprovedSpecReview,
    writePopulatedPlan,
} from './run-task-safety-helpers.js';


void test('canon run refuses a hand-deleted registered canon worktree after reroute', () => {
    withTempDir('run-task-missing-rerouted-worktree-', dir => {
        const taskId = 'missing-rerouted-worktree';
        const { localDir, worktreeDir, branch } = makeBootstrappedTaskWorktreeFixture(dir, taskId);
        const worktreeStatusPath = path.join(worktreeDir, 'tasks', taskId, 'status.json');
        const worktreeStatus = JSON.parse(fs.readFileSync(worktreeStatusPath, 'utf8')) as {
            phases: { implement: { status: string; rerouted?: boolean }; code_review: { status: string } };
        };
        worktreeStatus.phases.implement.status = 'pending';
        worktreeStatus.phases.implement.rerouted = true;
        worktreeStatus.phases.code_review.status = 'pending';
        fs.writeFileSync(worktreeStatusPath, `${JSON.stringify(worktreeStatus, null, 2)}\n`, 'utf8');
        fs.rmSync(worktreeDir, { recursive: true, force: true });
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
    });
});

void test('missing-worktree refusal clears after restoring the registered checkout', () => {
    withTempDir('run-task-missing-restore-', dir => {
        const taskId = 'missing-restore';
        const { localDir, worktreeDir, branch } = makeBootstrappedTaskWorktreeFixture(dir, taskId);
        fs.rmSync(worktreeDir, { recursive: true, force: true });
        gitIn(localDir, 'worktree', 'add', '-f', worktreeDir, branch);
        const result = runRealMainWithFakeAgents(taskId, [], localDir, dir);
        assert.doesNotMatch(combinedOutput(result), /registered with git but missing on disk/);
        gitIn(localDir, 'worktree', 'remove', '--force', worktreeDir);
    });
});

void test('missing-worktree refusal clears after discarding the registration', () => {
    withTempDir('run-task-missing-discard-', dir => {
        const taskId = 'missing-discard';
        const { localDir, worktreeDir } = makeBootstrappedTaskWorktreeFixture(dir, taskId);
        fs.rmSync(worktreeDir, { recursive: true, force: true });
        gitIn(localDir, 'worktree', 'remove', '--force', worktreeDir);
        const result = runRealMainWithFakeAgents(taskId, [], localDir, dir);
        assert.doesNotMatch(combinedOutput(result), /registered with git but missing on disk/);
    });
});

void test('an existing task branch without a worktree registration is not a missing-worktree refusal', () => {
    withTempDir('run-task-orphan-branch-', dir => {
        const taskId = 'orphan-branch';
        const { localDir } = makeGitFixture(dir);
        const status = { ...makeCompleteStatus(taskId, ''), worktree: true } as Record<string, unknown>;
        const phases = status.phases as Record<string, Record<string, unknown>>;
        phases.implement.status = 'pending';
        phases.code_review.status = 'pending';
        status.status = 'implement';
        writeTaskStatus(path.join(localDir, 'tasks'), taskId, status);
        gitIn(localDir, 'add', 'tasks');
        gitIn(localDir, 'commit', '-m', `add ${taskId} task artifacts`);
        gitIn(localDir, 'branch', `task/${taskId}`, 'main');

        const result = runEnsureBranchInline(taskId, localDir, path.join(localDir, '.canon', 'worktrees'));
        assert.equal(result.status, 0, result.stderr);
        assert.equal(fs.existsSync(path.join(localDir, '.canon', 'worktrees', taskId)), true);
        gitIn(localDir, 'worktree', 'remove', '--force', path.join(localDir, '.canon', 'worktrees', taskId));
        gitIn(localDir, 'branch', '-D', `task/${taskId}`);
    });
});

void test('an intact in-root custom worktree is not a missing-worktree refusal', () => {
    withTempDir('run-task-intact-in-root-', dir => {
        const taskId = 'intact-in-root';
        const linkedWorktree = path.join(dir, 'local', '.canon', 'worktrees', 'custom-name');
        const { localDir } = makeOutOfRootTaskFixture(dir, taskId, linkedWorktree);
        const result = runRealMainWithFakeAgents(taskId, [], localDir, dir);
        assert.doesNotMatch(combinedOutput(result), /registered with git but missing on disk/);
        gitIn(localDir, 'worktree', 'remove', '--force', linkedWorktree);
    });
});

void test('a missing non-task worktree registration is ignored by the canon detector', () => {
    withTempDir('run-task-missing-operator-worktree-', dir => {
        const taskId = 'missing-operator-worktree';
        const { localDir } = makeGitFixture(dir);
        const status = { ...makeCompleteStatus(taskId, ''), worktree: false };
        writeTaskStatus(path.join(localDir, 'tasks'), taskId, status);
        gitIn(localDir, 'add', 'tasks');
        gitIn(localDir, 'commit', '-m', `add ${taskId} task artifacts`);
        const operatorWorktree = path.join(dir, 'operator-worktree');
        gitIn(localDir, 'worktree', 'add', '-b', 'feature/operator-worktree', operatorWorktree, 'main');
        fs.rmSync(operatorWorktree, { recursive: true, force: true });
        const result = runRealMainWithFakeAgents(taskId, [], localDir, dir);
        assert.doesNotMatch(combinedOutput(result), /registered with git but missing on disk/);
    });
});

void test('a missing worktree for another task refuses the current task run', () => {
    withTempDir('run-task-missing-other-worktree-', dir => {
        const otherId = 'other-missing';
        const currentId = 'current-task';
        const { localDir } = makeGitFixture(dir);
        writeTaskStatus(path.join(localDir, 'tasks'), currentId, makeCompleteStatus(currentId, ''));
        gitIn(localDir, 'add', 'tasks');
        gitIn(localDir, 'commit', '-m', `add ${currentId} task artifacts`);
        const otherWorktree = path.join(dir, 'other-worktree');
        gitIn(localDir, 'worktree', 'add', '-b', `task/${otherId}`, otherWorktree, 'main');
        fs.rmSync(otherWorktree, { recursive: true, force: true });
        const result = runMainInline(currentId, [], childEnvWithoutTasksOverride(), localDir);
        const output = combinedOutput(result);
        assert.notEqual(result.status, 0);
        assert.ok(output.includes(canonicalizeTestPath(otherWorktree)));
        assert.match(output, new RegExp(`branch: task/${otherId}`));
    });
});

void test('bundle runs with an intact leader worktree and refuses after the leader is deleted', () => {
    withTempDir('run-task-missing-bundle-leader-', dir => {
        const leaderId = 'bundle-leader-missing';
        const secondaryId = 'bundle-secondary-missing';
        const { localDir } = makeGitFixture(dir);
        writeTaskStatus(path.join(localDir, 'tasks'), leaderId, { ...makeCompleteStatus(leaderId, ''), worktree: true });
        writeTaskStatus(path.join(localDir, 'tasks'), secondaryId, { ...makeCompleteStatus(secondaryId, ''), worktree: true });
        gitIn(localDir, 'add', 'tasks');
        gitIn(localDir, 'commit', '-m', 'add bundle task artifacts');
        const worktreesRoot = path.join(localDir, '.canon', 'worktrees');
        const setup = runEnsureBundleBranchInline([leaderId, secondaryId], localDir, worktreesRoot);
        assert.equal(setup.status, 0, setup.stderr);
        const leaderWorktree = path.join(worktreesRoot, leaderId);
        const env = childEnvWithoutTasksOverride();
        delete env.CANON_WORKTREES_ROOT;
        const intact = runRealMainWithFakeAgents(
            leaderId,
            [secondaryId],
            localDir,
            dir,
        );
        assert.doesNotMatch(combinedOutput(intact), /registered with git but missing on disk/);

        fs.rmSync(leaderWorktree, { recursive: true, force: true });
        for (const taskIds of [[leaderId, secondaryId], [secondaryId]] as const) {
            const result = runMainInline(taskIds[0], taskIds.slice(1), env, localDir);
            const output = combinedOutput(result);
            assert.notEqual(result.status, 0);
            assert.ok(output.includes(canonicalizeTestPath(leaderWorktree)));
            assert.match(output, new RegExp(`branch: task/${leaderId}`));
        }
    });
});

void test('entry detection skips dry-run and ship, and never prunes at entry', () => {
    for (const args of [['--dry-run'], ['--ship']] as const) {
        withTempDir(`run-task-entry-scope-${args[0].slice(2)}-`, dir => {
            const taskId = `entry-scope-${args[0].slice(2)}`;
            const harness = makeFakeRunHarness(dir, taskId, makeCompleteStatus(taskId, ''));
            const result = runFakeMain(harness, taskId, args);
            assert.doesNotMatch(fs.existsSync(harness.gitLogPath) ? fs.readFileSync(harness.gitLogPath, 'utf8') : '', /worktree list --porcelain/);
            assert.doesNotMatch(fs.existsSync(harness.gitLogPath) ? fs.readFileSync(harness.gitLogPath, 'utf8') : '', /worktree prune/);
            assert.equal(result.status === null, false);
        });
    }
});

void test('invocation-root refusal runs before missing-worktree detection', () => {
    withTempDir('run-task-entry-invocation-order-', dir => {
        const taskId = 'entry-invocation-order';
        const harness = makeFakeRunHarness(dir, taskId, makeCompleteStatus(taskId, ''));
        const oldWorktree = path.join(dir, 'old-worktree');
        fs.mkdirSync(oldWorktree, { recursive: true });
        const result = runFakeMain(harness, taskId, [], {}, oldWorktree);
        assert.notEqual(result.status, 0);
        assert.match(combinedOutput(result), /Canon was invoked from a linked git worktree it does not manage/);
        const log = fs.existsSync(harness.gitLogPath) ? fs.readFileSync(harness.gitLogPath, 'utf8') : '';
        assert.doesNotMatch(log, /worktree list --porcelain/);
    });
});

void test('entry worktree enumeration failure refuses closed with git stderr', () => {
    withTempDir('run-task-entry-enumeration-failure-', dir => {
        const taskId = 'entry-enumeration-failure';
        const harness = makeFakeRunHarness(dir, taskId, makeCompleteStatus(taskId, ''));
        const result = runFakeMain(harness, taskId, [], { FAKE_GIT_WORKTREE_LIST_FAIL: '1' });
        const output = combinedOutput(result);
        assert.notEqual(result.status, 0);
        assert.match(output, /git worktree list failed/);
        assert.match(output, /simulated worktree list failure/);
        for (const runtimeFile of ['.canon-pid', '.heartbeat.json', '.canon-run.log']) {
            assert.equal(fs.existsSync(path.join(harness.tasksRoot, taskId, runtimeFile)), false);
        }
    });
});

void test('ensureWorktree creates and tears down the default in-repo worktree cleanly', () => {
    withTempDir('run-task-ensure-wt-default-root-', dir => {
        const taskId = 'task-default-root';
        const { localDir } = makeGitFixture(dir);
        fs.writeFileSync(path.join(localDir, '.gitignore'), 'node_modules\n.env*\n.canon/worktrees/\n', 'utf8');
        fs.writeFileSync(path.join(localDir, 'package.json'), '{"name":"fixture"}\n', 'utf8');
        gitIn(localDir, 'add', '.gitignore', 'package.json');
        gitIn(localDir, 'commit', '-m', 'add canon runtime ignores');
        fs.mkdirSync(path.join(localDir, 'node_modules'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'node_modules', 'marker.txt'), 'root install\n', 'utf8');
        fs.writeFileSync(path.join(localDir, '.env.test'), 'VALUE=1\n', 'utf8');

        const branch = `task/${taskId}`;
        const expectedWorktree = path.join(localDir, '.canon', 'worktrees', taskId);
        const setup = runEnsureWorktreeInline(taskId, branch, localDir);
        assert.equal(setup.status, 0, setup.stderr);
        assert.equal(fs.existsSync(expectedWorktree), true);
        assert.equal(fs.lstatSync(path.join(expectedWorktree, 'node_modules')).isSymbolicLink(), true);
        assert.equal(fs.lstatSync(path.join(expectedWorktree, '.env.test')).isSymbolicLink(), true);

        const registered = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: localDir, encoding: 'utf8' });
        assert.match(registered, new RegExp(`worktree ${canonicalizeTestPath(expectedWorktree).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`));
        assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: localDir, encoding: 'utf8' }), '');

        const teardown = runTeardownWorktreeInline(taskId, localDir);
        assert.equal(teardown.status, 0, teardown.stderr);
        assert.equal(fs.existsSync(expectedWorktree), false);
        const afterTeardown = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: localDir, encoding: 'utf8' });
        assert.doesNotMatch(afterTeardown, /task\/task-default-root/);
        assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: localDir, encoding: 'utf8' }), '');
    });
});

void test('ensureWorktree fails closed on a wrong-target node_modules symlink', () => {
    withTempDir('run-task-ensure-wt-nm-wrong-target-', dir => {
        const taskId = 'task-wrong-target';
        const { localDir, worktreesRoot, branch, wrongTarget } =
            makeEnsureWorktreeNodeModulesFixture(dir, taskId, 'wrong-target-symlink');

        const result = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Worktree setup aborted: .*node_modules is a symlink but does not resolve to/);
        assert.match(result.stderr, new RegExp(wrongTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });
});

void test('ensureWorktree skips an escaping workspace destination and still links contained siblings', () => {
    withTempDir('run-task-ensure-wt-workspace-escape-', dir => {
        const taskId = 'task-workspace-escape';
        const {
            localDir,
            worktreesRoot,
            worktreeDir,
            branch,
            repoWorkspaceModules,
            outsideDestination,
        } = makeEnsureWorktreeWorkspaceFixture(dir, taskId, 'destination-escape');
        const outsideBefore = fs.readdirSync(outsideDestination).sort();

        const result = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);

        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(fs.readdirSync(outsideDestination).sort(), outsideBefore);
        assert.equal(fs.existsSync(path.join(outsideDestination, 'node_modules')), false);
        assert.match(result.stderr, /packages\/a/);
        const siblingLink = path.join(worktreeDir, 'packages/b/node_modules');
        assert.equal(fs.lstatSync(siblingLink).isSymbolicLink(), true);
        assert.equal(fs.realpathSync(siblingLink), fs.realpathSync(repoWorkspaceModules['packages/b']));
    });
});

void test('ensureWorktree classifies workspace node_modules entries without clobbering them', () => {
    for (const variant of ['missing', 'verified-symlink', 'file', 'directory'] as const) {
        withTempDir(`run-task-ensure-wt-workspace-${variant}-`, dir => {
            const taskId = `task-workspace-${variant}`;
            const { localDir, worktreesRoot, worktreeDir, branch, repoWorkspaceModules } =
                makeEnsureWorktreeWorkspaceFixture(dir, taskId, variant);

            const result = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
            assert.equal(result.status, 0, result.stderr);

            const workspaceModules = path.join(worktreeDir, 'packages/a/node_modules');
            const stat = fs.lstatSync(workspaceModules);
            if (variant === 'missing' || variant === 'verified-symlink') {
                assert.equal(stat.isSymbolicLink(), true);
                assert.equal(fs.realpathSync(workspaceModules), fs.realpathSync(repoWorkspaceModules['packages/a']));
                if (variant === 'missing') {
                    assert.match(result.stdout, /Symlinked node_modules into worktree workspace 'packages\/a'/);
                } else {
                    assert.doesNotMatch(result.stdout, /Symlinked node_modules into worktree workspace 'packages\/a'/);
                }
            } else if (variant === 'file') {
                assert.equal(stat.isFile(), true);
                assert.equal(fs.readFileSync(workspaceModules, 'utf8'), 'tracked workspace file\n');
            } else {
                assert.equal(stat.isDirectory(), true);
                assert.equal(fs.readFileSync(path.join(workspaceModules, 'pkg.json'), 'utf8'), '{}\n');
            }
            const siblingModules = path.join(worktreeDir, 'packages/b/node_modules');
            assert.equal(fs.lstatSync(siblingModules).isSymbolicLink(), true);
            assert.equal(fs.realpathSync(siblingModules), fs.realpathSync(repoWorkspaceModules['packages/b']));
        });
    }
});

void test('ensureWorktree fails closed on a wrong-target workspace node_modules symlink', () => {
    withTempDir('run-task-ensure-wt-workspace-wrong-target-', dir => {
        const taskId = 'task-workspace-wrong-target';
        const { localDir, worktreesRoot, branch, wrongTarget } =
            makeEnsureWorktreeWorkspaceFixture(dir, taskId, 'wrong-target-symlink');

        const result = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /packages\/a\/node_modules is a symlink but does not resolve to/);
        assert.match(result.stderr, new RegExp(wrongTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });
});

void test('ensureWorktree rerun repairs workspace links after a prior partial-link abort', () => {
    withTempDir('run-task-ensure-wt-workspace-repair-', dir => {
        const taskId = 'task-workspace-repair';
        const { localDir } = makeGitFixture(dir);
        fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
            name: 'fixture',
            workspaces: ['packages/*'],
        }), 'utf8');
        for (const name of ['a', 'b', 'c']) {
            fs.mkdirSync(path.join(localDir, 'packages', name), { recursive: true });
            fs.writeFileSync(path.join(localDir, 'packages', name, 'package.json'), JSON.stringify({ name }), 'utf8');
        }
        gitIn(localDir, 'add', 'package.json', 'packages');
        gitIn(localDir, 'commit', '-m', 'workspace package setup');

        const branch = `task/${taskId}`;
        const wrongTarget = path.join(dir, 'wrong-target');
        fs.mkdirSync(wrongTarget, { recursive: true });
        gitIn(localDir, 'checkout', '-b', branch);
        fs.symlinkSync(wrongTarget, path.join(localDir, 'packages/b/node_modules'));
        gitIn(localDir, 'add', 'packages/b/node_modules');
        gitIn(localDir, 'commit', '-m', 'stray workspace link');
        gitIn(localDir, 'checkout', 'main');

        fs.mkdirSync(path.join(localDir, 'node_modules'), { recursive: true });
        for (const name of ['a', 'b', 'c']) {
            const sourceModules = path.join(localDir, 'packages', name, 'node_modules');
            fs.mkdirSync(sourceModules, { recursive: true });
            fs.writeFileSync(path.join(sourceModules, 'marker.txt'), `${name}\n`, 'utf8');
        }
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);

        const first = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.notEqual(first.status, 0);
        assert.equal(fs.lstatSync(path.join(worktreeDir, 'packages/a/node_modules')).isSymbolicLink(), true);
        assert.equal(fs.existsSync(path.join(worktreeDir, 'packages/c/node_modules')), false);

        const second = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(second.status, 0, second.stderr);
        assert.equal(
            fs.realpathSync(path.join(worktreeDir, 'packages/c/node_modules')),
            fs.realpathSync(path.join(localDir, 'packages/c/node_modules')),
            'repair mode did not continue past the existing wrong-target link',
        );

        fs.rmSync(path.join(worktreeDir, 'packages/b/node_modules'));
        const third = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(third.status, 0, third.stderr);
        for (const name of ['a', 'b', 'c']) {
            const link = path.join(worktreeDir, 'packages', name, 'node_modules');
            assert.equal(fs.lstatSync(link).isSymbolicLink(), true, `${name} was not repaired`);
            assert.equal(
                fs.realpathSync(link),
                fs.realpathSync(path.join(localDir, 'packages', name, 'node_modules')),
            );
        }
    });
});

void test('ensureWorktree reuse leaves root links and env files untouched', () => {
    for (const variant of ['missing-source', 'wrong-root-link', 'dangling-env-link'] as const) {
        withTempDir(`run-task-ensure-wt-reuse-${variant}-`, dir => {
            const taskId = `task-reuse-${variant}`;
            const { localDir, worktreesRoot, worktreeDir, branch } =
                makeEnsureWorktreeNodeModulesFixture(dir, taskId, 'missing');
            const first = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
            assert.equal(first.status, 0, first.stderr);

            if (variant === 'missing-source') {
                fs.rmSync(path.join(localDir, 'node_modules'), { recursive: true });
            } else if (variant === 'wrong-root-link') {
                fs.rmSync(path.join(worktreeDir, 'node_modules'));
                const wrongTarget = path.join(dir, 'wrong-root-target');
                fs.mkdirSync(wrongTarget, { recursive: true });
                fs.symlinkSync(wrongTarget, path.join(worktreeDir, 'node_modules'));
            } else {
                fs.writeFileSync(path.join(localDir, '.env.reuse'), 'VALUE=1\n', 'utf8');
                fs.symlinkSync(path.join(dir, 'missing-env-target'), path.join(worktreeDir, '.env.reuse'));
            }

            const second = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
            assert.equal(second.status, 0, second.stderr);
            if (variant === 'wrong-root-link') {
                assert.equal(
                    fs.realpathSync(path.join(worktreeDir, 'node_modules')),
                    fs.realpathSync(path.join(dir, 'wrong-root-target')),
                );
            } else if (variant === 'dangling-env-link') {
                assert.equal(fs.lstatSync(path.join(worktreeDir, '.env.reuse')).isSymbolicLink(), true);
            }
        });
    }
});

void test('ensureWorktree reuse suppresses repeated unsupported-pattern warnings', () => {
    withTempDir('run-task-ensure-wt-reuse-warnings-', dir => {
        const taskId = 'task-reuse-warnings';
        const { localDir, worktreesRoot, branch } =
            makeEnsureWorktreeWorkspaceFixture(dir, taskId, 'missing');
        fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
            name: 'fixture',
            workspaces: ['!packages/legacy', 'packages/*'],
        }), 'utf8');

        const first = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(first.status, 0, first.stderr);
        assert.match(first.stderr, /Ignoring unsupported negated workspace pattern: !packages\/legacy/);

        const second = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(second.status, 0, second.stderr);
        assert.doesNotMatch(second.stderr, /Ignoring unsupported negated workspace pattern/);
    });
});

void test('ensureWorktree leaves an existing non-canon worktree untouched', () => {
    withTempDir('run-task-ensure-wt-existing-foreign-', dir => {
        const taskId = 'task-existing-foreign';
        const { localDir, worktreesRoot, branch } =
            makeEnsureWorktreeWorkspaceFixture(dir, taskId, 'missing');
        const foreignWorktree = path.join(dir, 'developer-worktree');
        gitIn(localDir, 'worktree', 'add', foreignWorktree, branch);

        const result = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(fs.existsSync(path.join(foreignWorktree, 'node_modules')), false);
        assert.equal(fs.existsSync(path.join(foreignWorktree, 'packages/a/node_modules')), false);
        assert.equal(fs.existsSync(path.join(worktreesRoot, taskId)), false);
    });
});

void test('ensureWorktree skips hoisted, absent, dangling, and file workspace cases while linking siblings', () => {
    for (const variant of ['source-hoisted', 'workspace-absent', 'destination-dangling', 'destination-file'] as const) {
        withTempDir(`run-task-ensure-wt-workspace-${variant}-`, dir => {
            const taskId = `task-${variant}`;
            const { localDir, worktreesRoot, worktreeDir, branch, repoWorkspaceModules } =
                makeEnsureWorktreeWorkspaceFixture(dir, taskId, variant);

            const result = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
            assert.equal(result.status, 0, result.stderr);
            assert.equal(fs.existsSync(path.join(worktreeDir, 'packages/a/node_modules')), false);
            const siblingModules = path.join(worktreeDir, 'packages/b/node_modules');
            assert.equal(fs.lstatSync(siblingModules).isSymbolicLink(), true);
            assert.equal(fs.realpathSync(siblingModules), fs.realpathSync(repoWorkspaceModules['packages/b']));
            if (variant === 'workspace-absent') {
                assert.match(result.stdout, /Workspace 'packages\/a' is not present/);
                assert.doesNotMatch(result.stderr, /packages\/a/);
            } else if (variant === 'destination-dangling') {
                assert.match(result.stderr, /packages\/a/);
            } else if (variant === 'destination-file') {
                assert.match(result.stderr, /packages\/a.*not a directory/);
            } else {
                assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /packages\/a/);
            }
        });
    }
});

void test('ensureWorktree source containment prevents writes under an outside workspace declaration', () => {
    withTempDir('run-task-ensure-wt-workspace-source-escape-', dir => {
        const taskId = 'task-source-escape';
        const { localDir } = makeGitFixture(dir);
        fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
            name: 'fixture',
            workspaces: ['packages/*', '../outside/ext'],
        }), 'utf8');
        fs.mkdirSync(path.join(localDir, 'packages/a'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'packages/a/package.json'), '{"name":"a"}\n', 'utf8');
        gitIn(localDir, 'add', 'package.json', 'packages/a/package.json');
        gitIn(localDir, 'commit', '-m', 'workspace package setup');
        const branch = `task/${taskId}`;
        gitIn(localDir, 'branch', branch);
        fs.mkdirSync(path.join(localDir, 'node_modules'), { recursive: true });
        fs.mkdirSync(path.join(localDir, 'packages/a/node_modules'), { recursive: true });
        const outsideWorkspace = path.join(dir, 'outside/ext');
        fs.mkdirSync(outsideWorkspace, { recursive: true });
        fs.writeFileSync(path.join(outsideWorkspace, 'package.json'), '{"name":"outside"}\n', 'utf8');
        fs.writeFileSync(path.join(outsideWorkspace, 'sentinel.txt'), 'untouched\n', 'utf8');
        const outsideBefore = fs.readdirSync(outsideWorkspace).sort();
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);

        const result = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /\.\.\/outside\/ext/);
        assert.deepEqual(fs.readdirSync(outsideWorkspace).sort(), outsideBefore);
        assert.equal(fs.existsSync(path.join(outsideWorkspace, 'node_modules')), false);
        assert.equal(fs.lstatSync(path.join(worktreeDir, 'packages/a/node_modules')).isSymbolicLink(), true);
        assert.equal(resolveWorkspaceDirs(localDir).some(workspace => workspace.split('/').includes('..')), false);
    });
});

void test('ensureWorktree skips an unresolvable workspace destination and exits successfully', () => {
    withTempDir('run-task-ensure-wt-workspace-dangling-', dir => {
        const taskId = 'task-workspace-dangling';
        const { localDir, worktreesRoot, worktreeDir, branch } =
            makeEnsureWorktreeWorkspaceFixture(dir, taskId, 'destination-dangling');
        const result = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /packages\/a/);
        assert.equal(fs.lstatSync(path.join(worktreeDir, 'packages/a')).isSymbolicLink(), true);
    });
});

void test('teardownWorktree removes root and workspace links without touching source installs', () => {
    withTempDir('run-task-teardown-workspace-links-', dir => {
        const taskId = 'task-teardown-workspace-links';
        const {
            localDir,
            worktreesRoot,
            worktreeDir,
            branch,
            repoModulesFixture,
            repoWorkspaceModules,
        } = makeEnsureWorktreeWorkspaceFixture(dir, taskId, 'missing');
        const setup = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(setup.status, 0, setup.stderr);
        assert.equal(fs.lstatSync(path.join(worktreeDir, 'node_modules')).isSymbolicLink(), true);
        assert.equal(fs.lstatSync(path.join(worktreeDir, 'packages/a/node_modules')).isSymbolicLink(), true);

        const teardown = runTeardownWorktreeInline(taskId, localDir, worktreesRoot);
        assert.equal(teardown.status, 0, teardown.stderr);
        assert.equal(fs.existsSync(worktreeDir), false);
        assert.equal(fs.readFileSync(path.join(repoModulesFixture, 'marker.txt'), 'utf8'), 'root install\n');
        assert.equal(
            fs.readFileSync(path.join(repoWorkspaceModules['packages/a'], 'marker.txt'), 'utf8'),
            'packages/a install\n',
        );
        assert.equal(
            fs.readFileSync(path.join(repoWorkspaceModules['packages/b'], 'marker.txt'), 'utf8'),
            'packages/b install\n',
        );
    });
});

void test('commitQaArtifacts uses a bundle commit subject naming every task id', () => {
    withTempDir('run-task-qa-end-bundle-real-git-', dir => {
        const { localDir } = makeGitFixture(dir);
        writeQaArtifacts(localDir, 'task-a');
        writeQaArtifacts(localDir, 'task-b');

        commitQaArtifacts(['task-a', 'task-b'], localDir);

        const subject = execFileSync('git', ['log', '-1', '--pretty=%s'], {
            cwd: localDir,
            encoding: 'utf8',
        }).trim();
        assert.equal(subject, 'chore: QA artifacts for task-a, task-b');
    });
});

void test('commitQaArtifacts rejects dirty files outside the QA-end allowlist', () => {
    withTempDir('run-task-qa-end-outside-allowlist-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);
        writeTaskStatus(tasksRoot, 'task-a', makeCompleteStatus('task-a', 'task/task-a'));

        const result = runNodeInline([
            "import { commitQaArtifacts } from './src/orchestrator/main.ts';",
            `commitQaArtifacts(['task-a'], ${JSON.stringify(dir)});`,
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: path.join(dir, 'current-branch.txt'),
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GIT_STATUS_OUTPUT: ' M src/late-edit.ts',
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /QA-end commit aborted: working tree has dirty files outside the QA-end allowlist/);
    });
});

void test('taskDirFor returns REPO_ROOT task dir before a worktree branch is recorded', () => {
    withTempDir('run-task-state-pre-impl-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'state-pre';
        writeTaskStatus(path.join(localDir, 'tasks'), taskId, {
            ...makeCompleteStatus(taskId, ''),
            branch: '',
            worktree: true,
        });

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/state.ts')).href)})`,
            `.then(m => { console.log(m.taskDirFor(${JSON.stringify(taskId)})); })`,
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join(''), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: path.join(dir, 'worktrees'),
        }), localDir);

        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), path.join(fs.realpathSync(localDir), 'tasks', taskId));
    });
});

void test('taskDirFor returns the task worktree dir after worktree status exists', () => {
    withTempDir('run-task-state-post-impl-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'state-post';
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        const status = {
            ...makeCompleteStatus(taskId, `task/${taskId}`),
            branch: `task/${taskId}`,
            worktree: true,
        };
        writeTaskStatus(path.join(localDir, 'tasks'), taskId, status);
        writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/state.ts')).href)})`,
            `.then(m => { console.log(m.taskDirFor(${JSON.stringify(taskId)})); })`,
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join(''), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
        }), localDir);

        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), path.join(worktreeDir, 'tasks', taskId), result.stderr);
    });
});

void test('parseAffectedFilesFromSpec reads the worktree spec when one exists', () => {
    withTempDir('run-task-parser-worktree-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'parser-worktree';
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        const status = {
            ...makeCompleteStatus(taskId, `task/${taskId}`),
            branch: `task/${taskId}`,
            worktree: true,
        };
        writeTaskStatus(path.join(localDir, 'tasks'), taskId, status);
        writeAffectedFilesSpec(path.join(localDir, 'tasks'), taskId, ['`docs/decisions.md`']);
        writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
        writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), taskId, ['`docs/codebase-map.md`']);

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/validation.ts')).href)})`,
            `.then(m => { console.log(JSON.stringify(m.parseAffectedFilesFromSpec(${JSON.stringify(taskId)}))); })`,
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join(''), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
        }), localDir);

        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout) as { files: string[]; malformed: unknown[] }, {
            files: ['docs/codebase-map.md'],
            malformed: [],
        });
    });
});

void test('commitTaskArtifactsToBase absorbs dirty pre-implement telemetry in a separate commit', () => {
    withTempDir('run-task-telemetry-absorb-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'telemetry-absorb';
        writeTaskStatus(path.join(localDir, 'tasks'), taskId, makeCompleteStatus(taskId, ''));
        fs.mkdirSync(path.join(localDir, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), 'pre-implement row\n', 'utf8');

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/git.ts')).href)})`,
            `.then(m => { m.commitTaskArtifactsToBase([${JSON.stringify(taskId)}], new Set()); })`,
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join(''), childEnvWithoutTasksOverride(), localDir);

        assert.equal(result.status, 0, result.stderr);
        const status = spawnSync('git', ['status', '--porcelain', '--', 'docs/pipeline-invocations.md'], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.equal(status.stdout.trim(), '');
        const log = spawnSync('git', ['log', '--format=%s', '-2'], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.match(log.stdout, /chore: absorb pre-implement telemetry into scaffold for telemetry-absorb/);
        assert.match(log.stdout, /task\(telemetry-absorb\): commit artifacts pre-pipeline/);
    });
});

void test('commitTaskArtifactsToBase commits a telemetry file removed with git rm instead of failing to stage it', () => {
    withTempDir('run-task-telemetry-staged-delete-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'telemetry-staged-delete';
        fs.mkdirSync(path.join(localDir, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), 'old row\n', 'utf8');
        gitIn(localDir, 'add', 'docs/pipeline-invocations.md');
        gitIn(localDir, 'commit', '-m', 'seed telemetry');
        gitIn(localDir, 'rm', '--quiet', 'docs/pipeline-invocations.md');
        writeTaskStatus(path.join(localDir, 'tasks'), taskId, makeCompleteStatus(taskId, ''));

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/git.ts')).href)})`,
            `.then(m => { m.commitTaskArtifactsToBase([${JSON.stringify(taskId)}], new Set()); })`,
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join(''), childEnvWithoutTasksOverride(), localDir);

        assert.equal(result.status, 0, result.stderr);
        const status = spawnSync('git', ['status', '--porcelain', '--', 'docs/pipeline-invocations.md'], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.equal(status.stdout.trim(), '');
        const removed = spawnSync('git', ['show', '--name-status', '--format=%s', 'HEAD'], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.match(removed.stdout, /chore: absorb pre-implement telemetry into scaffold for telemetry-staged-delete/);
        assert.match(removed.stdout, /^D\tdocs\/pipeline-invocations\.md$/m);
    });
});

void test('runImplementPhase writes metrics and task artifacts only in the worktree after scaffold commit', () => {
    withTempDir('run-task-implement-worktree-ssot-', dir => {
        const taskId = 'implement-ssot';
        const { localDir } = makeGitFixture(dir);
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);
        writeExecutable(fakeBins, 'codex', [
            'if [ "${1:-}" = "exec" ]; then',
            `  mkdir -p tasks/${taskId}`,
            `  printf "%s\\n" "worktree handoff" > tasks/${taskId}/handoff.md`,
            'fi',
            'exit 0',
        ]);
        fs.mkdirSync(path.join(localDir, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), 'baseline telemetry\n', 'utf8');
        gitIn(localDir, 'add', 'docs/pipeline-invocations.md');
        gitIn(localDir, 'commit', '-m', 'add telemetry baseline');

        const status = {
            ...makeCompleteStatus(taskId, ''),
            branch: '',
            base_branch: 'main',
            worktree: true,
            phases: {
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'pending', agent: 'codex' },
                code_review: { status: 'pending', agent: 'claude', verdict: '' },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
        };
        writeTaskStatus(path.join(localDir, 'tasks'), taskId, status);
        fs.writeFileSync(path.join(localDir, 'tasks', taskId, 'spec.md'), '# Spec\n\n## Acceptance Criteria\n\n- [ ] AC-1: Fixture\n\n## Design\n### Affected Files\n| File | Change |\n|---|---|\n| `initial-fixture.txt` | update |\n', 'utf8');
        fs.writeFileSync(path.join(localDir, 'tasks', taskId, 'plan.md'), '# Plan\n', 'utf8');
        fs.writeFileSync(path.join(localDir, 'tasks', taskId, 'handoff.md'), 'root scaffold\n', 'utf8');

        const childEnv = childEnvWithoutTasksOverride({
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_WORKTREES_ROOT: worktreesRoot,
            CANON_METRICS_FILE_OVERRIDE: '',
        });
        const result = spawnSync(process.execPath, [
            '--import',
            path.join(WORKTREE_ROOT, 'tests', 'md-loader-register.mjs'),
            '--import',
            TSX_LOADER,
            '-e',
            [
                `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/phases/implement.ts')).href)})`,
                '.then(async m => {',
                '  const fs = await import("node:fs");',
                `  const status = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(localDir, 'tasks', taskId, 'status.json'))}, 'utf8'));`,
                '  await m.runImplementPhase({',
                `    tasks: [{ taskId: ${JSON.stringify(taskId)}, title: ${JSON.stringify(taskId)}, specReviewVerdict: 'approved', iterations: 0, iterations_current_loop: 0, iterations_total: 0, rerouteCount: 0, status }],`,
                "    provider: 'mixed', tier: 'full',",
                '    isBundle: false,',
                '  }, false, null);',
                '})',
                '.catch(err => { console.error(err); process.exit(1); });',
            ].join('\n'),
        ], {
            cwd: localDir,
            encoding: 'utf8',
            env: childEnv,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.equal((result.stdout.match(/--pr, --push and full-send push it to origin\/main/g) ?? []).length, 1);
        const rootTaskStatus = spawnSync('git', ['status', '--porcelain', '--', `tasks/${taskId}`], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.equal(rootTaskStatus.stdout.trim(), '');
        assert.equal(fs.readFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), 'utf8'), 'baseline telemetry\n');
        assert.match(fs.readFileSync(path.join(worktreeDir, 'tasks', taskId, 'metrics.md'), 'utf8'), /implement-ssot/);
        assert.equal(fs.readFileSync(path.join(worktreeDir, 'docs', 'pipeline-invocations.md'), 'utf8'), 'baseline telemetry\n');
        assert.equal(fs.existsSync(path.join(localDir, 'tasks', taskId, 'metrics.md')), false);
        assert.equal(fs.readFileSync(path.join(localDir, 'tasks', taskId, 'handoff.md'), 'utf8'), 'root scaffold\n');
        assert.equal(fs.readFileSync(path.join(worktreeDir, 'tasks', taskId, 'handoff.md'), 'utf8'), 'worktree handoff\n');

        const secondResult = spawnSync(process.execPath, [
            '--import',
            path.join(WORKTREE_ROOT, 'tests', 'md-loader-register.mjs'),
            '--import',
            TSX_LOADER,
            '-e',
            [
                `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/phases/implement.ts')).href)})`,
                '.then(async m => {',
                '  const fs = await import("node:fs");',
                `  const status = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(worktreeDir, 'tasks', taskId, 'status.json'))}, 'utf8'));`,
                '  await m.runImplementPhase({',
                `    tasks: [{ taskId: ${JSON.stringify(taskId)}, title: ${JSON.stringify(taskId)}, specReviewVerdict: 'approved', iterations: 0, iterations_current_loop: 0, iterations_total: 0, rerouteCount: 0, status }],`,
                "    provider: 'mixed', tier: 'full',",
                '    isBundle: false,',
                '  }, false, null);',
                '})',
                '.catch(err => { console.error(err); process.exit(1); });',
            ].join('\n'),
        ], {
            cwd: localDir,
            encoding: 'utf8',
            env: childEnv,
        });
        assert.equal(secondResult.status, 0, secondResult.stderr);
        assert.doesNotMatch(secondResult.stdout, /--pr, --push and full-send push it to origin\/main/);

        if (fs.existsSync(worktreeDir)) {
            spawnSync('git', ['worktree', 'remove', '--force', worktreeDir], {
                cwd: localDir,
                encoding: 'utf8',
            });
        }
    });
});

void test('formatCompleteStateBanner renders the open_pr state with the merge-next command', () => {
    const banner = formatCompleteStateBanner(['task-a'], {
        kind: 'open_pr',
        branch: 'task/task-a',
        prNum: 42,
        prUrl: 'https://github.com/x/y/pull/42',
    });

    assert.match(banner, /TASK COMPLETE — already past human_review/);
    assert.match(banner, /Open PR: #42/);
    assert.match(banner, /canon run task-a --ship/);
});

void test('formatCompleteStateBanner renders the pushed_no_pr state with the retry command', () => {
    const banner = formatCompleteStateBanner(['task-a'], {
        kind: 'pushed_no_pr',
        branch: 'task/task-a',
        baseBranch: 'dev',
    });

    assert.match(banner, /Branch task\/task-a is on origin but no open PR/);
    assert.match(banner, /canon run task-a --pr/);
    assert.match(banner, /canon run task-a --ship/);
});

void test('formatCompleteStateBanner renders the unpushed state with the manual-merge fallback', () => {
    const banner = formatCompleteStateBanner(['task-a'], {
        kind: 'unpushed',
        branch: 'task/task-a',
        baseBranch: 'dev',
    });

    assert.match(banner, /Local branch task\/task-a is not on origin/);
    assert.match(banner, /merge to dev manually/);
});

void test('formatExistingPRMessage returns the idempotent existing-PR message', () => {
    assert.equal(
        formatExistingPRMessage(17, 'https://github.com/x/y/pull/17'),
        'Existing draft PR: #17 (https://github.com/x/y/pull/17)',
    );
});

// ── resolveCanonPrBody (ninja-mode PR body) ─────────────────────────────────

void test('resolveCanonPrBody: default (no env var) returns null so gh uses its own defaults', () => {
    assert.equal(resolveCanonPrBody(['foo'], 'Foo task title', {}), null);
});

void test('resolveCanonPrBody: empty env var still returns null (treated as opt-out)', () => {
    assert.equal(resolveCanonPrBody(['foo'], 'Foo task title', { CANON_PR_BODY: '' }), null);
});

void test('resolveCanonPrBody: env var expands $LABEL and $TITLE placeholders for single task', () => {
    const out = resolveCanonPrBody(['fix-hover'], 'Fix hover state', {
        CANON_PR_BODY: 'Generated for $LABEL\n\nTitle: $TITLE',
    });
    assert.equal(out, 'Generated for fix-hover\n\nTitle: Fix hover state');
});

void test('resolveCanonPrBody: env var joins multiple task IDs into $LABEL', () => {
    const out = resolveCanonPrBody(['a', 'b', 'c'], 'Bundle title', {
        CANON_PR_BODY: 'Tasks: $LABEL',
    });
    assert.equal(out, 'Tasks: a, b, c');
});

// ── resolveQaPrBody (QA drafted PR body) ───────────────────────────────────

void test('resolveQaPrBody: returns body-file for a populated single-task body', () => {
    withTempDir('canon-pr-body-', dir => {
        const taskId = 'task-a';
        const tasksDir = path.join(dir, 'tasks');
        const prBodyPath = path.join(tasksDir, taskId, 'pr-body.md');
        fs.mkdirSync(path.dirname(prBodyPath), { recursive: true });
        fs.writeFileSync(prBodyPath, [
            '# Summary',
            '',
            '- Filled by QA.',
            '',
        ].join('\n'));

        const result = resolveQaPrBody([taskId], dir);
        assert.deepEqual(result, { kind: 'body-file', path: prBodyPath });
    });
});

void test('resolveQaPrBody: returns fallback for a missing single-task body', () => {
    withTempDir('canon-pr-body-missing-', dir => {
        const result = resolveQaPrBody(['task-a'], dir);
        assert.deepEqual(result, { kind: 'fallback', reason: 'pr-body.md not found' });
    });
});

void test('resolveQaPrBody: returns fallback for the stub template', () => {
    withTempDir('canon-pr-body-stub-', dir => {
        const taskId = 'task-a';
        const prBodyPath = path.join(dir, 'tasks', taskId, 'pr-body.md');
        fs.mkdirSync(path.dirname(prBodyPath), { recursive: true });
        fs.writeFileSync(prBodyPath, [
            '<!-- [pr-body-stub] QA fills this file during the qa phase. Do not edit manually before QA runs. -->',
            '',
            '# PR Body: [TASK-ID] - [Title]',
            '',
        ].join('\n'));

        const result = resolveQaPrBody([taskId], dir);
        assert.deepEqual(result, { kind: 'fallback', reason: 'pr-body.md is still the stub template' });
    });
});

void test('resolveQaPrBody: bundles fall back because per-task bodies are not combined', () => {
    withTempDir('canon-pr-body-bundle-', dir => {
        const result = resolveQaPrBody(['task-a', 'task-b'], dir);
        assert.deepEqual(result, {
            kind: 'fallback',
            reason: 'bundle: per-task pr-body.md files are not combined in this version',
        });
    });
});

void test('findPullRequestTemplate: returns null when no template exists', () => {
    withTempDir('canon-pr-template-', dir => {
        assert.equal(findPullRequestTemplate(dir), null);
    });
});

void test('findPullRequestTemplate: finds .github/pull_request_template.md', () => {
    withTempDir('canon-pr-template-', dir => {
        const githubDir = path.join(dir, '.github');
        fs.mkdirSync(githubDir, { recursive: true });
        const expected = path.join(githubDir, 'pull_request_template.md');
        fs.writeFileSync(expected, '## Summary\n');
        assert.equal(findPullRequestTemplate(dir), expected);
    });
});

void test('findPullRequestTemplate: docs/ subdirectory location', () => {
    // Tests the docs/ fallback location in the candidate list — separate from
    // the .github/ case-sensitivity story (macOS treats lowercase + uppercase
    // basenames as the same file there, so testing both adds no coverage).
    withTempDir('canon-pr-template-', dir => {
        const docsDir = path.join(dir, 'docs');
        fs.mkdirSync(docsDir, { recursive: true });
        const expected = path.join(docsDir, 'pull_request_template.md');
        fs.writeFileSync(expected, '## Summary\n');
        assert.equal(findPullRequestTemplate(dir), expected);
    });
});

void test('main prints the complete-phase banner when the task is already complete', () => {
    withTempDir('run-task-complete-banner-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        writeTaskStatus(tasksRoot, 'task-a', makeCompleteStatus('task-a', 'task/task-a'));
        writeTaskStatus(tasksRoot, 'task-b', makeCompleteStatus('task-b', 'task/task-a'));
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './src/orchestrator/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', 'task-b'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GH_PR_NUMBER: '88',
            FAKE_GH_PR_URL: 'https://github.com/x/y/pull/88',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /TASK COMPLETE — already past human_review/);
        assert.equal((result.stdout.match(/TASK COMPLETE — already past human_review/g) ?? []).length, 1);
        assert.match(result.stdout, /canon run task-a task-b --ship/);
    });
});

void test('main prints the state-aware pushed_no_pr banner when the task is complete', () => {
    withTempDir('run-task-complete-pushed-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        writeTaskStatus(tasksRoot, 'task-a', makeCompleteStatus('task-a', 'task/task-a'));
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
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /TASK COMPLETE — already past human_review/);
        assert.match(result.stdout, /no open PR/);
        assert.match(result.stdout, /canon run task-a --pr/);
    });
});

void test('main prints the state-aware unpushed banner when the task is complete', () => {
    withTempDir('run-task-complete-unpushed-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        writeTaskStatus(tasksRoot, 'task-a', makeCompleteStatus('task-a', 'task/task-a'));
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
            FAKE_GIT_REMOTE_EXISTS: '0',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /TASK COMPLETE — already past human_review/);
        assert.match(result.stdout, /not on origin/);
        assert.match(result.stdout, /canon run task-a --pr/);
    });
});

void test('main --pr on complete is idempotent when an open PR already exists', () => {
    withTempDir('run-task-complete-pr-', dir => {
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
        writeTaskStatus(tasksRoot, 'task-a', status);
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './src/orchestrator/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--pr'];",
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
            FAKE_GH_PR_NUMBER: '88',
            FAKE_GH_PR_URL: 'https://github.com/x/y/pull/88',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Existing draft PR: #88 \(https:\/\/github\.com\/x\/y\/pull\/88\)/);
        assert.doesNotMatch(result.stdout, /TASK COMPLETE — already past human_review/);
        // Codex P1 on release PR #82: push MUST run even when an open PR is
        // already detected — clean tree + open PR doesn't guarantee origin
        // matches HEAD (new local commits after the PR was opened would be
        // silently dropped without this push).
        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.match(gitLog, /^push -u origin task\/task-a$/m, 'push must run on PR-exists branch');
    });
});

void test('main --pr on complete logs the pr-body fallback when pr-body.md is missing', () => {
    withTempDir('run-task-complete-pr-body-fallback-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, 'task-a');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        fs.mkdirSync(worktreeDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const status = makeCompleteStatus('task-a', 'task/task-a');
        status.worktree = true;
        writeTaskStatus(tasksRoot, 'task-a', status);
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');
        const prStateFile = path.join(dir, 'gh-pr-state.txt');

        const result = runNodeInline([
            "import { main } from './src/orchestrator/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--pr'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GH_LOG: path.join(dir, 'gh.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GH_PR_STATE_FILE: prStateFile,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /PR body fallback \(pr-body\.md not found\) — falling back to repo PR template or --fill/);
        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.match(gitLog, /^push -u origin task\/task-a$/m, 'push must run before falling back to the repo template');
        const ghLog = fs.readFileSync(path.join(dir, 'gh.log'), 'utf8');
        assert.match(ghLog, /pr create .*--body-file .*pull_request_template\.md/m);
    });
});

void test('main --pr at human_review is idempotent when an open PR already exists', () => {
    withTempDir('run-task-human-review-pr-', dir => {
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
        phases.human_review = { status: 'pending', agent: 'human' };
        writeTaskStatus(tasksRoot, 'task-a', status);
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './src/orchestrator/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--pr'];",
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
            FAKE_GH_PR_NUMBER: '88',
            FAKE_GH_PR_URL: 'https://github.com/x/y/pull/88',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Existing draft PR: #88 \(https:\/\/github\.com\/x\/y\/pull\/88\)/);
        assert.doesNotMatch(result.stdout, /TASK COMPLETE — already past human_review/);
        // Codex P1 on release PR #82: see complete-phase test above for full
        // rationale — push must run even when an open PR is detected.
        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.match(gitLog, /^push -u origin task\/task-a$/m, 'push must run on PR-exists branch');
    });
});

void test('main --pr does NOT match an open PR on the wrong base (Codex P2 on release PR #82 audit)', () => {
    // makeCompleteStatus() declares base_branch: 'main', so a task with an
    // open PR against an unrelated base ('release/v9') must not be picked
    // up as the "existing PR" for idempotent --pr. Before the fix,
    // findOpenPRNumber ignored --base entirely; the wrong-base PR's URL
    // would be printed and (worse) mergeOpenPRsAndPull would squash-merge
    // it into the wrong base on --ship.
    withTempDir('run-task-wrong-base-pr-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        writeTaskStatus(tasksRoot, 'task-a', makeCompleteStatus('task-a', 'task/task-a'));
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './src/orchestrator/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--pr'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GH_PR_NUMBER: '99',
            FAKE_GH_PR_URL: 'https://github.com/x/y/pull/99',
            FAKE_GIT_BASE_BRANCH: 'main',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            // gh shim: only return PR #99 if --base release/v9 (task expects main).
            FAKE_GH_PR_BASE: 'release/v9',
        });

        // The wrong-base PR must NOT be reported as the existing draft.
        // Note: we don't assert status === 0 because the test doesn't fully
        // wire the push/PR-create happy path (we only care about the
        // idempotency-check branch). The key assertion is the negative one.
        assert.doesNotMatch(result.stdout, /Existing draft PR: #99/);
    });
});

void test('main --pr at human_review with dirty allowed files is idempotent when an open PR already exists (GP #10)', () => {
    // 1.2.0's --pr idempotency only fired on the clean-tree retry path. The
    // dirty-tree commit-then-create path went straight to `gh pr create` and
    // died on its "PR already exists" exit code. GP's starter-preview-renderer
    // bundle hit this when QA finished writing artifacts and `--pr` ran while
    // tasks/<id>/done.md was still uncommitted — the PR (already opened on a
    // prior run) caused canon to exit 1 even though the work succeeded.
    withTempDir('run-task-human-review-pr-dirty-', dir => {
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
        phases.human_review = { status: 'pending', agent: 'human' };
        writeTaskStatus(tasksRoot, 'task-a', status);
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './src/orchestrator/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--pr'];",
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
            // Dirty file is on the allowlist — this is the "QA wrote done.md
            // and canon needs to commit + push + report" path.
            FAKE_GIT_STATUS_OUTPUT: ' M tasks/task-a/done.md',
            FAKE_GIT_DIFF_OUTPUT: 'tasks/task-a/done.md',
            FAKE_GH_PR_NUMBER: '94',
            FAKE_GH_PR_URL: 'https://github.com/x/y/pull/94',
        });

        // 1.3.0 expectation: the existing PR is detected after the commit + push,
        // canon prints the URL, and exits 0. Pre-fix this exited 1 with the
        // `gh pr create` "PR already exists" stderr propagated up.
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Existing draft PR: #94 \(https:\/\/github\.com\/x\/y\/pull\/94\)/);
        // The commit + push must still happen for QA artifacts to reach origin
        // before the PR-exists branch returns.
        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.match(gitLog, /^commit /m, 'commit must run on dirty-tree path');
        assert.match(gitLog, /^push -u origin task\/task-a$/m, 'push must run on dirty-tree path');
    });
});

void test('main --pr on complete still rejects dirty files outside the human_review allowlist', () => {
    withTempDir('run-task-complete-pr-dirty-', dir => {
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
        writeTaskStatus(tasksRoot, 'task-a', status);
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './src/orchestrator/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--pr'];",
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
            FAKE_GIT_STATUS_OUTPUT: '?? src/rogue.ts',
            FAKE_GH_PR_NUMBER: '88',
            FAKE_GH_PR_URL: 'https://github.com/x/y/pull/88',
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /working tree has dirty files outside the human_review allowlist/);
    });
});

// Fake git: checkout only changes the current-branch marker, so tasks/<id>/ stays on disk.
// This covers complete-state archiving; the real-git tests below cover the non-worktree ENOENT path.
void test('main --ship still works when the task is already complete', () => {
    withTempDir('run-task-complete-ship-', dir => {
        const taskId = 'ship-smoke';
        const repoRoot = process.cwd();
        const taskDir = path.join(repoRoot, 'tasks', taskId);
        const archiveDir = path.join(repoRoot, 'tasks', '_archive', taskId);
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        fs.mkdirSync(taskDir, { recursive: true });
        writeTaskStatus(path.join(repoRoot, 'tasks'), taskId, makeCompleteStatus(taskId, `task/${taskId}`));
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, `task/${taskId}\n`);

        try {
            const result = runNodeInline([
                "import { main } from './src/orchestrator/main.ts';",
                `process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--ship'];`,
                "main().catch(err => { console.error(err); process.exit(1); });",
            ].join('\n'), {
                ...process.env,
                PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
                FAKE_GIT_LOG: path.join(dir, 'git.log'),
                FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
                FAKE_GIT_BASE_BRANCH: 'main',
                FAKE_GIT_TASK_BRANCH: `task/${taskId}`,
                FAKE_GIT_REMOTE_BRANCH: `task/${taskId}`,
                FAKE_GIT_REMOTE_EXISTS: '0',
                FAKE_GIT_REVLIST_COUNT: '0',
                FAKE_GIT_STATUS_OUTPUT: '',
            });

            assert.equal(result.status, 0, result.stderr);
            assert.match(result.stdout, /Shipped 1 task to _archive\/\./);
        } finally {
            fs.rmSync(taskDir, { recursive: true, force: true });
            fs.rmSync(archiveDir, { recursive: true, force: true });
        }
    });
});

void test('main --ship handles a task with worktree: false when base lacks status.json', () => {
    withTempDir('run-task-ship-non-worktree-', dir => {
        const taskId = 'ship-nw';
        const branch = `task/${taskId}`;
        const { localDir, originDir } = makeGitFixture(dir);
        const fakeBins = path.join(dir, 'fake-bins');
        const worktreesRoot = path.join(dir, 'worktrees');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);

        gitIn(localDir, 'checkout', '-b', branch);
        writeShipTaskArtifacts(localDir, taskId, branch, false);
        gitIn(localDir, 'add', 'tasks');
        gitIn(localDir, 'commit', '-m', `add ${taskId}`);
        const taskTip = execFileSync('git', ['rev-parse', branch], { cwd: localDir, encoding: 'utf8' }).trim();
        gitIn(localDir, 'push', '-u', 'origin', branch);

        simulateShipMergeOnOrigin(dir, originDir, taskId, branch, false);

        const result = runShipTask(taskId, fakeBins, localDir, {
            FAKE_GH_PR_NUMBER: '42',
            FAKE_GH_PR_HEAD: branch,
            FAKE_GH_PR_BASE: 'main',
            FAKE_GH_HEAD_REF_OID: taskTip,
            CANON_WORKTREES_ROOT: worktreesRoot,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Shipped 1 task to _archive\/\./);
        assert.ok(fs.existsSync(path.join(localDir, 'tasks', '_archive', taskId)));
    });
});

void test('main --ship handles a task with worktree: true and tears down the worktree', () => {
    withTempDir('run-task-ship-worktree-', dir => {
        const taskId = 'ship-wt';
        const branch = `task/${taskId}`;
        const { localDir, originDir } = makeGitFixture(dir);
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);

        gitIn(localDir, 'checkout', '-b', branch);
        writeShipTaskArtifacts(localDir, taskId, branch, true);
        gitIn(localDir, 'add', 'tasks');
        gitIn(localDir, 'commit', '-m', `add ${taskId}`);
        const taskTip = execFileSync('git', ['rev-parse', branch], { cwd: localDir, encoding: 'utf8' }).trim();
        gitIn(localDir, 'push', '-u', 'origin', branch);

        gitIn(localDir, 'checkout', 'main');
        fs.mkdirSync(worktreesRoot, { recursive: true });
        gitIn(localDir, 'worktree', 'add', worktreeDir, branch);
        simulateShipMergeOnOrigin(dir, originDir, taskId, branch, true);

        try {
            const result = runShipTask(taskId, fakeBins, localDir, {
                FAKE_GH_PR_NUMBER: '43',
                FAKE_GH_PR_HEAD: branch,
                FAKE_GH_PR_BASE: 'main',
                FAKE_GH_HEAD_REF_OID: taskTip,
                CANON_WORKTREES_ROOT: worktreesRoot,
            });

            assert.equal(result.status, 0, result.stderr);
            assert.match(result.stdout, /Shipped 1 task to _archive\/\./);
            assert.ok(fs.existsSync(path.join(localDir, 'tasks', '_archive', taskId)));
            assert.ok(!fs.existsSync(worktreeDir));
        } finally {
            if (fs.existsSync(worktreeDir)) {
                spawnSync('git', ['worktree', 'remove', '--force', worktreeDir], {
                    cwd: localDir,
                    encoding: 'utf8',
                });
            }
        }
    });
});

void test('enableFullSend writes full_send and clears human_spec_gate for every task', () => {
    withTempDir('run-task-full-send-enable-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        writeTaskStatus(tasksRoot, 'task-a', {
            id: 'task-a',
            title: 'task-a',
            base_branch: 'main',
            human_spec_gate: true,
            full_send: false,
            worktree: false,
            phases: {},
        });
        writeTaskStatus(tasksRoot, 'task-b', {
            id: 'task-b',
            title: 'task-b',
            base_branch: 'main',
            human_spec_gate: true,
            full_send: false,
            worktree: false,
            phases: {},
        });

        withFakeGitEnv({
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        }, () => {
            enableFullSend(['task-a', 'task-b']);
        });

        const statusA = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            full_send?: boolean;
            human_spec_gate?: boolean;
        };
        const statusB = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-b', 'status.json'), 'utf8')) as {
            full_send?: boolean;
            human_spec_gate?: boolean;
        };

        assert.equal(statusA.full_send, true);
        assert.equal(statusA.human_spec_gate, false);
        assert.equal(statusB.full_send, true);
        assert.equal(statusB.human_spec_gate, false);
    });
});

void test('fast-tier spec review keeps the gate when a bundle mixes full-send and normal tasks', () => {
    withTempDir('run-task-full-send-fast-mixed-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        for (const [taskId, fullSend] of [['task-a', true], ['task-b', false]] as const) {
            writeTaskStatus(tasksRoot, taskId, {
                id: taskId,
                title: taskId,
                base_branch: 'main',
                task_size: 'XS',
                human_spec_gate: true,
                full_send: fullSend,
                worktree: false,
                phases: {
                    spec: { status: 'done', agent: 'claude' },
                    spec_review: { status: 'pending', agent: 'codex' },
                    plan: { status: 'pending', agent: 'claude' },
                },
            });
            writeApprovedSpecReview(tasksRoot, taskId);
            writePopulatedPlan(tasksRoot, taskId);
        }

        const result = runNodeInline([
            "import { buildPipelineState } from './src/orchestrator/main.ts';",
            "import { runSpecReviewPhase } from './src/orchestrator/phases/spec-review.ts';",
            '(async () => {',
            "  const state = buildPipelineState(['task-a', 'task-b']);",
            '  await runSpecReviewPhase(state, false, null);',
            '})().catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), {
            ...process.env,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /SPEC GATE — Review before Codex implements\./);

        const statusA = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            human_spec_gate?: boolean;
            phases?: { spec_review?: { status?: string }; plan?: { status?: string } };
        };
        const statusB = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-b', 'status.json'), 'utf8')) as {
            human_spec_gate?: boolean;
            phases?: { spec_review?: { status?: string }; plan?: { status?: string } };
        };
        assert.equal(statusA.human_spec_gate, false);
        assert.equal(statusB.human_spec_gate, false);
        assert.equal(statusA.phases?.spec_review?.status, 'pending');
        assert.equal(statusB.phases?.spec_review?.status, 'pending');
        assert.equal(statusA.phases?.plan?.status, 'pending');
        assert.equal(statusB.phases?.plan?.status, 'pending');
    });
});

void test('fast-tier spec review skips the gate when every task is full-send', () => {
    withTempDir('run-task-full-send-fast-all-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        for (const taskId of ['task-a', 'task-b']) {
            writeTaskStatus(tasksRoot, taskId, {
                id: taskId,
                title: taskId,
                base_branch: 'main',
                task_size: 'XS',
                human_spec_gate: true,
                full_send: true,
                worktree: false,
                phases: {
                    spec: { status: 'done', agent: 'claude' },
                    spec_review: { status: 'pending', agent: 'codex' },
                    plan: { status: 'pending', agent: 'claude' },
                },
            });
            writeApprovedSpecReview(tasksRoot, taskId);
            writePopulatedPlan(tasksRoot, taskId);
        }

        const result = runNodeInline([
            "import { buildPipelineState } from './src/orchestrator/main.ts';",
            "import { runSpecReviewPhase } from './src/orchestrator/phases/spec-review.ts';",
            '(async () => {',
            "  const state = buildPipelineState(['task-a', 'task-b']);",
            '  await runSpecReviewPhase(state, false, null);',
            '})().catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), {
            ...process.env,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(result.stdout, /SPEC GATE — Review before Codex implements\./);

        const statusA = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            phases?: { spec_review?: { status?: string }; plan?: { status?: string } };
        };
        const statusB = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-b', 'status.json'), 'utf8')) as {
            phases?: { spec_review?: { status?: string }; plan?: { status?: string } };
        };
        assert.equal(statusA.phases?.spec_review?.status, 'done');
        assert.equal(statusB.phases?.spec_review?.status, 'done');
        assert.equal(statusA.phases?.plan?.status, 'done');
        assert.equal(statusB.phases?.plan?.status, 'done');
    });
});

void test('commitHumanReviewFiles(createPR = false) pushes without opening a PR', () => {
    withTempDir('run-task-commit-pr-false-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        writeTaskStatus(tasksRoot, 'task-a', {
            id: 'task-a',
            title: 'task-a',
            base_branch: 'main',
            full_send: false,
            human_spec_gate: false,
            worktree: false,
            phases: {
                human_review: { status: 'pending', agent: 'human' },
            },
        });
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
        const ghLogPath = path.join(dir, 'gh.log');

        const result = runNodeInline([
            "import { commitHumanReviewFiles } from './src/orchestrator/main.ts';",
            `commitHumanReviewFiles(['task-a'], ${JSON.stringify(dir)}, false);`,
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GIT_STATUS_OUTPUT: ' M tasks/task-a/handoff.md',
            FAKE_GIT_DIFF_OUTPUT: 'tasks/task-a/handoff.md',
            FAKE_GH_LOG: ghLogPath,
        });

        assert.equal(result.status, 0, result.stderr);

        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.match(gitLog, /^push -u origin task\/task-a$/m);
        assert.equal(fs.existsSync(ghLogPath), false);
    });
});

void test('commitHumanReviewFiles(createPR = true) opens a PR on a clean-tree retry', () => {
    withTempDir('run-task-commit-pr-true-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        writeTaskStatus(tasksRoot, 'task-a', {
            id: 'task-a',
            title: 'task-a',
            base_branch: 'main',
            full_send: false,
            human_spec_gate: false,
            worktree: false,
            phases: {
                human_review: { status: 'pending', agent: 'human' },
            },
        });

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');
        const gitLogPath = path.join(dir, 'git.log');
        const ghLogPath = path.join(dir, 'gh.log');
        const prStateFile = path.join(dir, 'gh-pr-state.txt');

        const result = runNodeInline([
            "import { commitHumanReviewFiles } from './src/orchestrator/main.ts';",
            `commitHumanReviewFiles(['task-a'], ${JSON.stringify(dir)}, true);`,
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: gitLogPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GIT_STATUS_OUTPUT: '',
            FAKE_GIT_DIFF_OUTPUT: '',
            FAKE_GH_LOG: ghLogPath,
            FAKE_GH_PR_STATE_FILE: prStateFile,
            FAKE_GH_PR_CREATE_NUMBER: '202',
            FAKE_GH_PR_CREATE_URL: 'https://github.com/x/y/pull/202',
        });

        assert.equal(result.status, 0, result.stderr);

        const gitLog = fs.readFileSync(gitLogPath, 'utf8');
        assert.match(gitLog, /^push -u origin task\/task-a$/m);
        const ghLog = fs.readFileSync(ghLogPath, 'utf8');
        assert.match(ghLog, /^pr list /m);
        assert.match(ghLog, /^pr create /m);
    });
});

void test('commitHumanReviewFiles preserves the push-failure die message', () => {
    withTempDir('run-task-commit-push-fail-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M tasks/task-a/handoff.md',
            FAKE_GIT_DIFF_OUTPUT: 'tasks/task-a/handoff.md',
            FAKE_GIT_FAIL_PUSH: '1',
            FAKE_GIT_FAIL_PUSH_ERROR: 'simulated push failure',
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Human review push failed: simulated push failure/);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(gitLog, /^push -u origin task\/task-a$/m);
    });
});

void test('classifyMergeOutcome tolerates clean gh merge exits', () => {
    assert.equal(classifyMergeOutcome({ exitOk: true, mergeConfirmed: false }), 'tolerate');
});

void test('classifyMergeOutcome tolerates failed gh exits when the attempted PR is merged', () => {
    assert.equal(classifyMergeOutcome({ exitOk: false, mergeConfirmed: true }), 'tolerate');
});

void test('classifyMergeOutcome fails failed gh exits when the attempted PR is not merged', () => {
    assert.equal(classifyMergeOutcome({ exitOk: false, mergeConfirmed: false }), 'fail');
});

void test('main --push blocks when local base has unpushed commits', () => {
    withTempDir('run-task-base-divergence-block-', dir => {
        const taskId = 'task-a';
        const { localDir, shortSha } = setupDivergentBaseRepo(dir, taskId);
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
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }), localDir);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, new RegExp(shortSha));
        assert.match(result.stderr, /--allow-divergent-base/);
        assert.match(result.stderr, /Base divergence detected/);
    });
});

void test('plain --pr refuses an unsafe (out-of-tasks/) unpushed base commit without pushing it', () => {
    withTempDir('run-task-plain-pr-base-divergence-', dir => {
        const taskId = 'task-a';
        const { localDir } = setupDivergentBaseRepo(dir, taskId);
        const baseBefore = execFileSync('git', ['--git-dir', path.join(dir, 'origin.git'), 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim();
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);
        const result = runMainInline(taskId, ['--pr'], {
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: path.join(localDir, 'tasks'),
        }, localDir);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Base divergence detected/);
        const baseAfter = execFileSync('git', ['--git-dir', path.join(dir, 'origin.git'), 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim();
        assert.equal(baseAfter, baseBefore);
    });
});

void test('main full-send tail pushes an unpushed scaffold tip SHA before the divergence gate', () => {
    withTempDir('run-task-full-send-scaffold-push-', dir => {
        const taskId = 'task-a';
        const { localDir: clonedDir, originDir } = makeGitFixture(dir);
        const localDir = path.join(dir, 'worktrees', taskId);
        fs.mkdirSync(path.dirname(localDir), { recursive: true });
        fs.renameSync(clonedDir, localDir);
        fs.mkdirSync(path.join(localDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'src/module.ts'), 'export const value = 1;\n', 'utf8');
        gitIn(localDir, 'add', 'src/module.ts');
        gitIn(localDir, 'commit', '-m', 'add tracked module');
        gitIn(localDir, 'push', 'origin', 'main');
        const originMainSha = execFileSync('git', ['rev-parse', 'origin/main'], { cwd: localDir, encoding: 'utf8' }).trim();

        const status = makeCompleteStatus(taskId, `task/${taskId}`);
        status.full_send = true;
        (status.phases as Record<string, { status: string; agent: string }>).human_review = { status: 'pending', agent: 'human' };
        writeTaskStatus(path.join(localDir, 'tasks'), taskId, status);
        writeAffectedFilesSpec(path.join(localDir, 'tasks'), taskId, []);
        gitIn(localDir, 'add', 'tasks');
        gitIn(localDir, 'commit', '-m', `task(${taskId}): commit artifacts pre-pipeline`);
        fs.copyFileSync(path.join(localDir, 'src/module.ts'), path.join(localDir, 'tasks', taskId, 'module-copy.ts'));
        gitIn(localDir, 'add', `tasks/${taskId}/module-copy.ts`);
        gitIn(localDir, 'commit', '-m', `task(${taskId}): commit artifacts pre-pipeline`);
        const scaffoldTip = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: localDir, encoding: 'utf8' }).trim();
        const taskBranch = `task/${taskId}`;
        gitIn(localDir, 'checkout', '-b', taskBranch);
        fs.writeFileSync(path.join(localDir, 'tasks', taskId, 'handoff.md'), [
            '# Implementation Handoff', '', '## Validation Outcomes', '', '| Check | Result | Notes |', '|---|---|---|', '| `lint` | Pass | ok |', '',
        ].join('\n'), 'utf8');

        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);
        const result = runMainInline(taskId, ['--full-send'], {
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: path.join(localDir, 'tasks'),
            CANON_WORKTREES_ROOT: path.dirname(localDir),
            FAKE_GH_LOG: path.join(dir, 'gh.log'),
            FAKE_GH_PR_STATE_FILE: path.join(dir, 'pr-state.txt'),
        }, localDir);

        assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
        assert.match(result.stdout, /Pushed 2 unpushed main commit\(s\) to origin\/main/);
        const listedCommits = execFileSync('git', ['log', `${originMainSha}..${scaffoldTip}`, '--format=%H%x09%s'], {
            cwd: localDir,
            encoding: 'utf8',
        }).trim().split('\n');
        assert.equal(listedCommits.length, 2);
        for (const line of listedCommits) {
            const [sha, subject] = line.split('\t');
            assert.ok(sha && subject);
            assert.ok(result.stdout.includes(`${sha.slice(0, 7)}  ${subject}`), `missing pushed commit ${sha} ${subject}`);
        }
        const remoteTip = execFileSync('git', ['--git-dir', originDir, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim();
        assert.equal(remoteTip, scaffoldTip);
        const ghLog = fs.readFileSync(path.join(dir, 'gh.log'), 'utf8');
        assert.match(ghLog, /^pr create /m);
    });
});

void test('full-send tail leaves every unsafe scaffold-looking commit off origin', () => {
    const variants: { name: string; add: (repo: string, id: string) => void }[] = [
        {
            name: 'arbitrary subject',
            add: (repo, id) => {
                fs.writeFileSync(path.join(repo, 'tasks', id, 'extra.txt'), 'extra\n');
                gitIn(repo, 'add', `tasks/${id}/extra.txt`);
                gitIn(repo, 'commit', '-m', 'operator data');
            },
        },
        {
            name: 'suffixed subject',
            add: (repo, id) => {
                fs.writeFileSync(path.join(repo, 'tasks', id, 'extra.txt'), 'extra\n');
                gitIn(repo, 'add', `tasks/${id}/extra.txt`);
                gitIn(repo, 'commit', '-m', `task(${id}): commit artifacts pre-pipeline amended`);
            },
        },
        {
            name: 'embedded subject',
            add: (repo, id) => {
                fs.writeFileSync(path.join(repo, 'tasks', id, 'extra.txt'), 'extra\n');
                gitIn(repo, 'add', `tasks/${id}/extra.txt`);
                gitIn(repo, 'commit', '-m', `wip: task(${id}): commit artifacts pre-pipeline`);
            },
        },
        {
            name: 'outside source path',
            add: (repo, id) => {
                fs.writeFileSync(path.join(repo, 'src/module.ts'), 'export const value = 2;\n');
                gitIn(repo, 'add', 'src/module.ts');
                gitIn(repo, 'commit', '-m', `task(${id}): commit artifacts pre-pipeline`);
            },
        },
        {
            name: 'rename from source into tasks',
            add: (repo, id) => {
                gitIn(repo, 'mv', 'src/module.ts', `tasks/${id}/module.ts`);
                gitIn(repo, 'commit', '-m', `task(${id}): commit artifacts pre-pipeline`);
            },
        },
        {
            name: 'merge commit',
            add: (repo, id) => {
                gitIn(repo, 'checkout', '-b', 'side-scaffold');
                fs.writeFileSync(path.join(repo, 'tasks', id, 'side.txt'), 'side\n');
                gitIn(repo, 'add', `tasks/${id}/side.txt`);
                gitIn(repo, 'commit', '-m', `task(${id}): commit artifacts pre-pipeline`);
                gitIn(repo, 'checkout', 'main');
                fs.writeFileSync(path.join(repo, 'tasks', id, 'main.txt'), 'main\n');
                gitIn(repo, 'add', `tasks/${id}/main.txt`);
                gitIn(repo, 'commit', '-m', `task(${id}): commit artifacts pre-pipeline`);
                gitIn(repo, 'merge', '--no-ff', 'side-scaffold', '-m', `task(${id}): commit artifacts pre-pipeline`);
            },
        },
    ];
    for (const variant of variants) {
        withTempDir(`run-task-full-send-unsafe-${variant.name.replaceAll(' ', '-')}-`, dir => {
            const fixture = setupFullSendTailFixture(dir, variant.add);
            const result = runFullSendTailFixture(fixture, dir);
            assert.notEqual(result.status, 0, variant.name);
            assert.match(result.stderr, /Base divergence detected/, variant.name);
            const remoteTip = execFileSync('git', ['--git-dir', fixture.originDir, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim();
            assert.equal(remoteTip, fixture.originBaseSha, variant.name);
            const ghLog = fs.existsSync(path.join(dir, 'gh.log')) ? fs.readFileSync(path.join(dir, 'gh.log'), 'utf8') : '';
            assert.doesNotMatch(ghLog, /^pr create /m, variant.name);
        });
    }
});

void test('full-send tail fails closed on a rejected base push and a commit-list probe error', () => {
    withTempDir('run-task-full-send-rejected-push-', dir => {
        const fixture = setupFullSendTailFixture(dir);
        const hook = path.join(fixture.originDir, 'hooks', 'pre-receive');
        writeExecutable(path.dirname(hook), 'pre-receive', ['echo "protected branch rejection" >&2', 'exit 1']);
        const result = runFullSendTailFixture(fixture, dir);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /protected branch rejection/);
        assert.match(result.stderr, /base branch may be protected/i);
        const ghLog = fs.existsSync(path.join(dir, 'gh.log')) ? fs.readFileSync(path.join(dir, 'gh.log'), 'utf8') : '';
        assert.doesNotMatch(ghLog, /^pr create /m);
        const remoteTip = execFileSync('git', ['--git-dir', fixture.originDir, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim();
        assert.equal(remoteTip, fixture.originBaseSha);
    });

    withTempDir('run-task-full-send-probe-error-', dir => {
        const fixture = setupFullSendTailFixture(dir);
        const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
        writeExecutable(fixture.fakeBins, 'git', [
            'if [ "${1:-}" = "log" ] && [ "${2:-}" = "origin/main..refs/heads/main" ]; then echo "simulated commit-list failure" >&2; exit 1; fi',
            `exec "${realGit}" "$@"`,
        ]);
        const result = runFullSendTailFixture(fixture, dir);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /could not list unpushed main commits/);
        assert.match(result.stderr, /simulated commit-list failure/);
        const remoteTip = execFileSync('git', ['--git-dir', fixture.originDir, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim();
        assert.equal(remoteTip, fixture.originBaseSha);
    });
});

void test('full-send tail pushes the checked tip but not a concurrent operator commit', () => {
    withTempDir('run-task-full-send-concurrent-base-', dir => {
        const fixture = setupFullSendTailFixture(dir);
        const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
        writeExecutable(fixture.fakeBins, 'git', [
            'if [ "${1:-}" = "push" ] && [ "${2:-}" = "origin" ]; then',
            '  case "${3:-}" in main|*:refs/heads/main)',
            '  "$REAL_GIT" -C "$TAIL_REPO" checkout -q main',
            '  echo operator > "$TAIL_REPO/operator-source.txt"',
            '  "$REAL_GIT" -C "$TAIL_REPO" add operator-source.txt',
            '  "$REAL_GIT" -C "$TAIL_REPO" commit -qm "operator source commit"',
            '  "$REAL_GIT" -C "$TAIL_REPO" checkout -q task/task-a',
            '  ;; esac',
            'fi',
            'exec "$REAL_GIT" "$@"',
        ]);
        const result = runFullSendTailFixture(fixture, dir, { REAL_GIT: realGit, TAIL_REPO: fixture.localDir });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Base divergence detected/);
        const remoteTip = execFileSync('git', ['--git-dir', fixture.originDir, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim();
        const checkedScaffoldTip = execFileSync('git', ['rev-parse', 'task/task-a'], { cwd: fixture.localDir, encoding: 'utf8' }).trim();
        const localMainTip = execFileSync('git', ['rev-parse', 'main'], { cwd: fixture.localDir, encoding: 'utf8' }).trim();
        assert.equal(remoteTip, checkedScaffoldTip);
        assert.notEqual(remoteTip, localMainTip);
    });
});

void test('main --push --allow-divergent-base warns and proceeds past the divergence gate', () => {
    withTempDir('run-task-base-divergence-bypass-', dir => {
        const taskId = 'task-a';
        const { localDir, shortSha } = setupDivergentBaseRepo(dir, taskId);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            `.then(m => {`,
            `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--push', '--allow-divergent-base'];`,
            `  return m.main();`,
            `})`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }), localDir);

        const output = combinedOutput(result);
        assert.match(output, /--allow-divergent-base override/);
        assert.match(output, new RegExp(shortSha));
        assert.doesNotMatch(output, /Base divergence detected/);
    });
});

void test('main --full-send --force advances to draft PR and marks human_review done', () => {
    withTempDir('run-task-full-send-tail-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const status = makeCompleteStatus('task-a', 'task/task-a');
        status.delicate = true;
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
        const prStateFile = path.join(dir, 'gh-pr-state.txt');

        const result = runNodeInline([
            "import { main } from './src/orchestrator/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--full-send', '--force'];",
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
            FAKE_GH_PR_STATE_FILE: prStateFile,
            FAKE_GH_PR_CREATE_NUMBER: '101',
            FAKE_GH_PR_CREATE_URL: 'https://github.com/x/y/pull/101',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /FULL-SEND COMPLETE — draft PR open\./);
        assert.match(result.stdout, /PR: https:\/\/github\.com\/x\/y\/pull\/101/);
        assert.equal((result.stdout.match(/^  PR: https:\/\/github\.com\/x\/y\/pull\/101$/gm) ?? []).length, 1);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            full_send?: boolean;
            human_spec_gate?: boolean;
            phases?: { human_review?: { status?: string } };
        };
        assert.equal(updated.full_send, true);
        assert.equal(updated.human_spec_gate, false);
        assert.equal(updated.phases?.human_review?.status, 'done');

        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.match(gitLog, /^push -u origin task\/task-a$/m);
        assert.match(gitLog, /^rev-parse --abbrev-ref HEAD$/m);
        assert.ok(fs.existsSync(prStateFile));
    });
});

void test('main full-send tail reports the PR URL after pinning pr.number', () => {
    withTempDir('run-task-full-send-pr-placeholder-', dir => {
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
        const prStateFile = path.join(dir, 'gh-pr-state.txt');

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
            FAKE_GH_PR_STATE_FILE: prStateFile,
            FAKE_GH_PR_CREATE_NUMBER: '303',
            FAKE_GH_PR_CREATE_URL: 'https://github.com/x/y/pull/303',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /PR: https:\/\/github\.com\/x\/y\/pull\/303/);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            phases?: { human_review?: { status?: string } };
        };
        assert.equal(updated.phases?.human_review?.status, 'done');
    });
});

void test('main full-tier mixed bundle keeps the spec gate when not every task is full-send', () => {
    withTempDir('run-task-full-send-full-mixed-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        for (const [taskId, fullSend] of [['task-a', true], ['task-b', false]] as const) {
            const status = makeCompleteStatus(taskId, 'task/task-a');
            const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
            phases.spec_review = { status: 'pending', agent: 'codex' };
            phases.plan = { status: 'pending', agent: 'claude' };
            status.task_size = 'M';
            status.full_send = fullSend;
            status.human_spec_gate = true;
            writeTaskStatus(tasksRoot, taskId, status);
            writeApprovedSpecReview(tasksRoot, taskId);
        }

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './src/orchestrator/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', 'task-b', '--step'];",
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
            FAKE_GH_PR_CREATE_NUMBER: '404',
            FAKE_GH_PR_CREATE_URL: 'https://github.com/x/y/pull/404',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /SPEC GATE — Human review required before planning\./);
        assert.match(result.stdout, /When ready: canon run task-a task-b/);

        const statusA = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            human_spec_gate?: boolean;
            phases?: { spec_review?: { status?: string }; plan?: { status?: string } };
        };
        const statusB = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-b', 'status.json'), 'utf8')) as {
            human_spec_gate?: boolean;
            phases?: { spec_review?: { status?: string }; plan?: { status?: string } };
        };
        assert.equal(statusA.human_spec_gate, false);
        assert.equal(statusB.human_spec_gate, false);
        assert.equal(statusA.phases?.spec_review?.status, 'done');
        assert.equal(statusB.phases?.spec_review?.status, 'done');
        assert.equal(statusA.phases?.plan?.status, 'pending');
        assert.equal(statusB.phases?.plan?.status, 'pending');
    });
});

void test('main full-tier all-full-send bundle skips the spec gate', () => {
    withTempDir('run-task-full-send-full-all-', dir => {
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
            phases.spec_review = { status: 'pending', agent: 'codex' };
            phases.plan = { status: 'pending', agent: 'claude' };
            status.task_size = 'M';
            status.full_send = true;
            status.human_spec_gate = true;
            writeTaskStatus(tasksRoot, taskId, status);
            writeApprovedSpecReview(tasksRoot, taskId);
        }

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './src/orchestrator/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', 'task-b', '--step'];",
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
            FAKE_GH_PR_CREATE_NUMBER: '405',
            FAKE_GH_PR_CREATE_URL: 'https://github.com/x/y/pull/405',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(result.stdout, /SPEC GATE — Human review required before planning\./);
        assert.match(result.stdout, /Next phase: plan/);

        const statusA = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            phases?: { spec_review?: { status?: string }; plan?: { status?: string } };
        };
        const statusB = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-b', 'status.json'), 'utf8')) as {
            phases?: { spec_review?: { status?: string }; plan?: { status?: string } };
        };
        assert.equal(statusA.phases?.spec_review?.status, 'done');
        assert.equal(statusB.phases?.spec_review?.status, 'done');
        assert.equal(statusA.phases?.plan?.status, 'pending');
        assert.equal(statusB.phases?.plan?.status, 'pending');
    });
});

void test('main --full-send on a delicate task without --force dies before phase routing', () => {
    withTempDir('run-task-full-send-force-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const status = makeCompleteStatus('task-a', 'task/task-a');
        status.delicate = true;
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
        });

        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /--full-send on delicate task 'task-a' requires --force/);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            full_send?: boolean;
            human_spec_gate?: boolean;
        };
        assert.equal(updated.full_send, true);
        assert.equal(updated.human_spec_gate, false);

        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.doesNotMatch(gitLog, /^push /m);
    });
});

void test('commitHumanReviewFiles dies on out-of-scope managed docs with actionable allowlist guidance', () => {
    withTempDir('run-task-human-review-managed-out-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        // Override the harness's qa.status = 'done' (which would auto-allowlist
        // DEFAULT_PROTECTED_DOCS per the QA Docs Freshness sweep): the rejection
        // path under test is for managed-doc edits that landed BEFORE qa ran.
        const taskStatus = makeCompleteStatus('task-a', 'task/task-a');
        const phases = taskStatus.phases as Record<string, { status: string }>;
        phases.qa = { ...phases.qa, status: 'in_progress' };
        phases.human_review = { ...phases.human_review, status: 'pending' };
        writeTaskStatus(harness.tasksRoot, 'task-a', taskStatus);

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M docs/codebase-map.md',
            FAKE_GIT_DIFF_OUTPUT: '',
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /allowlist/);
        assert.match(result.stderr, /admitted docs/);
        assert.match(result.stderr, /Affected Files/);
        assert.match(result.stderr, /implement phase/);
        assert.match(result.stderr, /git checkout HEAD --/);
    });
});

void test('commitHumanReviewFiles commits in-scope managed docs and emits one advisory warning', () => {
    withTempDir('run-task-human-review-managed-in-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`docs/codebase-map.md`']);

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M docs/codebase-map.md',
            FAKE_GIT_DIFF_OUTPUT: 'docs/codebase-map.md',
        });

        assert.equal(result.status, 0, result.stderr);
        const output = combinedOutput(result);
        assert.equal((output.match(/WARNING: docs\/codebase-map\.md/g) ?? []).length, 1);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(gitLog, /^add -A -- docs\/codebase-map\.md$/m);
        assert.match(gitLog, /^commit /m);
    });
});

void test('commitHumanReviewFiles auto-allowlists DEFAULT_PROTECTED_DOCS once qa.status is done', () => {
    withTempDir('run-task-human-review-qa-done-allowlist-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        // Spec lists no managed docs; harness's makeCompleteStatus already has
        // qa.status = 'done', so the auto-allowlist kicks in.
        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M docs/patterns.md',
            FAKE_GIT_DIFF_OUTPUT: 'docs/patterns.md',
        });

        assert.equal(result.status, 0, result.stderr);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(gitLog, /^add -A -- docs\/patterns\.md$/m);
        assert.match(gitLog, /^commit /m);
    });
});

void test('commitHumanReviewFiles accepts directory-form Affected Files entries in the dirty tree', () => {
    withTempDir('run-task-human-review-dirform-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`dist/`']);

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M dist/cli/index.js',
            FAKE_GIT_DIFF_OUTPUT: 'dist/cli/index.js',
        });

        assert.equal(result.status, 0, result.stderr);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        // git add -A -- dist/ stages everything dirty under the prefix.
        assert.match(gitLog, /^add -A -- dist\/$/m);
        assert.match(gitLog, /^commit /m);
    });
});

void test('directory-form staging preserves vendored node_modules contents', () => {
    withTempDir('run-task-human-review-vendored-node-modules-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`dist/`']);
        const vendoredFile = 'dist/lambda/node_modules/lodash/index.js';

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: `?? ${vendoredFile}`,
            FAKE_GIT_DIFF_OUTPUT: vendoredFile,
        });

        assert.equal(result.status, 0, result.stderr);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(gitLog, /^add -A -- dist\/$/m);
        assert.match(gitLog, /^commit /m);
    });
});

void test('directory-form staging handles C-quoted filenames and staged renames', () => {
    for (const variant of ['unicode', 'rename'] as const) {
        withTempDir(`run-task-human-review-dirform-${variant}-`, dir => {
            const taskId = `task-${variant}`;
            const { worktreesRoot, worktreeDir, branch } =
                makeNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
            const status = { ...makeHumanReviewPendingStatus(taskId, branch), worktree: true };
            writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
            writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), taskId, ['`dist/`']);
            fs.mkdirSync(path.join(worktreeDir, 'dist'), { recursive: true });
            if (variant === 'rename') {
                fs.writeFileSync(path.join(worktreeDir, 'dist/old.js'), 'old\n', 'utf8');
            }
            gitIn(worktreeDir, 'add', 'tasks', ...(variant === 'rename' ? ['dist/old.js'] : []));
            gitIn(worktreeDir, 'commit', '-m', 'qa artifacts');

            if (variant === 'unicode') {
                fs.writeFileSync(path.join(worktreeDir, 'dist/café.js'), 'export {};\n', 'utf8');
            } else {
                fs.renameSync(
                    path.join(worktreeDir, 'dist/old.js'),
                    path.join(worktreeDir, 'dist/new.js'),
                );
                gitIn(worktreeDir, 'add', '-A', 'dist');
            }
            const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
                cwd: worktreeDir,
                encoding: 'utf8',
            });
            if (variant === 'unicode') {
                assert.match(porcelain, /^\?\? "dist\/caf\\303\\251\.js"$/m);
            } else {
                assert.match(porcelain, /^R  dist\/old\.js -> dist\/new\.js$/m);
            }

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
            assert.equal(tree.includes(variant === 'unicode' ? 'dist/café.js' : 'dist/new.js'), true);
            assert.equal(tree.includes('dist/old.js'), false);
        });
    }
});

void test('commitHumanReviewFiles commits telemetry files without managed-doc advisory', () => {
    withTempDir('run-task-human-review-telemetry-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M docs/lessons-learned.md',
            FAKE_GIT_DIFF_OUTPUT: 'docs/lessons-learned.md',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(combinedOutput(result), /WARNING:/);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(gitLog, /^add -A -- docs\/lessons-learned\.md$/m);
        assert.match(gitLog, /^commit /m);
    });
});
