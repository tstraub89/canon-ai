import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';

import { CODEX_HEADLESS } from '../src/orchestrator/prompts/helpers.js';
import { runCodex, runColdCodexReview } from '../src/orchestrator/agents/codex.js';
import { recordMetric } from '../src/orchestrator/metrics.js';
import { findUnjudgedFullSendFilesFromData, runCodeReviewPhase, type CodeReviewPhaseDeps } from '../src/orchestrator/phases/code-review.js';
import { writeColdCodexArchive, findColdCodexArchiveForRound, hasMalformedColdCodexArchive } from '../src/orchestrator/review-archive.js';
import { getPathsInRange, getDeltaLineStats, resolveCommit, isAncestorCommit, getScopedDiffInRange } from '../src/orchestrator/git.js';
import { evaluateCodeReviewLoop, evaluateSpecReviewLoop } from '../src/orchestrator/review-loop.js';
import { readStatus, writeStatusToFile } from '../src/orchestrator/state.js';
import type { PipelineState, StatusJson, TaskContext } from '../src/orchestrator/types.js';

async function withTempTasksAsync<T>(fn: (tasksRoot: string, activeCwd: string) => Promise<T>): Promise<T> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-task-code-review-'));
    const tasksRoot = path.join(root, 'tasks');
    const activeCwd = path.join(root, 'worktree');
    const previousTasks = process.env.CANON_TASKS_DIR_OVERRIDE;
    process.env.CANON_TASKS_DIR_OVERRIDE = tasksRoot;
    try {
        fs.mkdirSync(tasksRoot, { recursive: true });
        fs.mkdirSync(activeCwd, { recursive: true });
        return await fn(tasksRoot, activeCwd);
    } finally {
        if (previousTasks === undefined) delete process.env.CANON_TASKS_DIR_OVERRIDE;
        else process.env.CANON_TASKS_DIR_OVERRIDE = previousTasks;
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function makeCodeReviewStatus(taskId: string): StatusJson {
    return {
        id: taskId,
        title: taskId,
        status: 'code_review',
        created: '2026-06-26',
        updated: '2026-06-26',
        branch: '',
        base_branch: 'main',
        task_size: 'M',
        delicate: false,
        human_spec_gate: false,
        full_send: false,
        worktree: false,
        phases: {
            spec: { status: 'done', agent: 'claude' },
            spec_review: { status: 'done', agent: 'codex', verdict: 'approved', iterations: 0 },
            plan: { status: 'done', agent: 'claude' },
            implement: { status: 'done', agent: 'codex' },
            code_review: {
                status: 'pending',
                agent: 'claude',
                verdict: '',
                iterations: 0,
                iterations_current_loop: 0,
                iterations_total: 0,
                changes_requested_total: 0,
                preflight_rejections_current_loop: 0,
                preflight_rejections_total: 0,
                auto_block_count: 0,
            },
            qa: { status: 'pending', agent: 'claude' },
            human_review: { status: 'pending', agent: 'human' },
        },
        escalations: [],
        sessions: {},
    };
}

function writeTask(tasksRoot: string, taskId: string): void {
    const taskDir = path.join(tasksRoot, taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    writeStatusToFile(path.join(taskDir, 'status.json'), makeCodeReviewStatus(taskId));
    fs.writeFileSync(path.join(taskDir, 'spec.md'), [
        '# Spec',
        '',
        '## Acceptance Criteria',
        '',
        '- [ ] AC-1: Fixture behavior',
        '',
        '## Validation Required',
        '',
        '- [x] `npm test`',
        '',
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(taskDir, 'handoff.md'), [
        `# Implementation Handoff: ${taskId}`,
        '',
        '## Changes',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| `src/foo.ts` | fixture change |',
        '',
        '## AC Coverage',
        '',
        '| AC | Status | Evidence |',
        '|---|---|---|',
        '| AC-1: Fixture behavior | Met | fixture evidence |',
        '',
        '## Validation Outcomes',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| `npm test` | Pass | fixture |',
        '',
    ].join('\n'), 'utf8');
}

function taskContext(taskId: string): TaskContext {
    const status = readStatus(taskId);
    const codeReview = status.phases.code_review;
    return {
        taskId,
        title: status.title ?? taskId,
        specReviewVerdict: 'approved',
        iterations: codeReview?.iterations ?? 0,
        iterations_current_loop: codeReview?.iterations_current_loop ?? 0,
        iterations_total: codeReview?.iterations_total ?? 0,
        rerouteCount: codeReview?.reroute_count ?? 0,
        status,
    };
}

function makeState(taskIds: readonly string[]): PipelineState {
    return {
        tasks: taskIds.map(taskContext),
        tier: 'full',
        isBundle: taskIds.length > 1,
    };
}

function reviewLoopContext(options: {
    taskId?: string;
    specCurrent?: number;
    codeCurrent?: number;
    preflightCurrent?: number;
    specTotal?: number;
    codeTotal?: number;
    specStatus?: 'pending' | 'done';
    implementStatus?: 'pending' | 'done';
} = {}): TaskContext {
    const taskId = options.taskId ?? 'task-a';
    const status = makeCodeReviewStatus(taskId);
    const specCurrent = options.specCurrent ?? 0;
    const codeCurrent = options.codeCurrent ?? 0;
    const preflightCurrent = options.preflightCurrent ?? 0;
    status.phases.spec = {
        status: options.specStatus ?? 'pending',
        agent: 'claude',
    };
    status.phases.spec_review = {
        status: 'pending',
        agent: 'codex',
        verdict: '',
        iterations: specCurrent,
        iterations_current_loop: specCurrent,
        iterations_total: options.specTotal ?? specCurrent,
    };
    status.phases.implement = {
        status: options.implementStatus ?? 'pending',
        agent: 'codex',
    };
    status.phases.code_review = {
        ...status.phases.code_review!,
        iterations: codeCurrent,
        iterations_current_loop: codeCurrent,
        iterations_total: options.codeTotal ?? codeCurrent,
        preflight_rejections_current_loop: preflightCurrent,
    };
    return {
        taskId,
        title: taskId,
        specReviewVerdict: '',
        iterations: codeCurrent,
        iterations_current_loop: codeCurrent,
        iterations_total: options.codeTotal ?? codeCurrent,
        rerouteCount: 0,
        status,
    };
}

function resumePhase(reason: string): string | undefined {
    return reason.match(/Resuming after raising the cap runs `([a-z_]+)`/)?.[1];
}

function writeFakeCodexScript(dir: string, body: string): string {
    const scriptPath = path.join(dir, 'fake-codex.mjs');
    fs.writeFileSync(scriptPath, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
    return scriptPath;
}

async function withMetricsFileAsync<T>(dir: string, fn: (metricsFile: string) => Promise<T>): Promise<T> {
    const metricsFile = path.join(dir, 'pipeline-invocations.md');
    const previous = process.env.CANON_METRICS_FILE_OVERRIDE;
    process.env.CANON_METRICS_FILE_OVERRIDE = metricsFile;
    try {
        return await fn(metricsFile);
    } finally {
        if (previous === undefined) delete process.env.CANON_METRICS_FILE_OVERRIDE;
        else process.env.CANON_METRICS_FILE_OVERRIDE = previous;
    }
}

function readMetricRows(metricsFile: string): string[][] {
    return fs.readFileSync(metricsFile, 'utf8')
        .split('\n')
        .filter(line => /^\| 20\d\d-/.test(line))
        .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
}

async function captureDie(fn: () => Promise<unknown>): Promise<string> {
    const originalExit: typeof process.exit = process.exit.bind(process);
    const originalError = console.error;
    const errors: string[] = [];
    process.exit = (code?: string | number | null): never => {
        throw Object.assign(new Error('process.exit'), { code });
    };
    console.error = (...args: unknown[]): void => { errors.push(args.map(String).join(' ')); };
    try {
        await assert.rejects(fn, (error: unknown) => isProcessExitError(error, 1));
    } finally {
        process.exit = originalExit;
        console.error = originalError;
    }
    return errors.join('\n');
}

function assertInvalidEffortMessage(message: string): void {
    assert.match(message, /ultra/);
    assert.match(message, /none\|minimal\|low\|medium\|high\|xhigh/);
    // The actionable negative: editing the user's own Codex config cannot fix
    // this, because canon's `-c model_reasoning_effort=` supersedes it.
    assert.match(message, /per-invocation override supersedes it/);
    assert.match(message, /~\/\.codex\/config\.toml/);
    // Effort comes only from canon's fixed phase/size matrix — no env var or
    // adopter config feeds it — so the message must not send the reader to a
    // canon-ai source path they don't have when installed from npm.
    assert.doesNotMatch(message, /\bsrc\//);
}

function makeDeps(options: {
    activeCwd: string;
    events: string[];
    coldSuccess?: boolean;
    findings?: string;
    onClaude?: (prompt: string) => void;
}): CodeReviewPhaseDeps {
    return {
        verifyBranch: () => { options.events.push('verifyBranch'); },
        getBaseBranch: () => 'main',
        getActiveCwd: () => options.activeCwd,
        getAffectedFiles: () => [],
        verifyHandoffAgainstDiff: () => [],
        getScopedDiff: () => ({ diff: 'diff --git a/src/foo.ts b/src/foo.ts\n', truncated: false }),
        getScopedDiffInRange: () => ({ diff: 'delta diff\n', truncated: false }),
        getPathsInRange: () => ['src/foo.ts'],
        getDeltaLineStats: () => [{ path: 'src/foo.ts', added: 1, deleted: 0 }],
        resolveCommit: ref => ref === 'HEAD' ? 'a'.repeat(40) : ref,
        isAncestorCommit: () => true,
        getEffectiveSize: () => 'M',
        findColdCodexArchiveForRound: () => null,
        hasMalformedColdCodexArchive: () => false,
        writeColdCodexArchive,
        getClaudeConfig: () => ({ model: 'sonnet', effort: 'high', budget: '20.00' }),
        getMaxReviewLoops: () => 3,
        getCodexConfig: () => ({ model: 'mini-from-policy', effort: 'high' }),
        runColdCodexReview: (_baseBranch, model, effort, cwd, metricsContext) => {
            options.events.push(`cold:${model}:${effort}:${cwd}:${metricsContext?.taskId}:${metricsContext?.iteration}`);
            return Promise.resolve({
                success: options.coldSuccess ?? true,
                findings: options.findings ?? '[P2] src/foo.ts:10 - null deref',
                durationMs: 1,
            });
        },
        runClaude: (prompt: string) => {
            options.events.push('foreman');
            options.onClaude?.(prompt);
            return Promise.resolve({
                exitCode: 0,
                signal: null,
                spawnError: null,
                stalled: false,
                capturedStdout: '',
                capturedStderr: '',
                sessionId: 'claude-session',
                processedText: '',
            });
        },
    };
}

function gitAt(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function initReviewRepo(cwd: string): string {
    gitAt(cwd, 'init', '-b', 'main');
    gitAt(cwd, 'config', 'user.email', 'test@example.com');
    gitAt(cwd, 'config', 'user.name', 'Test');
    fs.mkdirSync(path.join(cwd, 'src'));
    fs.writeFileSync(path.join(cwd, 'src/a.ts'), 'first\n');
    fs.writeFileSync(path.join(cwd, 'src/b.ts'), 'second\n');
    gitAt(cwd, 'add', '.');
    gitAt(cwd, 'commit', '-m', 'base');
    gitAt(cwd, 'branch', 'feature');
    gitAt(cwd, 'switch', 'feature');
    fs.appendFileSync(path.join(cwd, 'src/a.ts'), 'task\n');
    gitAt(cwd, 'add', '.');
    gitAt(cwd, 'commit', '-m', 'task');
    return gitAt(cwd, 'rev-parse', 'HEAD');
}

function runCheckAndRouteInFixture(tasksRoot: string, activeCwd: string, taskIds: string | readonly string[]): { status: number | null; output: string } {
    const ids = typeof taskIds === 'string' ? [taskIds] : [...taskIds];
    const script = `import { checkAndRoute } from ${JSON.stringify(path.join(process.cwd(), 'src/orchestrator/main.ts'))}; await checkAndRoute('code_review', ${JSON.stringify(ids)});`;
    const result = spawnSync(process.execPath, [
        '--import', path.join(process.cwd(), 'tests/md-loader-register.mjs'),
        '--import', import.meta.resolve('tsx'), '--input-type=module', '-e', script,
    ], {
        cwd: activeCwd,
        env: { ...process.env, CANON_TASKS_DIR_OVERRIDE: tasksRoot },
        encoding: 'utf8',
    });
    return { status: result.status, output: String(result.stdout) + String(result.stderr) };
}

function realGitDeps(activeCwd: string, events: string[], onClaude?: (prompt: string) => void): CodeReviewPhaseDeps {
    const deps = makeDeps({ activeCwd, events, onClaude });
    deps.getPathsInRange = getPathsInRange;
    deps.getDeltaLineStats = getDeltaLineStats;
    deps.resolveCommit = resolveCommit;
    deps.isAncestorCommit = isAncestorCommit;
    deps.getScopedDiffInRange = getScopedDiffInRange;
    deps.findColdCodexArchiveForRound = findColdCodexArchiveForRound;
    deps.hasMalformedColdCodexArchive = hasMalformedColdCodexArchive;
    return deps;
}

function writeRoundTwoTask(tasksRoot: string, taskId: string): void {
    writeTask(tasksRoot, taskId);
    const dir = path.join(tasksRoot, taskId);
    fs.writeFileSync(path.join(dir, 'review.md'), '# Review\n\n## Stage 1\n\nfilled\n');
    const status = readStatus(taskId);
    status.phases.code_review!.iterations = 1;
    status.phases.code_review!.iterations_current_loop = 1;
    writeStatusToFile(path.join(dir, 'status.json'), status);
}

function isProcessExitError(error: unknown, code: number): boolean {
    return error instanceof Error &&
        error.message === 'process.exit' &&
        'code' in error &&
        error.code === code;
}

async function expectExitTwo(fn: () => Promise<unknown>): Promise<void> {
    const originalExit: typeof process.exit = process.exit.bind(process);
    process.exit = (code?: string | number | null): never => {
        throw Object.assign(new Error('process.exit'), { code });
    };
    try {
        await assert.rejects(fn, (error: unknown) => isProcessExitError(error, 2));
    } finally {
        process.exit = originalExit;
    }
}

function addAffectedFile(tasksRoot: string, taskId: string, file: string): void {
    fs.appendFileSync(path.join(tasksRoot, taskId, 'spec.md'), [
        '', '## Amendment', '', '### Affected Files', '', '| File | Change |',
        '|---|---|', `| \`${file}\` | fixture reason |`, '',
    ].join('\n'));
}

function writeFilledReview(tasksRoot: string, taskId: string, verdict: 'Approved' | 'Changes requested'): void {
    fs.writeFileSync(path.join(tasksRoot, taskId, 'review.md'),
        `# Code Review\n\n## Stage 1\n\nReviewed.\n\n## Final Verdict\n\n- [x] ${verdict}\n`);
}

void test('scope pre-flight blocks normal runs without consuming review counters, then resumes at Round 1', { concurrency: false }, async () => {
    await withTempTasksAsync(async (tasksRoot, activeCwd) => {
        writeTask(tasksRoot, 'scope');
        const events: string[] = [];
        const deps = makeDeps({ activeCwd, events, onClaude: prompt => {
            assert.match(prompt, /This is Round 1/);
            assert.doesNotMatch(prompt, /Full-Send Scope Judgment/);
            writeFilledReview(tasksRoot, 'scope', 'Approved');
        } });
        deps.getAffectedFiles = () => ['src/extra-helper.ts'];
        await expectExitTwo(() => runCodeReviewPhase(makeState(['scope']), false, null, deps));
        assert.deepEqual(events, ['verifyBranch']);
        const blocked = readStatus('scope');
        assert.equal(blocked.phases.code_review?.status, 'blocked');
        assert.match((blocked.escalations ?? []).map(e => JSON.stringify(e)).join('\n'), /src\/extra-helper\.ts/);
        assert.doesNotMatch((blocked.escalations ?? []).map(e => JSON.stringify(e)).join('\n'), /reset-code-review/);
        assert.match((blocked.escalations ?? []).map(e => JSON.stringify(e)).join('\n'), /reroute/);
        for (const key of ['iterations_current_loop', 'iterations_total', 'preflight_rejections_current_loop', 'preflight_rejections_total'] as const) {
            assert.equal(blocked.phases.code_review?.[key], 0);
        }
        addAffectedFile(tasksRoot, 'scope', 'src/extra-helper.ts');
        await runCodeReviewPhase(makeState(['scope']), false, null, deps);
        assert.ok(events.some(event => event.startsWith('cold:')));
        assert.ok(events.includes('foreman'));
    });
});

void test('scope halt after a prior review resumes at Round 2 without resetting counters', { concurrency: false }, async () => {
    await withTempTasksAsync(async (tasksRoot, activeCwd) => {
        writeRoundTwoTask(tasksRoot, 'scope-round-two');
        const events: string[] = [];
        const deps = makeDeps({ activeCwd, events, onClaude: prompt => {
            assert.match(prompt, /This is Round 2/);
            writeFilledReview(tasksRoot, 'scope-round-two', 'Approved');
        } });
        deps.getAffectedFiles = () => ['src/new-helper.ts'];
        await expectExitTwo(() => runCodeReviewPhase(makeState(['scope-round-two']), false, null, deps));
        const blocked = readStatus('scope-round-two');
        assert.equal(blocked.phases.code_review?.iterations_current_loop, 1);
        assert.doesNotMatch((blocked.escalations ?? []).map(e => JSON.stringify(e)).join('\n'), /reset-code-review/);
        addAffectedFile(tasksRoot, 'scope-round-two', 'src/new-helper.ts');
        await runCodeReviewPhase(makeState(['scope-round-two']), false, null, deps);
        assert.equal(readStatus('scope-round-two').phases.code_review?.iterations_current_loop, 1);
    });
});

void test('full-send router blocks an approved review that left an out-of-scope file unjudged', { concurrency: false }, async () => {
    await withTempTasksAsync(async (tasksRoot, activeCwd) => {
        initReviewRepo(activeCwd);
        writeTask(tasksRoot, 'retry-scope');
        const statusPath = path.join(tasksRoot, 'retry-scope', 'status.json');
        const status = readStatus('retry-scope');
        status.full_send = true;
        writeStatusToFile(statusPath, status);
        const deps = makeDeps({ activeCwd, events: [] });
        deps.getAffectedFiles = () => ['src/a.ts'];
        await runCodeReviewPhase(makeState(['retry-scope']), false, null, deps);
        assert.equal(readStatus('retry-scope').phases.code_review?.status, 'pending');

        // Simulate the resumed Claude session writing a review and finishing the
        // phase. checkAndRoute must enforce the scope rule before routing to QA.
        writeFilledReview(tasksRoot, 'retry-scope', 'Approved');
        const retried = readStatus('retry-scope');
        retried.phases.code_review!.status = 'done';
        retried.phases.code_review!.verdict = 'approved';
        writeStatusToFile(statusPath, retried);
        const result = runCheckAndRouteInFixture(tasksRoot, activeCwd, 'retry-scope');
        assert.equal(result.status, 2, result.output);
        assert.equal(readStatus('retry-scope').phases.code_review?.status, 'blocked');
        assert.match((readStatus('retry-scope').escalations ?? []).map(e => JSON.stringify(e)).join('\n'), /src\/a\.ts/);
    });
});

for (const outcome of ['amended', 'directory_amended', 'changes_requested', 'spec_gap'] as const) {
    void test(`full-send router accepts ${outcome} after the foreman`, { concurrency: false }, async () => {
        await withTempTasksAsync((tasksRoot, activeCwd) => {
            initReviewRepo(activeCwd);
            writeTask(tasksRoot, 'router-scope');
            const statusPath = path.join(tasksRoot, 'router-scope', 'status.json');
            const status = readStatus('router-scope');
            status.full_send = true;
            status.phases.code_review!.status = 'done';
            status.phases.code_review!.verdict = outcome === 'amended' || outcome === 'directory_amended' ? 'approved' : outcome;
            writeStatusToFile(statusPath, status);
            if (outcome === 'amended') addAffectedFile(tasksRoot, 'router-scope', 'src/a.ts');
            if (outcome === 'directory_amended') addAffectedFile(tasksRoot, 'router-scope', 'src/');
            if (outcome !== 'spec_gap') writeFilledReview(tasksRoot, 'router-scope',
                outcome === 'changes_requested' ? 'Changes requested' : 'Approved');

            const result = runCheckAndRouteInFixture(tasksRoot, activeCwd, 'router-scope');
            if (outcome === 'spec_gap') {
                assert.equal(result.status, 2, result.output);
                assert.match(result.output, /src\/a\.ts/);
                assert.match(result.output, /BLESS does not amend/);
            } else {
                assert.equal(result.status, 0, result.output);
                assert.notEqual(readStatus('router-scope').phases.code_review?.status, 'blocked');
                if (outcome === 'changes_requested') {
                    assert.equal(readStatus('router-scope').phases.implement?.status, 'pending');
                }
            }
            return Promise.resolve();
        });
    });
}

for (const amended of [true, false]) {
    void test(`full-send bundle router ${amended ? 'accepts an amendment in the sibling spec' : 'blocks a file no member amended'}`, { concurrency: false }, async () => {
        await withTempTasksAsync((tasksRoot, activeCwd) => {
            initReviewRepo(activeCwd);
            for (const id of ['router-a', 'router-b']) {
                writeTask(tasksRoot, id);
                const status = readStatus(id);
                status.full_send = true;
                status.phases.code_review!.status = 'done';
                status.phases.code_review!.verdict = 'approved';
                writeStatusToFile(path.join(tasksRoot, id, 'status.json'), status);
                writeFilledReview(tasksRoot, id, 'Approved');
            }
            if (amended) addAffectedFile(tasksRoot, 'router-b', 'src/a.ts');

            const result = runCheckAndRouteInFixture(tasksRoot, activeCwd, ['router-a', 'router-b']);
            if (amended) {
                assert.equal(result.status, 0, result.output);
                assert.notEqual(readStatus('router-a').phases.code_review?.status, 'blocked');
            } else {
                assert.equal(result.status, 2, result.output);
                assert.match(result.output, /src\/a\.ts/);
            }
            return Promise.resolve();
        });
    });
}

void test('partial full-send review without a verdict remains recoverable', { concurrency: false }, async () => {
    await withTempTasksAsync(async (tasksRoot, activeCwd) => {
        writeTask(tasksRoot, 'partial-scope');
        const statusPath = path.join(tasksRoot, 'partial-scope', 'status.json');
        const status = readStatus('partial-scope');
        status.full_send = true;
        writeStatusToFile(statusPath, status);
        const deps = makeDeps({ activeCwd, events: [], onClaude: () => {
            fs.writeFileSync(path.join(tasksRoot, 'partial-scope', 'review.md'),
                '# Code Review\n\n## Stage 1\n\nPartial findings, no verdict yet.\n');
        } });
        deps.getAffectedFiles = () => ['src/extra-helper.ts'];
        const originalExit: typeof process.exit = process.exit.bind(process);
        process.exit = (code?: string | number | null): never => {
            throw Object.assign(new Error('process.exit'), { code });
        };
        try {
            await runCodeReviewPhase(makeState(['partial-scope']), false, null, deps);
        } finally {
            process.exit = originalExit;
        }
        assert.notEqual(readStatus('partial-scope').phases.code_review?.status, 'blocked');
    });
});

void test('full-send scope exemptions match routing verdicts across a bundle', () => {
    const allowlist = { paths: new Set<string>(), prefixes: [] as string[] };
    const paths = ['src/unlisted.ts'];
    assert.deepEqual(findUnjudgedFullSendFilesFromData(paths, allowlist, ['task-a', 'task-b'], ['approved', 'changes_requested']), []);
    assert.deepEqual(findUnjudgedFullSendFilesFromData(paths, allowlist, ['task-a', 'task-b'], ['approved', 'needs_re_review']), []);
    assert.deepEqual(findUnjudgedFullSendFilesFromData(paths, allowlist, ['task-a', 'task-b'], ['spec_gap', 'approved']), []);
    assert.deepEqual(findUnjudgedFullSendFilesFromData(paths, allowlist, ['task-a', 'task-b'], ['approved', 'approved']), paths);
    const prefixed = { paths: new Set<string>(), prefixes: ['src/'] };
    assert.deepEqual(findUnjudgedFullSendFilesFromData(paths, prefixed, ['task-a'], ['approved']), []);
    assert.deepEqual(findUnjudgedFullSendFilesFromData(['lib/unlisted.ts'], prefixed, ['task-a'], ['approved']), ['lib/unlisted.ts']);
});

void test('mixed full-send bundle halts; once all members opt in the runner hands off to the foreman', { concurrency: false }, async () => {
    await withTempTasksAsync(async (tasksRoot, activeCwd) => {
        for (const id of ['member-a', 'member-b']) writeTask(tasksRoot, id);
        const events: string[] = [];
        const deps = makeDeps({ activeCwd, events, onClaude: () => {
            addAffectedFile(tasksRoot, 'member-b', 'src/extra-helper.ts');
            for (const id of ['member-a', 'member-b']) writeFilledReview(tasksRoot, id, 'Approved');
        } });
        deps.getAffectedFiles = () => ['src/extra-helper.ts'];
        const memberA = readStatus('member-a');
        memberA.full_send = true;
        writeStatusToFile(path.join(tasksRoot, 'member-a', 'status.json'), memberA);
        await expectExitTwo(() => runCodeReviewPhase(makeState(['member-a', 'member-b']), false, null, deps));
        assert.deepEqual(events, ['verifyBranch']);

        // Once every member is full-send, the runner defers judgment to the foreman
        // (post-foreman enforcement lives in checkAndRoute; see the bundle router tests).
        const memberB = readStatus('member-b');
        memberB.full_send = true;
        writeStatusToFile(path.join(tasksRoot, 'member-b', 'status.json'), memberB);
        await runCodeReviewPhase(makeState(['member-a', 'member-b']), false, null, deps);
        assert.ok(events.includes('foreman'));
        assert.notEqual(readStatus('member-a').phases.code_review?.status, 'blocked');
    });
});

for (const outcome of ['amended', 'directory_amended', 'changes_requested', 'unjudged', 'in_scope'] as const) {
    // The runner only hands off: it never blocks after the foreman, names the files in the
    // prompt, and leaves spec.md untouched. Outcome enforcement is covered by the router tests.
    void test(`full-send runner hands off to the foreman without enforcing (${outcome})`, { concurrency: false }, async () => {
        await withTempTasksAsync(async (tasksRoot, activeCwd) => {
            writeTask(tasksRoot, 'scope');
            const specPath = path.join(tasksRoot, 'scope', 'spec.md');
            const file = 'src/extra-helper.ts';
            if (outcome === 'in_scope') addAffectedFile(tasksRoot, 'scope', file);
            const originalSpec = fs.readFileSync(specPath);
            const status = readStatus('scope');
            status.full_send = true;
            writeStatusToFile(path.join(tasksRoot, 'scope', 'status.json'), status);
            const events: string[] = [];
            const deps = makeDeps({ activeCwd, events, onClaude: prompt => {
                assert.deepEqual(fs.readFileSync(specPath), originalSpec);
                if (outcome === 'in_scope') assert.doesNotMatch(prompt, /Full-Send Scope Judgment/);
                else {
                    assert.match(prompt, /Full-Send Scope Judgment/);
                    assert.match(prompt, /src\/extra-helper\.ts/);
                    assert.match(prompt, /Appropriate scope expansion/);
                    assert.match(prompt, /Spec miss/);
                    assert.match(prompt, /Should not have been changed/);
                }
                if (outcome === 'amended') addAffectedFile(tasksRoot, 'scope', file);
                if (outcome === 'directory_amended') addAffectedFile(tasksRoot, 'scope', 'src/');
                writeFilledReview(tasksRoot, 'scope', outcome === 'changes_requested' ? 'Changes requested' : 'Approved');
            } });
            deps.getAffectedFiles = () => [file];
            if (outcome === 'unjudged') {
                await runCodeReviewPhase(makeState(['scope']), false, null, deps);
                assert.notEqual(readStatus('scope').phases.code_review?.status, 'blocked');
            } else {
                const originalExit: typeof process.exit = process.exit.bind(process);
                process.exit = (code?: string | number | null): never => {
                    throw Object.assign(new Error('process.exit'), { code });
                };
                try {
                    await runCodeReviewPhase(makeState(['scope']), false, null, deps);
                } finally {
                    process.exit = originalExit;
                }
                assert.notEqual(readStatus('scope').phases.code_review?.status, 'blocked');
            }
            assert.ok(events.some(event => event.startsWith('cold:')));
            assert.ok(events.includes('foreman'));
        });
    });
}

void test('review-loop evaluators apply cap thresholds and loop-local counters', () => {
    const cap = 3;
    for (const count of [cap - 1, cap, cap + 1]) {
        const expectedBlocked = count >= cap;
        assert.equal(
            evaluateSpecReviewLoop([reviewLoopContext({ specCurrent: count })], cap).blocked,
            expectedBlocked,
        );
        assert.equal(
            evaluateCodeReviewLoop([reviewLoopContext({ codeCurrent: count })], cap).blocked,
            expectedBlocked,
        );
    }

    assert.equal(
        evaluateSpecReviewLoop([
            reviewLoopContext({ specCurrent: cap, codeCurrent: 0 }),
        ], cap).blocked,
        true,
    );
    assert.equal(
        evaluateSpecReviewLoop([
            reviewLoopContext({ specCurrent: 0, codeCurrent: cap }),
        ], cap).blocked,
        false,
    );
    assert.equal(
        evaluateSpecReviewLoop([
            reviewLoopContext({ specCurrent: 0, specTotal: cap + 4 }),
        ], cap).blocked,
        false,
    );
    assert.equal(
        evaluateCodeReviewLoop([
            reviewLoopContext({ codeCurrent: 0, codeTotal: cap + 4 }),
        ], cap).blocked,
        false,
    );
    assert.deepEqual(
        evaluateSpecReviewLoop([reviewLoopContext()], Number.NaN),
        { blocked: false, count: 0 },
    );
    assert.deepEqual(
        evaluateCodeReviewLoop([reviewLoopContext()], Number.NaN),
        { blocked: false, count: 0 },
    );
    const zeroCapSpec = evaluateSpecReviewLoop([reviewLoopContext()], 0);
    assert.equal(zeroCapSpec.blocked, true);
    assert.equal(zeroCapSpec.count, 0);
    assert.equal(evaluateCodeReviewLoop([reviewLoopContext()], 0).blocked, true);

    const legacySpecCounter = reviewLoopContext({ specCurrent: cap });
    delete legacySpecCounter.status.phases.spec_review?.iterations_current_loop;
    assert.equal(evaluateSpecReviewLoop([legacySpecCounter], cap).blocked, true);

    assert.deepEqual(evaluateSpecReviewLoop([], cap), { blocked: false, count: 0 });
    assert.deepEqual(evaluateCodeReviewLoop([], cap), { blocked: false, count: 0 });
});

void test('code-review evaluator combines attempts per task before taking the bundle maximum', () => {
    const mixed = evaluateCodeReviewLoop([
        reviewLoopContext({ taskId: 'task-a', codeCurrent: 2, preflightCurrent: 0 }),
        reviewLoopContext({ taskId: 'task-b', codeCurrent: 0, preflightCurrent: 2 }),
    ], 3);
    assert.deepEqual(mixed, { blocked: false, count: 2 });

    const combined = evaluateCodeReviewLoop([
        reviewLoopContext({ codeCurrent: 2, preflightCurrent: 1 }),
    ], 3);
    assert.equal(combined.blocked, true);
    assert.equal(combined.count, 3);
});

void test('review-loop recovery reasons keep invariant details while deriving state-dependent block and resume guidance', () => {
    const specPending = evaluateSpecReviewLoop([
        reviewLoopContext({ specCurrent: 3, specStatus: 'pending' }),
    ], 3);
    const specDone = evaluateSpecReviewLoop([
        reviewLoopContext({ specCurrent: 3, specStatus: 'done' }),
    ], 3);
    const codePending = evaluateCodeReviewLoop([
        reviewLoopContext({ codeCurrent: 3, implementStatus: 'pending' }),
    ], 3);
    const codeDone = evaluateCodeReviewLoop([
        reviewLoopContext({ codeCurrent: 3, implementStatus: 'done' }),
    ], 3);
    assert.equal(specPending.blocked, true);
    assert.equal(specDone.blocked, true);
    assert.equal(codePending.blocked, true);
    assert.equal(codeDone.blocked, true);
    if (!specPending.blocked || !specDone.blocked || !codePending.blocked || !codeDone.blocked) {
        assert.fail('at-cap evaluator fixtures must block');
    }

    assert.notEqual(specPending.reason, specDone.reason);
    assert.notEqual(codePending.reason, codeDone.reason);

    assert.match(specPending.reason, /auto-blocked before the next spec revision/);
    assert.doesNotMatch(specDone.reason, /auto-blocked before the next spec revision/);
    assert.match(codePending.reason, /auto-blocked before the next re-implementation/);
    assert.doesNotMatch(codeDone.reason, /auto-blocked before the next re-implementation/);

    assert.equal(resumePhase(specPending.reason), 'spec');
    assert.equal(resumePhase(specDone.reason), 'spec_review');
    assert.equal(resumePhase(codePending.reason), 'implement');
    assert.equal(resumePhase(codeDone.reason), 'code_review');

    for (const reason of [codePending.reason, codeDone.reason]) {
        assert.match(reason, /Read tasks\/<id>\/review\.md/);
        assert.match(reason, /Validation Outcomes rows using prose labels instead of backticked check keys/);
        assert.match(reason, /accepts the current implementation as-is/);
        assert.match(reason, /enters `code_review` without another implementation pass/);
    }
    for (const reason of [specPending.reason, specDone.reason]) {
        assert.match(reason, /accepts the current spec as-is/);
        assert.match(reason, /enters `spec_review` without another spec revision/);
    }
    assert.match(codePending.reason, /raise the cap instead if you want the deferred implementation pass/i);
    assert.doesNotMatch(codeDone.reason, /raise the cap instead if you want the deferred implementation pass/i);
    assert.match(specPending.reason, /raise the cap instead if you want the deferred spec revision/i);
    assert.doesNotMatch(specDone.reason, /raise the cap instead if you want the deferred spec revision/i);

    for (const [pendingReason, doneReason, opening, resetCommand] of [
        [specPending.reason, specDone.reason, 'Spec review hit 3 changes_requested iterations in a row (limit: 3).', 'reset-spec-review'],
        [codePending.reason, codeDone.reason, 'Code review hit 3 attempts in a row for task task-a (3 reviewer rounds + 0 pre-flight rejections; limit: 3).', 'reset-code-review'],
    ] as const) {
        for (const reason of [pendingReason, doneReason]) {
            assert.ok(reason.startsWith(opening));
            assert.ok(reason.indexOf('MAX_REVIEW_LOOPS') >= 0);
            assert.ok(reason.indexOf('MAX_REVIEW_LOOPS') < reason.indexOf(resetCommand));
            assert.match(reason, /MAX_REVIEW_LOOPS=<n> canon run task-a\./);
            assert.doesNotMatch(reason, /MAX_REVIEW_LOOPS=<n> canon run task-a --step/);
            assert.doesNotMatch(reason, /iterations_current_loop\s*=/);
            assert.doesNotMatch(reason, /phases\.\w+\.status\s*=/);
        }
    }
});

void test('runCodeReviewPhase retains the capped-loop review-entry backstop', { concurrency: false }, async () => {
    await withTempTasksAsync(async (tasksRoot, activeCwd) => {
        const taskId = 'code-review-backstop';
        writeTask(tasksRoot, taskId);
        const statusPath = path.join(tasksRoot, taskId, 'status.json');
        const status = readStatus(taskId);
        status.phases.implement!.status = 'done';
        status.phases.code_review!.status = 'pending';
        status.phases.code_review!.iterations = 2;
        status.phases.code_review!.iterations_current_loop = 2;
        status.phases.code_review!.preflight_rejections_current_loop = 1;
        writeStatusToFile(statusPath, status);

        const events: string[] = [];
        const deps = makeDeps({ activeCwd, events });
        deps.getMaxReviewLoops = () => 3;
        const originalExit: typeof process.exit = process.exit.bind(process);
        process.exit = (code?: string | number | null): never => {
            throw Object.assign(new Error('process.exit'), { code });
        };
        try {
            await assert.rejects(
                () => runCodeReviewPhase(makeState([taskId]), false, null, deps),
                (error: unknown) => isProcessExitError(error, 2),
            );
        } finally {
            process.exit = originalExit;
        }

        assert.deepEqual(events, ['verifyBranch']);
        const blocked = readStatus(taskId);
        assert.equal(blocked.status, 'code_review');
        assert.equal(blocked.phases.code_review?.status, 'blocked');
        assert.equal(blocked.escalations?.at(-1)?.phase, 'code_review');
        assert.equal(resumePhase(blocked.escalations?.at(-1)?.reason ?? ''), 'code_review');
    });
});

void test('runColdCodexReview captures agent_message findings and uses codex review args', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-review-'));
    try {
        const argsFile = path.join(dir, 'args.txt');
        const fakeCodex = writeFakeCodexScript(dir, [
            `import fs from 'node:fs';`,
            `fs.writeFileSync(${JSON.stringify(argsFile)}, process.argv.slice(2).join('\\n'));`,
            `console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '[P2] src/foo.ts:10 - null deref' } }));`,
            `console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'second paragraph' } }));`,
            `console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }));`,
        ].join('\n'));

        const result = await runColdCodexReview('main', 'gpt-mini', 'high', dir, undefined, { codexBinary: fakeCodex });

        assert.equal(result.success, true);
        assert.equal(result.findings, '[P2] src/foo.ts:10 - null deref\n\nsecond paragraph');
        assert.ok(result.durationMs >= 0);
        assert.deepEqual(fs.readFileSync(argsFile, 'utf8').split('\n'), [
            'exec',
            'review',
            '--json',
            '-c',
            'model_reasoning_effort=high',
            '--base',
            'main',
            '-m',
            'gpt-mini',
        ]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runColdCodexReview reports unavailable when no findings output is captured', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-review-empty-'));
    try {
        const fakeCodex = writeFakeCodexScript(dir, `process.exit(1);`);
        const result = await runColdCodexReview('main', 'gpt-mini', 'high', dir, undefined, { codexBinary: fakeCodex });
        assert.equal(result.success, false);
        assert.equal(result.findings, '');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runColdCodexReview reports unavailable when the stream truncates before turn.completed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-review-truncated-'));
    try {
        // A partial review: an agent_message is emitted, then the process crashes (non-zero
        // exit) before the turn completes. Captured findings are non-empty but incomplete, so
        // the review must NOT be treated as obtained — this is the case both PR bots flagged.
        const fakeCodex = writeFakeCodexScript(dir, [
            `console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '[P2] src/foo.ts:10 - partial finding' } }));`,
            `process.exit(1);`,
        ].join('\n'));
        const result = await runColdCodexReview('main', 'gpt-mini', 'high', dir, undefined, { codexBinary: fakeCodex });
        assert.equal(result.success, false);
        assert.equal(result.findings, '[P2] src/foo.ts:10 - partial finding');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runColdCodexReview rejects an invalid effort before spawning', { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-review-effort-'));
    try {
        const sentinel = path.join(dir, 'spawned.txt');
        const fakeCodex = writeFakeCodexScript(dir, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(sentinel)}, 'spawned');`);
        const message = await captureDie(() => runColdCodexReview(
            'main',
            'gpt-mini',
            'ultra',
            dir,
            undefined,
            { codexBinary: fakeCodex },
        ));

        assert.equal(fs.existsSync(sentinel), false);
        assertInvalidEffortMessage(message);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runCodex rejects an invalid effort before spawning on the fresh path', { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-fresh-effort-'));
    const previousPath = process.env.PATH;
    try {
        const sentinel = path.join(dir, 'spawned.txt');
        const binary = path.join(dir, 'codex');
        fs.writeFileSync(binary, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'spawned');\n`, { mode: 0o755 });
        process.env.PATH = `${dir}${path.delimiter}${previousPath ?? ''}`;

        const message = await captureDie(() => runCodex('prompt', false, null, 'gpt-mini', 'ultra', undefined, dir));

        assert.equal(fs.existsSync(sentinel), false);
        assertInvalidEffortMessage(message);
    } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runCodex rejects an invalid effort before spawning on the resumed path', { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-resume-effort-'));
    const previousPath = process.env.PATH;
    try {
        const sentinel = path.join(dir, 'spawned.txt');
        const binary = path.join(dir, 'codex');
        fs.writeFileSync(binary, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'spawned');\n`, { mode: 0o755 });
        process.env.PATH = `${dir}${path.delimiter}${previousPath ?? ''}`;

        const message = await captureDie(() => runCodex('prompt', false, 'resume-id', 'gpt-mini', 'ultra', undefined, dir));

        assert.equal(fs.existsSync(sentinel), false);
        assertInvalidEffortMessage(message);
    } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runCodex adds headless guidance to fresh and resumed non-interactive prompts only', { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-headless-gate-'));
    const previousPath = process.env.PATH;
    try {
        const argsFile = path.join(dir, 'args.jsonl');
        const binary = path.join(dir, 'codex');
        fs.writeFileSync(binary, [
            '#!/usr/bin/env node',
            `require('node:fs').appendFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
        ].join('\n'), { mode: 0o755 });
        process.env.PATH = `${dir}${path.delimiter}${previousPath ?? ''}`;

        await runCodex('fresh prompt', false, null, 'gpt-mini', 'high', undefined, dir);
        await runCodex('resumed prompt', false, 'resume-id', 'gpt-mini', 'high', undefined, dir);
        await runCodex('interactive prompt', true, null, 'gpt-mini', 'high', undefined, dir);

        const capturedArgs = fs.readFileSync(argsFile, 'utf8')
            .trim().split('\n').map(line => JSON.parse(line) as string[]);
        const prompts = capturedArgs.map(args => args.find(arg => arg.includes('prompt')) ?? '');
        assert.equal(prompts.length, 3);
        const freshPrompt = prompts[0] ?? '';
        const resumedPrompt = prompts[1] ?? '';
        const interactivePrompt = prompts[2] ?? '';
        assert.ok(freshPrompt.startsWith(CODEX_HEADLESS));
        assert.ok(freshPrompt.endsWith('fresh prompt'));
        assert.match(resumedPrompt, /Headless session: this runs non-interactively/);
        assert.match(resumedPrompt, /\[Resumed session/);
        assert.ok(resumedPrompt.endsWith('resumed prompt'));
        assert.doesNotMatch(interactivePrompt, /Headless session: this runs non-interactively/);
        assert.equal(interactivePrompt, 'interactive prompt');
    } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runColdCodexReview records one successful metric row with usage and round attribution', { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-review-metrics-ok-'));
    try {
        const fakeCodex = writeFakeCodexScript(dir, [
            `console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'clean review' } }));`,
            `console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 4 } }));`,
        ].join('\n'));

        await withMetricsFileAsync(dir, async metricsFile => {
            recordMetric({
                taskId: 'task-a+task-b',
                phase: 'code_review',
                agent: 'claude',
                model: 'sonnet',
                iteration: 2,
                durationMs: 1,
                status: 'ok',
            });
            const result = await runColdCodexReview(
                'main',
                'gpt-mini',
                'high',
                dir,
                { taskId: 'task-a+task-b', phase: 'code_review', iteration: 2, activeCwd: dir },
                { codexBinary: fakeCodex },
            );
            assert.equal(result.success, true);

            const rows = readMetricRows(metricsFile);
            const codexRows = rows.filter(row => row[2] === 'code_review' && row[3] === 'codex');
            const claudeRows = rows.filter(row => row[2] === 'code_review' && row[3] === 'claude');
            assert.equal(codexRows.length, 1);
            assert.equal(claudeRows.length, 1);
            assert.deepEqual(codexRows[0]?.slice(1, 6), ['task-a+task-b', 'code_review', 'codex', 'gpt-mini', '2']);
            assert.match(codexRows[0]?.[6] ?? '', /^\d+\.\d+s$/);
            assert.equal(codexRows[0]?.[7], '7');
            assert.equal(codexRows[0]?.[8], 'ok');
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runColdCodexReview records one failed metric row for an incomplete stream', { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-review-metrics-failed-'));
    try {
        const fakeCodex = writeFakeCodexScript(dir, [
            `console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'partial review' } }));`,
            `process.exit(1);`,
        ].join('\n'));

        await withMetricsFileAsync(dir, async metricsFile => {
            const result = await runColdCodexReview(
                'main',
                'gpt-mini',
                'high',
                dir,
                { taskId: 'task-a', phase: 'code_review', iteration: 0, activeCwd: dir },
                { codexBinary: fakeCodex },
            );
            assert.equal(result.success, false);

            const rows = readMetricRows(metricsFile);
            assert.equal(rows.length, 1);
            assert.equal(rows[0]?.[8], 'failed');
            assert.equal(rows.filter(row => row[8] === 'ok').length, 0);
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runColdCodexReview records one failed metric row for invalid effort without spawning', { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-review-metrics-guard-'));
    try {
        const sentinel = path.join(dir, 'spawned.txt');
        const fakeCodex = writeFakeCodexScript(dir, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(sentinel)}, 'spawned');`);

        await withMetricsFileAsync(dir, async metricsFile => {
            const message = await captureDie(() => runColdCodexReview(
                'main',
                'gpt-mini',
                'ultra',
                dir,
                { taskId: 'task-a', phase: 'code_review', iteration: 0, activeCwd: dir },
                { codexBinary: fakeCodex },
            ));
            assertInvalidEffortMessage(message);
            assert.equal(fs.existsSync(sentinel), false);

            const rows = readMetricRows(metricsFile);
            assert.equal(rows.length, 1);
            assert.equal(rows[0]?.[8], 'failed');
            assert.equal(rows.filter(row => row[8] === 'ok').length, 0);
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runColdCodexReview records a dash token cell when completion usage is absent', { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-review-metrics-no-usage-'));
    try {
        const fakeCodex = writeFakeCodexScript(dir, [
            `console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'clean review' } }));`,
            `console.log(JSON.stringify({ type: 'turn.completed' }));`,
        ].join('\n'));

        await withMetricsFileAsync(dir, async metricsFile => {
            const result = await runColdCodexReview(
                'main',
                'gpt-mini',
                'high',
                dir,
                { taskId: 'task-a', phase: 'code_review', iteration: 0, activeCwd: dir },
                { codexBinary: fakeCodex },
            );
            assert.equal(result.success, true);

            const rows = readMetricRows(metricsFile);
            assert.equal(rows.length, 1);
            assert.equal(rows[0]?.[7], '-');
            assert.equal(rows[0]?.[8], 'ok');
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runColdCodexReview records a dash token cell when completion usage is all-zero', { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-review-metrics-zero-usage-'));
    try {
        const fakeCodex = writeFakeCodexScript(dir, [
            `console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'clean review' } }));`,
            `console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } }));`,
        ].join('\n'));

        await withMetricsFileAsync(dir, async metricsFile => {
            const result = await runColdCodexReview(
                'main',
                'gpt-mini',
                'high',
                dir,
                { taskId: 'task-a', phase: 'code_review', iteration: 0, activeCwd: dir },
                { codexBinary: fakeCodex },
            );
            assert.equal(result.success, true);

            const rows = readMetricRows(metricsFile);
            assert.equal(rows.length, 1);
            assert.equal(rows[0]?.[7], '-');
            assert.equal(rows[0]?.[8], 'ok');
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('runCodeReviewPhase runs cold-Codex before the foreman and writes artifacts for a bundle', { concurrency: false }, async () => {
    await withTempTasksAsync(async (tasksRoot, activeCwd) => {
        for (const taskId of ['task-a', 'task-b']) writeTask(tasksRoot, taskId);
        const events: string[] = [];
        const deps = makeDeps({
            activeCwd,
            events,
            findings: '[P2] src/foo.ts:10 - null deref',
            onClaude: (prompt) => {
                assert.deepEqual(events, ['verifyBranch', `cold:mini-from-policy:high:${activeCwd}:task-a+task-b:0`, 'foreman']);
                assert.match(prompt, /\[P2\] src\/foo\.ts:10 - null deref/);
                assert.match(prompt, /third lens input/);
                for (const taskId of ['task-a', 'task-b']) {
                    const artifact = fs.readFileSync(path.join(tasksRoot, taskId, 'review-cold-codex.md'), 'utf8');
                    assert.equal(artifact, '[P2] src/foo.ts:10 - null deref');
                    fs.writeFileSync(path.join(tasksRoot, taskId, 'review.md'), [
                        `# Code Review: ${taskId}`,
                        '',
                        '## Stage 1',
                        '',
                        'filled review',
                        '',
                    ].join('\n'));
                }
            },
        });

        const result = await runCodeReviewPhase(makeState(['task-a', 'task-b']), false, null, deps);

        assert.deepEqual(result, { agent: 'claude', sessionId: 'claude-session', exitCode: 0 });
        assert.deepEqual(events, ['verifyBranch', `cold:mini-from-policy:high:${activeCwd}:task-a+task-b:0`, 'foreman']);
        for (const taskId of ['task-a', 'task-b']) {
            const status = readStatus(taskId);
            assert.equal(status.phases.code_review?.status, 'in_progress');
            assert.equal(status.phases.qa?.status, 'pending');
        }
        assert.equal(
            fs.readFileSync(path.join(tasksRoot, 'task-a', 'review-cold-codex-run-1.md'), 'utf8'),
            fs.readFileSync(path.join(tasksRoot, 'task-b', 'review-cold-codex-run-1.md'), 'utf8'),
        );
    });
});

void test('runCodeReviewPhase stops the whole bundle before foreman when cold-Codex is unavailable', { concurrency: false }, async () => {
    await withTempTasksAsync(async (tasksRoot, activeCwd) => {
        for (const taskId of ['task-a', 'task-b']) writeTask(tasksRoot, taskId);
        const events: string[] = [];
        const deps = makeDeps({
            activeCwd,
            events,
            coldSuccess: false,
            findings: '',
            onClaude: () => {
                throw new Error('foreman must not run when cold-Codex review is unavailable');
            },
        });
        const originalExit: typeof process.exit = process.exit.bind(process);
        process.exit = (code?: string | number | null): never => {
            throw Object.assign(new Error('process.exit'), { code });
        };
        try {
            await assert.rejects(
                () => runCodeReviewPhase(makeState(['task-a', 'task-b']), false, null, deps),
                (error: unknown) => isProcessExitError(error, 1),
            );
        } finally {
            process.exit = originalExit;
        }

        assert.deepEqual(events, ['verifyBranch', `cold:mini-from-policy:high:${activeCwd}:task-a+task-b:0`]);
        for (const taskId of ['task-a', 'task-b']) {
            assert.equal(fs.existsSync(path.join(tasksRoot, taskId, 'review-cold-codex.md')), false);
            assert.equal(fs.readdirSync(path.join(tasksRoot, taskId)).some(name => name.startsWith('review-cold-codex-run-')), false);
            const status = readStatus(taskId);
            assert.equal(status.phases.code_review?.status, 'in_progress');
            assert.equal(status.phases.qa?.status, 'pending');
        }
    });
});

void test('pre-flight rejection writes no cold-Codex archive', { concurrency: false }, async () => {
    await withTempTasksAsync(async (tasksRoot, activeCwd) => {
        writeTask(tasksRoot, 'reject');
        const deps = makeDeps({ activeCwd, events: [] });
        deps.verifyHandoffAgainstDiff = () => ['[reject] handoff→diff: src/foo.ts missing from handoff'];
        await runCodeReviewPhase(makeState(['reject']), false, null, deps);
        assert.equal(fs.readdirSync(path.join(tasksRoot, 'reject')).some(name => name.startsWith('review-cold-codex-run-')), false);
    });
});

void test('rename-aware delta path set forces full when an untouched source moves onto a prior path', { concurrency: false }, async () => {
    await withTempTasksAsync(async (tasksRoot, activeCwd) => {
        writeTask(tasksRoot, 'rename');
        gitAt(activeCwd, 'init', '-b', 'main');
        gitAt(activeCwd, 'config', 'user.email', 'test@example.com');
        gitAt(activeCwd, 'config', 'user.name', 'Test');
        fs.writeFileSync(path.join(activeCwd, 'X'), 'same content\n');
        fs.writeFileSync(path.join(activeCwd, 'Y'), 'other content\n');
        gitAt(activeCwd, 'add', '.');
        gitAt(activeCwd, 'commit', '-m', 'base');
        gitAt(activeCwd, 'switch', '-c', 'feature');
        gitAt(activeCwd, 'rm', 'Y');
        gitAt(activeCwd, 'commit', '-m', 'remove Y');
        const prior = gitAt(activeCwd, 'rev-parse', 'HEAD');
        gitAt(activeCwd, 'mv', 'X', 'Y');
        gitAt(activeCwd, 'commit', '-m', 'rename X to Y');
        assert.deepEqual(getPathsInRange(`${prior}..HEAD`, activeCwd), ['X', 'Y']);
        const dir = path.join(tasksRoot, 'rename');
        fs.writeFileSync(path.join(dir, 'review.md'), '# Review\n\n## Stage 1\n');
        const status = readStatus('rename');
        status.phases.code_review!.iterations = 1;
        status.phases.code_review!.iterations_current_loop = 1;
        writeStatusToFile(path.join(dir, 'status.json'), status);
        writeColdCodexArchive(dir, { round: 1, reviewedSha: prior, scope: 'full', base: 'main', reason: 'Round 1' }, 'prior');
        const bases: string[] = [];
        const deps = realGitDeps(activeCwd, []);
        const cold = deps.runColdCodexReview;
        deps.runColdCodexReview = (base, ...rest) => { bases.push(base); return cold(base, ...rest); };
        await runCodeReviewPhase(makeState(['rename']), false, null, deps);
        assert.deepEqual(bases, ['main']);
        assert.match(fs.readFileSync(path.join(dir, 'review-cold-codex-run-2.md'), 'utf8'), /X is outside the previous round's change set/);
    });
});

void test('cold-Codex archives use numeric max+1 and newest matching round', { concurrency: false }, async () => {
    await withTempTasksAsync((tasksRoot) => {
        const dir = path.join(tasksRoot, 'archive');
        fs.mkdirSync(dir);
        const sha = 'a'.repeat(40);
        const header = { round: 1, reviewedSha: sha, scope: 'full' as const, base: 'main', reason: 'Round 1' };
        for (const n of [1, 2, 10]) fs.writeFileSync(path.join(dir, `review-cold-codex-run-${n}.md`),
            `<!-- round=1 reviewed_sha=${sha} scope=full base=main reason="Round 1" -->\n\nold ${n}`);
        assert.equal(writeColdCodexArchive(dir, { ...header, round: 2 }, 'new findings'), 'review-cold-codex-run-11.md');
        assert.equal(findColdCodexArchiveForRound(dir, 1)?.reviewedSha, sha);
        assert.equal(findColdCodexArchiveForRound(dir, 2)?.round, 2);
        return Promise.resolve();
    });
});

void test('review scope follows prompt round, archives each invocation, and chooses delta base', { concurrency: false }, async () => {
    await withTempTasksAsync(async (tasksRoot, activeCwd) => {
        const taskId = 'scope-task';
        writeTask(tasksRoot, taskId);
        const previousSha = initReviewRepo(activeCwd);
        const bases: string[] = [];
        const prompts: string[] = [];
        const deps = realGitDeps(activeCwd, [], prompt => {
            prompts.push(prompt);
            fs.writeFileSync(path.join(tasksRoot, taskId, 'review.md'), '# Review\n\n## Stage 1\n\nfilled\n');
        });
        const cold = deps.runColdCodexReview;
        deps.runColdCodexReview = (base, ...rest) => { bases.push(base); return cold(base, ...rest); };

        // A stale counter with no real Stage 1 still renders and archives Round 1.
        const statusPath = path.join(tasksRoot, taskId, 'status.json');
        const stale = readStatus(taskId);
        stale.phases.code_review!.iterations = 1;
        stale.phases.code_review!.iterations_current_loop = 1;
        writeStatusToFile(statusPath, stale);
        await runCodeReviewPhase(makeState([taskId]), false, null, deps);
        assert.deepEqual(bases, ['main']);
        const dir = path.join(tasksRoot, taskId);
        assert.match(fs.readFileSync(path.join(dir, 'review-cold-codex-run-1.md'), 'utf8'), /round=1 .*scope=full.*reason="Round 1/);
        assert.match(prompts[0], /Scope:\*\* Full/);

        const next = readStatus(taskId);
        next.phases.code_review!.iterations = 1;
        next.phases.code_review!.iterations_current_loop = 1;
        writeStatusToFile(statusPath, next);
        fs.appendFileSync(path.join(activeCwd, 'src/a.ts'), 'fix\n');
        gitAt(activeCwd, 'add', '.');
        gitAt(activeCwd, 'commit', '-m', 'fix');
        await runCodeReviewPhase(makeState([taskId]), false, null, deps);
        assert.deepEqual(bases, ['main', previousSha]);
        const second = fs.readFileSync(path.join(dir, 'review-cold-codex-run-2.md'), 'utf8');
        assert.match(second, /round=2 .*scope=delta/);
        assert.match(second, /\n\n\[P2\] src\/foo.ts:10 - null deref$/);
        assert.equal(fs.readFileSync(path.join(dir, 'review-cold-codex.md'), 'utf8'), '[P2] src/foo.ts:10 - null deref');
        assert.match(prompts[1], /Scope:\*\* Delta/);
        assert.match(prompts[1], /subagent_type: code-review-cold/);
    });
});

void test('review retry uses round N-1 archive; equal HEAD and non-ancestor force full', { concurrency: false }, async () => {
    await withTempTasksAsync(async (tasksRoot, activeCwd) => {
        const id = 'retry';
        writeTask(tasksRoot, id);
        const prior = initReviewRepo(activeCwd);
        const dir = path.join(tasksRoot, id);
        fs.writeFileSync(path.join(dir, 'review.md'), '# Review\n\n## Stage 1\n\nfilled\n');
        const status = readStatus(id);
        status.phases.code_review!.iterations = 1;
        status.phases.code_review!.iterations_current_loop = 1;
        writeStatusToFile(path.join(dir, 'status.json'), status);
        const header = { round: 1, reviewedSha: prior, scope: 'full' as const, base: 'main', reason: 'Round 1' };
        writeColdCodexArchive(dir, header, 'prior');
        fs.appendFileSync(path.join(activeCwd, 'src/a.ts'), 'fix\n');
        gitAt(activeCwd, 'add', '.');
        gitAt(activeCwd, 'commit', '-m', 'fix');
        writeColdCodexArchive(dir, { ...header, round: 2, reviewedSha: gitAt(activeCwd, 'rev-parse', 'HEAD') }, 'aborted attempt');
        const bases: string[] = [];
        const deps = realGitDeps(activeCwd, []);
        const cold = deps.runColdCodexReview;
        deps.runColdCodexReview = (base, ...rest) => { bases.push(base); return cold(base, ...rest); };
        await runCodeReviewPhase(makeState([id]), false, null, deps);
        assert.equal(bases.at(-1), prior);
        assert.equal(findColdCodexArchiveForRound(dir, 2)?.base, prior);

        // The previous reviewed SHA now equals HEAD.
        writeColdCodexArchive(dir, { ...header, reviewedSha: gitAt(activeCwd, 'rev-parse', 'HEAD') }, 'same head');
        await runCodeReviewPhase(makeState([id]), false, null, deps);
        assert.equal(bases.at(-1), 'main');
        assert.match(fs.readFileSync(path.join(dir, 'review-cold-codex-run-5.md'), 'utf8'), /reason="previous reviewed commit equals HEAD"/);

        // Rewriting the branch leaves a valid but non-ancestor SHA.
        gitAt(activeCwd, 'switch', '-c', 'rewritten', 'main');
        fs.appendFileSync(path.join(activeCwd, 'src/b.ts'), 'new branch\n');
        gitAt(activeCwd, 'add', '.');
        gitAt(activeCwd, 'commit', '-m', 'rewritten');
        await runCodeReviewPhase(makeState([id]), false, null, deps);
        assert.equal(bases.at(-1), 'main');
        assert.match(fs.readFileSync(path.join(dir, 'review-cold-codex-run-6.md'), 'utf8'), /not an ancestor/);
    });
});

void test('missing, malformed, and unresolved previous records force full review', { concurrency: false }, async () => {
    await withTempTasksAsync(async (tasksRoot, activeCwd) => {
        const id = 'unusable';
        writeTask(tasksRoot, id);
        initReviewRepo(activeCwd);
        const dir = path.join(tasksRoot, id);
        fs.writeFileSync(path.join(dir, 'review.md'), '# Review\n\n## Stage 1\n');
        const status = readStatus(id);
        status.phases.code_review!.iterations = 1;
        status.phases.code_review!.iterations_current_loop = 1;
        writeStatusToFile(path.join(dir, 'status.json'), status);
        const deps = realGitDeps(activeCwd, []);
        const bases: string[] = [];
        const cold = deps.runColdCodexReview;
        deps.runColdCodexReview = (base, ...rest) => { bases.push(base); return cold(base, ...rest); };
        await runCodeReviewPhase(makeState([id]), false, null, deps);
        assert.match(fs.readFileSync(path.join(dir, 'review-cold-codex-run-1.md'), 'utf8'), /no cold-Codex archive record/);
        fs.writeFileSync(path.join(dir, 'review-cold-codex-run-2.md'), 'malformed header\n');
        await runCodeReviewPhase(makeState([id]), false, null, deps);
        assert.match(fs.readFileSync(path.join(dir, 'review-cold-codex-run-3.md'), 'utf8'), /unparseable cold-Codex archive record/);
        writeColdCodexArchive(dir, { round: 1, reviewedSha: 'f'.repeat(40), scope: 'full', base: 'main', reason: 'old' }, 'prior');
        await runCodeReviewPhase(makeState([id]), false, null, deps);
        assert.match(fs.readFileSync(path.join(dir, 'review-cold-codex-run-5.md'), 'utf8'), /does not resolve/);
        assert.deepEqual(bases, ['main', 'main', 'main']);
    });
});

void test('failed delta facts force full scope before cold-Codex runs', { concurrency: false }, async () => {
    await withTempTasksAsync(async (tasksRoot, activeCwd) => {
        const prior = 'b'.repeat(40);
        for (const [name, failedProbe, expectedReason] of [
            ['delta-paths', 'delta', /delta path probe failed/],
            ['prior-paths', 'prior', /previous change-set path probe failed/],
            ['line-stats', 'lines', /delta line-stat probe failed/],
        ] as const) {
            writeRoundTwoTask(tasksRoot, name);
            const bases: string[] = [];
            const deps = makeDeps({ activeCwd, events: [] });
            deps.findColdCodexArchiveForRound = () => ({
                round: 1, reviewedSha: prior, scope: 'full', base: 'main', reason: 'Round 1',
            });
            deps.getPathsInRange = range => {
                if (failedProbe === 'delta' && !range.includes('...')) return null;
                if (failedProbe === 'prior' && range.includes('...')) return null;
                return ['src/foo.ts'];
            };
            deps.getDeltaLineStats = () => failedProbe === 'lines'
                ? null : [{ path: 'src/foo.ts', added: 1, deleted: 0 }];
            const cold = deps.runColdCodexReview;
            deps.runColdCodexReview = (base, ...rest) => { bases.push(base); return cold(base, ...rest); };
            await runCodeReviewPhase(makeState([name]), false, null, deps);
            assert.deepEqual(bases, ['main']);
            assert.match(fs.readFileSync(path.join(tasksRoot, name, 'review-cold-codex-run-1.md'), 'utf8'), expectedReason);
        }
    });
});

void test('git range helpers distinguish failed probes from empty diffs', { concurrency: false }, async () => {
    await withTempTasksAsync((_tasksRoot, activeCwd) => {
        const head = initReviewRepo(activeCwd);
        assert.deepEqual(getPathsInRange(`${head}..${head}`, activeCwd), []);
        assert.deepEqual(getDeltaLineStats(head, activeCwd), []);
        assert.equal(getPathsInRange('missing-ref..HEAD', activeCwd), null);
        assert.equal(getDeltaLineStats('missing-ref', activeCwd), null);
        return Promise.resolve();
    });
});

void test('bundle disagreement is named as the full-scope reason', { concurrency: false }, async () => {
    await withTempTasksAsync(async (tasksRoot, activeCwd) => {
        for (const id of ['member-a', 'member-b']) writeRoundTwoTask(tasksRoot, id);
        const deps = makeDeps({ activeCwd, events: [] });
        deps.findColdCodexArchiveForRound = dir => ({
            round: 1, reviewedSha: path.basename(dir) === 'member-a' ? 'b'.repeat(40) : 'c'.repeat(40),
            scope: 'full', base: 'main', reason: 'Round 1',
        });
        await runCodeReviewPhase(makeState(['member-a', 'member-b']), false, null, deps);
        assert.match(fs.readFileSync(path.join(tasksRoot, 'member-a', 'review-cold-codex-run-1.md'), 'utf8'), /bundle members disagree/);
        deps.findColdCodexArchiveForRound = dir => path.basename(dir) === 'member-a'
            ? { round: 1, reviewedSha: 'b'.repeat(40), scope: 'full', base: 'main', reason: 'Round 1' }
            : null;
        await runCodeReviewPhase(makeState(['member-a', 'member-b']), false, null, deps);
        assert.match(fs.readFileSync(path.join(tasksRoot, 'member-a', 'review-cold-codex-run-2.md'), 'utf8'), /no cold-Codex archive record/);
    });
});

void test('HEAD must resolve before cold-Codex and no review artifact is written on failure', { concurrency: false }, async () => {
    await withTempTasksAsync(async (tasksRoot, activeCwd) => {
        writeTask(tasksRoot, 'no-head');
        const events: string[] = [];
        const deps = makeDeps({ activeCwd, events });
        deps.resolveCommit = () => null;
        const originalExit: typeof process.exit = process.exit.bind(process);
        process.exit = (code?: string | number | null): never => {
            throw Object.assign(new Error('process.exit'), { code });
        };
        try {
            await assert.rejects(
                () => runCodeReviewPhase(makeState(['no-head']), false, null, deps),
                (error: unknown) => isProcessExitError(error, 1),
            );
        } finally {
            process.exit = originalExit;
        }
        assert.deepEqual(events, ['verifyBranch']);
        assert.equal(fs.readdirSync(path.join(tasksRoot, 'no-head')).some(name => name.startsWith('review-cold-codex')), false);
    });
});

void test('archive records the SHA captured before cold-Codex if HEAD moves during the run', { concurrency: false }, async () => {
    await withTempTasksAsync(async (tasksRoot, activeCwd) => {
        writeTask(tasksRoot, 'moving-head');
        const pinnedSha = initReviewRepo(activeCwd);
        const deps = realGitDeps(activeCwd, []);
        const cold = deps.runColdCodexReview;
        deps.runColdCodexReview = (...args) => {
            fs.appendFileSync(path.join(activeCwd, 'src/a.ts'), 'arrived during review\n');
            gitAt(activeCwd, 'add', '.');
            gitAt(activeCwd, 'commit', '-m', 'concurrent');
            return cold(...args);
        };
        await runCodeReviewPhase(makeState(['moving-head']), false, null, deps);
        const archive = findColdCodexArchiveForRound(path.join(tasksRoot, 'moving-head'), 1);
        assert.equal(archive?.reviewedSha, pinnedSha);
        assert.notEqual(gitAt(activeCwd, 'rev-parse', 'HEAD'), pinnedSha);
    });
});
