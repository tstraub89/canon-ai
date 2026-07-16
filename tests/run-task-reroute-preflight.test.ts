import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { checkRerouteEvidence, sliceRerouteRoundSection } from '../scripts/run-task/validation.js';

const WORKTREE_ROOT = process.cwd();
const TSX_LOADER = path.join(WORKTREE_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');
const MAIN_URL = pathToFileURL(path.join(WORKTREE_ROOT, 'scripts', 'run-task', 'main.ts')).href;
const MD_LOADER = path.join(WORKTREE_ROOT, 'tests', 'md-loader-register.mjs');

function withTempDir<T>(prefix: string, fn: (dir: string) => T): T {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    try {
        return fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function writeTaskStatus(tasksRoot: string, taskId: string, status: Record<string, unknown>): void {
    const taskDir = path.join(tasksRoot, taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

function initGitRepo(dir: string): void {
    execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir });
}

function worktreeTasksRoot(worktreesRoot: string, taskId: string): string {
    return path.join(worktreesRoot, taskId, 'tasks');
}

type RerouteStatusOptions = {
    taskSize?: 'XS' | 'S' | 'M' | 'L' | 'XL';
    delicate?: boolean;
    worktree?: boolean;
    humanSpecGate?: boolean;
    sessions?: Record<string, string>;
    specReview?: Record<string, unknown>;
    plan?: Record<string, unknown>;
    implement?: Record<string, unknown>;
    codeReview?: Record<string, unknown>;
    qa?: Record<string, unknown>;
    humanReview?: Record<string, unknown>;
};

function makeRerouteStatus(
    taskId: string,
    branch: string,
    rerouteCount = 0,
    options: RerouteStatusOptions = {},
): Record<string, unknown> {
    return {
        id: taskId,
        title: taskId,
        status: 'human_review',
        branch,
        base_branch: 'main',
        task_size: options.taskSize ?? 'M',
        delicate: options.delicate ?? false,
        human_spec_gate: options.humanSpecGate ?? false,
        full_send: false,
        worktree: options.worktree ?? true,
        phases: {
            spec: { status: 'done', agent: 'claude' },
            spec_review: {
                status: 'done',
                agent: 'codex',
                verdict: 'approved',
                iterations: 2,
                iterations_current_loop: 2,
                iterations_total: 5,
                changes_requested_total: 2,
                auto_block_count: 1,
                ...options.specReview,
            },
            plan: { status: 'done', agent: 'claude', ...options.plan },
            implement: { status: 'done', agent: 'codex', reroute_count: rerouteCount, ...options.implement },
            code_review: { status: 'done', agent: 'claude', verdict: 'approved', ...options.codeReview },
            qa: { status: 'done', agent: 'claude', ...options.qa },
            human_review: { status: 'pending', agent: 'human', ...options.humanReview },
        },
        sessions: options.sessions,
    };
}

function writeSpec(root: string, taskId: string, content: string): void {
    const specPath = path.join(root, 'tasks', taskId, 'spec.md');
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.writeFileSync(specPath, content, 'utf8');
}

function runReroute(
    cwd: string,
    taskIds: readonly string[],
    force: boolean,
): { status: number | null; stdout: string; stderr: string } {
    const telemetryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reroute-preflight-metrics-'));
    const telemetryFile = path.join(telemetryDir, 'pipeline-invocations.md');
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        CANON_WORKTREES_ROOT: path.join(cwd, 'worktrees'),
        CANON_METRICS_FILE_OVERRIDE: telemetryFile,
    };
    delete env.CANON_TASKS_DIR_OVERRIDE;
    const result = spawnSync(process.execPath, [
        '--import',
        MD_LOADER,
        '--import',
        TSX_LOADER,
        '-e',
        [
            `import { rerouteFromHumanReview, setCliArgsForTest } from ${JSON.stringify(MAIN_URL)};`,
            `setCliArgsForTest({ force: ${force ? 'true' : 'false'} });`,
            `rerouteFromHumanReview(${JSON.stringify([...taskIds])});`,
        ].join('\n'),
    ], {
        cwd,
        encoding: 'utf8',
        env,
    });
    fs.rmSync(telemetryDir, { recursive: true, force: true });
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

function readStatus(tasksRoot: string, taskId: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as Record<string, unknown>;
}

function derivePhase(status: Record<string, unknown>): string {
    const phases = status.phases as Record<string, { status?: string }>;
    for (const phaseName of ['spec', 'spec_review', 'plan', 'implement', 'code_review', 'qa', 'human_review']) {
        if ((phases[phaseName]?.status ?? 'pending') !== 'done') return phaseName;
    }
    return 'complete';
}

function runCheckAndRoute(
    cwd: string,
    phase: 'spec_review' | 'code_review',
    taskIds: readonly string[],
): { status: number | null; stdout: string; stderr: string } {
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        CANON_WORKTREES_ROOT: path.join(cwd, 'worktrees'),
    };
    delete env.CANON_TASKS_DIR_OVERRIDE;
    const result = spawnSync(process.execPath, [
        '--import',
        MD_LOADER,
        '--import',
        TSX_LOADER,
        '-e',
        [
            `import { checkAndRoute } from ${JSON.stringify(MAIN_URL)};`,
            `await checkAndRoute(${JSON.stringify(phase)}, ${JSON.stringify([...taskIds])});`,
        ].join('\n'),
    ], {
        cwd,
        encoding: 'utf8',
        env,
    });
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

function makeCodeReviewBlockedStatus(
    taskId: string,
    branch: string,
    verdict: string,
    overrides: RerouteStatusOptions = {},
): Record<string, unknown> {
    return makeRerouteStatus(taskId, branch, 0, {
        taskSize: 'M',
        ...overrides,
        codeReview: {
            status: 'blocked',
            verdict,
            iterations: 3,
            iterations_current_loop: 3,
            iterations_total: 7,
            preflight_rejections_current_loop: 2,
            ...overrides.codeReview,
        },
        qa: { status: 'pending' },
        humanReview: { status: 'pending' },
    });
}

function writeFakeAgentBins(binDir: string): void {
    fs.mkdirSync(binDir, { recursive: true });
    const codexPath = path.join(binDir, 'codex');
    fs.writeFileSync(codexPath, [
        '#!/usr/bin/env node',
        'const fs = require("fs");',
        'const path = require("path");',
        'const capture = process.env.FAKE_AGENT_CAPTURE;',
        'if (capture) fs.appendFileSync(capture, JSON.stringify({ name: "codex", cwd: process.cwd(), args: process.argv.slice(2) }) + "\\n");',
        'const taskId = process.env.FAKE_CODEX_COMPLETE_SPEC_REVIEW_TASK;',
        'if (taskId) {',
        '  const taskDir = path.join(process.cwd(), "tasks", taskId);',
        '  fs.mkdirSync(taskDir, { recursive: true });',
        '  fs.writeFileSync(path.join(taskDir, "spec-review.md"), "# Spec Review\\n\\n## Verdict\\n\\n- [x] **Approved** — fixture\\n", "utf8");',
        '  const statusPath = path.join(taskDir, "status.json");',
        '  const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));',
        '  status.phases.spec_review.status = "done";',
        '  status.phases.spec_review.verdict = "approved";',
        '  const order = ["spec", "spec_review", "plan", "implement", "code_review", "qa", "human_review"];',
        '  status.status = order.find(phase => (status.phases[phase]?.status ?? "pending") !== "done") ?? "complete";',
        '  fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\\n`, "utf8");',
        '}',
        'console.log(JSON.stringify({ type: "thread.started", thread_id: "fake-codex-session" }));',
        'console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }));',
        '',
    ].join('\n'), 'utf8');
    fs.chmodSync(codexPath, 0o755);

    const claudePath = path.join(binDir, 'claude');
    fs.writeFileSync(claudePath, [
        '#!/usr/bin/env node',
        'const fs = require("fs");',
        'const capture = process.env.FAKE_AGENT_CAPTURE;',
        'if (capture) fs.appendFileSync(capture, JSON.stringify({ name: "claude", cwd: process.cwd(), args: process.argv.slice(2) }) + "\\n");',
        'console.log(JSON.stringify({ type: "result", session_id: "fake-claude-session", usage: {} }));',
        '',
    ].join('\n'), 'utf8');
    fs.chmodSync(claudePath, 0o755);
}

function runMain(
    cwd: string,
    args: readonly string[],
    extraEnv: NodeJS.ProcessEnv,
): { status: number | null; stdout: string; stderr: string } {
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        CANON_WORKTREES_ROOT: path.join(cwd, 'worktrees'),
        CANON_METRICS_FILE_OVERRIDE: path.join(cwd, 'metrics.md'),
        ...extraEnv,
    };
    delete env.CANON_TASKS_DIR_OVERRIDE;
    const result = spawnSync(process.execPath, [
        '--import',
        MD_LOADER,
        '--import',
        TSX_LOADER,
        '-e',
        [
            `import { main } from ${JSON.stringify(MAIN_URL)};`,
            `process.argv = ['node', 'run-task', ...${JSON.stringify([...args])}];`,
            'await main();',
        ].join('\n'),
    ], {
        cwd,
        encoding: 'utf8',
        env,
    });
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

function probeActiveCwd(cwd: string, taskId: string): string {
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        CANON_WORKTREES_ROOT: path.join(cwd, 'worktrees'),
    };
    delete env.CANON_TASKS_DIR_OVERRIDE;
    const result = spawnSync(process.execPath, [
        '--import',
        MD_LOADER,
        '--import',
        TSX_LOADER,
        '-e',
        [
            `import { getActiveCwd } from ${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'scripts', 'run-task', 'worktree.ts')).href)};`,
            `console.log(getActiveCwd([${JSON.stringify(taskId)}]));`,
        ].join('\n'),
    ], {
        cwd,
        encoding: 'utf8',
        env,
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
}

function readCapture(capturePath: string): Array<{ name: string; cwd: string; args: string[] }> {
    if (!fs.existsSync(capturePath)) return [];
    return fs.readFileSync(capturePath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as { name: string; cwd: string; args: string[] });
}

function replaceCodexPrompt(args: readonly string[]): string[] {
    const modelFlagIndex = args.lastIndexOf('-m');
    assert.ok(modelFlagIndex > 0, `missing model flag in Codex argv: ${JSON.stringify(args)}`);
    return args.map((arg, index) => index === modelFlagIndex - 1 ? '<prompt>' : arg);
}

void test('rerouteFromHumanReview reads worktree spec.md when a task worktree exists', () => {
    withTempDir('reroute-preflight-worktree-source-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const taskId = 'task-a';
        const status = makeRerouteStatus(taskId, 'task/task-a');
        writeTaskStatus(tasksRoot, taskId, status);
        writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, status);
        // REPO_ROOT still has the pre-implement scaffold.
        writeSpec(dir, taskId, [
            '# Spec',
            '',
            '## Overview',
            '',
            'No amendment heading here.',
            '',
        ].join('\n'));
        // The worktree copy is canonical past implement and carries the amendment.
        writeSpec(path.join(worktreesRoot, taskId), taskId, [
            '# Spec',
            '',
            '## Amendment',
            '',
            'Worktree amendment that should satisfy the gate.',
            '',
        ].join('\n'));

        const rootBefore = fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8');
        const result = runReroute(dir, [taskId], false);

        assert.equal(result.status, 0, `expected reroute to succeed; stderr was:\n${result.stderr}`);
        assert.equal(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8'), rootBefore);
        const updated = readStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId) as {
            phases?: { implement?: { status?: string; rerouted?: boolean; reroute_count?: number } };
        };
        assert.equal(updated.phases?.implement?.status, 'pending');
        assert.equal(updated.phases?.implement?.rerouted, true);
        assert.equal(updated.phases?.implement?.reroute_count, 1);
    });
});

void test('rerouteFromHumanReview rejects stale worktree spec even if REPO_ROOT spec is amended', () => {
    withTempDir('reroute-preflight-worktree-required-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const taskId = 'task-a';
        const status = makeRerouteStatus(taskId, 'task/task-a');
        writeTaskStatus(tasksRoot, taskId, status);
        writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, status);
        // REPO_ROOT has the amendment, but it is no longer the live source once the worktree exists.
        writeSpec(dir, taskId, [
            '# Spec',
            '',
            '## Amendment',
            '',
            'Operator amended the wrong copy.',
            '',
        ].join('\n'));
        writeSpec(path.join(worktreesRoot, taskId), taskId, [
            '# Spec',
            '',
            '## Overview',
            '',
            'Worktree copy is stale and should block reroute.',
            '',
        ].join('\n'));

        const rootBefore = fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8');
        const worktreeBefore = fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, taskId), taskId, 'status.json'), 'utf8');
        const result = runReroute(dir, [taskId], false);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /spec\.md amendment required before reroute/);
        assert.match(result.stderr, /worktrees\/task-a\/tasks\/task-a\/spec\.md/);
        assert.equal(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8'), rootBefore);
        assert.equal(fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, taskId), taskId, 'status.json'), 'utf8'), worktreeBefore);
    });
});

void test('rerouteFromHumanReview with --force proceeds and records reroute metadata', () => {
    withTempDir('reroute-preflight-force-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const taskId = 'task-a';
        const status = makeRerouteStatus(taskId, 'task/task-a');
        writeTaskStatus(tasksRoot, taskId, status);
        writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, status);
        // Worktree spec lacks the amendment; --force bypasses.
        writeSpec(dir, taskId, [
            '# Spec',
            '',
            '## Overview',
            '',
            'This amendment is intentionally omitted.',
            '',
        ].join('\n'));
        writeSpec(path.join(worktreesRoot, taskId), taskId, [
            '# Spec',
            '',
            '## Overview',
            '',
            'This amendment is intentionally omitted.',
            '',
        ].join('\n'));

        const rootBefore = fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8');
        const result = runReroute(dir, [taskId], true);

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /--force bypass: task-a spec\.md missing required ## Amendment heading for round 1/);
        assert.equal(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8'), rootBefore);
        const updated = readStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId) as {
            phases?: { implement?: { status?: string; rerouted?: boolean; reroute_count?: number } };
        };
        assert.equal(updated.phases?.implement?.status, 'pending');
        assert.equal(updated.phases?.implement?.rerouted, true);
        assert.equal(updated.phases?.implement?.reroute_count, 1);
    });
});

void test('rerouteFromHumanReview accepts code_review blocked spec_gap and cleanly resets review state', () => {
    withTempDir('reroute-preflight-spec-gap-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const taskId = 'task-a';
        const status = makeCodeReviewBlockedStatus(taskId, 'task/task-a', 'spec_gap', {
            taskSize: 'M',
            sessions: { codex_spec_review: 'stale-spec-session' },
        });
        writeTaskStatus(tasksRoot, taskId, status);
        writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, status);
        writeSpec(path.join(worktreesRoot, taskId), taskId, [
            '# Spec',
            '',
            '## Amendment',
            '',
            'Spec-gap fix.',
            '',
        ].join('\n'));

        const result = runReroute(dir, [taskId], false);

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /code_review spec_gap → spec_review/);
        const updated = readStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId) as {
            status?: string;
            sessions?: Record<string, string>;
            phases?: {
                spec_review?: { status?: string };
                plan?: { status?: string };
                implement?: { status?: string; rerouted?: boolean; reroute_count?: number };
                code_review?: {
                    status?: string;
                    verdict?: string;
                    iterations?: number;
                    iterations_current_loop?: number;
                    preflight_rejections_current_loop?: number;
                };
                qa?: { status?: string };
                human_review?: { status?: string };
            };
        };
        assert.equal(updated.status, 'spec_review');
        assert.equal(updated.phases?.spec_review?.status, 'pending');
        assert.equal(updated.phases?.plan?.status, 'pending');
        assert.equal(updated.phases?.implement?.status, 'pending');
        assert.equal(updated.phases?.implement?.rerouted, true);
        assert.equal(updated.phases?.implement?.reroute_count, 1);
        assert.equal(updated.phases?.code_review?.status, 'pending');
        assert.equal(updated.phases?.code_review?.verdict, '');
        assert.equal(updated.phases?.code_review?.iterations_current_loop, 0);
        assert.equal(updated.phases?.code_review?.iterations, 0);
        assert.equal(updated.phases?.code_review?.preflight_rejections_current_loop, 0);
        assert.equal(updated.phases?.qa?.status, 'pending');
        assert.equal(updated.phases?.human_review?.status, 'pending');
        assert.equal(updated.sessions?.codex_spec_review, undefined);
    });
});

void test('rerouteFromHumanReview rejects non-spec-gap code_review and off-phase bundle siblings without mutation', () => {
    withTempDir('reroute-preflight-spec-gap-reject-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const taskA = makeCodeReviewBlockedStatus('task-a', 'task/task-a', 'spec_gap');
        const approvedOnly = makeCodeReviewBlockedStatus('task-b', 'task/task-b', 'approved');
        const offPhase = makeRerouteStatus('task-c', 'task/task-c', 0, {
            codeReview: { status: 'pending', verdict: '' },
            implement: { status: 'pending' },
            qa: { status: 'pending' },
        });
        for (const [taskId, status] of [['task-a', taskA], ['task-b', approvedOnly], ['task-c', offPhase]] as const) {
            writeTaskStatus(tasksRoot, taskId, status);
            writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, status);
            writeSpec(path.join(worktreesRoot, taskId), taskId, '# Spec\n\n## Amendment\n\nAllowed.\n');
        }

        const beforeB = fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, 'task-b'), 'task-b', 'status.json'), 'utf8');
        const noGap = runReroute(dir, ['task-b'], false);
        assert.notEqual(noGap.status, 0);
        assert.match(noGap.stderr, /all tasks at code_review blocked with at least one spec_gap verdict/);
        assert.equal(fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, 'task-b'), 'task-b', 'status.json'), 'utf8'), beforeB);

        const beforeA = fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, 'task-a'), 'task-a', 'status.json'), 'utf8');
        const beforeC = fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, 'task-c'), 'task-c', 'status.json'), 'utf8');
        const mixed = runReroute(dir, ['task-a', 'task-c'], false);
        assert.notEqual(mixed.status, 0);
        assert.match(mixed.stderr, /Current state:/);
        assert.equal(fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, 'task-a'), 'task-a', 'status.json'), 'utf8'), beforeA);
        assert.equal(fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, 'task-c'), 'task-c', 'status.json'), 'utf8'), beforeC);
    });
});

void test('rerouteFromHumanReview reroutes mixed spec_gap bundle when only gap task is amended', () => {
    withTempDir('reroute-preflight-spec-gap-bundle-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const statuses = {
            'task-a': makeCodeReviewBlockedStatus('task-a', 'task/task-a', 'spec_gap'),
            'task-b': makeCodeReviewBlockedStatus('task-b', 'task/task-b', 'approved'),
        };
        for (const [taskId, status] of Object.entries(statuses)) {
            writeTaskStatus(tasksRoot, taskId, status);
            writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, status);
        }
        writeSpec(path.join(worktreesRoot, 'task-a'), 'task-a', '# Spec\n\n## Amendment\n\nBundle fix.\n');
        writeSpec(path.join(worktreesRoot, 'task-b'), 'task-b', '# Spec\n\nNo amendment needed for approved sibling.\n');

        const result = runReroute(dir, ['task-a', 'task-b'], false);

        assert.equal(result.status, 0, result.stderr);
        for (const taskId of ['task-a', 'task-b']) {
            const updated = readStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId) as {
                status?: string;
                phases?: {
                    implement?: { reroute_exempt?: boolean; reroute_exempt_prior_verdict?: string };
                    code_review?: {
                        status?: string;
                        verdict?: string;
                        iterations?: number;
                        iterations_current_loop?: number;
                        preflight_rejections_current_loop?: number;
                    };
                };
            };
            assert.equal(updated.status, 'spec_review');
            assert.equal(updated.phases?.code_review?.status, 'pending');
            assert.equal(updated.phases?.code_review?.verdict, '');
            assert.equal(updated.phases?.code_review?.iterations_current_loop, 0);
            assert.equal(updated.phases?.code_review?.iterations, 0);
            assert.equal(updated.phases?.code_review?.preflight_rejections_current_loop, 0);
            assert.equal(updated.phases?.implement?.reroute_exempt, taskId === 'task-b' ? true : undefined);
            assert.equal(updated.phases?.implement?.reroute_exempt_prior_verdict, taskId === 'task-b' ? 'approved' : undefined);
        }
    });
});

for (const priorVerdict of ['changes_requested', 'needs_re_review'] as const) {
    void test(`rerouteFromHumanReview preserves ${priorVerdict} verdict for exempt failing sibling`, () => {
        withTempDir(`reroute-preflight-failing-sibling-${priorVerdict}-`, dir => {
            initGitRepo(dir);
            const tasksRoot = path.join(dir, 'tasks');
            const worktreesRoot = path.join(dir, 'worktrees');
            const statuses = {
                'task-a': makeCodeReviewBlockedStatus('task-a', 'task/task-a', 'spec_gap'),
                'task-b': makeCodeReviewBlockedStatus('task-b', 'task/task-b', priorVerdict),
            };
            for (const [taskId, status] of Object.entries(statuses)) {
                writeTaskStatus(tasksRoot, taskId, status);
                writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, status);
            }
            writeSpec(path.join(worktreesRoot, 'task-a'), 'task-a', '# Spec\n\n## Amendment\n\nBundle fix.\n');
            writeSpec(path.join(worktreesRoot, 'task-b'), 'task-b', '# Spec\n\nNo amendment needed for failing non-gap sibling.\n');

            const result = runReroute(dir, ['task-a', 'task-b'], false);

            assert.equal(result.status, 0, result.stderr);
            const updatedA = readStatus(worktreeTasksRoot(worktreesRoot, 'task-a'), 'task-a') as {
                phases?: { implement?: { reroute_exempt?: boolean; reroute_exempt_prior_verdict?: string } };
            };
            const updatedB = readStatus(worktreeTasksRoot(worktreesRoot, 'task-b'), 'task-b') as {
                status?: string;
                phases?: {
                    implement?: { reroute_exempt?: boolean; reroute_exempt_prior_verdict?: string };
                    code_review?: { status?: string; verdict?: string };
                };
            };
            assert.equal(updatedA.phases?.implement?.reroute_exempt, undefined);
            assert.equal(updatedA.phases?.implement?.reroute_exempt_prior_verdict, undefined);
            assert.equal(updatedB.status, 'spec_review');
            assert.equal(updatedB.phases?.implement?.reroute_exempt, true);
            assert.equal(updatedB.phases?.implement?.reroute_exempt_prior_verdict, priorVerdict);
            assert.equal(updatedB.phases?.code_review?.status, 'pending');
            assert.equal(updatedB.phases?.code_review?.verdict, '');
        });
    });
}

void test('rerouteFromHumanReview full-tier resets spec_review and plan, preserves monotonic counters, and clears stale spec_review session', () => {
    withTempDir('reroute-preflight-full-tier-reset-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const taskId = 'task-a';
        const status = makeRerouteStatus(taskId, 'task/task-a', 2, {
            taskSize: 'M',
            sessions: {
                codex_spec_review: 'old-spec-review-session',
                codex: 'keep-implement-session',
            },
        });
        writeTaskStatus(tasksRoot, taskId, status);
        writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, status);
        writeSpec(path.join(worktreesRoot, taskId), taskId, [
            '# Spec',
            '',
            '## Amendment Round 3',
            '',
            'Round 3 amendment.',
            '',
        ].join('\n'));

        const result = runReroute(dir, [taskId], false);

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /human_review → spec_review/);
        assert.match(result.stdout, /--step --expect spec_review/);
        const updated = readStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId) as {
            status?: string;
            sessions?: Record<string, string>;
            phases?: {
                spec_review?: {
                    status?: string;
                    verdict?: string;
                    iterations?: number;
                    iterations_current_loop?: number;
                    iterations_total?: number;
                    changes_requested_total?: number;
                    auto_block_count?: number;
                };
                plan?: { status?: string };
                implement?: { status?: string; rerouted?: boolean; reroute_count?: number };
            };
        };
        assert.equal(updated.status, 'spec_review');
        assert.equal(updated.phases?.spec_review?.status, 'pending');
        assert.equal(updated.phases?.spec_review?.verdict, '');
        assert.equal(updated.phases?.spec_review?.iterations_current_loop, 0);
        assert.equal(updated.phases?.spec_review?.iterations, 0);
        assert.equal(updated.phases?.spec_review?.iterations_total, 5);
        assert.equal(updated.phases?.spec_review?.changes_requested_total, 2);
        assert.equal(updated.phases?.spec_review?.auto_block_count, 1);
        assert.equal(updated.phases?.plan?.status, 'pending');
        assert.equal(updated.phases?.implement?.status, 'pending');
        assert.equal(updated.phases?.implement?.rerouted, true);
        assert.equal(updated.phases?.implement?.reroute_count, 3);
        assert.equal(updated.sessions?.codex_spec_review, undefined);
        assert.equal(updated.sessions?.codex, 'keep-implement-session');
    });
});

void test('rerouteFromHumanReview fast-tier leaves spec_review and plan untouched and resumes at implement', () => {
    withTempDir('reroute-preflight-fast-tier-reset-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const taskId = 'task-a';
        const status = makeRerouteStatus(taskId, 'task/task-a', 0, {
            taskSize: 'XS',
            delicate: false,
            sessions: {
                codex_spec_review: 'unchanged-session',
                codex: 'keep-implement-session',
            },
        });
        writeTaskStatus(tasksRoot, taskId, status);
        writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, status);
        writeSpec(path.join(worktreesRoot, taskId), taskId, [
            '# Spec',
            '',
            '## Amendment',
            '',
            'Round 1 amendment.',
            '',
        ].join('\n'));

        const result = runReroute(dir, [taskId], false);

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /human_review → implement/);
        assert.doesNotMatch(result.stdout, /--step --expect spec_review/);
        const updated = readStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId) as {
            status?: string;
            sessions?: Record<string, string>;
            phases?: {
                spec_review?: { status?: string; verdict?: string; iterations_current_loop?: number };
                plan?: { status?: string };
                implement?: { status?: string; rerouted?: boolean; reroute_count?: number };
            };
        };
        assert.equal(updated.status, 'implement');
        assert.equal(updated.phases?.spec_review?.status, 'done');
        assert.equal(updated.phases?.spec_review?.verdict, 'approved');
        assert.equal(updated.phases?.spec_review?.iterations_current_loop, 2);
        assert.equal(updated.phases?.plan?.status, 'done');
        assert.equal(updated.phases?.implement?.status, 'pending');
        assert.equal(updated.phases?.implement?.rerouted, true);
        assert.equal(updated.phases?.implement?.reroute_count, 1);
        assert.equal(updated.sessions?.codex_spec_review, 'unchanged-session');
    });
});

void test('checkAndRoute blocks reroute amendment rejection to the human and resets the whole bundle to spec_review', () => {
    withTempDir('reroute-preflight-option-b-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const taskA = makeRerouteStatus('task-a', 'task/task-a', 1, {
            worktree: false,
            specReview: { status: 'done', verdict: 'changes_requested' },
            plan: { status: 'pending' },
            implement: { status: 'pending', rerouted: true },
        });
        const taskB = makeRerouteStatus('task-b', 'task/task-b', 2, {
            worktree: false,
            specReview: { status: 'done', verdict: 'approved' },
            plan: { status: 'pending' },
            implement: { status: 'pending', rerouted: true },
        });
        writeTaskStatus(tasksRoot, 'task-a', taskA);
        writeTaskStatus(tasksRoot, 'task-b', taskB);

        const result = runCheckAndRoute(dir, 'spec_review', ['task-a', 'task-b']);

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /AMENDMENT REVIEW/);
        assert.match(result.stdout, /tasks\/task-a\/spec\.md/);
        assert.match(result.stdout, /tasks\/task-a\/spec-review\.md/);
        assert.doesNotMatch(result.stdout, /tasks\/task-b\/spec\.md/);
        assert.match(result.stdout, /canon run task-a task-b/);
        const updatedA = readStatus(tasksRoot, 'task-a') as { status?: string; phases?: { spec?: { status?: string }; spec_review?: { status?: string; verdict?: string } } };
        const updatedB = readStatus(tasksRoot, 'task-b') as { status?: string; phases?: { spec?: { status?: string }; spec_review?: { status?: string; verdict?: string } } };
        assert.equal(updatedA.status, 'spec_review');
        assert.equal(updatedB.status, 'spec_review');
        assert.equal(updatedA.phases?.spec?.status, 'done');
        assert.equal(updatedB.phases?.spec?.status, 'done');
        assert.equal(updatedA.phases?.spec_review?.status, 'pending');
        assert.equal(updatedB.phases?.spec_review?.status, 'pending');
        assert.equal(updatedA.phases?.spec_review?.verdict, '');
        assert.equal(updatedB.phases?.spec_review?.verdict, '');
    });
});

void test('checkAndRoute preserves non-reroute spec_review changes_requested routing back to spec', () => {
    withTempDir('reroute-preflight-non-reroute-spec-loop-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const taskId = 'task-a';
        const status = makeRerouteStatus(taskId, 'task/task-a', 0, {
            worktree: false,
            specReview: { status: 'done', verdict: 'changes_requested' },
            implement: { rerouted: undefined },
        });
        writeTaskStatus(tasksRoot, taskId, status);

        const result = runCheckAndRoute(dir, 'spec_review', [taskId]);

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /routing back to spec/);
        const updated = readStatus(tasksRoot, taskId) as {
            status?: string;
            phases?: { spec?: { status?: string }; spec_review?: { status?: string } };
        };
        assert.equal(updated.status, 'spec');
        assert.equal(updated.phases?.spec?.status, 'pending');
        assert.equal(updated.phases?.spec_review?.status, 'pending');
    });
});

void test('checkAndRoute lets approved reroute spec_review flow through to plan without re-arming the spec gate', () => {
    withTempDir('reroute-preflight-approved-flow-through-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const taskId = 'task-a';
        const status = makeRerouteStatus(taskId, 'task/task-a', 1, {
            worktree: false,
            humanSpecGate: false,
            specReview: { status: 'done', verdict: 'approved' },
            plan: { status: 'pending' },
            implement: { status: 'pending', rerouted: true },
        });
        writeTaskStatus(tasksRoot, taskId, status);

        const result = runCheckAndRoute(dir, 'spec_review', [taskId]);

        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(result.stdout, /SPEC GATE/);
        const updated = readStatus(tasksRoot, taskId) as { phases?: { plan?: { status?: string } } };
        assert.equal(derivePhase(updated as Record<string, unknown>), 'plan');
        assert.equal(updated.phases?.plan?.status, 'pending');
    });
});

void test('checkAndRoute spec_gap block prints and stores audited full-bundle recovery commands', () => {
    withTempDir('reroute-preflight-spec-gap-message-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const taskA = makeRerouteStatus('task-a', 'task/task-a', 0, {
            worktree: false,
            codeReview: { status: 'done', verdict: 'spec_gap' },
            qa: { status: 'pending' },
        });
        const taskB = makeRerouteStatus('task-b', 'task/task-b', 0, {
            worktree: false,
            codeReview: { status: 'done', verdict: 'approved' },
            qa: { status: 'pending' },
        });
        writeTaskStatus(tasksRoot, 'task-a', taskA);
        writeTaskStatus(tasksRoot, 'task-b', taskB);

        const result = runCheckAndRoute(dir, 'code_review', ['task-a', 'task-b']);

        assert.equal(result.status, 2);
        const output = `${result.stdout}\n${result.stderr}`;
        assert.match(output, /canon run task-a task-b --reroute/);
        assert.match(output, /canon task accept task-a task-b code_review --reason/);
        assert.doesNotMatch(output, /code_review pending/);
        assert.doesNotMatch(output, /done approved/);
        for (const taskId of ['task-a', 'task-b']) {
            const status = readStatus(tasksRoot, taskId) as {
                phases?: { code_review?: { status?: string; verdict?: string } };
                escalations?: Array<{ reason?: string }>;
            };
            assert.equal(status.phases?.code_review?.status, 'blocked');
            const reason = status.escalations?.at(-1)?.reason ?? '';
            assert.match(reason, /canon run task-a task-b --reroute/);
            assert.match(reason, /canon task accept task-a task-b code_review --reason/);
            assert.doesNotMatch(reason, /code_review pending/);
            assert.doesNotMatch(reason, /done approved/);
        }
    });
});

void test('spec_review phase runs in REPO_ROOT on first pass and fresh in the worktree on reroute', () => {
    withTempDir('reroute-preflight-spec-review-cwd-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const binDir = path.join(dir, 'bin');
        writeFakeAgentBins(binDir);

        const firstPassCapture = path.join(dir, 'first-pass-capture.jsonl');
        const firstPassStatus = makeRerouteStatus('task-first', 'task/task-first', 0, {
            worktree: false,
            specReview: { status: 'pending', verdict: '' },
            plan: { status: 'pending' },
            implement: { status: 'pending' },
        });
        writeTaskStatus(tasksRoot, 'task-first', firstPassStatus);
        writeSpec(dir, 'task-first', '# Spec\n\n## Design\n\nFixture.\n');

        const firstPass = runMain(dir, ['--step', '--expect', 'spec_review', 'task-first'], {
            PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
            CODEX_MODEL_MINI: 'fixture-mini',
            FAKE_AGENT_CAPTURE: firstPassCapture,
            FAKE_CODEX_COMPLETE_SPEC_REVIEW_TASK: 'task-first',
        });

        assert.equal(firstPass.status, 0, firstPass.stderr);
        const firstPassCodex = readCapture(firstPassCapture)
            .find(entry => entry.name === 'codex' && entry.args[0] === 'exec');
        assert.equal(firstPassCodex ? fs.realpathSync(firstPassCodex.cwd) : '', fs.realpathSync(dir));
        assert.deepEqual(replaceCodexPrompt(firstPassCodex?.args ?? []), [
            'exec',
            '--json',
            '-c',
            'model_reasoning_effort=high',
            '--sandbox',
            'workspace-write',
            '<prompt>',
            '-m',
            'fixture-mini',
            '-C',
            fs.realpathSync(dir),
        ]);

        const worktreesRoot = path.join(dir, 'worktrees');
        const taskId = 'task-reroute';
        const rerouteStatus = makeRerouteStatus(taskId, 'task/task-reroute', 0, {
            taskSize: 'M',
            sessions: { codex_spec_review: 'old-root-session' },
        });
        writeTaskStatus(tasksRoot, taskId, rerouteStatus);
        writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, rerouteStatus);
        writeSpec(path.join(worktreesRoot, taskId), taskId, '# Spec\n\n## Amendment\n\nFixture.\n');

        const reroute = runReroute(dir, [taskId], false);
        assert.equal(reroute.status, 0, reroute.stderr);
        assert.equal(
            fs.realpathSync(probeActiveCwd(dir, taskId)),
            fs.realpathSync(path.join(worktreesRoot, taskId)),
        );

        const rerouteCapture = path.join(dir, 'reroute-capture.jsonl');
        const rerouteStep = runMain(dir, ['--step', '--expect', 'spec_review', taskId], {
            PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_AGENT_CAPTURE: rerouteCapture,
            FAKE_CODEX_COMPLETE_SPEC_REVIEW_TASK: taskId,
        });

        assert.equal(rerouteStep.status, 0, rerouteStep.stderr);
        const rerouteCaptures = readCapture(rerouteCapture).filter(entry => entry.name === 'codex');
        const rerouteCodex = rerouteCaptures.find(entry => entry.args[0] === 'exec');
        assert.equal(
            rerouteCodex ? fs.realpathSync(rerouteCodex.cwd) : '',
            fs.realpathSync(path.join(worktreesRoot, taskId)),
            JSON.stringify(rerouteCaptures, null, 2),
        );
        assert.equal(rerouteCodex?.args.includes('resume'), false);
    });
});

void test('retryAgentForPhase uses worktree cwd for reroute spec_review and REPO_ROOT otherwise', () => {
    withTempDir('reroute-preflight-retry-cwd-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const binDir = path.join(dir, 'bin');
        const capturePath = path.join(dir, 'retry-capture.jsonl');
        writeFakeAgentBins(binDir);
        const taskId = 'task-a';
        const status = makeRerouteStatus(taskId, 'task/task-a', 1, {
            sessions: { codex_spec_review: 'retry-session' },
            specReview: { status: 'in_progress', verdict: '' },
            plan: { status: 'pending' },
            implement: { status: 'pending', rerouted: true },
        });
        writeTaskStatus(tasksRoot, taskId, status);
        writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, status);
        const retryEnv: NodeJS.ProcessEnv = {
            ...process.env,
            CANON_WORKTREES_ROOT: worktreesRoot,
            CODEX_MODEL_MINI: 'fixture-mini',
            PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_AGENT_CAPTURE: capturePath,
        };
        delete retryEnv.CANON_TASKS_DIR_OVERRIDE;

        const rerouteResult = spawnSync(process.execPath, [
            '--import',
            MD_LOADER,
            '--import',
            TSX_LOADER,
            '-e',
            [
                `import { retryAgentForPhase } from ${JSON.stringify(MAIN_URL)};`,
                `await retryAgentForPhase(${JSON.stringify(taskId)}, 'spec_review', 'fixture evidence');`,
            ].join('\n'),
        ], {
            cwd: dir,
            encoding: 'utf8',
            env: retryEnv,
        });
        assert.equal(rerouteResult.status, 0, rerouteResult.stderr);
        let captures = readCapture(capturePath).filter(entry => entry.name === 'codex');
        let latestCapture = captures.at(-1);
        assert.equal(
            latestCapture ? fs.realpathSync(latestCapture.cwd) : '',
            fs.realpathSync(path.join(worktreesRoot, taskId)),
        );
        assert.deepEqual(replaceCodexPrompt(latestCapture?.args ?? []), [
            'exec',
            'resume',
            'retry-session',
            '--json',
            '-c',
            'model_reasoning_effort=high',
            '<prompt>',
            '-m',
            'fixture-mini',
        ]);

        const nonRerouteStatus = readStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId) as {
            phases?: { implement?: Record<string, unknown> };
        };
        if (nonRerouteStatus.phases?.implement) {
            delete nonRerouteStatus.phases.implement.rerouted;
        }
        writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, nonRerouteStatus);

        const nonRerouteResult = spawnSync(process.execPath, [
            '--import',
            MD_LOADER,
            '--import',
            TSX_LOADER,
            '-e',
            [
                `import { retryAgentForPhase } from ${JSON.stringify(MAIN_URL)};`,
                `await retryAgentForPhase(${JSON.stringify(taskId)}, 'spec_review', 'fixture evidence');`,
            ].join('\n'),
        ], {
            cwd: dir,
            encoding: 'utf8',
            env: retryEnv,
        });
        assert.equal(nonRerouteResult.status, 0, nonRerouteResult.stderr);
        captures = readCapture(capturePath).filter(entry => entry.name === 'codex');
        latestCapture = captures.at(-1);
        assert.equal(latestCapture ? fs.realpathSync(latestCapture.cwd) : '', fs.realpathSync(dir));
    });
});

void test('rerouteFromHumanReview reports every failing task in a bundle', () => {
    withTempDir('reroute-preflight-bundle-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const taskIds = ['task-a', 'task-b', 'task-c'];
        for (const taskId of taskIds) {
            const status = makeRerouteStatus(taskId, `task/${taskId}`);
            writeTaskStatus(tasksRoot, taskId, status);
            writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, status);
            // Each worktree spec lacks the amendment; pre-flight reads the active worktree.
            writeSpec(path.join(worktreesRoot, taskId), taskId, [
                '# Spec',
                '',
                '## Overview',
                '',
                `Task ${taskId} forgot to amend spec.md.`,
                '',
            ].join('\n'));
        }

        const before = taskIds.map(taskId => fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, taskId), taskId, 'status.json'), 'utf8'));
        const result = runReroute(dir, taskIds, false);

        assert.notEqual(result.status, 0);
        for (const taskId of taskIds) {
            assert.match(result.stderr, new RegExp(taskId));
            assert.match(result.stderr, new RegExp(`tasks/${taskId}/spec\\.md`));
        }
        assert.match(result.stderr, /Bypass with --force if you have verified the lack of amendment is intentional\./);
        taskIds.forEach((taskId, index) => {
            assert.equal(fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, taskId), taskId, 'status.json'), 'utf8'), before[index]);
        });
    });
});

void test('rerouteFromHumanReview enforces the round-2 heading and accepts the strict round-2 form after amendment', () => {
    withTempDir('reroute-preflight-round-two-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const taskId = 'task-a';
        const status = makeRerouteStatus(taskId, 'task/task-a', 1);
        writeTaskStatus(tasksRoot, taskId, status);
        writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, status);
        // Worktree spec only has the round-1 form; pre-flight requires Round 2.
        writeSpec(path.join(worktreesRoot, taskId), taskId, [
            '# Spec',
            '',
            '## Amendment',
            '',
            'Round 1 amendment only.',
            '',
        ].join('\n'));

        const first = runReroute(dir, [taskId], false);
        assert.notEqual(first.status, 0);
        assert.match(first.stderr, /expected heading: ## Amendment Round 2/);
        assert.match(first.stderr, /found `## Amendment`/);

        // Operator updates the worktree spec to the strict round-2 form; gate clears.
        writeSpec(path.join(worktreesRoot, taskId), taskId, [
            '# Spec',
            '',
            '## Amendment Round 2',
            '',
            'Round 2 amendment now present.',
            '',
        ].join('\n'));

        const second = runReroute(dir, [taskId], false);
        assert.equal(second.status, 0, second.stderr);
        const updated = readStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId) as {
            phases?: { implement?: { status?: string; rerouted?: boolean; reroute_count?: number } };
        };
        assert.equal(updated.phases?.implement?.status, 'pending');
        assert.equal(updated.phases?.implement?.rerouted, true);
        assert.equal(updated.phases?.implement?.reroute_count, 2);
    });
});

void test('rerouteFromHumanReview second spec_gap reroute requires round-2 headings for amended and previously exempt tasks', () => {
    withTempDir('reroute-preflight-mixed-round-two-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const statuses = {
            'task-a': makeCodeReviewBlockedStatus('task-a', 'task/task-a', 'spec_gap', {
                implement: { reroute_count: 1, rerouted: true },
            }),
            'task-b': makeCodeReviewBlockedStatus('task-b', 'task/task-b', 'spec_gap', {
                implement: { reroute_count: 1, rerouted: true, reroute_exempt: true },
            }),
        };
        for (const [taskId, status] of Object.entries(statuses)) {
            writeTaskStatus(tasksRoot, taskId, status);
            writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, status);
        }
        writeSpec(path.join(worktreesRoot, 'task-a'), 'task-a', [
            '# Spec',
            '',
            '## Amendment',
            '',
            'Round 1 amendment only.',
            '',
        ].join('\n'));
        writeSpec(path.join(worktreesRoot, 'task-b'), 'task-b', [
            '# Spec',
            '',
            'No amendment headings have ever been added for task B.',
            '',
        ].join('\n'));
        const beforeA = fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, 'task-a'), 'task-a', 'status.json'), 'utf8');
        const beforeB = fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, 'task-b'), 'task-b', 'status.json'), 'utf8');

        const result = runReroute(dir, ['task-a', 'task-b'], false);

        assert.notEqual(result.status, 0);
        for (const taskId of ['task-a', 'task-b']) {
            assert.match(result.stderr, new RegExp(`${taskId}:[\\s\\S]*required round: 2[\\s\\S]*expected heading: ## Amendment Round 2`));
        }
        assert.match(result.stderr, /task-a:[\s\S]*found `## Amendment`/);
        assert.match(result.stderr, /task-b:[\s\S]*no `## Amendment Round 2` heading found/);
        assert.equal(fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, 'task-a'), 'task-a', 'status.json'), 'utf8'), beforeA);
        assert.equal(fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, 'task-b'), 'task-b', 'status.json'), 'utf8'), beforeB);
    });
});

// ── Amendment 1: round-aware reroute evidence gates (P1/P2) ──────────────────

void test('sliceRerouteRoundSection matches only the round-specific section', () => {
    const has = (c: string, l: string, r: number): boolean => sliceRerouteRoundSection(c, l, r) !== null;
    // Round 1 = bare heading.
    assert.equal(has('## Amendment Review\n- [x] Approved', 'Amendment Review', 1), true);
    // Round 1 must reject an original review with no amendment-review section.
    assert.equal(has('## Verdict\n- [x] Approved\n', 'Amendment Review', 1), false);
    // Round 1 must reject a round-2-only heading (end-of-line anchor).
    assert.equal(has('## Amendment Review Round 2\n', 'Amendment Review', 1), false);
    // Round 2 matches "Round 2" and rejects round-1-only / round-3.
    assert.equal(has('## Amendment Review Round 2\n', 'Amendment Review', 2), true);
    assert.equal(has('## Amendment Review\n', 'Amendment Review', 2), false);
    assert.equal(has('## Amendment Review Round 3\n', 'Amendment Review', 2), false);
    // Single-line anchoring: bare round-1 heading + body text "Round 2" ≠ round 2.
    assert.equal(has('## Amendment Review\nRound 2 notes\n', 'Amendment Review', 2), false);
    // Tolerant of heading level and extra horizontal whitespace.
    assert.equal(has('###   Amendment   Review   Round   2  \n', 'Amendment Review', 2), true);
    // Reroute Plan label.
    assert.equal(has('## Reroute Plan\n### Delta\n', 'Reroute Plan', 1), true);
    assert.equal(has('## Reroute Plan Round 2\n', 'Reroute Plan', 2), true);
    assert.equal(has('## Reroute Plan\n', 'Reroute Plan', 2), false);

    // Returns ONLY the current round's section — excludes an earlier first-pass
    // verdict block above it (the basis for scoping the reroute verdict).
    const sr = '## Verdict\n- [x] **Approved**\n\n## Amendment Review\n- [x] **Changes requested**\n';
    const slice = sliceRerouteRoundSection(sr, 'Amendment Review', 1);
    assert.ok(slice !== null && slice.includes('Changes requested') && !slice.includes('## Verdict'));
    assert.equal(sliceRerouteRoundSection(sr, 'Amendment Review', 2), null);

    // A heading-like line inside a fenced code block must NOT truncate the section
    // before the verdict checkbox below it (P2 hardening).
    const fenced = '## Amendment Review\n```md\n## not a real heading\n```\n- [x] **Approved**\n';
    const fencedSlice = sliceRerouteRoundSection(fenced, 'Amendment Review', 1);
    assert.ok(fencedSlice !== null && fencedSlice.includes('- [x] **Approved**'));
    // A round heading that only appears inside a fence is not a real heading.
    assert.equal(sliceRerouteRoundSection('```\n## Amendment Review\n```\n', 'Amendment Review', 1), null);

    // A fenced block INSIDE an HTML comment must not corrupt comment/fence state.
    const cf = '## Amendment Review\n- [x] **Approved**\n<!--\n```\n## x\n```\n-->\n## Next\n- [x] **Changes requested**\n';
    const cfSlice = sliceRerouteRoundSection(cf, 'Amendment Review', 1);
    assert.ok(cfSlice !== null && cfSlice.includes('- [x] **Approved**') && !cfSlice.includes('Changes requested'));
});

void test('checkRerouteEvidence is the shared reroute-evidence invariant', () => {
    const reroute = (round?: number) => round === undefined
        ? { phases: { implement: { rerouted: true } } }
        : { phases: { implement: { rerouted: true, reroute_count: round } } };
    const firstPass = { phases: { implement: { rerouted: false, reroute_count: 0 } } };

    // Not a reroute → caller uses first-pass logic.
    assert.deepEqual(checkRerouteEvidence('spec_review', '## Amendment Review\n- [x] **Approved**\n', firstPass), { reroute: false });
    assert.deepEqual(
        checkRerouteEvidence('spec_review', '## Verdict\n- [x] **Approved**\n', {
            phases: { implement: { rerouted: true, reroute_count: 1, reroute_exempt: true } },
        }),
        { reroute: false },
    );
    assert.deepEqual(
        checkRerouteEvidence('plan', '# Plan\n\n## Steps\n1. unchanged\n', {
            phases: { implement: { rerouted: true, reroute_count: 1, reroute_exempt: true } },
        }),
        { reroute: false },
    );
    assert.deepEqual(
        checkRerouteEvidence('spec_review', '## Verdict\n- [x] **Approved**\n', {
            phases: {
                implement: {
                    rerouted: true,
                    reroute_count: 1,
                    reroute_exempt: true,
                    reroute_exempt_prior_verdict: 'changes_requested',
                },
            },
        }),
        { reroute: false },
    );

    // Reroute but reroute_count missing/invalid → fail closed (R4 P2).
    let r = checkRerouteEvidence('spec_review', '## Amendment Review\n- [x] **Approved**\n', reroute(undefined));
    assert.ok(r.reroute && !r.ok && /reroute_count/.test(r.reason));
    r = checkRerouteEvidence('plan', '## Reroute Plan\n', reroute(0));
    assert.ok(r.reroute && !r.ok);

    // A present-but-non-boolean `rerouted` is a corrupted reroute signal → fail
    // closed (must not silently fall back to first-pass).
    r = checkRerouteEvidence('spec_review', '## Amendment Review\n- [x] **Approved**\n', { phases: { implement: { rerouted: 'true' } } });
    assert.ok(r.reroute && !r.ok && /not a boolean/.test(r.reason));
    // A missing implement entry can't be a reroute (reroute implies implemented) →
    // first-pass, NOT fail-closed.
    assert.deepEqual(checkRerouteEvidence('plan', '## Reroute Plan\n', {}), { reroute: false });
    // code_review is never reroute-gated, even with a corrupt status.
    assert.deepEqual(checkRerouteEvidence('code_review', 'x', { phases: { implement: { rerouted: 'true' } } }), { reroute: false });

    // spec_review reroute: verdict scoped to the round section — a Changes
    // requested amendment below a stale Approved box yields changes_requested.
    r = checkRerouteEvidence('spec_review', '## Verdict\n- [x] **Approved**\n## Amendment Review\n- [x] **Changes requested**\n', reroute(1));
    assert.ok(r.reroute && r.ok && r.verdict === 'changes_requested');
    // Approved amendment → approved.
    r = checkRerouteEvidence('spec_review', '## Verdict\n- [x] **Approved**\n## Amendment Review\n- [x] **Approved**\n', reroute(1));
    assert.ok(r.reroute && r.ok && r.verdict === 'approved');
    // Missing amendment section → reject.
    r = checkRerouteEvidence('spec_review', '## Verdict\n- [x] **Approved**\n', reroute(1));
    assert.ok(r.reroute && !r.ok && /Amendment Review/.test(r.reason));
    // Section present, no checked box → reject.
    r = checkRerouteEvidence('spec_review', '## Amendment Review\n(no box)\n', reroute(1));
    assert.ok(r.reroute && !r.ok && /verdict box/.test(r.reason));

    // plan reroute: requires the round's Reroute Plan section, carries no verdict.
    r = checkRerouteEvidence('plan', '# Plan\n## Steps\n1. x\n## Reroute Plan\n- delta\n', reroute(1));
    assert.ok(r.reroute && r.ok && r.verdict === undefined);
    r = checkRerouteEvidence('plan', '# Plan\n## Steps\n1. x\n', reroute(1));
    assert.ok(r.reroute && !r.ok && /Reroute Plan/.test(r.reason));
    // round 2 needs the Round 2 heading; the stale round-1 section is insufficient.
    r = checkRerouteEvidence('plan', '## Reroute Plan\n- old\n', reroute(2));
    assert.ok(r.reroute && !r.ok);
    r = checkRerouteEvidence('plan', '## Reroute Plan\n- old\n## Reroute Plan Round 2\n- new\n', reroute(2));
    assert.ok(r.reroute && r.ok);

    // code_review is not reroute-gated by this helper.
    assert.deepEqual(checkRerouteEvidence('code_review', 'anything', reroute(1)), { reroute: false });
});

function runTryEvidenceAdvance(
    cwd: string,
    taskId: string,
    phase: string,
): { advanced: boolean; verdict?: string; note: string } {
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        CANON_WORKTREES_ROOT: path.join(cwd, 'worktrees'),
    };
    delete env.CANON_TASKS_DIR_OVERRIDE;
    const result = spawnSync(process.execPath, [
        '--import', MD_LOADER,
        '--import', TSX_LOADER,
        '-e',
        [
            `import { tryEvidenceAdvance } from ${JSON.stringify(MAIN_URL)};`,
            `const r = tryEvidenceAdvance(${JSON.stringify(taskId)}, ${JSON.stringify(phase)});`,
            `process.stdout.write('RESULT:' + JSON.stringify(r));`,
        ].join('\n'),
    ], { cwd, encoding: 'utf8', env });
    const m = (result.stdout ?? '').match(/RESULT:(\{.*\})/);
    if (!m) throw new Error(`no tryEvidenceAdvance result; stdout=${result.stdout} stderr=${result.stderr}`);
    return JSON.parse(m[1]) as { advanced: boolean; verdict?: string; note: string };
}

void test('reroute spec_review evidence gate scopes the verdict to the current round amendment review (AC-15 / P1)', () => {
    withTempDir('reroute-evidence-', (dir) => {
        initGitRepo(dir);
        const taskId = 'evidence-sr';
        const status = makeRerouteStatus(taskId, 'task/evidence-sr', 1, {
            worktree: false,
            implement: { status: 'done', agent: 'codex', reroute_count: 1, rerouted: true },
            specReview: { status: 'pending' },
        });
        writeTaskStatus(path.join(dir, 'tasks'), taskId, status);
        const reviewPath = path.join(dir, 'tasks', taskId, 'spec-review.md');
        // Original approved review, no fresh "## Amendment Review" section → reject.
        const original = '# Spec Review\n\n## Verdict\n- [x] **Approved** — implementable as written\n';
        fs.writeFileSync(reviewPath, original);
        const stale = runTryEvidenceAdvance(dir, taskId, 'spec_review');
        assert.equal(stale.advanced, false, stale.note);
        assert.match(stale.note, /Amendment Review/);

        // The original approved box is still present, but the fresh amendment
        // review is Changes requested — the verdict must reflect the AMENDMENT,
        // not the stale original approval (the exact bug Codex's PR review caught).
        fs.writeFileSync(reviewPath, `${original}\n## Amendment Review\n- [x] **Changes requested** — amendment contradicts AC-3\n`);
        const cr = runTryEvidenceAdvance(dir, taskId, 'spec_review');
        assert.equal(cr.advanced, true, cr.note);
        assert.equal(cr.verdict, 'changes_requested', cr.note);

        // Amendment review approved → approved.
        fs.writeFileSync(reviewPath, `${original}\n## Amendment Review\n- [x] **Approved**\n`);
        const ok = runTryEvidenceAdvance(dir, taskId, 'spec_review');
        assert.equal(ok.advanced, true, ok.note);
        assert.equal(ok.verdict, 'approved', ok.note);

        // Amendment section present but no verdict box checked → reject.
        fs.writeFileSync(reviewPath, `${original}\n## Amendment Review\n(no verdict yet)\n`);
        const noVerdict = runTryEvidenceAdvance(dir, taskId, 'spec_review');
        assert.equal(noVerdict.advanced, false, noVerdict.note);
    });
});

void test('first-pass spec_review evidence gate still advances on a normal review (AC-15 regression)', () => {
    withTempDir('reroute-evidence-', (dir) => {
        initGitRepo(dir);
        const taskId = 'evidence-fp';
        const status = makeRerouteStatus(taskId, 'task/evidence-fp', 0, {
            worktree: false,
            implement: { status: 'pending', agent: 'codex' }, // rerouted falsy → first pass
            specReview: { status: 'pending' },
        });
        writeTaskStatus(path.join(dir, 'tasks'), taskId, status);
        fs.writeFileSync(path.join(dir, 'tasks', taskId, 'spec-review.md'),
            '# Spec Review\n\n## Verdict\n- [x] **Approved**\n');
        const r = runTryEvidenceAdvance(dir, taskId, 'spec_review');
        assert.equal(r.advanced, true, r.note);
    });
});

void test('reroute plan evidence gate rejects the stale original plan, accepts a fresh reroute plan (AC-16 / P2)', () => {
    withTempDir('reroute-evidence-', (dir) => {
        initGitRepo(dir);
        const taskId = 'evidence-plan';
        const status = makeRerouteStatus(taskId, 'task/evidence-plan', 1, {
            worktree: false,
            implement: { status: 'done', agent: 'codex', reroute_count: 1, rerouted: true },
            plan: { status: 'pending', agent: 'claude' },
        });
        writeTaskStatus(path.join(dir, 'tasks'), taskId, status);
        const planPath = path.join(dir, 'tasks', taskId, 'plan.md');
        fs.writeFileSync(planPath, '# Plan\n\n## Steps\n1. original step\n');
        const stale = runTryEvidenceAdvance(dir, taskId, 'plan');
        assert.equal(stale.advanced, false, stale.note);
        assert.match(stale.note, /Reroute Plan/);

        fs.appendFileSync(planPath, '\n## Reroute Plan\n### Delta\n- new step\n');
        const fresh = runTryEvidenceAdvance(dir, taskId, 'plan');
        assert.equal(fresh.advanced, true, fresh.note);
    });
});
