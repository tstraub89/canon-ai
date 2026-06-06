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

// Returns the body text of every section whose H2 heading line matches `pattern`.
// Body excludes the heading line itself; spans to the next H1/H2 heading or EOF.
// Headings inside HTML comment blocks (`<!-- ... -->`) are skipped — those are
// template placeholders, not real sections. Useful for cumulative artifacts
// (handoff iteration sections, review round sections) where the orchestrator
// needs to evaluate the *latest* of multiple same-level sections.
export function extractSectionBodies(markdown: string, pattern: RegExp): string[] {
    const lines = markdown.split('\n');
    const bodies: string[] = [];
    let activeStart = -1;
    let inHtmlComment = false;
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];

        // Track HTML comment block state. A comment opened on a line stays open
        // for the rest of that line; a `-->` token closes it for subsequent
        // lines. We only need block-level tracking for skipping headings, so
        // single-line `<!-- ... -->` on one line doesn't affect headings on
        // other lines.
        const opensComment = /<!--/.test(line);
        const closesComment = /-->/.test(line);
        const startsInComment = inHtmlComment;
        if (opensComment && !closesComment) inHtmlComment = true;
        else if (closesComment && !opensComment) inHtmlComment = false;
        else if (opensComment && closesComment) {
            // Both on the same line — net state unchanged from before this line.
            // (If we were already in a comment, the `-->` closes it. If not,
            // the `<!--` opens and the same line's `-->` closes. Either way,
            // the *next* line is outside a comment block.)
            inHtmlComment = false;
        }

        // Skip if this line is inside an HTML comment block as of its start.
        if (startsInComment) continue;
        // Also skip a heading that lives on the same line as a comment opener
        // (defensive — unusual but cheap to handle).
        if (opensComment && !closesComment) continue;

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
