import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { taskList, taskNew, taskPhase, taskPostMergeSync, taskReleaseInit, taskResetSpecReview, taskStatus } from '../src/task/index.js';
import type { StatusJson } from '../scripts/run-task/types.js';

const WORKSPACE_ROOT = process.cwd();
const TSX_LOADER = path.join(WORKSPACE_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');

function withTempDir<T>(prefix: string, fn: (dir: string) => T): T {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    try {
        return fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function withCwd<T>(cwd: string, fn: () => T): T {
    const previous = process.cwd();
    process.chdir(cwd);
    try {
        return fn();
    } finally {
        process.chdir(previous);
    }
}

function withEnv<T>(updates: Record<string, string | undefined>, fn: () => T): T {
    const previous = new Map<string, string | undefined>();
    for (const key of Object.keys(updates)) {
        previous.set(key, process.env[key]);
        const value = updates[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    try {
        return fn();
    } finally {
        for (const [key, value] of previous) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

function captureStdout(fn: () => void): string {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
        fn();
    } finally {
        console.log = original;
    }
    return `${lines.join('\n')}\n`;
}

function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeStatus(taskId: string, overrides: Partial<StatusJson> = {}): StatusJson {
    return {
        id: taskId,
        title: `Task ${taskId}`,
        status: 'spec',
        created: '2026-05-16',
        updated: '2026-05-16',
        branch: '',
        base_branch: 'main',
        task_size: 'S',
        delicate: false,
        human_spec_gate: false,
        worktree: false,
        phases: {
            spec: { status: 'pending', agent: 'claude' },
            spec_review: {
                status: 'pending',
                agent: 'codex',
                verdict: '',
                iterations: 0,
                iterations_current_loop: 0,
                iterations_total: 0,
                changes_requested_total: 0,
                auto_block_count: 0,
            },
            plan: { status: 'pending', agent: 'claude' },
            implement: { status: 'pending', agent: 'codex' },
            code_review: {
                status: 'pending',
                agent: 'claude',
                verdict: '',
                iterations: 0,
                iterations_current_loop: 0,
                iterations_total: 0,
                changes_requested_total: 0,
                auto_block_count: 0,
            },
            qa: { status: 'pending', agent: 'claude' },
            human_review: { status: 'pending', agent: 'human' },
        },
        escalations: [],
        sessions: {},
        ...overrides,
    };
}

function writeTask(tasksRoot: string, taskId: string, status: StatusJson = makeStatus(taskId)): string {
    const taskDir = path.join(tasksRoot, taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(taskDir, 'spec-review.md'), '# Review\n', 'utf8');
    return taskDir;
}

function readStatusFile(taskDir: string): StatusJson {
    return JSON.parse(fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8')) as StatusJson;
}

type PackageJsonFixture = { version: string };
type PackageLockFixture = { version: string; packages: { '': { version: string } } };

function withTasksRoot<T>(fn: (root: string) => T): T {
    return withTempDir('task-cli-', root => {
        const tasksRoot = path.join(root, 'tasks');
        fs.mkdirSync(tasksRoot, { recursive: true });
        return withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => fn(tasksRoot));
    });
}

void test('task new creates a task from templates and rejects existing tasks', () => {
    withTempDir('task-new-', root => {
        fs.mkdirSync(path.join(root, '.canon'), { recursive: true });
        fs.cpSync(path.join(WORKSPACE_ROOT, '.canon', 'templates'), path.join(root, '.canon', 'templates'), { recursive: true });

        withCwd(root, () => {
            captureStdout(() => taskNew(['new-task', 'New Task', '--base', 'dev']));
            const taskDir = path.join(root, 'tasks', 'new-task');
            const status = readStatusFile(taskDir);
            assert.equal(status.id, 'new-task');
            assert.equal(status.title, 'New Task');
            assert.equal(status.base_branch, 'dev');
            assert.ok(fs.existsSync(path.join(taskDir, 'spec.md')));

            assert.throws(() => taskNew(['new-task', 'Again']), /Task directory tasks\/new-task already exists/);
        });
    });
});

void test('task new rejects invalid task IDs', () => {
    withTempDir('task-new-invalid-', root => {
        fs.mkdirSync(path.join(root, '.canon'), { recursive: true });
        fs.cpSync(path.join(WORKSPACE_ROOT, '.canon', 'templates'), path.join(root, '.canon', 'templates'), { recursive: true });
        withCwd(root, () => {
            assert.throws(() => taskNew(['Bad Task', 'Title']), /invalid task ID/);
        });
    });
});

void test('task list prints rows and handles an empty task directory', () => {
    withTasksRoot(tasksRoot => {
        assert.equal(captureStdout(() => taskList()), 'No tasks found.\n');
        writeTask(tasksRoot, 'alpha-task', makeStatus('alpha-task', { title: 'Alpha' }));
        writeTask(tasksRoot, 'beta-task', makeStatus('beta-task', {
            title: 'Beta',
            phases: {
                ...makeStatus('beta-task').phases,
                spec: { status: 'done', agent: 'claude' },
            },
        }));

        const output = captureStdout(() => taskList());
        assert.match(output, /TASK\s+TITLE\s+CURRENT PHASE/);
        assert.match(output, /alpha-task\s+Alpha\s+spec/);
        assert.match(output, /beta-task\s+Beta\s+spec_review/);
    });
});

void test('task status prints formatted JSON and errors for missing tasks', () => {
    withTasksRoot(tasksRoot => {
        writeTask(tasksRoot, 'status-task');
        const output = captureStdout(() => taskStatus('status-task'));
        assert.match(output, /"id": "status-task"/);
        assert.throws(() => taskStatus('missing-task'), /No status\.json found/);
    });
});

void test('task phase updates phase state and derives top-level status', () => {
    withTasksRoot(tasksRoot => {
        const taskDir = writeTask(tasksRoot, 'phase-task');
        captureStdout(() => taskPhase('phase-task', 'spec', 'done'));
        const updated = readStatusFile(taskDir);
        assert.equal(updated.phases.spec?.status, 'done');
        assert.equal(updated.status, 'spec_review');
    });
});

void test('task phase rejects invalid phase and out-of-order transitions', () => {
    withTasksRoot(tasksRoot => {
        writeTask(tasksRoot, 'phase-errors');
        assert.throws(() => taskPhase('phase-errors', 'bogus', 'done'), /invalid phase/);
        assert.throws(
            () => taskPhase('phase-errors', 'plan', 'done'),
            /prior phases not done: spec,spec_review/,
        );
    });
});

void test('task reset-spec-review archives prior review and resets loop-local fields', () => {
    withTasksRoot(tasksRoot => {
        const taskDir = writeTask(tasksRoot, 'reset-task', makeStatus('reset-task', {
            phases: {
                ...makeStatus('reset-task').phases,
                spec_review: {
                    status: 'blocked',
                    agent: 'codex',
                    verdict: 'changes_requested',
                    iterations: 2,
                    iterations_current_loop: 2,
                    iterations_total: 5,
                    changes_requested_total: 3,
                    auto_block_count: 1,
                },
            },
            sessions: { claude_spec: 'old-session' },
        }));

        captureStdout(() => taskResetSpecReview('reset-task'));
        const updated = readStatusFile(taskDir);
        assert.equal(updated.phases.spec?.status, 'done');
        assert.equal(updated.phases.spec_review?.status, 'pending');
        assert.equal(updated.phases.spec_review?.iterations, 0);
        assert.equal(updated.phases.spec_review?.iterations_current_loop, 0);
        assert.equal(updated.phases.spec_review?.iterations_total, 5);
        assert.equal(updated.sessions?.claude_spec, undefined);
        assert.equal(fs.existsSync(path.join(taskDir, 'spec-review-prior-1.md')), true);
        assert.throws(() => taskResetSpecReview('missing-reset'), /no status\.json/);
    });
});

void test('task post-merge-sync rejects a dirty working tree', () => {
    withTempDir('post-merge-sync-', root => {
        git(root, ['init', '-b', 'main']);
        fs.writeFileSync(path.join(root, 'dirty.txt'), 'dirty\n', 'utf8');
        withCwd(root, () => {
            assert.throws(() => taskPostMergeSync(), /working tree is dirty/);
        });
    });
});

function setupReleaseRepo(): { root: string; work: string; origin: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-init-'));
    const origin = path.join(root, 'origin.git');
    const work = path.join(root, 'work');
    git(root, ['init', '--bare', origin]);
    git(root, ['init', '-b', 'main', work]);
    git(work, ['config', 'user.email', 'test@example.com']);
    git(work, ['config', 'user.name', 'Test User']);
    fs.writeFileSync(path.join(work, 'package.json'), `${JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(work, 'package-lock.json'), `${JSON.stringify({ name: 'fixture', version: '1.0.0', packages: { '': { version: '1.0.0' } } }, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(work, 'CHANGELOG.md'), '# Changelog\n', 'utf8');
    git(work, ['add', 'package.json', 'package-lock.json', 'CHANGELOG.md']);
    git(work, ['commit', '-m', 'init']);
    git(work, ['remote', 'add', 'origin', origin]);
    git(work, ['push', '-u', 'origin', 'main']);
    return { root, work, origin };
}

void test('task release-init creates release branch, bumps files, commits, and uses injectable push', () => {
    const { root, work } = setupReleaseRepo();
    try {
        const pushed: string[] = [];
        withCwd(work, () => {
            captureStdout(() => taskReleaseInit('1.6.0', { pushFn: branch => { pushed.push(branch); } }));
            assert.equal(git(work, ['branch', '--show-current']), 'release/v1.6');
        });

        assert.deepEqual(pushed, ['release/v1.6']);
        const pkg = JSON.parse(fs.readFileSync(path.join(work, 'package.json'), 'utf8')) as PackageJsonFixture;
        const lock = JSON.parse(fs.readFileSync(path.join(work, 'package-lock.json'), 'utf8')) as PackageLockFixture;
        assert.equal(pkg.version, '1.6.0');
        assert.equal(lock.packages[''].version, '1.6.0');
        assert.match(fs.readFileSync(path.join(work, 'CHANGELOG.md'), 'utf8'), /## v1\.6 - unreleased/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function runTaskCmd(cwd: string, args: string[], env: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
    const code = [
        `import(${JSON.stringify(path.join(WORKSPACE_ROOT, 'src/task/index.ts'))})`,
        `.then(m => m.taskCmd(${JSON.stringify(args)}))`,
        `.catch(err => { console.error(err instanceof Error ? err.message : String(err)); process.exit(1); });`,
    ].join('');
    const result = spawnSync(process.execPath, ['--import', TSX_LOADER, '-e', code], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, ...env },
    });
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

void test('task release-init exits non-zero with exact local-branch guard message', () => {
    const { root, work } = setupReleaseRepo();
    try {
        git(work, ['branch', 'release/v1.6']);
        const result = runTaskCmd(work, ['release-init', '1.6.0']);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Error: branch 'release\/v1\.6' already exists locally\./);
        assert.doesNotMatch(result.stdout, /initialized and pushed/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('task phase routes to the task worktree status.json', () => {
    withTempDir('task-worktree-routing-', root => {
        const repo = path.join(root, 'repo');
        const worktreesRoot = path.join(root, 'worktrees');
        const worktree = path.join(worktreesRoot, 'worktree-route');
        fs.mkdirSync(worktreesRoot, { recursive: true });
        git(root, ['init', '-b', 'main', repo]);
        git(repo, ['config', 'user.email', 'test@example.com']);
        git(repo, ['config', 'user.name', 'Test User']);
        fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n', 'utf8');
        git(repo, ['add', 'README.md']);
        git(repo, ['commit', '-m', 'init']);
        git(repo, ['worktree', 'add', '-b', 'task/worktree-route', worktree, 'main']);

        const mainTaskDir = path.join(repo, 'tasks', 'worktree-route');
        const worktreeTaskDir = path.join(worktree, 'tasks', 'worktree-route');
        fs.mkdirSync(mainTaskDir, { recursive: true });
        fs.mkdirSync(worktreeTaskDir, { recursive: true });
        fs.writeFileSync(path.join(mainTaskDir, 'status.json'), `${JSON.stringify(makeStatus('worktree-route', {
            branch: 'task/worktree-route',
            worktree: true,
        }), null, 2)}\n`, 'utf8');
        fs.writeFileSync(path.join(worktreeTaskDir, 'status.json'), `${JSON.stringify(makeStatus('worktree-route', {
            branch: 'task/worktree-route',
            worktree: true,
        }), null, 2)}\n`, 'utf8');

        const result = runTaskCmd(repo, ['phase', 'worktree-route', 'spec', 'done'], {
            CANON_WORKTREES_ROOT: worktreesRoot,
            CANON_SKIP_PHASE_GATE: '1',
        });
        assert.equal(result.status, 0, result.stderr);

        const mainStatus = readStatusFile(mainTaskDir);
        const worktreeStatus = readStatusFile(worktreeTaskDir);
        assert.equal(mainStatus.phases.spec?.status, 'pending');
        assert.equal(worktreeStatus.phases.spec?.status, 'done');
        assert.equal(worktreeStatus.status, 'spec_review');
    });
});

void test('bundled orchestrator help is invocable once from dist', () => {
    const runTaskBundle = path.join(WORKSPACE_ROOT, 'dist', 'scripts', 'run-task.js');
    assert.equal(fs.existsSync(runTaskBundle), true, 'run npm run build before npm test so dist/scripts/run-task.js exists');
    const result = spawnSync(process.execPath, [runTaskBundle, '--help'], {
        cwd: WORKSPACE_ROOT,
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: canon run/);
});
