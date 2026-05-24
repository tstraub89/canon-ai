import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '../..');

export interface UpgradeOptions {
    /** Dry-run: print the plan and exit without writing any files. */
    check?: boolean;
    /** Overwrite dirty (modified/staged) managed targets. Without this, dirty targets cause the operation to refuse. */
    force?: boolean;
    /** Skip the post-write `git add`. Teams that prefer to stage manually. */
    noStage?: boolean;
}

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
    // First canon-managed file outside .canon/, .claude/, and
    // docs/pipeline-orchestrator.md. Future canon-shipped utility scripts
    // follow the same pattern.
    'scripts/docs-refs-check.mjs',
];

// Header-only sync: canon owns the header (intro + table column definitions);
// adopter owns the rows below the table separator. Used for telemetry files
// that the orchestrator auto-appends to (e.g., docs/pipeline-invocations.md).
// `canon upgrade` refreshes the header without touching the rows.
const HEADER_ONLY_SYNC = [
    'docs/pipeline-invocations.md',
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

// Matches a Markdown table separator row: `|---|---|...|` (with optional
// alignment colons and inline whitespace). Used to find the boundary between
// canon-owned header content (above the separator) and adopter-owned
// telemetry rows (below).
//
// `[^\S\r\n]*` is "whitespace except CR/LF" — important so the match does
// NOT consume the line-ending characters. With `\s*` on both sides, CRLF
// files (Windows checkouts) would consume the trailing `\r`, leaving the
// header slice ending in `\r` and the project tail starting at `\n` — the
// "byte-for-byte rows preserved" guarantee would break. The lookahead
// `(?=\r?\n|$)` anchors to end-of-line without consuming it.
// (Codex P2 on PR #80.)
const TABLE_SEPARATOR_RE = /^[^\S\r\n]*\|[-:|\s]+\|[^\S\r\n]*(?=\r?\n|$)/m;

/**
 * Header-only sync for telemetry files. The template ends at the table
 * separator line (it never contains rows); the project file extends the
 * template with auto-appended rows below the separator. On upgrade:
 *   - Take the new header from the template (everything up to and including
 *     its table separator).
 *   - Take the tail (everything AFTER the separator) from the project,
 *     preserving accumulated telemetry rows byte-for-byte.
 *
 * Returns null if either file is missing a table separator — fail safely
 * rather than corrupt the project's data.
 */
export function mergeHeaderOnly(templateContent: string, projectContent: string): string | null {
    const projectMatch = TABLE_SEPARATOR_RE.exec(projectContent);
    const templateMatch = TABLE_SEPARATOR_RE.exec(templateContent);
    if (!projectMatch || !templateMatch) return null;

    const templateSepEnd = (templateMatch.index ?? 0) + templateMatch[0].length;
    const projectSepEnd = (projectMatch.index ?? 0) + projectMatch[0].length;

    const templateHeader = templateContent.slice(0, templateSepEnd);
    const projectTail = projectContent.slice(projectSepEnd);

    return templateHeader + projectTail;
}

export interface UpgradeResult {
    /** Files actually written this run. Empty under --check, or when dirty targets refused. */
    upgraded: string[];
    /** Files where the project copy already matches the upgrade target. */
    unchanged: string[];
    /** Files not touched (missing template, missing delimiters, etc.) with reason. */
    skipped: string[];
    /** Under --check: files that WOULD be upgraded. Empty otherwise. */
    wouldUpgrade: string[];
    /** Files that would have been upgraded but are dirty in git. Empty under --force. */
    dirtyRefused: string[];
}

/**
 * Returns true if the project's git working tree has any modified/staged
 * changes to `relPath`. Untracked files return false (they don't represent
 * "user work that would be lost"). Returns false if the repo is not a git
 * repo or git is unavailable — treat as clean.
 */
function isPathDirty(cwd: string, relPath: string): boolean {
    const result = spawnSync('git', ['status', '--porcelain', '--', relPath], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.status !== 0 || result.error) return false;
    // Porcelain v1 first two columns: index status, working-tree status. ?? = untracked
    // (we don't refuse on untracked). M, A, D, R, C, T, U in either column = dirty.
    for (const line of (result.stdout ?? '').split('\n')) {
        if (!line.trim()) continue;
        const xy = line.slice(0, 2);
        if (xy === '??') continue;
        return true;
    }
    return false;
}

export function runUpgrade(cwd: string, pkgDir: string, options: UpgradeOptions = {}): UpgradeResult {
    const upgraded: string[] = [];
    const unchanged: string[] = [];
    const skipped: string[] = [];
    const wouldUpgrade: string[] = [];
    const dirtyRefused: string[] = [];

    // Compute the would-write content for every managed file. Don't write yet —
    // we need the full would-change list to (a) report under --check, and (b)
    // refuse the whole operation if any target is dirty without --force.
    type WriteOp = { rel: string; projectPath: string; content: string };
    const pending: WriteOp[] = [];

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

        pending.push({ rel, projectPath, content: merged });
    }

    // --- Header-only sync (telemetry files) ---
    // Refresh the canon-owned header above the table separator; preserve
    // appended telemetry rows below it byte-for-byte. Skipped if the project
    // file's table separator can't be located (treat as corrupted; don't
    // risk data loss).
    for (const rel of HEADER_ONLY_SYNC) {
        const projectPath = join(cwd, rel);
        const templatePath = join(pkgDir, 'templates', rel);

        if (!existsSync(templatePath)) {
            skipped.push(rel);
            continue;
        }
        const templateContent = readFileSync(templatePath, 'utf8');

        if (!existsSync(projectPath)) {
            // First-install / missing: scaffold the template wholesale.
            // Queued like every other write so --check / dirty-refusal apply.
            pending.push({ rel, projectPath, content: templateContent });
            continue;
        }

        const projectContent = readFileSync(projectPath, 'utf8');
        const merged = mergeHeaderOnly(templateContent, projectContent);

        if (merged === null) {
            skipped.push(`${rel} (no markdown table separator found — header-only sync needs the rows-below boundary)`);
            continue;
        }
        if (merged === projectContent) {
            unchanged.push(rel);
            continue;
        }

        pending.push({ rel, projectPath, content: merged });
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
        }

        pending.push({ rel, projectPath, content: templateContent });
    }

    // .canon/version — also subject to the dirty check.
    const versionPath = join(cwd, '.canon', 'version');
    const newVersion = process.env.CANON_VERSION ?? 'dev';
    const currentVersion = existsSync(versionPath) ? readFileSync(versionPath, 'utf8').trim() : null;
    if (currentVersion !== newVersion) {
        pending.push({ rel: '.canon/version', projectPath: versionPath, content: newVersion + '\n' });
    }

    // Dirty-target detection: any pending write whose project path has
    // tracked changes in git becomes a refusal (unless --force). Untracked
    // files don't count (no committed history to lose). We always ask git
    // — including for paths that don't exist on disk — because `git status`
    // is the authoritative source: a managed file deleted locally (or
    // renamed out of the way) is still a tracked change that should refuse
    // recreation, even though `existsSync()` returns false. Caught by Codex
    // P1 on the original `existsSync && isPathDirty` gate.
    const dirty: WriteOp[] = [];
    const clean: WriteOp[] = [];
    for (const op of pending) {
        if (isPathDirty(cwd, op.rel)) dirty.push(op);
        else clean.push(op);
    }

    if (options.check) {
        // Dry-run: report what would change, including dirty conflicts.
        for (const op of clean) wouldUpgrade.push(op.rel);
        for (const op of dirty) dirtyRefused.push(op.rel);
        return { upgraded, unchanged, skipped, wouldUpgrade, dirtyRefused };
    }

    if (dirty.length > 0 && !options.force) {
        // Refuse: don't write ANY pending op. Report the dirty list so the
        // caller can surface it and the operator can decide.
        for (const op of dirty) dirtyRefused.push(op.rel);
        return { upgraded, unchanged, skipped, wouldUpgrade, dirtyRefused };
    }

    // Write — every pending op when --force, else only the clean ones (no
    // dirty since the early-return above already covered that path).
    const toWrite = options.force ? pending : clean;
    for (const op of toWrite) {
        mkdirSync(dirname(op.projectPath), { recursive: true });
        writeFileSync(op.projectPath, op.content);
        upgraded.push(op.rel);
    }

    return { upgraded, unchanged, skipped, wouldUpgrade, dirtyRefused };
}

export function parseUpgradeArgs(args: string[]): UpgradeOptions {
    const options: UpgradeOptions = {};
    for (const arg of args) {
        if (arg === '--check' || arg === '--dry-run') options.check = true;
        else if (arg === '--force') options.force = true;
        else if (arg === '--no-stage') options.noStage = true;
        else {
            throw new Error(`canon upgrade: unknown flag '${arg}'. Supported: --check (--dry-run), --force, --no-stage.`);
        }
    }
    return options;
}

export function upgradeCmd(args: string[]): void {
    const options = parseUpgradeArgs(args);
    const result = runUpgrade(process.cwd(), packageDir, options);
    const { upgraded, unchanged, skipped, wouldUpgrade, dirtyRefused } = result;

    console.log('\ncanon upgrade' + (options.check ? ' --check' : '') + '\n');

    // --check / --dry-run mode: report the plan, do not write or stage.
    if (options.check) {
        if (wouldUpgrade.length > 0) {
            console.log('Would update:');
            for (const f of wouldUpgrade) console.log(`  ↑ ${f}`);
            console.log('');
        }
        if (dirtyRefused.length > 0) {
            console.log('Would refuse (dirty in git — pass --force to overwrite):');
            for (const f of dirtyRefused) console.log(`  ⚠ ${f}`);
            console.log('');
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
        if (wouldUpgrade.length === 0 && dirtyRefused.length === 0 && unchanged.length === 0 && skipped.length === 0) {
            console.log('No canon-managed files found. Run `canon init` to set up canon in this repo.\n');
        } else {
            console.log('(dry run — no files written.) Re-run without --check to apply.\n');
        }
        return;
    }

    // Refusal path: dirty managed targets without --force.
    if (dirtyRefused.length > 0) {
        console.log('Refused (dirty in git — pass --force to overwrite, or commit/stash these paths first):');
        for (const f of dirtyRefused) console.log(`  ⚠ ${f}`);
        console.log('');
        console.log('No files were upgraded. Resolve the dirty paths and re-run, or pass `--force`.');
        // Surface as a non-zero exit so scripts can detect.
        process.exit(2);
    }

    // Stage all changed files (default behavior; --no-stage opts out).
    if (upgraded.length > 0 && !options.noStage) {
        const r = spawnSync('git', ['add', ...upgraded], { cwd: process.cwd(), stdio: 'inherit' });
        if (r.status !== 0) {
            console.error('\nwarning: failed to stage changes — run `git add` manually.');
        }
    }

    if (upgraded.length > 0) {
        console.log('Updated:');
        for (const f of upgraded) console.log(`  ↑ ${f}`);
        if (!options.noStage) {
            console.log('\nReview:  git diff --staged');
            console.log('Revert:  git checkout -- <file>\n');
        } else {
            console.log('\n(--no-stage: files written but not staged. Review:  git diff)');
            console.log('Stage:   git add <file>\n');
        }
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
