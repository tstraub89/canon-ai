import fs from 'node:fs';
import path from 'node:path';

import { REPO_ROOT, TASKS_DIR, WORKTREES_ROOT } from './env.js';
import { PHASE_ORDER, type CurrentPhase, type Phase, type SessionSlot, type StatusJson } from './types.js';

export function taskDirFor(taskId: string): string {
    const tasksDir = process.env.CANON_TASKS_DIR_OVERRIDE ?? TASKS_DIR;
    return path.join(tasksDir, taskId);
}

export function resolveTaskCwd(taskId: string): string {
    const wtStatus = path.join(WORKTREES_ROOT, taskId, 'tasks', taskId, 'status.json');
    return fs.existsSync(wtStatus) ? path.join(WORKTREES_ROOT, taskId) : REPO_ROOT;
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
    status.status = deriveTopLevelStatus(status);
    const statusFile = statusFileFor(taskId);
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
