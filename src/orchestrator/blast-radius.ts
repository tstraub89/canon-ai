import fs from 'node:fs';
import path from 'node:path';

import { extractAffectedFiles } from './context.js';
import { gitSafeAt, gitSafeAtRaw } from './git.js';
import { extractSectionBodies } from './markdown-table.js';
import { taskDirFor } from './state.js';
import { getActiveCwd } from './worktree.js';

// Test-only override for deterministic prompt fixtures; this is not a user-facing setting.
export const BLAST_RADIUS_ROOT_ENV = 'CANON_BLAST_RADIUS_ROOT';
export const BLAST_RADIUS_HEADING = '## Blast Radius (files outside Affected Files to check)';
export const BLAST_RADIUS_FRAMING = 'These files are surfaces to check for restatements and sibling paths. Editing a file outside Affected Files still requires recording a Blocker in handoff.md.';
export const PER_ENTRY_LIMIT = 10;
export const TOKEN_CAP = 20;
export const BYTE_CAP = 6144;

const GENERIC_STEMS = new Set(['index', 'types']);
const GENERATED_ATTRIBUTE_VALUES = new Set(['set', 'true']);

type BlastRadiusPart = 'references' | 'identifiers';
type BlastRadiusEntry = { part: BlastRadiusPart; label: string; files: string[] };

function tokensFromBodies(bodies: readonly string[]): string[] {
    const tokens: string[] = [];
    const seen = new Set<string>();
    for (const body of bodies) {
        for (const match of body.matchAll(/`([^`\n]+)`/g)) {
            const token = match[1];
            let normalized: string | null = null;
            if (/^--[a-z0-9][a-z0-9-]*$/.test(token)) {
                normalized = token;
            } else {
                const hadParens = token.endsWith('()');
                const name = hadParens ? token.slice(0, -2) : token;
                const shaped = hadParens || /^[A-Z][a-z0-9]+$/.test(name) || /[a-z0-9][A-Z]/.test(name) || /[A-Z]{2,}[a-z]/.test(name) || /[A-Za-z0-9]_[A-Za-z0-9]/.test(name);
                if (name.length >= 3 && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && shaped) normalized = name;
            }
            if (normalized && !seen.has(normalized)) {
                seen.add(normalized);
                tokens.push(normalized);
            }
        }
    }
    return tokens;
}

export function extractSpecTokens(specMarkdown: string): { amendment: string[]; design: string[]; ac: string[] } {
    const amendment = extractSectionBodies(specMarkdown, /^## Amendment\b/).reverse();
    const design = extractSectionBodies(specMarkdown, /^## Design\b/);
    const ac = extractSectionBodies(specMarkdown, /^## Acceptance Criteria\b/);
    return {
        amendment: tokensFromBodies(amendment),
        design: tokensFromBodies(design),
        ac: tokensFromBodies(ac),
    };
}

function excludedPath(file: string, affectedFiles: readonly string[], directoryEntries: readonly string[]): boolean {
    return affectedFiles.includes(file) || directoryEntries.some(directory => file.startsWith(directory)) || file.startsWith('tasks/');
}

function gitGrep(root: string, modeFlags: readonly string[], pattern: string): string[] {
    const result = gitSafeAtRaw(root, 'grep', '-l', '-I', '-z', ...modeFlags, '-e', pattern);
    if (result.ok) return result.stdout.split('\0').filter(Boolean);
    if (!result.stderr) return [];
    throw new Error(`git grep failed: ${result.stderr}`);
}

function escapeEre(value: string): string {
    return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

function trackedReferenceFiles(root: string, affectedFile: string): string[] {
    const basename = path.basename(affectedFile);
    const matches = new Set(gitGrep(root, ['-F', '-w'], basename));
    const stem = path.basename(affectedFile, path.extname(affectedFile));
    if (stem && !GENERIC_STEMS.has(stem)) {
        // Match module specifiers ending in /<stem>[.<extension>] followed by a quote.
        const quoteClass = '[' + String.fromCharCode(39, 34, 96) + ']';
        const moduleSpecifier = '/' + escapeEre(stem) + '(\\.[A-Za-z0-9]+)?' + quoteClass;
        for (const file of gitGrep(root, ['-E'], moduleSpecifier)) matches.add(file);
    }
    return [...matches].sort();
}

function specTokens(taskIds: readonly string[]): string[] {
    const byTier = { amendment: [] as string[], design: [] as string[], ac: [] as string[] };
    for (const taskId of taskIds) {
        try {
            const markdown = fs.readFileSync(path.join(taskDirFor(taskId), 'spec.md'), 'utf8');
            const extracted = extractSpecTokens(markdown);
            byTier.amendment.push(...extracted.amendment);
            byTier.design.push(...extracted.design);
            byTier.ac.push(...extracted.ac);
        } catch {
            // An unreadable task spec contributes no identifier tokens.
        }
    }
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const token of [...byTier.amendment, ...byTier.design, ...byTier.ac]) {
        if (seen.has(token)) continue;
        seen.add(token);
        ordered.push(token);
        if (ordered.length === TOKEN_CAP) break;
    }
    return ordered;
}

function generatedFiles(root: string, candidates: readonly string[]): Set<string> {
    const generated = new Set<string>();
    for (let start = 0; start < candidates.length; start += 200) {
        const chunk = candidates.slice(start, start + 200);
        const result = gitSafeAtRaw(root, 'check-attr', '-z', 'linguist-generated', '--', ...chunk);
        if (!result.ok) throw new Error(`git check-attr failed: ${result.stderr || 'unknown error'}`);
        const fields = result.stdout.split('\0');
        for (let index = 0; index + 2 < fields.length; index += 3) {
            if (GENERATED_ATTRIBUTE_VALUES.has(fields[index + 2])) generated.add(fields[index]);
        }
    }
    return generated;
}

function formatEntry(entry: BlastRadiusEntry): string {
    const shown = entry.files.slice(0, PER_ENTRY_LIMIT).map(file => `\`${file}\``);
    const remaining = entry.files.length - shown.length;
    return `- \`${entry.label}\`: ${shown.join(', ')}${remaining > 0 ? `, +${remaining} more` : ''}`;
}

function renderEntries(entries: readonly BlastRadiusEntry[], omitted = 0): string {
    let block = `\n${BLAST_RADIUS_HEADING}\n\n${BLAST_RADIUS_FRAMING}\n\n`;
    for (const [part, heading] of [
        ['references', '### Files referencing Affected Files'],
        ['identifiers', '### Files containing spec-named identifiers'],
    ] as const) {
        const partEntries = entries.filter(entry => entry.part === part);
        if (partEntries.length === 0) continue;
        block += `${heading}\n${partEntries.map(formatEntry).join('\n')}\n\n`;
    }
    if (omitted > 0) block += `- … ${omitted} more entries omitted to stay under the size limit.\n`;
    return block;
}

function boundedBlock(entries: BlastRadiusEntry[]): string {
    if (entries.length === 0) return '';
    const full = renderEntries(entries);
    if (Buffer.byteLength(full) <= BYTE_CAP) return full;

    const retained = [...entries];
    let omitted = 0;
    while (retained.length > 0) {
        retained.pop();
        omitted += 1;
        const candidate = renderEntries(retained, omitted);
        if (Buffer.byteLength(candidate) <= BYTE_CAP) return candidate;
    }
    const truncated = renderEntries([], entries.length);
    return Buffer.byteLength(truncated) <= BYTE_CAP ? truncated : '';
}

export function buildBlastRadiusBlock(taskIds: string[], root: string): string {
    try {
        const repository = gitSafeAt(root, 'rev-parse', '--is-inside-work-tree');
        if (!repository.ok || repository.stdout !== 'true') return '';

        const affectedFiles = [...new Set(taskIds.flatMap(taskId => extractAffectedFiles(taskId)))];
        const directoryEntries = affectedFiles.filter(file => file.endsWith('/'));
        const entries: BlastRadiusEntry[] = [];

        for (const file of affectedFiles) {
            if (file.endsWith('/')) continue;
            const absolute = path.resolve(root, file);
            const rootPrefix = path.resolve(root) + path.sep;
            if (!absolute.startsWith(rootPrefix) || !fs.statSync(absolute, { throwIfNoEntry: false })?.isFile()) continue;
            const matches = new Set(trackedReferenceFiles(root, file));
            const files = [...matches].filter(candidate => !excludedPath(candidate, affectedFiles, directoryEntries)).sort();
            if (files.length > 0) entries.push({ part: 'references', label: file, files });
        }

        for (const token of specTokens(taskIds)) {
            const files = gitGrep(root, ['-F', '-w'], token)
                .filter(file => !excludedPath(file, affectedFiles, directoryEntries))
                .sort();
            if (files.length > 0) entries.push({ part: 'identifiers', label: token, files: [...new Set(files)] });
        }

        const candidates = [...new Set(entries.flatMap(entry => entry.files))];
        if (candidates.length > 0) {
            const generated = generatedFiles(root, candidates);
            for (const entry of entries) entry.files = entry.files.filter(file => !generated.has(file));
        }
        return boundedBlock(entries.filter(entry => entry.files.length > 0));
    } catch {
        return '';
    }
}

export function resolveBlastRadiusRoot(taskIds: string[]): string {
    return process.env[BLAST_RADIUS_ROOT_ENV] || getActiveCwd(taskIds);
}
