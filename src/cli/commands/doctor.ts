import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { isAvailable } from '../deps.js';

interface Check {
    label: string;
    status: 'pass' | 'warn' | 'fail';
    detail?: string;
}

const CANON_END = '<!-- canon:end -->';
const CANON_START_RE = /<!-- canon:start[^>]* -->/;

const EXPECTED_TEMPLATES = [
    'spec.md', 'plan.md', 'handoff.md', 'review.md',
    'done.md', 'spec-review.md', 'notes.md', 'status.json',
];

// Canon's recommended .claude/settings.json permissions.allow entries.
// Kept in sync with README's "Skip the permission prompts" block.
export const RECOMMENDED_ALLOW = [
    'Bash(git *)',
    'Bash(gh *)',
    'Bash(jq *)',
    'Bash(sed *)',
    'Bash(awk *)',
    'Bash(ls *)',
    'Bash(find *)',
    'Bash(npm run *)',
    'Bash(npx canon *)',
    'Bash(canon *)',
    'Bash(npx tsx *)',
    'Bash(codex *)',
    'Skill(canon-init)',
    'Skill(canon-spec)',
    'Skill(canon-spec:*)',
    'Skill(canon-pipeline)',
    'Skill(canon-pipeline:*)',
    'Skill(canon-status)',
    'Skill(canon-status:*)',
    'Skill(canon-changelog)',
    'Skill(canon-changelog:*)',
];

// --- individual checks ---

export function checkPlatform(): Check {
    const isWindows = process.platform === 'win32';
    if (!isWindows) return { label: 'platform', status: 'pass' };
    const isWSL = existsSync('/proc/version') &&
        readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
    if (isWSL) return { label: 'platform (WSL)', status: 'pass' };
    return {
        label: 'platform',
        status: 'warn',
        detail: 'Windows without WSL — canon is untested here; use WSL for best results',
    };
}

export function checkNodeVersion(): Check {
    const match = process.version.match(/^v(\d+)/);
    const major = match ? parseInt(match[1], 10) : 0;
    if (major >= 24) return { label: `node ${process.version}`, status: 'pass' };
    return {
        label: `node ${process.version}`,
        status: 'fail',
        detail: 'node 24+ required — https://nodejs.org',
    };
}

export function checkBinary(cmd: string, required: boolean, hint: string): Check {
    if (isAvailable(cmd)) return { label: cmd, status: 'pass' };
    return {
        label: cmd,
        status: required ? 'fail' : 'warn',
        detail: hint,
    };
}

export function checkAgentFile(cwd: string, filename: string): Check {
    const path = join(cwd, filename);
    if (!existsSync(path)) {
        return { label: filename, status: 'fail', detail: 'missing — run `canon init`' };
    }
    const content = readFileSync(path, 'utf8');
    if (!CANON_START_RE.test(content) || !content.includes(CANON_END)) {
        return { label: filename, status: 'warn', detail: 'no canon delimiters — run `canon init` to add them' };
    }
    return { label: filename, status: 'pass' };
}

export function checkTemplates(cwd: string): Check {
    const dir = join(cwd, '.canon', 'templates');
    if (!existsSync(dir)) {
        return { label: '.canon/templates/', status: 'fail', detail: 'missing — run `canon init`' };
    }
    const missing = EXPECTED_TEMPLATES.filter(f => !existsSync(join(dir, f)));
    if (missing.length > 0) {
        return {
            label: '.canon/templates/',
            status: 'warn',
            detail: `missing: ${missing.join(', ')}`,
        };
    }
    return { label: '.canon/templates/', status: 'pass' };
}

export function checkCanonVersion(cwd: string): Check {
    const versionPath = join(cwd, '.canon', 'version');
    const installedVersion = process.env['CANON_VERSION'] ?? 'dev';

    if (!existsSync(versionPath)) {
        return { label: '.canon/version', status: 'warn', detail: 'missing — run `canon upgrade`' };
    }
    const vendoredVersion = readFileSync(versionPath, 'utf8').trim();
    if (vendoredVersion !== installedVersion) {
        return {
            label: '.canon/version',
            status: 'warn',
            detail: `vendored ${vendoredVersion} ≠ installed ${installedVersion} — run \`canon upgrade\``,
        };
    }
    return { label: `.canon/version (${vendoredVersion})`, status: 'pass' };
}

export function checkSkills(cwd: string): Check {
    const initSkill = join(cwd, '.claude', 'skills', 'canon-init', 'SKILL.md');
    if (!existsSync(initSkill)) {
        return {
            label: '.claude/skills/',
            status: 'warn',
            detail: 'canon-init skill missing — run `canon init` or `canon upgrade`',
        };
    }
    const skillNames = ['canon-spec', 'canon-pipeline', 'canon-status', 'canon-changelog'];
    const missing = skillNames.filter(s => !existsSync(join(cwd, '.claude', 'skills', s, 'SKILL.md')));
    if (missing.length > 0) {
        return {
            label: '.claude/skills/',
            status: 'warn',
            detail: `operational skills missing: ${missing.join(', ')} — run \`canon upgrade\``,
        };
    }
    return { label: '.claude/skills/', status: 'pass' };
}

export function checkCodexConfig(cwd: string): Check {
    const path = join(cwd, '.codex', 'config.toml');
    if (existsSync(path)) return { label: '.codex/config.toml', status: 'pass' };
    return { label: '.codex/config.toml', status: 'warn', detail: 'missing — Codex will use defaults' };
}

export function checkRecommendedPermissions(cwd: string): Check {
    const settingsPath = join(cwd, '.claude', 'settings.json');
    const label = '.claude/settings.json';
    if (!existsSync(settingsPath)) {
        return {
            label,
            status: 'warn',
            detail: 'not present — see README "Skip the permission prompts" for the recommended allowlist, or rerun `/canon-init`',
        };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch {
        return { label, status: 'warn', detail: 'present but not valid JSON — review manually' };
    }
    const allowRaw = (parsed as { permissions?: { allow?: unknown } } | null)?.permissions?.allow;
    const allow = new Set<string>(Array.isArray(allowRaw) ? allowRaw.filter((x): x is string => typeof x === 'string') : []);
    const missing = RECOMMENDED_ALLOW.filter(p => !allow.has(p));
    if (missing.length === 0) {
        return { label, status: 'pass', detail: 'recommended canon perms present' };
    }
    if (missing.length === RECOMMENDED_ALLOW.length) {
        return {
            label,
            status: 'warn',
            detail: 'no recommended canon perms allowlisted — see README "Skip the permission prompts"',
        };
    }
    const preview = missing.slice(0, 3).join(', ');
    const more = missing.length > 3 ? ` (+${missing.length - 3} more)` : '';
    return {
        label,
        status: 'warn',
        detail: `missing ${missing.length} recommended perm(s): ${preview}${more} — see README`,
    };
}

export function checkLocalSettingsGitignored(cwd: string): Check {
    const settingsPath = join(cwd, '.claude', 'settings.local.json');
    const gitignorePath = join(cwd, '.gitignore');

    if (!existsSync(settingsPath)) return { label: '.claude/settings.local.json', status: 'pass', detail: 'not present' };

    if (!existsSync(gitignorePath)) {
        return {
            label: '.claude/settings.local.json',
            status: 'warn',
            detail: 'present but no .gitignore found — add it to .gitignore to avoid leaking local settings',
        };
    }
    const gitignore = readFileSync(gitignorePath, 'utf8');
    const isIgnored = gitignore.split('\n').some(line => {
        const trimmed = line.trim();
        return trimmed === '.claude/settings.local.json' ||
               trimmed === 'settings.local.json' ||
               trimmed === '.claude/';
    });
    if (isIgnored) return { label: '.claude/settings.local.json', status: 'pass', detail: 'gitignored' };
    return {
        label: '.claude/settings.local.json',
        status: 'warn',
        detail: 'present but not in .gitignore — add `.claude/settings.local.json` to avoid leaking local settings',
    };
}

// --- runner ---

function printSection(title: string): void {
    console.log(`\n${title}`);
    console.log('─'.repeat(title.length));
}

function printCheck(c: Check): void {
    const icon = c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✗';
    const line = `  ${icon} ${c.label}`;
    console.log(c.detail ? `${line} — ${c.detail}` : line);
}

export function doctorCmd(_args: string[]): void {
    const cwd = process.cwd();

    const envChecks: Check[] = [
        checkPlatform(),
        checkNodeVersion(),
        checkBinary('git', true, 'https://git-scm.com/downloads'),
        checkBinary('jq', true, 'brew install jq  (or https://jqlang.github.io/jq/)'),
        checkBinary('claude', true, 'npm install -g @anthropic-ai/claude-code'),
        checkBinary('codex', true, 'npm install -g @openai/codex'),
        checkBinary('gh', false, 'brew install gh && gh auth login  (required for --pr / --push)'),
    ];

    const canonChecks: Check[] = [
        checkAgentFile(cwd, 'AGENTS.md'),
        checkAgentFile(cwd, 'CLAUDE.md'),
        checkAgentFile(cwd, 'CODEX.md'),
        checkTemplates(cwd),
        checkCanonVersion(cwd),
        checkSkills(cwd),
    ];

    const configChecks: Check[] = [
        checkCodexConfig(cwd),
        checkRecommendedPermissions(cwd),
        checkLocalSettingsGitignored(cwd),
    ];

    console.log('\ncanon doctor\n');

    printSection('Environment');
    for (const c of envChecks) printCheck(c);

    printSection('Canon setup');
    for (const c of canonChecks) printCheck(c);

    printSection('Config');
    for (const c of configChecks) printCheck(c);

    const all = [...envChecks, ...canonChecks, ...configChecks];
    const failures = all.filter(c => c.status === 'fail');
    const warnings = all.filter(c => c.status === 'warn');

    console.log('');
    if (failures.length > 0) {
        console.log(`${failures.length} failure(s) — fix the above before running tasks.\n`);
        process.exit(1);
    }
    if (warnings.length > 0) {
        console.log(`${warnings.length} warning(s) — canon should work; review above.\n`);
        return;
    }
    console.log('All checks passed.\n');
}
