import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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

type PromptFixture = {
    taskId: string;
    title: string;
    specReviewVerdict: 'approved' | 'approved_with_nits' | 'changes_requested' | 'needs_re_review' | '';
    iterations: number;
    rerouteCount: number;
    status: {
        id: string;
        title: string;
        status: string;
        base_branch: string;
        task_size: 'S' | 'M' | 'L' | 'XL';
        delicate: boolean;
        human_spec_gate: boolean;
        worktree: boolean;
        phases: Record<string, unknown>;
    };
};

type GoldenSet = Record<string, string>;

const REPO_ROOT_PLACEHOLDER = '__REPO__';

function normalizeRepoPaths(obj: GoldenSet): GoldenSet {
    return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, v.replaceAll(REPO_ROOT, REPO_ROOT_PLACEHOLDER)]),
    );
}

const GOLDENS: GoldenSet = normalizeRepoPaths(
    JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, 'tests/run-task-prompts.golden.json'), 'utf8'),
    ) as GoldenSet,
);

function writeFixtureTask(fixture: PromptFixture): void {
    const dir = path.join(REPO_ROOT, 'tasks', fixture.taskId);
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(
        path.join(dir, 'status.json'),
        `${JSON.stringify(fixture.status, null, 2)}\n`,
    );

    fs.writeFileSync(
        path.join(dir, 'spec.md'),
        [
            '# Spec',
            '',
            '## Validation Required',
            '',
            '- [x] `npm run lint`',
            '',
            '## Affected Files',
            '',
            '| File | Change |',
            '|---|---|',
            '',
            '## Known Risks',
            '',
            'None',
            '',
        ].join('\n'),
    );

    fs.writeFileSync(path.join(dir, 'plan.md'), '# Plan\n');
}

function removeFixtureTask(taskId: string): void {
    fs.rmSync(path.join(REPO_ROOT, 'tasks', taskId), { recursive: true, force: true });
}

function buildFixtureSet(): Record<string, PromptFixture[]> {
    const baseStatus = (taskId: string, title: string, size: 'S' | 'M' | 'L' | 'XL', delicate: boolean): PromptFixture['status'] => ({
        id: taskId,
        title,
        status: 'spec',
        base_branch: 'main',
        task_size: size,
        delicate,
        human_spec_gate: delicate,
        worktree: delicate,
        phases: {},
    });

    return {
        solo: [{
            taskId: 'prompt-fixture-a',
            title: 'Alpha',
            specReviewVerdict: 'approved',
            iterations: 0,
            rerouteCount: 1,
            status: baseStatus('prompt-fixture-a', 'Alpha', 'S', false),
        }],
        bundle: [
            {
                taskId: 'prompt-fixture-a',
                title: 'Alpha',
                specReviewVerdict: 'approved',
                iterations: 0,
                rerouteCount: 1,
                status: baseStatus('prompt-fixture-a', 'Alpha', 'S', false),
            },
            {
                taskId: 'prompt-fixture-b',
                title: 'Beta',
                specReviewVerdict: 'changes_requested',
                iterations: 1,
                rerouteCount: 2,
                status: baseStatus('prompt-fixture-b', 'Beta', 'L', true),
            },
        ],
    };
}

function buildState(tasks: PromptFixture[], tier: 'fast' | 'full', isBundle: boolean) {
    return {
        tasks,
        tier,
        isBundle,
    };
}

function buildAllPrompts(): Record<string, string> {
    const fixtures = buildFixtureSet();
    const solo = fixtures.solo;
    const bundle = fixtures.bundle;

    const bundleIterations = bundle.map(task => ({ ...task, iterations: 2 }));
    const bundleReroute = bundle.map(task => ({ ...task, rerouteCount: 2 }));
    const bundleCodeReview = bundle.map(task => ({ ...task, iterations: 1 }));

    return {
        specFastSolo: promptSpec(buildState(solo, 'fast', false)),
        specFullBundle: promptSpec(buildState(bundle, 'full', true)),
        specRevisionSolo: promptSpecRevision(buildState(solo, 'fast', false)),
        specRevisionBundle: promptSpecRevision(buildState(bundle, 'full', true)),
        specReviewSolo: promptSpecReview(buildState(solo, 'fast', false)),
        specReviewBundle: promptSpecReview(buildState(bundle, 'full', true)),
        planSolo: promptPlan(buildState(solo, 'fast', false)),
        planBundle: promptPlan(buildState(bundle, 'full', true)),
        implementFreshSolo: promptImplement(buildState(solo, 'fast', false), 'fresh'),
        implementResumeSolo: promptImplement(buildState(solo, 'fast', false), 'resume'),
        implementFreshBundle: promptImplement(buildState(bundle, 'full', true), 'fresh'),
        implementResumeBundle: promptImplement(buildState(bundle, 'full', true), 'resume'),
        implementRevisionsSolo: promptImplementRevisions(buildState([{ ...solo[0], iterations: 2 }], 'fast', false)),
        implementRevisionsBundle: promptImplementRevisions(buildState(bundleIterations, 'full', true)),
        implementRerouteSolo: promptImplementReroute(buildState([{ ...solo[0], rerouteCount: 1 }], 'fast', false)),
        implementRerouteBundle: promptImplementReroute(buildState(bundleReroute, 'full', true)),
        codeReviewRound1Solo: promptCodeReview(buildState([{ ...solo[0], iterations: 0 }], 'fast', false)),
        codeReviewRoundNBundle: promptCodeReview(buildState(bundleCodeReview, 'full', true)),
        qaSolo: promptQa(buildState(solo, 'fast', false)),
        qaBundle: promptQa(buildState(bundle, 'full', true)),
    };
}

void test('prompt builders remain byte-identical to the captured pre-refactor outputs', () => {
    const fixtures = buildFixtureSet();
    for (const task of [...fixtures.solo, ...fixtures.bundle]) {
        writeFixtureTask(task);
    }

    try {
        const actual = normalizeRepoPaths(buildAllPrompts());
        assert.deepEqual(actual, GOLDENS);
    } finally {
        for (const task of [...fixtures.solo, ...fixtures.bundle]) {
            removeFixtureTask(task.taskId);
        }
    }
});
