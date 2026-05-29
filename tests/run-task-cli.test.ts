import assert from 'node:assert/strict';
import test from 'node:test';

import { parseArgs } from '../scripts/run-task/cli.ts';

function runParseArgs(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const originalExit = process.exit.bind(process);
    const originalLog = console.log;
    const originalError = console.error;
    let status: number | null = 0;

    console.log = (...values: unknown[]) => {
        stdout.push(values.map(value => String(value)).join(' '));
    };
    console.error = (...values: unknown[]) => {
        stderr.push(values.map(value => String(value)).join(' '));
    };
    const exitStub: typeof process.exit = (code?: number) => {
        status = typeof code === 'number' ? code : 0;
        throw new Error('__parse_args_exit__');
    };
    process.exit = exitStub;

    try {
        const result = parseArgs(args);
        stdout.push(JSON.stringify(result));
    } catch (error) {
        if (!(error instanceof Error) || error.message !== '__parse_args_exit__') {
            throw error;
        }
    } finally {
        process.exit = originalExit;
        console.log = originalLog;
        console.error = originalError;
    }

    return {
        status,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
    };
}

void test('parseArgs recognizes --full-send', () => {
    const result = runParseArgs(['--full-send', 'task-id']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout) as Record<string, unknown>, {
        taskIds: ['task-id'],
        interactive: false,
        step: false,
        expectPhase: null,
        push: false,
        pr: false,
        reroute: false,
        ship: false,
        dryRun: false,
        fullSend: true,
        force: false,
        allowDivergentBase: false,
    });
});

void test('parseArgs recognizes --force alongside --full-send', () => {
    const result = runParseArgs(['--full-send', '--force', 'task-id']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout) as Record<string, unknown>, {
        taskIds: ['task-id'],
        interactive: false,
        step: false,
        expectPhase: null,
        push: false,
        pr: false,
        reroute: false,
        ship: false,
        dryRun: false,
        fullSend: true,
        force: true,
        allowDivergentBase: false,
    });
});

void test('parseArgs recognizes --force without --full-send', () => {
    const result = runParseArgs(['--force', 'task-id']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout) as Record<string, unknown>, {
        taskIds: ['task-id'],
        interactive: false,
        step: false,
        expectPhase: null,
        push: false,
        pr: false,
        reroute: false,
        ship: false,
        dryRun: false,
        fullSend: false,
        force: true,
        allowDivergentBase: false,
    });
});

void test('parseArgs recognizes --allow-divergent-base', () => {
    const result = runParseArgs(['--allow-divergent-base', 'task-id']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout) as Record<string, unknown>, {
        taskIds: ['task-id'],
        interactive: false,
        step: false,
        expectPhase: null,
        push: false,
        pr: false,
        reroute: false,
        ship: false,
        dryRun: false,
        fullSend: false,
        force: false,
        allowDivergentBase: true,
    });
});

void test('parseArgs rejects --reroute with --full-send', () => {
    const result = runParseArgs(['--reroute', '--full-send', 'task-id']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--reroute and --full-send are mutually exclusive in a single invocation/);
});
