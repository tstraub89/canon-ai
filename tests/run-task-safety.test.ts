import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { REPO_ROOT } from '../scripts/run-task/env.js';
import { buildHumanReviewStagePaths } from '../scripts/run-task/main.js';
import { ensureBranch, ensureCheckedOutBaseBranch } from '../scripts/run-task/git.js';
import { commitArchiveChanges } from '../scripts/run-task/main.js';
import { resolveTaskCwd } from '../scripts/run-task/state.js';

const TSX_LOADER = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');

function withTempDir(prefix: string, fn: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    try {
        fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function writeTaskStatus(tasksRoot: string, taskId: string, status: Record<string, unknown>): void {
    const taskDir = path.join(tasksRoot, taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

function setupFakeGit(scriptDir: string): void {
    const gitPath = path.join(scriptDir, 'git');
    fs.writeFileSync(gitPath, [
        '#!/bin/sh',
        'set -eu',
        'printf "%s\\n" "$*" >> "$FAKE_GIT_LOG"',
        'if [ "${1:-}" = "rev-parse" ] && [ "${2:-}" = "--abbrev-ref" ] && [ "${3:-}" = "HEAD" ]; then',
        '  cat "$FAKE_GIT_CURRENT_BRANCH"',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "show-ref" ] && [ "${2:-}" = "--verify" ] && [ "${3:-}" = "--quiet" ]; then',
        '  if [ "${4:-}" = "refs/heads/$FAKE_GIT_BASE_BRANCH" ]; then exit 0; fi',
        '  if [ "${4:-}" = "refs/heads/$FAKE_GIT_TASK_BRANCH" ]; then exit 1; fi',
        '  exit 1',
        'fi',
        'if [ "${1:-}" = "checkout" ] && [ "${2:-}" = "$FAKE_GIT_BASE_BRANCH" ]; then',
        '  printf "%s\\n" "$FAKE_GIT_BASE_BRANCH" > "$FAKE_GIT_CURRENT_BRANCH"',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "checkout" ] && [ "${2:-}" = "-b" ] && [ "${3:-}" = "$FAKE_GIT_TASK_BRANCH" ]; then',
        '  printf "%s\\n" "$FAKE_GIT_TASK_BRANCH" > "$FAKE_GIT_CURRENT_BRANCH"',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "checkout" ] && [ "${2:-}" = "$FAKE_GIT_TASK_BRANCH" ]; then',
        '  printf "%s\\n" "$FAKE_GIT_TASK_BRANCH" > "$FAKE_GIT_CURRENT_BRANCH"',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "add" ]; then',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "diff" ] && [ "${2:-}" = "--cached" ] && [ "${3:-}" = "--name-only" ]; then',
        '  if [ -n "${FAKE_GIT_DIFF_OUTPUT:-}" ]; then printf "%s\\n" "$FAKE_GIT_DIFF_OUTPUT"; fi',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "commit" ]; then',
        '  if [ "${FAKE_GIT_FAIL_COMMIT:-}" = "1" ]; then',
        '    printf "%s\\n" "commit failed" >&2',
        '    exit 1',
        '  fi',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "push" ] && [ "${2:-}" = "origin" ] && [ "${3:-}" = "$FAKE_GIT_BASE_BRANCH" ]; then',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "worktree" ] && [ "${2:-}" = "list" ] && [ "${3:-}" = "--porcelain" ]; then',
        '  if [ -n "${FAKE_GIT_WORKTREE_LIST_FILE:-}" ] && [ -f "$FAKE_GIT_WORKTREE_LIST_FILE" ]; then',
        '    cat "$FAKE_GIT_WORKTREE_LIST_FILE"',
        '  fi',
        '  exit 0',
        'fi',
        'printf "%s\\n" "unexpected git args: $*" >&2',
        'exit 1',
        '',
    ].join('\n'), { mode: 0o755 });
}

function withFakeGitEnv<T>(
    vars: Record<string, string>,
    fn: (env: NodeJS.ProcessEnv) => T,
): T {
    const original = { ...process.env };
    try {
        for (const [key, value] of Object.entries(vars)) {
            process.env[key] = value;
        }
        return fn(process.env);
    } finally {
        for (const key of Object.keys(process.env)) {
            if (!(key in original)) {
                delete process.env[key];
            }
        }
        for (const [key, value] of Object.entries(original)) {
            process.env[key] = value;
        }
    }
}

function runNodeInline(
    script: string,
    env: NodeJS.ProcessEnv,
    cwd = process.cwd(),
): { status: number | null; stderr: string; stdout: string } {
    const result = spawnSync(process.execPath, ['--import', TSX_LOADER, '-e', script], {
        cwd,
        env,
        encoding: 'utf8',
    });
    return {
        status: result.status,
        stderr: result.stderr ?? '',
        stdout: result.stdout ?? '',
    };
}

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
            const result = commitArchiveChanges(['example'], 'main', ['tasks/example']);
            assert.deepEqual(result, { committed: false, stderr: 'commit failed' });
        });

        const log = fs.readFileSync(logPath, 'utf8');
        assert.match(log, /add -A -- tasks\/example/);
        assert.match(log, /diff --cached --name-only/);
        assert.match(log, /commit -m chore: archive example/);
        assert.doesNotMatch(log, /push origin main/);
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
            "import { resolveTaskCwd } from './scripts/run-task/state.js';",
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
            "import { getActiveCwd } from './scripts/run-task/worktree.js';",
            `console.log(getActiveCwd(${JSON.stringify([taskId])}));`,
        ].join('\n'), env));

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Worktree for task 'bundle-task' is expected but missing/);
    });
});

void test('REPO_ROOT stays anchored to the supervising checkout when imported from a linked worktree', () => {
    withTempDir('run-task-root-regression-', dir => {
        const worktreeDir = path.join(dir, 'linked-worktree');
        const addResult = spawnSync('git', ['worktree', 'add', '--detach', worktreeDir, 'HEAD'], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
        });
        assert.equal(addResult.status, 0, addResult.stderr ?? addResult.stdout ?? 'git worktree add failed');

        try {
            const result = runNodeInline([
                `import(${JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'scripts/run-task/env.ts')).href)})`,
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

void test('buildHumanReviewStagePaths includes protected docs in the human_review commit set', () => {
    const paths = buildHumanReviewStagePaths(['task-a'], [
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
            raw: ' M docs/product-context.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['docs/product-context.md'],
        },
    ]);

    assert.deepEqual(paths, [
        'tasks/task-a',
        'docs/architecture.md',
        'docs/codebase-map.md',
        'docs/decisions.md',
        'docs/patterns.md',
        'docs/product-context.md',
    ]);
});

void test('syncWorktreeTelemetry skips shared-doc mirroring when repo checkout has diverged', () => {
    withTempDir('run-task-sync-regression-', dir => {
        const repoDir = path.join(dir, 'repo');
        const worktreesRoot = path.join(dir, 'dev-worktrees');
        const worktreeDir = path.join(worktreesRoot, 'task-a');
        fs.mkdirSync(repoDir, { recursive: true });
        fs.mkdirSync(worktreesRoot, { recursive: true });

        const runGit = (args: string[], cwd = repoDir): string => {
            const result = spawnSync('git', args, {
                cwd,
                encoding: 'utf8',
            });
            assert.equal(result.status, 0, result.stderr ?? result.stdout ?? `git ${args.join(' ')} failed`);
            return result.stdout.trim();
        };

        runGit(['init', '-b', 'main']);
        runGit(['config', 'user.email', 'canon@example.com']);
        runGit(['config', 'user.name', 'Canon Bot']);
        fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'docs', 'architecture.md'), 'repo v1\n', 'utf8');
        runGit(['add', 'docs/architecture.md']);
        runGit(['commit', '-m', 'initial']);

        runGit(['worktree', 'add', '-b', 'task/task-a', worktreeDir, 'HEAD']);
        fs.writeFileSync(path.join(worktreeDir, 'docs', 'architecture.md'), 'worktree v2\n', 'utf8');

        fs.writeFileSync(path.join(repoDir, 'docs', 'architecture.md'), 'repo v2\n', 'utf8');
        runGit(['add', 'docs/architecture.md']);
        runGit(['commit', '-m', 'repo diverges']);

        try {
            const syncScript = [
                `import(${JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'scripts/run-task/worktree.ts')).href)})`,
                '.then(m => { m.syncWorktreeTelemetry([\'task-a\']); })',
                '.catch(err => { console.error(err); process.exit(1); });',
            ].join('');
            const result = runNodeInline(syncScript, {
                ...process.env,
                CANON_WORKTREES_ROOT: worktreesRoot,
            }, repoDir);

            assert.equal(result.status, 0, result.stderr);
            assert.match(result.stderr, /Skipping shared-doc sync for task-a/);
            assert.equal(fs.readFileSync(path.join(repoDir, 'docs', 'architecture.md'), 'utf8'), 'repo v2\n');
            assert.equal(fs.readFileSync(path.join(worktreeDir, 'docs', 'architecture.md'), 'utf8'), 'worktree v2\n');
        } finally {
            spawnSync('git', ['worktree', 'remove', '--force', worktreeDir], {
                cwd: repoDir,
                encoding: 'utf8',
            });
        }
    });
});

void test('syncWorktreeTelemetry copies shared docs even when the new content is the same length', () => {
    withTempDir('run-task-sync-same-length-', dir => {
        const repoDir = path.join(dir, 'repo');
        const worktreesRoot = path.join(dir, 'dev-worktrees');
        const worktreeDir = path.join(worktreesRoot, 'task-a');
        fs.mkdirSync(repoDir, { recursive: true });
        fs.mkdirSync(worktreesRoot, { recursive: true });

        const runGit = (args: string[], cwd = repoDir): string => {
            const result = spawnSync('git', args, {
                cwd,
                encoding: 'utf8',
            });
            assert.equal(result.status, 0, result.stderr ?? result.stdout ?? `git ${args.join(' ')} failed`);
            return result.stdout.trim();
        };

        runGit(['init', '-b', 'main']);
        runGit(['config', 'user.email', 'canon@example.com']);
        runGit(['config', 'user.name', 'Canon Bot']);
        fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'docs', 'architecture.md'), 'alpha beta\n', 'utf8');
        runGit(['add', 'docs/architecture.md']);
        runGit(['commit', '-m', 'initial']);

        runGit(['worktree', 'add', '-b', 'task/task-a', worktreeDir, 'HEAD']);
        fs.writeFileSync(path.join(worktreeDir, 'docs', 'architecture.md'), 'omega zeta\n', 'utf8');

        try {
            const syncScript = [
                `import(${JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'scripts/run-task/worktree.ts')).href)})`,
                '.then(m => { m.syncWorktreeTelemetry([\'task-a\']); })',
                '.catch(err => { console.error(err); process.exit(1); });',
            ].join('');
            const result = runNodeInline(syncScript, {
                ...process.env,
                CANON_WORKTREES_ROOT: worktreesRoot,
            }, repoDir);

            assert.equal(result.status, 0, result.stderr);
            assert.equal(fs.readFileSync(path.join(repoDir, 'docs', 'architecture.md'), 'utf8'), 'omega zeta\n');
            assert.equal(fs.readFileSync(path.join(worktreeDir, 'docs', 'architecture.md'), 'utf8'), 'alpha beta\n');
        } finally {
            spawnSync('git', ['worktree', 'remove', '--force', worktreeDir], {
                cwd: repoDir,
                encoding: 'utf8',
            });
        }
    });
});
