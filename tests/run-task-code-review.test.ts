import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCodex, runColdCodexReview } from '../scripts/run-task/agents/codex.js';
import { recordMetric } from '../scripts/run-task/metrics.js';
import { runCodeReviewPhase, type CodeReviewPhaseDeps } from '../scripts/run-task/phases/code-review.js';
import { readStatus, writeStatusToFile } from '../scripts/run-task/state.js';
import type { PipelineState, StatusJson, TaskContext } from '../scripts/run-task/types.js';

async function withTempTasksAsync<T>(fn: (tasksRoot: string, activeCwd: string) => Promise<T>): Promise<T> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-task-code-review-'));
    const tasksRoot = path.join(root, 'tasks');
    const activeCwd = path.join(root, 'worktree');
    const previousTasks = process.env.CANON_TASKS_DIR_OVERRIDE;
    process.env.CANON_TASKS_DIR_OVERRIDE = tasksRoot;
    try {
        fs.mkdirSync(tasksRoot, { recursive: true });
        fs.mkdirSync(activeCwd, { recursive: true });
        return await fn(tasksRoot, activeCwd);
    } finally {
        if (previousTasks === undefined) delete process.env.CANON_TASKS_DIR_OVERRIDE;
        else process.env.CANON_TASKS_DIR_OVERRIDE = previousTasks;
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function makeCodeReviewStatus(taskId: string): StatusJson {
    return {
        id: taskId,
        title: taskId,
        status: 'code_review',
        created: '2026-06-26',
        updated: '2026-06-26',
        branch: '',
        base_branch: 'main',
        task_size: 'M',
        delicate: false,
        human_spec_gate: false,
        full_send: false,
        worktree: false,
        phases: {
            spec: { status: 'done', agent: 'claude' },
            spec_review: { status: 'done', agent: 'codex', verdict: 'approved', iterations: 0 },
            plan: { status: 'done', agent: 'claude' },
            implement: { status: 'done', agent: 'codex' },
            code_review: {
                status: 'pending',
                agent: 'claude',
                verdict: '',
                iterations: 0,
                iterations_current_loop: 0,
                iterations_total: 0,
                changes_requested_total: 0,
                preflight_rejections_current_loop: 0,
                preflight_rejections_total: 0,
                auto_block_count: 0,
            },
            qa: { status: 'pending', agent: 'claude' },
            human_review: { status: 'pending', agent: 'human' },
        },
        escalations: [],
        sessions: {},
    };
}

function writeTask(tasksRoot: string, taskId: string): void {
    const taskDir = path.join(tasksRoot, taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    writeStatusToFile(path.join(taskDir, 'status.json'), makeCodeReviewStatus(taskId));
    fs.writeFileSync(path.join(taskDir, 'spec.md'), [
        '# Spec',
        '',
        '## Acceptance Criteria',
        '',
        '- [ ] AC-1: Fixture behavior',
        '',
        '## Validation Required',
        '',
        '- [x] `npm test`',
        '',
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(taskDir, 'handoff.md'), [
        `# Implementation Handoff: ${taskId}`,
        '',
        '## Changes',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| `src/foo.ts` | fixture change |',
        '',
        '## AC Coverage',
        '',
        '| AC | Status | Evidence |',
        '|---|---|---|',
        '| AC-1: Fixture behavior | Met | fixture evidence |',
        '',
        '## Validation Outcomes',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| `npm test` | Pass | fixture |',
        '',
    ].join('\n'), 'utf8');
}

function taskContext(taskId: string): TaskContext {
    const status = readStatus(taskId);
    const codeReview = status.phases.code_review;
    return {
        taskId,
        title: status.title ?? taskId,
        specReviewVerdict: 'approved',
        iterations: codeReview?.iterations ?? 0,
        iterations_current_loop: codeReview?.iterations_current_loop ?? 0,
        iterations_total: codeReview?.iterations_total ?? 0,
        rerouteCount: codeReview?.reroute_count ?? 0,
        status,
    };
}

function makeState(taskIds: readonly string[]): PipelineState {
    return {
        tasks: taskIds.map(taskContext),
        tier: 'full',
        isBundle: taskIds.length > 1,
    };
}

function writeFakeCodexScript(dir: string, body: string): string {
    const scriptPath = path.join(dir, 'fake-codex.mjs');
    fs.writeFileSync(scriptPath, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
    return scriptPath;
}

async function withMetricsFileAsync<T>(dir: string, fn: (metricsFile: string) => Promise<T>): Promise<T> {
    const metricsFile = path.join(dir, 'pipeline-invocations.md');
    const previous = process.env.CANON_METRICS_FILE_OVERRIDE;
    process.env.CANON_METRICS_FILE_OVERRIDE = metricsFile;
    try {
        return await fn(metricsFile);
    } finally {
        if (previous === undefined) delete process.env.CANON_METRICS_FILE_OVERRIDE;
        else process.env.CANON_METRICS_FILE_OVERRIDE = previous;
    }
}

function readMetricRows(metricsFile: string): string[][] {
    return fs.readFileSync(metricsFile, 'utf8')
        .split('\n')
        .filter(line => /^\| 20\d\d-/.test(line))
        .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
}

async function captureDie(fn: () => Promise<unknown>): Promise<string> {
    const originalExit: typeof process.exit = process.exit.bind(process);
    const originalError = console.error;
    const errors: string[] = [];
    process.exit = (code?: string | number | null): never => {
        throw Object.assign(new Error('process.exit'), { code });
    };
    console.error = (...args: unknown[]): void => { errors.push(args.map(String).join(' ')); };
    try {
        await assert.rejects(fn, (error: unknown) => isProcessExitError(error, 1));
    } finally {
        process.exit = originalExit;
        console.error = originalError;
    }
    return errors.join('\n');
}

function assertInvalidEffortMessage(message: string): void {
    assert.match(message, /ultra/);
    assert.match(message, /none\|minimal\|low\|medium\|high\|xhigh/);
    assert.match(message, /per-invocation override supersedes any user-level model_reasoning_effort/);
    assert.match(message, /~\/\.codex\/config\.toml/);
}

function makeDeps(options: {
    activeCwd: string;
    events: string[];
    coldSuccess?: boolean;
    findings?: string;
    onClaude?: (prompt: string) => void;
}): CodeReviewPhaseDeps {
    return {
        verifyBranch: () => { options.events.push('verifyBranch'); },
        getBaseBranch: () => 'main',
        getActiveCwd: () => options.activeCwd,
        getAffectedFiles: () => [],
        verifyHandoffAgainstDiff: () => [],
        getScopedDiff: () => ({ diff: 'diff --git a/src/foo.ts b/src/foo.ts\n', truncated: false }),
        getClaudeConfig: () => ({ model: 'sonnet', effort: 'high', budget: '20.00' }),
        getMaxReviewLoops: () => 3,
        getCodexConfig: () => ({ model: 'mini-from-policy', effort: 'high' }),
        runColdCodexReview: (_baseBranch, model, effort, cwd, metricsContext) => {
            options.events.push(`cold:${model}:${effort}:${cwd}:${metricsContext?.taskId}:${metricsContext?.iteration}`);
            return Promise.resolve({
                success: options.coldSuccess ?? true,
                findings: options.findings ?? '[P2] src/foo.ts:10 - null deref',
                durationMs: 1,
            });
        },
        runClaude: (prompt: string) => {
            options.events.push('foreman');
            options.onClaude?.(prompt);
            return Promise.resolve({
                exitCode: 0,
                signal: null,
                spawnError: null,
                stalled: false,
                capturedStdout: '',
                capturedStderr: '',
                sessionId: 'claude-session',
                processedText: '',
            });
        },
    };
}

function isProcessExitError(error: unknown, code: number): boolean {
    return error instanceof Error &&
        error.message === 'process.exit' &&
        'code' in error &&
        error.code === code;
}

void test('runColdCodexReview captures agent_message findings and uses codex review args', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-review-'));
    try {
        const argsFile = path.join(dir, 'args.txt');
        const fakeCodex = writeFakeCodexScript(dir, [
            `import fs from 'node:fs';`,
            `fs.writeFileSync(${JSON.stringify(argsFile)}, process.argv.slice(2).join('\\n'));`,
            `console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '[P2] src/foo.ts:10 - null deref' } }));`,
            `console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'second paragraph' } }));`,
            `console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }));`,
        ].join('\n'));

        const result = await runColdCodexReview('main', 'gpt-mini', 'high', dir, undefined, { codexBinary: fakeCodex });

        assert.equal(result.success, true);
        assert.equal(result.findings, '[P2] src/foo.ts:10 - null deref\n\nsecond paragraph');
        assert.ok(result.durationMs >= 0);
        assert.deepEqual(fs.readFileSync(argsFile, 'utf8').split('\n'), [
            'exec',
            'review',
            '--json',
            '-c',
            'model_reasoning_effort=high',
            '--base',
            'main',
            '-m',
            'gpt-mini',
        ]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runColdCodexReview reports unavailable when no findings output is captured', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-review-empty-'));
    try {
        const fakeCodex = writeFakeCodexScript(dir, `process.exit(1);`);
        const result = await runColdCodexReview('main', 'gpt-mini', 'high', dir, undefined, { codexBinary: fakeCodex });
        assert.equal(result.success, false);
        assert.equal(result.findings, '');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runColdCodexReview reports unavailable when the stream truncates before turn.completed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-review-truncated-'));
    try {
        // A partial review: an agent_message is emitted, then the process crashes (non-zero
        // exit) before the turn completes. Captured findings are non-empty but incomplete, so
        // the review must NOT be treated as obtained — this is the case both PR bots flagged.
        const fakeCodex = writeFakeCodexScript(dir, [
            `console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '[P2] src/foo.ts:10 - partial finding' } }));`,
            `process.exit(1);`,
        ].join('\n'));
        const result = await runColdCodexReview('main', 'gpt-mini', 'high', dir, undefined, { codexBinary: fakeCodex });
        assert.equal(result.success, false);
        assert.equal(result.findings, '[P2] src/foo.ts:10 - partial finding');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runColdCodexReview rejects an invalid effort before spawning', { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-review-effort-'));
    try {
        const sentinel = path.join(dir, 'spawned.txt');
        const fakeCodex = writeFakeCodexScript(dir, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(sentinel)}, 'spawned');`);
        const message = await captureDie(() => runColdCodexReview(
            'main',
            'gpt-mini',
            'ultra',
            dir,
            undefined,
            { codexBinary: fakeCodex },
        ));

        assert.equal(fs.existsSync(sentinel), false);
        assertInvalidEffortMessage(message);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runCodex rejects an invalid effort before spawning on the fresh path', { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-fresh-effort-'));
    const previousPath = process.env.PATH;
    try {
        const sentinel = path.join(dir, 'spawned.txt');
        const binary = path.join(dir, 'codex');
        fs.writeFileSync(binary, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'spawned');\n`, { mode: 0o755 });
        process.env.PATH = `${dir}${path.delimiter}${previousPath ?? ''}`;

        const message = await captureDie(() => runCodex('prompt', false, null, 'gpt-mini', 'ultra', undefined, dir));

        assert.equal(fs.existsSync(sentinel), false);
        assertInvalidEffortMessage(message);
    } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runCodex rejects an invalid effort before spawning on the resumed path', { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-resume-effort-'));
    const previousPath = process.env.PATH;
    try {
        const sentinel = path.join(dir, 'spawned.txt');
        const binary = path.join(dir, 'codex');
        fs.writeFileSync(binary, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'spawned');\n`, { mode: 0o755 });
        process.env.PATH = `${dir}${path.delimiter}${previousPath ?? ''}`;

        const message = await captureDie(() => runCodex('prompt', false, 'resume-id', 'gpt-mini', 'ultra', undefined, dir));

        assert.equal(fs.existsSync(sentinel), false);
        assertInvalidEffortMessage(message);
    } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runColdCodexReview records one successful metric row with usage and round attribution', { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-review-metrics-ok-'));
    try {
        const fakeCodex = writeFakeCodexScript(dir, [
            `console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'clean review' } }));`,
            `console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 4 } }));`,
        ].join('\n'));

        await withMetricsFileAsync(dir, async metricsFile => {
            recordMetric({
                taskId: 'task-a+task-b',
                phase: 'code_review',
                agent: 'claude',
                model: 'sonnet',
                iteration: 2,
                durationMs: 1,
                status: 'ok',
            });
            const result = await runColdCodexReview(
                'main',
                'gpt-mini',
                'high',
                dir,
                { taskId: 'task-a+task-b', phase: 'code_review', iteration: 2, activeCwd: dir },
                { codexBinary: fakeCodex },
            );
            assert.equal(result.success, true);

            const rows = readMetricRows(metricsFile);
            const codexRows = rows.filter(row => row[2] === 'code_review' && row[3] === 'codex');
            const claudeRows = rows.filter(row => row[2] === 'code_review' && row[3] === 'claude');
            assert.equal(codexRows.length, 1);
            assert.equal(claudeRows.length, 1);
            assert.deepEqual(codexRows[0]?.slice(1, 6), ['task-a+task-b', 'code_review', 'codex', 'gpt-mini', '2']);
            assert.match(codexRows[0]?.[6] ?? '', /^\d+\.\d+s$/);
            assert.equal(codexRows[0]?.[7], '7');
            assert.equal(codexRows[0]?.[8], 'ok');
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runColdCodexReview records one failed metric row for an incomplete stream', { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-review-metrics-failed-'));
    try {
        const fakeCodex = writeFakeCodexScript(dir, [
            `console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'partial review' } }));`,
            `process.exit(1);`,
        ].join('\n'));

        await withMetricsFileAsync(dir, async metricsFile => {
            const result = await runColdCodexReview(
                'main',
                'gpt-mini',
                'high',
                dir,
                { taskId: 'task-a', phase: 'code_review', iteration: 0, activeCwd: dir },
                { codexBinary: fakeCodex },
            );
            assert.equal(result.success, false);

            const rows = readMetricRows(metricsFile);
            assert.equal(rows.length, 1);
            assert.equal(rows[0]?.[8], 'failed');
            assert.equal(rows.filter(row => row[8] === 'ok').length, 0);
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runColdCodexReview records one failed metric row for invalid effort without spawning', { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-review-metrics-guard-'));
    try {
        const sentinel = path.join(dir, 'spawned.txt');
        const fakeCodex = writeFakeCodexScript(dir, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(sentinel)}, 'spawned');`);

        await withMetricsFileAsync(dir, async metricsFile => {
            const message = await captureDie(() => runColdCodexReview(
                'main',
                'gpt-mini',
                'ultra',
                dir,
                { taskId: 'task-a', phase: 'code_review', iteration: 0, activeCwd: dir },
                { codexBinary: fakeCodex },
            ));
            assertInvalidEffortMessage(message);
            assert.equal(fs.existsSync(sentinel), false);

            const rows = readMetricRows(metricsFile);
            assert.equal(rows.length, 1);
            assert.equal(rows[0]?.[8], 'failed');
            assert.equal(rows.filter(row => row[8] === 'ok').length, 0);
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runColdCodexReview records a dash token cell when completion usage is absent', { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-review-metrics-no-usage-'));
    try {
        const fakeCodex = writeFakeCodexScript(dir, [
            `console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'clean review' } }));`,
            `console.log(JSON.stringify({ type: 'turn.completed' }));`,
        ].join('\n'));

        await withMetricsFileAsync(dir, async metricsFile => {
            const result = await runColdCodexReview(
                'main',
                'gpt-mini',
                'high',
                dir,
                { taskId: 'task-a', phase: 'code_review', iteration: 0, activeCwd: dir },
                { codexBinary: fakeCodex },
            );
            assert.equal(result.success, true);

            const rows = readMetricRows(metricsFile);
            assert.equal(rows.length, 1);
            assert.equal(rows[0]?.[7], '-');
            assert.equal(rows[0]?.[8], 'ok');
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runColdCodexReview records a dash token cell when completion usage is all-zero', { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-review-metrics-zero-usage-'));
    try {
        const fakeCodex = writeFakeCodexScript(dir, [
            `console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'clean review' } }));`,
            `console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } }));`,
        ].join('\n'));

        await withMetricsFileAsync(dir, async metricsFile => {
            const result = await runColdCodexReview(
                'main',
                'gpt-mini',
                'high',
                dir,
                { taskId: 'task-a', phase: 'code_review', iteration: 0, activeCwd: dir },
                { codexBinary: fakeCodex },
            );
            assert.equal(result.success, true);

            const rows = readMetricRows(metricsFile);
            assert.equal(rows.length, 1);
            assert.equal(rows[0]?.[7], '-');
            assert.equal(rows[0]?.[8], 'ok');
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runCodeReviewPhase runs cold-Codex before the foreman and writes artifacts for a bundle', { concurrency: false }, async () => {
    await withTempTasksAsync(async (tasksRoot, activeCwd) => {
        for (const taskId of ['task-a', 'task-b']) writeTask(tasksRoot, taskId);
        const events: string[] = [];
        const deps = makeDeps({
            activeCwd,
            events,
            findings: '[P2] src/foo.ts:10 - null deref',
            onClaude: (prompt) => {
                assert.deepEqual(events, ['verifyBranch', `cold:mini-from-policy:high:${activeCwd}:task-a+task-b:0`, 'foreman']);
                assert.match(prompt, /\[P2\] src\/foo\.ts:10 - null deref/);
                assert.match(prompt, /third lens input/);
                for (const taskId of ['task-a', 'task-b']) {
                    const artifact = fs.readFileSync(path.join(tasksRoot, taskId, 'review-cold-codex.md'), 'utf8');
                    assert.equal(artifact, '[P2] src/foo.ts:10 - null deref');
                    fs.writeFileSync(path.join(tasksRoot, taskId, 'review.md'), [
                        `# Code Review: ${taskId}`,
                        '',
                        '## Stage 1',
                        '',
                        'filled review',
                        '',
                    ].join('\n'));
                }
            },
        });

        const result = await runCodeReviewPhase(makeState(['task-a', 'task-b']), false, null, deps);

        assert.deepEqual(result, { agent: 'claude', sessionId: 'claude-session', exitCode: 0 });
        assert.deepEqual(events, ['verifyBranch', `cold:mini-from-policy:high:${activeCwd}:task-a+task-b:0`, 'foreman']);
        for (const taskId of ['task-a', 'task-b']) {
            const status = readStatus(taskId);
            assert.equal(status.phases.code_review?.status, 'in_progress');
            assert.equal(status.phases.qa?.status, 'pending');
        }
    });
});

void test('runCodeReviewPhase stops the whole bundle before foreman when cold-Codex is unavailable', { concurrency: false }, async () => {
    await withTempTasksAsync(async (tasksRoot, activeCwd) => {
        for (const taskId of ['task-a', 'task-b']) writeTask(tasksRoot, taskId);
        const events: string[] = [];
        const deps = makeDeps({
            activeCwd,
            events,
            coldSuccess: false,
            findings: '',
            onClaude: () => {
                throw new Error('foreman must not run when cold-Codex review is unavailable');
            },
        });
        const originalExit: typeof process.exit = process.exit.bind(process);
        process.exit = (code?: string | number | null): never => {
            throw Object.assign(new Error('process.exit'), { code });
        };
        try {
            await assert.rejects(
                () => runCodeReviewPhase(makeState(['task-a', 'task-b']), false, null, deps),
                (error: unknown) => isProcessExitError(error, 1),
            );
        } finally {
            process.exit = originalExit;
        }

        assert.deepEqual(events, ['verifyBranch', `cold:mini-from-policy:high:${activeCwd}:task-a+task-b:0`]);
        for (const taskId of ['task-a', 'task-b']) {
            assert.equal(fs.existsSync(path.join(tasksRoot, taskId, 'review-cold-codex.md')), false);
            const status = readStatus(taskId);
            assert.equal(status.phases.code_review?.status, 'in_progress');
            assert.equal(status.phases.qa?.status, 'pending');
        }
    });
});
