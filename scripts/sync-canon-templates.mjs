import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { CANON_OWNED, DELIMITED } from '../src/lib/canon-owned.ts';

export const WHOLESALE_SYNC = [...CANON_OWNED, '.codex/config.toml'];
export const DELIMITED_SYNC = DELIMITED;

const CANON_END = '<!-- canon:end -->';
const CANON_START_RE = /<!-- canon:start[^>]* -->/;

/**
 * Merge root-owned canon content with the templates-side outside-delimiter tail.
 */
export function mergeDelimitedForSync(rootContent, templatesContent) {
    if (!CANON_START_RE.test(rootContent)) return null;
    if (!CANON_START_RE.test(templatesContent)) return null;

    const rootEnd = rootContent.indexOf(CANON_END);
    const templatesEnd = templatesContent.indexOf(CANON_END);
    if (rootEnd === -1 || templatesEnd === -1) return null;

    return (
        rootContent.slice(0, rootEnd + CANON_END.length) +
        templatesContent.slice(templatesEnd + CANON_END.length)
    );
}

function getTargetPath(repoRoot, relPath) {
    return join(repoRoot, 'templates', relPath);
}

function getTemplatesRelPath(relPath) {
    return `templates/${relPath}`;
}

function hasCanonMarkers(content) {
    return CANON_START_RE.test(content) && content.indexOf(CANON_END) !== -1;
}

/**
 * Returns `{ plan, errors }`. Errors describe situations where a file
 * pairing CAN'T be synchronized (missing source, missing canon markers on
 * either side of a delimited pair) — distinct from "drift" (which the
 * plan captures). Both block the `--check` gate; errors also block
 * `--apply` / `--stage` from reporting success. Codex P1 on PR #102
 * caught the previous version: it logged these to stderr and continued,
 * so `buildSyncPlan` returned an empty plan and `--check` printed
 * "All canon-managed files in sync" while a corrupted file silently
 * defeated the gate.
 */
function buildSyncPlan(repoRoot) {
    const plan = [];
    const errors = [];

    for (const relPath of WHOLESALE_SYNC) {
        const sourcePath = join(repoRoot, relPath);
        const targetPath = getTargetPath(repoRoot, relPath);
        const targetRel = getTemplatesRelPath(relPath);

        if (!existsSync(sourcePath)) {
            // The source is canon-managed by definition (it's in
            // WHOLESALE_SYNC). Its absence is always an error, whether or
            // not a stale mirror is left behind. Codex P1 (round 2) on
            // PR #102: an earlier revision only flagged this when the
            // mirror existed, so a fully-deleted canon-managed file
            // (e.g., someone removes both `.canon/templates/notes.md`
            // and its mirror without updating CANON_OWNED) slipped past
            // the gate.
            if (existsSync(targetPath)) {
                errors.push(`[wholesale] ${targetRel} exists but source ${relPath} is missing — cannot sync`);
            } else {
                errors.push(`[wholesale] canon-managed source ${relPath} is missing (no source, no mirror — likely deleted without removing from CANON_OWNED)`);
            }
            continue;
        }

        const sourceContent = readFileSync(sourcePath, 'utf8');
        if (!existsSync(targetPath)) {
            plan.push({
                kind: 'wholesale',
                sourceRel: relPath,
                targetRel,
                nextContent: sourceContent,
            });
            continue;
        }

        const targetContent = readFileSync(targetPath, 'utf8');
        if (targetContent === sourceContent) continue;

        plan.push({
            kind: 'wholesale',
            sourceRel: relPath,
            targetRel,
            nextContent: sourceContent,
        });
    }

    for (const relPath of DELIMITED_SYNC) {
        const sourcePath = join(repoRoot, relPath);
        const targetPath = getTargetPath(repoRoot, relPath);
        const targetRel = getTemplatesRelPath(relPath);

        if (!existsSync(sourcePath)) {
            // Same logic as the wholesale loop above — missing canon-managed
            // source is always an error, regardless of mirror state.
            if (existsSync(targetPath)) {
                errors.push(`[delimited] ${targetRel} exists but source ${relPath} is missing — cannot sync`);
            } else {
                errors.push(`[delimited] canon-managed source ${relPath} is missing (no source, no mirror — likely deleted without removing from DELIMITED)`);
            }
            continue;
        }

        const sourceContent = readFileSync(sourcePath, 'utf8');
        const sourceHasMarkers = hasCanonMarkers(sourceContent);

        if (!existsSync(targetPath)) {
            if (!sourceHasMarkers) {
                errors.push(`[delimited] source ${relPath} is missing canon delimiters — cannot create ${targetRel}`);
                continue;
            }
            plan.push({
                kind: 'delimited',
                sourceRel: relPath,
                targetRel,
                nextContent: sourceContent,
            });
            continue;
        }

        const targetContent = readFileSync(targetPath, 'utf8');
        const merged = mergeDelimitedForSync(sourceContent, targetContent);
        if (merged === null) {
            const targetHasMarkers = hasCanonMarkers(targetContent);
            if (!sourceHasMarkers && !targetHasMarkers) {
                errors.push(`[delimited] both ${relPath} and ${targetRel} are missing canon delimiters — cannot sync`);
            } else if (!sourceHasMarkers) {
                errors.push(`[delimited] source ${relPath} is missing canon delimiters — cannot sync ${targetRel}`);
            } else {
                errors.push(`[delimited] ${targetRel} is missing canon delimiters — cannot sync from ${relPath}`);
            }
            continue;
        }

        if (merged === targetContent) continue;

        plan.push({
            kind: 'delimited',
            sourceRel: relPath,
            targetRel,
            nextContent: merged,
        });
    }

    return { plan, errors };
}

function describePlanEntry(entry) {
    if (entry.kind === 'wholesale') {
        return `[wholesale] ${entry.targetRel} differs from ${entry.sourceRel}`;
    }
    return `[delimited] ${entry.targetRel} in-delimiter region differs from ${entry.sourceRel}`;
}

function stageChangedFiles(repoRoot, relPaths) {
    if (relPaths.length === 0) return;

    const result = spawnSync('git', ['add', '--', ...relPaths], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (result.status !== 0) {
        const detail = result.stderr?.trim() || result.stdout?.trim() || 'git add failed';
        throw new Error(detail);
    }
}

export function checkSync(repoRoot) {
    return buildSyncPlan(repoRoot).plan.map(entry => entry.targetRel);
}

/**
 * Returns the list of unsyncable file pairs (missing sources, missing
 * canon markers). Distinct from drift returned by `checkSync` — these
 * pairs CAN'T be synchronized at all, so writers should refuse and
 * the gate must fail. Exported as a peer to `checkSync` so callers
 * can distinguish "drift to fix" from "structural problem to investigate."
 */
export function findSyncErrors(repoRoot) {
    return buildSyncPlan(repoRoot).errors;
}

function applyPlanToDisk(repoRoot, plan) {
    for (const entry of plan) {
        const targetPath = join(repoRoot, entry.targetRel);
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, entry.nextContent, 'utf8');
    }
    return plan.map(entry => entry.targetRel);
}

export function applySync(repoRoot) {
    const { plan } = buildSyncPlan(repoRoot);
    return applyPlanToDisk(repoRoot, plan);
}

export function main(argv = process.argv.slice(2)) {
    const allowedArgs = new Set(['--apply', '--check', '--stage', '--help', '-h']);
    const unknownArgs = argv.filter(arg => !allowedArgs.has(arg));
    const args = new Set(argv);
    const repoRoot = process.cwd();

    if (unknownArgs.length > 0) {
        console.error(`Unknown argument(s): ${unknownArgs.join(' ')}`);
        return 1;
    }

    if (args.has('--help') || args.has('-h')) {
        console.log([
            'Usage: sync-canon-templates [--apply] [--check] [--stage]',
            '',
            '  --apply   Sync root canon-managed content to templates/ (default).',
            '  --check   Report drift without writing files.',
            '  --stage   Sync, then stage changed templates/ files with git add.',
        ].join('\n'));
        return 0;
    }

    if (args.has('--check') && args.has('--stage')) {
        console.error('Cannot combine --check and --stage.');
        return 1;
    }

    if (args.has('--check')) {
        const { plan, errors } = buildSyncPlan(repoRoot);
        for (const message of errors) console.error(message);
        for (const entry of plan) console.error(describePlanEntry(entry));
        if (errors.length > 0 || plan.length > 0) return 1;
        console.log('All canon-managed files in sync');
        return 0;
    }

    // --apply (default) and --stage both surface errors AND apply the
    // valid plan entries. Returning non-zero on errors propagates through
    // the pre-commit hook (`npm run sync-templates -- --stage`) and the
    // CI gate (`--check`) so a corrupted file can't quietly defeat either.
    const { plan, errors } = buildSyncPlan(repoRoot);
    for (const message of errors) console.error(message);
    const changed = applyPlanToDisk(repoRoot, plan);

    if (args.has('--stage')) {
        stageChangedFiles(repoRoot, changed);
    }
    return errors.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main();
}
