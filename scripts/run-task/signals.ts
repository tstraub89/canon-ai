// Signal handlers installed at module-evaluation time, BEFORE any importing
// module's transitive dependencies finish loading. This file is imported FIRST
// (as a side-effect import) from scripts/run-task.ts so its module body runs
// before scripts/run-task/main.ts and its deps — most notably env.ts, which
// runs `git rev-parse --git-common-dir` synchronously at module load.
//
// ES module evaluation is post-order DFS on the dependency graph: imports'
// module bodies run BEFORE the importing module's body. If we installed the
// handler inline in run-task.ts (as a top-level statement after the imports),
// the heavy import graph would evaluate first, leaving a startup window
// where SIGHUP from a dying supervising shell would terminate the orchestrator
// with Node's default action.
//
// `node:*` built-in imports are allowed here because they're effectively
// leaves — they have no further canon-side transitive dependencies. The
// structural test in tests/run-task-signals.test.ts enforces "no project
// imports" while permitting `node:*`.
//
// Beyond installing SIGHUP-ignore on the orchestrator, this module also owns
// the live-child registry used by agents/stream.ts. With `detached: true`
// on the spawned agent children (the P1 fix from Codex review of PR #105),
// they no longer share the orchestrator's POSIX process group. That isolates
// them from supervising-shell SIGHUP — but it also means they won't die with
// the orchestrator if it exits via SIGINT/SIGTERM/crash. The shutdown
// handlers below close that gap by explicitly forwarding the terminating
// signal to every registered child before exiting. Ctrl-C and `kill` now
// behave the same way they did before `detached: true` — both children
// die with the parent.

import type { ChildProcess } from 'node:child_process';

const activeChildren = new Set<ChildProcess>();

// Shutdown-hook registry. Modules with cleanup work (heartbeat file removal,
// PID-file cleanup for future detach mode, etc.) register a callback that
// fires before the signal forwarder re-raises. Registry-style keeps signals.ts
// leaf-pure — the structural test in tests/run-task-signals.test.ts forbids
// project imports here so the SIGHUP handler installs before the heavier
// transitive graph evaluates. Callers do `import { registerShutdownHook }
// from './signals.js'` from inside the project tree; signals.ts itself stays
// dependency-free.
type ShutdownHook = () => void;
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

function forwardAndExit(sig: 'SIGINT' | 'SIGTERM'): void {
    for (const child of activeChildren) {
        killChildGroup(child, sig);
    }
    // Run registered shutdown hooks before re-raising. Heartbeat-file cleanup
    // and (future) detach PID-file removal live here so a clean Ctrl-C / SIGTERM
    // doesn't leave runtime files looking stale. Hooks run best-effort — a
    // throw from one hook must not block the others or the re-raise.
    for (const hook of shutdownHooks) {
        try { hook(); } catch { /* best-effort; never block shutdown */ }
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

process.on('SIGINT', () => forwardAndExit('SIGINT'));
process.on('SIGTERM', () => forwardAndExit('SIGTERM'));
