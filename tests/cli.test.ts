import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { mergeDelimited, runUpgrade } from '../src/cli/commands/upgrade.js';
import { detectInstallType } from '../src/cli/commands/update.js';
import { scaffoldTemplates } from '../src/cli/commands/init.js';
import {
    checkNodeVersion,
    checkAgentFile,
    checkTemplates,
    checkSkills,
    checkCanonVersion,
    checkLocalSettingsGitignored,
} from '../src/cli/commands/doctor.js';
import { REPO_ROOT } from '../scripts/run-task/env.js';

function withTempDir(fn: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-cli-'));
    try { fn(dir); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
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

// ── checkNodeVersion ─────────────────────────────────────────────────────────

void test('checkNodeVersion: current process is ≥24 → pass', () => {
    const check = checkNodeVersion();
    assert.equal(check.status, 'pass');
    assert.match(check.label, /^node v\d+/);
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
        for (const f of ['spec.md', 'plan.md', 'handoff.md', 'review.md',
                         'done.md', 'spec-review.md', 'notes.md', 'status.json']) {
            fs.writeFileSync(path.join(templatesDir, f), '');
        }
        assert.equal(checkTemplates(dir).status, 'pass');
    });
});

void test('checkTemplates: some templates missing → warn with file list', () => {
    withTempDir(dir => {
        const templatesDir = path.join(dir, '.canon', 'templates');
        fs.mkdirSync(templatesDir, { recursive: true });
        fs.writeFileSync(path.join(templatesDir, 'spec.md'), '');
        const check = checkTemplates(dir);
        assert.equal(check.status, 'warn');
        // detail lists the missing files
        assert.match(check.detail ?? '', /plan\.md/);
        assert.match(check.detail ?? '', /done\.md/);
    });
});

// ── checkSkills ──────────────────────────────────────────────────────────────

void test('checkSkills: all five skills present → pass', () => {
    withTempDir(dir => {
        for (const skill of ['canon-init', 'canon-spec', 'canon-pipeline', 'canon-status', 'canon-changelog']) {
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
