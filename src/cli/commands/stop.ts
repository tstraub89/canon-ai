// src/cli/commands/stop.ts
//
// `canon stop <task-id>` — gracefully terminate a detached orchestrator.
//
// Verifying that a PID actually belongs to canon is the hard part. The
// orchestrator writes two runtime files:
//   - .canon-pid       — parent writes synchronously before exit (proof of
//                        "we started a child, here's its PID")
//   - .heartbeat.json  — child writes every 30s once it reaches startHeartbeat
//                        (proof of life: "canon code with this PID is running
//                        right now")
//
// .heartbeat.json is the load-bearing proof. It's written by canon's own
// code with canon's PID — no file-based check that's purely metadata (e.g.
// .canon-pid mtime) and no cmdline-based check (e.g. matching `ps -p` output
// against a regex) can distinguish "our live canon" from "OS recycled the
// PID to an unrelated process" as reliably as the heartbeat does. So canon
// stop centers around the heartbeat:
//   - CASE D (both files present) — heartbeat freshness drives the decision
//   - CASE C (heartbeat only) — heartbeat freshness + probeAlive
//   - CASE B (canon-pid only — i.e. launch window) — wait for the heartbeat
//                          to materialize, then re-decide. Polling lives in
//                          stopCmd (see waitForHeartbeat); decideStopAction
//                          itself stays pure and treats CASE B as "refuse
//                          unless polling already promoted us to CASE D."
//
// History of the CASE B handling, abridged:
//   - bc7672a tried having the parent write a bootstrap heartbeat record.
//     Codex flagged it: the parent-written record looks identical to a real
//     child tick, masking boot-time crashes.
//   - 7385cff tried verifying the PID via `ps -p $PID -o command=` matched
//     against `/canon-ai|run-task/`. Codex flagged it: missed standard
//     `.bin/canon` shim cmdlines (false-refuses live runs) and matched any
//     unrelated process whose argv happened to contain the substring (false
//     positives → PID reuse can still hit the wrong process).
//   - This iteration drops the cmdline heuristic and waits for the child's
//     own heartbeat write to prove identity.

import { existsSync } from 'fs';

import { readCanonPid, removeCanonPid, runLogPathFor } from '../../orchestrator/detach.js';
import {
    type HeartbeatReadResult,
    type HeartbeatRecord,
    isHeartbeatStale,
    readHeartbeatStatus,
    removeHeartbeat,
} from '../../orchestrator/heartbeat.js';
import { probePidAlive, tolerantTaskDir } from '../../orchestrator/run-context.js';
import { formatAge } from './doctor.js';

const SIGTERM_GRACE_MS = 10_000;
const SIGTERM_POLL_INTERVAL_MS = 200;

// Wait-for-heartbeat default. The detached child reaches `startHeartbeat`
// after Node boot + tsx loader + canon's module graph + `parseArgs` +
// `checkDeps` — typically <2s on a dev machine, <10s on slow filesystems
// or large bundles. 30s buys roughly a 3× safety margin while keeping
// canon stop's worst-case CLI latency tolerable. Override with the
// CANON_STOP_WAIT_MS env var when running against pathologically slow
// systems.
export const STOP_WAIT_DEFAULT_MS = 30_000;
export const STOP_WAIT_POLL_INTERVAL_MS = 250;

// ── waitForHeartbeat (pure-ish; testable via injected deps) ──────────────────

export interface WaitForHeartbeatOpts {
    timeoutMs: number;
    pollIntervalMs?: number;
    readImpl?: (dir: string) => HeartbeatReadResult;
    sleepImpl?: (ms: number) => void;
    nowImpl?: () => number;
    /**
     * Optional liveness gate: if the PID we're waiting on died mid-poll,
     * stop waiting and return `pid-died` so the caller can route to
     * cleanup instead of timing out.
     */
    isStillAlive?: () => boolean;
    /**
     * Invoked exactly once, immediately before the first sleep, so the
     * caller can emit a "Waiting for orchestrator's first heartbeat..."
     * progress line to the operator. Not invoked at all if the heartbeat
     * appears on the very first read (no wait needed).
     */
    onWaitStart?: () => void;
}

export type WaitResult =
    | { kind: 'found'; record: HeartbeatRecord }
    | { kind: 'corrupt'; reason: string }
    | { kind: 'unreadable'; reason: string }
    | { kind: 'pid-died' }
    | { kind: 'timeout' };

/**
 * Poll for a task's heartbeat file to appear (or be revealed as broken).
 *
 * - `found`: heartbeat materialized within the timeout. Caller falls back
 *   to standard heartbeat-based decision logic.
 * - `corrupt` / `unreadable`: file exists but is broken. Bail out
 *   immediately — polling against this won't get any better.
 * - `pid-died`: `isStillAlive` flipped false during the wait. Treat as
 *   cleanup-stale-pid (the orchestrator died before writing a heartbeat).
 * - `timeout`: deadline elapsed with the file still missing. Treat as
 *   refuse — orchestrator may have crashed at startup, or system is too
 *   slow to write a heartbeat within the configured budget.
 */
export function waitForHeartbeat(dir: string, opts: WaitForHeartbeatOpts): WaitResult {
    const read = opts.readImpl ?? readHeartbeatStatus;
    const sleep = opts.sleepImpl ?? sleepSync;
    const now = opts.nowImpl ?? Date.now;
    const interval = opts.pollIntervalMs ?? STOP_WAIT_POLL_INTERVAL_MS;
    const deadline = now() + opts.timeoutMs;

    let onWaitStartInvoked = false;
    const announce = (): void => {
        if (onWaitStartInvoked) return;
        onWaitStartInvoked = true;
        if (opts.onWaitStart) opts.onWaitStart();
    };

    // Loop until the deadline OR a terminal outcome.
    while (now() < deadline) {
        const result = read(dir);
        if (result.kind === 'found') return { kind: 'found', record: result.record };
        if (result.kind === 'corrupt') return { kind: 'corrupt', reason: result.reason };
        if (result.kind === 'unreadable') return { kind: 'unreadable', reason: result.reason };
        // result.kind === 'missing' → keep polling unless the pid died.
        if (opts.isStillAlive && !opts.isStillAlive()) return { kind: 'pid-died' };
        announce();
        sleep(interval);
    }

    // Deadline passed. One final read in case the heartbeat appeared during
    // the last sleep — gives writers fighting the deadline a fair shot.
    const final = read(dir);
    if (final.kind === 'found') return { kind: 'found', record: final.record };
    if (final.kind === 'corrupt') return { kind: 'corrupt', reason: final.reason };
    if (final.kind === 'unreadable') return { kind: 'unreadable', reason: final.reason };
    return { kind: 'timeout' };
}

// ── Decision logic (pure; testable) ──────────────────────────────────────────

export type StopAction =
    | { kind: 'noop'; message: string }
    | { kind: 'cleanup-stale-pid'; pid: number; cleanCanonPid: boolean; cleanHeartbeat: boolean; message: string }
    | { kind: 'refuse'; pid: number; message: string }
    | { kind: 'signal'; pid: number; source: '.canon-pid' | '.heartbeat.json'; message: string };

export interface DecideStopInputs {
    taskId: string;
    canonPid: number | null;
    heartbeat: HeartbeatRecord | null;
    /**
     * Probe whether a given PID is currently a running process. Pure function
     * boundary: tests pass deterministic fakes; production passes a wrapper
     * around `process.kill(pid, 0)`.
     */
    probeAlive: (pid: number) => boolean;
    now?: number;
}

/**
 * Decide what `canon stop <id>` should do given observed task state.
 *
 * Decision tree:
 *
 * CASE A — neither file present:
 *   → noop. Task isn't running detached.
 *
 * CASE B — only .canon-pid present:
 *   - alive → refuse. The launch-window polling in stopCmd is supposed
 *     to promote this case to CASE D once the heartbeat appears; if we
 *     still see CASE B post-poll, the heartbeat never materialized
 *     (orchestrator crashed at startup, or system is too slow). Refusing
 *     here protects against PID-reuse without trusting a cmdline regex.
 *   - dead  → cleanup-stale-pid (.canon-pid only)
 *
 * CASE C — only .heartbeat.json present (canon-pid write failed at detach
 * time — the bundle-member fallback path from earlier codex iterations):
 *   - pid dead              → cleanup-stale-pid (.heartbeat.json only)
 *   - stale heartbeat, pid alive → refuse (PID may be recycled)
 *   - fresh heartbeat, pid alive → signal via .heartbeat.json
 *
 * CASE D — both files present, pids agree:
 *   - dead                  → cleanup-stale-pid (both)
 *   - alive, stale heartbeat → refuse
 *   - alive, fresh heartbeat → signal via .canon-pid
 *
 * CASE D-disagree — both present, pids different:
 *   - canon-pid dead, heartbeat alive + fresh → signal via .heartbeat.json
 *     (canon-pid lingered from a prior run; new orchestrator owns heartbeat)
 *   - both alive, heartbeat fresh → refuse (PID reuse signature)
 *   - both dead                   → cleanup both
 *   - other combos                → refuse (ambiguous)
 */
export function decideStopAction(inputs: DecideStopInputs): StopAction {
    const { taskId, canonPid, heartbeat, probeAlive } = inputs;
    const now = inputs.now ?? Date.now();
    const heartbeatFresh = heartbeat != null && !isHeartbeatStale(heartbeat, now);
    const heartbeatStale = heartbeat != null && isHeartbeatStale(heartbeat, now);

    // CASE A
    if (canonPid == null && heartbeat == null) {
        return {
            kind: 'noop',
            message: `canon stop: task '${taskId}' is not running detached (no .canon-pid or .heartbeat.json found, or already stopped).`,
        };
    }

    // CASE B — only .canon-pid present (heartbeat null).
    if (canonPid != null && heartbeat == null) {
        if (!probeAlive(canonPid)) {
            return {
                kind: 'cleanup-stale-pid',
                pid: canonPid,
                cleanCanonPid: true,
                cleanHeartbeat: false,
                message: `canon stop: PID ${canonPid} for task '${taskId}' is not alive. Cleaning up stale .canon-pid.`,
            };
        }
        return {
            kind: 'refuse',
            pid: canonPid,
            message:
                `canon stop: .canon-pid says pid=${canonPid} but no .heartbeat.json appeared. ` +
                `The orchestrator either crashed before its first heartbeat tick or the system is too slow. ` +
                `Signaling would risk hitting an unrelated process if the OS recycled the PID. ` +
                `Check the run log for boot output, then: rm tasks/${taskId}/.canon-pid before retrying.`,
        };
    }

    // CASE C — only .heartbeat.json present (canon-pid null).
    if (canonPid == null && heartbeat != null) {
        const heartbeatPidAlive = probeAlive(heartbeat.pid);
        if (!heartbeatPidAlive) {
            return {
                kind: 'cleanup-stale-pid',
                pid: heartbeat.pid,
                cleanCanonPid: false,
                cleanHeartbeat: true,
                message: `canon stop: heartbeat PID ${heartbeat.pid} for task '${taskId}' is not alive. Cleaning up stale .heartbeat.json.`,
            };
        }
        if (heartbeatStale) {
            const age = formatAge(now - heartbeat.last_update_ms);
            return {
                kind: 'refuse',
                pid: heartbeat.pid,
                message:
                    `canon stop: heartbeat is stale (${age} ago) and there is no .canon-pid, but PID ${heartbeat.pid} is alive. ` +
                    `Cannot determine if it's our canon orchestrator or a recycled PID. ` +
                    `Refusing to signal. If you're sure: rm tasks/${taskId}/.heartbeat.json`,
            };
        }
        return {
            kind: 'signal',
            pid: heartbeat.pid,
            source: '.heartbeat.json',
            message: `canon stop: sending SIGTERM to canon orchestrator (pid=${heartbeat.pid}, task='${taskId}', source=.heartbeat.json)`,
        };
    }

    // CASE D — both files present. Re-assert non-null for TS narrowing.
    if (canonPid == null || heartbeat == null) {
        return {
            kind: 'noop',
            message: `canon stop: task '${taskId}' is not running detached (state classification bug).`,
        };
    }

    const canonAlive = probeAlive(canonPid);

    if (canonPid === heartbeat.pid) {
        if (!canonAlive) {
            return {
                kind: 'cleanup-stale-pid',
                pid: canonPid,
                cleanCanonPid: true,
                cleanHeartbeat: true,
                message: `canon stop: PID ${canonPid} for task '${taskId}' is not alive. Cleaning up both .canon-pid and .heartbeat.json.`,
            };
        }
        if (heartbeatStale) {
            const age = formatAge(now - heartbeat.last_update_ms);
            return {
                kind: 'refuse',
                pid: canonPid,
                message:
                    `canon stop: heartbeat is stale (${age} ago) for task '${taskId}'. ` +
                    `Orchestrator may already be dead and PID ${canonPid} may have been recycled. ` +
                    `Refusing to signal. If you're sure: rm tasks/${taskId}/.canon-pid tasks/${taskId}/.heartbeat.json`,
            };
        }
        return {
            kind: 'signal',
            pid: canonPid,
            source: '.canon-pid',
            message: `canon stop: sending SIGTERM to canon orchestrator (pid=${canonPid}, task='${taskId}', source=.canon-pid)`,
        };
    }

    // Pids disagree. Probe heartbeat side too.
    const heartbeatPidAlive = probeAlive(heartbeat.pid);

    if (!canonAlive && heartbeatPidAlive && heartbeatFresh) {
        return {
            kind: 'signal',
            pid: heartbeat.pid,
            source: '.heartbeat.json',
            message:
                `canon stop: .canon-pid (${canonPid}) is stale; ` +
                `signaling live heartbeat PID ${heartbeat.pid} (task='${taskId}', source=.heartbeat.json)`,
        };
    }

    if (canonAlive && heartbeatPidAlive && heartbeatFresh) {
        return {
            kind: 'refuse',
            pid: canonPid,
            message:
                `canon stop: .canon-pid (${canonPid}) and heartbeat pid (${heartbeat.pid}) are both alive but disagree. ` +
                `This is the signature of PID reuse or a stale state. Refusing to signal. Investigate manually.`,
        };
    }

    if (!canonAlive && !heartbeatPidAlive) {
        return {
            kind: 'cleanup-stale-pid',
            pid: canonPid,
            cleanCanonPid: true,
            cleanHeartbeat: true,
            message:
                `canon stop: both .canon-pid (${canonPid}) and heartbeat pid (${heartbeat.pid}) are dead for task '${taskId}'. ` +
                `Cleaning up stale runtime state.`,
        };
    }

    return {
        kind: 'refuse',
        pid: canonPid,
        message:
            `canon stop: ambiguous state for task '${taskId}' — ` +
            `.canon-pid=${canonPid} (alive=${canonAlive}), heartbeat.pid=${heartbeat.pid} (alive=${heartbeatPidAlive}, fresh=${heartbeatFresh}). ` +
            `Refusing to signal. Investigate; if needed: rm tasks/${taskId}/.canon-pid tasks/${taskId}/.heartbeat.json`,
    };
}

// ── Production-side wiring helpers ───────────────────────────────────────────

function sleepSync(ms: number): void {
    // Synchronous wait via Atomics.wait. CLI is one-shot — no event loop
    // interactivity to preserve, no other work to interleave.
    const buf = new SharedArrayBuffer(4);
    const view = new Int32Array(buf);
    Atomics.wait(view, 0, 0, ms);
}

// ── stopCmd with injectable deps for testing ─────────────────────────────────

/**
 * Dependency-injection bag for `stopCmd`. Production calls `stopCmd(args)`
 * with no deps (defaults to real process.kill / process.exit / console /
 * file-system reads). Tests pass fakes to exercise the CASE B → wait →
 * signal path without spawning processes or touching the real test runner.
 */
export interface StopCmdDeps {
    kill?: (pid: number, signal: NodeJS.Signals | 0) => void;
    exit?: (code: number) => never;
    stdout?: (s: string) => void;
    stderr?: (s: string) => void;
    /** Pre-read state — when set, bypasses the production fs reads. Used
     * in tests to inject a known canon-pid without writing a temp file. */
    readCanonPidImpl?: (dir: string) => number | null;
    readHeartbeatStatusImpl?: (dir: string) => HeartbeatReadResult;
    /** Used for the post-SIGTERM and SIGKILL polling loops AND for the
     * wait-for-heartbeat poller. */
    sleepImpl?: (ms: number) => void;
    nowImpl?: () => number;
    /** Override the env var / default. */
    waitTimeoutMs?: number;
    /** Override the task-dir resolver — tests pass an absolute path so
     * they don't need a fake worktree layout. */
    dirOverride?: string;
    /** Skip filesystem cleanup (.canon-pid / .heartbeat.json removal) so
     * tests can inspect the post-decision state. */
    skipFsCleanup?: boolean;
}

function readWaitTimeoutMs(deps: StopCmdDeps): number {
    if (typeof deps.waitTimeoutMs === 'number' && deps.waitTimeoutMs >= 0) {
        return deps.waitTimeoutMs;
    }
    const raw = process.env.CANON_STOP_WAIT_MS;
    if (raw != null) {
        const parsed = Number.parseInt(raw, 10);
        if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    return STOP_WAIT_DEFAULT_MS;
}

export function stopCmd(args: string[], deps: StopCmdDeps = {}): void {
    const kill = deps.kill ?? ((pid: number, sig: NodeJS.Signals | 0): void => { process.kill(pid, sig); });
    const exit = deps.exit ?? ((code: number): never => process.exit(code));
    const stdout = deps.stdout ?? ((s: string): void => { console.log(s); });
    const stderr = deps.stderr ?? ((s: string): void => { console.error(s); });
    const sleep = deps.sleepImpl ?? sleepSync;
    const now = deps.nowImpl ?? Date.now;
    const readCanonPidFn = deps.readCanonPidImpl ?? readCanonPid;
    const readHeartbeatStatusFn = deps.readHeartbeatStatusImpl ?? readHeartbeatStatus;
    const waitTimeoutMs = readWaitTimeoutMs(deps);

    const probeAlive = (pid: number): boolean => probePidAlive(pid, (value: number): void => { kill(value, 0); });

    const taskId = args[0];
    if (!taskId) {
        stderr('Usage: canon stop <task-id>');
        return exit(1);
    }

    const dir = deps.dirOverride ?? tolerantTaskDir(taskId);
    if (!deps.dirOverride && !existsSync(dir)) {
        stderr(`canon stop: task '${taskId}' not found (looked in ${dir})`);
        return exit(1);
    }

    let canonPid = readCanonPidFn(dir);
    let heartbeatStatus = readHeartbeatStatusFn(dir);
    let heartbeat = heartbeatStatus.kind === 'found' ? heartbeatStatus.record : null;

    // CASE B handling — canon-pid alive, heartbeat missing. The detached
    // child takes some time after spawn to reach its first startHeartbeat
    // call; instead of refusing immediately, give it a budget to write the
    // heartbeat. Once it does, we re-decide from a CASE D state.
    if (canonPid != null && heartbeat == null && heartbeatStatus.kind === 'missing' && probeAlive(canonPid)) {
        const pidBeforeWait = canonPid; // capture for isStillAlive — re-read below
        const waitResult = waitForHeartbeat(dir, {
            timeoutMs: waitTimeoutMs,
            readImpl: readHeartbeatStatusFn,
            sleepImpl: sleep,
            nowImpl: now,
            isStillAlive: () => probeAlive(pidBeforeWait),
            onWaitStart: () => {
                stdout(`canon stop: waiting for orchestrator's first heartbeat tick (up to ${waitTimeoutMs / 1000}s)...`);
            },
        });
        if (waitResult.kind === 'corrupt' || waitResult.kind === 'unreadable') {
            stderr(
                `canon stop: .heartbeat.json is ${waitResult.kind} (${waitResult.reason}) for task '${taskId}'. ` +
                `Refusing to signal pid ${canonPid} without proof of life. ` +
                `Check ${runLogPathFor(dir)} for boot output; if you're sure: ` +
                `rm tasks/${taskId}/.canon-pid tasks/${taskId}/.heartbeat.json`,
            );
            return exit(1);
        }
        // For every non-terminal wait outcome (found / pid-died / timeout),
        // RE-READ both files before handing off to decideStopAction. The
        // world may have changed during the wait — a new canon run could
        // have started on the same task after the original died, leaving
        // fresh .canon-pid and .heartbeat.json on disk that don't match
        // our pre-wait snapshot. Using stale snapshot data here would let
        // the cleanup-stale-pid path delete the NEW run's files (codex
        // PR #113 P2). (Re-reading two files independently is still
        // racy at microsecond scale, but the launch-window race is on
        // the order of seconds — the re-read closes the realistic gap.)
        canonPid = readCanonPidFn(dir);
        heartbeatStatus = readHeartbeatStatusFn(dir);
        heartbeat = heartbeatStatus.kind === 'found' ? heartbeatStatus.record : null;
    }

    const decision = decideStopAction({
        taskId,
        canonPid,
        heartbeat,
        probeAlive,
        now: now(),
    });

    if (decision.kind === 'noop') {
        stdout(decision.message);
        return exit(0);
    }
    if (decision.kind === 'cleanup-stale-pid') {
        stdout(decision.message);
        if (!deps.skipFsCleanup) {
            if (decision.cleanCanonPid) removeCanonPid(dir);
            if (decision.cleanHeartbeat) removeHeartbeat(dir);
        }
        return exit(0);
    }
    if (decision.kind === 'refuse') {
        stderr(decision.message);
        return exit(1);
    }

    // decision.kind === 'signal'
    const pid = decision.pid;
    stdout(decision.message);
    try {
        kill(-pid, 'SIGTERM');
    } catch {
        try { kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    }

    // Poll for clean exit.
    const sigtermDeadline = now() + SIGTERM_GRACE_MS;
    while (now() < sigtermDeadline) {
        if (!probeAlive(pid)) {
            stdout(`canon stop: task '${taskId}' stopped cleanly.`);
            if (!deps.skipFsCleanup) removeCanonPid(dir);
            return exit(0);
        }
        sleep(SIGTERM_POLL_INTERVAL_MS);
    }

    stdout(`canon stop: SIGTERM didn't take after ${SIGTERM_GRACE_MS / 1000}s — escalating to SIGKILL.`);
    try { kill(-pid, 'SIGKILL'); }
    catch { try { kill(pid, 'SIGKILL'); } catch { /* gone */ } }

    sleep(500);
    if (probeAlive(pid)) {
        stderr(`canon stop: pid ${pid} survived SIGKILL — investigate manually.`);
        stderr(`  Log: ${runLogPathFor(dir)}`);
        return exit(1);
    }

    stdout(`canon stop: task '${taskId}' stopped (SIGKILL).`);
    if (!deps.skipFsCleanup) removeCanonPid(dir);
    return exit(0);
}
