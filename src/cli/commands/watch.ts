import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

import { runLogPathFor } from '../../orchestrator/detach.js';
import { HEARTBEAT_INTERVAL_MS, isHeartbeatStale, type HeartbeatReadResult } from '../../orchestrator/heartbeat.js';
import { gatherRunContext, isStatusJson, probePidAlive, tolerantTaskDir, type RunContext } from '../../orchestrator/run-context.js';
import { deriveTopLevelStatus } from '../../orchestrator/state.js';
import { PHASE_ORDER, type CurrentPhase, type Phase, type Verdict, type StatusJson } from '../../orchestrator/types.js';
import { formatAge } from './doctor.js';
import { STOP_WAIT_DEFAULT_MS, STOP_WAIT_POLL_INTERVAL_MS, waitForHeartbeat } from './stop.js';

const WATCH_POLL_INTERVAL_MS = 3_000;

// Single source of truth for "is a live pid sufficient evidence that a
// blocked phase is actually a resuming run, not a terminal block." Per
// AC-3/AC-20 (tasks/preroute-review-loop-autoblock/spec.md): liveness alone
// is authoritative, deliberately unbounded by heartbeat staleness — the
// synchronous pre-agent setup work a resume runs through (scaffold commit,
// worktree add, session-init) has no fixed upper bound, and a time cutoff
// here would misreport a genuinely healthy, still-slow resume as blocked,
// defeating the reason this checkpoint exists. A long-dead orchestrator
// whose recycled pid this can't distinguish from an unrelated live process
// is a narrow, pre-existing risk this shares with every other liveness
// check in this file (e.g. the non-blocked-phase branch below) — accepted,
// not solved here. Every consumer of a blocked-phase status must route
// through this one function so that acceptance is applied consistently.
function blockedPhaseLivenessTrusted(_ctx: RunContext, orchestratorLive: boolean, _now: number): boolean {
    return orchestratorLive;
}

export type WatchReason =
    | 'checkpoint'
    | 'complete'
    | 'auto_block'
    | 'step_done'
    | 'death'
    | 'timeout'
    | 'until'
    | 'ambiguous_pid'
    | 'nothing_to_watch'
    | 'launch_window_timeout'
    | 'read_error'
    | 'usage_error';

type SummaryLine = {
    state: string;
    reason: WatchReason;
    phase?: string;
    verdict?: string;
    pid?: number;
};

type StatusError = { kind: 'read_error'; file: string; reason: string };

export type AttachClassification =
    | { kind: 'live'; pid: number; state: string }
    | { kind: 'launch_window'; state: string }
    | { kind: 'auto_block'; state: string; phase: string }
    | { kind: 'ambiguous_pid'; state: string; canonPid: number; heartbeatPid: number }
    | { kind: 'death'; state: string; hint: string }
    | { kind: 'nothing_to_watch'; state: string; hint: string }
    | { kind: 'read_error'; file: string; reason: string };

export type IdleClassification =
    | { kind: 'checkpoint'; state: string; phase: string; verdict?: Verdict; pid?: number }
    | { kind: 'complete'; state: string; pid?: number }
    | { kind: 'auto_block'; state: string; phase: string; pid?: number }
    | { kind: 'step_done'; state: string; phase: string; verdict?: Verdict; pid?: number }
    | { kind: 'death'; state: string; pid?: number }
    | { kind: 'ambiguous_pid'; state: string; canonPid: number; heartbeatPid: number }
    | { kind: 'read_error'; file: string; reason: string };

export interface WatchCmdDeps {
    exit?: (code: number) => never;
    stdout?: (s: string) => void;
    stderr?: (s: string) => void;
    sleepImpl?: (ms: number) => void;
    nowImpl?: () => number;
    gatherContextImpl?: (taskId: string) => RunContext;
    probeAliveImpl?: (pid: number) => void;
    readHeartbeatImpl?: (dir: string) => HeartbeatReadResult;
    readCanonPidImpl?: (dir: string) => number | null;
    waitTimeoutMs?: number;
    pollIntervalMs?: number;
}

interface ParsedWatchArgs {
    taskId: string;
    follow: boolean;
    untilPhase: Phase | null;
    timeoutMs: number | null;
    usageError: string | null;
}

function sleepSync(ms: number): void {
    const buffer = new SharedArrayBuffer(4);
    const view = new Int32Array(buffer);
    Atomics.wait(view, 0, 0, ms);
}

function summaryStateForStatus(status: StatusJson): string {
    return status.status ?? 'unknown';
}

function getErrnoCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// `blockedTrusted` must already be the grace-bounded result of
// blockedPhaseLivenessTrusted() -- not raw pid liveness -- so a 'blocked'
// phase settles (is no longer worth waiting on) only when that trust
// check fails, matching every other consumer of the same signal.
function isPhaseSettled(status: StatusJson, phase: Phase, blockedTrusted: boolean): boolean {
    const phaseStatus = status.phases[phase]?.status ?? 'pending';
    if (phaseStatus === 'done' || phaseStatus === 'changes_requested') return true;
    if (phaseStatus === 'blocked') return !blockedTrusted;
    return false;
}

function findFirstBlockedPhase(status: StatusJson): Phase | null {
    for (const phase of PHASE_ORDER) {
        if ((status.phases[phase]?.status ?? 'pending') === 'blocked') return phase;
    }
    return null;
}

function findPreviousDonePhase(status: StatusJson, beforePhase: Phase): Phase | null {
    const index = PHASE_ORDER.indexOf(beforePhase);
    for (let i = index - 1; i >= 0; i -= 1) {
        const phase = PHASE_ORDER[i];
        if ((status.phases[phase]?.status ?? 'pending') === 'done') return phase;
    }
    return null;
}

function formatPhaseTransition(from: CurrentPhase, to: CurrentPhase): string {
    return `${from}→${to}`;
}

function formatPhasePointerTransition(from: CurrentPhase, to: CurrentPhase): string {
    // A backwards pointer move is always the orchestrator routing a task
    // back after a changes_requested review — label it so the operator
    // doesn't read it as the pipeline running phases out of order.
    const fromIdx = PHASE_ORDER.indexOf(from as Phase);
    const toIdx = PHASE_ORDER.indexOf(to as Phase);
    const reroute = fromIdx !== -1 && toIdx !== -1 && toIdx < fromIdx;
    return `${from} → ${to}${reroute ? ' (reroute)' : ''}`;
}

function displayedPhasePointer(ctx: RunContext): CurrentPhase | null {
    if (ctx.statusResult.kind !== 'ok' || !isStatusJson(ctx.statusResult.status)) return null;
    return deriveTopLevelStatus(ctx.statusResult.status);
}

// True while status.json is mid-reroute: a review phase sits 'done' with a
// changes_requested/needs_re_review verdict, meaning the orchestrator's
// post-phase hook is about to route the pointer backwards (routeBackTo
// clears both the verdict and the 'done' stamp in one atomic write). In
// this window the derived pointer transiently reads as the NEXT phase
// (e.g. code_review done → pointer says qa) even though qa will never run
// this cycle — reporting that as a transition is what produced the bogus
// "code_review → qa" / "qa → implement" pair instead of the real
// "code_review → implement".
// Only the verdicts checkAndRoute actually routes back on: holding on any
// other done+verdict combination (e.g. spec_review + needs_re_review, which
// advances to plan) would wedge pointer reporting on a settled status.
const REROUTE_VERDICTS: Record<'spec_review' | 'code_review', readonly Verdict[]> = {
    spec_review: ['changes_requested'],
    code_review: ['changes_requested', 'needs_re_review'],
};

function pointerIsMidReroute(ctx: RunContext): boolean {
    if (ctx.statusResult.kind !== 'ok' || !isStatusJson(ctx.statusResult.status)) return false;
    for (const phase of ['spec_review', 'code_review'] as const) {
        const entry = ctx.statusResult.status.phases[phase];
        if (entry?.status !== 'done') continue;
        if (entry.verdict != null && REROUTE_VERDICTS[phase].includes(entry.verdict)) return true;
    }
    return false;
}

function formatSummaryLine(summary: SummaryLine): string {
    const parts = [`state=${summary.state}`, `reason=${summary.reason}`];
    if (summary.phase) parts.push(`phase=${summary.phase}`);
    if (summary.verdict) parts.push(`verdict=${summary.verdict}`);
    if (summary.pid != null) parts.push(`pid=${summary.pid}`);
    return parts.join(' ');
}

function emitSummary(stdout: (s: string) => void, summary: SummaryLine): void {
    stdout(`${formatSummaryLine(summary)}\n`);
}

function printUsage(stderr: (s: string) => void): void {
    stderr('Usage: canon watch <task-id> [--until <phase>] [--timeout <dur>] [--follow|-f]');
    stderr('');
    stderr('  Blocks until the detached orchestrator settles, then prints one summary line.');
    stderr('  Exit codes: 0 healthy stop/until, 2 usage/nothing-to-watch/read-error/ambiguous_pid/launch-window-timeout,');
    stderr('              3 auto-block, 4 death, 5 timeout.');
    stderr('  Summary line: state=<state> reason=<reason> [phase=<phase>] [verdict=<verdict>] [pid=<pid>]');
    stderr('  Reasons: checkpoint, complete, auto_block, step_done, death, timeout, until, nothing_to_watch,');
    stderr('           launch_window_timeout, ambiguous_pid, read_error, usage_error.');
}

function parseDurationMs(raw: string): number | null {
    const trimmed = raw.trim();
    const secondsMatch = trimmed.match(/^(\d+)s$/);
    if (secondsMatch) return Number.parseInt(secondsMatch[1], 10) * 1000;
    const minutesMatch = trimmed.match(/^(\d+)m$/);
    if (minutesMatch) return Number.parseInt(minutesMatch[1], 10) * 60_000;
    if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10) * 1000;
    return null;
}

function parseWatchArgs(args: string[]): ParsedWatchArgs {
    let taskId: string | null = null;
    let follow = false;
    let untilPhase: Phase | null = null;
    let timeoutMs: number | null = null;
    let usageError: string | null = null;

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--follow' || arg === '-f') {
            follow = true;
            continue;
        }
        if (arg === '--until') {
            const value = args[index + 1];
            if (!value) {
                usageError = '--until requires a phase argument';
                break;
            }
            index += 1;
            if (!PHASE_ORDER.includes(value as Phase)) {
                usageError = `Invalid phase for --until: ${value}`;
                break;
            }
            untilPhase = value as Phase;
            continue;
        }
        if (arg.startsWith('--timeout=')) {
            const value = arg.slice('--timeout='.length);
            const parsed = parseDurationMs(value);
            if (parsed == null) {
                usageError = `Invalid --timeout value: ${value}`;
                break;
            }
            timeoutMs = parsed;
            continue;
        }
        if (arg === '--timeout') {
            const value = args[index + 1];
            if (!value) {
                usageError = '--timeout requires a duration argument';
                break;
            }
            index += 1;
            const parsed = parseDurationMs(value);
            if (parsed == null) {
                usageError = `Invalid --timeout value: ${value}`;
                break;
            }
            timeoutMs = parsed;
            continue;
        }
        if (arg.startsWith('-')) {
            usageError = `Unknown option: ${arg}`;
            break;
        }
        if (taskId != null) {
            usageError = 'canon watch accepts exactly one TASK-ID';
            break;
        }
        taskId = arg;
    }

    if (!taskId && usageError == null) usageError = 'At least one TASK-ID is required.';
    return {
        taskId: taskId ?? '',
        follow,
        untilPhase,
        timeoutMs,
        usageError,
    };
}

function summarizeIdle(result: IdleClassification): SummaryLine {
    switch (result.kind) {
        case 'checkpoint':
            return { state: result.state, reason: 'checkpoint', phase: result.phase, verdict: result.verdict, pid: result.pid };
        case 'complete':
            return { state: result.state, reason: 'complete', pid: result.pid };
        case 'auto_block':
            return { state: result.state, reason: 'auto_block', phase: result.phase, pid: result.pid };
        case 'step_done':
            return { state: result.state, reason: 'step_done', phase: result.phase, verdict: result.verdict, pid: result.pid };
        case 'death':
            return { state: result.state, reason: 'death', pid: result.pid };
        case 'ambiguous_pid':
            return { state: result.state, reason: 'ambiguous_pid' };
        case 'read_error':
            return { state: 'unknown', reason: 'read_error' };
    }
}

function classifyStatusErrors(ctx: RunContext): StatusError | null {
    if (ctx.statusResult.kind === 'error') {
        return { kind: 'read_error', file: ctx.statusResult.file, reason: ctx.statusResult.reason };
    }
    if (ctx.heartbeatResult.kind === 'corrupt' || ctx.heartbeatResult.kind === 'unreadable') {
        return { kind: 'read_error', file: ctx.heartbeatFile, reason: ctx.heartbeatResult.reason };
    }
    return null;
}

export function classifyAttach(
    ctx: RunContext,
    taskId: string,
    probeAlive: (pid: number) => boolean,
    now: number,
): AttachClassification {
    const readError = classifyStatusErrors(ctx);
    if (readError) return readError;

    const status = ctx.statusResult.kind === 'ok' && isStatusJson(ctx.statusResult.status)
        ? ctx.statusResult.status
        : null;
    const state = status?.status ?? 'unknown';

    if (ctx.ambiguousPid != null) {
        return {
            kind: 'ambiguous_pid',
            state,
            canonPid: ctx.ambiguousPid.canonPid,
            heartbeatPid: ctx.ambiguousPid.heartbeatPid,
        };
    }

    const blockedPhase = status ? findFirstBlockedPhase(status) : null;
    const orchestratorLive = ctx.resolvedPid != null && probeAlive(ctx.resolvedPid);
    const blockedTrusted = blockedPhaseLivenessTrusted(ctx, orchestratorLive, now);
    if (blockedPhase && !blockedTrusted) {
        return { kind: 'auto_block', state: 'blocked', phase: blockedPhase };
    }
    if (blockedPhase && blockedTrusted) {
        return { kind: 'live', pid: ctx.resolvedPid as number, state };
    }

    if (ctx.resolvedPid != null && orchestratorLive && ctx.heartbeatResult.kind === 'found' && !isHeartbeatStale(ctx.heartbeatResult.record, now)) {
        return { kind: 'live', pid: ctx.resolvedPid, state };
    }

    if (ctx.launchWindow) {
        return { kind: 'launch_window', state };
    }

    if (status) {
        const inProgress = PHASE_ORDER.some(phase => (status.phases[phase]?.status ?? 'pending') === 'in_progress');
        if (inProgress) {
            return {
                kind: 'death',
                state,
                hint: `run \`canon run ${taskId}\` to resume`,
            };
        }
    }

    return {
        kind: 'nothing_to_watch',
        state,
        hint: `Use \`canon task status ${taskId}\` for a non-blocking snapshot of the task state.`,
    };
}

export function classifyIdle(
    ctx: RunContext,
    _taskId: string,
    probeAlive: (pid: number) => boolean = () => false,
    now: number = Date.now(),
): IdleClassification {
    const readError = classifyStatusErrors(ctx);
    if (readError) return readError;
    const status = ctx.statusResult.kind === 'ok' && isStatusJson(ctx.statusResult.status)
        ? ctx.statusResult.status
        : null;
    if (status == null) {
        return { kind: 'death', state: 'unknown' };
    }
    const state = summaryStateForStatus(status);
    if (ctx.ambiguousPid != null) {
        return {
            kind: 'ambiguous_pid',
            state,
            canonPid: ctx.ambiguousPid.canonPid,
            heartbeatPid: ctx.ambiguousPid.heartbeatPid,
        };
    }

    const blockedPhase = findFirstBlockedPhase(status);
    const orchestratorLive = ctx.resolvedPid != null && probeAlive(ctx.resolvedPid);
    if (blockedPhase && !blockedPhaseLivenessTrusted(ctx, orchestratorLive, now)) {
        return { kind: 'auto_block', state: 'blocked', phase: blockedPhase, pid: ctx.resolvedPid ?? undefined };
    }

    if (state === 'human_review') {
        const verdict = status.phases.code_review?.verdict || undefined;
        return {
            kind: 'checkpoint',
            state: 'human_review',
            phase: 'qa→human_review',
            verdict,
            pid: ctx.resolvedPid ?? undefined,
        };
    }

    if (state === 'complete') {
        return { kind: 'complete', state: 'complete', pid: ctx.resolvedPid ?? undefined };
    }

    const currentPhase = PHASE_ORDER.includes(state as Phase) ? state as Phase : null;
    if (currentPhase) {
        const currentPhaseStatus = status.phases[currentPhase]?.status ?? 'pending';
        if (currentPhaseStatus === 'changes_requested') {
            return {
                kind: 'step_done',
                state,
                phase: currentPhase,
                verdict: status.phases[currentPhase]?.verdict || 'changes_requested',
                pid: ctx.resolvedPid ?? undefined,
            };
        }
        if (currentPhaseStatus === 'pending' || currentPhaseStatus === 'in_progress') {
            const previousPhase = findPreviousDonePhase(status, currentPhase);
            if (previousPhase) {
                return {
                    kind: 'step_done',
                    state,
                    phase: formatPhaseTransition(previousPhase, currentPhase),
                    pid: ctx.resolvedPid ?? undefined,
                };
            }
        }
    }

    if (PHASE_ORDER.some(phase => (status.phases[phase]?.status ?? 'pending') === 'in_progress')) {
        return { kind: 'death', state, pid: ctx.resolvedPid ?? undefined };
    }

    return { kind: 'death', state, pid: ctx.resolvedPid ?? undefined };
}

function phaseSettled(ctx: RunContext, phase: Phase, probeAlive: (pid: number) => boolean, now: number): boolean {
    const status = ctx.statusResult.kind === 'ok' && isStatusJson(ctx.statusResult.status)
        ? ctx.statusResult.status
        : null;
    if (status == null) return false;
    const orchestratorLive = ctx.resolvedPid != null && probeAlive(ctx.resolvedPid);
    return isPhaseSettled(status, phase, blockedPhaseLivenessTrusted(ctx, orchestratorLive, now));
}

// A stale heartbeat alone does not mean the orchestrator stopped. The heartbeat
// timer can't tick during the synchronous no-heartbeat window at a phase boundary
// (scaffold commit, telemetry absorption, `git worktree add`, node_modules symlink,
// and agent session-init all shell out via execSync / sync fs and block the event
// loop). If the resolved orchestrator pid is still alive and the run hasn't
// reached a real stop — an auto-block, human_review checkpoint, or completion — it is
// progressing, not settled, so the idle classifier must keep blocking instead of
// reporting a false step_done.
//
// A live pid alone is not enough when a phase is blocked, though: the same
// bounded resume-setup grace classifyAttach() applies must hold here too, or
// a task that slips past that initial bounded check once would then be
// trusted by this function forever on every subsequent poll, regardless of
// how stale the heartbeat gets — reopening exactly the long-dead,
// recycled-pid ambiguity the bound exists to close.
export function orchestratorStillProgressing(
    ctx: RunContext,
    probeAlive: (pid: number) => boolean,
    now: number = Date.now(),
): boolean {
    const orchestratorLive = ctx.resolvedPid != null && probeAlive(ctx.resolvedPid);
    if (!orchestratorLive) return false;
    const status = ctx.statusResult.kind === 'ok' && isStatusJson(ctx.statusResult.status)
        ? ctx.statusResult.status
        : null;
    if (status == null) return false;
    if (findFirstBlockedPhase(status) && !blockedPhaseLivenessTrusted(ctx, orchestratorLive, now)) return false;
    const state = status.status;
    return state !== 'human_review' && state !== 'complete';
}
function primaryLogTaskId(ctx: RunContext, fallbackTaskId: string): string {
    if (ctx.heartbeatResult.kind === 'found') {
        return ctx.heartbeatResult.record.task_ids[0] ?? fallbackTaskId;
    }
    return fallbackTaskId;
}

type LogTailState = {
    position: number | null;
    path?: string;
    identity?: string;
    decoder: StringDecoder;
};

function tailRunLog(
    ctx: RunContext,
    taskId: string,
    deps: Pick<WatchCmdDeps, 'stderr'>,
    tailState: LogTailState,
): void {
    const logTaskDir = tolerantTaskDir(primaryLogTaskId(ctx, taskId));
    const logPath = runLogPathFor(logTaskDir);
    let fd: number | undefined;
    try {
        fd = fs.openSync(logPath, 'r');
        const stat = fs.fstatSync(fd);
        const identity = `${logPath}:${stat.dev}:${stat.ino}`;
        if (tailState.position == null || tailState.path !== logPath) {
            tailState.position = stat.size;
            tailState.path = logPath;
            tailState.identity = identity;
            tailState.decoder = new StringDecoder('utf8');
            return;
        }
        if (identity !== tailState.identity || stat.size < tailState.position) {
            tailState.position = 0;
            tailState.decoder = new StringDecoder('utf8');
        }
        tailState.identity = identity;
        if (stat.size === tailState.position) return;
        const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, stat.size - tailState.position));
        while (tailState.position < stat.size) {
            const bytes = fs.readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - tailState.position), tailState.position);
            if (bytes === 0) break;
            tailState.position += bytes;
            const chunk = tailState.decoder.write(buffer.subarray(0, bytes));
            if (chunk.length > 0) deps.stderr?.(chunk);
        }
    } catch (error: unknown) {
        const code = getErrnoCode(error);
        if (code === 'ENOENT') return;
        deps.stderr?.(`canon watch: failed to tail ${logPath}: ${errorMessage(error)}\n`);
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
}

function gatherContext(taskId: string, deps: WatchCmdDeps): RunContext {
    if (deps.gatherContextImpl) return deps.gatherContextImpl(taskId);
    return gatherRunContext(taskId, {
        readHeartbeatImpl: deps.readHeartbeatImpl,
        readCanonPidImpl: deps.readCanonPidImpl,
        probeAliveImpl: deps.probeAliveImpl,
    });
}

export function watchCmd(args: string[], deps: WatchCmdDeps = {}): void {
    const exit = deps.exit ?? ((code: number): never => process.exit(code));
    const rawStdout = deps.stdout ?? ((s: string): void => { process.stdout.write(s); });
    const rawStderr = deps.stderr ?? ((s: string): void => { process.stderr.write(s); });

    // Healthy poll ticks print a bare '.' (no newline) so hours of quiet run
    // collapse into a few dot-lines and real messages — phase transitions,
    // stall notices, summaries — stay visible in a short log tail. Any real
    // write first terminates an open dot run so it starts at column 0.
    let dotsOpen = false;
    // Follow-mode log chunks can end mid-line; a dot must never append to
    // such a partial line, so track whether the last real write ended in a
    // newline and open a fresh line before ticking when it didn't.
    let atLineStart = true;
    const closeDots = (): void => {
        if (!dotsOpen) return;
        dotsOpen = false;
        atLineStart = true;
        rawStderr('\n');
    };
    const tick = (): void => {
        if (!dotsOpen && !atLineStart) rawStderr('\n');
        dotsOpen = true;
        atLineStart = false;
        rawStderr('.');
    };
    const noteWrite = (s: string): void => {
        if (s.length > 0) atLineStart = s.endsWith('\n');
    };
    const stdout = (s: string): void => { closeDots(); rawStdout(s); noteWrite(s); };
    const stderr = (s: string): void => { closeDots(); rawStderr(s); noteWrite(s); };
    const sleep = deps.sleepImpl ?? sleepSync;
    const now = deps.nowImpl ?? Date.now;
    const pollIntervalMs = deps.pollIntervalMs ?? WATCH_POLL_INTERVAL_MS;
    const waitTimeoutMs = deps.waitTimeoutMs ?? STOP_WAIT_DEFAULT_MS;
    const isOrchestratorAlive = (pid: number): boolean => probePidAlive(pid, deps.probeAliveImpl);

    const parsed = parseWatchArgs(args);
    if (parsed.usageError) {
        printUsage(stderr);
        stderr(`canon watch: ${parsed.usageError}\n`);
        emitSummary(stdout, { state: 'usage', reason: 'usage_error' });
        return exit(2);
    }

    const taskId = parsed.taskId;
    const timeoutDeadline = parsed.timeoutMs == null ? null : now() + parsed.timeoutMs;
    const tailState: LogTailState = { position: null, decoder: new StringDecoder('utf8') };

    const withinTimeout = (): boolean => timeoutDeadline != null && now() >= timeoutDeadline;
    const remainingTimeoutMs = (): number | null => {
        if (timeoutDeadline == null) return null;
        return Math.max(0, timeoutDeadline - now());
    };

    const reportTimeout = (): never => {
        emitSummary(stdout, { state: 'timeout', reason: 'timeout' });
        return exit(5);
    };

    const reportInitialFailure = (result: AttachClassification): never => {
        switch (result.kind) {
            case 'auto_block':
                emitSummary(stdout, { state: 'blocked', reason: 'auto_block', phase: result.phase });
                return exit(3);
            case 'death':
                stderr(`canon watch: ${result.hint}\n`);
                emitSummary(stdout, { state: result.state, reason: 'death' });
                return exit(4);
            case 'nothing_to_watch':
                stderr(`canon watch: ${result.hint}\n`);
                emitSummary(stdout, { state: result.state, reason: 'nothing_to_watch' });
                return exit(2);
            case 'read_error':
                stderr(`canon watch: cannot read ${result.file}: ${result.reason}\n`);
                stderr(`canon watch: run \`canon task status ${taskId}\` to inspect the task state.\n`);
                emitSummary(stdout, { state: 'unknown', reason: 'read_error' });
                return exit(2);
            case 'launch_window':
                stderr(`canon watch: orchestrator is still starting; try again in a moment.\n`);
                emitSummary(stdout, { state: result.state, reason: 'nothing_to_watch' });
                return exit(2);
            case 'ambiguous_pid':
                stderr(
                    `canon watch: .canon-pid (${result.canonPid}) and heartbeat pid (${result.heartbeatPid}) are both alive but disagree. ` +
                    `Refusing to attach.\n`,
                );
                stderr(`canon watch: run \`canon task status ${taskId}\` to inspect the task state.\n`);
                emitSummary(stdout, { state: result.state, reason: 'ambiguous_pid' });
                return exit(2);
            case 'live':
                throw new Error('reportInitialFailure called for live result');
        }
    };

    let ctx = gatherContext(taskId, deps);

    if (parsed.untilPhase && phaseSettled(ctx, parsed.untilPhase, isOrchestratorAlive, now())) {
        emitSummary(stdout, {
            state: parsed.untilPhase,
            reason: 'until',
            phase: parsed.untilPhase,
            pid: ctx.resolvedPid ?? undefined,
        });
        return exit(0);
    }

    const initialAttach = classifyAttach(ctx, taskId, isOrchestratorAlive, now());
    if (initialAttach.kind !== 'live' && initialAttach.kind !== 'launch_window') {
        return reportInitialFailure(initialAttach);
    }

    let previousPhasePointer = displayedPhasePointer(ctx);

    // Report a pointer change, holding the previous pointer while status.json
    // is mid-reroute — the transient forward pointer in that window (see
    // pointerIsMidReroute) would otherwise report phases that never run.
    const reportPhasePointer = (pollCtx: RunContext): void => {
        let currentPhase = displayedPhasePointer(pollCtx);
        if (currentPhase != null && previousPhasePointer != null && pointerIsMidReroute(pollCtx)) {
            currentPhase = previousPhasePointer;
        }
        if (previousPhasePointer != null && currentPhase != null && previousPhasePointer !== currentPhase) {
            stderr(`canon watch: phase ${formatPhasePointerTransition(previousPhasePointer, currentPhase)}\n`);
        }
        previousPhasePointer = currentPhase;
    };

    if (initialAttach.kind === 'launch_window') {
        const remaining = remainingTimeoutMs();
        if (remaining != null && remaining <= 0) return reportTimeout();
        const launchTimeout = remaining == null ? waitTimeoutMs : Math.min(waitTimeoutMs, remaining);
        const launchTimeoutCappedByWatch = remaining != null && remaining < waitTimeoutMs;
        const waitResult = waitForHeartbeat(ctx.taskDir, {
            timeoutMs: launchTimeout,
            pollIntervalMs: STOP_WAIT_POLL_INTERVAL_MS,
            readImpl: deps.readHeartbeatImpl,
            sleepImpl: sleep,
            nowImpl: now,
            isStillAlive: () => ctx.canonPid == null ? false : probePidAlive(ctx.canonPid, deps.probeAliveImpl),
            onWaitStart: () => {
                stderr(`canon watch: waiting for orchestrator's first heartbeat tick (up to ${Math.floor(launchTimeout / 1000)}s)...\n`);
            },
        });

        if (waitResult.kind === 'found') {
            ctx = gatherContext(taskId, deps);
            const postWaitAttach = classifyAttach(ctx, taskId, isOrchestratorAlive, now());
            if (postWaitAttach.kind !== 'live') {
                return reportInitialFailure(postWaitAttach);
            }
            previousPhasePointer = displayedPhasePointer(ctx);
        } else if (waitResult.kind === 'pid-died') {
            emitSummary(stdout, { state: 'in_progress', reason: 'death' });
            return exit(4);
        } else if (waitResult.kind === 'timeout') {
            if (launchTimeoutCappedByWatch) {
                return reportTimeout();
            }
            emitSummary(stdout, { state: 'launch_window', reason: 'launch_window_timeout' });
            return exit(2);
        } else {
            stderr(`canon watch: cannot read ${ctx.heartbeatFile}: ${waitResult.reason}\n`);
            emitSummary(stdout, { state: 'unknown', reason: 'read_error' });
            return exit(2);
        }
    }

    stderr(`canon watch: attached to task '${taskId}' (pid=${ctx.resolvedPid ?? 'unknown'})\n`);
    if (parsed.follow) tailRunLog(ctx, taskId, { stderr }, tailState);

    for (;;) {
        if (withinTimeout()) return reportTimeout();
        sleep(pollIntervalMs);
        if (withinTimeout()) return reportTimeout();

        ctx = gatherContext(taskId, deps);
        if (parsed.untilPhase && phaseSettled(ctx, parsed.untilPhase, isOrchestratorAlive, now())) {
            emitSummary(stdout, {
                state: parsed.untilPhase,
                reason: 'until',
                phase: parsed.untilPhase,
                pid: ctx.resolvedPid ?? undefined,
            });
            return exit(0);
        }

        const liveResult = classifyAttach(ctx, taskId, isOrchestratorAlive, now());
        if (liveResult.kind === 'live') {
            reportPhasePointer(ctx);
            // A heartbeat younger than one heartbeat interval is business as
            // usual — worth a dot, not a line. Older means the orchestrator
            // missed a tick (classifyAttach caps this at the 2×-interval
            // stale bound), which deserves an explicit age notice.
            const heartbeatAgeMs = now() - (ctx.heartbeatResult.kind === 'found' ? ctx.heartbeatResult.record.last_update_ms : now());
            if (heartbeatAgeMs > HEARTBEAT_INTERVAL_MS) {
                stderr(`canon watch: heartbeat ${formatAge(heartbeatAgeMs)} ago\n`);
            } else {
                tick();
            }
            if (parsed.follow) tailRunLog(ctx, taskId, { stderr }, tailState);
            continue;
        }

        if (liveResult.kind === 'read_error') {
            stderr(`canon watch: cannot read ${liveResult.file}: ${liveResult.reason}\n`);
            emitSummary(stdout, { state: 'unknown', reason: 'read_error' });
            return exit(2);
        }

        if (liveResult.kind === 'ambiguous_pid') {
            stderr(
                `canon watch: .canon-pid (${liveResult.canonPid}) and heartbeat pid (${liveResult.heartbeatPid}) are both alive but disagree. ` +
                `Refusing to attach.\n`,
            );
            emitSummary(stdout, { state: liveResult.state, reason: 'ambiguous_pid' });
            return exit(2);
        }

        if (orchestratorStillProgressing(ctx, isOrchestratorAlive, now())) {
            // Heartbeat went stale inside a between-phase synchronous window, but the
            // orchestrator pid is alive and the run hasn't hit a stop. Surface any phase
            // advance and keep blocking — don't fall through to the idle/grace path that
            // would misclassify this live run as step_done.
            reportPhasePointer(ctx);
            // The heartbeat is stale here by definition (classifyAttach
            // rejected it) — surface the age instead of a quiet dot so the
            // operator can see the run is in an escalated window.
            if (ctx.heartbeatResult.kind === 'found') {
                stderr(`canon watch: heartbeat ${formatAge(now() - ctx.heartbeatResult.record.last_update_ms)} ago\n`);
            } else {
                tick();
            }
            if (parsed.follow) tailRunLog(ctx, taskId, { stderr }, tailState);
            continue;
        }

        stderr('canon watch: orchestrator appears idle; re-reading status.json after a grace interval...\n');
        sleep(pollIntervalMs);
        if (withinTimeout()) return reportTimeout();

        const freshCtx = gatherContext(taskId, deps);
        if (parsed.untilPhase && phaseSettled(freshCtx, parsed.untilPhase, isOrchestratorAlive, now())) {
            emitSummary(stdout, {
                state: parsed.untilPhase,
                reason: 'until',
                phase: parsed.untilPhase,
                pid: freshCtx.resolvedPid ?? undefined,
            });
            return exit(0);
        }

        const idleResult = classifyIdle(freshCtx, taskId, isOrchestratorAlive, now());
        emitSummary(stdout, summarizeIdle(idleResult));
        switch (idleResult.kind) {
            case 'checkpoint':
            case 'complete':
            case 'step_done':
                return exit(0);
            case 'auto_block':
                return exit(3);
            case 'death':
                return exit(4);
            case 'ambiguous_pid':
                stderr(
                    `canon watch: .canon-pid (${idleResult.canonPid}) and heartbeat pid (${idleResult.heartbeatPid}) are both alive but disagree. ` +
                    `Refusing to attach.\n`,
                );
                return exit(2);
            case 'read_error':
                stderr(`canon watch: cannot read ${idleResult.file}: ${idleResult.reason}\n`);
                return exit(2);
        }
    }
}
