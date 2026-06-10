const CANON_START_LINE_RE = /^[ \t]*# canon:start[ \t]*(?:\r?\n|$)/gm;
const CANON_END_LINE_RE = /^[ \t]*# canon:end[ \t]*(?:\r?\n|$)/gm;

export const CANON_RUNTIME_GITIGNORE_PATTERNS = [
    'tasks/**/.canon-pid',
    'tasks/**/.canon-run.log',
    'tasks/**/.heartbeat.json',
    'tasks/**/.pr-number',
] as const;

export const CANON_GITIGNORE_BLOCK = [
    '# canon:start',
    '# This block is managed by canon. Edits are overwritten on `canon upgrade`.',
    ...CANON_RUNTIME_GITIGNORE_PATTERNS,
    '# canon:end',
].join('\n') + '\n';

type CanonBlockRange = {
    startIndex: number;
    endIndex: number;
};

function findCanonBlockRange(content: string): CanonBlockRange | null | 'malformed' {
    CANON_START_LINE_RE.lastIndex = 0;
    const startMatch = CANON_START_LINE_RE.exec(content);
    if (!startMatch) return null;

    CANON_END_LINE_RE.lastIndex = startMatch.index + startMatch[0].length;
    const endMatch = CANON_END_LINE_RE.exec(content);
    if (!endMatch) return 'malformed';

    return {
        startIndex: startMatch.index,
        endIndex: endMatch.index + endMatch[0].length,
    };
}

function withSingleTrailingNewline(content: string): string {
    return content.replace(/(?:\r?\n)*$/, '') + '\n';
}

function appendCanonBlock(content: string, block: string): string {
    if (content.length === 0) return block;
    if (/(?:\r?\n){2}$/.test(content)) return content + block;
    if (/\r?\n$/.test(content)) return content + '\n' + block;
    return content + '\n\n' + block;
}

export function extractCanonBlock(content: string): string | null {
    const range = findCanonBlockRange(content);
    if (range === null || range === 'malformed') return null;
    return withSingleTrailingNewline(content.slice(range.startIndex, range.endIndex));
}

export function upsertCanonBlock(content: string, block: string): string | null {
    const normalizedBlock = withSingleTrailingNewline(block);
    const range = findCanonBlockRange(content);
    if (range === 'malformed') return null;
    if (range === null) return appendCanonBlock(content, normalizedBlock);
    return content.slice(0, range.startIndex) + normalizedBlock + content.slice(range.endIndex);
}
