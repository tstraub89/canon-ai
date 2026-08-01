import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { REPO_ROOT } from '../scripts/run-task/env.js';
import { extractAcSummary, extractAffectedFiles, extractValidationChecks } from '../scripts/run-task/context.js';
import { validateTaskId } from '../scripts/run-task/cli.js';
import { deriveTopLevelStatus } from '../scripts/run-task/state.js';
import {
    parseValidationOutcomeRows,
    parseValidationRequiredChecks,
} from '../scripts/run-task/validation.js';
import type { StatusJson } from '../scripts/run-task/types.js';

const TSX_LOADER = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');

function loadEnvMaxReviewLoops(raw: string): { value: number | null; stderr: string } {
    const envUrl = pathToFileURL(path.join(process.cwd(), 'scripts/run-task/env.ts')).href;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--eval', [
        `import(${JSON.stringify(envUrl)})`,
        '.then(m => console.log(JSON.stringify(m.config.maxReviewLoops)))',
        '.catch(error => { console.error(error); process.exit(1); });',
    ].join('')], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, MAX_REVIEW_LOOPS: raw },
    });
    assert.equal(result.status, 0, result.stderr);
    return {
        value: JSON.parse(result.stdout.trim()) as number | null,
        stderr: result.stderr,
    };
}

void test('env config rejects malformed or negative MAX_REVIEW_LOOPS and preserves zero', () => {
    for (const raw of ['abc', '-1', '1.5', '2junk']) {
        const loaded = loadEnvMaxReviewLoops(raw);
        assert.equal(loaded.value, null, raw);
        assert.match(loaded.stderr, new RegExp(`Invalid MAX_REVIEW_LOOPS value .*${raw.replace('.', '\\.')}`));
    }
    const zero = loadEnvMaxReviewLoops('0');
    assert.equal(zero.value, 0);
    assert.doesNotMatch(zero.stderr, /Invalid MAX_REVIEW_LOOPS/);
});

function withTempDir<T>(prefix: string, fn: (dir: string) => T): T {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    try {
        return fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function withTempTaskSpec<T>(specContent: string, fn: (taskId: string, taskRoot: string, specPath: string) => T): T {
    return withTempDir('run-task-harness-', dir => {
        const taskRoot = path.join(dir, 'tasks');
        const taskId = 'harness-task';
        const specPath = path.join(taskRoot, taskId, 'spec.md');
        fs.mkdirSync(path.dirname(specPath), { recursive: true });
        fs.writeFileSync(specPath, specContent, 'utf8');

        const previous = process.env.CANON_TASKS_DIR_OVERRIDE;
        process.env.CANON_TASKS_DIR_OVERRIDE = taskRoot;
        try {
            return fn(taskId, taskRoot, specPath);
        } finally {
            if (previous === undefined) delete process.env.CANON_TASKS_DIR_OVERRIDE;
            else process.env.CANON_TASKS_DIR_OVERRIDE = previous;
        }
    });
}

function runValidateTaskId(taskId: string): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(process.execPath, ['--import', TSX_LOADER, '-e', [
        `import(${JSON.stringify(path.join(REPO_ROOT, 'scripts/run-task/cli.ts'))})`,
        `.then(m => { m.validateTaskId(${JSON.stringify(taskId)}); console.log('ok'); })`,
        '.catch(err => { console.error(err); process.exit(1); });',
    ].join('')], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: process.env,
    });

    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

void test('deriveTopLevelStatus returns the first phase that is not done', () => {
    const cases: Array<[string, Partial<StatusJson['phases']>, string]> = [
        ['complete', {
            spec: { status: 'done', agent: 'claude' },
            spec_review: { status: 'done', agent: 'codex' },
            plan: { status: 'done', agent: 'claude' },
            implement: { status: 'done', agent: 'codex' },
            code_review: { status: 'done', agent: 'claude', verdict: 'approved' },
            qa: { status: 'done', agent: 'claude' },
            human_review: { status: 'done', agent: 'human' },
        }, 'complete'],
        ['spec', {
            spec: { status: 'pending', agent: 'claude' },
            spec_review: { status: 'pending', agent: 'codex' },
        }, 'spec'],
        ['plan', {
            spec: { status: 'done', agent: 'claude' },
            spec_review: { status: 'done', agent: 'codex' },
            plan: { status: 'pending', agent: 'claude' },
        }, 'plan'],
    ];

    for (const [label, phases, expected] of cases) {
        const actual = deriveTopLevelStatus({
            id: `task-${label}`,
            phases,
        } satisfies StatusJson);
        assert.equal(actual, expected);
    }
});

void test('extractAffectedFiles parses the Affected Files table and ignores malformed rows', () => {
    withTempTaskSpec([
        '# Spec',
        '',
        '## Design',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/foo.ts` | update |',
        '| src/bar.ts | malformed — no backtick |',
        '| `docs/baz.md` | docs |',
        '',
    ].join('\n'), taskId => {
        assert.deepEqual(extractAffectedFiles(taskId), ['src/foo.ts', 'docs/baz.md']);
    });
});

void test('extractAffectedFiles picks up paths from an Amendment section', () => {
    withTempTaskSpec([
        '# Spec',
        '',
        '## Design',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/original.ts` | update |',
        '',
        '## Amendment',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/added-in-amendment.ts` | add |',
        '',
    ].join('\n'), taskId => {
        const files = extractAffectedFiles(taskId);
        assert.ok(files.includes('src/original.ts'), 'Design table path missing');
        assert.ok(files.includes('src/added-in-amendment.ts'), 'Amendment table path missing');
    });
});

void test('extractAffectedFiles extracts paths from markdown-link cells', () => {
    withTempTaskSpec([
        '# Spec',
        '',
        '## Design',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| [src/linked.ts](src/linked.ts) | update via markdown link |',
        '',
    ].join('\n'), taskId => {
        assert.deepEqual(extractAffectedFiles(taskId), ['src/linked.ts']);
    });
});

void test('extractAffectedFiles returns an empty list when the section is missing', () => {
    withTempTaskSpec([
        '# Spec',
        '',
        '## Overview',
        '',
        'No affected files table here.',
        '',
    ].join('\n'), taskId => {
        assert.deepEqual(extractAffectedFiles(taskId), []);
    });
});

void test('extractAcSummary captures AC lines and ignores unrelated bullets', () => {
    withTempTaskSpec([
        '# Spec',
        '',
        '- [x] AC-1: ship the fix',
        '- [ ] AC-2: keep it safe',
        '- [x] not-an-AC: ignore me',
        '',
    ].join('\n'), taskId => {
        assert.deepEqual(extractAcSummary(taskId), [
            '- AC-1: ship the fix',
            '- AC-2: keep it safe',
        ]);
    });
});

void test('extractAcSummary returns an empty list when no AC markers are present', () => {
    withTempTaskSpec([
        '# Spec',
        '',
        'Nothing that looks like AC-1 or AC-2.',
        '',
    ].join('\n'), taskId => {
        assert.deepEqual(extractAcSummary(taskId), []);
    });
});

void test('extractValidationChecks captures checkbox rows and ignores malformed bullets', () => {
    withTempTaskSpec([
        '# Spec',
        '',
        '## Validation Required',
        '',
        '- [x] `npm run lint`',
        '- [ ] `npm run test`',
        '- [x] npm run build',
        '* [x] `npm run doc`',
        '',
    ].join('\n'), taskId => {
        assert.deepEqual(extractValidationChecks(taskId), [
            'npm run lint',
            'npm run test',
            'npm run build',
        ]);
    });
});

void test('extractValidationChecks returns an empty list when the section is missing', () => {
    withTempTaskSpec([
        '# Spec',
        '',
        '## Overview',
        '',
        'No validation section yet.',
        '',
    ].join('\n'), taskId => {
        assert.deepEqual(extractValidationChecks(taskId), []);
    });
});

void test('parseValidationOutcomeRows parses the Validation Outcomes table', () => {
    withTempDir('run-task-harness-handoff-', dir => {
        const handoffPath = path.join(dir, 'handoff.md');
        fs.writeFileSync(handoffPath, [
            '# Handoff',
            '',
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `npm run lint` | Pass | ok |',
            '| `npm run test` | Human_Pending | waiting on QA |',
            '',
        ].join('\n'), 'utf8');

        assert.deepEqual(parseValidationOutcomeRows(handoffPath), [
            { check: '`npm run lint`', result: 'Pass', notes: 'ok' },
            { check: '`npm run test`', result: 'Human_Pending', notes: 'waiting on QA' },
        ]);
    });
});

void test('parseValidationOutcomeRows returns an empty list when the table is missing', () => {
    withTempDir('run-task-harness-handoff-missing-', dir => {
        const handoffPath = path.join(dir, 'handoff.md');
        fs.writeFileSync(handoffPath, [
            '# Handoff',
            '',
            '## Validation Results',
            '',
            'The expected section is missing.',
            '',
        ].join('\n'), 'utf8');

        assert.deepEqual(parseValidationOutcomeRows(handoffPath), []);
    });
});

void test('parseValidationRequiredChecks returns checked validation requirements and ignores unchecked rows', () => {
    withTempDir('run-task-harness-spec-', dir => {
        const specPath = path.join(dir, 'spec.md');
        fs.writeFileSync(specPath, [
            '# Spec',
            '',
            '## Validation Required',
            '',
            '- [x] `npm run lint`',
            '- [x] `npm run test` — with the new parser coverage',
            '- [ ] `npm run build`',
            '',
        ].join('\n'), 'utf8');

        assert.deepEqual(parseValidationRequiredChecks(specPath), [
            '`npm run lint`',
            '`npm run test` — with the new parser coverage',
        ]);
    });
});

void test('parseValidationRequiredChecks returns null when the section is missing entirely', () => {
    withTempDir('run-task-harness-spec-missing-', dir => {
        const missingPath = path.join(dir, 'missing-spec.md');
        fs.writeFileSync(missingPath, ['# Spec', '', '## Overview', '', 'No validation section.', ''].join('\n'), 'utf8');
        assert.equal(parseValidationRequiredChecks(missingPath), null);
    });
});

void test('parseValidationRequiredChecks returns empty array when the section exists but has no `[x]` items', () => {
    // Distinct from the missing-section case so callers can emit the right
    // error: the missing case requires writing the section; the empty case
    // requires marking `[x]` checks. Conflating these (returning null for
    // both) misled an operator during docs-refs-check-canon-template's
    // code_review preflight on 2026-05-24.
    withTempDir('run-task-harness-spec-empty-', dir => {
        const emptyPath = path.join(dir, 'empty-spec.md');
        fs.writeFileSync(emptyPath, ['# Spec', '', '## Validation Required', '', '- [ ] `npm run lint`', ''].join('\n'), 'utf8');
        assert.deepEqual(parseValidationRequiredChecks(emptyPath), []);
    });
});

void test('validateTaskId accepts leading digits and rejects path traversal / punctuation edge cases', () => {
    for (const valid of ['1', '123', '1a2', 'task-1']) {
        validateTaskId(valid);
    }

    const cases: Array<[string, RegExp]> = [
        ['.hidden', /Invalid task ID '\.hidden'/],
        ['-leading', /Invalid task ID '-leading'/],
        ['task..bad', /Must not contain '\.\.'/],
        ['bad..name', /Must not contain '\.\.'/],
        ['UpperCase', /Invalid task ID 'UpperCase'/],
    ];

    for (const [taskId, pattern] of cases) {
        const result = runValidateTaskId(taskId);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, pattern);
    }
});
