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
 *   3. Section refs:           `path.md` §"Heading Name", `path.md §"Heading Name"`,
 *                             and [text](path.md) §"Heading Name"
 *   4. Markdown anchor links:  [text](#anchor) and [text](path.md#anchor)
 *   5. Adopter scope:          section refs and anchor links from a shipped
 *                              (CANON_OWNED) file into a scaffold-only doc
 *                              resolve against the `templates/` scaffold copy
 *
 * Only the quoted `§"Heading Name"` form is validated. The unquoted shorthand
 * (`docs/architecture.md §Validation`) has no unambiguous end boundary in
 * prose, so it stays a free-text pointer; write section refs quoted to get
 * them checked.
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
const CANON_OWNED_SOURCE = 'src/lib/canon-owned.ts';
const TEMPLATES_DIR = 'templates';

// Section pointers appear in three carriers across canon docs. All three name
// a heading in another doc; only the path carrier differs.
//
//   1. `docs/decisions.md` §"Heading"            — backtick path, pointer outside
//   2. `docs/decisions.md §"Heading"`            — path and pointer in one span
//   3. [`decisions.md`](decisions.md) §"Heading" — markdown-link path carrier
//
// Carriers 1 and 2 use canon's repo-root-relative backtick-ref convention;
// carrier 3's path resolution is spelled out in `sectionRefTargetCandidates`.
// Carrier 2 would otherwise be read by the bare-backtick validator as one
// absurd filename and reported as `missing file` — see
// `hasInlineSectionPointer`.
const SECTION_REF_PATTERNS = [
    { pattern: /`([^`]+\.md)`\s+§"([^"]+)"/g, relativeToSource: false },
    { pattern: /`([^`]+\.md)\s+§"([^"]+)"`/g, relativeToSource: false },
    { pattern: /\[[^\]]*\]\(([^)\s]+\.md)\)\s+§"([^"]+)"/g, relativeToSource: true },
];
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

function collectMarkdownFiles(repoRoot, markdownRootDirs, shippedSources = new Set()) {
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

    // Shipped markdown is scanned whether or not a configured root reaches it.
    // Most canon-owned markdown lives under `.claude/**` and `.canon/**`, which
    // `walkMarkdownTree` skips as hidden — so without this, the adopter-scope
    // guard would police only the two owned docs that happen to sit under
    // `docs/`, and a dangling section pointer in a shipped skill or task
    // template would ship silently. These files are the ones adopters receive
    // verbatim; they earn scanning by definition, not by directory layout.
    const seen = new Set(files);
    for (const rel of shippedSources) {
        if (!rel.endsWith('.md')) continue;
        const abs = path.join(repoRoot, rel);
        if (seen.has(abs)) continue;
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
        files.push(abs);
        seen.add(abs);
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
// allow-list at the gate so they're not silently skipped. A bare sibling
// filename (`[text](decisions.md#section)`) is the same case without the
// redundant `./`, and resolves unambiguously — skipping it would exempt the
// most natural way to link between two docs in one directory.
function isAllowedAnchorLinkPath(target, validDirs) {
    if (target.startsWith('./') || target.startsWith('../')) return true;
    if (!target.includes('/') && target.endsWith('.md')) return true;
    return isAllowedDocTarget(target, validDirs);
}

// Yields every quoted section pointer on a line, normalized across the three
// carriers in `SECTION_REF_PATTERNS`. `relativeToSource` tells the caller how
// to resolve `target`; `refText` is the full matched span so findings quote
// what the author actually wrote.
function* iterateSectionRefs(line) {
    for (const { pattern, relativeToSource } of SECTION_REF_PATTERNS) {
        for (const match of line.matchAll(pattern)) {
            yield {
                refText: match[0],
                target: match[1],
                headingText: match[2],
                relativeToSource,
            };
        }
    }
}

// Candidate repo-relative paths for a section ref's target, most-likely first,
// plus `markdownPath`: where a reader's renderer actually resolves the link
// (null for the backtick carriers, which are not links).
//
// Carriers 1 and 2 are repo-root-relative by canon convention, full stop.
// Carrier 3 is checked under BOTH conventions, because canon's prose uses both:
// true markdown-relative (`[`decisions.md`](decisions.md)` between sibling
// docs) and repo-root-relative with the path as the link label
// (`[`docs/decisions.md`](docs/decisions.md)`). Markdown semantics come first
// so a link that resolves normally is never re-pointed at a same-named file
// elsewhere; the repo-root form is a fallback that keeps the section pointer
// checkable, and the caller reports the unrenderable link path separately.
// Every candidate is confined to the repo. `isAllowedDocTarget` only inspects
// the first path segment, so without this a target like
// `docs/../../../outside.md` clears the allow-list and gets stat'd outside the
// worktree. `normalizeAnchorLinkPath` already enforces containment on the
// markdown-resolved path; this extends the same discipline to the repo-root
// spelling, which is otherwise trusted verbatim.
function isInsideRepo(repoRoot, relPath) {
    const relative = path.relative(repoRoot, path.resolve(repoRoot, relPath));
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function sectionRefTargetCandidates(sourceFile, repoRoot, target, relativeToSource) {
    const confine = candidates => candidates.filter(
        candidate => Boolean(candidate) && isInsideRepo(repoRoot, candidate),
    );

    if (!relativeToSource) return { candidates: confine([target]), markdownPath: null };

    const markdownPath = normalizeAnchorLinkPath(sourceFile, repoRoot, target);
    return {
        candidates: confine([...new Set([markdownPath, target])]),
        markdownPath,
    };
}

// True for the carrier-2 body (`docs/decisions.md §"Heading"` inside a single
// backtick pair). The bare-backtick file validator must hand these to the
// section-ref validator rather than stat a path that includes the pointer.
//
// Anchored at both ends to mirror carrier 2's pattern exactly, so nothing can
// escape BOTH validators: a malformed span (`§""`, an unterminated quote) is
// not claimed by the section validator, so it must stay claimed by the file
// validator. A wrong-looking message beats a silent skip.
function hasInlineSectionPointer(backtickBody) {
    return /^[^`]+\.md\s+§"[^"]+"$/.test(backtickBody);
}

// Repo-relative paths canon ships verbatim, parsed from `CANON_OWNED` rather
// than duplicated here — a hand-copied list would drift the moment a doc joins
// the managed set. Regex-parsed instead of imported because this script runs
// under plain `node` (no TS loader) and must stay importable in repos that
// have no such file at all.
//
function loadCanonOwnedPaths(repoRoot) {
    const abs = path.join(repoRoot, CANON_OWNED_SOURCE);
    if (!fs.existsSync(abs)) return new Set();
    return new Set(parseCanonOwnedArray(readText(abs)));
}

// Reads one quoted literal starting at `start`. Returns `next: -1` for an
// unterminated string so the caller can bail rather than resynchronize on
// whatever quote it finds next.
function readStringLiteral(source, start) {
    const quote = source[start];

    for (let index = start + 1, value = ''; index < source.length; index += 1) {
        const char = source[index];
        if (char === '\\') {
            value += source[index + 1] ?? '';
            index += 1;
            continue;
        }
        if (char === quote) return { value, next: index + 1 };
        if (char === '\n' && quote !== '`') break;
        value += char;
    }

    return { value: '', next: -1 };
}

// Extracts the string entries of `export const CANON_OWNED = [ … ]`.
//
// Deliberately not a regex. A `]`, `//`, or `/*` inside a quoted path
// truncates a regex match, and a comment containing `]` hides every entry
// after it — failures that are both silent and asymmetric, since a short
// manifest makes the adopter-scope guard skip files it should police. So the
// array body is walked with a small state machine that knows strings from
// comments. Anything it cannot parse to a closing bracket yields nothing,
// leaving the guard inert rather than half-enforced.
function parseCanonOwnedArray(source) {
    const anchor = source.match(/export const CANON_OWNED\s*=\s*\[/);
    if (!anchor) return [];

    const entries = [];
    let index = anchor.index + anchor[0].length;
    let depth = 1;

    while (index < source.length && depth > 0) {
        const char = source[index];

        if (char === '/' && source[index + 1] === '/') {
            const lineEnd = source.indexOf('\n', index);
            if (lineEnd === -1) return [];
            index = lineEnd + 1;
            continue;
        }
        if (char === '/' && source[index + 1] === '*') {
            const commentEnd = source.indexOf('*/', index + 2);
            if (commentEnd === -1) return [];
            index = commentEnd + 2;
            continue;
        }
        if (char === "'" || char === '"' || char === '`') {
            const { value, next } = readStringLiteral(source, index);
            if (next === -1) return [];
            entries.push(value);
            index = next;
            continue;
        }

        if (char === '[') depth += 1;
        if (char === ']') depth -= 1;
        index += 1;
    }

    return depth === 0 ? entries : [];
}

// The optional `~` after the colon tolerates the "approximate line"
// hedge operators write (e.g., `src/foo.ts:~140`). Line numbers in prose
// drift, so the hedge is honest; the suffix is stripped before path
// validation either way, so accepting it costs the check nothing.
function isLineCitationTarget(target) {
    return stripLineCitation(target) !== target;
}

function stripLineCitation(target) {
    return target
        .replace(/:~?\d+(?:[-–—]~?\d+)?(?:,[ \t]*~?\d+(?:[-–—]~?\d+)?)*$/, '')
        .replace(/#L\d+(?:[-–—]L?\d+)?(?:,[ \t]*L?\d+(?:[-–—]L?\d+)?)*$/, '');
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
// `src/orchestrator/git.ts:filterGitIgnoredPaths`. Returns empty on any
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
                if (hasInlineSectionPointer(match[1])) continue;
                targets.add(stripLineCitation(match[1]));
            }
            for (const match of line.matchAll(/`([^`]+)`\s+in\s+`([^`]+)`/g)) {
                targets.add(match[2]);
            }
            for (const sectionRef of iterateSectionRefs(line)) {
                const { candidates } = sectionRefTargetCandidates(
                    sourceFile,
                    repoRoot,
                    sectionRef.target,
                    sectionRef.relativeToSource,
                );
                for (const candidate of candidates) targets.add(candidate);
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
    const canonOwnedPaths = loadCanonOwnedPaths(repoRoot);
    const shippedSources = new Set(
        [...canonOwnedPaths].flatMap(rel => [rel, `${TEMPLATES_DIR}/${rel}`]),
    );
    const allMarkdownFiles = collectMarkdownFiles(repoRoot, markdownRootDirs, shippedSources);

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

    // Adopter-scope guard. canon ships every CANON_OWNED file verbatim into
    // adopter repos. The scaffold docs (`docs/decisions.md`, `docs/patterns.md`,
    // …) ship too, but only as starting points — their *content* becomes the
    // adopter's own. So a section pointer from a shipped file into a scaffold
    // doc is valid only if the named heading exists in the SCAFFOLD copy under
    // `templates/`. Resolving against canon-ai's own filled-in copy is what let
    // three pointers into canon-ai-authored `decisions.md` sections reach
    // adopters in 2026-07: the checker passed because those sections exist here.
    //
    // Both inputs are derived, never hand-listed:
    //   - shipped sources come from `CANON_OWNED` (plus its `templates/` mirror,
    //     which ships the same bytes and so carries the same leak).
    //   - a scaffold-only doc is any path with a `templates/` counterpart that
    //     is NOT in `CANON_OWNED`. Owned files are byte-identical mirrors, so
    //     their headings agree on both sides and need no re-resolution.
    //
    // Both derivations come up empty outside canon-ai's own repo, leaving the
    // guard inert for adopters — correct, since an adopter's docs pointing at
    // their own sections is the intended usage.
    function scaffoldOnlyCopy(target) {
        if (!target) return null;
        if (canonOwnedPaths.size === 0) return null;
        if (canonOwnedPaths.has(target)) return null;
        if (target === TEMPLATES_DIR || target.startsWith(`${TEMPLATES_DIR}/`)) return null;

        const rel = `${TEMPLATES_DIR}/${target}`;
        const abs = path.join(repoRoot, rel);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
        return { abs, rel };
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
                if (hasInlineSectionPointer(match[1])) continue;
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

            for (const { refText, target, headingText, relativeToSource } of iterateSectionRefs(line)) {
                if (isLineCitationTarget(target)) continue;
                if (isPlaceholderTarget(target) || isPlaceholderTarget(headingText)) continue;

                // Candidates are resolved before the allow-list gate so a
                // same-directory link (`[`decisions.md`](decisions.md)` from
                // `docs/release-process.md`) is judged as `docs/decisions.md`
                // rather than skipped for having no leading directory.
                const { candidates: allCandidates, markdownPath } =
                    sectionRefTargetCandidates(sourceFile, repoRoot, target, relativeToSource);
                const candidates = allCandidates
                    .filter(candidate => isAllowedDocTarget(candidate, validDirs));
                if (candidates.length === 0) continue;

                const targetRel = candidates.find(candidate => {
                    const abs = resolveRepoRelative(repoRoot, candidate);
                    return fs.existsSync(abs) && fs.statSync(abs).isFile();
                });
                if (!targetRel) {
                    // Nothing resolves under either convention. The gitignore
                    // skip exists for exactly this shape — a target present on
                    // a developer machine but absent on a fresh clone — so it
                    // is consulted here only, never in place of a candidate
                    // that does resolve.
                    if (candidates.some(candidate => gitIgnoredTargets.has(candidate))) continue;
                    addFinding(sourceFile, lineNumber, refText, 'missing file');
                    continue;
                }
                if (gitIgnoredTargets.has(targetRel)) continue;
                const targetPath = resolveRepoRelative(repoRoot, targetRel);

                // The target resolved, but not where a markdown renderer sends
                // the reader. Reported as its own defect so the section pointer
                // can still be judged against the file the author meant,
                // instead of the broken link swallowing both checks.
                if (relativeToSource && targetRel !== markdownPath) {
                    addFinding(sourceFile, lineNumber, refText, 'link path does not resolve from this file');
                }

                const scaffoldCopy = shippedSources.has(relSourceFile)
                    ? scaffoldOnlyCopy(targetRel)
                    : null;
                if (scaffoldCopy) {
                    if (!headingExists(getText(scaffoldCopy.abs), headingText)) {
                        addFinding(
                            sourceFile,
                            lineNumber,
                            refText,
                            `heading not found in adopter scaffold copy (${scaffoldCopy.rel})`,
                        );
                    }
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

                const linkTargetRel = linkPath
                    ? normalizeAnchorLinkPath(sourceFile, repoRoot, linkPath)
                    : null;
                // An anchor target outside the repo is skipped rather than
                // validated against a file no other clone has — the same
                // containment the section-ref candidates enforce.
                if (linkPath && !linkTargetRel) continue;
                if (linkTargetRel && gitIgnoredTargets.has(linkTargetRel)) continue;

                const targetPath = linkPath
                    ? path.resolve(path.dirname(sourceFile), linkPath)
                    : sourceFile;

                if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
                    addFinding(sourceFile, lineNumber, refText, 'missing file');
                    continue;
                }

                // A same-file anchor (`linkPath` empty) needs no adopter-scope
                // check: the file ships whole, so its own headings ship with it.
                const scaffoldCopy = linkTargetRel && shippedSources.has(relSourceFile)
                    ? scaffoldOnlyCopy(linkTargetRel)
                    : null;

                const targetHeadings = scaffoldCopy
                    ? getHeadings(scaffoldCopy.abs)
                    : (targetPath === sourceFile ? sourceHeadings : getHeadings(targetPath));
                if (!targetHeadings.some(heading => heading.slug === slugify(anchor))) {
                    addFinding(
                        sourceFile,
                        lineNumber,
                        refText,
                        scaffoldCopy
                            ? `anchor not found in adopter scaffold copy (${scaffoldCopy.rel})`
                            : 'anchor not found',
                    );
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
