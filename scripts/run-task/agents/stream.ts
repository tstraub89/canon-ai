import { spawn } from 'node:child_process';
import readline from 'node:readline';

import { STALL_KILL_GRACE_MS, STALL_TIMEOUT_MS } from '../env.js';
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

        const child = spawn(command, args, {
            cwd: options.cwd,
            stdio: ['inherit', 'pipe', 'pipe'],
        });

        const resetStallTimer = (): void => {
            if (stallTimer) clearTimeout(stallTimer);
            stallTimer = setTimeout(() => {
                stalled = true;
                warn(`${options.label} stalled — no output for ${Math.round(stallMs / 1000)}s. Sending SIGTERM.`);
                try { child.kill('SIGTERM'); } catch { /* already dead */ }
                killTimer = setTimeout(() => {
                    if (!closed) {
                        warn(`${options.label} did not exit after SIGTERM — sending SIGKILL.`);
                        try { child.kill('SIGKILL'); } catch { /* already dead */ }
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
