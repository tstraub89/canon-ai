import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from 'fs';

import { fileURLToPath } from 'url';
import { dirname, join, relative } from 'path';
import { checkDeps } from '../deps.js';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '../..');
const templatesDir = join(packageDir, 'templates');

const AGENT_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'CODEX.md']);

function walkDir(dir: string, base: string = dir): string[] {
    const results: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            results.push(...walkDir(full, base));
        } else {
            results.push(relative(base, full));
        }
    }
    return results;
}


export function scaffoldTemplates(
    cwd: string,
    srcTemplatesDir: string,
): { scaffolded: string[]; skipped: string[] } {
    const templateFiles = walkDir(srcTemplatesDir);
    const scaffolded: string[] = [];
    const skipped: string[] = [];

    for (const rel of templateFiles) {
        const dest = join(cwd, rel);
        if (existsSync(dest)) {
            skipped.push(rel);
            continue;
        }
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(join(srcTemplatesDir, rel), dest);
        scaffolded.push(rel);
    }

    return { scaffolded, skipped };
}

export function initCmd(_args: string[]): void {
    checkDeps();

    const cwd = process.cwd();
    const { scaffolded, skipped } = scaffoldTemplates(cwd, templatesDir);

    const pkgPath = join(cwd, 'package.json');
    const isJsProject = existsSync(pkgPath);
    if (isJsProject) {
        updatePackageJson(pkgPath);
    }

    console.log('\ncanon init\n');
    if (scaffolded.length > 0) {
        console.log('Scaffolded:');
        for (const f of scaffolded) console.log(`  + ${f}`);
    }
    if (skipped.length > 0) {
        console.log('\nExisting files (will be merged during grill):');
        for (const f of skipped) console.log(`  ~ ${f}`);
    }

    if (!isJsProject) {
        console.log('\nNo package.json found — running canon directly:');
        console.log('  canon run <id>          # run the pipeline');
        console.log('  canon run <id> --pr     # push + open draft PR');
    }

    writeCanonVersion(cwd);

    const hasExistingAgentFiles = skipped.some(f => AGENT_FILES.has(f));
    console.log('');
    launchGrill(cwd, hasExistingAgentFiles);
}

function writeCanonVersion(cwd: string): void {
    const versionPath = join(cwd, '.canon', 'version');
    const version = process.env['CANON_VERSION'] ?? 'dev';
    mkdirSync(dirname(versionPath), { recursive: true });
    writeFileSync(versionPath, version + '\n');
}

function updatePackageJson(pkgPath: string): void {
    const raw = readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const canonVersion = process.env['CANON_VERSION'] ?? 'latest';

    const devDeps = (pkg['devDependencies'] ?? {}) as Record<string, string>;
    devDeps['canon-ai'] = `^${canonVersion}`;
    pkg['devDependencies'] = devDeps;

    const scripts = (pkg['scripts'] ?? {}) as Record<string, string>;
    if (!scripts['canon']) scripts['canon'] = 'canon';
    pkg['scripts'] = scripts;

    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log('\nUpdated package.json (devDependencies + scripts.canon)');
}

function launchGrill(cwd: string, hasExistingAgentFiles: boolean): void {
    const skillPath = join(cwd, '.claude', 'skills', 'canon-init', 'SKILL.md');

    if (!existsSync(skillPath)) {
        console.log('(grill skill not installed — fill docs manually for now)');
        return;
    }

    console.log('Grill skill installed at .claude/skills/canon-init/SKILL.md\n');
    console.log('To fill your scaffold docs, open Claude Code in this directory and run:\n');
    console.log('  /canon-init\n');
    console.log('Claude will read your codebase, confirm its inferences, and ask targeted');
    console.log('questions to fill all docs in one pass.');
    if (hasExistingAgentFiles) {
        console.log('\nNote: existing AGENTS.md / CLAUDE.md / CODEX.md detected — the grill');
        console.log('will run the merge protocol on them automatically.');
    }
    console.log('');
}

