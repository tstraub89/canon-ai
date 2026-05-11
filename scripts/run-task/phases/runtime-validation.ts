import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { WriteStream } from 'node:fs';

import { info, warn } from '../cli.js';
import { REPO_ROOT } from '../env.js';
import { gitSafeAtRaw, parsePorcelainEntries, type PorcelainEntry } from '../git.js';
import { getMaxReviewLoops } from '../policy.js';
import { autoBlockPhase, readStatus, resolveTaskCwd, writeStatus } from '../state.js';
import { parseHandoffFiles } from '../validation.js';
import type { PhaseRunResult, PipelineState } from '../types.js';
import { RUNTIME_CHECKS, type RuntimeCheck } from '../../pipeline-policy.js';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const KILL_GRACE_MS = 3000;
const HANDOFF_HEAD_BYTES = 512;
const PROMPT_HEAD_BYTES = 2048;

type CheckResultKind = 'Pass' | 'Fail' | 'Timeout';

type CheckRunResult = {
    check: RuntimeCheck;
    result: CheckResultKind;
    elapsedMs: number;
    exitCode: number | null;
    stderrHead512: string;
    stderrTruncatedForHandoff: boolean;
    artifactRelDir: string | null;
};

function setRuntimeValidationPhase(
    taskId: string,
    status: 'pending' | 'in_progress' | 'done',
    verdict?: 'approved' | 'changes_requested',
): void {
    const taskStatus = readStatus(taskId);
    taskStatus.phases.runtime_validation = taskStatus.phases.runtime_validation ?? {
        status: 'pending',
        agent: 'orchestrator',
        verdict: '',
        iterations: 0,
        iterations_current_loop: 0,
        iterations_total: 0,
        changes_requested_total: 0,
        auto_block_count: 0,
    };
    const entry = taskStatus.phases.runtime_validation;
    entry.status = status;
    entry.agent = 'orchestrator';
    entry.iterations_current_loop = entry.iterations_current_loop ?? entry.iterations ?? 0;
    entry.iterations_total = entry.iterations_total ?? entry.iterations ?? 0;
    entry.changes_requested_total = entry.changes_requested_total ?? 0;
    entry.auto_block_count = entry.auto_block_count ?? 0;
    if (verdict) {
        entry.verdict = verdict;
        if (verdict === 'changes_requested') {
            entry.iterations_current_loop += 1;
            entry.iterations_total += 1;
            entry.changes_requested_total += 1;
        } else if (verdict === 'approved') {
            entry.iterations_total += 1;
            entry.iterations_current_loop = 0;
        }
    }
    entry.iterations = entry.iterations_current_loop;
    taskStatus.updated = new Date().toISOString().slice(0, 10);
    writeStatus(taskId, taskStatus);
}

class HeadBuffer {
    private readonly chunks: Buffer[] = [];
    private length = 0;
    private totalLength = 0;

    constructor(private readonly maxBytes: number) {}

    append(chunk: Buffer): void {
        this.totalLength += chunk.length;
        if (this.length >= this.maxBytes) return;
        const remaining = this.maxBytes - this.length;
        const slice = chunk.subarray(0, remaining);
        this.chunks.push(slice);
        this.length += slice.length;
    }

    text(maxBytes = this.maxBytes): string {
        return Buffer.concat(this.chunks).subarray(0, maxBytes).toString('utf8');
    }

    exceeds(bytes: number): boolean {
        return this.totalLength > bytes;
    }
}

export function sanitizeRuntimeCheckName(name: string): string {
    const sanitized = name.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');
    return sanitized || 'runtime-check';
}

function resolveTimeoutMs(check: RuntimeCheck): number {
    if (typeof check.timeoutMs === 'number' && Number.isFinite(check.timeoutMs) && check.timeoutMs > 0) {
        return check.timeoutMs;
    }
    const envTimeout = Number.parseInt(process.env.ORCHESTRATOR_CHECK_TIMEOUT_MS ?? '', 10);
    return Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT_MS;
}

function heartbeatIntervalMs(): number {
    const configured = Number.parseInt(process.env.ORCHESTRATOR_CHECK_HEARTBEAT_MS ?? '', 10);
    return Number.isFinite(configured) && configured > 0 ? configured : 30_000;
}

function formatElapsed(ms: number): string {
    return `${(ms / 1000).toFixed(1)}s`;
}

function escapeTableCell(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\|/g, '\\|')
        .replace(/\r?\n/g, '\\n')
        .trim();
}

function snapshotDirty(cwd: string): Map<string, PorcelainEntry> {
    const result = gitSafeAtRaw(cwd, 'status', '--porcelain=v1', '-uall');
    if (!result.ok) {
        throw new Error(`git status failed in ${cwd}: ${result.stderr || 'unknown error'}`);
    }
    const entries = new Map<string, PorcelainEntry>();
    for (const entry of parsePorcelainEntries(result.stdout)) {
        for (const relPath of entry.paths) entries.set(relPath, entry);
    }
    return entries;
}

function computeDelta(postDirty: Map<string, PorcelainEntry>, preDirty: Map<string, PorcelainEntry>): string[] {
    return [...postDirty.keys()].filter(relPath => !preDirty.has(relPath));
}

function copyPathIntoArtifactDir(sourcePath: string, destPath: string): void {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
        fs.cpSync(sourcePath, destPath, { recursive: true, force: true });
    } else {
        fs.copyFileSync(sourcePath, destPath);
    }
}

function safeRelativePath(cwd: string, candidate: string): string | null {
    const resolved = path.resolve(cwd, candidate);
    const rel = path.relative(cwd, resolved);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return rel;
}

function isProtectedDeltaPath(relPath: string): boolean {
    return relPath === 'tasks' ||
        relPath.startsWith('tasks/') ||
        relPath === 'runtime-check-output' ||
        relPath.startsWith('runtime-check-output/');
}

function cleanupDelta(cwd: string, delta: readonly string[], postDirty: Map<string, PorcelainEntry>): void {
    for (const relPath of delta) {
        if (isProtectedDeltaPath(relPath)) continue;
        const entry = postDirty.get(relPath);
        if (entry?.indexStatus === '?' && entry.worktreeStatus === '?') {
            fs.rmSync(path.join(cwd, relPath), { recursive: true, force: true });
            continue;
        }
        const result = gitSafeAtRaw(cwd, 'checkout', '--', relPath);
        if (!result.ok) {
            warn(`Runtime validation cleanup could not restore ${relPath}: ${result.stderr || 'unknown error'}`);
        }
    }
}

function removeEmptyArtifactParents(artifactAbsDir: string, taskId: string): void {
    const stopAt = path.join(resolveTaskCwd(taskId), 'tasks', taskId);
    let current = artifactAbsDir;
    while (current.startsWith(stopAt) && current !== stopAt) {
        try {
            fs.rmdirSync(current);
        } catch {
            return;
        }
        current = path.dirname(current);
    }
}

function closeStream(stream: WriteStream): Promise<void> {
    return new Promise((resolve, reject) => {
        stream.once('error', reject);
        stream.end(() => resolve());
    });
}

async function runCheck(taskId: string, check: RuntimeCheck, artifactIteration: number): Promise<CheckRunResult> {
    const taskCwd = resolveTaskCwd(taskId);
    const cwd = check.cwd === 'repo_root' ? REPO_ROOT : taskCwd;
    const timeoutMs = resolveTimeoutMs(check);
    const safeName = sanitizeRuntimeCheckName(check.name);
    const artifactRelDir = `tasks/${taskId}/runtime-check-output/${safeName}/iter-${artifactIteration}/`;
    const artifactAbsDir = path.join(taskCwd, artifactRelDir);

    info(`Running runtime check "${check.name}" for ${taskId}...`);
    const preDirty = snapshotDirty(cwd);
    fs.mkdirSync(artifactAbsDir, { recursive: true });

    const stdoutPath = path.join(artifactAbsDir, 'stdout.log');
    const stderrPath = path.join(artifactAbsDir, 'stderr.log');
    const stdoutStream = fs.createWriteStream(stdoutPath);
    const stderrStream = fs.createWriteStream(stderrPath);
    const stdoutHead = new HeadBuffer(PROMPT_HEAD_BYTES);
    const stderrHead = new HeadBuffer(PROMPT_HEAD_BYTES);
    const startedAt = Date.now();
    let lastOutputAt = startedAt;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | null = null;
    let spawnError: Error | null = null;

    // `detached: true` puts the child shell in its own process group. On
    // timeout we signal the entire group (`process.kill(-pid, sig)`) so that
    // grandchildren spawned by the shell (e.g. `npm run test:e2e` → playwright
    // → browser drivers) are also terminated. Without this, killing only the
    // shell leaves grandchildren alive holding stdio pipes open, and the
    // orchestrator hangs waiting for `close` instead of enforcing `timeoutMs`.
    const child = spawn(check.command, {
        shell: true,
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
    });

    const appendDiagnostic = (message: string): void => {
        process.stderr.write(`${message}\n`);
        lastOutputAt = Date.now();
    };

    child.stdout?.on('data', (chunk: Buffer) => {
        stdoutStream.write(chunk);
        stdoutHead.append(chunk);
        process.stdout.write(chunk);
        lastOutputAt = Date.now();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
        stderrStream.write(chunk);
        stderrHead.append(chunk);
        process.stderr.write(chunk);
        lastOutputAt = Date.now();
    });
    child.once('error', (error) => {
        spawnError = error;
        appendDiagnostic(`[${check.name} spawn error: ${error.message}]`);
    });

    const heartbeatMs = heartbeatIntervalMs();
    const heartbeat = setInterval(() => {
        const now = Date.now();
        if (lastOutputAt > now - heartbeatMs) return;
        const elapsedSec = Math.floor((now - startedAt) / 1000);
        const remainingSec = Math.max(0, Math.ceil((timeoutMs - (now - startedAt)) / 1000));
        process.stderr.write(`[${check.name} still running - ${elapsedSec}s elapsed; ${remainingSec}s until timeout]\n`);
        lastOutputAt = now;
    }, heartbeatMs);

    // Kill the entire process group (negative pid). See `detached: true`
    // comment on spawn above. Fall back to single-process kill if for some
    // reason the child has no pid (spawn failed before pid was assigned).
    const killTree = (signal: NodeJS.Signals): void => {
        if (typeof child.pid === 'number') {
            try { process.kill(-child.pid, signal); return; } catch {
                // ESRCH means the group is already gone; ignore.
                // EPERM should not happen for our own process group; fall through to single-child kill.
            }
        }
        child.kill(signal);
    };

    const timeout = setTimeout(() => {
        timedOut = true;
        killTree('SIGTERM');
        killTimer = setTimeout(() => {
            if (child.exitCode === null) killTree('SIGKILL');
        }, KILL_GRACE_MS);
    }, timeoutMs);

    const closeResult = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.once('close', (code, signal) => resolve({ code, signal }));
    });

    clearTimeout(timeout);
    clearInterval(heartbeat);
    if (killTimer) clearTimeout(killTimer);

    const actualElapsedMs = Date.now() - startedAt;
    const elapsedMs = timedOut ? timeoutMs : actualElapsedMs;
    const result: CheckResultKind = timedOut
        ? 'Timeout'
        : spawnError || closeResult.code !== 0
            ? 'Fail'
            : 'Pass';

    if (result === 'Timeout') {
        appendDiagnostic(`[${check.name} TIMED OUT after ${formatElapsed(elapsedMs)}]`);
    } else {
        const exitDescription = closeResult.code === null ? `signal ${closeResult.signal ?? 'unknown'}` : `exit code ${closeResult.code}`;
        appendDiagnostic(`[${check.name} finished in ${formatElapsed(elapsedMs)} with ${exitDescription}]`);
    }

    const postDirty = snapshotDirty(cwd);
    const delta = computeDelta(postDirty, preDirty);

    if (result !== 'Pass') {
        if (check.artifactPaths && check.artifactPaths.length > 0) {
            for (const artifactPath of check.artifactPaths) {
                const rel = safeRelativePath(cwd, artifactPath);
                if (!rel) {
                    appendDiagnostic(`[${check.name} artifactPath '${artifactPath}' escapes cwd - skipping]`);
                    continue;
                }
                const source = path.join(cwd, rel);
                if (!fs.existsSync(source)) {
                    appendDiagnostic(`[${check.name} artifactPath '${artifactPath}' not found - skipping]`);
                    continue;
                }
                copyPathIntoArtifactDir(source, path.join(artifactAbsDir, rel));
            }
        } else {
            for (const relPath of delta) {
                const source = path.join(cwd, relPath);
                if (fs.existsSync(source)) {
                    copyPathIntoArtifactDir(source, path.join(artifactAbsDir, relPath));
                }
            }
        }
    }

    cleanupDelta(cwd, delta, postDirty);
    await Promise.all([closeStream(stdoutStream), closeStream(stderrStream)]);

    if (result === 'Pass') {
        fs.rmSync(artifactAbsDir, { recursive: true, force: true });
        removeEmptyArtifactParents(path.dirname(artifactAbsDir), taskId);
    }

    return {
        check,
        result,
        elapsedMs,
        exitCode: closeResult.code,
        stderrHead512: stderrHead.text(HANDOFF_HEAD_BYTES),
        stderrTruncatedForHandoff: stderrHead.exceeds(HANDOFF_HEAD_BYTES),
        artifactRelDir: result === 'Pass' ? null : artifactRelDir,
    };
}

function resultNotes(result: CheckRunResult): string {
    const parts: string[] = [];
    if (result.result === 'Timeout') {
        parts.push(`timeout after ${formatElapsed(result.elapsedMs)}`);
    } else {
        parts.push(`exit code ${result.exitCode ?? 'unknown'}`);
    }
    if (result.stderrHead512.trim()) {
        const excerpt = result.stderrTruncatedForHandoff
            ? `${result.stderrHead512}...`
            : result.stderrHead512;
        parts.push(escapeTableCell(excerpt));
    }
    if (result.artifactRelDir) parts.push(`artifacts: ${result.artifactRelDir}`);
    return parts.join('; ');
}

function renderRuntimeResultsTable(results: readonly CheckRunResult[]): string {
    const rows = results.map(result =>
        `| \`${escapeTableCell(result.check.name)}\` | ${result.result} | ${formatElapsed(result.elapsedMs)} | ${resultNotes(result)} |`
    );
    return [
        '| Check | Result | Elapsed | Notes |',
        '|---|---|---|---|',
        ...rows,
    ].join('\n');
}

function baselineRuntimeSection(results: readonly CheckRunResult[]): string {
    return [
        '## Runtime Validation Outcomes',
        '',
        "> Authored by the orchestrator after Codex's implement phase. Codex did not run these checks.",
        '',
        renderRuntimeResultsTable(results),
        '',
    ].join('\n');
}

function insertBaselineRuntimeSection(handoff: string, results: readonly CheckRunResult[]): string {
    const section = baselineRuntimeSection(results);
    const readyHeading = '\n## Ready for Review';
    const readyIndex = handoff.indexOf(readyHeading);
    if (readyIndex !== -1) {
        return `${handoff.slice(0, readyIndex).replace(/\n*$/, '\n\n')}${section}${handoff.slice(readyIndex)}`;
    }
    return `${handoff.replace(/\n*$/, '\n\n')}${section}`;
}

function appendIterationRuntimeSection(handoff: string, results: readonly CheckRunResult[]): string {
    const section = [
        '### Re-run runtime validation',
        '',
        renderRuntimeResultsTable(results),
        '',
    ].join('\n');
    const iterationMatches = [...handoff.matchAll(/^## Iteration\b/gm)];
    const lastIteration = iterationMatches[iterationMatches.length - 1];
    if (lastIteration?.index === undefined) {
        return `${handoff.replace(/\n*$/, '\n\n')}${section}`;
    }
    const start = lastIteration.index;
    const nextH2 = handoff.slice(start + 1).search(/\n## /);
    if (nextH2 === -1) {
        return `${handoff.replace(/\n*$/, '\n\n')}${section}`;
    }
    const insertAt = start + 1 + nextH2;
    return `${handoff.slice(0, insertAt).replace(/\n*$/, '\n\n')}${section}${handoff.slice(insertAt)}`;
}

function writeRuntimeResults(taskId: string, iteration: number, results: readonly CheckRunResult[]): void {
    const handoffPath = path.join(resolveTaskCwd(taskId), 'tasks', taskId, 'handoff.md');
    const content = fs.readFileSync(handoffPath, 'utf8');
    const updated = iteration === 0
        ? insertBaselineRuntimeSection(content, results)
        : appendIterationRuntimeSection(content, results);
    fs.writeFileSync(handoffPath, updated, 'utf8');
}

export async function runRuntimeValidationPhase(
    taskIds: string[],
    state: PipelineState,
    checks?: readonly RuntimeCheck[],
): Promise<PhaseRunResult> {
    const { tasks } = state;
    const maxIter = tasks.reduce((max, task) => Math.max(max, task.runtimeIterations_current_loop), 0);
    const runtimeLoopCap = getMaxReviewLoops(tasks);
    if (maxIter >= runtimeLoopCap) {
        const reason =
            `Runtime validation hit ${maxIter} changes_requested iterations in a row ` +
            `(limit: ${runtimeLoopCap}). Pipeline auto-blocked. Read ` +
            `tasks/<id>/handoff.md and tasks/<id>/runtime-check-output/ for the failing ` +
            `runtime checks. To resume after fixing: set phases.runtime_validation.status = "pending" ` +
            `and phases.runtime_validation.iterations_current_loop = 0 in status.json, then re-run the pipeline.`;
        warn(reason);
        autoBlockPhase(taskIds, 'runtime_validation', maxIter, reason);
        process.exit(2);
    }

    const registry = checks ?? RUNTIME_CHECKS;
    const selectedByTask = new Map<string, RuntimeCheck[]>();
    for (const task of tasks) {
        const affectedFiles = parseHandoffFiles(task.taskId);
        const selected = registry.filter(check => check.when?.(task.status, affectedFiles) ?? true);
        selectedByTask.set(task.taskId, selected);
    }

    const hasAnyChecks = [...selectedByTask.values()].some(selected => selected.length > 0);
    if (!hasAnyChecks) {
        for (const taskId of taskIds) {
            setRuntimeValidationPhase(taskId, 'done', 'approved');
        }
        return { agent: 'claude', sessionId: null, exitCode: 0 };
    }

    info(`Phase: runtime_validation (orchestrator${state.isBundle ? ' bundle' : ''}, iteration ${maxIter + 1})`);
    for (const taskId of taskIds) {
        setRuntimeValidationPhase(taskId, 'in_progress');
    }

    let anyFailed = false;
    for (const task of tasks) {
        const selected = selectedByTask.get(task.taskId) ?? [];
        if (selected.length === 0) {
            setRuntimeValidationPhase(task.taskId, 'done', 'approved');
            continue;
        }

        const currentStatus = readStatus(task.taskId);
        const priorIterations = currentStatus.phases.runtime_validation?.iterations_total
            ?? currentStatus.phases.runtime_validation?.iterations
            ?? 0;
        const artifactIteration = currentStatus.phases.runtime_validation?.iterations_current_loop
            ?? currentStatus.phases.runtime_validation?.iterations
            ?? 0;
        const artifactLoopIteration = artifactIteration + 1;
        const results: CheckRunResult[] = [];
        for (const check of selected) {
            const result = await runCheck(task.taskId, check, artifactLoopIteration);
            results.push(result);
            if (result.result !== 'Pass') anyFailed = true;
        }
        writeRuntimeResults(task.taskId, priorIterations, results);
        const verdict = results.some(result => result.result !== 'Pass') ? 'changes_requested' : 'approved';
        setRuntimeValidationPhase(task.taskId, 'done', verdict);
    }

    return { agent: 'claude', sessionId: null, exitCode: anyFailed ? 1 : 0 };
}
