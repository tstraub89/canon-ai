import fs from 'node:fs';
import path from 'node:path';

import { extractAffectedFiles } from './context.js';
import { matchesDocsGlob } from './docs-freshness.js';
import { getActiveCwd } from './worktree.js';

// Test-only override for the docs root used by lessons and linked pitfall docs.
export const PITFALLS_DOCS_ROOT_ENV = 'CANON_PITFALLS_DOCS_ROOT';
export const PITFALLS_BYTE_CAP = 24 * 1024;
export const PITFALLS_HEADING = '## Relevant Pitfalls and Lessons (selected by spec Affected Files)';

type Heading = {
    level: 1 | 2 | 3;
    text: string;
    start: number;
    end: number;
    startLine: number;
    endLine: number;
};

type MarkdownDoc = {
    path: string;
    text: string;
    lines: string[];
    lineStarts: number[];
    outsideFence: boolean[];
    headings: Heading[];
};

type DocEntry = {
    doc: MarkdownDoc;
    heading: Heading;
    title: string;
    body: string;
    unconditional?: boolean;
};

type SectionTarget = { kind: 'section'; doc: MarkdownDoc; heading: Heading };
type LinkedTarget = { kind: 'linked'; path: string };
type DocSectionTarget = { kind: 'doc-section'; path: string; section: string };
type Target = SectionTarget | LinkedTarget | DocSectionTarget;
type ParsedTarget = { target: Target; specificity: number };

type IndexRow = {
    line: string;
    targets: Target[];
    keys: string[];
    matched: boolean;
};

type MarkdownTable = {
    startLine: number;
    endLine: number;
    header: string[];
    rows: string[][];
};

type CandidateChannel = 'direct' | 'linked' | 'section' | 'lesson';
type Candidate = {
    doc: MarkdownDoc;
    start: number;
    end: number;
    title: string;
    body: string;
    channel: CandidateChannel;
    docOrder: number;
    position: number;
    unconditional?: boolean;
};

export type PitfallsInput = {
    patterns: string | null;
    lessons: string | null;
    readDoc: (repoPath: string) => string | null;
    affectedFiles: readonly string[];
    cap?: number;
};

const CHANNEL_PRIORITY: Record<CandidateChannel, number> = {
    direct: 0,
    linked: 1,
    section: 2,
    lesson: 3,
};

const DEMOTION_ORDER: CandidateChannel[] = ['lesson', 'section', 'linked', 'direct'];
const PATTERNS_PATH = 'docs/patterns.md';
const LESSONS_PATH = 'docs/lessons-learned.md';
// Mirrors the Known Pitfalls index-table target-header hint rule.
const TARGET_HEADER_HINT = /\b(?:sections?|docs?)\b|read this/i;

function scanMarkdown(markdown: string, docPath: string): MarkdownDoc {
    markdown = markdown.replace(/\r\n?/g, '\n');
    const lines = markdown.split('\n');
    const lineStarts: number[] = [];
    const outsideFence: boolean[] = [];
    let offset = 0;
    let fenceChar = '';
    let fenceLength = 0;
    const headings: Heading[] = [];

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        lineStarts.push(offset);
        const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
        const fence = fenceMatch && !(fenceMatch[1][0] === '`' && fenceMatch[2].includes('`')) ? fenceMatch : null;
        if (fenceChar) {
            outsideFence.push(false);
            const closing = fence && fence[1][0] === fenceChar && fence[1].length >= fenceLength && /^\s*$/.test(fence[2]);
            if (closing) {
                fenceChar = '';
                fenceLength = 0;
            }
        } else if (fence) {
            outsideFence.push(false);
            fenceChar = fence[1][0];
            fenceLength = fence[1].length;
        } else {
            outsideFence.push(true);
            const match = line.match(/^ {0,3}(#{1,3})[ \t]+(.+?)[ \t]*$/);
            if (match) {
                const title = match[2].replace(/[ \t]+#+[ \t]*$/, '').trim();
                headings.push({
                    level: match[1].length as 1 | 2 | 3,
                    text: title,
                    start: offset,
                    end: markdown.length,
                    startLine: index,
                    endLine: lines.length,
                });
            }
        }
        offset += line.length + (index < lines.length - 1 ? 1 : 0);
    }

    for (let index = 0; index < headings.length; index++) {
        const heading = headings[index];
        let endLine = lines.length;
        let end = markdown.length;
        for (let next = index + 1; next < headings.length; next++) {
            if (headings[next].level <= heading.level) {
                endLine = headings[next].startLine;
                end = headings[next].start;
                break;
            }
        }
        heading.endLine = endLine;
        heading.end = end;
    }

    return { path: docPath, text: markdown, lines, lineStarts, outsideFence, headings };
}

function headingBody(doc: MarkdownDoc, heading: Heading): string {
    return doc.text.slice(heading.start, heading.end).trim();
}

function headingsAt(doc: MarkdownDoc, level: 1 | 2 | 3): Heading[] {
    return doc.headings.filter(heading => heading.level === level);
}

function sectionHeading(doc: MarkdownDoc, name: string): Heading | null {
    const target = name.trim().toLocaleLowerCase();
    if (!target) return null;
    const choices = doc.headings.filter(heading => heading.level === 2 || heading.level === 3);
    const exact = choices.find(heading => heading.text.toLocaleLowerCase() === target);
    if (exact) return exact;
    return choices
        .filter(heading => heading.text.toLocaleLowerCase().startsWith(target))
        .sort((left, right) => left.text.length - right.text.length || left.start - right.start)[0] ?? null;
}

function knownPitfallEntries(patterns: MarkdownDoc): DocEntry[] {
    const result: DocEntry[] = [];
    for (const section of headingsAt(patterns, 2).filter(heading => heading.text.toLocaleLowerCase().startsWith('known pitfalls'))) {
        let foundEntry = false;
        for (const heading of patterns.headings) {
            if (heading.level !== 3 || heading.start < section.start || heading.start >= section.end) continue;
            foundEntry = true;
            result.push({ doc: patterns, heading, title: heading.text, body: headingBody(patterns, heading) });
        }
        if (!foundEntry) {
            const body = proseFallbackBody(patterns, section);
            if (body) result.push({ doc: patterns, heading: section, title: section.text, body, unconditional: true });
        }
    }
    return result;
}

function docEntries(doc: MarkdownDoc): DocEntry[] {
    return headingsAt(doc, 3).map(heading => ({
        doc,
        heading,
        title: heading.text,
        body: headingBody(doc, heading),
    }));
}

function lessonsEntries(lessons: MarkdownDoc): DocEntry[] {
    const excluded: Array<{ start: number; end: number }> = [];
    for (const heading of headingsAt(lessons, 2)) {
        const title = heading.text.toLocaleLowerCase();
        if (title !== 'how to use this doc' && title !== 'entry format' && !title.startsWith('example')) continue;
        let end = heading.end;
        for (let line = heading.startLine + 1; line < heading.endLine; line++) {
            if (lessons.outsideFence[line] && lessons.lines[line].trim() === '---') {
                end = lessons.lineStarts[line];
                break;
            }
        }
        excluded.push({ start: heading.start, end });
    }
    return docEntries(lessons).filter(entry => !excluded.some(scope => entry.heading.start >= scope.start && entry.heading.start < scope.end));
}

function isUrl(value: string): boolean {
    return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value);
}

function stripLineSuffix(value: string): string {
    return value.replace(/:\d+(?:-\d+)?$/, '');
}

function normalizeRepoToken(value: string, fromDoc?: string, markdownLink = false): string | null {
    let token = value.trim();
    if (markdownLink) {
        token = token.replace(/^<|>$/g, '').split('#', 1)[0];
        if (isUrl(token)) return null;
        if (path.posix.isAbsolute(token)) return null;
        token = path.posix.join(path.posix.dirname(fromDoc ?? PATTERNS_PATH), token);
    }
    token = stripLineSuffix(token.replaceAll('\\', '/'));
    if (!token || /\s/.test(token) || isUrl(token) || path.posix.isAbsolute(token)) return null;
    const trailingSlash = token.endsWith('/');
    const normalized = path.posix.normalize(token.replace(/^\.\//, ''));
    if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null;
    const result = trailingSlash && !normalized.endsWith('/') ? `${normalized}/` : normalized;
    return result.includes('/') || result.includes('*') ? result : null;
}

function pathTokens(markdown: string, docPath: string): string[] {
    const doc = scanMarkdown(markdown, docPath);
    const tokens: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < doc.lines.length; index++) {
        if (!doc.outsideFence[index]) continue;
        const line = doc.lines[index];
        for (const match of line.matchAll(/`([^`\n]+)`/g)) {
            const token = normalizeRepoToken(match[1]);
            if (token && !seen.has(token)) {
                seen.add(token);
                tokens.push(token);
            }
        }
        for (const match of line.matchAll(/\]\((<[^>\n]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g)) {
            const token = normalizeRepoToken(match[1], docPath, true);
            if (token && !seen.has(token)) {
                seen.add(token);
                tokens.push(token);
            }
        }
    }
    return tokens;
}

function normalizeAffectedFile(value: string): string | null {
    const token = value.replaceAll('\\', '/').trim();
    if (!token || path.posix.isAbsolute(token) || /\s/.test(token)) return null;
    const trailingSlash = token.endsWith('/');
    const normalized = path.posix.normalize(token.replace(/^\.\//, ''));
    if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null;
    return trailingSlash && !normalized.endsWith('/') ? `${normalized}/` : normalized;
}

function globCouldMatchInsideDir(glob: string, dir: string): boolean {
    const globSegments = glob.split('/').filter(Boolean);
    const dirSegments = dir.split('/').filter(Boolean);
    for (let index = 0; index < dirSegments.length; index++) {
        if (index >= globSegments.length) return false;
        if (globSegments[index] === '**') return true;
        if (!matchesDocsGlob(globSegments[index], dirSegments[index])) return false;
    }
    // A path inside the directory needs at least one segment beyond the directory itself.
    return globSegments.length > dirSegments.length;
}

function tokenMatches(token: string, filePath: string): boolean {
    if (token === filePath) return true;
    if (token.endsWith('/') && filePath.startsWith(token)) return true;
    if (filePath.endsWith('/')) {
        if (token.startsWith(filePath)) return true;
        if (token.includes('*') && globCouldMatchInsideDir(token, filePath)) return true;
    }
    return token.includes('*') && matchesDocsGlob(token, filePath);
}

function rowMatches(keys: readonly string[], affectedFiles: readonly string[]): boolean {
    return keys.some(key => affectedFiles.some(file => tokenMatches(key, file)));
}

function splitCells(line: string): string[] | null {
    const source = line.trim();
    if (!source.startsWith('|') || !source.endsWith('|')) return null;
    const cells: string[] = [];
    let cell = '';
    let codeTicks = 0;
    for (let index = 1; index < source.length - 1; index++) {
        const char = source[index];
        if (char === '`') {
            let runLength = 1;
            while (source[index + runLength] === '`') runLength++;
            if (codeTicks === 0) codeTicks = runLength;
            else if (runLength === codeTicks) codeTicks = 0;
            cell += '`'.repeat(runLength);
            index += runLength - 1;
        } else if (char === '\\' && source[index + 1] === '|') {
            cell += '\\|';
            index++;
        } else if (char === '|' && codeTicks === 0) {
            cells.push(cell.trim());
            cell = '';
        } else {
            cell += char;
        }
    }
    if (codeTicks !== 0) return null;
    cells.push(cell.trim());
    return cells.length >= 2 ? cells : null;
}

function isSeparatorRow(cells: readonly string[]): boolean {
    return cells.every(cell => /^:?-{3,}:?$/.test(cell.replaceAll(' ', '')));
}

function markdownTablesInSection(doc: MarkdownDoc, section: Heading): MarkdownTable[] {
    const result: MarkdownTable[] = [];
    let line = section.startLine + 1;
    while (line < section.endLine) {
        if (!doc.outsideFence[line]) {
            line++;
            continue;
        }
        const header = splitCells(doc.lines[line]);
        const separator = line + 1 < section.endLine ? splitCells(doc.lines[line + 1]) : null;
        if (!header || !separator || !isSeparatorRow(separator) || separator.length !== header.length) {
            line++;
            continue;
        }
        const startLine = line;
        line += 2;
        const tableRows: string[][] = [];
        while (line < section.endLine) {
            if (!doc.outsideFence[line]) break;
            const cells = splitCells(doc.lines[line]);
            if (!cells) {
                const raw = doc.lines[line].trim();
                if (raw.startsWith('|') && raw.endsWith('|')) {
                    tableRows.push([raw.replace(/^\|/, '').replace(/\|$/, '').trim()]);
                    line++;
                    continue;
                }
                break;
            }
            if (cells.length !== header.length) {
                tableRows.push([doc.lines[line].trim().replace(/^\|/, '').replace(/\|$/, '').trim()]);
            } else if (!isSeparatorRow(cells)) {
                tableRows.push(cells);
            }
            line++;
        }
        result.push({ startLine, endLine: line, header, rows: tableRows });
    }
    return result;
}

function knownPitfallsIndexTables(doc: MarkdownDoc, section: Heading): MarkdownTable[] {
    const firstH3Line = doc.headings.find(heading => heading.level === 3
        && heading.start >= section.start && heading.start < section.end)?.startLine ?? section.endLine;
    return markdownTablesInSection(doc, section).filter(table => table.startLine < firstH3Line);
}

function proseFallbackBody(patterns: MarkdownDoc, section: Heading): string {
    const indexLines = new Set<number>();
    for (const table of knownPitfallsIndexTables(patterns, section)) {
        for (let line = table.startLine; line < table.endLine; line++) indexLines.add(line);
    }

    const keptLines: string[] = [];
    let inBlockquote = false;
    for (let line = section.startLine + 1; line < section.endLine; line++) {
        if (indexLines.has(line)) continue;
        const text = patterns.lines[line];
        if (!patterns.outsideFence[line]) {
            keptLines.push(text);
            continue;
        }
        if (/^ {0,3}>/.test(text)) {
            inBlockquote = true;
            continue;
        }
        if (inBlockquote && text.trim() !== '') continue;
        if (inBlockquote) inBlockquote = false;
        keptLines.push(text);
    }
    return keptLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function tableRowsInSection(
    doc: MarkdownDoc,
    section: Heading,
): MarkdownTable[] {
    if (section.text.toLocaleLowerCase().startsWith('known pitfalls')) return knownPitfallsIndexTables(doc, section);
    return markdownTablesInSection(doc, section);
}

function stripParenthetical(value: string): string {
    return value.replace(/\[[^\]]+\]\([^)]+\)|\([^)]*\)/g, match => match.startsWith('[') ? match : '').trim();
}

function resolveLinkPath(target: string): string | null {
    const link = target.trim().replace(/^<|>$/g, '').split('#', 1)[0];
    if (!link || isUrl(link) || path.posix.isAbsolute(link)) return null;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(PATTERNS_PATH), link));
    if (resolved === '..' || resolved.startsWith('../')) return null;
    return resolved;
}

function parseDocPathItem(item: string): { path: string } | null {
    const codePath = item.match(/^\s*`([^`]+)`\s*$/);
    if (codePath) {
        const normalized = normalizeRepoToken(codePath[1]);
        if (normalized?.toLocaleLowerCase().endsWith('.md') && !normalized.includes('*')) return { path: normalized };
        return null;
    }
    const link = item.match(/^\s*\[[^\]]+\]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)\s*$/);
    if (link) {
        const resolved = resolveLinkPath(link[1]);
        if (resolved?.toLocaleLowerCase().endsWith('.md') && !resolved.includes('*')) return { path: resolved };
    }
    return null;
}

function docSectionMatch(item: string): RegExpMatchArray | null {
    return stripParenthetical(item).match(/^\s*(`[^`]+`|\[[^\]]+\]\([^)]+\))\s*§\s*(.+?)\s*$/);
}

function isDocSectionItem(item: string): boolean {
    return docSectionMatch(item) !== null;
}

function parseTargetFromItem(item: string, patterns: MarkdownDoc, readDoc: (repoPath: string) => string | null): ParsedTarget | null {
    const clean = stripParenthetical(item);
    const docSection = docSectionMatch(item);
    if (docSection) {
        const parsed = parseDocPathItem(docSection[1]);
        if (!parsed) return null;
        const sectionName = docSection[2].replaceAll('`', '').trim();
        const doc = parsed.path === PATTERNS_PATH ? patterns : (() => {
            const text = readDoc(parsed.path);
            return text === null ? null : scanMarkdown(text, parsed.path);
        })();
        const heading = doc ? sectionHeading(doc, sectionName) : null;
        if (!heading || !doc) return null;
        return {
            target: { kind: 'doc-section', path: parsed.path, section: heading.text },
            specificity: heading.text.toLocaleLowerCase() === sectionName.toLocaleLowerCase() ? 2 : 0,
        };
    }

    const docPath = parseDocPathItem(clean);
    if (docPath) {
        if (docPath.path === PATTERNS_PATH) return null;
        return { target: { kind: 'linked', path: docPath.path }, specificity: 1 };
    }

    const sectionName = clean.replaceAll('`', '').trim();
    const heading = sectionHeading(patterns, sectionName);
    if (!heading) return null;
    return {
        target: { kind: 'section', doc: patterns, heading },
        specificity: heading.text.toLocaleLowerCase() === sectionName.toLocaleLowerCase() ? 2 : 0,
    };
}

function splitTargetItems(value: string): string[] {
    const items: string[] = [];
    let item = '';
    let parentheses = 0;
    let codeTicks = 0;
    for (let index = 0; index < value.length; index++) {
        const char = value[index];
        if (char === '`') {
            let runLength = 1;
            while (value[index + runLength] === '`') runLength++;
            if (codeTicks === 0) codeTicks = runLength;
            else if (runLength === codeTicks) codeTicks = 0;
            item += '`'.repeat(runLength);
            index += runLength - 1;
        } else if (codeTicks === 0 && char === '(') {
            parentheses++;
            item += char;
        } else if (codeTicks === 0 && char === ')' && parentheses > 0) {
            parentheses--;
            item += char;
        } else if (codeTicks === 0 && parentheses === 0 && char === ';') {
            items.push(item.trim());
            item = '';
        } else {
            item += char;
        }
    }
    items.push(item.trim());
    return items.filter(Boolean);
}

function buildIndexRows(patterns: MarkdownDoc | null, affectedFiles: readonly string[], readDoc: (repoPath: string) => string | null): IndexRow[] {
    if (!patterns) return [];
    const sections = patterns.headings.filter(heading => heading.level === 2 && (
        heading.text.toLocaleLowerCase().startsWith('trigger table')
        || heading.text.toLocaleLowerCase().startsWith('known pitfalls')
    ));
    const rows: IndexRow[] = [];
    for (const section of sections) {
        for (const table of tableRowsInSection(patterns, section)) {
            const targetHint = table.header.findIndex(cell => TARGET_HEADER_HINT.test(cell.replaceAll('`', '').replaceAll('*', '')));
            for (const cells of table.rows) {
                if (cells.length === 1) {
                    rows.push({ line: `- ${cells[0]}`, targets: [], keys: [], matched: false });
                    continue;
                }

                let targetCell = targetHint >= 0 && targetHint < cells.length ? targetHint : 0;
                if (targetHint < 0) {
                    const hasDocPathOrSectionReference = (item: string): boolean => {
                        if (isDocSectionItem(item)) return true;
                        const docPath = parseDocPathItem(stripParenthetical(item));
                        return docPath !== null && docPath.path !== PATTERNS_PATH;
                    };
                    const isExactSection = (item: string): boolean => {
                        const parsed = parseTargetFromItem(item, patterns, readDoc);
                        return parsed !== null && parsed.specificity === 2 && parsed.target.kind !== 'linked';
                    };
                    const isPrefixSection = (item: string): boolean => {
                        const parsed = parseTargetFromItem(item, patterns, readDoc);
                        return parsed !== null && parsed.specificity === 0 && parsed.target.kind !== 'linked';
                    };
                    const tiers = [hasDocPathOrSectionReference, isExactSection, isPrefixSection];
                    for (const matchesTier of tiers) {
                        const index = cells.findIndex(cell => splitTargetItems(cell).some(matchesTier));
                        if (index >= 0) {
                            targetCell = index;
                            break;
                        }
                    }
                }

                const targets = targetHint >= 0 && targetHint >= cells.length
                    ? []
                    : splitTargetItems(cells[targetCell])
                        .map(item => parseTargetFromItem(item, patterns, readDoc))
                        .filter((item): item is ParsedTarget => item !== null)
                        .map(item => item.target);
                const keys = cells.flatMap((cell, index) => index === targetCell ? [] : pathTokens(cell, patterns.path));
                const matched = rowMatches(keys, affectedFiles);
                const targetText = cells[targetCell];
                const otherText = cells.filter((_, index) => index !== targetCell).join(' — ');
                const line = `- ${targetText}${otherText ? ` — ${otherText}` : ''}${matched ? ' **(matches this task)**' : ''}`;
                rows.push({ line, targets, keys, matched });
            }
        }
    }
    return rows;
}

function addCandidate(candidates: Candidate[], candidate: Candidate): void {
    const sameSpanIndex = candidates.findIndex(existing => existing.doc.path === candidate.doc.path
        && existing.start === candidate.start && existing.end === candidate.end);
    if (sameSpanIndex >= 0) {
        if (CHANNEL_PRIORITY[candidate.channel] < CHANNEL_PRIORITY[candidates[sameSpanIndex].channel]) {
            candidates[sameSpanIndex] = candidate;
        }
        return;
    }
    candidates.push(candidate);
}

function candidateFromEntry(entry: DocEntry, channel: CandidateChannel, docOrder: number): Candidate {
    return {
        doc: entry.doc,
        start: entry.heading.start,
        end: entry.heading.end,
        title: entry.title,
        body: entry.body,
        channel,
        docOrder,
        position: entry.heading.start,
        unconditional: entry.unconditional,
    };
}

function candidateFromSection(doc: MarkdownDoc, heading: Heading, docOrder: number): Candidate {
    return {
        doc,
        start: heading.start,
        end: heading.end,
        title: heading.text,
        body: headingBody(doc, heading),
        channel: 'section',
        docOrder,
        position: heading.start,
    };
}

function candidateCovered(candidate: Candidate, others: readonly Candidate[]): boolean {
    return others.some(other => other.doc.path === candidate.doc.path
        && other.start <= candidate.start && other.end >= candidate.end
        && (other.start < candidate.start || other.end > candidate.end));
}

function visibleCandidates(active: readonly Candidate[]): Candidate[] {
    return active.filter(candidate => !candidateCovered(candidate, active)).sort((left, right) => left.docOrder - right.docOrder || left.start - right.start);
}

function entryIsCovered(entry: DocEntry, active: readonly Candidate[]): boolean {
    return active.some(candidate => candidate.doc.path === entry.doc.path
        && candidate.start <= entry.heading.start && candidate.end >= entry.heading.end);
}

function isPathInsideRoot(root: string, repoPath: string): boolean {
    if (path.isAbsolute(repoPath) || repoPath.split(/[\\/]/).includes('..')) return false;
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(resolvedRoot, ...repoPath.split('/'));
    if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) return false;
    try {
        const realRoot = fs.realpathSync(resolvedRoot);
        const realPath = fs.realpathSync(resolved);
        return realPath.startsWith(`${realRoot}${path.sep}`);
    } catch {
        return false;
    }
}

function titleGroupsFor(entriesByDoc: Map<string, DocEntry[]>, active: readonly Candidate[], demoted: readonly Candidate[], matchedLinkedDocs: Set<string>): Array<{
    doc: string;
    titles: string[];
    open: boolean;
}> {
    const byDoc = new Map<string, { doc: string; titles: string[]; open: boolean }>();
    for (const [doc, entries] of entriesByDoc) {
        const titles = entries.filter(entry => !entryIsCovered(entry, active)).map(entry => entry.title);
        if (titles.length > 0) byDoc.set(doc, { doc, titles, open: matchedLinkedDocs.has(doc) });
    }
    for (const candidate of demoted) {
        if (candidate.channel !== 'direct' && candidate.channel !== 'linked') continue;
        const group = byDoc.get(candidate.doc.path) ?? { doc: candidate.doc.path, titles: [], open: matchedLinkedDocs.has(candidate.doc.path) };
        if (!group.titles.includes(candidate.title)) group.titles.push(candidate.title);
        byDoc.set(candidate.doc.path, group);
    }
    return [...byDoc.values()];
}

function bodyByteLength(value: string): number {
    return Buffer.byteLength(value, 'utf8');
}

function selectPitfallsInternal(input: PitfallsInput): string {
    const affectedFiles = [...new Set(input.affectedFiles.map(normalizeAffectedFile).filter((value): value is string => value !== null))];
    const patterns = input.patterns === null ? null : scanMarkdown(input.patterns, PATTERNS_PATH);
    const lessonsDoc = input.lessons === null ? null : scanMarkdown(input.lessons, LESSONS_PATH);
    const linkedDocCache = new Map<string, MarkdownDoc | null>();
    const readLinkedDoc = (repoPath: string): MarkdownDoc | null => {
        if (linkedDocCache.has(repoPath)) return linkedDocCache.get(repoPath) ?? null;
        let text: string | null = null;
        try {
            text = input.readDoc(repoPath);
        } catch {
            text = null;
        }
        const doc = text === null ? null : scanMarkdown(text, repoPath);
        linkedDocCache.set(repoPath, doc);
        return doc;
    };
    const indexRows = buildIndexRows(patterns, affectedFiles, repoPath => readLinkedDoc(repoPath)?.text ?? null);
    const linkedPaths: string[] = [];
    const linkedPathSeen = new Set<string>();
    const matchedLinkedDocs = new Set<string>();
    for (const row of indexRows) {
        for (const target of row.targets) {
            if (target.kind === 'linked') {
                if (!linkedPathSeen.has(target.path)) {
                    linkedPathSeen.add(target.path);
                    linkedPaths.push(target.path);
                }
                if (row.matched) matchedLinkedDocs.add(target.path);
            }
        }
    }

    const candidates: Candidate[] = [];
    const titleEntries = new Map<string, DocEntry[]>();
    const patternsEntries = patterns ? knownPitfallEntries(patterns) : [];
    if (patterns) titleEntries.set(patterns.path, patternsEntries);
    if (patterns) {
        for (const entry of patternsEntries) {
            if (entry.unconditional || pathTokens(entry.body, patterns.path).some(token => rowMatches([token], affectedFiles))) {
                addCandidate(candidates, candidateFromEntry(entry, 'direct', 0));
            }
        }
    }

    linkedPaths.forEach((repoPath, index) => {
        const doc = readLinkedDoc(repoPath);
        if (!doc) return;
        const entries = docEntries(doc);
        titleEntries.set(repoPath, entries);
        for (const entry of entries) {
            if (pathTokens(entry.body, doc.path).some(token => rowMatches([token], affectedFiles))) {
                addCandidate(candidates, candidateFromEntry(entry, 'linked', index + 1));
            }
        }
    });

    if (patterns) {
        for (const row of indexRows) {
            if (!row.matched) continue;
            for (const target of row.targets) {
                if (target.kind === 'section') addCandidate(candidates, candidateFromSection(target.doc, target.heading, 0));
                else if (target.kind === 'doc-section') {
                    const doc = target.path === PATTERNS_PATH ? patterns : readLinkedDoc(target.path);
                    const heading = doc ? sectionHeading(doc, target.section) : null;
                    if (doc && heading) addCandidate(candidates, candidateFromSection(doc, heading, target.path === PATTERNS_PATH ? 0 : (linkedPaths.indexOf(target.path) + 1 || linkedPaths.length + 1)));
                }
            }
        }
    }

    const lessonEntries = lessonsDoc ? lessonsEntries(lessonsDoc) : [];
    if (lessonsDoc) {
        for (const entry of lessonEntries) {
            if (pathTokens(entry.body, lessonsDoc.path).some(token => rowMatches([token], affectedFiles))) {
                addCandidate(candidates, candidateFromEntry(entry, 'lesson', Number.MAX_SAFE_INTEGER));
            }
        }
    }

    let active = [...candidates];
    const demoted: Candidate[] = [];
    const titleLimitState = { perDoc: Number.POSITIVE_INFINITY };
    const areaLimitState = { count: indexRows.length };
    const demotedLimitState = { count: Number.POSITIVE_INFINITY };
    const requestedCap = input.cap ?? PITFALLS_BYTE_CAP;
    const cap = Number.isFinite(requestedCap) ? Math.max(0, Math.floor(requestedCap)) : PITFALLS_BYTE_CAP;
    let capped = false;

    function render(): string {
        const full = visibleCandidates(active);
        const pitfallFull = full.filter(candidate => candidate.channel !== 'lesson' && !candidate.unconditional);
        const proseFull = full.filter(candidate => candidate.unconditional);
        const lessonFull = full.filter(candidate => candidate.channel === 'lesson');
        const groups = titleGroupsFor(titleEntries, active, demoted, matchedLinkedDocs);
        const titleLines: string[] = [];
        let droppedTitles = 0;
        for (const group of groups) {
            const shown = group.titles.slice(0, titleLimitState.perDoc);
            const omitted = group.titles.length - shown.length;
            droppedTitles += omitted;
            if (shown.length === 0 && omitted === 0) continue;
            titleLines.push(`**${group.doc}**`);
            if (group.open) titleLines.push(`Open \`${group.doc}\` — it covers files this task touches.`);
            for (const title of shown) titleLines.push(`- ${title}`);
            if (omitted > 0) titleLines.push(`- +${omitted} more in ${group.doc}`);
        }

        const areaVisible = indexRows.slice(0, areaLimitState.count).map(row => row.line);
        const droppedRows = indexRows.length - areaVisible.length;
        if (droppedRows > 0) areaVisible.push(`- +${droppedRows} more index rows`);
        const demotedCandidates = demoted
            .filter(candidate => candidate.channel === 'section' || candidate.channel === 'lesson')
        const demotedVisible = demotedCandidates.slice(0, demotedLimitState.count);
        const droppedDemoted = demotedCandidates.length - demotedVisible.length;
        const demotedLines = demotedVisible.map(candidate => `- ${candidate.title} (demoted to fit)`);
        if (droppedDemoted > 0) demotedLines.push(`- +${droppedDemoted} more demoted titles`);

        const sections: string[] = [];
        if (pitfallFull.length > 0) sections.push(`### Pitfalls and patterns that cite your files\n\n${pitfallFull.map(candidate => candidate.body).join('\n\n')}`);
        if (proseFull.length > 0) sections.push(`### Known Pitfalls (included regardless of your files)\n\n_This section has no \`###\` entries, so its prose is included in full (index tables and blockquotes omitted) whatever the task's Affected Files._\n\n${proseFull.map(candidate => candidate.body).join('\n\n')}`);
        if (lessonFull.length > 0) sections.push(`### Lessons that cite your files\n\n${lessonFull.map(candidate => candidate.body).join('\n\n')}`);
        if (areaVisible.length > 0) sections.push(`### Area index\n\n${areaVisible.join('\n')}`);
        if (titleLines.length > 0) sections.push(`### Other pitfalls (titles only)\n\n${titleLines.join('\n')}`);
        if (demotedLines.length > 0) sections.push(`### Demoted to fit the cap\n\n${demotedLines.join('\n')}`);

        const totalDemoted = demoted.length;
        const note = capped
            ? `\n\n_Pitfalls block capped at ${cap} bytes: ${totalDemoted} full ${totalDemoted === 1 ? 'candidate' : 'candidates'} demoted; ${droppedTitles} titles and ${droppedRows} index rows dropped; ${droppedDemoted} demoted titles dropped._`
            : '';
        if (sections.length === 0 && !note) return '';
        const framing = 'Selected full entries match paths in the task spec’s Affected Files. Other pitfalls stay visible by title; open a title’s doc when it may apply.';
        return `\n${PITFALLS_HEADING}\n\n${framing}\n\n${sections.join('\n\n')}${note}\n\n`;
    }

    capped = bodyByteLength(render()) > cap;

    while (bodyByteLength(render()) > cap) {
        const visible = visibleCandidates(active);
        if (visible.length === 0) break;
        let selected: Candidate | undefined;
        for (const channel of DEMOTION_ORDER) {
            const group = visible.filter(candidate => candidate.channel === channel);
            if (group.length === 0) continue;
            selected = group.sort((left, right) => bodyByteLength(right.body) - bodyByteLength(left.body)
                || right.docOrder - left.docOrder || right.position - left.position)[0];
            break;
        }
        if (!selected) break;
        active = active.filter(candidate => candidate !== selected);
        demoted.push(selected);
    }

    if (bodyByteLength(render()) > cap) {
        const groups = titleGroupsFor(titleEntries, active, demoted, matchedLinkedDocs);
        const largest = Math.max(0, ...groups.map(group => group.titles.length));
        for (let keep = largest - 1; keep >= 0 && bodyByteLength(render()) > cap; keep--) {
            titleLimitState.perDoc = keep;
        }
    }

    if (bodyByteLength(render()) > cap) {
        for (let keep = indexRows.length - 1; keep >= 0 && bodyByteLength(render()) > cap; keep--) {
            areaLimitState.count = keep;
        }
    }

    if (bodyByteLength(render()) > cap) {
        const demotedTitleCount = demoted.filter(candidate => candidate.channel === 'section' || candidate.channel === 'lesson').length;
        for (let keep = demotedTitleCount - 1; keep >= 0 && bodyByteLength(render()) > cap; keep--) {
            demotedLimitState.count = keep;
        }
    }

    const rendered = render();
    if (bodyByteLength(rendered) <= cap) return rendered;

    const groups = titleGroupsFor(titleEntries, active, demoted, matchedLinkedDocs);
    const titleCount = groups.reduce((total, group) => total + group.titles.length, 0);
    const allDemotedTitles = demoted.filter(candidate => candidate.channel === 'section' || candidate.channel === 'lesson').length;
    const droppedDemotedTitles = Math.max(0, allDemotedTitles - demotedLimitState.count);
    const summary = `\n${PITFALLS_HEADING}\n\n_Pitfalls block capped at ${cap} bytes: ${demoted.length} full candidates demoted; ${titleCount} titles and ${indexRows.length} index rows dropped; ${droppedDemotedTitles} demoted titles dropped._\n\n`;
    return bodyByteLength(summary) <= cap ? summary : '';
}

export function selectPitfalls(input: PitfallsInput): string {
    try {
        return selectPitfallsInternal(input);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(`Unable to select relevant pitfalls and lessons: ${detail}`);
        return '';
    }
}

function readOrNull(filePath: string): string | null {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

export function resolvePitfallsDocsRoot(taskIds: string[]): string {
    return process.env[PITFALLS_DOCS_ROOT_ENV] || getActiveCwd(taskIds);
}

export function buildRelevantPitfalls(taskIds: string[]): string {
    const root = resolvePitfallsDocsRoot(taskIds);
    const patternsPath = process.env.CANON_PATTERNS_MD_PATH ?? path.join(root, PATTERNS_PATH);
    const affectedFiles = [...new Set(taskIds.flatMap(taskId => extractAffectedFiles(taskId))
        .map(normalizeAffectedFile).filter((value): value is string => value !== null))];
    return selectPitfalls({
        patterns: readOrNull(patternsPath),
        lessons: readOrNull(path.join(root, LESSONS_PATH)),
        readDoc: repoPath => isPathInsideRoot(root, repoPath) ? readOrNull(path.join(root, repoPath)) : null,
        affectedFiles,
    });
}
