import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { fileURLToPath } from 'node:url';

import { REPO_ROOT } from '../scripts/run-task/env.js';

const TSX_LOADER = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');
const MD_LOADER = path.join(REPO_ROOT, 'tests', 'md-loader-register.mjs');
const ENTRY_URL = new URL('../scripts/run-task.ts', import.meta.url).href;

// Resolve source paths from THIS file's location rather than REPO_ROOT. In a
// linked-worktree run, REPO_ROOT resolves to the main checkout (env.ts uses
// `git rev-parse --git-common-dir` by design — see env.ts:12-22) while the
// test files we want to inspect live in the worktree. `import.meta.url` gives
// us the right checkout regardless of worktree state.
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CHECKOUT_ROOT = path.resolve(TEST_DIR, '..');
const SIGNALS_TS = path.join(CHECKOUT_ROOT, 'scripts', 'run-task', 'signals.ts');
const RUN_TASK_TS = path.join(CHECKOUT_ROOT, 'scripts', 'run-task.ts');
const STREAM_TS = path.join(CHECKOUT_ROOT, 'scripts', 'run-task', 'agents', 'stream.ts');

function makeHarness(signal: 'SIGHUP' | 'SIGINT'): {
    cleanup: () => void;
    child: ReturnType<typeof spawn>;
    exited: Promise<[number | null, NodeJS.Signals | null]>;
    stderr: string[];
} {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-task-signals-'));
    const harnessPath = path.join(root, 'harness.mjs');
    fs.writeFileSync(harnessPath, [
        `await import(${JSON.stringify(ENTRY_URL)});`,
        `setTimeout(() => process.kill(process.pid, ${JSON.stringify(signal)}), 100);`,
        `setTimeout(() => { console.log('alive'); process.exit(0); }, 300);`,
        '',
    ].join('\n'), 'utf8');

    const stderr: string[] = [];
    const child = spawn(process.execPath, [
        '--import', MD_LOADER,
        '--import', TSX_LOADER,
        harnessPath,
    ], {
        cwd: REPO_ROOT,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
        stderr.push(chunk);
    });

    return {
        cleanup: () => {
            fs.rmSync(root, { recursive: true, force: true });
        },
        child,
        exited: once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>,
        stderr,
    };
}

void test('run-task entry survives SIGHUP after installing its handler', async () => {
    const harness = makeHarness('SIGHUP');

    try {
        await delay(200);
        assert.equal(harness.child.exitCode, null, harness.stderr.join(''));
        assert.equal(harness.child.signalCode, null, harness.stderr.join(''));

        const [code, signal] = await harness.exited;
        assert.equal(code, 0, harness.stderr.join(''));
        assert.equal(signal, null, harness.stderr.join(''));
        assert.match(harness.stderr.join(''), /SIGHUP received; ignoring/);
    } finally {
        harness.cleanup();
    }
});

void test('run-task entry still exits on SIGINT', async () => {
    const harness = makeHarness('SIGINT');

    try {
        const [code, signal] = await harness.exited;
        assert.equal(code, null, harness.stderr.join(''));
        assert.equal(signal, 'SIGINT', harness.stderr.join(''));
    } finally {
        harness.cleanup();
    }
});

// Structural guard: signals.ts must import only `node:*` built-ins. Project
// imports here would defer the SIGHUP-handler installation until the
// project's transitive graph has evaluated — re-opening the startup-window
// failure mode Codex flagged on PR #105. Built-in `node:*` modules are
// effectively leaves in the dependency graph and run cheaply.
void test('signals.ts imports only node:* built-ins', () => {
    const src = fs.readFileSync(SIGNALS_TS, 'utf8');
    const importLines = src
        .split('\n')
        .filter((line) => /^\s*import\b/.test(line));
    const nonBuiltin = importLines.filter((line) => !/from\s+['"]node:/.test(line));
    assert.deepEqual(
        nonBuiltin,
        [],
        `signals.ts may only import from node:* (found non-built-in: ${JSON.stringify(nonBuiltin)})`,
    );
});

// Structural guard: scripts/run-task.ts must import signals.js BEFORE any
// other project import. ES post-order DFS evaluates dependencies in source
// order; if a heavier import appears first, signals.ts's handler installs
// too late.
void test('run-task.ts imports signals.js before main.js', () => {
    const src = fs.readFileSync(RUN_TASK_TS, 'utf8');
    const signalsIdx = src.indexOf("import './run-task/signals.js'");
    const mainIdx = src.indexOf("from './run-task/main.js'");
    assert.notEqual(signalsIdx, -1, 'run-task.ts must side-effect-import ./run-task/signals.js');
    assert.notEqual(mainIdx, -1, 'run-task.ts must import main from ./run-task/main.js');
    assert.ok(
        signalsIdx < mainIdx,
        `signals.js import (offset ${signalsIdx}) must precede main.js import (offset ${mainIdx})`,
    );
});

// Structural + sanity guard: streamProcess spawns children with detached:true,
// which calls setsid() and places the child in its own session/process group.
// Process-group SIGHUP from the supervising shell stops at that boundary, so
// Codex/Claude survive shell-exit. Without detached:true, the orchestrator-
// side SIGHUP handler is necessary-but-not-sufficient — the agent children
// die anyway (Codex review on PR #105, P1).
//
// Verified two ways:
//   1. Structural: stream.ts's spawn options literally contain detached:true.
//   2. Sanity: direct spawn(..., {detached: true}) creates a reachable process
//      group via process.kill(-pid, 0) — confirms the OS primitive does what
//      we depend on, on this platform.
// (Earlier draft of this test used `ps` to compare PGIDs; that broke under
// sandboxed/containerized runners where `ps` is restricted.)
void test('streamProcess spawn options include detached:true (P1: process-group isolation)', () => {
    const streamSrc = fs.readFileSync(STREAM_TS, 'utf8');
    assert.match(
        streamSrc,
        /detached:\s*true/,
        'agents/stream.ts must spawn children with detached:true',
    );

    // Sanity: confirm the OS primitive we depend on. With detached:true,
    // child.pid IS the PGID of a new group. process.kill(-pid, 0) probes
    // that group's existence without sending an actual signal.
    const probe = spawn('sleep', ['5'], { detached: true, stdio: 'ignore' });
    try {
        assert.ok(probe.pid, 'spawned probe must have a PID');
        // Send signal 0 (no-op probe) to the negative PID. Throws if the
        // process group doesn't exist; succeeds if it does.
        const reached = process.kill(-probe.pid, 0);
        assert.ok(reached, 'detached spawn must create a reachable process group');
    } finally {
        if (probe.pid) {
            try { process.kill(-probe.pid, 'SIGKILL'); } catch { /* gone */ }
        }
    }
});

// Functional guard: when the orchestrator receives SIGINT/SIGTERM, the
// signals.ts shutdown handler must forward the signal to every registered
// child before exiting. Without this bridge, `detached: true` would leak
// agent processes on Ctrl-C and `kill` (the regression Codex flagged on the
// first iteration of this task — the children are no longer in the parent's
// process group, so they don't die automatically).
//
// The harness uses streamProcess's onSpawn callback to write the child PID
// to disk — no `ps` lookup needed (which would fail on sandboxed runners
// where `ps` is restricted).
void test('SIGINT to orchestrator kills tracked streamProcess children', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-task-shutdown-'));
    const harnessPath = path.join(root, 'harness.mjs');
    const pidFile = path.join(root, 'child.pid');
    const signalsUrl = new URL('../scripts/run-task/signals.ts', import.meta.url).href;
    const streamUrl = new URL('../scripts/run-task/agents/stream.ts', import.meta.url).href;

    fs.writeFileSync(harnessPath, [
        // Side-effect import: installs SIGINT/SIGTERM forwarders.
        `await import(${JSON.stringify(signalsUrl)});`,
        `const { streamProcess } = await import(${JSON.stringify(streamUrl)});`,
        `const fs = await import('node:fs');`,
        // Spawn a long-running sleeper via streamProcess. The onSpawn
        // callback writes the child PID to disk so the outer test can
        // poll it after SIGINT.
        `streamProcess('sleep', ['30'], {`,
        `    cwd: process.cwd(),`,
        `    label: 'shutdown-probe',`,
        `    onLine: () => {},`,
        `    onSpawn: (c) => fs.writeFileSync(${JSON.stringify(pidFile)}, String(c.pid), 'utf8'),`,
        `});`,
        // Stay alive long enough for outer test to SIGINT us. The signal
        // handler should fire and kill the sleep before we exit.
        `await new Promise((r) => setTimeout(r, 5000));`,
        '',
    ].join('\n'), 'utf8');

    const child = spawn(process.execPath, [
        '--import', MD_LOADER,
        '--import', TSX_LOADER,
        harnessPath,
    ], {
        cwd: REPO_ROOT,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stderrChunks: string[] = [];
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => { stderrChunks.push(chunk); });

    try {
        // Wait for the sleeper PID to appear on disk.
        let sleepPid: number | null = null;
        for (let i = 0; i < 50; i += 1) {
            await delay(50);
            if (fs.existsSync(pidFile)) {
                sleepPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
                break;
            }
        }
        assert.ok(sleepPid, `sleeper PID never appeared on disk (stderr: ${stderrChunks.join('')})`);

        // Sanity-check the sleep is alive before we SIGINT the parent.
        let aliveBefore = false;
        try {
            process.kill(sleepPid, 0);
            aliveBefore = true;
        } catch {
            aliveBefore = false;
        }
        assert.ok(aliveBefore, 'sleep child must be running before SIGINT');

        // SIGINT the harness. signals.ts's forwarder should kill the sleep.
        child.kill('SIGINT');

        // Wait for the harness to exit, then poll the sleep PID.
        await once(child, 'exit');
        // Give the kernel a beat to reap the sleep process.
        await delay(200);

        let aliveAfter = true;
        try {
            process.kill(sleepPid, 0);
            aliveAfter = true;
        } catch {
            aliveAfter = false;
        }
        assert.equal(aliveAfter, false, `sleep child must be dead after parent SIGINT (PID ${sleepPid}, parent stderr: ${stderrChunks.join('')})`);
    } finally {
        // Best-effort cleanup: if the test failed mid-way, kill any leaked sleep.
        if (fs.existsSync(pidFile)) {
            const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
            try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
        }
        fs.rmSync(root, { recursive: true, force: true });
    }
});
