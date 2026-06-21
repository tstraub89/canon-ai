import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path, { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CANON_GITIGNORE_BLOCK } from '../src/lib/canon-block.ts';
import { CANON_OWNED, DELIMITED } from '../src/lib/canon-owned.ts';

export const WHOLESALE_SYNC = [...CANON_OWNED];
export const DELIMITED_SYNC = DELIMITED;

const CANON_END = '<!-- canon:end -->';
const CANON_START_RE = /<!-- canon:start[^>]* -->/;

// Canon's own orchestrator source trees. Backtick refs to anything under
// these prefixes inside canon-managed content (CANON_OWNED files or the
// canon:start..canon:end region of DELIMITED files) break on adopter
// repos — those files don't exist there. The leak surfaces as broken
// refs in `docs-refs-check.mjs` at adopter upgrade time; this guard
// catches it on the canon-ai-dev side before sync, so the leak never
// reaches `templates/`. Extend this list if a future split adds a new
// canon-internal source tree. Adopter-visible paths (`tasks/<id>/...`,
// `docs/patterns.md`, `status.json`, etc.) are NOT canon-internal and
// must not be added here.
export const CANON_INTERNAL_PATH_PREFIXES = ['scripts/run-task/'];

const CANON_AI_ROOT = path.resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readMarkdownBasenames(dir) {
    if (!existsSync(dir)) return [];
    // Exclude a subdirectory named `*.md` from the basename set (it would
    // produce a false-positive leak flag). Use a real statSync rather than
    // readdirSync({ withFileTypes }) — dirent type metadata is UNKNOWN on
    // some network/bind mounts, which would collapse the set to empty and
    // silently drop leak coverage; statSync is reliable everywhere.
    return readdirSync(dir)
        .filter(name => name.endsWith('.md') && statSync(join(dir, name)).isFile());
}

export const INTERNAL_ONLY_TEMPLATE_BASENAMES = new Set(
    (() => {
        const internalBasenames = readMarkdownBasenames(join(CANON_AI_ROOT, 'scripts/run-task/prompts/templates'));
        const canonBasenames = new Set(readMarkdownBasenames(join(CANON_AI_ROOT, '.canon/templates')));
        return internalBasenames.filter(name => !canonBasenames.has(name));
    })(),
);

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

function isCanonInternalTarget(target, sourceRel) {
    // Canon-ai-dev convention: refs are repo-root-relative
    // (e.g., `scripts/run-task/main.ts` in any doc, at any depth).
    if (CANON_INTERNAL_PATH_PREFIXES.some(prefix => target.startsWith(prefix))) {
        return true;
    }
    if (!target.includes('/') && INTERNAL_ONLY_TEMPLATE_BASENAMES.has(target)) {
        return true;
    }
    // Also normalize source-file-relative refs (e.g., `../scripts/run-task/...`
    // from a nested doc like `docs/pipeline-orchestrator.md`). Codex P2 on the
    // 1.6.1 hotfix-leak diff flagged this bypass — without normalization, a
    // maintainer could slip a canon-internal ref past the literal-prefix
    // check by using a relative form.
    if (target.startsWith('http://') || target.startsWith('https://')) return false;
    if (target.startsWith('/')) return false;
    const sourceDir = path.posix.dirname(sourceRel);
    const resolved = path.posix.normalize(path.posix.join(sourceDir, target));
    // Reject paths that escape repo root — they can't resolve to a
    // canon-internal file in this checkout.
    if (resolved.startsWith('..')) return false;
    return CANON_INTERNAL_PATH_PREFIXES.some(prefix => resolved.startsWith(prefix));
}

/**
 * Scan markdown content for backtick refs to canon-internal source paths.
 * Returns `[{ line, target }, ...]` with line numbers 1-based, relative to
 * the start of `content`. Skips code-fenced blocks (``` and ~~~) so example
 * snippets in fenced regions are not flagged. `sourceRel` is the
 * repo-relative POSIX path of the file the content came from — used to
 * resolve source-file-relative refs (`../scripts/run-task/...`) before
 * the canon-internal prefix check. Callers that scan only a subset of a
 * file (e.g., the canon:start..canon:end region) must offset the
 * returned line numbers themselves.
 */
function findCanonInternalRefs(content, sourceRel) {
    const findings = [];
    const lines = content.split(/\r?\n/);
    let inFence = false;
    for (let i = 0; i < lines.length; i += 1) {
        const trimmed = lines[i].trim();
        if (/^(```|~~~)/.test(trimmed)) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;
        for (const match of lines[i].matchAll(/`([^`]+)`/g)) {
            if (isCanonInternalTarget(match[1], sourceRel)) {
                findings.push({ line: i + 1, target: match[1] });
            }
        }
    }
    return findings;
}

/**
 * Run `findCanonInternalRefs` over a substring of `content` (chars
 * `[startIdx, endIdx)`) and return findings with line numbers offset to
 * the whole-file frame so error messages cite the actual line a
 * maintainer would open in their editor.
 */
function scanRegionForCanonInternalRefs(content, startIdx, endIdx, sourceRel) {
    if (endIdx <= startIdx) return [];
    const before = content.slice(0, startIdx);
    const region = content.slice(startIdx, endIdx);
    const leadingLines = before.split(/\r?\n/).length - 1;
    return findCanonInternalRefs(region, sourceRel).map(finding => ({
        line: finding.line + leadingLines,
        target: finding.target,
    }));
}

function describeLeakTarget(target) {
    if (!target.includes('/') && INTERNAL_ONLY_TEMPLATE_BASENAMES.has(target)) {
        return `\`${target}\` is an internal-only prompt-template filename — adopters don't have this file; reference the phase name instead of the template filename`;
    }
    return `\`${target}\` is canon-internal and must not appear in canon-managed content (adopters don't have this file; ref would break their docs-refs-check at upgrade time)`;
}

/**
 * Scan only the canon:start..canon:end region of a DELIMITED file.
 * Returns `[]` if the file lacks valid delimiters (a separate structural
 * error is raised elsewhere in `buildSyncPlan`).
 */
function findCanonInternalRefsInDelimitedRegion(content, sourceRel) {
    const startMatch = content.match(CANON_START_RE);
    if (!startMatch) return [];
    const endIdx = content.indexOf(CANON_END);
    if (endIdx === -1) return [];
    return scanRegionForCanonInternalRefs(content, startMatch.index + startMatch[0].length, endIdx, sourceRel);
}

/**
 * Scan the preserved tail (everything after `<!-- canon:end -->`) of a
 * DELIMITED file. The tail in `templates/<file>` ships to adopters as
 * their default starting content below the canon-managed region — a
 * canon-internal ref there still leaks even though it's outside the
 * synced canon-region. Codex P2 on the 1.6.1 hotfix-leak diff caught
 * this: scanning only the source canon-region missed
 * `mergeDelimitedForSync`'s tail-preservation path.
 *
 * Callers pass `templates/<file>` content here; the root source tail is
 * canon-ai-dev local-only and never ships, so scanning it would only
 * produce false positives.
 */
function findCanonInternalRefsInDelimitedTail(content, sourceRel) {
    const endIdx = content.indexOf(CANON_END);
    if (endIdx === -1) return [];
    return scanRegionForCanonInternalRefs(content, endIdx + CANON_END.length, content.length, sourceRel);
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

    const gitignoreTargetRel = 'templates/.gitignore';
    const gitignoreTargetPath = join(repoRoot, gitignoreTargetRel);
    if (!existsSync(gitignoreTargetPath) || readFileSync(gitignoreTargetPath, 'utf8') !== CANON_GITIGNORE_BLOCK) {
        plan.push({
            kind: 'gitignore',
            sourceRel: 'src/lib/canon-block.ts',
            targetRel: gitignoreTargetRel,
            nextContent: CANON_GITIGNORE_BLOCK,
        });
    }

    // Third pass: canon-internal-leak scan. Catches the class of mistake
    // where a maintainer adds a `scripts/run-task/...` ref to a canon-managed
    // doc (good for canon-ai-dev navigation, broken for adopters since
    // those files don't ship). Pre-1.6.1 release path: 4 such refs leaked
    // into 1.6.0 and broke `docs-refs-check.mjs` on first adopter upgrade.
    // Scanned set: WHOLESALE_SYNC markdown (.md) files in full, and the
    // canon:start..canon:end region of DELIMITED files. JSON/template
    // entries in WHOLESALE_SYNC (e.g., `.canon/templates/status.json`) are
    // skipped — the backtick-ref grammar is markdown-specific.
    for (const relPath of WHOLESALE_SYNC) {
        if (!relPath.endsWith('.md')) continue;
        const sourcePath = join(repoRoot, relPath);
        if (!existsSync(sourcePath)) continue;
        const content = readFileSync(sourcePath, 'utf8');
        for (const leak of findCanonInternalRefs(content, relPath)) {
            errors.push(`[canon-internal-leak] ${relPath}:${leak.line} — ${describeLeakTarget(leak.target)}`);
        }
    }

    for (const relPath of DELIMITED_SYNC) {
        if (!relPath.endsWith('.md')) continue;
        const sourcePath = join(repoRoot, relPath);
        if (existsSync(sourcePath)) {
            const sourceContent = readFileSync(sourcePath, 'utf8');
            for (const leak of findCanonInternalRefsInDelimitedRegion(sourceContent, relPath)) {
                errors.push(`[canon-internal-leak] ${relPath}:${leak.line} — ${describeLeakTarget(leak.target)}`);
            }
        }
        // The templates-side tail (post canon:end) ships verbatim to
        // adopters as their default starting content. A canon-internal
        // ref there leaks even though it's outside the synced canon-region.
        const targetRel = getTemplatesRelPath(relPath);
        const targetPath = getTargetPath(repoRoot, relPath);
        if (existsSync(targetPath)) {
            const targetContent = readFileSync(targetPath, 'utf8');
            for (const leak of findCanonInternalRefsInDelimitedTail(targetContent, targetRel)) {
                errors.push(`[canon-internal-leak] ${targetRel}:${leak.line} — ${describeLeakTarget(leak.target)}`);
            }
        } else if (existsSync(sourcePath)) {
            // First-create path: `buildSyncPlan` writes the full source
            // content (including its post-canon:end tail) to a missing
            // template. Canon-internal refs in the source tail are
            // legitimate there (canon-ai-dev local notes), but they'd
            // ship to adopters as the new template tail on first-create.
            // Codex P1 on the 1.6.1 hotfix-leak diff: scanning only the
            // existing template tail missed this case entirely.
            const sourceContent = readFileSync(sourcePath, 'utf8');
            for (const leak of findCanonInternalRefsInDelimitedTail(sourceContent, relPath)) {
                errors.push(
                    `[canon-internal-leak] ${relPath}:${leak.line} — ${describeLeakTarget(leak.target)}; in the source tail it would ship as ${targetRel}'s default tail on first-create (move the ref above \`<!-- canon:end -->\` only if it should be canon-managed, otherwise drop it or create ${targetRel} manually with the desired adopter-default tail)`,
                );
            }
        }
    }

    return { plan, errors };
}

function describePlanEntry(entry) {
    if (entry.kind === 'wholesale') {
        return `[wholesale] ${entry.targetRel} differs from ${entry.sourceRel}`;
    }
    if (entry.kind === 'gitignore') {
        return `[gitignore] ${entry.targetRel} differs from CANON_GITIGNORE_BLOCK`;
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
