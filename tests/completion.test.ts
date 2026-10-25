import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { COMPLETION_ARGS, COMPLETION_SHELLS, COMPLETION_USAGE, buildCompletionModel, renderCompletion, tcshFlagProgram } from '../src/cli/commands/completion.ts';
import { COMMAND_REGISTRY, GLOBAL_FLAGS } from '../src/cli/registry.ts';
import { RUN_ARGS } from '../src/orchestrator/cli.ts';
import { WATCH_ARGS } from '../src/cli/commands/watch.ts';
import { STOP_ARGS } from '../src/cli/commands/stop.ts';
import { UPDATE_ARGS } from '../src/cli/commands/update.ts';
import { TASK_SUBCOMMAND_ARGS, ACCEPT_PHASES, SETTABLE_FIELDS, TASK_SET_FIELD_VALUES, assertValidPhase, assertValidStatus, assertValidVerdict, taskAccept, taskSet } from '../src/task/index.ts';
import { SIZE_ORDER } from '../src/lib/pipeline-policy.ts';
import { parseWatchArgs } from '../src/cli/commands/watch.ts';
import { parseUpdateArgs } from '../src/cli/commands/update.ts';

const model = buildCompletionModel(COMMAND_REGISTRY, GLOBAL_FLAGS);
const goldenPath = path.join(process.cwd(), 'tests/completion.golden.json');
const rendered = Object.fromEntries(COMPLETION_SHELLS.map(shell => [shell, renderCompletion(shell, model)]));

void test('completion metadata and shared value sets are attached to declarations', () => {
    assert.deepEqual(RUN_ARGS.completion?.positionals, [{ kind: 'taskId', variadic: true }]);
    assert.deepEqual(RUN_ARGS.completion?.valueFlags, { '--expect': 'phase' });
    assert.deepEqual(WATCH_ARGS.completion?.positionals, [{ kind: 'taskId' }]);
    assert.deepEqual(WATCH_ARGS.completion?.valueFlags, { '--until': 'phase' });
    assert.deepEqual(STOP_ARGS.completion?.positionals, [{ kind: 'taskId' }]);
    assert.deepEqual(UPDATE_ARGS.completion?.valueFlags, { '--channel': 'updateChannel' });
    assert.deepEqual(COMPLETION_ARGS.completion?.positionals, [{ kind: 'shell' }]);
    assert.deepEqual(TASK_SUBCOMMAND_ARGS.phase.completion?.positionals?.map(s => s.kind), ['taskId', 'phase', 'phaseStatus', 'reviewVerdict']);
    assert.deepEqual(TASK_SUBCOMMAND_ARGS.accept.completion?.positionals?.map(s => s.kind), ['taskId', 'acceptPhase']);
    assert.deepEqual(TASK_SUBCOMMAND_ARGS.set.completion?.positionals?.map(s => s.kind), ['taskId', 'settableField', 'fieldValue']);
    assert.deepEqual(SIZE_ORDER, ['XS', 'S', 'M', 'L', 'XL']);
    assert.deepEqual(ACCEPT_PHASES, ['implement', 'spec_review', 'code_review']);
    assert.deepEqual(Object.keys(TASK_SET_FIELD_VALUES).sort(), ['delicate', 'human_spec_gate', 'task_size', 'worktree']);
    for (const phase of model.values.phase) assert.doesNotThrow(() => assertValidPhase(phase));
    for (const status of model.values.phaseStatus) assert.doesNotThrow(() => assertValidStatus(status));
    for (const [phase, verdicts] of Object.entries(model.verdictsByPhase)) for (const verdict of verdicts) assert.doesNotThrow(() => assertValidVerdict(phase as 'spec_review' | 'code_review', verdict));
    assert.deepEqual([...SETTABLE_FIELDS].sort(), [...Object.keys(TASK_SET_FIELD_VALUES), 'title', 'base_branch'].sort());
});

void test('completion scripts are deterministic, adopter-safe, and derived from declarations', () => {
    assert.doesNotMatch(COMPLETION_USAGE, /\bsrc\/|\btests\/|BACKLOG/);
    for (const [shell, script] of Object.entries(rendered)) {
        assert.ok(script.endsWith('\n'));
        assert.equal(script.match(/\n/g)?.length ?? 0, (script.trimEnd().match(/\n/g)?.length ?? 0) + 1);
        assert.doesNotMatch(script, /\b(node|npx)\b|\$\(\s*canon\b|`\s*canon\b/);
        assert.doesNotMatch(script, /\bsrc\/|\btests\/|BACKLOG/);
        for (const command of model.commands) assert.ok(script.includes(command.path[0]), `${shell}: ${command.path[0]}`);
        for (const command of model.commands.flatMap(c => [c, ...(c.subcommands ?? [])])) {
            for (const flag of command.flags) assert.ok(script.includes(flag), `${shell}: ${command.path.join(' ')} ${flag}`);
        }
        for (const flag of model.globalFlags) assert.ok(script.includes(flag), `${shell}: ${flag}`);
    }
    if (process.env.UPDATE_GOLDENS === '1') fs.writeFileSync(goldenPath, `${JSON.stringify(rendered, null, 2)}\n`);
    else assert.deepEqual(rendered, JSON.parse(fs.readFileSync(goldenPath, 'utf8')));
});

void test('each renderer follows declaration growth and emits no undeclared long flags', () => {
    const synthetic = COMMAND_REGISTRY.map(command => command.name === 'task'
        ? { ...command, subcommands: { ...command.subcommands, 'zz-sub': { command: 'task zz-sub', usage: 'Usage: canon task zz-sub', booleanFlags: [], valueFlags: [] } } }
        : command);
    synthetic.push({ name: 'zz-cmd', decl: {
        command: 'zz-cmd', usage: 'Usage: canon zz-cmd', booleanFlags: ['--zz-bool'], valueFlags: ['--zz-value', '--zz-id'], equalsValueFlags: ['--zz-eq'],
        completion: { positionals: [{ kind: 'taskId' }, { kind: 'phase' }], valueFlags: { '--zz-value': 'none', '--zz-id': 'taskId' } },
    } });
    const syntheticModel = buildCompletionModel(synthetic, GLOBAL_FLAGS);
    for (const shell of COMPLETION_SHELLS) {
        const script = renderCompletion(shell, syntheticModel);
        for (const token of ['zz-cmd', 'zz-sub', '--zz-bool', '--zz-value', '--zz-id', '--zz-eq']) assert.ok(script.includes(token), `${shell}: ${token}`);
        if (shell !== 'tcsh') assert.ok(script.includes('taskId'), `${shell}: taskId value kind`);
    }
    const invalidVariadic = [...COMMAND_REGISTRY, { name: 'zz-many', decl: {
        command: 'zz-many', usage: 'Usage: canon zz-many', booleanFlags: [], valueFlags: [],
        completion: { positionals: [{ kind: 'taskId' as const, variadic: true }, { kind: 'phase' as const }, { kind: 'phaseStatus' as const }] },
    } }];
    assert.throws(() => buildCompletionModel(invalidVariadic, GLOBAL_FLAGS), /more than one fixed positional slot after a variadic slot/);
    const modelFlags = new Set([...model.globalFlags, ...model.commands.flatMap(c => [c, ...(c.subcommands ?? [])].flatMap(command => command.flags))]);
    for (const [shell, script] of Object.entries(rendered)) {
        const allowed = new Set(shell === 'tcsh' ? [] : ['--path-format', '--git-common-dir']);
        for (const token of script.match(/--[A-Za-z][\w-]*/g) ?? []) assert.ok(modelFlags.has(token) || allowed.has(token), `${shell}: undeclared ${token}`);
    }
});

void test('synthetic value flags do not shift later positional slots', t => {
    const synthetic = [...COMMAND_REGISTRY, { name: 'zz-cmd', decl: {
        command: 'zz-cmd', usage: 'Usage: canon zz-cmd', booleanFlags: [], valueFlags: ['--zz-value', '--zz-eq'], equalsValueFlags: ['--zz-eq'],
        completion: { positionals: [{ kind: 'taskId' as const }, { kind: 'phase' as const }], valueFlags: { '--zz-value': 'none' as const, '--zz-eq': 'phase' as const } },
    } }];
    const syntheticModel = buildCompletionModel(synthetic, GLOBAL_FLAGS);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-completion-model-'));
    try {
        const bashFile = path.join(dir, 'completion.bash');
        fs.writeFileSync(bashFile, renderCompletion('bash', syntheticModel));
        for (const flagArgs of [['--zz-value', 'x'], ['--zz-eq=x'], ['--zz-eq', '=', 'x']]) {
            const bash = spawnSync('bash', ['--norc', '--noprofile', '-c', '. "$1"; shift; COMP_WORDS=("$@"); COMP_CWORD=$(($# - 1)); _canon; printf "%s\\n" "${COMPREPLY[@]}"', '_', bashFile, 'canon', 'zz-cmd', 'alpha', ...flagArgs, ''], { encoding: 'utf8' });
            assert.equal(bash.status, 0, bash.stderr);
            assert.deepEqual(bash.stdout.trim().split(/\r?\n/).filter(Boolean).sort(), [...model.values.phase].sort());
        }
        for (const [flag, expected] of [['--zz-value', []], ['--zz-eq', model.values.phase]] as const) {
            const bash = spawnSync('bash', ['--norc', '--noprofile', '-c', '. "$1"; shift; _canon_candidates "=" "$@"', '_', bashFile, 'zz-cmd', 'alpha', flag], { encoding: 'utf8' });
            assert.equal(bash.status, 0, bash.stderr);
            assert.deepEqual(bash.stdout.trim().split(/\r?\n/).filter(Boolean).sort(), [...expected].sort());
        }
        if (spawnSync('which', ['zsh'], { encoding: 'utf8' }).status === 0) {
            const zshFile = path.join(dir, 'completion.zsh');
            fs.writeFileSync(zshFile, renderCompletion('zsh', syntheticModel));
            for (const flagArgs of [['--zz-value', 'x'], ['--zz-eq=x'], ['--zz-eq', '=', 'x']]) {
                const zsh = spawnSync('zsh', ['-f', '-c', '. "$1"; shift; _canon_candidates "" "$@"', '_', zshFile, 'zz-cmd', 'alpha', ...flagArgs], { encoding: 'utf8' });
                assert.equal(zsh.status, 0, zsh.stderr);
                assert.deepEqual(zsh.stdout.trim().split(/\r?\n/).filter(Boolean).sort(), [...model.values.phase].sort());
            }
            for (const [flag, expected] of [['--zz-value', []], ['--zz-eq', model.values.phase]] as const) {
                const zsh = spawnSync('zsh', ['-f', '-c', '. "$1"; shift; _canon_candidates "=" "$@"', '_', zshFile, 'zz-cmd', 'alpha', flag], { encoding: 'utf8' });
                assert.equal(zsh.status, 0, zsh.stderr);
                assert.deepEqual(zsh.stdout.trim().split(/\r?\n/).filter(Boolean).sort(), [...expected].sort());
            }
        } else if (process.env.CI) assert.fail('zsh is required in CI');
        else t.diagnostic('zsh not installed; synthetic positional-shift smoke skipped');
        if (spawnSync('which', ['fish'], { encoding: 'utf8' }).status === 0) {
            const fishFile = path.join(dir, 'completion.fish');
            fs.writeFileSync(fishFile, renderCompletion('fish', syntheticModel));
            for (const [flag, expected] of [['--zz-value', []], ['--zz-eq', model.values.phase]] as const) {
                const fish = spawnSync('fish', ['-c', 'source $argv[1]; __canon_candidates "=" $argv[2..-1]', fishFile, 'zz-cmd', 'alpha', flag], { encoding: 'utf8' });
                assert.equal(fish.status, 0, fish.stderr);
                assert.deepEqual(fish.stdout.trim().split(/\r?\n/).filter(Boolean).sort(), [...expected].sort());
            }
        } else if (process.env.CI) assert.fail('fish is required in CI');
        else t.diagnostic('fish not installed; synthetic equals-separator smoke skipped');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

void test('completion shell scripts pass available syntax checks', t => {
    const commands: Record<string, string[]> = { bash: ['-n'], zsh: ['-n'], fish: ['--no-execute'], tcsh: ['-f', '-n'] };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-completion-'));
    try {
        for (const [shell, args] of Object.entries(commands)) {
            const found = spawnSync('which', [shell], { encoding: 'utf8' });
            if (found.status !== 0) {
                if (process.env.CI) assert.fail(`${shell} is required in CI`);
                t.diagnostic(`${shell} not installed; syntax check skipped`);
                continue;
            }
            const file = path.join(dir, `completion.${shell}`);
            fs.writeFileSync(file, rendered[shell as keyof typeof rendered]);
            const result = spawnSync(shell, [...args, file], { encoding: 'utf8' });
            assert.equal(result.status, 0, `${shell}: ${result.stderr}`);
            if (shell === 'tcsh') {
                const loaded = spawnSync('tcsh', ['-f', '-c', `source "${file}"; complete`], { encoding: 'utf8' });
                assert.equal(loaded.status, 0, loaded.stderr);
                assert.match(loaded.stdout, /canon/);
            }
        }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

void test('bash completion smoke cases handle positional and value-flag contexts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-completion-smoke-'));
    const file = path.join(dir, 'completion.bash');
    try {
        const git = (args: string[]) => {
            const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr);
        };
        git(['init', '-q']); git(['config', 'user.email', 'test@example.com']); git(['config', 'user.name', 'Test']);
        fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed'); git(['add', 'seed.txt']); git(['commit', '-qm', 'seed']);
        for (const name of ['alpha', 'beta', '_archive', '.hidden']) fs.mkdirSync(path.join(dir, 'tasks', name), { recursive: true });
        fs.writeFileSync(path.join(dir, 'tasks', 'plain-file'), 'file');
        fs.mkdirSync(path.join(dir, 'sub', 'dir'), { recursive: true });
        fs.writeFileSync(file, rendered.bash);
        const code = '. "$1"; shift; COMP_WORDS=("$@"); COMP_CWORD=$(($# - 1)); _canon; if [ ${#COMPREPLY[@]} -gt 0 ]; then printf "%s\\n" "${COMPREPLY[@]}"; fi';
        const rows: Array<[string[], string[]]> = [
            [['canon', 'ta'], ['task']],
            [['canon', 'run', '--'], ['--pr', '--allow-divergent-base']],
            [['canon', 'run', '--expect', ''], [...model.values.phase]],
            [['canon', 'run', ''], ['alpha', 'beta']],
            [['canon', 'run', 'alpha', ''], ['alpha', 'beta']],
            [['canon', 'watch', '--until', ''], [...model.values.phase]],
            [['canon', 'watch', '--until', 'plan', ''], ['alpha', 'beta']],
            [['canon', 'stop', 'alpha', ''], []],
            [['canon', 'watch', 'alpha', ''], []],
            [['canon', 'task', 'status', 'alpha', ''], []],
            [['canon', 'task', 'reset-spec-review', 'alpha', ''], []],
            [['canon', 'task', 'reset-code-review', 'alpha', ''], []],
            [['canon', 'task', '-'], ['--help', '-h']],
            [['canon', 'unknown', '-'], ['--help', '-h', '--version', '-v']],
            [['canon', 'task', 'phase', 'alpha', ''], ['spec', 'spec_review', 'plan', 'implement', 'code_review', 'qa', 'human_review']],
            [['canon', 'task', 'phase', 'alpha', 'spec', ''], ['pending', 'in_progress', 'done', 'changes_requested', 'blocked']],
            [['canon', 'task', 'phase', 'alpha', 'code_review', 'done', ''], ['spec_gap']],
            [['canon', 'task', 'phase', 'alpha', 'spec_review', 'done', ''], ['approved', 'approved_with_nits', 'changes_requested', 'needs_re_review']],
            [['canon', 'task', 'phase', 'alpha', 'plan', 'done', ''], []],
            [['canon', 'task', 'accept', 'alpha', '--reason', 'x', ''], ['beta', 'implement']],
            [['canon', 'task', 'accept', 'alpha', 'imp'], ['implement']],
            [['canon', 'task', 'set', 'alpha', 'task_size', ''], ['XS', 'S', 'M', 'L', 'XL']],
            [['canon', 'task', 'set', 'alpha', 'delicate', ''], ['true', 'false']],
            [['canon', 'task', 'set', 'alpha', 'title', ''], []],
            [['canon', 'task', 'set', 'alpha', 'unknown', ''], []],
            [['canon', 'completion', ''], ['bash', 'zsh', 'fish', 'tcsh']],
        ];
        const binaries = [...new Set(['bash', '/bin/bash'].filter(binary => spawnSync(binary, ['--version'], { encoding: 'utf8' }).status === 0))];
        for (const binary of binaries) for (const [words, expected] of rows) {
            const result = spawnSync(binary, ['--norc', '--noprofile', '-c', code, '_', file, ...words], {
                cwd: dir, env: { PATH: process.env.PATH, HOME: dir, GIT_CEILING_DIRECTORIES: path.dirname(dir) }, encoding: 'utf8',
            });
            assert.equal(result.status, 0, `${binary} ${words.join(' ')}: ${result.stderr}`);
            const actual = result.stdout.trim().split(/\r?\n/).filter(Boolean).sort();
            if (words[words.length - 1] === '--' || expected.includes('spec_gap') || (words.includes('accept') && words[words.length - 1] === '')) for (const candidate of expected) assert.ok(actual.includes(candidate), `${binary} ${words.join(' ')}: missing ${candidate}`);
            else assert.deepEqual(actual, [...expected].sort(), `${binary} ${words.join(' ')}`);
        }
        const runIds = (binary: string, cwd: string) => {
            const result = spawnSync(binary, ['--norc', '--noprofile', '-c', code, '_', file, 'canon', 'run', ''], {
                cwd, env: { PATH: process.env.PATH, HOME: dir, GIT_CEILING_DIRECTORIES: path.dirname(dir) }, encoding: 'utf8',
            });
            assert.equal(result.status, 0, result.stderr);
            return result.stdout.trim().split(/\r?\n/).filter(Boolean).sort();
        };
        const worktree = path.join(dir, 'wt');
        git(['worktree', 'add', '--detach', worktree, 'HEAD']);
        for (const binary of binaries) {
            assert.deepEqual(runIds(binary, path.join(dir, 'sub', 'dir')), ['alpha', 'beta']);
            assert.deepEqual(runIds(binary, worktree), ['alpha', 'beta']);
        }
        const evilRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-completion-untrusted-task-'));
        try {
            const evilName = '$(touch${IFS}PWNED)';
            const git = (args: string[]) => { const result = spawnSync('git', args, { cwd: evilRepo, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); };
            git(['init', '-q']); git(['config', 'user.email', 'test@example.com']); git(['config', 'user.name', 'Test']);
            fs.writeFileSync(path.join(evilRepo, 'seed.txt'), 'seed'); git(['add', 'seed.txt']); git(['commit', '-qm', 'seed']);
            fs.mkdirSync(path.join(evilRepo, 'tasks', evilName), { recursive: true });
            const result = spawnSync('/bin/bash', ['--norc', '--noprofile', '-c', code, '_', file, 'canon', 'run', ''], {
                cwd: evilRepo, env: { PATH: process.env.PATH, HOME: evilRepo }, encoding: 'utf8',
            });
            assert.equal(result.status, 0, result.stderr);
            assert.deepEqual(result.stdout.trim().split(/\r?\n/).filter(Boolean), [evilName]);
            assert.equal(fs.existsSync(path.join(evilRepo, 'PWNED')), false);
        } finally { fs.rmSync(evilRepo, { recursive: true, force: true }); }
        const noRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-completion-no-repo-'));
        const noTasks = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-completion-no-tasks-'));
        try {
            const empty = spawnSync('bash', ['--norc', '--noprofile', '-c', code, '_', file, 'canon', 'run', ''], { cwd: noRepo, env: { PATH: process.env.PATH, HOME: noRepo }, encoding: 'utf8' });
            assert.equal(empty.status, 0); assert.equal(empty.stdout, ''); assert.equal(empty.stderr, '');
            const init = spawnSync('git', ['init', '-q'], { cwd: noTasks, encoding: 'utf8' }); assert.equal(init.status, 0);
            spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: noTasks }); spawnSync('git', ['config', 'user.name', 'Test'], { cwd: noTasks });
            fs.writeFileSync(path.join(noTasks, 'seed.txt'), 'seed'); spawnSync('git', ['add', 'seed.txt'], { cwd: noTasks }); spawnSync('git', ['commit', '-qm', 'seed'], { cwd: noTasks });
            const absent = spawnSync('bash', ['--norc', '--noprofile', '-c', code, '_', file, 'canon', 'run', ''], { cwd: noTasks, env: { PATH: process.env.PATH, HOME: noTasks }, encoding: 'utf8' });
            assert.equal(absent.status, 0); assert.equal(absent.stdout, ''); assert.equal(absent.stderr, '');
        } finally { fs.rmSync(noRepo, { recursive: true, force: true }); fs.rmSync(noTasks, { recursive: true, force: true }); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

void test('zsh completion smoke cases preserve contextual values and task ids', t => {
    const available = spawnSync('which', ['zsh'], { encoding: 'utf8' }).status === 0;
    if (!available) { if (process.env.CI) assert.fail('zsh is required in CI'); t.diagnostic('zsh not installed; smoke check skipped'); return; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-completion-zsh-'));
    const file = path.join(dir, 'completion.zsh');
    try {
        const git = (args: string[]) => { const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); };
        git(['init', '-q']); git(['config', 'user.email', 'test@example.com']); git(['config', 'user.name', 'Test']);
        fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed'); git(['add', 'seed.txt']); git(['commit', '-qm', 'seed']);
        for (const name of ['alpha', 'beta', '_archive', '.hidden']) fs.mkdirSync(path.join(dir, 'tasks', name), { recursive: true });
        fs.writeFileSync(path.join(dir, 'tasks', 'plain-file'), 'file');
        fs.mkdirSync(path.join(dir, 'sub', 'dir'), { recursive: true });
        fs.writeFileSync(file, rendered.zsh);
        const rows: Array<[string[], string[]]> = [
            [[''], ['init', 'doctor', 'task', 'run', 'watch', 'stop', 'update', 'upgrade', 'completion']],
            [['run', '--'], ['--pr', '--allow-divergent-base']],
            [['run', '--expect', ''], [...model.values.phase]],
            [['task', '-'], ['--help', '-h']],
            [['unknown', '-'], ['--help', '-h', '--version', '-v']],
            [['run', ''], ['alpha', 'beta']],
            [['run', 'alpha', ''], ['alpha', 'beta']],
            [['watch', '--until', 'plan', ''], ['alpha', 'beta']],
            [['watch', '--until', ''], [...model.values.phase]],
            [['stop', 'alpha', ''], []],
            [['watch', 'alpha', ''], []],
            [['task', 'status', 'alpha', ''], []],
            [['task', 'reset-spec-review', 'alpha', ''], []],
            [['task', 'reset-code-review', 'alpha', ''], []],
            [['task', 'phase', 'alpha', ''], ['spec', 'spec_review', 'plan', 'implement', 'code_review', 'qa', 'human_review']],
            [['task', 'phase', 'alpha', 'spec', ''], ['pending', 'in_progress', 'done', 'changes_requested', 'blocked']],
            [['task', 'phase', 'alpha', 'code_review', 'done', ''], model.verdictsByPhase.code_review],
            [['task', 'phase', 'alpha', 'spec_review', 'done', ''], ['approved', 'approved_with_nits', 'changes_requested', 'needs_re_review']],
            [['task', 'phase', 'alpha', 'plan', 'done', ''], []],
            [['task', 'accept', 'alpha', '--reason', 'x', ''], ['beta', 'implement']],
            [['task', 'set', 'alpha', 'task_size', ''], ['XS', 'S', 'M', 'L', 'XL']],
            [['task', 'set', 'alpha', 'delicate', ''], ['true', 'false']],
            [['task', 'set', 'alpha', 'title', ''], []],
            [['task', 'set', 'alpha', 'unknown', ''], []],
            [['completion', ''], ['bash', 'zsh', 'fish', 'tcsh']],
        ];
        for (const [words, expected] of rows) {
            const completionArgs = [words[words.length - 1], ...words.slice(0, -1)];
            const result = spawnSync('zsh', ['-f', '-c', '. "$1"; shift; _canon_candidates "$@"', '_', file, ...completionArgs], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, encoding: 'utf8' });
            assert.equal(result.status, 0, `${words.join(' ')}: ${result.stderr}`);
            const actual = result.stdout.trim().split(/\r?\n/).filter(Boolean).sort();
            if (words[words.length - 1] === '--' || words.includes('accept') || expected.includes('spec_gap')) for (const candidate of expected) assert.ok(actual.includes(candidate), `${words.join(' ')}: missing ${candidate}`);
            else assert.deepEqual(actual, [...expected].sort(), `${words.join(' ')} ${result.stderr}`);
        }
        const worktree = path.join(dir, 'wt');
        git(['worktree', 'add', '--detach', worktree, 'HEAD']);
        for (const cwd of [path.join(dir, 'sub', 'dir'), worktree]) {
            const result = spawnSync('zsh', ['-f', '-c', '. "$1"; shift; _canon_candidates "$@"', '_', file, '', 'run'], { cwd, env: { PATH: process.env.PATH, HOME: dir }, encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr);
            assert.deepEqual(result.stdout.trim().split(/\r?\n/).filter(Boolean).sort(), ['alpha', 'beta']);
        }
        const noRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-completion-zsh-no-repo-'));
        const noTasks = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-completion-zsh-no-tasks-'));
        try {
            const empty = spawnSync('zsh', ['-f', '-c', 'compdef() { :; }; . "$1"; shift; _canon_candidates "" "$@"', '_', file, 'run'], { cwd: noRepo, env: { PATH: process.env.PATH, HOME: noRepo }, encoding: 'utf8' });
            assert.equal(empty.status, 0, empty.stderr); assert.equal(empty.stdout, ''); assert.equal(empty.stderr, '');
            const init = spawnSync('git', ['init', '-q'], { cwd: noTasks, encoding: 'utf8' }); assert.equal(init.status, 0);
            spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: noTasks }); spawnSync('git', ['config', 'user.name', 'Test'], { cwd: noTasks });
            fs.writeFileSync(path.join(noTasks, 'seed.txt'), 'seed'); spawnSync('git', ['add', 'seed.txt'], { cwd: noTasks }); spawnSync('git', ['commit', '-qm', 'seed'], { cwd: noTasks });
            const absent = spawnSync('zsh', ['-f', '-c', 'compdef() { :; }; . "$1"; shift; _canon_candidates "" "$@"', '_', file, 'run'], { cwd: noTasks, env: { PATH: process.env.PATH, HOME: noTasks }, encoding: 'utf8' });
            assert.equal(absent.status, 0, absent.stderr); assert.equal(absent.stdout, ''); assert.equal(absent.stderr, '');
        } finally { fs.rmSync(noRepo, { recursive: true, force: true }); fs.rmSync(noTasks, { recursive: true, force: true }); }
        const noCompdef = spawnSync('zsh', ['-f', '-c', '. "$1"', '_', file], { encoding: 'utf8' });
        assert.equal(noCompdef.status, 0);
        assert.equal(noCompdef.stderr, 'canon completion: compdef not found; load compinit before this line\n');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

void test('fish completion smoke cases cover command, verdict, and field contexts', t => {
    if (spawnSync('which', ['fish'], { encoding: 'utf8' }).status !== 0) {
        if (process.env.CI) assert.fail('fish is required in CI');
        t.diagnostic('fish not installed; runtime smoke skipped');
        return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-completion-fish-'));
    const file = path.join(dir, 'completion.fish');
    try {
        const git = (args: string[]) => { const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); };
        git(['init', '-q']); git(['config', 'user.email', 'test@example.com']); git(['config', 'user.name', 'Test']);
        fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed'); git(['add', 'seed.txt']); git(['commit', '-qm', 'seed']);
        for (const name of ['alpha', 'beta', '_archive', '.hidden']) fs.mkdirSync(path.join(dir, 'tasks', name), { recursive: true });
        fs.writeFileSync(path.join(dir, 'tasks', 'plain-file'), 'file');
        fs.writeFileSync(file, rendered.fish);
        const rows: Array<[string[], string[]]> = [
            [['run'], ['alpha', 'beta']],
            [['run', 'alpha'], ['alpha', 'beta']],
            [['run', '--expect'], [...model.values.phase]],
            [['task', 'phase', 'alpha', 'code_review', 'done'], model.verdictsByPhase.code_review],
            [['task', 'set', 'alpha', 'delicate'], ['true', 'false']],
            [['task', 'set', 'alpha', 'task_size'], ['XS', 'S', 'M', 'L', 'XL']],
            [['task', 'set', 'alpha', 'unknown'], []],
            [['task', 'accept', 'alpha'], ['alpha', 'beta', 'implement', 'spec_review', 'code_review']],
        ];
        for (const [words, expected] of rows) {
            const result = spawnSync('fish', ['-c', 'source $argv[1]; __canon_candidates "" $argv[2..-1]', file, ...words], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, encoding: 'utf8' });
            assert.equal(result.status, 0, `${words.join(' ')}: ${result.stderr}`);
            assert.deepEqual(result.stdout.trim().split(/\r?\n/).filter(Boolean).sort(), [...expected].sort(), `${words.join(' ')}`);
        }
        const dashFlags = spawnSync('fish', ['-c', 'source $argv[1]; __canon_candidates "-" task', file], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, encoding: 'utf8' });
        assert.equal(dashFlags.status, 0, dashFlags.stderr);
        assert.deepEqual(dashFlags.stdout.trim().split(/\r?\n/).filter(Boolean).sort(), ['--help', '-h'].sort());
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

void test('tcsh flag program selects flags for the active command path', () => {
    const program = tcshFlagProgram(model);
    for (const line of ['canon run --', 'canon task accept a --', 'canon task -']) {
        const result = spawnSync('awk', [program], { env: { ...process.env, COMMAND_LINE: line }, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        if (line === 'canon task -') { assert.match(result.stdout, /--help/); assert.doesNotMatch(result.stdout, /--version|--pr/); }
        else if (line.includes('task accept')) assert.match(result.stdout, /--reason/);
        else { assert.match(result.stdout, /--pr/); assert.doesNotMatch(result.stdout, /--channel/); }
    }
});

void test('completion value sets pass the corresponding command validators', () => {
    for (const value of model.values.phase) assert.equal(parseWatchArgs(['alpha', '--until', value]).usageError, null);
    for (const value of model.values.phase) assert.doesNotThrow(() => assertValidPhase(value));
    for (const value of model.values.phaseStatus) assert.doesNotThrow(() => assertValidStatus(value));
    for (const [phase, verdicts] of Object.entries(model.verdictsByPhase)) for (const verdict of verdicts) assert.doesNotThrow(() => assertValidVerdict(phase as 'spec_review' | 'code_review', verdict));
    for (const value of ACCEPT_PHASES) {
        const prior = process.env.CANON_TASKS_DIR_OVERRIDE;
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-completion-accept-'));
        process.env.CANON_TASKS_DIR_OVERRIDE = empty;
        try { assert.throws(() => taskAccept(['zz-missing'], value), error => error instanceof Error && !error.message.includes('supports implement, spec_review, and code_review')); }
        finally { if (prior === undefined) delete process.env.CANON_TASKS_DIR_OVERRIDE; else process.env.CANON_TASKS_DIR_OVERRIDE = prior; fs.rmSync(empty, { recursive: true, force: true }); }
    }
    for (const value of model.values.updateChannel) assert.doesNotThrow(() => parseUpdateArgs(['--channel', value]));
    const prior = process.env.CANON_TASKS_DIR_OVERRIDE;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-completion-set-'));
    const statusDir = path.join(root, 'zz-task');
    fs.mkdirSync(statusDir, { recursive: true });
    const statusTemplate = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.canon/templates/status.json'), 'utf8')) as Record<string, unknown>;
    statusTemplate.id = 'zz-task'; statusTemplate.branch = ''; statusTemplate.delicate = false;
    fs.writeFileSync(path.join(statusDir, 'status.json'), JSON.stringify(statusTemplate, null, 2));
    process.env.CANON_TASKS_DIR_OVERRIDE = root;
    try {
        const fields = ['task_size', 'human_spec_gate', 'delicate', 'worktree'];
        for (const field of fields) {
            const values = TASK_SET_FIELD_VALUES[field as keyof typeof TASK_SET_FIELD_VALUES] ?? [];
            for (const value of values) taskSet(['zz-task', field, value]);
        }
        assert.deepEqual([...SETTABLE_FIELDS].sort(), [...fields, 'title', 'base_branch'].sort());
    } finally { if (prior === undefined) delete process.env.CANON_TASKS_DIR_OVERRIDE; else process.env.CANON_TASKS_DIR_OVERRIDE = prior; fs.rmSync(root, { recursive: true, force: true }); }
});

void test('completion command prints deterministic scripts without requiring a repository', () => {
    const root = process.cwd();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-completion-cli-'));
    const loader = path.join(root, 'node_modules', 'tsx', 'dist', 'loader.mjs');
    const entry = path.join(root, 'src', 'cli', 'index.ts');
    const invoke = (args: string[]) => spawnSync(process.execPath, ['--import', loader, entry, 'completion', ...args], { cwd: dir, encoding: 'utf8' });
    try {
        for (const shell of COMPLETION_SHELLS) {
            const first = invoke([shell]);
            const second = invoke([shell]);
            assert.equal(first.status, 0, first.stderr);
            assert.ok(first.stdout.length > 0);
            assert.equal(first.stdout, second.stdout);
            assert.equal(first.stdout.includes(dir), false);
            assert.equal(first.stdout.includes('3.13.0'), false);
        }
        for (const args of [[], ['powershell'], ['bash', 'zsh'], ['--bogus'], ['bash', '--bogus']]) {
            const result = invoke(args);
            assert.equal(result.status, 1, args.join(' '));
            assert.equal(result.stderr.trimEnd().split(/\r?\n/).length, 2, args.join(' '));
            assert.equal(result.stderr.trimEnd().split(/\r?\n/).at(-1), "Run 'canon completion --help' for usage.");
        }
        for (const args of [['--help'], ['-h'], ['bash', '-h']]) {
            const result = invoke(args);
            assert.equal(result.status, 0, result.stderr);
            for (const shell of COMPLETION_SHELLS) assert.ok(result.stdout.includes(shell));
            for (const install of ['eval "$(canon completion bash)"', 'eval "$(canon completion zsh)"', 'canon completion fish | source', 'source ~/.canon-completion.tcsh', 'after compinit']) assert.ok(result.stdout.includes(install), install);
        }
        assert.deepEqual(fs.readdirSync(dir), []);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
