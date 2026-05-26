import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

const WORKTREE_ROOT = process.cwd();
const TSX_LOADER = path.join(WORKTREE_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');
const MAIN_URL = pathToFileURL(path.join(WORKTREE_ROOT, 'scripts', 'run-task', 'main.ts')).href;
const MD_LOADER = path.join(WORKTREE_ROOT, 'tests', 'md-loader-register.mjs');

function withTempDir<T>(prefix: string, fn: (dir: string) => T): T {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    try {
        return fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function writeTaskStatus(tasksRoot: string, taskId: string, status: Record<string, unknown>): void {
    const taskDir = path.join(tasksRoot, taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

function initGitRepo(dir: string): void {
    execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir });
}

function worktreeTasksRoot(worktreesRoot: string, taskId: string): string {
    return path.join(worktreesRoot, taskId, 'tasks');
}

function makeRerouteStatus(taskId: string, branch: string, rerouteCount = 0): Record<string, unknown> {
    return {
        id: taskId,
        title: taskId,
        branch,
        base_branch: 'main',
        full_send: false,
        worktree: true,
        phases: {
            spec: { status: 'done', agent: 'claude' },
            spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
            plan: { status: 'done', agent: 'claude' },
            implement: { status: 'done', agent: 'codex', reroute_count: rerouteCount },
            code_review: { status: 'done', agent: 'claude', verdict: 'approved' },
            qa: { status: 'done', agent: 'claude' },
            human_review: { status: 'pending', agent: 'human' },
        },
    };
}

function writeSpec(root: string, taskId: string, content: string): void {
    const specPath = path.join(root, 'tasks', taskId, 'spec.md');
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.writeFileSync(specPath, content, 'utf8');
}

function runReroute(
    cwd: string,
    taskIds: readonly string[],
    force: boolean,
): { status: number | null; stdout: string; stderr: string } {
    const telemetryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reroute-preflight-metrics-'));
    const telemetryFile = path.join(telemetryDir, 'pipeline-invocations.md');
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        CANON_WORKTREES_ROOT: path.join(cwd, 'worktrees'),
        CANON_METRICS_FILE_OVERRIDE: telemetryFile,
    };
    delete env.CANON_TASKS_DIR_OVERRIDE;
    const result = spawnSync(process.execPath, [
        '--import',
        MD_LOADER,
        '--import',
        TSX_LOADER,
        '-e',
        [
            `import { rerouteFromHumanReview, setCliArgsForTest } from ${JSON.stringify(MAIN_URL)};`,
            `setCliArgsForTest({ force: ${force ? 'true' : 'false'} });`,
            `rerouteFromHumanReview(${JSON.stringify([...taskIds])});`,
        ].join('\n'),
    ], {
        cwd,
        encoding: 'utf8',
        env,
    });
    fs.rmSync(telemetryDir, { recursive: true, force: true });
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

function readStatus(tasksRoot: string, taskId: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as Record<string, unknown>;
}

void test('rerouteFromHumanReview reads worktree spec.md when a task worktree exists', () => {
    withTempDir('reroute-preflight-worktree-source-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const taskId = 'task-a';
        const status = makeRerouteStatus(taskId, 'task/task-a');
        writeTaskStatus(tasksRoot, taskId, status);
        writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, status);
        // REPO_ROOT still has the pre-implement scaffold.
        writeSpec(dir, taskId, [
            '# Spec',
            '',
            '## Overview',
            '',
            'No amendment heading here.',
            '',
        ].join('\n'));
        // The worktree copy is canonical past implement and carries the amendment.
        writeSpec(path.join(worktreesRoot, taskId), taskId, [
            '# Spec',
            '',
            '## Amendment',
            '',
            'Worktree amendment that should satisfy the gate.',
            '',
        ].join('\n'));

        const rootBefore = fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8');
        const result = runReroute(dir, [taskId], false);

        assert.equal(result.status, 0, `expected reroute to succeed; stderr was:\n${result.stderr}`);
        assert.equal(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8'), rootBefore);
        const updated = readStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId) as {
            phases?: { implement?: { status?: string; rerouted?: boolean; reroute_count?: number } };
        };
        assert.equal(updated.phases?.implement?.status, 'pending');
        assert.equal(updated.phases?.implement?.rerouted, true);
        assert.equal(updated.phases?.implement?.reroute_count, 1);
    });
});

void test('rerouteFromHumanReview rejects stale worktree spec even if REPO_ROOT spec is amended', () => {
    withTempDir('reroute-preflight-worktree-required-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const taskId = 'task-a';
        const status = makeRerouteStatus(taskId, 'task/task-a');
        writeTaskStatus(tasksRoot, taskId, status);
        writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, status);
        // REPO_ROOT has the amendment, but it is no longer the live source once the worktree exists.
        writeSpec(dir, taskId, [
            '# Spec',
            '',
            '## Amendment',
            '',
            'Operator amended the wrong copy.',
            '',
        ].join('\n'));
        writeSpec(path.join(worktreesRoot, taskId), taskId, [
            '# Spec',
            '',
            '## Overview',
            '',
            'Worktree copy is stale and should block reroute.',
            '',
        ].join('\n'));

        const rootBefore = fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8');
        const worktreeBefore = fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, taskId), taskId, 'status.json'), 'utf8');
        const result = runReroute(dir, [taskId], false);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /spec\.md amendment required before reroute/);
        assert.match(result.stderr, /worktrees\/task-a\/tasks\/task-a\/spec\.md/);
        assert.equal(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8'), rootBefore);
        assert.equal(fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, taskId), taskId, 'status.json'), 'utf8'), worktreeBefore);
    });
});

void test('rerouteFromHumanReview with --force proceeds and records reroute metadata', () => {
    withTempDir('reroute-preflight-force-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const taskId = 'task-a';
        const status = makeRerouteStatus(taskId, 'task/task-a');
        writeTaskStatus(tasksRoot, taskId, status);
        writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, status);
        // Worktree spec lacks the amendment; --force bypasses.
        writeSpec(dir, taskId, [
            '# Spec',
            '',
            '## Overview',
            '',
            'This amendment is intentionally omitted.',
            '',
        ].join('\n'));
        writeSpec(path.join(worktreesRoot, taskId), taskId, [
            '# Spec',
            '',
            '## Overview',
            '',
            'This amendment is intentionally omitted.',
            '',
        ].join('\n'));

        const rootBefore = fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8');
        const result = runReroute(dir, [taskId], true);

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /--force bypass: task-a spec\.md missing required ## Amendment heading for round 1/);
        assert.equal(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8'), rootBefore);
        const updated = readStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId) as {
            phases?: { implement?: { status?: string; rerouted?: boolean; reroute_count?: number } };
        };
        assert.equal(updated.phases?.implement?.status, 'pending');
        assert.equal(updated.phases?.implement?.rerouted, true);
        assert.equal(updated.phases?.implement?.reroute_count, 1);
    });
});

void test('rerouteFromHumanReview reports every failing task in a bundle', () => {
    withTempDir('reroute-preflight-bundle-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const taskIds = ['task-a', 'task-b', 'task-c'];
        for (const taskId of taskIds) {
            const status = makeRerouteStatus(taskId, `task/${taskId}`);
            writeTaskStatus(tasksRoot, taskId, status);
            writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, status);
            // Each worktree spec lacks the amendment; pre-flight reads the active worktree.
            writeSpec(path.join(worktreesRoot, taskId), taskId, [
                '# Spec',
                '',
                '## Overview',
                '',
                `Task ${taskId} forgot to amend spec.md.`,
                '',
            ].join('\n'));
        }

        const before = taskIds.map(taskId => fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, taskId), taskId, 'status.json'), 'utf8'));
        const result = runReroute(dir, taskIds, false);

        assert.notEqual(result.status, 0);
        for (const taskId of taskIds) {
            assert.match(result.stderr, new RegExp(taskId));
            assert.match(result.stderr, new RegExp(`tasks/${taskId}/spec\\.md`));
        }
        assert.match(result.stderr, /Bypass with --force if you have verified the lack of amendment is intentional\./);
        taskIds.forEach((taskId, index) => {
            assert.equal(fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, taskId), taskId, 'status.json'), 'utf8'), before[index]);
        });
    });
});

void test('rerouteFromHumanReview enforces the round-2 heading and accepts the strict round-2 form after amendment', () => {
    withTempDir('reroute-preflight-round-two-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const taskId = 'task-a';
        const status = makeRerouteStatus(taskId, 'task/task-a', 1);
        writeTaskStatus(tasksRoot, taskId, status);
        writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, status);
        // Worktree spec only has the round-1 form; pre-flight requires Round 2.
        writeSpec(path.join(worktreesRoot, taskId), taskId, [
            '# Spec',
            '',
            '## Amendment',
            '',
            'Round 1 amendment only.',
            '',
        ].join('\n'));

        const first = runReroute(dir, [taskId], false);
        assert.notEqual(first.status, 0);
        assert.match(first.stderr, /expected heading: ## Amendment Round 2/);
        assert.match(first.stderr, /found `## Amendment`/);

        // Operator updates the worktree spec to the strict round-2 form; gate clears.
        writeSpec(path.join(worktreesRoot, taskId), taskId, [
            '# Spec',
            '',
            '## Amendment Round 2',
            '',
            'Round 2 amendment now present.',
            '',
        ].join('\n'));

        const second = runReroute(dir, [taskId], false);
        assert.equal(second.status, 0, second.stderr);
        const updated = readStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId) as {
            phases?: { implement?: { status?: string; rerouted?: boolean; reroute_count?: number } };
        };
        assert.equal(updated.phases?.implement?.status, 'pending');
        assert.equal(updated.phases?.implement?.rerouted, true);
        assert.equal(updated.phases?.implement?.reroute_count, 2);
    });
});
