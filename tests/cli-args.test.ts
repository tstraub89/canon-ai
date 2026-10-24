import assert from 'node:assert/strict';
import test from 'node:test';
import { preScanArgs } from '../src/lib/cli-args.ts';
import { INIT_ARGS } from '../src/cli/commands/init.ts';
import { DOCTOR_ARGS } from '../src/cli/commands/doctor.ts';
import { STOP_ARGS } from '../src/cli/commands/stop.ts';
import { WATCH_ARGS, parseWatchArgs } from '../src/cli/commands/watch.ts';
import { UPDATE_ARGS, parseUpdateArgs } from '../src/cli/commands/update.ts';
import { UPGRADE_ARGS, parseUpgradeArgs } from '../src/cli/commands/upgrade.ts';
import { RUN_ARGS, parseArgs } from '../src/orchestrator/cli.ts';
import { TASK_ARGS, TASK_SUBCOMMAND_ARGS, parseTaskAcceptArgs, parseTaskNewArgs } from '../src/task/index.ts';

function parseRun(args: string[]): { status: number; stdout: string; stderr: string } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const oldExit = process.exit.bind(process);
    const oldLog = console.log;
    const oldError = console.error;
    let status = 0;
    process.exit = ((code?: number) => { status = code ?? 0; throw new Error('exit'); });
    console.log = (...xs: unknown[]) => stdout.push(xs.map(String).join(' '));
    console.error = (...xs: unknown[]) => stderr.push(xs.map(String).join(' '));
    try { parseArgs(args); } catch (error) { if (!(error instanceof Error) || error.message !== 'exit') throw error; }
    finally { process.exit = oldExit; console.log = oldLog; console.error = oldError; }
    return { status, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

void test('preScanArgs honors help precedence and positional value rules', () => {
    const decl = { command: 'test', usage: 'Usage: canon test', booleanFlags: [], valueFlags: ['--value'], freeTextSlots: [0], rejectPositionals: true } as const;
    assert.equal(preScanArgs(decl, ['--help']).kind, 'help');
    assert.equal(preScanArgs(decl, ['x', '--help']).kind, 'help');
    assert.equal(preScanArgs(decl, ['x', 'y', '-h']).kind, 'help');
    assert.equal(preScanArgs(decl, ['-h']).kind, 'help');
    assert.equal(preScanArgs(decl, ['--bogus', '--help']).kind, 'help');
    assert.equal(preScanArgs(decl, ['--value', '--help']).kind, 'proceed');
    assert.equal(preScanArgs(decl, ['-draft']).kind, 'proceed');
    assert.equal(preScanArgs(decl, ['x', '-draft']).kind, 'unknown');
    assert.equal(preScanArgs({ ...decl, freeTextSlots: [] }, ['--value']).kind, 'proceed');
    assert.equal(preScanArgs({ ...decl, rejectPositionals: false }, ['--value=ok']).kind, 'proceed');
    assert.equal(preScanArgs({ ...decl, equalsValueFlags: ['--value'] }, ['--value=ok']).kind, 'proceed');
    assert.equal(preScanArgs({ ...decl, equalsValueFlags: ['--value'] }, ['--value=ok', '--help']).kind, 'help');
    assert.equal(preScanArgs({ ...decl, equalsValueFlags: ['--base'] }, ['--base=main', '--help']).kind, 'help');
    assert.equal(preScanArgs({ ...decl, valueFlags: ['--reason'] }, ['--reason', '--reason', '--help']).kind, 'help');
    assert.equal(preScanArgs(RUN_ARGS, ['--expect=plan']).kind, 'unknown');
    assert.equal(preScanArgs(RUN_ARGS, ['-']).kind, 'unknown');
    assert.equal(preScanArgs({ ...decl, valueFlags: ['--value'] }, ['--value']).kind, 'proceed');
    assert.equal(preScanArgs({ ...decl, rejectPositionals: true, freeTextSlots: [] }, ['word']).kind, 'unexpected');
    assert.deepEqual(preScanArgs(RUN_ARGS, ['-x', '-y']), { kind: 'unknown', argument: '-x' });
});

void test('all command declarations list parser-supported flags in their usage', () => {
    const declarations = [INIT_ARGS, DOCTOR_ARGS, RUN_ARGS, WATCH_ARGS, STOP_ARGS, UPDATE_ARGS, UPGRADE_ARGS, TASK_ARGS, ...Object.values(TASK_SUBCOMMAND_ARGS)];
    assert.equal(Object.keys(TASK_SUBCOMMAND_ARGS).length, 9);
    assert.deepEqual(Object.keys(TASK_SUBCOMMAND_ARGS).sort(), ['new', 'list', 'status', 'phase', 'accept', 'set', 'reset-spec-review', 'reset-code-review', 'post-merge-sync'].sort());
    for (const decl of declarations) {
        assert.ok(decl.usage.startsWith(`Usage: canon ${decl.command}`), decl.command);
        for (const flag of [...decl.booleanFlags, ...decl.valueFlags, ...(decl.equalsValueFlags ?? [])]) assert.ok(decl.usage.includes(flag), `${decl.command}: ${flag}`);
    }
    const samples: Record<string, string> = { '--expect': 'plan', '--until': 'plan', '--timeout': '5s', '--channel': 'main', '--ref': 'feature', '--base': 'main', '--reason': 'x' };
    for (const decl of declarations) {
        let adapters: string[][] = [];
        if (decl === RUN_ARGS) adapters = [...decl.booleanFlags.map(f => ['foo', f]), ...decl.valueFlags.map(f => ['foo', f, samples[f]])];
        else if (decl === WATCH_ARGS) adapters = [...decl.booleanFlags.map(f => ['foo', f]), ...decl.valueFlags.map(f => ['foo', f, samples[f]]), ...(decl.equalsValueFlags ?? []).map(f => ['foo', `${f}=${samples[f]}`])];
        else if (decl === UPDATE_ARGS) adapters = [...decl.valueFlags.map(f => [f, samples[f]])];
        else if (decl === UPGRADE_ARGS) adapters = decl.booleanFlags.map(f => [f]);
        else if (decl.command === 'task new') adapters = [...decl.valueFlags.map(f => ['foo', 'Title', f, samples[f]]), ...[...(decl.equalsValueFlags ?? [])].map(f => ['foo', 'Title', `${f}=${samples[f]}`])];
        else if (decl.command === 'task accept') adapters = [...decl.booleanFlags.map(f => ['foo', 'code_review', f]), ...decl.valueFlags.map(f => ['foo', 'code_review', f, samples[f]])];
        for (const args of adapters) {
            if (decl === RUN_ARGS) assert.equal(parseRun(args).status, 0, args.join(' '));
            else if (decl === WATCH_ARGS) assert.equal(parseWatchArgs(args).usageError, null, args.join(' '));
            else if (decl === UPDATE_ARGS) assert.doesNotThrow(() => parseUpdateArgs(args));
            else if (decl === UPGRADE_ARGS) assert.doesNotThrow(() => parseUpgradeArgs(args));
            else if (decl.command === 'task new') assert.doesNotThrow(() => parseTaskNewArgs(args));
            else if (decl.command === 'task accept') assert.doesNotThrow(() => parseTaskAcceptArgs(args));
        }
    }
    for (const flag of ['--allow-divergent-base', '-1', '--step', '--timeout', '--check', '--dry-run', '--force', '--no-stage', '--base', '--reason']) {
        assert.ok(declarations.some(decl => [...decl.booleanFlags, ...decl.valueFlags].includes(flag)), flag);
    }
});

void test('task accept keeps --help as the literal --reason value', () => {
    const args = ['foo', 'code_review', '--reason', '--help'];
    assert.equal(parseTaskAcceptArgs(args).reason, '--help');
    assert.equal(preScanArgs(TASK_SUBCOMMAND_ARGS.accept, args).kind, 'proceed');
});

void test('task declarations keep free-text values and equals-form flags out of unknown-option handling', () => {
    assert.equal(preScanArgs(TASK_SUBCOMMAND_ARGS.set, ['foo', 'title', '-draft']).kind, 'proceed');
    assert.equal(preScanArgs(TASK_SUBCOMMAND_ARGS.new, ['foo', '-draft title']).kind, 'proceed');
    assert.equal(preScanArgs(TASK_SUBCOMMAND_ARGS.new, ['bar', 'Title', '--base=main']).kind, 'proceed');
});

void test('watch parser accepts --timeout=5s', () => {
    assert.equal(parseWatchArgs(['foo', '--timeout=5s']).timeoutMs, 5000);
});
