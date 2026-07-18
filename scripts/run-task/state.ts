import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { die } from './cli.js';
import { REPO_ROOT, TASKS_DIR, WORKTREES_ROOT } from './env.js';
import { PHASE_ORDER, type CurrentPhase, type Phase, type SessionSlot, type StatusJson } from './types.js';

function effectiveWorktreesRoot(): string {
    return process.env.CANON_WORKTREES_ROOT ? path.resolve(process.env.CANON_WORKTREES_ROOT) : WORKTREES_ROOT;
}

type WorktreeBranchEntry = { path: string; branch: string | null };
type WorktreeEnumerationResult =
    | { ok: true; worktrees: WorktreeBranchEntry[] }
    | { ok: false };

function listWorktreesWithBranches(): WorktreeEnumerationResult {
    const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0) return { ok: false };

    const worktrees: WorktreeBranchEntry[] = [];
    let currentPath: string | null = null;
    let currentBranch: string | null = null;
    const flush = () => {
        if (currentPath && currentPath !== REPO_ROOT) {
            worktrees.push({ path: currentPath, branch: currentBranch });
        }
    };
    for (const line of (result.stdout ?? '').split('\n')) {
        if (line.startsWith('worktree ')) {
            flush();
            currentPath = line.slice('worktree '.length).trim();
            currentBranch = null;
        } else if (line.startsWith('branch refs/heads/')) {
            currentBranch = line.slice('branch refs/heads/'.length).trim();
        }
    }
    flush();
    return { ok: true, worktrees };
}

type WorktreeOwnershipScan =
    | { outcome: 'matched'; worktreePath: string }
    | { outcome: 'ambiguous'; worktreePaths: string[] }
    | { outcome: 'enumeration-failed' }
    | { outcome: 'present-but-invalid'; worktreePath: string; error: string }
    | { outcome: 'no-match' };

function scanWorktreesForSecondaryOwnership(taskId: string): WorktreeOwnershipScan {
    const enumeration = listWorktreesWithBranches();
    if (!enumeration.ok) return { outcome: 'enumeration-failed' };

    const matches: string[] = [];
    for (const { path: worktreePath, branch: checkedOutBranch } of enumeration.worktrees) {
        const candidateStatusPath = path.join(worktreePath, 'tasks', taskId, 'status.json');
        if (!fs.existsSync(candidateStatusPath)) continue;

        let candidate: StatusJson;
        try {
            candidate = readStatusFromPath(candidateStatusPath, taskId);
        } catch (err) {
            return {
                outcome: 'present-but-invalid',
                worktreePath,
                error: err instanceof Error ? err.message : String(err),
            };
        }

        if (candidate.worktree !== true || checkedOutBranch === null) continue;
        const candidateBranch = candidate.branch?.trim() ?? '';
        if (candidateBranch && candidateBranch === checkedOutBranch) {
            matches.push(worktreePath);
        }
    }

    if (matches.length === 1) return { outcome: 'matched', worktreePath: matches[0] };
    if (matches.length >= 2) return { outcome: 'ambiguous', worktreePaths: matches };
    return { outcome: 'no-match' };
}

function findExistingWorktreeForBranch(branch: string): string | null {
    const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0) return null;

    const lines = (result.stdout ?? '').split('\n');
    let currentPath: string | null = null;
    for (const line of lines) {
        if (line.startsWith('worktree ')) {
            currentPath = line.slice('worktree '.length).trim();
        } else if (line.startsWith('branch refs/heads/') && currentPath && currentPath !== REPO_ROOT) {
            const lineBranch = line.slice('branch refs/heads/'.length).trim();
            if (lineBranch === branch) return currentPath;
        }
    }
    return null;
}

// REPO_ROOT-only resolver. Reserved for callers that intentionally need REPO_ROOT semantics regardless of worktree state — currently resolveTaskCwd (breaks the self-reference cycle), commitTaskArtifactsToBase (scaffold-to-base commit), and the post-teardownWorktree archive-move in shipTasks. Do not use for general task-state reads; use taskDirFor() instead.
export function taskDirForRepoRoot(taskId: string): string {
    return path.join(process.env.CANON_TASKS_DIR_OVERRIDE ?? TASKS_DIR, taskId);
}

export function taskDirFor(taskId: string): string {
    // CANON_TASKS_DIR_OVERRIDE is the test-harness escape hatch — when set,
    // it MUST win over worktree resolution. Tests set this to a temp directory
    // and expect both reads and writes to land there regardless of any
    // `dev-worktrees/<id>/` directory that happens to exist (test setup may
    // construct fake worktree dirs to exercise resolveTaskCwd elsewhere).
    // Without this fast-path, the rewire would route to the worktree and
    // ignore the override, breaking AC-15's CANON_TASKS_DIR_OVERRIDE guarantee.
    if (process.env.CANON_TASKS_DIR_OVERRIDE) {
        return path.join(process.env.CANON_TASKS_DIR_OVERRIDE, taskId);
    }
    return path.join(resolveTaskCwd(taskId), 'tasks', taskId);
}

/**
 * True when `tasks/<taskId>/status.json` claims `worktree: true` with a branch
 * but no usable worktree exists on disk — either the conventional path is
 * missing entirely, OR the directory is present but stale (no `tasks/<id>/
 * status.json` inside, as happens after a half-completed `git worktree remove`
 * or a manual `rm` that left the dir behind) — AND no other checkout for the
 * branch exists. Mirrors `resolveTaskCwd`'s own usability test (it returns
 * the worktree only when the nested `status.json` is present), so this gate
 * fires whenever `resolveTaskCwd` would fall through to its `die()` path.
 * Used by callers that must degrade gracefully (e.g., `canon task list` per
 * the issue #83 contract) instead of crashing. Returns false on any
 * read/parse error — leave the "real" failure to the caller's normal path.
 */
export function isOrphanedWorktreeState(taskId: string): boolean {
    const worktreesRoot = effectiveWorktreesRoot();
    const directWorktree = path.join(worktreesRoot, taskId);
    const directStatus = path.join(directWorktree, 'tasks', taskId, 'status.json');
    if (fs.existsSync(directStatus)) return false;
    const statusPath = path.join(taskDirForRepoRoot(taskId), 'status.json');
    try {
        const parsed = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as Pick<StatusJson, 'worktree' | 'branch'>;
        if (parsed.worktree !== true) return false;
        const branch = parsed.branch?.trim() ?? '';
        if (!branch) return false;
        return findExistingWorktreeForBranch(branch) === null;
    } catch {
        return false;
    }
}

export function resolveTaskCwd(taskId: string): string {
    const worktreesRoot = effectiveWorktreesRoot();
    const directWorktree = path.join(worktreesRoot, taskId);
    const directStatus = path.join(directWorktree, 'tasks', taskId, 'status.json');
    if (fs.existsSync(directStatus)) return directWorktree;

    const statusPath = path.join(taskDirForRepoRoot(taskId), 'status.json');
    try {
        const parsed = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as Pick<StatusJson, 'worktree' | 'branch'>;
        if (parsed.worktree === true) {
            const branch = parsed.branch?.trim() ?? '';
            if (branch) {
                const existing = findExistingWorktreeForBranch(branch);
                if (existing) return existing;
                die(
                    `Worktree for task '${taskId}' is expected but missing.\n` +
                    `  Looked for ${directWorktree} and a worktree for branch '${branch}'.\n` +
                    `  Restore or recreate the worktree before continuing.`,
                );
            }

            const scan = scanWorktreesForSecondaryOwnership(taskId);
            switch (scan.outcome) {
                case 'matched':
                    return scan.worktreePath;
                case 'ambiguous':
                    die(
                        `Multiple worktrees claim ownership of task '${taskId}':\n` +
                        scan.worktreePaths.map(worktreePath => `  - ${worktreePath}`).join('\n') +
                        `\n  Only one worktree may record this task's branch. Resolve manually before continuing.`,
                    );
                    break;
                case 'enumeration-failed':
                    die(`Could not enumerate git worktrees while resolving task '${taskId}' ('git worktree list --porcelain' failed).`);
                    break;
                case 'present-but-invalid':
                    die(
                        `Task '${taskId}' has an unreadable status.json in worktree ${scan.worktreePath}: ${scan.error}\n` +
                        `  Fix or remove that file before continuing — ownership cannot be determined.`,
                    );
                    break;
                case 'no-match':
                    break;
            }
        }
    } catch {
        // No readable status metadata — fall through to the main checkout.
    }
    return REPO_ROOT;
}

export function statusFileFor(taskId: string): string {
    if (process.env.CANON_TASKS_DIR_OVERRIDE) {
        return path.join(process.env.CANON_TASKS_DIR_OVERRIDE, taskId, 'status.json');
    }
    return path.join(resolveTaskCwd(taskId), 'tasks', taskId, 'status.json');
}

export function validateBranchField(value: string | undefined, taskId: string, fieldName: string): void {
    if (value === undefined) return;
    if (typeof value !== 'string') {
        throw new Error(`Invalid ${fieldName} in task '${taskId}': expected string, got ${typeof value}. Edit status.json.`);
    }
    const trimmed = value.trim();
    if (trimmed === '') return;
    if (trimmed.startsWith('-')) {
        throw new Error(`Invalid ${fieldName} in task '${taskId}': '${value}' looks like a flag, not a branch name. Edit status.json.`);
    }
    if (/[\x00-\x1F\x7F\s:]/.test(trimmed)) {
        throw new Error(`Invalid ${fieldName} in task '${taskId}': '${value}' contains control chars, whitespace, or refspec separator. Edit status.json.`);
    }
}

function validateNonNegativeInt(value: unknown, taskId: string, fieldPath: string): void {
    if (value === undefined) return;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new Error(`Invalid ${fieldPath} in task '${taskId}': expected non-negative integer, got ${JSON.stringify(value)}. Edit status.json.`);
    }
}

export function validateStatus(taskId: string, parsed: StatusJson): void {
    validateBranchField(parsed.branch, taskId, 'branch');
    validateBranchField(parsed.base_branch, taskId, 'base_branch');

    const phases = parsed.phases ?? {};
    for (const [phaseName, entry] of Object.entries(phases)) {
        if (!entry) continue;
        for (const field of ['iterations', 'iterations_current_loop', 'iterations_total', 'changes_requested_total', 'preflight_rejections_current_loop', 'preflight_rejections_total', 'auto_block_count', 'reroute_count'] as const) {
            validateNonNegativeInt(entry[field], taskId, `phases.${phaseName}.${field}`);
        }
    }
}

export function readStatus(taskId: string): StatusJson {
    return readStatusFromPath(statusFileFor(taskId), taskId);
}

export function readStatusFromPath(statusFile: string, taskIdForErrors = '<unknown>'): StatusJson {
    const parsed = JSON.parse(fs.readFileSync(statusFile, 'utf8')) as StatusJson;
    validateStatus(taskIdForErrors, parsed);
    return parsed;
}

export function deriveTopLevelStatus(status: StatusJson): CurrentPhase {
    for (const phase of PHASE_ORDER) {
        const phaseStatus = status.phases[phase]?.status ?? 'pending';
        if (phaseStatus !== 'done') return phase;
    }
    return 'complete';
}

export function writeStatus(taskId: string, status: StatusJson): void {
    writeStatusToFile(statusFileFor(taskId), status);
}

export function writeStatusToFile(statusFile: string, status: StatusJson): void {
    status.status = deriveTopLevelStatus(status);
    const tmpFile = `${statusFile}.tmp`;
    fs.writeFileSync(tmpFile, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
    fs.renameSync(tmpFile, statusFile);
}

export function storeSessionId(taskIds: string[], agent: SessionSlot, sessionId: string): void {
    for (const taskId of taskIds) {
        const s = readStatus(taskId);
        if (!s.sessions) s.sessions = {};
        s.sessions[agent] = sessionId;
        writeStatus(taskId, s);
    }
}

export function getStoredSessionId(taskIds: string[], agent: SessionSlot): string | null {
    return readStatus(taskIds[0]).sessions?.[agent] ?? null;
}

export function autoBlockPhase(
    taskIds: string[],
    phase: Phase,
    iterationCount: number,
    reason: string,
): void {
    const today = new Date().toISOString().slice(0, 10);
    for (const taskId of taskIds) {
        const status = readStatus(taskId);
        const phaseEntry = status.phases[phase];
        if (phaseEntry) {
            phaseEntry.status = 'blocked';
            phaseEntry.auto_block_count = (phaseEntry.auto_block_count ?? 0) + 1;
        }
        status.escalations = status.escalations ?? [];
        status.escalations.push({ date: today, phase, iteration_count: iterationCount, reason });
        status.updated = today;
        writeStatus(taskId, status);
    }
}
