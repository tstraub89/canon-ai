// Imported before the orchestrator module graph so SIGHUP handling is active
// during synchronous startup work. Keep this module free of project imports.
// Agent children use separate process groups; shutdown must supervise those
// groups through termination before removing runtime markers and exiting.

import type { ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const activeChildren = new Set<ChildProcess>();
let shuttingDown = false;

export function isShuttingDown(): boolean {
    return shuttingDown;
}

// Hooks run after child-group shutdown. Keep the registry here so callers can
// register cleanup without adding project dependencies to this early import.
type ShutdownHook = (sig?: NodeJS.Signals) => void;
const shutdownHooks: ShutdownHook[] = [];

export function registerShutdownHook(hook: ShutdownHook): void {
    shutdownHooks.push(hook);
}

export function registerActiveChild(child: ChildProcess): void {
    activeChildren.add(child);
    const drop = (): void => {
        activeChildren.delete(child);
    };
    child.once('close', drop);
    child.once('error', drop);
}

/**
 * Send `sig` to the entire process group of a detached child. With
 * detached:true on spawn, child.pid IS the PGID of a new group that
 * contains the agent CLI plus any helper subprocesses it spawned for tool
 * execution. process.kill(-pid, sig) targets the group; child.kill(sig)
 * only targets the leader.
 *
 * Use this anywhere we want to terminate the detached child fully (stall
 * timeout, signal forwarder, error cleanup). If the group is already gone
 * (process exited) or the platform refuses the negative-PID kill, falls
 * back to the leader-only kill.
 *
 * Returns true if a signal was successfully delivered (group or leader),
 * false if the child was already dead.
 */
export function killChildGroup(child: ChildProcess, sig: NodeJS.Signals): boolean {
    if (child.pid == null) return false;
    try {
        process.kill(-child.pid, sig);
        return true;
    } catch {
        try {
            child.kill(sig);
            return true;
        } catch {
            return false;
        }
    }
}

process.on('SIGHUP', () => {
    process.stderr.write('WARN: SIGHUP received; ignoring (orchestrator survives supervising-shell exit).\n');
});

function childGroupAlive(child: ChildProcess): boolean {
    if (child.pid == null) return false;
    try {
        process.kill(-child.pid, 0);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return true;
        return child.exitCode === null && child.signalCode === null;
    }
}

async function forwardAndExit(sig: 'SIGINT' | 'SIGTERM'): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    // Keep group identities after their leaders close: descendants may still run.
    const children = [...activeChildren];
    for (const child of children) {
        killChildGroup(child, sig);
    }
    const graceDeadline = Date.now() + 3000;
    while (children.some(childGroupAlive) && Date.now() < graceDeadline) await delay(50);
    for (const child of children.filter(childGroupAlive)) killChildGroup(child, 'SIGKILL');
    const reapDeadline = Date.now() + 1000;
    while (children.some(childGroupAlive) && Date.now() < reapDeadline) await delay(50);
    // Run registered shutdown hooks before re-raising. Heartbeat-file cleanup
    // and detach PID-file removal live here so a clean Ctrl-C / SIGTERM
    // doesn't leave runtime files looking stale. Hooks run best-effort — a
    // throw from one hook must not block the others or the re-raise.
    for (const hook of shutdownHooks) {
        try { hook(sig); } catch { /* best-effort; never block shutdown */ }
    }
    // Restore Node's default handling for this signal, then re-raise it
    // against ourselves. This preserves native signal-termination semantics
    // (the process exits with `signal: <sig>`, not `code: 128+n`), which
    // matches the behavior callers observed before detached:true forced us
    // into explicit forwarding. Without the removeAllListeners + re-kill
    // dance, process.exit(N) would terminate with an exit code instead and
    // shell-level signal semantics ($?, wait, etc.) would drift.
    process.removeAllListeners(sig);
    process.kill(process.pid, sig);
}

process.on('SIGINT', () => { void forwardAndExit('SIGINT'); });
process.on('SIGTERM', () => { void forwardAndExit('SIGTERM'); });
