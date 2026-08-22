import fs from 'node:fs';
import path from 'node:path';

import { isTemplateUnfilled } from './validation.js';

export const REVIEW_ARCHIVE_PREFIX = 'review-prior-';

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
 * review findings and cannot create the stale-round verdict wedge.
 */
export function archivePriorReview(
    taskDir: string,
    options: { skipUnfilledTemplate?: boolean } = {},
): string | null {
    const reviewPath = path.join(taskDir, 'review.md');
    if (!fs.existsSync(reviewPath)) return null;

    if (options.skipUnfilledTemplate) {
        const content = fs.readFileSync(reviewPath, 'utf8');
        if (isTemplateUnfilled(content)) return null;
    }

    const archiveName = `${REVIEW_ARCHIVE_PREFIX}${newestReviewArchiveNumber(taskDir) + 1}.md`;
    fs.renameSync(reviewPath, path.join(taskDir, archiveName));
    return archiveName;
}
