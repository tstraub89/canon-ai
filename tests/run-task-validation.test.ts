import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    checkAcCoveragePlaceholders,
    computeLatestValidationResults,
    validateHandoffAgainstSpec,
    verifyHandoffAgainstDiffFromData,
} from '../scripts/run-task/validation.js';

function withTempPair(
    specContent: string,
    handoffContent: string,
    fn: (specPath: string, handoffPath: string) => void,
): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-task-validation-'));
    const specPath = path.join(dir, 'spec.md');
    const handoffPath = path.join(dir, 'handoff.md');
    fs.writeFileSync(specPath, specContent);
    fs.writeFileSync(handoffPath, handoffContent);
    try {
        fn(specPath, handoffPath);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function makeHandoffMap(entries: Record<string, readonly string[]>): Map<string, readonly string[]> {
    return new Map(Object.entries(entries));
}

void test('validateHandoffAgainstSpec rejects N/A for a required validation check', () => {
    withTempPair(
        [
            '# Spec',
            '',
            '## Validation Required',
            '',
            '- [x] `npm run lint`',
            '- [x] `npm run test:e2e`',
            '- [ ] `npm run build`',
            '',
        ].join('\n'),
        [
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `npm run lint` | Pass | ok |',
            '| `npm run test:e2e` | N/A | logic-only change |',
            '| `npm run build` | N/A | not required |',
            '',
        ].join('\n'),
        (specPath, handoffPath) => {
            const issues = validateHandoffAgainstSpec(specPath, handoffPath);
            assert.deepEqual(issues, [
                'Validation Required item marked N/A in handoff.md: `npm run test:e2e`',
            ]);
        },
    );
});

void test('validateHandoffAgainstSpec matches by canonical command, ignoring spec annotations', () => {
    // Regression: a real task shipped with a spec line like
    // "`npm run test` — including the four new unit tests (3 in parser test
    // file, 1 in validator test file)" but the handoff row contained just
    // "`npm run test`". The pre-flight rejected the handoff for ~4 implement
    // iterations because the canonicalizer compared full annotated strings.
    withTempPair(
        [
            '# Spec',
            '',
            '## Validation Required',
            '',
            '- [x] `npm run lint`',
            '- [x] `npm run test` — including the four new unit tests (3 in parser test file, 1 in validator test file)',
            '- [x] `npm run build`',
            '',
        ].join('\n'),
        [
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `npm run lint` | Pass | ok |',
            '| `npm run test` | Pass | full suite green |',
            '| `npm run build` | Pass | ok |',
            '',
        ].join('\n'),
        (specPath, handoffPath) => {
            const issues = validateHandoffAgainstSpec(specPath, handoffPath);
            assert.deepEqual(issues, []);
        },
    );
});

void test('validateHandoffAgainstSpec allows required checks to pass and optional checks to stay N/A', () => {
    withTempPair(
        [
            '# Spec',
            '',
            '## Validation Required',
            '',
            '- [x] `npm run lint`',
            '- [x] `npm run test:e2e`',
            '- [ ] `npm run build`',
            '',
        ].join('\n'),
        [
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `npm run lint` | Pass | ok |',
            '| `npm run test:e2e` | Pass | covered by Chromium flow |',
            '| `npm run build` | N/A | not required |',
            '',
        ].join('\n'),
        (specPath, handoffPath) => {
            const issues = validateHandoffAgainstSpec(specPath, handoffPath);
            assert.deepEqual(issues, []);
        },
    );
});

void test('checkAcCoveragePlaceholders ignores prose in the AC Coverage section', () => {
    const issues = checkAcCoveragePlaceholders([
        '## AC Coverage',
        '',
        'This prose mentions AC-1 and the phrase Met / Partial / Not met, but it is not a table row.',
        '',
        '| AC | Status | Notes |',
        '|---|---|---|',
        '| AC-1 | Pass | filled in |',
        '',
    ].join('\n'));

    assert.deepEqual(issues, []);
});

void test('checkAcCoveragePlaceholders flags an all-placeholder table even when Status is last', () => {
    const issues = checkAcCoveragePlaceholders([
        '## AC Coverage',
        '',
        '| AC | Notes | Status |',
        '|---|---|---|',
        '| AC-1 | template row | Met / Partial / Not met |',
        '| AC-2 | template row | Met / Partial / Not met |',
        '',
    ].join('\n'));

    assert.deepEqual(issues, [
        'AC Coverage table only contains template placeholder rows (Status "Met / Partial / Not met") — fill in actual AC statuses',
    ]);
});

void test('verifyHandoffAgainstDiffFromData passes when handoff and diff agree', () => {
    const issues = verifyHandoffAgainstDiffFromData(
        ['task-a'],
        {
            diffFiles: ['src/foo.ts'],
            handoffFilesByTask: makeHandoffMap({
                'task-a': ['src/foo.ts'],
            }),
        },
    );
    assert.deepEqual(issues, []);
});

void test('verifyHandoffAgainstDiffFromData rejects a handoff file missing from diff', () => {
    const issues = verifyHandoffAgainstDiffFromData(
        ['task-a'],
        {
            diffFiles: ['src/foo.ts'],
            handoffFilesByTask: makeHandoffMap({
                'task-a': ['src/foo.ts', 'src/bar.ts'],
            }),
        },
    );
    assert.equal(issues.length, 1);
    assert.ok(issues[0].includes('handoff→diff'));
    assert.ok(issues[0].includes('task-a'));
    assert.ok(issues[0].includes('src/bar.ts'));
});

void test('verifyHandoffAgainstDiffFromData rejects a diff file missing from all handoffs', () => {
    const issues = verifyHandoffAgainstDiffFromData(
        ['task-a'],
        {
            diffFiles: ['src/foo.ts', 'src/baz.ts'],
            handoffFilesByTask: makeHandoffMap({
                'task-a': ['src/foo.ts'],
            }),
        },
    );
    assert.equal(issues.length, 1);
    assert.ok(issues[0].includes('diff→handoff'));
    assert.ok(issues[0].includes('src/baz.ts'));
});

void test('verifyHandoffAgainstDiffFromData respects bundle-wide handoff unions', () => {
    const issues = verifyHandoffAgainstDiffFromData(
        ['task-a', 'task-b'],
        {
            diffFiles: ['src/foo.ts', 'src/bar.ts'],
            handoffFilesByTask: makeHandoffMap({
                'task-a': ['src/foo.ts'],
                'task-b': ['src/bar.ts'],
            }),
        },
    );
    assert.deepEqual(issues, []);
});

void test('verifyHandoffAgainstDiffFromData passes empty diff and empty handoff cleanly', () => {
    const issues = verifyHandoffAgainstDiffFromData(
        ['task-a'],
        {
            diffFiles: [],
            handoffFilesByTask: makeHandoffMap({
                'task-a': [],
            }),
        },
    );
    assert.deepEqual(issues, []);
});

void test('verifyHandoffAgainstDiffFromData: rename covered when handoff lists pre-image (old) path', () => {
    // Regression: --name-only -M only emits post-image paths, so a handoff
    // listing the pre-image path used to false-positive on handoff→diff. With
    // --name-status -M and rename-pair handling, either side covers both.
    const issues = verifyHandoffAgainstDiffFromData(
        ['task-a'],
        {
            diffFiles: [],
            renamePairs: [['src/old-name.ts', 'src/new-name.ts']],
            handoffFilesByTask: makeHandoffMap({
                'task-a': ['src/old-name.ts'],
            }),
        },
    );
    assert.deepEqual(issues, []);
});

void test('verifyHandoffAgainstDiffFromData: rename covered when handoff lists post-image (new) path', () => {
    const issues = verifyHandoffAgainstDiffFromData(
        ['task-a'],
        {
            diffFiles: [],
            renamePairs: [['src/old-name.ts', 'src/new-name.ts']],
            handoffFilesByTask: makeHandoffMap({
                'task-a': ['src/new-name.ts'],
            }),
        },
    );
    assert.deepEqual(issues, []);
});

void test('verifyHandoffAgainstDiffFromData: rename uncovered emits one issue naming both paths', () => {
    const issues = verifyHandoffAgainstDiffFromData(
        ['task-a'],
        {
            diffFiles: [],
            renamePairs: [['src/old-name.ts', 'src/new-name.ts']],
            handoffFilesByTask: makeHandoffMap({
                'task-a': [],
            }),
        },
    );
    assert.equal(issues.length, 1);
    assert.ok(issues[0].includes('rename'));
    assert.ok(issues[0].includes('src/old-name.ts'));
    assert.ok(issues[0].includes('src/new-name.ts'));
    assert.ok(issues[0].includes('diff→handoff'));
});

// ─── Cumulative-handoff bug #1: validateHandoff must respect later iteration re-runs ───

void test('computeLatestValidationResults: original Fail overridden by iteration Pass', () => {
    const handoff = [
        '# Implementation Handoff: x',
        '',
        '## Validation Outcomes',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| `npm test` | Fail | flaky |',
        '',
        '## Iteration 2 — addressing review round 1',
        '',
        '### Re-run validation (only checks that re-ran)',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| `npm test` | Pass | resolved |',
        '',
    ].join('\n');

    const latest = computeLatestValidationResults(handoff);
    const row = latest.get('test');
    assert.ok(row, 'should have npm test result');
    assert.equal(row.result, 'Pass');
});

void test('computeLatestValidationResults: latest iteration wins when multiple iterations re-run same check', () => {
    const handoff = [
        '## Validation Outcomes',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| `npm test` | Fail | original |',
        '',
        '## Iteration 2 — round 1',
        '',
        '### Re-run validation',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| `npm test` | Pass | iter 2 |',
        '',
        '## Iteration 3 — round 2',
        '',
        '### Re-run validation',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| `npm test` | Fail | regressed iter 3 |',
        '',
    ].join('\n');

    const latest = computeLatestValidationResults(handoff);
    assert.equal(latest.get('test')!.result, 'Fail', 'latest iteration result wins');
});

void test('computeLatestValidationResults: check not re-run keeps baseline result', () => {
    const handoff = [
        '## Validation Outcomes',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| `npm run lint` | Pass | |',
        '| `npm test` | Fail | flaky |',
        '',
        '## Iteration 2 — round 1',
        '',
        '### Re-run validation',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| `npm test` | Pass | resolved |',
        '',
    ].join('\n');

    const latest = computeLatestValidationResults(handoff);
    assert.equal(latest.get('lint')!.result, 'Pass');
    assert.equal(latest.get('test')!.result, 'Pass');
});

void test('validateHandoff: cumulative handoff with all checks resolved in later iteration passes', () => {
    const handoffContent = [
        '## Changes',
        '',
        '| File | What |',
        '|---|---|',
        '| `src/x.ts` | new |',
        '',
        '## AC Coverage',
        '',
        '| AC | Status | Notes |',
        '|---|---|---|',
        '| AC-1: thing | Met | done |',
        '',
        '## Validation Outcomes',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| `npm test` | Fail | flaky in round 1 |',
        '',
        '## Iteration 2 — addressing review round 1',
        '',
        '### Re-run validation (only checks that re-ran)',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| `npm test` | Pass | fixed |',
        '',
    ].join('\n');

    withTempPair(
        ['# Spec', '', '## Validation Required', '', '- [x] `npm test`', ''].join('\n'),
        handoffContent,
        (specPath, handoffPath) => {
            const latest = computeLatestValidationResults(handoffContent);
            const issues = validateHandoffAgainstSpec(specPath, handoffPath, latest);
            assert.deepEqual(issues, [], `expected no issues; got ${JSON.stringify(issues)}`);
        },
    );
});

void test('validateHandoff: cumulative handoff where re-run still fails reports diagnostic', () => {
    const handoffContent = [
        '## Validation Outcomes',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| `npm test` | Fail | original |',
        '',
        '## Iteration 2 — round 1',
        '',
        '### Re-run validation',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| `npm test` | Fail | still broken |',
        '',
    ].join('\n');

    withTempPair(
        ['# Spec', '', '## Validation Required', '', '- [x] `npm test`', ''].join('\n'),
        handoffContent,
        (specPath, handoffPath) => {
            const latest = computeLatestValidationResults(handoffContent);
            const issues = validateHandoffAgainstSpec(specPath, handoffPath, latest);
            assert.ok(
                issues.some(i => i.includes('did not pass')),
                `expected fail diagnostic; got ${JSON.stringify(issues)}`,
            );
        },
    );
});

// ─── Issue #41 regression: pipeline-owned task artifacts must be exempt ───

void test('verifyHandoffAgainstDiffFromData: tasks/<active-id>/* artifacts in diff do not require handoff entries', () => {
    // From canon-ai issue #41 (James / TokenAnxiety stack-radar-001): task
    // artifacts in tasks/<id>/ that get committed to the task branch appear
    // in `git diff base...HEAD` and used to be flagged as uncovered diff
    // files. Codex would route back to implement, the next pass appended
    // more iteration sections to handoff/notes, the preflight rejected
    // again — preflight loop.
    const issues = verifyHandoffAgainstDiffFromData(
        ['demo-task'],
        {
            diffFiles: ['apps/web/src/Page.tsx', 'tasks/demo-task/spec.md', 'tasks/demo-task/status.json'],
            handoffFilesByTask: makeHandoffMap({
                'demo-task': ['apps/web/src/Page.tsx'],
            }),
        },
    );
    assert.deepEqual(issues, []);
});

void test('verifyHandoffAgainstDiffFromData: tasks/<active-id>/* exemption is per-active-task; other tasks/<id>/ paths still flagged', () => {
    // Strict-scope guard: only paths under tasks/<id>/ for an ACTIVE bundle
    // task get exempted. Random tasks/other-id/ paths in the diff should
    // still be rejected so accidental cross-task edits don't slip through.
    const issues = verifyHandoffAgainstDiffFromData(
        ['demo-task'],
        {
            diffFiles: ['tasks/demo-task/spec.md', 'tasks/some-other-task/notes.md'],
            handoffFilesByTask: makeHandoffMap({
                'demo-task': [],
            }),
        },
    );
    assert.equal(issues.length, 1);
    assert.ok(issues[0].includes('tasks/some-other-task/notes.md'));
});

void test('verifyHandoffAgainstDiffFromData: app/source changes still strictly required in handoff', () => {
    // Adjacent guarantee: the exemption is narrow. Source files outside
    // tasks/<id>/ must still appear in the handoff Changes table.
    const issues = verifyHandoffAgainstDiffFromData(
        ['demo-task'],
        {
            diffFiles: ['apps/web/src/Page.tsx', 'tasks/demo-task/handoff.md'],
            handoffFilesByTask: makeHandoffMap({
                'demo-task': [],
            }),
        },
    );
    assert.equal(issues.length, 1);
    assert.ok(issues[0].includes('apps/web/src/Page.tsx'));
});

void test('verifyHandoffAgainstDiffFromData: rename whose either side is a pipeline-owned task artifact is exempt', () => {
    // Archive moves (tasks/<id>/ → tasks/_archive/<id>/) and pre-archive
    // edits show up as renames in `git diff -M`. Pipeline-owned paths on
    // either side keep the rename out of the rejection set.
    const issues = verifyHandoffAgainstDiffFromData(
        ['demo-task'],
        {
            diffFiles: [],
            renamePairs: [['tasks/demo-task/notes.md', 'tasks/demo-task/notes.archived.md']],
            handoffFilesByTask: makeHandoffMap({
                'demo-task': [],
            }),
        },
    );
    assert.deepEqual(issues, []);
});

// ─── PR #39 CodeRabbit finding #2: --ship branch name resolution ───
// resolveTaskBranchName is internal; we test it indirectly via the call sites
// in main.ts. Manual smoke covered by routine canon-on-canon ship cycles.
// (Not adding a unit test here — the fallback path is exercised by every
// existing task in the repo whose status.branch is absent.)

// ─── 1a-2 phase gate ───
// checkPhaseGate fires before task.sh advances a phase to `done`. Each
// case below tests one accept/reject branch of the gate. The CLI wrapper
// (check-phase-gate.ts) is just argv parsing + exit-code mapping around
// this function; integration test via task.sh would duplicate the unit
// coverage.

import { checkPhaseGate } from '../scripts/run-task/validation.js';

function withTempTaskDir(
    fn: (taskId: string, taskDirRoot: string) => void,
): void {
    // Build tasks/<id>/ under a temp root so checkPhaseGate's taskDirFor()
    // resolves there via CANON_TASKS_DIR_OVERRIDE — same pattern
    // prompt-fidelity-tests uses to point production reads at a temp
    // fixture dir.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-gate-'));
    const tasksRoot = path.join(root, 'tasks');
    const taskId = `phase-gate-task`;
    const taskDir = path.join(tasksRoot, taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    const prevOverride = process.env.CANON_TASKS_DIR_OVERRIDE;
    process.env.CANON_TASKS_DIR_OVERRIDE = tasksRoot;
    try {
        fn(taskId, taskDir);
    } finally {
        if (prevOverride === undefined) delete process.env.CANON_TASKS_DIR_OVERRIDE;
        else process.env.CANON_TASKS_DIR_OVERRIDE = prevOverride;
        fs.rmSync(root, { recursive: true, force: true });
    }
}

void test('checkPhaseGate: spec phase accepts a filled spec.md', () => {
    withTempTaskDir((taskId, taskDir) => {
        fs.writeFileSync(path.join(taskDir, 'spec.md'), '# Spec: real task — Real Title\n\n## Problem\n\nReal problem.\n');
        const result = checkPhaseGate(taskId, 'spec');
        assert.deepEqual(result, { ok: true });
    });
});

void test('checkPhaseGate: spec phase rejects a template-only spec.md', () => {
    withTempTaskDir((taskId, taskDir) => {
        fs.writeFileSync(path.join(taskDir, 'spec.md'), '# Spec: [TASK-ID] — [Title]\n\n## Problem\n\nDescribe...\n');
        const result = checkPhaseGate(taskId, 'spec');
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.reason, /spec\.md is still the unfilled template/);
    });
});

void test('checkPhaseGate: spec phase rejects when spec.md is missing', () => {
    withTempTaskDir(taskId => {
        const result = checkPhaseGate(taskId, 'spec');
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.reason, /spec\.md is missing/);
    });
});

void test('checkPhaseGate: code_review accepts when review.md is filled AND verdict matches checked box', () => {
    withTempTaskDir((taskId, taskDir) => {
        fs.writeFileSync(path.join(taskDir, 'review.md'), [
            '# Code Review: real task',
            '',
            '## Final Verdict',
            '',
            '- [x] **Approved**',
            '- [ ] **Changes requested**',
        ].join('\n'));
        const result = checkPhaseGate(taskId, 'code_review', 'approved');
        assert.deepEqual(result, { ok: true });
    });
});

void test('checkPhaseGate: code_review rejects when verdict argument disagrees with checked box in review.md', () => {
    withTempTaskDir((taskId, taskDir) => {
        fs.writeFileSync(path.join(taskDir, 'review.md'), [
            '# Code Review: real task',
            '',
            '## Final Verdict',
            '',
            '- [x] **Changes requested**',
        ].join('\n'));
        const result = checkPhaseGate(taskId, 'code_review', 'approved');
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.reason, /verdict mismatch/);
    });
});

void test('checkPhaseGate: code_review rejects when review.md has no checked verdict box', () => {
    withTempTaskDir((taskId, taskDir) => {
        fs.writeFileSync(path.join(taskDir, 'review.md'), [
            '# Code Review: real task',
            '',
            '## Final Verdict',
            '',
            '- [ ] **Approved**',
            '- [ ] **Changes requested**',
        ].join('\n'));
        const result = checkPhaseGate(taskId, 'code_review', 'approved');
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.reason, /no checked verdict checkbox/);
    });
});

void test('checkPhaseGate: code_review rejects when verdict is not provided', () => {
    withTempTaskDir((taskId, taskDir) => {
        fs.writeFileSync(path.join(taskDir, 'review.md'), '# Code Review: real task\n\n- [x] **Approved**\n');
        const result = checkPhaseGate(taskId, 'code_review', undefined);
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.reason, /requires a verdict argument/);
    });
});

void test('checkPhaseGate: runtime_validation has no gate (CLI contract: verdict optional, orchestrator writes always include one)', () => {
    // The gate does not enforce a verdict on runtime_validation manual
    // transitions — the orchestrator's setRuntimeValidationPhase() bypasses
    // task.sh entirely and always provides a verdict via its direct write
    // path. Manual `task.sh phase X runtime_validation done` without a
    // verdict is treated as a deliberate repair action by the operator.
    withTempTaskDir(taskId => {
        assert.deepEqual(checkPhaseGate(taskId, 'runtime_validation', 'approved'), { ok: true });
        assert.deepEqual(checkPhaseGate(taskId, 'runtime_validation', undefined), { ok: true });
    });
});

void test('checkPhaseGate: qa rejects done.md template via the multi-sentinel detector', () => {
    withTempTaskDir((taskId, taskDir) => {
        fs.writeFileSync(path.join(taskDir, 'done.md'), [
            '# QA Summary: real task',
            '',
            '## What Changed',
            '',
            'One paragraph, plain English. No code jargon.',  // sentinel from isDoneMdTemplate
        ].join('\n'));
        const result = checkPhaseGate(taskId, 'qa');
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.reason, /done\.md is still the unfilled template/);
    });
});

void test('checkPhaseGate: human_review has no artifact + no verdict requirement (always accepts)', () => {
    withTempTaskDir(taskId => {
        const result = checkPhaseGate(taskId, 'human_review');
        assert.deepEqual(result, { ok: true });
    });
});
