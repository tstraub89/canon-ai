import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '../..');

const CANON_END = '<!-- canon:end -->';
const CANON_START_RE = /<!-- canon:start[^>]* -->/;

// Agent files: have canon:start/end delimiters — replace canon block, preserve project tail
const DELIMITED = ['AGENTS.md', 'CLAUDE.md', 'CODEX.md'];

// Canon-owned files: no delimiters, fully managed by canon — overwrite entirely.
// .canon/templates/ are the canonical defaults; projects override per-file by
// placing a copy in tasks/_templates/ (never touched by upgrade). See .canon/README.md.
const CANON_OWNED = [
    '.canon/README.md',
    '.claude/skills/canon-init/SKILL.md',
    '.claude/skills/canon-spec/SKILL.md',
    '.claude/skills/canon-pipeline/SKILL.md',
    '.claude/skills/canon-status/SKILL.md',
    '.claude/skills/canon-changelog/SKILL.md',
    '.canon/templates/status.json',
    '.canon/templates/spec.md',
    '.canon/templates/plan.md',
    '.canon/templates/handoff.md',
    '.canon/templates/spec-review.md',
    '.canon/templates/review.md',
    '.canon/templates/done.md',
    '.canon/templates/notes.md',
    // Pure canon documentation — adopters don't customize. Listed here so future
    // canon releases (post-1.1.x reframes etc.) flow through `canon upgrade`
    // instead of going stale in every existing install. See 1.1.2 CHANGELOG.
    'docs/pipeline-orchestrator.md',
];

export function mergeDelimited(templateContent: string, projectContent: string): string | null {
    if (!CANON_START_RE.test(templateContent)) return null;
    if (!CANON_START_RE.test(projectContent)) return null;

    const templateEnd = templateContent.indexOf(CANON_END);
    const projectEnd = projectContent.indexOf(CANON_END);
    if (templateEnd === -1 || projectEnd === -1) return null;

    // Template up to and including canon:end, then the project's custom tail
    return (
        templateContent.slice(0, templateEnd + CANON_END.length) +
        projectContent.slice(projectEnd + CANON_END.length)
    );
}

interface UpgradeResult {
    upgraded: string[];
    unchanged: string[];
    skipped: string[];
}

export function runUpgrade(cwd: string, pkgDir: string): UpgradeResult {
    const upgraded: string[] = [];
    const unchanged: string[] = [];
    const skipped: string[] = [];

    // --- Delimited files (AGENTS.md, CLAUDE.md, CODEX.md) ---
    for (const rel of DELIMITED) {
        const projectPath = join(cwd, rel);
        const templatePath = join(pkgDir, 'templates', rel);

        if (!existsSync(projectPath) || !existsSync(templatePath)) {
            skipped.push(rel);
            continue;
        }

        const projectContent = readFileSync(projectPath, 'utf8');
        const templateContent = readFileSync(templatePath, 'utf8');
        const merged = mergeDelimited(templateContent, projectContent);

        if (merged === null) {
            skipped.push(`${rel} (no canon delimiters — run \`canon init\` to add them)`);
            continue;
        }

        if (merged === projectContent) {
            unchanged.push(rel);
            continue;
        }

        writeFileSync(projectPath, merged);
        upgraded.push(rel);
    }

    // --- Canon-owned files (skills, etc.) ---
    for (const rel of CANON_OWNED) {
        const projectPath = join(cwd, rel);
        const templatePath = join(pkgDir, 'templates', rel);

        if (!existsSync(templatePath)) {
            skipped.push(rel);
            continue;
        }

        const templateContent = readFileSync(templatePath, 'utf8');

        if (existsSync(projectPath)) {
            const projectContent = readFileSync(projectPath, 'utf8');
            if (projectContent === templateContent) {
                unchanged.push(rel);
                continue;
            }
        } else {
            mkdirSync(dirname(projectPath), { recursive: true });
        }

        writeFileSync(projectPath, templateContent);
        upgraded.push(rel);
    }

    // Update .canon/version to match the installed package
    const versionPath = join(cwd, '.canon', 'version');
    const newVersion = process.env.CANON_VERSION ?? 'dev';
    const currentVersion = existsSync(versionPath) ? readFileSync(versionPath, 'utf8').trim() : null;
    if (currentVersion !== newVersion) {
        mkdirSync(dirname(versionPath), { recursive: true });
        writeFileSync(versionPath, newVersion + '\n');
        upgraded.push('.canon/version');
    }

    return { upgraded, unchanged, skipped };
}

export function upgradeCmd(_args: string[]): void {
    const { upgraded, unchanged, skipped } = runUpgrade(process.cwd(), packageDir);

    // Stage all changed files
    if (upgraded.length > 0) {
        const r = spawnSync('git', ['add', ...upgraded], { cwd: process.cwd(), stdio: 'inherit' });
        if (r.status !== 0) {
            console.error('\nwarning: failed to stage changes — run `git add` manually.');
        }
    }

    // Summary
    console.log('\ncanon upgrade\n');

    if (upgraded.length > 0) {
        console.log('Updated:');
        for (const f of upgraded) console.log(`  ↑ ${f}`);
        console.log('\nReview:  git diff --staged');
        console.log('Revert:  git checkout -- <file>\n');
    }
    if (unchanged.length > 0) {
        console.log('Already up to date:');
        for (const f of unchanged) console.log(`  = ${f}`);
        console.log('');
    }
    if (skipped.length > 0) {
        console.log('Skipped:');
        for (const f of skipped) console.log(`  ? ${f}`);
        console.log('');
    }

    if (upgraded.length === 0 && unchanged.length === 0) {
        console.log('No canon-managed files found. Run `canon init` to set up canon in this repo.\n');
    } else {
        console.log('Orchestrator scripts update automatically — run `npm update canon-ai` to pull the latest.\n');
    }
}
