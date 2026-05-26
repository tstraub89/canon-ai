import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findUntrackedClobberPaths, taskAccept, taskList, taskNew, taskPhase, taskPostMergeSync, taskReleaseInit, taskResetSpecReview, taskStatus } from '../src/task/index.js';
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

type PackageJsonFixture = { version: string };
type PackageLockFixture = { version: string; packages: { '': { version: string } } };

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

void test('task phase updates phase state and derives top-level status', () => {
    withTasksRoot(tasksRoot => {
        const taskDir = writeTask(tasksRoot, 'phase-task');
        captureStdout(() => taskPhase('phase-task', 'spec', 'done'));
        const updated = readStatusFile(taskDir);
        assert.equal(updated.phases.spec?.status, 'done');
        assert.equal(updated.status, 'spec_review');
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

void test('task accept rejects non-implement phases', () => {
    withTasksRoot(tasksRoot => {
        writeTask(tasksRoot, 'accept-task');
        assert.throws(
            () => taskAccept(['accept-task'], 'code_review'),
            /only supports the implement phase/,
        );
    });
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
            '| `src.txt`, `extra.txt` | combined row — malformed |',
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

function setupReleaseRepo(): { root: string; work: string; origin: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-init-'));
    const origin = path.join(root, 'origin.git');
    const work = path.join(root, 'work');
    git(root, ['init', '--bare', origin]);
    git(root, ['init', '-b', 'main', work]);
    git(work, ['config', 'user.email', 'test@example.com']);
    git(work, ['config', 'user.name', 'Test User']);
    fs.writeFileSync(path.join(work, 'package.json'), `${JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(work, 'package-lock.json'), `${JSON.stringify({ name: 'fixture', version: '1.0.0', packages: { '': { version: '1.0.0' } } }, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(work, 'CHANGELOG.md'), '# Changelog\n', 'utf8');
    fs.mkdirSync(path.join(work, '.canon'), { recursive: true });
    fs.writeFileSync(path.join(work, '.canon/version'), '1.0.0\n', 'utf8');
    git(work, ['add', 'package.json', 'package-lock.json', 'CHANGELOG.md', '.canon/version']);
    git(work, ['commit', '-m', 'init']);
    git(work, ['remote', 'add', 'origin', origin]);
    git(work, ['push', '-u', 'origin', 'main']);
    return { root, work, origin };
}

void test('task release-init creates release branch, bumps files, commits, and uses injectable push', () => {
    const { root, work } = setupReleaseRepo();
    try {
        const pushed: string[] = [];
        withCwd(work, () => {
            captureStdout(() => taskReleaseInit('1.6.0', { pushFn: branch => { pushed.push(branch); } }));
            assert.equal(git(work, ['branch', '--show-current']), 'release/v1.6');
        });

        assert.deepEqual(pushed, ['release/v1.6']);
        const pkg = JSON.parse(fs.readFileSync(path.join(work, 'package.json'), 'utf8')) as PackageJsonFixture;
        const lock = JSON.parse(fs.readFileSync(path.join(work, 'package-lock.json'), 'utf8')) as PackageLockFixture;
        assert.equal(pkg.version, '1.6.0');
        assert.equal(lock.packages[''].version, '1.6.0');
        // CHANGELOG block must use bracketed full-semver + em-dash to match the
        // auto-release workflow's extraction regex (^## \[<version>\] — <date>)
        // and the canonical format every existing canon-ai CHANGELOG entry uses.
        const changelog = fs.readFileSync(path.join(work, 'CHANGELOG.md'), 'utf8');
        assert.match(changelog, /## \[1\.6\.0\] — unreleased/);
        // .canon/version must track package.json — the auto-release workflow
        // asserts they agree and dies otherwise.
        assert.equal(fs.readFileSync(path.join(work, '.canon/version'), 'utf8'), '1.6.0\n');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

void test('task release-init skips .canon/version when the file does not exist (adopter without .canon/ dir)', () => {
    // Some adopter installs may not have a .canon/ directory yet. The write
    // should be conditional — its absence is not an error.
    withTempDir('release-init-no-canon-version-', root => {
        const origin = path.join(root, 'origin.git');
        const work = path.join(root, 'work');
        git(root, ['init', '--bare', origin]);
        git(root, ['init', '-b', 'main', work]);
        git(work, ['config', 'user.email', 'test@example.com']);
        git(work, ['config', 'user.name', 'Test User']);
        fs.writeFileSync(path.join(work, 'package.json'), `${JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2)}\n`, 'utf8');
        fs.writeFileSync(path.join(work, 'CHANGELOG.md'), '# Changelog\n', 'utf8');
        git(work, ['add', 'package.json', 'CHANGELOG.md']);
        git(work, ['commit', '-m', 'init']);
        git(work, ['remote', 'add', 'origin', origin]);
        git(work, ['push', '-u', 'origin', 'main']);
        withCwd(work, () => {
            captureStdout(() => taskReleaseInit('1.6.0', { pushFn: () => undefined }));
        });
        // .canon/version still does not exist (we didn't create it).
        assert.equal(fs.existsSync(path.join(work, '.canon/version')), false);
        // package.json and CHANGELOG.md still bumped/updated.
        const pkg = JSON.parse(fs.readFileSync(path.join(work, 'package.json'), 'utf8')) as PackageJsonFixture;
        assert.equal(pkg.version, '1.6.0');
        assert.match(fs.readFileSync(path.join(work, 'CHANGELOG.md'), 'utf8'), /## \[1\.6\.0\] — unreleased/);
    });
});

void test('task release-init inserts new block after intro blockquote, before first existing version block', () => {
    // Regression for the 1.5.0 init bug: the new ## block was inserted
    // directly after the H1, pushing any intro blockquote (e.g.,
    // "> Format follows Keep a Changelog...") below the new entry.
    // The blockquote is file-level meta and belongs between the H1 and
    // the first version block.
    const { root, work } = setupReleaseRepo();
    try {
        const initialChangelog = [
            '# Changelog',
            '',
            '> Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). canon-ai uses SemVer per [`docs/decisions.md`](docs/decisions.md).',
            '',
            '## [1.0.0] — 2026-05-01',
            '',
            '- Initial release.',
            '',
        ].join('\n');
        fs.writeFileSync(path.join(work, 'CHANGELOG.md'), initialChangelog, 'utf8');
        git(work, ['add', 'CHANGELOG.md']);
        git(work, ['commit', '-m', 'changelog with intro blockquote']);
        withCwd(work, () => {
            captureStdout(() => taskReleaseInit('1.6.0', { pushFn: () => undefined }));
        });
        const result = fs.readFileSync(path.join(work, 'CHANGELOG.md'), 'utf8');
        // New block must appear AFTER the intro blockquote and BEFORE the
        // prior version block.
        const blockquoteIdx = result.indexOf('> Format follows');
        const newBlockIdx = result.indexOf('## [1.6.0] — unreleased');
        const priorBlockIdx = result.indexOf('## [1.0.0] — 2026-05-01');
        assert.ok(blockquoteIdx > 0, 'intro blockquote should still be in the file');
        assert.ok(newBlockIdx > blockquoteIdx, 'new block must follow the blockquote');
        assert.ok(priorBlockIdx > newBlockIdx, 'prior block must follow the new block');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
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

void test('task release-init exits non-zero with exact local-branch guard message', () => {
    const { root, work } = setupReleaseRepo();
    try {
        git(work, ['branch', 'release/v1.6']);
        const result = runTaskCmd(work, ['release-init', '1.6.0']);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Error: branch 'release\/v1\.6' already exists locally\./);
        assert.doesNotMatch(result.stdout, /initialized and pushed/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

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

void test('docs telemetry files stay clean after the suite', () => {
    const result = spawnSync('git', ['status', '-s', '--', 'docs/pipeline-invocations.md', 'docs/task-quality-log.md', 'docs/lessons-learned.md'], {
        cwd: WORKSPACE_ROOT,
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '', `unexpected docs pollution:\n${result.stdout}`);
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
