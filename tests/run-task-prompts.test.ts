import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { REPO_ROOT } from '../src/orchestrator/env.js';
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
} from '../src/orchestrator/prompts/index.js';
import { runClaude } from '../src/orchestrator/agents/claude.js';
import { CLAUDE_HEADLESS, CLAUDE_STARTUP, CODEX_STARTUP, toResumePrompt } from '../src/orchestrator/prompts/helpers.js';
import type { PipelineState, StatusJson, TaskContext } from '../src/orchestrator/types.js';

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
    '| `src/orchestrator/state.ts` | fixture handoff |',
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

function outputLineFor(output: string, taskId: string): string {
    return output.split('\n').find(line => line.includes(`\`${taskId}\``)) ?? '';
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

void test('reroute prompts mark reroute_exempt siblings exempt instead of directing them at an Amendment', () => {
    const gapTask = makeReroutedTask(TASK_ID, 1);
    const exemptId = 'test-pf-005';
    const exemptTask = makeReroutedTask(exemptId, 1, 'Approved sibling riding the bundle');
    const exemptImpl = exemptTask.status.phases.implement as {
        reroute_exempt?: boolean;
        reroute_exempt_prior_verdict?: string;
    };
    exemptImpl.reroute_exempt = true;
    exemptImpl.reroute_exempt_prior_verdict = 'approved';
    const exemptDir = path.join(tmpRoot, exemptId);
    fs.mkdirSync(exemptDir, { recursive: true });
    fs.writeFileSync(path.join(exemptDir, 'status.json'), JSON.stringify(exemptTask.status, null, 2));
    const state: PipelineState = { tasks: [gapTask, exemptTask], tier: 'full', isBundle: true };

    const specReviewOutput = normalize(promptSpecReview(state));
    assert.match(specReviewOutput, /test-pf-001.*reroute round 1.*`## Amendment`/);
    assert.match(specReviewOutput, /test-pf-005.*EXEMPT from this reroute's amendment/);
    assert.doesNotMatch(specReviewOutput, /test-pf-005.*review `## Amendment`/);
    // The template's global per-task steps must defer to the EXEMPT lines,
    // not unconditionally direct the reviewer at an Amendment heading.
    assert.match(specReviewOutput, /EXCEPT tasks whose line above marks them EXEMPT/);

    const planOutput = normalize(promptPlan(state));
    assert.match(planOutput, /test-pf-001.*`## Reroute Plan`/);
    assert.match(planOutput, /test-pf-005.*EXEMPT from this reroute's amendment/);
    assert.doesNotMatch(planOutput, /test-pf-005.*append `## Reroute Plan/);
    assert.match(planOutput, /EXCEPT tasks whose line above marks them EXEMPT/);
    assert.ok(planOutput.indexOf('Feasibility check') > planOutput.indexOf('EXCEPT tasks whose line above marks them EXEMPT'));
    assert.ok(planOutput.indexOf('Feasibility check') < planOutput.indexOf('Do **not** rewrite'));
    assert.match(planOutput, /### Delta/);
    assert.doesNotMatch(outputLineFor(planOutput, exemptId), /Feasibility|Real path/);

    const implementOutput = normalize(promptImplementReroute(state, false, [], 'main'));
    assert.match(implementOutput, /test-pf-001.*entering reroute round 1.*`## Amendment`/);
    assert.match(implementOutput, /test-pf-005.*EXEMPT from this reroute's amendment/);
    assert.doesNotMatch(implementOutput, /test-pf-005.*Locate `## Amendment/);
    assert.match(implementOutput, /If a task's line above marks it EXEMPT, skip steps 1-2/);
});

for (const priorVerdict of ['changes_requested', 'needs_re_review'] as const) {
    void test(`reroute prompts preserve ${priorVerdict} findings for exempt failing siblings`, () => {
        const gapTask = makeReroutedTask(TASK_ID, 1);
        const exemptId = `test-pf-failing-${priorVerdict.replaceAll('_', '-')}`;
        const exemptTask = makeReroutedTask(exemptId, 1, 'Failing sibling riding the bundle');
        exemptTask.status.phases.code_review = phase('claude', { status: 'pending', verdict: '' });
        const exemptImpl = exemptTask.status.phases.implement as {
            reroute_exempt?: boolean;
            reroute_exempt_prior_verdict?: string;
        };
        exemptImpl.reroute_exempt = true;
        exemptImpl.reroute_exempt_prior_verdict = priorVerdict;
        const exemptDir = path.join(tmpRoot, exemptId);
        fs.mkdirSync(exemptDir, { recursive: true });
        fs.writeFileSync(path.join(exemptDir, 'status.json'), JSON.stringify(exemptTask.status, null, 2));
        fs.writeFileSync(path.join(exemptDir, 'review-prior-1.md'), reviewTemplate);
        const state: PipelineState = { tasks: [gapTask, exemptTask], tier: 'full', isBundle: true };

        const specReviewLine = outputLineFor(normalize(promptSpecReview(state)), exemptId);
        assert.match(specReviewLine, new RegExp(priorVerdict));
        assert.match(specReviewLine, /review-prior-1\.md/);
        assert.doesNotMatch(specReviewLine, /approved/i);

        const planLine = outputLineFor(normalize(promptPlan(state)), exemptId);
        assert.match(planLine, new RegExp(priorVerdict));
        assert.doesNotMatch(planLine, /approved/i);

        const implementLine = outputLineFor(normalize(promptImplementReroute(state, false, [], 'main')), exemptId);
        assert.match(implementLine, new RegExp(priorVerdict));
        assert.match(implementLine, /review-prior-1\.md/);
        assert.match(implementLine, /address ALL findings/);
        assert.doesNotMatch(implementLine, /approved/i);
    });
}

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
    assert.match(actual, /## Committed diff vs base branch/);
    assert.match(actual, /- `src\/a\.ts`/);
    assert.match(actual, /- `src\/b\.ts`/);
    assert.match(actual, /vs `main`/);
});

void test('promptImplementRevisions', () => {
    const actual = normalize(promptImplementRevisions(iterState, [], 'main'));
    recordOrAssert('promptImplementRevisions', actual);
});

void test('toResumePrompt strips CODEX_STARTUP from spec-review, fresh-implement, and implement-revisions prompts', () => {
    const specReview = promptSpecReview(baseState);
    const implementFresh = promptImplement(baseState, 'fresh', [], 'main');
    const implementRevisions = promptImplementRevisions(iterState, [], 'main');

    for (const rendered of [specReview, implementFresh, implementRevisions]) {
        const resumed = toResumePrompt(rendered);
        assert.ok(!resumed.includes(CODEX_STARTUP));
        assert.ok(resumed.startsWith('[Resumed session'));
    }
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

    // A bundle must not inherit the single-task strong anchor.
    assert.doesNotMatch(output, /THIS IS REROUTE ROUND \d+ FOR THIS TASK/);

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

    assert.match(output, /THIS IS REROUTE ROUND 2 FOR THIS TASK/);
    assert.match(output, /sent back 1 time before this one/);
    // Per-task line for round 2 uses the `## Amendment Round 2` heading form.
    assert.match(output, new RegExp(`${TASK_ID}.*entering reroute round 2.*\`## Amendment Round 2\``));
});

void test('promptCodeReview_round1', () => {
    const actual = normalize(promptCodeReview(baseState));
    recordOrAssert('promptCodeReview_round1', actual);
});

void test('code-review foreman distinguishes valid clean and missing lens returns in every render', () => {
    for (const output of [
        promptCodeReview(baseState),
        promptCodeReview(codeReviewRoundNState),
        promptCodeReview(codeReviewRoundNState, 'main', null, null, { scope: 'delta', base: 'HEAD~1', reason: 'delta', deltaDiff: { diff: 'delta', truncated: false } }),
        promptCodeReview(baseState, 'main', null, null, null, ['src/extra-helper.ts']),
    ]) {
        assert.doesNotMatch(output, /quiet lens output is a bug/);
        assert.match(output, /STAGE_2_FINDINGS: \(none\)/);
        assert.match(output, /COLD_FINDINGS: \(none\)/);
        assert.match(output, /STAGE_1: fail/);
        assert.match(output, /re-spawn/);
        assert.match(output, /approval evidence/);
        assert.match(output, /no verdict box/);
        assert.match(output, /code_review blocked/);
        assert.match(output, /exactly the two Claude lenses/);
        assert.match(output, /never substitute your own review/);
    }
});

void test('missing lens stop renders a blocked command for every bundle member', () => {
    const peer = makeTask({ taskId: 'test-pf-blocked-peer', title: 'Blocked peer' });
    const dir = path.join(tmpRoot, peer.taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(peer.status));
    const output = promptCodeReview({ tasks: [baseState.tasks[0], peer], tier: 'full', isBundle: true });
    for (const id of [TASK_ID, peer.taskId]) {
        assert.match(output, new RegExp(`canon task phase ${id} code_review blocked`));
    }
});

void test('Claude headless guidance stays out of interactive startup', () => {
    for (const token of [
        'nobody reads', 'ambiguous', 'interpretation', 'notes.md', 'phase command',
        'not completion', 'Do only this phase', 'canon run', 'reviewer sub-agents',
        'review passes', 'never as passed', 'no one to ask',
        'Skip that action unless this prompt explicitly authorizes it',
    ]) {
        assert.ok(CLAUDE_HEADLESS.includes(token), token);
        assert.ok(!CLAUDE_STARTUP.includes(token), token);
    }
});

void test('lens charters preserve clean forms and high recall while limiting delegation', () => {
    const anchored = fs.readFileSync(path.resolve('.claude/agents/code-review-anchored.md'), 'utf8');
    const cold = fs.readFileSync(path.resolve('.claude/agents/code-review-cold.md'), 'utf8');
    assert.match(anchored, /STAGE_2_FINDINGS: \(none\)/);
    assert.match(cold, /COLD_FINDINGS: \(none\)/);
    for (const charter of [anchored, cold]) {
        assert.match(charter, /Coverage is your job; filtering is not\./);
        assert.match(charter, /Do this review yourself: spawn no sub-agents/);
    }
});

void test('spec-review-lens charter and canon-spec-review skill carry the calibrated contract', () => {
    const charter = fs.readFileSync(path.resolve('.claude/agents/spec-review-lens.md'), 'utf8');
    const skill = fs.readFileSync(path.resolve('.claude/skills/canon-spec-review/SKILL.md'), 'utf8');
    const frontmatter = charter.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    const skillFrontmatter = skill.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    assert.match(frontmatter, /name: spec-review-lens/);
    const toolsLine = frontmatter.match(/^tools:\s*(.*)$/m)?.[1];
    assert.ok(toolsLine, 'tools allowlist must be explicit');
    const toolList = toolsLine.split(',').map(tool => tool.trim());
    assert.deepEqual([...new Set(toolList)].sort(), ['Bash', 'Glob', 'Grep', 'Read']);
    assert.equal(new Set(toolList).size, toolList.length, 'tools allowlist must not contain duplicates');
    assert.doesNotMatch(toolsLine, /Agent|Skill|Edit|Write/);

    for (const token of [
        /Bash is read-only/, /spawn no sub-agents/, /Invoke no skills/, /Write no files/,
        /file:line/, /Coverage first/, /Filtering is the synthesizer's job/, /\[NO FINDINGS\]/,
    ]) assert.match(charter, token);

    // These structural assertions prove the text is present, not that a model will behave accordingly.
    for (const file of [charter, skill]) {
        assert.match(file, /BLOCKING/);
        assert.match(file, /STRONG/);
        assert.match(file, /NIT/);
        assert.match(file, /explicitly exclude|Non-Goals/);
        assert.match(file, /verif\w* (as )?unaffected/);
        assert.match(file, /omitted required change/);
        assert.match(file, /transitive effect/);
        assert.match(file, /internal contradiction/);
        for (const line of file.split('\n')) {
            if (/explicitly exclude|Non-Goals/.test(line)) assert.match(line, /verif\w* (as )?unaffected/);
        }
    }

    assert.match(skill, /subagent_type: spec-review-lens/);
    assert.match(skill, /canon upgrade/);
    assert.doesNotMatch(skill, /general-purpose/);
    assert.doesNotMatch(skill, /\bExplore\b/);
    assert.doesNotMatch(skill, /Shape Check rubric/);
    assert.match(skill, /Name effects to DELETE/);
    assert.match(skill, /Prefer positive or structural assertions/);
    assert.doesNotMatch(skill, /Calibration applied to every angle/);
    const angleA = skill.split('#### Agent A')[1]?.split('#### Agent B')[0] ?? '';
    for (const token of [/problem real/, /framing right/, /simpler solution/, /AC decomposition/]) assert.match(angleA, token);
    const angleB = skill.split('#### Agent B')[1]?.split('#### Agent C')[0] ?? '';
    for (const token of [/Read whole functions/, /call sites/, /return shapes/]) assert.match(angleB, token);
    const angleC = skill.split('#### Agent C')[1]?.split('### 3.')[0] ?? '';
    for (let n = 1; n <= 9; n++) assert.ok(angleC.includes(`(${n}) **`), `Agent C check (${n}) must exist`);
    const synthesis = skill.split('### 3. Synthesize and report')[1] ?? '';
    for (const token of [/uncited/, /scope boundary/, /de-dupe/]) assert.match(synthesis, token);
    const c3 = skill.split('(3) **Affected Files**')[1]?.split('\n(4)')[0] ?? '';
    assert.ok(c3, 'C3 text must exist');
    assert.match(c3, /### Affected Files/);
    assert.match(c3, /## Design/);
    assert.match(c3, /generated|rebuilt/i);
    assert.match(skillFrontmatter, /effort: high/);
    assert.match(skill, /canon-inline-review/);
    assert.doesNotMatch(skill, /codex review --/);
    assert.doesNotMatch(skill, /worktree-canonical-task-state/);
    assert.doesNotMatch(skill, /~15-min/);
    const trivialRow = skill.split('\n').find(line => line.startsWith('| Run on ')) ?? '';
    assert.match(trivialRow, /XS/);
});

void test('plan feasibility reaches ordinary, bundle, reroute, and fast-tier combined planning', () => {
    const ordinary = promptPlan(planState);
    for (const token of [
        'Feasibility check', 'searching', 'Real path', 'Callers', 'Tests that can fail',
        'Predicates', 'boundary', 'Affected Files', 're-entry', 'N/A', '[plan]',
        'notes.md', 'Do not change the spec', 'widen scope', 'Approach section',
    ]) assert.ok(ordinary.includes(token), token);
    const peer = makeTask({ taskId: 'test-pf-bundle', title: 'Bundle peer' });
    const bundle: PipelineState = { tasks: [planState.tasks[0], peer], tier: 'full', isBundle: true };
    assert.match(promptPlan(bundle), /Feasibility check[\s\S]*Approach section/);
    assert.match(promptPlan(makeState(makeReroutedTask())), /Feasibility check[\s\S]*### Delta/);
    for (const state of [
        { ...baseState, tier: 'fast' as const },
        { ...bundle, tier: 'fast' as const },
    ]) {
        const output = promptSpec(state);
        assert.match(output, /Feasibility check/);
        assert.match(output, /records the feasibility check/);
    }
    assert.doesNotMatch(promptSpec(baseState), /Feasibility check/);
});

void test('promptCodeReview_fullSendOutOfScope', () => {
    const actual = normalize(promptCodeReview(baseState, 'main', null, null, null, ['src/extra-helper.ts']));
    recordOrAssert('promptCodeReview_fullSendOutOfScope', actual);
    assert.match(actual, /src\/extra-helper\.ts/);
    assert.match(actual, /### Affected Files/);
});

void test('promptCodeReview renders the synthesis foreman, Claude subagents, and injected cold-Codex lens', () => {
    const actual = normalize(promptCodeReview(baseState, 'main', null, 'P2 - null deref at src/foo.ts:10'));
    assert.match(actual, /synthesis foreman/);
    assert.match(actual, /subagent_type: code-review-anchored/);
    assert.match(actual, /subagent_type: code-review-cold/);
    assert.match(actual, /Do not give it `spec\.md`, ACs, handoff rationale, canon docs/);
    assert.match(actual, /P2 - null deref at src\/foo\.ts:10/);
    assert.match(actual, /third lens input/);
    assert.match(actual, /three review inputs/);
    assert.match(actual, /Do not run `codex` yourself/);
});

void test('promptCodeReview_roundN', () => {
    const actual = normalize(promptCodeReview(codeReviewRoundNState));
    recordOrAssert('promptCodeReview_roundN', actual);
});

void test('promptCodeReview_deltaRound', () => {
    const actual = normalize(promptCodeReview(codeReviewRoundNState, 'main',
        { diff: 'full diff', truncated: false }, 'cold findings', {
            scope: 'delta', base: 'a'.repeat(40), reason: 'delta',
            deltaDiff: { diff: 'delta diff', truncated: false },
        }));
    recordOrAssert('promptCodeReview_deltaRound', actual);
    assert.match(actual, /subagent_type: code-review-anchored/);
    assert.match(actual, /subagent_type: code-review-cold/);
    assert.match(actual, /delta diff/);
    assert.doesNotMatch(actual, /```diff\nfull diff\n```/);
    assert.match(actual, /git diff main\.\.\.HEAD/);
    assert.match(actual, /Retrieve the full task diff with `git diff main\.\.\.HEAD` and give it that full diff, not the delta,/);
    assert.match(actual, /sibling-site sweep may search other code files/);
});

void test('promptCodeReview delta round retrieves the diff when injection fails', () => {
    const actual = promptCodeReview(codeReviewRoundNState, 'main', null, 'cold findings', {
        scope: 'delta', base: 'a'.repeat(40), reason: 'delta', deltaDiff: null,
    });
    assert.match(actual, /The delta diff could not be injected\. Retrieve it with `git diff a{40}\.\.HEAD`/);
    assert.doesNotMatch(actual, /```diff\s*```/);
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

void test('anchored review charter checks project patterns without changing categories or the cold lens', () => {
    const worktreeRoot = process.cwd();
    const anchored = fs.readFileSync(path.join(worktreeRoot, '.claude/agents/code-review-anchored.md'), 'utf8');
    const cold = fs.readFileSync(path.join(worktreeRoot, '.claude/agents/code-review-cold.md'), 'utf8');

    assert.match(anchored, /docs\/patterns\.md/);
    assert.match(anchored, /Trigger Table/);
    assert.match(anchored, /TODO\[canon\]/);
    assert.ok(anchored.includes('- [correctness bug | risk/guardrail | optional cleanup/nit | spec gap]'));
    assert.doesNotMatch(cold, /patterns\.md/);
});

void test('AC-11 — structural relocation: presence tokens appear in destinations, absence tokens do not bleed', () => {
    const worktreeRoot = process.cwd();
    function readRepoFile(relPath: string): string {
        return fs.readFileSync(path.join(worktreeRoot, relPath), 'utf8');
    }

    const impl = readRepoFile('src/orchestrator/prompts/templates/implement.md');
    assert.match(impl, /ship the safer guarded behavior first/);
    assert.match(impl, /No unauthorized new abstractions/);
    assert.match(impl, /No incidental dependency changes/);
    assert.match(impl, /Suppressing a lint or type error is a last resort/);
    assert.match(impl, /Parse cell-by-cell with explicit rejection/);
    assert.match(impl, /Migration runner \+ manual review/);

    const implRev = readRepoFile('src/orchestrator/prompts/templates/implement-revisions.md');
    assert.match(implRev, /git show origin\//);
    assert.match(implRev, /the pre-flight diff is cumulative/);
    assert.match(implRev, /Referencing deleted/);

    const specRevTpl = readRepoFile('src/orchestrator/prompts/templates/spec-review.md');
    assert.match(specRevTpl, /No agent reviews its own output/);
    assert.match(specRevTpl, /Each role owns a checkpoint/);

    const qa = readRepoFile('src/orchestrator/prompts/templates/qa.md');
    assert.match(qa, /Agents do not bump versions/);
    assert.match(qa, /Handoff Validation/);
    assert.match(qa, /One-paragraph plain-English summary/);
    assert.match(qa, /Two-checkpoint/);
    assert.match(qa, /Code is Canonical/);
    assert.match(qa, /Commit Ownership/);

    const specJit = readRepoFile('src/orchestrator/prompts/templates/spec.md');
    assert.match(specJit, /Name effects to DELETE/);
    assert.match(specJit, /Prefer positive or structural assertions/);

    const specRevJit = readRepoFile('src/orchestrator/prompts/templates/spec-revision.md');
    assert.match(specRevJit, /Name effects to DELETE/);
    assert.match(specRevJit, /Prefer positive or structural assertions/);

    for (const phrase of [
        'auth, billing / payments',
        'privacy / data handling',
        'destructive operations',
        'schema / data-model migrations',
        'analytics-event changes',
    ]) {
        assert.ok(specJit.includes(phrase), `spec.md missing escalation trigger: ${phrase}`);
        assert.ok(specRevJit.includes(phrase), `spec-revision.md missing escalation trigger: ${phrase}`);
    }

    const canonSpec = readRepoFile('.claude/skills/canon-spec/SKILL.md');
    assert.match(canonSpec, /Name effects to DELETE/);
    assert.match(canonSpec, /Prefer positive or structural assertions/);

    const canonSpecReview = readRepoFile('.claude/skills/canon-spec-review/SKILL.md');
    assert.match(canonSpecReview, /Name effects to DELETE/);
    assert.match(canonSpecReview, /Prefer positive or structural assertions/);

    const helpers = readRepoFile('src/orchestrator/prompts/helpers.ts');
    assert.match(helpers, /honest signal is canon/);
    assert.match(helpers, /Branch state: the orchestrator manages it — do not fetch, pull, rebase, or push/);
    assert.doesNotMatch(helpers.match(/export const CODEX_STARTUP =[\s\S]*?;\n/)?.[0] ?? '', /Headless session|wait for approval/);
    assert.match(helpers, /export const CODEX_HEADLESS =/);
    assert.doesNotMatch(helpers.match(/export const CLAUDE_STARTUP =[\s\S]*?;\n/)?.[0] ?? '', /Unattended session|no one to ask/);

    const scaffoldSpec = readRepoFile('.canon/templates/spec.md');
    assert.match(scaffoldSpec, /Migration runner \+ manual review/);
    assert.match(scaffoldSpec, /heads-up, not a change/);

    assert.doesNotMatch(specJit, /task baseline/);
    assert.doesNotMatch(specJit, /git -C/);
    assert.doesNotMatch(specRevJit, /task baseline/);
    assert.doesNotMatch(specRevJit, /git -C/);
    assert.doesNotMatch(specRevTpl, /task baseline/);
    assert.doesNotMatch(specRevTpl, /git -C/);

    const foreman = readRepoFile('src/orchestrator/prompts/templates/code-review-foreman.md');
    assert.doesNotMatch(foreman, /Name effects to DELETE/);
    assert.doesNotMatch(foreman, /Prefer positive or structural assertions/);

    const anchored = readRepoFile('.claude/agents/code-review-anchored.md');
    assert.doesNotMatch(anchored, /Name effects to DELETE/);
    assert.doesNotMatch(anchored, /Prefer positive or structural assertions/);

    const cold = readRepoFile('.claude/agents/code-review-cold.md');
    assert.match(cold, /Sibling-site sweep/);
    assert.doesNotMatch(cold, /Name effects to DELETE/);
    assert.doesNotMatch(cold, /Prefer positive or structural assertions/);

    const scaffoldDir = path.join(worktreeRoot, '.canon/templates');
    const walk = (dir: string): string[] => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        return entries.flatMap(e =>
            e.isDirectory()
                ? walk(path.join(dir, e.name))
                : [path.join(dir, e.name)],
        );
    };
    for (const filePath of walk(scaffoldDir)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const rel = path.relative(worktreeRoot, filePath);
        assert.doesNotMatch(
            content,
            /AGENTS\.md|CLAUDE\.md/,
            `Scaffold ${rel} still references AGENTS.md or CLAUDE.md`,
        );
    }
});

void test('refactor correctness-audit guidance stays aligned across spec surfaces', () => {
    const worktreeRoot = process.cwd();
    const readRepoFile = (relPath: string): string => fs.readFileSync(path.join(worktreeRoot, relPath), 'utf8');
    const carriers = [
        '.claude/skills/canon-spec/SKILL.md',
        '.canon/templates/spec.md',
        'src/orchestrator/prompts/templates/spec.md',
        'src/orchestrator/prompts/templates/spec-revision.md',
        'src/orchestrator/prompts/templates/spec-review.md',
        '.claude/skills/canon-spec-review/SKILL.md',
    ];
    for (const file of carriers) {
        assert.ok(readRepoFile(file).includes('correctness audit'), `${file} is missing correctness audit guidance`);
    }

    const specPrompt = readRepoFile('src/orchestrator/prompts/templates/spec.md');
    const revisionPrompt = readRepoFile('src/orchestrator/prompts/templates/spec-revision.md');
    const bulletLead = '- **Refactor specs need a correctness audit** —';
    const extractBullet = (content: string): string => {
        const matches = content.split('\n').filter(line => line.startsWith(bulletLead));
        assert.equal(matches.length, 1);
        const [match] = matches;
        assert.ok(match);
        return match;
    };
    const specBullet = extractBullet(specPrompt);
    const revisionBullet = extractBullet(revisionPrompt);
    assert.equal(specBullet, revisionBullet);
    for (const content of [specPrompt, revisionPrompt]) {
        const lines = content.split('\n');
        const index = lines.findIndex(line => line.startsWith(bulletLead));
        assert.ok(lines[index - 1]?.startsWith('- **Refactor specs need structural caps**'));
    }

    const builder = readRepoFile('src/orchestrator/prompts/index.ts');
    const selfCheckLine = builder.split('\n').find(line => line.includes('correctness audit'));
    assert.ok(selfCheckLine);
    assert.ok(selfCheckLine.includes('(Refactors; N/A for features/bug fixes)'));
    assert.ok(selfCheckLine.includes('outcome'));
    const reviewLine = readRepoFile('src/orchestrator/prompts/templates/spec-review.md')
        .split('\n').find(line => line.includes('correctness audit'));
    assert.ok(reviewLine);
    assert.ok(reviewLine.startsWith('- For a refactor:'));
    assert.match(reviewLine, /Blocking/);
    assert.doesNotMatch(reviewLine, /STRONG/);
    assert.doesNotMatch(reviewLine, /never BLOCKING/i);
    assert.match(reviewLine, /correct as-is, fixed deliberately, split out, or kept as a named quirk/);
    assert.match(reviewLine, /audited, correct/);
    for (const line of [specBullet, revisionBullet, selfCheckLine, reviewLine]) {
        assert.doesNotMatch(line, /`/);
    }

    const specOutput = promptSpec(baseState);
    const revisionOutput = promptSpecRevision(specRevisionState);
    const distinctive = 'correctness audit of each behavior declared preserved';
    assert.ok(specOutput.includes(distinctive));
    assert.ok(goldens.promptSpec?.includes(distinctive));
    assert.ok(!revisionOutput.includes(distinctive));
    assert.ok(!goldens.promptSpecRevision?.includes(distinctive));
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
