import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { classifyAttach, classifyIdle, orchestratorStillProgressing, watchCmd } from '../src/cli/commands/watch.js';
import type { HeartbeatReadResult, HeartbeatRecord } from '../src/orchestrator/heartbeat.js';
import { gatherRunContext, readLastExitMarker, readNewestExitMarker, runLogCandidateDirs } from '../src/orchestrator/run-context.js';
import type { RunContext } from '../src/orchestrator/run-context.js';
import { type StatusJson } from '../src/orchestrator/types.js';

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

void test('classifyAttach: a blocked marker stays live while the orchestrator pid is alive', () => {
    const ctx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('implement', {
                implement: { status: 'in_progress', agent: 'codex' },
                code_review: { status: 'blocked', agent: 'claude' },
            }),
        },
        heartbeatResult: { kind: 'found', record: makeHeartbeat(1234) },
        canonPid: 1234,
        resolvedPid: 1234,
    });

    const result = classifyAttach(ctx, 't1', () => true, NOW);
    assert.equal(result.kind, 'live');
});

void test('classifyAttach: ambiguous_pid when canon-pid and heartbeat.pid are both alive but differ', () => {
    const ctx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('implement', {
                implement: { status: 'in_progress', agent: 'codex' },
                code_review: { status: 'blocked', agent: 'claude' },
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

void test('classifyAttach: a detached resume of a blocked task is live, not auto_block, even with no heartbeat yet', () => {
    // The parent that spawns a detached resume writes .canon-pid before
    // the child has run far enough to write its own first heartbeat, so a
    // watch invoked immediately sees a blocked (stale, pre-resume) phase
    // with no heartbeat at all yet. Liveness alone must be enough here --
    // must not declare auto_block before the resumed child has had any
    // chance to prove itself.
    const ctx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('implement', {
                implement: { status: 'pending', agent: 'codex' },
                code_review: { status: 'blocked', agent: 'claude' },
            }),
        },
        heartbeatResult: { kind: 'missing' },
        canonPid: 9999,
        resolvedPid: 9999,
        launchWindow: true,
    });

    const result = classifyAttach(ctx, 't1', () => true, NOW);
    assert.equal(result.kind, 'live');
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

void test('classifyAttach: reports a fresh crash marker after a completed phase', () => {
    withTempDir((dir) => {
        const taskDir = path.join(dir, 't1');
        writeExitLog(taskDir, [exitLine('1', 'claude session exited 1 (budget)')]);
        const statusFile = path.join(taskDir, 'status.json');
        const ctx = makeContext({
            taskDir,
            statusFile,
            statusResult: { kind: 'ok', file: statusFile, status: makeStatus('plan', {
                spec_review: { status: 'done', agent: 'claude' },
                plan: { status: 'pending', agent: 'claude' },
            }) },
        });
        const result = classifyAttach(ctx, 't1', () => false, NOW);
        assert.equal(result.kind, 'death');
        if (result.kind === 'death') {
            assert.match(result.reason ?? '', /orchestrator exited non-zero: .*budget/);
            assert.equal(result.hint, 'run `canon run t1` to resume');
        }
    });
});

void test('classifyAttach: pending phase without crash evidence remains nothing_to_watch', () => {
    withTempDir((dir) => {
        const taskDir = path.join(dir, 't1');
        const statusFile = path.join(taskDir, 'status.json');
        const ctx = makeContext({ taskDir, statusFile, statusResult: { kind: 'ok', file: statusFile, status: makeStatus('plan', {
            spec_review: { status: 'done', agent: 'claude' }, plan: { status: 'pending', agent: 'claude' },
        }) } });
        assert.equal(classifyAttach(ctx, 't1', () => false, NOW).kind, 'nothing_to_watch');
    });
});

void test('classifyAttach: clean or stale crash markers remain nothing_to_watch', () => {
    withTempDir((dir) => {
        const taskDir = path.join(dir, 't1');
        const statusFile = path.join(taskDir, 'status.json');
        const ctx = makeContext({ taskDir, statusFile, statusResult: { kind: 'ok', file: statusFile, status: makeStatus('plan', {
            spec_review: { status: 'done', agent: 'claude' }, plan: { status: 'pending', agent: 'claude' },
        }) } });
        writeExitLog(taskDir, [exitLine('0', 'clean')]);
        assert.equal(classifyAttach(ctx, 't1', () => false, NOW).kind, 'nothing_to_watch');
        writeExitLog(taskDir, [exitLine('1', 'old crash', new Date(Date.now() - 20_000).toISOString())]);
        fs.utimesSync(statusFile, Date.now() / 1000, Date.now() / 1000);
        assert.equal(classifyAttach(ctx, 't1', () => false, NOW).kind, 'nothing_to_watch');
    });
});

void test('classifyAttach: in_progress crash keeps marker reason and no evidence keeps generic hint', () => {
    withTempDir((dir) => {
        const taskDir = path.join(dir, 't1');
        const statusFile = path.join(taskDir, 'status.json');
        const status = makeStatus('plan', { plan: { status: 'in_progress', agent: 'claude' } });
        const ctx = makeContext({ taskDir, statusFile, statusResult: { kind: 'ok', file: statusFile, status } });
        writeExitLog(taskDir, [exitLine('1', 'plan agent failed')]);
        const withEvidence = classifyAttach(ctx, 't1', () => false, NOW);
        assert.equal(withEvidence.kind, 'death');
        if (withEvidence.kind === 'death') assert.match(withEvidence.reason ?? '', /plan agent failed/);
        fs.rmSync(path.join(taskDir, '.canon-run.log'));
        const withoutEvidence = classifyAttach(ctx, 't1', () => false, NOW);
        assert.equal(withoutEvidence.kind, 'death');
        if (withoutEvidence.kind === 'death') {
            assert.equal(withoutEvidence.reason, undefined);
            assert.equal(withoutEvidence.hint, 'run `canon run t1` to resume');
        }
    });
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

void test('classifyAttach: primary and backstop loop blocks are terminal only without a live orchestrator', () => {
    for (const [label, status] of [
        ['primary', makeStatus('implement', {
            implement: { status: 'pending', agent: 'codex' },
            code_review: { status: 'blocked', agent: 'claude' },
        })],
        ['backstop', makeStatus('code_review', {
            implement: { status: 'done', agent: 'codex' },
            code_review: { status: 'blocked', agent: 'claude' },
        })],
    ] as const) {
        const ctx = makeContext({
            statusResult: { kind: 'ok', file: '/tmp/t1/status.json', status },
            heartbeatResult: { kind: 'missing' },
            resolvedPid: null,
        });
        const result = classifyAttach(ctx, 't1', () => false, NOW);
        assert.equal(result.kind, 'auto_block', label);
    }
});

void test('classifyAttach: a live backstop pre-flight window is not terminal', () => {
    const ctx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('code_review', {
                implement: { status: 'done', agent: 'codex' },
                code_review: { status: 'blocked', agent: 'claude' },
            }),
        },
        heartbeatResult: { kind: 'found', record: makeHeartbeat(1234) },
        canonPid: 1234,
        resolvedPid: 1234,
    });
    assert.equal(classifyAttach(ctx, 't1', () => true, NOW).kind, 'live');
});

void test('classifyAttach: a live resume is attachable even with a stale heartbeat', () => {
    // The heartbeat timer can't tick during a resumed run's synchronous
    // pre-agent setup work (scaffold commit, worktree add, session-init),
    // so a genuinely live orchestrator can momentarily read as stale.
    // Liveness alone must be enough to avoid nothing_to_watch/death here,
    // matching orchestratorStillProgressing()'s no-heartbeat-window rule.
    const ctx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('implement', {
                implement: { status: 'in_progress', agent: 'codex' },
                code_review: { status: 'blocked', agent: 'claude' },
            }),
        },
        heartbeatResult: { kind: 'found', record: makeHeartbeat(1234, NOW - 90_000) },
        canonPid: 1234,
        resolvedPid: 1234,
    });

    const result = classifyAttach(ctx, 't1', () => true, NOW);
    assert.equal(result.kind, 'live');
    if (result.kind === 'live') assert.equal(result.pid, 1234);
});

void test('classifyAttach: a blocked phase with a live pid is trusted as live no matter how stale the heartbeat', () => {
    // Deliberately unbounded (AC-3/AC-20): the synchronous pre-agent setup
    // work a resume runs through has no fixed upper bound, so a time cutoff
    // here would misreport a genuinely slow-but-healthy resume as blocked.
    const ctx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('implement', {
                implement: { status: 'in_progress', agent: 'codex' },
                code_review: { status: 'blocked', agent: 'claude' },
            }),
        },
        heartbeatResult: { kind: 'found', record: makeHeartbeat(1234, NOW - 300_000) },
        canonPid: 1234,
        resolvedPid: 1234,
    });

    const result = classifyAttach(ctx, 't1', () => true, NOW);
    assert.equal(result.kind, 'live');
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

void test('classifyIdle: full-send tail reports a fresh non-zero exit and keeps clean/non-full-send stops', () => {
    withTempDir(dir => {
        const taskDir = path.join(dir, 't1');
        const statusFile = path.join(taskDir, 'status.json');
        const status = makeStatus('human_review', { qa: { status: 'done', agent: 'claude' } });
        status.full_send = true;
        writeExitLog(taskDir, [exitLine('1', 'tail push rejected')]);
        fs.utimesSync(statusFile, Date.now() / 1000 - 10, Date.now() / 1000 - 10);
        const ctx = makeContext({ taskDir, statusFile, statusResult: { kind: 'ok', file: statusFile, status } });
        const crashed = classifyIdle(ctx, 't1');
        assert.equal(crashed.kind, 'death');
        if (crashed.kind === 'death') assert.match(crashed.reason ?? '', /tail push rejected/);

        writeExitLog(taskDir, [exitLine('0', 'clean')]);
        assert.equal(classifyIdle(ctx, 't1').kind, 'checkpoint');
        status.full_send = false;
        writeExitLog(taskDir, [exitLine('1', 'tail push rejected')]);
        assert.equal(classifyIdle(ctx, 't1').kind, 'checkpoint');
    });
});

void test('classifyAttach and watchCmd report a dead full-send tail after it has exited', () => {
    withTempDir(dir => {
        const taskDir = path.join(dir, 't1');
        const statusFile = path.join(taskDir, 'status.json');
        const status = makeStatus('human_review', { qa: { status: 'done', agent: 'claude' } });
        status.full_send = true;
        writeExitLog(taskDir, [exitLine('1', 'tail push rejected')]);
        fs.utimesSync(statusFile, Date.now() / 1000 - 10, Date.now() / 1000 - 10);
        const ctx = makeContext({ taskDir, statusFile, statusResult: { kind: 'ok', file: statusFile, status } });
        const attach = classifyAttach(ctx, 't1', () => false, NOW);
        assert.equal(attach.kind, 'death');
        if (attach.kind === 'death') assert.match(attach.reason ?? '', /tail push rejected/);

        const result = runWatchCommand(['t1'], { gatherContextImpl: () => ctx });
        assert.equal(result.exitCode, 4);
        assert.match(result.stdout.join(''), /state=human_review reason=death/);
        assert.match(result.stderr.join(''), /tail push rejected/);
    });
});

void test('live full-send tail stays live through a stale heartbeat and an old crash marker', () => {
    withTempDir(dir => {
        const taskDir = path.join(dir, 't1');
        const statusFile = path.join(taskDir, 'status.json');
        const status = makeStatus('human_review', { qa: { status: 'done', agent: 'claude' } });
        status.full_send = true;
        writeExitLog(taskDir, [exitLine('1', 'earlier tail died')]);
        fs.utimesSync(statusFile, Date.now() / 1000 - 10, Date.now() / 1000 - 10);
        const ctx = makeContext({
            taskDir,
            statusFile,
            statusResult: { kind: 'ok', file: statusFile, status },
            heartbeatResult: { kind: 'found', record: makeHeartbeat(1234, NOW - 60_000) },
            canonPid: 1234,
            resolvedPid: 1234,
        });
        assert.equal(classifyIdle(ctx, 't1', () => true).kind, 'live');
        assert.equal(classifyAttach(ctx, 't1', () => true, NOW).kind, 'live');
        assert.equal(orchestratorStillProgressing(ctx, () => true, NOW), true);
        fs.writeFileSync(path.join(taskDir, '.canon-run.log'), '', 'utf8');
        assert.equal(classifyIdle(ctx, 't1', () => true).kind, 'live');
        assert.equal(classifyAttach(ctx, 't1', () => true, NOW).kind, 'live');
        assert.equal(orchestratorStillProgressing(ctx, () => true, NOW), true);
    });
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

void test('classifyIdle: live primary and backstop loop-block windows are not auto_block', () => {
    for (const status of [
        makeStatus('implement', {
            implement: { status: 'in_progress', agent: 'codex' },
            code_review: { status: 'blocked', agent: 'claude' },
        }),
        makeStatus('code_review', {
            implement: { status: 'done', agent: 'codex' },
            code_review: { status: 'blocked', agent: 'claude' },
        }),
    ]) {
        const ctx = makeContext({
            statusResult: { kind: 'ok', file: '/tmp/t1/status.json', status },
            heartbeatResult: { kind: 'found', record: makeHeartbeat(1234, NOW - 90_000) },
            canonPid: 1234,
            resolvedPid: 1234,
        });
        assert.notEqual(classifyIdle(ctx, 't1', () => true, NOW).kind, 'auto_block');
    }
});

void test('classifyIdle: primary and backstop loop blocks are terminal without a live orchestrator', () => {
    for (const status of [
        makeStatus('implement', {
            implement: { status: 'pending', agent: 'codex' },
            code_review: { status: 'blocked', agent: 'claude' },
        }),
        makeStatus('code_review', {
            implement: { status: 'done', agent: 'codex' },
            code_review: { status: 'blocked', agent: 'claude' },
        }),
    ]) {
        const ctx = makeContext({
            statusResult: { kind: 'ok', file: '/tmp/t1/status.json', status },
            resolvedPid: null,
        });
        assert.equal(classifyIdle(ctx, 't1', () => false).kind, 'auto_block');
    }
});

void test('classifyIdle: blocked plus ambiguous live pids refuses ambiguity before auto-block', () => {
    const ctx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('implement', {
                implement: { status: 'pending', agent: 'codex' },
                code_review: { status: 'blocked', agent: 'claude' },
            }),
        },
        resolvedPid: null,
        ambiguousPid: { canonPid: 1111, heartbeatPid: 2222 },
    });
    assert.equal(classifyIdle(ctx, 't1', () => false).kind, 'ambiguous_pid');
});

void test('orchestratorStillProgressing ignores blocked markers after confirming liveness, no matter how stale the heartbeat', () => {
    // Deliberately unbounded (AC-3/AC-20): liveness alone is authoritative
    // for a blocked phase here. A cap-raised resume's synchronous pre-agent
    // setup work has no fixed upper bound, so this must keep trusting a
    // confirmed-alive pid regardless of heartbeat age.
    for (const status of [
        makeStatus('implement', {
                implement: { status: 'in_progress', agent: 'codex' },
                code_review: { status: 'blocked', agent: 'claude' },
        }),
        makeStatus('code_review', {
            implement: { status: 'done', agent: 'codex' },
            code_review: { status: 'blocked', agent: 'claude' },
        }),
    ]) {
        const liveCtx = makeContext({
            statusResult: { kind: 'ok', file: '/tmp/t1/status.json', status },
            heartbeatResult: { kind: 'found', record: makeHeartbeat(1234, NOW - 300_000) },
            resolvedPid: 1234,
        });
        assert.equal(orchestratorStillProgressing(liveCtx, () => true, NOW), true);
        assert.equal(orchestratorStillProgressing(liveCtx, () => false, NOW), false);
    }
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

function makeCrashStatus(taskDir: string): RunContext {
    const statusFile = path.join(taskDir, 'status.json');
    return makeContext({
        taskDir,
        statusFile,
        statusResult: {
            kind: 'ok', file: statusFile,
            status: makeStatus('plan', {
                spec_review: { status: 'done', agent: 'claude' },
                plan: { status: 'in_progress', agent: 'claude' },
            }),
        },
    });
}

function writeExitLog(taskDir: string, markers: string[]): void {
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'status.json'), '{}');
    fs.writeFileSync(path.join(taskDir, '.canon-run.log'), markers.join('\n') + '\n');
}

function exitLine(code: string, reason: string, timestamp = new Date().toISOString()): string {
    return `■ orchestrator exit code=${code} [reason=${reason}] at ${timestamp}`;
}

void test('readLastExitMarker: last well-formed marker wins; malformed trailing lines are ignored', () => {
    withTempDir((dir) => {
        const taskDir = path.join(dir, 't1');
        writeExitLog(taskDir, [exitLine('1', 'old'), exitLine('0', 'clean'), '■ orchestrator exit code=1 [reas']);
        assert.equal(readLastExitMarker(taskDir)?.code, '0');
    });
});

void test('readLastExitMarker: malformed and absent logs return null and signal codes/reasons parse', () => {
    withTempDir((dir) => {
        const taskDir = path.join(dir, 't1');
        writeExitLog(taskDir, ['noise', 'truncated']);
        assert.equal(readLastExitMarker(taskDir), null);
        assert.equal(readLastExitMarker(path.join(dir, 'missing')), null);
        const timestamp = new Date().toISOString();
        writeExitLog(taskDir, [exitLine('signal:SIGTERM', 'terminated by SIGTERM [operator]', timestamp)]);
        assert.deepEqual(readLastExitMarker(taskDir), {
            code: 'signal:SIGTERM', reason: 'terminated by SIGTERM [operator]',
            timestampMs: Date.parse(timestamp),
        });
    });
});

void test('readLastExitMarker: accepts unterminated output before a marker and rejects truncated tails', () => {
    withTempDir((dir) => {
        const taskDir = path.join(dir, 't1');
        writeExitLog(taskDir, ['partial agent output with no newline' + exitLine('1', 'claude session exited 1', '2026-01-01T00:00:00.000Z')]);
        assert.deepEqual(readLastExitMarker(taskDir), {
            code: '1', reason: 'claude session exited 1', timestampMs: Date.parse('2026-01-01T00:00:00.000Z'),
        });
        writeExitLog(taskDir, [
            exitLine('0', 'prev', '2026-01-01T00:00:00.000Z'),
            '■ orchestrator exit code=1 [reason=x]',
        ]);
        assert.equal(readLastExitMarker(taskDir)?.reason, 'prev');
        writeExitLog(taskDir, ['■ orchestrator exit code=1 [reason=x]']);
        assert.equal(readLastExitMarker(taskDir), null);
        writeExitLog(taskDir, ['error: saw ' + exitLine('1', 'embedded', '2026-01-01T00:00:00.000Z') + ' in output']);
        assert.equal(readLastExitMarker(taskDir), null);
    });
});

void test('readNewestExitMarker: newest timestamp wins across candidate dirs; missing logs are ignored', () => {
    withTempDir((root) => {
        const first = path.join(root, 'first');
        const second = path.join(root, 'second');
        writeExitLog(first, [exitLine('1', 'older', '2026-01-01T00:00:00.000Z')]);
        writeExitLog(second, [exitLine('0', 'newer', '2026-01-02T00:00:00.000Z')]);
        assert.equal(readNewestExitMarker([first, second, first])?.reason, 'newer');
        assert.equal(readNewestExitMarker([path.join(root, 'missing')]), null);
    });
});

void test('runLogCandidateDirs: includes main-checkout dirs for primary and watched ids without duplicates', () => {
    withTempDir((root) => {
        const ctxDir = path.join(root, 'worktree', 'tasks', 'secondary');
        const candidates = runLogCandidateDirs(ctxDir, 'secondary', 'primary');
        assert.ok(candidates.includes(ctxDir));
        assert.ok(candidates.includes(path.join(root, 'tasks', 'primary')));
        assert.ok(candidates.includes(path.join(root, 'tasks', 'secondary')));
        assert.equal(new Set(candidates).size, candidates.length);
    });
});

void test('classifyIdle: fresh non-zero marker is death with reason', () => {
    withTempDir((dir) => {
        const taskDir = path.join(dir, 't1');
        const statusFile = path.join(taskDir, 'status.json');
        const now = Date.now();
        writeExitLog(taskDir, [exitLine('1', 'claude session exited 1 (possible budget exhaustion — see CLAUDE_BUDGET)', new Date(now).toISOString())]);
        fs.utimesSync(statusFile, now / 1000 - 10, now / 1000 - 10);
        const result = classifyIdle(makeCrashStatus(taskDir), 't1');
        assert.equal(result.kind, 'death');
        if (result.kind === 'death') assert.match(result.reason ?? '', /CLAUDE_BUDGET/);
    });
});

void test('classifyIdle: clean code=0 marker remains step_done', () => {
    withTempDir((dir) => {
        const taskDir = path.join(dir, 't1');
        writeExitLog(taskDir, [exitLine('0', 'clean')]);
        assert.equal(classifyIdle(makeCrashStatus(taskDir), 't1').kind, 'step_done');
    });
});

void test('classifyIdle: stale crash marker remains step_done and exact tolerance boundary counts as death', () => {
    withTempDir((dir) => {
        const taskDir = path.join(dir, 't1');
        const statusFile = path.join(taskDir, 'status.json');
        const oldMarker = new Date(Date.now() - 20_000).toISOString();
        writeExitLog(taskDir, [exitLine('1', 'old crash', oldMarker)]);
        fs.utimesSync(statusFile, Date.now() / 1000, Date.now() / 1000);
        assert.equal(classifyIdle(makeCrashStatus(taskDir), 't1').kind, 'step_done');

        const wholeSecond = Math.floor(Date.now() / 1000);
        writeExitLog(taskDir, [exitLine('1', 'boundary', new Date(wholeSecond * 1000 - 1_000).toISOString())]);
        fs.utimesSync(statusFile, wholeSecond, wholeSecond);
        assert.equal(classifyIdle(makeCrashStatus(taskDir), 't1').kind, 'death');
        writeExitLog(taskDir, [exitLine('1', 'outside boundary', new Date(wholeSecond * 1000 - 1_001).toISOString())]);
        fs.utimesSync(statusFile, wholeSecond, wholeSecond);
        assert.equal(classifyIdle(makeCrashStatus(taskDir), 't1').kind, 'step_done');
    });
});

void test('classifyIdle: dead pid evidence is death while a live pid does not override step_done', () => {
    const ctx = makeContext({
        statusResult: { kind: 'ok', file: '/tmp/t1/status.json', status: makeStatus('plan', {
            spec_review: { status: 'done', agent: 'claude' }, plan: { status: 'in_progress', agent: 'claude' },
        }) },
        canonPid: 4242, resolvedPid: 4242,
    });
    assert.equal(classifyIdle(ctx, 't1', () => false).kind, 'death');
    assert.equal(classifyIdle(ctx, 't1', () => true).kind, 'step_done');
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

void test('watchCmd: reports a logged crash on stderr with the stable death summary', () => {
    withTempDir((dir) => {
        const taskDir = path.join(dir, 't1');
        writeExitLog(taskDir, [exitLine('1', 'claude session exited 1 (budget exhausted)')]);
        const liveCtx = makeContext({
            statusResult: { kind: 'ok', file: path.join(taskDir, 'status.json'), status: makeStatus('plan', {
                spec_review: { status: 'done', agent: 'claude' }, plan: { status: 'in_progress', agent: 'claude' },
            }) },
            taskDir, statusFile: path.join(taskDir, 'status.json'),
            heartbeatResult: { kind: 'found', record: makeHeartbeat(7777, NOW) }, canonPid: 7777, resolvedPid: 7777,
        });
        const deadCtx = makeCrashStatus(taskDir);
        const contexts = [liveCtx, deadCtx, deadCtx];
        let index = 0;
        const clock = makeClock();
        const result = runWatchCommand(['t1'], {
            nowImpl: clock.now, sleepImpl: clock.sleep,
            gatherContextImpl: () => contexts[index++] ?? deadCtx,
            probeAliveImpl: (pid: number): void => {
                if (pid === 7777) return;
                const err = new Error('ESRCH') as NodeJS.ErrnoException; err.code = 'ESRCH'; throw err;
            },
        });
        assert.equal(result.exitCode, 4);
        assert.deepEqual(result.stdout, ['state=plan reason=death\n']);
        assert.equal(result.stderr.filter((line) => line.startsWith('canon watch: orchestrator exited non-zero:')).length, 1);
        assert.match(result.stderr.join(''), /budget exhausted/);
        assert.match(result.stderr.join(''), /canon run t1/);
    });
});

void test('watchCmd: late attach reports a pending-phase crash and exits 4', () => {
    withTempDir((dir) => {
        const taskDir = path.join(dir, 't1');
        const statusFile = path.join(taskDir, 'status.json');
        writeExitLog(taskDir, [exitLine('1', 'claude session exited 1 (budget exhausted)')]);
        const ctx = makeContext({
            taskDir, statusFile,
            statusResult: { kind: 'ok', file: statusFile, status: makeStatus('plan', {
                spec_review: { status: 'done', agent: 'claude' }, plan: { status: 'pending', agent: 'claude' },
            }) },
        });
        const result = runWatchCommand(['t1'], { gatherContextImpl: () => ctx });
        assert.equal(result.exitCode, 4);
        assert.deepEqual(result.stdout, ['state=plan reason=death\n']);
        assert.match(result.stderr.join(''), /budget exhausted/);
        assert.match(result.stderr.join(''), /canon run t1/);
    });
});

void test('watchCmd: signal exit marker reports termination reason', () => {
    withTempDir((dir) => {
        const taskDir = path.join(dir, 't1');
        writeExitLog(taskDir, [exitLine('signal:SIGTERM', 'terminated by SIGTERM')]);
        const liveCtx = makeContext({
            statusResult: { kind: 'ok', file: path.join(taskDir, 'status.json'), status: makeStatus('plan', {
                spec_review: { status: 'done', agent: 'claude' }, plan: { status: 'in_progress', agent: 'claude' },
            }) },
            taskDir, statusFile: path.join(taskDir, 'status.json'),
            heartbeatResult: { kind: 'found', record: makeHeartbeat(7777, NOW) }, canonPid: 7777, resolvedPid: 7777,
        });
        const deadCtx = makeCrashStatus(taskDir);
        const contexts = [liveCtx, deadCtx, deadCtx]; let index = 0;
        const clock = makeClock();
        const result = runWatchCommand(['t1'], {
            nowImpl: clock.now, sleepImpl: clock.sleep,
            gatherContextImpl: () => contexts[index++] ?? deadCtx,
            probeAliveImpl: (pid: number): void => {
                if (pid === 7777) return;
                const err = new Error('ESRCH') as NodeJS.ErrnoException; err.code = 'ESRCH'; throw err;
            },
        });
        assert.equal(result.exitCode, 4);
        assert.match(result.stderr.join(''), /terminated by SIGTERM/);
        assert.deepEqual(result.stdout, ['state=plan reason=death\n']);
    });
});

void test('watchCmd (red-first): finds primary run log in main checkout after task dir moves to worktree', () => {
    withTempDir((root) => {
        const primaryDir = path.join(root, 'tasks', 'primary');
        const worktreeDir = path.join(root, 'worktree', 'tasks', 'primary');
        fs.mkdirSync(worktreeDir, { recursive: true });
        fs.writeFileSync(path.join(worktreeDir, 'status.json'), '{}');
        fs.mkdirSync(primaryDir, { recursive: true });
        fs.writeFileSync(path.join(primaryDir, '.canon-run.log'), exitLine('1', 'primary main-checkout crash') + '\n');
        const status = makeStatus('code_review', {
            spec: { status: 'done', agent: 'codex' },
            spec_review: { status: 'done', agent: 'claude' },
            plan: { status: 'done', agent: 'codex' },
            implement: { status: 'done', agent: 'codex' },
            code_review: { status: 'pending', agent: 'claude' },
        });
        const live = makeContext({
            taskDir: worktreeDir, statusFile: path.join(worktreeDir, 'status.json'),
            statusResult: { kind: 'ok', file: path.join(worktreeDir, 'status.json'), status },
            heartbeatResult: { kind: 'found', record: makeHeartbeat(7777, NOW, ['primary']) },
            canonPid: 7777, resolvedPid: 7777,
        });
        const dead = { ...live, heartbeatResult: { kind: 'missing' } as const, canonPid: null, resolvedPid: null };
        const contexts = [live, dead, dead]; let index = 0;
        const clock = makeClock();
        const result = runWatchCommand(['primary'], {
            nowImpl: clock.now, sleepImpl: clock.sleep,
            gatherContextImpl: () => contexts[index++] ?? dead,
            probeAliveImpl: (pid: number): void => {
                if (pid === 7777) return;
                const err = new Error('ESRCH') as NodeJS.ErrnoException; err.code = 'ESRCH'; throw err;
            },
        });
        assert.equal(result.exitCode, 4);
        assert.deepEqual(result.stdout, ['state=code_review reason=death\n']);
        assert.match(result.stderr.join(''), /primary main-checkout crash/);
    });
});

void test('watchCmd: secondary bundle member uses remembered primary main-checkout log', () => {
    withTempDir((root) => {
        const primaryDir = path.join(root, 'tasks', 'primary');
        const secondaryWorktreeDir = path.join(root, 'worktree', 'tasks', 'secondary');
        fs.mkdirSync(primaryDir, { recursive: true });
        fs.mkdirSync(secondaryWorktreeDir, { recursive: true });
        fs.writeFileSync(path.join(secondaryWorktreeDir, 'status.json'), '{}');
        fs.writeFileSync(path.join(primaryDir, '.canon-run.log'), exitLine('1', 'bundle primary crashed') + '\n');
        const bundleStatus = makeStatus('code_review', {
            spec: { status: 'done', agent: 'codex' }, spec_review: { status: 'done', agent: 'claude' },
            plan: { status: 'done', agent: 'codex' }, implement: { status: 'done', agent: 'codex' },
            code_review: { status: 'pending', agent: 'claude' },
        });
        const live = makeContext({
            taskDir: secondaryWorktreeDir, statusFile: path.join(secondaryWorktreeDir, 'status.json'),
            statusResult: { kind: 'ok', file: path.join(secondaryWorktreeDir, 'status.json'), status: bundleStatus },
            heartbeatResult: { kind: 'found', record: makeHeartbeat(7777, NOW, ['primary', 'secondary']) },
            canonPid: 7777, resolvedPid: 7777,
        });
        const dead = { ...live, heartbeatResult: { kind: 'missing' } as const, canonPid: null, resolvedPid: null };
        const contexts = [live, dead, dead]; let index = 0;
        const clock = makeClock();
        const result = runWatchCommand(['secondary'], {
            nowImpl: clock.now, sleepImpl: clock.sleep,
            gatherContextImpl: () => contexts[index++] ?? dead,
            probeAliveImpl: (pid: number): void => {
                if (pid === 7777) return;
                const err = new Error('ESRCH') as NodeJS.ErrnoException; err.code = 'ESRCH'; throw err;
            },
        });
        assert.equal(result.exitCode, 4);
        assert.deepEqual(result.stdout, ['state=code_review reason=death\n']);
        assert.match(result.stderr.join(''), /bundle primary crashed/);

        const noHeartbeat = { ...dead, taskDir: secondaryWorktreeDir };
        assert.equal(classifyIdle(noHeartbeat, 'secondary').kind, 'step_done');
    });
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

void test('watchCmd: --until does not settle a blocked review while its orchestrator is alive', () => {
    for (const [label, status] of [
        ['primary', makeStatus('implement', {
            implement: { status: 'in_progress', agent: 'codex' },
            code_review: { status: 'blocked', agent: 'claude' },
        })],
        ['backstop', makeStatus('code_review', {
            implement: { status: 'done', agent: 'codex' },
            code_review: { status: 'blocked', agent: 'claude' },
        })],
    ] as const) {
        const liveCtx = makeContext({
            statusResult: { kind: 'ok', file: '/tmp/t1/status.json', status },
            heartbeatResult: { kind: 'found', record: makeHeartbeat(1234) },
            canonPid: 1234,
            resolvedPid: 1234,
        });
        const result = runWatchCommand(['t1', '--until', 'code_review', '--timeout', '0s'], {
            gatherContextImpl: () => liveCtx,
            probeAliveImpl: () => { /* alive */ },
            nowImpl: () => NOW,
        });
        assert.equal(result.exitCode, 5, label);
        assert.match(result.stdout[0] ?? '', /reason=timeout/, label);
    }
});

void test('watchCmd: --until does not settle a blocked review during a detached-resume launch window', () => {
    // The resume's parent writes .canon-pid before the child has run far
    // enough to write its own first heartbeat. --until must not read the
    // resulting missing heartbeat as "infinitely stale, therefore settled"
    // -- that would report success before the resumed child ever started.
    const status = makeStatus('implement', {
        implement: { status: 'pending', agent: 'codex' },
        code_review: { status: 'blocked', agent: 'claude' },
    });
    const launchCtx = makeContext({
        statusResult: { kind: 'ok', file: '/tmp/t1/status.json', status },
        heartbeatResult: { kind: 'missing' },
        canonPid: 9999,
        resolvedPid: 9999,
        launchWindow: true,
    });
    const result = runWatchCommand(['t1', '--until', 'code_review', '--timeout', '0s'], {
        gatherContextImpl: () => launchCtx,
        probeAliveImpl: () => { /* alive */ },
        nowImpl: () => NOW,
    });
    assert.notEqual(result.exitCode, 0);
    assert.doesNotMatch(result.stdout[0] ?? '', /reason=until/);
});

void test('watchCmd: --until settles primary and backstop loop blocks when no orchestrator is alive', () => {
    for (const [label, status] of [
        ['primary', makeStatus('implement', {
            implement: { status: 'pending', agent: 'codex' },
            code_review: { status: 'blocked', agent: 'claude' },
        })],
        ['backstop', makeStatus('code_review', {
            implement: { status: 'done', agent: 'codex' },
            code_review: { status: 'blocked', agent: 'claude' },
        })],
    ] as const) {
        const result = runWatchCommand(['t1', '--until', 'code_review'], {
            gatherContextImpl: () => makeContext({
                statusResult: { kind: 'ok', file: '/tmp/t1/status.json', status },
                resolvedPid: null,
            }),
        });
        assert.equal(result.exitCode, 0, label);
        assert.match(result.stdout[0] ?? '', /reason=until/, label);
    }
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
    // Fresh heartbeats print quiet '.' ticks, not per-poll age lines; the
    // transition line must start at column 0 (dot run closed by a newline).
    const joined = result.stderr.join('');
    assert.doesNotMatch(joined, /heartbeat .* ago/);
    assert.match(joined, /\.\n?canon watch: phase/);
});

void test('watchCmd: a changes_requested reroute reports one backwards transition, not the transient forward flap', () => {
    const clock = makeClock();
    const livePid = 7777;
    const makeLiveCtx = (phases: StatusJson['phases'], state: string): ReturnType<typeof makeContext> => makeContext({
        statusResult: { kind: 'ok', file: '/tmp/t1/status.json', status: makeStatus(state, phases) },
        heartbeatResult: { kind: 'found', record: makeHeartbeat(livePid, clock.now()) },
        canonPid: livePid,
        resolvedPid: livePid,
    });
    const donePrefix: StatusJson['phases'] = {
        spec: { status: 'done', agent: 'codex' },
        spec_review: { status: 'done', agent: 'claude' },
        plan: { status: 'done', agent: 'codex' },
        implement: { status: 'done', agent: 'codex' },
    };
    // code_review running.
    const reviewCtx = makeLiveCtx({ ...donePrefix, code_review: { status: 'in_progress', agent: 'claude' } }, 'code_review');
    // Mid-reroute window: code_review stamped done with changes_requested —
    // the derived pointer transiently reads 'qa'. Watch must hold, not
    // report code_review → qa.
    const midRerouteCtx = makeLiveCtx({ ...donePrefix, code_review: { status: 'done', agent: 'claude', verdict: 'changes_requested' } }, 'qa');
    // Post routeBackTo: implement re-opened, verdict cleared.
    const reroutedCtx = makeLiveCtx({
        spec: { status: 'done', agent: 'codex' },
        spec_review: { status: 'done', agent: 'claude' },
        plan: { status: 'done', agent: 'codex' },
        implement: { status: 'in_progress', agent: 'codex' },
        code_review: { status: 'pending', agent: 'claude', verdict: '' },
    }, 'implement');
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

    const contexts = [reviewCtx, reviewCtx, midRerouteCtx, midRerouteCtx, reroutedCtx, completeCtx];
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
    const joined = result.stderr.join('');
    assert.doesNotMatch(joined, /code_review → qa/);
    assert.doesNotMatch(joined, /qa → implement/);
    assert.match(joined, /phase code_review → implement \(reroute\)/);
});

void test('watchCmd: escalates to a heartbeat-age notice only after a missed heartbeat tick', () => {
    const clock = makeClock();
    const livePid = 7777;
    // Heartbeat written at attach time and never refreshed: poll ages climb
    // 3s, 6s, ... past HEARTBEAT_INTERVAL_MS (30s) while staying under the
    // 60s stale bound, so the run stays classified live throughout.
    const heartbeatBirth = clock.now();
    const makeLiveCtx = (): ReturnType<typeof makeContext> => makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('plan', {
                spec: { status: 'done', agent: 'codex' },
                spec_review: { status: 'done', agent: 'claude' },
                plan: { status: 'in_progress', agent: 'codex' },
            }),
        },
        heartbeatResult: { kind: 'found', record: makeHeartbeat(livePid, heartbeatBirth) },
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

    // 12 live polls × 3s ⇒ ages 3s..36s: the first 10 are ≤30s (dots), the
    // last two cross the interval and must print age lines.
    const contexts = [...Array.from({ length: 12 }, makeLiveCtx), completeCtx];
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
    const joined = result.stderr.join('');
    const ageLines = joined.match(/canon watch: heartbeat .+ ago/g) ?? [];
    assert.ok(ageLines.length >= 1, `expected at least one age notice, got stderr: ${JSON.stringify(joined)}`);
    assert.ok((joined.match(/\./g) ?? []).length >= 5, 'expected dot ticks for the fresh-heartbeat polls');
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

void test('watchCmd: worktree flip with a fresh heartbeat keeps blocking instead of step_done', () => {
    const clock = makeClock();
    withTempDir(dir => {
        const worktreeTaskDir = path.join(dir, 'worktrees', 't1', 'tasks', 't1');
        fs.mkdirSync(worktreeTaskDir, { recursive: true });
        fs.writeFileSync(path.join(worktreeTaskDir, 'status.json'), `${JSON.stringify(makeStatus('implement', {
            spec: { status: 'done', agent: 'codex' },
            spec_review: { status: 'done', agent: 'claude' },
            plan: { status: 'done', agent: 'codex' },
            implement: { status: 'in_progress', agent: 'codex' },
        }), null, 2)}\n`, 'utf8');
        fs.writeFileSync(path.join(worktreeTaskDir, '.heartbeat.json'), `${JSON.stringify(makeHeartbeat(process.pid, clock.now()), null, 2)}\n`, 'utf8');

        const ctx = gatherRunContext('t1', {
            resolveTaskDirImpl: () => worktreeTaskDir,
            probeAliveImpl: (pid: number): void => {
                if (pid === process.pid) return;
                const err = new Error('ESRCH') as NodeJS.ErrnoException;
                err.code = 'ESRCH';
                throw err;
            },
        });

        assert.equal(ctx.canonPid, null);
        assert.equal(ctx.resolvedPid, process.pid);
        assert.equal(ctx.launchWindow, false);

        const result = runWatchCommand(['t1', '--timeout', '1s'], {
            nowImpl: clock.now,
            sleepImpl: clock.sleep,
            gatherContextImpl: () => ctx,
            probeAliveImpl: (pid: number): boolean => pid === process.pid,
        });

        assert.equal(result.exitCode, 5);
        assert.equal(result.stdout.length, 1);
        assert.match(result.stdout[0], /reason=timeout/);
        assert.doesNotMatch(result.stdout[0], /step_done/);
    });
});

void test('watch --follow uses byte offsets and preserves UTF-8 across polls and log replacement', () => {
    withTempDir(root => {
        const dir = path.join(root, 'tasks', 't1');
        fs.mkdirSync(dir, { recursive: true });
        const log = path.join(dir, '.canon-run.log');
        fs.writeFileSync(log, '→'.repeat(100) + '\n');
        const clock = makeClock();
        let polls = 0;
        const emoji = Buffer.from('😀');
        const otherDir = path.join(root, 'tasks', 'other');
        fs.mkdirSync(otherDir);
        const otherLog = path.join(otherDir, '.canon-run.log');
        fs.writeFileSync(otherLog, 'historical-other\n'.repeat(30));
        const result = runWatchCommand(['t1', '--follow', '--timeout', '1s'], {
            nowImpl: clock.now,
            pollIntervalMs: 100,
            sleepImpl: ms => {
                clock.sleep(ms);
                polls++;
                if (polls === 1) fs.appendFileSync(log, Buffer.concat([Buffer.from('new '), emoji.subarray(0, 2)]));
                if (polls === 2) fs.appendFileSync(log, Buffer.concat([emoji.subarray(2), Buffer.from(' line\n')]));
                if (polls === 3) {
                    const size = fs.statSync(log).size;
                    fs.renameSync(log, `${log}.old`);
                    fs.writeFileSync(log, 'replacement\n'.padEnd(size, 'x'));
                }
                if (polls === 4) fs.writeFileSync(log, 'truncated\n');
                if (polls === 6) fs.appendFileSync(otherLog, 'new-other\n');
            },
            probeAliveImpl: () => {},
            gatherContextImpl: () => makeContext({
                taskDir: dir, canonPid: 7777, resolvedPid: 7777,
                statusResult: { kind: 'ok', file: path.join(dir, 'status.json'), status: makeStatus('implement', { implement: { status: 'in_progress', agent: 'codex' } }) },
                heartbeatResult: { kind: 'found', record: makeHeartbeat(7777, clock.now(), polls >= 5 ? ['other', 't1'] : ['t1']) },
            }),
        });
        const output = result.stderr.join('');
        assert.equal(result.exitCode, 5);
        assert.match(output, /new /);
        assert.match(output, /😀 line\n/);
        assert.doesNotMatch(output, /�/);
        assert.equal(output.split('😀').length - 1, 1);
        assert.match(output, /replacement\n/);
        assert.match(output, /truncated\n/);
        assert.doesNotMatch(output, /historical-other/);
        assert.match(output, /new-other\n/);
    });
});

void test('watch --follow tails the most recently written log when both the main-checkout and worktree logs exist', () => {
    withTempDir((root) => {
        const mainDir = path.join(root, 'tasks', 'primary');
        const worktreeDir = path.join(root, 'worktree', 'tasks', 'primary');
        fs.mkdirSync(mainDir, { recursive: true });
        fs.mkdirSync(worktreeDir, { recursive: true });
        const mainLog = path.join(mainDir, '.canon-run.log');
        const worktreeLog = path.join(worktreeDir, '.canon-run.log');
        fs.writeFileSync(mainLog, 'first run\n');
        const old = new Date(Date.now() - 60_000);
        fs.utimesSync(mainLog, old, old);
        fs.writeFileSync(worktreeLog, 'resumed run\n');
        fs.writeFileSync(path.join(worktreeDir, 'status.json'), '{}');
        const clock = makeClock();
        let polls = 0;
        const ctx = makeContext({
            taskDir: worktreeDir, statusFile: path.join(worktreeDir, 'status.json'),
            statusResult: { kind: 'ok', file: path.join(worktreeDir, 'status.json'), status: makeStatus('implement', {
                plan: { status: 'done', agent: 'claude' }, implement: { status: 'in_progress', agent: 'codex' },
            }) },
            heartbeatResult: { kind: 'found', record: makeHeartbeat(7777, clock.now(), ['primary']) },
            canonPid: 7777, resolvedPid: 7777,
        });
        const result = runWatchCommand(['primary', '--follow', '--timeout', '1s'], {
            nowImpl: clock.now, pollIntervalMs: 100,
            sleepImpl: (ms) => {
                clock.sleep(ms);
                polls += 1;
                if (polls === 1) fs.appendFileSync(worktreeLog, 'streamed from the resumed run\n');
            },
            gatherContextImpl: () => ctx,
            probeAliveImpl: (pid: number): void => { if (pid !== 7777) throw new Error('unexpected pid'); },
        });
        assert.equal(result.exitCode, 5);
        assert.match(result.stderr.join(''), /streamed from the resumed run/);
    });
});

void test('watch --follow switches to a resumed run log mid-follow and streams it from the start', () => {
    withTempDir((root) => {
        const mainDir = path.join(root, 'tasks', 'primary');
        const worktreeDir = path.join(root, 'worktree', 'tasks', 'primary');
        fs.mkdirSync(mainDir, { recursive: true });
        fs.mkdirSync(worktreeDir, { recursive: true });
        const mainLog = path.join(mainDir, '.canon-run.log');
        const worktreeLog = path.join(worktreeDir, '.canon-run.log');
        fs.writeFileSync(mainLog, 'first run history\n');
        const old = new Date(Date.now() - 60_000);
        fs.utimesSync(mainLog, old, old);
        fs.writeFileSync(path.join(worktreeDir, 'status.json'), '{}');
        const clock = makeClock();
        let polls = 0;
        const ctx = makeContext({
            taskDir: worktreeDir, statusFile: path.join(worktreeDir, 'status.json'),
            statusResult: { kind: 'ok', file: path.join(worktreeDir, 'status.json'), status: makeStatus('implement', {
                plan: { status: 'done', agent: 'claude' }, implement: { status: 'in_progress', agent: 'codex' },
            }) },
            heartbeatResult: { kind: 'found', record: makeHeartbeat(7777, clock.now(), ['primary']) },
            canonPid: 7777, resolvedPid: 7777,
        });
        const result = runWatchCommand(['primary', '--follow', '--timeout', '1s'], {
            nowImpl: clock.now, pollIntervalMs: 100,
            sleepImpl: (ms) => {
                clock.sleep(ms);
                polls += 1;
                if (polls === 2) fs.writeFileSync(worktreeLog, 'resumed run first line\n');
                if (polls === 4) fs.appendFileSync(worktreeLog, 'resumed run later line\n');
            },
            gatherContextImpl: () => ctx,
            probeAliveImpl: (pid: number): void => { if (pid !== 7777) throw new Error('unexpected pid'); },
        });
        const output = result.stderr.join('');
        assert.equal(result.exitCode, 5);
        assert.doesNotMatch(output, /first run history/);
        assert.match(output, /resumed run first line\n/);
        assert.match(output, /resumed run later line\n/);
    });
});

void test('watch --follow streams the main-checkout primary log when context is in a worktree', () => {
    withTempDir((root) => {
        const mainDir = path.join(root, 'tasks', 'primary');
        const worktreeDir = path.join(root, 'worktree', 'tasks', 'primary');
        fs.mkdirSync(mainDir, { recursive: true });
        fs.mkdirSync(worktreeDir, { recursive: true });
        fs.writeFileSync(path.join(mainDir, '.canon-run.log'), 'initial log\n');
        fs.writeFileSync(path.join(worktreeDir, 'status.json'), '{}');
        const clock = makeClock();
        let polls = 0;
        const ctx = makeContext({
            taskDir: worktreeDir, statusFile: path.join(worktreeDir, 'status.json'),
            statusResult: { kind: 'ok', file: path.join(worktreeDir, 'status.json'), status: makeStatus('plan', {
                spec_review: { status: 'done', agent: 'claude' }, plan: { status: 'in_progress', agent: 'claude' },
            }) },
            heartbeatResult: { kind: 'found', record: makeHeartbeat(7777, clock.now(), ['primary']) },
            canonPid: 7777, resolvedPid: 7777,
        });
        const result = runWatchCommand(['primary', '--follow', '--timeout', '1s'], {
            nowImpl: clock.now, pollIntervalMs: 100,
            sleepImpl: (ms) => {
                clock.sleep(ms);
                polls += 1;
                if (polls === 1) fs.appendFileSync(path.join(mainDir, '.canon-run.log'), 'streamed from primary\n');
            },
            gatherContextImpl: () => ctx,
            probeAliveImpl: (pid: number): void => { if (pid !== 7777) throw new Error('unexpected pid'); },
        });
        assert.equal(result.exitCode, 5);
        assert.match(result.stderr.join(''), /streamed from primary/);
    });
});

void test('watch help is successful without a summary, and unknown flags include the help pointer', () => {
    const help = runWatchCommand(['t1', '--help'], {});
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout.join(''), /Usage: canon watch/);
    assert.doesNotMatch(help.stdout.join(''), /^state=/m);
    assert.equal(help.stderr.join(''), '');

    const unknown = runWatchCommand(['t1', '--bogus'], {});
    assert.equal(unknown.exitCode, 2);
    assert.match(unknown.stderr.join(''), /Unknown option: --bogus/);
    assert.match(unknown.stderr.join(''), /usage_error\.\n/, 'usage block must end with a newline before the error line');
    assert.match(unknown.stderr.join(''), /Run 'canon watch --help' for usage\./);
    assert.match(unknown.stdout.join(''), /state=usage reason=usage_error/);

    const value = runWatchCommand(['t1', '--until', '--help'], {});
    assert.equal(value.exitCode, 2);
    assert.match(value.stderr.join(''), /Invalid phase for --until: --help/);
});
