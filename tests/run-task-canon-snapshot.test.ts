import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { REPO_ROOT } from '../scripts/run-task/env.js';
import {
    CANON_UPSTREAM_REPO,
    captureCanonSnapshot,
    refreshCanonSnapshotAtPath,
} from '../scripts/run-task/canon-snapshot.js';
import type { CanonSnapshotOptions } from '../scripts/run-task/canon-snapshot.js';
import type { CommandResult, StatusJson } from '../scripts/run-task/types.js';

const TASK_SH = path.resolve('scripts/task.sh');

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

function runTaskSh(root: string, args: string[]): string {
    return execFileSync('bash', [TASK_SH, ...args], {
        cwd: root,
        env: {
            PATH: process.env.PATH ?? '',
            HOME: process.env.HOME ?? '',
            CANON_SKIP_PHASE_GATE: '1',
        },
        encoding: 'utf8',
    });
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
        runGitAt: fakeGitRunner({
            [`${repoRoot} :: rev-parse --show-superproject-working-tree`]: { ok: true, stdout: '', stderr: '' },
            [`${repoRoot} :: rev-parse HEAD`]: { ok: true, stdout: 'native-sha', stderr: '' },
        }),
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
            runGitAt: fakeGitRunner({
                [`${REPO_ROOT} :: rev-parse --show-superproject-working-tree`]: { ok: true, stdout: '', stderr: '' },
                [`${REPO_ROOT} :: rev-parse HEAD`]: { ok: true, stdout: 'refresh-sha', stderr: '' },
            }),
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

void test('task.sh new stamps canon provenance into the seeded status.json', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-snapshot-task-new-'));
    try {
        fs.mkdirSync(path.join(root, '.canon', 'templates'), { recursive: true });
        fs.cpSync(path.join(REPO_ROOT, '.canon', 'templates'), path.join(root, '.canon', 'templates'), { recursive: true });

        const taskId = 'canon-stamp-seed';
        runTaskSh(root, ['new', taskId, 'Canon stamp seed']);

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
