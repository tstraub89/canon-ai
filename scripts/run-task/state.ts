import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { die } from './cli.js';
import { REPO_ROOT, TASKS_DIR, WORKTREES_ROOT } from './env.js';
import { PHASE_ORDER, type CurrentPhase, type Phase, type SessionSlot, type StatusJson } from './types.js';

function effectiveWorktreesRoot(): string {
    return process.env.CANON_WORKTREES_ROOT ? path.resolve(process.env.CANON_WORKTREES_ROOT) : WORKTREES_ROOT;
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

export function taskDirFor(taskId: string): string {
    const tasksDir = process.env.CANON_TASKS_DIR_OVERRIDE ?? TASKS_DIR;
    return path.join(tasksDir, taskId);
}

export function resolveTaskCwd(taskId: string): string {
    const worktreesRoot = effectiveWorktreesRoot();
    const directWorktree = path.join(worktreesRoot, taskId);
    const directStatus = path.join(directWorktree, 'tasks', taskId, 'status.json');
    if (fs.existsSync(directStatus)) return directWorktree;

    const statusPath = path.join(taskDirFor(taskId), 'status.json');
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

export function readStatus(taskId: string): StatusJson {
    const parsed = JSON.parse(fs.readFileSync(statusFileFor(taskId), 'utf8')) as StatusJson;
    if (!parsed.phases.runtime_validation) {
        parsed.phases.runtime_validation = {
            status: 'done',
            agent: 'orchestrator',
            verdict: 'approved',
            iterations: 0,
            iterations_current_loop: 0,
            iterations_total: 0,
            changes_requested_total: 0,
            auto_block_count: 0,
        };
    }
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
