import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { METRICS_SKELETON, getSharedMetricsFile } from './metrics.js';
import { foldQualityLogFragment } from './quality-log.js';
import { PIPELINE_TELEMETRY_FILES } from './worktree.js';

const LESSONS_SKELETON = '# Lessons Learned\n\n> Distilled cross-task insights. Task lessons fragments are folded here by `canon run --ship`.\n';
const METRICS_HEADER = /^\|\s*Timestamp\s*\|/;

export function foldMetricsFragment(shared: string | null, fragment: string): string | null {
    const rows = fragment.split('\n').filter(line => line.trimStart().startsWith('|') &&
        !METRICS_HEADER.test(line.trimStart()) && !/^\|(\s*:?-+:?\s*\|)+\s*$/.test(line.trim()));
    if (!rows.length) return null;
    const lines = (shared ?? METRICS_SKELETON).split('\n');
    const header = lines.findIndex(line => METRICS_HEADER.test(line.trimStart()));
    if (header === -1) throw new Error("docs/pipeline-invocations.md has no '| Timestamp |' table header");
    let end = header + 1;
    while (end < lines.length && lines[end].trimStart().startsWith('|')) end += 1;
    lines.splice(end, 0, ...rows);
    return lines.join('\n').replace(/\n?$/, '\n');
}

/**
 * A fragment holds `###` entries only. Drop `#`/`##` title lines an agent may put above the first
 * entry; never touch anything from the first `###` on, so entry content (code examples included) survives.
 */
function stripFragmentTitles(fragment: string): string {
    const lines = fragment.split('\n');
    const firstEntry = lines.findIndex(line => /^###\s/.test(line));
    const head = firstEntry === -1 ? lines : lines.slice(0, firstEntry);
    const rest = firstEntry === -1 ? [] : lines.slice(firstEntry);
    return [...head.filter(line => !/^#{1,2}\s/.test(line)), ...rest].join('\n');
}

export function foldLessonsFragment(shared: string | null, fragment: string): string | null {
    const body = stripFragmentTitles(fragment).trim();
    if (!body) return null;
    const base = (shared ?? LESSONS_SKELETON).trimEnd();
    const separator = base.endsWith('---') || body.startsWith('---') ? '\n\n' : '\n\n---\n\n';
    return `${base}${separator}${body}\n`;
}

export function sharedTelemetryDocsTouched(paths: readonly string[]): string[] {
    return PIPELINE_TELEMETRY_FILES.filter(file => paths.includes(file));
}

export type TelemetryFoldPlan = {
    writes: Array<{ target: string; before: string | null; after: string }>;
    fragments: Array<{ path: string; content: string }>;
};

function readOptional(file: string): string | null {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
}

export function planTelemetryFold(
    repoRoot: string, taskIds: readonly string[], taskDirFor: (taskId: string) => string,
): TelemetryFoldPlan {
    const kinds = [
        { name: 'metrics.md', target: getSharedMetricsFile(repoRoot), fold: foldMetricsFragment },
        { name: 'quality-log.md', target: path.join(repoRoot, 'docs/task-quality-log.md'), fold: foldQualityLogFragment },
        { name: 'lessons.md', target: path.join(repoRoot, 'docs/lessons-learned.md'), fold: foldLessonsFragment },
    ];
    const before = new Map(kinds.map(kind => [kind.target, readOptional(kind.target)]));
    const contents = new Map(before);
    const fragments: TelemetryFoldPlan['fragments'] = [];
    for (const taskId of taskIds) {
        for (const kind of kinds) {
            const fragmentPath = path.join(taskDirFor(taskId), kind.name);
            const content = readOptional(fragmentPath);
            if (content === null) continue;
            fragments.push({ path: fragmentPath, content });
            try {
                const folded = kind.fold(contents.get(kind.target) ?? null, content, taskId);
                if (folded !== null) contents.set(kind.target, folded);
            } catch (error) {
                throw new Error(`${fragmentPath}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    return {
        writes: [...contents].flatMap(([target, after]) => after !== null && after !== before.get(target)
            ? [{ target, before: before.get(target) ?? null, after }] : []),
        fragments,
    };
}

/** Compute first; replace docs before consuming fragments. Roll back ordinary I/O failures. */
export function applyTelemetryFold(plan: TelemetryFoldPlan): void {
    const temps: string[] = [];
    const written: TelemetryFoldPlan['writes'] = [];
    const deleted: TelemetryFoldPlan['fragments'] = [];
    try {
        for (const write of plan.writes) {
            fs.mkdirSync(path.dirname(write.target), { recursive: true });
            const temp = `${write.target}.${randomUUID()}.canon-fold.tmp`;
            const fd = fs.openSync(temp, 'wx');
            temps.push(temp);
            try { fs.writeFileSync(fd, write.after, 'utf8'); } finally { fs.closeSync(fd); }
        }
        for (let index = 0; index < plan.writes.length; index += 1) {
            fs.renameSync(temps[index], plan.writes[index].target);
            written.push(plan.writes[index]);
        }
        for (const fragment of plan.fragments) {
            fs.unlinkSync(fragment.path);
            deleted.push(fragment);
        }
    } catch (error) {
        const rollbackErrors: string[] = [];
        const restore = (action: () => void): void => {
            try { action(); } catch (rollbackError) { rollbackErrors.push(String(rollbackError)); }
        };
        for (const write of written.reverse()) {
            restore(() => {
                if (write.before === null) fs.unlinkSync(write.target);
                else fs.writeFileSync(write.target, write.before, 'utf8');
            });
        }
        for (const fragment of deleted) restore(() => fs.writeFileSync(fragment.path, fragment.content, 'utf8'));
        if (rollbackErrors.length) throw new Error(`${String(error)}; rollback failed: ${rollbackErrors.join('; ')}`);
        throw error;
    } finally {
        for (const temp of temps) {
            try { fs.unlinkSync(temp); } catch { /* Consumed by rename, or best-effort cleanup after failure. */ }
        }
    }
}

export function foldTelemetryFragments(
    repoRoot: string, taskIds: readonly string[], taskDirFor: (taskId: string) => string,
): string[] {
    const plan = planTelemetryFold(repoRoot, taskIds, taskDirFor);
    applyTelemetryFold(plan);
    return plan.writes.map(write => path.relative(repoRoot, write.target));
}

export type PostFoldFailureState = 'uncommitted' | 'unpushed';

export function formatPostFoldFailureHint(
    foldedDocs: readonly string[], state: PostFoldFailureState, baseBranch: string,
): string {
    const location = state === 'uncommitted'
        ? 'as uncommitted (possibly staged) edits in the working tree. Do not reset or check out those docs.'
        : `in the local chore: archive commit on ${baseBranch}, which was not pushed. Do not reset the local ${baseBranch} branch.`;
    return `Folded telemetry rows for ${foldedDocs.join(', ')} remain ${location} ` +
        'Task telemetry fragments were already deleted, so those rows cannot be regenerated from them. ' +
        'Follow "Failure after the telemetry fold" in docs/pipeline-orchestrator.md for manual recovery.';
}
