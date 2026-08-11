import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
    HEARTBEAT_STALE_AFTER_MS,
    isHeartbeatStale,
    readHeartbeat,
    readHeartbeatStatus,
    startHeartbeat,
    stopAllHeartbeats,
    tickAllHeartbeats,
    type HeartbeatRecord,
} from '../src/orchestrator/heartbeat.js';

function withTempDir(fn: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heartbeat-test-'));
    try { fn(dir); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function withTempDirAsync(fn: (dir: string) => Promise<void>): Promise<void> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heartbeat-test-'));
    try { await fn(dir); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function taskDirResolver(rootDir: string): (taskId: string) => string {
    // Mirrors the orchestrator's wiring in main.ts: heartbeat lives in the
    // task's own status.json directory.
    return (taskId: string) => path.join(rootDir, 'tasks', taskId);
}

void test('startHeartbeat writes initial record synchronously', () => {
    withTempDir((root) => {
        const handle = startHeartbeat(['t1'], taskDirResolver(root), { intervalMs: 999_999 });
        try {
            const file = path.join(root, 'tasks', 't1', '.heartbeat.json');
            assert.ok(fs.existsSync(file), 'heartbeat file must exist immediately after start');
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as HeartbeatRecord;
            assert.equal(parsed.pid, process.pid);
            assert.deepEqual(parsed.task_ids, ['t1']);
            assert.ok(typeof parsed.started_at_ms === 'number');
            assert.ok(typeof parsed.last_update_ms === 'number');
        } finally {
            handle.stop();
        }
    });
});

void test('startHeartbeat re-writes record on each tick', async () => {
    await withTempDirAsync(async (root) => {
        const handle = startHeartbeat(['t1'], taskDirResolver(root), { intervalMs: 50 });
        try {
            const file = path.join(root, 'tasks', 't1', '.heartbeat.json');
            const first = JSON.parse(fs.readFileSync(file, 'utf8')) as HeartbeatRecord;
            await delay(140); // ~2-3 ticks
            const second = JSON.parse(fs.readFileSync(file, 'utf8')) as HeartbeatRecord;
            assert.ok(
                second.last_update_ms > first.last_update_ms,
                `last_update_ms must advance on each tick (first=${first.last_update_ms}, second=${second.last_update_ms})`,
            );
            // started_at_ms is captured once at start() and should NOT advance.
            assert.equal(second.started_at_ms, first.started_at_ms);
        } finally {
            handle.stop();
        }
    });
});

void test('startHeartbeat writes one file per task in a bundle', () => {
    withTempDir((root) => {
        const handle = startHeartbeat(['alpha', 'beta', 'gamma'], taskDirResolver(root), { intervalMs: 999_999 });
        try {
            for (const id of ['alpha', 'beta', 'gamma']) {
                const file = path.join(root, 'tasks', id, '.heartbeat.json');
                assert.ok(fs.existsSync(file), `heartbeat file missing for ${id}`);
                const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as HeartbeatRecord;
                assert.deepEqual(parsed.task_ids.sort(), ['alpha', 'beta', 'gamma']);
            }
        } finally {
            handle.stop();
        }
    });
});

void test('handle.stop() removes heartbeat files', () => {
    withTempDir((root) => {
        const handle = startHeartbeat(['t1', 't2'], taskDirResolver(root), { intervalMs: 999_999 });
        const f1 = path.join(root, 'tasks', 't1', '.heartbeat.json');
        const f2 = path.join(root, 'tasks', 't2', '.heartbeat.json');
        assert.ok(fs.existsSync(f1));
        assert.ok(fs.existsSync(f2));
        handle.stop();
        assert.ok(!fs.existsSync(f1), 'stop() must remove heartbeat file for t1');
        assert.ok(!fs.existsSync(f2), 'stop() must remove heartbeat file for t2');
    });
});

void test('stopAllHeartbeats() cleans up every active handle', () => {
    withTempDir((root) => {
        const h1 = startHeartbeat(['t1'], taskDirResolver(root), { intervalMs: 999_999 });
        const h2 = startHeartbeat(['t2'], taskDirResolver(root), { intervalMs: 999_999 });
        const f1 = path.join(root, 'tasks', 't1', '.heartbeat.json');
        const f2 = path.join(root, 'tasks', 't2', '.heartbeat.json');
        assert.ok(fs.existsSync(f1));
        assert.ok(fs.existsSync(f2));
        stopAllHeartbeats();
        assert.ok(!fs.existsSync(f1));
        assert.ok(!fs.existsSync(f2));
        // Idempotent re-stop must not throw even after the registry has been
        // emptied — the signal forwarder calls this unconditionally.
        h1.stop();
        h2.stop();
        stopAllHeartbeats();
    });
});

void test('handle.tick() writes heartbeat to the dir the resolver currently points to', () => {
    withTempDir((root) => {
        const dir1 = path.join(root, 'tasks', 'dir1');
        const dir2 = path.join(root, 'tasks', 'dir2');
        let currentDir = dir1;
        const handle = startHeartbeat(['t1'], () => currentDir, { intervalMs: 999_999 });
        try {
            const file1 = path.join(dir1, '.heartbeat.json');
            const file2 = path.join(dir2, '.heartbeat.json');
            assert.ok(fs.existsSync(file1), 'initial heartbeat must land in the first resolver dir');
            assert.ok(!fs.existsSync(file2));

            currentDir = dir2;
            const before = Date.now();
            handle.tick();

            assert.ok(fs.existsSync(file1), 'existing heartbeat file in the old resolver dir must remain untouched');
            assert.ok(fs.existsSync(file2), 'tick must write heartbeat to the new resolver dir');
            const record1 = JSON.parse(fs.readFileSync(file1, 'utf8')) as HeartbeatRecord;
            const record = JSON.parse(fs.readFileSync(file2, 'utf8')) as HeartbeatRecord;
            assert.equal(record1.pid, process.pid);
            assert.equal(record.pid, process.pid);
            assert.ok(record.last_update_ms >= record1.last_update_ms);
            assert.ok(record.last_update_ms >= before);
        } finally {
            handle.stop();
        }
    });
});

void test('tickAllHeartbeats() writes fresh heartbeat for every active handle', () => {
    withTempDir((root) => {
        const dir1 = path.join(root, 'tasks', 'h1');
        const dir2 = path.join(root, 'tasks', 'h2');
        const h1 = startHeartbeat(['h1'], () => dir1, { intervalMs: 999_999 });
        const h2 = startHeartbeat(['h2'], () => dir2, { intervalMs: 999_999 });
        try {
            const file1 = path.join(dir1, '.heartbeat.json');
            const file2 = path.join(dir2, '.heartbeat.json');
            fs.unlinkSync(file1);
            fs.unlinkSync(file2);

            const before = Date.now();
            tickAllHeartbeats();

            assert.ok(fs.existsSync(file1));
            assert.ok(fs.existsSync(file2));
            const record1 = JSON.parse(fs.readFileSync(file1, 'utf8')) as HeartbeatRecord;
            const record2 = JSON.parse(fs.readFileSync(file2, 'utf8')) as HeartbeatRecord;
            assert.equal(record1.pid, process.pid);
            assert.equal(record2.pid, process.pid);
            assert.ok(record1.last_update_ms >= before);
            assert.ok(record2.last_update_ms >= before);
        } finally {
            h1.stop();
            h2.stop();
        }
    });
});

void test('heartbeat write survives a resolveTaskDir that throws', () => {
    withTempDir((root) => {
        let throwOn: 'badtask' | null = 'badtask';
        const resolver = (taskId: string): string => {
            if (taskId === throwOn) throw new Error('simulated resolveTaskCwd die()');
            return path.join(root, 'tasks', taskId);
        };
        const handle = startHeartbeat(['goodtask', 'badtask'], resolver, { intervalMs: 999_999 });
        try {
            // goodtask still gets its file; badtask's failure was silently skipped.
            assert.ok(fs.existsSync(path.join(root, 'tasks', 'goodtask', '.heartbeat.json')));
            assert.ok(!fs.existsSync(path.join(root, 'tasks', 'badtask', '.heartbeat.json')));
            // stop() also tolerates the throwing resolver.
            throwOn = null;
        } finally {
            handle.stop();
        }
    });
});

void test('readHeartbeat returns null for missing file', () => {
    withTempDir((root) => {
        assert.equal(readHeartbeat(path.join(root, 'no-such-dir')), null);
    });
});

void test('readHeartbeat returns null for malformed JSON', () => {
    withTempDir((root) => {
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(path.join(root, '.heartbeat.json'), '{not json', 'utf8');
        assert.equal(readHeartbeat(root), null);
    });
});

void test('readHeartbeat returns null when shape is wrong', () => {
    withTempDir((root) => {
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(
            path.join(root, '.heartbeat.json'),
            JSON.stringify({ pid: 1, started_at_ms: 0 }), // missing fields
            'utf8',
        );
        assert.equal(readHeartbeat(root), null);
    });
});

void test('readHeartbeat round-trips a written record', () => {
    withTempDir((root) => {
        const handle = startHeartbeat(['t1'], taskDirResolver(root), { intervalMs: 999_999 });
        try {
            const record = readHeartbeat(path.join(root, 'tasks', 't1'));
            assert.ok(record);
            assert.equal(record?.pid, process.pid);
            assert.deepEqual(record?.task_ids, ['t1']);
        } finally {
            handle.stop();
        }
    });
});

void test('isHeartbeatStale: null record is stale', () => {
    assert.equal(isHeartbeatStale(null), true);
});

void test('isHeartbeatStale: fresh record (now) is not stale', () => {
    const now = Date.now();
    const record: HeartbeatRecord = {
        pid: 1,
        started_at_ms: now,
        last_update_ms: now,
        task_ids: ['t1'],
    };
    assert.equal(isHeartbeatStale(record, now), false);
});

void test('isHeartbeatStale: exactly at threshold is NOT stale (boundary)', () => {
    const now = 1_000_000_000;
    const record: HeartbeatRecord = {
        pid: 1,
        started_at_ms: 0,
        last_update_ms: now - HEARTBEAT_STALE_AFTER_MS,
        task_ids: ['t1'],
    };
    // > threshold is stale; == threshold is OK (Boolean test uses strict >).
    assert.equal(isHeartbeatStale(record, now), false);
});

void test('isHeartbeatStale: 1ms past threshold IS stale', () => {
    const now = 1_000_000_000;
    const record: HeartbeatRecord = {
        pid: 1,
        started_at_ms: 0,
        last_update_ms: now - HEARTBEAT_STALE_AFTER_MS - 1,
        task_ids: ['t1'],
    };
    assert.equal(isHeartbeatStale(record, now), true);
});

// ── readHeartbeatStatus ──────────────────────────────────────────────────────
//
// The tagged-union variant distinguishes "file isn't there yet (keep polling)"
// from "file exists but is broken (bail out)". canon stop's wait-for-heartbeat
// poller needs that distinction so a corrupted heartbeat doesn't burn the
// full wait timeout. See src/cli/commands/stop.ts.

void test('readHeartbeatStatus: returns missing when file is absent', () => {
    withTempDir((root) => {
        const result = readHeartbeatStatus(path.join(root, 'no-such-task'));
        assert.equal(result.kind, 'missing');
    });
});

void test('readHeartbeatStatus: returns found with the record when valid', () => {
    withTempDir((root) => {
        const handle = startHeartbeat(['t1'], taskDirResolver(root), { intervalMs: 999_999 });
        try {
            const result = readHeartbeatStatus(path.join(root, 'tasks', 't1'));
            assert.equal(result.kind, 'found');
            if (result.kind === 'found') {
                assert.equal(result.record.pid, process.pid);
                assert.deepEqual(result.record.task_ids, ['t1']);
            }
        } finally {
            handle.stop();
        }
    });
});

void test('readHeartbeatStatus: returns corrupt for invalid JSON', () => {
    withTempDir((root) => {
        const dir = path.join(root, 'task-dir');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, '.heartbeat.json'), '{not valid json', 'utf8');
        const result = readHeartbeatStatus(dir);
        assert.equal(result.kind, 'corrupt');
        if (result.kind === 'corrupt') {
            assert.match(result.reason, /invalid JSON/);
        }
    });
});

void test('readHeartbeatStatus: returns corrupt for wrong shape (missing fields)', () => {
    withTempDir((root) => {
        const dir = path.join(root, 'task-dir');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, '.heartbeat.json'),
            JSON.stringify({ pid: 99 }), // missing started_at_ms, last_update_ms, task_ids
            'utf8',
        );
        const result = readHeartbeatStatus(dir);
        assert.equal(result.kind, 'corrupt');
        if (result.kind === 'corrupt') {
            assert.match(result.reason, /wrong shape/);
        }
    });
});

void test('readHeartbeatStatus: returns corrupt for wrong shape (wrong types)', () => {
    withTempDir((root) => {
        const dir = path.join(root, 'task-dir');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, '.heartbeat.json'),
            JSON.stringify({
                pid: 'not-a-number',
                started_at_ms: 0,
                last_update_ms: 0,
                task_ids: ['t1'],
            }),
            'utf8',
        );
        const result = readHeartbeatStatus(dir);
        assert.equal(result.kind, 'corrupt');
    });
});

void test('readHeartbeat: still returns the record when readHeartbeatStatus would say found', () => {
    // The legacy convenience wrapper must keep working — it's used by doctor,
    // decideStopAction, and other call sites that don't care about the
    // missing-vs-corrupt distinction.
    withTempDir((root) => {
        const handle = startHeartbeat(['t1'], taskDirResolver(root), { intervalMs: 999_999 });
        try {
            const record = readHeartbeat(path.join(root, 'tasks', 't1'));
            assert.ok(record);
            assert.equal(record?.pid, process.pid);
        } finally {
            handle.stop();
        }
    });
});
