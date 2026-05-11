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
