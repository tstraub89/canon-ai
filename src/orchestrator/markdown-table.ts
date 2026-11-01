function splitTableLine(line: string): string[] {
    const cells: string[] = [];
    let cell = '';
    let backslashes = 0;

    for (const char of line) {
        if (char === '\\') {
            backslashes += 1;
            continue;
        }

        if (char === '|') {
            if (backslashes % 2 === 1) {
                cell += '\\'.repeat((backslashes - 1) / 2) + '|';
            } else {
                cell += '\\'.repeat(backslashes / 2);
                cells.push(cell);
                cell = '';
            }
            backslashes = 0;
            continue;
        }

        if (backslashes > 0) {
            cell += '\\'.repeat(backslashes);
            backslashes = 0;
        }
        cell += char;
    }

    if (backslashes > 0) cell += '\\'.repeat(backslashes);
    cells.push(cell);
    return cells;
}

function normalizeCells(line: string): string[] {
    const cells = splitTableLine(line.trim());
    const innerCells = cells.slice(
        (cells[0] ?? '').trim() === '' ? 1 : 0,
        (cells[cells.length - 1] ?? '').trim() === '' ? -1 : undefined,
    );
    return innerCells.map(cell => cell.trim());
}

function isSeparatorRow(cells: readonly string[]): boolean {
    return cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell.trim()));
}

function isSectionHeading(line: string, sectionHeading: string): boolean {
    return line.trimEnd() === `## ${sectionHeading}`;
}

function isHeadingBoundary(line: string): boolean {
    return /^#{1,2}\s/.test(line);
}

// Per-line HTML comment visibility. `hidden[i]` is true when line i starts
// inside an HTML comment block (`<!-- ... -->`) or opens one without closing
// it on the same line. A comment opened on a line stays open for the rest of
// that line; a `-->` token closes it for subsequent lines. Block-level
// tracking only — single-line `<!-- ... -->` doesn't affect other lines.
function computeCommentHiddenLines(lines: readonly string[]): boolean[] {
    const hidden: boolean[] = new Array<boolean>(lines.length).fill(false);
    let inHtmlComment = false;
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const opensComment = /<!--/.test(line);
        const closesComment = /-->/.test(line);
        const startsInComment = inHtmlComment;
        if (opensComment && !closesComment) inHtmlComment = true;
        else if (closesComment && !opensComment) inHtmlComment = false;
        else if (opensComment && closesComment) {
            // Both on the same line — the *next* line is outside a comment
            // block either way. (If we were already in a comment, the `-->`
            // closes it. If not, the `<!--` opens and the same line's `-->`
            // closes.)
            inHtmlComment = false;
        }
        hidden[i] = startsInComment || (opensComment && !closesComment);
    }
    return hidden;
}

// Returns the body text of every section whose H2 heading line matches `pattern`.
// Body excludes the heading line itself; spans to the next H1/H2 heading or EOF.
// Headings inside HTML comment blocks (`<!-- ... -->`) are skipped — those are
// template placeholders, not real sections. Useful for cumulative artifacts
// (handoff iteration sections, review round sections) where the orchestrator
// needs to evaluate the *latest* of multiple same-level sections.
export function extractSectionBodies(markdown: string, pattern: RegExp): string[] {
    const lines = markdown.split('\n');
    const hidden = computeCommentHiddenLines(lines);
    const bodies: string[] = [];
    let activeStart = -1;
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (hidden[i]) continue;

        const isH2 = /^## /.test(line);
        const isH1 = /^# /.test(line);
        if (isH2 || isH1) {
            if (activeStart !== -1) {
                bodies.push(lines.slice(activeStart, i).join('\n'));
                activeStart = -1;
            }
            if (isH2 && pattern.test(line)) {
                activeStart = i + 1;
            }
        }
    }
    if (activeStart !== -1) bodies.push(lines.slice(activeStart).join('\n'));
    return bodies;
}

// Like parseTable but matches H3 (`### <heading>`) instead of H2. Scoped within
// the input string the caller passes — typically a body returned by
// extractSectionBodies. Used for iteration-section subsections like
// `### Re-run validation` inside a `## Iteration N` body.
export function parseTableH3(markdown: string, sectionHeading: string): Array<Record<string, string>> {
    const lines = markdown.split('\n');
    const headingIndex = lines.findIndex(line => line.trimEnd() === `### ${sectionHeading}`);
    if (headingIndex === -1) return [];

    let tableStart = -1;
    let sectionEnd = lines.length;
    for (let index = headingIndex + 1; index < lines.length; index += 1) {
        if (/^#{1,3}\s/.test(lines[index])) {
            sectionEnd = index;
            break;
        }
        if (tableStart === -1 && lines[index].trimStart().startsWith('|')) {
            tableStart = index;
        }
    }
    if (tableStart === -1 || tableStart >= sectionEnd) return [];

    const headerCells = normalizeCells(lines[tableStart]);
    if (headerCells.length === 0) return [];

    let rowStart = tableStart + 1;
    if (rowStart < sectionEnd) {
        const separatorCells = normalizeCells(lines[rowStart]);
        if (isSeparatorRow(separatorCells)) rowStart += 1;
    }

    const rows: Array<Record<string, string>> = [];
    for (let index = rowStart; index < sectionEnd; index += 1) {
        const line = lines[index];
        if (!line.trimStart().startsWith('|')) break;

        const cells = normalizeCells(line);
        if (isSeparatorRow(cells)) continue;

        const row: Record<string, string> = {};
        for (let cellIndex = 0; cellIndex < headerCells.length; cellIndex += 1) {
            row[headerCells[cellIndex]] = cells[cellIndex] ?? '';
        }
        rows.push(row);
    }

    return rows;
}

// Like parseTableH3 but collects rows from ALL contiguous table blocks under the
// heading, not just the first one. Blank lines and non-`|` lines (sub-headings,
// prose) end the current block; the scanner then looks for the next `|` line to
// start the next block. Each block's header row is read fresh at the start of
// each block, so a second table with the same column names does not bleed state
// from the first. Used for `### Affected Files` where a spec author may write
// one table per subsystem — the allow-list gate and context preload must see
// all of them. Fenced and HTML-commented content is excluded.
export function parseAllTablesH3(markdown: string, sectionHeading: string): Array<Record<string, string>> {
    const { lines, hidden } = visibleMarkdownLines(markdown);
    const headingIndex = lines.findIndex((line, i) => !hidden[i] && line.trimEnd() === `### ${sectionHeading}`);
    if (headingIndex === -1) return [];
    let end = headingIndex + 1;
    while (end < lines.length && (hidden[end] || !/^#{1,3}\s/.test(lines[end]))) end += 1;
    return blocksToRecords(scanTableBlocks(lines, hidden, headingIndex + 1, end));
}

// Manifest readers share visibility, heading boundaries and raw cell scanning.
// Keep extractSectionBodies unchanged: its other callers read review/handoff bodies.
function visibleMarkdownLines(markdown: string): { lines: string[]; hidden: boolean[] } {
    const hidden: boolean[] = [];
    let comment = false;
    let fence: { char: string; length: number } | null = null;
    const lines = markdown.split('\n').map(line => {
        if (fence) {
            hidden.push(true);
            const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
            if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
            return line;
        }
        const opener = !comment && /^\s{0,3}(`{3,}|~{3,})/.exec(line);
        if (opener) {
            fence = { char: opener[1][0], length: opener[1].length };
            hidden.push(true);
            return line;
        }
        // A comment marker inside an inline code span is literal example text.
        // Remove only actual comment content, retaining visible cells on the line.
        let visible = '';
        let i = 0;
        while (i < line.length) {
            if (comment) {
                const close = line.indexOf('-->', i);
                if (close === -1) break;
                comment = false;
                i = close + 3;
            } else if (line.startsWith('<!--', i)) {
                comment = true;
                i += 4;
            } else if (line[i] === '`') {
                const run = /^`+/.exec(line.slice(i))![0];
                const rest = line.slice(i + run.length);
                const close = [...rest.matchAll(/`+/g)].find(match => match[0].length === run.length);
                const end = close ? i + run.length + close.index + run.length : i + run.length;
                visible += line.slice(i, end);
                i = end;
            } else {
                visible += line[i];
                i += 1;
            }
        }
        hidden.push(visible.trim() === '');
        return visible;
    });
    return { lines, hidden };
}

export type RawTableRow = { line: number; cells: string[] };
export type RawTableBlock = { header: RawTableRow; hasSeparator: boolean; rows: RawTableRow[] };

export function scanTableBlocks(lines: readonly string[], hidden: readonly boolean[], start: number, end: number): RawTableBlock[] {
    const blocks: RawTableBlock[] = [];
    let i = start;
    while (i < end) {
        if (hidden[i] || !lines[i].trimStart().startsWith('|')) { i += 1; continue; }
        const header = { line: i + 1, cells: normalizeCells(lines[i]) };
        i += 1;
        if (header.cells.length === 0) continue;
        const hasSeparator = i < end && !hidden[i] && isSeparatorRow(normalizeCells(lines[i]));
        if (hasSeparator) i += 1;
        const rows: RawTableRow[] = [];
        while (i < end && !hidden[i] && lines[i].trimStart().startsWith('|')) {
            const cells = normalizeCells(lines[i]);
            if (!isSeparatorRow(cells)) rows.push({ line: i + 1, cells });
            i += 1;
        }
        blocks.push({ header, hasSeparator, rows });
    }
    return blocks;
}

export function blocksToRecords(blocks: readonly RawTableBlock[]): Array<Record<string, string>> {
    return blocks.flatMap(block => block.rows.map(({ cells }) => {
        const row: Record<string, string> = {};
        block.header.cells.forEach((name, i) => { row[name] = cells[i] ?? ''; });
        return row;
    }));
}

export type ScannedHeading = { index: number; line: number; level: number; text: string; sectionEnd: number };
export type ManifestHeading = { heading: ScannedHeading; blocks: RawTableBlock[] };
export type ManifestSection = { h2: ScannedHeading; kind: 'design' | 'amendment'; affectedFiles: ManifestHeading[] };

export function scanSpecManifest(markdown: string): {
    lines: string[]; hidden: boolean[]; headings: ScannedHeading[]; sections: ManifestSection[];
} {
    const { lines, hidden } = visibleMarkdownLines(markdown);
    const headings: ScannedHeading[] = [];
    lines.forEach((line, index) => {
        const match = !hidden[index] && /^(#{1,6})\s/.exec(line);
        if (match) headings.push({ index, line: index + 1, level: match[1].length, text: line.trimEnd(), sectionEnd: lines.length });
    });
    headings.forEach((heading, i) => {
        heading.sectionEnd = headings.slice(i + 1).find(next => next.level <= Math.max(3, heading.level))?.index ?? lines.length;
    });
    const sections: ManifestSection[] = [];
    headings.forEach((h2, i) => {
        if (h2.level !== 2 || !/^## (?:Design|Amendment)\b/.test(h2.text)) return;
        const end = headings.slice(i + 1).find(next => next.level <= 2)?.index ?? lines.length;
        const affectedFiles = headings.filter(h => h.index > h2.index && h.index < end && h.text === '### Affected Files')
            .map(heading => ({ heading, blocks: scanTableBlocks(lines, hidden, heading.index + 1, Math.min(end, heading.sectionEnd)) }));
        sections.push({ h2, kind: /^## Design\b/.test(h2.text) ? 'design' : 'amendment', affectedFiles });
    });
    return { lines, hidden, headings, sections };
}

export type ScannedTable = {
    /** Trimmed text of the nearest preceding visible heading line (any level, hashes included), or null if none. */
    heading: string | null;
    headerCells: string[];
    rows: Array<Record<string, string>>;
};

// Scans EVERY markdown table in the document regardless of which section it
// lives under. Tables inside HTML comment blocks are skipped (template
// scaffolds), as are blockquoted tables (`> | ... |` — guidance, not data;
// their lines don't start with `|`) and anything inside fenced code blocks
// (``` or ~~~ — example/command-output text, not real tables). The
// diff→handoff pre-flight uses this to (a) accept coverage rows from any
// table whose first column header is `File`, wherever the implementer put
// it, and (b) name near-miss tables in rejection messages instead of leaving
// the implementer to guess which headings are scanned.
export function scanAllTables(markdown: string): ScannedTable[] {
    const lines = markdown.split('\n');
    const hidden = computeCommentHiddenLines(lines);
    const tables: ScannedTable[] = [];
    let currentHeading: string | null = null;
    // Open fence marker, or null when outside a fence. Per CommonMark, the
    // closing fence must use the same character and be at least as long as
    // the opener, with nothing else on the line.
    let fence: { char: string; length: number } | null = null;
    let i = 0;
    while (i < lines.length) {
        if (hidden[i]) {
            i += 1;
            continue;
        }
        const line = lines[i];
        if (fence) {
            const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
            if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
            i += 1;
            continue;
        }
        const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
        if (open) {
            fence = { char: open[1][0], length: open[1].length };
            i += 1;
            continue;
        }
        if (/^#{1,6}\s/.test(line)) {
            currentHeading = line.trim();
            i += 1;
            continue;
        }
        if (!line.trimStart().startsWith('|')) {
            i += 1;
            continue;
        }

        // Table block: contiguous visible `|` lines. First line is the header
        // row, optionally followed by a separator row.
        let end = i;
        while (end < lines.length && !hidden[end] && lines[end].trimStart().startsWith('|')) end += 1;
        const headerCells = normalizeCells(lines[i]);
        let rowStart = i + 1;
        if (rowStart < end && isSeparatorRow(normalizeCells(lines[rowStart]))) rowStart += 1;

        const rows: Array<Record<string, string>> = [];
        for (let index = rowStart; index < end; index += 1) {
            const cells = normalizeCells(lines[index]);
            if (isSeparatorRow(cells)) continue;
            const row: Record<string, string> = {};
            for (let cellIndex = 0; cellIndex < headerCells.length; cellIndex += 1) {
                row[headerCells[cellIndex]] = cells[cellIndex] ?? '';
            }
            rows.push(row);
        }
        if (headerCells.length > 0) tables.push({ heading: currentHeading, headerCells, rows });
        i = end;
    }
    return tables;
}

export function parseTable(markdown: string, sectionHeading: string): Array<Record<string, string>> {
    const lines = markdown.split('\n');
    const headingIndex = lines.findIndex(line => isSectionHeading(line, sectionHeading));
    if (headingIndex === -1) return [];

    let tableStart = -1;
    let sectionEnd = lines.length;
    for (let index = headingIndex + 1; index < lines.length; index += 1) {
        if (isHeadingBoundary(lines[index])) {
            sectionEnd = index;
            break;
        }
        if (tableStart === -1 && lines[index].trimStart().startsWith('|')) {
            tableStart = index;
        }
    }
    if (tableStart === -1 || tableStart >= sectionEnd) return [];

    const headerCells = normalizeCells(lines[tableStart]);
    if (headerCells.length === 0) return [];

    let rowStart = tableStart + 1;
    if (rowStart < sectionEnd) {
        const separatorCells = normalizeCells(lines[rowStart]);
        if (isSeparatorRow(separatorCells)) rowStart += 1;
    }

    const rows: Array<Record<string, string>> = [];
    for (let index = rowStart; index < sectionEnd; index += 1) {
        const line = lines[index];
        if (!line.trimStart().startsWith('|')) break;

        const cells = normalizeCells(line);
        if (isSeparatorRow(cells)) continue;

        const row: Record<string, string> = {};
        for (let cellIndex = 0; cellIndex < headerCells.length; cellIndex += 1) {
            row[headerCells[cellIndex]] = cells[cellIndex] ?? '';
        }
        rows.push(row);
    }

    return rows;
}
