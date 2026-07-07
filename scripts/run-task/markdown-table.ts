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
// all of them.
export function parseAllTablesH3(markdown: string, sectionHeading: string): Array<Record<string, string>> {
    const lines = markdown.split('\n');
    const headingIndex = lines.findIndex(line => line.trimEnd() === `### ${sectionHeading}`);
    if (headingIndex === -1) return [];

    let sectionEnd = lines.length;
    for (let index = headingIndex + 1; index < lines.length; index += 1) {
        if (/^#{1,3}\s/.test(lines[index])) {
            sectionEnd = index;
            break;
        }
    }

    const allRows: Array<Record<string, string>> = [];
    let scanFrom = headingIndex + 1;

    while (scanFrom < sectionEnd) {
        // Find the next table block start (first `|` line from scanFrom).
        let tableStart = -1;
        for (let i = scanFrom; i < sectionEnd; i += 1) {
            if (lines[i].trimStart().startsWith('|')) {
                tableStart = i;
                break;
            }
        }
        if (tableStart === -1) break;

        // The first `|` line of each block is the header row.
        const headerCells = normalizeCells(lines[tableStart]);
        if (headerCells.length === 0) {
            scanFrom = tableStart + 1;
            continue;
        }

        // Skip an optional separator row immediately after the header.
        let rowStart = tableStart + 1;
        if (rowStart < sectionEnd) {
            const maybeSep = normalizeCells(lines[rowStart]);
            if (isSeparatorRow(maybeSep)) rowStart += 1;
        }

        // Collect contiguous `|` lines as data rows for this block.
        let tableEnd = rowStart;
        while (tableEnd < sectionEnd && lines[tableEnd].trimStart().startsWith('|')) {
            tableEnd += 1;
        }

        for (let index = rowStart; index < tableEnd; index += 1) {
            const cells = normalizeCells(lines[index]);
            if (isSeparatorRow(cells)) continue;
            const row: Record<string, string> = {};
            for (let cellIndex = 0; cellIndex < headerCells.length; cellIndex += 1) {
                row[headerCells[cellIndex]] = cells[cellIndex] ?? '';
            }
            allRows.push(row);
        }

        // Advance past this block and look for the next one.
        scanFrom = tableEnd;
    }

    return allRows;
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
