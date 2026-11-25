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
    return { taskId, activeCwd: root, phase, agent: 'codex', model: 'test-model', effort: 'high', durationMs: 1234, tokens: 42, status: 'ok' };
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
    const cells = single.split('\n').find(line => line.startsWith('| 20'))!.split('|').slice(1, -1).map(cell => cell.trim());
    assert.equal(cells.length, 10);
    assert.equal(cells[9], 'high');
    assert.match(single, /\| example-task \| spec \| codex \| test-model \| - \| 1\.2s \| 42 \| ok \|/);
    assert.match(fs.readFileSync(path.join(root, 'tasks/a/metrics.md'), 'utf8'), /\| a\+b \|/);
    assert.ok(!fs.existsSync(path.join(root, 'tasks/b')));
}));

void test('recordMetric widens a legacy metrics header without changing old rows', () => fixture(root => {
    const fragment = path.join(root, 'tasks/example-task/metrics.md');
    fs.mkdirSync(path.dirname(fragment), { recursive: true });
    const legacyHeader = '| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |\n|---|---|---|---|---|---|---|---|---|';
    const oldRow = '| 2025-01-01T00:00:00.000Z | example-task | spec | codex | old | - | 1.0s | 5 | ok |';
    fs.writeFileSync(fragment, `${legacyHeader}\n${oldRow}\n`);
    recordMetric(entry(root));
    const result = fs.readFileSync(fragment, 'utf8');
    const separatorEnd = METRICS_SKELETON.indexOf('\n', METRICS_SKELETON.indexOf('|---|'));
    const expectedHeader = METRICS_SKELETON.slice(0, separatorEnd);
    assert.equal(result.slice(0, result.indexOf(`\n${oldRow}`)), expectedHeader);
    assert.ok(result.includes(`\n${oldRow}\n`));
    const rows = result.split('\n').filter(line => line.startsWith('| 20'));
    assert.equal(rows.at(-1)!.split('|').length - 2, 10);
}));

void test('recordMetric preserves current headers and hand-edited fragments without a table', () => fixture(root => {
    const fragment = path.join(root, 'tasks/example-task/metrics.md');
    fs.mkdirSync(path.dirname(fragment), { recursive: true });
    const prefix = METRICS_SKELETON + 'existing row\n';
    fs.writeFileSync(fragment, prefix);
    recordMetric(entry(root));
    assert.ok(fs.readFileSync(fragment, 'utf8').startsWith(prefix));
    const noTable = path.join(root, 'tasks/no-table/metrics.md');
    fs.mkdirSync(path.dirname(noTable), { recursive: true });
    fs.writeFileSync(noTable, '# Hand edited fragment\nkeep this\n');
    recordMetric(entry(root, 'no-table'));
    assert.ok(fs.readFileSync(noTable, 'utf8').startsWith('# Hand edited fragment\nkeep this\n'));
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

void test('metrics skeleton notes match adopter header and Agent cells escape delimiters', () => fixture(root => {
    const template = fs.readFileSync(path.join(process.cwd(), 'templates/docs/pipeline-invocations.md'), 'utf8');
    const notes = (value: string) => value.split('\n').filter(line => line.startsWith('>'));
    assert.deepEqual(notes(METRICS_SKELETON), notes(template));
    assert.deepEqual(template.split('\n').filter(line => line.startsWith('|')), METRICS_SKELETON.split('\n').filter(line => line.startsWith('|')));
    assert.match(METRICS_SKELETON, /Status \| Effort \|/);
    process.env.CANON_METRICS_FILE_OVERRIDE = path.join(root, 'metrics.md');
    recordMetric({ ...entry(root), agent: 'claude:a|b\nc' });
    const row = fs.readFileSync(path.join(root, 'metrics.md'), 'utf8').split('\n').find(line => line.startsWith('| 20'));
    assert.ok(row);
    assert.equal(row.split(/(?<!\\)\|/).length - 2, 10);
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
