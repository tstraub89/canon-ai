import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { autoBlockPhase, readStatus } from '../scripts/run-task/state.js';
import { autoBlockSpecReview } from '../scripts/run-task/phases/spec-review.js';
import type { StatusJson } from '../scripts/run-task/types.js';

const TASK_SH = path.resolve('scripts/task.sh');

function makeStatus(taskId: string, overrides: Partial<StatusJson> = {}): StatusJson {
    return {
        id: taskId,
        title: `Counter schema test ${taskId}`,
        status: 'spec_review',
        created: '2026-05-11',
        updated: '2026-05-11',
        branch: '',
        base_branch: 'dev',
        task_size: 'S',
        delicate: false,
        human_spec_gate: false,
        worktree: false,
        phases: {
            spec: { status: 'done', agent: 'claude' },
            spec_review: {
                status: 'pending',
                agent: 'codex',
                verdict: '',
                iterations: 0,
            },
            plan: { status: 'done', agent: 'claude' },
            implement: { status: 'done', agent: 'codex' },
            code_review: {
                status: 'done',
                agent: 'claude',
                verdict: 'approved',
                iterations: 0,
            },
            qa: { status: 'pending', agent: 'claude' },
            human_review: { status: 'pending', agent: 'human' },
        },
        escalations: [],
        sessions: {},
        ...overrides,
    };
}

function withTempTasks<T>(fn: (root: string) => T): T {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'counter-schema-'));
    const previousOverride = process.env.CANON_TASKS_DIR_OVERRIDE;
    process.env.CANON_TASKS_DIR_OVERRIDE = root;
    try {
        fs.mkdirSync(path.join(root, 'tasks'), { recursive: true });
        return fn(root);
    } finally {
        if (previousOverride === undefined) {
            delete process.env.CANON_TASKS_DIR_OVERRIDE;
        } else {
            process.env.CANON_TASKS_DIR_OVERRIDE = previousOverride;
        }
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function writeTask(root: string, taskId: string, status: StatusJson, specReviewContent = '# old review\n'): void {
    const taskDir = path.join(root, 'tasks', taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(taskDir, 'spec-review.md'), specReviewContent, 'utf8');
    const overrideTaskDir = path.join(root, taskId);
    try {
        fs.symlinkSync(path.join('tasks', taskId), overrideTaskDir, 'dir');
    } catch {
        // Some environments block symlink creation. The shell-path tests still
        // cover the jq behavior; only the CANON_TASKS_DIR_OVERRIDE reads lose
        // the mirror path in that case.
    }
}

function readTaskStatus(root: string, taskId: string): StatusJson {
    return JSON.parse(fs.readFileSync(path.join(root, 'tasks', taskId, 'status.json'), 'utf8')) as StatusJson;
}

function runTaskSh(root: string, args: string[]): string {
    return execFileSync('bash', [TASK_SH, ...args], {
        cwd: root,
        env: {
            PATH: process.env.PATH ?? '',
            HOME: process.env.HOME ?? '',
            // Counter-schema tests don't materialize phase artifacts; bypass the
            // gate so we can exercise the jq counter math directly. The gate's
            // own tests (run-task-validation.test.ts) cover its enforcement.
            CANON_SKIP_PHASE_GATE: '1',
        },
        encoding: 'utf8',
    });
}

void test('task.sh phase seeds cumulative counters from legacy iterations without a verdict', () => {
    withTempTasks(root => {
        const taskId = 'legacy-seed';
        const status = makeStatus(taskId, {
            phases: {
                ...makeStatus(taskId).phases,
                spec_review: {
                    status: 'pending',
                    agent: 'codex',
                    verdict: '',
                    iterations: 3,
                },
            },
        });
        writeTask(root, taskId, status);

        runTaskSh(root, ['phase', taskId, 'spec_review', 'in_progress']);

        const updated = readTaskStatus(root, taskId);
        assert.equal(updated.phases.spec_review?.iterations_current_loop, 3);
        assert.equal(updated.phases.spec_review?.iterations_total, 3);
        assert.equal(updated.phases.spec_review?.changes_requested_total, 0);
        assert.equal(updated.phases.spec_review?.auto_block_count, 0);
        assert.equal(updated.phases.spec_review?.iterations, 3);
    });
});

void test('task.sh phase increments all counters on changes_requested and keeps the alias in sync', () => {
    withTempTasks(root => {
        const taskId = 'changes-requested';
        writeTask(root, taskId, makeStatus(taskId));

        runTaskSh(root, ['phase', taskId, 'spec_review', 'done', 'changes_requested']);

        const updated = readTaskStatus(root, taskId);
        assert.equal(updated.phases.spec_review?.iterations_current_loop, 1);
        assert.equal(updated.phases.spec_review?.iterations_total, 1);
        assert.equal(updated.phases.spec_review?.changes_requested_total, 1);
        assert.equal(updated.phases.spec_review?.auto_block_count, 0);
        assert.equal(updated.phases.spec_review?.iterations, 1);
    });
});

void test('task.sh phase increments total and resets the loop on approved', () => {
    withTempTasks(root => {
        const taskId = 'approved-once';
        writeTask(root, taskId, makeStatus(taskId));

        runTaskSh(root, ['phase', taskId, 'spec_review', 'done', 'approved']);

        const updated = readTaskStatus(root, taskId);
        assert.equal(updated.phases.spec_review?.iterations_current_loop, 0);
        assert.equal(updated.phases.spec_review?.iterations_total, 1);
        assert.equal(updated.phases.spec_review?.changes_requested_total, 0);
        assert.equal(updated.phases.spec_review?.auto_block_count, 0);
        assert.equal(updated.phases.spec_review?.iterations, 0);
    });
});

void test('task.sh phase accumulates current-loop and total counts across a changes_requested -> approved sequence', () => {
    withTempTasks(root => {
        const taskId = 'round-sequence';
        writeTask(root, taskId, makeStatus(taskId));

        runTaskSh(root, ['phase', taskId, 'spec_review', 'done', 'changes_requested']);
        runTaskSh(root, ['phase', taskId, 'spec_review', 'done', 'approved']);

        const updated = readTaskStatus(root, taskId);
        assert.equal(updated.phases.spec_review?.iterations_current_loop, 0);
        assert.equal(updated.phases.spec_review?.iterations_total, 2);
        assert.equal(updated.phases.spec_review?.changes_requested_total, 1);
        assert.equal(updated.phases.spec_review?.auto_block_count, 0);
        assert.equal(updated.phases.spec_review?.iterations, 0);
    });
});

void test('autoBlockPhase increments auto_block_count alongside the escalation record', () => {
    withTempTasks(root => {
        const taskId = 'autoblock-phase';
        writeTask(root, taskId, makeStatus(taskId, {
            phases: {
                ...makeStatus(taskId).phases,
                code_review: {
                    status: 'pending',
                    agent: 'claude',
                    verdict: '',
                    iterations: 0,
                },
            },
        }));

        autoBlockPhase([taskId], 'code_review', 4, 'limit reached');

        const updated = readStatus(taskId);
        assert.equal(updated.phases.code_review?.status, 'blocked');
        assert.equal(updated.phases.code_review?.auto_block_count, 1);
        assert.deepEqual(updated.escalations, [
            {
                date: updated.escalations?.[0]?.date,
                phase: 'code_review',
                iteration_count: 4,
                reason: 'limit reached',
            },
        ]);
    });
});

void test('autoBlockSpecReview increments auto_block_count alongside the escalation record', () => {
    withTempTasks(root => {
        const taskId = 'autoblock-spec-review';
        writeTask(root, taskId, makeStatus(taskId));

        autoBlockSpecReview([taskId], 3, 'spec loop cap reached');

        const updated = readStatus(taskId);
        assert.equal(updated.phases.spec_review?.status, 'blocked');
        assert.equal(updated.phases.spec_review?.auto_block_count, 1);
        assert.deepEqual(updated.escalations, [
            {
                date: updated.escalations?.[0]?.date,
                phase: 'spec_review',
                iteration_count: 3,
                reason: 'spec loop cap reached',
            },
        ]);
    });
});

void test('cmd_reset_spec_review resets only the current loop and alias counters', () => {
    withTempTasks(root => {
        const taskId = 'reset-spec-review';
        writeTask(root, taskId, makeStatus(taskId, {
            phases: {
                ...makeStatus(taskId).phases,
                spec_review: {
                    status: 'blocked',
                    agent: 'codex',
                    verdict: 'changes_requested',
                    iterations: 2,
                    iterations_current_loop: 2,
                    iterations_total: 5,
                    changes_requested_total: 3,
                    auto_block_count: 1,
                },
            },
        }));

        runTaskSh(root, ['reset-spec-review', taskId]);

        const updated = readTaskStatus(root, taskId);
        assert.equal(updated.phases.spec_review?.status, 'pending');
        assert.equal(updated.phases.spec_review?.iterations_current_loop, 0);
        assert.equal(updated.phases.spec_review?.iterations_total, 5);
        assert.equal(updated.phases.spec_review?.changes_requested_total, 3);
        assert.equal(updated.phases.spec_review?.auto_block_count, 1);
        assert.equal(fs.existsSync(path.join(root, 'tasks', taskId, 'spec-review-prior-1.md')), true);
    });
});
