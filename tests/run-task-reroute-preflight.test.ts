import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
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
        env: {
            ...process.env,
            CANON_TASKS_DIR_OVERRIDE: path.join(cwd, 'tasks'),
            CANON_WORKTREES_ROOT: path.join(cwd, 'worktrees'),
            CANON_METRICS_FILE_OVERRIDE: telemetryFile,
        },
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

void test('rerouteFromHumanReview reads main-repo spec.md, ignoring worktree contents (P2 regression: pre-flight previously used resolveTaskCwd → worktree path, which false-aborted a correctly-amended main-repo spec)', () => {
    withTempDir('reroute-preflight-main-repo-source-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const taskId = 'task-a';
        const status = makeRerouteStatus(taskId, 'task/task-a');
        writeTaskStatus(tasksRoot, taskId, status);
        writeTaskStatus(path.join(worktreesRoot, taskId, 'tasks'), taskId, status);
        // Main-repo spec is what the operator amends (per docs). Pre-flight MUST read this.
        writeSpec(dir, taskId, [
            '# Spec',
            '',
            '## Overview',
            '',
            'No amendment heading here.',
            '',
        ].join('\n'));
        // Worktree spec has the amendment — irrelevant to the pre-flight after the P2 fix.
        // (Pre-fix, the gate read this path and let the reroute proceed; post-fix it ignores it.)
        writeSpec(path.join(worktreesRoot, taskId), taskId, [
            '# Spec',
            '',
            '## Amendment',
            '',
            'Worktree amendment that should not satisfy the gate.',
            '',
        ].join('\n'));

        const before = fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8');
        const result = runReroute(dir, [taskId], false);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /spec\.md amendment required before reroute/);
        assert.match(result.stderr, /task-a/);
        assert.match(result.stderr, /expected heading: ## Amendment/);
        // The reported spec path is the main-repo path (tasks/...), not the worktree path.
        assert.match(result.stderr, /tasks\/task-a\/spec\.md/);
        assert.doesNotMatch(result.stderr, /worktrees\/task-a/);
        assert.equal(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8'), before);
    });
});

void test('rerouteFromHumanReview accepts a correctly-amended main-repo spec on a worktree-mode task', () => {
    withTempDir('reroute-preflight-main-repo-pass-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const taskId = 'task-a';
        const status = makeRerouteStatus(taskId, 'task/task-a');
        writeTaskStatus(tasksRoot, taskId, status);
        writeTaskStatus(path.join(worktreesRoot, taskId, 'tasks'), taskId, status);
        // Main-repo has the amendment. Worktree is stale (sync hasn't run yet at pre-flight time).
        writeSpec(dir, taskId, [
            '# Spec',
            '',
            '## Amendment',
            '',
            'Operator amended the main-repo spec; canon will sync this into the worktree at implement-start.',
            '',
        ].join('\n'));
        writeSpec(path.join(worktreesRoot, taskId), taskId, [
            '# Spec',
            '',
            '## Overview',
            '',
            'Worktree copy is stale — sync runs at implement-start.',
            '',
        ].join('\n'));

        const result = runReroute(dir, [taskId], false);

        assert.equal(result.status, 0, `expected reroute to succeed; stderr was:\n${result.stderr}`);
        const updated = readStatus(tasksRoot, taskId) as {
            phases?: { implement?: { status?: string; rerouted?: boolean; reroute_count?: number } };
        };
        assert.equal(updated.phases?.implement?.status, 'pending');
        assert.equal(updated.phases?.implement?.rerouted, true);
        assert.equal(updated.phases?.implement?.reroute_count, 1);
    });
});

void test('rerouteFromHumanReview with --force proceeds and records reroute metadata', () => {
    withTempDir('reroute-preflight-force-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const taskId = 'task-a';
        const status = makeRerouteStatus(taskId, 'task/task-a');
        writeTaskStatus(tasksRoot, taskId, status);
        writeTaskStatus(path.join(worktreesRoot, taskId, 'tasks'), taskId, status);
        // Main-repo spec lacks the amendment; --force bypasses.
        writeSpec(dir, taskId, [
            '# Spec',
            '',
            '## Overview',
            '',
            'This amendment is intentionally omitted.',
            '',
        ].join('\n'));

        const result = runReroute(dir, [taskId], true);

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /--force bypass: task-a spec\.md missing required ## Amendment heading for round 1/);
        const updated = readStatus(tasksRoot, taskId) as {
            phases?: { implement?: { status?: string; rerouted?: boolean; reroute_count?: number } };
        };
        assert.equal(updated.phases?.implement?.status, 'pending');
        assert.equal(updated.phases?.implement?.rerouted, true);
        assert.equal(updated.phases?.implement?.reroute_count, 1);
    });
});

void test('rerouteFromHumanReview reports every failing task in a bundle', () => {
    withTempDir('reroute-preflight-bundle-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const taskIds = ['task-a', 'task-b', 'task-c'];
        for (const taskId of taskIds) {
            const status = makeRerouteStatus(taskId, `task/${taskId}`);
            writeTaskStatus(tasksRoot, taskId, status);
            writeTaskStatus(path.join(worktreesRoot, taskId, 'tasks'), taskId, status);
            // Each main-repo spec lacks the amendment; pre-flight reads main-repo.
            writeSpec(dir, taskId, [
                '# Spec',
                '',
                '## Overview',
                '',
                `Task ${taskId} forgot to amend spec.md.`,
                '',
            ].join('\n'));
        }

        const before = taskIds.map(taskId => fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8'));
        const result = runReroute(dir, taskIds, false);

        assert.notEqual(result.status, 0);
        for (const taskId of taskIds) {
            assert.match(result.stderr, new RegExp(taskId));
            assert.match(result.stderr, new RegExp(`tasks/${taskId}/spec\\.md`));
        }
        assert.match(result.stderr, /Bypass with --force if you have verified the lack of amendment is intentional\./);
        taskIds.forEach((taskId, index) => {
            assert.equal(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8'), before[index]);
        });
    });
});

void test('rerouteFromHumanReview enforces the round-2 heading and accepts the strict round-2 form after amendment', () => {
    withTempDir('reroute-preflight-round-two-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const taskId = 'task-a';
        const status = makeRerouteStatus(taskId, 'task/task-a', 1);
        writeTaskStatus(tasksRoot, taskId, status);
        writeTaskStatus(path.join(worktreesRoot, taskId, 'tasks'), taskId, status);
        // Main-repo spec only has the round-1 form; pre-flight requires Round 2.
        writeSpec(dir, taskId, [
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

        // Operator updates the main-repo spec to the strict round-2 form; gate clears.
        writeSpec(dir, taskId, [
            '# Spec',
            '',
            '## Amendment Round 2',
            '',
            'Round 2 amendment now present.',
            '',
        ].join('\n'));

        const second = runReroute(dir, [taskId], false);
        assert.equal(second.status, 0, second.stderr);
        const updated = readStatus(tasksRoot, taskId) as {
            phases?: { implement?: { status?: string; rerouted?: boolean; reroute_count?: number } };
        };
        assert.equal(updated.phases?.implement?.status, 'pending');
        assert.equal(updated.phases?.implement?.rerouted, true);
        assert.equal(updated.phases?.implement?.reroute_count, 2);
    });
});
