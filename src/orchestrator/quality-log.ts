import fs from 'node:fs';
import path from 'node:path';

import type { TaskSize } from '../lib/pipeline-policy.js';
import { warn } from './cli.js';
import { extractSectionBodies } from './markdown-table.js';
import type { StatusJson } from './types.js';

export const CANON_LOG_HEADERS = [
    'Date',
    'Task',
    'Size',
    'Spec verdict',
    'Spec iter',
    'Review iter',
    'Dropped ACs',
    'Validation gaps',
    'Human reroute?',
    'Notes',
] as const;

const DERIVED_HEADERS = new Set<string>(['Date', 'Task', 'Size', 'Spec iter', 'Review iter']);
const JUDGMENT_HEADERS = new Set<string>([
    'Spec verdict',
    'Human reroute?',
    'Dropped ACs',
    'Validation gaps',
    'Notes',
]);
const EARLIEST_WINS_HEADERS = new Set<string>(['Spec verdict']);

const STANDARD_QUALITY_LOG_SKELETON = [
    '# Task Quality Log',
    '',
    '## Log',
    '',
    '| Date | Task | Size | Spec verdict | Spec iter | Review iter | Dropped ACs | Validation gaps | Human reroute? | Notes |',
    '|---|---|---|---|---|---|---|---|---|---|',
    '',
    '## Periodic Reviews',
    '',
].join('\n');

export type QualityLogJudgment = Partial<Record<
    'Spec verdict' | 'Human reroute?' | 'Dropped ACs' | 'Validation gaps' | 'Notes',
    string
>>;

export type QualityLogDerived = {
    taskId: string;
    taskSize?: TaskSize;
    delicate?: boolean;
    specIterTotal?: number;
    reviewIterTotal?: number;
};

type TableRow = {
    lineIndex: number;
    cells: Record<string, string>;
};

export type LocatedLogTable = {
    headerCells: string[];
    dataStart: number;
    dataEnd: number;
};

const JUDGMENT_LABELS: Record<string, keyof QualityLogJudgment> = {
    'spec verdict': 'Spec verdict',
    'human reroute?': 'Human reroute?',
    'dropped acs': 'Dropped ACs',
    'validation gaps': 'Validation gaps',
    'notes': 'Notes',
};

export function getQualityLogFile(activeCwd: string): string {
    return process.env.CANON_QUALITY_LOG_FILE_OVERRIDE
        ? path.resolve(process.env.CANON_QUALITY_LOG_FILE_OVERRIDE)
        : path.join(activeCwd, 'docs/task-quality-log.md');
}

function normalizeCellValue(value: string): string {
    return value.replace(/\r\n|\n/g, ' ');
}

export function serializeQualityLogCell(value: string): string {
    return normalizeCellValue(value)
        .replace(/\\/g, '\\\\')
        .replace(/\|/g, '\\|');
}

// This is intentionally local to the writer: the existing markdown-table
// module does not expose its line splitter, and this task's affected-file cap
// does not authorize widening that API. Keep parity with splitTableLine there.
function splitTableRowCells(line: string): string[] {
    const cells: string[] = [];
    let cell = '';
    let backslashes = 0;

    for (const char of line.trim()) {
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

    const innerCells = cells.slice(
        (cells[0] ?? '').trim() === '' ? 1 : 0,
        (cells[cells.length - 1] ?? '').trim() === '' ? -1 : undefined,
    );
    return innerCells.map(value => value.trim());
}

function isSeparatorRow(cells: readonly string[]): boolean {
    return cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell.trim()));
}

export function locateLogTable(lines: readonly string[]): LocatedLogTable | null {
    const headingIndex = lines.findIndex(line => line.trimEnd() === '## Log');
    if (headingIndex === -1) return null;

    let headerIndex = -1;
    for (let index = headingIndex + 1; index < lines.length; index += 1) {
        if (/^#{1,2}\s/.test(lines[index])) return null;
        if (lines[index].trimStart().startsWith('|')) {
            headerIndex = index;
            break;
        }
    }
    if (headerIndex === -1) return null;

    const headerCells = splitTableRowCells(lines[headerIndex]);
    const uniqueHeaders = new Set(headerCells);
    if (
        uniqueHeaders.size !== headerCells.length ||
        CANON_LOG_HEADERS.some(required => !uniqueHeaders.has(required))
    ) {
        return null;
    }

    let dataStart = headerIndex + 1;
    if (
        dataStart < lines.length &&
        isSeparatorRow(splitTableRowCells(lines[dataStart]))
    ) {
        dataStart += 1;
    }

    let dataEnd = dataStart;
    while (dataEnd < lines.length && lines[dataEnd].trimStart().startsWith('|')) {
        dataEnd += 1;
    }

    return { headerCells, dataStart, dataEnd };
}

function rowFromCells(headerCells: readonly string[], cells: readonly string[]): Record<string, string> {
    const row: Record<string, string> = {};
    for (let index = 0; index < headerCells.length; index += 1) {
        row[headerCells[index]] = cells[index] ?? '';
    }
    return row;
}

function parseLogRows(
    lines: readonly string[],
    headerCells: readonly string[],
    dataStart: number,
    dataEnd: number,
): TableRow[] {
    const rows: TableRow[] = [];
    for (let index = dataStart; index < dataEnd; index += 1) {
        const cells = splitTableRowCells(lines[index]);
        if (isSeparatorRow(cells)) continue;
        rows.push({
            lineIndex: index,
            cells: rowFromCells(headerCells, cells),
        });
    }
    return rows;
}

function parseStrayRows(lines: readonly string[], headerCells: readonly string[]): TableRow[] {
    const periodicIndex = lines.findIndex(line => line.trimEnd() === '## Periodic Reviews');
    if (periodicIndex === -1) return [];

    const rows: TableRow[] = [];
    for (let index = periodicIndex + 1; index < lines.length; index += 1) {
        if (!lines[index].trimStart().startsWith('|')) continue;
        const cells = splitTableRowCells(lines[index]);
        if (isSeparatorRow(cells) || cells.length !== headerCells.length) continue;
        rows.push({
            lineIndex: index,
            cells: rowFromCells(headerCells, cells),
        });
    }
    return rows;
}

function reconcileHistory(
    existingRows: readonly TableRow[],
    headerCells: readonly string[],
): Record<string, string> {
    const sorted = [...existingRows].sort((left, right) => left.lineIndex - right.lineIndex);
    const reconciled: Record<string, string> = {};

    for (const header of headerCells) {
        if (DERIVED_HEADERS.has(header)) continue;
        if (EARLIEST_WINS_HEADERS.has(header)) {
            const earliest = sorted
                .map(row => row.cells[header] ?? '')
                .find(value => value.trim() !== '');
            if (earliest !== undefined) reconciled[header] = earliest;
            continue;
        }
        for (const row of sorted) {
            const value = row.cells[header] ?? '';
            if (value.trim() !== '') reconciled[header] = value;
        }
    }

    return reconciled;
}

function buildFinalRow(
    headerCells: readonly string[],
    derived: QualityLogDerived,
    reconciled: Readonly<Record<string, string>>,
    qaSupplied: QualityLogJudgment,
): Record<string, string> {
    const row: Record<string, string> = {};
    for (const header of headerCells) {
        if (header === 'Date') {
            row[header] = new Date().toISOString().slice(0, 10);
        } else if (header === 'Task') {
            row[header] = derived.taskId;
        } else if (header === 'Size') {
            const size = derived.taskSize ?? 'M';
            row[header] = derived.delicate ? `${size} delicate` : size;
        } else if (header === 'Spec iter') {
            row[header] = String(derived.specIterTotal ?? 0);
        } else if (header === 'Review iter') {
            row[header] = String(derived.reviewIterTotal ?? 0);
        } else if (JUDGMENT_HEADERS.has(header)) {
            const supplied = qaSupplied[header as keyof QualityLogJudgment];
            row[header] = supplied?.trim() ? supplied : (reconciled[header] ?? '');
        } else {
            row[header] = reconciled[header] ?? '';
        }
    }
    return row;
}

function renderRowLine(headerCells: readonly string[], row: Readonly<Record<string, string>>): string {
    const cells = headerCells.map(header => serializeQualityLogCell(row[header] ?? ''));
    return `| ${cells.join(' | ')} |`;
}

function writeFileAtomic(filePath: string, content: string): void {
    const tempPath = `${filePath}.tmp`;
    try {
        fs.writeFileSync(tempPath, content, 'utf8');
        fs.renameSync(tempPath, filePath);
    } finally {
        try {
            fs.unlinkSync(tempPath);
        } catch {
            // The rename normally consumes the temp file. Cleanup is best-effort
            // so a failed telemetry cleanup cannot escape into qa → done.
        }
    }
}

export function upsertQualityLogRow(
    logFilePath: string,
    derived: QualityLogDerived,
    qaSupplied: QualityLogJudgment,
): void {
    try {
        let content: string;
        try {
            content = fs.readFileSync(logFilePath, 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                content = STANDARD_QUALITY_LOG_SKELETON;
            } else {
                const message = error instanceof Error ? error.message : String(error);
                warn(`quality-log: could not read ${logFilePath}: ${message}`);
                return;
            }
        }

        const lines = content.split('\n');
        const located = locateLogTable(lines);
        if (!located) {
            warn(
                `quality-log: ${logFilePath} has no well-formed '## Log' table ` +
                `with all required columns — skipping row write for '${derived.taskId}'.`,
            );
            return;
        }

        const logRows = parseLogRows(
            lines,
            located.headerCells,
            located.dataStart,
            located.dataEnd,
        );
        const strayRows = parseStrayRows(lines, located.headerCells);
        const taskRows = [...logRows, ...strayRows]
            .filter(row => (row.cells.Task ?? '').trim() === derived.taskId);
        const reconciled = reconcileHistory(taskRows, located.headerCells);
        const finalRow = buildFinalRow(located.headerCells, derived, reconciled, qaSupplied);
        const rendered = renderRowLine(located.headerCells, finalRow);
        const removeIndexes = new Set(taskRows.map(row => row.lineIndex));

        const updatedLines: string[] = [];
        for (let index = 0; index < lines.length; index += 1) {
            if (index === located.dataEnd) updatedLines.push(rendered);
            if (!removeIndexes.has(index)) updatedLines.push(lines[index]);
        }
        if (located.dataEnd >= lines.length) updatedLines.push(rendered);

        writeFileAtomic(logFilePath, updatedLines.join('\n'));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warn(`quality-log: unexpected error writing row for '${derived.taskId}': ${message}`);
    }
}

export function parseQualityLogJudgmentBlock(doneMdContent: string): QualityLogJudgment {
    const bodies = extractSectionBodies(doneMdContent, /^## Quality Log\b/);
    if (bodies.length === 0) return {};

    const result: QualityLogJudgment = {};
    for (const line of bodies[bodies.length - 1].split('\n')) {
        const match = /^-\s*([^:]+):\s*(.*)$/.exec(line.trim());
        if (!match) continue;
        const key = JUDGMENT_LABELS[match[1].trim().toLowerCase()];
        const value = match[2].trim();
        if (key && value) result[key] = value;
    }
    return result;
}

export function writeQualityLogForTask(
    taskId: string,
    activeCwd: string,
    donePath: string,
    status: StatusJson,
): void {
    try {
        let doneContent = '';
        try {
            doneContent = fs.readFileSync(donePath, 'utf8');
        } catch {
            // A missing/unreadable done.md only means this pass supplies no
            // judgment cells. The transition gate owns done.md validity.
        }
        upsertQualityLogRow(
            getQualityLogFile(activeCwd),
            {
                taskId,
                taskSize: status.task_size,
                delicate: status.delicate,
                specIterTotal: status.phases.spec_review?.iterations_total ?? 0,
                reviewIterTotal: status.phases.code_review?.iterations_total ?? 0,
            },
            parseQualityLogJudgmentBlock(doneContent),
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warn(`quality-log: failed to write row for '${taskId}': ${message}`);
    }
}
