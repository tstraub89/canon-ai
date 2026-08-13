import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { isSynchronousMode } from '../src/orchestrator/cli.js';
import {
    DETACH_CHILD_FLAG,
    DETACH_DISABLE_FLAG,
    detachAndExit,
    readCanonPid,
    removeCanonPid,
    runLogPathFor,
    shouldAutoDetach,
} from '../src/orchestrator/detach.js';

// ── shouldAutoDetach ─────────────────────────────────────────────────────────

function fakeStdout(isTTY: boolean): NodeJS.WriteStream {
    const stream = new EventEmitter() as unknown as NodeJS.WriteStream;
    Object.assign(stream, { isTTY });
    return stream;
}

void test('shouldAutoDetach: false when stdout is a TTY', () => {
    assert.equal(shouldAutoDetach({ stdout: fakeStdout(true), env: {} }), false);
});

void test('shouldAutoDetach: true when stdout is not a TTY and no opt-out', () => {
    assert.equal(shouldAutoDetach({ stdout: fakeStdout(false), env: {} }), true);
});

void test('shouldAutoDetach: false when already the detached child', () => {
    assert.equal(
        shouldAutoDetach({ stdout: fakeStdout(false), env: { [DETACH_CHILD_FLAG]: '1' } }),
        false,
    );
});

void test('shouldAutoDetach: false when CANON_NO_DETACH=1', () => {
    assert.equal(
        shouldAutoDetach({ stdout: fakeStdout(false), env: { [DETACH_DISABLE_FLAG]: '1' } }),
        false,
    );
});

void test('shouldAutoDetach: CANON_NO_DETACH wins over !TTY', () => {
    assert.equal(
        shouldAutoDetach({
            stdout: fakeStdout(false),
            env: { [DETACH_DISABLE_FLAG]: '1' },
        }),
        false,
    );
});

// ── synchronous-mode predicate ──────────────────────────────────────────────

void test('isSynchronousMode: bare reroute is not synchronous', () => {
    assert.equal(isSynchronousMode({ reroute: true }), false);
});

void test('isSynchronousMode: pr, push, ship, step, and expectPhase are synchronous', () => {
    assert.equal(isSynchronousMode({ pr: true }), true);
    assert.equal(isSynchronousMode({ push: true }), true);
    assert.equal(isSynchronousMode({ ship: true }), true);
    assert.equal(isSynchronousMode({ step: true }), true);
    assert.equal(isSynchronousMode({ expectPhase: 'spec_review' }), true);
});

void test('isSynchronousMode: step dominates reroute', () => {
    assert.equal(isSynchronousMode({ reroute: true, step: true }), true);
});

void test('isSynchronousMode: bare args are not synchronous', () => {
    assert.equal(isSynchronousMode({}), false);
});

// ── detachAndExit ────────────────────────────────────────────────────────────

interface FakeChild {
    pid: number | null;
    unref: () => void;
    args: { cmd: string; argv: readonly string[]; env: NodeJS.ProcessEnv; detached: boolean; stdio: unknown };
}

function makeSpawnFake(pidToReturn: number | null): {
    spawnImpl: (cmd: string, args: readonly string[], options: { detached?: boolean; stdio?: unknown; env?: NodeJS.ProcessEnv }) => ChildProcess;
    last(): FakeChild;
} {
    let last: FakeChild | null = null;
    const spawnImpl = (cmd: string, args: readonly string[], options: { detached?: boolean; stdio?: unknown; env?: NodeJS.ProcessEnv }): ChildProcess => {
        const fake: FakeChild = {
            pid: pidToReturn,
            unref: () => { /* ignored in tests */ },
            args: {
                cmd,
                argv: args,
                env: options.env ?? {},
                detached: options.detached ?? false,
                stdio: options.stdio,
            },
        };
        last = fake;
        return fake as unknown as ChildProcess;
    };
    return {
        spawnImpl,
        last(): FakeChild {
            if (!last) throw new Error('spawnImpl was not invoked');
            return last;
        },
    };
}

function withTempDir(fn: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'detach-test-'));
    try { fn(dir); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

void test('detachAndExit: writes .canon-pid for each task in the bundle', () => {
    withTempDir((root) => {
        const fake = makeSpawnFake(12345);
        let exitCode: number | null = null;
        let stdoutBuf = '';
        // Wrap exit so it doesn't actually terminate the test runner. Cast
        // to `never` since the production signature is `never` but we want
        // to capture and return.
        const fakeExit = ((code: number): never => {
            exitCode = code;
            return undefined as never;
        });

        detachAndExit({
            taskIds: ['alpha', 'beta'],
            resolveTaskDir: (id) => path.join(root, 'tasks', id),
            argv: ['/usr/local/bin/node', '/path/to/run-task.js', '--step'],
            spawnImpl: fake.spawnImpl,
            exit: fakeExit,
            stdoutWrite: (s: string) => { stdoutBuf += s; },
            stderrWrite: () => { /* ignored */ },
        });

        assert.equal(exitCode, 0);
        assert.equal(readCanonPid(path.join(root, 'tasks', 'alpha')), 12345);
        assert.equal(readCanonPid(path.join(root, 'tasks', 'beta')), 12345);
        // The spawn forwarded the args (sans node binary).
        assert.deepEqual(fake.last().args.argv, ['/path/to/run-task.js', '--step']);
        assert.equal(fake.last().args.detached, true);
        // Child env has the CANON_DETACHED flag set so the re-spawn doesn't
        // recurse on its own shouldAutoDetach check.
        assert.equal(fake.last().args.env[DETACH_CHILD_FLAG], '1');
        // Stdout banner mentions PID, the primary log path, and `canon stop`.
        assert.match(stdoutBuf, /PID:\s+12345/);
        assert.match(stdoutBuf, /canon stop alpha/);
        assert.match(stdoutBuf, /\.canon-run\.log/);
        // The NEXT STEP directive is the agent-facing contract: an imperative
        // `canon watch` instruction plus an explicit no-poll-loop prohibition.
        assert.match(stdoutBuf, /NEXT STEP/);
        assert.match(stdoutBuf, /canon watch alpha/);
        assert.match(stdoutBuf, /Do NOT hand-roll a poll loop/);
    });
});

void test('detachAndExit: opens the log file in the primary task dir', () => {
    withTempDir((root) => {
        const fake = makeSpawnFake(99);
        detachAndExit({
            taskIds: ['primary'],
            resolveTaskDir: (id) => path.join(root, 'tasks', id),
            argv: ['node', 'run-task.js'],
            spawnImpl: fake.spawnImpl,
            exit: (() => undefined as never),
            stdoutWrite: () => undefined,
            stderrWrite: () => undefined,
        });
        // The log file must exist (opened for append by detachAndExit).
        const logPath = path.join(root, 'tasks', 'primary', '.canon-run.log');
        assert.ok(fs.existsSync(logPath), '.canon-run.log must exist after detachAndExit');
    });
});

void test('detachAndExit: strips --reroute from the detached child argv', () => {
    withTempDir((root) => {
        const fake = makeSpawnFake(88);
        detachAndExit({
            taskIds: ['primary'],
            resolveTaskDir: (id) => path.join(root, 'tasks', id),
            argv: ['node', 'run-task.js', 'primary', '--reroute'],
            spawnImpl: fake.spawnImpl,
            exit: (() => undefined as never),
            stdoutWrite: () => undefined,
            stderrWrite: () => undefined,
        });

        assert.deepEqual(fake.last().args.argv, ['run-task.js', 'primary']);
        assert.equal(fake.last().args.env[DETACH_CHILD_FLAG], '1');
    });
});

void test('detachAndExit: forwards a normal (no --reroute) argv unchanged', () => {
    withTempDir((root) => {
        const fake = makeSpawnFake(89);
        detachAndExit({
            taskIds: ['primary'],
            resolveTaskDir: (id) => path.join(root, 'tasks', id),
            argv: ['node', 'run-task.js', 'primary'],
            spawnImpl: fake.spawnImpl,
            exit: (() => undefined as never),
            stdoutWrite: () => undefined,
            stderrWrite: () => undefined,
        });

        // The filter must be a no-op when --reroute is absent — guards against
        // an over-eager future filter dropping unrelated args.
        assert.deepEqual(fake.last().args.argv, ['run-task.js', 'primary']);
    });
});

void test('detachAndExit: strips --reroute regardless of position and count', () => {
    withTempDir((root) => {
        const fake = makeSpawnFake(90);
        detachAndExit({
            taskIds: ['primary'],
            resolveTaskDir: (id) => path.join(root, 'tasks', id),
            argv: ['node', 'run-task.js', '--reroute', 'primary', '--reroute'],
            spawnImpl: fake.spawnImpl,
            exit: (() => undefined as never),
            stdoutWrite: () => undefined,
            stderrWrite: () => undefined,
        });

        // Mid-argv and duplicate occurrences are both removed; other args kept.
        assert.deepEqual(fake.last().args.argv, ['run-task.js', 'primary']);
    });
});

// ── REGRESSION (codex P1 round 4, bc7672a) ───────────────────────────────────
//
// An earlier attempt had detachAndExit write a bootstrap .heartbeat.json
// record using the child's PID. Codex flagged that approach because the
// parent-written record looks identical to a real child tick — a child
// that crashes during boot leaves the record looking fresh for
// HEARTBEAT_STALE_AFTER_MS, masking the death from canon doctor and
// tempting canon stop to signal a possibly-recycled PID. A subsequent
// attempt used a `ps -p $PID -o command=` cmdline regex to verify PID
// identity (commit 7385cff); codex P1'd that too because the substring
// match missed the standard `.bin/canon` install and false-positived
// random argv. The final answer is wait-for-heartbeat polling in
// src/cli/commands/stop.ts: the child's own heartbeat write is the
// definitive proof of life. This test asserts the bootstrap heartbeat
// write is NOT present after detachAndExit — only .canon-pid is.
void test('detachAndExit: does NOT write a bootstrap heartbeat (child writes it later)', () => {
    withTempDir((root) => {
        const fake = makeSpawnFake(54321);
        detachAndExit({
            taskIds: ['alpha', 'beta'],
            resolveTaskDir: (id) => path.join(root, 'tasks', id),
            argv: ['node', 'run-task.js'],
            spawnImpl: fake.spawnImpl,
            exit: (() => undefined as never),
            stdoutWrite: () => undefined,
            stderrWrite: () => undefined,
        });
        // .canon-pid should be there (parent owns it).
        assert.equal(readCanonPid(path.join(root, 'tasks', 'alpha')), 54321);
        assert.equal(readCanonPid(path.join(root, 'tasks', 'beta')), 54321);
        // .heartbeat.json must NOT exist yet — only the child writes that.
        const alphaHb = path.join(root, 'tasks', 'alpha', '.heartbeat.json');
        const betaHb = path.join(root, 'tasks', 'beta', '.heartbeat.json');
        assert.equal(fs.existsSync(alphaHb), false, 'bootstrap .heartbeat.json must not be present');
        assert.equal(fs.existsSync(betaHb), false, 'bootstrap .heartbeat.json must not be present');
    });
});

void test('detachAndExit: exits 1 with no task IDs', () => {
    withTempDir((root) => {
        const fake = makeSpawnFake(1);
        let exitCode: number | null = null;
        let stderrBuf = '';
        detachAndExit({
            taskIds: [],
            resolveTaskDir: (id) => path.join(root, 'tasks', id),
            argv: ['node', 'run-task.js'],
            spawnImpl: fake.spawnImpl,
            exit: ((code: number): never => { exitCode = code; return undefined as never; }),
            stdoutWrite: () => undefined,
            stderrWrite: (s: string) => { stderrBuf += s; },
        });
        assert.equal(exitCode, 1);
        assert.match(stderrBuf, /no task IDs/);
    });
});

void test('detachAndExit: exits 1 when spawn returns null PID', () => {
    withTempDir((root) => {
        const fake = makeSpawnFake(null);
        let exitCode: number | null = null;
        let stderrBuf = '';
        detachAndExit({
            taskIds: ['t1'],
            resolveTaskDir: (id) => path.join(root, 'tasks', id),
            argv: ['node', 'run-task.js'],
            spawnImpl: fake.spawnImpl,
            exit: ((code: number): never => { exitCode = code; return undefined as never; }),
            stdoutWrite: () => undefined,
            stderrWrite: (s: string) => { stderrBuf += s; },
        });
        assert.equal(exitCode, 1);
        assert.match(stderrBuf, /no PID returned/);
    });
});

// ── readCanonPid / removeCanonPid ────────────────────────────────────────────

void test('readCanonPid: returns the integer for a valid file', () => {
    withTempDir((dir) => {
        fs.writeFileSync(path.join(dir, '.canon-pid'), '4242\n', 'utf8');
        assert.equal(readCanonPid(dir), 4242);
    });
});

void test('readCanonPid: returns null for missing file', () => {
    withTempDir((dir) => {
        assert.equal(readCanonPid(dir), null);
    });
});

void test('readCanonPid: returns null for malformed content', () => {
    withTempDir((dir) => {
        fs.writeFileSync(path.join(dir, '.canon-pid'), 'not a number', 'utf8');
        assert.equal(readCanonPid(dir), null);
    });
});

void test('readCanonPid: returns null for negative or zero pid', () => {
    withTempDir((dir) => {
        fs.writeFileSync(path.join(dir, '.canon-pid'), '-1', 'utf8');
        assert.equal(readCanonPid(dir), null);
        fs.writeFileSync(path.join(dir, '.canon-pid'), '0', 'utf8');
        assert.equal(readCanonPid(dir), null);
    });
});

void test('removeCanonPid: best-effort delete', () => {
    withTempDir((dir) => {
        fs.writeFileSync(path.join(dir, '.canon-pid'), '99', 'utf8');
        removeCanonPid(dir);
        assert.ok(!fs.existsSync(path.join(dir, '.canon-pid')));
        // Idempotent: second call on missing file does not throw.
        removeCanonPid(dir);
    });
});

void test('runLogPathFor: composes path correctly', () => {
    assert.equal(runLogPathFor('/tmp/foo'), path.join('/tmp/foo', '.canon-run.log'));
});

// ── Regression: detachAndExit warns on per-task .canon-pid write failures ────
//
// Codex P2 (commit 4834bdb review): bundle-mode .canon-pid writes were
// best-effort with no surfacing. A task whose dir was unwritable became
// silently unreachable to `canon stop`. Fix surfaces failures to stderr
// before exiting.
void test('detachAndExit: warns on stderr when a per-task .canon-pid write fails', () => {
    withTempDir((root) => {
        const fake = makeSpawnFake(777);
        let stderrBuf = '';
        // Resolve "bad" to a path that cannot be mkdir'd: create a FILE at
        // the expected dir location so mkdirSync(recursive:true) fails with
        // ENOTDIR. Other tasks resolve normally.
        const badPathParent = path.join(root, 'tasks');
        fs.mkdirSync(badPathParent, { recursive: true });
        fs.writeFileSync(path.join(badPathParent, 'bad'), 'not a dir', 'utf8');

        detachAndExit({
            taskIds: ['good', 'bad'],
            resolveTaskDir: (id) => path.join(root, 'tasks', id),
            argv: ['node', 'run-task.js'],
            spawnImpl: fake.spawnImpl,
            exit: (() => undefined as never),
            stdoutWrite: () => undefined,
            stderrWrite: (s: string) => { stderrBuf += s; },
        });

        // Good task got its pid file; bad task surfaced an error.
        assert.equal(readCanonPid(path.join(root, 'tasks', 'good')), 777);
        assert.match(stderrBuf, /failed to write \.canon-pid for 1 task/);
        assert.match(stderrBuf, /bad:/);
        assert.match(stderrBuf, /fall back to \.heartbeat\.json/);
    });
});
