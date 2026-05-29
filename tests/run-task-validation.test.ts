import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    parseNameStatusOutput,
} from '../scripts/run-task/git.js';
import {
    deriveTopLevelStatus,
    readStatus,
    writeStatusToFile,
} from '../scripts/run-task/state.js';
import type { StatusJson } from '../scripts/run-task/types.js';
import {
    canonicalizeValidationCheck,
    checkAcCoveragePlaceholders,
    computeLatestValidationResults,
    extractHandoffPath,
    parseAffectedFilesFromSpec,
    parseHandoffChangesRows,
    parseHandoffFiles,
    parseHandoffPathCell,
    validateHandoffAgainstSpec,
    verifyBaseDivergence,
    verifyBaseDivergenceFromData,
    verifyBaseDrift,
    verifyBaseDriftFromData,
    verifyHandoffAgainstDiffFromData,
    verifyRerouteAmendment,
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

void test('parseNameStatusOutput: empty diff returns no affected files', () => {
    assert.deepEqual(parseNameStatusOutput(''), []);
});

void test('parseNameStatusOutput: non-renamed change returns one path', () => {
    assert.deepEqual(parseNameStatusOutput('M\0src/foo.ts\0'), ['src/foo.ts']);
});

void test('parseNameStatusOutput: rename returns pre-image and post-image paths sorted', () => {
    assert.deepEqual(parseNameStatusOutput('R95\0old.ts\0new.ts\0'), ['new.ts', 'old.ts']);
});

void test('parseNameStatusOutput: deletion is included', () => {
    assert.deepEqual(parseNameStatusOutput('D\0src/gone.ts\0'), ['src/gone.ts']);
});

void test('parseNameStatusOutput: binary-modified file is included', () => {
    assert.deepEqual(parseNameStatusOutput('B\0bin/binary\0'), ['bin/binary']);
});

void test('parseNameStatusOutput: paths with spaces survive NUL decoding', () => {
    assert.deepEqual(
        parseNameStatusOutput('M\0src/has spaces.ts\0R100\0old name.ts\0new name.ts\0'),
        ['new name.ts', 'old name.ts', 'src/has spaces.ts'],
    );
});

void test('legacy status with retired phase block parses, routes implement to code_review, and roundtrips intact', () => {
    const retiredPhase = `runtime${'_'}validation`;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-retirement-status-'));
    const tasksRoot = path.join(root, 'tasks');
    const taskId = 'legacy-status-task';
    const taskDir = path.join(tasksRoot, taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    const statusPath = path.join(taskDir, 'status.json');
    const legacyStatus = {
        id: taskId,
        status: 'implement',
        phases: {
            spec: { status: 'done', agent: 'claude' },
            spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
            plan: { status: 'done', agent: 'claude' },
            implement: { status: 'done', agent: 'codex' },
            [retiredPhase]: {
                status: 'pending',
                agent: 'orchestrator',
                verdict: '',
                iterations: 0,
                iterations_current_loop: 0,
                iterations_total: 0,
                changes_requested_total: 0,
                auto_block_count: 0,
            },
            code_review: { status: 'pending', agent: 'claude', verdict: '', iterations: 0 },
            qa: { status: 'pending', agent: 'claude' },
            human_review: { status: 'pending', agent: 'human' },
        },
    } as unknown as StatusJson;
    fs.writeFileSync(statusPath, `${JSON.stringify(legacyStatus, null, 2)}\n`, 'utf8');

    const prevOverride = process.env.CANON_TASKS_DIR_OVERRIDE;
    process.env.CANON_TASKS_DIR_OVERRIDE = tasksRoot;
    try {
        const parsed = readStatus(taskId);
        assert.equal(deriveTopLevelStatus(parsed), 'code_review');

        writeStatusToFile(statusPath, parsed);
        const roundtripped = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as {
            status: string;
            phases: Record<string, unknown>;
        };
        assert.equal(roundtripped.status, 'code_review');
        assert.ok(roundtripped.phases[retiredPhase]);
    } finally {
        if (prevOverride === undefined) delete process.env.CANON_TASKS_DIR_OVERRIDE;
        else process.env.CANON_TASKS_DIR_OVERRIDE = prevOverride;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function withTempTaskHandoff(
    taskId: string,
    handoffContent: string,
    fn: () => void,
): void {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-task-handoff-'));
    const tasksRoot = path.join(root, 'tasks');
    const taskDir = path.join(tasksRoot, taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'handoff.md'), handoffContent);

    const prevOverride = process.env.CANON_TASKS_DIR_OVERRIDE;
    process.env.CANON_TASKS_DIR_OVERRIDE = tasksRoot;
    try {
        fn();
    } finally {
        if (prevOverride === undefined) delete process.env.CANON_TASKS_DIR_OVERRIDE;
        else process.env.CANON_TASKS_DIR_OVERRIDE = prevOverride;
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function withTempTaskSpec(
    taskId: string,
    specContent: string | null,
    fn: (cwd: string, tasksRoot: string) => void,
): void {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'affected-files-spec-'));
    const tasksRoot = path.join(root, 'tasks');
    const taskDir = path.join(tasksRoot, taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    if (specContent !== null) {
        fs.writeFileSync(path.join(taskDir, 'spec.md'), specContent, 'utf8');
    }

    const prevOverride = process.env.CANON_TASKS_DIR_OVERRIDE;
    process.env.CANON_TASKS_DIR_OVERRIDE = tasksRoot;
    try {
        fn(root, tasksRoot);
    } finally {
        if (prevOverride === undefined) delete process.env.CANON_TASKS_DIR_OVERRIDE;
        else process.env.CANON_TASKS_DIR_OVERRIDE = prevOverride;
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function writeAffectedFilesSpec(tasksRoot: string, taskId: string, fileCells: readonly string[]): void {
    const taskDir = path.join(tasksRoot, taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'spec.md'), [
        `# Spec: ${taskId}`,
        '',
        '## Design',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        ...fileCells.map(cell => `| ${cell} | fixture change |`),
        '',
    ].join('\n'), 'utf8');
}

function withTempTaskSpecs(
    specs: Record<string, readonly string[]>,
    fn: (tasksRoot: string) => void,
): void {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'base-drift-specs-'));
    const tasksRoot = path.join(root, 'tasks');
    for (const [taskId, fileCells] of Object.entries(specs)) {
        writeAffectedFilesSpec(tasksRoot, taskId, fileCells);
    }

    const prevOverride = process.env.CANON_TASKS_DIR_OVERRIDE;
    process.env.CANON_TASKS_DIR_OVERRIDE = tasksRoot;
    try {
        fn(tasksRoot);
    } finally {
        if (prevOverride === undefined) delete process.env.CANON_TASKS_DIR_OVERRIDE;
        else process.env.CANON_TASKS_DIR_OVERRIDE = prevOverride;
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function captureConsoleError<T>(fn: () => T): { result: T; stderr: string } {
    const original = console.error;
    const messages: string[] = [];
    console.error = (...args: unknown[]) => {
        messages.push(args.map(arg => String(arg)).join(' '));
    };
    try {
        return { result: fn(), stderr: messages.join('\n') };
    } finally {
        console.error = original;
    }
}

function gitIn(cwd: string, ...args: string[]): void {
    execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function makeGitFixture(dir: string): { localDir: string; originDir: string } {
    const originDir = path.join(dir, 'origin.git');
    const localDir = path.join(dir, 'local');
    execFileSync('git', ['init', '--bare', originDir], { stdio: 'ignore' });
    execFileSync('git', ['clone', originDir, localDir], { stdio: 'ignore' });
    gitIn(localDir, 'config', 'user.email', 'test@example.com');
    gitIn(localDir, 'config', 'user.name', 'Test User');
    gitIn(localDir, 'checkout', '-b', 'main');
    fs.writeFileSync(path.join(localDir, 'initial-fixture.txt'), 'initial\n', 'utf8');
    gitIn(localDir, 'add', 'initial-fixture.txt');
    gitIn(localDir, 'commit', '-m', 'initial');
    gitIn(localDir, 'push', '-u', 'origin', 'main');
    return { localDir, originDir };
}

// ── canonicalizeValidationCheck (issue #71) ──────────────────────────────────

void test('canonicalizeValidationCheck: plain backtick-quoted command → last word', () => {
    assert.equal(canonicalizeValidationCheck('`npm run lint`'), 'lint');
    assert.equal(canonicalizeValidationCheck('`npm test`'), 'test');
});

void test('canonicalizeValidationCheck: cell with escaped backticks no longer leaves trailing backslash in canonical', () => {
    // Pre-fix regression: the cell `Type checking: \`npm run type-check:all\``
    // canonicalized to `type-check:all\` (with trailing backslash) because the
    // first-backtick-span match included the `\`. Fix strips both backticks
    // and backslashes when the captured span includes a backslash.
    assert.equal(
        canonicalizeValidationCheck('Type checking: \\`npm run type-check:all\\`'),
        'type-check:all',
    );
});

void test('canonicalizeValidationCheck: preserves legitimate backslashes in labels (e.g. regex escapes)', () => {
    // Codex P2 on PR #71 iter 1: the fallback originally stripped EVERY
    // backslash globally, which would corrupt labels like `grep \w+`. The
    // narrowed pattern only consumes `\`` (backslash-then-backtick) so
    // freestanding backslashes pass through.
    assert.equal(
        canonicalizeValidationCheck('Pattern grep: \\`grep \\w+\\`'),
        '\\w+',
    );
});

void test('canonicalizeValidationCheck: backtick span with internal backslash uses shortcut (Codex P2 on PR #81 iter 1)', () => {
    // Regression guard: the escaped-backtick guard previously fired on ANY
    // backslash inside the captured span (`.includes('\\')`), which pushed
    // legitimate checks with surrounding prose into the plain-text fallback
    // and produced wrong canonical keys (the last prose word instead of the
    // code-spanned token). The narrowed `.endsWith('\\')` guard only fires
    // when the captured span ends with `\` — the actual escaped-backtick
    // signature.
    assert.equal(
        canonicalizeValidationCheck('Do `grep \\w+` check'),
        '\\w+',
    );
    // Path-style content with internal backslash also uses the shortcut.
    assert.equal(
        canonicalizeValidationCheck('Run `node C:\\path\\to\\script.js` to verify'),
        'c:\\path\\to\\script.js',
    );
});

void test('canonicalizeValidationCheck: plain text with no backticks falls back to dash-split last word', () => {
    assert.equal(canonicalizeValidationCheck('lint — runs eslint'), 'lint');
    assert.equal(canonicalizeValidationCheck('lint'), 'lint');
});

void test('canonicalizeValidationCheck: clean backtick span wins over surrounding prose (no regression)', () => {
    // The pre-fix shortcut: when a clean backtick-bounded span is present,
    // only that span is canonicalized — surrounding prose is ignored.
    assert.equal(canonicalizeValidationCheck('`lint` and other stuff'), 'lint');
});

void test('validateHandoffAgainstSpec: missing row error includes the canonical key + present rows hint', () => {
    withTempPair(
        ['# Spec', '', '## Validation Required', '', '- [x] `npm run type-check`', ''].join('\n'),
        [
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `npm run lint` | Pass | ok |',
            '',
        ].join('\n'),
        (specPath, handoffPath) => {
            const issues = validateHandoffAgainstSpec(specPath, handoffPath);
            assert.equal(issues.length, 1);
            // Diagnostic now lists what the handoff DOES have so the user
            // can spot a canonicalization mismatch instead of chasing a
            // false "row missing" root cause.
            assert.match(issues[0], /missing from handoff\.md/);
            assert.match(issues[0], /canonicalized to: 'type-check'/);
            assert.match(issues[0], /Handoff has rows for: lint/);
        },
    );
});

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
            assert.equal(issues.length, 1);
            assert.match(issues[0], /required checks cannot be skipped/);
            assert.match(issues[0], /npm run test:e2e/);
        },
    );
});

void test('validateHandoffAgainstSpec fails closed when Validation Required is missing', () => {
    withTempPair(
        [
            '# Spec',
            '',
            '## Overview',
            '',
            'This spec forgets to declare validation requirements.',
            '',
        ].join('\n'),
        [
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `npm run lint` | Pass | ok |',
            '',
        ].join('\n'),
        (specPath, handoffPath) => {
            const issues = validateHandoffAgainstSpec(specPath, handoffPath);
            assert.deepEqual(issues, ['Validation Required section is missing from spec.md']);
        },
    );
});

void test('validateHandoffAgainstSpec fails closed when Validation Required exists but lists no checked items', () => {
    withTempPair(
        [
            '# Spec',
            '',
            '## Validation Required',
            '',
            '- [ ] `npm run lint`',
            '- [ ] `npm run test`',
            '',
        ].join('\n'),
        [
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `npm run lint` | Pass | ok |',
            '| `npm run test` | Pass | ok |',
            '',
        ].join('\n'),
        (specPath, handoffPath) => {
            const issues = validateHandoffAgainstSpec(specPath, handoffPath);
            assert.equal(issues.length, 1);
            assert.match(issues[0], /Validation Required section in spec\.md has no `\[x\]`-checked items/);
            assert.match(issues[0], /mark at least one required check `\[x\]`/);
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

void test('parseHandoffFiles unions baseline Changes and iteration Changes tables', () => {
    withTempTaskHandoff('union-task', [
        '# Implementation Handoff: test',
        '',
        '## Changes',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| `src/base.ts` | baseline change |',
        '',
        '## Iteration 2 — addressing review round 1',
        '',
        '### Changes',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| `src/iter.ts` | new file added in iteration 2 |',
        '',
        '### Findings addressed',
        '',
        '- _correctness bug:_ "example" → fixed',
        '',
    ].join('\n'), () => {
        assert.deepEqual(parseHandoffFiles('union-task'), ['src/base.ts', 'src/iter.ts']);
    });
});

void test('parseAffectedFilesFromSpec returns valid paths from the Design Affected Files table', () => {
    withTempTaskSpec('affected-task', [
        '# Spec: affected task',
        '',
        '## Design',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `scripts/run-task/main.ts` | update allow-list |',
        '| [tests/run-task-safety.test.ts](https://github.com/example/repo/blob/main/tests/run-task-safety.test.ts) | add safety tests |',
        '| `docs/pipeline-orchestrator.md` | document behavior |',
        '',
    ].join('\n'), () => {
        assert.deepEqual(parseAffectedFilesFromSpec('affected-task'), {
            files: [
                'scripts/run-task/main.ts',
                'tests/run-task-safety.test.ts',
                'docs/pipeline-orchestrator.md',
            ],
            malformed: [],
        });
    });
});

void test('parseAffectedFilesFromSpec returns empty result when spec.md is missing', () => {
    withTempTaskSpec('missing-spec-task', null, () => {
        assert.deepEqual(parseAffectedFilesFromSpec('missing-spec-task'), {
            files: [],
            malformed: [],
        });
    });
});

void test('parseAffectedFilesFromSpec returns empty result when Design section is missing', () => {
    withTempTaskSpec('no-design-task', [
        '# Spec: no design',
        '',
        '## Problem',
        '',
        'Nothing here.',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `docs/codebase-map.md` | should not be parsed outside Design |',
        '',
    ].join('\n'), () => {
        assert.deepEqual(parseAffectedFilesFromSpec('no-design-task'), {
            files: [],
            malformed: [],
        });
    });
});

void test('parseAffectedFilesFromSpec returns empty result when Affected Files H3 is missing', () => {
    withTempTaskSpec('no-affected-files-task', [
        '# Spec: no affected files',
        '',
        '## Design',
        '',
        '### Interaction Dependencies',
        '',
        '| File | Change |',
        '|---|---|',
        '| `docs/codebase-map.md` | should not be parsed from a different H3 |',
        '',
    ].join('\n'), () => {
        assert.deepEqual(parseAffectedFilesFromSpec('no-affected-files-task'), {
            files: [],
            malformed: [],
        });
    });
});

void test('parseAffectedFilesFromSpec reports malformed placeholder rows', () => {
    withTempTaskSpec('malformed-affected-task', [
        '# Spec: malformed affected files',
        '',
        '## Design',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `docs/codebase-map.md` | valid managed doc |',
        '| `<path>` | placeholder left in template |',
        '',
    ].join('\n'), () => {
        const result = parseAffectedFilesFromSpec('malformed-affected-task');
        assert.deepEqual(result.files, ['docs/codebase-map.md']);
        assert.equal(result.malformed.length, 1);
        assert.equal(result.malformed[0].cell, '`<path>`');
        assert.match(result.malformed[0].reason, /template placeholder/);
    });
});

void test('parseAffectedFilesFromSpec accepts backtick and markdown-link path cells', () => {
    withTempTaskSpec('format-affected-task', [
        '# Spec: affected files formats',
        '',
        '## Design',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `path/foo.ts` | backtick form |',
        '| [path/bar.ts](https://github.com/example/repo/blob/main/path/bar.ts) | markdown-link form |',
        '',
    ].join('\n'), () => {
        assert.deepEqual(parseAffectedFilesFromSpec('format-affected-task'), {
            files: ['path/foo.ts', 'path/bar.ts'],
            malformed: [],
        });
    });
});

void test('parseAffectedFilesFromSpec walks round-1 `## Amendment` Affected Files', () => {
    withTempTaskSpec('amendment-r1-task', [
        '# Spec: round-1 amendment',
        '',
        '## Design',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/original.ts` | original scope |',
        '',
        '## Amendment',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/added-by-amendment.ts` | added during reroute |',
        '',
    ].join('\n'), () => {
        assert.deepEqual(parseAffectedFilesFromSpec('amendment-r1-task'), {
            files: ['src/original.ts', 'src/added-by-amendment.ts'],
            malformed: [],
        });
    });
});

void test('parseAffectedFilesFromSpec walks round-N `## Amendment Round 2` Affected Files', () => {
    withTempTaskSpec('amendment-r2-task', [
        '# Spec: round-2 amendment',
        '',
        '## Design',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/original.ts` | original scope |',
        '',
        '## Amendment Round 2',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/added-round-2.ts` | added during round-2 reroute |',
        '',
    ].join('\n'), () => {
        assert.deepEqual(parseAffectedFilesFromSpec('amendment-r2-task'), {
            files: ['src/original.ts', 'src/added-round-2.ts'],
            malformed: [],
        });
    });
});

void test('parseAffectedFilesFromSpec dedupes a path declared in both Design and Amendment', () => {
    withTempTaskSpec('amendment-dedupe-task', [
        '# Spec: dedupe across sections',
        '',
        '## Design',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/shared.ts` | first declared in Design |',
        '',
        '## Amendment',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/shared.ts` | redeclared in amendment (e.g., operator clarification) |',
        '| `src/new.ts` | only declared in amendment |',
        '',
    ].join('\n'), () => {
        assert.deepEqual(parseAffectedFilesFromSpec('amendment-dedupe-task'), {
            files: ['src/shared.ts', 'src/new.ts'],
            malformed: [],
        });
    });
});

void test('parseAffectedFilesFromSpec unions multiple amendment rounds with Design', () => {
    withTempTaskSpec('amendment-multi-round-task', [
        '# Spec: multi-round amendments',
        '',
        '## Design',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/design.ts` | original |',
        '',
        '## Amendment',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/round-1.ts` | added in round 1 |',
        '',
        '## Amendment Round 2',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/round-2.ts` | added in round 2 |',
        '',
    ].join('\n'), () => {
        assert.deepEqual(parseAffectedFilesFromSpec('amendment-multi-round-task'), {
            files: ['src/design.ts', 'src/round-1.ts', 'src/round-2.ts'],
            malformed: [],
        });
    });
});

void test('parseAffectedFilesFromSpec reports malformed rows inside an amendment', () => {
    withTempTaskSpec('amendment-malformed-task', [
        '# Spec: malformed in amendment',
        '',
        '## Design',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/ok.ts` | valid |',
        '',
        '## Amendment',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `<path>` | placeholder left in amendment template |',
        '',
    ].join('\n'), () => {
        const result = parseAffectedFilesFromSpec('amendment-malformed-task');
        assert.deepEqual(result.files, ['src/ok.ts']);
        assert.equal(result.malformed.length, 1);
        assert.equal(result.malformed[0].cell, '`<path>`');
        assert.match(result.malformed[0].reason, /template placeholder/);
    });
});

void test('parseAffectedFilesFromSpec surfaces amendment-only Affected Files when Design has no H3', () => {
    withTempTaskSpec('amendment-only-task', [
        '# Spec: amendment-only',
        '',
        '## Design',
        '',
        'Originally a minimal-scope spec with no Affected Files table.',
        '',
        '## Amendment',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/late-arrival.ts` | scope arrived entirely via amendment |',
        '',
    ].join('\n'), () => {
        assert.deepEqual(parseAffectedFilesFromSpec('amendment-only-task'), {
            files: ['src/late-arrival.ts'],
            malformed: [],
        });
    });
});

void test('parseAffectedFilesFromSpec does NOT false-match `## Amendments` (plural)', () => {
    // The \b word boundary in /^## Amendment\b/ should reject `## Amendments`
    // because the next char ("s") is a word char. Guards against accidentally
    // pulling in rows from prose H2s that happen to start with "Amendment".
    withTempTaskSpec('amendment-plural-guard-task', [
        '# Spec: word-boundary guard',
        '',
        '## Design',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/in-design.ts` | should surface |',
        '',
        '## Amendments (prose section, not the reroute heading)',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `src/should-not-surface.ts` | this row must NOT be parsed |',
        '',
    ].join('\n'), () => {
        assert.deepEqual(parseAffectedFilesFromSpec('amendment-plural-guard-task'), {
            files: ['src/in-design.ts'],
            malformed: [],
        });
    });
});

void test('extractHandoffPath: backtick-quoted path', () => {
    assert.equal(extractHandoffPath('`src/foo.ts`'), 'src/foo.ts');
    assert.equal(extractHandoffPath('`src/foo.ts` some annotation'), 'src/foo.ts');
});

void test('extractHandoffPath: markdown-link path', () => {
    assert.equal(extractHandoffPath('[src/foo.ts](https://github.com/x/y/blob/main/src/foo.ts)'), 'src/foo.ts');
    assert.equal(extractHandoffPath('[src/foo.ts](/Users/local/path/src/foo.ts)'), 'src/foo.ts');
});

void test('extractHandoffPath: rejects multiple paths in a single cell (combined row)', () => {
    // Pre-1.3.0 this returned the FIRST path silently — the rest got dropped,
    // and the diff→handoff preflight then flagged them as mismatches. The
    // strict parser rejects the cell outright so the malformed row is the
    // actionable error rather than a downstream symptom.
    assert.equal(extractHandoffPath('`src/a.ts` and [src/b.ts](url)'), null);
    assert.equal(extractHandoffPath('`src/a.ts`, `src/b.ts`'), null);
});

void test('parseHandoffPathCell rejects markdown links with empty URL', () => {
    // `[foo]()` would otherwise pass the loose regex with an empty URL.
    // Codex won't produce this on purpose, but a template-substitution bug
    // that strips the URL to `()` would silently slip through.
    const result = parseHandoffPathCell('[src/foo.ts]()');
    assert.equal(result.kind, 'malformed');
});

void test('parseHandoffPathCell rejects absolute paths', () => {
    // Absolute paths poison `git check-ignore --stdin` (exits 128, returns no
    // partial stdout) — rejecting them at the parse boundary keeps the
    // batched gitignored-filter call clean for legitimate entries in the same
    // handoff.
    const posixResult = parseHandoffPathCell('`/etc/passwd`');
    assert.equal(posixResult.kind, 'malformed');
    if (posixResult.kind === 'malformed') assert.match(posixResult.reason, /absolute path/);

    const windowsResult = parseHandoffPathCell('`C:\\\\Users\\\\foo.ts`');
    assert.equal(windowsResult.kind, 'malformed');
    if (windowsResult.kind === 'malformed') assert.match(windowsResult.reason, /absolute path/);
});

void test('parseHandoffPathCell rejects parent-directory traversal paths', () => {
    const result = parseHandoffPathCell('`../outside-repo.ts`');
    assert.equal(result.kind, 'malformed');
    if (result.kind === 'malformed') assert.match(result.reason, /parent-directory traversal/);

    const nested = parseHandoffPathCell('`src/../../foo.ts`');
    assert.equal(nested.kind, 'malformed');
    if (nested.kind === 'malformed') assert.match(nested.reason, /parent-directory traversal/);
});

void test('parseHandoffPathCell allows bracketed filenames like src/foo[beta].ts', () => {
    // Square brackets are valid filename characters even though shell globs
    // treat them as character classes. The wildcard check must not over-reject.
    const result = parseHandoffPathCell('`src/foo[beta].ts`');
    assert.equal(result.kind, 'ok');
    if (result.kind === 'ok') assert.equal(result.path, 'src/foo[beta].ts');
});

void test('parseHandoffPathCell surfaces the specific rejection reason', () => {
    {
        const result = parseHandoffPathCell('`src/a.ts`, `src/b.ts`');
        assert.equal(result.kind, 'malformed');
        if (result.kind === 'malformed') {
            assert.match(result.reason, /multiple paths/);
            assert.match(result.reason, /one path per row/);
        }
    }
    {
        const result = parseHandoffPathCell('`src/content/examples/*.md`');
        assert.equal(result.kind, 'malformed');
        if (result.kind === 'malformed') {
            assert.match(result.reason, /wildcard not allowed/);
        }
    }
    {
        const result = parseHandoffPathCell('`<path>`');
        assert.equal(result.kind, 'malformed');
        if (result.kind === 'malformed') {
            assert.match(result.reason, /template placeholder/);
        }
    }
    {
        const result = parseHandoffPathCell('AC-9: `sitemap.xml` regenerated');
        assert.equal(result.kind, 'malformed');
        if (result.kind === 'malformed') {
            assert.match(result.reason, /at the start of the cell/);
        }
    }
    {
        const result = parseHandoffPathCell('`src/foo.ts`');
        assert.equal(result.kind, 'ok');
        if (result.kind === 'ok') assert.equal(result.path, 'src/foo.ts');
    }
});

void test('extractHandoffPath: markdown-link URL with parens still captures the path', () => {
    // The captured group is everything inside `[...]`. The URL part `(...)`
    // closing on the first `)` is fine for our purposes — we never read the
    // destination, only the path.
    assert.equal(
        extractHandoffPath('[src/foo.ts](/tmp/build(foo)/src/foo.ts)'),
        'src/foo.ts',
    );
    assert.equal(
        extractHandoffPath('[src/foo.ts](https://github.com/x/y/pull/123)'),
        'src/foo.ts',
    );
});

void test('extractHandoffPath: returns null for no recognized format', () => {
    assert.equal(extractHandoffPath('plain text src/foo.ts'), null);
    assert.equal(extractHandoffPath(''), null);
});

void test('parseHandoffFiles: accepts markdown-link format in Changes table', () => {
    withTempTaskHandoff('mdlink-task', [
        '# Implementation Handoff: test',
        '',
        '## Changes',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| [src/main.ts](/abs/path/src/main.ts) | refactor |',
        '| [tests/main.test.ts](https://github.com/x/y/blob/main/tests/main.test.ts) | new tests |',
        '',
    ].join('\n'), () => {
        assert.deepEqual(parseHandoffFiles('mdlink-task').sort(), ['src/main.ts', 'tests/main.test.ts']);
    });
});

void test('parseHandoffChangesRows surfaces malformed rows from baseline + iteration Changes tables', () => {
    withTempTaskHandoff('malformed-task', [
        '# Implementation Handoff: test',
        '',
        '## Changes',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| `src/good.ts` | clean baseline row |',
        '| `src/content/examples/*.md` | wildcard — should be rejected |',
        '| `<path>` | template placeholder — should be rejected |',
        '',
        '## Iteration 2 — addressing review round 1',
        '',
        '### Changes',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| `src/iter.ts`, `src/also-iter.ts` | combined row — should be rejected |',
        '',
    ].join('\n'), () => {
        const { files, malformed } = parseHandoffChangesRows('malformed-task');
        assert.deepEqual(files, ['src/good.ts']);
        assert.equal(malformed.length, 3);
        const reasons = malformed.map(m => m.reason).join('\n');
        assert.match(reasons, /wildcard not allowed/);
        assert.match(reasons, /template placeholder/);
        assert.match(reasons, /multiple paths in one cell/);
    });
});

void test('parseHandoffFiles preserves single-round handoff behavior', () => {
    withTempTaskHandoff('baseline-task', [
        '# Implementation Handoff: test',
        '',
        '## Changes',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| `src/only.ts` | single-round change |',
        '',
        '## Validation Outcomes',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| `npm run lint` | Pass | fixture |',
        '',
    ].join('\n'), () => {
        assert.deepEqual(parseHandoffFiles('baseline-task'), ['src/only.ts']);
    });
});

void test('verifyHandoffAgainstDiffFromData accepts iteration-added files covered by iteration Changes tables', () => {
    withTempTaskHandoff('iter-diff-task', [
        '# Implementation Handoff: test',
        '',
        '## Changes',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| `src/base.ts` | baseline change |',
        '',
        '## Iteration 2 — addressing review round 1',
        '',
        '### Changes',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| `src/iter.ts` | iteration-added file |',
        '',
        '### Findings addressed',
        '',
        '- _correctness bug:_ "example" → fixed',
        '',
    ].join('\n'), () => {
        const issues = verifyHandoffAgainstDiffFromData(
            ['iter-diff-task'],
            {
                diffFiles: ['src/base.ts', 'src/iter.ts'],
                handoffFilesByTask: makeHandoffMap({
                    'iter-diff-task': parseHandoffFiles('iter-diff-task'),
                }),
            },
        );
        assert.deepEqual(issues, []);
    });
});

void test('verifyHandoffAgainstDiffFromData exempts gitignored handoff entries from handoff→diff check', () => {
    // Build-generated artifacts like `public/sitemap.xml` that Codex
    // legitimately references in the Changes table to describe build output.
    // They cannot appear in `git diff base...HEAD` (not tracked) so the
    // standard handoff→diff check would always reject them. Callers compute
    // the gitignored subset via filterGitIgnoredPaths and pass it in.
    const issues = verifyHandoffAgainstDiffFromData(
        ['task-a'],
        {
            diffFiles: ['scripts/generate-sitemap.ts'],
            handoffFilesByTask: makeHandoffMap({
                'task-a': ['scripts/generate-sitemap.ts', 'public/sitemap.xml'],
            }),
            gitIgnoredHandoffFiles: new Set(['public/sitemap.xml']),
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

void test('verifyHandoffAgainstDiffFromData exempts PIPELINE_TELEMETRY_FILES from diff→handoff check', () => {
    const issues = verifyHandoffAgainstDiffFromData(
        ['task-a'],
        {
            diffFiles: [
                'src/foo.ts',
                'docs/lessons-learned.md',
                'docs/pipeline-invocations.md',
                'docs/task-quality-log.md',
            ],
            handoffFilesByTask: makeHandoffMap({
                'task-a': ['src/foo.ts'],
            }),
        },
    );
    assert.deepEqual(issues, []);
});

void test('verifyHandoffAgainstDiffFromData still rejects non-telemetry diff files missing from handoff when telemetry is also present', () => {
    const issues = verifyHandoffAgainstDiffFromData(
        ['task-a'],
        {
            diffFiles: ['docs/lessons-learned.md', 'src/baz.ts'],
            handoffFilesByTask: makeHandoffMap({
                'task-a': [],
            }),
        },
    );
    assert.equal(issues.length, 1);
    assert.ok(issues[0].includes('src/baz.ts'));
    assert.ok(!issues[0].includes('lessons-learned'));
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

void test('verifyBaseDriftFromData: empty diff returns no drift', () => {
    assert.deepEqual(verifyBaseDriftFromData([], new Set(), ['task-a']), []);
});

void test('verifyBaseDriftFromData: file listed in spec allowlist is accepted', () => {
    assert.deepEqual(
        verifyBaseDriftFromData(['docs/codebase-map.md'], new Set(['docs/codebase-map.md']), ['task-a']),
        [],
    );
});

void test('verifyBaseDriftFromData: file outside spec allowlist is drift', () => {
    assert.deepEqual(
        verifyBaseDriftFromData(['docs/decisions.md'], new Set(['docs/codebase-map.md']), ['task-a']),
        ['docs/decisions.md'],
    );
});

void test('verifyBaseDriftFromData: active task-dir files are accepted without allowlist entry', () => {
    assert.deepEqual(
        verifyBaseDriftFromData(['tasks/task-a/handoff.md'], new Set(), ['task-a']),
        [],
    );
});

void test('verifyBaseDriftFromData: telemetry file in allowlist is accepted', () => {
    assert.deepEqual(
        verifyBaseDriftFromData(['docs/pipeline-invocations.md'], new Set(['docs/pipeline-invocations.md']), ['task-a']),
        [],
    );
});

void test('verifyBaseDriftFromData: bundle unions disjoint task allowlists', () => {
    assert.deepEqual(
        verifyBaseDriftFromData(
            ['docs/codebase-map.md', 'scripts/run-task/main.ts'],
            new Set(['docs/codebase-map.md', 'scripts/run-task/main.ts']),
            ['task-a', 'task-b'],
        ),
        [],
    );
});

void test('verifyBaseDriftFromData: deleted path from name-status output is drift when not allowed', () => {
    const diffFiles = parseNameStatusOutput('D\0docs/deleted-file.md\0');
    assert.deepEqual(
        verifyBaseDriftFromData(diffFiles, new Set(), ['task-a']),
        ['docs/deleted-file.md'],
    );
});

void test('verifyBaseDriftFromData: rename requires both old and new paths in allowlist', () => {
    const diffFiles = parseNameStatusOutput('R100\0docs/old-name.md\0docs/new-name.md\0');
    assert.deepEqual(
        verifyBaseDriftFromData(diffFiles, new Set(['docs/new-name.md']), ['task-a']),
        ['docs/old-name.md'],
    );
});

void test('verifyBaseDrift: fetch failure warns and returns fetchFailed without drift', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'base-drift-offline-'));
    try {
        execFileSync('git', ['init', dir], { stdio: 'ignore' });
        gitIn(dir, 'remote', 'add', 'origin', path.join(dir, 'missing-origin.git'));
        withTempTaskSpecs({ 'task-a': [] }, () => {
            const { result, stderr } = captureConsoleError(() => verifyBaseDrift(['task-a'], 'main', dir));
            assert.deepEqual(result, { drift: [], fetchFailed: true, diffFailed: false });
            assert.match(stderr, /Could not fetch origin\/main/);
            assert.match(stderr, /Skipping base-drift check/);
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('verifyBaseDrift: malformed affected-file rows warn and do not enter the allowlist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'base-drift-malformed-'));
    try {
        const { localDir } = makeGitFixture(dir);
        withTempTaskSpecs({ 'task-a': ['`<path>`'] }, () => {
            const { result, stderr } = captureConsoleError(() => verifyBaseDrift(['task-a'], 'main', localDir));
            assert.deepEqual(result, { drift: [], fetchFailed: false, diffFailed: false });
            assert.match(stderr, /task-a spec\.md Affected Files row malformed/);
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('verifyBaseDrift: diff failure after successful fetch returns diffFailed and git error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'base-drift-diff-fail-'));
    try {
        const { originDir } = makeGitFixture(dir);
        const emptyLocalDir = path.join(dir, 'empty-local');
        execFileSync('git', ['init', emptyLocalDir], { stdio: 'ignore' });
        gitIn(emptyLocalDir, 'remote', 'add', 'origin', originDir);

        withTempTaskSpecs({ 'task-a': [] }, () => {
            const result = verifyBaseDrift(['task-a'], 'main', emptyLocalDir);
            assert.equal(result.fetchFailed, false);
            assert.equal(result.diffFailed, true);
            assert.deepEqual(result.drift, []);
            assert.equal(typeof result.diffError, 'string');
            assert.ok((result.diffError ?? '').length > 0);
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

function writeMinimalStatus(
    tasksRoot: string,
    taskId: string,
    overrides: { qaStatus?: 'pending' | 'in_progress' | 'done' } = {},
): void {
    const statusFile = path.join(tasksRoot, taskId, 'status.json');
    const status: StatusJson = {
        id: taskId,
        title: taskId,
        status: 'qa',
        created: '2026-05-26',
        updated: '2026-05-26',
        branch: `task/${taskId}`,
        base_branch: 'main',
        task_size: 'S',
        delicate: false,
        human_spec_gate: false,
        worktree: false,
        phases: {
            spec: { status: 'done', agent: 'claude' },
            spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
            plan: { status: 'done', agent: 'claude' },
            implement: { status: 'done', agent: 'codex' },
            code_review: { status: 'done', agent: 'claude', verdict: 'approved' },
            qa: { status: overrides.qaStatus ?? 'pending', agent: 'claude' },
            human_review: { status: 'pending', agent: 'human' },
        },
    };
    writeStatusToFile(statusFile, status);
}

void test('verifyBaseDrift: directory-form Affected Files entry accepts subpaths', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'base-drift-dirform-'));
    try {
        const { localDir } = makeGitFixture(dir);
        gitIn(localDir, 'checkout', '-b', 'task/demo');
        const distFile = path.join(localDir, 'dist', 'cli', 'index.js');
        fs.mkdirSync(path.dirname(distFile), { recursive: true });
        fs.writeFileSync(distFile, 'bundle\n', 'utf8');
        gitIn(localDir, 'add', 'dist/cli/index.js');
        gitIn(localDir, 'commit', '-m', 'rebuild dist');

        withTempTaskSpecs({ 'task-a': ['`dist/`'] }, () => {
            const result = verifyBaseDrift(['task-a'], 'main', localDir);
            assert.equal(result.fetchFailed, false);
            assert.equal(result.diffFailed, false);
            assert.deepEqual(result.drift, []);
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('verifyBaseDrift: directory-form prefix does not bleed across siblings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'base-drift-dirform-bleed-'));
    try {
        const { localDir } = makeGitFixture(dir);
        gitIn(localDir, 'checkout', '-b', 'task/demo');
        const siblingFile = path.join(localDir, 'dist-other', 'foo.js');
        fs.mkdirSync(path.dirname(siblingFile), { recursive: true });
        fs.writeFileSync(siblingFile, 'sibling\n', 'utf8');
        gitIn(localDir, 'add', 'dist-other/foo.js');
        gitIn(localDir, 'commit', '-m', 'sibling dir');

        withTempTaskSpecs({ 'task-a': ['`dist/`'] }, () => {
            const result = verifyBaseDrift(['task-a'], 'main', localDir);
            assert.deepEqual(result.drift, ['dist-other/foo.js']);
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('verifyBaseDrift: QA-done task auto-allowlists PIPELINE_MANAGED_DOCS', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'base-drift-qa-done-'));
    try {
        const { localDir } = makeGitFixture(dir);
        gitIn(localDir, 'checkout', '-b', 'task/demo');
        const patternsFile = path.join(localDir, 'docs', 'patterns.md');
        fs.mkdirSync(path.dirname(patternsFile), { recursive: true });
        fs.writeFileSync(patternsFile, '# Patterns\n\nNew QA-promoted lesson.\n', 'utf8');
        gitIn(localDir, 'add', 'docs/patterns.md');
        gitIn(localDir, 'commit', '-m', 'QA promotes lesson into patterns');

        withTempTaskSpecs({ 'task-a': ['`scripts/run-task/main.ts`'] }, (tasksRoot) => {
            writeMinimalStatus(tasksRoot, 'task-a', { qaStatus: 'done' });
            const result = verifyBaseDrift(['task-a'], 'main', localDir);
            assert.deepEqual(result.drift, []);
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('verifyBaseDrift: QA-pending task does NOT auto-allowlist managed docs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'base-drift-qa-pending-'));
    try {
        const { localDir } = makeGitFixture(dir);
        gitIn(localDir, 'checkout', '-b', 'task/demo');
        const patternsFile = path.join(localDir, 'docs', 'patterns.md');
        fs.mkdirSync(path.dirname(patternsFile), { recursive: true });
        fs.writeFileSync(patternsFile, '# Patterns\n\nPremature edit.\n', 'utf8');
        gitIn(localDir, 'add', 'docs/patterns.md');
        gitIn(localDir, 'commit', '-m', 'edit before QA completes');

        withTempTaskSpecs({ 'task-a': ['`scripts/run-task/main.ts`'] }, (tasksRoot) => {
            writeMinimalStatus(tasksRoot, 'task-a', { qaStatus: 'pending' });
            const result = verifyBaseDrift(['task-a'], 'main', localDir);
            assert.deepEqual(result.drift, ['docs/patterns.md']);
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('verifyBaseDriftFromData: allowedPrefixes accepts subpaths under the prefix', () => {
    assert.deepEqual(
        verifyBaseDriftFromData(
            ['dist/cli/index.js'],
            new Set(),
            ['task-a'],
            ['dist/'],
        ),
        [],
    );
});

void test('verifyBaseDriftFromData: empty allowedPrefixes leaves the legacy 3-arg signature behavior intact', () => {
    assert.deepEqual(
        verifyBaseDriftFromData(['dist/cli/index.js'], new Set(), ['task-a']),
        ['dist/cli/index.js'],
    );
});

void test('verifyBaseDivergenceFromData: empty commits returns empty string', () => {
    assert.equal(verifyBaseDivergenceFromData([]), '');
});

void test('verifyBaseDivergenceFromData: single commit includes short-sha and full subject', () => {
    const message = verifyBaseDivergenceFromData([
        { sha: 'abcdef1234567890', subject: 'task(foo): commit artifacts' },
    ]);
    assert.match(message, /abcdef1/);
    assert.match(message, /task\(foo\): commit artifacts/);
    assert.equal(
        message,
        [
            'Base divergence detected: 1 colliding commit on <base> not yet on origin/<base>; they will collide when <base> is pulled:',
            '  abcdef1  task(foo): commit artifacts',
            'Fix: git push origin <base>',
            'Override: rerun with --allow-divergent-base to skip this commit-divergence check only.',
        ].join('\n'),
    );
});

void test('verifyBaseDivergenceFromData: multiple commits listed in input order on separate lines', () => {
    const message = verifyBaseDivergenceFromData([
        { sha: 'aaaaaaa000000001', subject: 'first commit' },
        { sha: 'bbbbbbb000000002', subject: 'second commit' },
    ]);
    assert.match(message, /\n  aaaaaaa  first commit\n  bbbbbbb  second commit\n/);
});

void test('verifyBaseDivergenceFromData: message includes operator fix and override literals', () => {
    const message = verifyBaseDivergenceFromData([
        { sha: 'deadbeef00000000', subject: 'some change' },
    ]);
    assert.match(message, /git push origin/);
    assert.match(message, /--allow-divergent-base/);
});

void test('verifyBaseDivergence: clean repo with no divergent commits returns empty ok result', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'base-divergence-clean-'));
    try {
        const { localDir } = makeGitFixture(dir);
        const result = verifyBaseDivergence('main', localDir);
        assert.deepEqual(result, { commits: [], ok: true, stderr: '', fetchFailed: false });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('verifyBaseDivergence: non-existent cwd returns ok:false with non-empty stderr', () => {
    const result = verifyBaseDivergence('main', path.join(os.tmpdir(), `missing-cwd-${Date.now()}`));
    assert.equal(result.ok, false);
    assert.equal(result.fetchFailed, false);
    assert.ok(result.stderr.length > 0);
});

void test('verifyBaseDivergence: unpushed base commits match from repo root and worktree cwd', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'base-divergence-worktree-'));
    try {
        const { localDir } = makeGitFixture(dir);
        fs.writeFileSync(path.join(localDir, 'scaffold.txt'), 'scaffold\n', 'utf8');
        gitIn(localDir, 'add', 'scaffold.txt');
        gitIn(localDir, 'commit', '-m', 'task(example): commit artifacts pre-pipeline');
        const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: localDir, encoding: 'utf8' }).trim();

        const worktreeDir = path.join(dir, 'worktree');
        gitIn(localDir, 'worktree', 'add', '-b', 'task/example', worktreeDir, 'main');
        const repoRootResult = verifyBaseDivergence('main', localDir);
        const worktreeResult = verifyBaseDivergence('main', worktreeDir);

        assert.equal(repoRootResult.ok, true);
        assert.equal(worktreeResult.ok, true);
        assert.deepEqual(repoRootResult.commits, [
            { sha, subject: 'task(example): commit artifacts pre-pipeline' },
        ]);
        assert.deepEqual(worktreeResult.commits, repoRootResult.commits);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('verifyBaseDrift: two-dot diff catches base-advance drift that three-dot would miss', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'base-drift-mode1-'));
    try {
        const { localDir, originDir } = makeGitFixture(dir);
        gitIn(localDir, 'checkout', '-b', 'task/demo');
        const taskFile = path.join(localDir, 'scripts', 'run-task', 'main.ts');
        fs.mkdirSync(path.dirname(taskFile), { recursive: true });
        fs.writeFileSync(taskFile, 'task content\n', 'utf8');
        gitIn(localDir, 'add', 'scripts/run-task/main.ts');
        gitIn(localDir, 'commit', '-m', 'task change');

        const thirdPartyDir = path.join(dir, 'third-party');
        execFileSync('git', ['clone', '-b', 'main', originDir, thirdPartyDir], { stdio: 'ignore' });
        gitIn(thirdPartyDir, 'config', 'user.email', 'third@example.com');
        gitIn(thirdPartyDir, 'config', 'user.name', 'Third Party');
        const baseAdvanceFile = path.join(thirdPartyDir, 'docs', 'decisions.md');
        fs.mkdirSync(path.dirname(baseAdvanceFile), { recursive: true });
        fs.writeFileSync(baseAdvanceFile, 'third-party content\n', 'utf8');
        gitIn(thirdPartyDir, 'add', 'docs/decisions.md');
        gitIn(thirdPartyDir, 'commit', '-m', 'third-party base advance');
        gitIn(thirdPartyDir, 'push', 'origin', 'main');

        withTempTaskSpecs({ 'task-a': ['`scripts/run-task/main.ts`'] }, () => {
            const result = verifyBaseDrift(['task-a'], 'main', localDir);
            assert.equal(result.fetchFailed, false);
            assert.equal(result.diffFailed, false);
            assert.deepEqual(result.drift, ['docs/decisions.md']);
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('verifyRerouteAmendment: round 1 accepts `## Amendment`', () => {
    withTempTaskSpec('reroute-round-1-amendment', [
        '# Spec',
        '',
        '## Amendment',
        '',
        'New direction.',
        '',
    ].join('\n'), () => {
        const result = verifyRerouteAmendment('reroute-round-1-amendment', 1);
        assert.equal(result.amended, true);
        assert.equal(result.reason, '');
    });
});

void test('verifyRerouteAmendment: round 1 accepts lowercase h3 amendment headings', () => {
    withTempTaskSpec('reroute-round-1-lowercase', [
        '# Spec',
        '',
        '### amendment',
        '',
        'New direction.',
        '',
    ].join('\n'), () => {
        const result = verifyRerouteAmendment('reroute-round-1-lowercase', 1);
        assert.equal(result.amended, true);
        assert.equal(result.reason, '');
    });
});

void test('verifyRerouteAmendment: round 1 accepts strict round-1 form', () => {
    withTempTaskSpec('reroute-round-1-strict', [
        '# Spec',
        '',
        '## Amendment Round 1',
        '',
        'New direction.',
        '',
    ].join('\n'), () => {
        const result = verifyRerouteAmendment('reroute-round-1-strict', 1);
        assert.equal(result.amended, true);
        assert.equal(result.reason, '');
    });
});

void test('verifyRerouteAmendment: round 1 rejects missing Amendment headings', () => {
    withTempTaskSpec('reroute-round-1-missing', [
        '# Spec',
        '',
        '## Overview',
        '',
        'No amendment heading here.',
        '',
    ].join('\n'), () => {
        const result = verifyRerouteAmendment('reroute-round-1-missing', 1);
        assert.equal(result.amended, false);
        assert.match(result.reason, /no `## Amendment` heading found/);
    });
});

void test('verifyRerouteAmendment: round 1 rejects legacy Follow-up headings', () => {
    withTempTaskSpec('reroute-round-1-legacy', [
        '# Spec',
        '',
        '## Follow-up',
        '',
        'New direction.',
        '',
    ].join('\n'), () => {
        const result = verifyRerouteAmendment('reroute-round-1-legacy', 1);
        assert.equal(result.amended, false);
        assert.match(result.reason, /no `## Amendment` heading found/);
    });
});

void test('verifyRerouteAmendment: round 2 accepts `## Amendment Round 2`', () => {
    withTempTaskSpec('reroute-round-2-amendment', [
        '# Spec',
        '',
        '## Amendment Round 2',
        '',
        'Second-round direction.',
        '',
    ].join('\n'), () => {
        const result = verifyRerouteAmendment('reroute-round-2-amendment', 2);
        assert.equal(result.amended, true);
        assert.equal(result.reason, '');
    });
});

void test('verifyRerouteAmendment: round 2 reports the seen round when only round 1 exists', () => {
    withTempTaskSpec('reroute-round-2-mismatch', [
        '# Spec',
        '',
        '## Amendment Round 1',
        '',
        'First-round direction only.',
        '',
    ].join('\n'), () => {
        const result = verifyRerouteAmendment('reroute-round-2-mismatch', 2);
        assert.equal(result.amended, false);
        assert.match(result.reason, /found `## Amendment Round 1`/);
        assert.match(result.reason, /expected `## Amendment Round 2`/);
    });
});

void test('verifyRerouteAmendment: round 2 rejects the bare round-1 Amendment heading', () => {
    withTempTaskSpec('reroute-round-2-bare', [
        '# Spec',
        '',
        '## Amendment',
        '',
        'Only the first round heading is present.',
        '',
    ].join('\n'), () => {
        const result = verifyRerouteAmendment('reroute-round-2-bare', 2);
        assert.equal(result.amended, false);
        assert.match(result.reason, /found `## Amendment`/);
        assert.match(result.reason, /expected `## Amendment Round 2`/);
    });
});

void test('verifyRerouteAmendment: missing spec.md reports the path in the reason', () => {
    withTempTaskSpec('reroute-round-missing-file', null, () => {
        const result = verifyRerouteAmendment('reroute-round-missing-file', 2);
        assert.equal(result.amended, false);
        assert.match(result.reason, /spec\.md missing at/);
        assert.match(result.reason, /reroute-round-missing-file/);
    });
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
// checkPhaseGate fires before canon task advances a phase to `done`. Each
// case below tests one accept/reject branch of the gate. The CLI wrapper
// (check-phase-gate.ts) is just argv parsing + exit-code mapping around
// this function; integration test via canon task would duplicate the unit
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

void test('checkPhaseGate: human_review rejects when handoff.md is missing', () => {
    withTempTaskDir(taskId => {
        const result = checkPhaseGate(taskId, 'human_review');
        assert.equal(result.ok, false);
        assert.match(result.reason, /handoff\.md/);
    });
});

// ─── 1b validation result enum + human_review gate ───

import {
    countHumanPendingChecks,
    hasHumanPendingWaiver,
    isHumanPendingResult,
    isBlockedResult,
    isDeferredBySpecResult,
    isNotConfiguredResult,
    isPendingResult,
    isUnrelatedFailResult,
} from '../scripts/run-task/validation.js';

void test('result enum: state-detector helpers recognize each new value (case + delim variants)', () => {
    assert.ok(isHumanPendingResult('human_pending'));
    assert.ok(isHumanPendingResult('Human Pending'));
    assert.ok(isHumanPendingResult('HUMAN-PENDING'));
    assert.ok(isBlockedResult('blocked'));
    assert.ok(isBlockedResult('BLOCKED'));
    assert.ok(isDeferredBySpecResult('deferred_by_spec'));
    assert.ok(isDeferredBySpecResult('Deferred By Spec'));
    assert.ok(isNotConfiguredResult('not_configured'));
    assert.ok(isNotConfiguredResult('Not Configured'));
    assert.ok(isPendingResult(''));
    assert.ok(isPendingResult('Pass / Fail / N/A'));  // template-row state
    assert.ok(isUnrelatedFailResult('Fail – unrelated'));
    assert.ok(isUnrelatedFailResult('fail - unrelated'));
    assert.ok(isUnrelatedFailResult('FAIL — UNRELATED'));
    assert.equal(isUnrelatedFailResult('fail'), false);
    assert.equal(isUnrelatedFailResult('pass'), false);
    assert.equal(isHumanPendingResult('pass'), false);
    assert.equal(isBlockedResult('human_pending'), false);
});

void test('validateHandoffAgainstSpec: Fail – unrelated with notes is accepted (reviewer assesses)', () => {
    withTempPair(
        ['# Spec', '', '## Validation Required', '', '- [x] `npm run test`', ''].join('\n'),
        [
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `npm run test` | Fail – unrelated | tests/foo.test.ts:42 — pre-existing timing race unrelated to Affected Files |',
            '',
        ].join('\n'),
        (specPath, handoffPath) => {
            const issues = validateHandoffAgainstSpec(specPath, handoffPath);
            assert.deepEqual(issues, []);
        },
    );
});

void test('validateHandoffAgainstSpec: Fail – unrelated without notes is rejected', () => {
    withTempPair(
        ['# Spec', '', '## Validation Required', '', '- [x] `npm run test`', ''].join('\n'),
        [
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `npm run test` | Fail – unrelated |  |',
            '',
        ].join('\n'),
        (specPath, handoffPath) => {
            const issues = validateHandoffAgainstSpec(specPath, handoffPath);
            assert.equal(issues.length, 1);
            assert.match(issues[0], /Fail.*unrelated.*needs a specific test\/file reference/);
        },
    );
});

void test('validateHandoffAgainstSpec: Fail – unrelated with vague notes (no file ref) is rejected', () => {
    for (const vague of ['pre-existing flake', 'CI/network flake', 'unit/e2e failure', 'see logs']) {
        withTempPair(
            ['# Spec', '', '## Validation Required', '', '- [x] `npm run test`', ''].join('\n'),
            [
                '## Validation Outcomes',
                '',
                '| Check | Result | Notes |',
                '|---|---|---|',
                `| \`npm run test\` | Fail – unrelated | ${vague} |`,
                '',
            ].join('\n'),
            (specPath, handoffPath) => {
                const issues = validateHandoffAgainstSpec(specPath, handoffPath);
                assert.equal(issues.length, 1, `expected rejection for notes: "${vague}"`);
                assert.match(issues[0], /Fail.*unrelated.*needs a specific test\/file reference/);
            },
        );
    }
});

void test('validateHandoffAgainstSpec: human_pending on a required check is accepted (soft state)', () => {
    withTempPair(
        ['# Spec', '', '## Validation Required', '', '- [x] `npm run e2e:safari`', ''].join('\n'),
        [
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `npm run e2e:safari` | human_pending | Safari unavailable on Linux CI |',
            '',
        ].join('\n'),
        (specPath, handoffPath) => {
            const issues = validateHandoffAgainstSpec(specPath, handoffPath);
            assert.deepEqual(issues, []);
        },
    );
});

void test('validateHandoffAgainstSpec: blocked on a required check fails with triage-required message', () => {
    withTempPair(
        ['# Spec', '', '## Validation Required', '', '- [x] `npm run test`', ''].join('\n'),
        [
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `npm run test` | blocked | CI infra down |',
            '',
        ].join('\n'),
        (specPath, handoffPath) => {
            const issues = validateHandoffAgainstSpec(specPath, handoffPath);
            assert.equal(issues.length, 1);
            assert.match(issues[0], /blocked/);
            assert.match(issues[0], /triage required/);
        },
    );
});

void test('validateHandoffAgainstSpec: deferred_by_spec without a spec citation in Notes is rejected', () => {
    withTempPair(
        ['# Spec', '', '## Validation Required', '', '- [x] `npm run test`', ''].join('\n'),
        [
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `npm run test` | deferred_by_spec | wasn\'t needed |',
            '',
        ].join('\n'),
        (specPath, handoffPath) => {
            const issues = validateHandoffAgainstSpec(specPath, handoffPath);
            assert.equal(issues.length, 1);
            assert.match(issues[0], /without a spec citation/);
        },
    );
});

void test('validateHandoffAgainstSpec: deferred_by_spec with a spec citation in Notes is accepted', () => {
    withTempPair(
        ['# Spec', '', '## Validation Required', '', '- [x] `npm run test`', ''].join('\n'),
        [
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `npm run test` | deferred_by_spec | Spec: §Non-Goals explicitly defers this. |',
            '',
        ].join('\n'),
        (specPath, handoffPath) => {
            const issues = validateHandoffAgainstSpec(specPath, handoffPath);
            assert.deepEqual(issues, []);
        },
    );
});

void test('validateHandoffAgainstSpec: not_configured on a required check fails (cannot skip)', () => {
    withTempPair(
        ['# Spec', '', '## Validation Required', '', '- [x] `npm run test`', ''].join('\n'),
        [
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `npm run test` | not_configured | (intent: skip) |',
            '',
        ].join('\n'),
        (specPath, handoffPath) => {
            const issues = validateHandoffAgainstSpec(specPath, handoffPath);
            assert.equal(issues.length, 1);
            assert.match(issues[0], /required checks cannot be skipped/);
        },
    );
});

void test('countHumanPendingChecks: returns matching rows with check name + notes', () => {
    const handoff = [
        '## Validation Outcomes',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| `npm run lint` | Pass | clean |',
        '| `npm run e2e:safari` | human_pending | needs macOS Safari |',
        '| `npm run e2e:firefox` | human_pending |  |',
        '| `npm run test` | Fail | unrelated |',
        '',
    ].join('\n');
    const pending = countHumanPendingChecks(handoff);
    assert.equal(pending.length, 2);
    assert.equal(pending[0].check, '`npm run e2e:safari`');
    assert.match(pending[0].notes, /macOS Safari/);
    assert.equal(pending[1].check, '`npm run e2e:firefox`');
});

void test('hasHumanPendingWaiver: matches an "Acknowledged:" line in done.md', () => {
    assert.ok(hasHumanPendingWaiver('## Decisions\n\nAcknowledged: Safari/Firefox e2e deferred to post-merge by team agreement.\n'));
    assert.ok(hasHumanPendingWaiver('   acknowledged: deferred  '));  // leading whitespace + lowercase ok
    assert.equal(hasHumanPendingWaiver('## Done\n\nAll good.\n'), false);
});

void test('checkPhaseGate human_review: rejects when handoff has unresolved human_pending and no waiver', () => {
    withTempTaskDir((taskId, taskDir) => {
        fs.writeFileSync(path.join(taskDir, 'handoff.md'), [
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `npm run e2e:safari` | human_pending | needs Safari |',
            '',
        ].join('\n'));
        const result = checkPhaseGate(taskId, 'human_review');
        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.match(result.reason, /human_review cannot close/);
            assert.match(result.reason, /e2e:safari/);
            assert.match(result.reason, /add an explicit waiver/);
        }
    });
});

void test('checkPhaseGate human_review: accepts when handoff has human_pending but done.md has waiver', () => {
    withTempTaskDir((taskId, taskDir) => {
        fs.writeFileSync(path.join(taskDir, 'handoff.md'), [
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `npm run e2e:safari` | human_pending | needs Safari |',
            '',
        ].join('\n'));
        fs.writeFileSync(path.join(taskDir, 'done.md'), [
            '# Done',
            '',
            'Acknowledged: Safari e2e deferred to post-merge — covered by Firefox locally.',
            '',
        ].join('\n'));
        const result = checkPhaseGate(taskId, 'human_review');
        assert.deepEqual(result, { ok: true });
    });
});

void test('checkPhaseGate human_review: accepts when no human_pending rows exist', () => {
    withTempTaskDir((taskId, taskDir) => {
        fs.writeFileSync(path.join(taskDir, 'handoff.md'), [
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `npm run lint` | Pass | clean |',
            '| `npm run test` | Pass | 50/50 |',
            '',
        ].join('\n'));
        const result = checkPhaseGate(taskId, 'human_review');
        assert.deepEqual(result, { ok: true });
    });
});

void test('checkPhaseGate human_review: rejects when handoff is missing entirely (fail closed)', () => {
    withTempTaskDir(taskId => {
        const result = checkPhaseGate(taskId, 'human_review');
        assert.equal(result.ok, false);
        assert.match(result.reason, /handoff\.md/);
    });
});

void test('checkPhaseGate human_review: honors an explicit task root override for worktree callers', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-gate-override-'));
    const tasksRoot = path.join(root, 'tasks');
    const taskId = 'phase-gate-worktree';
    const taskDir = path.join(tasksRoot, taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'handoff.md'), [
        '## Validation Outcomes',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| `npm run e2e:safari` | human_pending | needs Safari |',
        '',
    ].join('\n'));
    const result = checkPhaseGate(taskId, 'human_review', undefined, tasksRoot);
    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.match(result.reason, /human_review cannot close/);
        assert.match(result.reason, /e2e:safari/);
    }
});

void test('regression: isPendingResult catches 1b template sentinel so untouched rows do not silently pass', () => {
    // Codex P1 on the 1b inline change: isPassResult is prefix-based, so the
    // new template cell `Pass / Fail / not_configured / human_pending / ...`
    // would otherwise be parsed as a Pass. isPendingResult must catch it.
    assert.ok(isPendingResult('Pass / Fail / N/A'));  // legacy template
    assert.ok(isPendingResult('Pass / Fail / not_configured / human_pending / deferred_by_spec / blocked'));  // 1b template
    assert.ok(isPendingResult('  Pass / Fail / not_configured  '));  // whitespace tolerant
    assert.equal(isPendingResult('Pass'), false);
    assert.equal(isPendingResult('pass'), false);
});

void test('regression: validateHandoffAgainstSpec rejects a row with the 1b template Result cell', () => {
    // Belt-and-suspenders: prove the end-to-end behavior (untouched template
    // row → required check reported as missing, not silently passing).
    withTempPair(
        ['# Spec', '', '## Validation Required', '', '- [x] `npm run lint`', ''].join('\n'),
        [
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `npm run lint` | Pass / Fail / not_configured / human_pending / deferred_by_spec / blocked | |',
            '',
        ].join('\n'),
        (specPath, handoffPath) => {
            const issues = validateHandoffAgainstSpec(specPath, handoffPath);
            assert.equal(issues.length, 1);
            // New (issue #71): "present but unfilled" distinguishes the
            // template-pending case from the row-absent case.
            assert.match(issues[0], /present but unfilled.*template 'pending' state/);
        },
    );
});
