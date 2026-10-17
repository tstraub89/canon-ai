import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { METRICS_SKELETON, recordMetric } from '../src/orchestrator/metrics.js';
import type { MetricEntry } from '../src/orchestrator/types.js';

function fixture(fn: (root: string) => void): void {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-'));
    const keys = ['CANON_METRICS_FILE_OVERRIDE', 'CANON_TASKS_DIR_OVERRIDE'];
    const previous = keys.map(key => process.env[key]);
    keys.forEach(key => { delete process.env[key]; });
    try { fn(root); } finally {
        keys.forEach((key, index) => {
            if (previous[index] === undefined) delete process.env[key];
            else process.env[key] = previous[index];
        });
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function entry(root: string, taskId = 'example-task', phase: MetricEntry['phase'] = 'spec'): MetricEntry {
    return { taskId, activeCwd: root, phase, agent: 'codex', model: 'test-model', durationMs: 1234, tokens: 42, status: 'ok' };
}

void test('metrics use per-task fragments, preserve shared docs, and retain bundle labels', () => fixture(root => {
    fs.mkdirSync(path.join(root, 'docs'));
    const shared = path.join(root, 'docs/pipeline-invocations.md');
    fs.writeFileSync(shared, METRICS_SKELETON);
    recordMetric(entry(root));
    recordMetric(entry(root, 'a+b'));
    assert.equal(fs.readFileSync(shared, 'utf8'), METRICS_SKELETON);
    const single = fs.readFileSync(path.join(root, 'tasks/example-task/metrics.md'), 'utf8');
    assert.ok(single.startsWith(METRICS_SKELETON));
    assert.match(single, /\| example-task \| spec \| codex \| test-model \| - \| 1\.2s \| 42 \| ok \|/);
    assert.match(fs.readFileSync(path.join(root, 'tasks/a/metrics.md'), 'utf8'), /\| a\+b \|/);
    assert.ok(!fs.existsSync(path.join(root, 'tasks/b')));
}));

void test('metrics overrides resolve at call time, with file override taking precedence', () => fixture(root => {
    process.env.CANON_TASKS_DIR_OVERRIDE = path.join(root, 'custom');
    recordMetric(entry(root));
    assert.ok(fs.existsSync(path.join(root, 'custom/example-task/metrics.md')));
    process.env.CANON_METRICS_FILE_OVERRIDE = path.join(root, 'override.md');
    recordMetric(entry(root, 'other'));
    assert.match(fs.readFileSync(path.join(root, 'override.md'), 'utf8'), /\| other \|/);
    assert.ok(!fs.existsSync(path.join(root, 'custom/other')));
    assert.ok(!fs.existsSync(path.join(root, 'docs')));
}));

void test('metrics warn without throwing when task directory cannot be written', () => fixture(root => {
    fs.writeFileSync(path.join(root, 'tasks'), 'blocks directory creation');
    const warnings: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
    try { assert.doesNotThrow(() => recordMetric(entry(root))); } finally { console.error = original; }
    assert.match(warnings.join('\n'), /metrics: could not record spec row/);
}));

void test('early phases leave all shared telemetry clean in a real main checkout', () => fixture(root => {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-b', 'main');
    git('config', 'user.name', 'Test User');
    git('config', 'user.email', 'test@example.com');
    fs.mkdirSync(path.join(root, 'docs'));
    fs.writeFileSync(path.join(root, 'docs/pipeline-invocations.md'), METRICS_SKELETON);
    fs.writeFileSync(path.join(root, 'docs/task-quality-log.md'), '# Quality\n');
    fs.writeFileSync(path.join(root, 'docs/lessons-learned.md'), '# Lessons\n');
    git('add', 'docs');
    git('commit', '-m', 'initial telemetry');
    for (const phase of ['spec', 'spec_review', 'plan'] as const) recordMetric(entry(root, 'early', phase));
    assert.equal(git('status', '--porcelain', '--', 'docs'), '');
    const fragment = fs.readFileSync(path.join(root, 'tasks/early/metrics.md'), 'utf8');
    for (const phase of ['spec', 'spec_review', 'plan']) assert.ok(fragment.includes(`| early | ${phase} |`));
}));
