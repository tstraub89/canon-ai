import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { classifyAttach, classifyIdle, watchCmd } from '../src/cli/commands/watch.js';
import type { HeartbeatReadResult, HeartbeatRecord } from '../scripts/run-task/heartbeat.js';
import type { RunContext } from '../scripts/run-task/run-context.js';
import { type StatusJson } from '../scripts/run-task/types.js';

const NOW = 1_700_000_000_000;

class HaltExit extends Error {}

function withTempDir(fn: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-watch-'));
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

function makeHeartbeat(pid: number, lastUpdateMs = NOW - 5_000, taskIds = ['t1']): HeartbeatRecord {
    return {
        pid,
        started_at_ms: lastUpdateMs - 1_000,
        last_update_ms: lastUpdateMs,
        task_ids: taskIds,
    };
}

function makeStatus(
    state: string,
    phases: StatusJson['phases'] = {},
): StatusJson {
    return {
        id: 't1',
        status: state,
        phases,
    };
}

function makeContext(overrides: Partial<RunContext> = {}): RunContext {
    return {
        taskId: 't1',
        taskDir: '/tmp/t1',
        statusFile: '/tmp/t1/status.json',
        heartbeatFile: '/tmp/t1/.heartbeat.json',
        statusResult: { kind: 'missing', file: '/tmp/t1/status.json' },
        heartbeatResult: { kind: 'missing' },
        canonPid: null,
        resolvedPid: null,
        ambiguousPid: null,
        launchWindow: false,
        ...overrides,
    };
}

function makeClock(): { now: () => number; sleep: (ms: number) => void; elapsed: () => number } {
    let now = NOW;
    return {
        now: () => now,
        sleep: (ms: number) => { now += ms; },
        elapsed: () => now - NOW,
    };
}

function runWatchCommand(
    args: string[],
    deps: Parameters<typeof watchCmd>[1],
): { exitCode: number | null; stdout: string[]; stderr: string[] } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let exitCode: number | null = null;
    try {
        watchCmd(args, {
            stdout: (s) => { stdout.push(s); },
            stderr: (s) => { stderr.push(s); },
            exit: ((code: number): never => {
                exitCode = code;
                throw new HaltExit();
            }),
            ...(deps ?? {}),
        });
    } catch (error) {
        if (!(error instanceof HaltExit)) throw error;
    }
    return { exitCode, stdout, stderr };
}

// ── classifyAttach ──────────────────────────────────────────────────────────

void test('classifyAttach: auto_block wins even when the pid is live', () => {
    const ctx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('implement', {
                implement: { status: 'blocked', agent: 'codex' },
            }),
        },
        heartbeatResult: { kind: 'found', record: makeHeartbeat(1234) },
        canonPid: 1234,
        resolvedPid: 1234,
    });

    const result = classifyAttach(ctx, 't1', () => true, NOW);
    assert.equal(result.kind, 'auto_block');
    if (result.kind === 'auto_block') assert.equal(result.phase, 'implement');
});

void test('classifyAttach: ambiguous_pid when canon-pid and heartbeat.pid are both alive but differ', () => {
    const ctx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('implement', {
                implement: { status: 'in_progress', agent: 'codex' },
            }),
        },
        heartbeatResult: { kind: 'found', record: makeHeartbeat(2222) },
        canonPid: 1111,
        resolvedPid: null,
        ambiguousPid: { canonPid: 1111, heartbeatPid: 2222 },
    });

    const result = classifyAttach(ctx, 't1', () => true, NOW);
    assert.equal(result.kind, 'ambiguous_pid');
    if (result.kind === 'ambiguous_pid') {
        assert.equal(result.canonPid, 1111);
        assert.equal(result.heartbeatPid, 2222);
    }
});

void test('classifyAttach: live when pid is alive and heartbeat is fresh', () => {
    const ctx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('implement', {
                implement: { status: 'in_progress', agent: 'codex' },
            }),
        },
        heartbeatResult: { kind: 'found', record: makeHeartbeat(1234) },
        canonPid: 1234,
        resolvedPid: 1234,
    });

    const result = classifyAttach(ctx, 't1', () => true, NOW);
    assert.equal(result.kind, 'live');
    if (result.kind === 'live') assert.equal(result.pid, 1234);
});

void test('classifyAttach: launch_window when .canon-pid is alive and heartbeat is missing', () => {
    const ctx = makeContext({
        statusResult: { kind: 'missing', file: '/tmp/t1/status.json' },
        heartbeatResult: { kind: 'missing' },
        canonPid: 9999,
        resolvedPid: 9999,
        launchWindow: true,
    });

    const result = classifyAttach(ctx, 't1', () => true, NOW);
    assert.equal(result.kind, 'launch_window');
});

void test('classifyAttach: death when status says in_progress and no live process remains', () => {
    const ctx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('implement', {
                implement: { status: 'in_progress', agent: 'codex' },
            }),
        },
        heartbeatResult: { kind: 'missing' },
        canonPid: 1111,
        resolvedPid: 1111,
    });

    const result = classifyAttach(ctx, 't1', () => false, NOW);
    assert.equal(result.kind, 'death');
});

void test('classifyAttach: read_error when the heartbeat file is corrupt', () => {
    const ctx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('implement', {
                implement: { status: 'in_progress', agent: 'codex' },
            }),
        },
        heartbeatResult: { kind: 'corrupt', reason: 'invalid JSON' },
    });

    const result = classifyAttach(ctx, 't1', () => false, NOW);
    assert.equal(result.kind, 'read_error');
});

void test('classifyAttach: nothing_to_watch when settled and no live process exists', () => {
    const ctx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('complete', {
                spec: { status: 'done', agent: 'codex' },
                spec_review: { status: 'done', agent: 'codex' },
                plan: { status: 'done', agent: 'codex' },
                implement: { status: 'done', agent: 'codex' },
                code_review: { status: 'done', agent: 'codex' },
                qa: { status: 'done', agent: 'codex' },
                human_review: { status: 'done', agent: 'claude' },
            }),
        },
        heartbeatResult: { kind: 'missing' },
        resolvedPid: null,
    });

    const result = classifyAttach(ctx, 't1', () => false, NOW);
    assert.equal(result.kind, 'nothing_to_watch');
});

// ── classifyIdle ────────────────────────────────────────────────────────────

void test('classifyIdle: checkpoint when human_review settled', () => {
    const ctx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('human_review', {
                qa: { status: 'done', agent: 'codex' },
                code_review: { status: 'done', agent: 'claude', verdict: 'approved' },
                human_review: { status: 'pending', agent: 'human' },
            }),
        },
    });
    const result = classifyIdle(ctx, 't1');
    assert.equal(result.kind, 'checkpoint');
    if (result.kind === 'checkpoint') {
        assert.equal(result.state, 'human_review');
        assert.equal(result.phase, 'qa→human_review');
        assert.equal(result.verdict, 'approved');
    }
});

void test('classifyIdle: complete when all phases are done', () => {
    const ctx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('complete', {
                spec: { status: 'done', agent: 'codex' },
                spec_review: { status: 'done', agent: 'codex' },
                plan: { status: 'done', agent: 'codex' },
                implement: { status: 'done', agent: 'codex' },
                code_review: { status: 'done', agent: 'codex' },
                qa: { status: 'done', agent: 'codex' },
                human_review: { status: 'done', agent: 'claude' },
            }),
        },
    });
    const result = classifyIdle(ctx, 't1');
    assert.equal(result.kind, 'complete');
});

void test('classifyIdle: auto_block when any phase is blocked', () => {
    const ctx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('implement', {
                implement: { status: 'blocked', agent: 'codex' },
            }),
        },
    });
    const result = classifyIdle(ctx, 't1');
    assert.equal(result.kind, 'auto_block');
    if (result.kind === 'auto_block') assert.equal(result.phase, 'implement');
});

void test('classifyIdle: step_done carries verdict when changes_requested', () => {
    const ctx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('code_review', {
                implement: { status: 'done', agent: 'codex' },
                code_review: { status: 'changes_requested', agent: 'claude', verdict: 'changes_requested' },
            }),
        },
    });
    const result = classifyIdle(ctx, 't1');
    assert.equal(result.kind, 'step_done');
    if (result.kind === 'step_done') {
        assert.equal(result.phase, 'code_review');
        assert.equal(result.verdict, 'changes_requested');
    }
});

void test('classifyIdle: step_done shows the transition for a done phase', () => {
    const ctx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('code_review', {
                implement: { status: 'done', agent: 'codex' },
                code_review: { status: 'pending', agent: 'claude' },
            }),
        },
    });
    const result = classifyIdle(ctx, 't1');
    assert.equal(result.kind, 'step_done');
    if (result.kind === 'step_done') assert.equal(result.phase, 'implement→code_review');
});

void test('classifyIdle: death when progress remains in the file', () => {
    const ctx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('implement', {
                implement: { status: 'in_progress', agent: 'codex' },
            }),
        },
    });
    const result = classifyIdle(ctx, 't1');
    assert.equal(result.kind, 'death');
});

// ── watchCmd ────────────────────────────────────────────────────────────────

void test('watchCmd: invalid --until phase fails before attach', () => {
    const result = runWatchCommand(['t1', '--until', 'not-a-phase'], {});
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr.join('\n'), /Invalid phase for --until/);
    assert.equal(result.stdout.length, 1);
    assert.match(result.stdout[0], /state=usage reason=usage_error/);
});

void test('watchCmd: --until returns immediately when the phase has already settled', () => {
    let gatherCalls = 0;
    const result = runWatchCommand(['t1', '--until', 'plan'], {
        gatherContextImpl: () => {
            gatherCalls += 1;
            return makeContext({
                statusResult: {
                    kind: 'ok',
                    file: '/tmp/t1/status.json',
                    status: makeStatus('code_review', {
                        spec: { status: 'done', agent: 'codex' },
                        spec_review: { status: 'done', agent: 'codex' },
                        plan: { status: 'done', agent: 'codex' },
                    }),
                },
            });
        },
    });

    assert.equal(result.exitCode, 0);
    assert.equal(gatherCalls, 1);
    assert.equal(result.stdout.length, 1);
    assert.match(result.stdout[0], /reason=until/);
    assert.equal(result.stderr.length, 0);
});

void test('watchCmd: timeout exits with reason=timeout', () => {
    const clock = makeClock();
    const liveCtx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('implement', {
                implement: { status: 'in_progress', agent: 'codex' },
            }),
        },
        heartbeatResult: { kind: 'found', record: makeHeartbeat(1234, clock.now()) },
        canonPid: 1234,
        resolvedPid: 1234,
    });

    const result = runWatchCommand(['t1', '--timeout', '1s'], {
        nowImpl: clock.now,
        sleepImpl: clock.sleep,
        gatherContextImpl: () => liveCtx,
        probeAliveImpl: () => { /* alive */ },
    });

    assert.equal(result.exitCode, 5);
    assert.equal(result.stdout.length, 1);
    assert.match(result.stdout[0], /reason=timeout/);
});

void test('watchCmd: read_error refuses unreadable state', () => {
    const result = runWatchCommand(['t1'], {
        gatherContextImpl: () => makeContext({
            statusResult: { kind: 'error', file: '/tmp/t1/status.json', reason: 'bad JSON' },
        }),
    });

    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout.length, 1);
    assert.match(result.stdout[0], /reason=read_error/);
    assert.match(result.stderr.join('\n'), /status\.json/);
});

void test('watchCmd: ambiguous pid disagreement refuses to attach', () => {
    const result = runWatchCommand(['t1'], {
        gatherContextImpl: () => makeContext({
            statusResult: {
                kind: 'ok',
                file: '/tmp/t1/status.json',
                status: makeStatus('implement', {
                    implement: { status: 'in_progress', agent: 'codex' },
                }),
            },
            heartbeatResult: { kind: 'found', record: makeHeartbeat(2222) },
            canonPid: 1111,
            resolvedPid: null,
            ambiguousPid: { canonPid: 1111, heartbeatPid: 2222 },
        }),
    });

    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout.length, 1);
    assert.match(result.stdout[0], /reason=ambiguous_pid/);
    assert.match(result.stderr.join('\n'), /canon-pid \(1111\).*heartbeat pid \(2222\)/);
});

void test('watchCmd: launch-window wait follows the primary bundle log and exits cleanly', () => {
    withTempDir(dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const primaryDir = path.join(tasksRoot, 'primary');
        const watchedDir = path.join(tasksRoot, 'secondary');
        fs.mkdirSync(primaryDir, { recursive: true });
        fs.mkdirSync(watchedDir, { recursive: true });
        fs.writeFileSync(path.join(primaryDir, '.canon-run.log'), 'start\n', 'utf8');

        const clock = makeClock();
        let sleepCalls = 0;
        let heartbeatReads = 0;
        let appended = false;

        const launchWindowCtx = makeContext({
            taskId: 'secondary',
            taskDir: watchedDir,
            statusFile: path.join(watchedDir, 'status.json'),
            heartbeatFile: path.join(watchedDir, '.heartbeat.json'),
            statusResult: { kind: 'missing', file: path.join(watchedDir, 'status.json') },
            heartbeatResult: { kind: 'missing' },
            canonPid: 7777,
            resolvedPid: 7777,
            launchWindow: true,
        });

        const liveCtx = makeContext({
            taskId: 'secondary',
            taskDir: watchedDir,
            statusFile: path.join(watchedDir, 'status.json'),
            heartbeatFile: path.join(watchedDir, '.heartbeat.json'),
            statusResult: { kind: 'missing', file: path.join(watchedDir, 'status.json') },
            heartbeatResult: { kind: 'found', record: makeHeartbeat(7777, clock.now(), ['primary', 'secondary']) },
            canonPid: 7777,
            resolvedPid: 7777,
            launchWindow: false,
        });

        const completeCtx = makeContext({
            taskId: 'secondary',
            taskDir: watchedDir,
            statusFile: path.join(watchedDir, 'status.json'),
            heartbeatFile: path.join(watchedDir, '.heartbeat.json'),
            statusResult: {
                kind: 'ok',
                file: path.join(watchedDir, 'status.json'),
                status: makeStatus('complete', {
                    spec: { status: 'done', agent: 'codex' },
                    spec_review: { status: 'done', agent: 'codex' },
                    plan: { status: 'done', agent: 'codex' },
                    implement: { status: 'done', agent: 'codex' },
                    code_review: { status: 'done', agent: 'codex' },
                    qa: { status: 'done', agent: 'codex' },
                    human_review: { status: 'done', agent: 'claude' },
                }),
            },
            heartbeatResult: { kind: 'missing' },
            canonPid: 7777,
            resolvedPid: 7777,
            launchWindow: false,
        });

        const contexts = [launchWindowCtx, liveCtx, liveCtx, completeCtx];
        let gatherIndex = 0;

        const result = runWatchCommand(['secondary', '--follow'], {
            nowImpl: clock.now,
            sleepImpl: (ms: number) => {
                sleepCalls += 1;
                clock.sleep(ms);
                if (!appended && sleepCalls >= 3) {
                    fs.appendFileSync(path.join(primaryDir, '.canon-run.log'), 'live-chunk\n', 'utf8');
                    appended = true;
                }
            },
            readHeartbeatImpl: (): HeartbeatReadResult => {
                heartbeatReads += 1;
                if (heartbeatReads < 3) return { kind: 'missing' };
                return { kind: 'found', record: makeHeartbeat(7777, clock.now(), ['primary', 'secondary']) };
            },
            gatherContextImpl: () => contexts[gatherIndex++] ?? completeCtx,
            probeAliveImpl: (pid: number): void => {
                if (pid === 7777) return;
                const err = new Error('ESRCH') as NodeJS.ErrnoException;
                err.code = 'ESRCH';
                throw err;
            },
        });

        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout.length, 1);
        assert.match(result.stdout[0], /reason=complete/);
        assert.match(result.stderr.join('\n'), /waiting for orchestrator's first heartbeat/);
        assert.match(result.stderr.join('\n'), /live-chunk/);
        assert.ok(heartbeatReads >= 3);
    });
});

void test('watchCmd: emits phase-pointer transitions during live polling', () => {
    const clock = makeClock();
    const livePid = 7777;
    const liveSpecReviewCtx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('spec_review', {
                spec: { status: 'done', agent: 'codex' },
                spec_review: { status: 'in_progress', agent: 'claude' },
            }),
        },
        heartbeatResult: { kind: 'found', record: makeHeartbeat(livePid, clock.now()) },
        canonPid: livePid,
        resolvedPid: livePid,
    });
    const livePlanCtx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('plan', {
                spec: { status: 'done', agent: 'codex' },
                spec_review: { status: 'done', agent: 'claude' },
                plan: { status: 'in_progress', agent: 'codex' },
            }),
        },
        heartbeatResult: { kind: 'found', record: makeHeartbeat(livePid, clock.now()) },
        canonPid: livePid,
        resolvedPid: livePid,
    });
    const completeCtx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('complete', {
                spec: { status: 'done', agent: 'codex' },
                spec_review: { status: 'done', agent: 'claude' },
                plan: { status: 'done', agent: 'codex' },
                implement: { status: 'done', agent: 'codex' },
                code_review: { status: 'done', agent: 'claude' },
                qa: { status: 'done', agent: 'codex' },
                human_review: { status: 'done', agent: 'claude' },
            }),
        },
        heartbeatResult: { kind: 'missing' },
        canonPid: null,
        resolvedPid: null,
    });

    const contexts = [liveSpecReviewCtx, liveSpecReviewCtx, livePlanCtx, completeCtx];
    let gatherIndex = 0;

    const result = runWatchCommand(['t1'], {
        nowImpl: clock.now,
        sleepImpl: clock.sleep,
        gatherContextImpl: () => contexts[gatherIndex++] ?? completeCtx,
        probeAliveImpl: (pid: number): void => {
            if (pid === livePid) return;
            const err = new Error('ESRCH') as NodeJS.ErrnoException;
            err.code = 'ESRCH';
            throw err;
        },
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.length, 1);
    assert.match(result.stdout[0], /reason=complete/);
    assert.match(result.stderr.join('\n'), /phase spec_review → plan/);
    assert.match(result.stderr.join('\n'), /heartbeat .* ago/);
});

void test('watchCmd: a stale heartbeat while the pid is alive at a phase boundary is not a false step_done', () => {
    const clock = makeClock();
    const livePid = 8888;
    // plan in progress, fresh heartbeat — the initial attach.
    const livePlanCtx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('plan', {
                spec: { status: 'done', agent: 'codex' },
                spec_review: { status: 'done', agent: 'claude' },
                plan: { status: 'in_progress', agent: 'codex' },
            }),
        },
        heartbeatResult: { kind: 'found', record: makeHeartbeat(livePid, clock.now()) },
        canonPid: livePid,
        resolvedPid: livePid,
    });
    // The between-phase synchronous window: pointer advanced to implement, heartbeat
    // is stale (older than HEARTBEAT_STALE_AFTER_MS), but the orchestrator is alive.
    // Pre-fix this fell through to the idle path and reported step_done plan→implement.
    const staleBoundaryCtx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('implement', {
                spec: { status: 'done', agent: 'codex' },
                spec_review: { status: 'done', agent: 'claude' },
                plan: { status: 'done', agent: 'codex' },
                implement: { status: 'in_progress', agent: 'codex' },
            }),
        },
        heartbeatResult: { kind: 'found', record: makeHeartbeat(livePid, NOW - 120_000) },
        canonPid: livePid,
        resolvedPid: livePid,
    });
    // Codex implement turn resumes ticking the heartbeat.
    const liveImplementCtx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('implement', {
                spec: { status: 'done', agent: 'codex' },
                spec_review: { status: 'done', agent: 'claude' },
                plan: { status: 'done', agent: 'codex' },
                implement: { status: 'in_progress', agent: 'codex' },
            }),
        },
        heartbeatResult: { kind: 'found', record: makeHeartbeat(livePid, clock.now()) },
        canonPid: livePid,
        resolvedPid: livePid,
    });
    const completeCtx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('complete', {
                spec: { status: 'done', agent: 'codex' },
                spec_review: { status: 'done', agent: 'claude' },
                plan: { status: 'done', agent: 'codex' },
                implement: { status: 'done', agent: 'codex' },
                code_review: { status: 'done', agent: 'claude' },
                qa: { status: 'done', agent: 'codex' },
                human_review: { status: 'done', agent: 'claude' },
            }),
        },
        heartbeatResult: { kind: 'missing' },
        canonPid: null,
        resolvedPid: null,
    });

    const contexts = [livePlanCtx, staleBoundaryCtx, liveImplementCtx, completeCtx];
    let gatherIndex = 0;

    const result = runWatchCommand(['t1'], {
        nowImpl: clock.now,
        sleepImpl: clock.sleep,
        gatherContextImpl: () => contexts[gatherIndex++] ?? completeCtx,
        probeAliveImpl: (pid: number): void => {
            if (pid === livePid) return;
            const err = new Error('ESRCH') as NodeJS.ErrnoException;
            err.code = 'ESRCH';
            throw err;
        },
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.length, 1);
    // It blocks through the stale window and only settles on the real completion.
    assert.match(result.stdout[0], /reason=complete/);
    assert.doesNotMatch(result.stdout[0], /step_done/);
    // The forward transition is still surfaced while blocking.
    assert.match(result.stderr.join('\n'), /phase plan → implement/);
});
