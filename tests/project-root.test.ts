import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { isInsideGitRepository, isTaskEntry, isValidTaskId, probeProjectRoot, resolveProjectRoot, tasksDir, templatesDir } from '../src/lib/project-root.js';
import { taskNew } from '../src/task/index.js';

function temp<T>(fn: (root: string) => T): T {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-root-'));
    try { return fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function git(cwd: string, args: string[]): void {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
}

function runCli(root: string, args: string[]) {
    const env = { ...process.env };
    for (const key of ['CANON_TASKS_DIR_OVERRIDE', 'CANON_WORKTREES_ROOT', 'CANON_SKIP_PHASE_GATE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) delete env[key];
    const workspace = process.cwd();
    return spawnSync(process.execPath, ['--import', path.join(workspace, 'node_modules/tsx/dist/loader.mjs'), path.join(workspace, 'src/cli/index.ts'), ...args], { cwd: root, env, encoding: 'utf8' });
}

function initRepo(root: string): void {
    fs.mkdirSync(root, { recursive: true });
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'init']);
    fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
    fs.mkdirSync(path.join(root, '.canon'), { recursive: true });
    fs.cpSync(path.join(process.cwd(), '.canon/templates'), path.join(root, '.canon/templates'), { recursive: true });
}

void test('resolveProjectRoot resolves main checkout root, separate git dir, linked worktree and per-call cwd', () => {
    temp(root => {
        const repo = path.join(root, 'repo');
        fs.mkdirSync(path.join(repo, 'sub'), { recursive: true });
        git(repo, ['init', '-q', '-b', 'main']);
        assert.equal(resolveProjectRoot(path.join(repo, 'sub')), fs.realpathSync(repo));

        const separate = path.join(root, 'separate');
        fs.mkdirSync(path.join(separate, 'work', 'sub'), { recursive: true });
        git(root, ['init', '-q', '-b', 'main', '--separate-git-dir', path.join(separate, 'gitdir'), path.join(separate, 'work')]);
        assert.equal(resolveProjectRoot(path.join(separate, 'work', 'sub')), fs.realpathSync(path.join(separate, 'work')));
        fs.mkdirSync(path.join(separate, 'work', 'tasks', 'sg'), { recursive: true });
        fs.copyFileSync(path.join(process.cwd(), '.canon/templates/status.json'), path.join(separate, 'work/tasks/sg/status.json'));
        const separateList = runCli(path.join(separate, 'work', 'sub'), ['task', 'list']);
        assert.equal(separateList.status, 0, separateList.stderr);
        assert.match(separateList.stdout, /\bsg\b/);

        const wt = path.join(root, 'wt');
        git(repo, ['worktree', 'add', '-q', '-b', 'task/wt', wt]);
        fs.mkdirSync(path.join(wt, 'sub'), { recursive: true });
        assert.equal(resolveProjectRoot(path.join(wt, 'sub')), fs.realpathSync(repo));
    });
    temp(a => temp(b => {
        assert.equal(resolveProjectRoot(a), path.resolve(a));
        assert.equal(resolveProjectRoot(b), path.resolve(b));
    }));
});

void test('project-root probe reports git presence and treats a failing git query as outside git', () => {
    temp(root => {
        const repo = path.join(root, 'repo');
        fs.mkdirSync(path.join(repo, 'sub'), { recursive: true });
        git(repo, ['init', '-q', '-b', 'main']);
        assert.deepEqual(probeProjectRoot(path.join(repo, 'sub')), { root: fs.realpathSync(repo), inGitRepository: true });
        assert.equal(isInsideGitRepository(path.join(repo, 'sub')), true);
        const outside = path.join(root, 'outside');
        fs.mkdirSync(outside);
        assert.deepEqual(probeProjectRoot(outside), { root: path.resolve(outside), inGitRepository: false });
        const fakeBin = path.join(root, 'fake-bin');
        fs.mkdirSync(fakeBin);
        const fakeGit = path.join(fakeBin, 'git');
        fs.writeFileSync(fakeGit, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
        const previousPath = process.env.PATH;
        try {
            process.env.PATH = fakeBin;
            assert.deepEqual(probeProjectRoot(repo), { root: path.resolve(repo), inGitRepository: false });
        } finally {
            if (previousPath === undefined) delete process.env.PATH;
            else process.env.PATH = previousPath;
        }
    });
});

void test('resolveProjectRoot follows process cwd on each call', () => {
    temp(a => temp(b => {
        git(a, ['init', '-q', '-b', 'main']);
        git(b, ['init', '-q', '-b', 'main']);
        const previous = process.cwd();
        try {
            process.chdir(a);
            assert.equal(resolveProjectRoot(), fs.realpathSync(a));
            process.chdir(b);
            assert.equal(resolveProjectRoot(), fs.realpathSync(b));
        } finally { process.chdir(previous); }
    }));
});

void test('tasks and templates dirs honor project root and task entry uses valid ids plus directories', () => {
    temp(root => {
        const tasks = path.join(root, 'tasks');
        fs.mkdirSync(path.join(tasks, 'valid-id'), { recursive: true });
        for (const name of ['_archive', '_templates', '_anything', '.DS_Store', 'Upper']) fs.mkdirSync(path.join(tasks, name));
        fs.writeFileSync(path.join(tasks, '.DS_Store-file'), 'x');
        fs.writeFileSync(path.join(tasks, 'file-id'), 'x');
        assert.equal(isTaskEntry(tasks, 'valid-id'), true);
        for (const name of ['_archive', '_templates', '_anything', '.DS_Store', 'Upper', 'missing', 'file-id']) assert.equal(isTaskEntry(tasks, name), false, name);
        fs.rmSync(path.join(tasks, '.DS_Store'), { recursive: true });
        fs.writeFileSync(path.join(tasks, '.DS_Store'), 'x');
        assert.equal(isTaskEntry(tasks, '.DS_Store'), false);
        assert.equal(isValidTaskId('a.b-c_d'), true);
        assert.equal(isValidTaskId('_x'), false);
        assert.equal(isValidTaskId('.x'), false);
        assert.equal(tasksDir(root), tasks);
        assert.equal(templatesDir(root), path.join(root, '.canon', 'templates'));
    });
});

void test('task new reports missing templates without leaving a task directory', () => {
    temp(root => {
        const previous = process.cwd();
        const oldOverride = process.env.CANON_TASKS_DIR_OVERRIDE;
        delete process.env.CANON_TASKS_DIR_OVERRIDE;
        try {
            git(root, ['init', '-q', '-b', 'main']);
            process.chdir(root);
            assert.throws(() => taskNew(['no-templates', 'No templates']), /templates directory not found/);
            assert.equal(fs.existsSync(path.join(root, 'tasks', 'no-templates')), false);
            assert.equal(fs.existsSync(path.join(root, 'tasks')), false);
        } finally {
            process.chdir(previous);
            if (oldOverride === undefined) delete process.env.CANON_TASKS_DIR_OVERRIDE;
            else process.env.CANON_TASKS_DIR_OVERRIDE = oldOverride;
        }
    });
});

void test('task list and task new from a subdirectory use repository tasks and templates', () => {
    temp(root => {
        initRepo(root);
        fs.mkdirSync(path.join(root, 'tasks', 't1'), { recursive: true });
        fs.copyFileSync(path.join(process.cwd(), '.canon/templates/status.json'), path.join(root, 'tasks/t1/status.json'));
        const listed = runCli(path.join(root, 'sub'), ['task', 'list']);
        assert.equal(listed.status, 0, listed.stderr);
        assert.match(listed.stdout, /\bt1\b/);
        const created = runCli(path.join(root, 'sub'), ['task', 'new', 'sub-made', 'Sub made']);
        assert.equal(created.status, 0, created.stderr);
        assert.ok(fs.existsSync(path.join(root, 'tasks/sub-made/spec.md')));
        assert.equal(fs.existsSync(path.join(root, 'sub/tasks')), false);
        assert.match(created.stdout, /Created task: \.\.\/tasks\/sub-made/);
        const duplicate = runCli(path.join(root, 'sub'), ['task', 'new', 'sub-made', 'Sub made']);
        assert.equal(duplicate.status, 1);
        assert.match(duplicate.stderr, /Task directory \.\.\/tasks\/sub-made already exists/);
    });
});
