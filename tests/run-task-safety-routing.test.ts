import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { REPO_ROOT, WORKTREES_ROOT } from '../src/orchestrator/env.js';
import { guardConcurrentRun } from '../src/orchestrator/main.js';
import { classifyInvocationRoot, effectiveWorktreesRoot } from '../src/orchestrator/state.js';
import { worktreePath } from '../src/orchestrator/worktree.js';
import type { StatusJson } from '../src/orchestrator/types.js';
import {
    WORKTREE_ROOT,
    canonicalizeTestPath,
    withTempDir,
    writeTaskStatus,
    writeExecutable,
    setupFakeGit,
    setupFakeCliTools,
    setupInvocationLoggingCliTools,
    makeReviewLoopStatus,
    writeReviewLoopFixture,
    runReviewLoopMain,
    runNodeInline,
    runMainInline,
    childEnvWithoutTasksOverride,
    gitIn,
    makeGitFixture,
    baseDriftEnv,
    makeOutOfRootTaskFixture,
    makeBootstrappedTaskWorktreeFixture,
    makeCompleteStatus,
    writeAffectedFilesSpec,
    setupHumanReviewHarness,
    runHumanReviewCommit,
    combinedOutput,
    runCommitQaArtifactsInline,
    writeImplementEvidenceFixture,
    prepareReviewEntryMainFixture,
    makeGuardResolver,
    captureDie,
    writeFreshHeartbeat,
    writeFreshnessConfig,
} from './run-task-safety-helpers.js';


void test('checkAndRoute blocks code_review on spec_gap without advancing qa', () => {
    withTempDir('spec-gap-route-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const taskId = 'task-a';
        writeTaskStatus(tasksRoot, taskId, {
            ...makeCompleteStatus(taskId, 'task/task-a'),
            status: 'code_review',
            phases: {
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'done', agent: 'codex' },
                code_review: {
                    status: 'done',
                    agent: 'claude',
                    verdict: 'spec_gap',
                    iterations: 0,
                    iterations_current_loop: 0,
                    iterations_total: 1,
                    changes_requested_total: 0,
                    auto_block_count: 0,
                },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
            escalations: [],
        });

        const result = runNodeInline([
            "import { checkAndRoute } from './src/orchestrator/main.ts';",
            "checkAndRoute('code_review', ['task-a']).catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        });

        assert.equal(result.status, 2);
        assert.match(result.stdout, /SPEC GAP/);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            status?: string;
            escalations?: Array<{ phase?: string; reason?: string }>;
            phases?: {
                code_review?: { status?: string; auto_block_count?: number };
                qa?: { status?: string };
            };
        };
        assert.equal(updated.status, 'code_review');
        assert.equal(updated.phases?.code_review?.status, 'blocked');
        assert.equal(updated.phases?.code_review?.auto_block_count, 1);
        assert.equal(updated.phases?.qa?.status, 'pending');
        assert.equal(updated.escalations?.length, 1);
        assert.equal(updated.escalations?.[0]?.phase, 'code_review');
        assert.match(updated.escalations?.[0]?.reason ?? '', /spec_gap/);
    });
});

void test('checkAndRoute revalidates implement done evidence before recovery and preserves sessions on a failed retry', () => {
    withTempDir('implement-evidence-retry-fail-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);
        writeImplementEvidenceFixture(tasksRoot, 'task-a', ['`package.json`']);
        writeExecutable(fakeBins, 'codex', [
            'set -eu',
            'tasks_root="${CANON_TASKS_DIR_OVERRIDE:-tasks}"',
            'task_dir="$tasks_root/task-a"',
            'mkdir -p "$task_dir"',
            'cat > "$task_dir/status.json" <<\'EOF\'',
            '{',
            '  "id": "task-a",',
            '  "title": "task-a",',
            '  "base_branch": "main",',
            '  "branch": "task/task-a",',
            '  "worktree": false,',
            '  "status": "implement",',
            '  "sessions": { "codex": "resume-1234567890" },',
            '  "phases": {',
            '    "spec": { "status": "done", "agent": "claude" },',
            '    "spec_review": { "status": "done", "agent": "codex", "verdict": "approved" },',
            '    "plan": { "status": "done", "agent": "claude" },',
            '    "implement": { "status": "done", "agent": "codex" },',
            '    "code_review": { "status": "pending", "agent": "claude", "verdict": "" },',
            '    "qa": { "status": "pending", "agent": "claude" },',
            '    "human_review": { "status": "pending", "agent": "human" }',
            '  }',
            '}',
            'EOF',
            'exit 0',
        ]);

        const taskId = 'task-a';
        writeImplementEvidenceFixture(tasksRoot, taskId, []);
        writeTaskStatus(tasksRoot, taskId, {
            id: taskId,
            title: taskId,
            base_branch: 'main',
            branch: 'task/task-a',
            worktree: false,
            status: 'implement',
            sessions: { codex: 'resume-1234567890' },
            phases: {
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'done', agent: 'codex' },
                code_review: { status: 'pending', agent: 'claude', verdict: '' },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
        });

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { checkAndRoute } from './src/orchestrator/main.ts';",
            '(async () => {',
            `  await checkAndRoute('implement', [${JSON.stringify(taskId)}]);`,
            '})().catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'main',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GIT_LOG_OUTPUT: 'abc123',
        });

        assert.equal(result.status, 2, result.stderr);
        assert.match(result.stderr, /Evidence insufficient for 'task-a' implement: handoff\.md Changes table is empty/);
        assert.match(result.stderr, /Retry completed but handoff evidence is still missing\/invalid: handoff\.md Changes table is empty/);
        assert.match(result.stderr, /Re-run `canon run task-a` to resume the session\./);
        assert.doesNotMatch(result.stderr, /Retry succeeded/);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            sessions?: { codex?: string };
            phases?: { implement?: { status?: string } };
        };
        assert.equal(updated.phases?.implement?.status, 'in_progress');
        assert.equal(updated.sessions?.codex, 'resume-1234567890');
    });
});

void test('checkAndRoute honors valid implement evidence and proceeds without a retry', () => {
    withTempDir('implement-evidence-valid-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const taskId = 'task-a';
        writeImplementEvidenceFixture(tasksRoot, taskId, ['`package.json`']);
        writeTaskStatus(tasksRoot, taskId, {
            id: taskId,
            title: taskId,
            base_branch: 'main',
            branch: 'task/task-a',
            worktree: false,
            sessions: { codex: 'resume-1234567890' },
            phases: {
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'done', agent: 'codex' },
                code_review: { status: 'pending', agent: 'claude', verdict: '' },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
        });

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { checkAndRoute } from './src/orchestrator/main.ts';",
            '(async () => {',
            `  await checkAndRoute('implement', [${JSON.stringify(taskId)}]);`,
            '})().catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'main',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GIT_LOG_OUTPUT: 'abc123',
        });

        assert.equal(result.status, 0, result.stderr);
        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: { implement?: { status?: string } };
        };
        assert.equal(updated.phases?.implement?.status, 'done');
        assert.doesNotMatch(result.stderr, /Retry/);
    });
});

void test('checkAndRoute honors deletion-only implement evidence (listed file absent but git-tracked deletion)', () => {
    withTempDir('implement-evidence-deletion-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const taskId = 'task-a';
        // The handoff's only Changes entry is a file that does NOT exist on
        // disk — it was deleted by the implement. The gate must accept the
        // git-tracked deletion as evidence instead of wedging the phase.
        writeImplementEvidenceFixture(tasksRoot, taskId, ['`src/legacy-module.ts`']);
        writeTaskStatus(tasksRoot, taskId, {
            id: taskId,
            title: taskId,
            base_branch: 'main',
            branch: 'task/task-a',
            worktree: false,
            sessions: { codex: 'resume-1234567890' },
            phases: {
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'done', agent: 'codex' },
                code_review: { status: 'pending', agent: 'claude', verdict: '' },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
        });

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { checkAndRoute } from './src/orchestrator/main.ts';",
            '(async () => {',
            `  await checkAndRoute('implement', [${JSON.stringify(taskId)}]);`,
            '})().catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'main',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GIT_LOG_OUTPUT: 'abc123',
            FAKE_GIT_DELETED_FILES: 'src/legacy-module.ts',
        });

        assert.equal(result.status, 0, result.stderr);
        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: { implement?: { status?: string } };
        };
        assert.equal(updated.phases?.implement?.status, 'done');
        assert.doesNotMatch(result.stderr, /Retry/);
    });
});

void test('checkAndRoute honors a committed rename\'s old path as deletion evidence (real git)', () => {
    withTempDir('implement-evidence-committed-rename-', dir => {
        const { localDir } = makeGitFixture(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const taskId = 'task-a';
        const legacy = Array.from({ length: 20 }, (_, i) => `export const line${i} = ${i};`).join('\n') + '\n';
        fs.mkdirSync(path.join(localDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'src', 'legacy.ts'), legacy, 'utf8');
        gitIn(localDir, 'add', 'src/legacy.ts');
        gitIn(localDir, 'commit', '-m', 'seed legacy');
        gitIn(localDir, 'checkout', '-b', 'task/task-a');
        // A similar add pairs with the delete, so a rename-detecting diff
        // reports `R` and the old path never shows up as `D`.
        gitIn(localDir, 'mv', 'src/legacy.ts', 'src/renamed.ts');
        gitIn(localDir, 'commit', '-m', 'rename legacy');

        writeImplementEvidenceFixture(tasksRoot, taskId, ['`src/legacy.ts`']);
        writeTaskStatus(tasksRoot, taskId, {
            id: taskId,
            title: taskId,
            base_branch: 'main',
            branch: 'task/task-a',
            worktree: false,
            sessions: { codex: 'resume-1234567890' },
            phases: {
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'done', agent: 'codex' },
                code_review: { status: 'pending', agent: 'claude', verdict: '' },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
        });

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            `.then(m => m.checkAndRoute('implement', [${JSON.stringify(taskId)}]))`,
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join(''), baseDriftEnv(dir, tasksRoot), localDir);

        assert.equal(result.status, 0, result.stderr);
        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: { implement?: { status?: string } };
        };
        assert.equal(updated.phases?.implement?.status, 'done');
        assert.doesNotMatch(result.stderr + result.stdout, /none exist on disk/);
    });
});

void test('checkAndRoute decodes a C-quoted non-ASCII deletion as implement evidence', () => {
    withTempDir('implement-evidence-quoted-deletion-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const taskId = 'task-a';
        // The handoff's only Changes entry is a file that does NOT exist on
        // disk — it was deleted by the implement. The gate must accept the
        // git-tracked deletion as evidence instead of wedging the phase.
        writeImplementEvidenceFixture(tasksRoot, taskId, ['`src/café.ts`']);
        writeTaskStatus(tasksRoot, taskId, {
            id: taskId,
            title: taskId,
            base_branch: 'main',
            branch: 'task/task-a',
            worktree: false,
            sessions: { codex: 'resume-1234567890' },
            phases: {
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'done', agent: 'codex' },
                code_review: { status: 'pending', agent: 'claude', verdict: '' },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
        });

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { checkAndRoute } from './src/orchestrator/main.ts';",
            '(async () => {',
            `  await checkAndRoute('implement', [${JSON.stringify(taskId)}]);`,
            '})().catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'main',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GIT_LOG_OUTPUT: 'abc123',
            FAKE_GIT_DELETED_FILES: '"src/caf\\303\\251.ts"',
        });

        assert.equal(result.status, 0, result.stderr);
        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: { implement?: { status?: string } };
        };
        assert.equal(updated.phases?.implement?.status, 'done');
        assert.doesNotMatch(result.stderr, /Retry/);
    });
});

void test('checkAndRoute logs Retry succeeded when implement retry produces valid evidence', () => {
    withTempDir('implement-evidence-retry-success-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);
        writeImplementEvidenceFixture(tasksRoot, 'task-a', ['`package.json`']);
        writeExecutable(fakeBins, 'codex', [
            'set -eu',
            'tasks_root="${CANON_TASKS_DIR_OVERRIDE:-tasks}"',
            'task_dir="$tasks_root/task-a"',
            'mkdir -p "$task_dir"',
            'cat > "$task_dir/status.json" <<\'EOF\'',
            '{',
            '  "id": "task-a",',
            '  "title": "task-a",',
            '  "base_branch": "main",',
            '  "branch": "task/task-a",',
            '  "worktree": false,',
            '  "status": "implement",',
            '  "sessions": { "codex": "resume-1234567890" },',
            '  "phases": {',
            '    "spec": { "status": "done", "agent": "claude" },',
            '    "spec_review": { "status": "done", "agent": "codex", "verdict": "approved" },',
            '    "plan": { "status": "done", "agent": "claude" },',
            '    "implement": { "status": "done", "agent": "codex" },',
            '    "code_review": { "status": "pending", "agent": "claude", "verdict": "" },',
            '    "qa": { "status": "pending", "agent": "claude" },',
            '    "human_review": { "status": "pending", "agent": "human" }',
            '  }',
            '}',
            'EOF',
            'cat > "$task_dir/handoff.md" <<\'EOF\'',
            '# Implementation Handoff: task-a',
            '',
            '## Changes',
            '',
            '| File | Change |',
            '|---|---|',
            '| `package.json` | retry evidence |',
            '',
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `lint` | Pass | ok |',
            'EOF',
            'exit 0',
        ]);

        const taskId = 'task-a';
        writeImplementEvidenceFixture(tasksRoot, taskId, []);
        writeTaskStatus(tasksRoot, taskId, {
            id: taskId,
            title: taskId,
            base_branch: 'main',
            branch: 'task/task-a',
            worktree: false,
            sessions: { codex: 'resume-1234567890' },
            phases: {
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'done', agent: 'codex' },
                code_review: { status: 'pending', agent: 'claude', verdict: '' },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
        });

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { checkAndRoute } from './src/orchestrator/main.ts';",
            '(async () => {',
            `  await checkAndRoute('implement', [${JSON.stringify(taskId)}]);`,
            '})().catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'main',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GIT_LOG_OUTPUT: 'abc123',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /Retry succeeded — 'task-a' implement is now done\./);
        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: { implement?: { status?: string } };
        };
        assert.equal(updated.phases?.implement?.status, 'done');
    });
});

void test('main writes one exit marker with code=0 and an ISO timestamp on a successful single-phase run', () => {
    withTempDir('orchestrator-exit-success-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);
        writeImplementEvidenceFixture(tasksRoot, 'task-a', ['`package.json`']);
        writeExecutable(fakeBins, 'codex', [
            'set -eu',
            'tasks_root="${CANON_TASKS_DIR_OVERRIDE:-tasks}"',
            'task_dir="$tasks_root/task-a"',
            'mkdir -p "$task_dir"',
            'cat > "$task_dir/handoff.md" <<\'EOF\'',
            '# Implementation Handoff: task-a',
            '',
            '## Changes',
            '',
            '| File | Change |',
            '|---|---|',
            '| `package.json` | success evidence |',
            '',
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `lint` | Pass | ok |',
            'EOF',
            'cat > "$task_dir/status.json" <<\'EOF\'',
            '{',
            '  "id": "task-a",',
            '  "title": "task-a",',
            '  "base_branch": "main",',
            '  "branch": "task/task-a",',
            '  "worktree": false,',
            '  "status": "implement",',
            '  "sessions": { "codex": "resume-1234567890" },',
            '  "phases": {',
            '    "spec": { "status": "done", "agent": "claude" },',
            '    "spec_review": { "status": "done", "agent": "codex", "verdict": "approved" },',
            '    "plan": { "status": "done", "agent": "claude" },',
            '    "implement": { "status": "done", "agent": "codex" },',
            '    "code_review": { "status": "pending", "agent": "claude", "verdict": "" },',
            '    "qa": { "status": "pending", "agent": "claude" },',
            '    "human_review": { "status": "pending", "agent": "human" }',
            '  }',
            '}',
            'EOF',
            'exit 0',
        ]);

        const taskId = 'task-a';
        writeTaskStatus(tasksRoot, taskId, {
            id: taskId,
            title: taskId,
            base_branch: 'main',
            branch: 'task/task-a',
            worktree: false,
            phases: {
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'in_progress', agent: 'codex' },
                code_review: { status: 'pending', agent: 'claude', verdict: '' },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
        });

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './src/orchestrator/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--step'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'main',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GIT_LOG_OUTPUT: 'abc123',
        });

        assert.equal(result.status, 0, result.stderr);
        const markers = result.stderr.match(/^■ orchestrator exit .*$/gm) ?? [];
        assert.equal(markers.length, 1, result.stderr);
        assert.match(markers[0] ?? '', /code=0/);
        assert.match(markers[0] ?? '', /at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
});

void test('main die exits write a marker whose reason contains the die message', () => {
    withTempDir('orchestrator-exit-die-', dir => {
        // Stub agent CLIs so checkDeps passes on machines without them (CI):
        // the die under test must be the invalid-task-id one, not a deps die.
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        writeExecutable(fakeBins, 'claude', ['exit 0']);
        writeExecutable(fakeBins, 'codex', ['exit 0']);

        const result = runNodeInline([
            "import { main } from './src/orchestrator/main.ts';",
            "process.argv = ['node', 'canon', 'BadID'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeBins}:${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: path.join(dir, 'tasks'),
        });

        assert.equal(result.status, 1, result.stderr);
        const markers = result.stderr.match(/^■ orchestrator exit .*$/gm) ?? [];
        assert.equal(markers.length, 1, result.stderr);
        assert.match(markers[0] ?? '', /code=1/);
        assert.match(markers[0] ?? '', /Invalid task ID 'BadID'/);
    });
});

void test('multi-line exit reasons collapse to a single marker line', () => {
    const result = runNodeInline([
        "import { registerExitHandlers, setExitReason } from './src/orchestrator/cli.js';",
        'registerExitHandlers();',
        "setExitReason('first line\\nsecond line\\nthird line');",
        'process.exit(1);',
    ].join('\n'), {
        ...process.env,
    });

    assert.equal(result.status, 1, result.stderr);
    const markers = result.stderr.match(/^■ orchestrator exit .*$/gm) ?? [];
    assert.equal(markers.length, 1, result.stderr);
    assert.match(markers[0] ?? '', /code=1/);
    assert.match(markers[0] ?? '', /reason=first line · second line · third line/);
    assert.match(markers[0] ?? '', /at \d{4}-\d{2}-\d{2}T/);
});

void test('agent failure ladders throw AgentSessionError and Codex non-zero exits still return', () => {
    withTempDir('orchestrator-exit-agents-', dir => {
        const fakeBins = path.join(dir, 'fake-bins');
        const emptyBins = path.join(dir, 'empty-bins');
        fs.mkdirSync(fakeBins);
        fs.mkdirSync(emptyBins);
        const metricsFile = path.join(dir, 'metrics.md');
        for (const scenario of [
            { agent: 'claude', body: ['exit 1'], kind: 'exit_code', reason: /claude session exited 1/ },
            { agent: 'codex', body: null, kind: 'spawn_error', reason: /codex session spawn error:/ },
            { agent: 'codex', body: ['sleep 2'], kind: 'stalled', reason: /codex session stalled/ },
            { agent: 'codex', body: ['kill -TERM $$'], kind: 'signal', reason: /codex session received signal SIGTERM/ },
        ]) {
            if (scenario.body) writeExecutable(fakeBins, scenario.agent, scenario.body);
            const result = runNodeInline([
                "import { registerExitHandlers } from './src/orchestrator/cli.js';",
                "import { AgentSessionError } from './src/orchestrator/agents/errors.js';",
                `import { ${scenario.agent === 'claude' ? 'runClaude' : 'runCodex'} as run } from './src/orchestrator/agents/${scenario.agent}.js';`,
                'registerExitHandlers();',
                'try {',
                scenario.agent === 'claude'
                    ? "await run('prompt', false, null, 'model', 'high', '10', { taskId: 'claude-failed-metric', phase: 'plan', iteration: 0 }, process.cwd());"
                    : "await run('prompt', false, null, 'model', 'high', undefined, process.cwd());",
                "console.log('returned');",
                '} catch (err) {',
                "console.log('CAUGHT ' + JSON.stringify({ isASE: err instanceof AgentSessionError, agent: err.agent, kind: err.kind, reason: err.reason, exitCode: err.exitCode, signal: err.signal }));",
                '}',
                "console.log('after-call');",
            ].join('\n'), {
                ...process.env,
                PATH: scenario.body ? `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}` : emptyBins,
                PIPELINE_STALL_TIMEOUT_MS: scenario.kind === 'stalled' ? '1' : '600000',
                CANON_METRICS_FILE_OVERRIDE: metricsFile,
            });
            assert.equal(result.status, 0, combinedOutput(result));
            assert.match(result.stdout, /after-call/);
            assert.doesNotMatch(result.stdout, /^returned$/m);
            const caught = JSON.parse(result.stdout.match(/^CAUGHT (.+)$/m)![1]) as Record<string, unknown>;
            assert.equal(caught.isASE, true);
            assert.equal(caught.agent, scenario.agent);
            assert.equal(caught.kind, scenario.kind);
            assert.match(String(caught.reason), scenario.reason);
            if (scenario.kind === 'exit_code') assert.equal(caught.exitCode, 1);
            if (scenario.kind === 'signal') assert.equal(caught.signal, 'SIGTERM');
            assert.equal((result.stderr.match(/^■ orchestrator exit .*$/gm) ?? []).length, 1);
            assert.match(result.stderr, /■ orchestrator exit code=0/);
        }
        assert.match(fs.readFileSync(metricsFile, 'utf8'), /\| claude-failed-metric \| plan \| claude \|.*\| failed \|/);
        writeExecutable(fakeBins, 'codex', ['exit 1']);
        const returned = runNodeInline([
            "import { runCodex } from './src/orchestrator/agents/codex.js';",
            "await runCodex('prompt', false, null, 'model', 'high', undefined, process.cwd());",
            "console.log('after-runCodex');",
        ].join('\n'), { ...process.env, PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}` });
        assert.equal(returned.status, 0, returned.stderr);
        assert.match(returned.stdout, /after-runCodex/);
    });
});

void test('uncaught exceptions and unhandled rejections write one exit marker and exit 1', () => {
    const uncaughtResult = runNodeInline([
        "import { registerExitHandlers } from './src/orchestrator/cli.js';",
        'registerExitHandlers();',
        "setTimeout(() => { throw new Error('boom'); }, 0);",
        'await new Promise(() => {});',
    ].join('\n'), {
        ...process.env,
    });
    assert.equal(uncaughtResult.status, 1, uncaughtResult.stderr);
    const uncaughtMarkers = uncaughtResult.stderr.match(/^■ orchestrator exit .*$/gm) ?? [];
    assert.equal(uncaughtMarkers.length, 1, uncaughtResult.stderr);
    assert.match(uncaughtMarkers[0] ?? '', /code=1/);
    assert.match(uncaughtResult.stderr, /Error: boom/);
    assert.match(uncaughtResult.stderr, /at .*:/);

    const rejectionResult = runNodeInline([
        "import { registerExitHandlers } from './src/orchestrator/cli.js';",
        'registerExitHandlers();',
        "setTimeout(() => { Promise.reject(new Error('oops')); }, 0);",
        'await new Promise(() => {});',
    ].join('\n'), {
        ...process.env,
    });
    assert.equal(rejectionResult.status, 1, rejectionResult.stderr);
    const rejectionMarkers = rejectionResult.stderr.match(/^■ orchestrator exit .*$/gm) ?? [];
    assert.equal(rejectionMarkers.length, 1, rejectionResult.stderr);
    assert.match(rejectionMarkers[0] ?? '', /code=1/);
    assert.match(rejectionResult.stderr, /Error: oops/);
    assert.match(rejectionResult.stderr, /at .*:/);
});

void test('recordMetric honors CANON_METRICS_FILE_OVERRIDE', () => {
    withTempDir('run-task-metrics-override-', dir => {
        const telemetryFile = path.join(dir, 'pipeline-invocations.md');
        const result = runNodeInline([
            "import { recordMetric } from './src/orchestrator/metrics.ts';",
            "recordMetric({ taskId: 'metrics-override', phase: 'implement', agent: 'codex', model: 'gpt-5.4-mini', durationMs: 0, status: 'ok', tokens: null, iteration: 0 });",
        ].join('\n'), {
            ...process.env,
            CANON_METRICS_FILE_OVERRIDE: telemetryFile,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.equal(fs.existsSync(telemetryFile), true);
        const contents = fs.readFileSync(telemetryFile, 'utf8');
        assert.match(contents, /metrics-override/);
    });
});

void test('guardConcurrentRun: passes through when task dir is empty', () => {
    withTempDir('guard-empty-', dir => {
        const { fn } = captureDie();
        assert.doesNotThrow(() => guardConcurrentRun(['t1'], makeGuardResolver(dir), fn));
    });
});

void test('guardConcurrentRun: passes through when .canon-pid points to dead PID', () => {
    withTempDir('guard-dead-pid-', dir => {
        const taskDir = path.join(dir, 'tasks', 't1');
        fs.mkdirSync(taskDir, { recursive: true });
        fs.writeFileSync(path.join(taskDir, '.canon-pid'), '99999999\n', 'utf8');
        const { fn } = captureDie();
        assert.doesNotThrow(() => guardConcurrentRun(['t1'], makeGuardResolver(dir), fn));
    });
});

void test('guardConcurrentRun: passes through when .canon-pid matches own PID', () => {
    withTempDir('guard-self-pid-', dir => {
        const taskDir = path.join(dir, 'tasks', 't1');
        fs.mkdirSync(taskDir, { recursive: true });
        fs.writeFileSync(path.join(taskDir, '.canon-pid'), `${process.pid}\n`, 'utf8');
        const { fn } = captureDie();
        assert.doesNotThrow(() => guardConcurrentRun(['t1'], makeGuardResolver(dir), fn));
    });
});

void test('guardConcurrentRun: dies when fresh heartbeat has foreign PID', () => {
    withTempDir('guard-fresh-hb-', dir => {
        const taskDir = path.join(dir, 'tasks', 't1');
        writeFreshHeartbeat(taskDir, 12345);
        const c = captureDie();
        assert.throws(() => guardConcurrentRun(['t1'], makeGuardResolver(dir), c.fn));
        assert.ok(c.msg !== null, 'dieImpl should have been called');
        assert.match(c.msg, /t1/);
        assert.match(c.msg, /12345/);
        assert.match(c.msg, /canon stop/);
    });
});

void test('guardConcurrentRun: passes through when heartbeat is stale', () => {
    withTempDir('guard-stale-hb-', dir => {
        const taskDir = path.join(dir, 'tasks', 't1');
        const staleMs = Date.now() - 300_000;
        const hb = { pid: 12345, started_at_ms: staleMs, last_update_ms: staleMs, task_ids: ['t1'] };
        fs.mkdirSync(taskDir, { recursive: true });
        fs.writeFileSync(path.join(taskDir, '.heartbeat.json'), JSON.stringify(hb, null, 2), 'utf8');
        const { fn } = captureDie();
        assert.doesNotThrow(() => guardConcurrentRun(['t1'], makeGuardResolver(dir), fn));
    });
});

void test('guardConcurrentRun: passes through when heartbeat PID matches own PID', () => {
    withTempDir('guard-self-hb-', dir => {
        const taskDir = path.join(dir, 'tasks', 't1');
        writeFreshHeartbeat(taskDir, process.pid);
        const { fn } = captureDie();
        assert.doesNotThrow(() => guardConcurrentRun(['t1'], makeGuardResolver(dir), fn));
    });
});

// --- assertManagedInvocationRoot / classifyInvocationRoot (issue #202) ---------
// The pure classifier decides whether canon was invoked from the main checkout,
// a canon-managed worktree, or a hand-created (foreign) linked worktree it must
// refuse. Callers realpath every input first, so these tests pass canonical
// paths (see the "Canonicalize real git worktree paths" lesson).

void test('classifyInvocationRoot: main checkout when active toplevel equals the main root', () => {
    const result = classifyInvocationRoot({
        activeToplevel: '/repo',
        mainRoot: '/repo',
        worktreesRoot: '/dev-worktrees',
    });
    assert.deepEqual(result, { kind: 'main' });
});

void test('classifyInvocationRoot: canon-worktree when active toplevel is under the worktrees root', () => {
    const result = classifyInvocationRoot({
        activeToplevel: '/dev-worktrees/task-a',
        mainRoot: '/repo',
        worktreesRoot: '/dev-worktrees',
    });
    assert.deepEqual(result, { kind: 'canon-worktree', activeRoot: '/dev-worktrees/task-a' });
});

void test('classifyInvocationRoot: canon-worktree for a nested subdir under the worktrees root', () => {
    const result = classifyInvocationRoot({
        activeToplevel: '/dev-worktrees/task-a/nested',
        mainRoot: '/repo',
        worktreesRoot: '/dev-worktrees',
    });
    assert.equal(result.kind, 'canon-worktree');
});

void test('classifyInvocationRoot: foreign-worktree for a linked worktree outside canon control', () => {
    const result = classifyInvocationRoot({
        activeToplevel: '/tmp/canon-root',
        mainRoot: '/repo',
        worktreesRoot: '/dev-worktrees',
    });
    assert.deepEqual(result, {
        kind: 'foreign-worktree',
        activeRoot: '/tmp/canon-root',
        mainRoot: '/repo',
        worktreesRoot: '/dev-worktrees',
    });
});

void test('classifyInvocationRoot: a sibling that only shares a path prefix with the worktrees root is foreign', () => {
    // `/dev-worktrees-evil` must not be treated as inside `/dev-worktrees`.
    const result = classifyInvocationRoot({
        activeToplevel: '/dev-worktrees-evil',
        mainRoot: '/repo',
        worktreesRoot: '/dev-worktrees',
    });
    assert.equal(result.kind, 'foreign-worktree');
});

void test('classifyInvocationRoot: main checkout remains main with an in-repo worktrees root', () => {
    const result = classifyInvocationRoot({
        activeToplevel: '/repo',
        mainRoot: '/repo',
        worktreesRoot: '/repo/.canon/worktrees',
    });
    assert.deepEqual(result, { kind: 'main' });
});

void test('classifyInvocationRoot: in-repo worktree is managed under the nested root', () => {
    const result = classifyInvocationRoot({
        activeToplevel: '/repo/.canon/worktrees/task-a',
        mainRoot: '/repo',
        worktreesRoot: '/repo/.canon/worktrees',
    });
    assert.deepEqual(result, { kind: 'canon-worktree', activeRoot: '/repo/.canon/worktrees/task-a' });
});

void test('classifyInvocationRoot: in-repo root prefix sibling remains foreign', () => {
    const result = classifyInvocationRoot({
        activeToplevel: '/repo/.canon/worktrees-evil/task-a',
        mainRoot: '/repo',
        worktreesRoot: '/repo/.canon/worktrees',
    });
    assert.equal(result.kind, 'foreign-worktree');
});

void test('classifyInvocationRoot: unknown when git reports no toplevel (non-git tree)', () => {
    const result = classifyInvocationRoot({
        activeToplevel: null,
        mainRoot: '/repo',
        worktreesRoot: '/dev-worktrees',
    });
    assert.deepEqual(result, { kind: 'unknown' });
});

void test('classifyInvocationRoot: real linked worktree classifies foreign vs canon by worktrees root', () => {
    withTempDir('run-task-202-worktree-', dir => {
        const canonical = fs.realpathSync(dir);
        const mainRoot = path.join(canonical, 'main');
        fs.mkdirSync(mainRoot, { recursive: true });
        const git = (cwd: string, args: string[]): void => {
            const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
            if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
        };
        git(mainRoot, ['init', '-q', '-b', 'main']);
        git(mainRoot, ['config', 'user.email', 'test@example.com']);
        git(mainRoot, ['config', 'user.name', 'Test']);
        fs.writeFileSync(path.join(mainRoot, 'f.txt'), 'x\n');
        git(mainRoot, ['add', '.']);
        git(mainRoot, ['commit', '-q', '-m', 'init']);

        // A real linked worktree the operator created by hand.
        const linkedWorktree = path.join(canonical, 'linked');
        git(mainRoot, ['worktree', 'add', '-q', '-b', 'feature', linkedWorktree, 'main']);

        const activeToplevel = fs.realpathSync(
            spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: linkedWorktree, encoding: 'utf8' }).stdout.trim(),
        );
        const realMainRoot = fs.realpathSync(mainRoot);

        // With the worktrees root elsewhere, the hand-created worktree is foreign.
        const foreign = classifyInvocationRoot({
            activeToplevel,
            mainRoot: realMainRoot,
            worktreesRoot: path.join(canonical, 'dev-worktrees'),
        });
        assert.equal(foreign.kind, 'foreign-worktree');

        // If that same directory IS canon's worktrees root, it's accepted.
        const managed = classifyInvocationRoot({
            activeToplevel,
            mainRoot: realMainRoot,
            worktreesRoot: canonical,
        });
        assert.equal(managed.kind, 'canon-worktree');

        // From the main checkout itself, always 'main'.
        const mainTop = fs.realpathSync(
            spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: mainRoot, encoding: 'utf8' }).stdout.trim(),
        );
        const fromMain = classifyInvocationRoot({
            activeToplevel: mainTop,
            mainRoot: realMainRoot,
            worktreesRoot: path.join(canonical, 'dev-worktrees'),
        });
        assert.equal(fromMain.kind, 'main');

        git(mainRoot, ['worktree', 'remove', '--force', linkedWorktree]);
    });
});

void test('assertManagedInvocationRoot: accepts the main checkout and an in-repo linked worktree', () => {
    withTempDir('run-task-202-in-repo-worktree-', dir => {
        const { localDir } = makeGitFixture(dir);
        const linkedWorktree = path.join(localDir, '.canon', 'worktrees', 'custom-name');
        gitIn(localDir, 'worktree', 'add', '-q', '-b', 'feature/in-repo', linkedWorktree, 'main');
        const env = childEnvWithoutTasksOverride();
        delete env.CANON_WORKTREES_ROOT;
        const stateModuleUrl = pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/state.ts')).href;
        try {
            const fromWorktree = runNodeInline([
                `import(${JSON.stringify(stateModuleUrl)})`,
                '.then(m => m.assertManagedInvocationRoot())',
                '.catch(err => { console.error(err); process.exit(1); });',
            ].join('\n'), env, linkedWorktree);
            assert.equal(fromWorktree.status, 0, fromWorktree.stderr);

            const fromMain = runNodeInline([
                `import(${JSON.stringify(stateModuleUrl)})`,
                '.then(m => m.assertManagedInvocationRoot())',
                '.catch(err => { console.error(err); process.exit(1); });',
            ].join('\n'), env, localDir);
            assert.equal(fromMain.status, 0, fromMain.stderr);
        } finally {
            spawnSync('git', ['worktree', 'remove', '--force', linkedWorktree], {
                cwd: localDir,
                encoding: 'utf8',
            });
        }
    });
});

void test('resolveTaskCwd remains location-blind for an out-of-root linked worktree', () => {
    withTempDir('run-task-safety-out-of-root-resolution-', dir => {
        const linkedWorktree = path.join(dir, 'legacy-worktree');
        const { localDir } = makeOutOfRootTaskFixture(dir, 'legacy-resolution', linkedWorktree);
        const env = childEnvWithoutTasksOverride();
        delete env.CANON_WORKTREES_ROOT;
        const stateModuleUrl = pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/state.ts')).href;
        try {
            const result = runNodeInline([
                `import(${JSON.stringify(stateModuleUrl)})`,
                `.then(m => console.log(m.resolveTaskCwd(${JSON.stringify('legacy-resolution')})))`,
                '.catch(err => { console.error(err); process.exit(1); });',
            ].join('\n'), env, localDir);
            assert.equal(result.status, 0, result.stderr);
            assert.equal(canonicalizeTestPath(result.stdout.trim()), canonicalizeTestPath(linkedWorktree));
        } finally {
            spawnSync('git', ['worktree', 'remove', '--force', linkedWorktree], {
                cwd: localDir,
                encoding: 'utf8',
            });
        }
    });
});

void test('main refuses canon run before writing runtime files for an out-of-root worktree', () => {
    withTempDir('run-task-safety-run-out-of-root-', dir => {
        const taskId = 'run-out-of-root';
        const linkedWorktree = path.join(dir, 'legacy-worktree');
        const { localDir } = makeOutOfRootTaskFixture(dir, taskId, linkedWorktree);
        const env = childEnvWithoutTasksOverride();
        delete env.CANON_WORKTREES_ROOT;
        try {
            const result = runMainInline(taskId, [], env, localDir);
            const output = combinedOutput(result);
            assert.notEqual(result.status, 0);
            assert.match(output, /resolves to a worktree outside canon's managed worktrees root/);
            assert.ok(output.includes(canonicalizeTestPath(linkedWorktree)));
            assert.ok(output.includes(canonicalizeTestPath(path.join(localDir, '.canon', 'worktrees'))));
            assert.match(output, /move the directory .* run\n\s+git worktree repair '/);
            assert.match(output, /set CANON_WORKTREES_ROOT to the directory that CONTAINS this worktree/);
            for (const runtimeFile of ['.canon-pid', '.heartbeat.json']) {
                assert.equal(fs.existsSync(path.join(localDir, 'tasks', taskId, runtimeFile)), false);
                assert.equal(fs.existsSync(path.join(linkedWorktree, 'tasks', taskId, runtimeFile)), false);
            }
        } finally {
            spawnSync('git', ['worktree', 'remove', '--force', linkedWorktree], {
                cwd: localDir,
                encoding: 'utf8',
            });
        }
    });
});

void test('main --ship skips the out-of-root run refusal', () => {
    withTempDir('run-task-safety-ship-out-of-root-', dir => {
        const taskId = 'ship-out-of-root';
        const linkedWorktree = path.join(dir, 'legacy-worktree');
        const { localDir } = makeOutOfRootTaskFixture(dir, taskId, linkedWorktree);
        const env = childEnvWithoutTasksOverride();
        delete env.CANON_WORKTREES_ROOT;
        try {
            const result = runMainInline(taskId, ['--ship'], env, localDir);
            assert.doesNotMatch(combinedOutput(result), /resolves to a worktree outside canon's managed worktrees root/);
        } finally {
            spawnSync('git', ['worktree', 'remove', '--force', linkedWorktree], {
                cwd: localDir,
                encoding: 'utf8',
            });
        }
    });
});

void test('main allows an in-root worktree with a non-default directory name past the guard', () => {
    withTempDir('run-task-safety-run-in-root-', dir => {
        const taskId = 'run-in-root';
        const linkedWorktree = path.join(dir, 'local', '.canon', 'worktrees', 'custom-name');
        const { localDir } = makeOutOfRootTaskFixture(dir, taskId, linkedWorktree);
        const env = childEnvWithoutTasksOverride();
        delete env.CANON_WORKTREES_ROOT;
        try {
            const result = runMainInline(taskId, ['--dry-run'], env, localDir);
            assert.equal(result.status, 0, result.stderr);
            assert.doesNotMatch(combinedOutput(result), /resolves to a worktree outside canon's managed worktrees root/);
        } finally {
            spawnSync('git', ['worktree', 'remove', '--force', linkedWorktree], {
                cwd: localDir,
                encoding: 'utf8',
            });
        }
    });
});

void test('main allows a fresh worktree task with no worktree yet past the guard', () => {
    withTempDir('run-task-safety-run-no-worktree-', dir => {
        const taskId = 'run-no-worktree';
        const { localDir } = makeGitFixture(dir);
        writeTaskStatus(path.join(localDir, 'tasks'), taskId, { ...makeCompleteStatus(taskId, ''), worktree: true });
        const env = childEnvWithoutTasksOverride();
        delete env.CANON_WORKTREES_ROOT;
        const result = runMainInline(taskId, ['--dry-run'], env, localDir);
        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(combinedOutput(result), /resolves to a worktree outside canon's managed worktrees root/);
    });
});

void test('task commands from an unmigrated worktree use the invocation-root refusal', () => {
    withTempDir('run-task-safety-task-out-of-root-', dir => {
        const taskId = 'task-out-of-root';
        const linkedWorktree = path.join(dir, 'legacy-worktree');
        const { localDir } = makeOutOfRootTaskFixture(dir, taskId, linkedWorktree);
        const env = childEnvWithoutTasksOverride();
        delete env.CANON_WORKTREES_ROOT;
        const taskModuleUrl = pathToFileURL(path.join(WORKTREE_ROOT, 'src/task/index.ts')).href;
        try {
            const result = runNodeInline([
                `import(${JSON.stringify(taskModuleUrl)})`,
                `.then(m => m.taskCmd(['status', ${JSON.stringify(taskId)}]))`,
                '.catch(err => { console.error(err); process.exit(1); });',
            ].join('\n'), env, linkedWorktree);
            const output = combinedOutput(result);
            assert.notEqual(result.status, 0);
            assert.ok(output.includes(canonicalizeTestPath(linkedWorktree)));
            assert.ok(output.includes(canonicalizeTestPath(path.join(localDir, '.canon', 'worktrees'))));
            assert.match(output, /This also covers a worktree canon itself created under an earlier default/);
            assert.doesNotMatch(output, /dev-worktrees/);
        } finally {
            spawnSync('git', ['worktree', 'remove', '--force', linkedWorktree], {
                cwd: localDir,
                encoding: 'utf8',
            });
        }
    });
});

void test('task mutations from the main checkout still target an unmigrated worktree', () => {
    withTempDir('run-task-safety-task-main-routing-', dir => {
        const taskId = 'task-main-routing';
        const linkedWorktree = path.join(dir, 'legacy-worktree');
        const { localDir } = makeOutOfRootTaskFixture(dir, taskId, linkedWorktree);
        const env = childEnvWithoutTasksOverride();
        delete env.CANON_WORKTREES_ROOT;
        const taskModuleUrl = pathToFileURL(path.join(WORKTREE_ROOT, 'src/task/index.ts')).href;
        const mainStatusPath = path.join(localDir, 'tasks', taskId, 'status.json');
        const worktreeStatusPath = path.join(linkedWorktree, 'tasks', taskId, 'status.json');
        const mainBefore = fs.readFileSync(mainStatusPath, 'utf8');
        const worktreeBefore = fs.readFileSync(worktreeStatusPath, 'utf8');
        try {
            const result = runNodeInline([
                `import(${JSON.stringify(taskModuleUrl)})`,
                `.then(m => m.taskCmd(['phase', ${JSON.stringify(taskId)}, 'implement', 'in_progress']))`,
                '.catch(err => { console.error(err); process.exit(1); });',
            ].join('\n'), env, localDir);
            assert.equal(result.status, 0, result.stderr);
            assert.equal(fs.readFileSync(mainStatusPath, 'utf8'), mainBefore);
            assert.notEqual(fs.readFileSync(worktreeStatusPath, 'utf8'), worktreeBefore);
            const worktreeStatus = JSON.parse(fs.readFileSync(worktreeStatusPath, 'utf8')) as {
                phases: { implement: { status: string } };
            };
            assert.equal(worktreeStatus.phases.implement.status, 'in_progress');
        } finally {
            spawnSync('git', ['worktree', 'remove', '--force', linkedWorktree], {
                cwd: localDir,
                encoding: 'utf8',
            });
        }
    });
});

void test('effectiveWorktreesRoot: relative CANON_WORKTREES_ROOT anchors on REPO_ROOT, not cwd', () => {
    // Regression for the guard falsely rejecting canon's own agents: an agent
    // runs task commands from inside a managed worktree, so process.cwd() is the
    // worktree. A cwd-relative resolve of a relative override would recompute a
    // different root and misclassify that worktree as foreign.
    withTempDir('run-task-202-relroot-', dir => {
        const prevCwd = process.cwd();
        const prevEnv = process.env.CANON_WORKTREES_ROOT;
        try {
            process.env.CANON_WORKTREES_ROOT = '../dev-worktrees';
            process.chdir(dir);
            const resolved = effectiveWorktreesRoot();
            assert.equal(resolved, path.resolve(REPO_ROOT, '../dev-worktrees'));
            assert.notEqual(resolved, path.resolve(dir, '../dev-worktrees'));
        } finally {
            process.chdir(prevCwd);
            if (prevEnv === undefined) delete process.env.CANON_WORKTREES_ROOT;
            else process.env.CANON_WORKTREES_ROOT = prevEnv;
        }
    });
});

void test('worktree roots default to the in-repo .canon/worktrees directory', () => {
    const previous = process.env.CANON_WORKTREES_ROOT;
    try {
        delete process.env.CANON_WORKTREES_ROOT;
        const expectedRoot = canonicalizeTestPath(path.join(REPO_ROOT, '.canon/worktrees'));
        assert.equal(canonicalizeTestPath(WORKTREES_ROOT), expectedRoot);
        assert.equal(canonicalizeTestPath(effectiveWorktreesRoot()), expectedRoot);
        assert.equal(canonicalizeTestPath(worktreePath('x')), canonicalizeTestPath(path.join(expectedRoot, 'x')));
    } finally {
        if (previous === undefined) delete process.env.CANON_WORKTREES_ROOT;
        else process.env.CANON_WORKTREES_ROOT = previous;
    }
});

for (const [name, doc, config, admitted] of [
    ['mapped', 'docs/api.md', { paths: { 'api/**': ['docs/api.md'] } }, true],
    ['flag-only', 'AGENTS.md', { protected: ['AGENTS.md'], flag_only: ['AGENTS.md'] }, false],
    ['default pipeline reference', 'docs/pipeline-orchestrator.md', {}, false],
    ['explicit pipeline reference', 'docs/pipeline-orchestrator.md', { protected: ['docs/pipeline-orchestrator.md'] }, true],
] as const) {
    void test(`QA-end docs admission: ${name}`, () => {
        withTempDir('qa-config-admission-', dir => {
            const { localDir } = makeGitFixture(dir);
            writeFreshnessConfig(localDir, { docs_freshness: config });
            gitIn(localDir, 'add', '.canon/config.json');
            gitIn(localDir, 'commit', '-m', 'fixture config');
            fs.mkdirSync(path.dirname(path.join(localDir, doc)), { recursive: true });
            fs.writeFileSync(path.join(localDir, doc), 'QA correction\n');
            const result = runCommitQaArtifactsInline('task-a', localDir);
            assert.equal(result.status === 0, admitted, result.stderr);
            if (admitted) assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: localDir, encoding: 'utf8' }), '');
            else assert.match(result.stderr, /outside the QA-end allowlist/);
        });
    });
}

for (const [name, doc, config, qaDone, declared, admitted] of [
    ['mapped after QA', 'docs/api.md', { paths: { 'api/**': ['docs/api.md'] } }, true, false, true],
    ['mapped before QA', 'docs/api.md', { paths: { 'api/**': ['docs/api.md'] } }, false, false, false],
    ['mapped explicitly before QA', 'docs/api.md', { paths: { 'api/**': ['docs/api.md'] } }, false, true, true],
    ['flag-only undeclared', 'AGENTS.md', { flag_only: ['AGENTS.md'] }, true, false, false],
    ['flag-only declared', 'AGENTS.md', { flag_only: ['AGENTS.md'] }, true, true, true],
    ['default pipeline reference', 'docs/pipeline-orchestrator.md', {}, true, false, false],
    ['explicit pipeline reference', 'docs/pipeline-orchestrator.md', { protected: ['docs/pipeline-orchestrator.md'] }, true, false, true],
] as const) {
    void test(`human-review docs admission: ${name}`, () => {
        withTempDir('human-config-admission-', dir => {
            const harness = setupHumanReviewHarness(dir, ['task-a']);
            writeFreshnessConfig(dir, { docs_freshness: config });
            if (!qaDone) {
                const status = makeCompleteStatus('task-a', 'task/task-a');
                (status.phases as Record<string, { status: string }>).qa.status = 'in_progress';
                writeTaskStatus(harness.tasksRoot, 'task-a', status);
            }
            if (declared) writeAffectedFilesSpec(harness.tasksRoot, 'task-a', [`\`${doc}\``]);
            const result = runHumanReviewCommit(harness, ['task-a'], {
                FAKE_GIT_STATUS_OUTPUT: ` M ${doc}`, FAKE_GIT_DIFF_OUTPUT: doc,
            });
            assert.equal(result.status === 0, admitted, result.stderr);
            if (admitted) assert.match(fs.readFileSync(harness.gitLogPath, 'utf8'), /^commit /m);
            else assert.match(result.stderr, /outside the human_review allowlist/);
        });
    });
}

void test('QA-end, human-review, and QA prompt consumers fail closed on a config edited after import', () => {
    withTempDir('config-mid-run-', dir => {
        for (const kind of ['qa-commit', 'human-commit', 'qa-prompt']) {
            writeFreshnessConfig(dir, '{}');
            const modulePath = kind === 'qa-prompt' ? 'src/orchestrator/phases/qa.ts' : 'src/orchestrator/main.ts';
            const action = kind === 'qa-commit' ? 'm.commitQaArtifacts(["task-a"], root);'
                : kind === 'human-commit' ? 'm.commitHumanReviewFiles(["task-a"], root, false);'
                : 'm.resolveQaDocsFreshness(["task-a"], root, { getBaseBranch: () => "main", getAffectedFiles: () => ({ ok: true, files: [] }) });';
            const result = runNodeInline(`import fs from 'node:fs';
                const root = ${JSON.stringify(dir)};
                import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, modulePath)).href)}).then(m => {
                    fs.writeFileSync(root + '/.canon/config.json', '{');
                    ${action}
                });`, process.env);
            assert.notEqual(result.status, 0, kind);
            assert.match(result.stderr, /\.canon\/config.json.*not valid JSON/, kind);
            assert.doesNotMatch(result.stdout, /Committed|Pushing/);
        }
    });
});

void test('main parks a failed plan durably and a plain rerun completes it', { concurrency: false }, () => {
    withTempDir('agent-plan-park-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'plan-failure';
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', 0);
        const statusPath = path.join(tasksRoot, taskId, 'status.json');
        const status = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as StatusJson;
        status.phases.plan!.status = 'pending';
        writeTaskStatus(tasksRoot, taskId, status);
        const fakeBins = path.join(dir, 'bins');
        fs.mkdirSync(fakeBins);
        setupInvocationLoggingCliTools(fakeBins);
        writeExecutable(fakeBins, 'claude', [
            'if [ "${1:-}" = "--version" ]; then echo "fake-agent 1.0"; exit 0; fi',
            'exit 1',
        ]);
        const failed = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, 3);
        assert.equal(failed.status, 2, combinedOutput(failed));
        const parked = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as StatusJson;
        assert.equal(parked.phases.plan?.status, 'blocked');
        assert.equal(parked.phases.plan?.auto_block_count, 1);
        assert.equal(parked.escalations?.length, 1);
        assert.equal(parked.escalations?.[0].phase, 'plan');
        assert.match(parked.escalations[0].reason, /claude session exited 1/);
        assert.match(parked.escalations[0].reason, /canon run plan-failure/);
        assert.match(parked.escalations[0].cause ?? '', /claude session exited 1/);
        assert.doesNotMatch(parked.escalations[0].cause ?? '', /canon run|Fix the cause/);
        assert.match(failed.stderr, /■ orchestrator exit code=2 \[reason=claude session exited 1/);
        assert.match(failed.stdout, /AGENT SESSION FAILED/);

        writeExecutable(fakeBins, 'claude', [
            'if [ "${1:-}" = "--version" ]; then echo "fake-agent 1.0"; exit 0; fi',
            'printf "# Plan\\n\\n1. Implement the change.\\n" > "$CANON_TASKS_DIR_OVERRIDE/$FAKE_AGENT_TASK_ID/plan.md"',
            'node "$FAKE_AGENT_COMPLETER"',
        ]);
        const recovered = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, 3, [], { FAKE_AGENT_COMPLETE_PHASE: 'plan' });
        assert.equal(recovered.status, 0, combinedOutput(recovered));
        const done = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as StatusJson;
        assert.equal(done.phases.plan?.status, 'done');
        assert.equal(done.status, 'implement');
    });
});

void test('main parks a stalled Codex implement session', { concurrency: false }, () => {
    withTempDir('agent-implement-park-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'implement-stall';
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', 0);
        const fakeBins = path.join(dir, 'bins');
        fs.mkdirSync(fakeBins);
        setupInvocationLoggingCliTools(fakeBins);
        writeExecutable(fakeBins, 'codex', [
            'if [ "${1:-}" = "--version" ]; then echo "fake-agent 1.0"; exit 0; fi',
            'sleep 2',
        ]);
        const result = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, 3, [], { PIPELINE_STALL_TIMEOUT_MS: '1' });
        assert.equal(result.status, 2, combinedOutput(result));
        const parked = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as StatusJson;
        assert.equal(parked.phases.implement?.status, 'blocked');
        assert.equal(parked.escalations?.at(-1)?.phase, 'implement');
        assert.match(parked.escalations.at(-1)!.reason, /codex session stalled/);
    });
});

for (const failure of ['signal', 'exit_code'] as const) {
    void test(`main reopens a partially completed spec_review bundle after ${failure}`, { concurrency: false }, () => {
        withTempDir(`agent-bundle-${failure}-`, dir => {
            const { localDir } = makeGitFixture(dir);
            const ids = ['bundle-a', 'bundle-b'];
            const tasksRoot = writeReviewLoopFixture(localDir, ids[0], 'spec_review', 0, 0, true);
            writeReviewLoopFixture(localDir, ids[1], 'spec_review', 0, 0, true);
            const fakeBins = path.join(dir, 'bins');
            fs.mkdirSync(fakeBins);
            setupInvocationLoggingCliTools(fakeBins);
            writeExecutable(fakeBins, 'codex', [
                'if [ "${1:-}" = "--version" ]; then echo "fake-agent 1.0"; exit 0; fi',
                'node "$FAKE_AGENT_COMPLETER"',
                failure === 'signal' ? 'kill -TERM $$' : 'exit 1',
            ]);
            const first = runReviewLoopMain(localDir, tasksRoot, fakeBins, ids[0], 3, [ids[1]], { FAKE_AGENT_COMPLETE_PHASE: 'spec_review' });
            assert.equal(first.status, 2, combinedOutput(first));
            for (const id of ids) {
                const parked = JSON.parse(fs.readFileSync(path.join(tasksRoot, id, 'status.json'), 'utf8')) as StatusJson;
                assert.equal(parked.phases.spec_review?.status, 'blocked');
                assert.equal(parked.status, 'spec_review');
                assert.equal(parked.escalations?.length, 1);
                assert.equal(parked.escalations?.[0].phase, 'spec_review');
                assert.match(parked.escalations[0].reason, /canon run bundle-a bundle-b/);
            }
            writeExecutable(fakeBins, 'codex', [
                'if [ "${1:-}" = "--version" ]; then echo "fake-agent 1.0"; exit 0; fi',
                'FAKE_AGENT_TASK_ID=bundle-a node "$FAKE_AGENT_COMPLETER"',
                'FAKE_AGENT_TASK_ID=bundle-b node "$FAKE_AGENT_COMPLETER"',
            ]);
            const second = runReviewLoopMain(localDir, tasksRoot, fakeBins, ids[0], 3, [ids[1]], { FAKE_AGENT_COMPLETE_PHASE: 'spec_review' });
            assert.equal(second.status, 0, combinedOutput(second));
            assert.doesNotMatch(combinedOutput(second), /Bundle tasks are at different phases/);
            for (const id of ids) {
                const done = JSON.parse(fs.readFileSync(path.join(tasksRoot, id, 'status.json'), 'utf8')) as StatusJson;
                assert.equal(done.phases.spec_review?.status, 'done');
                assert.equal(done.status, 'plan');
            }
        });
    });
}

void test('QA failure rejects before partial stdout can salvage done.md', { concurrency: false }, () => {
    withTempDir('agent-qa-salvage-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'qa-failure';
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', 0, 0, true);
        const statusPath = path.join(tasksRoot, taskId, 'status.json');
        const status = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as StatusJson;
        status.phases.code_review!.status = 'done';
        writeTaskStatus(tasksRoot, taskId, status);
        const fakeBins = path.join(dir, 'bins');
        fs.mkdirSync(fakeBins);
        writeExecutable(fakeBins, 'claude', ['printf "# QA Summary\\n\\nAll checks passed.\\n"', 'exit 1']);
        const result = runNodeInline([
            `import { buildPipelineState } from ${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)};`,
            `import { runQaPhase } from ${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/phases/qa.ts')).href)};`,
            `import { AgentSessionError } from ${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/agents/errors.ts')).href)};`,
            'try {',
            `await runQaPhase(buildPipelineState([${JSON.stringify(taskId)}]), false, null);`,
            "console.log('returned');",
            '} catch (error) {',
            "console.log('CAUGHT ' + JSON.stringify({ isASE: error instanceof AgentSessionError, agent: error.agent, kind: error.kind }));",
            '}',
        ].join('\n'), { ...process.env, PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`, CANON_TASKS_DIR_OVERRIDE: tasksRoot }, localDir);
        assert.equal(result.status, 0, combinedOutput(result));
        assert.match(result.stdout, /# QA Summary/);
        assert.match(result.stdout, /CAUGHT {"isASE":true,"agent":"claude","kind":"exit_code"}/);
        assert.doesNotMatch(result.stdout, /^returned$/m);
        assert.equal(fs.existsSync(path.join(tasksRoot, taskId, 'done.md')), false);
        const incomplete = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as StatusJson;
        assert.equal(incomplete.phases.qa?.status, 'in_progress');
    });
});

void test('agent park boundary propagates non-agent errors and parks typed failures only', () => {
    withTempDir('agent-park-boundary-', dir => {
        for (const typed of [false, true]) {
            const taskId = typed ? 'typed-error' : 'plain-error';
            const tasksRoot = path.join(dir, 'tasks');
            const status = makeReviewLoopStatus(taskId, 'code_review', 0) as unknown as StatusJson;
            status.phases.plan!.status = 'in_progress';
            writeTaskStatus(tasksRoot, taskId, status);
            const result = runNodeInline([
                "import { registerExitHandlers } from './src/orchestrator/cli.js';",
                "import { withAgentSessionPark } from './src/orchestrator/main.ts';",
                "import { AgentSessionError } from './src/orchestrator/agents/errors.js';",
                'registerExitHandlers();',
                `void withAgentSessionPark('plan', [${JSON.stringify(taskId)}], async () => {`,
                typed
                    ? "throw new AgentSessionError({ agent: 'claude', kind: 'exit_code', exitCode: 1, reason: 'claude session exited 1' });"
                    : "throw new Error('plain boom');",
                '});',
            ].join('\n'), { ...process.env, CANON_TASKS_DIR_OVERRIDE: tasksRoot });
            assert.equal(result.status, typed ? 2 : 1, combinedOutput(result));
            const after = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as StatusJson;
            assert.equal(after.phases.plan?.status, typed ? 'blocked' : 'in_progress');
            assert.equal(after.escalations?.length, typed ? 1 : 0);
            if (!typed) {
                assert.match(result.stderr, /reason=unhandled rejection: plain boom/);
                assert.doesNotMatch(result.stdout, /AGENT SESSION FAILED/);
            }
        }
    });
});

void test('agent failure park writes task status only in its active worktree', () => {
    withTempDir('agent-park-worktree-', dir => {
        const taskId = 'worktree-park';
        const { localDir, worktreeDir } = makeBootstrappedTaskWorktreeFixture(dir, taskId);
        const mainPath = path.join(localDir, 'tasks', taskId, 'status.json');
        const worktreeStatusPath = path.join(worktreeDir, 'tasks', taskId, 'status.json');
        const before = fs.readFileSync(mainPath, 'utf8');
        const mainHref = pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href;
        const errorsHref = pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/agents/errors.ts')).href;
        const result = runNodeInline([
            `import { withAgentSessionPark } from ${JSON.stringify(mainHref)};`,
            `import { AgentSessionError } from ${JSON.stringify(errorsHref)};`,
            `await withAgentSessionPark('implement', [${JSON.stringify(taskId)}], async () => {`,
            "throw new AgentSessionError({ agent: 'codex', kind: 'stalled', reason: 'codex session stalled' });",
            '});',
        ].join('\n'), { ...process.env, CANON_WORKTREES_ROOT: path.join(localDir, '.canon', 'worktrees') }, localDir);
        assert.equal(result.status, 2, combinedOutput(result));
        assert.equal(fs.readFileSync(mainPath, 'utf8'), before);
        const parked = JSON.parse(fs.readFileSync(worktreeStatusPath, 'utf8')) as StatusJson;
        assert.equal(parked.phases.implement?.status, 'blocked');
        assert.equal(parked.escalations?.at(-1)?.phase, 'implement');
    });
});

void test('role routing red-first: empty agent retries the implementer session', () => {
    withTempDir('role-retry-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'empty-agent';
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', 0);
        const status = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as StatusJson;
        status.phases.implement!.agent = '';
        status.sessions = { implementer: 'stored-implementer' };
        writeTaskStatus(tasksRoot, taskId, status);
        const bins = path.join(dir, 'bins');
        fs.mkdirSync(bins);
        setupInvocationLoggingCliTools(bins);
        const result = runNodeInline([
            `import { retryAgentForPhase } from ${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)};`,
            `console.log('RETRY=' + await retryAgentForPhase('${taskId}', 'implement', 'fixture'));`,
        ].join('\n'), { ...process.env, PATH: `${bins}${path.delimiter}${process.env.PATH ?? ''}`, CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_AGENT_LOG: path.join(dir, 'agents.log') }, localDir);
        assert.equal(result.status, 0, combinedOutput(result));
        assert.match(result.stdout, /RETRY=drift/);
        assert.equal(fs.readFileSync(path.join(dir, 'agents.log'), 'utf8').trim(), 'codex');
    });
});

void test('role routing red-first: empty agent spec stores author and records backend', () => {
    withTempDir('role-storage-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'empty-spec';
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'spec_review', 0);
        const status = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as StatusJson;
        status.phases.spec!.agent = '';
        writeTaskStatus(tasksRoot, taskId, status);
        const bins = path.join(dir, 'bins');
        fs.mkdirSync(bins);
        setupInvocationLoggingCliTools(bins);
        const result = runReviewLoopMain(localDir, tasksRoot, bins, taskId, 3, [], {
            FAKE_AGENT_COMPLETE_PHASE: 'spec', FAKE_CLAUDE_SESSION_ID: 'new-author-session',
        });
        assert.equal(result.status, 0, combinedOutput(result));
        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as { sessions?: Record<string, string>; phases: Record<string, { agent: string }> };
        assert.equal(updated.sessions?.author, 'new-author-session');
        assert.equal(updated.phases.spec.agent, 'claude');
    });
});

void test('role routing red-first: QA salvages result-event text', () => {
    withTempDir('role-qa-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'qa-text';
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', 0, 0, true);
        const status = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as StatusJson;
        status.phases.code_review!.status = 'done';
        writeTaskStatus(tasksRoot, taskId, status);
        const bins = path.join(dir, 'bins');
        fs.mkdirSync(bins);
        const body = '# QA Summary\n\nAll checks passed.\n';
        writeExecutable(bins, 'claude', [`printf '%s\\n' '${JSON.stringify({ type: 'result', result: body, session_id: 'qa-session' })}'`]);
        const result = runNodeInline([
            `import { buildPipelineState } from ${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)};`,
            `import { runQaPhase } from ${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/phases/qa.ts')).href)};`,
            `await runQaPhase(buildPipelineState(['${taskId}']), false, null);`,
        ].join('\n'), { ...process.env, PATH: `${bins}${path.delimiter}${process.env.PATH ?? ''}`, CANON_TASKS_DIR_OVERRIDE: tasksRoot }, localDir);
        assert.equal(result.status, 0, combinedOutput(result));
        assert.equal(fs.existsSync(path.join(tasksRoot, taskId, 'done.md')), true);
        assert.equal(fs.readFileSync(path.join(tasksRoot, taskId, 'done.md'), 'utf8').trim(), body.trim());
    });
});

void test('QA salvage keeps a qa phase the session blocked', () => {
    withTempDir('role-qa-blocked-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'qa-blocked';
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', 0, 0, true);
        const status = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as StatusJson;
        status.phases.code_review!.status = 'done';
        writeTaskStatus(tasksRoot, taskId, status);
        const bins = path.join(dir, 'bins');
        fs.mkdirSync(bins);
        const statusPath = path.join(tasksRoot, taskId, 'status.json');
        const body = '# QA Summary\n\nBlocked on a missing fixture.\n';
        // The fake QA session blocks its own phase, then replies with a summary but leaves done.md as the template.
        writeExecutable(bins, 'claude', [
            `node -e 'const fs=require("fs");const p=process.argv[1];const s=JSON.parse(fs.readFileSync(p,"utf8"));s.phases.qa.status="blocked";fs.writeFileSync(p,JSON.stringify(s,null,2))' '${statusPath}'`,
            `printf '%s\\n' '${JSON.stringify({ type: 'result', result: body, session_id: 'qa-session' })}'`,
        ]);
        const result = runNodeInline([
            `import { buildPipelineState } from ${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)};`,
            `import { runQaPhase } from ${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/phases/qa.ts')).href)};`,
            `import { checkAndRoute } from ${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)};`,
            `await runQaPhase(buildPipelineState(['${taskId}']), false, null);`,
            `await checkAndRoute('qa', ['${taskId}']);`,
        ].join('\n'), { ...process.env, PATH: `${bins}${path.delimiter}${process.env.PATH ?? ''}`, CANON_TASKS_DIR_OVERRIDE: tasksRoot }, localDir);
        // Routing stops on the block instead of recovering the salvaged done.md into qa done.
        assert.equal(result.status, 2, combinedOutput(result));
        assert.equal(fs.readFileSync(path.join(tasksRoot, taskId, 'done.md'), 'utf8').trim(), body.trim());
        const updated = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as StatusJson;
        assert.equal(updated.phases.qa?.status, 'blocked');
        assert.match(combinedOutput(result), /QA session marked qa blocked/);
    });
});

void test('checkAndRoute parks the whole QA bundle when one member blocked qa', () => {
    withTempDir('role-qa-bundle-blocked-', dir => {
        const { localDir } = makeGitFixture(dir);
        const ids = ['qa-done', 'qa-blocked'];
        let tasksRoot = '';
        for (const id of ids) {
            tasksRoot = writeReviewLoopFixture(localDir, id, 'code_review', 0, 0, true);
            const status = JSON.parse(fs.readFileSync(path.join(tasksRoot, id, 'status.json'), 'utf8')) as StatusJson;
            status.phases.code_review!.status = 'done';
            status.phases.qa = { status: id === 'qa-done' ? 'done' : 'blocked', agent: 'claude' };
            writeTaskStatus(tasksRoot, id, status);
        }
        const result = runNodeInline([
            `import { checkAndRoute } from ${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)};`,
            `await checkAndRoute('qa', ${JSON.stringify(ids)});`,
        ].join('\n'), { ...process.env, CANON_TASKS_DIR_OVERRIDE: tasksRoot }, localDir);
        assert.equal(result.status, 2, combinedOutput(result));
        // Both members sit at qa blocked, so `canon run qa-done qa-blocked` passes the same-phase check.
        for (const id of ids) {
            const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, id, 'status.json'), 'utf8')) as StatusJson;
            assert.equal(updated.phases.qa?.status, 'blocked', id);
            assert.equal(updated.escalations?.at(-1)?.phase, 'qa', id);
        }
    });
});

for (const row of [
    { phase: 'spec', mode: 'fresh' }, { phase: 'spec', mode: 'revision' },
    { phase: 'spec_review', mode: 'fresh' }, { phase: 'spec_review', mode: 'resume' },
    { phase: 'plan', mode: 'fresh' },
    { phase: 'implement', mode: 'fresh' }, { phase: 'implement', mode: 'resume' }, { phase: 'implement', mode: 'reroute' },
    { phase: 'qa', mode: 'fresh' },
] as const) {
    void test(`phase invocation parity: ${row.phase} ${row.mode}`, () => {
        withTempDir('role-phase-parity-', dir => {
            const taskId = 'parity';
            const fixture = prepareReviewEntryMainFixture(dir, taskId, true, false);
            const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
            status.task_size = 'L'; status.delicate = false;
            status.phases.code_review!.status = row.phase === 'qa' ? 'done' : 'pending';
            status.phases.spec_review!.verdict = row.mode === 'revision' ? 'changes_requested' : 'approved';
            status.phases[row.phase]!.status = row.mode === 'resume' ? 'in_progress' : 'pending';
            if (row.mode === 'reroute') status.phases.implement!.rerouted = true;
            writeTaskStatus(fixture.tasksRoot, taskId, status);
            setupInvocationLoggingCliTools(fixture.fakeBins);
            const capture = path.join(dir, 'argv.jsonl');
            const env = { ...process.env, CANON_TASKS_DIR_OVERRIDE: fixture.tasksRoot,
                CANON_WORKTREES_ROOT: path.join(fixture.localDir, '.canon/worktrees'),
                PATH: `${fixture.fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
                FAKE_AGENT_LOG: path.join(dir, 'agents.log'), FAKE_AGENT_ARGV_LOG: capture,
            };
            for (const key of Object.keys(env)) if (/^(CANON_PROVIDER|CLAUDE_MODEL|CLAUDE_BUDGET|CODEX_MODEL|MAX_REVIEW_LOOPS)/.test(key)) delete env[key as keyof typeof env];
            const result = runNodeInline(String.raw`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPipelineState } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href}';
import { runSpecPhase } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/phases/spec.ts')).href}';
import { runPlanPhase } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/phases/plan.ts')).href}';
import { runSpecReviewPhase } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/phases/spec-review.ts')).href}';
import { runImplementPhase } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/phases/implement.ts')).href}';
import { runQaPhase, resolveQaDocsFreshness } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/phases/qa.ts')).href}';
import * as prompts from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/prompts/index.ts')).href}';
import { requireDocsFreshnessConfig } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/docs-freshness.ts')).href}';
import { getAffectedFiles } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/git.ts')).href}';
import { runClaude } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/agents/claude.ts')).href}';
import { runCodex } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/agents/codex.ts')).href}';
import { getClaudeConfig, getCodexConfig } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/policy.ts')).href}';
const phase = '${row.phase}', mode = '${row.mode}';
const state = buildPipelineState(['parity']);
const cwd = ${JSON.stringify(fixture.worktreeDir)};
const resume = ['resume','revision','reroute'].includes(mode) ? 'previous-session' : null;
const affected = getAffectedFiles('main',cwd).files;
let prompt;
if (phase === 'spec') prompt = mode === 'revision' ? prompts.promptSpecRevision(state,requireDocsFreshnessConfig(cwd)?.paths) : prompts.promptSpec(state,requireDocsFreshnessConfig(cwd)?.paths);
if (phase === 'plan') prompt = prompts.promptPlan(state);
if (phase === 'spec_review') prompt = (resume ? 'The spec has been revised since your last review. Re-read the current spec.md file from disk and produce a completely fresh review — do not replay or summarise your previous output.\n\n' : '') + prompts.promptSpecReview(state);
if (phase === 'implement') prompt = mode === 'reroute' ? prompts.promptImplementReroute(state,true,affected,'main') : mode === 'resume' ? prompts.promptImplementResume(state) : prompts.promptImplement(state,'fresh',affected,'main');
if (phase === 'qa') prompt = prompts.promptQa(state,null,resolveQaDocsFreshness(['parity'],cwd));
const handlers = {spec:runSpecPhase,plan:runPlanPhase,spec_review:runSpecReviewPhase,implement:runImplementPhase,qa:runQaPhase};
const actualResult = await handlers[phase](state,false,phase === 'qa' ? null : resume);
assert.equal(actualResult.agent, ['spec_review','implement'].includes(phase) ? 'codex' : 'claude');
const captured = () => fs.readFileSync(process.env.FAKE_AGENT_ARGV_LOG,'utf8').trim().split('\n').map(line=>JSON.parse(line));
const actual = captured()[0];
if (['spec_review','implement'].includes(phase)) {
    const cfg = getCodexConfig(phase,state.tasks);
    await runCodex(prompt,false,resume,cfg.model,cfg.effort,undefined,cwd,mode !== 'reroute');
} else {
    const cfg = getClaudeConfig(phase,state.tasks);
    await runClaude(prompt,false,resume,cfg.model,cfg.effort,cfg.budget,undefined,phase === 'spec' ? undefined : cwd);
}
assert.deepEqual(actual,captured()[1]);
`, env, fixture.localDir);
            assert.equal(result.status, 0, combinedOutput(result));
        });
    });
}

for (const provider of ['mixed', 'claude'] as const) {
void test(`implement hallucination clears only implementer pair on every bundle member (${provider})`, () => {
    withTempDir('role-hallucination-', dir => {
        const fixture = prepareReviewEntryMainFixture(dir, 'leader', true, false);
        const sessions = { author: 'a', claude_spec: 'la', spec_reviewer: 's', codex_spec_review: 'ls',
            implementer: 'i', codex: 'li', reviewer: 'r', claude_review: 'lr' };
        const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
        status.phases.code_review!.iterations_current_loop = 1;
        status.phases.code_review!.iterations = 1;
        status.phases.implement!.status = 'pending';
        status.sessions = sessions;
        status.provider = provider;
        status.session_backends = { implementer: provider === 'claude' ? 'claude' : 'codex' };
        for (const id of ['leader', 'secondary']) writeTaskStatus(fixture.tasksRoot, id, { ...status, id });
        fs.copyFileSync(path.join(fixture.tasksRoot, 'leader', 'spec.md'), path.join(fixture.tasksRoot, 'secondary', 'spec.md'));
        gitIn(fixture.worktreeDir, 'add', 'tasks');
        gitIn(fixture.worktreeDir, 'commit', '-m', 'clean revision fixture');
        const result = runNodeInline(String.raw`
import { buildPipelineState } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href}';
import { runImplementPhase } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/phases/implement.ts')).href}';
await runImplementPhase(buildPipelineState(['leader','secondary']),false,'i');
`, { ...process.env, CANON_TASKS_DIR_OVERRIDE: fixture.tasksRoot,
            CANON_WORKTREES_ROOT: path.join(fixture.localDir, '.canon/worktrees'),
            PATH: `${fixture.fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_AGENT_LOG: path.join(dir, 'agents.log'),
        }, fixture.localDir);
        assert.equal(result.status, 2, combinedOutput(result));
        assert.match(combinedOutput(result), /hallucination signature/);
        const expected: Record<string, string> = { ...sessions };
        delete expected.implementer; delete expected.codex;
        for (const id of ['leader','secondary']) {
            const after = JSON.parse(fs.readFileSync(path.join(fixture.tasksRoot, id, 'status.json'), 'utf8')) as StatusJson;
            assert.deepEqual(after.sessions, expected);
            assert.equal(after.session_backends?.implementer, undefined);
            assert.match(after.escalations?.at(-1)?.reason ?? '', new RegExp(provider === 'claude' ? 'Claude resumed-session' : 'Codex resumed-session'));
            assert.match(combinedOutput(result), new RegExp('Phase: implement \\(' + (provider === 'claude' ? 'Claude' : 'Codex')));
        }
    });
});

}

void test('recordPhaseAgent writes only the canonical worktree status', () => {
    withTempDir('role-record-worktree-', dir => {
        const fixture = prepareReviewEntryMainFixture(dir, 'agent-record', true, false);
        const mainStatus = path.join(fixture.localDir, 'tasks/agent-record/status.json');
        const before = fs.readFileSync(mainStatus, 'utf8');
        const env: NodeJS.ProcessEnv = { ...process.env, CANON_WORKTREES_ROOT: path.join(fixture.localDir, '.canon/worktrees') };
        delete env.CANON_TASKS_DIR_OVERRIDE;
        const result = runNodeInline(`
import { recordPhaseAgent } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/state.ts')).href}';
recordPhaseAgent(['agent-record'],'spec','codex');
`, env, fixture.localDir);
        assert.equal(result.status, 0, combinedOutput(result));
        assert.equal(fs.readFileSync(mainStatus, 'utf8'), before);
        const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
        assert.equal(status.phases.spec?.agent, 'codex');
    });
});

for (const phase of ['implement', 'code_review'] as const) {
    void test(`retry invocation parity: ${phase} ignores empty agent and uses retry cwd`, () => {
        withTempDir('role-retry-parity-', dir => {
            const fixture = prepareReviewEntryMainFixture(dir, 'retry-parity', true, false);
            const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
            status.phases[phase]!.agent = '';
            status.phases[phase]!.status = 'in_progress';
            status.sessions = { implementer: 'implement-session', reviewer: 'review-session' };
            writeTaskStatus(fixture.tasksRoot, 'retry-parity', status);
            setupInvocationLoggingCliTools(fixture.fakeBins);
            const log = path.join(dir, 'argv.jsonl');
            const result = runNodeInline(String.raw`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { retryAgentForPhase } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href}';
import { runClaude } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/agents/claude.ts')).href}';
import { runCodex } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/agents/codex.ts')).href}';
import { getClaudeConfig, getCodexConfig } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/policy.ts')).href}';
const phase = '${phase}';
assert.equal(await retryAgentForPhase('retry-parity',phase,'fixture evidence'),'drift');
const prompt = [
    "PIPELINE GUARDRAIL: phases."+phase+".status for task retry-parity is still 'in_progress'.",
    'Evidence check: fixture evidence.', '',
    'Your previous turn ended without completing the phase. Finish the work now (write the artifact if missing, commit if needed), then run:',
    '  canon task phase retry-parity '+phase+' done'+(phase === 'code_review' ? ' <verdict>' : ''), '',
    'Reply with tool calls only. No summary, no explanation.',
].join('\n');
const tasks = [{status: ${JSON.stringify(status)}}];
const cwd = ${JSON.stringify(fixture.worktreeDir)};
if (phase === 'implement') {
    const cfg = getCodexConfig(phase,tasks);
    await runCodex(prompt,false,'implement-session',cfg.model,cfg.effort,undefined,cwd);
} else {
    const cfg = getClaudeConfig(phase,tasks);
    await runClaude(prompt,false,'review-session',cfg.model,cfg.effort,cfg.budget,undefined,cwd);
}
const entries = fs.readFileSync(process.env.FAKE_AGENT_ARGV_LOG,'utf8').trim().split('\n').map(line=>JSON.parse(line));
assert.equal(entries.length,2);
assert.deepEqual(entries[0],entries[1]);
assert.equal(fs.existsSync(${JSON.stringify(path.join(fixture.tasksRoot, 'retry-parity/metrics.md'))}),false);
`, { ...process.env, PATH: `${fixture.fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
                CANON_TASKS_DIR_OVERRIDE: fixture.tasksRoot, CANON_WORKTREES_ROOT: path.join(fixture.localDir, '.canon/worktrees'),
                FAKE_AGENT_LOG: path.join(dir, 'agents.log'), FAKE_AGENT_ARGV_LOG: log,
            }, fixture.localDir);
            assert.equal(result.status, 0, combinedOutput(result));
        });
    });
}

for (const [phase, backend, slot] of [
    ['spec_review', 'codex', 'spec_reviewer'], ['plan', 'claude', null],
    ['implement', 'codex', 'implementer'], ['code_review', 'claude', 'reviewer'], ['qa', 'claude', null],
] as const) {
    void test(`main role record and session storage: ${phase}`, () => {
        withTempDir('role-main-storage-', dir => {
            const fixture = prepareReviewEntryMainFixture(dir, 'storage', true, false);
            const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
            const phases = ['spec', 'spec_review', 'plan', 'implement', 'code_review', 'qa', 'human_review'] as const;
            for (const entry of phases) {
                status.phases[entry]!.status = phases.indexOf(entry) < phases.indexOf(phase) ? 'done' : 'pending';
            }
            status.phases[phase]!.agent = '';
            status.sessions = { author: 'keep-author', claude_spec: 'legacy-author',
                codex_spec_review: 'legacy-spec', codex: 'legacy-implement', claude_review: 'legacy-review' };
            writeTaskStatus(fixture.tasksRoot, 'storage', status);
            fs.writeFileSync(path.join(fixture.tasksRoot, 'storage/plan.md'), '# Implementation Plan\n\nImplement the fixture.\n');
            setupInvocationLoggingCliTools(fixture.fakeBins);
            const codexPath = path.join(fixture.fakeBins, 'codex');
            const codexScript = fs.readFileSync(codexPath, 'utf8');
            fs.writeFileSync(codexPath, codexScript.replace(/\nexit 0\n$/, `\nnode -e 'console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"clean review"}}));console.log(JSON.stringify({type:"turn.completed"}))'\nexit 0\n`));
            const result = runReviewLoopMain(fixture.localDir, fixture.tasksRoot, fixture.fakeBins, 'storage', 3, [], {
                CANON_WORKTREES_ROOT: path.join(fixture.localDir, '.canon/worktrees'),
                FAKE_AGENT_COMPLETE_PHASE: phase, FAKE_CODEX_THREAD_ID: 'new-session', FAKE_CLAUDE_SESSION_ID: 'new-session',
            });
            assert.equal(result.status, 0, combinedOutput(result));
            const after = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
            assert.equal(after.phases[phase]?.agent, backend);
            const expected = { ...status.sessions, ...(slot ? { [slot]: 'new-session' } : {}) };
            assert.deepEqual(after.sessions, expected);
        });
    });
}

for (const agent of ['', 'codex']) {
    void test(`legacy retry isolates empty agent: ${agent || 'empty'}`, () => {
        withTempDir('role-legacy-retry-', dir => {
            const { localDir } = makeGitFixture(dir);
            const taskId = 'legacy-empty-agent';
            const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', 0);
            const status = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as StatusJson;
            status.phases.implement!.agent = agent;
            status.sessions = { codex: 'legacy-implement-session' };
            writeTaskStatus(tasksRoot, taskId, status);
            const bins = path.join(dir, 'bins');
            fs.mkdirSync(bins);
            setupInvocationLoggingCliTools(bins);
            const log = path.join(dir, 'argv.jsonl');
            const result = runNodeInline([
                `import { retryAgentForPhase } from ${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)};`,
                `console.log('RETRY=' + await retryAgentForPhase('${taskId}', 'implement', 'fixture'));`,
            ].join('\n'), { ...process.env, PATH: `${bins}${path.delimiter}${process.env.PATH ?? ''}`, CANON_TASKS_DIR_OVERRIDE: tasksRoot,
                FAKE_AGENT_LOG: path.join(dir, 'agents.log'), FAKE_AGENT_ARGV_LOG: log }, localDir);
            assert.equal(result.status, 0, combinedOutput(result));
            assert.match(result.stdout, /RETRY=drift/);
            const invocations = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { agent: string; argv: string[] });
            assert.equal(invocations.length, 1);
            assert.equal(invocations[0].agent, 'codex');
            assert.deepEqual(invocations[0].argv.slice(0, 3), ['exec', 'resume', 'legacy-implement-session']);
        });
    });
}
