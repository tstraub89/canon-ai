import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { REPO_ROOT } from '../scripts/run-task/env.js';
import {
    promptCodeReview,
    promptImplement,
    promptImplementReroute,
    promptImplementRevisions,
    promptPlan,
    promptQa,
    promptSpec,
    promptSpecRevision,
    promptSpecReview,
} from '../scripts/run-task/prompts/index.js';
import { runClaude } from '../scripts/run-task/agents/claude.js';
import type { PipelineState, StatusJson, TaskContext } from '../scripts/run-task/types.js';

const TASK_ID = 'test-pf-001';
const PATTERNS_STUB_PATH = path.resolve('tests/fixtures/patterns.stub.md');
const GOLDEN_PATH = path.resolve('tests/run-task-prompts.golden.json');

type GoldenMap = Record<string, string>;

const goldenTemplate = [
    '# Prompt Fidelity Fixture',
    '',
    '## Validation Required',
    '',
    '- [x] `type-check`',
    '- [x] `test`',
    '- [x] `lint`',
    '',
    '## Affected Files',
    '',
    '| File | Change |',
    '|---|---|',
    '',
].join('\n');

const planTemplate = [
    '# Plan',
    '',
    '1. Placeholder plan step.',
    '',
].join('\n');

const handoffTemplate = [
    '# Implementation Handoff: test-pf-001',
    '',
    '## Changes',
    '',
    '| File | What Changed |',
    '|---|---|',
    '| `scripts/run-task/state.ts` | fixture handoff |',
    '',
    '## Iteration 1 — addressing review round 0',
    '',
    '### Re-run validation (only checks that re-ran)',
    '',
    '| Check | Result | Notes |',
    '|---|---|---|',
    '| `npm test` | Pass | fixture |',
    '',
].join('\n');

// Must include a `## Stage 1` heading so promptCodeReview's
// `bundleHasRealPriorReview` defense-in-depth check treats this fixture as a
// real prior review and selects the Round-N prompt for codeReviewRoundNState.
// Without the heading the check would force Round-1 (the defensive path that
// guards against pre-flight-rejection state) and the round-N golden test
// would no longer exercise the round-N template.
const reviewTemplate = [
    '# Review',
    '',
    '## Stage 1 — Spec Compliance (gate)',
    '',
    '- [x] AC-1: ...',
    '',
    '## Round 1',
    '',
    '- approved',
    '',
].join('\n');

let tmpRoot = '';
let baseState: PipelineState;
let specRevisionState: PipelineState;
let planState: PipelineState;
let iterState: PipelineState;
let rerouteState: PipelineState;
let codeReviewRoundNState: PipelineState;
let goldens: GoldenMap = {};

function phase(agent: string, extras: Record<string, unknown> = {}): StatusJson['phases'][keyof StatusJson['phases']] {
    return { status: 'pending', agent, ...extras };
}

function makeStatus(overrides: Partial<StatusJson> = {}): StatusJson {
    return {
        id: TASK_ID,
        title: 'Prompt fidelity fixture',
        status: 'spec',
        created: '2026-05-11',
        updated: '2026-05-11',
        branch: '',
        base_branch: 'main',
        task_size: 'S',
        delicate: false,
        human_spec_gate: false,
        full_send: false,
        worktree: false,
        phases: {
            spec: phase('claude'),
            spec_review: phase('codex'),
            plan: phase('claude'),
            implement: phase('codex'),
            code_review: phase('claude'),
            qa: phase('claude'),
            human_review: phase('human'),
        },
        ...overrides,
    };
}

function makeTask(overrides: Partial<TaskContext> = {}): TaskContext {
    const task = {
        taskId: TASK_ID,
        title: 'Prompt fidelity fixture',
        specReviewVerdict: '' as TaskContext['specReviewVerdict'],
        iterations: 0,
        iterations_current_loop: 0,
        iterations_total: 0,
        rerouteCount: 0,
        status: makeStatus(),
        ...overrides,
    };
    return {
        ...task,
        iterations: task.iterations ?? 0,
        iterations_current_loop: task.iterations_current_loop ?? task.iterations ?? 0,
        iterations_total: task.iterations_total ?? task.iterations_current_loop ?? task.iterations ?? 0,
    };
}

function makeReroutedTask(taskId = TASK_ID, rerouteCount = 1, title = 'Prompt fidelity fixture'): TaskContext {
    const status = makeStatus({ id: taskId, title });
    status.phases.spec_review = phase('codex', { status: 'done', verdict: 'approved' });
    status.phases.implement = phase('codex', { rerouted: true, reroute_count: rerouteCount });
    return makeTask({
        taskId,
        title,
        specReviewVerdict: 'approved',
        rerouteCount,
        status,
    });
}

function makeState(task: TaskContext): PipelineState {
    return {
        tasks: [task],
        tier: 'full',
        isBundle: false,
    };
}

function normalize(value: string): string {
    return value.replaceAll(REPO_ROOT, '<REPO_ROOT>');
}

function recordOrAssert(key: string, actual: string): void {
    if (process.env.UPDATE_GOLDENS === '1') {
        goldens[key] = actual;
        return;
    }
    assert.equal(actual, goldens[key]);
}

// Run UPDATE_GOLDENS=1 npm test after intentional template changes to regenerate.
before(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-fidelity-tests-'));
    const taskDir = path.join(tmpRoot, TASK_ID);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'status.json'), JSON.stringify(makeStatus(), null, 2));
    fs.writeFileSync(path.join(taskDir, 'spec.md'), goldenTemplate);
    fs.writeFileSync(path.join(taskDir, 'plan.md'), planTemplate);
    fs.writeFileSync(path.join(taskDir, 'handoff.md'), handoffTemplate);
    fs.writeFileSync(path.join(taskDir, 'review.md'), reviewTemplate);
    process.env.CANON_TASKS_DIR_OVERRIDE = tmpRoot;
    process.env.CANON_PATTERNS_MD_PATH = PATTERNS_STUB_PATH;

    const loaded = fs.existsSync(GOLDEN_PATH)
        ? JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8')) as GoldenMap
        : {};
    goldens = loaded;

    const baseTask = makeTask();
    baseState = makeState(baseTask);
    specRevisionState = makeState(makeTask({ specReviewVerdict: 'changes_requested' }));
    planState = makeState(makeTask({ specReviewVerdict: 'approved' }));
    iterState = makeState(makeTask({ iterations: 1, iterations_current_loop: 1, iterations_total: 1 }));
    rerouteState = makeState(makeTask({ rerouteCount: 1, specReviewVerdict: 'approved' }));
    codeReviewRoundNState = makeState(makeTask({ iterations: 1, iterations_current_loop: 1, iterations_total: 1 }));
});

after(() => {
    delete process.env.CANON_TASKS_DIR_OVERRIDE;
    delete process.env.CANON_PATTERNS_MD_PATH;
    if (tmpRoot) {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
    if (process.env.UPDATE_GOLDENS === '1') {
        fs.writeFileSync(GOLDEN_PATH, `${JSON.stringify(goldens, null, 2)}\n`);
    }
});

void test('promptSpec', () => {
    const actual = normalize(promptSpec(baseState));
    recordOrAssert('promptSpec', actual);
});

void test('promptSpecRevision', () => {
    const actual = normalize(promptSpecRevision(specRevisionState));
    recordOrAssert('promptSpecRevision', actual);
});

void test('promptSpecReview', () => {
    const actual = normalize(promptSpecReview(baseState));
    recordOrAssert('promptSpecReview', actual);
});

void test('promptSpecReview_reroute_round1', () => {
    const actual = normalize(promptSpecReview(makeState(makeReroutedTask(TASK_ID, 1))));
    recordOrAssert('promptSpecReview_reroute_round1', actual);
});

void test('promptSpecReview_reroute_round2', () => {
    const actual = normalize(promptSpecReview(makeState(makeReroutedTask(TASK_ID, 2))));
    recordOrAssert('promptSpecReview_reroute_round2', actual);
});

void test('promptSpecReview_reroute_bundle', () => {
    const taskA = makeReroutedTask(TASK_ID, 1);
    const taskBId = 'test-pf-002';
    const taskB = makeReroutedTask(taskBId, 2, 'Bundle peer');
    const taskBDir = path.join(tmpRoot, taskBId);
    fs.mkdirSync(taskBDir, { recursive: true });
    fs.writeFileSync(path.join(taskBDir, 'status.json'), JSON.stringify(taskB.status, null, 2));
    const actual = normalize(promptSpecReview({ tasks: [taskA, taskB], tier: 'full', isBundle: true }));
    recordOrAssert('promptSpecReview_reroute_bundle', actual);
});

void test('promptSpecReview injects the full-send rigor block when status.full_send is true', () => {
    const fullSendState = makeState(makeTask({ status: makeStatus({ full_send: true }) }));
    const actual = normalize(promptSpecReview(fullSendState));
    assert.match(actual, /Full-send mode active/);
    assert.match(actual, /primary rigor layer before implementation/);
});

void test('promptPlan', () => {
    const actual = normalize(promptPlan(planState));
    recordOrAssert('promptPlan', actual);
});

void test('promptPlan_reroute_round1', () => {
    const actual = normalize(promptPlan(makeState(makeReroutedTask(TASK_ID, 1))));
    recordOrAssert('promptPlan_reroute_round1', actual);
});

void test('promptPlan_reroute_bundle', () => {
    const taskA = makeReroutedTask(TASK_ID, 1);
    const taskBId = 'test-pf-003';
    const taskB = makeReroutedTask(taskBId, 2, 'Bundle plan peer');
    const taskBDir = path.join(tmpRoot, taskBId);
    fs.mkdirSync(taskBDir, { recursive: true });
    fs.writeFileSync(path.join(taskBDir, 'status.json'), JSON.stringify(taskB.status, null, 2));
    const actual = normalize(promptPlan({ tasks: [taskA, taskB], tier: 'full', isBundle: true }));
    recordOrAssert('promptPlan_reroute_bundle', actual);
});

void test('promptSpecReview and promptPlan dispatch reroute variants only when implement.rerouted is true', () => {
    const normalSpecReview = normalize(promptSpecReview(baseState));
    const rerouteSpecReview = normalize(promptSpecReview(makeState(makeReroutedTask(TASK_ID, 1))));
    assert.doesNotMatch(normalSpecReview, /reroute amendment review/);
    assert.match(rerouteSpecReview, /reroute amendment review/);

    const normalPlan = normalize(promptPlan(planState));
    const reroutePlan = normalize(promptPlan(makeState(makeReroutedTask(TASK_ID, 1))));
    assert.doesNotMatch(normalPlan, /Reroute Plan/);
    assert.match(reroutePlan, /Reroute Plan/);
});

void test('promptSpecReview and promptPlan reroute bundle lines preserve per-task rounds', () => {
    const taskA = makeReroutedTask(TASK_ID, 1);
    const taskBId = 'test-pf-004';
    const taskB = makeReroutedTask(taskBId, 2, 'Bundle mixed round peer');
    const taskBDir = path.join(tmpRoot, taskBId);
    fs.mkdirSync(taskBDir, { recursive: true });
    fs.writeFileSync(path.join(taskBDir, 'status.json'), JSON.stringify(taskB.status, null, 2));
    const state: PipelineState = { tasks: [taskA, taskB], tier: 'full', isBundle: true };

    const specReviewOutput = normalize(promptSpecReview(state));
    assert.match(specReviewOutput, /test-pf-001.*reroute round 1.*`## Amendment`/);
    assert.match(specReviewOutput, /test-pf-004.*reroute round 2.*`## Amendment Round 2`/);

    const planOutput = normalize(promptPlan(state));
    assert.match(planOutput, /test-pf-001.*reroute round 1.*`## Reroute Plan`/);
    assert.match(planOutput, /test-pf-004.*reroute round 2.*`## Reroute Plan Round 2`/);
});

void test('promptImplement_fresh', () => {
    const actual = normalize(promptImplement(baseState, 'fresh', [], 'main'));
    recordOrAssert('promptImplement_fresh', actual);
});

void test('promptImplement renders empty affected-files branch', () => {
    const actual = normalize(promptImplement(baseState, 'fresh', [], 'main'));
    assert.match(actual, /No prior commits on this task's branch yet/);
    assert.match(actual, /every check runs unconditionally on this first implement pass/);
});

void test('promptImplement renders affected files when provided', () => {
    const actual = normalize(promptImplement(baseState, 'fresh', ['src/a.ts', 'src/b.ts'], 'main'));
    assert.match(actual, /## Affected files \(committed diff vs base branch\)/);
    assert.match(actual, /- `src\/a\.ts`/);
    assert.match(actual, /- `src\/b\.ts`/);
    assert.match(actual, /vs `main`/);
});

void test('promptImplementRevisions', () => {
    const actual = normalize(promptImplementRevisions(iterState, [], 'main'));
    recordOrAssert('promptImplementRevisions', actual);
});

void test('promptImplementRevisions selects review-findings branch when preflight counter is 0 and iterations >= 1', () => {
    const reviewFindingsTask = makeTask({
        iterations: 1,
        iterations_current_loop: 1,
        iterations_total: 1,
        status: makeStatus({
            phases: {
                ...makeStatus().phases,
                code_review: phase('claude', { preflight_rejections_current_loop: 0 }),
            },
        }),
    });

    const output = normalize(promptImplementRevisions(makeState(reviewFindingsTask), [], 'main'));

    assert.match(output, /addressing code review round \d+/);
    assert.doesNotMatch(output, /addressing pre-flight handoff rejection/);
});

void test('promptImplementRevisions selects pre-flight branch when preflight counter is >= 1', () => {
    const preflightTask = makeTask({
        iterations: 0,
        iterations_current_loop: 0,
        iterations_total: 0,
        status: makeStatus({
            phases: {
                ...makeStatus().phases,
                code_review: phase('claude', { preflight_rejections_current_loop: 1 }),
            },
        }),
    });

    const output = normalize(promptImplementRevisions(makeState(preflightTask), [], 'main'));

    assert.match(output, /addressing pre-flight rejection/);
    assert.doesNotMatch(output, /addressing pre-flight handoff rejection/);
    assert.doesNotMatch(output, /addressing code review round/);
    assert.doesNotMatch(output, /input-validation failure/);
    assert.doesNotMatch(output, /Fix the handoff itself/);
    assert.doesNotMatch(output, /Source-code changes are usually unnecessary/);
    assert.match(output, /review\.md/);
    assert.match(output, /Validation Gate|Pre-Flight Rejection/);
    assert.match(output, /fix the handoff, fix the code, or both/);
});

void test('promptImplementReroute', () => {
    const actual = normalize(promptImplementReroute(rerouteState, false, [], 'main'));
    recordOrAssert('promptImplementReroute', actual);
});

// Regression: a bundle of tasks at mixed reroute counts must NOT receive a single
// bundle-wide round number in the banner (Codex P2 — anchoring problem: task A
// entering reroute #1 was previously told the bundle was on "round 3 / reroute #2"
// because the banner was derived from max(rerouteCount) across the bundle).
void test('promptImplementReroute mixed-bundle banner is neutral and per-task lines are correct', () => {
    const taskA = makeTask({ rerouteCount: 1 });
    const taskBId = 'test-pf-002';
    const taskBStatus = makeStatus({ id: taskBId, title: 'Bundle peer' });
    const taskB = makeTask({
        taskId: taskBId,
        title: 'Bundle peer',
        rerouteCount: 2,
        status: taskBStatus,
    });
    // Materialize task B's directory so context helpers (taskDirFor) find it.
    const taskBDir = path.join(tmpRoot, taskBId);
    fs.mkdirSync(taskBDir, { recursive: true });
    fs.writeFileSync(path.join(taskBDir, 'status.json'), JSON.stringify(taskBStatus, null, 2));
    fs.writeFileSync(path.join(taskBDir, 'spec.md'), goldenTemplate);

    const bundleState: PipelineState = { tasks: [taskA, taskB], tier: 'full', isBundle: true };
    const output = normalize(promptImplementReroute(bundleState, false, [], 'main'));

    // Banner is neutral and explicitly disclaims a single bundle-wide round.
    assert.match(output, /This is a reroute round for a bundle of tasks/);
    assert.match(output, /Each task carries its own reroute count/);
    assert.match(output, /a bundle can mix tasks on different reroute rounds/);

    // The misstatement form the bug produced must not appear (case-sensitive — the
    // state header legitimately contains lowercase `reroute #N`).
    assert.doesNotMatch(output, /THIS IS ROUND \d+ OF HUMAN REVIEW/);
    assert.doesNotMatch(output, /REROUTE #\d+\.\*\*/);

    // Per-task lines name the correct heading for each task's own reroute count.
    assert.match(output, /test-pf-001.*entering reroute round 1.*`## Amendment`/);
    assert.match(output, /test-pf-002.*entering reroute round 2.*`## Amendment Round 2`/);
});

// Regression: a single task at reroute #2+ should retain the strong "you've been
// sent back N times" banner — that anchoring is unambiguous for a single task.
void test('promptImplementReroute single-task at reroute #2 retains strong-anchor banner', () => {
    const task = makeTask({ rerouteCount: 2, specReviewVerdict: 'approved' });
    const state: PipelineState = { tasks: [task], tier: 'full', isBundle: false };
    const output = normalize(promptImplementReroute(state, false, [], 'main'));

    assert.match(output, /THIS IS ROUND 3 OF HUMAN REVIEW — REROUTE #2/);
    assert.match(output, /sent back 1 time before this one/);
    // Per-task line for round 2 uses the `## Amendment Round 2` heading form.
    assert.match(output, new RegExp(`${TASK_ID}.*entering reroute round 2.*\`## Amendment Round 2\``));
});

void test('promptCodeReview_round1', () => {
    const actual = normalize(promptCodeReview(baseState));
    recordOrAssert('promptCodeReview_round1', actual);
});

void test('promptCodeReview renders the synthesis foreman and both lens subagents', () => {
    const actual = normalize(promptCodeReview(baseState));
    assert.match(actual, /synthesis foreman/);
    assert.match(actual, /subagent_type: code-review-anchored/);
    assert.match(actual, /subagent_type: code-review-cold/);
    assert.match(actual, /Do not give it `spec\.md`, ACs, handoff rationale, canon docs/);
});

void test('promptCodeReview_roundN', () => {
    const actual = normalize(promptCodeReview(codeReviewRoundNState));
    recordOrAssert('promptCodeReview_roundN', actual);
});

// Defense in depth against the historical pre-flight-rejection-counts-as-round
// bug. Even with iteration counters > 0, if review.md lacks a `## Stage 1`
// heading (because the prior "round" was a pre-flight rejection, not a real
// Claude review), the orchestrator MUST select the Round-1 prompt so Claude
// fills the AC table from scratch. This test temporarily stomps the review.md
// fixture with a BLOCKED-only stub and confirms the prompt switches to Round-1.
void test('promptCodeReview forces Round-1 when review.md lacks a Stage 1 heading even if iterations > 0', () => {
    const reviewPath = path.join(tmpRoot, TASK_ID, 'review.md');
    const original = fs.readFileSync(reviewPath, 'utf8');
    try {
        // BLOCKED-only stub — no `## Stage 1` heading. This is exactly the
        // shape the orchestrator's pre-flight rejection writes.
        fs.writeFileSync(reviewPath, [
            '# Code Review: test-pf-001',
            '',
            '## Validation Gate',
            '',
            '**BLOCKED — pre-flight rejected handoff before full review:**',
            '',
            '- some handoff issue',
            '',
            '## Verdict',
            '',
            '- [x] **Changes requested** — fix the above and resubmit handoff.',
            '',
        ].join('\n'));

        const output = promptCodeReview(codeReviewRoundNState);

        // Round-N prompt would include this string verbatim. Round-1 does not.
        assert.doesNotMatch(output, /REVIEW ROUND \d+ — verifying iteration/);
        // Round-1 prompt asks for AC cross-reference against spec.md.
        assert.match(output, /cross-reference tasks\/.+\/spec\.md ACs/);
    } finally {
        fs.writeFileSync(reviewPath, original);
    }
});

// Complement to the test above: a review.md where the foreman deviated and
// used `### Stage 1` nested under `## Round 1` (instead of filling the
// template directly with H2 headings) must still be recognised as a real prior
// review — so Round-N is selected, not Round-1, and no data loss occurs.
void test('promptCodeReview treats ### Stage 1 (nested) as a real prior review and selects Round-N', () => {
    const reviewPath = path.join(tmpRoot, TASK_ID, 'review.md');
    const original = fs.readFileSync(reviewPath, 'utf8');
    try {
        // Foreman-deviated structure: `### Stage 1` under `## Round 1`.
        // No H2 `## Stage 1` is present — this is the heading-level mismatch.
        fs.writeFileSync(reviewPath, [
            '# Code Review: test-pf-001',
            '',
            '## Round 1',
            '',
            '### Stage 1 — Spec Compliance (gate)',
            '',
            '| AC | Status | Notes |',
            '|---|---|---|',
            '| AC-1: something | Fail | missing implementation |',
            '',
            '### Stage 1 Verdict',
            '',
            '- [x] **Fail** — skip Stage 2',
            '',
            '## Verdict',
            '',
            '- [x] **Changes requested**',
            '',
        ].join('\n'));

        const output = promptCodeReview(codeReviewRoundNState);

        // Must select Round-N (real prior review exists): foreman says "This is Round N: re-review…"
        assert.match(output, /This is Round \d+: re-review after iteration/);
        // Must NOT fall back to Round-1 (which would say "cross-reference … spec.md ACs").
        assert.doesNotMatch(output, /This is Round 1, the initial code review/);
    } finally {
        fs.writeFileSync(reviewPath, original);
    }
});

// Guard against false-positive: a stray `### Stage 1` that is NOT inside a
// real `## Round N` section (e.g. the HTML comment scaffold in the review
// template) must NOT be treated as a real prior review.
void test('promptCodeReview treats ### Stage 1 without a ## Round N wrapper as no prior review (forces Round-1)', () => {
    const reviewPath = path.join(tmpRoot, TASK_ID, 'review.md');
    const original = fs.readFileSync(reviewPath, 'utf8');
    try {
        // ### Stage 1 present but no ## Round N heading — stray / comment scaffold shape.
        fs.writeFileSync(reviewPath, [
            '# Code Review: test-pf-001',
            '',
            '<!--',
            'On re-review, append below this line:',
            '',
            '## Round N — verifying ...',
            '',
            '### Stage 1 — Acceptance Criteria Re-Check',
            '-->',
            '',
        ].join('\n'));

        const output = promptCodeReview(codeReviewRoundNState);

        // Must fall back to Round-1 — the stray H3 must not count as a real prior review.
        assert.match(output, /This is Round 1, the initial code review/);
        assert.doesNotMatch(output, /This is Round \d+: re-review after iteration/);
    } finally {
        fs.writeFileSync(reviewPath, original);
    }
});

void test('promptQa', () => {
    const actual = normalize(promptQa(baseState));
    recordOrAssert('promptQa', actual);
});

void test('promptQa_withTemplate', () => {
    const actual = normalize(promptQa(baseState, '## Summary\n- Fill this section.\n'));
    recordOrAssert('promptQa_withTemplate', actual);
});

void test('promptQa bundle ignores prTemplate — bundles skip pr-body.md', () => {
    const t1 = makeTask({ taskId: 'bundle-qa-a', title: 'Task A' });
    const t2 = makeTask({ taskId: 'bundle-qa-b', title: 'Task B' });
    const bundleState: PipelineState = { tasks: [t1, t2], tier: 'full', isBundle: true };
    const withTemplate = promptQa(bundleState, '## Summary\n- Fill this section.\n');
    const withoutTemplate = promptQa(bundleState);
    assert.equal(withTemplate, withoutTemplate, 'bundle QA prompt must not change when a PR template is passed');
    assert.ok(!withTemplate.includes('Fill this section'), 'PR template content must not appear in bundle QA prompt');
});

void test('interactive runClaude omits --max-budget-usd', { concurrency: false }, async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interactive-claude-args-'));
    const binDir = path.join(tempDir, 'bin');
    const argsFile = path.join(tempDir, 'claude-args.txt');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'claude'), [
        '#!/bin/sh',
        'set -eu',
        'printf "%s\\n" "$@" > "$FAKE_CLAUDE_ARGS_FILE"',
        'exit 0',
        '',
    ].join('\n'), { mode: 0o755 });

    const originalPath = process.env.PATH ?? '';
    process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
    process.env.FAKE_CLAUDE_ARGS_FILE = argsFile;
    let args = '';
    try {
        await runClaude('interactive prompt', true, null, 'opus', 'high', '20.00', undefined, tempDir);
        args = fs.readFileSync(argsFile, 'utf8');
    } finally {
        process.env.PATH = originalPath;
        delete process.env.FAKE_CLAUDE_ARGS_FILE;
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
    assert.doesNotMatch(args, /--max-budget-usd/);
    assert.match(args, /--model\nopus\n--effort\nhigh/);
});
