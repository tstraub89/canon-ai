// scripts/run-task/heartbeat.ts
//
// Per-task heartbeat file. Every 30s the orchestrator writes a JSON record
// to `<taskDir>/.heartbeat.json` containing `pid`, `started_at_ms`, and
// `last_update_ms`. Detectors (canon doctor, status-line plugins, future
// `canon status` augmentations) read the file and treat a >120s gap from
// the last update as "no live orchestrator."
//
// Context: this is fix 3 of the three-fix orchestrator-death plan in
// docs/BACKLOG.md ("Orchestrator dies silently in background mode"). Fix 1
// (#105) makes the orchestrator survive SIGHUP cascades. Fix 2 (detach mode)
// is still open. Heartbeat doesn't prevent any death class — it surfaces
// them within ~60–90s of occurrence regardless of cause (SIGKILL, OOM,
// kernel panic, harness-level pgroup kill). Combined with re-running
// `canon run <id>` (which resumes durably via Codex/Claude session IDs),
// this turns "silent hours of stall" into "visible within a minute."
//
// Design choices:
//   - Atomic writes (tmp + rename) so a partial file is never observable
//     by a concurrent doctor read.
//   - `.unref()` on the timer so heartbeat alone doesn't keep the event
//     loop alive; clean orchestrator exit naturally stops ticking.
//   - Best-effort errors: a transient FS failure (EACCES, ENOENT during
//     worktree teardown) skips the tick instead of crashing the
//     orchestrator. The next tick retries.
//   - Per-task file (rather than one global registry): bundle runs touch
//     every task's `tasks/<id>/.heartbeat.json`, so detectors that know
//     only a task ID can find the heartbeat without cross-referencing.
//   - Leading `.` filename is conventional "runtime/hidden"; `.gitignore`
//     excludes `tasks/*/.heartbeat.json` so it's never committed.

import fs from 'node:fs';
import path from 'node:path';

const HEARTBEAT_FILENAME = '.heartbeat.json';
const HEARTBEAT_INTERVAL_MS = 30_000;

// 2× interval. One missed tick is tolerable noise (slow FS, GC pause);
// two missed = real stall or process death. Doctor uses this threshold.
export const HEARTBEAT_STALE_AFTER_MS = HEARTBEAT_INTERVAL_MS * 2;

export interface HeartbeatRecord {
    pid: number;
    started_at_ms: number;
    last_update_ms: number;
    task_ids: string[];
}

export interface HeartbeatHandle {
    stop: () => void;
}

// Module-level registry so the signal forwarder can sweep all active
// heartbeats before re-raising. SIGKILL skips this (uncatchable) — the
// resulting stale file is exactly what the doctor check surfaces.
const activeHandles: Set<HeartbeatHandle> = new Set();

interface StartOptions {
    intervalMs?: number; // overrideable for tests; defaults to HEARTBEAT_INTERVAL_MS
}

export function startHeartbeat(
    taskIds: string[],
    resolveTaskDir: (taskId: string) => string,
    options: StartOptions = {},
): HeartbeatHandle {
    const startedAtMs = Date.now();
    const intervalMs = options.intervalMs ?? HEARTBEAT_INTERVAL_MS;

    const writeOnce = (): void => {
        const record: HeartbeatRecord = {
            pid: process.pid,
            started_at_ms: startedAtMs,
            last_update_ms: Date.now(),
            task_ids: [...taskIds],
        };
        const payload = `${JSON.stringify(record, null, 2)}\n`;
        for (const taskId of taskIds) {
            let dir: string;
            try {
                dir = resolveTaskDir(taskId);
            } catch {
                // resolveTaskDir may die() during a transient worktree state
                // (mid-teardown, etc.). Skip this tick; next interval retries.
                continue;
            }
            const file = path.join(dir, HEARTBEAT_FILENAME);
            const tmp = `${file}.tmp`;
            try {
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(tmp, payload, 'utf8');
                fs.renameSync(tmp, file);
            } catch {
                // Best-effort; never crash the orchestrator on heartbeat I/O.
            }
        }
    };

    // Initial write so detectors observe liveness from t=0, not after the
    // first interval elapses.
    writeOnce();

    const timer = setInterval(writeOnce, intervalMs);
    timer.unref();

    const handle: HeartbeatHandle = {
        stop: (): void => {
            clearInterval(timer);
            activeHandles.delete(handle);
            // Clean shutdown deletes the heartbeat so detectors don't read
            // a now-stale file later. Best-effort: a missing file is the
            // same end-state as a successfully-deleted one.
            for (const taskId of taskIds) {
                let dir: string;
                try {
                    dir = resolveTaskDir(taskId);
                } catch {
                    continue;
                }
                try {
                    fs.unlinkSync(path.join(dir, HEARTBEAT_FILENAME));
                } catch {
                    // Already gone — fine.
                }
            }
        },
    };
    activeHandles.add(handle);
    return handle;
}

/**
 * Stop all active heartbeats. The signal forwarder calls this before
 * re-raising so clean-shutdown paths (Ctrl-C, SIGTERM from a friendly
 * supervisor) don't leave stale files behind.
 */
export function stopAllHeartbeats(): void {
    for (const handle of [...activeHandles]) {
        handle.stop();
    }
}

/**
 * Best-effort removal of `.heartbeat.json`. Used by `canon stop` to fully
 * self-heal a task directory whose orchestrator died ungracefully and left
 * behind both runtime files (`.canon-pid` and `.heartbeat.json`). Mirrors
 * `removeCanonPid` in detach.ts.
 */
export function removeHeartbeat(taskDir: string): void {
    try {
        fs.unlinkSync(path.join(taskDir, '.heartbeat.json'));
    } catch {
        // Already gone — fine.
    }
}

/**
 * Tagged-union return type for `readHeartbeatStatus`. Lets callers like
 * `waitForHeartbeat` distinguish "file isn't there yet — keep polling" from
 * "file exists but is broken — fail fast." A simple `null` return would
 * conflate them and burn the entire stop timeout polling against a
 * corrupted file that will never become valid.
 */
export type HeartbeatReadResult =
    | { kind: 'found'; record: HeartbeatRecord }
    | { kind: 'missing' }
    | { kind: 'corrupt'; reason: string }
    | { kind: 'unreadable'; reason: string };

/**
 * Read a task's heartbeat record with a tagged-union result. Callers that
 * need to distinguish "missing" from "corrupt" (notably the `canon stop`
 * launch-window poller) use this; callers that just need "alive or not"
 * use the `readHeartbeat` convenience wrapper below.
 */
export function readHeartbeatStatus(taskDir: string): HeartbeatReadResult {
    const file = path.join(taskDir, HEARTBEAT_FILENAME);
    let raw: string;
    try {
        raw = fs.readFileSync(file, 'utf8');
    } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') return { kind: 'missing' };
        return { kind: 'unreadable', reason: err.message ?? String(error) };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { kind: 'corrupt', reason: `invalid JSON: ${message}` };
    }
    if (
        parsed === null ||
        typeof parsed !== 'object' ||
        typeof (parsed as Partial<HeartbeatRecord>).pid !== 'number' ||
        typeof (parsed as Partial<HeartbeatRecord>).started_at_ms !== 'number' ||
        typeof (parsed as Partial<HeartbeatRecord>).last_update_ms !== 'number' ||
        !Array.isArray((parsed as Partial<HeartbeatRecord>).task_ids)
    ) {
        return { kind: 'corrupt', reason: 'wrong shape — missing or mistyped required fields' };
    }
    return { kind: 'found', record: parsed as HeartbeatRecord };
}

/**
 * Read a task's heartbeat record. Returns null when the file is missing,
 * unreadable, malformed, or fails shape validation. Callers should treat
 * null as "no live orchestrator" when status.json reports the task as
 * in-progress (status.json + heartbeat are independent signals — both
 * required for "ALIVE"). Thin wrapper over `readHeartbeatStatus` — callers
 * that need to distinguish missing-vs-corrupt should call that directly.
 */
export function readHeartbeat(taskDir: string): HeartbeatRecord | null {
    const result = readHeartbeatStatus(taskDir);
    return result.kind === 'found' ? result.record : null;
}

/**
 * True when the heartbeat is missing or older than HEARTBEAT_STALE_AFTER_MS.
 * `now` is parameterized for deterministic tests.
 */
export function isHeartbeatStale(record: HeartbeatRecord | null, now: number = Date.now()): boolean {
    if (!record) return true;
    return (now - record.last_update_ms) > HEARTBEAT_STALE_AFTER_MS;
}
