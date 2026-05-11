import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { RUNTIME_CHECKS, type RuntimeCheck } from '../scripts/pipeline-policy.ts';
import { REPO_ROOT } from '../scripts/run-task/env.ts';
import { buildPipelineState } from '../scripts/run-task/main.ts';
import { promptImplementRevisions } from '../scripts/run-task/prompts/index.ts';
import { shouldUseImplementRevision } from '../scripts/run-task/phases/implement.ts';
import { runRuntimeValidationPhase } from '../scripts/run-task/phases/runtime-validation.ts';
import { computeLatestRuntimeResults, parseHandoffFiles } from '../scripts/run-task/validation.ts';
import type { PipelineState, StatusJson } from '../scripts/run-task/types.ts';

let taskCounter = 0;

function nextTaskId(label: string): string {
    taskCounter += 1;
    return `rtv-${process.pid}-${taskCounter}-${label}`;
}

function taskDir(taskId: string): string {
    return path.join(REPO_ROOT, 'tasks', taskId);
}

function statusPath(taskId: string): string {
    return path.join(taskDir(taskId), 'status.json');
}

function handoffPath(taskId: string): string {
    return path.join(taskDir(taskId), 'handoff.md');
}

function baseStatus(taskId: string, runtimeIterations = 0, codeReviewIterations = 0): StatusJson {
    return {
        id: taskId,
        title: `Runtime validation test ${taskId}`,
        status: 'runtime_validation',
        created: '2026-05-11',
        updated: '2026-05-11',
        branch: '',
        base_branch: 'dev',
        task_size: 'M',
        delicate: false,
        human_spec_gate: false,
        worktree: false,
        phases: {
            spec: { status: 'done', agent: 'claude' },
            spec_review: { status: 'done', agent: 'codex', verdict: 'approved', iterations: 0 },
            plan: { status: 'done', agent: 'claude' },
            implement: { status: 'done', agent: 'codex' },
            runtime_validation: {
                status: 'pending',
                agent: 'orchestrator',
                verdict: runtimeIterations > 0 ? 'changes_requested' : '',
                iterations: runtimeIterations,
            },
            code_review: { status: 'pending', agent: 'claude', verdict: '', iterations: codeReviewIterations },
            qa: { status: 'pending', agent: 'claude' },
            human_review: { status: 'pending', agent: 'human' },
        },
        escalations: [],
        sessions: {},
    };
}

function baseHandoff(changedFile = 'scripts/run-task/types.ts'): string {
    return [
        '# Implementation Handoff: test',
        '',
        '## Changes',
        '',
        '| File | What Changed |',
        '|---|---|',
        `| \`${changedFile}\` | test fixture |`,
        '',
        '## Validation Outcomes',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| `npm run lint` | Pass | fixture |',
        '',
        '## Ready for Review',
        '',
        '- [x] All spec ACs met',
        '',
    ].join('\n');
}

function createTask(label: string, options: {
    runtimeIterations?: number;
    codeReviewIterations?: number;
    handoff?: string;
} = {}): string {
    const taskId = nextTaskId(label);
    fs.mkdirSync(taskDir(taskId), { recursive: true });
    fs.writeFileSync(statusPath(taskId), `${JSON.stringify(
        baseStatus(taskId, options.runtimeIterations ?? 0, options.codeReviewIterations ?? 0),
        null,
        2,
    )}\n`);
    fs.writeFileSync(handoffPath(taskId), options.handoff ?? baseHandoff());
    return taskId;
}

function cleanupTask(taskId: string): void {
    fs.rmSync(taskDir(taskId), { recursive: true, force: true });
}

function stateFor(taskId: string): PipelineState {
    return buildPipelineState([taskId]);
}

async function runPhase(taskId: string, checks: readonly RuntimeCheck[]): Promise<void> {
    await runRuntimeValidationPhase([taskId], stateFor(taskId), checks);
}

function readStatusFile(taskId: string): StatusJson {
    return JSON.parse(fs.readFileSync(statusPath(taskId), 'utf8')) as StatusJson;
}

function readHandoff(taskId: string): string {
    return fs.readFileSync(handoffPath(taskId), 'utf8');
}

async function captureProcessOutput(fn: () => Promise<void>): Promise<{ stdout: string; stderr: string }> {
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    let stdout = '';
    let stderr = '';
    process.stdout.write = (chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), cb?: (error?: Error | null) => void) => {
        stdout += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        if (typeof encoding === 'function') return originalStdoutWrite(chunk, encoding);
        return originalStdoutWrite(chunk, encoding, cb);
    };
    process.stderr.write = (chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), cb?: (error?: Error | null) => void) => {
        stderr += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        if (typeof encoding === 'function') encoding();
        if (cb) cb();
        return true;
    };
    try {
        await fn();
        return { stdout, stderr };
    } finally {
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
    }
}

void test('runtime validation: empty registry is a no-op with approved verdict and no handoff write', async () => {
    const taskId = createTask('empty');
    const before = readHandoff(taskId);
    try {
        await runPhase(taskId, []);
        assert.equal(readHandoff(taskId), before);
        const status = readStatusFile(taskId);
        assert.equal(status.phases.runtime_validation?.status, 'done');
        assert.equal(status.phases.runtime_validation?.verdict, 'approved');
        assert.equal(status.phases.runtime_validation?.iterations, 0);
        assert.equal(readHandoff(taskId).includes('## Runtime Validation Outcomes'), false);
    } finally {
        cleanupTask(taskId);
    }
});

void test('runtime validation: passing, failing, filtered, and timeout checks write expected status and rows', async () => {
    const passTask = createTask('pass');
    const failTask = createTask('fail');
    const filterTask = createTask('filter');
    const timeoutTask = createTask('timeout');
    try {
        await runPhase(passTask, [{ name: 'pass-check', command: 'node -e "console.log(\'ok\')"' }]);
        assert.match(readHandoff(passTask), /## Runtime Validation Outcomes/);
        assert.match(readHandoff(passTask), /\| `pass-check` \| Pass \|/);
        assert.equal(readStatusFile(passTask).phases.runtime_validation?.verdict, 'approved');
        assert.equal(fs.existsSync(path.join(taskDir(passTask), 'runtime-check-output')), false);

        await runPhase(failTask, [{ name: 'fail-check', command: 'node -e "console.error(\'boom\'); process.exit(1)"' }]);
        const failHandoff = readHandoff(failTask);
        assert.match(failHandoff, /\| `fail-check` \| Fail \|/);
        assert.match(failHandoff, /boom/);
        assert.match(failHandoff, /artifacts: tasks\/.*\/runtime-check-output\/fail-check\/iter-1\//);
        assert.equal(readStatusFile(failTask).phases.runtime_validation?.status, 'done');
        assert.equal(readStatusFile(failTask).phases.runtime_validation?.verdict, 'changes_requested');
        assert.equal(readStatusFile(failTask).phases.runtime_validation?.iterations, 1);

        await runPhase(filterTask, [{ name: 'filtered-check', command: 'node -e "process.exit(99)"', when: () => false }]);
        assert.equal(readHandoff(filterTask).includes('filtered-check'), false);
        assert.equal(readStatusFile(filterTask).phases.runtime_validation?.verdict, 'approved');

        await runPhase(timeoutTask, [{ name: 'timeout-check', command: 'node -e "setTimeout(() => {}, 10000)"', timeoutMs: 100 }]);
        assert.match(readHandoff(timeoutTask), /\| `timeout-check` \| Timeout \| 0\.1s \|/);
        assert.equal(readStatusFile(timeoutTask).phases.runtime_validation?.verdict, 'changes_requested');
    } finally {
        cleanupTask(passTask);
        cleanupTask(failTask);
        cleanupTask(filterTask);
        cleanupTask(timeoutTask);
    }
});

void test('runtime validation: latest re-run result wins', async () => {
    const taskId = createTask('rerun');
    try {
        await runPhase(taskId, [{ name: 'rerun-check', command: 'node -e "console.error(\'first\'); process.exit(1)"' }]);
        fs.appendFileSync(handoffPath(taskId), '\n## Iteration 2 — addressing runtime validation\n\n### Findings addressed\n\n- fixed\n');
        const status = readStatusFile(taskId);
        status.phases.implement = { status: 'done', agent: 'codex' };
        status.phases.runtime_validation = { status: 'pending', agent: 'orchestrator', verdict: 'changes_requested', iterations: 1 };
        fs.writeFileSync(statusPath(taskId), `${JSON.stringify(status, null, 2)}\n`);

        await runPhase(taskId, [{ name: 'rerun-check', command: 'node -e "console.error(\'second\')"' }]);
        const handoff = readHandoff(taskId);
        assert.match(handoff, /### Re-run runtime validation/);
        const latest = computeLatestRuntimeResults(handoff);
        assert.equal(latest.get('rerun-check')?.result, 'Pass');
        assert.equal(readStatusFile(taskId).phases.runtime_validation?.iterations, 0);
    } finally {
        cleanupTask(taskId);
    }
});

void test('runtime validation: cwd option, scoped cleanup, artifacts, and dirty task artifact preservation', async () => {
    const passTask = createTask('cleanup-pass');
    const failTask = createTask('cleanup-fail');
    const dirtyTask = createTask('dirty-preserve');
    const passFile = `rtv-pass-${process.pid}.txt`;
    const failFile = `rtv-fail-${process.pid}.txt`;
    const dirtyFile = `rtv-preexisting-${process.pid}.txt`;
    try {
        await runPhase(passTask, [{
            name: 'worktree-cwd-pass',
            cwd: 'worktree',
            command: `node -e 'if (process.cwd() !== ${JSON.stringify(REPO_ROOT)}) process.exit(2); require("fs").writeFileSync(${JSON.stringify(passFile)}, "x")'`,
        }]);
        assert.equal(fs.existsSync(path.join(REPO_ROOT, passFile)), false);

        await runPhase(failTask, [{
            name: 'repo-root-cwd-fail',
            cwd: 'repo_root',
            command: `node -e 'if (process.cwd() !== ${JSON.stringify(REPO_ROOT)}) process.exit(2); require("fs").writeFileSync(${JSON.stringify(failFile)}, "artifact"); process.exit(1)'`,
        }]);
        assert.equal(fs.existsSync(path.join(REPO_ROOT, failFile)), false);
        assert.equal(
            fs.readFileSync(path.join(taskDir(failTask), 'runtime-check-output', 'repo-root-cwd-fail', 'iter-1', failFile), 'utf8'),
            'artifact',
        );

        const handoffBefore = `${readHandoff(dirtyTask)}\n<!-- dirty marker -->\n`;
        const notesBefore = 'pre-existing notes\n';
        fs.writeFileSync(handoffPath(dirtyTask), handoffBefore);
        fs.writeFileSync(path.join(taskDir(dirtyTask), 'notes.md'), notesBefore);
        fs.writeFileSync(path.join(REPO_ROOT, dirtyFile), 'pre-existing source dirty');
        await runPhase(dirtyTask, [{
            name: 'preserve-dirty',
            command: `node -e "require('fs').writeFileSync('rtv-induced-${process.pid}.txt', 'new'); process.exit(1)"`,
        }]);
        assert.match(readHandoff(dirtyTask), /<!-- dirty marker -->/);
        assert.equal(fs.readFileSync(path.join(taskDir(dirtyTask), 'notes.md'), 'utf8'), notesBefore);
        assert.equal(fs.readFileSync(path.join(REPO_ROOT, dirtyFile), 'utf8'), 'pre-existing source dirty');
        assert.equal(fs.existsSync(path.join(REPO_ROOT, `rtv-induced-${process.pid}.txt`)), false);
    } finally {
        cleanupTask(passTask);
        cleanupTask(failTask);
        cleanupTask(dirtyTask);
        fs.rmSync(path.join(REPO_ROOT, passFile), { force: true });
        fs.rmSync(path.join(REPO_ROOT, failFile), { force: true });
        fs.rmSync(path.join(REPO_ROOT, dirtyFile), { force: true });
        fs.rmSync(path.join(REPO_ROOT, `rtv-induced-${process.pid}.txt`), { force: true });
    }
});

void test('runtime validation: declared artifactPaths preserve gitignored files and missing paths log without aborting', async () => {
    const taskId = createTask('artifact-paths');
    const ignoredDir = path.join(REPO_ROOT, 'fixtures', 'ignored-output');
    try {
        const output = await captureProcessOutput(async () => {
            await runPhase(taskId, [{
                name: 'declared-artifacts',
                command: [
                    'node -e "',
                    "require('fs').mkdirSync('fixtures/ignored-output', { recursive: true });",
                    "require('fs').writeFileSync('fixtures/ignored-output/report.log', 'ignored report');",
                    "console.error('artifact stderr');",
                    'process.exit(1)"',
                ].join(''),
                artifactPaths: ['fixtures/ignored-output/', 'fixtures/missing-output/'],
            }]);
        });
        const status = await import('../scripts/run-task/git.ts').then(({ gitSafeAtRaw }) =>
            gitSafeAtRaw(REPO_ROOT, 'status', '--porcelain=v1', '-uall', '--', 'fixtures/ignored-output/report.log')
        );
        assert.equal(status.stdout.trim(), '');
        assert.equal(
            fs.readFileSync(path.join(taskDir(taskId), 'runtime-check-output', 'declared-artifacts', 'iter-1', 'fixtures', 'ignored-output', 'report.log'), 'utf8'),
            'ignored report',
        );
        assert.match(output.stderr, /artifactPath 'fixtures\/missing-output\/' not found - skipping/);
    } finally {
        cleanupTask(taskId);
        fs.rmSync(ignoredDir, { recursive: true, force: true });
    }
});

void test('runtime validation: prompt uses stderr.log first, then handoff excerpt fallback, and includes hint', async () => {
    const taskId = createTask('prompt');
    const check: RuntimeCheck = {
        name: 'prompt-check',
        command: 'node -e "process.stderr.write(\'A\'.repeat(3072)); process.exit(1)"',
        artifactReadingHint: 'Open the trace viewer before editing.',
    };
    RUNTIME_CHECKS.push(check);
    try {
        await captureProcessOutput(async () => {
            await runPhase(taskId, [check]);
        });
        const prompt = promptImplementRevisions(stateFor(taskId));
        assert.match(prompt, /\[ITERATION 2 - addressing runtime validation failures\]|\[ITERATION 2 — addressing runtime validation failures\]/);
        assert.match(prompt, /## Runtime check failures to address/);
        assert.doesNotMatch(prompt, /review\.md/);
        assert.match(prompt, /prompt-check/);
        assert.match(prompt, /Open the trace viewer before editing\./);
        assert.ok(prompt.includes(`Artifacts: \`tasks/${taskId}/runtime-check-output/prompt-check/iter-1/\``));
        assert.match(prompt, /READ the artifacts before proposing a fix/);
        assert.match(prompt, /Fix the code, NOT the check/);
        assert.match(prompt, /You cannot re-run this check yourself/);
        assert.match(prompt, /Blind guessing burns iterations toward auto-block/);
        assert.match(prompt, new RegExp(`A{2048}`));
        assert.doesNotMatch(prompt, new RegExp(`A{2049}`));

        fs.rmSync(path.join(taskDir(taskId), 'runtime-check-output', 'prompt-check', 'iter-1', 'stderr.log'), { force: true });
        const fallbackPrompt = promptImplementRevisions(stateFor(taskId));
        assert.match(fallbackPrompt, /stderr\.log missing — using truncated handoff excerpt/);
        assert.match(fallbackPrompt, new RegExp(`A{512}`));
    } finally {
        RUNTIME_CHECKS.pop();
        cleanupTask(taskId);
    }
});

void test('runtime validation: two-tier capture keeps full stderr log but handoff and prompt are bounded', async () => {
    const taskId = createTask('large-stderr');
    try {
        await captureProcessOutput(async () => {
            await runPhase(taskId, [{
                name: 'large-stderr',
                command: 'node -e "require(\'fs\').writeSync(2, \'Z\'.repeat(100 * 1024)); process.exit(1)"',
            }]);
        });
        const stderrLog = fs.readFileSync(path.join(taskDir(taskId), 'runtime-check-output', 'large-stderr', 'iter-1', 'stderr.log'), 'utf8');
        assert.equal(stderrLog, 'Z'.repeat(100 * 1024));
        const latest = computeLatestRuntimeResults(readHandoff(taskId));
        const notes = latest.get('large-stderr')?.notes ?? '';
        assert.match(notes, new RegExp(`Z{512}`));
        assert.doesNotMatch(notes, new RegExp(`Z{513}`));
        const prompt = promptImplementRevisions(stateFor(taskId));
        assert.match(prompt, new RegExp(`Z{2048}`));
        assert.doesNotMatch(prompt, new RegExp(`Z{2049}`));
    } finally {
        cleanupTask(taskId);
    }
});

void test('runtime validation: prompt template supports review-only, runtime-only, and combined shapes', async () => {
    const runtimeTask = createTask('shape-runtime');
    const reviewTask = createTask('shape-review', { codeReviewIterations: 1 });
    const bothTask = createTask('shape-both', { codeReviewIterations: 1 });
    try {
        await runPhase(runtimeTask, [{ name: 'runtime-shape', command: 'node -e "console.error(\'runtime failed\'); process.exit(1)"' }]);
        const runtimeOnly = promptImplementRevisions(stateFor(runtimeTask));
        assert.match(runtimeOnly, /## Runtime check failures to address/);
        assert.doesNotMatch(runtimeOnly, /review\.md/);
        assert.doesNotMatch(runtimeOnly, /## Round 0/);

        const reviewOnly = promptImplementRevisions(stateFor(reviewTask));
        assert.match(reviewOnly, /## Round 1/);
        assert.match(reviewOnly, /review\.md/);
        assert.doesNotMatch(reviewOnly, /## Runtime check failures to address/);

        await runPhase(bothTask, [{ name: 'both-shape', command: 'node -e "console.error(\'runtime failed\'); process.exit(1)"' }]);
        const both = promptImplementRevisions(stateFor(bothTask));
        assert.match(both, /## Round 1/);
        assert.match(both, /## Runtime check failures to address/);
        assert.ok(both.indexOf('review.md') < both.indexOf('## Runtime check failures to address'));
    } finally {
        cleanupTask(runtimeTask);
        cleanupTask(reviewTask);
        cleanupTask(bothTask);
    }
});

void test('runtime validation: buildPipelineState carries runtime iterations and parseHandoffFiles feeds when predicate', async () => {
    const taskId = createTask('state-when');
    try {
        let seenFiles: readonly string[] = [];
        await runPhase(taskId, [{
            name: 'when-sees-files',
            command: 'node -e "console.log(\'ok\')"',
            when: (_status, affectedFiles) => {
                seenFiles = affectedFiles;
                return false;
            },
        }]);
        assert.deepEqual(seenFiles, parseHandoffFiles(taskId));

        const status = readStatusFile(taskId);
        status.phases.runtime_validation = { status: 'pending', agent: 'orchestrator', verdict: 'changes_requested', iterations: 1 };
        fs.writeFileSync(statusPath(taskId), `${JSON.stringify(status, null, 2)}\n`);
        const runtimeState = buildPipelineState([taskId]);
        assert.equal(runtimeState.tasks[0].runtimeIterations, 1);
        assert.equal(runtimeState.tasks[0].iterations, 0);
        assert.equal(shouldUseImplementRevision(runtimeState.tasks), true);
    } finally {
        cleanupTask(taskId);
    }
});

void test('runtime validation: streaming, heartbeat, and summary are emitted to process streams', async () => {
    const taskId = createTask('streaming');
    const previousHeartbeat = process.env.ORCHESTRATOR_CHECK_HEARTBEAT_MS;
    process.env.ORCHESTRATOR_CHECK_HEARTBEAT_MS = '50';
    try {
        const output = await captureProcessOutput(async () => {
            await runPhase(taskId, [{
                name: 'stream-heartbeat',
                command: 'node -e "setTimeout(() => console.log(\'late stdout\'), 140)"',
                timeoutMs: 1000,
            }]);
        });
        assert.match(output.stdout, /late stdout/);
        assert.match(output.stderr, /stream-heartbeat still running/);
        assert.match(output.stderr, /stream-heartbeat finished in/);
    } finally {
        if (previousHeartbeat === undefined) delete process.env.ORCHESTRATOR_CHECK_HEARTBEAT_MS;
        else process.env.ORCHESTRATOR_CHECK_HEARTBEAT_MS = previousHeartbeat;
        cleanupTask(taskId);
    }
});
