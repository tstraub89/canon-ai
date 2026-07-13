import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { basename, dirname, join, relative, resolve } from 'path';
import { spawnSync } from 'child_process';
import { CANON_OWNED, DELIMITED } from '../../lib/canon-owned.js';
import { CANON_GITIGNORE_BLOCK, upsertCanonBlock } from '../../lib/canon-block.js';
import { taskTemplateOverrideRoot } from '../../task/index.js';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '../..');

export interface UpgradeOptions {
    /** Dry-run: print the plan and exit without writing any files. */
    check?: boolean;
    /** Overwrite refused managed targets. Without this, unsafe destinations cause the operation to refuse. */
    force?: boolean;
    /** Skip the post-write `git add`. Teams that prefer to stage manually. */
    noStage?: boolean;
}

export const CANON_END = '<!-- canon:end -->';
export const CANON_START_RE = /<!-- canon:start[^>]* -->/;

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

function printDocsRefsCutoverWarning(cutoverWarnings: string[], check: boolean): void {
    if (cutoverWarnings.length === 0) return;
    // The pre-split checker hardcoded VALID_DIRS / NOISY_SOURCE_PATHS /
    // MARKDOWN_ROOT_DIRS inline. The checker is canon-owned, so it (and its
    // .d.ts) overwrite in place — we no longer defer the upgrade. We DO warn,
    // because an adopter who hand-edited those inline arrays needs to migrate
    // them into the scaffolded scripts/docs-refs-config.mjs; the old inline
    // values are recoverable from git history.
    console.log(`Heads-up: pre-split docs-refs checker ${check ? 'would be' : 'was'} replaced (inline config superseded by scripts/docs-refs-config.mjs):`);
    for (const f of cutoverWarnings) console.log(`  ↻ ${f}`);
    console.log('');
    console.log('  If you hand-edited VALID_DIRS / NOISY_SOURCE_PATHS / MARKDOWN_ROOT_DIRS in the old');
    console.log('  checker, inspect the diff and move any custom entries into scripts/docs-refs-config.mjs:');
    if (check) {
        console.log('    (after upgrading) git diff HEAD -- scripts/docs-refs-check.mjs\n');
    } else {
        console.log('    git diff HEAD -- scripts/docs-refs-check.mjs      # what changed');
        console.log('    git show HEAD:scripts/docs-refs-check.mjs         # the pre-upgrade checker\n');
    }
}

export function printStaleOverrideNudge(staleOverrides: string[], check: boolean): void {
    if (staleOverrides.length === 0) return;
    console.log(`Heads-up: canon templates ${check ? 'that would be changed by this upgrade' : 'changed by this upgrade'} have customized task-template overrides that ${check ? 'would not be auto-updated' : 'were not auto-updated'}:`);
    console.log('  These override files were NOT updated automatically; review them manually:');
    for (const overridePath of staleOverrides) {
        const name = basename(overridePath);
        console.log(`  ↻ ${overridePath}`);
        console.log(`    diff .canon/templates/${name} ${overridePath}`);
    }
    console.log('');
}

type WriteOp = { rel: string; projectPath: string; content: string };

function getTaskTemplateBasenames(): string[] {
    return CANON_OWNED
        .filter(rel => rel.startsWith('.canon/templates/'))
        .map(rel => basename(rel));
}

function getStaleOverrides(cwd: string, changedOps: ReadonlyArray<WriteOp>): string[] {
    const changedByRel = new Map(changedOps.map(op => [op.rel, op.content]));
    if (changedByRel.size === 0) return [];

    const templateBasenames = getTaskTemplateBasenames();
    const overrideRootAbs = resolve(cwd, taskTemplateOverrideRoot());
    const staleOverrides: string[] = [];

    for (const name of templateBasenames) {
        const canonRel = `.canon/templates/${name}`;
        const newTemplateContent = changedByRel.get(canonRel);
        if (newTemplateContent === undefined) continue;

        const overridePathAbs = join(overrideRootAbs, name);
        if (!existsSync(overridePathAbs)) continue;

        const overrideContent = readFileSync(overridePathAbs, 'utf8');
        if (overrideContent === newTemplateContent) continue;

        staleOverrides.push(relative(cwd, overridePathAbs));
    }

    return staleOverrides;
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
    /** Union of all refusal buckets in `refusals`. Empty under --force. */
    dirtyRefused: string[];
    /** Files refused by destination safety class. Empty under --force. */
    refusals: {
        /** Tracked by git with staged/unstaged changes, including local deletion. */
        trackedDirty: string[];
        /** Exists on disk but is not tracked by git, including gitignored files. */
        untrackedExisting: string[];
        /** Exists on disk but git state could not be verified. */
        unverifiable: string[];
    };
    /** Files with malformed canon markers that cannot be safely rewritten. */
    malformed: string[];
    /** Pre-split docs-refs checkers overwritten this run whose adopter should
     *  migrate inline customizations into docs-refs-config.mjs. */
    cutoverWarnings: string[];
    /** Task-template overrides that differ from canon templates changed by this upgrade run. */
    staleOverrides: string[];
}

type DestinationClass = 'absent' | 'tracked-clean' | 'tracked-dirty' | 'untracked-existing' | 'unverifiable';

/**
 * Classifies pending upgrade destinations by whether canon can write them
 * safely: absent and tracked-clean paths may be written; tracked-dirty,
 * untracked-existing, and unverifiable paths are refused unless --force.
 *
 * Git is the safety boundary for existing non-identical content, so git
 * failures classify existing paths as unverifiable. Dirty status is checked
 * before trackedness so a staged deletion (`git rm`) remains tracked-dirty
 * instead of falling through to absent. Trackedness is then checked before
 * on-disk existence so an unstaged local deletion also remains tracked-dirty.
 * Untracked-existing includes gitignored files, which single-path porcelain
 * output alone cannot distinguish from tracked-clean.
 */
function classifyDestinations(cwd: string, relPaths: readonly string[]): Map<string, DestinationClass> {
    const classes = new Map<string, DestinationClass>();
    const uniqueRelPaths = [...new Set(relPaths)];
    if (uniqueRelPaths.length === 0) return classes;

    const probe = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const gitAvailable = probe.status === 0 && !probe.error && probe.stdout.trim() === 'true';
    if (!gitAvailable) {
        for (const rel of uniqueRelPaths) {
            classes.set(rel, existsSync(join(cwd, rel)) ? 'unverifiable' : 'absent');
        }
        return classes;
    }

    const lsFiles = spawnSync('git', ['ls-files', '-z', '--', ...uniqueRelPaths], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const status = spawnSync('git', ['status', '--porcelain=v1', '-z', '--', ...uniqueRelPaths], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });

    if (lsFiles.status !== 0 || lsFiles.error || status.status !== 0 || status.error) {
        for (const rel of uniqueRelPaths) {
            classes.set(rel, existsSync(join(cwd, rel)) ? 'unverifiable' : 'absent');
        }
        return classes;
    }

    const tracked = new Set((lsFiles.stdout ?? '').split('\0').filter(Boolean));
    const dirty = new Set<string>();
    const statusEntries = (status.stdout ?? '').split('\0');
    for (let i = 0; i < statusEntries.length; i += 1) {
        const entry = statusEntries[i];
        if (!entry) continue;
        const xy = entry.slice(0, 2);
        const rel = entry.slice(3);
        if (xy !== '??') dirty.add(rel);
        if (xy[0] === 'R' || xy[0] === 'C') i += 1;
    }

    for (const rel of uniqueRelPaths) {
        if (dirty.has(rel)) {
            classes.set(rel, 'tracked-dirty');
            continue;
        }
        if (!tracked.has(rel)) {
            classes.set(rel, existsSync(join(cwd, rel)) ? 'untracked-existing' : 'absent');
            continue;
        }
        classes.set(rel, dirty.has(rel) ? 'tracked-dirty' : 'tracked-clean');
    }
    return classes;
}

function emptyRefusals(): UpgradeResult['refusals'] {
    return {
        trackedDirty: [],
        untrackedExisting: [],
        unverifiable: [],
    };
}

export function printUpgradeRefusals(refusals: UpgradeResult['refusals'], prefix: 'Would refuse' | 'Refused'): void {
    if (refusals.trackedDirty.length > 0) {
        console.log(`${prefix} — tracked and locally modified (commit/stash first, or pass --force):`);
        for (const f of refusals.trackedDirty) console.log(`  ⚠ ${f}`);
        console.log('');
    }
    if (refusals.untrackedExisting.length > 0) {
        console.log(`${prefix} — exists but not tracked by git (git could not restore it after an overwrite; commit it, move it aside, or pass --force):`);
        for (const f of refusals.untrackedExisting) console.log(`  ⚠ ${f}`);
        console.log('');
    }
    if (refusals.unverifiable.length > 0) {
        console.log(`${prefix} — git state could not be verified (git is canon upgrade's safety boundary; repair git or run inside a git repo, or pass --force):`);
        for (const f of refusals.unverifiable) console.log(`  ⚠ ${f}`);
        console.log('');
    }
}

export function runUpgrade(cwd: string, pkgDir: string, options: UpgradeOptions = {}): UpgradeResult {
    const upgraded: string[] = [];
    const unchanged: string[] = [];
    const skipped: string[] = [];
    const wouldUpgrade: string[] = [];
    const dirtyRefused: string[] = [];
    const refusals = emptyRefusals();
    const malformed: string[] = [];
    const cutoverWarnings: string[] = [];

    // Compute the would-write content for every managed file. Don't write yet —
    // we need the full would-change list to (a) report under --check, and (b)
    // refuse the whole operation if any target is dirty without --force.
    const pending: WriteOp[] = [];

    // --- Delimited files ---
    const delimitedFiles: readonly string[] = DELIMITED;
    for (const rel of delimitedFiles) {
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

    const docsRefsCheckRel = 'scripts/docs-refs-check.mjs';
    const docsRefsConfigRel = 'scripts/docs-refs-config.mjs';
    const docsRefsCheckPath = join(cwd, docsRefsCheckRel);
    const docsRefsConfigPath = join(cwd, docsRefsConfigRel);
    const docsRefsCheckContent = existsSync(docsRefsCheckPath) ? readFileSync(docsRefsCheckPath, 'utf8') : null;
    const docsRefsConfigExists = existsSync(docsRefsConfigPath);
    const docsRefsConfigTemplatePath = join(pkgDir, 'templates', docsRefsConfigRel);
    const docsRefsConfigTemplateContent = existsSync(docsRefsConfigTemplatePath)
        ? readFileSync(docsRefsConfigTemplatePath, 'utf8')
        : null;
    // "Pre-split" = the old checker that hardcoded its config inline and never
    // imports docs-refs-config.mjs. This is independent of whether the config
    // file already exists: a repo can carry an old inline checker alongside a
    // scaffolded config (an interrupted prior upgrade, or a manual scaffold),
    // and that adopter STILL needs the migration heads-up because their inline
    // customizations are trapped in the checker about to be overwritten.
    const isPreSplitDocsRefs =
        docsRefsCheckContent !== null &&
        !docsRefsCheckContent.includes('./docs-refs-config.mjs');

    // Pre-split cutover: the old checker hardcoded its config inline. The new
    // checker (and its .d.ts) are canon-owned and overwrite in place through the
    // CANON_OWNED loop above — we do NOT defer the overwrite. Deferring left the
    // freshly-upgraded .d.ts declaring an API the held-back .mjs lacked, and
    // forced a confusing second `canon upgrade`. Instead we overwrite now and
    // warn the adopter to migrate any inline customizations (recoverable from
    // git history) into the scaffolded docs-refs-config.mjs.
    if (isPreSplitDocsRefs) {
        cutoverWarnings.push(docsRefsCheckRel);
    }

    // .canon/version — also subject to the dirty check.
    const versionPath = join(cwd, '.canon', 'version');
    const newVersion = process.env.CANON_VERSION ?? 'dev';
    const currentVersion = existsSync(versionPath) ? readFileSync(versionPath, 'utf8').trim() : null;
    if (currentVersion !== newVersion) {
        pending.push({ rel: '.canon/version', projectPath: versionPath, content: newVersion + '\n' });
    }

    // .gitignore — canon owns only the runtime-file block. Queue any write
    // through the same pending path as other managed files so dirty refusal,
    // --check, --force, and --no-stage stay uniform.
    const gitignoreRel = '.gitignore';
    const gitignorePath = join(cwd, gitignoreRel);
    const existingGitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
    const desiredGitignore = upsertCanonBlock(existingGitignore, CANON_GITIGNORE_BLOCK);
    if (desiredGitignore === null) {
        malformed.push(gitignoreRel);
    } else if (desiredGitignore === existingGitignore) {
        unchanged.push(gitignoreRel);
    } else {
        pending.push({ rel: gitignoreRel, projectPath: gitignorePath, content: desiredGitignore });
    }

    const destinationClasses = classifyDestinations(cwd, [
        ...pending.map(op => op.rel),
        docsRefsConfigRel,
    ]);

    if (docsRefsConfigTemplateContent === null) {
        if (!docsRefsConfigExists) {
            skipped.push(`${docsRefsConfigRel} (missing template for cutover scaffold)`);
        }
    } else {
        const docsRefsConfigClass = destinationClasses.get(docsRefsConfigRel);
        if (docsRefsConfigClass === 'absent') {
            pending.push({ rel: docsRefsConfigRel, projectPath: docsRefsConfigPath, content: docsRefsConfigTemplateContent });
        } else if (!docsRefsConfigExists) {
            // Locally deleted tracked config: queue it so the shared classifier
            // refuses it instead of silently recreating adopter-owned state.
            pending.push({ rel: docsRefsConfigRel, projectPath: docsRefsConfigPath, content: docsRefsConfigTemplateContent });
        } else {
            const existingConfigContent = readFileSync(docsRefsConfigPath, 'utf8');
            if (
                existingConfigContent !== docsRefsConfigTemplateContent &&
                (docsRefsConfigClass === 'untracked-existing' || docsRefsConfigClass === 'unverifiable')
            ) {
                pending.push({ rel: docsRefsConfigRel, projectPath: docsRefsConfigPath, content: docsRefsConfigTemplateContent });
            }
        }
    }

    // Destination classification: classify every pending write before writing
    // anything, then refuse the whole run if any unsafe destination appears.
    const clean: WriteOp[] = [];
    const trackedDirtyOps: WriteOp[] = [];
    const untrackedExistingOps: WriteOp[] = [];
    const unverifiableOps: WriteOp[] = [];
    for (const op of pending) {
        switch (destinationClasses.get(op.rel)) {
            case 'tracked-dirty':
                trackedDirtyOps.push(op);
                break;
            case 'untracked-existing':
                untrackedExistingOps.push(op);
                break;
            case 'unverifiable':
                unverifiableOps.push(op);
                break;
            case 'absent':
            case 'tracked-clean':
                clean.push(op);
                break;
            default:
                unverifiableOps.push(op);
                break;
        }
    }
    const dirty: WriteOp[] = [...trackedDirtyOps, ...untrackedExistingOps, ...unverifiableOps];
    refusals.trackedDirty.push(...trackedDirtyOps.map(op => op.rel));
    refusals.untrackedExisting.push(...untrackedExistingOps.map(op => op.rel));
    refusals.unverifiable.push(...unverifiableOps.map(op => op.rel));

    if (options.check) {
        // Dry-run: report what would change, including dirty conflicts.
        const staleOverrides = getStaleOverrides(cwd, clean);
        for (const op of clean) wouldUpgrade.push(op.rel);
        for (const op of dirty) dirtyRefused.push(op.rel);
        return { upgraded, unchanged, skipped, wouldUpgrade, dirtyRefused, refusals, malformed, cutoverWarnings, staleOverrides };
    }

    if (dirty.length > 0 && !options.force) {
        // Refuse: don't write ANY pending op. Report the dirty list so the
        // caller can surface it and the operator can decide.
        for (const op of dirty) dirtyRefused.push(op.rel);
        return { upgraded, unchanged, skipped, wouldUpgrade, dirtyRefused, refusals, malformed, cutoverWarnings, staleOverrides: [] };
    }

    // Compare the canon task templates actually written by this run against
    // the project's override root. Under --force that includes dirty writes;
    // otherwise it's just the clean subset. If the run refused above, the
    // changed set is empty and we returned staleOverrides: [].
    const reportedWrites = options.force ? pending : clean;
    const staleOverrides = getStaleOverrides(cwd, reportedWrites);

    // Write — every pending op when --force, else only the clean ones (no
    // dirty since the early-return above already covered that path).
    const toWrite = options.force ? pending : clean;
    for (const op of toWrite) {
        mkdirSync(dirname(op.projectPath), { recursive: true });
        writeFileSync(op.projectPath, op.content);
        upgraded.push(op.rel);
    }

    return { upgraded, unchanged, skipped, wouldUpgrade, dirtyRefused, refusals: emptyRefusals(), malformed, cutoverWarnings, staleOverrides };
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
    const { upgraded, unchanged, skipped, wouldUpgrade, dirtyRefused, refusals, malformed, cutoverWarnings, staleOverrides } = result;

    console.log('\ncanon upgrade' + (options.check ? ' --check' : '') + '\n');

    // --check / --dry-run mode: report the plan, do not write or stage.
    if (options.check) {
        if (wouldUpgrade.length > 0) {
            console.log('Would update:');
            for (const f of wouldUpgrade) console.log(`  ↑ ${f}`);
            console.log('');
        }
        if (cutoverWarnings.length > 0) {
            printDocsRefsCutoverWarning(cutoverWarnings, true);
        }
        if (staleOverrides.length > 0) {
            printStaleOverrideNudge(staleOverrides, true);
        }
        printUpgradeRefusals(refusals, 'Would refuse');
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
        if (malformed.length > 0) {
            console.log('Malformed (manual fix needed):');
            for (const f of malformed) {
                console.log(`  ⚠ ${f} — \`# canon:start\` has no \`# canon:end\`; add it manually, then re-run upgrade`);
            }
            console.log('');
        }
        if (wouldUpgrade.length === 0 && dirtyRefused.length === 0 && unchanged.length === 0 && skipped.length === 0 && malformed.length === 0) {
            console.log('No canon-managed files found. Run `canon init` to set up canon in this repo.\n');
        } else {
            console.log('(dry run — no files written.) Re-run without --check to apply.\n');
        }
        return;
    }

    // Refusal path: unsafe managed targets without --force.
    if (dirtyRefused.length > 0) {
        printUpgradeRefusals(refusals, 'Refused');
        if (malformed.length > 0) {
            console.log('Malformed (manual fix needed):');
            for (const f of malformed) {
                console.log(`  ⚠ ${f} — \`# canon:start\` has no \`# canon:end\`; add it manually, then re-run upgrade`);
            }
            console.log('');
        }
        console.log('No files were upgraded. Resolve the refused paths and re-run, or pass `--force`.');
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
            console.log('Revert:  git checkout HEAD -- <file>\n');
        } else {
            console.log('\n(--no-stage: files written but not staged. Review:  git diff)');
            console.log('Stage:   git add <file>\n');
        }
    }
    if (cutoverWarnings.length > 0) {
        printDocsRefsCutoverWarning(cutoverWarnings, false);
    }
    if (staleOverrides.length > 0) {
        printStaleOverrideNudge(staleOverrides, false);
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
    if (malformed.length > 0) {
        console.log('Malformed (manual fix needed):');
        for (const f of malformed) {
            console.log(`  ⚠ ${f} — \`# canon:start\` has no \`# canon:end\`; add it manually, then re-run upgrade`);
        }
        console.log('');
    }

    if (upgraded.length === 0 && unchanged.length === 0 && skipped.length === 0 && malformed.length === 0) {
        console.log('No canon-managed files found. Run `canon init` to set up canon in this repo.\n');
    } else {
        console.log('Orchestrator scripts update automatically — run `npm update canon-ai` to pull the latest.\n');
    }
}
