import fs from 'node:fs';
import path from 'node:path';

import { isPristineTaskArtifact, scaffoldTaskArtifact } from '../task/templates.js';
import { isTemplateUnfilled } from './validation.js';

export const REVIEW_ARCHIVE_PREFIX = 'review-prior-';

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

/**
 * Restores a fresh review.md scaffold after the filled one was archived, so
 * the next code_review round has the same template `canon task new` gave the
 * task. Resolves the adopter's `tasks/_templates/review.md` override first,
 * then `.canon/templates/review.md`. Returns the template path used, or null
 * when neither exists (the caller warns; the phase still runs, since every
 * review.md reader tolerates a missing file). Never overwrites an existing
 * review.md.
 */
export function rescaffoldReview(taskDir: string, identity: ReviewScaffoldIdentity): string | null {
    if (fs.existsSync(path.join(taskDir, 'review.md'))) return null;
    return scaffoldTaskArtifact(taskDir, 'review.md', identity.taskId, identity.title);
}
