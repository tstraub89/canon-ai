import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { REPO_ROOT } from '../scripts/run-task/env.js';
import {
    CANON_UPSTREAM_REPO,
    captureCanonSnapshot,
    refreshCanonSnapshotAtPath,
} from '../scripts/run-task/canon-snapshot.js';
import { taskNew } from '../src/task/index.js';
import type { CanonSnapshotOptions } from '../scripts/run-task/canon-snapshot.js';
import type { CommandResult, StatusJson } from '../scripts/run-task/types.js';

function makeStatus(taskId: string, overrides: Partial<StatusJson> = {}): StatusJson {
    return {
        id: taskId,
        title: `Canon snapshot test ${taskId}`,
        status: 'spec',
        created: '2026-05-11',
        updated: '2026-05-11',
        branch: '',
        base_branch: 'main',
        task_size: 'S',
        delicate: false,
        human_spec_gate: false,
        full_send: false,
        worktree: false,
        phases: {
            spec: { status: 'pending', agent: 'claude' },
            spec_review: { status: 'pending', agent: 'codex', verdict: '', iterations: 0 },
            plan: { status: 'pending', agent: 'claude' },
            implement: { status: 'pending', agent: 'codex' },
            code_review: { status: 'pending', agent: 'claude', verdict: '', iterations: 0 },
            qa: { status: 'pending', agent: 'claude' },
            human_review: { status: 'pending', agent: 'human' },
        },
        escalations: [],
        sessions: {},
        ...overrides,
    };
}

function fakeGitRunner(responses: Record<string, CommandResult>): NonNullable<CanonSnapshotOptions['runGitAt']> {
    return (cwd: string, ...args: string[]) => {
        const key = `${cwd} :: ${args.join(' ')}`;
        const response = responses[key];
        if (!response) {
            throw new Error(`Missing fake git response for ${key}`);
        }
        return response;
    };
}

function fakeCommandRunner(responses: Record<string, CommandResult>): NonNullable<CanonSnapshotOptions['runCommand']> {
    return (command: string, args: string[]) => {
        const key = `${command} :: ${args.join(' ')}`;
        const response = responses[key];
        if (!response) {
            throw new Error(`Missing fake command response for ${key}`);
        }
        return response;
    };
}

function nativeGitResponses(repoRoot: string, sha: string): Record<string, CommandResult> {
    const parentDir = path.dirname(repoRoot);
    return {
        [`${repoRoot} :: rev-parse --show-superproject-working-tree`]: { ok: true, stdout: '', stderr: '' },
        [`${repoRoot} :: rev-parse HEAD`]: { ok: true, stdout: sha, stderr: '' },
        [`${repoRoot} :: rev-parse --show-toplevel`]: { ok: true, stdout: repoRoot, stderr: '' },
        [`${parentDir} :: rev-parse --show-toplevel`]: { ok: false, stdout: '', stderr: '' },
    };
}

function withEnv<T>(updates: Record<string, string | undefined>, fn: () => T): T {
    const previous = new Map<string, string | undefined>();
    for (const key of Object.keys(updates)) {
        previous.set(key, process.env[key]);
        const value = updates[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    try {
        return fn();
    } finally {
        for (const [key, value] of previous) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

void test('captureCanonSnapshot uses the current checkout SHA for native canon', () => {
    const snapshot = captureCanonSnapshot(REPO_ROOT);
    assert.equal(snapshot.upstream_repo, CANON_UPSTREAM_REPO);
    assert.equal(snapshot.upstream_commit, snapshot.orchestrator_commit);
    assert.ok(snapshot.upstream_commit.length > 0);
});

void test('captureCanonSnapshot uses the superproject SHA when canon is vendored', () => {
    const repoRoot = '/tmp/vendor/canon-ai';
    const snapshot = captureCanonSnapshot(repoRoot, {
        runGitAt: fakeGitRunner({
            [`${repoRoot} :: rev-parse --show-superproject-working-tree`]: { ok: true, stdout: '/tmp/host', stderr: '' },
            [`${repoRoot} :: rev-parse HEAD`]: { ok: true, stdout: 'submodule-sha', stderr: '' },
            ['/tmp/host :: rev-parse HEAD']: { ok: true, stdout: 'host-sha', stderr: '' },
        }),
        runCommand: fakeCommandRunner({
            ['codex :: --version']: { ok: true, stdout: 'codex 1.2.3', stderr: '' },
            ['claude :: --version']: { ok: true, stdout: 'claude 4.5.6', stderr: '' },
        }),
    });
    assert.equal(snapshot.upstream_repo, CANON_UPSTREAM_REPO);
    assert.equal(snapshot.upstream_commit, 'submodule-sha');
    assert.equal(snapshot.orchestrator_commit, 'host-sha');
    assert.equal(snapshot.codex_cli, 'codex 1.2.3');
    assert.equal(snapshot.claude_code, 'claude 4.5.6');
});

void test('captureCanonSnapshot records unavailable CLIs without failing', () => {
    const repoRoot = '/tmp/native/canon-ai';
    const snapshot = captureCanonSnapshot(repoRoot, {
        runGitAt: fakeGitRunner(nativeGitResponses(repoRoot, 'native-sha')),
        runCommand: fakeCommandRunner({
            ['codex :: --version']: { ok: false, stdout: '', stderr: 'ENOENT' },
            ['claude :: --version']: { ok: false, stdout: '', stderr: 'ENOENT' },
        }),
    });
    assert.equal(snapshot.upstream_commit, 'native-sha');
    assert.equal(snapshot.orchestrator_commit, 'native-sha');
    assert.equal(snapshot.codex_cli, '<unavailable>');
    assert.equal(snapshot.claude_code, '<unavailable>');
});

void test('refreshCanonSnapshotAtPath stamps an older task before pipeline work starts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-snapshot-refresh-'));
    try {
        const taskId = 'stale-task';
        const taskDir = path.join(root, 'tasks', taskId);
        fs.mkdirSync(taskDir, { recursive: true });
        const statusFile = path.join(taskDir, 'status.json');
        fs.writeFileSync(statusFile, `${JSON.stringify(makeStatus(taskId, { canon: undefined }), null, 2)}\n`, 'utf8');

        refreshCanonSnapshotAtPath(statusFile, {
            runGitAt: fakeGitRunner(nativeGitResponses(REPO_ROOT, 'refresh-sha')),
            runCommand: fakeCommandRunner({
                ['codex :: --version']: { ok: true, stdout: 'codex 9.9.9', stderr: '' },
                ['claude :: --version']: { ok: true, stdout: 'claude 8.8.8', stderr: '' },
            }),
        });

        const updated = JSON.parse(fs.readFileSync(statusFile, 'utf8')) as StatusJson;
        assert.equal(updated.canon?.upstream_repo, CANON_UPSTREAM_REPO);
        assert.equal(updated.canon?.upstream_commit, 'refresh-sha');
        assert.equal(updated.canon?.orchestrator_commit, 'refresh-sha');
        assert.equal(updated.canon?.codex_cli, 'codex 9.9.9');
        assert.equal(updated.canon?.claude_code, 'claude 8.8.8');
        assert.equal(updated.updated, new Date().toISOString().slice(0, 10));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('captureCanonSnapshot uses CANON_UPSTREAM_REPO env var when non-empty', () => {
    const repoRoot = '/tmp/env-override/canon-ai';
    withEnv({ CANON_UPSTREAM_REPO: 'my-fork/canon-ai' }, () => {
        const snapshot = captureCanonSnapshot(repoRoot, {
            runGitAt: fakeGitRunner(nativeGitResponses(repoRoot, 'abc1234')),
            runCommand: fakeCommandRunner({
                ['codex :: --version']: { ok: true, stdout: 'codex 1.0.0', stderr: '' },
                ['claude :: --version']: { ok: true, stdout: 'claude 1.0.0', stderr: '' },
            }),
        });
        assert.equal(snapshot.upstream_repo, 'my-fork/canon-ai');
    });
});

void test('captureCanonSnapshot falls back to the const when CANON_UPSTREAM_REPO is unset, empty, or whitespace-only', () => {
    for (const [label, value] of [
        ['unset', undefined],
        ['empty', ''],
        ['whitespace', '   '],
    ] as const) {
        const repoRoot = `/tmp/env-${label}/canon-ai`;
        withEnv({ CANON_UPSTREAM_REPO: value }, () => {
            const snapshot = captureCanonSnapshot(repoRoot, {
                runGitAt: fakeGitRunner(nativeGitResponses(repoRoot, `${label}-sha`)),
                runCommand: fakeCommandRunner({
                    ['codex :: --version']: { ok: true, stdout: 'codex 1.0.0', stderr: '' },
                    ['claude :: --version']: { ok: true, stdout: 'claude 1.0.0', stderr: '' },
                }),
            });
            assert.equal(snapshot.upstream_repo, CANON_UPSTREAM_REPO);
        });
    }
});

void test('captureCanonSnapshot uses host HEAD when canon is a plain vendored clone', () => {
    const repoRoot = '/tmp/host/vendor/canon-ai';
    const parentDir = path.dirname(repoRoot);
    const parentToplevel = '/tmp/host';
    const snapshot = captureCanonSnapshot(repoRoot, {
        runGitAt: fakeGitRunner({
            [`${repoRoot} :: rev-parse --show-superproject-working-tree`]: { ok: true, stdout: '', stderr: '' },
            [`${repoRoot} :: rev-parse HEAD`]: { ok: true, stdout: 'canon-sha', stderr: '' },
            [`${repoRoot} :: rev-parse --show-toplevel`]: { ok: true, stdout: repoRoot, stderr: '' },
            [`${parentDir} :: rev-parse --show-toplevel`]: { ok: true, stdout: parentToplevel, stderr: '' },
            [`${parentToplevel} :: rev-parse HEAD`]: { ok: true, stdout: 'host-sha', stderr: '' },
        }),
        runCommand: fakeCommandRunner({
            ['codex :: --version']: { ok: true, stdout: 'codex 1.0.0', stderr: '' },
            ['claude :: --version']: { ok: true, stdout: 'claude 1.0.0', stderr: '' },
        }),
    });
    assert.equal(snapshot.upstream_commit, 'canon-sha');
    assert.equal(snapshot.orchestrator_commit, 'host-sha');
    assert.notEqual(snapshot.orchestrator_commit, snapshot.upstream_commit);
});

void test('captureCanonSnapshot falls back to native mode when no enclosing repo exists', () => {
    const repoRoot = '/tmp/standalone/canon-ai';
    const snapshot = captureCanonSnapshot(repoRoot, {
        runGitAt: fakeGitRunner(nativeGitResponses(repoRoot, 'standalone-sha')),
        runCommand: fakeCommandRunner({
            ['codex :: --version']: { ok: true, stdout: 'codex 1.0.0', stderr: '' },
            ['claude :: --version']: { ok: true, stdout: 'claude 1.0.0', stderr: '' },
        }),
    });
    assert.equal(snapshot.orchestrator_commit, snapshot.upstream_commit);
    assert.equal(snapshot.orchestrator_commit, 'standalone-sha');
});

void test('captureCanonSnapshot falls back to native mode when parent resolves to own toplevel', () => {
    const repoRoot = '/tmp/monorepo/packages/canon-ai';
    const parentDir = path.dirname(repoRoot);
    const sharedToplevel = '/tmp/monorepo';
    const snapshot = captureCanonSnapshot(repoRoot, {
        runGitAt: fakeGitRunner({
            [`${repoRoot} :: rev-parse --show-superproject-working-tree`]: { ok: true, stdout: '', stderr: '' },
            [`${repoRoot} :: rev-parse HEAD`]: { ok: true, stdout: 'canon-sha2', stderr: '' },
            [`${repoRoot} :: rev-parse --show-toplevel`]: { ok: true, stdout: sharedToplevel, stderr: '' },
            [`${parentDir} :: rev-parse --show-toplevel`]: { ok: true, stdout: sharedToplevel, stderr: '' },
        }),
        runCommand: fakeCommandRunner({
            ['codex :: --version']: { ok: true, stdout: 'codex 1.0.0', stderr: '' },
            ['claude :: --version']: { ok: true, stdout: 'claude 1.0.0', stderr: '' },
        }),
    });
    assert.equal(snapshot.orchestrator_commit, snapshot.upstream_commit);
    assert.equal(snapshot.orchestrator_commit, 'canon-sha2');
});

function withCwd<T>(cwd: string, fn: () => T): T {
    const previous = process.cwd();
    process.chdir(cwd);
    try {
        return fn();
    } finally {
        process.chdir(previous);
    }
}

void test('taskNew stamps canon provenance into the seeded status.json', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-snapshot-task-new-'));
    try {
        fs.mkdirSync(path.join(root, '.canon', 'templates'), { recursive: true });
        fs.cpSync(path.join(REPO_ROOT, '.canon', 'templates'), path.join(root, '.canon', 'templates'), { recursive: true });

        const taskId = 'canon-stamp-seed';
        withCwd(root, () => taskNew([taskId, 'Canon stamp seed']));

        const status = JSON.parse(fs.readFileSync(path.join(root, 'tasks', taskId, 'status.json'), 'utf8')) as StatusJson;
        assert.equal(status.canon?.upstream_repo, CANON_UPSTREAM_REPO);
        assert.match(status.canon?.upstream_commit ?? '', /^[0-9a-f]{7,40}$/i);
        assert.match(status.canon?.orchestrator_commit ?? '', /^[0-9a-f]{7,40}$/i);
        assert.ok(status.canon?.codex_cli);
        assert.ok(status.canon?.claude_code);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
