import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { autoBlockPhase, readStatus } from '../src/orchestrator/state.js';
import { autoBlockSpecReview } from '../src/orchestrator/phases/spec-review.js';
import { taskPhase, taskPhasePreflightRejected, taskResetSpecReview } from '../src/task/index.js';
import type { StatusJson } from '../src/orchestrator/types.js';

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
        full_send: false,
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
    process.env.CANON_TASKS_DIR_OVERRIDE = path.join(root, 'tasks');
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
}

function readTaskStatus(root: string, taskId: string): StatusJson {
    return JSON.parse(fs.readFileSync(path.join(root, 'tasks', taskId, 'status.json'), 'utf8')) as StatusJson;
}

function withSkippedPhaseGate<T>(fn: () => T): T {
    const previous = process.env.CANON_SKIP_PHASE_GATE;
    process.env.CANON_SKIP_PHASE_GATE = '1';
    try {
        return fn();
    } finally {
        if (previous === undefined) delete process.env.CANON_SKIP_PHASE_GATE;
        else process.env.CANON_SKIP_PHASE_GATE = previous;
    }
}

void test('taskPhase seeds cumulative counters from legacy iterations without a verdict', () => {
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

        withSkippedPhaseGate(() => taskPhase(taskId, 'spec_review', 'in_progress'));

        const updated = readTaskStatus(root, taskId);
        assert.equal(updated.phases.spec_review?.iterations_current_loop, 3);
        assert.equal(updated.phases.spec_review?.iterations_total, 3);
        assert.equal(updated.phases.spec_review?.changes_requested_total, 0);
        assert.equal(updated.phases.spec_review?.auto_block_count, 0);
        assert.equal(updated.phases.spec_review?.iterations, 3);
    });
});

void test('taskPhase increments all counters on changes_requested and keeps the alias in sync', () => {
    withTempTasks(root => {
        const taskId = 'changes-requested';
        writeTask(root, taskId, makeStatus(taskId));

        withSkippedPhaseGate(() => taskPhase(taskId, 'spec_review', 'done', 'changes_requested'));

        const updated = readTaskStatus(root, taskId);
        assert.equal(updated.phases.spec_review?.iterations_current_loop, 1);
        assert.equal(updated.phases.spec_review?.iterations_total, 1);
        assert.equal(updated.phases.spec_review?.changes_requested_total, 1);
        assert.equal(updated.phases.spec_review?.auto_block_count, 0);
        assert.equal(updated.phases.spec_review?.iterations, 1);
    });
});

void test('taskPhasePreflightRejected bumps preflight_rejections counters for auto-block visibility', () => {
    // The auto-block check in src/orchestrator/phases/code-review.ts sums
    // iterations_current_loop + preflight_rejections_current_loop against
    // MAX_REVIEW_LOOPS. Without bumping preflight_rejections_current_loop,
    // persistent pre-flight failures (e.g., malformed Validation Outcomes
    // rows that Codex keeps generating) would bounce implement→pre-flight
    // forever without tripping the cap. (Codex P2 finding.)
    withTempTasks(root => {
        const taskId = 'preflight-counter';
        writeTask(root, taskId, makeStatus(taskId));

        taskPhasePreflightRejected(taskId, 'code_review');
        taskPhasePreflightRejected(taskId, 'code_review');
        taskPhasePreflightRejected(taskId, 'code_review');

        const phase = readTaskStatus(root, taskId).phases.code_review;
        assert.equal(phase?.preflight_rejections_current_loop, 3);
        assert.equal(phase?.preflight_rejections_total, 3);
        // Real review counters still untouched:
        assert.equal(phase?.iterations_current_loop ?? 0, 0);
        assert.equal(phase?.iterations_total ?? 0, 0);
    });
});

void test('approved real review resets preflight_rejections_current_loop alongside iterations', () => {
    // When a real reviewer round finally approves after a streak of pre-flight
    // rejections, the per-loop pre-flight counter must reset so the next
    // distinct review loop starts fresh against the auto-block cap.
    withTempTasks(root => {
        const taskId = 'preflight-then-approved';
        const base = makeStatus(taskId);
        base.phases.spec_review = { status: 'done', agent: 'codex', verdict: 'approved', iterations: 0 };
        writeTask(root, taskId, base);

        taskPhasePreflightRejected(taskId, 'code_review');
        taskPhasePreflightRejected(taskId, 'code_review');
        withSkippedPhaseGate(() => taskPhase(taskId, 'code_review', 'done', 'approved'));

        const phase = readTaskStatus(root, taskId).phases.code_review;
        // Per-loop counters cleared:
        assert.equal(phase?.preflight_rejections_current_loop, 0);
        assert.equal(phase?.iterations_current_loop, 0);
        // Cumulative totals preserved:
        assert.equal(phase?.preflight_rejections_total, 2);
        assert.equal(phase?.changes_requested_total, 2);
    });
});

void test('spec_gap real review increments total and resets the loop like an approval', () => {
    withTempTasks(root => {
        const taskId = 'preflight-then-spec-gap';
        const base = makeStatus(taskId);
        base.phases.spec_review = { status: 'done', agent: 'codex', verdict: 'approved', iterations: 0 };
        writeTask(root, taskId, base);

        taskPhasePreflightRejected(taskId, 'code_review');
        taskPhasePreflightRejected(taskId, 'code_review');
        withSkippedPhaseGate(() => taskPhase(taskId, 'code_review', 'done', 'spec_gap'));

        const phase = readTaskStatus(root, taskId).phases.code_review;
        assert.equal(phase?.verdict, 'spec_gap');
        assert.equal(phase?.preflight_rejections_current_loop, 0);
        assert.equal(phase?.iterations_current_loop, 0);
        assert.equal(phase?.iterations, 0);
        assert.equal(phase?.iterations_total, 1);
        assert.equal(phase?.preflight_rejections_total, 2);
        assert.equal(phase?.changes_requested_total, 2);
    });
});

void test('taskPhasePreflightRejected sets verdict but does NOT bump iteration counters', () => {
    // The bug this fixes: pre-flight rejection was previously calling
    // taskPhase(..., 'changes_requested'), which bumped iterations_current_loop.
    // The next code_review run then saw maxIter > 0 and was issued the round-N
    // prompt, which says "Stage 1 already passed in round 1, do not redo it." But
    // round 1 was just the orchestrator gate — Stage 1 had never run. Tasks that
    // hit a pre-flight rejection then shipped without a real Claude review.
    withTempTasks(root => {
        const taskId = 'preflight-rejection';
        writeTask(root, taskId, makeStatus(taskId));

        taskPhasePreflightRejected(taskId, 'code_review');

        const updated = readTaskStatus(root, taskId);
        const phase = updated.phases.code_review;
        assert.equal(phase?.status, 'done');
        assert.equal(phase?.verdict, 'changes_requested');
        // Telemetry signal preserved:
        assert.equal(phase?.changes_requested_total, 1);
        // Iteration counters MUST stay at 0 so the next reviewer run gets the
        // round-1 prompt with full Stage 1 + Stage 2 framing:
        assert.equal(phase?.iterations_current_loop ?? 0, 0);
        assert.equal(phase?.iterations_total ?? 0, 0);
        assert.equal(phase?.iterations ?? 0, 0);
    });
});

void test('taskPhasePreflightRejected followed by a real changes_requested round counts only the real round', () => {
    // After a pre-flight rejection, the next reviewer invocation should see
    // iterations_current_loop = 0 and get the round-1 prompt. If the reviewer
    // returns changes_requested for real, only then does the iteration counter
    // advance to 1. This sequence catches a regression where the pre-flight
    // path resumed counting iterations.
    withTempTasks(root => {
        const taskId = 'preflight-then-real';
        // code_review requires all prior phases done — set spec_review done
        // (already approved) so the taskPhase call below isn't blocked.
        const base = makeStatus(taskId);
        base.phases.spec_review = { status: 'done', agent: 'codex', verdict: 'approved', iterations: 0 };
        writeTask(root, taskId, base);

        taskPhasePreflightRejected(taskId, 'code_review');
        withSkippedPhaseGate(() => taskPhase(taskId, 'code_review', 'done', 'changes_requested'));

        const updated = readTaskStatus(root, taskId);
        const phase = updated.phases.code_review;
        // Real round counted as round 1:
        assert.equal(phase?.iterations_current_loop, 1);
        assert.equal(phase?.iterations_total, 1);
        // Both rejections (preflight + real) tracked in changes_requested_total:
        assert.equal(phase?.changes_requested_total, 2);
        // Pre-flight streak is cleared by the real review round:
        assert.equal(phase?.preflight_rejections_current_loop, 0);
        // Monotonic pre-flight total is preserved:
        assert.equal(phase?.preflight_rejections_total, 1);
    });
});

void test('taskPhasePreflightRejected followed by a real needs_re_review round resets preflight counter', () => {
    withTempTasks(root => {
        const taskId = 'preflight-then-needs-re-review';
        const base = makeStatus(taskId);
        base.phases.spec_review = { status: 'done', agent: 'codex', verdict: 'approved', iterations: 0 };
        writeTask(root, taskId, base);

        taskPhasePreflightRejected(taskId, 'code_review');
        withSkippedPhaseGate(() => taskPhase(taskId, 'code_review', 'done', 'needs_re_review'));

        const phase = readTaskStatus(root, taskId).phases.code_review;
        assert.equal(phase?.preflight_rejections_current_loop, 0);
        assert.equal(phase?.preflight_rejections_total, 1);
        assert.equal(phase?.iterations_current_loop, 1);
        assert.equal(phase?.changes_requested_total, 2);
    });
});

void test('taskPhasePreflightRejected rejects non-review phases', () => {
    withTempTasks(root => {
        const taskId = 'preflight-wrong-phase';
        writeTask(root, taskId, makeStatus(taskId));

        assert.throws(
            () => taskPhasePreflightRejected(taskId, 'implement'),
            /not a review phase/,
        );
    });
});

void test('taskPhase increments total and resets the loop on approved', () => {
    withTempTasks(root => {
        const taskId = 'approved-once';
        writeTask(root, taskId, makeStatus(taskId));

        withSkippedPhaseGate(() => taskPhase(taskId, 'spec_review', 'done', 'approved'));

        const updated = readTaskStatus(root, taskId);
        assert.equal(updated.phases.spec_review?.iterations_current_loop, 0);
        assert.equal(updated.phases.spec_review?.iterations_total, 1);
        assert.equal(updated.phases.spec_review?.changes_requested_total, 0);
        assert.equal(updated.phases.spec_review?.auto_block_count, 0);
        assert.equal(updated.phases.spec_review?.iterations, 0);
    });
});

void test('taskPhase accumulates current-loop and total counts across a changes_requested -> approved sequence', () => {
    withTempTasks(root => {
        const taskId = 'round-sequence';
        writeTask(root, taskId, makeStatus(taskId));

        withSkippedPhaseGate(() => {
            taskPhase(taskId, 'spec_review', 'done', 'changes_requested');
            taskPhase(taskId, 'spec_review', 'done', 'approved');
        });

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

        taskResetSpecReview(taskId);

        const updated = readTaskStatus(root, taskId);
        assert.equal(updated.phases.spec_review?.status, 'pending');
        assert.equal(updated.phases.spec_review?.iterations_current_loop, 0);
        assert.equal(updated.phases.spec_review?.iterations_total, 5);
        assert.equal(updated.phases.spec_review?.changes_requested_total, 3);
        assert.equal(updated.phases.spec_review?.auto_block_count, 1);
        assert.equal(fs.existsSync(path.join(root, 'tasks', taskId, 'spec-review-prior-1.md')), true);
    });
});
