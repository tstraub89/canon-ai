import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { mergeDelimited, mergeHeaderOnly, parseUpgradeArgs, printStaleOverrideNudge, runUpgrade } from '../src/cli/commands/upgrade.js';
import { detectInstallType } from '../src/cli/commands/update.js';
import { scaffoldTemplates } from '../src/cli/commands/init.js';
import {
    CANON_GITIGNORE_BLOCK,
    CANON_RUNTIME_GITIGNORE_PATTERNS,
    extractCanonBlock,
    upsertCanonBlock,
} from '../src/lib/canon-block.js';
import {
    checkActiveOrchestrators,
    checkNodeVersion,
    checkAgentFile,
    checkCodexMdDeprecated,
    EXPECTED_TEMPLATES,
    checkTemplates,
    checkSkills,
    checkCanonVersion,
    checkLocalSettingsGitignored,
    checkRuntimeFilesGitignored,
    checkRecommendedPermissions,
    checkClaudeVersion,
    formatAge,
    parseClaudeVersion,
    parseCodexProjectTrust,
    MIN_CLAUDE_VERSION,
    RECOMMENDED_ALLOW,
} from '../src/cli/commands/doctor.js';
import { CANON_OWNED } from '../src/lib/canon-owned.js';
import { HEARTBEAT_STALE_AFTER_MS } from '../scripts/run-task/heartbeat.js';
import { REPO_ROOT } from '../scripts/run-task/env.js';

const WORKTREE_ROOT = process.cwd();
const CLI_ENTRYPOINT = path.join(WORKTREE_ROOT, 'src', 'cli', 'index.ts');

function withTempDir(fn: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-cli-'));
    try { fn(dir); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function runCanonCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(process.execPath, ['--import', 'tsx', CLI_ENTRYPOINT, ...args], {
        cwd: WORKTREE_ROOT,
        encoding: 'utf8',
    });
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
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
    assert.equal(detectInstallType('/home/user/.npm/_npx/abc123/node_modules/canon-ai'), 'npx');
});

void test('detectInstallType: windows npx path → npx', () => {
    assert.equal(detectInstallType('C:\\Users\\user\\.npm\\_npx\\abc\\node_modules\\canon-ai'), 'npx');
});

void test('detectInstallType: local install — pkgDir inside project node_modules', () => {
    withTempDir(dir => {
        fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"my-project"}');
        const pkgDir = path.join(dir, 'node_modules', 'canon-ai');
        assert.equal(detectInstallType(pkgDir), 'local');
    });
});

void test('detectInstallType: local install from subdirectory — pkgDir path determines type, not cwd', () => {
    withTempDir(dir => {
        fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"my-project"}');
        const pkgDir = path.join(dir, 'node_modules', 'canon-ai');
        // cwd is a subdir — but detectInstallType uses pkgDir, not cwd
        assert.equal(detectInstallType(pkgDir), 'local');
    });
});

void test('detectInstallType: global — no package.json at node_modules parent', () => {
    // /usr/local/lib/node_modules/canon-ai: parent is /usr/local/lib — no package.json there
    assert.equal(detectInstallType('/usr/local/lib/node_modules/canon-ai'), 'global');
});

void test('detectInstallType: no node_modules in path → global', () => {
    assert.equal(detectInstallType('/usr/local/bin/canon-ai'), 'global');
});

void test('detectInstallType: node_modules present but parent lacks package.json → global', () => {
    withTempDir(dir => {
        // dir has no package.json
        const pkgDir = path.join(dir, 'node_modules', 'canon-ai');
        assert.equal(detectInstallType(pkgDir), 'global');
    });
});

// ── CLI entrypoint dispatch ────────────────────────────────────────────────

void test('canon CLI help mentions watch', () => {
    const result = runCanonCli(['--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /canon watch <id>/);
    assert.match(result.stdout, /Exit codes: 0 healthy stop\/until/);
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

// ── checkAgentFile ───────────────────────────────────────────────────────────

void test('checkAgentFile: missing file → fail with run canon init hint', () => {
    withTempDir(dir => {
        const check = checkAgentFile(dir, 'CLAUDE.md');
        assert.equal(check.status, 'fail');
        assert.match(check.detail ?? '', /canon init/);
    });
});

void test('checkAgentFile: present with both delimiters → pass', () => {
    withTempDir(dir => {
        fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
            `${CANON_START}\ncontent\n${CANON_END}\nproject tail\n`);
        assert.equal(checkAgentFile(dir, 'CLAUDE.md').status, 'pass');
    });
});

void test('checkAgentFile: present but no canon delimiters → warn', () => {
    withTempDir(dir => {
        fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# CLAUDE.md\n\nPlain content.\n');
        const check = checkAgentFile(dir, 'CLAUDE.md');
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /delimiter/i);
    });
});

void test('checkAgentFile: present with start but missing end → warn', () => {
    withTempDir(dir => {
        fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `${CANON_START}\ncontent\n`);
        assert.equal(checkAgentFile(dir, 'CLAUDE.md').status, 'warn');
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
        for (const skill of ['canon-init', 'canon-spec', 'canon-pipeline', 'canon-status', 'canon-changelog', 'canon-review', 'canon-inline-review']) {
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

// ── runUpgrade ───────────────────────────────────────────────────────────────

void test('runUpgrade: merges CLAUDE.md — new canon block, project tail preserved', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            // Template: new canon block
            const templateContent = `${CANON_START}\nnew canon content\n${CANON_END}\n`;
            const tmplDir = path.join(pkgDir, 'templates');
            fs.mkdirSync(tmplDir, { recursive: true });
            fs.writeFileSync(path.join(tmplDir, 'CLAUDE.md'), templateContent);

            // Project: old canon block + project tail
            const projectTail = '\n\n## My Project Section\n\nCustom content here.\n';
            fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'),
                `${CANON_START}\nold canon content\n${CANON_END}\n${projectTail}`);

            // Stamp a version so version bump doesn't appear in upgraded
            const canonDir = path.join(projectDir, '.canon');
            fs.mkdirSync(canonDir, { recursive: true });
            const ver = process.env['CANON_VERSION'] ?? 'dev';
            fs.writeFileSync(path.join(canonDir, 'version'), `${ver}\n`);

            const { upgraded, unchanged, skipped } = runUpgrade(projectDir, pkgDir);

            assert.ok(upgraded.includes('CLAUDE.md'), 'CLAUDE.md should be upgraded');
            const result = fs.readFileSync(path.join(projectDir, 'CLAUDE.md'), 'utf8');
            assert.ok(result.includes('new canon content'), 'new content should be present');
            assert.ok(!result.includes('old canon content'), 'old content should be gone');
            assert.ok(result.includes('## My Project Section'), 'project tail should be preserved');
            assert.ok(!unchanged.includes('CLAUDE.md'));
            assert.ok(!skipped.includes('CLAUDE.md'));
        });
    });
});

void test('runUpgrade: unchanged file not written — reported as unchanged', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const content = `${CANON_START}\ncontent\n${CANON_END}\n\nproject tail\n`;
            const tmplDir = path.join(pkgDir, 'templates');
            fs.mkdirSync(tmplDir, { recursive: true });
            fs.writeFileSync(path.join(tmplDir, 'CLAUDE.md'), content);
            fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'), content);

            const canonDir = path.join(projectDir, '.canon');
            fs.mkdirSync(canonDir, { recursive: true });
            const ver = process.env['CANON_VERSION'] ?? 'dev';
            fs.writeFileSync(path.join(canonDir, 'version'), `${ver}\n`);

            const { upgraded, unchanged } = runUpgrade(projectDir, pkgDir);

            assert.ok(!upgraded.includes('CLAUDE.md'));
            assert.ok(unchanged.includes('CLAUDE.md'));
        });
    });
});

void test('runUpgrade: project file without delimiters → skipped with message', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const tmplDir = path.join(pkgDir, 'templates');
            fs.mkdirSync(tmplDir, { recursive: true });
            fs.writeFileSync(path.join(tmplDir, 'CLAUDE.md'),
                `${CANON_START}\nnew\n${CANON_END}\n`);
            // Project file has no delimiters
            fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'), '# CLAUDE\n\nPlain content.\n');

            const canonDir = path.join(projectDir, '.canon');
            fs.mkdirSync(canonDir, { recursive: true });
            const ver = process.env['CANON_VERSION'] ?? 'dev';
            fs.writeFileSync(path.join(canonDir, 'version'), `${ver}\n`);

            const { skipped } = runUpgrade(projectDir, pkgDir);

            assert.ok(skipped.some(s => s.includes('CLAUDE.md') && s.includes('delimiter')));
            // File should be unchanged
            assert.equal(
                fs.readFileSync(path.join(projectDir, 'CLAUDE.md'), 'utf8'),
                '# CLAUDE\n\nPlain content.\n',
            );
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

void test('runUpgrade: untracked dirty status does NOT trigger refusal', () => {
    // First-install scenario: the managed path exists locally but isn't yet
    // tracked in git. `git status` shows it as `??` (untracked); we treat
    // untracked as clean since there's no committed history to lose.
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            gitInit(projectDir);
            const rel = setupSkillTemplate(pkgDir, 'NEW skill content');
            const projectSkillPath = path.join(projectDir, rel);
            fs.mkdirSync(path.dirname(projectSkillPath), { recursive: true });
            fs.writeFileSync(projectSkillPath, 'untracked skill content');
            const canonDir = path.join(projectDir, '.canon');
            fs.mkdirSync(canonDir, { recursive: true });
            const ver = process.env['CANON_VERSION'] ?? 'dev';
            fs.writeFileSync(path.join(canonDir, 'version'), `${ver}\n`);
            // Note: no `git add` — file is untracked.

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.upgraded.includes(rel), 'untracked file upgraded without refusal');
            assert.deepEqual(result.dirtyRefused, []);
        });
    });
});

// ── runUpgrade against real templates ────────────────────────────────────────

void test('runUpgrade: real templates dir produces valid merged CLAUDE.md', () => {
    const realTemplatesParent = REPO_ROOT;
    withTempDir(projectDir => {
        // Seed project with a CLAUDE.md that has delimiters and a project tail
        const projectTail = '\n\n## Adopter Section\n\nCustom docs.\n';
        const seedContent = `${CANON_START}\nplaceholder\n${CANON_END}\n${projectTail}`;
        fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'), seedContent);

        const canonDir = path.join(projectDir, '.canon');
        fs.mkdirSync(canonDir, { recursive: true });
        const ver = process.env['CANON_VERSION'] ?? 'dev';
        fs.writeFileSync(path.join(canonDir, 'version'), `${ver}\n`);

        const { upgraded } = runUpgrade(projectDir, realTemplatesParent);

        assert.ok(upgraded.includes('CLAUDE.md'), 'CLAUDE.md should be upgraded from real template');
        const result = fs.readFileSync(path.join(projectDir, 'CLAUDE.md'), 'utf8');
        assert.ok(result.includes(CANON_START), 'result has canon start');
        assert.ok(result.includes(CANON_END), 'result has canon end');
        assert.ok(result.includes('## Adopter Section'), 'project tail preserved');
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
    'templates/AGENTS.md',
    'templates/CLAUDE.md',
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
    'templates/AGENTS.md',
    'templates/CLAUDE.md',
    'templates/.canon/templates/spec.md',
    'templates/.canon/templates/plan.md',
    'templates/.canon/templates/handoff.md',
    'templates/.canon/templates/review.md',
    'templates/.canon/templates/done.md',
    'templates/.canon/templates/pr-body.md',
    'templates/.canon/templates/notes.md',
    'templates/.canon/templates/spec-review.md',
    'templates/.canon/templates/status.json',
    // Root CANON_OWNED files (canon-ai-dev's own dogfood copies of the
    // templates/ versions, kept in parallel per the canon-delimited-files
    // memory). Scanned to catch the case where the root copy drifts and
    // accumulates dev-specifics that templates/ doesn't have — that's the
    // exact leak shape that produced 1.4.0's `release/v1.4` slip in
    // CLAUDE.md.
    'AGENTS.md',
    'CLAUDE.md',
    // Bundled dist/ ships in the canon-ai npm package (per package.json
    // `files`). Bundled JS may include string literals from source — a
    // banned token making it into a source-file string would land in
    // dist/*.js and ship to every adopter via `npm install canon-ai`.
    // Scan both build entries.
    'dist/cli/index.js',
    'dist/scripts/run-task.js',
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
        const fullPath = path.join(REPO_ROOT, rel);
        if (!fs.existsSync(fullPath)) continue;
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
// scripts/run-task/phases/*.ts); doctor's stale-orchestrator check keys off
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
