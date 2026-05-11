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
