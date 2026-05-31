import path from 'node:path';

import { readCanonPid } from './detach.js';
import { type HeartbeatReadResult, readHeartbeatStatus } from './heartbeat.js';
import { isOrphanedWorktreeState, statusFileFor, taskDirForRepoRoot } from './state.js';
import { readStatusFromPath } from './state.js';
import { type StatusJson } from './types.js';

export type StatusReadResult =
    | { kind: 'ok'; file: string; status: unknown }
    | { kind: 'missing'; file: string }
    | { kind: 'error'; file: string; reason: string };

export interface RunContext {
    taskId: string;
    taskDir: string;
    statusFile: string;
    heartbeatFile: string;
    statusResult: StatusReadResult;
    heartbeatResult: HeartbeatReadResult;
    canonPid: number | null;
    resolvedPid: number | null;
    ambiguousPid: { canonPid: number; heartbeatPid: number } | null;
    launchWindow: boolean;
}

export interface GatherRunContextDeps {
    readStatusImpl?: (file: string) => StatusJson;
    readHeartbeatImpl?: (dir: string) => HeartbeatReadResult;
    readCanonPidImpl?: (dir: string) => number | null;
    probeAliveImpl?: (pid: number) => void;
    resolveTaskDirImpl?: (taskId: string) => string;
}

function statusReadResult(taskId: string, statusFile: string, readImpl?: (file: string) => StatusJson): StatusReadResult {
    try {
        if (readImpl) {
            return { kind: 'ok', file: statusFile, status: readImpl(statusFile) };
        }
        return { kind: 'ok', file: statusFile, status: readStatusFromPath(statusFile, taskId) };
    } catch (error: unknown) {
        if (getErrnoCode(error) === 'ENOENT') {
            return { kind: 'missing', file: statusFile };
        }
        return {
            kind: 'error',
            file: statusFile,
            reason: errorMessage(error),
        };
    }
}

export function tolerantTaskDir(taskId: string): string {
    if (isOrphanedWorktreeState(taskId)) return taskDirForRepoRoot(taskId);
    return path.dirname(statusFileFor(taskId));
}

function defaultProbeAlive(pid: number): void {
    process.kill(pid, 0);
}

function getErrnoCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function isStatusJson(value: unknown): value is StatusJson {
    if (typeof value !== 'object' || value === null) return false;
    const record = value as { id?: unknown; phases?: unknown };
    return typeof record.id === 'string' && typeof record.phases === 'object' && record.phases !== null;
}

export function probePidAlive(pid: number, probeImpl: (pid: number) => void = defaultProbeAlive): boolean {
    try {
        probeImpl(pid);
        return true;
    } catch (error: unknown) {
        return getErrnoCode(error) === 'EPERM';
    }
}

export function gatherRunContext(taskId: string, deps: GatherRunContextDeps = {}): RunContext {
    const taskDir = (deps.resolveTaskDirImpl ?? tolerantTaskDir)(taskId);
    const statusFile = path.join(taskDir, 'status.json');
    const heartbeatFile = path.join(taskDir, '.heartbeat.json');
    const statusResult = statusReadResult(taskId, statusFile, deps.readStatusImpl);
    const heartbeatResult = (deps.readHeartbeatImpl ?? readHeartbeatStatus)(taskDir);
    const canonPid = (deps.readCanonPidImpl ?? readCanonPid)(taskDir);
    const probeImpl = deps.probeAliveImpl;
    const canonAlive = canonPid != null ? probePidAlive(canonPid, probeImpl) : false;
    const heartbeatPid = heartbeatResult.kind === 'found' ? heartbeatResult.record.pid : null;
    const heartbeatAlive = heartbeatPid != null ? probePidAlive(heartbeatPid, probeImpl) : false;

    const ambiguousPid =
        canonPid != null &&
        heartbeatPid != null &&
        canonPid !== heartbeatPid &&
        canonAlive &&
        heartbeatAlive
            ? { canonPid, heartbeatPid }
            : null;

    // A heartbeat pid that disagrees with .canon-pid (and is not the both-alive
    // ambiguous case above) is positive evidence that .canon-pid is stale or
    // reused: the orchestrator stamps both files with its own pid, so they only
    // diverge across a death + pid-recycle. Trust the heartbeat's pid in that
    // case — if it is dead, the run reports death instead of attaching to an
    // unrelated live process that happens to hold the recycled .canon-pid.
    const heartbeatDisagrees = canonPid != null && heartbeatPid != null && heartbeatPid !== canonPid;

    let resolvedPid: number | null = null;
    if (ambiguousPid != null) {
        resolvedPid = null;
    } else if (heartbeatDisagrees) {
        resolvedPid = heartbeatPid;
    } else if (canonAlive) {
        resolvedPid = canonPid;
    } else if (heartbeatAlive) {
        resolvedPid = heartbeatPid;
    } else if (canonPid != null) {
        resolvedPid = canonPid;
    } else if (heartbeatResult.kind === 'found') {
        resolvedPid = heartbeatResult.record.pid;
    }

    const launchWindow =
        canonPid != null &&
        canonAlive &&
        heartbeatResult.kind === 'missing';

    return {
        taskId,
        taskDir,
        statusFile,
        heartbeatFile,
        statusResult,
        heartbeatResult,
        canonPid,
        resolvedPid,
        ambiguousPid,
        launchWindow,
    };
}
