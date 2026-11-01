import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { RECOMMENDED_GUARD_HOOKS } from '../src/cli/commands/doctor.js';

const SCRIPT_PATH = path.join(process.cwd(), '.claude', 'hooks', 'canon-guard.mjs');

type GuardResult = { status: number | null; denied: boolean; reason: string; stdout: string };
type GuardOptions = { cwd?: string; env?: NodeJS.ProcessEnv };
type GuardFixture = {
    root: string;
    repo: string;
    internalWorktree: string;
    externalWorktree: string;
    noCanonRepo: string;
};

function runGuard(payload: unknown, options: GuardOptions = {}): GuardResult {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.CANON_WORKTREES_ROOT;
    Object.assign(env, options.env ?? {});
    const input = typeof payload === 'string' ? payload : JSON.stringify(payload) ?? '';
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
        cwd: options.cwd ?? process.cwd(),
        env,
        input,
        encoding: 'utf8',
    });
    const stdout = result.stdout ?? '';
    let reason = '';
    let denied = false;
    if (stdout !== '') {
        const parsed: unknown = JSON.parse(stdout);
        if (isRecord(parsed) && isRecord(parsed.hookSpecificOutput)) {
            denied = parsed.hookSpecificOutput.permissionDecision === 'deny';
            reason = typeof parsed.hookSpecificOutput.permissionDecisionReason === 'string'
                ? parsed.hookSpecificOutput.permissionDecisionReason
                : '';
        }
    }
    assert.equal(result.status, 0, result.stderr ?? 'hook process must fail open with exit 0');
    return { status: result.status, denied, reason, stdout };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withTempDir(fn: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-guard-'));
    try { fn(dir); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function withCanonRepo(fn: (fixture: GuardFixture) => void | Promise<void>): Promise<void> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-guard-repo-'));
    try { await fn(makeCanonRepo(root)); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function makeCanonRepo(root: string): GuardFixture {
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    gitInit(repo);
    fs.mkdirSync(path.join(repo, '.canon'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.canon', 'README.md'), '# Canon fixture\n');
    gitAddCommit(repo, 'seed canon marker');

    const internalWorktree = path.join(repo, '.canon', 'worktrees', 'foo');
    fs.mkdirSync(path.dirname(internalWorktree), { recursive: true });
    execFileSync('git', ['worktree', 'add', '-q', internalWorktree, '-b', 'task/foo'], { cwd: repo });

    const externalWorktree = path.join(root, 'outside', 'wt');
    fs.mkdirSync(path.dirname(externalWorktree), { recursive: true });
    execFileSync('git', ['worktree', 'add', '-q', externalWorktree, '-b', 'task/bar'], { cwd: repo });

    for (const worktree of [repo, internalWorktree, externalWorktree]) {
        fs.mkdirSync(path.join(worktree, 'tasks', 'foo'), { recursive: true });
        fs.mkdirSync(path.join(worktree, 'tasks', 'bar'), { recursive: true });
    }

    const noCanonRepo = path.join(root, 'no-canon');
    fs.mkdirSync(noCanonRepo, { recursive: true });
    gitInit(noCanonRepo);
    fs.mkdirSync(path.join(noCanonRepo, 'tasks', 'foo'), { recursive: true });

    return { root, repo, internalWorktree, externalWorktree, noCanonRepo };
}

function gitInit(cwd: string): void {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd });
    execFileSync('git', ['config', 'user.email', 'guard-test@example.com'], { cwd });
    execFileSync('git', ['config', 'user.name', 'Guard Test'], { cwd });
}

function gitAddCommit(cwd: string, message: string): void {
    execFileSync('git', ['add', '-A'], { cwd });
    execFileSync('git', ['commit', '-q', '-m', message], { cwd });
}

function writeExecutable(dir: string, name: string, lines: string[]): string {
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, ['#!/bin/sh', 'set -eu', ...lines, ''].join('\n'), { mode: 0o755 });
    return filePath;
}

function makeGhShim(binDir: string): void {
    writeExecutable(binDir, 'gh', [
        'if [ -n "${CANON_GUARD_GH_LOG-}" ]; then printf "%s\\n" "$*" >> "$CANON_GUARD_GH_LOG"; fi',
        'case "$3" in',
        '  12) printf "%s\\n" task/foo ;;',
        '  13) printf "%s\\n" release/v1.2 ;;',
        '  98) exec sleep 5 ;;',
        '  99) exit 1 ;;',
        '  *) exit 1 ;;',
        'esac',
    ]);
}

function statusPayload(toolName: string, filePath: string, cwd: string): unknown {
    return { tool_name: toolName, tool_input: { file_path: filePath }, cwd };
}

function assertStatusDenied(result: GuardResult): void {
    assert.equal(result.denied, true, result.reason || result.stdout || 'expected task status write to be denied');
    assert.match(result.reason, /canon task phase/);
    assert.match(result.reason, /canon task set/);
    assert.match(result.reason, /canon task accept/);
    assert.match(result.reason, /give the human the exact edit/);
}

void test('status.json rule denies task-state writes and allows read and neighboring paths', async t => {
    await withCanonRepo(async fixture => {
        const mainStatus = 'tasks/foo/status.json';
        const internalStatus = 'tasks/foo/status.json';
        const internalAbsolute = path.join(fixture.internalWorktree, 'tasks', 'foo', 'status.json');
        const externalStatus = path.join(fixture.externalWorktree, 'tasks', 'foo', 'status.json');

        for (const toolName of ['Edit', 'Write', 'MultiEdit']) {
            await t.test(`${toolName} on the main checkout task status`, () => {
                assertStatusDenied(runGuard(statusPayload(toolName, mainStatus, fixture.repo), { cwd: fixture.repo }));
            });
        }
        for (const toolName of ['Edit', 'Write']) {
            await t.test(`${toolName} on an in-repo linked worktree task status`, () => {
                assertStatusDenied(runGuard(statusPayload(toolName, internalStatus, fixture.internalWorktree), { cwd: fixture.internalWorktree }));
            });
            await t.test(`${toolName} on an in-repo linked worktree by absolute path from the main checkout`, () => {
                assertStatusDenied(runGuard(statusPayload(toolName, internalAbsolute, fixture.repo), { cwd: fixture.repo }));
            });
        }
        await t.test('Edit on an external linked worktree by absolute path from the main checkout', () => {
            assertStatusDenied(runGuard(statusPayload('Edit', externalStatus, fixture.repo), { cwd: fixture.repo }));
        });
        await t.test('Write on an external linked worktree by absolute path from the main checkout', () => {
            assertStatusDenied(runGuard(statusPayload('Write', externalStatus, fixture.repo), { cwd: fixture.repo }));
        });
        await t.test('Edit on an external linked worktree by relative path from inside that worktree', () => {
            assertStatusDenied(runGuard(statusPayload('Edit', 'tasks/foo/status.json', fixture.externalWorktree), { cwd: fixture.externalWorktree }));
        });
        await t.test('Write on an external linked worktree by relative path from inside that worktree', () => {
            assertStatusDenied(runGuard(statusPayload('Write', 'tasks/foo/status.json', fixture.externalWorktree), { cwd: fixture.externalWorktree }));
        });

        const externalAbsolute = path.join(fixture.externalWorktree, 'tasks', 'foo', 'status.json');
        const bashDenied = [
            ['sed -i on an external worktree from the main checkout', `sed -i 's/a/b/' ${externalAbsolute}`, fixture.repo],
            ['sed -i on an external worktree from inside that worktree', "sed -i 's/a/b/' tasks/foo/status.json", fixture.externalWorktree],
            ['sed -i task status write', "sed -i 's/a/b/' tasks/foo/status.json", fixture.repo],
            ['perl -pi task status write', "perl -pi -e 's/a/b/' tasks/foo/status.json", fixture.repo],
            ['perl in-place with backup extension', "perl -pi.bak -e 's/a/b/' tasks/foo/status.json", fixture.repo],
            ['perl line-processing in-place cluster', "perl -lpi -e 's/a/b/' tasks/foo/status.json", fixture.repo],
            ['perl octal-record in-place cluster', "perl -0777pi -e 's/a/b/' tasks/foo/status.json", fixture.repo],
            ['perl unicode-setting followed by in-place option', "perl -C16 -pi -e 's/a/b/' tasks/foo/status.json", fixture.repo],
            ['jq output redirect task status write', "jq '.phases' tasks/foo/status.json > tasks/foo/status.json", fixture.repo],
            ['append redirect task status write', 'echo x >> tasks/foo/status.json', fixture.repo],
            ['attached redirect target task status write', 'echo x >tasks/foo/status.json', fixture.repo],
            ['tee task status write', 'echo x | tee tasks/foo/status.json', fixture.repo],
            ['jq temp file moved over task status', "jq '.a=1' tasks/foo/status.json > /tmp/s && mv /tmp/s tasks/foo/status.json", fixture.repo],
            ['mv with flags over task status', 'mv -f /tmp/s tasks/foo/status.json', fixture.repo],
            ['cp over task status', 'cp /tmp/s tasks/foo/status.json', fixture.repo],
            ['install over task status', 'install -m 644 /tmp/s tasks/foo/status.json', fixture.repo],
        ] as const;
        for (const [name, command, cwd] of bashDenied) {
            await t.test(name, () => {
                assertStatusDenied(runGuard({ tool_name: 'Bash', tool_input: { command }, cwd }, { cwd }));
            });
        }

        const allowed = [
            ['Read tool call', { tool_name: 'Read', tool_input: { file_path: mainStatus }, cwd: fixture.repo }, fixture.repo],
            ['cat read', { tool_name: 'Bash', tool_input: { command: 'cat tasks/foo/status.json' }, cwd: fixture.repo }, fixture.repo],
            ['cat read with stderr redirect', { tool_name: 'Bash', tool_input: { command: 'cat tasks/foo/status.json 2>/dev/null' }, cwd: fixture.repo }, fixture.repo],
            ['read redirected to another file', { tool_name: 'Bash', tool_input: { command: "jq '.phases' tasks/foo/status.json > /tmp/x.json" }, cwd: fixture.repo }, fixture.repo],
            ['sed read', { tool_name: 'Bash', tool_input: { command: "sed -n '1,5p' tasks/foo/status.json" }, cwd: fixture.repo }, fixture.repo],
            ['perl -Mstrict read', { tool_name: 'Bash', tool_input: { command: "perl -Mstrict -ne 'print' tasks/foo/status.json" }, cwd: fixture.repo }, fixture.repo],
            ['perl -F pattern read', { tool_name: 'Bash', tool_input: { command: "perl -Fi -ane 'print' tasks/foo/status.json" }, cwd: fixture.repo }, fixture.repo],
            ['perl unicode input setting read', { tool_name: 'Bash', tool_input: { command: "perl -Ci -ane 'print' tasks/foo/status.json" }, cwd: fixture.repo }, fixture.repo],
            ['perl debugger flag list read', { tool_name: 'Bash', tool_input: { command: "perl -Dpi -ane 'print' tasks/foo/status.json" }, cwd: fixture.repo }, fixture.repo],
            ['perl unicode cluster swallowing later letters', { tool_name: 'Bash', tool_input: { command: "perl -C16pi -e 's/a/b/' tasks/foo/status.json" }, cwd: fixture.repo }, fixture.repo],
            ['quoted redirect-looking commit message', { tool_name: 'Bash', tool_input: { command: 'git commit -m "fix > tasks/foo/status.json"' }, cwd: fixture.repo }, fixture.repo],
            ['cp task status out to a backup', { tool_name: 'Bash', tool_input: { command: 'cp tasks/foo/status.json /tmp/status.bak' }, cwd: fixture.repo }, fixture.repo],
            ['cp task status into a target directory', { tool_name: 'Bash', tool_input: { command: 'cp -t /tmp tasks/foo/status.json' }, cwd: fixture.repo }, fixture.repo],
            ['mv a neighboring task file', { tool_name: 'Bash', tool_input: { command: 'mv /tmp/s tasks/foo/notes.md' }, cwd: fixture.repo }, fixture.repo],
            ['read piped to tee elsewhere', { tool_name: 'Bash', tool_input: { command: 'cat tasks/foo/status.json | tee /tmp/x' }, cwd: fixture.repo }, fixture.repo],
            ['canon template status', statusPayload('Edit', '.canon/templates/status.json', fixture.repo), fixture.repo],
            ['task template status', statusPayload('Edit', 'tasks/_templates/status.json', fixture.repo), fixture.repo],
            ['archived task status', statusPayload('Edit', 'tasks/_archive/foo/status.json', fixture.repo), fixture.repo],
            ['non-root tasks path', statusPayload('Edit', 'src/tasks/foo/status.json', fixture.repo), fixture.repo],
            ['task spec path', statusPayload('Edit', 'tasks/foo/spec.md', fixture.repo), fixture.repo],
            ['invalid task id with repeated dots', statusPayload('Edit', 'tasks/foo../status.json', fixture.repo), fixture.repo],
            ['status path in a repo without .canon', statusPayload('Edit', 'tasks/foo/status.json', fixture.noCanonRepo), fixture.noCanonRepo],
        ] as const;
        for (const [name, payload, cwd] of allowed) {
            await t.test(name, () => assert.equal(runGuard(payload, { cwd }).denied, false));
        }
    });
});

void test('monitoring rule denies piped run/watch and log polling but allows neighboring commands', async t => {
    const denied = [
        ['bare run pipe', 'canon run foo | tail', /canon watch <id>/],
        ['watch pipe with stderr', 'canon watch foo |& grep x', /canon watch <id>/],
        ['npx canon pipe', 'npx canon run foo | cat', /canon watch <id>/],
        ['canon-dev watch pipe', 'canon-dev watch foo | head', /canon watch <id>/],
        ['node CLI watch pipe', 'node ~/x/dist/cli/index.js watch foo | tail', /canon watch <id>/],
        ['env wrapper', 'env X=1 canon watch foo | head', /canon watch <id>/],
        ['exec wrapper', 'exec canon run foo | tail', /canon watch <id>/],
        ['fd redirect is not a separator', 'canon run foo 2>&1 | tail', /canon watch <id>/],
        ['second simple command', 'cd x && canon watch foo | head', /canon watch <id>/],
        ['line continuation', 'canon watch foo \\\n| head', /canon watch <id>/],
        ['foreground ship pipe', 'canon run foo --ship | tail', /without the pipe/],
        ['foreground PR pipe', 'canon run foo --pr | cat', /without the pipe/],
        ['tail follow', 'tail -f tasks/foo/.canon-run.log', /canon watch <id>/],
        ['sleep polling loop', 'while sleep 5; do tail -n 5 tasks/foo/.canon-run.log; done', /canon watch <id>/],
    ] as const;
    for (const [name, command, reason] of denied) {
        await t.test(name, () => {
            const result = runGuard({ tool_name: 'Bash', tool_input: { command }, cwd: process.cwd() });
            assert.equal(result.denied, true, result.reason || command);
            assert.match(result.reason, reason);
            if (name.startsWith('foreground')) assert.doesNotMatch(result.reason, /canon watch/);
        });
    }

    const heredoc = "cat <<'EOF' > notes.txt\ncanon run foo | tail\nEOF";
    const tabHeredoc = 'cat <<-EOF > notes.txt\ncanon run foo | tail\n\tEOF';
    const allowed = [
        ['bare run', 'canon run foo'],
        ['bare watch', 'canon watch foo'],
        ['other canon subcommand pipe', 'canon task status foo | jq .'],
        ['doctor pipe', 'canon doctor | head'],
        ['dry run pipe', 'canon run foo --dry-run | less'],
        ['help pipe', 'canon run --help | head'],
        ['quoted command text', 'echo "canon run foo | tail"'],
        ['quoted commit message', "git commit -m 'canon watch foo | head'"],
        ['comment', 'ls # canon run foo | tail'],
        ['heredoc body', heredoc],
        ['tab-stripped heredoc body', tabHeredoc],
        ['fd redirect without a pipe', 'canon run foo 2>&1'],
        ['pipe belongs to later command', 'canon run foo; echo done | cat'],
        ['other program pipe', "grep 'canon run' log.txt | head"],
        ['single log read', 'tail -n 50 tasks/foo/.canon-run.log'],
        ['one sleep then log read', 'sleep 60 && tail -n 20 tasks/foo/.canon-run.log'],
    ] as const;
    for (const [name, command] of allowed) {
        await t.test(name, () => {
            const result = runGuard({ tool_name: 'Bash', tool_input: { command }, cwd: process.cwd() });
            assert.equal(result.denied, false, result.reason || command);
        });
    }
});

void test('task PR merge rule denies squash/default and allows other strategies and lookup failures', async t => {
    await withCanonRepo(async fixture => {
        const binDir = path.join(fixture.root, 'bin');
        makeGhShim(binDir);
        const pathEnv = `${binDir}${path.delimiter}${process.env.PATH ?? ''}`;
        const run = (command: string, cwd = fixture.repo, env: NodeJS.ProcessEnv = {}) => runGuard(
            { tool_name: 'Bash', tool_input: { command }, cwd },
            { cwd, env: { ...env, PATH: pathEnv } },
        );

        for (const [name, command] of [
            ['explicit squash', 'gh pr merge 12 --squash'],
            ['default merge', 'gh pr merge 12'],
            ['non-strategy short-option cluster', 'gh pr merge 12 -ds'],
            ['strategy-looking title value', 'gh pr merge 12 --squash -t -dr'],
            ['strategy-looking title after a clustered value flag', 'gh pr merge 12 -dt -r'],
            ['cluster mixing squash with rebase', 'gh pr merge 12 -sr'],
            ['rebase explicitly disabled', 'gh pr merge 12 --rebase=false'],
        ] as const) {
            await t.test(name, () => {
                const result = run(command);
                assert.equal(result.denied, true, result.reason || command);
                assert.match(result.reason, /canon run foo --ship/);
                assert.match(result.reason, /ship\.merge_method/);
                assert.match(result.reason, /squash by default/);
                assert.doesNotMatch(result.reason, /merge outside canon/);
            });
        }
        const repoFlagCases = [
            ['global -R flag', 'gh -R owner/repo pr merge 12 --squash'],
            ['global --repo flag', 'gh --repo owner/repo pr merge 12 --squash'],
            ['global --repo=value flag', 'gh --repo=owner/repo pr merge 12 --squash'],
            ['global -R=value flag', 'gh -R=owner/repo pr merge 12 --squash'],
            ['global joined -R flag', 'gh -Rowner/repo pr merge 12 --squash'],
            ['-R between pr and merge', 'gh pr -R owner/repo merge 12 --squash'],
            ['--repo between pr and merge', 'gh pr --repo owner/repo merge 12 --squash'],
            ['--repo=value between pr and merge', 'gh pr --repo=owner/repo merge 12 --squash'],
            ['-R=value between pr and merge', 'gh pr -R=owner/repo merge 12 --squash'],
            ['joined -R between pr and merge', 'gh pr -Rowner/repo merge 12 --squash'],
            ['joined -R before PR reference', 'gh pr merge -Rowner/repo 12 --squash'],
            ['-R=value before PR reference', 'gh pr merge -R=owner/repo 12 --squash'],
            ['joined -R after PR reference', 'gh pr merge 12 -Rowner/repo --squash'],
            ['-R=value after PR reference', 'gh pr merge 12 -R=owner/repo --squash'],
        ] as const;
        const ghLogPath = path.join(fixture.root, 'gh-lookup.log');
        for (const [name, command] of repoFlagCases) {
            await t.test(name, () => {
                fs.rmSync(ghLogPath, { force: true });
                const result = run(command, fixture.repo, { CANON_GUARD_GH_LOG: ghLogPath });
                assert.equal(result.denied, true, result.reason || command);
                assert.match(result.reason, /canon run foo --ship/);
                assert.match(fs.readFileSync(ghLogPath, 'utf8'), /-R owner\/repo/);
            });
        }
        await t.test('bundle PR names every task recorded on the shared branch', () => {
            for (const id of ['foo', 'baz']) {
                fs.mkdirSync(path.join(fixture.internalWorktree, 'tasks', id), { recursive: true });
                fs.writeFileSync(path.join(fixture.internalWorktree, 'tasks', id, 'status.json'), JSON.stringify({ branch: 'task/foo' }));
            }
            fs.mkdirSync(path.join(fixture.internalWorktree, 'tasks', 'qux'), { recursive: true });
            fs.writeFileSync(path.join(fixture.internalWorktree, 'tasks', 'qux', 'status.json'), JSON.stringify({ branch: 'task/qux' }));
            try {
                const result = run('gh pr merge 12 --squash');
                assert.equal(result.denied, true);
                assert.match(result.reason, /canon run foo baz --ship/);
                assert.doesNotMatch(result.reason, /qux/);
            } finally {
                for (const id of ['foo', 'baz', 'qux']) fs.rmSync(path.join(fixture.internalWorktree, 'tasks', id, 'status.json'), { force: true });
            }
        });
        await t.test('implicit PR on the current task branch', () => {
            const result = run('gh pr merge', fixture.internalWorktree);
            assert.equal(result.denied, true, result.reason);
            assert.match(result.reason, /task\/foo/);
        });
        for (const [name, command] of [
            ['rebase merge', 'gh pr merge 12 --rebase'],
            ['merge commit', 'gh pr merge 12 --merge'],
            ['delete branch plus rebase short cluster', 'gh pr merge 12 -dr'],
            ['delete branch plus merge-commit short cluster', 'gh pr merge 12 -dm'],
            ['rebase cluster ending in a value flag', 'gh pr merge 12 -rt subject'],
            ['explicit boolean rebase', 'gh pr merge 12 --rebase=true'],
            ['explicit boolean merge commit', 'gh pr merge 12 --merge=true'],
            ['merge-commit cluster ending in a value flag', 'gh pr merge 12 -mb body'],
            ['non-task PR', 'gh pr merge 13 --squash'],
            ['create PR', 'gh pr create --head task/foo --title x'],
            ['edit PR', 'gh pr edit 12 --body x'],
            ['check PR', 'gh pr checks 12'],
            ['lookup failure', 'gh pr merge 99'],
        ] as const) {
            await t.test(name, () => assert.equal(run(command).denied, false, command));
        }
        await t.test('lookup timeout fails open', () => {
            assert.equal(run('gh pr merge 98', fixture.repo, { CANON_GUARD_GH_TIMEOUT_MS: '300' }).denied, false);
        });
    });
});

void test('hook fails open on malformed, incomplete, unknown, and internal-error inputs', async () => {
    await withCanonRepo(fixture => {
        const missingInput = runGuard({ tool_name: 'Edit', cwd: fixture.repo });
        const missingCwd = runGuard({ tool_name: 'Edit', tool_input: { file_path: 'tasks/foo/status.json' } });
        const cases = [
            ['malformed JSON', runGuard('{not json', { cwd: fixture.repo })],
            ['unknown tool', runGuard({ tool_name: 'Frobnicate', tool_input: {}, cwd: fixture.repo })],
            ['missing tool_input', missingInput],
            ['missing cwd', missingCwd],
            ['internal error', runGuard(statusPayload('Edit', 'tasks/foo/status.json', fixture.repo), { cwd: fixture.repo, env: { CANON_GUARD_TEST_THROW: '1' } })],
        ] as const;
        for (const [name, result] of cases) {
            assert.equal(result.status, 0, name);
            assert.equal(result.stdout, '', name);
            assert.equal(result.denied, false, name);
        }
    });
});

void test('exported snippet is a no-op when missing and reaches the hook when installed', () => {
    withTempDir(projectDir => {
        const command = RECOMMENDED_GUARD_HOOKS.hooks.PreToolUse[0].hooks[0].command;
        const payload = JSON.stringify({
            tool_name: 'Bash',
            tool_input: { command: 'canon run foo | tail' },
            cwd: projectDir,
        });
        const missing = spawnSync('sh', ['-c', command], {
            cwd: projectDir,
            env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
            input: payload,
            encoding: 'utf8',
        });
        assert.equal(missing.status, 0);
        assert.equal(missing.stdout, '');

        const target = path.join(projectDir, '.claude', 'hooks', 'canon-guard.mjs');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(SCRIPT_PATH, target);
        const installed = spawnSync('sh', ['-c', command], {
            cwd: projectDir,
            env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
            input: payload,
            encoding: 'utf8',
        });
        assert.equal(installed.status, 0);
        const output: unknown = JSON.parse(installed.stdout ?? '');
        assert.ok(isRecord(output) && isRecord(output.hookSpecificOutput));
        assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
    });
});

void test('deny reasons stay adopter-safe, actionable, and end with the next action', async () => {
    await withCanonRepo(fixture => {
        const binDir = path.join(fixture.root, 'bin');
        makeGhShim(binDir);
        const ghEnv = { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` };
        const reasons = [
            runGuard(statusPayload('Edit', 'tasks/foo/status.json', fixture.repo), { cwd: fixture.repo }).reason,
            runGuard({ tool_name: 'Bash', tool_input: { command: 'canon run foo | tail' }, cwd: fixture.repo }, { cwd: fixture.repo }).reason,
            runGuard({ tool_name: 'Bash', tool_input: { command: 'canon run foo --ship | tail' }, cwd: fixture.repo }, { cwd: fixture.repo }).reason,
            runGuard({ tool_name: 'Bash', tool_input: { command: 'tail -f tasks/foo/.canon-run.log' }, cwd: fixture.repo }, { cwd: fixture.repo }).reason,
            runGuard({ tool_name: 'Bash', tool_input: { command: 'gh pr merge 12 --squash' }, cwd: fixture.repo }, { cwd: fixture.repo, env: ghEnv }).reason,
        ];
        assert.ok(reasons.every(reason => reason.length > 0));
        for (const reason of reasons) {
            assert.doesNotMatch(reason, /\b(?:src|scripts|tests)\//);
            assert.match(reason.trim().split(/(?<=\.)\s+/).at(-1) ?? '', /^(?:Retry|hand the edit to the human)/i);
        }
        assert.match(reasons[1], /canon watch <id>/);
        assert.match(reasons[2], /without the pipe/);
        assert.match(reasons[3], /canon watch <id>/);
        assert.match(reasons[4], /canon run foo --ship/);
    });
});
