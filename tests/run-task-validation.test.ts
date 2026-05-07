import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateHandoffAgainstSpec } from '../scripts/run-task.ts';

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

test('validateHandoffAgainstSpec rejects N/A for a required validation check', () => {
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

test('validateHandoffAgainstSpec matches by canonical command, ignoring spec annotations', () => {
    // Regression: smart-fill-exclude-locked-photos shipped with a spec line like
    // "`npm run test` — including the four new unit tests (3 in optimizer test
    // file, 1 in wall-composition test file)" but the handoff row contained just
    // "`npm run test`". The pre-flight rejected the handoff for ~4 implement
    // iterations because the canonicalizer compared full annotated strings.
    withTempPair(
        [
            '# Spec',
            '',
            '## Validation Required',
            '',
            '- [x] `npm run lint`',
            '- [x] `npm run test` — including the four new unit tests (3 in optimizer test file, 1 in wall-composition test file)',
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

test('validateHandoffAgainstSpec allows required checks to pass and optional checks to stay N/A', () => {
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
