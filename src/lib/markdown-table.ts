// The separator match does not consume CR/LF, so replacing a CRLF header keeps
// the project-owned tail byte-for-byte intact. (Codex P2 on PR #80.)
const TABLE_SEPARATOR_RE = /^[^\S\r\n]*\|[-:|\s]+\|[^\S\r\n]*(?=\r?\n|$)/m;

/** Replace the table header while preserving the project-owned tail byte-for-byte. */
export function mergeHeaderOnly(templateContent: string, projectContent: string): string | null {
    const projectMatch = TABLE_SEPARATOR_RE.exec(projectContent);
    const templateMatch = TABLE_SEPARATOR_RE.exec(templateContent);
    if (!projectMatch || !templateMatch) return null;
    const templateSepEnd = (templateMatch.index ?? 0) + templateMatch[0].length;
    const projectSepEnd = (projectMatch.index ?? 0) + projectMatch[0].length;
    return templateContent.slice(0, templateSepEnd) + projectContent.slice(projectSepEnd);
}
