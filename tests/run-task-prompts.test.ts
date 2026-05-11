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

const reviewTemplate = [
    '# Review',
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
    return {
        taskId: TASK_ID,
        title: 'Prompt fidelity fixture',
        specReviewVerdict: '',
        iterations: 0,
        runtimeIterations: 0,
        rerouteCount: 0,
        status: makeStatus(),
        ...overrides,
    };
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
    iterState = makeState(makeTask({ iterations: 1 }));
    rerouteState = makeState(makeTask({ rerouteCount: 1, specReviewVerdict: 'approved' }));
    codeReviewRoundNState = makeState(makeTask({ iterations: 1 }));
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

void test('promptPlan', () => {
    const actual = normalize(promptPlan(planState));
    recordOrAssert('promptPlan', actual);
});

void test('promptImplement_fresh', () => {
    const actual = normalize(promptImplement(baseState, 'fresh'));
    recordOrAssert('promptImplement_fresh', actual);
});

void test('promptImplementRevisions', () => {
    const actual = normalize(promptImplementRevisions(iterState));
    recordOrAssert('promptImplementRevisions', actual);
});

void test('promptImplementReroute', () => {
    const actual = normalize(promptImplementReroute(rerouteState));
    recordOrAssert('promptImplementReroute', actual);
});

void test('promptCodeReview_round1', () => {
    const actual = normalize(promptCodeReview(baseState));
    recordOrAssert('promptCodeReview_round1', actual);
});

void test('promptCodeReview_roundN', () => {
    const actual = normalize(promptCodeReview(codeReviewRoundNState));
    recordOrAssert('promptCodeReview_roundN', actual);
});

void test('promptQa', () => {
    const actual = normalize(promptQa(baseState));
    recordOrAssert('promptQa', actual);
});
