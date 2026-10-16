import fs from 'node:fs';
import path from 'node:path';
import { die } from './cli.js';
import { PIPELINE_TELEMETRY_FILES } from './worktree.js';

export const DOCS_FRESHNESS_CONFIG_PATH = '.canon/config.json';
export const DEFAULT_PROTECTED_DOCS = [
    'docs/architecture.md', 'docs/codebase-map.md', 'docs/patterns.md',
    'docs/product-context.md', 'docs/decisions.md',
] as const;

export interface DocsFreshnessConfig {
    protected?: readonly string[];
    paths?: Readonly<Record<string, readonly string[]>>;
    flagOnly?: readonly string[];
}
export type DocsFreshnessLoad =
    | { ok: true; source: 'defaults' | 'file'; config: DocsFreshnessConfig | null; unknownKeys: string[] }
    | { ok: false; message: string };

function invalid(problem: string): DocsFreshnessLoad {
    return { ok: false, message: `${DOCS_FRESHNESS_CONFIG_PATH} is invalid: ${problem} Fix the file (or delete it to use canon's defaults), then re-run.` };
}
function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isStrings(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string' && entry.trim().length > 0);
}
function isPipelinePath(value: string): boolean {
    return value === 'tasks' || value.startsWith('tasks/') || (PIPELINE_TELEMETRY_FILES as readonly string[]).includes(value);
}
function docProblem(doc: string, key: string): string | null {
    if (path.posix.isAbsolute(doc) || path.win32.isAbsolute(doc) || doc.split(/[\\/]/).includes('..')) {
        return `doc path "${doc}" in ${key} must be repo-relative with no ".." segment.`;
    }
    if (/[*?[\]{}]/.test(doc)) return `doc path "${doc}" in ${key} must not contain glob characters.`;
    // Git reads a leading colon as pathspec magic when the doc is committed.
    if (doc.startsWith(':')) return `doc path "${doc}" in ${key} must not start with ":".`;
    // Allowlists compare exact file paths, so a directory entry would admit nothing.
    if (['', '.'].includes(doc.split(/[\\/]/).at(-1) ?? '')) {
        return `doc path "${doc}" in ${key} must name a file, not a directory.`;
    }
    // Normalize equivalent spellings before applying the disjoint-class rule.
    if (isPipelinePath(path.posix.normalize(doc.replaceAll('\\', '/')))) {
        return `doc path "${doc}" in ${key} is a pipeline telemetry file or task artifact; telemetry files and tasks/ paths can't be configured.`;
    }
    return null;
}

export function parseDocsFreshnessConfig(raw: string): DocsFreshnessLoad {
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch (error) { return invalid(`not valid JSON (${error instanceof Error ? error.message : String(error)}).`); }
    if (!isObject(value)) return invalid('the top level must be a JSON object.');
    const unknownKeys = Object.keys(value).filter(key => key !== 'docs_freshness');
    if (!Object.hasOwn(value, 'docs_freshness')) return { ok: true, source: 'file', config: null, unknownKeys };
    const docs = value.docs_freshness;
    if (!isObject(docs)) return invalid('"docs_freshness" must be an object.');
    unknownKeys.push(...Object.keys(docs).filter(key => !['protected', 'paths', 'flag_only'].includes(key)).map(key => `docs_freshness.${key}`));
    const config: DocsFreshnessConfig = {};
    for (const key of ['protected', 'flag_only'] as const) {
        if (!Object.hasOwn(docs, key)) continue;
        const list = docs[key];
        if (!isStrings(list)) return invalid(`"docs_freshness.${key}" must be an array of non-empty strings.`);
        for (const doc of list) {
            const problem = docProblem(doc, `docs_freshness.${key}`);
            if (problem) return invalid(problem);
        }
        config[key === 'protected' ? 'protected' : 'flagOnly'] = list.map(doc => path.posix.normalize(doc.replaceAll('\\', '/')));
    }
    if (Object.hasOwn(docs, 'paths')) {
        if (!isObject(docs.paths)) return invalid('"docs_freshness.paths" must be an object mapping globs to arrays of doc paths.');
        const mappings: Record<string, readonly string[]> = Object.create(null) as Record<string, readonly string[]>;
        for (const [glob, list] of Object.entries(docs.paths)) {
            if (!glob.trim() || path.win32.isAbsolute(glob) || glob.startsWith('/') || glob.startsWith('./') || glob.split(/[\\/]/).includes('..')) {
                return invalid(`paths key "${glob}" must be a non-empty repo-relative glob that does not start with "/" or "./" and has no ".." segment.`);
            }
            if (!isStrings(list)) return invalid(`docs_freshness.paths["${glob}"] must be an array of non-empty strings.`);
            for (const doc of list) {
                const problem = docProblem(doc, `docs_freshness.paths["${glob}"]`);
                if (problem) return invalid(problem);
            }
            mappings[glob] = list.map(doc => path.posix.normalize(doc.replaceAll('\\', '/')));
        }
        config.paths = mappings;
    }
    return { ok: true, source: 'file', config, unknownKeys };
}

export function loadDocsFreshnessConfig(root: string): DocsFreshnessLoad {
    try { return parseDocsFreshnessConfig(fs.readFileSync(path.join(root, DOCS_FRESHNESS_CONFIG_PATH), 'utf8')); }
    catch (error) {
        if (isObject(error) && error.code === 'ENOENT') return { ok: true, source: 'defaults', config: null, unknownKeys: [] };
        return invalid(`could not be read (${error instanceof Error ? error.message : String(error)}).`);
    }
}
export function requireDocsFreshnessConfig(root: string): DocsFreshnessConfig | null {
    const loaded = loadDocsFreshnessConfig(root);
    if (!loaded.ok) die(loaded.message);
    return loaded.config;
}
export function formatUnknownKeysWarning(keys: readonly string[]): string {
    return `${DOCS_FRESHNESS_CONFIG_PATH}: unknown key(s) ignored: ${keys.join(', ')}. Check for a misspelled field (for example docs_freshness).`;
}

function expandBraces(segment: string): string[] {
    const open = segment.indexOf('{');
    const close = open < 0 ? -1 : segment.indexOf('}', open);
    if (close < 0) return [segment];
    const head = segment.slice(0, open);
    const tails = expandBraces(segment.slice(close + 1));
    return segment.slice(open + 1, close).split(',').flatMap(alt => tails.map(tail => head + alt + tail));
}
// Iterative `*`/`?` matching: on a mismatch, resume from the latest star only,
// so the cost is bounded by name length times pattern length.
function matchesWildcards(pattern: string, name: string): boolean {
    let p = 0, n = 0, star = -1, resume = 0;
    while (n < name.length) {
        if (p < pattern.length && (pattern[p] === '?' || (pattern[p] !== '*' && pattern[p] === name[n]))) { p++; n++; }
        else if (p < pattern.length && pattern[p] === '*') { star = p++; resume = n; }
        else if (star >= 0) { p = star + 1; n = ++resume; }
        else return false;
    }
    while (pattern[p] === '*') p++;
    return p === pattern.length;
}
export function matchesDocsGlob(pattern: string, filePath: string): boolean {
    // Adjacent globstars describe the same paths.
    const globs = pattern.split('/').filter((segment, i, parts) => segment !== '**' || parts[i - 1] !== '**')
        .map(segment => segment === '**' ? null : expandBraces(segment));
    const names = filePath.split('/');
    const memo = new Map<number, boolean>();
    // Segment-level matching memoized on (glob index, name index), so a
    // globstar never re-explores the same split.
    const match = (g: number, n: number): boolean => {
        const key = g * (names.length + 1) + n;
        const cached = memo.get(key);
        if (cached !== undefined) return cached;
        let result: boolean;
        if (g === globs.length) result = n === names.length;
        else {
            const alternatives = globs[g];
            if (alternatives === null) {
                result = g === globs.length - 1
                    ? n < names.length
                    : match(g + 1, n) || (n < names.length && names[n] !== '' && match(g, n + 1));
            } else {
                result = n < names.length && alternatives.some(alt => matchesWildcards(alt, names[n])) && match(g + 1, n + 1);
            }
        }
        memo.set(key, result);
        return result;
    };
    return match(0, 0);
}

export interface DocsFreshnessSets {
    protected: string[];
    flagOnly: string[];
    admitted: string[];
    configured: string[];
    promptEditable: string[];
    promptFlagged: string[];
    unevaluatedMappedDocs: string[];
}
export function resolveDocsFreshness(config: DocsFreshnessConfig | null, diff: readonly string[] | null): DocsFreshnessSets {
    const protectedDocs = [...new Set(config?.protected ?? DEFAULT_PROTECTED_DOCS)];
    const mappings = Object.entries(config?.paths ?? {});
    const mapped = [...new Set(mappings.flatMap(([, docs]) => [...docs]))];
    const flagOnly = [...new Set(config?.flagOnly ?? [])];
    const prompt = new Set(protectedDocs);
    const paths = diff?.filter(file => !isPipelinePath(file)) ?? [];
    for (const [glob, docs] of mappings) {
        if (paths.some(file => matchesDocsGlob(glob, file))) for (const doc of docs) prompt.add(doc);
    }
    return {
        protected: protectedDocs, flagOnly,
        admitted: [...new Set([...protectedDocs, ...mapped])].filter(doc => !flagOnly.includes(doc)),
        configured: [...new Set([...protectedDocs, ...mapped, ...flagOnly])],
        promptEditable: [...prompt].filter(doc => !flagOnly.includes(doc)),
        promptFlagged: [...prompt].filter(doc => flagOnly.includes(doc)),
        unevaluatedMappedDocs: diff === null ? mapped.filter(doc => !protectedDocs.includes(doc)) : [],
    };
}
