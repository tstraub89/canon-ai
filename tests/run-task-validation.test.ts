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
    autoBlockPhase,
    deriveTopLevelStatus,
    readStatus,
    validateStatus,
    writeStatusToFile,
} from '../scripts/run-task/state.js';
import { _VERDICT_VALUES } from '../scripts/run-task/types.js';
import type { StatusJson, TaskContext } from '../scripts/run-task/types.js';
import {
    canonicalizeValidationCheck,
    checkAcCoveragePlaceholders,
    checkRerouteEvidence,
    buildSharedDocAbortMessage,
    classifySharedDocDirtFromData,
    classifySharedDocSetFromData,
    classifyPreflightBlockersFromData,
    collectUnscannedTableHits,
    computeLatestValidationResults,
    extractCheckedVerdict,
    extractCitedFilePaths,
    extractHandoffPath,
    isPrBodyTemplate,
    matchAgainstChangedFiles,
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
    sliceRerouteRoundSection,
    verifyRerouteAmendment,
} from '../scripts/run-task/validation.js';
import { checkAndRoute, resolveQaPrBody } from '../scripts/run-task/main.js';
import {
    buildPreflightReviewBlock,
    determinePreflightRoute,
    writePreflightReviewArtifacts,
} from '../scripts/run-task/phases/code-review.js';
import { taskPhasePreflightRejected, VALID_VERDICTS } from '../src/task/index.js';

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

function withTempDir(prefix: string, fn: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    try {
        fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function withTempTasks<T>(fn: (tasksRoot: string) => T): T {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-task-validation-tasks-'));
    const tasksRoot = path.join(root, 'tasks');
    const previousOverride = process.env.CANON_TASKS_DIR_OVERRIDE;
    process.env.CANON_TASKS_DIR_OVERRIDE = tasksRoot;
    try {
        fs.mkdirSync(tasksRoot, { recursive: true });
        return fn(tasksRoot);
    } finally {
        if (previousOverride === undefined) {
            delete process.env.CANON_TASKS_DIR_OVERRIDE;
        } else {
            process.env.CANON_TASKS_DIR_OVERRIDE = previousOverride;
        }
        fs.rmSync(root, { recursive: true, force: true });
    }
}

async function withTempTasksAsync<T>(fn: (tasksRoot: string) => Promise<T>): Promise<T> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-task-validation-tasks-'));
    const tasksRoot = path.join(root, 'tasks');
    const previousOverride = process.env.CANON_TASKS_DIR_OVERRIDE;
    process.env.CANON_TASKS_DIR_OVERRIDE = tasksRoot;
    try {
        fs.mkdirSync(tasksRoot, { recursive: true });
        return await fn(tasksRoot);
    } finally {
        if (previousOverride === undefined) {
            delete process.env.CANON_TASKS_DIR_OVERRIDE;
        } else {
            process.env.CANON_TASKS_DIR_OVERRIDE = previousOverride;
        }
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function makeCodeReviewStatus(
    taskId: string,
    codeReviewOverrides: Partial<NonNullable<StatusJson['phases']['code_review']>> = {},
): StatusJson {
    return {
        id: taskId,
        title: taskId,
        status: 'code_review',
        created: '2026-06-06',
        updated: '2026-06-06',
        branch: `task/${taskId}`,
        base_branch: 'dev',
        task_size: 'S',
        delicate: false,
        human_spec_gate: false,
        full_send: false,
        worktree: false,
        phases: {
            spec: { status: 'done', agent: 'claude' },
            spec_review: { status: 'done', agent: 'codex', verdict: 'approved', iterations: 0 },
            plan: { status: 'done', agent: 'claude' },
            implement: { status: 'done', agent: 'codex' },
            code_review: {
                status: 'pending',
                agent: 'claude',
                verdict: '',
                iterations: 0,
                iterations_current_loop: 0,
                iterations_total: 0,
                changes_requested_total: 0,
                preflight_rejections_current_loop: 0,
                preflight_rejections_total: 0,
                auto_block_count: 0,
                ...codeReviewOverrides,
            },
            qa: { status: 'pending', agent: 'claude' },
            human_review: { status: 'pending', agent: 'human' },
        },
        escalations: [],
        sessions: {},
    };
}

function writeCodeReviewTask(
    tasksRoot: string,
    taskId: string,
    options: {
        codeReview?: Partial<NonNullable<StatusJson['phases']['code_review']>>;
        review?: string;
    } = {},
): void {
    const taskDir = path.join(tasksRoot, taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    writeStatusToFile(path.join(taskDir, 'status.json'), makeCodeReviewStatus(taskId, options.codeReview));
    if (options.review !== undefined) {
        fs.writeFileSync(path.join(taskDir, 'review.md'), options.review, 'utf8');
    }
}

function readReview(tasksRoot: string, taskId: string): string {
    return fs.readFileSync(path.join(tasksRoot, taskId, 'review.md'), 'utf8');
}

function taskContext(tasksRoot: string, taskId: string): TaskContext {
    const status = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as StatusJson;
    const codeReview = status.phases.code_review;
    return {
        taskId,
        title: status.title ?? taskId,
        specReviewVerdict: 'approved',
        iterations: codeReview?.iterations ?? 0,
        iterations_current_loop: codeReview?.iterations_current_loop ?? codeReview?.iterations ?? 0,
        iterations_total: codeReview?.iterations_total ?? codeReview?.iterations ?? 0,
        rerouteCount: codeReview?.reroute_count ?? 0,
        status,
    };
}

function makeHandoffMap(entries: Record<string, readonly string[]>): Map<string, readonly string[]> {
    return new Map(Object.entries(entries));
}

void test('parseNameStatusOutput: empty diff returns no affected files', () => {
    assert.deepEqual(parseNameStatusOutput(''), []);
});

void test('sanctioned verdict is registered on status value surfaces but not artifact parsing', () => {
    assert.ok(_VERDICT_VALUES.includes('sanctioned'));
    assert.ok(VALID_VERDICTS.has('sanctioned'));

    const cliHelp = fs.readFileSync(path.join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8');
    assert.match(cliHelp, /approved \| approved_with_nits \| changes_requested \| needs_re_review \| spec_gap \| sanctioned/);
    assert.match(cliHelp, /sanctioned is written via canon task accept --reason/);

    const statusTemplate = fs.readFileSync(path.join(process.cwd(), '.canon', 'templates', 'status.json'), 'utf8');
    assert.match(statusTemplate, /spec_gap \| sanctioned/);

    assert.equal(extractCheckedVerdict('- [x] **Sanctioned**'), null);
});

void test('parseNameStatusOutput: non-renamed change returns one path', () => {
    assert.deepEqual(parseNameStatusOutput('M\0src/foo.ts\0'), ['src/foo.ts']);
});

void test('parseNameStatusOutput: rename returns pre-image and post-image paths sorted', () => {
    assert.deepEqual(parseNameStatusOutput('R95\0old.ts\0new.ts\0'), ['new.ts', 'old.ts']);
});

void test('classifySharedDocDirtFromData preserves byte-for-byte telemetry appends', () => {
    assert.deepEqual(
        classifySharedDocDirtFromData('telemetry', ' M', 'base\n', 'base\nrow\n'),
        { verdict: 'preserve', suffix: 'row\n' },
    );
});

void test('classifySharedDocDirtFromData treats identical content as clean, not empty preserve', () => {
    assert.deepEqual(
        classifySharedDocDirtFromData('telemetry', null, 'base\n', 'base\n'),
        { verdict: 'clean' },
    );
});

void test('classifySharedDocDirtFromData aborts modified telemetry and managed dirt', () => {
    assert.deepEqual(
        classifySharedDocDirtFromData('telemetry', ' M', 'base\n', 'changed\n'),
        {
            verdict: 'abort',
            reason: 'uncommitted edits are not a pure append over HEAD content — cannot safely preserve',
        },
    );
    assert.deepEqual(
        classifySharedDocDirtFromData('managed', ' M', 'base\n', 'base\nedit\n'),
        { verdict: 'abort', reason: 'has uncommitted edits' },
    );
});

void test('classifySharedDocDirtFromData aborts untracked status before content checks', () => {
    assert.deepEqual(
        classifySharedDocDirtFromData('telemetry', '??', null, 'row\n'),
        {
            verdict: 'abort',
            reason: "git status shows this path as '??' — only a plain unstaged modification " +
                'is eligible for preservation; staged changes, deletions, untracked files, and renames abort',
        },
    );
});

void test('classifySharedDocDirtFromData aborts missing HEAD content for safe-shape status', () => {
    assert.deepEqual(
        classifySharedDocDirtFromData('telemetry', ' M', null, 'row\n'),
        {
            verdict: 'abort',
            reason: 'present on disk but not readable at HEAD (untracked?) — cannot verify pure-append safety',
        },
    );
});

void test('classifySharedDocDirtFromData aborts every unsafe porcelain code', () => {
    const unsafeCodes = ['A ', 'M ', 'D ', ' D', 'R ', '??', 'MM'];
    for (const code of unsafeCodes) {
        const result = classifySharedDocDirtFromData('telemetry', code, 'base\n', 'base\nrow\n');
        assert.equal(result.verdict, 'abort', `expected abort for code ${JSON.stringify(code)}`);
    }
});

void test('classifySharedDocSetFromData aborts mixed sets before returning preserve work', () => {
    const verdict = classifySharedDocSetFromData([
        {
            relPath: 'docs/pipeline-invocations.md',
            docClass: 'telemetry',
            porcelainCode: ' M',
            headContent: 'base\n',
            workingContent: 'base\nrow\n',
        },
        {
            relPath: 'docs/patterns.md',
            docClass: 'managed',
            porcelainCode: ' M',
            headContent: 'base\n',
            workingContent: 'base\nedit\n',
        },
    ]);
    assert.deepEqual(verdict, {
        ok: false,
        abortedFiles: [{ relPath: 'docs/patterns.md', reason: 'has uncommitted edits' }],
    });
});

void test('buildSharedDocAbortMessage names files and recovery', () => {
    const message = buildSharedDocAbortMessage([
        { relPath: 'docs/patterns.md', reason: 'has uncommitted edits' },
    ]);
    assert.match(message, /docs\/patterns\.md: has uncommitted edits/);
    assert.match(message, /commit or stash your edits/);
    assert.match(message, /--force does not bypass this gate/);
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

void test('isPrBodyTemplate returns true when pr-body.md is missing', () => {
    withTempDir('pr-body-missing-', dir => {
        assert.equal(isPrBodyTemplate(path.join(dir, 'pr-body.md')), true);
    });
});

void test('isPrBodyTemplate returns true for the unfilled template stub', () => {
    withTempDir('pr-body-stub-', dir => {
        const prBodyPath = path.join(dir, 'pr-body.md');
        fs.writeFileSync(prBodyPath, [
            '<!-- [pr-body-stub] QA fills this file during the qa phase. Do not edit manually before QA runs. -->',
            '',
            '# PR Body: [TASK-ID] - [Title]',
            '',
            '> Stub - QA will replace this entire file with the filled PR body.',
            '',
        ].join('\n'));
        assert.equal(isPrBodyTemplate(prBodyPath), true);
    });
});

void test('isPrBodyTemplate returns false for a populated PR body', () => {
    withTempDir('pr-body-populated-', dir => {
        const prBodyPath = path.join(dir, 'pr-body.md');
        fs.writeFileSync(prBodyPath, [
            '# Summary',
            '',
            '- Filled by QA.',
            '',
            '# Changes',
            '',
            '- Updated the orchestrator prompt path.',
            '',
        ].join('\n'));
        assert.equal(isPrBodyTemplate(prBodyPath), false);
    });
});

void test('isPrBodyTemplate returns true for blank content', () => {
    withTempDir('pr-body-blank-', dir => {
        const prBodyPath = path.join(dir, 'pr-body.md');
        fs.writeFileSync(prBodyPath, '');
        assert.equal(isPrBodyTemplate(prBodyPath), true);
    });
});

void test('isPrBodyTemplate returns true for whitespace-only content', () => {
    withTempDir('pr-body-whitespace-', dir => {
        const prBodyPath = path.join(dir, 'pr-body.md');
        fs.writeFileSync(prBodyPath, '  \n\t');
        assert.equal(isPrBodyTemplate(prBodyPath), true);
    });
});

void test('resolveQaPrBody falls back for a blank single-task pr-body.md', () => {
    withTempDir('resolve-qa-pr-body-', dir => {
        const taskId = 'blank-pr-body-task';
        const taskDir = path.join(dir, 'tasks', taskId);
        fs.mkdirSync(taskDir, { recursive: true });
        fs.writeFileSync(path.join(taskDir, 'pr-body.md'), ' \n\t');
        const result = resolveQaPrBody([taskId], dir);
        assert.equal(result.kind, 'fallback');
        assert.match(result.reason, /stub template/);
    });
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

void test('validateStatus accepts optional pr.number and legacy statuses without pr', () => {
    const baseStatus = makeCodeReviewStatus('pr-status-task');

    assert.doesNotThrow(() => validateStatus('pr-status-task', baseStatus));
    assert.doesNotThrow(() => validateStatus('pr-status-task', {
        ...baseStatus,
        pr: { number: 42 },
    }));
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

void test('rows under an unrecognized heading are not coverage, but the rejection names the table (multi-wall-ux-cleanup incident)', () => {
    // GP task multi-wall-ux-cleanup (2026-07-06): amendment-pass files listed
    // in a well-formed table under `### Changes Added For Coverage` were
    // invisible to the heading-scoped parser; the pre-flight rejected the same
    // files three rounds running (never saying which headings ARE scanned) and
    // auto-blocked with zero reviewer rounds. Coverage stays heading-scoped —
    // the fix is that the rejection now points at the near-miss table.
    const handoffContent = [
        '# Implementation Handoff: test',
        '',
        '## Changes',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| `src/current.ts` | current-round change |',
        '',
        '## Iteration 1 — addressing pre-flight rejection',
        '',
        '### Changes Added For Coverage',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| `src/earlier.ts` | earlier-round change |',
        '',
    ].join('\n');
    withTempTaskHandoff('coverage-heading-task', handoffContent, () => {
        const { files, malformed } = parseHandoffChangesRows('coverage-heading-task');
        assert.deepEqual(files, ['src/current.ts']);
        assert.deepEqual(malformed, []);

        const issues = verifyHandoffAgainstDiffFromData(
            ['coverage-heading-task'],
            {
                diffFiles: ['src/current.ts', 'src/earlier.ts'],
                handoffFilesByTask: makeHandoffMap({ 'coverage-heading-task': files }),
                unscannedTableHits: collectUnscannedTableHits(handoffContent),
            },
        );
        assert.equal(issues.length, 2);
        assert.ok(issues[0].includes('src/earlier.ts in diff but not in any bundle handoff'));
        assert.ok(issues[0].includes("'### Changes Added For Coverage'"));
        assert.ok(issues[0].includes('does not scan'));
        assert.ok(issues[1].includes('coverage rows are read only from'));
    });
});

void test('parseHandoffChangesRows ignores commented-out template scaffold tables', () => {
    withTempTaskHandoff('commented-scaffold-task', [
        '# Implementation Handoff: test',
        '',
        '## Changes',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| `src/real.ts` | real change |',
        '',
        '<!--',
        '### Changes',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| `src/scaffold-only.ts` | commented-out example |',
        '-->',
        '',
    ].join('\n'), () => {
        assert.deepEqual(parseHandoffFiles('commented-scaffold-task'), ['src/real.ts']);
    });
});

void test('parseHandoffChangesRows leaves tables under unrecognized headings alone — no coverage, no malformed errors', () => {
    // An informational file list is neither a coverage claim nor held to
    // strict row parsing; only the recognized Changes tables are load-bearing.
    withTempTaskHandoff('unrecognized-heading-task', [
        '# Implementation Handoff: test',
        '',
        '## Changes',
        '',
        '| File | What Changed |',
        '|---|---|',
        '| `src/real.ts` | real change |',
        '',
        '## Appendix',
        '',
        '### Files Reviewed, No Changes Needed',
        '',
        '| File | Why |',
        '|---|---|',
        '| `src/untouched.ts` | already handled the edge case |',
        '| several helper files | prose that would be malformed in a Changes table |',
        '',
    ].join('\n'), () => {
        const { files, malformed } = parseHandoffChangesRows('unrecognized-heading-task');
        assert.deepEqual(files, ['src/real.ts']);
        assert.deepEqual(malformed, []);
    });
});

void test('collectUnscannedTableHits reports valid path rows from any table, with heading and first column header', () => {
    const hits = collectUnscannedTableHits([
        '# Implementation Handoff: test',
        '',
        '## Iteration 1',
        '',
        '### Files Touched',
        '',
        '| Path | What Changed |',
        '|---|---|',
        '| `src/orphan.ts` | valid row, unrecognized table |',
        '| prose without a path | skipped |',
        '',
    ].join('\n'));
    const found = hits.get('src/orphan.ts');
    assert.ok(found, 'expected a hit for src/orphan.ts');
    assert.equal(found.length, 1);
    assert.ok(found[0].includes('### Files Touched'));
    assert.ok(found[0].includes("first column header 'Path'"));
    assert.equal(hits.size, 1);
});

void test('verifyHandoffAgainstDiffFromData names the near-miss table for an uncovered diff file', () => {
    const issues = verifyHandoffAgainstDiffFromData(
        ['task-a'],
        {
            diffFiles: ['src/orphan.ts'],
            handoffFilesByTask: makeHandoffMap({ 'task-a': [] }),
            unscannedTableHits: new Map([
                ['src/orphan.ts', ["'### Files Touched' (first column header 'Path')"]],
            ]),
        },
    );
    assert.equal(issues.length, 2);
    assert.ok(issues[0].includes('src/orphan.ts in diff but not in any bundle handoff'));
    assert.ok(issues[0].includes("a row for it exists under '### Files Touched' (first column header 'Path')"));
    assert.ok(issues[0].includes('does not scan'));
    assert.ok(issues[1].includes('coverage rows are read only from'));
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
    assert.equal(issues.length, 2);
    assert.ok(issues[0].includes('diff→handoff'));
    assert.ok(issues[0].includes('src/baz.ts'));
    // Trailing hint enumerates the scanned coverage surfaces once per run.
    assert.ok(issues[1].includes('coverage rows are read only from'));
    assert.ok(issues[1].includes("'## Changes'"));
    assert.ok(issues[1].includes("'### Changes'"));
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
    assert.equal(issues.length, 2);
    assert.ok(issues[0].includes('src/baz.ts'));
    assert.ok(!issues[0].includes('lessons-learned'));
    assert.ok(issues[1].includes('coverage rows are read only from'));
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
    assert.equal(issues.length, 2);
    assert.ok(issues[0].includes('rename'));
    assert.ok(issues[0].includes('src/old-name.ts'));
    assert.ok(issues[0].includes('src/new-name.ts'));
    assert.ok(issues[0].includes('diff→handoff'));
    assert.ok(issues[1].includes('coverage rows are read only from'));
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
    assert.equal(issues.length, 2);
    assert.ok(issues[0].includes('tasks/some-other-task/notes.md'));
    assert.ok(issues[1].includes('coverage rows are read only from'));
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
    assert.equal(issues.length, 2);
    assert.ok(issues[0].includes('apps/web/src/Page.tsx'));
    assert.ok(issues[1].includes('coverage rows are read only from'));
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

function writeGateStatus(taskDir: string, opts: { rerouted: boolean; reroute_count?: number }): void {
    fs.writeFileSync(path.join(taskDir, 'status.json'), `${JSON.stringify({
        phases: { implement: { rerouted: opts.rerouted, ...(opts.reroute_count !== undefined ? { reroute_count: opts.reroute_count } : {}) } },
    }, null, 2)}\n`);
}

void test('checkPhaseGate: reroute plan requires the round Reroute Plan section (R4 P1 bypass)', () => {
    withTempTaskDir((taskId, taskDir) => {
        writeGateStatus(taskDir, { rerouted: true, reroute_count: 1 });
        // Stale original plan, no `## Reroute Plan` → reject (the manual
        // `canon task phase plan done` bypass that this closes).
        fs.writeFileSync(path.join(taskDir, 'plan.md'), '# Plan\n\n## Steps\n1. original\n');
        const result = checkPhaseGate(taskId, 'plan');
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.reason, /Reroute Plan/);
        // Fresh reroute plan appended → ok.
        fs.appendFileSync(path.join(taskDir, 'plan.md'), '\n## Reroute Plan\n- delta\n');
        assert.deepEqual(checkPhaseGate(taskId, 'plan'), { ok: true });
    });
});

void test('checkPhaseGate: first-pass plan accepts a populated plan.md', () => {
    withTempTaskDir((taskId, taskDir) => {
        writeGateStatus(taskDir, { rerouted: false, reroute_count: 0 });
        fs.writeFileSync(path.join(taskDir, 'plan.md'), '# Plan\n\n## Steps\n1. original\n');
        assert.deepEqual(checkPhaseGate(taskId, 'plan'), { ok: true });
    });
});

void test('checkPhaseGate: reroute spec_review verdict is scoped to the amendment section', () => {
    withTempTaskDir((taskId, taskDir) => {
        writeGateStatus(taskDir, { rerouted: true, reroute_count: 1 });
        // Stale Approved box above + Changes requested amendment section: the gate
        // must match the amendment verdict, not the stale approval.
        fs.writeFileSync(path.join(taskDir, 'spec-review.md'),
            '# Spec Review\n## Verdict\n- [x] **Approved**\n## Amendment Review\n- [x] **Changes requested**\n');
        const result = checkPhaseGate(taskId, 'spec_review', 'approved');
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.reason, /verdict mismatch/);
        assert.deepEqual(checkPhaseGate(taskId, 'spec_review', 'changes_requested'), { ok: true });
    });
});

void test('sliceRerouteRoundSection: duplicate round-2 sections returns the latest section', () => {
    const content = [
        '# Spec Review',
        '',
        '## Amendment Review Round 2',
        '- [x] **Changes requested**',
        '',
        '## Amendment Review Round 2',
        '- [x] **Approved**',
        '',
        '## Final Notes',
        '',
    ].join('\n');
    const section = sliceRerouteRoundSection(content, 'Amendment Review', 2);
    assert.notEqual(section, null);
    assert.match(section ?? '', /Approved/);
    assert.doesNotMatch(section ?? '', /Changes requested/);
});

void test('sliceRerouteRoundSection: single match returns the current section and no match returns null', () => {
    const single = [
        '# Spec Review',
        '',
        '## Amendment Review Round 2',
        '- [x] **Approved**',
        '',
        '## Final Notes',
        '',
    ].join('\n');
    assert.equal(
        sliceRerouteRoundSection(single, 'Amendment Review', 2),
        [
            '## Amendment Review Round 2',
            '- [x] **Approved**',
            '',
        ].join('\n'),
    );
    assert.equal(sliceRerouteRoundSection('# Spec Review\n\n## Final Notes\n', 'Amendment Review', 2), null);
});

void test('sliceRerouteRoundSection: round-1 bare-label duplicates select the latest bare heading', () => {
    const content = [
        '# Spec Review',
        '',
        '## Amendment Review',
        '- [x] **Changes requested**',
        '',
        '## Amendment Review',
        '- [x] **Approved**',
        '',
        '## Final Notes',
        '',
    ].join('\n');
    const section = sliceRerouteRoundSection(content, 'Amendment Review', 1);
    assert.notEqual(section, null);
    assert.match(section ?? '', /Approved/);
    assert.doesNotMatch(section ?? '', /Changes requested/);
});

void test('sliceRerouteRoundSection: fenced fake same-round heading is ignored and earlier fence state does not corrupt the last section', () => {
    const content = [
        '# Spec Review',
        '',
        '## Amendment Review Round 2',
        '- [x] **Changes requested**',
        '```md',
        '## Amendment Review Round 2',
        '- [x] **Changes requested**',
        '```',
        '',
        '## Amendment Review Round 2',
        '- [x] **Approved**',
        '',
        '## Final Notes',
        '',
    ].join('\n');
    const section = sliceRerouteRoundSection(content, 'Amendment Review', 2);
    assert.notEqual(section, null);
    assert.match(section ?? '', /^## Amendment Review Round 2\n- \[x\] \*\*Approved\*\*\n$/m);
    assert.doesNotMatch(section ?? '', /Changes requested/);
    assert.doesNotMatch(section ?? '', /```md/);
    assert.doesNotMatch(section ?? '', /Final Notes/);
});

void test('checkRerouteEvidence: spec_review reads the fresh verdict from the latest same-round amendment section', () => {
    const content = [
        '# Spec Review',
        '',
        '## Amendment Review Round 2',
        '- [x] **Changes requested**',
        '',
        '## Amendment Review Round 2',
        '- [x] **Approved**',
        '',
    ].join('\n');
    const status = {
        phases: {
            implement: {
                rerouted: true,
                reroute_count: 2,
            },
        },
    };
    assert.deepEqual(checkRerouteEvidence('spec_review', content, status), {
        reroute: true,
        ok: true,
        verdict: 'approved',
    });
});

void test('checkPhaseGate: reroute-capable phase fails closed on missing/malformed/schema-invalid status.json', () => {
    withTempTaskDir((taskId, taskDir) => {
        fs.writeFileSync(path.join(taskDir, 'plan.md'), '# Plan\n## Reroute Plan\n- delta\n');
        // Missing status.json → fail closed (cannot rule out a reroute).
        let result = checkPhaseGate(taskId, 'plan');
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.reason, /cannot determine reroute state/);
        // Malformed (unparseable) status.json → fail closed.
        fs.writeFileSync(path.join(taskDir, 'status.json'), '{ not json');
        result = checkPhaseGate(taskId, 'plan');
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.reason, /unparseable/);
        // Parseable but schema-invalid (rerouted not a boolean) → fail closed.
        fs.writeFileSync(path.join(taskDir, 'status.json'), JSON.stringify({ phases: { implement: { rerouted: 'true' } } }));
        result = checkPhaseGate(taskId, 'plan');
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.reason, /not a boolean/);
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

void test('checkPhaseGate: code_review accepts spec_gap when review.md has the Spec gap checkbox checked', () => {
    withTempTaskDir((taskId, taskDir) => {
        fs.writeFileSync(path.join(taskDir, 'review.md'), [
            '# Code Review: real task',
            '',
            '## Stage 2 - Code Quality',
            '',
            'Spec root cause found.',
            '',
            '## Final Verdict',
            '',
            '- [ ] **Approved**',
            '- [x] **Spec gap**',
        ].join('\n'));
        const result = checkPhaseGate(taskId, 'code_review', 'spec_gap');
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

function classifyFixture(
    rows: Array<{ check?: string; result: string; notes?: string }>,
    changedFiles: readonly string[] = [],
    extra: Partial<Parameters<typeof classifyPreflightBlockersFromData>[0]> = {},
) {
    return classifyPreflightBlockersFromData({
        latestResults: new Map(rows.map(row => [
            canonicalizeValidationCheck(row.check ?? '`npm run test`'),
            { check: row.check ?? '`npm run test`', result: row.result, notes: row.notes ?? '' },
        ])),
        requiredChecks: ['`npm run test`'],
        changedFiles: new Set(changedFiles),
        acCoverageIssues: [],
        changesTableIssues: [],
        bundleDiffIssues: [],
        handoffMissing: false,
        ...extra,
    });
}

void test('extractCitedFilePaths strips line and column suffixes from cited paths', () => {
    assert.deepEqual(extractCitedFilePaths('e2e/specs/editor.spec.ts:1231'), ['e2e/specs/editor.spec.ts']);
    assert.deepEqual(extractCitedFilePaths('src/foo.ts:42:7'), ['src/foo.ts']);
    assert.deepEqual(
        extractCitedFilePaths('tests/a.test.ts:10 tests/b.test.ts:20'),
        ['tests/a.test.ts', 'tests/b.test.ts'],
    );
    assert.deepEqual(extractCitedFilePaths('some prose'), []);
});

void test('matchAgainstChangedFiles matches relative paths and absolute path suffixes', () => {
    const changedFiles = new Set(['e2e/specs/editor.spec.ts']);

    assert.equal(matchAgainstChangedFiles('e2e/specs/editor.spec.ts', changedFiles), true);
    assert.equal(matchAgainstChangedFiles('./e2e/specs/editor.spec.ts', changedFiles), true);
    assert.equal(matchAgainstChangedFiles('src/other.ts', changedFiles), false);
    assert.equal(matchAgainstChangedFiles('/workspace/repo/e2e/specs/editor.spec.ts', changedFiles), true);
    assert.equal(matchAgainstChangedFiles('/workspace/repo/src/other.ts', changedFiles), false);
    assert.equal(matchAgainstChangedFiles('C:\\workspace\\repo\\e2e\\specs\\editor.spec.ts', changedFiles), true);
    assert.equal(matchAgainstChangedFiles('editor.spec.ts', changedFiles), true);
    assert.equal(matchAgainstChangedFiles('foo.spec.ts', changedFiles), false);
    // ../‐prefixed relative paths are treated as absolute-style (suffix walk)
    assert.equal(matchAgainstChangedFiles('../e2e/specs/editor.spec.ts', changedFiles), true);
    assert.equal(matchAgainstChangedFiles('../../e2e/specs/editor.spec.ts', changedFiles), true);
    assert.equal(matchAgainstChangedFiles('../other/file.ts', changedFiles), false);
});

void test('extractCitedFilePaths includes extensionless filenames when they have a :line reference', () => {
    // Extensionless files (Dockerfile, Makefile, Gemfile) with a line number
    // must not be dropped by the extension filter — they are valid citations.
    assert.deepEqual(extractCitedFilePaths('Dockerfile:17'), ['Dockerfile']);
    assert.deepEqual(extractCitedFilePaths('Makefile:42'), ['Makefile']);
    // A bare line-number token with no filename is still dropped (empty after strip).
    assert.deepEqual(extractCitedFilePaths(':1231'), []);
    // Extensionless file with NO line ref is not emitted (outer check already
    // rejects it, but belt-and-suspenders: extractCitedFilePaths also drops it).
    assert.deepEqual(extractCitedFilePaths('Dockerfile'), []);
});

void test('classifyPreflightBlockersFromData rejects Fail – unrelated when cited file is in the diff', () => {
    const issues = classifyFixture(
        [{ result: 'Fail – unrelated', notes: 'e2e/specs/editor.spec.ts:1231 (Editor flake)' }],
        ['e2e/specs/editor.spec.ts'],
    );

    assert.equal(issues.length, 1);
    assert.equal(issues[0].bucket, 'regression');
    assert.match(issues[0].message, /file changed by this task/);
});

void test('classifyPreflightBlockersFromData rejects Fail – unrelated when an absolute cited path suffix is in the diff', () => {
    const issues = classifyFixture(
        [{ result: 'Fail – unrelated', notes: '/workspace/repo/e2e/specs/editor.spec.ts:1231 (Editor flake)' }],
        ['e2e/specs/editor.spec.ts'],
    );

    assert.equal(issues.length, 1);
    assert.equal(issues[0].bucket, 'regression');
    assert.match(issues[0].message, /file changed by this task/);
});

void test('classifyPreflightBlockersFromData rejects bare basename Fail – unrelated notes without a line suffix', () => {
    const issues = classifyFixture(
        [{ result: 'Fail – unrelated', notes: 'editor.spec.ts' }],
        ['e2e/specs/editor.spec.ts'],
    );

    assert.equal(issues.length, 1);
    assert.equal(issues[0].bucket, 'format');
    assert.match(issues[0].message, /needs a specific test\/file reference/);
});

void test('classifyPreflightBlockersFromData rejects bare basename Fail – unrelated notes with a line suffix when the basename is in the diff', () => {
    const issues = classifyFixture(
        [{ result: 'Fail – unrelated', notes: 'editor.spec.ts:1231' }],
        ['e2e/specs/editor.spec.ts'],
    );

    assert.equal(issues.length, 1);
    assert.equal(issues[0].bucket, 'regression');
    assert.match(issues[0].message, /file changed by this task/);
});

void test('classifyPreflightBlockersFromData accepts bare basename Fail – unrelated notes with a line suffix when the basename is not in the diff', () => {
    const issues = classifyFixture(
        [{ result: 'Fail – unrelated', notes: 'foo.spec.ts:1231' }],
        ['e2e/specs/editor.spec.ts'],
    );

    assert.deepEqual(issues, []);
});

void test('classifyPreflightBlockersFromData accepts Fail – unrelated when cited file is outside the diff', () => {
    const issues = classifyFixture(
        [{ result: 'Fail – unrelated', notes: 'e2e/specs/editor.spec.ts:1231 (Editor flake)' }],
        ['src/app.ts'],
    );

    assert.deepEqual(issues, []);
});

void test('classifyPreflightBlockersFromData matches in-diff Fail – unrelated without a line suffix', () => {
    const issues = classifyFixture(
        [{ result: 'Fail – unrelated', notes: 'e2e/specs/editor.spec.ts' }],
        ['e2e/specs/editor.spec.ts'],
    );

    assert.equal(issues.length, 1);
    assert.equal(issues[0].bucket, 'regression');
});

void test('classifyPreflightBlockersFromData skips laundering guard when changed-files set is empty', () => {
    const issues = classifyFixture([
        { result: 'Fail – unrelated', notes: 'e2e/specs/editor.spec.ts:1231' },
    ]);

    assert.deepEqual(issues, []);
});

void test('classifyPreflightBlockersFromData classifies non-required plain Fail rows as regression blockers', () => {
    const issues = classifyFixture([
        { check: '`npm run test`', result: 'Pass' },
        { check: '`npm run smoke`', result: 'Fail', notes: 'smoke regression' },
    ], [], { requiredChecks: ['`npm run test`'] });

    assert.equal(issues.length, 1);
    assert.equal(issues[0].bucket, 'regression');
    assert.match(issues[0].message, /not listed in spec's required checks/);
    assert.match(issues[0].message, /npm run smoke/);
});

void test('classifyPreflightBlockersFromData ignores non-required Pass rows', () => {
    const issues = classifyFixture([
        { check: '`npm run test`', result: 'Pass' },
        { check: '`npm run smoke`', result: 'Pass' },
    ], [], { requiredChecks: ['`npm run test`'] });

    assert.deepEqual(issues, []);
});

void test('classifyPreflightBlockersFromData leaves non-required Fail – unrelated rows on the accept path', () => {
    const issues = classifyFixture([
        { check: '`npm run test`', result: 'Pass' },
        { check: '`npm run smoke`', result: 'Fail – unrelated', notes: 'e2e/specs/other.spec.ts:1231' },
    ], ['src/app.ts'], { requiredChecks: ['`npm run test`'] });

    assert.deepEqual(issues, []);
});

void test('classifyPreflightBlockersFromData does not double-count required plain Fail rows', () => {
    const issues = classifyFixture([
        { check: '`npm run test`', result: 'Fail', notes: 'unit failure' },
    ], [], { requiredChecks: ['`npm run test`'] });

    assert.equal(issues.length, 1);
    assert.equal(issues[0].bucket, 'regression');
    assert.match(issues[0].message, /Validation Required item did not pass/);
});

void test('classifyPreflightBlockersFromData assigns format, regression, and blocked buckets', () => {
    assert.deepEqual(
        classifyFixture([{ result: 'Pass' }], [], { acCoverageIssues: ['AC Coverage section is missing'] }).map(issue => issue.bucket),
        ['format'],
    );
    assert.deepEqual(
        classifyFixture([{ result: 'Fail', notes: 'unit failure' }]).map(issue => issue.bucket),
        ['regression'],
    );
    assert.deepEqual(
        classifyFixture(
            [{ result: 'Fail', notes: 'unit failure' }],
            [],
            { changesTableIssues: ['Changes table row \'<path>\': template placeholder'] },
        ).map(issue => issue.bucket),
        ['format', 'regression'],
    );
    assert.deepEqual(
        classifyFixture([{ result: 'Pass' }], [], { bundleDiffIssues: ['diff→handoff: src/app.ts in diff but not in any bundle handoff'] })
            .map(issue => issue.bucket),
        ['format'],
    );
    assert.deepEqual(
        classifyFixture([{ result: 'blocked', notes: 'CI unavailable' }]).map(issue => issue.bucket),
        ['blocked'],
    );
    assert.deepEqual(
        classifyFixture([
            { check: '`npm run test`', result: 'Fail', notes: 'unit failure' },
            { check: '`npm run lint`', result: 'blocked', notes: 'CI unavailable' },
        ], [], { requiredChecks: ['`npm run test`', '`npm run lint`'] }).map(issue => issue.bucket),
        ['regression', 'blocked'],
    );
});

void test('pre-flight route and review block frame format blockers as handoff fixes', () => {
    const failures = [{
        taskId: 'format-task',
        classified: [{ bucket: 'format' as const, message: 'AC Coverage section is missing' }],
    }];
    const block = buildPreflightReviewBlock(failures[0].classified, determinePreflightRoute(failures));

    assert.equal(determinePreflightRoute(failures), 'implement');
    assert.match(block, /## Validation Gate/);
    assert.match(block, /## Pre-Flight Rejection/);
    assert.match(block, /Fix the handoff/);
    assert.match(block, /AC Coverage section is missing/);
    assert.doesNotMatch(block, /Fix the code/);
});

void test('pre-flight route and review block frame regression blockers as code fixes', () => {
    const failures = [{
        taskId: 'regression-task',
        classified: [{ bucket: 'regression' as const, message: 'Validation Required item did not pass in handoff.md: `npm test` — Fail' }],
    }];
    const block = buildPreflightReviewBlock(failures[0].classified, determinePreflightRoute(failures));

    assert.equal(determinePreflightRoute(failures), 'implement');
    assert.match(block, /Fix the code/);
    assert.match(block, /You broke one or more required checks/);
    assert.match(block, /Fail – unrelated/);
    assert.doesNotMatch(block, /resubmit handoff/);
});

void test('pre-flight review block stacks mixed fixable framings and keeps implement route', () => {
    const failures = [{
        taskId: 'mixed-task',
        classified: [
            { bucket: 'format' as const, message: 'Changes table row \'<path>\': template placeholder' },
            { bucket: 'regression' as const, message: 'Validation Required item did not pass in handoff.md: `npm test` — Fail' },
        ],
    }];
    const block = buildPreflightReviewBlock(failures[0].classified, determinePreflightRoute(failures));

    assert.equal(determinePreflightRoute(failures), 'implement');
    assert.match(block, /Fix the handoff/);
    assert.match(block, /Fix the code/);
});

void test('pre-flight blocked-only route halts for human triage', () => {
    const failures = [{
        taskId: 'blocked-task',
        classified: [{ bucket: 'blocked' as const, message: 'Validation Required item marked blocked in handoff.md: `npm test` — triage required' }],
    }];
    const block = buildPreflightReviewBlock(failures[0].classified, determinePreflightRoute(failures));

    assert.equal(determinePreflightRoute(failures), 'auto_block');
    assert.match(block, /Human triage required/);
    assert.match(block, /Infrastructure was unavailable/);
    assert.match(block, /Re-implementing cannot resolve this/);
});

void test('pre-flight fixable blocker wins over blocked rows', () => {
    const failures = [{
        taskId: 'priority-task',
        classified: [
            { bucket: 'regression' as const, message: 'Validation Required item did not pass in handoff.md: `npm test` — Fail' },
            { bucket: 'blocked' as const, message: 'Validation Required item marked blocked in handoff.md: `npm run lint` — triage required' },
        ],
    }];
    const block = buildPreflightReviewBlock(failures[0].classified, determinePreflightRoute(failures));

    assert.equal(determinePreflightRoute(failures), 'implement');
    assert.match(block, /Fix the code/);
    assert.match(block, /Infra note/);
    assert.doesNotMatch(block, /Human triage required/);
});

void test('bundle pre-flight Route A rejects a two-task bundle atomically', () => {
    withTempTasks(tasksRoot => {
        writeCodeReviewTask(tasksRoot, 'task-a');
        writeCodeReviewTask(tasksRoot, 'task-b');
        const failures = [{
            taskId: 'task-a',
            classified: [{ bucket: 'format' as const, message: 'AC Coverage section is missing' }],
        }];
        const route = determinePreflightRoute(failures);

        assert.equal(writePreflightReviewArtifacts([
            taskContext(tasksRoot, 'task-a'),
            taskContext(tasksRoot, 'task-b'),
        ], failures, route), true);
        for (const taskId of ['task-a', 'task-b']) taskPhasePreflightRejected(taskId, 'code_review');

        for (const taskId of ['task-a', 'task-b']) {
            const phase = readStatus(taskId).phases.code_review;
            assert.equal(phase?.status, 'done');
            assert.equal(phase?.verdict, 'changes_requested');
            assert.equal(phase?.preflight_rejections_current_loop, 1);
            assert.equal(phase?.preflight_rejections_total, 1);
            assert.equal(phase?.changes_requested_total, 1);
            assert.equal(phase?.iterations_current_loop, 0);
            assert.equal(phase?.iterations_total, 0);
        }

        const failingReview = readReview(tasksRoot, 'task-a');
        assert.match(failingReview, /## Validation Gate/);
        assert.match(failingReview, /## Pre-Flight Rejection/);
        assert.match(failingReview, /AC Coverage section is missing/);

        const cleanReview = readReview(tasksRoot, 'task-b');
        assert.match(cleanReview, /^# Code Review: task-b/m);
        assert.match(cleanReview, /^## Bundle Pre-Flight Rejection$/m);
        assert.match(cleanReview, /`task-a` — see `tasks\/task-a\/review\.md`/);
        assert.match(cleanReview, /^- \[x\] \*\*Changes requested\*\*/m);
        assert.doesNotMatch(cleanReview, /^## Stage 1\b/m);
        assert.equal(extractCheckedVerdict(cleanReview), 'changes_requested');
    });
});

void test('bundle pre-flight Route A rejects every task in a three-task bundle', () => {
    withTempTasks(tasksRoot => {
        for (const taskId of ['task-a', 'task-b', 'task-c']) writeCodeReviewTask(tasksRoot, taskId);
        const failures = [{
            taskId: 'task-a',
            classified: [{ bucket: 'regression' as const, message: 'Validation Required item did not pass in handoff.md: `npm test` — Fail' }],
        }];

        writePreflightReviewArtifacts([
            taskContext(tasksRoot, 'task-a'),
            taskContext(tasksRoot, 'task-b'),
            taskContext(tasksRoot, 'task-c'),
        ], failures, determinePreflightRoute(failures));
        for (const taskId of ['task-a', 'task-b', 'task-c']) taskPhasePreflightRejected(taskId, 'code_review');

        for (const taskId of ['task-a', 'task-b', 'task-c']) {
            const phase = readStatus(taskId).phases.code_review;
            assert.equal(phase?.status, 'done');
            assert.equal(phase?.verdict, 'changes_requested');
            assert.equal(phase?.preflight_rejections_current_loop, 1);
        }
        for (const taskId of ['task-b', 'task-c']) {
            const cleanReview = readReview(tasksRoot, taskId);
            assert.match(cleanReview, /`task-a` — see `tasks\/task-a\/review\.md`/);
            assert.doesNotMatch(cleanReview, /^## Stage 1\b/m);
        }
    });
});

void test('bundle pre-flight Route A appends clean-task stub over a prior real review', () => {
    withTempTasks(tasksRoot => {
        const prior = [
            '# Code Review: task-b',
            '',
            '## Stage 1',
            '',
            'Prior AC table.',
            '',
        ].join('\n');
        writeCodeReviewTask(tasksRoot, 'task-a');
        writeCodeReviewTask(tasksRoot, 'task-b', { review: prior });
        const failures = [{
            taskId: 'task-a',
            classified: [{ bucket: 'format' as const, message: 'AC Coverage section is missing' }],
        }];

        writePreflightReviewArtifacts([
            taskContext(tasksRoot, 'task-a'),
            taskContext(tasksRoot, 'task-b'),
        ], failures, determinePreflightRoute(failures));

        const cleanReview = readReview(tasksRoot, 'task-b');
        assert.ok(cleanReview.startsWith(prior.trimEnd()));
        assert.match(cleanReview, /^---$/m);
        assert.match(cleanReview, /^## Bundle Pre-Flight Rejection \(round 1\) — sibling task\(s\) failed$/m);
        const appended = cleanReview.slice(cleanReview.indexOf('## Bundle Pre-Flight Rejection'));
        assert.doesNotMatch(appended, /^## Verdict\b/m);
        assert.doesNotMatch(appended, /^- \[x\] \*\*Changes requested\*\*/m);
        assert.equal(extractCheckedVerdict(cleanReview), null);
    });
});

void test('bundle pre-flight Route A preserves prior approved clean-task verdict while status records rejection', () => {
    withTempTasks(tasksRoot => {
        const priorApproved = [
            '# Code Review: task-b',
            '',
            '## Stage 1',
            '',
            'Prior AC table.',
            '',
            '## Final Verdict',
            '',
            '- [x] **Approved**',
            '',
        ].join('\n');
        writeCodeReviewTask(tasksRoot, 'task-a');
        writeCodeReviewTask(tasksRoot, 'task-b', { review: priorApproved });
        const failures = [{
            taskId: 'task-a',
            classified: [{ bucket: 'format' as const, message: 'AC Coverage section is missing' }],
        }];

        writePreflightReviewArtifacts([
            taskContext(tasksRoot, 'task-a'),
            taskContext(tasksRoot, 'task-b'),
        ], failures, determinePreflightRoute(failures));
        const cleanReview = readReview(tasksRoot, 'task-b');
        const appended = cleanReview.slice(cleanReview.indexOf('## Bundle Pre-Flight Rejection'));
        assert.match(cleanReview, /^## Stage 1$/m);
        assert.match(cleanReview, /^## Final Verdict$/m);
        assert.match(appended, /^## Bundle Pre-Flight Rejection \(round 1\) — sibling task\(s\) failed$/m);
        assert.doesNotMatch(appended, /^## Verdict\b/m);
        assert.doesNotMatch(appended, /^- \[x\] \*\*Changes requested\*\*/m);
        assert.equal(extractCheckedVerdict(cleanReview), 'approved');

        for (const taskId of ['task-a', 'task-b']) taskPhasePreflightRejected(taskId, 'code_review');
        assert.equal(readStatus('task-b').phases.code_review?.verdict, 'changes_requested');
    });
});

void test('bundle pre-flight Route A statuses route the whole bundle back to implement', async () => {
    await withTempTasksAsync(async tasksRoot => {
        writeCodeReviewTask(tasksRoot, 'task-a');
        writeCodeReviewTask(tasksRoot, 'task-b', {
            review: [
                '# Code Review: task-b',
                '',
                '## Stage 1',
                '',
                'Prior AC table.',
                '',
                '## Final Verdict',
                '',
                '- [x] **Approved**',
                '',
            ].join('\n'),
        });
        const failures = [{
            taskId: 'task-a',
            classified: [{ bucket: 'format' as const, message: 'AC Coverage section is missing' }],
        }];
        writePreflightReviewArtifacts([
            taskContext(tasksRoot, 'task-a'),
            taskContext(tasksRoot, 'task-b'),
        ], failures, determinePreflightRoute(failures));
        for (const taskId of ['task-a', 'task-b']) taskPhasePreflightRejected(taskId, 'code_review');

        assert.equal(extractCheckedVerdict(readReview(tasksRoot, 'task-b')), 'approved');
        await checkAndRoute('code_review', ['task-a', 'task-b']);

        for (const taskId of ['task-a', 'task-b']) {
            const status = readStatus(taskId);
            assert.equal(status.phases.implement?.status, 'pending');
            assert.equal(status.phases.code_review?.status, 'pending');
            assert.equal(status.status, 'implement');
        }
    });
});

void test('checkAndRoute treats sanctioned review verdicts as advancing outcomes', async () => {
    await withTempTasksAsync(async tasksRoot => {
        writeCodeReviewTask(tasksRoot, 'task-code', {
            codeReview: {
                status: 'done',
                verdict: 'sanctioned',
                operator_accepted: true,
                operator_accepted_at: '2026-06-08',
                operator_accepted_sha: 'abc123',
            },
        });

        await checkAndRoute('code_review', ['task-code']);
        const codeStatus = readStatus('task-code');
        assert.equal(codeStatus.phases.code_review?.status, 'done');
        assert.equal(codeStatus.phases.code_review?.verdict, 'sanctioned');
        assert.equal(codeStatus.escalations?.length ?? 0, 0);

        const specTaskDir = path.join(tasksRoot, 'task-spec');
        fs.mkdirSync(specTaskDir, { recursive: true });
        const specStatus: StatusJson = {
            id: 'task-spec',
            title: 'task-spec',
            status: 'plan',
            created: '2026-06-08',
            updated: '2026-06-08',
            branch: 'task/task-spec',
            base_branch: 'dev',
            task_size: 'M',
            delicate: false,
            human_spec_gate: false,
            full_send: false,
            worktree: false,
            phases: {
                spec: { status: 'done', agent: 'claude' },
                spec_review: {
                    status: 'done',
                    agent: 'codex',
                    verdict: 'sanctioned',
                    operator_accepted: true,
                    operator_accepted_at: '2026-06-08',
                    operator_accepted_sha: 'abc123',
                },
                plan: { status: 'pending', agent: 'claude' },
                implement: { status: 'pending', agent: 'codex' },
                code_review: { status: 'pending', agent: 'claude', verdict: '' },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
            escalations: [],
            sessions: {},
        };
        writeStatusToFile(path.join(specTaskDir, 'status.json'), specStatus);

        await checkAndRoute('spec_review', ['task-spec']);
        const updatedSpec = readStatus('task-spec');
        assert.equal(updatedSpec.phases.spec_review?.status, 'done');
        assert.equal(updatedSpec.phases.spec_review?.verdict, 'sanctioned');
        assert.equal(updatedSpec.phases.spec?.status, 'done');
    });
});

void test('bundle pre-flight Route B auto-blocks every task and writes clean halt stubs without verdicts', () => {
    withTempTasks(tasksRoot => {
        writeCodeReviewTask(tasksRoot, 'task-a');
        writeCodeReviewTask(tasksRoot, 'task-b');
        const failures = [{
            taskId: 'task-a',
            classified: [{ bucket: 'blocked' as const, message: 'Validation Required item marked blocked in handoff.md: `npm test` — triage required' }],
        }];
        const route = determinePreflightRoute(failures);

        assert.equal(route, 'auto_block');
        writePreflightReviewArtifacts([
            taskContext(tasksRoot, 'task-a'),
            taskContext(tasksRoot, 'task-b'),
        ], failures, route);
        autoBlockPhase(['task-a', 'task-b'], 'code_review', 0, 'blocked validation rows');

        const failingReview = readReview(tasksRoot, 'task-a');
        assert.match(failingReview, /HALTED — infrastructure unavailable before full review/);
        assert.doesNotMatch(failingReview, /^## Bundle Pre-Flight Halt$/m);

        const cleanReview = readReview(tasksRoot, 'task-b');
        assert.match(cleanReview, /^# Code Review: task-b/m);
        assert.match(cleanReview, /^## Bundle Pre-Flight Halt$/m);
        assert.match(cleanReview, /Human triage required/);
        assert.match(cleanReview, /`task-a` — see `tasks\/task-a\/review\.md`/);
        assert.doesNotMatch(cleanReview, /^## Verdict\b/m);
        assert.doesNotMatch(cleanReview, /^## Stage 1\b/m);
        assert.equal(extractCheckedVerdict(cleanReview), null);

        for (const taskId of ['task-a', 'task-b']) {
            const status = readStatus(taskId);
            const phase = status.phases.code_review;
            assert.equal(phase?.status, 'blocked');
            assert.equal(phase?.auto_block_count, 1);
            assert.equal(phase?.preflight_rejections_current_loop, 0);
            assert.equal(phase?.preflight_rejections_total, 0);
            assert.equal(phase?.changes_requested_total, 0);
            assert.equal(status.escalations?.length, 1);
        }
    });
});

void test('bundle pre-flight artifact writer is a no-op when every task passes pre-flight', () => {
    withTempTasks(tasksRoot => {
        writeCodeReviewTask(tasksRoot, 'task-a');
        writeCodeReviewTask(tasksRoot, 'task-b');

        assert.equal(writePreflightReviewArtifacts([
            taskContext(tasksRoot, 'task-a'),
            taskContext(tasksRoot, 'task-b'),
        ], [], 'implement'), false);

        for (const taskId of ['task-a', 'task-b']) {
            assert.equal(fs.existsSync(path.join(tasksRoot, taskId, 'review.md')), false);
            assert.equal(readStatus(taskId).phases.code_review?.status, 'pending');
        }
    });
});

void test('single-task Route A pre-flight failure keeps the existing failing-task block shape', () => {
    withTempTasks(tasksRoot => {
        writeCodeReviewTask(tasksRoot, 'task-a');
        const failures = [{
            taskId: 'task-a',
            classified: [{ bucket: 'format' as const, message: 'AC Coverage section is missing' }],
        }];

        writePreflightReviewArtifacts([taskContext(tasksRoot, 'task-a')], failures, determinePreflightRoute(failures));
        taskPhasePreflightRejected('task-a', 'code_review');

        const review = readReview(tasksRoot, 'task-a');
        assert.match(review, /^# Code Review: task-a/m);
        assert.match(review, /^## Validation Gate$/m);
        assert.match(review, /^## Pre-Flight Rejection$/m);
        assert.doesNotMatch(review, /^## Bundle Pre-Flight Rejection$/m);
        const phase = readStatus('task-a').phases.code_review;
        assert.equal(phase?.status, 'done');
        assert.equal(phase?.verdict, 'changes_requested');
    });
});

void test('single-task Route B pre-flight failure keeps the existing auto-block shape', () => {
    withTempTasks(tasksRoot => {
        writeCodeReviewTask(tasksRoot, 'task-a');
        const failures = [{
            taskId: 'task-a',
            classified: [{ bucket: 'blocked' as const, message: 'Validation Required item marked blocked in handoff.md: `npm test` — triage required' }],
        }];

        writePreflightReviewArtifacts([taskContext(tasksRoot, 'task-a')], failures, determinePreflightRoute(failures));
        autoBlockPhase(['task-a'], 'code_review', 0, 'blocked validation rows');

        const review = readReview(tasksRoot, 'task-a');
        assert.match(review, /HALTED — infrastructure unavailable before full review/);
        assert.doesNotMatch(review, /^## Bundle Pre-Flight Halt$/m);
        const phase = readStatus('task-a').phases.code_review;
        assert.equal(phase?.status, 'blocked');
        assert.equal(phase?.auto_block_count, 1);
        assert.equal(phase?.preflight_rejections_current_loop, 0);
        assert.equal(phase?.changes_requested_total, 0);
    });
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

void test('validateHandoffAgainstSpec: Fail – unrelated citing an in-diff file is rejected', () => {
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
            const issues = validateHandoffAgainstSpec(specPath, handoffPath, undefined, new Set(['tests/foo.test.ts']));
            assert.equal(issues.length, 1);
            assert.match(issues[0], /file changed by this task/);
        },
    );
});

void test('validateHandoffAgainstSpec: Fail – unrelated citing a not-in-diff file is accepted', () => {
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
            const issues = validateHandoffAgainstSpec(specPath, handoffPath, undefined, new Set(['src/app.ts']));
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
