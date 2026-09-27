import fs from 'node:fs';
import path from 'node:path';

import { isPristineTaskArtifact, scaffoldTaskArtifact } from '../task/templates.js';
import { isTemplateUnfilled } from './validation.js';

export const REVIEW_ARCHIVE_PREFIX = 'review-prior-';
export const COLD_CODEX_ARCHIVE_PREFIX = 'review-cold-codex-run-';
const COLD_CODEX_ARCHIVE_RE = /^review-cold-codex-run-(\d+)\.md$/;

export type ColdCodexArchiveHeader = {
    round: number;
    reviewedSha: string;
    scope: 'full' | 'delta';
    base: string;
    reason: string;
};

export function writeColdCodexArchive(taskDir: string, header: ColdCodexArchiveHeader, findings: string): string {
    let newest = 0;
    for (const name of fs.readdirSync(taskDir)) {
        const match = COLD_CODEX_ARCHIVE_RE.exec(name);
        if (match) newest = Math.max(newest, Number(match[1]));
    }
    const name = `${COLD_CODEX_ARCHIVE_PREFIX}${newest + 1}.md`;
    const reason = header.reason.replaceAll('"', "'");
    fs.writeFileSync(path.join(taskDir, name),
        `<!-- round=${header.round} reviewed_sha=${header.reviewedSha} scope=${header.scope} base=${header.base} reason="${reason}" -->\n\n${findings}`,
        'utf8');
    return name;
}

export function parseColdCodexArchiveHeader(content: string): ColdCodexArchiveHeader | null {
    const match = /^<!-- round=(\d+) reviewed_sha=([a-f\d]{40,64}) scope=(full|delta) base=(\S+) reason="([^"\n]*)" -->\r?\n\r?\n/.exec(content);
    if (!match) return null;
    return {
        round: Number(match[1]),
        reviewedSha: match[2],
        scope: match[3] as 'full' | 'delta',
        base: match[4],
        reason: match[5],
    };
}

export function findColdCodexArchiveForRound(taskDir: string, round: number): ColdCodexArchiveHeader | null {
    let names: string[];
    try { names = fs.readdirSync(taskDir); } catch { return null; }
    const numbered = names.flatMap(name => {
        const match = COLD_CODEX_ARCHIVE_RE.exec(name);
        return match ? [{ name, number: Number(match[1]) }] : [];
    }).sort((a, b) => b.number - a.number);
    for (const { name } of numbered) {
        let content: string;
        try { content = fs.readFileSync(path.join(taskDir, name), 'utf8'); } catch { continue; }
        const header = parseColdCodexArchiveHeader(content);
        if (header?.round === round) return header;
    }
    return null;
}

export function hasMalformedColdCodexArchive(taskDir: string): boolean {
    let names: string[];
    try { names = fs.readdirSync(taskDir); } catch { return false; }
    return names.some(name => {
        if (!COLD_CODEX_ARCHIVE_RE.test(name)) return false;
        try {
            return parseColdCodexArchiveHeader(fs.readFileSync(path.join(taskDir, name), 'utf8')) === null;
        } catch { return true; }
    });
}

export type ReviewScaffoldIdentity = { taskId: string; title: string };

const REVIEW_ARCHIVE_RE = new RegExp(`^${REVIEW_ARCHIVE_PREFIX}(\\d+)\\.md$`);

// The allocator and lookup deliberately share this numeric scan. Filling the
// lowest gap or sorting names lexicographically would make the newest archive
// ambiguous after an operator deletes an older file or the count reaches 10.
function newestReviewArchiveNumber(taskDir: string): number {
    let newest = 0;
    for (const name of fs.readdirSync(taskDir)) {
        const match = REVIEW_ARCHIVE_RE.exec(name);
        if (match) newest = Math.max(newest, Number(match[1]));
    }
    return newest;
}

/** Returns the numerically greatest review archive filename in a task dir. */
export function findNewestReviewArchive(taskDir: string): string | null {
    const newest = newestReviewArchiveNumber(taskDir);
    return newest === 0 ? null : `${REVIEW_ARCHIVE_PREFIX}${newest}.md`;
}

/**
 * Moves review.md to the next monotonic review archive filename.
 *
 * reset-code-review keeps its historical unconditional archival behavior.
 * Reroute opts into skipping the pristine scaffold because it contains no
 * review findings and cannot create the stale-round verdict wedge. Pass
 * `scaffold` so a rendered scaffold (task id already substituted, as
 * `canon task new` and `rescaffoldReview` both write it) is recognized as
 * pristine too — the placeholder check alone only catches the raw template.
 */
export function archivePriorReview(
    taskDir: string,
    options: { skipUnfilledTemplate?: boolean; scaffold?: ReviewScaffoldIdentity } = {},
): string | null {
    const reviewPath = path.join(taskDir, 'review.md');
    if (!fs.existsSync(reviewPath)) return null;

    if (options.skipUnfilledTemplate) {
        const content = fs.readFileSync(reviewPath, 'utf8');
        if (isTemplateUnfilled(content)) return null;
        if (options.scaffold && isPristineTaskArtifact(content, 'review.md', options.scaffold.taskId, options.scaffold.title)) {
            return null;
        }
    }

    const archiveName = `${REVIEW_ARCHIVE_PREFIX}${newestReviewArchiveNumber(taskDir) + 1}.md`;
    fs.renameSync(reviewPath, path.join(taskDir, archiveName));
    return archiveName;
}

export type RescaffoldReviewResult =
    | { outcome: 'written'; source: string }
    | { outcome: 'exists' }
    | { outcome: 'no-template' }
    | { outcome: 'error'; message: string };

/**
 * Restores a fresh review.md scaffold when the task has none — after the
 * filled one was archived, or after an earlier attempt left it missing — so
 * the next code_review round has the same template `canon task new` gave the
 * task. Resolves the adopter's review.md override under tasks/_templates/
 * first, then .canon/templates/review.md. Never overwrites an existing
 * review.md and never throws: the callers have already renamed the prior
 * review by the time this runs, and every review.md reader tolerates a
 * missing file, so a failed re-scaffold is a warning, not an abort.
 */
export function rescaffoldReview(taskDir: string, identity: ReviewScaffoldIdentity): RescaffoldReviewResult {
    try {
        if (fs.existsSync(path.join(taskDir, 'review.md'))) return { outcome: 'exists' };
        const source = scaffoldTaskArtifact(taskDir, 'review.md', identity.taskId, identity.title);
        return source ? { outcome: 'written', source } : { outcome: 'no-template' };
    } catch (error) {
        return { outcome: 'error', message: error instanceof Error ? error.message : String(error) };
    }
}
