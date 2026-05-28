import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { decideStopAction, stopCmd, waitForHeartbeat } from '../src/cli/commands/stop.js';
import { HEARTBEAT_STALE_AFTER_MS, type HeartbeatReadResult, type HeartbeatRecord } from '../scripts/run-task/heartbeat.js';

// ── decideStopAction ─────────────────────────────────────────────────────────
//
// Pure decision logic for `canon stop <id>`. Exercises each branch of the
// state classification matrix, including all regression cases surfaced by
// codex review on commits 4834bdb and 380329b.

const NOW = 1_700_000_000_000;

function freshHeartbeat(pid: number, ageMs = 5_000): HeartbeatRecord {
    return {
        pid,
        started_at_ms: NOW - ageMs - 1_000,
        last_update_ms: NOW - ageMs,
        task_ids: ['t1'],
    };
}

function staleHeartbeat(pid: number, ageMs = HEARTBEAT_STALE_AFTER_MS + 5_000): HeartbeatRecord {
    return {
        pid,
        started_at_ms: NOW - ageMs - 1_000,
        last_update_ms: NOW - ageMs,
        task_ids: ['t1'],
    };
}

function alwaysAlive(_pid: number): boolean { return true; }
function alwaysDead(_pid: number): boolean { return false; }
function aliveOnly(...pids: number[]): (pid: number) => boolean {
    const set = new Set(pids);
    return (pid: number) => set.has(pid);
}

// ── CASE A: neither file present ─────────────────────────────────────────────

void test('decideStopAction: noop when no pid is available anywhere', () => {
    const decision = decideStopAction({
        taskId: 't1',
        canonPid: null,
        heartbeat: null,
        probeAlive: alwaysDead,
        now: NOW,
    });
    assert.equal(decision.kind, 'noop');
    assert.match(decision.message, /not running detached/);
});

// ── CASE B: only .canon-pid present ──────────────────────────────────────────
//
// Codex history on CASE B (chronologically):
//   - bc7672a: parent-written bootstrap heartbeat — flagged as masking
//     boot-time crashes (fresh-looking record after a dead child).
//   - 7385cff: cmdline regex via `ps -p $PID -o command=` — flagged as
//     (a) missing the .bin/canon shim install path, (b) too loose
//     a substring match (false positives → PID-reuse SIGTERMs wrong proc).
//
// Resolution: decideStopAction stays strict — refuse in CASE B with a live
// pid. The wait-for-heartbeat polling in stopCmd is what promotes a
// legitimate launch-window CASE B into a CASE D signal once the child's
// own startHeartbeat tick fires. If we observe CASE B here, the wait
// already gave the child its budget and no heartbeat appeared — either
// crash at startup or system too slow. Refuse is the safe answer.
void test('decideStopAction: REFUSE when canon-pid alive but heartbeat null (wait-for-heartbeat happens in stopCmd)', () => {
    const decision = decideStopAction({
        taskId: 't1',
        canonPid: 12345,
        heartbeat: null,
        probeAlive: aliveOnly(12345),
        now: NOW,
    });
    assert.equal(decision.kind, 'refuse');
    if (decision.kind === 'refuse') {
        assert.match(decision.message, /no \.heartbeat\.json appeared/);
    }
});

void test('decideStopAction: cleanup-stale-pid when .canon-pid points to a dead process and no heartbeat', () => {
    const decision = decideStopAction({
        taskId: 't1',
        canonPid: 12345,
        heartbeat: null,
        probeAlive: alwaysDead,
        now: NOW,
    });
    assert.equal(decision.kind, 'cleanup-stale-pid');
    if (decision.kind === 'cleanup-stale-pid') {
        assert.equal(decision.pid, 12345);
        assert.equal(decision.cleanCanonPid, true);
        assert.equal(decision.cleanHeartbeat, false);
    }
});

// ── CASE C: only .heartbeat.json present (canon-pid write failed) ───────────

void test('decideStopAction: SIGNAL via heartbeat.pid when .canon-pid missing and heartbeat fresh', () => {
    const decision = decideStopAction({
        taskId: 't1',
        canonPid: null,
        heartbeat: freshHeartbeat(67890),
        probeAlive: aliveOnly(67890),
        now: NOW,
    });
    assert.equal(decision.kind, 'signal');
    if (decision.kind === 'signal') {
        assert.equal(decision.pid, 67890);
        assert.equal(decision.source, '.heartbeat.json');
    }
});

void test('decideStopAction: REFUSE when only stale heartbeat present BUT pid is still alive (PID-reuse risk)', () => {
    const decision = decideStopAction({
        taskId: 't1',
        canonPid: null,
        heartbeat: staleHeartbeat(98765),
        probeAlive: alwaysAlive,
        now: NOW,
    });
    assert.equal(decision.kind, 'refuse');
});

// ── REGRESSION (codex P2 round 3a, commit ec3181f) ──────────────────────────
//
// Stale heartbeat + dead pid + no .canon-pid: this is the "orchestrator died
// long ago" case. No live process to protect, no other source of truth.
// Previously returned refuse — leaving the heartbeat file behind forever.
// Now self-heals by cleaning up the dead .heartbeat.json.
void test('decideStopAction: CLEANUP when only stale heartbeat present AND pid is dead (self-heal)', () => {
    const decision = decideStopAction({
        taskId: 't1',
        canonPid: null,
        heartbeat: staleHeartbeat(98765),
        probeAlive: alwaysDead,
        now: NOW,
    });
    assert.equal(decision.kind, 'cleanup-stale-pid');
    if (decision.kind === 'cleanup-stale-pid') {
        assert.equal(decision.pid, 98765);
        assert.equal(decision.cleanCanonPid, false);
        assert.equal(decision.cleanHeartbeat, true);
    }
});

// ── REGRESSION (codex P2, commit 380329b round 2) ────────────────────────────
//
// Heartbeat-only path with dead pid: cleanup must remove .heartbeat.json
// (not just .canon-pid, which is absent in this branch).
void test('decideStopAction: cleanup-stale-pid removes .heartbeat.json when canon-pid missing and heartbeat pid dead', () => {
    const decision = decideStopAction({
        taskId: 't1',
        canonPid: null,
        heartbeat: freshHeartbeat(99),
        probeAlive: alwaysDead,
        now: NOW,
    });
    assert.equal(decision.kind, 'cleanup-stale-pid');
    if (decision.kind === 'cleanup-stale-pid') {
        assert.equal(decision.pid, 99);
        assert.equal(decision.cleanCanonPid, false);
        assert.equal(decision.cleanHeartbeat, true);
    }
});

// ── CASE D: both files present, pids agree ──────────────────────────────────

void test('decideStopAction: SIGNAL when both pid sources agree and heartbeat is fresh', () => {
    const decision = decideStopAction({
        taskId: 't1',
        canonPid: 12345,
        heartbeat: freshHeartbeat(12345),
        probeAlive: aliveOnly(12345),
        now: NOW,
    });
    assert.equal(decision.kind, 'signal');
    if (decision.kind === 'signal') {
        assert.equal(decision.pid, 12345);
        assert.equal(decision.source, '.canon-pid');
    }
});

void test('decideStopAction: cleanup BOTH files when pids agree but process is dead', () => {
    const decision = decideStopAction({
        taskId: 't1',
        canonPid: 12345,
        heartbeat: freshHeartbeat(12345),
        probeAlive: alwaysDead,
        now: NOW,
    });
    assert.equal(decision.kind, 'cleanup-stale-pid');
    if (decision.kind === 'cleanup-stale-pid') {
        assert.equal(decision.cleanCanonPid, true);
        assert.equal(decision.cleanHeartbeat, true);
    }
});

void test('decideStopAction: REFUSE when pids agree but heartbeat is stale', () => {
    const decision = decideStopAction({
        taskId: 't1',
        canonPid: 12345,
        heartbeat: staleHeartbeat(12345),
        probeAlive: alwaysAlive,
        now: NOW,
    });
    assert.equal(decision.kind, 'refuse');
    if (decision.kind === 'refuse') {
        assert.match(decision.message, /heartbeat is stale/);
    }
});

// ── CASE D: both files present, pids disagree ───────────────────────────────

// ── REGRESSION (codex P1, commit 380329b round 2) ────────────────────────────
//
// Stale .canon-pid pointing at a dead process + fresh heartbeat for a
// different live process: must signal the heartbeat pid, NOT cleanup and
// exit. Previously the early !isAlive check on canon-pid short-circuited
// the heartbeat fallback for the most common .canon-pid-write-failure
// recovery case.
void test('decideStopAction: SIGNAL via heartbeat.pid when .canon-pid is dead and heartbeat is fresh+alive (recovery case)', () => {
    const decision = decideStopAction({
        taskId: 't1',
        canonPid: 100, // dead from prior run
        heartbeat: freshHeartbeat(200), // current orchestrator
        probeAlive: aliveOnly(200), // 100 dead, 200 alive
        now: NOW,
    });
    assert.equal(decision.kind, 'signal');
    if (decision.kind === 'signal') {
        assert.equal(decision.pid, 200);
        assert.equal(decision.source, '.heartbeat.json');
        assert.match(decision.message, /stale/);
    }
});

void test('decideStopAction: REFUSE when both canon-pid AND heartbeat point to different live processes', () => {
    // True PID-reuse signature: prior orchestrator's .canon-pid is now in use
    // by another live process, AND a new canon orchestrator is alive via
    // heartbeat. Can't tell which is "our" canon safely.
    const decision = decideStopAction({
        taskId: 't1',
        canonPid: 100,
        heartbeat: freshHeartbeat(200),
        probeAlive: aliveOnly(100, 200),
        now: NOW,
    });
    assert.equal(decision.kind, 'refuse');
    if (decision.kind === 'refuse') {
        assert.match(decision.message, /PID reuse|disagree/);
    }
});

void test('decideStopAction: REFUSE when pids disagree and heartbeat is stale', () => {
    const decision = decideStopAction({
        taskId: 't1',
        canonPid: 100,
        heartbeat: staleHeartbeat(200),
        probeAlive: aliveOnly(100),
        now: NOW,
    });
    assert.equal(decision.kind, 'refuse');
    if (decision.kind === 'refuse') {
        assert.match(decision.message, /ambiguous/);
    }
});

// ── REGRESSION (codex P2 round 3b, commit ec3181f) ──────────────────────────
//
// Both pid sources disagree AND both are dead: previously fell through to
// ambiguous refuse, stranding both files. Now self-heals — there's no live
// process to protect against an erroneous signal.
void test('decideStopAction: CLEANUP when both pids disagree AND both are dead (self-heal)', () => {
    const decision = decideStopAction({
        taskId: 't1',
        canonPid: 100,
        heartbeat: freshHeartbeat(200),
        probeAlive: alwaysDead,
        now: NOW,
    });
    assert.equal(decision.kind, 'cleanup-stale-pid');
    if (decision.kind === 'cleanup-stale-pid') {
        assert.equal(decision.cleanCanonPid, true);
        assert.equal(decision.cleanHeartbeat, true);
    }
});

// ── waitForHeartbeat (pure; injected deps) ───────────────────────────────────
//
// Deterministic, synchronous tests of the launch-window poller. Drives
// readImpl + sleepImpl + nowImpl as fakes so the loop completes instantly
// regardless of real wall-clock or real fs. No process.pid, no real
// process.kill, no spawned children — those would tangle the polling
// behavior with the harness's own lifecycle (and risk signaling the test
// runner itself).

interface FakeClock {
    now: () => number;
    sleep: (ms: number) => void;
    advance: (ms: number) => void;
    elapsed: () => number;
}

function makeFakeClock(): FakeClock {
    let t = 1_000_000_000_000;
    const initial = t;
    return {
        now: () => t,
        sleep: (ms: number) => { t += ms; },
        advance: (ms: number) => { t += ms; },
        elapsed: () => t - initial,
    };
}

void test('waitForHeartbeat: returns found when readImpl produces a record after N polls', () => {
    const clock = makeFakeClock();
    let calls = 0;
    const readImpl = (): HeartbeatReadResult => {
        calls += 1;
        if (calls < 5) return { kind: 'missing' };
        return {
            kind: 'found',
            record: { pid: 12345, started_at_ms: 0, last_update_ms: clock.now(), task_ids: ['t1'] },
        };
    };

    const result = waitForHeartbeat('/fake-dir', {
        timeoutMs: 30_000,
        pollIntervalMs: 250,
        readImpl,
        sleepImpl: clock.sleep,
        nowImpl: clock.now,
    });

    assert.equal(result.kind, 'found');
    if (result.kind === 'found') {
        assert.equal(result.record.pid, 12345);
    }
    // 4 misses + 1 found = ~1s elapsed at 250ms poll. Sanity-check the loop
    // wasn't spinning faster than the configured interval.
    assert.equal(calls, 5);
    assert.ok(clock.elapsed() >= 4 * 250, `expected >=1000ms elapsed, got ${clock.elapsed()}ms`);
});

void test('waitForHeartbeat: returns timeout when readImpl never produces', () => {
    const clock = makeFakeClock();
    const readImpl = (): HeartbeatReadResult => ({ kind: 'missing' });

    const result = waitForHeartbeat('/fake-dir', {
        timeoutMs: 5_000,
        pollIntervalMs: 250,
        readImpl,
        sleepImpl: clock.sleep,
        nowImpl: clock.now,
    });

    assert.equal(result.kind, 'timeout');
    assert.ok(clock.elapsed() >= 5_000, `expected timeout >=5000ms, got ${clock.elapsed()}ms`);
});

void test('waitForHeartbeat: returns pid-died when isStillAlive flips false mid-poll', () => {
    const clock = makeFakeClock();
    const readImpl = (): HeartbeatReadResult => ({ kind: 'missing' });
    let aliveChecks = 0;
    const isStillAlive = (): boolean => {
        aliveChecks += 1;
        return aliveChecks < 3; // alive on poll 1 and 2, dead on poll 3
    };

    const result = waitForHeartbeat('/fake-dir', {
        timeoutMs: 30_000,
        pollIntervalMs: 250,
        readImpl,
        sleepImpl: clock.sleep,
        nowImpl: clock.now,
        isStillAlive,
    });

    assert.equal(result.kind, 'pid-died');
    assert.ok(clock.elapsed() < 5_000, `expected to bail early, but elapsed ${clock.elapsed()}ms`);
});

void test('waitForHeartbeat: returns corrupt immediately when readImpl reports corrupt', () => {
    const clock = makeFakeClock();
    const readImpl = (): HeartbeatReadResult => ({ kind: 'corrupt', reason: 'invalid JSON: ...' });

    const result = waitForHeartbeat('/fake-dir', {
        timeoutMs: 30_000,
        pollIntervalMs: 250,
        readImpl,
        sleepImpl: clock.sleep,
        nowImpl: clock.now,
    });

    assert.equal(result.kind, 'corrupt');
    if (result.kind === 'corrupt') {
        assert.match(result.reason, /invalid JSON/);
    }
    // No sleeps for a fast-fail path.
    assert.equal(clock.elapsed(), 0);
});

void test('waitForHeartbeat: invokes onWaitStart exactly once', () => {
    const clock = makeFakeClock();
    const readImpl = (): HeartbeatReadResult => ({ kind: 'missing' });
    let waitStartCalls = 0;
    const onWaitStart = (): void => { waitStartCalls += 1; };

    waitForHeartbeat('/fake-dir', {
        timeoutMs: 2_000,
        pollIntervalMs: 250,
        readImpl,
        sleepImpl: clock.sleep,
        nowImpl: clock.now,
        onWaitStart,
    });

    assert.equal(waitStartCalls, 1, 'onWaitStart should fire exactly once across all polls');
});

void test('waitForHeartbeat: does NOT invoke onWaitStart when heartbeat appears on first read', () => {
    const clock = makeFakeClock();
    const readImpl = (): HeartbeatReadResult => ({
        kind: 'found',
        record: { pid: 1, started_at_ms: 0, last_update_ms: 0, task_ids: ['t1'] },
    });
    let waitStartCalls = 0;
    const onWaitStart = (): void => { waitStartCalls += 1; };

    const result = waitForHeartbeat('/fake-dir', {
        timeoutMs: 30_000,
        pollIntervalMs: 250,
        readImpl,
        sleepImpl: clock.sleep,
        nowImpl: clock.now,
        onWaitStart,
    });

    assert.equal(result.kind, 'found');
    assert.equal(waitStartCalls, 0, 'no operator message when no wait was needed');
});

// ── stopCmd integration test (non-spawning; injected deps) ───────────────────
//
// Drives stopCmd end-to-end through CASE B → wait → signal, without
// process.kill against any real PID and without spawning processes. The
// fake `kill` simulates a live canon that responds to SIGTERM by going
// "dead" on the next signal-0 probe.

void test('stopCmd: CASE B path — waits for heartbeat, then signals successfully', () => {
    withTempDirForStop((dir) => {
        // Setup: .canon-pid exists, .heartbeat.json will appear after 3 polls.
        const targetPid = 99999;
        fs.writeFileSync(path.join(dir, '.canon-pid'), `${targetPid}\n`, 'utf8');

        const clock = makeFakeClock();
        let readCalls = 0;
        const readImpl = (_dir: string): HeartbeatReadResult => {
            readCalls += 1;
            if (readCalls < 4) return { kind: 'missing' };
            return {
                kind: 'found',
                record: { pid: targetPid, started_at_ms: 0, last_update_ms: clock.now(), task_ids: ['t1'] },
            };
        };

        // Fake kill: signal 0 reports alive until SIGTERM lands, then dead.
        let sigtermSent = false;
        const killSignals: Array<{ pid: number; signal: NodeJS.Signals | 0 }> = [];
        const kill = (pid: number, sig: NodeJS.Signals | 0): void => {
            killSignals.push({ pid, signal: sig });
            if (sig === 0) {
                if (sigtermSent) {
                    const err = new Error('ESRCH') as NodeJS.ErrnoException;
                    err.code = 'ESRCH';
                    throw err;
                }
                return;
            }
            if (sig === 'SIGTERM') sigtermSent = true;
        };

        let exitCode: number | null = null;
        const exit = ((code: number): never => {
            exitCode = code;
            throw new HaltExit();
        });
        const stdoutLines: string[] = [];
        const stderrLines: string[] = [];

        try {
            stopCmd(['t1'], {
                kill,
                exit,
                stdout: (s) => { stdoutLines.push(s); },
                stderr: (s) => { stderrLines.push(s); },
                readHeartbeatStatusImpl: readImpl,
                readCanonPidImpl: () => targetPid,
                sleepImpl: clock.sleep,
                nowImpl: clock.now,
                waitTimeoutMs: 30_000,
                dirOverride: dir,
                skipFsCleanup: true,
            });
        } catch (e) {
            if (!(e instanceof HaltExit)) throw e;
        }

        assert.equal(exitCode, 0, `expected exit 0, got ${exitCode}; stderr=${stderrLines.join('\n')}`);
        // First operator-facing line should be the waiting banner.
        assert.ok(
            stdoutLines.some(line => /waiting for orchestrator/i.test(line)),
            `expected a 'waiting for orchestrator' line; got: ${stdoutLines.join(' | ')}`,
        );
        // SIGTERM must have been sent to the right pid via the process-group form.
        const sigterms = killSignals.filter(s => s.signal === 'SIGTERM');
        assert.ok(sigterms.length > 0, 'expected at least one SIGTERM');
        assert.ok(
            sigterms.some(s => s.pid === -targetPid || s.pid === targetPid),
            `expected SIGTERM to pid ${targetPid} (or -${targetPid}); got ${JSON.stringify(sigterms)}`,
        );
    });
});

// ── REGRESSION (codex PR #113 P2 — race during the launch-window wait) ───────
//
// stopCmd was reading .canon-pid and .heartbeat.json ONCE before the wait,
// then reusing that snapshot for the post-wait decideStopAction call. If the
// original orchestrator dies and a new run starts on the same task while
// canon stop is waiting, the stale snapshot routes to the wrong branch and
// can delete the NEW run's runtime state. The fix re-reads both files after
// the wait completes.
void test('stopCmd: re-reads .canon-pid + .heartbeat.json after the wait (race recovery)', () => {
    withTempDirForStop((dir) => {
        const originalPid = 11111;
        const newPid = 22222;

        // Pre-state: original orchestrator's .canon-pid on disk; no heartbeat.
        fs.writeFileSync(path.join(dir, '.canon-pid'), `${originalPid}\n`, 'utf8');

        const clock = makeFakeClock();
        let readCanonPidCalls = 0;
        const readCanonPidImpl = (_dir: string): number | null => {
            readCanonPidCalls += 1;
            // First call (before the wait) returns the original pid.
            // Second call (after the wait) returns the new pid — a new run
            // wrote a fresh .canon-pid during the wait.
            return readCanonPidCalls === 1 ? originalPid : newPid;
        };

        let readHeartbeatCalls = 0;
        const readHeartbeatStatusImpl = (_dir: string): HeartbeatReadResult => {
            readHeartbeatCalls += 1;
            // Pre-wait call: missing. Wait-loop calls: missing (forces the
            // pid-died exit via isStillAlive going false). Post-wait re-read:
            // fresh heartbeat for the NEW pid.
            if (readHeartbeatCalls === 1) return { kind: 'missing' };
            if (readHeartbeatCalls < 6) return { kind: 'missing' };
            return {
                kind: 'found',
                record: { pid: newPid, started_at_ms: 0, last_update_ms: clock.now(), task_ids: ['t1'] },
            };
        };

        // Fake kill: the original pid dies after the wait loop's third poll;
        // the new pid is alive throughout. SIGTERM to new pid succeeds.
        let probesSinceWaitStart = 0;
        let waitStarted = false;
        let newPidSigtermSent = false;
        const killSignals: Array<{ pid: number; signal: NodeJS.Signals | 0 }> = [];
        const kill = (pid: number, sig: NodeJS.Signals | 0): void => {
            killSignals.push({ pid, signal: sig });
            if (sig === 0) {
                if (pid === originalPid) {
                    if (waitStarted) probesSinceWaitStart += 1;
                    if (probesSinceWaitStart >= 3) {
                        const err = new Error('ESRCH') as NodeJS.ErrnoException;
                        err.code = 'ESRCH';
                        throw err;
                    }
                    return;
                }
                if (pid === newPid) {
                    if (newPidSigtermSent) {
                        const err = new Error('ESRCH') as NodeJS.ErrnoException;
                        err.code = 'ESRCH';
                        throw err;
                    }
                    return;
                }
                const err = new Error('ESRCH') as NodeJS.ErrnoException;
                err.code = 'ESRCH';
                throw err;
            }
            if (sig === 'SIGTERM') {
                if (pid === newPid || pid === -newPid) newPidSigtermSent = true;
            }
        };

        // Mark "wait started" so the kill fake knows to start the death
        // countdown for originalPid on subsequent signal-0 probes.
        const sleepImpl = (ms: number): void => {
            waitStarted = true;
            clock.sleep(ms);
        };

        let exitCode: number | null = null;
        const exit = ((code: number): never => {
            exitCode = code;
            throw new HaltExit();
        });
        const stdoutLines: string[] = [];
        const stderrLines: string[] = [];

        try {
            stopCmd(['t1'], {
                kill,
                exit,
                stdout: (s) => { stdoutLines.push(s); },
                stderr: (s) => { stderrLines.push(s); },
                readHeartbeatStatusImpl,
                readCanonPidImpl,
                sleepImpl,
                nowImpl: clock.now,
                waitTimeoutMs: 30_000,
                dirOverride: dir,
                skipFsCleanup: true,
            });
        } catch (e) {
            if (!(e instanceof HaltExit)) throw e;
        }

        // Crucially: SIGTERM landed on the NEW pid, not the original.
        // If the bug were present, decideStopAction would have seen
        // canonPid=originalPid (dead) + heartbeat=null and routed to
        // cleanup-stale-pid for originalPid — never touching newPid.
        assert.equal(
            exitCode,
            0,
            `expected exit 0 (signal sent to new pid); got ${exitCode}; stderr=${stderrLines.join('\n')}`,
        );
        const sigterms = killSignals.filter(s => s.signal === 'SIGTERM');
        assert.ok(
            sigterms.some(s => s.pid === newPid || s.pid === -newPid),
            `expected SIGTERM to NEW pid ${newPid}; got ${JSON.stringify(sigterms)}`,
        );
        assert.ok(
            !sigterms.some(s => s.pid === originalPid || s.pid === -originalPid),
            `must NOT have SIGTERM'd the original (dead) pid ${originalPid}; got ${JSON.stringify(sigterms)}`,
        );
        // Confirms the re-read actually fired (canon-pid read at least twice).
        assert.ok(readCanonPidCalls >= 2, `expected >=2 .canon-pid reads, got ${readCanonPidCalls}`);
    });
});

void test('stopCmd: waitTimeoutMs override — refuses fast when heartbeat never appears', () => {
    withTempDirForStop((dir) => {
        const targetPid = 99999;
        fs.writeFileSync(path.join(dir, '.canon-pid'), `${targetPid}\n`, 'utf8');

        const clock = makeFakeClock();
        // Always missing — never produces a heartbeat.
        const readImpl = (_dir: string): HeartbeatReadResult => ({ kind: 'missing' });

        const kill = (pid: number, sig: NodeJS.Signals | 0): void => {
            if (sig === 0) return; // always alive in this test
            // No SIGTERM should ever fire — we expect refuse before signaling.
            throw new Error(`unexpected signal: pid=${pid} sig=${String(sig)}`);
        };

        let exitCode: number | null = null;
        const exit = ((code: number): never => {
            exitCode = code;
            throw new HaltExit();
        });
        const stderrLines: string[] = [];

        try {
            stopCmd(['t1'], {
                kill,
                exit,
                stdout: () => undefined,
                stderr: (s) => { stderrLines.push(s); },
                readHeartbeatStatusImpl: readImpl,
                readCanonPidImpl: () => targetPid,
                sleepImpl: clock.sleep,
                nowImpl: clock.now,
                waitTimeoutMs: 2_000,
                dirOverride: dir,
                skipFsCleanup: true,
            });
        } catch (e) {
            if (!(e instanceof HaltExit)) throw e;
        }

        assert.equal(exitCode, 1, 'refuse should exit 1');
        assert.ok(
            stderrLines.some(line => /no \.heartbeat\.json appeared/.test(line)),
            `expected refuse message about missing heartbeat; got: ${stderrLines.join(' | ')}`,
        );
        // Elapsed wall-time should be close to the override, not the default.
        assert.ok(
            clock.elapsed() >= 2_000 && clock.elapsed() < 30_000,
            `expected ~2s elapsed (override budget), got ${clock.elapsed()}ms`,
        );
    });
});

class HaltExit extends Error {}

function withTempDirForStop(fn: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-int-'));
    try { fn(dir); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
