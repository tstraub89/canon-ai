#!/usr/bin/env node
/**
 * docs-refs-check.mjs
 *
 * Adapted from tstraub89/gallery_wall's scripts/docs-refs-check.mjs with
 * attribution. Validates markdown references in canon-ai docs and task
 * artifacts so stale paths, symbols, sections, and anchors fail fast.
 *
 * Checked ref classes:
 *   1. Backtick file-path refs: `path/to/file.ts`
 *   2. Symbol-in-file refs:    `SYMBOL` in `path/to/file.ts`
 *   3. Section refs:           `path.md` §"Heading Name"
 *   4. Markdown anchor links:  [text](#anchor) and [text](path.md#anchor)
 *
 * Adopter note: edit VALID_DIRS below after `canon upgrade` brings this script
 * into your repo so the allowlist matches your top-level directory layout.
 *
 * Intentional limitation: symbol-in-file validation uses `\bSYMBOL\b` and can
 * match symbols that only appear inside comments or strings. Tightening that
 * would require AST parsing and is out of scope for v1.
 *
 * Intentional forward-ref guidance: if a doc needs to mention a symbol or file
 * that does not exist yet, use prose or another reference style that does not
 * match these four validators.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Adopters can edit this list after `canon upgrade` brings the script.
const VALID_DIRS = new Set([
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
    'templates',
]);

const ROOT_MARKDOWN_FILES = ['AGENTS.md', 'CLAUDE.md', 'CODEX.md', 'README.md'];
const MARKDOWN_ROOT_DIRS = ['docs', 'tasks', 'templates'];
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

function isVisibleDir(name) {
    return !name.startsWith('.');
}

function readText(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function collectMarkdownFiles(repoRoot) {
    const files = [];

    for (const rel of ROOT_MARKDOWN_FILES) {
        const abs = path.join(repoRoot, rel);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
            files.push(abs);
        }
    }

    for (const rel of MARKDOWN_ROOT_DIRS) {
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

function isAllowedDocTarget(target) {
    if (ROOT_MARKDOWN_FILES.includes(target)) return true;
    if (!target.includes('/')) return false;
    return VALID_DIRS.has(target.split('/')[0]);
}

// Anchor links in nested docs commonly use relative paths (e.g.,
// `[text](../AGENTS.md#section)` from `docs/foo.md`). The path-resolution
// step below handles relative paths correctly; this helper widens the
// allow-list at the gate so they're not silently skipped.
function isAllowedAnchorLinkPath(target) {
    if (target.startsWith('./') || target.startsWith('../')) return true;
    return isAllowedDocTarget(target);
}

function isLineCitationTarget(target) {
    return /(?::\d+(?:-\d+)?)$/.test(target) || /#L\d+(?:-L\d+)?$/.test(target);
}

// `templates/` markdown is intentionally scanned — those files ship to
// adopters via `canon upgrade`, so broken refs there would propagate
// silently. Three exempt classes, each by named purpose (not by filename
// suffix alone):
//
// 1. `docs/BACKLOG.md` — deliberate forward-refs to unbuilt work.
// 2. spec.md / plan.md TEMPLATES under any `templates/` directory —
//    contain `<placeholder>` refs by design.
// 3. Task spec.md / plan.md at `tasks/<id>/{spec,plan}.md` — describe
//    work to be done, including symbols/files the task will create.
//    Forward refs are intrinsic to the artifact, not stale refs. Spec
//    ref hygiene at archive time is the Stage 1 code reviewer's job;
//    once archived, the dir moves to `tasks/_archive/` which the
//    directory walker already excludes. (CI can't distinguish "active
//    task being shipped now" from "parked task describing future work."
//    Per Codex P1 review on PR #100 — the carve-out is intentional.)
//    `<id>` here matches the documented `tasks/_templates/` override path
//    too — `_templates` is a single non-slash path component, so the
//    `[^/]+` segment exempts override-template placeholders alongside
//    real task specs.
function isNoisySourceFile(relPath) {
    return (
        relPath === 'docs/BACKLOG.md' ||
        /(?:^|\/)templates\/(?:.*\/)?(spec|plan)\.md$/.test(relPath) ||
        /^tasks\/[^/]+\/(spec|plan)\.md$/.test(relPath)
    );
}

function findBrokenRefs(repoRoot) {
    const findings = [];
    const markdownFiles = collectMarkdownFiles(repoRoot);
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
        if (isNoisySourceFile(relSourceFile)) continue;

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
                const target = match[1];

                if (isLineCitationTarget(target)) continue;
                if (!target.includes('/') && path.extname(target) === '') continue;
                if (isPlaceholderTarget(target)) continue;
                const topLevel = target.split('/')[0];
                if (!VALID_DIRS.has(topLevel)) continue;

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
                if (!isAllowedDocTarget(target)) continue;
                if (isPlaceholderTarget(target)) continue;
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
                if (!isAllowedDocTarget(target)) continue;
                if (isPlaceholderTarget(target) || isPlaceholderTarget(headingText)) continue;
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
                if (linkPath && !isAllowedAnchorLinkPath(linkPath)) continue;

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

export function runChecks(repoRoot) {
    return findBrokenRefs(repoRoot);
}

function printFindings(findings) {
    for (const finding of findings) {
        console.error(`${finding.file}:${finding.line}: ${finding.ref} — ${finding.reason}`);
    }
    console.error(`Found ${findings.length} broken ref${findings.length === 1 ? '' : 's'}`);
}

function main(argv = process.argv.slice(2)) {
    const repoRoot = argv[0] ? path.resolve(argv[0]) : process.cwd();
    const findings = runChecks(repoRoot);

    if (findings.length === 0) {
        console.log('All refs OK');
        return 0;
    }

    printFindings(findings);
    return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main();
}

export { VALID_DIRS, main };
