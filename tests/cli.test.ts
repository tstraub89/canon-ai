import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { mergeDelimited, mergeHeaderOnly, parseUpgradeArgs, printStaleOverrideNudge, printUpgradeRefusals, runUpgrade } from '../src/cli/commands/upgrade.js';
import {
    detectInstallType,
    layoutGate,
    parseUpdateArgs,
    updateCmd,
    defaultGitRunner,
    resolveNamedRef,
    resolveStable,
} from '../src/cli/commands/update.js';
import { existingAgentFilesNoticeLines, hasExistingAgentFiles, scaffoldTemplates } from '../src/cli/commands/init.js';
import { CANON_LOG_HEADERS } from '../src/orchestrator/quality-log.js';
import {
    CANON_GITIGNORE_BLOCK,
    CANON_RUNTIME_GITIGNORE_PATTERNS,
    extractCanonBlock,
    upsertCanonBlock,
} from '../src/lib/canon-block.js';
import {
    checkActiveOrchestrators,
    checkNodeVersion,
    checkCodexMdDeprecated,
    EXPECTED_TEMPLATES,
    checkTemplates,
    checkSkills,
    checkCanonVersion,
    checkQualityLog,
    checkCanonDiscoveryNudge,
    checkLocalSettingsGitignored,
    checkRuntimeFilesGitignored,
    checkRecommendedPermissions,
    checkClaudeVersion,
    formatAge,
    parseClaudeVersion,
    parseCodexProjectTrust,
    MIN_CLAUDE_VERSION,
    RECOMMENDED_ALLOW,
    RECOMMENDED_NUDGE,
} from '../src/cli/commands/doctor.js';
import { CANON_OWNED } from '../src/lib/canon-owned.js';
import { HEARTBEAT_STALE_AFTER_MS } from '../src/orchestrator/heartbeat.js';
import { REPO_ROOT } from '../src/orchestrator/env.js';

const WORKTREE_ROOT = process.cwd();
const CLI_ENTRYPOINT = path.join(WORKTREE_ROOT, 'src', 'cli', 'index.ts');

function withTempDir(fn: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-cli-'));
    try { fn(dir); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function runCanonCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
    return runCanonCliIn(WORKTREE_ROOT, args);
}

function runCanonCliIn(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(process.execPath, ['--import', 'tsx', CLI_ENTRYPOINT, ...args], {
        cwd,
        encoding: 'utf8',
    });
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

function writeExecutable(scriptDir: string, name: string, body: string[]): void {
    fs.writeFileSync(path.join(scriptDir, name), ['#!/bin/sh', 'set -eu', ...body, ''].join('\n'), { mode: 0o755 });
}

function buildUpdateRedFirstFixture(dir: string): {
    installRoot: string;
    adopterDir: string;
    cliEntry: string;
    binDir: string;
    npmLogPath: string;
    envPromptLogPath: string;
    gitLogPath: string;
} {
    const installRoot = path.join(dir, 'install');
    const adopterDir = path.join(dir, 'adopter');
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(installRoot, { recursive: true });
    fs.mkdirSync(adopterDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });

    fs.writeFileSync(path.join(installRoot, 'package.json'), JSON.stringify({
        name: 'install-project',
        devDependencies: { 'canon-ai': 'github:tstraub89/canon-ai' },
    }, null, 2));
    const packageTarget = path.join(installRoot, 'node_modules', 'canon-ai');
    fs.mkdirSync(packageTarget, { recursive: true });
    fs.cpSync(path.join(WORKTREE_ROOT, 'dist'), path.join(packageTarget, 'dist'), { recursive: true });
    fs.cpSync(path.join(WORKTREE_ROOT, 'package.json'), path.join(packageTarget, 'package.json'));

    fs.writeFileSync(path.join(adopterDir, 'package.json'), JSON.stringify({
        name: 'unrelated-adopter-project',
        dependencies: { express: '^4.0.0' },
    }, null, 2));
    fs.writeFileSync(path.join(adopterDir, 'package-lock.json'), JSON.stringify({
        name: 'unrelated-adopter-project',
        lockfileVersion: 3,
    }, null, 2));

    const npmLogPath = path.join(dir, 'npm.log');
    writeExecutable(binDir, 'npm', [
        `printf '%s\\t%s\\n' "$(pwd)" "$*" >> ${JSON.stringify(npmLogPath)}`,
        'if [ "$1" = "view" ]; then',
        '  version="${2##*@}"',
        '  printf \'"%s"\' "$version"',
        'fi',
        'if [ "$1" = "install" ]; then',
        `  node -e ${JSON.stringify("const fs = require('fs'); const file = process.cwd() + '/package.json'; const manifest = JSON.parse(fs.readFileSync(file, 'utf8')); const spec = process.argv.slice(1).find(arg => arg.startsWith('canon-ai@')); if (spec) { const version = spec.slice('canon-ai@'.length); manifest.devDependencies['canon-ai'] = process.argv.slice(1).includes('--save-exact') ? version : '^' + version; fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\\n'); }")} "$@"`,
        'fi',
        'exit 0',
    ]);

    const envPromptLogPath = path.join(dir, 'git-env.log');
    const gitLogPath = path.join(dir, 'git.log');
    writeExecutable(binDir, 'git', [
        `printf '%s\\n' "$*" >> ${JSON.stringify(gitLogPath)}`,
        `printf '%s\\n' "GIT_TERMINAL_PROMPT=${'${GIT_TERMINAL_PROMPT:-unset}'} GIT_SSH_COMMAND=${'${GIT_SSH_COMMAND:-unset}'}" >> ${JSON.stringify(envPromptLogPath)}`,
        'if [ "${CANON_TEST_FORCE_HTTPS_FAIL:-}" = "1" ]; then',
        '  case "$*" in',
        '    *https://github.com*) exit 1 ;;',
        '  esac',
        'fi',
        'if [ "$1" = "ls-remote" ] && [ "$2" = "--tags" ]; then',
        `  printf '%s\\t%s\\n' ${UPDATE_SHA_A} refs/tags/v8.1.0`,
        `  printf '%s\\t%s\\n' ${UPDATE_SHA_B} refs/tags/v8.2.0`,
        `  printf '%s\\t%s\\n' ${UPDATE_SHA_C} refs/tags/v8.2.0^{}`,
        '  exit 0',
        'fi',
        'exit 1',
    ]);

    return {
        installRoot,
        adopterDir,
        cliEntry: path.join(packageTarget, 'dist', 'cli', 'index.js'),
        binDir,
        npmLogPath,
        envPromptLogPath,
        gitLogPath,
    };
}

const UPDATE_SHA_A = 'a'.repeat(40);
const UPDATE_SHA_B = 'b'.repeat(40);
const UPDATE_SHA_C = 'c'.repeat(40);

class UpdateExitError extends Error {
    constructor(readonly code: number) {
        super(`update exited with ${code}`);
    }
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

function makeLocalUpdateRoot(dir: string, manifest: unknown): string {
    fs.mkdirSync(path.join(dir, 'node_modules', 'canon-ai'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
    return dir;
}

function stableUpdateGitRunner(args: string[]): { ok: boolean; stdout: string; stderr: string } {
    if (args[0] === 'ls-remote' && args[1] === '--tags') {
        return {
            ok: true,
            stdout: `${UPDATE_SHA_A}\trefs/tags/v8.1.0\n${UPDATE_SHA_B}\trefs/tags/v8.2.0\n${UPDATE_SHA_C}\trefs/tags/v8.2.0^{}\n`,
            stderr: '',
        };
    }
    return { ok: false, stdout: '', stderr: 'unexpected git invocation' };
}

function stableNpmViewRunner(args: string[]): { status: number; stdout: string; stderr: string } {
    const spec = args.find(arg => arg.includes('@')) ?? '';
    const atIdx = spec.lastIndexOf('@');
    const version = atIdx > 0 ? spec.slice(atIdx + 1) : '';
    return { status: 0, stdout: JSON.stringify(version), stderr: '' };
}

function runLocalUpdate(dir: string, args: string[] = [], manifest: unknown = {
    name: 'local-project',
    devDependencies: { 'canon-ai': `github:tstraub89/canon-ai#${UPDATE_SHA_A}` },
}): { output: string[]; errors: string[]; npmArgs: string[]; npmCwd: string[]; npmViewArgs: string[][]; npmViewCwds: (string | undefined)[] } {
    const root = makeLocalUpdateRoot(dir, manifest);
    const output: string[] = [];
    const errors: string[] = [];
    const npmArgs: string[] = [];
    const npmCwd: string[] = [];
    const npmViewArgs: string[][] = [];
    const npmViewCwds: (string | undefined)[] = [];
    updateCmd(args, {
        packageDir: path.join(root, 'node_modules', 'canon-ai'),
        cwd: root,
        gitRunner: stableUpdateGitRunner,
        npmViewRunner: (args, cwd) => {
            npmViewArgs.push(args);
            npmViewCwds.push(cwd);
            return stableNpmViewRunner(args);
        },
        spawnRunner: (_command, commandArgs, options) => {
            npmArgs.push(commandArgs.join(' '));
            npmCwd.push(options.cwd);
            return { status: 0 };
        },
        stdout: message => output.push(message),
        stderr: message => errors.push(message),
        now: () => '2026-07-18T12:00:00.000Z',
        exit: code => { throw new UpdateExitError(code); },
    });
    return { output, errors, npmArgs, npmCwd, npmViewArgs, npmViewCwds };
}

const CANON_START = '<!-- canon:start -->';
const CANON_END = '<!-- canon:end -->';

// ── mergeDelimited ──────────────────────────────────────────────────────────

void test('mergeDelimited: replaces canon block and preserves project tail', () => {
    const template = `${CANON_START}\nnew canon content\n${CANON_END}\n`;
    const project = `${CANON_START}\nold canon content\n${CANON_END}\n\n## My Project\n\nCustom.\n`;
    const result = mergeDelimited(template, project);
    assert.equal(result, `${CANON_START}\nnew canon content\n${CANON_END}\n\n## My Project\n\nCustom.\n`);
});

void test('mergeDelimited: no project tail — returns just the new canon block', () => {
    const template = `${CANON_START}\nnew\n${CANON_END}\n`;
    const project = `${CANON_START}\nold\n${CANON_END}\n`;
    assert.equal(mergeDelimited(template, project), `${CANON_START}\nnew\n${CANON_END}\n`);
});

void test('mergeDelimited: template missing start → null', () => {
    assert.equal(mergeDelimited(`no start\n${CANON_END}\n`, `${CANON_START}\nold\n${CANON_END}\n`), null);
});

void test('mergeDelimited: project missing start → null', () => {
    assert.equal(mergeDelimited(`${CANON_START}\nnew\n${CANON_END}\n`, `no start\n${CANON_END}\n`), null);
});

void test('mergeDelimited: template missing end → null', () => {
    assert.equal(mergeDelimited(`${CANON_START}\nnew\n`, `${CANON_START}\nold\n${CANON_END}\n`), null);
});

void test('mergeDelimited: project missing end → null', () => {
    assert.equal(mergeDelimited(`${CANON_START}\nnew\n${CANON_END}\n`, `${CANON_START}\nold\n`), null);
});

void test('mergeDelimited: canon:start with attributes still matches', () => {
    const template = `<!-- canon:start version="2" -->\nnew\n${CANON_END}\n`;
    const project = `<!-- canon:start version="1" -->\nold\n${CANON_END}\n\nproject tail\n`;
    const result = mergeDelimited(template, project);
    assert.equal(result, `<!-- canon:start version="2" -->\nnew\n${CANON_END}\n\nproject tail\n`);
});

void test('mergeDelimited: content already matches → byte-identical result (upgradeCmd skips)', () => {
    const content = `${CANON_START}\ncontent\n${CANON_END}\n\nproject tail\n`;
    assert.equal(mergeDelimited(content, content), content);
});

void test('mergeDelimited: multi-line project tail preserved exactly', () => {
    const template = `${CANON_START}\nnew\n${CANON_END}\n`;
    const tail = '\n\n## Section A\n\nLine 1.\nLine 2.\n\n## Section B\n\n- item\n';
    const project = `${CANON_START}\nold\n${CANON_END}\n${tail}`;
    assert.equal(mergeDelimited(template, project), `${CANON_START}\nnew\n${CANON_END}\n${tail}`);
});

void test('mergeDelimited: both template and project have no tail → result has no tail', () => {
    const template = `${CANON_START}\nt\n${CANON_END}`;
    const project = `${CANON_START}\np\n${CANON_END}`;
    assert.equal(mergeDelimited(template, project), `${CANON_START}\nt\n${CANON_END}`);
});

// ── canon .gitignore block ──────────────────────────────────────────────────

void test('upsertCanonBlock: empty content returns just the canon block', () => {
    assert.equal(upsertCanonBlock('', CANON_GITIGNORE_BLOCK), CANON_GITIGNORE_BLOCK);
});

void test('upsertCanonBlock: appends block while preserving existing content', () => {
    const existing = 'node_modules\n.env\n';
    assert.equal(
        upsertCanonBlock(existing, CANON_GITIGNORE_BLOCK),
        `${existing}\n${CANON_GITIGNORE_BLOCK}`,
    );
});

void test('upsertCanonBlock: replaces existing block and preserves both sides verbatim', () => {
    const before = 'node_modules\r\n.env\r\n\r\n';
    const after = '\r\n# local tail\r\n*.local\r\n';
    const oldBlock = '# canon:start\r\nold-pattern\r\n# canon:end\r\n';
    assert.equal(
        upsertCanonBlock(`${before}${oldBlock}${after}`, CANON_GITIGNORE_BLOCK),
        `${before}${CANON_GITIGNORE_BLOCK}${after}`,
    );
});

void test('upsertCanonBlock: applying twice is idempotent', () => {
    const once = upsertCanonBlock('node_modules\n', CANON_GITIGNORE_BLOCK);
    assert.ok(once);
    assert.equal(upsertCanonBlock(once, CANON_GITIGNORE_BLOCK), once);
});

void test('upsertCanonBlock: non-marker mentions of canon markers are preserved', () => {
    const existing = "# canon:start is canon's marker\nnode_modules\n";
    assert.equal(
        upsertCanonBlock(existing, CANON_GITIGNORE_BLOCK),
        `${existing}\n${CANON_GITIGNORE_BLOCK}`,
    );
});

void test('upsertCanonBlock: start marker without subsequent end marker returns null', () => {
    assert.equal(upsertCanonBlock('node_modules\n# canon:start\nstill open\n', CANON_GITIGNORE_BLOCK), null);
});

void test('upsertCanonBlock: orphan end marker is adopter content and block is appended', () => {
    const existing = 'node_modules\n# canon:end\n';
    assert.equal(
        upsertCanonBlock(existing, CANON_GITIGNORE_BLOCK),
        `${existing}\n${CANON_GITIGNORE_BLOCK}`,
    );
});

void test('root .gitignore canon block matches the shared constant', () => {
    const rootGitignore = fs.readFileSync(path.join(WORKTREE_ROOT, '.gitignore'), 'utf8');
    assert.equal(extractCanonBlock(rootGitignore), CANON_GITIGNORE_BLOCK);
});

// ── detectInstallType ────────────────────────────────────────────────────────

void test('detectInstallType: unix npx path → npx', () => {
    assert.deepEqual(detectInstallType('/home/user/.npm/_npx/abc123/node_modules/canon-ai'), { type: 'npx', installRoot: null });
});

void test('detectInstallType: windows npx path → npx', () => {
    assert.deepEqual(detectInstallType('C:\\Users\\user\\.npm\\_npx\\abc\\node_modules\\canon-ai'), { type: 'npx', installRoot: null });
});

void test('canon update: npx recommends the registry package', () => {
    const output: string[] = [];
    updateCmd([], {
        packageDir: '/home/user/.npm/_npx/abc/node_modules/canon-ai',
        stdout: message => output.push(message),
    });
    assert.match(output.join('\n'), /npx canon-ai@latest upgrade/);
    assert.doesNotMatch(output.join('\n'), /install-links|github:/);
});

void test('detectInstallType: local install — pkgDir inside project node_modules', () => {
    withTempDir(dir => {
        fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"my-project"}');
        const pkgDir = path.join(dir, 'node_modules', 'canon-ai');
        assert.deepEqual(detectInstallType(pkgDir), { type: 'local', installRoot: fs.realpathSync(dir) });
    });
});

void test('detectInstallType: local install from subdirectory — pkgDir path determines type, not cwd', () => {
    withTempDir(dir => {
        fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"my-project"}');
        const pkgDir = path.join(dir, 'node_modules', 'canon-ai');
        // cwd is a subdir — but detectInstallType uses pkgDir, not cwd
        assert.deepEqual(detectInstallType(pkgDir), { type: 'local', installRoot: fs.realpathSync(dir) });
    });
});

void test('detectInstallType: global — no package.json at node_modules parent', () => {
    // /usr/local/lib/node_modules/canon-ai: parent is /usr/local/lib — no package.json there
    assert.deepEqual(detectInstallType('/usr/local/lib/node_modules/canon-ai'), { type: 'global', installRoot: null });
});

void test('detectInstallType: no node_modules in path → global', () => {
    assert.deepEqual(detectInstallType('/usr/local/bin/canon-ai'), { type: 'global', installRoot: null });
});

void test('detectInstallType: node_modules present but parent lacks package.json → global', () => {
    withTempDir(dir => {
        // dir has no package.json
        const pkgDir = path.join(dir, 'node_modules', 'canon-ai');
        assert.deepEqual(detectInstallType(pkgDir), { type: 'global', installRoot: null });
    });
});

void test('detectInstallType: symlinked package dir resolves to the real install root', () => {
    withTempDir(dir => {
        const realProject = path.join(dir, 'real-project');
        fs.mkdirSync(realProject, { recursive: true });
        fs.writeFileSync(path.join(realProject, 'package.json'), '{"name":"my-project"}');
        const linkedProject = path.join(dir, 'linked-project');
        fs.symlinkSync(realProject, linkedProject, 'dir');
        const detection = detectInstallType(path.join(linkedProject, 'node_modules', 'canon-ai'));
        assert.equal(detection.type, 'local');
        assert.equal(detection.installRoot, fs.realpathSync(realProject));
        assert.notEqual(detection.installRoot, linkedProject);
    });
});

void test('canon update: pnpm-shaped virtual-store path reaches the layout refusal', () => {
    withTempDir(dir => {
        const packageDir = path.join(dir, 'node_modules', '.pnpm', 'canon-ai@2.2.0', 'node_modules', 'canon-ai');
        fs.mkdirSync(path.dirname(packageDir), { recursive: true });
        const errors: string[] = [];
        const npmCalls: string[] = [];
        assert.throws(() => updateCmd([], {
            packageDir,
            gitRunner: () => { throw new Error('resolver must not run'); },
            spawnRunner: () => { npmCalls.push('called'); return { status: 0 }; },
            stderr: message => errors.push(message),
            exit: code => { throw new UpdateExitError(code); },
        }), (error: unknown) => error instanceof UpdateExitError && error.code === 1);
        assert.match(errors[0], /no package\.json.*install root/);
        assert.deepEqual(npmCalls, []);
    });
});

void test('canon update (red-first): pins to installRoot cwd and the highest final-tag commit', () => {
    withTempDir(dir => {
        const fixture = buildUpdateRedFirstFixture(dir);
        const adopterPackageBefore = fs.readFileSync(path.join(fixture.adopterDir, 'package.json'), 'utf8');
        const adopterLockBefore = fs.readFileSync(path.join(fixture.adopterDir, 'package-lock.json'), 'utf8');
        const result = spawnSync(process.execPath, [fixture.cliEntry, 'update'], {
            cwd: fixture.adopterDir,
            encoding: 'utf8',
            env: {
                ...process.env,
                PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
                GIT_TERMINAL_PROMPT: '0',
                GIT_SSH_COMMAND: 'ssh -oBatchMode=yes',
            },
        });
        assert.equal(result.status, 0, result.stderr);

        const npmLog = fs.readFileSync(fixture.npmLogPath, 'utf8').trim().split('\n');
        assert.equal(npmLog.length, 2);
        const [recordedCwd, recordedArgs] = npmLog[1].split('\t');
        assert.equal(fs.realpathSync(recordedCwd), fs.realpathSync(fixture.installRoot));
        assert.match(recordedArgs, /^install --save-dev --save-exact canon-ai@8\.2\.0$/);
        const installRootManifest = JSON.parse(fs.readFileSync(path.join(fixture.installRoot, 'package.json'), 'utf8')) as { devDependencies: { 'canon-ai': string } };
        assert.equal(installRootManifest.devDependencies['canon-ai'], '8.2.0');

        assert.equal(fs.readFileSync(path.join(fixture.adopterDir, 'package.json'), 'utf8'), adopterPackageBefore);
        assert.equal(fs.readFileSync(path.join(fixture.adopterDir, 'package-lock.json'), 'utf8'), adopterLockBefore);

        const envLines = fs.readFileSync(fixture.envPromptLogPath, 'utf8').trim().split('\n');
        assert.ok(envLines.length > 0 && envLines.every(line => line === 'GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND=ssh -oBatchMode=yes'), envLines.join('|'));
    });
});

void test('canon update (red-first): falls back to SSH when HTTPS resolution fails (AC-12b, stable path)', () => {
    withTempDir(dir => {
        const fixture = buildUpdateRedFirstFixture(dir);
        const result = spawnSync(process.execPath, [fixture.cliEntry, 'update'], {
            cwd: fixture.adopterDir,
            encoding: 'utf8',
            env: {
                ...process.env,
                PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
                CANON_TEST_FORCE_HTTPS_FAIL: '1',
                GIT_TERMINAL_PROMPT: '0',
                GIT_SSH_COMMAND: 'ssh -oBatchMode=yes',
            },
        });
        assert.equal(result.status, 0, `${result.stderr}\nstatus=${result.status}; npmLogExists=${fs.existsSync(fixture.npmLogPath)}`);

        const npmLog = fs.readFileSync(fixture.npmLogPath, 'utf8').trim().split('\n');
        assert.match(npmLog[1].split('\t')[1], /^install --save-dev --save-exact canon-ai@8\.2\.0$/);

        const gitCalls = fs.readFileSync(fixture.gitLogPath, 'utf8').trim().split('\n').filter(line => line.includes('ls-remote'));
        assert.equal(gitCalls.length, 2);
        assert.match(gitCalls[0], /https:\/\/github\.com/);
        assert.match(gitCalls[1], /git@github\.com:/);

        const envLines = fs.readFileSync(fixture.envPromptLogPath, 'utf8').trim().split('\n');
        assert.ok(envLines.length > 0 && envLines.every(line => line === 'GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND=ssh -oBatchMode=yes'), envLines.join('|'));
    });
});

void test('parseUpdateArgs: accepts stable, main, and named or SHA refs', () => {
    assert.deepEqual(parseUpdateArgs([]), {});
    assert.deepEqual(parseUpdateArgs(['--channel', 'main']), { channel: 'main' });
    assert.deepEqual(parseUpdateArgs(['--ref', 'refs/heads/feature']), { ref: 'refs/heads/feature' });
    assert.deepEqual(parseUpdateArgs(['--ref', UPDATE_SHA_A]), { ref: UPDATE_SHA_A });
});

void test('parseUpdateArgs: rejects invalid or conflicting flags', () => {
    assert.throws(() => parseUpdateArgs(['--channel']), /--channel only supports 'main'/);
    assert.throws(() => parseUpdateArgs(['--channel', 'next']), /--channel only supports 'main'/);
    assert.throws(() => parseUpdateArgs(['--ref']), /--ref requires a value/);
    assert.throws(() => parseUpdateArgs(['--ref', '--upload-pack']), /must not start/);
    assert.throws(() => parseUpdateArgs(['--unknown']), /Supported: --channel main, --ref <ref\|sha>/);
    assert.throws(() => parseUpdateArgs(['--channel', 'main', '--ref', 'feature']), /mutually exclusive/);
});

void test('layoutGate: missing package.json is a distinct install-root refusal', () => {
    withTempDir(dir => {
        const result = layoutGate(dir);
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.message, /no package\.json.*install root/);
    });
});

void test('canon update: malformed or unrelated local manifests refuse before npm', () => {
    withTempDir(dir => {
        const malformedRoot = path.join(dir, 'malformed');
        fs.mkdirSync(path.join(malformedRoot, 'node_modules', 'canon-ai'), { recursive: true });
        fs.writeFileSync(path.join(malformedRoot, 'package.json'), '{not json');
        const malformedErrors: string[] = [];
        const malformedNpm: string[] = [];
        assert.throws(() => updateCmd([], {
            packageDir: path.join(malformedRoot, 'node_modules', 'canon-ai'),
            gitRunner: () => { throw new Error('resolver must not run'); },
            spawnRunner: () => { malformedNpm.push('called'); return { status: 0 }; },
            stderr: message => malformedErrors.push(message),
            exit: code => { throw new UpdateExitError(code); },
        }), (error: unknown) => error instanceof UpdateExitError && error.code === 1);
        assert.match(malformedErrors[0], /could not be parsed as JSON/);
        assert.deepEqual(malformedNpm, []);

        const unrelatedRoot = path.join(dir, 'unrelated');
        fs.mkdirSync(path.join(unrelatedRoot, 'node_modules', 'canon-ai'), { recursive: true });
        fs.writeFileSync(path.join(unrelatedRoot, 'package.json'), JSON.stringify({ dependencies: { express: '^4.0.0' } }));
        const unrelatedErrors: string[] = [];
        const unrelatedNpm: string[] = [];
        assert.throws(() => updateCmd([], {
            packageDir: path.join(unrelatedRoot, 'node_modules', 'canon-ai'),
            gitRunner: () => { throw new Error('resolver must not run'); },
            spawnRunner: () => { unrelatedNpm.push('called'); return { status: 0 }; },
            stderr: message => unrelatedErrors.push(message),
            exit: code => { throw new UpdateExitError(code); },
        }), (error: unknown) => error instanceof UpdateExitError && error.code === 1);
        assert.match(unrelatedErrors[0], /does not list canon-ai/);
        assert.deepEqual(unrelatedNpm, []);
    });
});

void test('canon update: canon-ai in each supported dependency block proceeds', () => {
    const expectedSaveFlags: Record<string, string> = {
        dependencies: '--save',
        devDependencies: '--save-dev',
        optionalDependencies: '--save-optional',
    };
    for (const block of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        withTempDir(dir => {
            const result = runLocalUpdate(dir, [], { name: 'local-project', [block]: { 'canon-ai': '^2.2.0' } });
            assert.equal(result.errors.length, 0);
            assert.equal(result.npmArgs.length, 1);
            assert.match(result.npmArgs[0], new RegExp(`^install ${expectedSaveFlags[block]} --save-exact canon-ai@8\\.2\\.0$`));
            assert.deepEqual(result.npmViewArgs, [['view', 'canon-ai@8.2.0', 'version', '--json']]);
            assert.deepEqual(result.npmViewCwds, [fs.realpathSync(dir)]);
        });
    }
});

void test('canon update: registry-absent version refuses with the ref fallback, no install spawn', () => {
    withTempDir(dir => {
        const errors: string[] = [];
        const npmCalls: string[] = [];
        assert.throws(() => updateCmd([], {
            packageDir: path.join(dir, 'node_modules', 'canon-ai'),
            cwd: dir,
            gitRunner: stableUpdateGitRunner,
            npmViewRunner: () => ({ status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }), stderr: 'npm error 404' }),
            spawnRunner: () => { npmCalls.push('called'); return { status: 0 }; },
            stderr: message => errors.push(message),
            exit: code => { throw new UpdateExitError(code); },
        }), (error: unknown) => error instanceof UpdateExitError && error.code === 1);
        assert.match(errors[0], /8\.2\.0/);
        assert.match(errors[0], /not yet on the npm registry/);
        assert.match(errors[0], /retry shortly/);
        assert.match(errors[0], /canon update --ref v8\.2\.0/);
        assert.deepEqual(npmCalls, []);
    });
});

void test('canon update: registry check failure refuses with the npm error, no install spawn', () => {
    withTempDir(dir => {
        const errors: string[] = [];
        const npmCalls: string[] = [];
        assert.throws(() => updateCmd([], {
            packageDir: path.join(dir, 'node_modules', 'canon-ai'),
            cwd: dir,
            gitRunner: stableUpdateGitRunner,
            npmViewRunner: () => ({ status: null, stdout: '', stderr: 'getaddrinfo ENOTFOUND registry.npmjs.org' }),
            spawnRunner: () => { npmCalls.push('called'); return { status: 0 }; },
            stderr: message => errors.push(message),
            exit: code => { throw new UpdateExitError(code); },
        }), (error: unknown) => error instanceof UpdateExitError && error.code === 1);
        assert.match(errors[0], /could not verify/);
        assert.match(errors[0], /ENOTFOUND/);
        assert.deepEqual(npmCalls, []);
    });
});

void test('resolveStable: selects the highest final tag and peeled commit', () => {
    let calls = 0;
    const result = resolveStable('owner/repo', args => {
        calls++;
        assert.deepEqual(args, ['ls-remote', '--tags', 'https://github.com/owner/repo.git']);
        return {
            ok: true,
            stdout: `${UPDATE_SHA_A}\trefs/tags/v8.2.0\n${UPDATE_SHA_B}\trefs/tags/v9.0.0-rc.1\n${UPDATE_SHA_C}\trefs/tags/v8.2.0^{}\n`,
            stderr: '',
        };
    });
    assert.equal(calls, 1);
    assert.deepEqual(result, { ok: true, sha: UPDATE_SHA_C, version: '8.2.0' });
});

void test('resolveStable: retries the identical query over SSH after HTTPS fails', () => {
    const calls: string[][] = [];
    const result = resolveStable('owner/repo', args => {
        calls.push(args);
        if (calls.length === 1) return { ok: false, stdout: '', stderr: 'HTTPS auth failed' };
        return {
            ok: true,
            stdout: `${UPDATE_SHA_A}\trefs/tags/v8.2.0\n${UPDATE_SHA_C}\trefs/tags/v8.2.0^{}\n`,
            stderr: '',
        };
    });
    assert.deepEqual(result, { ok: true, sha: UPDATE_SHA_C, version: '8.2.0' });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].slice(0, 2), calls[1].slice(0, 2));
    assert.deepEqual(calls[0].slice(3), calls[1].slice(3));
    assert.equal(calls[0][2], 'https://github.com/owner/repo.git');
    assert.equal(calls[1][2], 'git@github.com:owner/repo.git');
});

void test('resolveStable: reports both transports when HTTPS and SSH fail', () => {
    const calls: string[][] = [];
    const result = resolveStable('owner/repo', args => {
        calls.push(args);
        return { ok: false, stdout: '', stderr: calls.length === 1 ? 'HTTPS failed' : 'SSH failed' };
    });
    assert.equal(calls.length, 2);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /https.*HTTPS failed.*ssh.*SSH failed/i);
});

void test('defaultGitRunner: disables prompts and enables SSH batch mode', () => {
    withTempDir(dir => {
        const binDir = path.join(dir, 'bin');
        const envLogPath = path.join(dir, 'env.log');
        fs.mkdirSync(binDir, { recursive: true });
        writeExecutable(binDir, 'git', [
            `printf '%s\\n' "GIT_TERMINAL_PROMPT=${'${GIT_TERMINAL_PROMPT:-unset}'} GIT_SSH_COMMAND=${'${GIT_SSH_COMMAND:-unset}'}" >> ${JSON.stringify(envLogPath)}`,
            'exit 0',
        ]);

        const result = withEnv({
            PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
            GIT_SSH_COMMAND: 'ssh -i /tmp/canon-key',
        }, () => (
            defaultGitRunner(['ls-remote', '--tags', 'https://github.com/owner/repo.git'])
        ));
        assert.equal(result.ok, true);
        assert.equal(fs.readFileSync(envLogPath, 'utf8').trim(), 'GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND=ssh -i /tmp/canon-key -oBatchMode=yes');
    });
});

void test('resolveStable: resolution errors and no-final-tag universes refuse', () => {
    const error = resolveStable('owner/repo', () => ({ ok: false, stdout: '', stderr: 'authentication failed' }));
    assert.equal(error.ok, false);
    if (!error.ok) assert.match(error.message, /GitHub auth.*no npm install/);

    const empty = resolveStable('owner/repo', () => ({ ok: true, stdout: '', stderr: '' }));
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.match(empty.message, /no final release tags/);

    const prereleaseOnly = resolveStable('owner/repo', () => ({
        ok: true,
        stdout: `${UPDATE_SHA_A}\trefs/tags/v9.0.0-rc.1\n`,
        stderr: '',
    }));
    assert.equal(prereleaseOnly.ok, false);
    if (!prereleaseOnly.ok) assert.match(prereleaseOnly.message, /no final release tags/);
});

void test('resolveNamedRef: resolves peeled refs and refuses zero or ambiguous matches', () => {
    let resolvedCalls = 0;
    const resolved = resolveNamedRef('owner/repo', 'refs/heads/main', args => {
        resolvedCalls++;
        assert.deepEqual(args, ['ls-remote', 'https://github.com/owner/repo.git', 'refs/heads/main']);
        return { ok: true, stdout: `${UPDATE_SHA_A}\trefs/tags/v2.0.0\n${UPDATE_SHA_C}\trefs/tags/v2.0.0^{}\n`, stderr: '' };
    });
    assert.equal(resolvedCalls, 1);
    assert.deepEqual(resolved, { ok: true, sha: UPDATE_SHA_C });

    const none = resolveNamedRef('owner/repo', 'missing', () => ({ ok: true, stdout: '', stderr: '' }));
    assert.equal(none.ok, false);
    if (!none.ok) assert.match(none.message, /no remote ref matched/);

    const ambiguous = resolveNamedRef('owner/repo', 'feature', () => ({
        ok: true,
        stdout: `${UPDATE_SHA_A}\trefs/heads/feature\n${UPDATE_SHA_B}\trefs/tags/feature\n`,
        stderr: '',
    }));
    assert.equal(ambiguous.ok, false);
    if (!ambiguous.ok) assert.match(ambiguous.message, /ambiguous/);
});

void test('resolveNamedRef: retries the identical query over SSH after HTTPS fails', () => {
    const calls: string[][] = [];
    const result = resolveNamedRef('owner/repo', 'refs/heads/main', args => {
        calls.push(args);
        if (calls.length === 1) return { ok: false, stdout: '', stderr: 'HTTPS auth failed' };
        return { ok: true, stdout: `${UPDATE_SHA_C}\trefs/heads/main\n`, stderr: '' };
    });
    assert.deepEqual(result, { ok: true, sha: UPDATE_SHA_C });
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], calls[1][0]);
    assert.deepEqual(calls[0].slice(2), calls[1].slice(2));
    assert.equal(calls[0][1], 'https://github.com/owner/repo.git');
    assert.equal(calls[1][1], 'git@github.com:owner/repo.git');
});

void test('resolveNamedRef: reports both transports when HTTPS and SSH fail', () => {
    const calls: string[][] = [];
    const result = resolveNamedRef('owner/repo', 'refs/heads/main', args => {
        calls.push(args);
        return { ok: false, stdout: '', stderr: calls.length === 1 ? 'HTTPS failed' : 'SSH failed' };
    });
    assert.equal(calls.length, 2);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /https.*HTTPS failed.*ssh.*SSH failed/i);
});

void test('canon update: both failed resolver transports refuse before npm on stable and named-ref paths', () => {
    for (const args of [[], ['--channel', 'main']]) {
        withTempDir(dir => {
            const packageDir = path.join(dir, 'node_modules', 'canon-ai');
            const installRoot = path.dirname(path.dirname(packageDir));
            fs.mkdirSync(packageDir, { recursive: true });
            fs.writeFileSync(path.join(installRoot, 'package.json'), JSON.stringify({
                name: 'local-project',
                devDependencies: { 'canon-ai': '^2.2.0' },
            }));
            const errors: string[] = [];
            const npmCalls: string[] = [];
            let gitCalls = 0;
            assert.throws(() => updateCmd(args, {
                packageDir,
                gitRunner: () => {
                    gitCalls++;
                    return { ok: false, stdout: '', stderr: gitCalls === 1 ? 'HTTPS failed' : 'SSH failed' };
                },
                spawnRunner: () => { npmCalls.push('called'); return { status: 0 }; },
                stderr: message => errors.push(message),
                exit: code => { throw new UpdateExitError(code); },
            }), (error: unknown) => error instanceof UpdateExitError && error.code === 1);
            assert.equal(gitCalls, 2);
            assert.deepEqual(npmCalls, []);
            assert.match(errors[0], /https.*HTTPS failed.*ssh.*SSH failed/i);
        });
    }
});

void test('canon update: announces current and target pins without reading provenance', () => {
    withTempDir(dir => {
        const pinned = runLocalUpdate(dir, [], {
            name: 'local-project',
            devDependencies: { 'canon-ai': `github:tstraub89/canon-ai#${UPDATE_SHA_A}` },
        });
        const announcement = pinned.output[0];
        assert.match(announcement, /local install at/);
        assert.match(announcement, new RegExp(`current: .* @ ${UPDATE_SHA_A}`));
        assert.match(announcement, new RegExp(`target:  8\\.2\\.0 \\(stable\\) @ ${UPDATE_SHA_C}`));
        assert.doesNotMatch(announcement, /target:  v8\.2\.0/);

        withTempDir(registryDir => {
            const registry = runLocalUpdate(registryDir, [], {
                name: 'local-project',
                devDependencies: { 'canon-ai': '^8.1.0' },
            });
            assert.match(registry.output[0], /current: .* @ 8\.1\.0/);
        });

        withTempDir(exactDir => {
            const exact = runLocalUpdate(exactDir, [], {
                name: 'local-project',
                devDependencies: { 'canon-ai': '8.2.0' },
            });
            assert.match(exact.output[0], /current: .* @ 8\.2\.0/);
        });

        withTempDir(unpinnedDir => {
            const unpinned = runLocalUpdate(unpinnedDir, [], {
                name: 'local-project',
                devDependencies: { 'canon-ai': '^2.2.0' },
            });
            assert.match(unpinned.output[0], /current: .* @ 2\.2\.0/);
        });

        withTempDir(withProvenanceDir => {
            fs.mkdirSync(path.join(withProvenanceDir, '.canon'), { recursive: true });
            fs.writeFileSync(path.join(withProvenanceDir, '.canon', 'provenance.json'), 'not consulted');
            const withProvenance = runLocalUpdate(withProvenanceDir);
            const normalizeRoot = (message: string): string => message.replace(/local install at .+\n/, 'local install at <root>\n');
            assert.equal(normalizeRoot(withProvenance.output[0]), normalizeRoot(pinned.output[0]));
        });
    });
});

void test('canon update: main is labeled development and writes provenance without version', () => {
    withTempDir(dir => {
        const root = makeLocalUpdateRoot(dir, { devDependencies: { 'canon-ai': '^2.2.0' } });
        const output: string[] = [];
        const npmArgs: string[][] = [];
        updateCmd(['--channel', 'main'], {
            packageDir: path.join(root, 'node_modules', 'canon-ai'),
            gitRunner: args => {
                assert.deepEqual(args, ['ls-remote', 'https://github.com/tstraub89/canon-ai.git', 'refs/heads/main']);
                return { ok: true, stdout: `${UPDATE_SHA_C}\trefs/heads/main\n`, stderr: '' };
            },
            npmViewRunner: () => { throw new Error('development channel must not query npm'); },
            spawnRunner: (_command, args) => { npmArgs.push(args); return { status: 0 }; },
            stdout: message => output.push(message),
            exit: code => { throw new UpdateExitError(code); },
            now: () => '2026-07-18T12:00:00.000Z',
        });
        assert.match(output[0], /target:  main \(development\)/);
        assert.match(output[0], new RegExp(UPDATE_SHA_C));
        assert.deepEqual(npmArgs[0], ['install', '--save-dev', '--install-links', `github:tstraub89/canon-ai#${UPDATE_SHA_C}`]);
        const provenance = JSON.parse(fs.readFileSync(path.join(root, '.canon', 'provenance.json'), 'utf8')) as Record<string, unknown>;
        assert.deepEqual(provenance, {
            source: `github:tstraub89/canon-ai#${UPDATE_SHA_C}`,
            channel: 'main',
            resolved_sha: UPDATE_SHA_C,
            updated_at: '2026-07-18T12:00:00.000Z',
        });
    });
});

void test('canon update: fork slug is shared by resolution, npm, and provenance', () => {
    withTempDir(dir => withEnv({ CANON_UPSTREAM_REPO: 'my-fork/canon-ai' }, () => {
        const root = makeLocalUpdateRoot(dir, { devDependencies: { 'canon-ai': '^2.2.0' } });
        const gitArgs: string[][] = [];
        const npmArgs: string[][] = [];
        updateCmd([], {
            packageDir: path.join(root, 'node_modules', 'canon-ai'),
            gitRunner: args => {
                gitArgs.push(args);
                return { ok: true, stdout: `${UPDATE_SHA_C}\trefs/tags/v8.2.0\n`, stderr: '' };
            },
            npmViewRunner: () => { throw new Error('fork override must not query npm'); },
            spawnRunner: (_command, args) => { npmArgs.push(args); return { status: 0 }; },
            exit: code => { throw new UpdateExitError(code); },
            now: () => '2026-07-18T12:00:00.000Z',
        });
        assert.match(gitArgs[0][2], /github\.com\/my-fork\/canon-ai\.git/);
        assert.equal(npmArgs[0][3], `github:my-fork/canon-ai#${UPDATE_SHA_C}`);
        const provenance = JSON.parse(fs.readFileSync(path.join(root, '.canon', 'provenance.json'), 'utf8')) as { source: string };
        assert.equal(provenance.source, `github:my-fork/canon-ai#${UPDATE_SHA_C}`);
    }));
});

void test('canon update: a full SHA skips resolution and persists ref provenance', () => {
    withTempDir(dir => {
        const root = makeLocalUpdateRoot(dir, { devDependencies: { 'canon-ai': '^2.2.0' } });
        let gitCalls = 0;
        const npmArgs: string[][] = [];
        updateCmd(['--ref', UPDATE_SHA_A], {
            packageDir: path.join(root, 'node_modules', 'canon-ai'),
            gitRunner: () => { gitCalls++; throw new Error('SHA refs must not resolve'); },
            npmViewRunner: () => { throw new Error('ref channel must not query npm'); },
            spawnRunner: (_command, args) => { npmArgs.push(args); return { status: 0 }; },
            exit: code => { throw new UpdateExitError(code); },
            now: () => '2026-07-18T12:00:00.000Z',
        });
        assert.equal(gitCalls, 0);
        assert.equal(npmArgs[0][3], `github:tstraub89/canon-ai#${UPDATE_SHA_A}`);
        const provenance = JSON.parse(fs.readFileSync(path.join(root, '.canon', 'provenance.json'), 'utf8')) as Record<string, unknown>;
        assert.equal(provenance.channel, 'ref');
        assert.equal(provenance.resolved_sha, UPDATE_SHA_A);
        assert.equal('version' in provenance, false);
    });
});

void test('canon update: failed npm install does not write provenance', () => {
    withTempDir(dir => {
        const root = makeLocalUpdateRoot(dir, { devDependencies: { 'canon-ai': '^2.2.0' } });
        assert.throws(() => updateCmd([], {
            packageDir: path.join(root, 'node_modules', 'canon-ai'),
            gitRunner: stableUpdateGitRunner,
            npmViewRunner: stableNpmViewRunner,
            spawnRunner: () => ({ status: 17 }),
            exit: code => { throw new UpdateExitError(code); },
        }), (error: unknown) => error instanceof UpdateExitError && error.code === 17);
        assert.equal(fs.existsSync(path.join(root, '.canon', 'provenance.json')), false);
    });
});

void test('canon update: provenance write failure is reported after npm succeeds', () => {
    withTempDir(dir => {
        const root = makeLocalUpdateRoot(dir, { devDependencies: { 'canon-ai': '^2.2.0' } });
        fs.mkdirSync(path.join(root, '.canon', 'provenance.json'), { recursive: true });
        const errors: string[] = [];
        updateCmd([], {
            packageDir: path.join(root, 'node_modules', 'canon-ai'),
            gitRunner: stableUpdateGitRunner,
            npmViewRunner: stableNpmViewRunner,
            spawnRunner: () => ({ status: 0 }),
            stderr: message => errors.push(message),
            exit: code => { throw new UpdateExitError(code); },
        });
        assert.match(errors[0], /npm install succeeded, but provenance could not be recorded/);
    });
});

void test('canon update: global provenance uses an existing invoking-repo .canon only', () => {
    withTempDir(dir => {
        fs.mkdirSync(path.join(dir, '.canon'), { recursive: true });
        const output: string[] = [];
        const npmArgs: string[][] = [];
        const npmViewArgs: string[][] = [];
        updateCmd([], {
            packageDir: '/usr/local/lib/node_modules/canon-ai',
            cwd: dir,
            gitRunner: stableUpdateGitRunner,
            npmViewRunner: (args, cwd) => {
                npmViewArgs.push([cwd ?? '', ...args]);
                return stableNpmViewRunner(args);
            },
            spawnRunner: (_command, args) => { npmArgs.push(args); return { status: 0 }; },
            stdout: message => output.push(message),
            exit: code => { throw new UpdateExitError(code); },
            now: () => '2026-07-18T12:00:00.000Z',
        });
        assert.equal(fs.existsSync(path.join(dir, '.canon', 'provenance.json')), true);
        assert.match(output.join('\n'), /global install/);
        assert.deepEqual(npmArgs[0], ['install', '-g', 'canon-ai@8.2.0']);
        assert.deepEqual(npmViewArgs[0], [dir, 'view', '--global', 'canon-ai@8.2.0', 'version', '--json']);
    });

    withTempDir(dir => {
        const output: string[] = [];
        updateCmd([], {
            packageDir: '/usr/local/lib/node_modules/canon-ai',
            cwd: dir,
            gitRunner: stableUpdateGitRunner,
            npmViewRunner: stableNpmViewRunner,
            spawnRunner: () => ({ status: 0 }),
            stdout: message => output.push(message),
            exit: code => { throw new UpdateExitError(code); },
        });
        assert.equal(fs.existsSync(path.join(dir, '.canon')), false);
        assert.match(output.join('\n'), /provenance not recorded/);
    });
});

// ── CLI entrypoint dispatch ────────────────────────────────────────────────

void test('canon CLI help mentions watch', () => {
    const result = runCanonCli(['--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /canon watch <id>/);
    assert.match(result.stdout, /set <id> <field> <value>/);
    assert.match(result.stdout, /Exit codes: 0 healthy stop\/until/);
    assert.match(result.stdout, /--channel main/);
    assert.match(result.stdout, /--ref <40-hex-sha>/);
});

void test('canon watch dispatches with usage when no task id is provided', () => {
    const result = runCanonCli(['watch']);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /Usage: canon watch <task-id>/);
    assert.match(result.stdout, /state=usage reason=usage_error/);
});

// ── checkNodeVersion ─────────────────────────────────────────────────────────

void test('checkNodeVersion: current process is ≥24 → pass', () => {
    const check = checkNodeVersion();
    assert.equal(check.status, 'pass');
    assert.match(check.label, /^node v\d+/);
});

// ── parseClaudeVersion ─────────────────────────────────────────────────────

void test('parseClaudeVersion: parses "2.1.143 (Claude Code)" → { 2, 1, 143 }', () => {
    assert.deepEqual(parseClaudeVersion('2.1.143 (Claude Code)'), { major: 2, minor: 1, patch: 143 });
});

void test('parseClaudeVersion: parses "2.1.72" (no suffix) → { 2, 1, 72 }', () => {
    assert.deepEqual(parseClaudeVersion('2.1.72'), { major: 2, minor: 1, patch: 72 });
});

void test('parseClaudeVersion: returns null for "" (empty)', () => {
    assert.equal(parseClaudeVersion(''), null);
});

void test('parseClaudeVersion: returns null for "Claude Code v??" (non-semver)', () => {
    assert.equal(parseClaudeVersion('Claude Code v??'), null);
});

// ── checkClaudeVersion ──────────────────────────────────────────────────────

void test('checkClaudeVersion: pass for 2.1.143', () => {
    const check = checkClaudeVersion(() => '2.1.143 (Claude Code)');
    assert.equal(check.status, 'pass');
    assert.equal(check.label, 'claude 2.1.143');
});

void test('checkClaudeVersion: pass for 2.1.72 (exact minimum)', () => {
    const check = checkClaudeVersion(() => '2.1.72 (Claude Code)');
    assert.equal(check.status, 'pass');
    assert.equal(check.label, 'claude 2.1.72');
});

void test('checkClaudeVersion: fail for 2.1.71 (one below)', () => {
    const check = checkClaudeVersion(() => '2.1.71 (Claude Code)');
    assert.equal(check.status, 'fail');
    assert.match(check.detail ?? '', /2\.1\.72\+ required/);
});

void test('checkClaudeVersion: fail for 2.1.34 (James\'s reported version)', () => {
    const check = checkClaudeVersion(() => '2.1.34 (Claude Code)');
    assert.equal(check.status, 'fail');
    assert.match(check.label, /^claude 2\.1\.34$/);
});

void test('checkClaudeVersion: pass for 3.0.0 (future major)', () => {
    const check = checkClaudeVersion(() => '3.0.0 (Claude Code)');
    assert.equal(check.status, 'pass');
    assert.equal(check.label, 'claude 3.0.0');
});

void test('checkClaudeVersion: warn for unparseable output', () => {
    const check = checkClaudeVersion(() => 'Claude Code v??');
    assert.equal(check.status, 'warn');
    assert.match(check.detail ?? '', /verify your Claude Code install/);
});

void test('checkClaudeVersion: exports the fixed minimum version', () => {
    assert.deepEqual(MIN_CLAUDE_VERSION, { major: 2, minor: 1, patch: 72 });
});

// ── checkCanonDiscoveryNudge ───────────────────────────────────────────────

void test('checkCanonDiscoveryNudge: existing files without canon → warn and leaves files unchanged', () => {
    withTempDir(dir => {
        const claudePath = path.join(dir, 'CLAUDE.md');
        const agentsPath = path.join(dir, 'AGENTS.md');
        fs.writeFileSync(claudePath, 'Project instructions.\n');
        fs.writeFileSync(agentsPath, 'Agent instructions.\n');

        const beforeClaude = fs.readFileSync(claudePath, 'utf8');
        const beforeAgents = fs.readFileSync(agentsPath, 'utf8');

        const check = checkCanonDiscoveryNudge(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /CLAUDE\.md/);
        assert.match(check.detail ?? '', /canon/i);
        assert.match(check.detail ?? '', /This project uses canon/);
        assert.doesNotMatch(check.detail ?? '', /built-in `\/init`/);

        assert.equal(fs.readFileSync(claudePath, 'utf8'), beforeClaude);
        assert.equal(fs.readFileSync(agentsPath, 'utf8'), beforeAgents);
    });
});

void test('checkCanonDiscoveryNudge: either file mentioning canon → pass', () => {
    withTempDir(dir => {
        fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'Project instructions.\n');
        fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'This repo uses canon for task orchestration.\n');
        assert.equal(checkCanonDiscoveryNudge(dir).status, 'pass');
    });
});

void test('doctor canon setup: absent AGENTS.md and CLAUDE.md warn with init nudge, not fail', () => {
    withTempDir(dir => {
        const check = checkCanonDiscoveryNudge(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /built-in `\/init`/);
        assert.match(check.detail ?? '', /high-level project overview/);
        assert.doesNotMatch(check.detail ?? '', /add this to CLAUDE\.md/);
        // The nudge text is printed inline (no dangling "below" pointing at nothing).
        assert.match(check.detail ?? '', /This project uses canon/);
    });
});

void test('checkCodexMdDeprecated: missing file → null', () => {
    withTempDir(dir => {
        assert.equal(checkCodexMdDeprecated(dir), null);
    });
});

void test('checkCodexMdDeprecated: present file → warn', () => {
    withTempDir(dir => {
        fs.writeFileSync(path.join(dir, 'CODEX.md'), '# title\nbody\n');
        const check = checkCodexMdDeprecated(dir);
        assert.ok(check);
        assert.equal(check.status, 'warn');
        assert.equal(check.label, 'CODEX.md');
        assert.match(check.detail ?? '', /deprecated/);
    });
});

// ── checkTemplates ───────────────────────────────────────────────────────────

void test('checkTemplates: missing .canon/templates/ → fail', () => {
    withTempDir(dir => {
        const check = checkTemplates(dir);
        assert.equal(check.status, 'fail');
        assert.match(check.detail ?? '', /canon init/);
    });
});

void test('checkTemplates: all expected templates present → pass', () => {
    withTempDir(dir => {
        const templatesDir = path.join(dir, '.canon', 'templates');
        fs.mkdirSync(templatesDir, { recursive: true });
        for (const f of EXPECTED_TEMPLATES) {
            fs.writeFileSync(path.join(templatesDir, f), '');
        }
        assert.equal(checkTemplates(dir).status, 'pass');
    });
});

void test('checkTemplates: missing pr-body.md → warn with file list', () => {
    withTempDir(dir => {
        const templatesDir = path.join(dir, '.canon', 'templates');
        fs.mkdirSync(templatesDir, { recursive: true });
        for (const f of EXPECTED_TEMPLATES) {
            if (f === 'pr-body.md') continue;
            fs.writeFileSync(path.join(templatesDir, f), '');
        }
        const check = checkTemplates(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /pr-body\.md/);
    });
});

void test('EXPECTED_TEMPLATES covers every canon-owned .canon/templates entry', () => {
    const canonOwnedTemplates = CANON_OWNED
        .filter(entry => entry.startsWith('.canon/templates/'))
        .map(entry => path.basename(entry));

    for (const template of canonOwnedTemplates) {
        assert.ok(
            EXPECTED_TEMPLATES.includes(template),
            `${template} missing from EXPECTED_TEMPLATES`,
        );
    }

    assert.ok(EXPECTED_TEMPLATES.includes('pr-body.md'));
});

// ── checkSkills ──────────────────────────────────────────────────────────────

void test('checkSkills: all seven skills present → pass', () => {
    withTempDir(dir => {
        for (const skill of ['canon-init', 'canon-spec', 'canon-pipeline', 'canon-status', 'canon-changelog', 'canon-spec-review', 'canon-inline-review']) {
            const skillDir = path.join(dir, '.claude', 'skills', skill);
            fs.mkdirSync(skillDir, { recursive: true });
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '');
        }
        assert.equal(checkSkills(dir).status, 'pass');
    });
});

void test('checkSkills: canon-init missing → warn, mentions canon-init', () => {
    withTempDir(dir => {
        const check = checkSkills(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /canon-init/);
    });
});

void test('checkSkills: canon-init present but all operational skills missing → warn with names', () => {
    withTempDir(dir => {
        const initDir = path.join(dir, '.claude', 'skills', 'canon-init');
        fs.mkdirSync(initDir, { recursive: true });
        fs.writeFileSync(path.join(initDir, 'SKILL.md'), '');
        const check = checkSkills(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /canon-spec/);
        assert.match(check.detail ?? '', /canon-pipeline/);
        assert.match(check.detail ?? '', /canon-status/);
        assert.match(check.detail ?? '', /canon-changelog/);
        assert.match(check.detail ?? '', /canon-inline-review/);
    });
});

void test('checkSkills: canon-changelog specifically checked — missing canon-changelog warns even with others present', () => {
    withTempDir(dir => {
        for (const skill of ['canon-init', 'canon-spec', 'canon-pipeline', 'canon-status']) {
            const skillDir = path.join(dir, '.claude', 'skills', skill);
            fs.mkdirSync(skillDir, { recursive: true });
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '');
        }
        const check = checkSkills(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /canon-changelog/);
    });
});

// ── checkQualityLog ──────────────────────────────────────────────────────────

void test('checkQualityLog: missing file with existing docs/ → pass', () => {
    withTempDir(dir => {
        fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
        assert.equal(checkQualityLog(dir).status, 'pass');
    });
});

void test('checkQualityLog: missing docs/ directory → warn instead of false pass', () => {
    withTempDir(dir => {
        const check = checkQualityLog(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /parent directory/);
        assert.match(check.detail ?? '', /does not exist/);
    });
});

void test('checkQualityLog: well-formed log table → pass', () => {
    withTempDir(dir => {
        const docsDir = path.join(dir, 'docs');
        fs.mkdirSync(docsDir, { recursive: true });
        fs.copyFileSync(
            path.join(WORKTREE_ROOT, 'docs', 'task-quality-log.md'),
            path.join(docsDir, 'task-quality-log.md'),
        );
        assert.equal(checkQualityLog(dir).status, 'pass');
    });
});

void test('checkQualityLog: malformed header → warn with file and reference shape', () => {
    withTempDir(dir => {
        const docsDir = path.join(dir, 'docs');
        fs.mkdirSync(docsDir, { recursive: true });
        const source = fs.readFileSync(path.join(WORKTREE_ROOT, 'docs', 'task-quality-log.md'), 'utf8');
        const malformed = source.replace(' | Notes |', ' | Missing notes |');
        fs.writeFileSync(path.join(docsDir, 'task-quality-log.md'), malformed);

        const check = checkQualityLog(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /docs[\\/]task-quality-log\.md/);
        // The reference shape must be the required columns themselves, not a
        // `templates/docs/...` path — that path exists only in canon-ai's own
        // repo, so an adopter reading this warning would be sent nowhere.
        for (const header of CANON_LOG_HEADERS) {
            assert.match(check.detail ?? '', new RegExp(header.replace('?', '\\?')));
        }
        assert.doesNotMatch(check.detail ?? '', /templates[\\/]docs/);
        assert.match(check.detail ?? '', /unique/);
    });
});

// `locateLogTable` rejects a duplicate header cell even when every required
// column is present, so the warning has to name uniqueness as its own
// requirement — listing the required columns alone would describe a table
// that still fails the check.
void test('checkQualityLog: duplicate header cell with all required columns present → warn naming uniqueness', () => {
    withTempDir(dir => {
        const docsDir = path.join(dir, 'docs');
        fs.mkdirSync(docsDir, { recursive: true });
        const source = fs.readFileSync(path.join(WORKTREE_ROOT, 'docs', 'task-quality-log.md'), 'utf8');
        // Append a duplicate of an existing required column; all of
        // CANON_LOG_HEADERS remain present.
        const duplicated = source.replace(' | Notes |', ' | Notes | Notes |');
        fs.writeFileSync(path.join(docsDir, 'task-quality-log.md'), duplicated);

        const check = checkQualityLog(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /unique/);
    });
});

void test('checkQualityLog: unreadable path → warn instead of throwing', () => {
    withTempDir(dir => {
        const docsDir = path.join(dir, 'docs');
        fs.mkdirSync(path.join(docsDir, 'task-quality-log.md'), { recursive: true });
        const check = checkQualityLog(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /could not read/);
    });
});

// ── checkCanonVersion ────────────────────────────────────────────────────────

void test('checkCanonVersion: missing .canon/version → warn', () => {
    withTempDir(dir => {
        const check = checkCanonVersion(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /canon upgrade/);
    });
});

void test('checkCanonVersion: version matches installed → pass with version in label', () => {
    withTempDir(dir => {
        fs.mkdirSync(path.join(dir, '.canon'), { recursive: true });
        const ver = process.env['CANON_VERSION'] ?? 'dev';
        fs.writeFileSync(path.join(dir, '.canon', 'version'), `${ver}\n`);
        const check = checkCanonVersion(dir);
        assert.equal(check.status, 'pass');
        assert.match(check.label, new RegExp(ver.replace('.', '\\.')));
    });
});

void test('checkCanonVersion: version mismatch → warn showing both versions', () => {
    withTempDir(dir => {
        fs.mkdirSync(path.join(dir, '.canon'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.canon', 'version'), '0.1.0\n');
        const check = checkCanonVersion(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /0\.1\.0/);
    });
});

// ── checkLocalSettingsGitignored ─────────────────────────────────────────────

void test('checkLocalSettingsGitignored: settings.local.json absent → pass', () => {
    withTempDir(dir => {
        assert.equal(checkLocalSettingsGitignored(dir).status, 'pass');
    });
});

void test('checkLocalSettingsGitignored: present and exact-matched in .gitignore → pass', () => {
    withTempDir(dir => {
        fs.writeFileSync(path.join(dir, '.gitignore'), '.claude/settings.local.json\n');
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), '{}');
        assert.equal(checkLocalSettingsGitignored(dir).status, 'pass');
    });
});

void test('checkLocalSettingsGitignored: gitignored via settings.local.json bare name → pass', () => {
    withTempDir(dir => {
        fs.writeFileSync(path.join(dir, '.gitignore'), 'settings.local.json\n');
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), '{}');
        assert.equal(checkLocalSettingsGitignored(dir).status, 'pass');
    });
});

void test('checkLocalSettingsGitignored: gitignored via .claude/ directory glob → pass', () => {
    withTempDir(dir => {
        fs.writeFileSync(path.join(dir, '.gitignore'), '.claude/\n');
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), '{}');
        assert.equal(checkLocalSettingsGitignored(dir).status, 'pass');
    });
});

void test('checkLocalSettingsGitignored: present but not in .gitignore → warn', () => {
    withTempDir(dir => {
        fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\ndist\n');
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), '{}');
        const check = checkLocalSettingsGitignored(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /\.gitignore/);
    });
});

void test('checkLocalSettingsGitignored: present with no .gitignore at all → warn', () => {
    withTempDir(dir => {
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), '{}');
        const check = checkLocalSettingsGitignored(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /no .gitignore/i);
    });
});

// ── checkRuntimeFilesGitignored ──────────────────────────────────────────────

void test('checkRuntimeFilesGitignored: all runtime patterns present → pass', () => {
    withTempDir(dir => {
        fs.writeFileSync(path.join(dir, '.gitignore'), CANON_RUNTIME_GITIGNORE_PATTERNS.join('\n') + '\n');
        const check = checkRuntimeFilesGitignored(dir);
        assert.equal(check.status, 'pass');
    });
});

void test('checkRuntimeFilesGitignored: missing .gitignore → warn', () => {
    withTempDir(dir => {
        const check = checkRuntimeFilesGitignored(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /canon upgrade/);
    });
});

void test('checkRuntimeFilesGitignored: missing pattern is named in warning', () => {
    withTempDir(dir => {
        fs.writeFileSync(path.join(dir, '.gitignore'), [
            'tasks/**/.canon-pid',
            'tasks/**/.heartbeat.json',
            '',
        ].join('\n'));
        const check = checkRuntimeFilesGitignored(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /tasks\/\*\*\/\.canon-run\.log/);
        assert.match(check.detail ?? '', /canon upgrade/);
    });
});

void test('checkRuntimeFilesGitignored: pre-3.0.0 ignore block names the new worktree pattern', () => {
    withTempDir(dir => {
        fs.writeFileSync(path.join(dir, '.gitignore'), [
            'tasks/**/.canon-pid',
            'tasks/**/.canon-run.log',
            'tasks/**/.heartbeat.json',
            'tasks/**/.pr-number',
            '',
        ].join('\n'));
        const check = checkRuntimeFilesGitignored(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /\.canon\/worktrees\//);
    });
});

// ── checkRecommendedPermissions ──────────────────────────────────────────────

function writeSettings(dir: string, obj: unknown): void {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(obj));
}

void test('checkRecommendedPermissions: settings.json absent → warn pointing to README', () => {
    withTempDir(dir => {
        const check = checkRecommendedPermissions(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /README/);
    });
});

void test('checkRecommendedPermissions: present with all recommended perms → pass', () => {
    withTempDir(dir => {
        writeSettings(dir, { permissions: { allow: [...RECOMMENDED_ALLOW] } });
        assert.equal(checkRecommendedPermissions(dir).status, 'pass');
    });
});

void test('checkRecommendedPermissions: present with extras alongside all recommended → pass', () => {
    withTempDir(dir => {
        writeSettings(dir, { permissions: { allow: [...RECOMMENDED_ALLOW, 'Bash(my-custom *)'] } });
        assert.equal(checkRecommendedPermissions(dir).status, 'pass');
    });
});

void test('checkRecommendedPermissions: present but empty allow → warn "no recommended"', () => {
    withTempDir(dir => {
        writeSettings(dir, { permissions: { allow: [] } });
        const check = checkRecommendedPermissions(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /no recommended canon perms/);
    });
});

void test('checkRecommendedPermissions: present with partial perms → warn with count and preview', () => {
    withTempDir(dir => {
        writeSettings(dir, { permissions: { allow: ['Bash(git *)', 'Bash(gh *)', 'Skill(canon-init)'] } });
        const check = checkRecommendedPermissions(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /missing \d+ recommended perm/);
    });
});

void test('checkRecommendedPermissions: malformed JSON → warn gracefully', () => {
    withTempDir(dir => {
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ not valid json');
        const check = checkRecommendedPermissions(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /not valid JSON/i);
    });
});

void test('checkRecommendedPermissions: settings.local.json carries all perms, settings.json absent → pass', () => {
    withTempDir(dir => {
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.writeFileSync(
            path.join(dir, '.claude', 'settings.local.json'),
            JSON.stringify({ permissions: { allow: [...RECOMMENDED_ALLOW] } }),
        );
        assert.equal(checkRecommendedPermissions(dir).status, 'pass');
    });
});

void test('checkRecommendedPermissions: union of committed + local covers recommended set → pass', () => {
    withTempDir(dir => {
        const half = Math.floor(RECOMMENDED_ALLOW.length / 2);
        writeSettings(dir, { permissions: { allow: RECOMMENDED_ALLOW.slice(0, half) } });
        fs.writeFileSync(
            path.join(dir, '.claude', 'settings.local.json'),
            JSON.stringify({ permissions: { allow: RECOMMENDED_ALLOW.slice(half) } }),
        );
        assert.equal(checkRecommendedPermissions(dir).status, 'pass');
    });
});

void test('checkRecommendedPermissions: malformed settings.local.json → warn pointing at local file', () => {
    withTempDir(dir => {
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), '{ not valid json');
        const check = checkRecommendedPermissions(dir);
        assert.equal(check.status, 'warn');
        assert.equal(check.label, '.claude/settings.local.json');
        assert.match(check.detail ?? '', /not valid JSON/i);
    });
});

// ── parseCodexProjectTrust ──────────────────────────────────────────────────

void test('parseCodexProjectTrust: extracts project paths and trust levels', () => {
    const config = [
        'model = "gpt-5.4-mini"',
        'sandbox_mode = "workspace-write"',
        '',
        '[projects."/Users/x/repo-a"]',
        'trust_level = "trusted"',
        '',
        '[projects."/Users/x/repo-b"]',
        'trust_level = "untrusted"',
        '',
        '[projects."/Users/x/repo-c"]',
        '# no trust_level set — should not appear in the map',
        '',
    ].join('\n');
    const result = parseCodexProjectTrust(config);
    assert.equal(result.get('/Users/x/repo-a'), 'trusted');
    assert.equal(result.get('/Users/x/repo-b'), 'untrusted');
    assert.equal(result.has('/Users/x/repo-c'), false);
});

void test('parseCodexProjectTrust: ignores trust_level outside [projects.*] blocks', () => {
    // A stray `trust_level` at the top of the file (or under some unrelated
    // table) must not be associated with a previously-seen project block.
    const config = [
        'trust_level = "trusted"',
        '',
        '[projects."/Users/x/repo-a"]',
        'trust_level = "trusted"',
        '',
        '[other]',
        'trust_level = "untrusted"',
        '',
    ].join('\n');
    const result = parseCodexProjectTrust(config);
    assert.equal(result.size, 1);
    assert.equal(result.get('/Users/x/repo-a'), 'trusted');
});

void test('parseCodexProjectTrust: empty input returns empty map', () => {
    assert.equal(parseCodexProjectTrust('').size, 0);
});

void test('parseCodexProjectTrust: accepts inline TOML comments after the value', () => {
    const config = [
        '[projects."/Users/x/repo"]',
        'trust_level = "trusted" # added manually 2026-05-19',
        '',
    ].join('\n');
    const result = parseCodexProjectTrust(config);
    assert.equal(result.get('/Users/x/repo'), 'trusted');
});

void test('parseCodexProjectTrust: accepts single-quoted TOML values', () => {
    // TOML allows both `"..."` (basic strings) and `'...'` (literal strings).
    // The codex CLI itself writes double-quoted, but operators editing the
    // config by hand may use single quotes — accept either so canon doctor
    // doesn't false-warn on a valid config.
    const config = [
        '[projects."/Users/x/repo"]',
        "trust_level = 'trusted'",
        '',
    ].join('\n');
    const result = parseCodexProjectTrust(config);
    assert.equal(result.get('/Users/x/repo'), 'trusted');
});

void test('parseCodexProjectTrust: accepts inline TOML comments on the table header', () => {
    const config = [
        '[projects."/Users/x/repo"] # trusted manually',
        'trust_level = "trusted"',
        '',
    ].join('\n');
    const result = parseCodexProjectTrust(config);
    assert.equal(result.get('/Users/x/repo'), 'trusted');
});

void test('parseCodexProjectTrust: explicit untrusted child overrides trusted parent in caller logic', () => {
    // The parser itself just records each block's declared level — the
    // "explicit-wins-over-inherited" rule lives in checkCodexProjectTrust.
    // This test pins the data the check operates on: both entries must
    // round-trip exactly so the override logic has the right inputs.
    const config = [
        '[projects."/Users/x"]',
        'trust_level = "trusted"',
        '',
        '[projects."/Users/x/repo"]',
        'trust_level = "untrusted"',
        '',
    ].join('\n');
    const result = parseCodexProjectTrust(config);
    assert.equal(result.get('/Users/x'), 'trusted');
    assert.equal(result.get('/Users/x/repo'), 'untrusted');
});

// ── scaffoldTemplates ────────────────────────────────────────────────────────

void test('scaffoldTemplates: fresh directory — all templates copied', () => {
    withTempDir(projectDir => {
        withTempDir(srcDir => {
            // Build a small fake templates tree
            const files = ['AGENTS.md', '.canon/templates/spec.md', '.claude/skills/canon-spec/SKILL.md'];
            for (const f of files) {
                const full = path.join(srcDir, f);
                fs.mkdirSync(path.dirname(full), { recursive: true });
                fs.writeFileSync(full, `content of ${f}`);
            }

            const { scaffolded, skipped } = scaffoldTemplates(projectDir, srcDir);

            assert.deepEqual(scaffolded.sort(), files.sort());
            assert.deepEqual(skipped, []);
            for (const f of files) {
                assert.ok(fs.existsSync(path.join(projectDir, f)), `${f} should exist`);
                assert.equal(
                    fs.readFileSync(path.join(projectDir, f), 'utf8'),
                    `content of ${f}`,
                );
            }
        });
    });
});

void test('init: real templates create neither CLAUDE.md nor AGENTS.md', () => {
    withTempDir(projectDir => {
        const { scaffolded, skipped } = scaffoldTemplates(projectDir, path.join(WORKTREE_ROOT, 'templates'));

        assert.equal(fs.existsSync(path.join(projectDir, 'CLAUDE.md')), false);
        assert.equal(fs.existsSync(path.join(projectDir, 'AGENTS.md')), false);
        assert.equal(scaffolded.includes('CLAUDE.md'), false);
        assert.equal(scaffolded.includes('AGENTS.md'), false);
        assert.equal(skipped.includes('CLAUDE.md'), false);
        assert.equal(skipped.includes('AGENTS.md'), false);
    });
});

void test('scaffoldTemplates: existing files skipped, new ones copied', () => {
    withTempDir(projectDir => {
        withTempDir(srcDir => {
            const existing = 'AGENTS.md';
            const newFile = 'CLAUDE.md';

            fs.writeFileSync(path.join(srcDir, existing), 'template content');
            fs.writeFileSync(path.join(srcDir, newFile), 'new template content');
            // Pre-create the existing file in project
            fs.writeFileSync(path.join(projectDir, existing), 'project content');

            const { scaffolded, skipped } = scaffoldTemplates(projectDir, srcDir);

            assert.deepEqual(scaffolded, [newFile]);
            assert.deepEqual(skipped, [existing]);
            // Existing file untouched
            assert.equal(fs.readFileSync(path.join(projectDir, existing), 'utf8'), 'project content');
            // New file copied
            assert.equal(fs.readFileSync(path.join(projectDir, newFile), 'utf8'), 'new template content');
        });
    });
});

void test('scaffoldTemplates: nested directories created automatically', () => {
    withTempDir(projectDir => {
        withTempDir(srcDir => {
            const nested = path.join('.claude', 'skills', 'spec', 'SKILL.md');
            const full = path.join(srcDir, nested);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, 'skill content');

            scaffoldTemplates(projectDir, srcDir);

            assert.ok(fs.existsSync(path.join(projectDir, nested)));
        });
    });
});

void test('init: existing agent files are detected directly and notice has no merge protocol', () => {
    withTempDir(projectDir => {
        assert.equal(hasExistingAgentFiles(projectDir), false);

        fs.writeFileSync(path.join(projectDir, 'AGENTS.md'), 'project-owned agent instructions\n');
        assert.equal(hasExistingAgentFiles(projectDir), true);

        const notice = existingAgentFilesNoticeLines().join('\n');
        assert.match(notice, /existing AGENTS\.md \/ CLAUDE\.md detected/);
        assert.match(notice, /adopter-owned/);
        assert.match(notice, /does not insert, merge, or read managed content/);
        assert.doesNotMatch(notice, /merge protocol/i);
    });
});

void test('root AGENTS.md and CLAUDE.md reflect the audience split', () => {
    const agents = fs.readFileSync(path.join(WORKTREE_ROOT, 'AGENTS.md'), 'utf8');
    assert.match(agents, /TypeScript\/Node CLI published as an npm package/);
    assert.match(agents, /scaffolds a Claude \+ Codex spec-driven pipeline into other repositories/);
    assert.match(agents, /dogfoods that same pipeline on itself/);
    assert.match(agents, /spec -> spec_review -> plan -> implement -> code_review -> qa -> human_review/);
    assert.match(agents, /npm run build/);
    assert.match(agents, /npm test/);
    assert.match(agents, /npm run lint/);
    assert.match(agents, /npm run type-check/);
    assert.match(agents, /Cross-review/);
    assert.match(agents, /Communication/);
    assert.match(agents, /`AGENTS\.md` and `CLAUDE\.md` are not part of the managed set/);
    assert.match(agents, /src\/lib\/canon-owned\.ts/);
    assert.match(agents, /docs\/release-process\.md/);
    assert.match(agents, /docs\/pipeline-orchestrator\.md/);
    assert.match(agents, /docs\/codebase-map\.md/);
    assert.doesNotMatch(agents, /Always-On Operator Norms/);
    assert.doesNotMatch(agents, /Ask before committing/);
    assert.doesNotMatch(agents, /Default to the smallest model/);
    assert.doesNotMatch(agents, /Do not intervene in full-tier `spec_review` auto-revision/);
    assert.doesNotMatch(agents, /Never self-review inline work/);

    const claude = fs.readFileSync(path.join(WORKTREE_ROOT, 'CLAUDE.md'), 'utf8');
    assert.match(claude, /^@AGENTS\.md$/m);
    assert.match(claude, /## Conversational Operator Norms/);
    assert.match(claude, /Ask before committing/);
    assert.match(claude, /Default to the smallest model/);
    assert.match(claude, /Do not intervene in full-tier `spec_review` auto-revision/);
    assert.match(claude, /Never self-review inline work/);
    assert.doesNotMatch(claude, /## Role/);
});

// ── runUpgrade ───────────────────────────────────────────────────────────────

void test('runUpgrade: CLAUDE.md and AGENTS.md ignored after DELIMITED is empty', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const tmplDir = path.join(pkgDir, 'templates');
            fs.mkdirSync(tmplDir, { recursive: true });
            fs.writeFileSync(path.join(tmplDir, 'CLAUDE.md'), `${CANON_START}\ntemplate\n${CANON_END}\n`);
            fs.writeFileSync(path.join(tmplDir, 'AGENTS.md'), `${CANON_START}\ntemplate\n${CANON_END}\n`);

            const claudeContent = '# CLAUDE\n\nProject-owned content.\n';
            const agentsContent = '# AGENTS\n\nProject-owned content.\n';
            fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'), claudeContent);
            fs.writeFileSync(path.join(projectDir, 'AGENTS.md'), agentsContent);

            // Stamp a version so version bump doesn't appear in upgraded
            const canonDir = path.join(projectDir, '.canon');
            fs.mkdirSync(canonDir, { recursive: true });
            const ver = process.env['CANON_VERSION'] ?? 'dev';
            fs.writeFileSync(path.join(canonDir, 'version'), `${ver}\n`);

            const { upgraded, skipped } = runUpgrade(projectDir, pkgDir);

            assert.equal(upgraded.includes('CLAUDE.md'), false);
            assert.equal(upgraded.includes('AGENTS.md'), false);
            assert.equal(skipped.some(s => s.includes('CLAUDE.md') || s.includes('AGENTS.md')), false);
            assert.equal(fs.readFileSync(path.join(projectDir, 'CLAUDE.md'), 'utf8'), claudeContent);
            assert.equal(fs.readFileSync(path.join(projectDir, 'AGENTS.md'), 'utf8'), agentsContent);
        });
    });
});

void test('runUpgrade: canon-owned skill file fully overwritten', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const skillRel = '.claude/skills/canon-spec/SKILL.md';
            const tmplSkill = path.join(pkgDir, 'templates', skillRel);
            fs.mkdirSync(path.dirname(tmplSkill), { recursive: true });
            fs.writeFileSync(tmplSkill, 'new skill content');

            const projectSkill = path.join(projectDir, skillRel);
            fs.mkdirSync(path.dirname(projectSkill), { recursive: true });
            fs.writeFileSync(projectSkill, 'old skill content');

            const canonDir = path.join(projectDir, '.canon');
            fs.mkdirSync(canonDir, { recursive: true });
            const ver = process.env['CANON_VERSION'] ?? 'dev';
            fs.writeFileSync(path.join(canonDir, 'version'), `${ver}\n`);
            gitInit(projectDir);
            gitAddCommit(projectDir, 'seed tracked skill');

            const { upgraded } = runUpgrade(projectDir, pkgDir);

            assert.ok(upgraded.includes(skillRel));
            assert.equal(
                fs.readFileSync(projectSkill, 'utf8'),
                'new skill content',
            );
        });
    });
});

void test('runUpgrade: canon-owned skill not in templates → skipped', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            // Empty templates dir — no skill files
            fs.mkdirSync(path.join(pkgDir, 'templates'), { recursive: true });

            const canonDir = path.join(projectDir, '.canon');
            fs.mkdirSync(canonDir, { recursive: true });
            const ver = process.env['CANON_VERSION'] ?? 'dev';
            fs.writeFileSync(path.join(canonDir, 'version'), `${ver}\n`);

            const { skipped } = runUpgrade(projectDir, pkgDir);

            assert.ok(skipped.some(s => s.includes('.claude/skills/')));
        });
    });
});

void test('runUpgrade: version bumped when .canon/version mismatches installed version', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            fs.mkdirSync(path.join(pkgDir, 'templates'), { recursive: true });

            const canonDir = path.join(projectDir, '.canon');
            fs.mkdirSync(canonDir, { recursive: true });
            fs.writeFileSync(path.join(canonDir, 'version'), '0.0.1\n');
            gitInit(projectDir);
            gitAddCommit(projectDir, 'seed tracked version');

            const { upgraded } = runUpgrade(projectDir, pkgDir);

            assert.ok(upgraded.includes('.canon/version'));
            const written = fs.readFileSync(path.join(canonDir, 'version'), 'utf8').trim();
            assert.equal(written, process.env['CANON_VERSION'] ?? 'dev');
        });
    });
});

void test('runUpgrade: version already current → not in upgraded', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            fs.mkdirSync(path.join(pkgDir, 'templates'), { recursive: true });

            const canonDir = path.join(projectDir, '.canon');
            fs.mkdirSync(canonDir, { recursive: true });
            const ver = process.env['CANON_VERSION'] ?? 'dev';
            fs.writeFileSync(path.join(canonDir, 'version'), `${ver}\n`);

            const { upgraded } = runUpgrade(projectDir, pkgDir);

            assert.ok(!upgraded.includes('.canon/version'));
        });
    });
});

void test('runUpgrade: task template (.canon/templates/spec.md) fully overwritten', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const rel = '.canon/templates/spec.md';
            const tmplPath = path.join(pkgDir, 'templates', rel);
            fs.mkdirSync(path.dirname(tmplPath), { recursive: true });
            fs.writeFileSync(tmplPath, '# new spec template');

            const projPath = path.join(projectDir, rel);
            fs.mkdirSync(path.dirname(projPath), { recursive: true });
            fs.writeFileSync(projPath, '# old spec template');

            const canonDir = path.join(projectDir, '.canon');
            const ver = process.env['CANON_VERSION'] ?? 'dev';
            fs.writeFileSync(path.join(canonDir, 'version'), `${ver}\n`);
            gitInit(projectDir);
            gitAddCommit(projectDir, 'seed tracked task template');

            const { upgraded } = runUpgrade(projectDir, pkgDir);

            assert.ok(upgraded.includes(rel));
            assert.equal(fs.readFileSync(projPath, 'utf8'), '# new spec template');
        });
    });
});

void test('runUpgrade: task template unchanged → not in upgraded', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const rel = '.canon/templates/spec.md';
            const content = '# spec template';
            const tmplPath = path.join(pkgDir, 'templates', rel);
            fs.mkdirSync(path.dirname(tmplPath), { recursive: true });
            fs.writeFileSync(tmplPath, content);

            const projPath = path.join(projectDir, rel);
            fs.mkdirSync(path.dirname(projPath), { recursive: true });
            fs.writeFileSync(projPath, content);

            const canonDir = path.join(projectDir, '.canon');
            const ver = process.env['CANON_VERSION'] ?? 'dev';
            fs.writeFileSync(path.join(canonDir, 'version'), `${ver}\n`);

            const { upgraded, unchanged } = runUpgrade(projectDir, pkgDir);

            assert.ok(!upgraded.includes(rel));
            assert.ok(unchanged.includes(rel));
        });
    });
});

// ── runUpgrade staleOverrides ───────────────────────────────────────────────

function setupTemplateUpgrade(
    projectDir: string,
    pkgDir: string,
    name: string,
    { oldContent, newContent }: { oldContent: string; newContent: string },
): string {
    const rel = `.canon/templates/${name}`;
    const tmplPath = path.join(pkgDir, 'templates', rel);
    fs.mkdirSync(path.dirname(tmplPath), { recursive: true });
    fs.writeFileSync(tmplPath, newContent);

    const projPath = path.join(projectDir, rel);
    fs.mkdirSync(path.dirname(projPath), { recursive: true });
    fs.writeFileSync(projPath, oldContent);

    writeCurrentCanonVersion(projectDir);
    return rel;
}

function captureConsoleLog(fn: () => void): string[] {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = ((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
    }) as typeof console.log;
    try {
        fn();
    } finally {
        console.log = originalLog;
    }
    return lines;
}

void test('runUpgrade staleOverrides: drift guard uses CANON_OWNED template basenames', () => {
    const expected = CANON_OWNED
        .filter(entry => entry.startsWith('.canon/templates/'))
        .map(entry => path.basename(entry));

    assert.equal(new Set(expected).size, expected.length);
    assert.ok(expected.length > 0, 'CANON_OWNED must include at least one task template');
    assert.ok(expected.includes('spec.md'));
    assert.ok(expected.includes('plan.md'));
});

void test('runUpgrade staleOverrides: differing override under default root is listed', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const rel = setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                oldContent: '# old canon spec\n',
                newContent: '# new canon spec\n',
            });

            const overrideRel = path.join('tasks', '_templates', 'spec.md');
            const overridePath = path.join(projectDir, overrideRel);
            fs.mkdirSync(path.dirname(overridePath), { recursive: true });
            fs.writeFileSync(overridePath, '# custom spec\n');
            gitInit(projectDir);
            gitAddCommit(projectDir, 'seed tracked template and override');

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.upgraded.includes(rel));
            assert.deepEqual(result.wouldUpgrade, []);
            assert.ok(result.staleOverrides.includes(overrideRel));
            assert.equal(fs.readFileSync(path.join(projectDir, rel), 'utf8'), '# new canon spec\n');
        });
    });
});

void test('runUpgrade staleOverrides: unchanged canon template does not nudge a differing override', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const rel = setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                oldContent: '# same canon spec\n',
                newContent: '# same canon spec\n',
            });

            const overrideRel = path.join('tasks', '_templates', 'spec.md');
            const overridePath = path.join(projectDir, overrideRel);
            fs.mkdirSync(path.dirname(overridePath), { recursive: true });
            fs.writeFileSync(overridePath, '# custom spec\n');

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.unchanged.includes(rel));
            assert.ok(!result.upgraded.includes(rel));
            assert.deepEqual(result.staleOverrides, []);
        });
    });
});

void test('runUpgrade staleOverrides: identical override content is suppressed', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const rel = setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                oldContent: '# old canon spec\n',
                newContent: '# new canon spec\n',
            });

            const overrideRel = path.join('tasks', '_templates', 'spec.md');
            const overridePath = path.join(projectDir, overrideRel);
            fs.mkdirSync(path.dirname(overridePath), { recursive: true });
            fs.writeFileSync(overridePath, '# new canon spec\n');
            gitInit(projectDir);
            gitAddCommit(projectDir, 'seed tracked template and override');

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.upgraded.includes(rel));
            assert.deepEqual(result.staleOverrides, []);
        });
    });
});

void test('runUpgrade staleOverrides: --check uses wouldUpgrade and does not write', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const rel = setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                oldContent: '# old canon spec\n',
                newContent: '# new canon spec\n',
            });

            const overrideRel = path.join('tasks', '_templates', 'spec.md');
            const overridePath = path.join(projectDir, overrideRel);
            fs.mkdirSync(path.dirname(overridePath), { recursive: true });
            fs.writeFileSync(overridePath, '# custom spec\n');
            gitInit(projectDir);
            gitAddCommit(projectDir, 'seed tracked template and override');

            const result = runUpgrade(projectDir, pkgDir, { check: true });

            assert.deepEqual(result.upgraded, []);
            assert.ok(result.wouldUpgrade.includes(rel));
            assert.ok(result.staleOverrides.includes(overrideRel));
            assert.equal(fs.readFileSync(path.join(projectDir, rel), 'utf8'), '# old canon spec\n');
        });
    });
});

void test('runUpgrade staleOverrides: dirty-refusal keeps nudge empty when the template itself is dirty', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            gitInit(projectDir);

            const rel = setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                oldContent: '# tracked canon spec\n',
                newContent: '# new canon spec\n',
            });

            const overrideRel = path.join('tasks', '_templates', 'spec.md');
            const overridePath = path.join(projectDir, overrideRel);
            fs.mkdirSync(path.dirname(overridePath), { recursive: true });
            fs.writeFileSync(overridePath, '# custom spec\n');

            gitAddCommit(projectDir, 'seed tracked template');
            fs.writeFileSync(path.join(projectDir, rel), '# dirty local spec\n');

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.dirtyRefused.includes(rel));
            assert.deepEqual(result.staleOverrides, []);
            assert.equal(fs.readFileSync(path.join(projectDir, rel), 'utf8'), '# dirty local spec\n');
        });
    });
});

void test('runUpgrade staleOverrides: mixed dirty-refusal keeps nudge empty even when a clean template would have changed', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            gitInit(projectDir);

            const cleanRel = setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                oldContent: '# tracked canon spec\n',
                newContent: '# new canon spec\n',
            });
            const dirtyRel = setupTemplateUpgrade(projectDir, pkgDir, 'plan.md', {
                oldContent: '# tracked canon plan\n',
                newContent: '# new canon plan\n',
            });

            const overrideRel = path.join('tasks', '_templates', 'spec.md');
            const overridePath = path.join(projectDir, overrideRel);
            fs.mkdirSync(path.dirname(overridePath), { recursive: true });
            fs.writeFileSync(overridePath, '# custom spec\n');

            gitAddCommit(projectDir, 'seed tracked templates');
            fs.writeFileSync(path.join(projectDir, dirtyRel), '# dirty local plan\n');

            const result = runUpgrade(projectDir, pkgDir);

            assert.deepEqual(result.upgraded, []);
            assert.deepEqual(result.wouldUpgrade, []);
            assert.ok(result.dirtyRefused.includes(dirtyRel));
            assert.ok(!result.dirtyRefused.includes(cleanRel));
            assert.deepEqual(result.staleOverrides, []);
        });
    });
});

void test('runUpgrade staleOverrides: --force lists a stale override for a dirty canon template that was written', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            gitInit(projectDir);

            const rel = setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                oldContent: '# tracked canon spec\n',
                newContent: '# force-written canon spec\n',
            });

            const overrideRel = path.join('tasks', '_templates', 'spec.md');
            const overridePath = path.join(projectDir, overrideRel);
            fs.mkdirSync(path.dirname(overridePath), { recursive: true });
            fs.writeFileSync(overridePath, '# custom spec\n');

            gitAddCommit(projectDir, 'seed tracked template');
            fs.writeFileSync(path.join(projectDir, rel), '# dirty local spec\n');

            const result = runUpgrade(projectDir, pkgDir, { force: true });

            assert.ok(result.upgraded.includes(rel));
            assert.ok(result.staleOverrides.includes(overrideRel));
            assert.equal(fs.readFileSync(path.join(projectDir, rel), 'utf8'), '# force-written canon spec\n');
        });
    });
});

void test('runUpgrade staleOverrides: empty when override root is absent', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const rel = setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                oldContent: '# old canon spec\n',
                newContent: '# new canon spec\n',
            });
            gitInit(projectDir);
            gitAddCommit(projectDir, 'seed tracked template');

            const result = runUpgrade(projectDir, pkgDir);
            assert.ok(result.upgraded.includes(rel));
            assert.deepEqual(result.staleOverrides, []);
        });
    });
});

void test('runUpgrade staleOverrides: stray files under the override root are ignored', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const rel = setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                oldContent: '# old canon spec\n',
                newContent: '# new canon spec\n',
            });

            const strayRoot = path.join(projectDir, 'tasks', '_templates');
            fs.mkdirSync(strayRoot, { recursive: true });
            fs.writeFileSync(path.join(strayRoot, 'random.txt'), 'not a template');
            gitInit(projectDir);
            gitAddCommit(projectDir, 'seed tracked template and override root');

            const result = runUpgrade(projectDir, pkgDir);
            assert.ok(result.upgraded.includes(rel));
            assert.deepEqual(result.staleOverrides, []);
        });
    });
});

void test('runUpgrade staleOverrides: honors CANON_TASKS_DIR_OVERRIDE and ignores the default root', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const prev = process.env.CANON_TASKS_DIR_OVERRIDE;
            try {
                const rel = setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                    oldContent: '# old canon spec\n',
                    newContent: '# new canon spec\n',
                });

                const customTasksRoot = path.join(projectDir, 'custom-tasks');
                const customOverrideRel = path.join('custom-tasks', '_templates', 'spec.md');
                const customOverridePath = path.join(projectDir, customOverrideRel);
                fs.mkdirSync(path.dirname(customOverridePath), { recursive: true });
                fs.writeFileSync(customOverridePath, '# custom spec\n');

                const defaultOverrideRel = path.join('tasks', '_templates', 'spec.md');
                const defaultOverridePath = path.join(projectDir, defaultOverrideRel);
                fs.mkdirSync(path.dirname(defaultOverridePath), { recursive: true });
                fs.writeFileSync(defaultOverridePath, '# default root spec\n');
                gitInit(projectDir);
                gitAddCommit(projectDir, 'seed tracked template and overrides');

                process.env.CANON_TASKS_DIR_OVERRIDE = customTasksRoot;

                const result = runUpgrade(projectDir, pkgDir);

                assert.ok(result.upgraded.includes(rel));
                assert.ok(result.staleOverrides.includes(customOverrideRel));
                assert.ok(!result.staleOverrides.includes(defaultOverrideRel));
            } finally {
                if (prev === undefined) delete process.env.CANON_TASKS_DIR_OVERRIDE;
                else process.env.CANON_TASKS_DIR_OVERRIDE = prev;
            }
        });
    });
});

void test('printStaleOverrideNudge: emits the override reminder and is empty for no overrides', () => {
    const overrideRel = path.join('tasks', '_templates', 'spec.md');
    const lines = captureConsoleLog(() => {
        printStaleOverrideNudge([overrideRel], false);
    });
    assert.equal(lines[0], 'Heads-up: canon templates changed by this upgrade have customized task-template overrides that were not auto-updated:');
    assert.ok(lines.some(line => line.includes('NOT updated automatically')));
    assert.ok(lines.some(line => line.includes(overrideRel)));
    assert.ok(lines.some(line => line.includes('diff .canon/templates/spec.md tasks/_templates/spec.md')));

    const dryRunLines = captureConsoleLog(() => {
        printStaleOverrideNudge([overrideRel], true);
    });
    assert.equal(dryRunLines[0], 'Heads-up: canon templates that would be changed by this upgrade have customized task-template overrides that would not be auto-updated:');
    assert.ok(dryRunLines.some(line => line.includes(overrideRel)));

    const emptyLines = captureConsoleLog(() => {
        printStaleOverrideNudge([], false);
    });
    assert.deepEqual(emptyLines, []);
});

// ── runUpgrade .gitignore block sync ─────────────────────────────────────────

function writeCurrentCanonVersion(projectDir: string): void {
    const canonDir = path.join(projectDir, '.canon');
    fs.mkdirSync(canonDir, { recursive: true });
    const ver = process.env['CANON_VERSION'] ?? 'dev';
    fs.writeFileSync(path.join(canonDir, 'version'), `${ver}\n`);
}

void test('runUpgrade: .gitignore without canon block receives the block via pending queue', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            fs.mkdirSync(path.join(pkgDir, 'templates'), { recursive: true });
            writeCurrentCanonVersion(projectDir);
            const existing = 'node_modules\n.env\n';
            fs.writeFileSync(path.join(projectDir, '.gitignore'), existing);
            gitInit(projectDir);
            gitAddCommit(projectDir, 'seed tracked gitignore');

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.upgraded.includes('.gitignore'));
            const written = fs.readFileSync(path.join(projectDir, '.gitignore'), 'utf8');
            assert.equal(written, `${existing}\n${CANON_GITIGNORE_BLOCK}`);
        });
    });
});

void test('runUpgrade: current .gitignore block is unchanged', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            fs.mkdirSync(path.join(pkgDir, 'templates'), { recursive: true });
            writeCurrentCanonVersion(projectDir);
            fs.writeFileSync(path.join(projectDir, '.gitignore'), CANON_GITIGNORE_BLOCK);

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.unchanged.includes('.gitignore'));
            assert.ok(!result.upgraded.includes('.gitignore'));
        });
    });
});

void test('runUpgrade: dirty .gitignore is refused without --force and not written', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            gitInit(projectDir);
            fs.mkdirSync(path.join(pkgDir, 'templates'), { recursive: true });
            writeCurrentCanonVersion(projectDir);
            const committed = 'node_modules\n';
            fs.writeFileSync(path.join(projectDir, '.gitignore'), committed);
            gitAddCommit(projectDir, 'initial commit');
            const localEdit = 'node_modules\n.env\n';
            fs.writeFileSync(path.join(projectDir, '.gitignore'), localEdit);

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.dirtyRefused.includes('.gitignore'));
            assert.deepEqual(result.upgraded, []);
            assert.equal(fs.readFileSync(path.join(projectDir, '.gitignore'), 'utf8'), localEdit);
        });
    });
});

void test('runUpgrade --check: .gitignore reports wouldUpgrade without writing', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            fs.mkdirSync(path.join(pkgDir, 'templates'), { recursive: true });
            writeCurrentCanonVersion(projectDir);
            const existing = 'node_modules\n';
            fs.writeFileSync(path.join(projectDir, '.gitignore'), existing);
            gitInit(projectDir);
            gitAddCommit(projectDir, 'seed tracked gitignore');

            const result = runUpgrade(projectDir, pkgDir, { check: true });

            assert.ok(result.wouldUpgrade.includes('.gitignore'));
            assert.deepEqual(result.upgraded, []);
            assert.equal(fs.readFileSync(path.join(projectDir, '.gitignore'), 'utf8'), existing);
        });
    });
});

void test('runUpgrade: malformed .gitignore is reported and --force does not override', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            fs.mkdirSync(path.join(pkgDir, 'templates'), { recursive: true });
            writeCurrentCanonVersion(projectDir);
            const malformed = 'node_modules\n# canon:start\nstill open\n';
            fs.writeFileSync(path.join(projectDir, '.gitignore'), malformed);

            const result = runUpgrade(projectDir, pkgDir);
            assert.ok(result.malformed.includes('.gitignore'));
            assert.ok(!result.upgraded.includes('.gitignore'));
            assert.equal(fs.readFileSync(path.join(projectDir, '.gitignore'), 'utf8'), malformed);

            const forced = runUpgrade(projectDir, pkgDir, { force: true });
            assert.ok(forced.malformed.includes('.gitignore'));
            assert.ok(!forced.upgraded.includes('.gitignore'));
            assert.equal(fs.readFileSync(path.join(projectDir, '.gitignore'), 'utf8'), malformed);
        });
    });
});

void test('runUpgrade: pre-split docs-refs checker scaffolds config and overwrites checker + .d.ts with a warning', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const templatesDir = path.join(pkgDir, 'templates');
            fs.mkdirSync(path.join(templatesDir, 'scripts'), { recursive: true });
            fs.writeFileSync(
                path.join(templatesDir, 'scripts', 'docs-refs-check.mjs'),
                [
                    'export const checkerVersion = 2;',
                    '',
                ].join('\n'),
            );
            // The .d.ts must move in lockstep with the checker: the original bug
            // was that the deferral upgraded the .d.ts while holding back the
            // .mjs, leaving the declaration describing a non-existent API.
            fs.writeFileSync(
                path.join(templatesDir, 'scripts', 'docs-refs-check.mjs.d.ts'),
                'export const checkerVersion: 2;\n',
            );
            fs.writeFileSync(
                path.join(templatesDir, 'scripts', 'docs-refs-config.mjs'),
                [
                    '// scaffolded config',
                    'export const noisySourcePaths = [];',
                    "export const validDirs = ['templates'];",
                    "export const markdownRootDirs = ['templates'];",
                    '',
                ].join('\n'),
            );

            const projectScriptsDir = path.join(projectDir, 'scripts');
            fs.mkdirSync(projectScriptsDir, { recursive: true });
            fs.writeFileSync(
                path.join(projectScriptsDir, 'docs-refs-check.mjs'),
                [
                    'export const checkerVersion = 1;',
                    '',
                ].join('\n'),
            );
            fs.writeFileSync(
                path.join(projectScriptsDir, 'docs-refs-check.mjs.d.ts'),
                'export const checkerVersion: 1;\n',
            );

            writeCurrentCanonVersion(projectDir);
            gitInit(projectDir);
            gitAddCommit(projectDir, 'seed tracked docs refs checker');

            const result = runUpgrade(projectDir, pkgDir);

            assert.deepEqual(result.cutoverWarnings, ['scripts/docs-refs-check.mjs']);
            assert.ok(result.upgraded.includes('scripts/docs-refs-config.mjs'));
            assert.ok(result.upgraded.includes('scripts/docs-refs-check.mjs'));
            assert.ok(result.upgraded.includes('scripts/docs-refs-check.mjs.d.ts'));
            // Checker overwritten in one shot (no deferral).
            assert.equal(
                fs.readFileSync(path.join(projectScriptsDir, 'docs-refs-check.mjs'), 'utf8'),
                'export const checkerVersion = 2;\n',
            );
            // .d.ts upgraded in the SAME run — no desync with the .mjs.
            assert.equal(
                fs.readFileSync(path.join(projectScriptsDir, 'docs-refs-check.mjs.d.ts'), 'utf8'),
                'export const checkerVersion: 2;\n',
            );
            assert.equal(
                fs.readFileSync(path.join(projectScriptsDir, 'docs-refs-config.mjs'), 'utf8'),
                [
                    '// scaffolded config',
                    'export const noisySourcePaths = [];',
                    "export const validDirs = ['templates'];",
                    "export const markdownRootDirs = ['templates'];",
                    '',
                ].join('\n'),
            );
        });
    });
});

void test('runUpgrade: new docs-refs checker with missing config scaffolds config but does not defer', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const templatesDir = path.join(pkgDir, 'templates');
            fs.mkdirSync(path.join(templatesDir, 'scripts'), { recursive: true });
            fs.writeFileSync(
                path.join(templatesDir, 'scripts', 'docs-refs-check.mjs'),
                [
                    "import './docs-refs-config.mjs';",
                    'export const checkerVersion = 2;',
                    '',
                ].join('\n'),
            );
            fs.writeFileSync(
                path.join(templatesDir, 'scripts', 'docs-refs-config.mjs'),
                [
                    '// scaffolded config',
                    'export const noisySourcePaths = [];',
                    "export const validDirs = ['templates'];",
                    "export const markdownRootDirs = ['templates'];",
                    '',
                ].join('\n'),
            );

            const projectScriptsDir = path.join(projectDir, 'scripts');
            fs.mkdirSync(projectScriptsDir, { recursive: true });
            fs.writeFileSync(
                path.join(projectScriptsDir, 'docs-refs-check.mjs'),
                [
                    "import './docs-refs-config.mjs';",
                    'export const checkerVersion = 1;',
                    '',
                ].join('\n'),
            );

            writeCurrentCanonVersion(projectDir);
            gitInit(projectDir);
            gitAddCommit(projectDir, 'seed tracked docs refs checker');

            const result = runUpgrade(projectDir, pkgDir);

            assert.deepEqual(result.cutoverWarnings, []);
            assert.ok(result.upgraded.includes('scripts/docs-refs-config.mjs'));
            assert.ok(result.upgraded.includes('scripts/docs-refs-check.mjs'));
            assert.equal(
                fs.readFileSync(path.join(projectScriptsDir, 'docs-refs-config.mjs'), 'utf8'),
                [
                    '// scaffolded config',
                    'export const noisySourcePaths = [];',
                    "export const validDirs = ['templates'];",
                    "export const markdownRootDirs = ['templates'];",
                    '',
                ].join('\n'),
            );
            assert.equal(
                fs.readFileSync(path.join(projectScriptsDir, 'docs-refs-check.mjs'), 'utf8'),
                [
                    "import './docs-refs-config.mjs';",
                    'export const checkerVersion = 2;',
                    '',
                ].join('\n'),
            );
        });
    });
});

void test('runUpgrade: pre-split checker with config already present is overwritten WITH a warning (interrupted-upgrade recovery)', () => {
    // Codex P2 regression: the warning must not be gated on config-absence. A
    // repo can carry an OLD inline checker alongside an already-scaffolded
    // config (interrupted prior upgrade / manual scaffold). That adopter still
    // has inline customizations trapped in the checker, so replacing it must
    // emit the migration heads-up even though the config file already exists.
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const templatesDir = path.join(pkgDir, 'templates');
            fs.mkdirSync(path.join(templatesDir, 'scripts'), { recursive: true });
            fs.writeFileSync(
                path.join(templatesDir, 'scripts', 'docs-refs-check.mjs'),
                [
                    "import './docs-refs-config.mjs';",
                    'export const checkerVersion = 2;',
                    '',
                ].join('\n'),
            );
            fs.writeFileSync(
                path.join(templatesDir, 'scripts', 'docs-refs-config.mjs'),
                [
                    '// scaffolded config',
                    'export const noisySourcePaths = [];',
                    "export const validDirs = ['templates'];",
                    "export const markdownRootDirs = ['templates'];",
                    '',
                ].join('\n'),
            );

            const projectScriptsDir = path.join(projectDir, 'scripts');
            fs.mkdirSync(projectScriptsDir, { recursive: true });
            // Old inline checker — does NOT import the config.
            fs.writeFileSync(
                path.join(projectScriptsDir, 'docs-refs-check.mjs'),
                [
                    'export const checkerVersion = 1;',
                    '',
                ].join('\n'),
            );
            // Config already present (e.g. left behind by an interrupted upgrade).
            const existingConfig = [
                '// scaffolded config',
                'export const noisySourcePaths = [];',
                "export const validDirs = ['templates'];",
                "export const markdownRootDirs = ['templates'];",
                '',
            ].join('\n');
            fs.writeFileSync(path.join(projectScriptsDir, 'docs-refs-config.mjs'), existingConfig);

            writeCurrentCanonVersion(projectDir);
            gitInit(projectDir);
            gitAddCommit(projectDir, 'seed tracked docs refs checker and config');

            const result = runUpgrade(projectDir, pkgDir);

            // Warning fires even though config already exists.
            assert.deepEqual(result.cutoverWarnings, ['scripts/docs-refs-check.mjs']);
            // Checker overwritten; config NOT re-scaffolded (already present, adopter-owned).
            assert.ok(result.upgraded.includes('scripts/docs-refs-check.mjs'));
            assert.ok(!result.upgraded.includes('scripts/docs-refs-config.mjs'));
            assert.equal(
                fs.readFileSync(path.join(projectScriptsDir, 'docs-refs-check.mjs'), 'utf8'),
                [
                    "import './docs-refs-config.mjs';",
                    'export const checkerVersion = 2;',
                    '',
                ].join('\n'),
            );
            // Existing config left untouched.
            assert.equal(fs.readFileSync(path.join(projectScriptsDir, 'docs-refs-config.mjs'), 'utf8'), existingConfig);
        });
    });
});

void test('runUpgrade: new docs-refs checker with config present upgrades normally and does not scaffold', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const templatesDir = path.join(pkgDir, 'templates');
            fs.mkdirSync(path.join(templatesDir, 'scripts'), { recursive: true });
            fs.writeFileSync(
                path.join(templatesDir, 'scripts', 'docs-refs-check.mjs'),
                [
                    "import './docs-refs-config.mjs';",
                    'export const checkerVersion = 2;',
                    '',
                ].join('\n'),
            );
            fs.writeFileSync(
                path.join(templatesDir, 'scripts', 'docs-refs-config.mjs'),
                [
                    '// scaffolded config',
                    'export const noisySourcePaths = [];',
                    "export const validDirs = ['templates'];",
                    "export const markdownRootDirs = ['templates'];",
                    '',
                ].join('\n'),
            );

            const projectScriptsDir = path.join(projectDir, 'scripts');
            fs.mkdirSync(projectScriptsDir, { recursive: true });
            fs.writeFileSync(
                path.join(projectScriptsDir, 'docs-refs-check.mjs'),
                [
                    "import './docs-refs-config.mjs';",
                    'export const checkerVersion = 1;',
                    '',
                ].join('\n'),
            );
            fs.writeFileSync(
                path.join(projectScriptsDir, 'docs-refs-config.mjs'),
                [
                    '// scaffolded config',
                    'export const noisySourcePaths = [];',
                    "export const validDirs = ['templates'];",
                    "export const markdownRootDirs = ['templates'];",
                    '',
                ].join('\n'),
            );

            writeCurrentCanonVersion(projectDir);
            gitInit(projectDir);
            gitAddCommit(projectDir, 'seed tracked docs refs checker and config');

            const result = runUpgrade(projectDir, pkgDir);

            assert.deepEqual(result.cutoverWarnings, []);
            assert.ok(!result.upgraded.includes('scripts/docs-refs-config.mjs'));
            assert.ok(result.upgraded.includes('scripts/docs-refs-check.mjs'));
            assert.equal(
                fs.readFileSync(path.join(projectScriptsDir, 'docs-refs-check.mjs'), 'utf8'),
                [
                    "import './docs-refs-config.mjs';",
                    'export const checkerVersion = 2;',
                    '',
                ].join('\n'),
            );
        });
    });
});

void test('runUpgrade --check: cutover plans config scaffold without writing', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const templatesDir = path.join(pkgDir, 'templates');
            fs.mkdirSync(path.join(templatesDir, 'scripts'), { recursive: true });
            const configContent = [
                '// scaffolded config',
                'export const noisySourcePaths = [];',
                "export const validDirs = ['templates'];",
                "export const markdownRootDirs = ['templates'];",
                '',
            ].join('\n');
            fs.writeFileSync(
                path.join(templatesDir, 'scripts', 'docs-refs-check.mjs'),
                [
                    'export const checkerVersion = 2;',
                    '',
                ].join('\n'),
            );
            fs.writeFileSync(path.join(templatesDir, 'scripts', 'docs-refs-config.mjs'), configContent);

            const projectScriptsDir = path.join(projectDir, 'scripts');
            fs.mkdirSync(projectScriptsDir, { recursive: true });
            const projectCheckerContent = [
                'export const checkerVersion = 1;',
                '',
            ].join('\n');
            fs.writeFileSync(path.join(projectScriptsDir, 'docs-refs-check.mjs'), projectCheckerContent);
            writeCurrentCanonVersion(projectDir);
            gitInit(projectDir);
            gitAddCommit(projectDir, 'seed tracked docs refs checker');

            const result = runUpgrade(projectDir, pkgDir, { check: true });

            assert.deepEqual(result.cutoverWarnings, ['scripts/docs-refs-check.mjs']);
            assert.ok(result.wouldUpgrade.includes('scripts/docs-refs-config.mjs'));
            // No longer deferred — the checker is planned for overwrite too.
            assert.ok(result.wouldUpgrade.includes('scripts/docs-refs-check.mjs'));
            // --check still writes nothing.
            assert.equal(fs.readFileSync(path.join(projectScriptsDir, 'docs-refs-check.mjs'), 'utf8'), projectCheckerContent);
            assert.ok(!fs.existsSync(path.join(projectScriptsDir, 'docs-refs-config.mjs')));
        });
    });
});

void test('runUpgrade: dirty cutover scaffold is refused without --force and overwritten with --force', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const templatesDir = path.join(pkgDir, 'templates');
            fs.mkdirSync(path.join(templatesDir, 'scripts'), { recursive: true });
            const configContent = [
                '// scaffolded config',
                'export const noisySourcePaths = [];',
                "export const validDirs = ['templates'];",
                "export const markdownRootDirs = ['templates'];",
                '',
            ].join('\n');
            fs.writeFileSync(path.join(templatesDir, 'scripts', 'docs-refs-check.mjs'), 'export const checkerVersion = 2;\n');
            fs.writeFileSync(path.join(templatesDir, 'scripts', 'docs-refs-config.mjs'), configContent);

            const projectScriptsDir = path.join(projectDir, 'scripts');
            fs.mkdirSync(projectScriptsDir, { recursive: true });
            fs.writeFileSync(path.join(projectScriptsDir, 'docs-refs-check.mjs'), 'export const checkerVersion = 1;\n');
            fs.writeFileSync(path.join(projectScriptsDir, 'docs-refs-config.mjs'), 'local edits\n');
            writeCurrentCanonVersion(projectDir);
            gitInit(projectDir);
            gitAddCommit(projectDir, 'initial commit');
            fs.unlinkSync(path.join(projectScriptsDir, 'docs-refs-config.mjs'));

            const refused = runUpgrade(projectDir, pkgDir);
            assert.deepEqual(refused.cutoverWarnings, ['scripts/docs-refs-check.mjs']);
            assert.ok(refused.dirtyRefused.includes('scripts/docs-refs-config.mjs'));
            assert.deepEqual(refused.upgraded, []);
            assert.equal(fs.existsSync(path.join(projectScriptsDir, 'docs-refs-config.mjs')), false);

            const forced = runUpgrade(projectDir, pkgDir, { force: true });
            assert.deepEqual(forced.cutoverWarnings, ['scripts/docs-refs-check.mjs']);
            assert.ok(forced.upgraded.includes('scripts/docs-refs-config.mjs'));
            // No longer deferred — --force overwrites the checker in the same run.
            assert.ok(forced.upgraded.includes('scripts/docs-refs-check.mjs'));
            assert.equal(fs.readFileSync(path.join(projectScriptsDir, 'docs-refs-config.mjs'), 'utf8'), configContent);
            assert.equal(fs.readFileSync(path.join(projectScriptsDir, 'docs-refs-check.mjs'), 'utf8'), 'export const checkerVersion = 2;\n');
        });
    });
});

// ── mergeHeaderOnly (telemetry header sync) ──────────────────────────────────

void test('mergeHeaderOnly: refreshes canon header, preserves project rows byte-for-byte', () => {
    const template = [
        '# Workflow Metrics',
        '',
        '> NEW intro from updated canon template.',
        '> Tokens reframed for the next version.',
        '',
        '| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |',
        '|---|---|---|---|---|---|---|---|---|',
    ].join('\n');

    const projectRowsTail = '\n| 2026-05-01T10:00:00Z | foo | implement | codex | gpt-5.4-mini | 1 | 22s | 5234 | ok |\n| 2026-05-01T10:01:00Z | foo | code_review | claude | sonnet | 1 | 18s | 4112 | ok |\n';
    const project = [
        '# Workflow Metrics',
        '',
        '> OLD intro before the refresh.',
        '',
        '| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |',
        '|---|---|---|---|---|---|---|---|---|',
    ].join('\n') + projectRowsTail;

    const merged = mergeHeaderOnly(template, project);
    assert.ok(merged);
    assert.ok(merged.includes('NEW intro from updated canon template.'), 'new header content present');
    assert.ok(!merged.includes('OLD intro before the refresh.'), 'old header content removed');
    assert.ok(merged.endsWith(projectRowsTail), 'project rows preserved byte-for-byte (tail unchanged)');
});

void test('mergeHeaderOnly: CRLF line endings preserved byte-for-byte (Codex P2 on PR #80)', () => {
    // The separator regex must not consume `\r` from a CRLF file, or the
    // header slice would end with `\r` and the project tail would start at
    // `\n` — breaking the byte-for-byte guarantee for telemetry rows.
    const eol = '\r\n';
    const tplCrlf = [
        '# Workflow Metrics',
        '',
        '> NEW intro.',
        '',
        '| A | B |',
        '|---|---|',
    ].join(eol);
    const projectRowsTailCrlf = `${eol}| 2026-05-01T10:00:00Z | row1 |${eol}| 2026-05-01T10:01:00Z | row2 |${eol}`;
    const prjCrlf = [
        '# Workflow Metrics',
        '',
        '> OLD intro.',
        '',
        '| A | B |',
        '|---|---|',
    ].join(eol) + projectRowsTailCrlf;

    const mergedCrlf = mergeHeaderOnly(tplCrlf, prjCrlf);
    assert.ok(mergedCrlf);
    assert.ok(mergedCrlf.endsWith(projectRowsTailCrlf), 'CRLF project rows tail preserved verbatim');
    // No bare LF in the tail (would indicate spliced line endings).
    assert.ok(!/[^\r]\n/.test(mergedCrlf.slice(-100)), 'no bare LF spliced into CRLF content');
});

void test('mergeHeaderOnly: project file with no rows yet — just refreshes header', () => {
    const template = [
        '# Workflow Metrics',
        '',
        '> NEW intro.',
        '',
        '| A | B |',
        '|---|---|',
    ].join('\n');
    const project = [
        '# Workflow Metrics',
        '',
        '> OLD intro.',
        '',
        '| A | B |',
        '|---|---|',
    ].join('\n');

    const merged = mergeHeaderOnly(template, project);
    assert.ok(merged);
    assert.equal(merged, template, 'no rows on project side → result equals template');
});

void test('mergeHeaderOnly: project missing table separator → null', () => {
    const template = '# Header\n| A |\n|---|\n';
    const project = '# Header\n\n(no table at all)\n';
    assert.equal(mergeHeaderOnly(template, project), null);
});

void test('mergeHeaderOnly: template missing table separator → null', () => {
    const template = '# Header\n\nNo table here.\n';
    const project = '# Header\n| A |\n|---|\n| 1 |\n';
    assert.equal(mergeHeaderOnly(template, project), null);
});

void test('mergeHeaderOnly: identical content → result equals input (upgrade reports as unchanged)', () => {
    const content = '# Workflow Metrics\n\n> intro.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n';
    assert.equal(mergeHeaderOnly(content, content), content);
});

void test('runUpgrade: header-only sync refreshes telemetry header + preserves rows', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const rel = 'docs/pipeline-invocations.md';
            const tmplPath = path.join(pkgDir, 'templates', rel);
            fs.mkdirSync(path.dirname(tmplPath), { recursive: true });
            const newHeader = [
                '# Workflow Metrics',
                '',
                '> NEW header from this canon release.',
                '',
                '| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |',
                '|---|---|---|---|---|---|---|---|---|',
            ].join('\n');
            fs.writeFileSync(tmplPath, newHeader);

            const projectPath = path.join(projectDir, rel);
            fs.mkdirSync(path.dirname(projectPath), { recursive: true });
            const oldHeader = [
                '# Workflow Metrics',
                '',
                '> OLD header.',
                '',
                '| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |',
                '|---|---|---|---|---|---|---|---|---|',
            ].join('\n');
            const adopterRows = '\n| 2026-04-30T09:00:00Z | task-a | implement | codex | x | 1 | 12s | 9000 | ok |\n| 2026-04-30T09:01:00Z | task-a | code_review | claude | y | 1 | 8s | 5100 | ok |\n';
            fs.writeFileSync(projectPath, oldHeader + adopterRows);

            const canonDir = path.join(projectDir, '.canon');
            fs.mkdirSync(canonDir, { recursive: true });
            const ver = process.env['CANON_VERSION'] ?? 'dev';
            fs.writeFileSync(path.join(canonDir, 'version'), `${ver}\n`);
            gitInit(projectDir);
            gitAddCommit(projectDir, 'seed tracked telemetry');

            const { upgraded } = runUpgrade(projectDir, pkgDir);

            assert.ok(upgraded.includes(rel), 'telemetry file should be upgraded');
            const written = fs.readFileSync(projectPath, 'utf8');
            assert.ok(written.includes('NEW header from this canon release.'), 'new header landed');
            assert.ok(!written.includes('OLD header.'), 'old header replaced');
            assert.ok(written.endsWith(adopterRows), 'adopter rows preserved verbatim');
        });
    });
});

void test('runUpgrade: header-only sync scaffolds the file when missing in project', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const rel = 'docs/pipeline-invocations.md';
            const tmplPath = path.join(pkgDir, 'templates', rel);
            fs.mkdirSync(path.dirname(tmplPath), { recursive: true });
            const tmplContent = '# Workflow Metrics\n\n> Intro.\n\n| A | B |\n|---|---|\n';
            fs.writeFileSync(tmplPath, tmplContent);
            // Project does NOT have the file yet.
            const canonDir = path.join(projectDir, '.canon');
            fs.mkdirSync(canonDir, { recursive: true });
            const ver = process.env['CANON_VERSION'] ?? 'dev';
            fs.writeFileSync(path.join(canonDir, 'version'), `${ver}\n`);

            const { upgraded } = runUpgrade(projectDir, pkgDir);
            assert.ok(upgraded.includes(rel));
            const projectPath = path.join(projectDir, rel);
            assert.equal(fs.readFileSync(projectPath, 'utf8'), tmplContent);
        });
    });
});

void test('runUpgrade --check: header-only sync reports wouldUpgrade without writing (Codex P1 on PR #82)', () => {
    // Header-only writes used to go direct to disk, bypassing the --check
    // dry-run contract added in #79. Confirm they now route through the
    // pending queue and respect --check.
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const rel = 'docs/pipeline-invocations.md';
            const tmplPath = path.join(pkgDir, 'templates', rel);
            fs.mkdirSync(path.dirname(tmplPath), { recursive: true });
            const tmplContent = '# Metrics\n\n> NEW intro.\n\n| A | B |\n|---|---|\n';
            fs.writeFileSync(tmplPath, tmplContent);
            const projectPath = path.join(projectDir, rel);
            fs.mkdirSync(path.dirname(projectPath), { recursive: true });
            const oldContent = '# Metrics\n\n> OLD intro.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n';
            fs.writeFileSync(projectPath, oldContent);
            const canonDir = path.join(projectDir, '.canon');
            fs.mkdirSync(canonDir, { recursive: true });
            fs.writeFileSync(path.join(canonDir, 'version'), `${process.env['CANON_VERSION'] ?? 'dev'}\n`);
            gitInit(projectDir);
            gitAddCommit(projectDir, 'seed tracked telemetry');

            const result = runUpgrade(projectDir, pkgDir, { check: true });

            assert.ok(result.wouldUpgrade.includes(rel), 'header-only file in wouldUpgrade');
            assert.deepEqual(result.upgraded, [], '--check writes nothing');
            assert.equal(fs.readFileSync(projectPath, 'utf8'), oldContent, 'project file untouched');
        });
    });
});

void test('runUpgrade: dirty header-only target refused without --force (Codex P1 on PR #82)', () => {
    // Header-only writes also bypassed the dirty-refusal gate. Confirm a
    // tracked local edit to pipeline-invocations.md now refuses without --force.
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: projectDir });
            execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: projectDir });
            execFileSync('git', ['config', 'user.name', 'T'], { cwd: projectDir });

            const rel = 'docs/pipeline-invocations.md';
            const tmplPath = path.join(pkgDir, 'templates', rel);
            fs.mkdirSync(path.dirname(tmplPath), { recursive: true });
            fs.writeFileSync(tmplPath, '# Metrics\n\n> NEW.\n\n| A | B |\n|---|---|\n');
            const projectPath = path.join(projectDir, rel);
            fs.mkdirSync(path.dirname(projectPath), { recursive: true });
            const committed = '# Metrics\n\n> OLD.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n';
            fs.writeFileSync(projectPath, committed);
            const canonDir = path.join(projectDir, '.canon');
            fs.mkdirSync(canonDir, { recursive: true });
            fs.writeFileSync(path.join(canonDir, 'version'), `${process.env['CANON_VERSION'] ?? 'dev'}\n`);
            execFileSync('git', ['add', '-A'], { cwd: projectDir });
            execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: projectDir });
            // Local edit on the tracked file — dirty.
            const localEdit = committed + '| 3 | 4 |\n';
            fs.writeFileSync(projectPath, localEdit);

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.dirtyRefused.includes(rel), 'dirty header-only target refused');
            assert.deepEqual(result.upgraded, [], 'nothing written on refusal');
            assert.equal(fs.readFileSync(projectPath, 'utf8'), localEdit, 'local edit preserved');
        });
    });
});

// ── runUpgrade safety flags (--check, --force, dirty refusal) ────────────────

function gitInit(dir: string): void {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir });
}

function gitAddCommit(dir: string, message: string): void {
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
}

function setupSkillTemplate(pkgDir: string, content: string): string {
    const rel = '.claude/skills/canon-spec/SKILL.md';
    const tmplSkill = path.join(pkgDir, 'templates', rel);
    fs.mkdirSync(path.dirname(tmplSkill), { recursive: true });
    fs.writeFileSync(tmplSkill, content);
    return rel;
}

void test('parseUpgradeArgs: accepts --check, --dry-run, --force, --no-stage', () => {
    assert.deepEqual(parseUpgradeArgs([]), {});
    assert.deepEqual(parseUpgradeArgs(['--check']), { check: true });
    assert.deepEqual(parseUpgradeArgs(['--dry-run']), { check: true });
    assert.deepEqual(parseUpgradeArgs(['--force']), { force: true });
    assert.deepEqual(parseUpgradeArgs(['--no-stage']), { noStage: true });
    assert.deepEqual(parseUpgradeArgs(['--check', '--force']), { check: true, force: true });
});

void test('parseUpgradeArgs: rejects unknown flag', () => {
    assert.throws(() => parseUpgradeArgs(['--what']), /unknown flag '--what'/);
});

void test('runUpgrade --check: reports wouldUpgrade without writing', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const rel = setupSkillTemplate(pkgDir, 'NEW skill content');
            const projectSkillPath = path.join(projectDir, rel);
            fs.mkdirSync(path.dirname(projectSkillPath), { recursive: true });
            fs.writeFileSync(projectSkillPath, 'OLD skill content');
            const canonDir = path.join(projectDir, '.canon');
            fs.mkdirSync(canonDir, { recursive: true });
            const ver = process.env['CANON_VERSION'] ?? 'dev';
            fs.writeFileSync(path.join(canonDir, 'version'), `${ver}\n`);
            gitInit(projectDir);
            gitAddCommit(projectDir, 'seed tracked skill');

            const result = runUpgrade(projectDir, pkgDir, { check: true });

            assert.ok(result.wouldUpgrade.includes(rel), 'would upgrade the skill');
            assert.deepEqual(result.upgraded, [], '--check writes nothing');
            assert.equal(
                fs.readFileSync(projectSkillPath, 'utf8'),
                'OLD skill content',
                'file on disk untouched',
            );
        });
    });
});

void test('runUpgrade: dirty managed target refused without --force', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            gitInit(projectDir);
            const rel = setupSkillTemplate(pkgDir, 'NEW skill content');
            const projectSkillPath = path.join(projectDir, rel);
            fs.mkdirSync(path.dirname(projectSkillPath), { recursive: true });
            fs.writeFileSync(projectSkillPath, 'COMMITTED skill content');
            const canonDir = path.join(projectDir, '.canon');
            fs.mkdirSync(canonDir, { recursive: true });
            const ver = process.env['CANON_VERSION'] ?? 'dev';
            fs.writeFileSync(path.join(canonDir, 'version'), `${ver}\n`);
            gitAddCommit(projectDir, 'initial commit');
            // Make the managed file dirty (modified tracked).
            fs.writeFileSync(projectSkillPath, 'LOCAL EDITS in progress');

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.dirtyRefused.includes(rel), 'dirty target reported');
            assert.deepEqual(result.upgraded, [], 'nothing written when dirty refusal fires');
            assert.equal(
                fs.readFileSync(projectSkillPath, 'utf8'),
                'LOCAL EDITS in progress',
                'dirty file preserved on disk',
            );
        });
    });
});

void test('runUpgrade --force: dirty managed target is overwritten', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            gitInit(projectDir);
            const rel = setupSkillTemplate(pkgDir, 'NEW skill content');
            const projectSkillPath = path.join(projectDir, rel);
            fs.mkdirSync(path.dirname(projectSkillPath), { recursive: true });
            fs.writeFileSync(projectSkillPath, 'COMMITTED skill content');
            const canonDir = path.join(projectDir, '.canon');
            fs.mkdirSync(canonDir, { recursive: true });
            const ver = process.env['CANON_VERSION'] ?? 'dev';
            fs.writeFileSync(path.join(canonDir, 'version'), `${ver}\n`);
            gitAddCommit(projectDir, 'initial commit');
            fs.writeFileSync(projectSkillPath, 'LOCAL EDITS to discard');

            const result = runUpgrade(projectDir, pkgDir, { force: true });

            assert.ok(result.upgraded.includes(rel), 'dirty target upgraded under --force');
            assert.deepEqual(result.dirtyRefused, [], 'no refusals under --force');
            assert.equal(
                fs.readFileSync(projectSkillPath, 'utf8'),
                'NEW skill content',
                'file overwritten with template',
            );
        });
    });
});

void test('runUpgrade: locally-deleted tracked managed file is refused without --force', () => {
    // Codex P1 on PR 4 iter 1: previous gate skipped the dirty check for
    // paths that didn't exist on disk, letting `canon upgrade` silently
    // re-create files the user had intentionally deleted. The check now
    // asks git regardless of `existsSync()`, so a tracked deletion still
    // refuses.
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            gitInit(projectDir);
            const rel = setupSkillTemplate(pkgDir, 'NEW skill content');
            const projectSkillPath = path.join(projectDir, rel);
            fs.mkdirSync(path.dirname(projectSkillPath), { recursive: true });
            fs.writeFileSync(projectSkillPath, 'COMMITTED skill content');
            const canonDir = path.join(projectDir, '.canon');
            fs.mkdirSync(canonDir, { recursive: true });
            const ver = process.env['CANON_VERSION'] ?? 'dev';
            fs.writeFileSync(path.join(canonDir, 'version'), `${ver}\n`);
            gitAddCommit(projectDir, 'initial commit');
            // Operator intentionally deleted the managed file locally.
            fs.unlinkSync(projectSkillPath);

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.dirtyRefused.includes(rel), 'deletion is a dirty state — refused');
            assert.deepEqual(result.upgraded, []);
            assert.ok(!fs.existsSync(projectSkillPath), 'file not recreated on refusal');
        });
    });
});

void test('runUpgrade: staged-deleted tracked managed file is refused without --force', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            gitInit(projectDir);
            const rel = setupSkillTemplate(pkgDir, 'NEW skill content');
            const projectSkillPath = path.join(projectDir, rel);
            fs.mkdirSync(path.dirname(projectSkillPath), { recursive: true });
            fs.writeFileSync(projectSkillPath, 'COMMITTED skill content');
            writeCurrentCanonVersion(projectDir);
            gitAddCommit(projectDir, 'initial commit');
            execFileSync('git', ['rm', '-q', rel], { cwd: projectDir });

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.refusals.trackedDirty.includes(rel), 'staged deletion is tracked-dirty');
            assert.ok(result.dirtyRefused.includes(rel), 'union refusal includes staged deletion');
            assert.deepEqual(result.upgraded, []);
            assert.ok(!fs.existsSync(projectSkillPath), 'file not recreated on refusal');
        });
    });
});

void test('runUpgrade: untracked existing managed target is refused without --force', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            gitInit(projectDir);
            const rel = setupSkillTemplate(pkgDir, 'NEW skill content');
            const projectSkillPath = path.join(projectDir, rel);
            fs.mkdirSync(path.dirname(projectSkillPath), { recursive: true });
            const sentinel = 'UNTRACKED-SENTINEL-187\n';
            fs.writeFileSync(projectSkillPath, sentinel);
            const canonDir = path.join(projectDir, '.canon');
            fs.mkdirSync(canonDir, { recursive: true });
            const ver = process.env['CANON_VERSION'] ?? 'dev';
            fs.writeFileSync(path.join(canonDir, 'version'), `${ver}\n`);
            // Note: no `git add` — file is untracked.

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.refusals.untrackedExisting.includes(rel), 'untracked file refused');
            assert.ok(result.dirtyRefused.includes(rel), 'union refusal includes untracked file');
            assert.deepEqual(result.upgraded, []);
            assert.equal(fs.readFileSync(projectSkillPath, 'utf8'), sentinel);
        });
    });
});

void test('runUpgrade: existing target in non-git directory is unverifiable and refused', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const rel = setupSkillTemplate(pkgDir, 'NEW skill content');
            const projectSkillPath = path.join(projectDir, rel);
            fs.mkdirSync(path.dirname(projectSkillPath), { recursive: true });
            fs.writeFileSync(projectSkillPath, 'LOCAL NON-GIT CONTENT\n');
            writeCurrentCanonVersion(projectDir);

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.refusals.unverifiable.includes(rel), 'existing non-git target refused');
            assert.deepEqual(result.upgraded, []);
            assert.equal(fs.readFileSync(projectSkillPath, 'utf8'), 'LOCAL NON-GIT CONTENT\n');
            assert.equal(fs.existsSync(path.join(projectDir, '.gitignore')), false, 'clean pending target withheld too');
        });
    });
});

void test('runUpgrade: absent target in non-git directory still scaffolds', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const rel = setupSkillTemplate(pkgDir, 'NEW skill content');
            writeCurrentCanonVersion(projectDir);

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.upgraded.includes(rel));
            assert.deepEqual(result.dirtyRefused, []);
            assert.equal(fs.readFileSync(path.join(projectDir, rel), 'utf8'), 'NEW skill content');
        });
    });
});

void test('runUpgrade: gitignored existing managed target is refused as untracked-existing', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            gitInit(projectDir);
            const rel = setupSkillTemplate(pkgDir, 'NEW skill content');
            fs.mkdirSync(path.join(projectDir, path.dirname(rel)), { recursive: true });
            fs.writeFileSync(path.join(projectDir, '.gitignore'), `${rel}\n`);
            writeCurrentCanonVersion(projectDir);
            gitAddCommit(projectDir, 'seed ignore pattern');
            const projectSkillPath = path.join(projectDir, rel);
            fs.writeFileSync(projectSkillPath, 'IGNORED LOCAL CONTENT\n');

            const porcelain = spawnSync('git', ['status', '--porcelain', '--', rel], {
                cwd: projectDir,
                encoding: 'utf8',
            });
            assert.equal(porcelain.stdout, '', 'fixture path must be ignored, not plain untracked');

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.refusals.untrackedExisting.includes(rel));
            assert.deepEqual(result.upgraded, []);
            assert.equal(fs.readFileSync(projectSkillPath, 'utf8'), 'IGNORED LOCAL CONTENT\n');
        });
    });
});

void test('runUpgrade --force: untracked-existing and unverifiable targets are overwritten', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            gitInit(projectDir);
            const rel = setupSkillTemplate(pkgDir, 'NEW skill content');
            const projectSkillPath = path.join(projectDir, rel);
            fs.mkdirSync(path.dirname(projectSkillPath), { recursive: true });
            fs.writeFileSync(projectSkillPath, 'UNTRACKED LOCAL CONTENT\n');
            writeCurrentCanonVersion(projectDir);

            const result = runUpgrade(projectDir, pkgDir, { force: true });

            assert.ok(result.upgraded.includes(rel));
            assert.deepEqual(result.dirtyRefused, []);
            assert.deepEqual(result.refusals.untrackedExisting, []);
            assert.equal(fs.readFileSync(projectSkillPath, 'utf8'), 'NEW skill content');
        });
    });

    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const rel = setupSkillTemplate(pkgDir, 'NEW skill content');
            const projectSkillPath = path.join(projectDir, rel);
            fs.mkdirSync(path.dirname(projectSkillPath), { recursive: true });
            fs.writeFileSync(projectSkillPath, 'NON-GIT LOCAL CONTENT\n');
            writeCurrentCanonVersion(projectDir);

            const result = runUpgrade(projectDir, pkgDir, { force: true });

            assert.ok(result.upgraded.includes(rel));
            assert.deepEqual(result.dirtyRefused, []);
            assert.deepEqual(result.refusals.unverifiable, []);
            assert.equal(fs.readFileSync(projectSkillPath, 'utf8'), 'NEW skill content');
        });
    });
});

void test('runUpgrade: tracked-clean managed target overwrites without --force', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            gitInit(projectDir);
            const rel = setupSkillTemplate(pkgDir, 'NEW skill content');
            const projectSkillPath = path.join(projectDir, rel);
            fs.mkdirSync(path.dirname(projectSkillPath), { recursive: true });
            fs.writeFileSync(projectSkillPath, 'COMMITTED OLD CONTENT\n');
            writeCurrentCanonVersion(projectDir);
            gitAddCommit(projectDir, 'seed tracked clean target');

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.upgraded.includes(rel));
            assert.deepEqual(result.dirtyRefused, []);
            assert.equal(fs.readFileSync(projectSkillPath, 'utf8'), 'NEW skill content');
        });
    });
});

void test('runUpgrade: canon-identical target stays unchanged without git', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const rel = setupSkillTemplate(pkgDir, 'SAME skill content');
            const projectSkillPath = path.join(projectDir, rel);
            fs.mkdirSync(path.dirname(projectSkillPath), { recursive: true });
            fs.writeFileSync(projectSkillPath, 'SAME skill content');
            writeCurrentCanonVersion(projectDir);

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.unchanged.includes(rel));
            assert.ok(!result.dirtyRefused.includes(rel));
            assert.ok(!result.upgraded.includes(rel));
            assert.equal(fs.readFileSync(projectSkillPath, 'utf8'), 'SAME skill content');
        });
    });
});

void test('runUpgrade --check parity: classifications match real run classes', () => {
    type Case = {
        name: string;
        setup: (projectDir: string, pkgDir: string) => string;
        check: (checkResult: ReturnType<typeof runUpgrade>, realResult: ReturnType<typeof runUpgrade>, rel: string) => void;
    };

    const cases: Case[] = [
        {
            name: 'absent',
            setup(projectDir, pkgDir) {
                const rel = setupSkillTemplate(pkgDir, 'NEW skill content');
                writeCurrentCanonVersion(projectDir);
                return rel;
            },
            check(checkResult, realResult, rel) {
                assert.ok(checkResult.wouldUpgrade.includes(rel), 'absent path would write under --check');
                assert.ok(realResult.upgraded.includes(rel), 'absent path writes in real run');
            },
        },
        {
            name: 'canon-identical',
            setup(projectDir, pkgDir) {
                const rel = setupSkillTemplate(pkgDir, 'SAME skill content');
                const projectSkillPath = path.join(projectDir, rel);
                fs.mkdirSync(path.dirname(projectSkillPath), { recursive: true });
                fs.writeFileSync(projectSkillPath, 'SAME skill content');
                writeCurrentCanonVersion(projectDir);
                return rel;
            },
            check(checkResult, realResult, rel) {
                assert.ok(checkResult.unchanged.includes(rel), 'identical path unchanged under --check');
                assert.ok(realResult.unchanged.includes(rel), 'identical path unchanged in real run');
            },
        },
        {
            name: 'tracked-clean',
            setup(projectDir, pkgDir) {
                gitInit(projectDir);
                const rel = setupSkillTemplate(pkgDir, 'NEW skill content');
                const projectSkillPath = path.join(projectDir, rel);
                fs.mkdirSync(path.dirname(projectSkillPath), { recursive: true });
                fs.writeFileSync(projectSkillPath, 'COMMITTED OLD CONTENT\n');
                writeCurrentCanonVersion(projectDir);
                gitAddCommit(projectDir, 'seed tracked clean target');
                return rel;
            },
            check(checkResult, realResult, rel) {
                assert.ok(checkResult.wouldUpgrade.includes(rel), 'tracked-clean path would write under --check');
                assert.ok(realResult.upgraded.includes(rel), 'tracked-clean path writes in real run');
            },
        },
        {
            name: 'tracked-dirty',
            setup(projectDir, pkgDir) {
                gitInit(projectDir);
                const rel = setupSkillTemplate(pkgDir, 'NEW skill content');
                const projectSkillPath = path.join(projectDir, rel);
                fs.mkdirSync(path.dirname(projectSkillPath), { recursive: true });
                fs.writeFileSync(projectSkillPath, 'COMMITTED OLD CONTENT\n');
                writeCurrentCanonVersion(projectDir);
                gitAddCommit(projectDir, 'seed tracked target');
                fs.writeFileSync(projectSkillPath, 'DIRTY LOCAL CONTENT\n');
                return rel;
            },
            check(checkResult, realResult, rel) {
                assert.ok(checkResult.refusals.trackedDirty.includes(rel), 'tracked-dirty path refused under --check');
                assert.ok(realResult.refusals.trackedDirty.includes(rel), 'tracked-dirty path refused in real run');
                assert.deepEqual(realResult.upgraded, []);
            },
        },
        {
            name: 'untracked-existing',
            setup(projectDir, pkgDir) {
                gitInit(projectDir);
                const rel = setupSkillTemplate(pkgDir, 'NEW skill content');
                const projectSkillPath = path.join(projectDir, rel);
                fs.mkdirSync(path.dirname(projectSkillPath), { recursive: true });
                fs.writeFileSync(projectSkillPath, 'UNTRACKED LOCAL CONTENT\n');
                writeCurrentCanonVersion(projectDir);
                return rel;
            },
            check(checkResult, realResult, rel) {
                assert.ok(checkResult.refusals.untrackedExisting.includes(rel), 'untracked path refused under --check');
                assert.ok(realResult.refusals.untrackedExisting.includes(rel), 'untracked path refused in real run');
                assert.deepEqual(realResult.upgraded, []);
            },
        },
        {
            name: 'unverifiable',
            setup(projectDir, pkgDir) {
                const rel = setupSkillTemplate(pkgDir, 'NEW skill content');
                const projectSkillPath = path.join(projectDir, rel);
                fs.mkdirSync(path.dirname(projectSkillPath), { recursive: true });
                fs.writeFileSync(projectSkillPath, 'NON-GIT LOCAL CONTENT\n');
                writeCurrentCanonVersion(projectDir);
                return rel;
            },
            check(checkResult, realResult, rel) {
                assert.ok(checkResult.refusals.unverifiable.includes(rel), 'unverifiable path refused under --check');
                assert.ok(realResult.refusals.unverifiable.includes(rel), 'unverifiable path refused in real run');
                assert.deepEqual(realResult.upgraded, []);
            },
        },
    ];

    for (const testCase of cases) {
        withTempDir(checkProjectDir => {
            withTempDir(realProjectDir => {
                withTempDir(pkgDir => {
                    const checkRel = testCase.setup(checkProjectDir, pkgDir);
                    const realRel = testCase.setup(realProjectDir, pkgDir);
                    assert.equal(realRel, checkRel, `${testCase.name} setup returned inconsistent path`);

                    const checkResult = runUpgrade(checkProjectDir, pkgDir, { check: true });
                    const realResult = runUpgrade(realProjectDir, pkgDir);

                    testCase.check(checkResult, realResult, checkRel);
                });
            });
        });
    }
});

void test('runUpgrade: untracked refusal withholds otherwise writable targets until --force', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            gitInit(projectDir);
            const cleanRel = '.canon/templates/spec.md';
            const cleanTemplate = path.join(pkgDir, 'templates', cleanRel);
            fs.mkdirSync(path.dirname(cleanTemplate), { recursive: true });
            fs.writeFileSync(cleanTemplate, '# new spec\n');
            const cleanProject = path.join(projectDir, cleanRel);
            fs.mkdirSync(path.dirname(cleanProject), { recursive: true });
            fs.writeFileSync(cleanProject, '# old spec\n');

            const refusedRel = setupSkillTemplate(pkgDir, 'NEW skill content');
            const refusedProject = path.join(projectDir, refusedRel);
            fs.mkdirSync(path.dirname(refusedProject), { recursive: true });
            fs.writeFileSync(refusedProject, 'UNTRACKED LOCAL CONTENT\n');

            writeCurrentCanonVersion(projectDir);
            execFileSync('git', ['add', cleanRel, '.canon/version'], { cwd: projectDir });
            execFileSync('git', ['commit', '-q', '-m', 'seed tracked clean target'], { cwd: projectDir });

            const refused = runUpgrade(projectDir, pkgDir);
            assert.ok(refused.refusals.untrackedExisting.includes(refusedRel));
            assert.deepEqual(refused.upgraded, []);
            assert.equal(fs.readFileSync(cleanProject, 'utf8'), '# old spec\n');
            assert.equal(fs.readFileSync(refusedProject, 'utf8'), 'UNTRACKED LOCAL CONTENT\n');

            const forced = runUpgrade(projectDir, pkgDir, { force: true });
            assert.ok(forced.upgraded.includes(cleanRel));
            assert.ok(forced.upgraded.includes(refusedRel));
            assert.equal(fs.readFileSync(cleanProject, 'utf8'), '# new spec\n');
            assert.equal(fs.readFileSync(refusedProject, 'utf8'), 'NEW skill content');
        });
    });
});

void test('printUpgradeRefusals: emits class-specific refusal remedies', () => {
    const lines = captureConsoleLog(() => {
        printUpgradeRefusals({
            trackedDirty: ['tracked.md'],
            untrackedExisting: ['untracked.md'],
            unverifiable: ['broken.md'],
        }, 'Refused');
    }).join('\n');

    assert.match(lines, /Refused — tracked and locally modified \(commit\/stash first, or pass --force\):/);
    assert.match(lines, /tracked\.md/);
    assert.match(lines, /Refused — exists but not tracked by git \(git could not restore it after an overwrite; commit it, move it aside, or pass --force\):/);
    assert.match(lines, /untracked\.md/);
    assert.match(lines, /Refused — git state could not be verified \(git is canon upgrade's safety boundary; repair git or run inside a git repo, or pass --force\):/);
    assert.match(lines, /broken\.md/);
});

void test('upgrade source documents destination classification without old fail-open wording', () => {
    const source = fs.readFileSync(path.join(WORKTREE_ROOT, 'src', 'cli', 'commands', 'upgrade.ts'), 'utf8');
    assert.doesNotMatch(source, /don't refuse on untracked/);
    assert.doesNotMatch(source, /treat as clean/);
    assert.match(source, /tracked-dirty/);
    assert.match(source, /untracked-existing/);
    assert.match(source, /unverifiable/);
});

void test('README canon upgrade row describes untracked and unverifiable refusal classes', () => {
    const readme = fs.readFileSync(path.join(WORKTREE_ROOT, 'README.md'), 'utf8');
    const row = readme.split('\n').find(line => line.startsWith('| `canon upgrade` |'));
    assert.ok(row, 'README canon upgrade row not found');
    assert.match(row, /locally modified/);
    assert.match(row, /untracked but present/);
    assert.match(row, /git state cannot be verified/);
    assert.match(row, /--force/);
});

void test('runUpgrade: untracked docs-refs config scaffold target is refused', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            gitInit(projectDir);
            const configRel = 'scripts/docs-refs-config.mjs';
            const templatePath = path.join(pkgDir, 'templates', configRel);
            fs.mkdirSync(path.dirname(templatePath), { recursive: true });
            fs.writeFileSync(templatePath, 'export const validDirs = [\'.canon\'];\n');

            const projectConfigPath = path.join(projectDir, configRel);
            fs.mkdirSync(path.dirname(projectConfigPath), { recursive: true });
            fs.writeFileSync(projectConfigPath, 'export const validDirs = [\'custom\'];\n');
            writeCurrentCanonVersion(projectDir);

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.refusals.untrackedExisting.includes(configRel));
            assert.deepEqual(result.upgraded, []);
            assert.equal(fs.readFileSync(projectConfigPath, 'utf8'), 'export const validDirs = [\'custom\'];\n');
        });
    });
});

void test('runUpgrade: dirty-present tracked docs-refs config stays adopter-owned', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            gitInit(projectDir);
            const skillRel = setupSkillTemplate(pkgDir, 'NEW skill content');
            const projectSkillPath = path.join(projectDir, skillRel);
            fs.mkdirSync(path.dirname(projectSkillPath), { recursive: true });
            fs.writeFileSync(projectSkillPath, 'COMMITTED OLD CONTENT\n');

            const configRel = 'scripts/docs-refs-config.mjs';
            const templatePath = path.join(pkgDir, 'templates', configRel);
            fs.mkdirSync(path.dirname(templatePath), { recursive: true });
            fs.writeFileSync(templatePath, 'export const validDirs = [\'.canon\'];\n');
            const projectConfigPath = path.join(projectDir, configRel);
            fs.mkdirSync(path.dirname(projectConfigPath), { recursive: true });
            fs.writeFileSync(projectConfigPath, 'export const validDirs = [\'committed-custom\'];\n');
            writeCurrentCanonVersion(projectDir);
            gitAddCommit(projectDir, 'seed tracked skill and config');
            fs.writeFileSync(projectConfigPath, 'export const validDirs = [\'dirty-custom\'];\n');

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.upgraded.includes(skillRel), 'unrelated tracked-clean target still writes');
            assert.ok(!result.dirtyRefused.includes(configRel), 'dirty adopter-owned config does not abort upgrade');
            assert.equal(fs.readFileSync(projectSkillPath, 'utf8'), 'NEW skill content');
            assert.equal(fs.readFileSync(projectConfigPath, 'utf8'), 'export const validDirs = [\'dirty-custom\'];\n');
        });
    });
});

// ── README / doctor allowlist drift ──────────────────────────────────────────

void test('README Prerequisites Claude Code floor matches MIN_CLAUDE_VERSION (Codex P2 on release PR #82 audit)', () => {
    // Same drift-prevention pattern as the RECOMMENDED_ALLOW test below: when
    // the doctor's version floor bumps (e.g., a new Claude Code flag becomes
    // load-bearing), CI must catch a README that still advertises the old
    // floor. Adopters seeing contradictory floors is exactly the adopter-
    // perspective friction this batch was meant to close.
    const readme = fs.readFileSync(path.join(WORKTREE_ROOT, 'README.md'), 'utf8');
    const match = readme.match(/Claude Code \(≥ (\d+)\.(\d+)\.(\d+)\)/);
    assert.ok(match, 'README Prerequisites line "Claude Code (≥ X.Y.Z)" not found');
    const [, major, minor, patch] = match;
    assert.deepEqual(
        { major: Number(major), minor: Number(minor), patch: Number(patch) },
        MIN_CLAUDE_VERSION,
        'README Claude Code floor drifted from MIN_CLAUDE_VERSION (src/cli/commands/doctor.ts)',
    );
});

void test('README "Skip the permission prompts" allowlist matches RECOMMENDED_ALLOW', () => {
    const readme = fs.readFileSync(path.join(WORKTREE_ROOT, 'README.md'), 'utf8');
    const blockMatch = readme.match(
        /### Skip the permission prompts[\s\S]*?```json\n([\s\S]*?)\n```/,
    );
    assert.ok(blockMatch, 'README "Skip the permission prompts" json block not found');
    const parsed: unknown = JSON.parse(blockMatch[1]);
    if (
        typeof parsed !== 'object' || parsed === null ||
        typeof (parsed as { permissions?: unknown }).permissions !== 'object'
    ) {
        throw new Error('README json block missing permissions object');
    }
    const allow = (parsed as { permissions: { allow?: unknown } }).permissions.allow;
    assert.ok(Array.isArray(allow), 'README permissions.allow must be an array');
    const allowStrings = allow.map(entry => {
        if (typeof entry !== 'string') {
            throw new Error('README permissions.allow contained a non-string entry');
        }
        return entry;
    });
    assert.deepEqual(
        [...allowStrings].sort(),
        [...RECOMMENDED_ALLOW].sort(),
        'README allowlist drifted from RECOMMENDED_ALLOW (src/cli/commands/doctor.ts)',
    );
});

void test('README discovery nudge matches RECOMMENDED_NUDGE', () => {
    const readme = fs.readFileSync(path.join(WORKTREE_ROOT, 'README.md'), 'utf8');
    const blockMatch = readme.match(
        /### Discovery nudge \(recommended\)[\s\S]*?```text\n([\s\S]*?)\n```/,
    );
    assert.ok(blockMatch, 'README discovery nudge text block not found');
    assert.equal(
        blockMatch[1].trim(),
        RECOMMENDED_NUDGE,
        'README discovery nudge drifted from RECOMMENDED_NUDGE (src/cli/commands/doctor.ts)',
    );
});

void test('README agent-file consolidation guidance mentions @AGENTS.md', () => {
    const readme = fs.readFileSync(path.join(WORKTREE_ROOT, 'README.md'), 'utf8');
    assert.match(readme, /### Generate your agent files with the built-in `\/init`/);
    assert.match(readme, /@AGENTS\.md/);
    assert.match(readme, /Claude Code expands `@path` imports into context at launch/);
    assert.match(readme, /Codex auto-loads `AGENTS\.md` natively/);
});

void test('README where-to-go-deeper list includes release-process docs', () => {
    const readme = fs.readFileSync(path.join(WORKTREE_ROOT, 'README.md'), 'utf8');
    assert.match(readme, /## Where to Go Deeper/);
    assert.match(readme, /docs\/release-process\.md/);
});

// ── Retired-phase drift in shipped docs ──────────────────────────────────────

// Add to this list whenever an orchestrator phase is retired. The test below
// guards against retired phase names slipping back into operational docs.
// Phrasings we don't want anywhere — both the snake_case key and the
// human-prose form that appeared in the old tier diagrams.
const RETIRED_PHASE_TOKENS = ['runtime_validation', 'Orchestrator runtime validation'];

// Operational docs the test scans. These describe how the pipeline operates
// today; retired phase names must not appear here. Historical / supersession
// records (`decisions.md`, `lessons-learned.md`, `BACKLOG.md`, `CHANGELOG.md`)
// are intentionally excluded — they describe *why* the phase was retired and
// must reference it by name.
const OPERATIONAL_DOCS = [
    'AGENTS.md',
    'CLAUDE.md',
    'docs/pipeline-orchestrator.md',
    'templates/docs/pipeline-orchestrator.md',
];

void test('operational docs do not mention retired phase names', () => {
    for (const rel of OPERATIONAL_DOCS) {
        // Case-insensitive comparison catches capitalization variants like
        // "orchestrator runtime validation" or "Orchestrator Runtime Validation"
        // that would slip past a literal substring check.
        const content = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').toLowerCase();
        for (const token of RETIRED_PHASE_TOKENS) {
            assert.ok(
                !content.includes(token.toLowerCase()),
                `${rel} mentions retired phase token "${token}" — remove or update the diagram/reference`,
            );
        }
    }
});

// ── canon-development leakage into adopter-shipped content ───────────────────

// Read the active release branch name from a single fixture so the test
// updates when canon-ai rotates to a new release branch, and so the leakage
// regression doesn't fire on intentionally-generic future-version examples in
// adopter docs (e.g., `release/v1.6` as a template placeholder).
//
// Format: { "active_release_branch": "release/vX.Y", "tokens": [...] }.
// `tokens` includes canon-ai's dogfooding-project nicknames + the dev repo
// path. Add new tokens here as canon-ai's dogfood roster grows.
//
// Filed as a regression test after canon-ai 1.4.0's init shipped
// `release/v1.4` as an example in adopter-facing CLAUDE.md — the second
// instance of this class after 1.1.1's GalleryPlanner cleanup (canon-ai #18).
// Both got caught by manual audit, not automation.
type CanonDevTokens = {
    active_release_branch: string;
    tokens: string[];
};

// Files canon-ai ships to adopters via `canon init` and `canon upgrade`.
// `templates/` is the source of truth for `canon upgrade`; `CANON_OWNED` root
// files are what `canon init` scaffolds in target repos and `canon upgrade`
// refreshes in-place. `dist/` ships in the npm package — leaks there reach
// every adopter via `npm install canon-ai`.
const ADOPTER_SHIPPED_PATHS = [
    'templates/.gitignore',
    'templates/.canon/templates/spec.md',
    'templates/.canon/templates/plan.md',
    'templates/.canon/templates/handoff.md',
    'templates/.canon/templates/review.md',
    'templates/.canon/templates/done.md',
    'templates/.canon/templates/pr-body.md',
    'templates/.canon/templates/notes.md',
    'templates/.canon/templates/spec-review.md',
    'templates/.canon/templates/status.json',
    // Root AGENTS.md / CLAUDE.md are now adopter-owned and are not shipped
    // through canon init/upgrade.
    // Bundled dist/ ships in the canon-ai npm package (per package.json
    // `files`). Bundled JS may include string literals from source — a
    // banned token making it into a source-file string would land in
    // dist/*.js and ship to every adopter via `npm install canon-ai`.
    // Scan both build entries.
    'dist/cli/index.js',
    'dist/orchestrator/run-task.js',
    // README.md is canon-ai's own marketing page (origin story, install
    // instructions for the canon-ai package), NOT a CANON_OWNED file that
    // `canon init` or `canon upgrade` ships to adopter repos. Adopters write
    // their own README. Intentional mentions of dogfooding projects in this
    // README (GalleryPlanner origin attribution, etc.) are NOT leaks — they
    // explain canon's provenance, which is correct content for canon-ai's
    // marketing page. Excluded from the scan.
];

void test('adopter-shipped content does not leak canon-development tokens', () => {
    const fixturePath = path.join(REPO_ROOT, 'tests/fixtures/canon-dev-tokens.json');
    const fixtureRaw = fs.readFileSync(fixturePath, 'utf8');
    const fixture = JSON.parse(fixtureRaw) as CanonDevTokens;
    const banned = [fixture.active_release_branch, ...fixture.tokens];

    const failures: string[] = [];
    for (const rel of ADOPTER_SHIPPED_PATHS) {
        const fullPath = path.join(WORKTREE_ROOT, rel);
        assert.equal(fs.existsSync(fullPath), true, `expected adopter-shipped path to exist: ${rel}`);
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const token of banned) {
            if (content.includes(token)) {
                failures.push(`${rel} contains canon-dev token "${token}"`);
            }
        }
    }
    assert.deepEqual(
        failures,
        [],
        'adopter-shipped files leak canon-development tokens — see tests/fixtures/canon-dev-tokens.json',
    );
});

// ── checkActiveOrchestrators ─────────────────────────────────────────────────
//
// Background: docs/BACKLOG.md "Orchestrator dies silently in background mode."
// Operator-session resume kills the Bash-tool pgroup, which kills the bash
// hosting `npx canon | tee`, which kills the orchestrator. The orchestrator's
// SIGHUP handler (#105) doesn't help because the signal isn't SIGHUP — it's
// a pgroup-level kill that no in-process handler can catch.
//
// `checkActiveOrchestrators` reads status.json + .heartbeat.json for every
// non-archived task and flags any task whose status.json says in_progress but
// whose heartbeat is missing or stale. Output drives the doctor's "Active
// orchestrators" section so operators see "your task is dead, run canon run
// <id>" instead of hours of silence.

function makeTaskDir(cwd: string, id: string, status: object, heartbeat: object | null): void {
    const dir = path.join(cwd, 'tasks', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status), 'utf8');
    if (heartbeat !== null) {
        fs.writeFileSync(path.join(dir, '.heartbeat.json'), JSON.stringify(heartbeat), 'utf8');
    }
}

const MIN_VALID_STATUS = {
    id: 'fake-task',
    title: 'fake',
    worktree: false,
    branch: '',
    phases: {},
};

// Helper: build a status shape where one phase is in_progress. Real status.json
// files set phase-level status to 'in_progress' at phase entry (see
// src/orchestrator/phases/*.ts); doctor's stale-orchestrator check keys off
// this, not a top-level "in_progress" string.
function statusWithInProgressPhase(): object {
    return {
        ...MIN_VALID_STATUS,
        status: 'implement',
        phases: { implement: { status: 'in_progress', agent: 'codex' } },
    };
}

void test('checkActiveOrchestrators: empty when tasks/ does not exist', () => {
    withTempDir((dir) => {
        const result = checkActiveOrchestrators(dir);
        assert.deepEqual(result, []);
    });
});

void test('checkActiveOrchestrators: empty when no phase is in_progress', () => {
    withTempDir((dir) => {
        // 'complete' top-level + no in_progress phase → task is done.
        makeTaskDir(dir, 'done-task', {
            ...MIN_VALID_STATUS,
            status: 'complete',
            phases: { spec: { status: 'done' } },
        }, null);
        // Pending phase (never started) → no orchestrator was ever supposed
        // to be running.
        makeTaskDir(dir, 'pending-task', { ...MIN_VALID_STATUS, status: 'spec' }, null);
        const prev = process.cwd();
        try {
            process.chdir(dir);
            process.env.CANON_TASKS_DIR_OVERRIDE = path.join(dir, 'tasks');
            const result = checkActiveOrchestrators(dir);
            assert.deepEqual(result, []);
        } finally {
            delete process.env.CANON_TASKS_DIR_OVERRIDE;
            process.chdir(prev);
        }
    });
});

void test('checkActiveOrchestrators: pass when heartbeat is fresh', () => {
    withTempDir((dir) => {
        const now = 1_700_000_000_000;
        makeTaskDir(dir, 'live-task',
            statusWithInProgressPhase(),
            { pid: 99999, started_at_ms: now - 5000, last_update_ms: now - 5000, task_ids: ['live-task'] },
        );
        const prev = process.cwd();
        try {
            process.chdir(dir);
            process.env.CANON_TASKS_DIR_OVERRIDE = path.join(dir, 'tasks');
            const result = checkActiveOrchestrators(dir, now);
            assert.equal(result.length, 1);
            assert.equal(result[0].status, 'pass');
            assert.match(result[0].label, /orchestrator live-task/);
            assert.match(result[0].detail ?? '', /pid 99999/);
            assert.match(result[0].detail ?? '', /5s ago/);
        } finally {
            delete process.env.CANON_TASKS_DIR_OVERRIDE;
            process.chdir(prev);
        }
    });
});

void test('checkActiveOrchestrators: warn when heartbeat is stale', () => {
    withTempDir((dir) => {
        const now = 1_700_000_000_000;
        const stale = now - HEARTBEAT_STALE_AFTER_MS - 5_000; // safely past threshold
        makeTaskDir(dir, 'dead-task',
            statusWithInProgressPhase(),
            { pid: 1, started_at_ms: stale - 1000, last_update_ms: stale, task_ids: ['dead-task'] },
        );
        const prev = process.cwd();
        try {
            process.chdir(dir);
            process.env.CANON_TASKS_DIR_OVERRIDE = path.join(dir, 'tasks');
            const result = checkActiveOrchestrators(dir, now);
            assert.equal(result.length, 1);
            assert.equal(result[0].status, 'warn');
            assert.match(result[0].detail ?? '', /canon run dead-task/);
            assert.match(result[0].detail ?? '', /last heartbeat/);
        } finally {
            delete process.env.CANON_TASKS_DIR_OVERRIDE;
            process.chdir(prev);
        }
    });
});

void test('checkActiveOrchestrators: warn with explicit "no .heartbeat.json" detail when missing', () => {
    withTempDir((dir) => {
        const now = 1_700_000_000_000;
        makeTaskDir(dir, 'killed-task',
            statusWithInProgressPhase(),
            null, // no heartbeat at all — exactly what SIGKILL produces
        );
        const prev = process.cwd();
        try {
            process.chdir(dir);
            process.env.CANON_TASKS_DIR_OVERRIDE = path.join(dir, 'tasks');
            const result = checkActiveOrchestrators(dir, now);
            assert.equal(result.length, 1);
            assert.equal(result[0].status, 'warn');
            assert.match(result[0].detail ?? '', /no \.heartbeat\.json/);
            assert.match(result[0].detail ?? '', /canon run killed-task/);
        } finally {
            delete process.env.CANON_TASKS_DIR_OVERRIDE;
            process.chdir(prev);
        }
    });
});

void test('checkActiveOrchestrators: skips _archive entries', () => {
    withTempDir((dir) => {
        const tasks = path.join(dir, 'tasks');
        fs.mkdirSync(path.join(tasks, '_archive'), { recursive: true });
        const result = checkActiveOrchestrators(dir);
        assert.deepEqual(result, []);
    });
});

void test('checkActiveOrchestrators: tolerates malformed status.json', () => {
    withTempDir((dir) => {
        const taskDir = path.join(dir, 'tasks', 'broken');
        fs.mkdirSync(taskDir, { recursive: true });
        fs.writeFileSync(path.join(taskDir, 'status.json'), '{not json', 'utf8');
        const prev = process.cwd();
        try {
            process.chdir(dir);
            process.env.CANON_TASKS_DIR_OVERRIDE = path.join(dir, 'tasks');
            const result = checkActiveOrchestrators(dir);
            // Doctor must not crash on a single broken status.json — task-list
            // contract from issue #83 applies here too.
            assert.deepEqual(result, []);
        } finally {
            delete process.env.CANON_TASKS_DIR_OVERRIDE;
            process.chdir(prev);
        }
    });
});

void test('formatAge: seconds-only for < 60s', () => {
    assert.equal(formatAge(0), '0s');
    assert.equal(formatAge(999), '0s');
    assert.equal(formatAge(1_000), '1s');
    assert.equal(formatAge(59_000), '59s');
});

void test('formatAge: minutes + remainder for < 1h', () => {
    assert.equal(formatAge(60_000), '1m');
    assert.equal(formatAge(125_000), '2m 5s');
    assert.equal(formatAge(3_599_000), '59m 59s');
});

void test('formatAge: hours + remainder for >= 1h', () => {
    assert.equal(formatAge(3_600_000), '1h');
    assert.equal(formatAge(3_660_000), '1h 1m');
    assert.equal(formatAge(7_320_000), '2h 2m');
});

void test('formatAge: never returns negative', () => {
    assert.equal(formatAge(-1000), '0s');
});
