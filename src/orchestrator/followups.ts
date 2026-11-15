import { isValidTaskId } from '../lib/project-root.js';
import { scanSpecManifest, scanTableBlocks } from './markdown-table.js';

// The done.md template's example row; a done.md that still carries it was not filled in.
const TEMPLATE_PLACEHOLDER_CATEGORY = '(category)';

export const FOLLOWUP_CATEGORIES = ['correctness', 'risk', 'spec-gap', 'nit', 'scope', 'observation'] as const;

export type FollowupTracked = 'untracked' | 'dropped' | 'post-ship' | 'tracked';
export type FollowupRow = { category: string; text: string; tracked: FollowupTracked };
export type FollowupsParse =
    | { kind: 'rows'; rows: FollowupRow[] }
    | { kind: 'missing' }
    | { kind: 'unparseable'; reason: string };

export function classifyTracked(cell: string): FollowupTracked {
    const value = cell.replace(/^[\s`]+|[\s`]+$/g, '').toLowerCase();
    if (value === 'dropped') return 'dropped';
    if (value === 'post-ship') return 'post-ship';
    if (
        /^https?:\/\/\S+$/.test(value) ||
        /^#\d+$/.test(value) ||
        /^\[[^\]]+\]\([^\s)]+\)$/.test(value) ||
        (value.startsWith('task:') && isValidTaskId(value.slice('task:'.length)))
    ) return 'tracked';
    return 'untracked';
}

export function parseFollowups(markdown: string): FollowupsParse {
    const { lines, hidden, headings } = scanSpecManifest(markdown);
    const heading = headings.filter(candidate => candidate.level === 2 && /^## follow-ups\s*$/i.test(candidate.text)).at(-1);
    if (!heading) return { kind: 'missing' };

    const start = heading.index + 1;
    const end = headings.find(candidate => candidate.index > heading.index && candidate.level <= 2)?.index ?? lines.length;
    const blocks = scanTableBlocks(lines, hidden, start, end);
    if (blocks.length > 1) return { kind: 'unparseable', reason: 'more than one table' };

    const visibleBody = lines
        .slice(start, end)
        .filter((_, offset) => !hidden[start + offset])
        .map(line => line.trim())
        .filter(Boolean);
    if (blocks.length === 0) {
        if (visibleBody.length === 1 && /^none\.?$/i.test(visibleBody[0] ?? '')) return { kind: 'rows', rows: [] };
        if (visibleBody.some(line => /^none\.?$/i.test(line))) {
            return { kind: 'unparseable', reason: '`None.` must be the only visible content line' };
        }
        return { kind: 'unparseable', reason: 'no table and no `None.` line' };
    }

    const [block] = blocks;
    const expectedHeader = ['category', 'follow-up', 'tracked'];
    if (block.header.cells.map(cell => cell.toLowerCase()).join('\0') !== expectedHeader.join('\0')) {
        return { kind: 'unparseable', reason: `table header on line ${block.header.line} must be Category / Follow-up / Tracked` };
    }
    if (!block.hasSeparator) {
        return { kind: 'unparseable', reason: `table on line ${block.header.line} has no separator row` };
    }
    for (const row of block.rows) {
        if (row.cells.length !== 3) {
            return {
                kind: 'unparseable',
                reason: `line ${row.line} has ${row.cells.length} cells, expected 3 (escape a literal pipe as \\|)`,
            };
        }
    }
    if (visibleBody.some(line => /^none\.?$/i.test(line))) {
        return { kind: 'unparseable', reason: 'a `None.` line cannot appear with a table' };
    }
    const placeholder = block.rows.find(row => row.cells[0] === TEMPLATE_PLACEHOLDER_CATEGORY);
    if (placeholder) {
        return {
            kind: 'unparseable',
            reason: `line ${placeholder.line} is the template's placeholder row; replace it with real rows or write \`None.\` alone`,
        };
    }

    return {
        kind: 'rows',
        rows: block.rows.map(({ cells }) => ({ category: cells[0], text: cells[1], tracked: classifyTracked(cells[2]) })),
    };
}

export function followupsProblem(markdown: string): string | null {
    const parsed = parseFollowups(markdown);
    if (parsed.kind === 'rows') return null;
    if (parsed.kind === 'missing') {
        return 'done.md has no `## Follow-ups` section. Add it after `## Open Questions` with a `| Category | Follow-up | Tracked |` table, or the line `None.` alone';
    }
    return `done.md \`## Follow-ups\` cannot be parsed: ${parsed.reason}`;
}

export function formatShipFollowups(
    byTask: ReadonlyArray<{ taskId: string; rows: readonly FollowupRow[] }>,
): string[] {
    const formatBlock = (heading: string, tracked: FollowupTracked, instruction: string): string[] => {
        const lines = [heading];
        for (const { taskId, rows } of byTask) {
            const matching = rows.filter(row => row.tracked === tracked);
            if (matching.length === 0) continue;
            lines.push(`  ${taskId}:`);
            for (const row of matching) lines.push(`    - [${row.category}] ${row.text}`);
        }
        if (lines.length === 1) return [];
        lines.push(`  ${instruction}`);
        return lines;
    };

    const postShip = formatBlock(
        'Post-ship follow-ups:',
        'post-ship',
        'Write these in the post-ship docs commit (backlog entries or doc fixes).',
    );
    const untracked = formatBlock(
        'Untracked follow-ups:',
        'untracked',
        'Put these to the human: file now, write post-ship, or drop.',
    );
    if (postShip.length > 0 && untracked.length > 0) return [...postShip, '', ...untracked];
    return postShip.length > 0 ? postShip : untracked;
}
