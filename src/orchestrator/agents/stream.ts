import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';

import { STALL_KILL_GRACE_MS, STALL_TIMEOUT_MS } from '../env.js';
import { isShuttingDown, killChildGroup, registerActiveChild } from '../signals.js';
import type { StreamResult } from '../types.js';
import { warn } from '../cli.js';

export type { StreamResult } from '../types.js';

export function streamProcess(
    command: string,
    args: string[],
    options: {
        cwd: string;
        label: string;
        onLine: (line: string) => void;
        onStderrChunk?: (chunk: string) => void;
        stallTimeoutMs?: number;
        // Fires immediately after spawn with the live ChildProcess handle.
        // Test seam — production callers don't need this. Lets tests learn
        // the child PID without shelling out to `ps` (which is blocked in
        // sandboxed CI runners).
        onSpawn?: (child: ChildProcess) => void;
    },
): Promise<StreamResult> {
    return new Promise((resolve) => {
        const stallMs = options.stallTimeoutMs ?? STALL_TIMEOUT_MS;
        let stalled = false;
        let closed = false;
        let stallTimer: NodeJS.Timeout | null = null;
        let killTimer: NodeJS.Timeout | null = null;
        const capturedStdout: string[] = [];
        const capturedStderr: string[] = [];

        // detached: true → setsid() on the child, placing it in a new session
        // and process group. Process-group SIGHUP from the supervising shell
        // stops at this boundary, so Codex/Claude survive shell-exit just like
        // the orchestrator does (see src/orchestrator/signals.ts). We deliberately do
        // NOT call child.unref() — the orchestrator must continue to wait for
        // the agent to finish; detaching is purely for signal isolation.
        //
        // registerActiveChild() bridges back the shutdown propagation we lose
        // by detaching: signals.ts's SIGINT/SIGTERM handlers forward the
        // terminating signal to every registered child before exiting, so
        // Ctrl-C and `kill` still take the children down with the parent.
        const child = spawn(command, args, {
            cwd: options.cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
        });
        registerActiveChild(child);
        options.onSpawn?.(child);

        const resetStallTimer = (): void => {
            if (stallTimer) clearTimeout(stallTimer);
            stallTimer = setTimeout(() => {
                stalled = true;
                warn(`${options.label} stalled — no output for ${Math.round(stallMs / 1000)}s. Sending SIGTERM.`);
                // Group-kill: detached:true above puts the child + any helper
                // subprocesses it spawned in their own process group. A
                // leader-only child.kill would leave the descendants alive,
                // and they'd keep the stdout/stderr pipes open — the 'close'
                // event would never fire and the orchestrator would hang on
                // exactly the stall path that's supposed to recover from
                // hung agents. killChildGroup targets the whole subtree.
                killChildGroup(child, 'SIGTERM');
                killTimer = setTimeout(() => {
                    if (!closed) {
                        warn(`${options.label} did not exit after SIGTERM — sending SIGKILL.`);
                        killChildGroup(child, 'SIGKILL');
                    }
                }, STALL_KILL_GRACE_MS);
            }, stallMs);
        };

        if (child.stdout) {
            const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
            rl.on('line', (line) => {
                resetStallTimer();
                capturedStdout.push(line);
                if (line.trim()) {
                    try { options.onLine(line); } catch { /* parsing errors must not kill the stream */ }
                }
            });
        }

        if (child.stderr) {
            child.stderr.setEncoding('utf8');
            child.stderr.on('data', (chunk: string) => {
                resetStallTimer();
                capturedStderr.push(chunk);
                if (options.onStderrChunk) {
                    try { options.onStderrChunk(chunk); } catch { /* same */ }
                } else {
                    process.stderr.write(chunk);
                }
            });
        }

        child.on('error', (err) => {
            if (stallTimer) clearTimeout(stallTimer);
            if (killTimer) clearTimeout(killTimer);
            if (isShuttingDown()) return;
            resolve({
                exitCode: null,
                signal: null,
                spawnError: err,
                stalled,
                capturedStdout: capturedStdout.join('\n'),
                capturedStderr: capturedStderr.join(''),
            });
        });

        child.on('close', (code, signal) => {
            closed = true;
            if (stallTimer) clearTimeout(stallTimer);
            if (killTimer) clearTimeout(killTimer);
            // Shutdown owns termination; resolving would let phase wrappers exit
            // before resistant descendants have received the final group kill.
            if (isShuttingDown()) return;
            resolve({
                exitCode: code,
                signal,
                spawnError: null,
                stalled,
                capturedStdout: capturedStdout.join('\n'),
                capturedStderr: capturedStderr.join(''),
            });
        });

        resetStallTimer();
    });
}

export function formatLiveTick(event: Record<string, unknown>): string | null {
    const type = event.type;
    if (type === 'thread.started') return `  → session started`;
    if (type === 'turn.started') return `  → turn started`;
    if (type === 'turn.completed') return `  ← turn completed`;
    if (type === 'item.started' || type === 'item.completed') {
        const item = (event.item ?? {}) as { type?: string; name?: string };
        if (item.type === 'tool_call' || item.type === 'function_call') {
            return `  ${type === 'item.started' ? '→' : '←'} ${item.name ?? 'tool'}`;
        }
    }
    if (type === 'system') {
        const subtype = (event as { subtype?: string }).subtype;
        if (subtype === 'init') return `  → claude session init`;
    }
    if (type === 'assistant') {
        const message = (event as { message?: { content?: Array<{ type?: string; name?: string }> } }).message;
        const blocks = message?.content ?? [];
        for (const b of blocks) {
            if (b.type === 'tool_use' && b.name) return `  → ${b.name}`;
        }
    }
    if (type === 'user') {
        const message = (event as { message?: { content?: Array<{ type?: string }> } }).message;
        const blocks = message?.content ?? [];
        if (blocks.some(b => b.type === 'tool_result')) return `  ← tool result`;
    }
    return null;
}
