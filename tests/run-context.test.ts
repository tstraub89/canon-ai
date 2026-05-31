import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { classifyAttach } from '../src/cli/commands/watch.js';
import { gatherRunContext, probePidAlive } from '../scripts/run-task/run-context.js';

function withTempDir(fn: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-run-context-'));
    const prevTasks = process.env.CANON_TASKS_DIR_OVERRIDE;
    const prevWorktrees = process.env.CANON_WORKTREES_ROOT;
    try {
        process.env.CANON_TASKS_DIR_OVERRIDE = path.join(dir, 'tasks');
        process.env.CANON_WORKTREES_ROOT = path.join(dir, 'worktrees');
        fn(dir);
    } finally {
        if (prevTasks == null) delete process.env.CANON_TASKS_DIR_OVERRIDE;
        else process.env.CANON_TASKS_DIR_OVERRIDE = prevTasks;
        if (prevWorktrees == null) delete process.env.CANON_WORKTREES_ROOT;
        else process.env.CANON_WORKTREES_ROOT = prevWorktrees;
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function writeStatus(taskDir: string, status: Record<string, unknown>): void {
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

function writeHeartbeat(taskDir: string, pid: number, lastUpdateMs: number): void {
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, '.heartbeat.json'), `${JSON.stringify({
        pid,
        started_at_ms: lastUpdateMs - 1_000,
        last_update_ms: lastUpdateMs,
        task_ids: ['t1'],
    }, null, 2)}\n`, 'utf8');
}

void test('gatherRunContext: orphaned worktree resolves through the repo-root task dir', () => {
    withTempDir(dir => {
        const taskDir = path.join(process.env.CANON_TASKS_DIR_OVERRIDE ?? '', 't1');
        fs.mkdirSync(taskDir, { recursive: true });
        writeStatus(taskDir, {
            id: 't1',
            worktree: true,
            branch: `feature-${Date.now()}`,
            phases: {},
        });

        const ctx = gatherRunContext('t1');
        assert.equal(ctx.taskDir, taskDir);
        assert.equal(ctx.statusResult.kind, 'ok');
        assert.equal(ctx.heartbeatResult.kind, 'missing');
        assert.equal(ctx.resolvedPid, null);
        assert.equal(ctx.launchWindow, false);
        assert.equal(path.join(process.env.CANON_TASKS_DIR_OVERRIDE ?? '', 't1', 'status.json'), ctx.statusFile);
        assert.ok(dir.length > 0);
    });
});

void test('gatherRunContext: falls back to heartbeat.pid when .canon-pid is missing', () => {
    withTempDir(() => {
        const taskDir = path.join(process.env.CANON_TASKS_DIR_OVERRIDE ?? '', 't1');
        fs.mkdirSync(taskDir, { recursive: true });
        writeHeartbeat(taskDir, 4242, Date.now());

        const ctx = gatherRunContext('t1');
        assert.equal(ctx.statusResult.kind, 'missing');
        assert.equal(ctx.heartbeatResult.kind, 'found');
        assert.equal(ctx.resolvedPid, 4242);
    });
});

void test('gatherRunContext: falls back to heartbeat.pid when .canon-pid is dead and heartbeat is alive', () => {
    withTempDir(() => {
        const taskDir = path.join(process.env.CANON_TASKS_DIR_OVERRIDE ?? '', 't1');
        fs.mkdirSync(taskDir, { recursive: true });
        fs.writeFileSync(path.join(taskDir, '.canon-pid'), '1111\n', 'utf8');
        writeHeartbeat(taskDir, 2222, Date.now());

        const ctx = gatherRunContext('t1', {
            probeAliveImpl: (pid: number): void => {
                if (pid === 2222) return;
                const err = new Error('ESRCH') as NodeJS.ErrnoException;
                err.code = 'ESRCH';
                throw err;
            },
        });
        assert.equal(ctx.resolvedPid, 2222);
    });
});

void test('gatherRunContext: a reused .canon-pid does not win over a fresh heartbeat for a different, dead pid', () => {
    withTempDir(() => {
        const taskDir = path.join(process.env.CANON_TASKS_DIR_OVERRIDE ?? '', 't1');
        fs.mkdirSync(taskDir, { recursive: true });
        // An in-progress run whose .canon-pid points at a recycled pid that now
        // belongs to an unrelated, still-alive process; the heartbeat is fresh but
        // names the real orchestrator pid that has already exited.
        writeStatus(taskDir, { id: 't1', phases: { implement: { status: 'in_progress', agent: 'codex' } } });
        fs.writeFileSync(path.join(taskDir, '.canon-pid'), '1111\n', 'utf8');
        writeHeartbeat(taskDir, 2222, Date.now());

        const probeImpl = (pid: number): void => {
            if (pid === 1111) return; // recycled pid is alive
            const err = new Error('ESRCH') as NodeJS.ErrnoException;
            err.code = 'ESRCH';
            throw err; // 2222 (the orchestrator) is dead
        };
        const ctx = gatherRunContext('t1', { probeAliveImpl: probeImpl });
        // Must NOT resolve to the recycled-but-alive .canon-pid — trust the
        // heartbeat's dead pid so death is reported rather than a false attach.
        assert.equal(ctx.resolvedPid, 2222);
        assert.equal(ctx.ambiguousPid, null);
        // Pin the downstream symptom: classifyAttach reports death, not a false live.
        const attach = classifyAttach(ctx, 't1', pid => probePidAlive(pid, probeImpl), Date.now());
        assert.equal(attach.kind, 'death');
    });
});

void test('gatherRunContext: marks ambiguous pid disagreement when both PIDs are alive but differ', () => {
    withTempDir(() => {
        const taskDir = path.join(process.env.CANON_TASKS_DIR_OVERRIDE ?? '', 't1');
        fs.mkdirSync(taskDir, { recursive: true });
        fs.writeFileSync(path.join(taskDir, '.canon-pid'), '1111\n', 'utf8');
        writeHeartbeat(taskDir, 2222, Date.now());

        const ctx = gatherRunContext('t1', {
            probeAliveImpl: (pid: number): void => {
                if (pid === 1111 || pid === 2222) return;
                const err = new Error('ESRCH') as NodeJS.ErrnoException;
                err.code = 'ESRCH';
                throw err;
            },
        });
        assert.equal(ctx.resolvedPid, null);
        assert.deepEqual(ctx.ambiguousPid, { canonPid: 1111, heartbeatPid: 2222 });
    });
});

void test('gatherRunContext: launch-window is flagged when .canon-pid is alive and heartbeat is missing', () => {
    withTempDir(() => {
        const taskDir = path.join(process.env.CANON_TASKS_DIR_OVERRIDE ?? '', 't1');
        fs.mkdirSync(taskDir, { recursive: true });
        fs.writeFileSync(path.join(taskDir, '.canon-pid'), '3333\n', 'utf8');

        const ctx = gatherRunContext('t1', {
            probeAliveImpl: (pid: number): void => {
                if (pid === 3333) return;
                const err = new Error('ESRCH') as NodeJS.ErrnoException;
                err.code = 'ESRCH';
                throw err;
            },
        });
        assert.equal(ctx.launchWindow, true);
        assert.equal(ctx.resolvedPid, 3333);
    });
});

void test('probePidAlive: treats EPERM as alive', () => {
    const result = probePidAlive(1234, (_pid: number): void => {
        const err = new Error('operation not permitted') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
    });
    assert.equal(result, true);
});
