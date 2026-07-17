import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findUntrackedClobberPaths, taskAccept, taskCmd, taskList, taskNew, taskPhase, taskPostMergeSync, taskResetCodeReview, taskResetSpecReview, taskSet, taskStatus } from '../src/task/index.js';
import type { StatusJson } from '../scripts/run-task/types.js';

const WORKSPACE_ROOT = process.cwd();
const TSX_LOADER = path.join(WORKSPACE_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');

function withTempDir<T>(prefix: string, fn: (dir: string) => T): T {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    try {
        return fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function withCwd<T>(cwd: string, fn: () => T): T {
    const previous = process.cwd();
    process.chdir(cwd);
    try {
        return fn();
    } finally {
        process.chdir(previous);
    }
}

function withEnv<T>(updates: Record<string, string | undefined>, fn: () => T): T {
    const previous = new Map<string, string | undefined>();
    for (const key of Object.keys(updates)) {
        previous.set(key, process.env[key]);
        const value = updates[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    try {
        return fn();
    } finally {
        for (const [key, value] of previous) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

function captureStdout(fn: () => void): string {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
        fn();
    } finally {
        console.log = original;
    }
    return `${lines.join('\n')}\n`;
}

function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeStatus(taskId: string, overrides: Partial<StatusJson> = {}): StatusJson {
    return {
        id: taskId,
        title: `Task ${taskId}`,
        status: 'spec',
        created: '2026-05-16',
        updated: '2026-05-16',
        branch: '',
        base_branch: 'main',
        task_size: 'S',
        delicate: false,
        human_spec_gate: false,
        full_send: false,
        worktree: false,
        phases: {
            spec: { status: 'pending', agent: 'claude' },
            spec_review: {
                status: 'pending',
                agent: 'codex',
                verdict: '',
                iterations: 0,
                iterations_current_loop: 0,
                iterations_total: 0,
                changes_requested_total: 0,
                auto_block_count: 0,
            },
            plan: { status: 'pending', agent: 'claude' },
            implement: { status: 'pending', agent: 'codex' },
            code_review: {
                status: 'pending',
                agent: 'claude',
                verdict: '',
                iterations: 0,
                iterations_current_loop: 0,
                iterations_total: 0,
                changes_requested_total: 0,
                auto_block_count: 0,
            },
            qa: { status: 'pending', agent: 'claude' },
            human_review: { status: 'pending', agent: 'human' },
        },
        escalations: [],
        sessions: {},
        ...overrides,
    };
}

function writeTask(tasksRoot: string, taskId: string, status: StatusJson = makeStatus(taskId)): string {
    const taskDir = path.join(tasksRoot, taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(taskDir, 'spec-review.md'), '# Review\n', 'utf8');
    return taskDir;
}

function readStatusFile(taskDir: string): StatusJson {
    return JSON.parse(fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8')) as StatusJson;
}

function withTasksRoot<T>(fn: (root: string) => T): T {
    return withTempDir('task-cli-', root => {
        const tasksRoot = path.join(root, 'tasks');
        fs.mkdirSync(tasksRoot, { recursive: true });
        return withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => fn(tasksRoot));
    });
}

void test('task new creates a task from templates and rejects existing tasks', () => {
    withTempDir('task-new-', root => {
        fs.mkdirSync(path.join(root, '.canon'), { recursive: true });
        fs.cpSync(path.join(WORKSPACE_ROOT, '.canon', 'templates'), path.join(root, '.canon', 'templates'), { recursive: true });

        withCwd(root, () => {
            captureStdout(() => taskNew(['new-task', 'New Task', '--base', 'dev']));
            const taskDir = path.join(root, 'tasks', 'new-task');
            const status = readStatusFile(taskDir);
            assert.equal(status.id, 'new-task');
            assert.equal(status.title, 'New Task');
            assert.equal(status.base_branch, 'dev');
            assert.equal(status.full_send, false);
            assert.ok(fs.existsSync(path.join(taskDir, 'spec.md')));
            assert.equal(fs.existsSync(path.join(root, 'dev-worktrees', 'new-task')), false);

            assert.throws(() => taskNew(['new-task', 'Again']), /Task directory tasks\/new-task already exists/);
        });
    });
});

void test('task new rejects invalid task IDs', () => {
    withTempDir('task-new-invalid-', root => {
        fs.mkdirSync(path.join(root, '.canon'), { recursive: true });
        fs.cpSync(path.join(WORKSPACE_ROOT, '.canon', 'templates'), path.join(root, '.canon', 'templates'), { recursive: true });
        withCwd(root, () => {
            assert.throws(() => taskNew(['Bad Task', 'Title']), /invalid task ID/);
        });
    });
});

void test('task list prints rows and handles an empty task directory', () => {
    withTasksRoot(tasksRoot => {
        assert.equal(captureStdout(() => taskList()), 'No tasks found.\n');
        writeTask(tasksRoot, 'alpha-task', makeStatus('alpha-task', { title: 'Alpha' }));
        writeTask(tasksRoot, 'beta-task', makeStatus('beta-task', {
            title: 'Beta',
            phases: {
                ...makeStatus('beta-task').phases,
                spec: { status: 'done', agent: 'claude' },
            },
        }));

        const output = captureStdout(() => taskList());
        assert.match(output, /TASK\s+TITLE\s+CURRENT PHASE/);
        assert.match(output, /alpha-task\s+Alpha\s+spec/);
        assert.match(output, /beta-task\s+Beta\s+spec_review/);
    });
});

void test('task list does not crash on non-canonical status.json (issue #83)', () => {
    withTasksRoot(tasksRoot => {
        // James's repro: status.json with no `phases` object at all.
        const badDir = path.join(tasksRoot, 'noncanonical');
        fs.mkdirSync(badDir);
        fs.writeFileSync(path.join(badDir, 'status.json'), JSON.stringify({
            id: 'noncanonical',
            title: 'Noncanonical status shape',
            status: 'paper_gate',
        }, null, 2));
        // A valid task alongside so we can confirm the listing isn't aborted by
        // the bad sibling.
        writeTask(tasksRoot, 'valid-task', makeStatus('valid-task', { title: 'Valid' }));

        const output = captureStdout(() => {
            assert.throws(() => taskList(), /1 task\(s\) had invalid status\.json/);
        });
        assert.match(output, /valid-task\s+Valid\s+spec/);
        assert.match(output, /noncanonical\s+\(invalid status\.json\)\s+INVALID:/);
    });
});

void test('task list renders INVALID row for orphan-worktree state (does not abort listing)', () => {
    // Orphan state: status.json says worktree:true with a branch, but
    // dev-worktrees/<id>/ is missing AND no checkout exists for the branch.
    // Pre-fix, taskDirForCwd → resolveTaskCwd would die(), aborting the
    // entire listing on the first orphan task (regression of issue #83 after
    // PR #104's worktree-canonical rewire).
    withTasksRoot(tasksRoot => {
        const worktreesRoot = path.join(path.dirname(tasksRoot), 'dev-worktrees');
        fs.mkdirSync(worktreesRoot, { recursive: true });
        writeTask(tasksRoot, 'orphan-task', makeStatus('orphan-task', {
            title: 'Orphan',
            worktree: true,
            branch: 'task/orphan-task-never-existed',
        }));
        writeTask(tasksRoot, 'healthy-task', makeStatus('healthy-task', { title: 'Healthy' }));

        withEnv({ CANON_WORKTREES_ROOT: worktreesRoot }, () => {
            const output = captureStdout(() => {
                assert.throws(() => taskList(), /1 task\(s\) had invalid status\.json/);
            });
            assert.match(output, /orphan-task\s+Orphan\s+INVALID: worktree missing/);
            assert.match(output, /healthy-task\s+Healthy\s+spec/);
        });
    });
});

void test('task list renders INVALID row for stale-worktree state (dir present, no status.json inside)', () => {
    // Stale state: dev-worktrees/<id>/ exists on disk but has no valid
    // `tasks/<id>/status.json` inside it (e.g., after a partial
    // `git worktree remove` that left the directory behind, or a manual rm
    // -rf of the inner files). resolveTaskCwd's `if (fs.existsSync(directStatus))
    // return directWorktree;` check fails, then it falls through to the
    // findExistingWorktreeForBranch lookup and die()s if no checkout exists.
    // The orphan detector must mirror that same usability test, not just
    // check fs.existsSync(directWorktree).
    withTasksRoot(tasksRoot => {
        const worktreesRoot = path.join(path.dirname(tasksRoot), 'dev-worktrees');
        fs.mkdirSync(worktreesRoot, { recursive: true });
        // Create the worktree directory but leave it empty (no nested
        // tasks/<id>/status.json — the file resolveTaskCwd actually checks).
        fs.mkdirSync(path.join(worktreesRoot, 'stale-task'), { recursive: true });
        writeTask(tasksRoot, 'stale-task', makeStatus('stale-task', {
            title: 'Stale',
            worktree: true,
            branch: 'task/stale-task-never-existed',
        }));
        writeTask(tasksRoot, 'healthy-task', makeStatus('healthy-task', { title: 'Healthy' }));

        withEnv({ CANON_WORKTREES_ROOT: worktreesRoot }, () => {
            const output = captureStdout(() => {
                assert.throws(() => taskList(), /1 task\(s\) had invalid status\.json/);
            });
            assert.match(output, /stale-task\s+Stale\s+INVALID: worktree missing/);
            assert.match(output, /healthy-task\s+Healthy\s+spec/);
        });
    });
});

void test('task status prints formatted JSON and errors for missing tasks', () => {
    withTasksRoot(tasksRoot => {
        writeTask(tasksRoot, 'status-task');
        const output = captureStdout(() => taskStatus('status-task'));
        assert.match(output, /"id": "status-task"/);
        assert.throws(() => taskStatus('missing-task'), /No status\.json found/);
    });
});

void test('task set updates task_size, re-derives status, and refreshes updated timestamp', () => {
    withTasksRoot(tasksRoot => {
        const taskDir = writeTask(tasksRoot, 'set-task');
        captureStdout(() => taskSet(['set-task', 'task_size', 'L']));
        const updated = readStatusFile(taskDir);
        assert.equal(updated.task_size, 'L');
        assert.equal(updated.status, 'spec');
        assert.equal(updated.updated, new Date().toISOString().slice(0, 10));
    });
});

void test('task set routes writes to the task worktree status.json', () => {
    withTempDir('task-set-worktree-routing-', root => {
        const repo = path.join(root, 'repo');
        const worktreesRoot = path.join(root, 'worktrees');
        const worktree = path.join(worktreesRoot, 'worktree-set');
        fs.mkdirSync(worktreesRoot, { recursive: true });
        git(root, ['init', '-b', 'main', repo]);
        git(repo, ['config', 'user.email', 'test@example.com']);
        git(repo, ['config', 'user.name', 'Test User']);
        fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n', 'utf8');
        git(repo, ['add', 'README.md']);
        git(repo, ['commit', '-m', 'init']);
        git(repo, ['worktree', 'add', '-b', 'task/worktree-set', worktree, 'main']);

        const mainTaskDir = path.join(repo, 'tasks', 'worktree-set');
        const worktreeTaskDir = path.join(worktree, 'tasks', 'worktree-set');
        fs.mkdirSync(mainTaskDir, { recursive: true });
        fs.mkdirSync(worktreeTaskDir, { recursive: true });
        fs.writeFileSync(path.join(mainTaskDir, 'status.json'), `${JSON.stringify(makeStatus('worktree-set', {
            branch: 'task/worktree-set',
            worktree: true,
            task_size: 'S',
        }), null, 2)}\n`, 'utf8');
        fs.writeFileSync(path.join(worktreeTaskDir, 'status.json'), `${JSON.stringify(makeStatus('worktree-set', {
            branch: 'task/worktree-set',
            worktree: true,
            task_size: 'M',
        }), null, 2)}\n`, 'utf8');

        withEnv({ CANON_WORKTREES_ROOT: worktreesRoot }, () => {
            withCwd(worktree, () => {
                captureStdout(() => taskSet(['worktree-set', 'task_size', 'XL']));
            });
        });

        const mainStatus = readStatusFile(mainTaskDir);
        const worktreeStatus = readStatusFile(worktreeTaskDir);
        assert.equal(mainStatus.task_size, 'S');
        assert.equal(worktreeStatus.task_size, 'XL');
        assert.equal(worktreeStatus.status, 'spec');
    });
});

void test('task set applies valid values across the settable fields', () => {
    withTasksRoot(tasksRoot => {
        const taskDir = writeTask(tasksRoot, 'set-valid', makeStatus('set-valid', {
            title: 'Before',
            task_size: 'S',
            delicate: false,
            worktree: false,
            base_branch: 'main',
        }));

        captureStdout(() => taskSet(['set-valid', 'title', 'After title']));
        captureStdout(() => taskSet(['set-valid', 'task_size', 'XL']));
        captureStdout(() => taskSet(['set-valid', 'delicate', 'TRUE']));
        captureStdout(() => taskSet(['set-valid', 'worktree', 'false']));
        captureStdout(() => taskSet(['set-valid', 'base_branch', 'feature/topic']));

        const updated = readStatusFile(taskDir);
        assert.equal(updated.title, 'After title');
        assert.equal(updated.task_size, 'XL');
        assert.equal(updated.delicate, true);
        assert.equal(updated.worktree, false);
        assert.equal(updated.base_branch, 'feature/topic');
    });
});

void test('task set rejects topology fields once a branch is recorded', () => {
    withTasksRoot(tasksRoot => {
        const taskId = 'set-topology-locked';
        const taskDir = writeTask(tasksRoot, taskId, makeStatus(taskId, {
            branch: 'task/set-topology-locked',
            title: 'Original',
            task_size: 'S',
            worktree: false,
            base_branch: 'main',
        }));
        const original = fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8');

        assert.throws(() => taskSet([taskId, 'worktree', 'true']), /worktree is locked once branch 'task\/set-topology-locked' is recorded/);
        assert.throws(() => taskSet([taskId, 'base_branch', 'feature/topic']), /base_branch is locked once branch 'task\/set-topology-locked' is recorded/);

        assert.equal(fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8'), original);
    });
});

void test('task set rejects invalid field values without changing the file', () => {
    withTasksRoot(tasksRoot => {
        const taskId = 'set-invalid';
        const taskDir = writeTask(tasksRoot, taskId, makeStatus(taskId, {
            title: 'Original',
            task_size: 'M',
            delicate: false,
            worktree: true,
            base_branch: 'main',
        }));
        const original = fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8');

        assert.throws(() => taskSet([taskId, 'task_size', 'Medium']), /task_size.*XS, S, M, L, XL/);
        assert.throws(() => taskSet([taskId, 'delicate', 'yes']), /Must be true or false/);
        assert.throws(() => taskSet([taskId, 'worktree', '1']), /Must be true or false/);
        assert.throws(() => taskSet([taskId, 'base_branch', '']), /must not be empty or whitespace-only/);
        assert.throws(() => taskSet([taskId, 'base_branch', '   ']), /must not be empty or whitespace-only/);
        assert.throws(() => taskSet([taskId, 'base_branch', '-flaglike']), /looks like a flag/);
        assert.throws(() => taskSet([taskId, 'base_branch', 'foo bar']), /contains control chars, whitespace, or refspec separator/);
        assert.throws(() => taskSet([taskId, 'base_branch', 'foo:bar']), /contains control chars, whitespace, or refspec separator/);
        assert.throws(() => taskSet([taskId, 'title', 'line 1\nline 2']), /single-line/);

        assert.equal(fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8'), original);
    });
});

void test('task set rejects extra positional args (unquoted multi-word value) without changing the file', () => {
    withTasksRoot(tasksRoot => {
        const taskId = 'set-extra-args';
        const taskDir = writeTask(tasksRoot, taskId, makeStatus(taskId, { title: 'Original' }));
        const original = fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8');

        // `canon task set my-task title New title` would otherwise keep only "New"
        // and silently drop the rest while still rewriting status.json.
        assert.throws(() => taskSet([taskId, 'title', 'New', 'title']), /unexpected argument 'title'/);

        assert.equal(fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8'), original);
    });
});

void test('task set rejects guarded, redirected, immutable, and unknown fields with category-correct messages', () => {
    withTasksRoot(tasksRoot => {
        const taskId = 'set-categories';
        const taskDir = writeTask(tasksRoot, taskId);
        const original = fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8');

        assert.throws(() => taskSet([taskId, 'full_send', 'true']), /canon run --full-send/);
        assert.throws(() => taskSet([taskId, 'human_spec_gate', 'false']), /Re-run `canon run <id>`/);
        assert.throws(() => taskSet([taskId, 'status', 'done']), /canon task phase/);
        assert.throws(() => taskSet([taskId, 'branch', 'main']), /git identity/);
        assert.throws(() => taskSet([taskId, 'phases', '{}']), /canon task phase/);
        assert.throws(() => taskSet([taskId, 'sessions', '{}']), /reset-spec-review/);
        assert.throws(() => taskSet([taskId, 'canon', '{}']), /CANON_UPSTREAM_REPO/);
        assert.throws(() => taskSet([taskId, 'escalations', '[]']), /canon task accept/);
        assert.throws(() => taskSet([taskId, 'id', 'new-id']), /immutable \/ not editable/);
        assert.throws(() => taskSet([taskId, 'created', '2026-01-01']), /immutable \/ not editable/);
        assert.throws(() => taskSet([taskId, 'updated', '2026-01-01']), /immutable \/ not editable/);
        assert.throws(() => taskSet([taskId, '_inline_doc', 'x']), /immutable \/ not editable/);
        assert.throws(() => taskSet([taskId, 'nope', '1']), /Settable fields: title, task_size, delicate, worktree, base_branch/);

        assert.equal(fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8'), original);
    });
});

void test('task set warns only after a task has started', () => {
    withTasksRoot(tasksRoot => {
        const pendingId = 'set-pending';
        const pendingDir = writeTask(tasksRoot, pendingId, makeStatus(pendingId, {
            status: 'pending',
            phases: {
                spec: { status: 'pending', agent: 'claude' },
                spec_review: { status: 'pending', agent: 'codex', verdict: '', iterations: 0, iterations_current_loop: 0, iterations_total: 0, changes_requested_total: 0, auto_block_count: 0 },
                plan: { status: 'pending', agent: 'claude' },
                implement: { status: 'pending', agent: 'codex' },
                code_review: { status: 'pending', agent: 'claude', verdict: '', iterations: 0, iterations_current_loop: 0, iterations_total: 0, changes_requested_total: 0, auto_block_count: 0 },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
        }));
        const pendingOut = captureStdout(() => taskSet([pendingId, 'task_size', 'M']));
        assert.equal(pendingOut.includes('takes effect on the next canon run'), false);
        assert.equal(readStatusFile(pendingDir).task_size, 'M');

        const activeId = 'set-active';
        const activeDir = writeTask(tasksRoot, activeId, makeStatus(activeId, {
            branch: 'task/set-active',
            status: 'implement',
            phases: {
                ...makeStatus(activeId).phases,
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved', iterations: 0, iterations_current_loop: 0, iterations_total: 1, changes_requested_total: 0, auto_block_count: 0 },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'in_progress', agent: 'codex' },
            },
        }));
        const activeOut = captureStdout(() => taskSet([activeId, 'delicate', 'true']));
        assert.match(activeOut, /takes effect on the next canon run/);
        assert.equal(readStatusFile(activeDir).delicate, true);
    });
});

void test('task phase updates phase state and derives top-level status', () => {
    withTasksRoot(tasksRoot => {
        const taskDir = writeTask(tasksRoot, 'phase-task');
        captureStdout(() => taskPhase('phase-task', 'spec', 'done'));
        const updated = readStatusFile(taskDir);
        assert.equal(updated.phases.spec?.status, 'done');
        assert.equal(updated.status, 'spec_review');
    });
});

void test('task phase accepts spec_gap for code_review', () => {
    withTasksRoot(tasksRoot => {
        const taskId = 'phase-spec-gap';
        const taskDir = writeTask(tasksRoot, taskId, makeStatus(taskId, {
            phases: {
                ...makeStatus(taskId).phases,
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
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
                    preflight_rejections_current_loop: 1,
                    auto_block_count: 0,
                },
            },
        }));

        captureStdout(() => taskPhase(taskId, 'code_review', 'done', 'spec_gap'));

        const updated = readStatusFile(taskDir);
        assert.equal(updated.phases.code_review?.verdict, 'spec_gap');
        assert.equal(updated.phases.code_review?.iterations_total, 1);
        assert.equal(updated.phases.code_review?.iterations_current_loop, 0);
        assert.equal(updated.phases.code_review?.preflight_rejections_current_loop, 0);
        assert.equal(updated.status, 'qa');
    });
});

void test('task phase rejects spec_gap for spec_review (code_review-only verdict)', () => {
    withTasksRoot(tasksRoot => {
        const taskId = 'phase-spec-gap-reject';
        writeTask(tasksRoot, taskId, makeStatus(taskId, {
            phases: {
                ...makeStatus(taskId).phases,
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'in_progress', agent: 'codex', verdict: '' },
            },
        }));

        assert.throws(
            () => taskPhase(taskId, 'spec_review', 'done', 'spec_gap'),
            /spec_gap.*only valid for the code_review phase/,
        );
    });
});

void test('task phase rejects sanctioned verdict outside canon task accept', () => {
    withTasksRoot(tasksRoot => {
        const taskId = 'phase-sanctioned-reject';
        writeTask(tasksRoot, taskId, makeStatus(taskId, {
            phases: {
                ...makeStatus(taskId).phases,
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'done', agent: 'codex' },
                code_review: { status: 'pending', agent: 'claude', verdict: '' },
            },
        }));

        assert.throws(
            () => taskPhase(taskId, 'code_review', 'done', 'sanctioned'),
            /canon task accept <id> code_review --reason/,
        );
        assert.throws(
            () => taskPhase(taskId, 'plan', 'done', 'sanctioned'),
            /verdict is only valid for spec_review and code_review/,
        );
    });
});

void test('task phase clears stale verdict when resetting a review phase to pending', () => {
    withTasksRoot(tasksRoot => {
        // spec_review: stale 'approved' verdict should be cleared on reset to pending
        const taskId = 'phase-stale-verdict-spec';
        const taskDir = writeTask(tasksRoot, taskId, makeStatus(taskId, {
            phases: {
                ...makeStatus(taskId).phases,
                spec: { status: 'done', agent: 'claude' },
                spec_review: {
                    status: 'done',
                    agent: 'codex',
                    verdict: 'approved',
                    iterations: 1,
                    iterations_current_loop: 1,
                    iterations_total: 1,
                    changes_requested_total: 0,
                    auto_block_count: 0,
                },
            },
        }));

        captureStdout(() => taskPhase(taskId, 'spec_review', 'pending'));
        const updated = readStatusFile(taskDir);
        assert.equal(updated.phases.spec_review?.status, 'pending');
        assert.equal(updated.phases.spec_review?.verdict, '');

        // code_review: stale 'changes_requested' verdict should be cleared on reset to pending
        const taskId2 = 'phase-stale-verdict-cr';
        const taskDir2 = writeTask(tasksRoot, taskId2, makeStatus(taskId2, {
            phases: {
                ...makeStatus(taskId2).phases,
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved', iterations: 0, iterations_current_loop: 0, iterations_total: 1, changes_requested_total: 0, auto_block_count: 0 },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'done', agent: 'codex' },
                code_review: {
                    status: 'done',
                    agent: 'claude',
                    verdict: 'changes_requested',
                    iterations: 1,
                    iterations_current_loop: 1,
                    iterations_total: 1,
                    changes_requested_total: 1,
                    preflight_rejections_current_loop: 0,
                    auto_block_count: 0,
                },
            },
        }));

        captureStdout(() => taskPhase(taskId2, 'code_review', 'pending'));
        const updated2 = readStatusFile(taskDir2);
        assert.equal(updated2.phases.code_review?.status, 'pending');
        assert.equal(updated2.phases.code_review?.verdict, '');
    });
});

void test('task phase rejects invalid phase and out-of-order transitions', () => {
    withTasksRoot(tasksRoot => {
        writeTask(tasksRoot, 'phase-errors');
        assert.throws(() => taskPhase('phase-errors', 'bogus', 'done'), /invalid phase/);
        assert.throws(
            () => taskPhase('phase-errors', 'plan', 'done'),
            /prior phases not done: spec,spec_review/,
        );
    });
});

void test('taskCmd routes set to the handler', () => {
    withTasksRoot(tasksRoot => {
        const taskDir = writeTask(tasksRoot, 'set-dispatch');
        captureStdout(() => taskCmd(['set', 'set-dispatch', 'task_size', 'XS']));
        const updated = readStatusFile(taskDir);
        assert.equal(updated.task_size, 'XS');
    });
});

void test('task reset-spec-review archives prior review and resets loop-local fields', () => {
    withTasksRoot(tasksRoot => {
        const taskDir = writeTask(tasksRoot, 'reset-task', makeStatus('reset-task', {
            phases: {
                ...makeStatus('reset-task').phases,
                spec_review: {
                    status: 'blocked',
                    agent: 'codex',
                    verdict: 'changes_requested',
                    iterations: 2,
                    iterations_current_loop: 2,
                    iterations_total: 5,
                    changes_requested_total: 3,
                    auto_block_count: 1,
                },
            },
            sessions: { claude_spec: 'old-session' },
        }));

        captureStdout(() => taskResetSpecReview('reset-task'));
        const updated = readStatusFile(taskDir);
        assert.equal(updated.phases.spec?.status, 'done');
        assert.equal(updated.phases.spec_review?.status, 'pending');
        assert.equal(updated.phases.spec_review?.iterations, 0);
        assert.equal(updated.phases.spec_review?.iterations_current_loop, 0);
        assert.equal(updated.phases.spec_review?.iterations_total, 5);
        assert.equal(updated.sessions?.claude_spec, undefined);
        assert.equal(fs.existsSync(path.join(taskDir, 'spec-review-prior-1.md')), true);
        assert.throws(() => taskResetSpecReview('missing-reset'), /no status\.json/);
    });
});

void test('task reset-code-review archives prior review, resets loop-local fields incl. legacy iterations alias, and preserves iterations_total', () => {
    withTasksRoot(tasksRoot => {
        const taskDir = writeTask(tasksRoot, 'reset-cr-task', makeStatus('reset-cr-task', {
            status: 'code_review',
            phases: {
                ...makeStatus('reset-cr-task').phases,
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved', iterations: 0, iterations_current_loop: 0, iterations_total: 1, changes_requested_total: 0, auto_block_count: 0 },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'done', agent: 'codex' },
                code_review: {
                    status: 'blocked',
                    agent: 'claude',
                    verdict: 'changes_requested',
                    iterations: 4,
                    iterations_current_loop: 3,
                    iterations_total: 6,
                    changes_requested_total: 2,
                    preflight_rejections_current_loop: 2,
                    auto_block_count: 1,
                },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
            sessions: { claude_review: 'old-review-session' },
        }));
        fs.writeFileSync(path.join(taskDir, 'review.md'), '# Review\nold content\n', 'utf8');

        captureStdout(() => taskCmd(['reset-code-review', 'reset-cr-task']));
        const updated = readStatusFile(taskDir);
        assert.equal(updated.phases.code_review?.status, 'pending');
        assert.equal(updated.phases.code_review?.iterations, 0);
        assert.equal(updated.phases.code_review?.iterations_current_loop, 0);
        assert.equal(updated.phases.code_review?.iterations_total, 6);
        assert.equal(updated.phases.code_review?.preflight_rejections_current_loop, 0);
        assert.equal(updated.phases.code_review?.verdict, '');
        assert.equal(updated.status, 'code_review');
        assert.equal(updated.sessions?.claude_review, undefined);
        assert.equal(fs.existsSync(path.join(taskDir, 'review-prior-1.md')), true);
        assert.equal(fs.existsSync(path.join(taskDir, 'review.md')), false);
        assert.throws(() => taskResetCodeReview(''), /usage: canon task reset-code-review <TASK-ID>/);
        assert.throws(() => taskResetCodeReview('missing-reset-cr'), /no status\.json/);
    });
});

void test('task reset-code-review rejects non-code_review tasks', () => {
    withTasksRoot(tasksRoot => {
        const taskDir = writeTask(tasksRoot, 'reset-cr-wrong-phase', makeStatus('reset-cr-wrong-phase', {
            phases: {
                ...makeStatus('reset-cr-wrong-phase').phases,
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved', iterations: 0, iterations_current_loop: 0, iterations_total: 1, changes_requested_total: 0, auto_block_count: 0 },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'done', agent: 'codex' },
                code_review: { status: 'done', agent: 'claude', verdict: 'approved', iterations: 5, iterations_current_loop: 0, iterations_total: 5, changes_requested_total: 0, auto_block_count: 0 },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
        }));

        assert.throws(() => taskResetCodeReview('reset-cr-wrong-phase'), /only operates on tasks currently at code_review/);
        assert.equal(readStatusFile(taskDir).phases.code_review?.status, 'done');
    });
});

// ── canon task accept ────────────────────────────────────────────────────────

function setupAcceptRepo(): { root: string; work: string; tasksRoot: string; taskDir: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-accept-'));
    const work = path.join(root, 'work');
    git(root, ['init', '-b', 'main', work]);
    git(work, ['config', 'user.email', 'test@example.com']);
    git(work, ['config', 'user.name', 'Test User']);
    fs.writeFileSync(path.join(work, 'README.md'), '# base\n', 'utf8');
    git(work, ['add', '-A']);
    git(work, ['commit', '-m', 'init']);
    git(work, ['checkout', '-b', 'task/accept']);
    // tasks/ lives inside the work tree (the normal canon layout). The accept
    // command's dirty-tree guard exempts `tasks/<id>/` paths so its own
    // status.json/notes.md mutation doesn't trip the check.
    const tasksRoot = path.join(work, 'tasks');
    const taskDir = path.join(tasksRoot, 'accept-task');
    fs.mkdirSync(taskDir, { recursive: true });
    return { root, work, tasksRoot, taskDir };
}

function writeAcceptTaskStatus(taskDir: string, overrides: Partial<StatusJson> = {}): void {
    const status = makeStatus('accept-task', {
        base_branch: 'main',
        phases: {
            ...makeStatus('accept-task').phases,
            spec: { status: 'done', agent: 'claude' },
            spec_review: {
                status: 'done',
                agent: 'codex',
                verdict: 'approved',
                iterations: 0,
                iterations_current_loop: 0,
                iterations_total: 1,
                changes_requested_total: 0,
                auto_block_count: 0,
            },
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
                auto_block_count: 0,
            },
            qa: { status: 'pending', agent: 'claude' },
            human_review: { status: 'pending', agent: 'human' },
        },
        ...overrides,
    });
    fs.writeFileSync(path.join(taskDir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

void test('task accept marks implement done, sets operator_accepted, logs to notes.md', () => {
    const { root, work, tasksRoot, taskDir } = setupAcceptRepo();
    try {
        writeAcceptTaskStatus(taskDir);
        // Write a handoff that matches the work we're about to commit, then
        // land the commit on the task branch.
        fs.writeFileSync(path.join(taskDir, 'handoff.md'), [
            '# Implementation Handoff: accept-task',
            '',
            '## Changes',
            '',
            '| File | What Changed |',
            '|---|---|',
            '| `src.txt` | manual implement commit |',
            '',
        ].join('\n'), 'utf8');
        fs.writeFileSync(path.join(work, 'src.txt'), 'committed work\n', 'utf8');
        git(work, ['add', '-A']);
        git(work, ['commit', '-m', 'manual implement commit']);

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                captureStdout(() => taskAccept(['accept-task'], 'implement'));
                const updated = readStatusFile(taskDir);
                assert.equal(updated.phases.implement?.status, 'done');
                assert.equal(updated.phases.implement?.operator_accepted, true);
                assert.ok(updated.phases.implement?.operator_accepted_at);
                const notes = fs.readFileSync(path.join(taskDir, 'notes.md'), 'utf8');
                assert.match(notes, /Operator accepted implement phase/);
            });
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('task accept rejects unsupported phases', () => {
    withTasksRoot(tasksRoot => {
        writeTask(tasksRoot, 'accept-task');
        assert.throws(
            () => taskAccept(['accept-task'], 'plan'),
            /supports implement, spec_review, and code_review phases/,
        );
    });
});

void test('task accept refuses review phases with no recorded verdict unless forced', () => {
    const { root, work, tasksRoot, taskDir } = setupAcceptRepo();
    try {
        writeAcceptTaskStatus(taskDir, {
            status: 'code_review',
            phases: {
                ...makeStatus('accept-task').phases,
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
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
                    auto_block_count: 0,
                },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
        });
        const beforeCodeReview = fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8');

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                assert.throws(
                    () => taskAccept(['accept-task'], 'code_review', { reason: 'wrong task' }),
                    error => {
                        assert.ok(error instanceof Error);
                        assert.match(error.message, /accept-task/);
                        assert.match(error.message, /no review verdict exists/);
                        assert.match(error.message, /Run the review first, or pass --force/);
                        return true;
                    },
                );
            });
        });
        assert.equal(fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8'), beforeCodeReview);
        assert.equal(fs.existsSync(path.join(taskDir, 'notes.md')), false);

        writeAcceptTaskStatus(taskDir, {
            status: 'spec_review',
            phases: {
                ...makeStatus('accept-task').phases,
                spec: { status: 'done', agent: 'claude' },
                spec_review: {
                    status: 'blocked',
                    agent: 'codex',
                    verdict: '',
                    iterations: 0,
                    iterations_current_loop: 0,
                    iterations_total: 0,
                    changes_requested_total: 0,
                    auto_block_count: 1,
                },
                plan: { status: 'pending', agent: 'claude' },
            },
        });
        const beforeSpecReview = fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8');

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                assert.throws(
                    () => taskAccept(['accept-task'], 'spec_review', { reason: 'wrong task' }),
                    error => {
                        assert.ok(error instanceof Error);
                        assert.match(error.message, /accept-task/);
                        assert.match(error.message, /no review verdict exists/);
                        assert.match(error.message, /Run the review first, or pass --force/);
                        return true;
                    },
                );
                captureStdout(() => taskAccept(['accept-task'], 'spec_review', { reason: 'emergency override', force: true }));
            });
        });
        assert.notEqual(fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8'), beforeSpecReview);
        const forced = readStatusFile(taskDir);
        assert.equal(forced.status, 'plan');
        assert.equal(forced.phases.spec_review?.status, 'done');
        assert.equal(forced.phases.spec_review?.verdict, 'sanctioned');
        assert.match(fs.readFileSync(path.join(taskDir, 'notes.md'), 'utf8'), /emergency override/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('task accept review bundle refuses verdictless tasks before mutating any task', () => {
    const { root, work, tasksRoot, taskDir: taskDirA } = setupAcceptRepo();
    try {
        const taskDirB = path.join(tasksRoot, 'task-b');
        fs.mkdirSync(taskDirB, { recursive: true });
        writeAcceptTaskStatus(taskDirA, {
            status: 'code_review',
            phases: {
                ...makeStatus('accept-task').phases,
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'done', agent: 'codex' },
                code_review: {
                    status: 'blocked',
                    agent: 'claude',
                    verdict: '',
                    iterations: 0,
                    iterations_current_loop: 0,
                    iterations_total: 0,
                    changes_requested_total: 0,
                    auto_block_count: 1,
                },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
        });
        const statusB = readStatusFile(taskDirA);
        statusB.id = 'task-b';
        statusB.title = 'Task task-b';
        statusB.phases.code_review = {
            status: 'blocked',
            agent: 'claude',
            verdict: 'changes_requested',
            iterations: 1,
            iterations_current_loop: 1,
            iterations_total: 1,
            changes_requested_total: 1,
            auto_block_count: 1,
        };
        fs.writeFileSync(path.join(taskDirB, 'status.json'), `${JSON.stringify(statusB, null, 2)}\n`, 'utf8');
        const beforeA = fs.readFileSync(path.join(taskDirA, 'status.json'), 'utf8');
        const beforeB = fs.readFileSync(path.join(taskDirB, 'status.json'), 'utf8');

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                assert.throws(
                    () => taskAccept(['accept-task', 'task-b'], 'code_review', { reason: 'bundle override' }),
                    error => {
                        assert.ok(error instanceof Error);
                        assert.match(error.message, /accept-task/);
                        assert.doesNotMatch(error.message, /task-b/);
                        assert.match(error.message, /no review verdict exists/);
                        return true;
                    },
                );
            });
        });

        assert.equal(fs.readFileSync(path.join(taskDirA, 'status.json'), 'utf8'), beforeA);
        assert.equal(fs.readFileSync(path.join(taskDirB, 'status.json'), 'utf8'), beforeB);
        assert.equal(fs.existsSync(path.join(taskDirA, 'notes.md')), false);
        assert.equal(fs.existsSync(path.join(taskDirB, 'notes.md')), false);

        statusB.phases.spec_review = {
            status: 'blocked',
            agent: 'codex',
            verdict: 'changes_requested',
            iterations: 1,
            iterations_current_loop: 1,
            iterations_total: 1,
            changes_requested_total: 1,
            auto_block_count: 1,
        };
        statusB.phases.plan = { status: 'pending', agent: 'claude' };
        fs.writeFileSync(path.join(taskDirB, 'status.json'), `${JSON.stringify(statusB, null, 2)}\n`, 'utf8');
        writeAcceptTaskStatus(taskDirA, {
            status: 'spec_review',
            phases: {
                ...makeStatus('accept-task').phases,
                spec: { status: 'done', agent: 'claude' },
                spec_review: {
                    status: 'blocked',
                    agent: 'codex',
                    verdict: '',
                    iterations: 0,
                    iterations_current_loop: 0,
                    iterations_total: 0,
                    changes_requested_total: 0,
                    auto_block_count: 1,
                },
                plan: { status: 'pending', agent: 'claude' },
            },
        });
        const beforeSpecA = fs.readFileSync(path.join(taskDirA, 'status.json'), 'utf8');
        const beforeSpecB = fs.readFileSync(path.join(taskDirB, 'status.json'), 'utf8');

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                assert.throws(
                    () => taskAccept(['accept-task', 'task-b'], 'spec_review', { reason: 'bundle override' }),
                    error => {
                        assert.ok(error instanceof Error);
                        assert.match(error.message, /accept-task/);
                        assert.doesNotMatch(error.message, /task-b/);
                        assert.match(error.message, /no review verdict exists/);
                        return true;
                    },
                );
            });
        });
        assert.equal(fs.readFileSync(path.join(taskDirA, 'status.json'), 'utf8'), beforeSpecA);
        assert.equal(fs.readFileSync(path.join(taskDirB, 'status.json'), 'utf8'), beforeSpecB);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('task accept requires reason for review phases and sanctions code_review with audit trail', () => {
    const { root, work, tasksRoot, taskDir } = setupAcceptRepo();
    try {
        writeAcceptTaskStatus(taskDir, {
            status: 'code_review',
            phases: {
                ...makeStatus('accept-task').phases,
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'done', agent: 'codex', reroute_count: 4 },
                code_review: {
                    status: 'blocked',
                    agent: 'claude',
                    verdict: 'spec_gap',
                    iterations: 2,
                    iterations_current_loop: 2,
                    iterations_total: 2,
                    changes_requested_total: 0,
                    auto_block_count: 1,
                },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
            escalations: [{ date: '2026-06-08', phase: 'code_review', reason: 'spec_gap block' }],
        });
        fs.writeFileSync(path.join(taskDir, 'spec.md'), '# Spec\n\n## Design\n\nNo amendment.\n', 'utf8');
        const beforeSpec = fs.readFileSync(path.join(taskDir, 'spec.md'), 'utf8');

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                assert.throws(
                    () => taskAccept(['accept-task'], 'code_review'),
                    /--reason "<text>" is required/,
                );
                captureStdout(() => taskCmd(['accept', 'accept-task', 'code_review', '--reason', 'false positive with spaces']));
            });
        });

        const updated = readStatusFile(taskDir);
        assert.equal(updated.status, 'qa');
        assert.equal(updated.phases.code_review?.status, 'done');
        assert.equal(updated.phases.code_review?.verdict, 'sanctioned');
        assert.equal(updated.phases.code_review?.operator_accepted, true);
        assert.ok(updated.phases.code_review?.operator_accepted_at);
        assert.ok(updated.phases.code_review?.operator_accepted_sha);
        assert.equal(updated.phases.implement?.reroute_count, 4);
        assert.equal(fs.readFileSync(path.join(taskDir, 'spec.md'), 'utf8'), beforeSpec);
        assert.equal(updated.escalations?.length, 1);
        const notes = fs.readFileSync(path.join(taskDir, 'notes.md'), 'utf8');
        assert.match(notes, /Operator accepted code_review/);
        assert.match(notes, /false positive with spaces/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('task accept sanctions spec_review and advances to plan', () => {
    const { root, work, tasksRoot, taskDir } = setupAcceptRepo();
    try {
        writeAcceptTaskStatus(taskDir, {
            status: 'spec_review',
            phases: {
                ...makeStatus('accept-task').phases,
                spec: { status: 'done', agent: 'claude' },
                spec_review: {
                    status: 'done',
                    agent: 'codex',
                    verdict: 'changes_requested',
                    iterations: 1,
                    iterations_current_loop: 1,
                    iterations_total: 1,
                    changes_requested_total: 1,
                    auto_block_count: 0,
                },
                plan: { status: 'pending', agent: 'claude' },
            },
        });

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                assert.throws(
                    () => taskAccept(['accept-task'], 'spec_review'),
                    /--reason "<text>" is required/,
                );
                captureStdout(() => taskAccept(['accept-task'], 'spec_review', { reason: 'nit accepted' }));
            });
        });

        const updated = readStatusFile(taskDir);
        assert.equal(updated.status, 'plan');
        assert.equal(updated.phases.spec_review?.status, 'done');
        assert.equal(updated.phases.spec_review?.verdict, 'sanctioned');
        assert.equal(updated.phases.spec_review?.operator_accepted, true);
        assert.match(fs.readFileSync(path.join(taskDir, 'notes.md'), 'utf8'), /nit accepted/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('task accept review bundle sanctions non-advancing verdicts and preserves approvals', () => {
    const { root, work, tasksRoot, taskDir: taskDirA } = setupAcceptRepo();
    try {
        const taskDirB = path.join(tasksRoot, 'task-b');
        fs.mkdirSync(taskDirB, { recursive: true });
        writeAcceptTaskStatus(taskDirA, {
            status: 'code_review',
            phases: {
                ...makeStatus('accept-task').phases,
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'done', agent: 'codex' },
                code_review: { status: 'blocked', agent: 'claude', verdict: 'spec_gap', iterations: 1, iterations_current_loop: 1, iterations_total: 1, changes_requested_total: 0, auto_block_count: 1 },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
            escalations: [{ date: '2026-06-08', phase: 'code_review', reason: 'bundle blocked' }],
        });
        const statusB = readStatusFile(taskDirA);
        statusB.id = 'task-b';
        statusB.title = 'Task task-b';
        statusB.phases.code_review = { status: 'blocked', agent: 'claude', verdict: 'approved', iterations: 1, iterations_current_loop: 0, iterations_total: 1, changes_requested_total: 0, auto_block_count: 1 };
        fs.writeFileSync(path.join(taskDirB, 'status.json'), `${JSON.stringify(statusB, null, 2)}\n`, 'utf8');

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                captureStdout(() => taskAccept(['accept-task'], 'code_review', { reason: 'partial first' }));
                const partialB = readStatusFile(taskDirB);
                assert.equal(partialB.phases.code_review?.status, 'blocked');

                captureStdout(() => taskAccept(['accept-task', 'task-b'], 'code_review', { reason: 'bundle bless' }));
            });
        });

        const a = readStatusFile(taskDirA);
        const b = readStatusFile(taskDirB);
        assert.equal(a.status, 'qa');
        assert.equal(a.phases.code_review?.status, 'done');
        assert.equal(a.phases.code_review?.verdict, 'sanctioned');
        assert.equal(a.phases.code_review?.operator_accepted, true);
        assert.equal(a.escalations?.length, 1);
        assert.equal(b.status, 'qa');
        assert.equal(b.phases.code_review?.status, 'done');
        assert.equal(b.phases.code_review?.verdict, 'approved');
        assert.equal(b.phases.code_review?.operator_accepted, undefined);
        assert.match(fs.readFileSync(path.join(taskDirA, 'notes.md'), 'utf8'), /bundle bless/);
        assert.match(fs.readFileSync(path.join(taskDirB, 'notes.md'), 'utf8'), /advancing verdict preserved/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('task accept sanctions needs_re_review as an existing non-empty review verdict', () => {
    const { root, work, tasksRoot, taskDir } = setupAcceptRepo();
    try {
        writeAcceptTaskStatus(taskDir, {
            status: 'code_review',
            phases: {
                ...makeStatus('accept-task').phases,
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'done', agent: 'codex' },
                code_review: {
                    status: 'blocked',
                    agent: 'claude',
                    verdict: 'needs_re_review',
                    iterations: 1,
                    iterations_current_loop: 1,
                    iterations_total: 1,
                    changes_requested_total: 0,
                    auto_block_count: 1,
                },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
        });

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                captureStdout(() => taskAccept(['accept-task'], 'code_review', { reason: 'operator reviewed manually' }));
            });
        });

        const updated = readStatusFile(taskDir);
        assert.equal(updated.status, 'qa');
        assert.equal(updated.phases.code_review?.status, 'done');
        assert.equal(updated.phases.code_review?.verdict, 'sanctioned');
        assert.equal(updated.phases.code_review?.operator_accepted, true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('task accept refuses dirty working tree without --force', () => {
    const { root, work, tasksRoot, taskDir } = setupAcceptRepo();
    try {
        writeAcceptTaskStatus(taskDir);
        // Handoff covers src.txt; commit src.txt; then dirty src.txt to trip the guard.
        fs.writeFileSync(path.join(taskDir, 'handoff.md'), [
            '# Implementation Handoff: accept-task',
            '',
            '## Changes',
            '',
            '| File | What Changed |',
            '|---|---|',
            '| `src.txt` | implement |',
            '',
        ].join('\n'), 'utf8');
        fs.writeFileSync(path.join(work, 'src.txt'), 'committed\n', 'utf8');
        git(work, ['add', '-A']);
        git(work, ['commit', '-m', 'implement']);
        fs.writeFileSync(path.join(work, 'src.txt'), 'uncommitted change\n', 'utf8');

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                assert.throws(
                    () => taskAccept(['accept-task'], 'implement'),
                    /working tree is not clean/,
                );
                // --force bypasses the guard.
                captureStdout(() => taskAccept(['accept-task'], 'implement', { force: true }));
                const updated = readStatusFile(taskDir);
                assert.equal(updated.phases.implement?.operator_accepted, true);
            });
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('task accept refuses when handoff coverage does not match the diff', () => {
    const { root, work, tasksRoot, taskDir } = setupAcceptRepo();
    try {
        writeAcceptTaskStatus(taskDir);
        // Handoff lists src.txt, but the operator actually committed other.txt.
        fs.writeFileSync(path.join(taskDir, 'handoff.md'), [
            '# Implementation Handoff: accept-task',
            '',
            '## Changes',
            '',
            '| File | What Changed |',
            '|---|---|',
            '| `src.txt` | claimed by handoff but not in the diff |',
            '',
        ].join('\n'), 'utf8');
        fs.writeFileSync(path.join(work, 'other.txt'), 'work\n', 'utf8');
        git(work, ['add', '-A']);
        git(work, ['commit', '-m', 'implement']);

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                assert.throws(
                    () => taskAccept(['accept-task'], 'implement'),
                    /handoff\.md does not match `git diff/,
                );
                captureStdout(() => taskAccept(['accept-task'], 'implement', { force: true }));
                const updated = readStatusFile(taskDir);
                assert.equal(updated.phases.implement?.operator_accepted, true);
            });
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('task accept accepts a comma-separated multi-path Changes row', () => {
    const { root, work, tasksRoot, taskDir } = setupAcceptRepo();
    try {
        writeAcceptTaskStatus(taskDir);
        fs.writeFileSync(path.join(taskDir, 'handoff.md'), [
            '# Implementation Handoff: accept-task',
            '',
            '## Changes',
            '',
            '| File | What Changed |',
            '|---|---|',
            '| `src.txt`, `extra.txt` | grouped — tightly coupled |',
            '',
        ].join('\n'), 'utf8');
        fs.writeFileSync(path.join(work, 'src.txt'), 'work\n', 'utf8');
        fs.writeFileSync(path.join(work, 'extra.txt'), 'work\n', 'utf8');
        git(work, ['add', '-A']);
        git(work, ['commit', '-m', 'implement']);

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                assert.doesNotThrow(() => taskAccept(['accept-task'], 'implement'));
                const updated = readStatusFile(taskDir);
                assert.equal(updated.phases.implement?.operator_accepted, true);
            });
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('task accept refuses malformed handoff rows without --force', () => {
    const { root, work, tasksRoot, taskDir } = setupAcceptRepo();
    try {
        writeAcceptTaskStatus(taskDir);
        fs.writeFileSync(path.join(taskDir, 'handoff.md'), [
            '# Implementation Handoff: accept-task',
            '',
            '## Changes',
            '',
            '| File | What Changed |',
            '|---|---|',
            '| `src.txt` and then `extra.txt` | prose between tokens — malformed |',
            '',
        ].join('\n'), 'utf8');
        fs.writeFileSync(path.join(work, 'src.txt'), 'work\n', 'utf8');
        fs.writeFileSync(path.join(work, 'extra.txt'), 'work\n', 'utf8');
        git(work, ['add', '-A']);
        git(work, ['commit', '-m', 'implement']);

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                assert.throws(
                    () => taskAccept(['accept-task'], 'implement'),
                    /malformed Changes rows/,
                );
            });
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('task accept exempts gitignored handoff entries from the coverage check', () => {
    const { root, work, tasksRoot, taskDir } = setupAcceptRepo();
    try {
        // Move .gitignore onto main (before the task branch) so the only
        // diff on the task branch is the generator script. public/sitemap.xml
        // is ignored under that rule.
        git(work, ['checkout', 'main']);
        fs.writeFileSync(path.join(work, '.gitignore'), 'public/sitemap.xml\n', 'utf8');
        git(work, ['add', '-A']);
        git(work, ['commit', '-m', 'add gitignore']);
        git(work, ['checkout', 'task/accept']);
        git(work, ['merge', 'main', '--no-edit']);

        writeAcceptTaskStatus(taskDir);
        // public/sitemap.xml is gitignored — a regenerated build artifact.
        // Codex lists both the generator script (real change) and the artifact
        // (description of build output). Coverage check should ignore the
        // gitignored entry instead of failing on it.
        fs.mkdirSync(path.join(work, 'public'));
        fs.writeFileSync(path.join(work, 'public/sitemap.xml'), '<urlset/>\n', 'utf8');
        fs.writeFileSync(path.join(taskDir, 'handoff.md'), [
            '# Implementation Handoff: accept-task',
            '',
            '## Changes',
            '',
            '| File | What Changed |',
            '|---|---|',
            '| `scripts/generate-sitemap.ts` | regenerates sitemap |',
            '| `public/sitemap.xml` | regenerated output (gitignored) |',
            '',
        ].join('\n'), 'utf8');
        fs.mkdirSync(path.join(work, 'scripts'));
        fs.writeFileSync(path.join(work, 'scripts/generate-sitemap.ts'), 'export {};\n', 'utf8');
        git(work, ['add', '-A']);
        git(work, ['commit', '-m', 'add generator script']);

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                captureStdout(() => taskAccept(['accept-task'], 'implement'));
                const updated = readStatusFile(taskDir);
                assert.equal(updated.phases.implement?.operator_accepted, true);
            });
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('task accept rejects bundles mixing worktree and non-worktree tasks', () => {
    const { root, work, tasksRoot, taskDir: taskDirA } = setupAcceptRepo();
    try {
        const taskDirB = path.join(tasksRoot, 'task-b');
        fs.mkdirSync(taskDirB);
        writeAcceptTaskStatus(taskDirA);
        // Task B is declared as a worktree task (in-memory only — empty branch
        // makes resolveTaskCwd fall through to REPO_ROOT without dying on a
        // missing worktree, which is enough for the mixed-mode guard to fire).
        // Task A keeps worktree: false.
        const statusB = JSON.parse(fs.readFileSync(path.join(taskDirA, 'status.json'), 'utf8')) as StatusJson;
        statusB.id = 'task-b';
        statusB.worktree = true;
        statusB.branch = '';
        fs.writeFileSync(path.join(taskDirB, 'status.json'), `${JSON.stringify(statusB, null, 2)}\n`);

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                assert.throws(
                    () => taskAccept(['accept-task', 'task-b'], 'implement'),
                    /cannot mix worktree and non-worktree tasks/,
                );
            });
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('task accept handles bundle: unions handoffs across multiple tasks for coverage', () => {
    const { root, work, tasksRoot, taskDir: taskDirA } = setupAcceptRepo();
    try {
        const taskDirB = path.join(tasksRoot, 'task-b');
        fs.mkdirSync(taskDirB, { recursive: true });
        writeAcceptTaskStatus(taskDirA);
        // Re-use writeAcceptTaskStatus by writing the second task's status by hand
        // (the helper hardcodes the task ID).
        const statusB = JSON.parse(fs.readFileSync(path.join(taskDirA, 'status.json'), 'utf8')) as StatusJson;
        statusB.id = 'task-b';
        statusB.title = 'Task task-b';
        fs.writeFileSync(path.join(taskDirB, 'status.json'), `${JSON.stringify(statusB, null, 2)}\n`);

        // Each handoff lists only its own files. A single manual commit covers both.
        fs.writeFileSync(path.join(taskDirA, 'handoff.md'), [
            '# Implementation Handoff: accept-task',
            '', '## Changes', '',
            '| File | What Changed |',
            '|---|---|',
            '| `a.ts` | task A change |',
            '',
        ].join('\n'), 'utf8');
        fs.writeFileSync(path.join(taskDirB, 'handoff.md'), [
            '# Implementation Handoff: task-b',
            '', '## Changes', '',
            '| File | What Changed |',
            '|---|---|',
            '| `b.ts` | task B change |',
            '',
        ].join('\n'), 'utf8');
        fs.writeFileSync(path.join(work, 'a.ts'), 'A\n', 'utf8');
        fs.writeFileSync(path.join(work, 'b.ts'), 'B\n', 'utf8');
        git(work, ['add', '-A']);
        git(work, ['commit', '-m', 'bundle commit']);

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                // Single-task accept of task A would fail because b.ts is in the
                // diff but not in A's handoff — exercise that to anchor the fix.
                assert.throws(
                    () => taskAccept(['accept-task'], 'implement'),
                    /diff→handoff: b\.ts in diff but not in any bundle handoff/,
                );
                // Bundled accept succeeds: the union covers both files.
                captureStdout(() => taskAccept(['accept-task', 'task-b'], 'implement'));
                const a = JSON.parse(fs.readFileSync(path.join(taskDirA, 'status.json'), 'utf8')) as StatusJson;
                const b = JSON.parse(fs.readFileSync(path.join(taskDirB, 'status.json'), 'utf8')) as StatusJson;
                assert.equal(a.phases.implement?.operator_accepted, true);
                assert.equal(b.phases.implement?.operator_accepted, true);
                // Both tasks pin the same HEAD SHA so the orchestrator's
                // all-or-nothing skip stays symmetric.
                assert.equal(a.phases.implement?.operator_accepted_sha, b.phases.implement?.operator_accepted_sha);
            });
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('task accept records operator_accepted_sha so a later commit invalidates the skip', () => {
    const { root, work, tasksRoot, taskDir } = setupAcceptRepo();
    try {
        writeAcceptTaskStatus(taskDir);
        fs.writeFileSync(path.join(taskDir, 'handoff.md'), [
            '# Implementation Handoff: accept-task',
            '',
            '## Changes',
            '',
            '| File | What Changed |',
            '|---|---|',
            '| `src.txt` | implement |',
            '',
        ].join('\n'), 'utf8');
        fs.writeFileSync(path.join(work, 'src.txt'), 'work\n', 'utf8');
        git(work, ['add', '-A']);
        git(work, ['commit', '-m', 'implement']);
        const acceptedSha = git(work, ['rev-parse', 'HEAD']);

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                captureStdout(() => taskAccept(['accept-task'], 'implement'));
            });
        });

        const accepted = readStatusFile(taskDir);
        assert.equal(accepted.phases.implement?.operator_accepted, true);
        assert.equal(accepted.phases.implement?.operator_accepted_sha, acceptedSha);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('taskPhase clears operator_accepted when implement moves away from done', () => {
    withTasksRoot(tasksRoot => {
        const taskDir = writeTask(tasksRoot, 'phase-clear', makeStatus('phase-clear', {
            phases: {
                ...makeStatus('phase-clear').phases,
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
                plan: { status: 'done', agent: 'claude' },
                implement: {
                    status: 'done',
                    agent: 'codex',
                    operator_accepted: true,
                    operator_accepted_at: '2026-05-19',
                    operator_accepted_sha: 'deadbeef',
                },
            },
        }));
        captureStdout(() => taskPhase('phase-clear', 'implement', 'changes_requested'));
        const updated = readStatusFile(taskDir);
        assert.equal(updated.phases.implement?.status, 'changes_requested');
        assert.equal(updated.phases.implement?.operator_accepted, undefined);
        assert.equal(updated.phases.implement?.operator_accepted_sha, undefined);
        assert.equal(updated.phases.implement?.operator_accepted_at, undefined);
    });
});

void test('task accept refuses (does not silently demote) when HEAD cannot be read', () => {
    // If --force bypasses earlier guards but `git rev-parse HEAD` then fails,
    // earlier versions wrote operator_accepted_sha = '' and reported success.
    // The skip-time check correctly rejects empty SHAs so no harm done, but
    // the operator was misled into thinking auto-commit would be bypassed.
    // 1.3.0 throws loudly instead.
    const { root, work, tasksRoot, taskDir } = setupAcceptRepo();
    try {
        writeAcceptTaskStatus(taskDir);
        // Detach HEAD to an unborn-like state by removing it.
        fs.rmSync(path.join(work, '.git', 'HEAD'));

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                assert.throws(
                    () => taskAccept(['accept-task'], 'implement', { force: true }),
                    /failed to read HEAD|empty string/,
                );
                // Status untouched — accept did not partially mutate.
                const status = JSON.parse(fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8')) as StatusJson;
                assert.notEqual(status.phases.implement?.operator_accepted, true);
            });
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('task accept refuses when no work has landed (empty baseRef..HEAD)', () => {
    const { root, work, tasksRoot, taskDir } = setupAcceptRepo();
    try {
        writeAcceptTaskStatus(taskDir);
        // No commit on the task branch beyond the base — empty baseRef..HEAD.

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                assert.throws(
                    () => taskAccept(['accept-task'], 'implement'),
                    /no work has landed/,
                );
            });
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('task post-merge-sync rejects dirty tracked files when about to reset --hard', () => {
    // Set up: local main is ahead of origin/main but only with telemetry-only
    // commits (taskPostMergeSync's reset-to-origin path). Working tree has a
    // dirty TRACKED file. reset --hard would destroy it → refuse.
    withTempDir('post-merge-sync-dirty-', root => {
        const origin = path.join(root, 'origin.git');
        const work = path.join(root, 'work');
        git(root, ['init', '--bare', origin]);
        git(root, ['init', '-b', 'main', work]);
        git(work, ['config', 'user.email', 'test@example.com']);
        git(work, ['config', 'user.name', 'Test User']);
        // Initial commit on main + push to origin.
        fs.writeFileSync(path.join(work, 'src.txt'), 'original\n', 'utf8');
        fs.mkdirSync(path.join(work, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(work, 'docs', 'pipeline-invocations.md'), '# metrics\n', 'utf8');
        git(work, ['add', '-A']);
        git(work, ['commit', '-m', 'init']);
        git(work, ['remote', 'add', 'origin', origin]);
        git(work, ['push', '-u', 'origin', 'main']);
        // Telemetry-only commit ahead of origin (will be the "reset-able" diff).
        fs.appendFileSync(path.join(work, 'docs', 'pipeline-invocations.md'), 'row\n', 'utf8');
        git(work, ['add', '-A']);
        git(work, ['commit', '-m', 'telemetry']);
        // Now make src.txt dirty (tracked, modified, uncommitted).
        fs.writeFileSync(path.join(work, 'src.txt'), 'dirty\n', 'utf8');
        withCwd(work, () => {
            assert.throws(() => taskPostMergeSync(), /dirty tracked files/);
        });
    });
});

void test('findUntrackedClobberPaths: case A — exact path match', () => {
    const target = new Set(['src.txt', 'docs/a.md', 'lib/b.ts']);
    assert.deepEqual(findUntrackedClobberPaths([], target), []);
    assert.deepEqual(findUntrackedClobberPaths(['scratch.txt'], target), []);
    assert.deepEqual(findUntrackedClobberPaths(['src.txt'], target), ['src.txt']);
    assert.deepEqual(
        findUntrackedClobberPaths(['scratch.txt', 'src.txt', 'lib/b.ts', 'other.md'], target),
        ['src.txt', 'lib/b.ts'],
    );
});

void test('findUntrackedClobberPaths: case B — local dir under a target file path', () => {
    // Target tracks `foo` as a file. Local has untracked `foo/bar.txt`,
    // so `foo` is a directory locally. reset --hard wipes the directory
    // to write the file.
    const target = new Set(['foo', 'docs/a.md']);
    assert.deepEqual(findUntrackedClobberPaths(['foo/bar.txt'], target), ['foo/bar.txt']);
    assert.deepEqual(findUntrackedClobberPaths(['foo/bar/baz.txt'], target), ['foo/bar/baz.txt']);
    // Sanity: a sibling untracked file outside the colliding ancestor is fine.
    assert.deepEqual(findUntrackedClobberPaths(['other.txt'], target), []);
});

void test('findUntrackedClobberPaths: case C — local file at a target directory path', () => {
    // Target tracks `foo/bar.txt`. Local has untracked `foo` as a file.
    // reset --hard removes the file to create the directory.
    const target = new Set(['foo/bar.txt', 'foo/qux.txt', 'docs/a.md']);
    assert.deepEqual(findUntrackedClobberPaths(['foo'], target), ['foo']);
    // Untracked file at a path with NO target prefix → no conflict.
    assert.deepEqual(findUntrackedClobberPaths(['unrelated'], target), []);
});

void test('findUntrackedClobberPaths: multiple conflict modes in one call', () => {
    const target = new Set(['foo', 'src/main.ts', 'docs/a.md']);
    assert.deepEqual(
        findUntrackedClobberPaths(
            ['foo/bar.txt', 'src/main.ts', 'src', 'scratch.txt'],
            target,
        ),
        ['foo/bar.txt', 'src/main.ts', 'src'],
    );
});

void test('task post-merge-sync allows untracked files that do NOT conflict with the target tree', () => {
    // Untracked files survive reset --hard cleanly when their paths aren't in
    // the target tree. The GP report's `.gitignore`d scratch dir is a common
    // case — should not block post-merge-sync.
    withTempDir('post-merge-sync-untracked-safe-', root => {
        const origin = path.join(root, 'origin.git');
        const work = path.join(root, 'work');
        git(root, ['init', '--bare', origin]);
        git(root, ['init', '-b', 'main', work]);
        git(work, ['config', 'user.email', 'test@example.com']);
        git(work, ['config', 'user.name', 'Test User']);
        fs.writeFileSync(path.join(work, 'src.txt'), 'tracked\n', 'utf8');
        fs.mkdirSync(path.join(work, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(work, 'docs', 'pipeline-invocations.md'), '# metrics\n', 'utf8');
        git(work, ['add', '-A']);
        git(work, ['commit', '-m', 'init']);
        git(work, ['remote', 'add', 'origin', origin]);
        git(work, ['push', '-u', 'origin', 'main']);
        // Telemetry-only commit ahead.
        fs.appendFileSync(path.join(work, 'docs', 'pipeline-invocations.md'), 'row\n', 'utf8');
        git(work, ['add', '-A']);
        git(work, ['commit', '-m', 'telemetry']);
        // Untracked file at a path NOT in origin/main → safe to reset --hard.
        fs.writeFileSync(path.join(work, 'scratch-notes.txt'), 'my untracked notes\n', 'utf8');
        withCwd(work, () => {
            captureStdout(() => { taskPostMergeSync(); });
            // Verify reset --hard succeeded (HEAD is now at origin/main).
            assert.equal(git(work, ['rev-list', '--count', 'origin/main..HEAD']), '0');
            // Untracked file survives.
            assert.ok(fs.existsSync(path.join(work, 'scratch-notes.txt')));
        });
    });
});

void test('task post-merge-sync allows untracked files when in sync with origin', () => {
    // Untracked files survive `git reset --hard`, so post-merge-sync should
    // not refuse on their account. Set up: local == origin, untracked file
    // present → should succeed.
    withTempDir('post-merge-sync-untracked-', root => {
        const origin = path.join(root, 'origin.git');
        const work = path.join(root, 'work');
        git(root, ['init', '--bare', origin]);
        git(root, ['init', '-b', 'main', work]);
        git(work, ['config', 'user.email', 'test@example.com']);
        git(work, ['config', 'user.name', 'Test User']);
        fs.writeFileSync(path.join(work, 'src.txt'), 'original\n', 'utf8');
        git(work, ['add', '-A']);
        git(work, ['commit', '-m', 'init']);
        git(work, ['remote', 'add', 'origin', origin]);
        git(work, ['push', '-u', 'origin', 'main']);
        // Untracked file in the working tree.
        fs.writeFileSync(path.join(work, 'scratch.txt'), 'untracked\n', 'utf8');
        withCwd(work, () => {
            const out = captureStdout(() => { taskPostMergeSync(); });
            assert.match(out, /in sync with origin\/main/);
        });
    });
});

function runTaskCmd(cwd: string, args: string[], env: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
    const code = [
        `import(${JSON.stringify(path.join(WORKSPACE_ROOT, 'src/task/index.ts'))})`,
        `.then(m => m.taskCmd(${JSON.stringify(args)}))`,
        `.catch(err => { console.error(err instanceof Error ? err.message : String(err)); process.exit(1); });`,
    ].join('');
    const result = spawnSync(process.execPath, ['--import', TSX_LOADER, '-e', code], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, ...env },
    });
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

void test('task phase routes to the task worktree status.json', () => {
    withTempDir('task-worktree-routing-', root => {
        const repo = path.join(root, 'repo');
        const worktreesRoot = path.join(root, 'worktrees');
        const worktree = path.join(worktreesRoot, 'worktree-route');
        fs.mkdirSync(worktreesRoot, { recursive: true });
        git(root, ['init', '-b', 'main', repo]);
        git(repo, ['config', 'user.email', 'test@example.com']);
        git(repo, ['config', 'user.name', 'Test User']);
        fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n', 'utf8');
        git(repo, ['add', 'README.md']);
        git(repo, ['commit', '-m', 'init']);
        git(repo, ['worktree', 'add', '-b', 'task/worktree-route', worktree, 'main']);

        const mainTaskDir = path.join(repo, 'tasks', 'worktree-route');
        const worktreeTaskDir = path.join(worktree, 'tasks', 'worktree-route');
        fs.mkdirSync(mainTaskDir, { recursive: true });
        fs.mkdirSync(worktreeTaskDir, { recursive: true });
        fs.writeFileSync(path.join(mainTaskDir, 'status.json'), `${JSON.stringify(makeStatus('worktree-route', {
            branch: 'task/worktree-route',
            worktree: true,
        }), null, 2)}\n`, 'utf8');
        fs.writeFileSync(path.join(worktreeTaskDir, 'status.json'), `${JSON.stringify(makeStatus('worktree-route', {
            branch: 'task/worktree-route',
            worktree: true,
        }), null, 2)}\n`, 'utf8');

        const result = runTaskCmd(repo, ['phase', 'worktree-route', 'spec', 'done'], {
            CANON_WORKTREES_ROOT: worktreesRoot,
            CANON_SKIP_PHASE_GATE: '1',
        });
        assert.equal(result.status, 0, result.stderr);

        const mainStatus = readStatusFile(mainTaskDir);
        const worktreeStatus = readStatusFile(worktreeTaskDir);
        assert.equal(mainStatus.phases.spec?.status, 'pending');
        assert.equal(worktreeStatus.phases.spec?.status, 'done');
        assert.equal(worktreeStatus.status, 'spec_review');
    });
});

void test('task reset-code-review routes to the task worktree status.json', () => {
    withTempDir('task-worktree-reset-cr-', root => {
        const repo = path.join(root, 'repo');
        const worktreesRoot = path.join(root, 'worktrees');
        const worktree = path.join(worktreesRoot, 'worktree-reset-cr');
        fs.mkdirSync(worktreesRoot, { recursive: true });
        git(root, ['init', '-b', 'main', repo]);
        git(repo, ['config', 'user.email', 'test@example.com']);
        git(repo, ['config', 'user.name', 'Test User']);
        fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n', 'utf8');
        git(repo, ['add', 'README.md']);
        git(repo, ['commit', '-m', 'init']);
        git(repo, ['worktree', 'add', '-b', 'task/worktree-reset-cr', worktree, 'main']);

        const mainTaskDir = path.join(repo, 'tasks', 'worktree-reset-cr');
        const worktreeTaskDir = path.join(worktree, 'tasks', 'worktree-reset-cr');
        fs.mkdirSync(mainTaskDir, { recursive: true });
        fs.mkdirSync(worktreeTaskDir, { recursive: true });
        fs.writeFileSync(path.join(mainTaskDir, 'status.json'), `${JSON.stringify(makeStatus('worktree-reset-cr', {
            branch: 'task/worktree-reset-cr',
            worktree: true,
            status: 'code_review',
            phases: {
                ...makeStatus('worktree-reset-cr').phases,
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved', iterations: 0, iterations_current_loop: 0, iterations_total: 1, changes_requested_total: 0, auto_block_count: 0 },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'done', agent: 'codex' },
                code_review: {
                    status: 'blocked',
                    agent: 'claude',
                    verdict: 'changes_requested',
                    iterations: 3,
                    iterations_current_loop: 2,
                    iterations_total: 5,
                    changes_requested_total: 2,
                    preflight_rejections_current_loop: 1,
                    auto_block_count: 1,
                },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
        }), null, 2)}\n`, 'utf8');
        fs.writeFileSync(path.join(worktreeTaskDir, 'status.json'), `${JSON.stringify(makeStatus('worktree-reset-cr', {
            branch: 'task/worktree-reset-cr',
            worktree: true,
            status: 'code_review',
            phases: {
                ...makeStatus('worktree-reset-cr').phases,
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved', iterations: 0, iterations_current_loop: 0, iterations_total: 1, changes_requested_total: 0, auto_block_count: 0 },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'done', agent: 'codex' },
                code_review: {
                    status: 'blocked',
                    agent: 'claude',
                    verdict: 'changes_requested',
                    iterations: 3,
                    iterations_current_loop: 2,
                    iterations_total: 5,
                    changes_requested_total: 2,
                    preflight_rejections_current_loop: 1,
                    auto_block_count: 1,
                },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
            sessions: { claude_review: 'worktree-session' },
        }), null, 2)}\n`, 'utf8');
        fs.writeFileSync(path.join(worktreeTaskDir, 'review.md'), '# Review\nworktree\n', 'utf8');

        const result = runTaskCmd(repo, ['reset-code-review', 'worktree-reset-cr'], {
            CANON_WORKTREES_ROOT: worktreesRoot,
            CANON_SKIP_PHASE_GATE: '1',
        });
        assert.equal(result.status, 0, result.stderr);

        const mainStatus = readStatusFile(mainTaskDir);
        const worktreeStatus = readStatusFile(worktreeTaskDir);
        assert.equal(mainStatus.phases.code_review?.status, 'blocked');
        assert.equal(mainStatus.phases.code_review?.iterations_current_loop, 2);
        assert.equal(worktreeStatus.phases.code_review?.status, 'pending');
        assert.equal(worktreeStatus.phases.code_review?.iterations_current_loop, 0);
        assert.equal(worktreeStatus.phases.code_review?.preflight_rejections_current_loop, 0);
        assert.equal(worktreeStatus.sessions?.claude_review, undefined);
        assert.equal(fs.existsSync(path.join(worktreeTaskDir, 'review-prior-1.md')), true);
    });
});

void test('task status and list read task worktree status when present', () => {
    withTempDir('task-worktree-status-list-', root => {
        const repo = path.join(root, 'repo');
        const worktreesRoot = path.join(root, 'worktrees');
        const worktree = path.join(worktreesRoot, 'worktree-visible');
        fs.mkdirSync(worktreesRoot, { recursive: true });
        git(root, ['init', '-b', 'main', repo]);
        git(repo, ['config', 'user.email', 'test@example.com']);
        git(repo, ['config', 'user.name', 'Test User']);
        fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n', 'utf8');
        git(repo, ['add', 'README.md']);
        git(repo, ['commit', '-m', 'init']);
        git(repo, ['worktree', 'add', '-b', 'task/worktree-visible', worktree, 'main']);

        const mainTaskDir = path.join(repo, 'tasks', 'worktree-visible');
        const worktreeTaskDir = path.join(worktree, 'tasks', 'worktree-visible');
        fs.mkdirSync(mainTaskDir, { recursive: true });
        fs.mkdirSync(worktreeTaskDir, { recursive: true });
        fs.writeFileSync(path.join(mainTaskDir, 'status.json'), `${JSON.stringify(makeStatus('worktree-visible', {
            title: 'Main scaffold',
            branch: 'task/worktree-visible',
            worktree: true,
        }), null, 2)}\n`, 'utf8');
        fs.writeFileSync(path.join(worktreeTaskDir, 'status.json'), `${JSON.stringify(makeStatus('worktree-visible', {
            title: 'Live worktree',
            branch: 'task/worktree-visible',
            worktree: true,
            phases: {
                ...makeStatus('worktree-visible').phases,
                spec: { status: 'done', agent: 'claude' },
            },
        }), null, 2)}\n`, 'utf8');

        const rootOnlyDir = path.join(repo, 'tasks', 'root-only');
        fs.mkdirSync(rootOnlyDir, { recursive: true });
        fs.writeFileSync(path.join(rootOnlyDir, 'status.json'), `${JSON.stringify(makeStatus('root-only', {
            title: 'Root only',
        }), null, 2)}\n`, 'utf8');

        const env = { CANON_WORKTREES_ROOT: worktreesRoot };
        const statusResult = runTaskCmd(repo, ['status', 'worktree-visible'], env);
        assert.equal(statusResult.status, 0, statusResult.stderr);
        assert.match(statusResult.stdout, /"title": "Live worktree"/);
        assert.doesNotMatch(statusResult.stdout, /Main scaffold/);

        const listResult = runTaskCmd(repo, ['list'], env);
        assert.equal(listResult.status, 0, listResult.stderr);
        assert.match(listResult.stdout, /worktree-visible\s+Live worktree\s+spec_review/);
        assert.match(listResult.stdout, /root-only\s+Root only\s+spec/);
        assert.doesNotMatch(listResult.stdout, /Main scaffold/);
    });
});

void test('task accept routes writes to the task worktree status.json', () => {
    withTempDir('task-worktree-accept-', root => {
        const repo = path.join(root, 'repo');
        const worktreesRoot = path.join(root, 'worktrees');
        const worktree = path.join(worktreesRoot, 'worktree-accept');
        fs.mkdirSync(worktreesRoot, { recursive: true });
        git(root, ['init', '-b', 'main', repo]);
        git(repo, ['config', 'user.email', 'test@example.com']);
        git(repo, ['config', 'user.name', 'Test User']);
        fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n', 'utf8');
        git(repo, ['add', 'README.md']);
        git(repo, ['commit', '-m', 'init']);
        git(repo, ['worktree', 'add', '-b', 'task/worktree-accept', worktree, 'main']);

        const phases: StatusJson['phases'] = {
            ...makeStatus('worktree-accept').phases,
            spec: { status: 'done', agent: 'claude' },
            spec_review: {
                status: 'done',
                agent: 'codex',
                verdict: 'approved',
                iterations: 0,
                iterations_current_loop: 0,
                iterations_total: 0,
                changes_requested_total: 0,
                auto_block_count: 0,
            },
            plan: { status: 'done', agent: 'claude' },
            implement: { status: 'in_progress', agent: 'codex' },
        };
        const status = makeStatus('worktree-accept', {
            branch: 'task/worktree-accept',
            base_branch: 'main',
            worktree: true,
            phases,
        });
        const mainTaskDir = path.join(repo, 'tasks', 'worktree-accept');
        const worktreeTaskDir = path.join(worktree, 'tasks', 'worktree-accept');
        fs.mkdirSync(mainTaskDir, { recursive: true });
        fs.mkdirSync(worktreeTaskDir, { recursive: true });
        fs.writeFileSync(path.join(mainTaskDir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
        fs.writeFileSync(path.join(worktreeTaskDir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
        fs.writeFileSync(path.join(worktreeTaskDir, 'handoff.md'), [
            '# Implementation Handoff: worktree-accept',
            '',
            '## Changes',
            '',
            '| File | What Changed |',
            '|---|---|',
            '| `src.txt` | worktree implementation |',
            '',
        ].join('\n'), 'utf8');
        fs.writeFileSync(path.join(worktree, 'src.txt'), 'work\n', 'utf8');
        git(worktree, ['add', 'src.txt']);
        git(worktree, ['commit', '-m', 'implement work']);

        const result = runTaskCmd(repo, ['accept', 'worktree-accept', 'implement'], {
            CANON_WORKTREES_ROOT: worktreesRoot,
            CANON_SKIP_PHASE_GATE: '1',
        });
        assert.equal(result.status, 0, result.stderr);

        const mainStatus = readStatusFile(mainTaskDir);
        const worktreeStatus = readStatusFile(worktreeTaskDir);
        assert.equal(mainStatus.phases.implement?.status, 'in_progress');
        assert.equal(worktreeStatus.phases.implement?.status, 'done');
        assert.equal(worktreeStatus.phases.implement?.operator_accepted, true);
        assert.equal(fs.existsSync(path.join(mainTaskDir, 'notes.md')), false);
        assert.match(fs.readFileSync(path.join(worktreeTaskDir, 'notes.md'), 'utf8'), /Operator accepted implement phase/);
    });
});

const TELEMETRY_DOC_FILES = [
    'docs/pipeline-invocations.md',
    'docs/task-quality-log.md',
    'docs/lessons-learned.md',
] as const;

// Snapshot the telemetry docs' *contents* at module load — before any test in
// this file runs — so the assertion below flags writes the SUITE made, not
// pre-existing working-tree dirt (e.g. a real pipeline run appended rows to
// these docs before the suite started). Content comparison (not `git status`)
// is deliberate: porcelain status reports ` M file` regardless of how much
// changed, so it can't detect the suite appending to an already-modified file.
function snapshotTelemetryDocs(): Record<string, string | null> {
    const snapshot: Record<string, string | null> = {};
    for (const rel of TELEMETRY_DOC_FILES) {
        const abs = path.join(WORKSPACE_ROOT, rel);
        snapshot[rel] = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    }
    return snapshot;
}

const TELEMETRY_DOCS_BASELINE = snapshotTelemetryDocs();

void test('docs telemetry files stay clean after the suite', () => {
    const after = snapshotTelemetryDocs();
    for (const rel of TELEMETRY_DOC_FILES) {
        assert.equal(
            after[rel],
            TELEMETRY_DOCS_BASELINE[rel],
            `the test suite modified ${rel} — tests must not write to the real telemetry docs. ` +
            `(Compared against a pre-suite snapshot, so pre-existing working-tree changes are ignored; ` +
            `this fires only on changes introduced while the suite ran.)`,
        );
    }
});

void test('bundled orchestrator help is invocable once from dist', () => {
    const runTaskBundle = path.join(WORKSPACE_ROOT, 'dist', 'scripts', 'run-task.js');
    assert.equal(fs.existsSync(runTaskBundle), true, 'run npm run build before npm test so dist/scripts/run-task.js exists');
    const result = spawnSync(process.execPath, [runTaskBundle, '--help'], {
        cwd: WORKSPACE_ROOT,
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: canon run/);
});
