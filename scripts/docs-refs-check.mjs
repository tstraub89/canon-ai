#!/usr/bin/env node
/**
 * docs-refs-check.mjs
 *
 * Validates markdown references in canon-managed docs and task artifacts
 * so stale paths, symbols, sections, and anchors fail fast.
 *
 * Checked ref classes:
 *   1. Backtick file-path refs: `path/to/file.ts`
 *   2. Symbol-in-file refs:    `SYMBOL` in `path/to/file.ts`
 *   3. Section refs:           `path.md` §"Heading Name"
 *   4. Markdown anchor links:  [text](#anchor) and [text](path.md#anchor)
 *
 * Adopter note: customize `scripts/docs-refs-config.mjs` beside this script.
 * Canon defaults live here; the sibling config is merged at module load.
 *
 * Intentional limitation: symbol-in-file validation uses `\bSYMBOL\b` and can
 * match symbols that only appear inside comments or strings. Tightening that
 * would require AST parsing and is out of scope for v1.
 *
 * Intentional forward-ref guidance: if a doc needs to mention a symbol or file
 * that does not exist yet, use prose or another reference style that does not
 * match these four validators.
 *
 * Gitignore handling: refs whose target path is gitignored (per
 * `git check-ignore`, batched once at startup) are skipped. This keeps local
 * vs. CI behavior consistent for paths that legitimately exist on a
 * developer machine but never on a fresh clone (e.g.,
 * `.claude/settings.local.json`). Falls back to "no skip" outside a git
 * repo so the script remains usable in test fixtures.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT_MARKDOWN_FILES = ['AGENTS.md', 'CLAUDE.md', 'README.md'];
const CANON_VALID_DIRS = new Set([
    'src',
    'scripts',
    'tests',
    'docs',
    'public',
    'tasks',
    '.github',
    '.canon',
    '.claude',
    '.codex',
]);
const CANON_NOISY_SOURCE_PATHS = [];
const CANON_MARKDOWN_ROOT_DIRS = ['docs', 'tasks'];
const PLACEHOLDER_SEGMENTS = new Set([
    'path',
    'file',
    'symbol',
    'heading',
    'heading-name',
    'section-name',
    'anchor',
    'title',
    'name',
    'example',
    'task-id',
    'taskid',
    'task',
    'id',
    'your-reset-function',
]);
function toPosixPath(relPath) {
    return relPath.split(path.sep).join('/');
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function slugify(text) {
    return text
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function isStringArray(value) {
    return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

export function mergeAdopterConfig(adopterConfig) {
    const source = adopterConfig && typeof adopterConfig === 'object' ? adopterConfig : null;
    const noisySourcePaths = isStringArray(source?.noisySourcePaths) ? source.noisySourcePaths : [];
    const validDirs = isStringArray(source?.validDirs) ? source.validDirs : [];
    const markdownRootDirs = isStringArray(source?.markdownRootDirs) ? source.markdownRootDirs : [];

    return {
        validDirs: new Set([...CANON_VALID_DIRS, ...validDirs]),
        noisySourcePaths: [...new Set([...CANON_NOISY_SOURCE_PATHS, ...noisySourcePaths])],
        markdownRootDirs: [...new Set([...CANON_MARKDOWN_ROOT_DIRS, ...markdownRootDirs])],
    };
}

export async function loadAdopterConfig(configPath) {
    if (!configPath || !fs.existsSync(configPath)) return null;

    try {
        const mod = await import(pathToFileURL(configPath).href);
        // Thin loader: return the raw exports and let mergeAdopterConfig be the
        // single validator (it already coerces each non-array key to []). A
        // config that exports only some of the three keys keeps the others at
        // canon defaults rather than discarding ALL adopter entries when one is
        // absent — the old all-or-nothing guard reintroduced the silent-drop
        // bug class this task exists to remove.
        return {
            noisySourcePaths: mod.noisySourcePaths,
            validDirs: mod.validDirs,
            markdownRootDirs: mod.markdownRootDirs,
        };
    } catch {
        return null;
    }
}

const DEFAULT_ADOPTER_CONFIG_PATH = fileURLToPath(new URL('./docs-refs-config.mjs', import.meta.url));
const DEFAULT_ADOPTER_CONFIG = await loadAdopterConfig(DEFAULT_ADOPTER_CONFIG_PATH);
const DEFAULT_EFFECTIVE_CONFIG = mergeAdopterConfig(DEFAULT_ADOPTER_CONFIG);

export const VALID_DIRS = DEFAULT_EFFECTIVE_CONFIG.validDirs;
export const NOISY_SOURCE_PATHS = DEFAULT_EFFECTIVE_CONFIG.noisySourcePaths;

function isVisibleDir(name) {
    return !name.startsWith('.');
}

function readText(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function collectMarkdownFiles(repoRoot, markdownRootDirs) {
    const files = [];

    for (const rel of ROOT_MARKDOWN_FILES) {
        const abs = path.join(repoRoot, rel);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
            files.push(abs);
        }
    }

    for (const rel of markdownRootDirs) {
        const abs = path.join(repoRoot, rel);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
        walkMarkdownTree(abs, files, rel === 'tasks');
    }

    return files.sort((a, b) => a.localeCompare(b));
}

function walkMarkdownTree(dirPath, files, skipArchiveUnderTasks) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (!isVisibleDir(entry.name)) continue;
            if (entry.name === 'node_modules' || entry.name === 'dist') continue;
            if (skipArchiveUnderTasks && entry.name === '_archive') continue;
            walkMarkdownTree(path.join(dirPath, entry.name), files, false);
            continue;
        }

        if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(path.join(dirPath, entry.name));
        }
    }
}

function getMarkdownHeadings(markdownText) {
    const headings = [];
    const lines = markdownText.split(/\r?\n/);
    let inFence = false;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const trimmed = line.trim();

        if (/^(```|~~~)/.test(trimmed)) {
            inFence = !inFence;
            continue;
        }

        if (inFence) continue;

        const atxMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (atxMatch) {
            headings.push({
                text: atxMatch[2].trim(),
                slug: slugify(atxMatch[2]),
            });
            continue;
        }

        const nextLine = lines[index + 1];
        if (!nextLine) continue;

        const setextLevel = nextLine.trim();
        if (/^=+\s*$/.test(setextLevel) || /^-+\s*$/.test(setextLevel)) {
            const headingText = trimmed;
            if (headingText) {
                headings.push({
                    text: headingText,
                    slug: slugify(headingText),
                });
            }
            index += 1;
        }
    }

    return headings;
}

function headingExists(markdownText, headingText) {
    return getMarkdownHeadings(markdownText).some(heading => heading.text === headingText);
}

function resolveRepoRelative(repoRoot, relPath) {
    return path.resolve(repoRoot, relPath);
}

function isPlaceholderTarget(target) {
    if (target.includes('...')) return true;
    if (/[<>\[\]\*\?]/.test(target)) return true;
    if (target.endsWith('/')) return true;

    const segments = target.split('/').filter(Boolean);
    if (segments.length === 0) return true;

    for (const segment of segments) {
        const bareSegment = segment.replace(/\.[^.]+$/, '').toLowerCase();
        if (PLACEHOLDER_SEGMENTS.has(bareSegment)) return true;
    }

    return false;
}

// Narrower than `isPlaceholderTarget`: symbol names commonly collide
// with the path-oriented PLACEHOLDER_SEGMENTS list (e.g., a real export
// named `id`, `name`, `task`, or `symbol` would be misread as a
// placeholder and silently bypassed). The only symbol form we want
// treated as a placeholder is `...` — the marker-range pattern that
// motivated the BACKLOG entry (e.g.,
// `` `<!-- canon:start -->...<!-- canon:end -->` in `AGENTS.md` ``).
function isPlaceholderSymbol(symbol) {
    return symbol.includes('...');
}

function isAllowedDocTarget(target, validDirs) {
    if (ROOT_MARKDOWN_FILES.includes(target)) return true;
    if (!target.includes('/')) return false;
    return validDirs.has(target.split('/')[0]);
}

// Anchor links in nested docs commonly use relative paths (e.g.,
// `[text](../AGENTS.md#section)` from `docs/foo.md`). The path-resolution
// step below handles relative paths correctly; this helper widens the
// allow-list at the gate so they're not silently skipped.
function isAllowedAnchorLinkPath(target, validDirs) {
    if (target.startsWith('./') || target.startsWith('../')) return true;
    return isAllowedDocTarget(target, validDirs);
}

function isLineCitationTarget(target) {
    return /(?::\d+(?:[-–—]\d+)?)$/.test(target) || /#L\d+(?:[-–—]L\d+)?$/.test(target);
}

function stripLineCitation(target) {
    return target
        .replace(/:\d+(?:[-–—]\d+)?(?:,\d+(?:[-–—]\d+)?)*$/, '')
        .replace(/#L\d+(?:[-–—]L?\d+)?(?:,L?\d+(?:[-–—]L?\d+)?)*$/, '');
}

// `templates/` markdown is intentionally scanned — those files ship to
// adopters via `canon upgrade`, so broken refs there would propagate
// silently. Three exempt classes, each by named purpose (not by filename
// suffix alone):
//
// 1. `docs/BACKLOG.md` — deliberate forward-refs to unbuilt work.
// 2. spec.md / plan.md / notes.md / spec-review.md TEMPLATES under any
//    `templates/` directory — contain `<placeholder>` refs by design.
// 3. Task spec.md / plan.md / notes.md / spec-review.md at
//    `tasks/<id>/`. spec.md and plan.md describe work to be done,
//    including symbols/files the task will create — forward refs are
//    intrinsic, not stale. notes.md and spec-review.md are
//    hypothetical-friendly: notes.md accumulates "Codex tried <path>
//    but it didn't exist"; spec-review.md captures reviewer thought
//    experiments referencing files that may not exist. Refs there are
//    exploration artifacts, not assertions. `handoff.md` / `review.md`
//    / `done.md` are deliberately NOT exempt — those are records of
//    real work and broken refs there are real bugs (e.g., a test plan
//    pointing at a wrong path). Spec ref hygiene at archive time is
//    the Stage 1 code reviewer's job; once archived, the dir moves to
//    `tasks/_archive/` which the directory walker already excludes.
//    (CI can't distinguish "active task being shipped now" from
//    "parked task describing future work." Per Codex P1 review on
//    PR #100 — the carve-out is intentional.) `<id>` here matches the
//    documented `tasks/_templates/` override path too — `_templates`
//    is a single non-slash path component, so the `[^/]+` segment
//    exempts override-template placeholders alongside real task
//    artifacts.
function isNoisySourceFile(relPath, skipPaths = []) {
    if (skipPaths.some(entry => {
        const norm = entry.endsWith('/') ? entry.slice(0, -1) : entry;
        return relPath === norm || relPath.startsWith(norm + '/');
    })) return true;
    return (
        relPath === 'docs/BACKLOG.md' ||
        /(?:^|\/)templates\/(?:.*\/)?(spec|plan|notes|spec-review)\.md$/.test(relPath) ||
        /^tasks\/[^/]+\/(spec|plan|notes|spec-review)\.md$/.test(relPath)
    );
}

// Batched `git check-ignore --stdin -z` lookup. Mirrors the pattern from
// `scripts/run-task/git.ts:filterGitIgnoredPaths`. Returns empty on any
// failure (including running outside a git repo, where git exits 128) so
// behavior degrades to the pre-1.5 "no skip" mode rather than failing
// closed. Doc refs to paths that legitimately exist in the working tree
// but are gitignored (e.g., `.claude/settings.local.json`, written by
// Claude Code on first permission grant) previously caused inconsistent
// pass/fail between local runs and CI; the skip lets the check stay
// silent on paths git already treats as transient.
// Resolve an anchor-link's path component (e.g., `../AGENTS.md`,
// `./generated.md`, or `docs/foo.md`) to its repo-relative POSIX form.
// Returns null for paths that resolve outside the repo, for URLs, or
// for empty input. The same normalization runs at collection and lookup
// time so set keys agree across both sites.
function normalizeAnchorLinkPath(sourceFile, repoRoot, linkPath) {
    if (!linkPath) return null;
    if (linkPath.startsWith('http://') || linkPath.startsWith('https://')) return null;
    const resolved = path.resolve(path.dirname(sourceFile), linkPath);
    const relative = path.relative(repoRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return toPosixPath(relative);
}

function collectGitIgnoredTargets(repoRoot, candidateTargets) {
    if (candidateTargets.size === 0) return new Set();
    // Drop inputs git check-ignore can't process. Each form below makes
    // git exit 128 and tank the whole batch:
    //   - `../foo`: anchor-link relative paths are pre-normalized, but
    //     backtick refs like `` `../dev-worktrees` `` in repo docs are
    //     added raw.
    //   - `/canon-spec`, `/absolute/path`: slash-prefixed tokens are
    //     interpreted as absolute paths outside the worktree. Repo docs
    //     contain backtick slash-command refs (`` `/canon-spec` ``,
    //     `` `/canon-pipeline` ``, etc.) on purpose.
    //   - `./foo`, http(s) URLs: not gitignore-checkable.
    // Such refs can never be gitignored matches anyway; skipping them
    // here keeps the batch on repo-relative candidates only. Any
    // remaining 128s are isolated by bisection below.
    const safe = [...candidateTargets].filter(target =>
        target.length > 0 &&
        target !== '.' &&
        target !== '..' &&
        !target.startsWith('./') &&
        !target.startsWith('../') &&
        !target.startsWith('/') &&
        !target.startsWith('http://') &&
        !target.startsWith('https://'),
    );
    if (safe.length === 0) return new Set();

    const workTreeCheck = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (workTreeCheck.error || workTreeCheck.status !== 0) {
        return new Set();
    }

    function runGitCheckIgnoreBatch(targets) {
        if (targets.length === 0) return new Set();
        const result = spawnSync('git', ['check-ignore', '--stdin', '-z'], {
            cwd: repoRoot,
            input: `${targets.join('\0')}\0`,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (result.error) return new Set();
        if (result.status === 0 || result.status === 1) {
            return new Set((result.stdout ?? '').split('\0').filter(p => p.length > 0));
        }
        if (result.status === 128) {
            if (targets.length === 1) return new Set();
            const mid = Math.floor(targets.length / 2);
            const left = runGitCheckIgnoreBatch(targets.slice(0, mid));
            const right = runGitCheckIgnoreBatch(targets.slice(mid));
            for (const entry of right) left.add(entry);
            return left;
        }
        return new Set();
    }

    return runGitCheckIgnoreBatch(safe);
}

function collectCandidateTargetPaths(markdownFiles, repoRoot, skipPaths) {
    const targets = new Set();
    for (const sourceFile of markdownFiles) {
        const relSourceFile = toPosixPath(path.relative(repoRoot, sourceFile));
        if (isNoisySourceFile(relSourceFile, skipPaths)) continue;
        const text = readText(sourceFile);
        const lines = text.split(/\r?\n/);
        let inFence = false;
        for (const line of lines) {
            const trimmed = line.trim();
            if (/^(```|~~~)/.test(trimmed)) {
                inFence = !inFence;
                continue;
            }
            if (inFence) continue;
            for (const match of line.matchAll(/`([^`]+)`(?!\s+in\s+`|\s+§")/g)) {
                targets.add(stripLineCitation(match[1]));
            }
            for (const match of line.matchAll(/`([^`]+)`\s+in\s+`([^`]+)`/g)) {
                targets.add(match[2]);
            }
            for (const match of line.matchAll(/`([^`]+\.md)`\s+§"([^"]+)"/g)) {
                targets.add(match[1]);
            }
            for (const match of line.matchAll(/(!?)\[([^\]]*)\]\(([^)]+)\)/g)) {
                if (match[1] === '!') continue;
                const raw = match[3].trim().replace(/\s+"[^"]*"\s*$/, '');
                if (!raw.includes('#')) continue;
                const [linkPath] = raw.split('#', 2);
                const normalized = normalizeAnchorLinkPath(sourceFile, repoRoot, linkPath);
                if (normalized) targets.add(normalized);
            }
        }
    }
    return targets;
}

function findBrokenRefs(repoRoot, options = {}) {
    const effectiveConfig = options.effectiveConfig ?? DEFAULT_EFFECTIVE_CONFIG;
    const skipPaths = options.skipPaths ?? effectiveConfig.noisySourcePaths;
    const validDirs = effectiveConfig.validDirs;
    const markdownRootDirs = effectiveConfig.markdownRootDirs;
    const findings = [];
    const allMarkdownFiles = collectMarkdownFiles(repoRoot, markdownRootDirs);

    // First pass: skip gitignored markdown source files entirely.
    // This is broader than just self-anchor false positives — refs of
    // any kind inside a gitignored doc are excluded. Rationale:
    // gitignored files don't exist on a fresh clone (CI), so scanning
    // them locally would reintroduce exactly the local-vs-CI skew this
    // feature exists to remove. A broken ref inside a generated /
    // local-only doc is by definition not in the repo's authoritative
    // content. Trade-off accepted in favor of CI consistency, per the
    // BACKLOG entry's framing.
    const sourceRelByAbs = new Map(
        allMarkdownFiles.map(abs => [abs, toPosixPath(path.relative(repoRoot, abs))]),
    );
    const ignoredSources = collectGitIgnoredTargets(repoRoot, new Set(sourceRelByAbs.values()));
    const markdownFiles = allMarkdownFiles.filter(abs => !ignoredSources.has(sourceRelByAbs.get(abs)));

    // Second pass: collect and check ref targets from the surviving sources.
    const candidateTargets = collectCandidateTargetPaths(markdownFiles, repoRoot, skipPaths);
    const gitIgnoredTargets = collectGitIgnoredTargets(repoRoot, candidateTargets);
    const textCache = new Map();
    const headingCache = new Map();

    function getText(filePath) {
        if (!textCache.has(filePath)) {
            textCache.set(filePath, readText(filePath));
        }
        return textCache.get(filePath);
    }

    function getHeadings(filePath) {
        if (!headingCache.has(filePath)) {
            headingCache.set(filePath, getMarkdownHeadings(getText(filePath)));
        }
        return headingCache.get(filePath);
    }

    function addFinding(sourceFile, lineNumber, refText, reason) {
        findings.push({
            file: toPosixPath(path.relative(repoRoot, sourceFile)),
            line: lineNumber,
            ref: refText,
            reason,
        });
    }

    for (const sourceFile of markdownFiles) {
        const relSourceFile = toPosixPath(path.relative(repoRoot, sourceFile));
        if (isNoisySourceFile(relSourceFile, skipPaths)) continue;

        const sourceText = getText(sourceFile);
        const lines = sourceText.split(/\r?\n/);
        const sourceHeadings = getHeadings(sourceFile);
        let inFence = false;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            const line = lines[lineIndex];
            const trimmed = line.trim();
            const lineNumber = lineIndex + 1;

            if (/^(```|~~~)/.test(trimmed)) {
                inFence = !inFence;
                continue;
            }
            if (inFence) continue;

            for (const match of line.matchAll(/`([^`]+)`(?!\s+in\s+`|\s+§")/g)) {
                const refText = match[0];
                const target = stripLineCitation(match[1]);

                if (!target.includes('/') && path.extname(target) === '') continue;
                if (isPlaceholderTarget(target)) continue;
                const topLevel = target.split('/')[0];
                if (!validDirs.has(topLevel)) continue;
                if (gitIgnoredTargets.has(target)) continue;

                const targetPath = resolveRepoRelative(repoRoot, target);
                if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
                    addFinding(sourceFile, lineNumber, refText, 'missing file');
                }
            }

            for (const match of line.matchAll(/`([^`]+)`\s+in\s+`([^`]+)`/g)) {
                const refText = match[0];
                const symbol = match[1];
                const target = match[2];
                if (isLineCitationTarget(target)) continue;
                if (!isAllowedDocTarget(target, validDirs)) continue;
                if (isPlaceholderTarget(target)) continue;
                if (isPlaceholderSymbol(symbol)) continue;
                if (gitIgnoredTargets.has(target)) continue;
                const targetPath = resolveRepoRelative(repoRoot, target);

                if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
                    addFinding(sourceFile, lineNumber, refText, 'missing file');
                    continue;
                }

                const normalizedSymbol = symbol.replace(/\s*\(.*$/, '');
                const symbolRe = new RegExp(`\\b${escapeRegExp(normalizedSymbol)}\\b`, 'm');
                if (!symbolRe.test(getText(targetPath))) {
                    addFinding(sourceFile, lineNumber, refText, 'symbol not found');
                }
            }

            for (const match of line.matchAll(/`([^`]+\.md)`\s+§"([^"]+)"/g)) {
                const refText = match[0];
                const target = match[1];
                const headingText = match[2];
                if (isLineCitationTarget(target)) continue;
                if (!isAllowedDocTarget(target, validDirs)) continue;
                if (isPlaceholderTarget(target) || isPlaceholderTarget(headingText)) continue;
                if (gitIgnoredTargets.has(target)) continue;
                const targetPath = resolveRepoRelative(repoRoot, target);

                if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
                    addFinding(sourceFile, lineNumber, refText, 'missing file');
                    continue;
                }

                if (!headingExists(getText(targetPath), headingText)) {
                    addFinding(sourceFile, lineNumber, refText, 'heading not found');
                }
            }

            for (const match of line.matchAll(/(!?)\[([^\]]*)\]\(([^)]+)\)/g)) {
                if (match[1] === '!') continue;

                const refText = match[0];
                const rawTarget = match[3].trim().replace(/\s+"[^"]*"\s*$/, '');
                if (isPlaceholderTarget(rawTarget)) continue;
                if (isLineCitationTarget(rawTarget)) continue;
                if (rawTarget.startsWith('http://') || rawTarget.startsWith('https://')) continue;
                if (!rawTarget.includes('#')) continue;

                const [linkPath, rawAnchor] = rawTarget.split('#', 2);
                const anchor = rawAnchor.trim();
                if (!anchor) continue;
                if (PLACEHOLDER_SEGMENTS.has(slugify(anchor))) continue;
                if (linkPath && !isAllowedAnchorLinkPath(linkPath, validDirs)) continue;
                if (linkPath) {
                    const normalized = normalizeAnchorLinkPath(sourceFile, repoRoot, linkPath);
                    if (normalized && gitIgnoredTargets.has(normalized)) continue;
                }

                const targetPath = linkPath
                    ? path.resolve(path.dirname(sourceFile), linkPath)
                    : sourceFile;

                if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
                    addFinding(sourceFile, lineNumber, refText, 'missing file');
                    continue;
                }

                const targetHeadings = targetPath === sourceFile ? sourceHeadings : getHeadings(targetPath);
                if (!targetHeadings.some(heading => heading.slug === slugify(anchor))) {
                    addFinding(sourceFile, lineNumber, refText, 'anchor not found');
                }
            }
        }
    }

    return findings;
}

export function runChecks(repoRoot, options = {}) {
    const effectiveConfig = options.adopterConfig === undefined
        ? DEFAULT_EFFECTIVE_CONFIG
        : mergeAdopterConfig(options.adopterConfig);
    return findBrokenRefs(repoRoot, { ...options, effectiveConfig });
}

function printFindings(findings) {
    for (const finding of findings) {
        console.error(`${finding.file}:${finding.line}: ${finding.ref} — ${finding.reason}`);
    }
    console.error(`Found ${findings.length} broken ref${findings.length === 1 ? '' : 's'}`);
}

async function main(argv = process.argv.slice(2)) {
    const repoRoot = argv[0] ? path.resolve(argv[0]) : process.cwd();
    const adopterConfigPath = path.join(repoRoot, 'scripts', 'docs-refs-config.mjs');
    const adopterConfig = await loadAdopterConfig(adopterConfigPath);
    const findings = runChecks(repoRoot, { adopterConfig });

    if (findings.length === 0) {
        console.log('All refs OK');
        return 0;
    }

    printFindings(findings);
    return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    void main().then(code => {
        process.exitCode = code;
    }).catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

export { main };
