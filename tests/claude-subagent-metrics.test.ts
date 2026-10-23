import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runClaude } from '../src/orchestrator/agents/claude.js';
import { AgentSessionError } from '../src/orchestrator/agents/errors.js';

type Result = { agentType?: unknown; status?: unknown; resolvedModel?: unknown; totalDurationMs?: unknown; totalTokens?: number };

function resultEvent(result: Result, toolUseId = 'tool-1', parent: unknown = null): object {
    return { type: 'user', parent_tool_use_id: parent, message: { content: [{ type: 'tool_result', tool_use_id: toolUseId }] }, tool_use_result: result };
}

function notification(toolUseId: string, outputFile: string): object {
    return { type: 'system', subtype: 'task_notification', tool_use_id: toolUseId, status: 'completed', output_file: outputFile };
}

function assistant(id: string, tokens: number): object {
    return { type: 'assistant', message: { id, usage: { input_tokens: tokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 } } };
}

async function runFixture(events: Array<object | string>, options: { exit?: number; resumeId?: string; transcript?: Record<string, object[]> } = {}): Promise<string> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-lens-metrics-'));
    const oldPath = process.env.PATH;
    const oldMetrics = process.env.CANON_METRICS_FILE_OVERRIDE;
    try {
        const bin = path.join(root, 'bin');
        fs.mkdirSync(bin);
        const stream = events.map(event => typeof event === 'string' ? event : JSON.stringify(event));
        const transcriptFiles: Record<string, string> = {};
        for (const [name, entries] of Object.entries(options.transcript ?? {})) {
            const file = path.join(root, name);
            fs.writeFileSync(file, entries.map(entry => JSON.stringify(entry)).join('\n'));
            transcriptFiles[name] = file;
        }
        const resolvedStream = stream.map(line => line.replaceAll('__TRANSCRIPT__', transcriptFiles.transcript ?? ''));
        const code = options.resumeId
            ? `#!/usr/bin/env node\nif (process.argv.includes('--resume')) { console.error('No conversation found with session ID'); process.exit(1); }\n${resolvedStream.map(line => `console.log(${JSON.stringify(line)});`).join('\n')}\n`
            : `#!/usr/bin/env node\n${resolvedStream.map(line => `console.log(${JSON.stringify(line)});`).join('\n')}\nprocess.exit(${options.exit ?? 0});\n`;
        const executable = path.join(bin, 'claude');
        fs.writeFileSync(executable, code, { mode: 0o755 });
        process.env.PATH = `${bin}${path.delimiter}${oldPath ?? ''}`;
        const metrics = path.join(root, 'metrics.md');
        process.env.CANON_METRICS_FILE_OVERRIDE = metrics;
        try {
            await runClaude('test prompt', false, options.resumeId ?? null, 'session-model', 'medium', '1',
                { taskId: 'example-task', phase: 'code_review', iteration: 2 }, root);
        } catch (error) {
            if (options.exit !== undefined && options.exit !== 0) assert.ok(error instanceof AgentSessionError);
            else throw error;
        }
        return fs.readFileSync(metrics, 'utf8');
    } finally {
        if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
        if (oldMetrics === undefined) delete process.env.CANON_METRICS_FILE_OVERRIDE; else process.env.CANON_METRICS_FILE_OVERRIDE = oldMetrics;
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function rows(fragment: string): string[] { return fragment.split('\n').filter(line => line.startsWith('| 20')); }
function cells(row: string): string[] { return row.split(/(?<!\\)\|/).slice(1, -1).map(cell => cell.trim()); }

void test('runClaude records top-level sub-agent rows with deduplicated cumulative transcript usage', async () => {
    const fragment = await runFixture([
        notification('tool-1', '__TRANSCRIPT__'),
        resultEvent({ agentType: 'code-review-anchored', status: 'completed', resolvedModel: 'lens-model', totalDurationMs: 476392, totalTokens: 999 }),
        { type: 'result', session_id: 'session-1', usage: { input_tokens: 10, output_tokens: 2 }, result: 'done' },
    ], { transcript: { transcript: [assistant('turn-1', 13), assistant('turn-1', 13), assistant('turn-2', 7)] } });
    const output = rows(fragment).map(cells);
    assert.equal(output.length, 2);
    assert.deepEqual(output.map(row => row[3]), ['claude', 'claude:code-review-anchored']);
    assert.deepEqual(output[1].slice(1, 6), ['example-task', 'code_review', 'claude:code-review-anchored', 'lens-model', '2']);
    assert.equal(output[1][6], '476.4s');
    assert.equal(output[1][7], '20');
    assert.equal(output[1][8], 'ok');
});

void test('runClaude records multiple lenses in stream order and applies status/model/token fallbacks', async () => {
    const fragment = await runFixture([
        notification('tool-1', '__TRANSCRIPT__'),
        resultEvent({ agentType: 'code-review-anchored', status: 'completed', resolvedModel: 'a', totalDurationMs: 1000 }, 'tool-1'),
        notification('tool-2', '__TRANSCRIPT__'),
        resultEvent({ agentType: 'code-review-cold', status: 'failed', totalDurationMs: 2100 }, 'tool-2'),
        resultEvent({ agentType: 'no-notification', status: 'completed', totalDurationMs: 0 }, 'tool-3'),
        notification('tool-4', path.join(os.tmpdir(), 'missing-lens-transcript.jsonl')),
        resultEvent({ agentType: 'empty-transcript', status: 'completed', totalDurationMs: 5 }, 'tool-4'),
        { type: 'result', session_id: 'session-1', usage: { input_tokens: 1 }, result: 'done' },
    ], { transcript: { transcript: [assistant('turn', 9)] } });
    const output = rows(fragment).map(cells);
    assert.equal(output.length, 5);
    assert.deepEqual(output.slice(1).map(row => row[3]), ['claude:code-review-anchored', 'claude:code-review-cold', 'claude:no-notification', 'claude:empty-transcript']);
    assert.equal(output[2][4], 'session-model');
    assert.equal(output[1][7], '9');
    assert.equal(output[2][8], 'failed');
    assert.deepEqual(output.slice(3).map(row => row[7]), ['-', '-']);
    const zero = await runFixture([
        notification('tool-1', '__TRANSCRIPT__'),
        resultEvent({ agentType: 'zero-usage', status: 'completed', totalDurationMs: 1 }, 'tool-1'),
        { type: 'result', session_id: 'session-1', usage: {}, result: 'done' },
    ], { transcript: { transcript: [assistant('zero', 0)] } });
    assert.equal(cells(rows(zero)[1])[7], '-');
});

void test('runClaude ignores non-lens and nested events, but retains lens rows after session failure', async () => {
    const negative = await runFixture([
        { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'a' }] } },
        resultEvent({ status: 'completed', totalDurationMs: 2 }),
        resultEvent({ agentType: 'no-duration' }),
        resultEvent({ agentType: 'nested', totalDurationMs: 5 }, 'nested', 'parent'),
        'not-json',
        { type: 'result', session_id: 'session-1', usage: {}, result: 'done' },
    ]);
    assert.equal(rows(negative).length, 1);
    const failed = await runFixture([
        notification('tool-1', '__TRANSCRIPT__'),
        resultEvent({ agentType: 'completed-before-failure', status: 'completed', totalDurationMs: 8 }, 'tool-1'),
    ], { exit: 1, transcript: { transcript: [assistant('turn', 1)] } });
    const output = rows(failed).map(cells);
    assert.equal(output.length, 2);
    assert.equal(output[0][8], 'failed');
    assert.equal(output[1][3], 'claude:completed-before-failure');
});

void test('runClaude escapes hostile agent types and deduplicates results across resume fallback', async () => {
    const hostile = await runFixture([
        resultEvent({ agentType: 'x|y\nz', status: 'completed', totalDurationMs: 1 }),
        { type: 'result', session_id: 'session-1', usage: {}, result: 'done' },
    ]);
    assert.equal(cells(rows(hostile)[1]).length, 9);
    const resumed = await runFixture([
        notification('tool-1', '__TRANSCRIPT__'),
        resultEvent({ agentType: 'lens', status: 'completed', totalDurationMs: 3 }, 'tool-1'),
        { type: 'result', session_id: 'session-1', usage: {}, result: 'done' },
    ], { resumeId: 'resume-session', transcript: { transcript: [assistant('turn', 2)] } });
    assert.equal(rows(resumed).length, 2);
});
