import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const WORKTREE_ROOT = process.cwd();
const TSX_LOADER = path.join(WORKTREE_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');
const MD_LOADER = path.join(WORKTREE_ROOT, 'tests', 'md-loader-register.mjs');

const MAIN_HREF = pathToFileURL(path.join(WORKTREE_ROOT, 'scripts', 'run-task', 'main.ts')).href;

type RunResult = { status: number | null; stdout: string; stderr: string };

function withTempDir(prefix: string, fn: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    try {
        fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function gitIn(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeGitFixture(dir: string): { localDir: string; originDir: string } {
    const originDir = path.join(dir, 'origin.git');
    const localDir = path.join(dir, 'local');
    execFileSync('git', ['init', '--bare', originDir], { stdio: 'ignore' });
    execFileSync('git', ['clone', originDir, localDir], { stdio: 'ignore' });
    gitIn(localDir, 'config', 'user.email', 'test@example.com');
    gitIn(localDir, 'config', 'user.name', 'Test User');
    gitIn(localDir, 'checkout', '-b', 'main');
    fs.writeFileSync(path.join(localDir, 'README.md'), '# fixture\n', 'utf8');
    fs.writeFileSync(path.join(localDir, '.gitignore'), 'tasks/**/.canon-pid\ntasks/**/.heartbeat.json\n', 'utf8');
    gitIn(localDir, 'add', 'README.md', '.gitignore');
    gitIn(localDir, 'commit', '-m', 'initial');
    gitIn(localDir, 'push', '-u', 'origin', 'main');
    return { localDir, originDir };
}

function writeExecutable(scriptDir: string, name: string, body: string[]): void {
    fs.writeFileSync(path.join(scriptDir, name), ['#!/bin/sh', 'set -eu', ...body, ''].join('\n'), { mode: 0o755 });
}

function setupFakeTools(scriptDir: string): void {
    fs.mkdirSync(scriptDir, { recursive: true });
    writeExecutable(scriptDir, 'claude', ['if [ "${1:-}" = "--version" ]; then printf "claude-test\\n"; fi', 'exit 0']);
    writeExecutable(scriptDir, 'codex', ['if [ "${1:-}" = "--version" ]; then printf "codex-test\\n"; fi', 'exit 0']);
    writeExecutable(scriptDir, 'gh', [
        'if [ -n "${FAKE_GH_LOG:-}" ]; then printf "%s\\n" "$*" >> "$FAKE_GH_LOG"; fi',
        'state_file="${FAKE_GH_STATE_FILE:-}"',
        'STATE_NUMBER=""',
        'STATE_URL=""',
        'STATE_BASE=""',
        'STATE_HEAD=""',
        'STATE_STATUS=""',
        'read_state() {',
        '  STATE_NUMBER=""',
        '  STATE_URL=""',
        '  STATE_BASE=""',
        '  STATE_HEAD=""',
        '  STATE_STATUS=""',
        '  if [ -n "$state_file" ] && [ -s "$state_file" ]; then',
        '    IFS="|" read -r STATE_NUMBER STATE_URL STATE_BASE STATE_HEAD STATE_STATUS < "$state_file" || true',
        '  fi',
        '}',
        'emit_list() {',
        '  state_filter="$1"',
        '  head="$2"',
        '  base="$3"',
        '  json="$4"',
        '  read_state',
        '  number=""',
        '  url=""',
        '  candidate_base="${FAKE_GH_PR_BASE:-}"',
        '  candidate_head="${FAKE_GH_PR_HEAD:-$head}"',
        '  if [ "$state_filter" = "open" ]; then',
        '    number="${FAKE_GH_OPEN_PR_NUMBER:-}"',
        '    url="${FAKE_GH_PR_URL:-}"',
        '    if [ "$STATE_STATUS" = "OPEN" ]; then number="$STATE_NUMBER"; url="$STATE_URL"; candidate_base="$STATE_BASE"; candidate_head="$STATE_HEAD"; fi',
        '  elif [ "$state_filter" = "merged" ]; then',
        '    number="${FAKE_GH_MERGED_PR_NUMBER:-}"',
        '    url="${FAKE_GH_PR_URL:-}"',
        '    if [ "$STATE_STATUS" = "MERGED" ]; then number="$STATE_NUMBER"; url="$STATE_URL"; candidate_base="$STATE_BASE"; candidate_head="$STATE_HEAD"; fi',
        '  fi',
        '  if [ -z "$number" ]; then if [ "$json" = "1" ]; then printf "[]\\n"; fi; exit 0; fi',
        '  if [ -n "$base" ] && [ -n "$candidate_base" ] && [ "$base" != "$candidate_base" ]; then if [ "$json" = "1" ]; then printf "[]\\n"; fi; exit 0; fi',
        '  if [ "$json" = "1" ]; then printf \'[{"number":%s,"headRefName":"%s"}]\\n\' "$number" "$candidate_head"; else printf "%s\\n" "$number"; fi',
        '  exit 0',
        '}',
        'if [ "${1:-}" = "pr" ] && [ "${2:-}" = "list" ]; then',
        '  head=""',
        '  base=""',
        '  state_filter="open"',
        '  json=0',
        '  while [ $# -gt 0 ]; do',
        '    case "$1" in',
        '      --head) head="$2"; shift 2 ;;',
        '      --base) base="$2"; shift 2 ;;',
        '      --state) state_filter="$2"; shift 2 ;;',
        '      --json) json=1; shift 2 ;;',
        '      *) shift ;;',
        '    esac',
        '  done',
        '  emit_list "$state_filter" "$head" "$base" "$json"',
        'fi',
        'if [ "${1:-}" = "pr" ] && [ "${2:-}" = "create" ]; then',
        '  number="${FAKE_GH_CREATE_NUMBER:-101}"',
        '  url="${FAKE_GH_CREATE_URL:-https://github.com/example/repo/pull/$number}"',
        '  head=""',
        '  base=""',
        '  while [ $# -gt 0 ]; do',
        '    case "$1" in',
        '      --head) head="$2"; shift 2 ;;',
        '      --base) base="$2"; shift 2 ;;',
        '      *) shift ;;',
        '    esac',
        '  done',
        '  if [ -n "$state_file" ]; then printf "%s|%s|%s|%s|OPEN\\n" "$number" "$url" "$base" "$head" > "$state_file"; fi',
        '  printf "%s\\n" "$url"',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "pr" ] && [ "${2:-}" = "merge" ]; then',
        '  if [ -n "$state_file" ]; then',
        '    read_state',
        '    if [ -n "$STATE_NUMBER" ]; then printf "%s|%s|%s|%s|MERGED\\n" "$STATE_NUMBER" "$STATE_URL" "$STATE_BASE" "$STATE_HEAD" > "$state_file"; fi',
        '  fi',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "pr" ] && [ "${2:-}" = "view" ]; then',
        '  json=""',
        '  while [ $# -gt 0 ]; do',
        '    case "$1" in',
        '      --json) json="$2"; shift 2 ;;',
        '      --jq) shift 2 ;;',
        '      *) shift ;;',
        '    esac',
        '  done',
        '  read_state',
        '  if [ "$json" = "state" ]; then printf "%s\\n" "${FAKE_GH_PR_STATE:-${STATE_STATUS:-MERGED}}"; exit 0; fi',
        '  if [ "$json" = "headRefOid" ]; then if [ -n "${FAKE_GH_HEAD_REF_OID:-}" ]; then printf "%s\\n" "$FAKE_GH_HEAD_REF_OID"; exit 0; fi; exit 1; fi',
        '  if [ "$json" = "baseRefName" ]; then printf "%s\\n" "${FAKE_GH_BASE_REF_NAME:-${STATE_BASE:-main}}"; exit 0; fi',
        '  if [ "$json" = "url" ]; then printf "%s\\n" "${FAKE_GH_PR_URL:-${STATE_URL:-https://github.com/example/repo/pull/1}}"; exit 0; fi',
        '  exit 1',
        'fi',
        'printf "%s\\n" "unexpected gh args: $*" >&2',
        'exit 1',
    ]);
}

function setupGitDeleteRace(scriptDir: string, realGit: string): void {
    writeExecutable(scriptDir, 'git', [
        'if [ "${1:-}" = "push" ] && [ "${2:-}" = "origin" ] && [ "${3:-}" = "--delete" ] && [ "${4:-}" = "${FAKE_GIT_DELETE_REMOTE_REF:-}" ]; then',
        '  printf "%s\\n" "error: unable to delete: remote ref does not exist" >&2',
        '  exit 1',
        'fi',
        `exec ${JSON.stringify(realGit)} "$@"`,
    ]);
}

function runCanon(cwd: string, args: readonly string[], fakeTools: string, env: Record<string, string> = {}): RunResult {
    const telemetryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-ship-metrics-'));
    const telemetryFile = path.join(telemetryDir, 'pipeline-invocations.md');
    const script = [
        `import(${JSON.stringify(MAIN_HREF)})`,
        '  .then(async m => {',
        `    process.argv = ['node', 'canon', ...${JSON.stringify(args)}];`,
        '    await m.main();',
        '  })',
        '  .catch(error => { console.error(error); process.exit(1); });',
    ].join('\n');
    const result = spawnSync(process.execPath, [
        '--import',
        MD_LOADER,
        '--import',
        TSX_LOADER,
        '-e',
        script,
    ], {
        cwd,
        env: {
            ...process.env,
            PATH: `${fakeTools}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_METRICS_FILE_OVERRIDE: telemetryFile,
            CANON_NO_DETACH: '1',
            ...env,
        },
        encoding: 'utf8',
    });
    fs.rmSync(telemetryDir, { recursive: true, force: true });
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

function makeStatus(taskId: string, branch: string, prNumber?: unknown): Record<string, unknown> {
    const status: Record<string, unknown> = {
        id: taskId,
        title: taskId,
        status: 'complete',
        branch,
        base_branch: 'main',
        task_size: 'S',
        delicate: false,
        human_spec_gate: false,
        full_send: false,
        worktree: false,
        phases: {
            spec: { status: 'done', agent: 'claude' },
            spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
            plan: { status: 'done', agent: 'claude' },
            implement: { status: 'done', agent: 'codex' },
            code_review: { status: 'done', agent: 'claude', verdict: 'approved' },
            qa: { status: 'done', agent: 'claude' },
            human_review: { status: 'done', agent: 'human' },
        },
        escalations: [],
        sessions: {},
    };
    if (prNumber !== undefined) status.pr = { number: prNumber };
    return status;
}

function makeHumanReviewStatus(taskId: string, branch: string): Record<string, unknown> {
    const status = makeStatus(taskId, branch);
    status.status = 'human_review';
    const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
    phases.human_review = { status: 'pending', agent: 'human' };
    return status;
}

function writeTaskFiles(repoDir: string, taskId: string, status: Record<string, unknown>): void {
    const taskDir = path.join(repoDir, 'tasks', taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(taskDir, 'spec.md'), [
        `# Spec: ${taskId}`,
        '',
        '## Design',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '',
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(taskDir, 'handoff.md'), [
        `# Implementation Handoff: ${taskId}`,
        '',
        '## Changes',
        '',
        '| File | Summary |',
        '|---|---|',
        '',
        '## Validation Outcomes',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| lint | Pass | ok |',
        '',
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(taskDir, 'done.md'), `# Done: ${taskId}\n`, 'utf8');
}

function readStatusFile(repoDir: string, taskId: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(repoDir, 'tasks', taskId, 'status.json'), 'utf8')) as Record<string, unknown>;
}

function branchExists(repoDir: string, branch: string): boolean {
    const result = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repoDir });
    return result.status === 0;
}

function createUnrelatedCommit(repoDir: string, originalBranch: string): string {
    gitIn(repoDir, 'checkout', '-b', `unrelated-${Math.random().toString(16).slice(2)}`, 'main');
    fs.writeFileSync(path.join(repoDir, 'unrelated.txt'), `unrelated ${Date.now()}\n`, 'utf8');
    gitIn(repoDir, 'add', 'unrelated.txt');
    gitIn(repoDir, 'commit', '-m', 'unrelated head');
    const sha = gitIn(repoDir, 'rev-parse', 'HEAD');
    gitIn(repoDir, 'checkout', originalBranch);
    return sha;
}

function advanceBranchOnOrigin(dir: string, originDir: string, branch: string): string {
    const advanceDir = path.join(dir, `advance-${Math.random().toString(16).slice(2)}`);
    execFileSync('git', ['clone', originDir, advanceDir], { stdio: 'ignore' });
    gitIn(advanceDir, 'config', 'user.email', 'test@example.com');
    gitIn(advanceDir, 'config', 'user.name', 'Test User');
    gitIn(advanceDir, 'checkout', branch);
    fs.writeFileSync(path.join(advanceDir, 'remote-advance.txt'), `remote advance ${Date.now()}\n`, 'utf8');
    gitIn(advanceDir, 'add', 'remote-advance.txt');
    gitIn(advanceDir, 'commit', '-m', 'advance remote task branch');
    const sha = gitIn(advanceDir, 'rev-parse', 'HEAD');
    gitIn(advanceDir, 'push', 'origin', branch);
    return sha;
}

function simulateMergeOnOrigin(dir: string, originDir: string, statuses: Record<string, Record<string, unknown>>): void {
    const mergeDir = path.join(dir, `merge-${Math.random().toString(16).slice(2)}`);
    execFileSync('git', ['clone', originDir, mergeDir], { stdio: 'ignore' });
    gitIn(mergeDir, 'config', 'user.email', 'test@example.com');
    gitIn(mergeDir, 'config', 'user.name', 'Test User');
    gitIn(mergeDir, 'checkout', 'main');
    for (const [taskId, status] of Object.entries(statuses)) {
        writeTaskFiles(mergeDir, taskId, status);
    }
    gitIn(mergeDir, 'add', 'tasks');
    gitIn(mergeDir, 'commit', '-m', 'simulate squash merge');
    gitIn(mergeDir, 'push', 'origin', 'main');
}

function prepareShipFixture(
    dir: string,
    taskIds: readonly string[],
    options: {
        prNumbers?: Record<string, unknown>;
        mergeToOrigin?: boolean;
        deleteRemote?: boolean;
        syncBase?: boolean;
        advanceRemote?: boolean;
        materializeAdvancedHead?: boolean;
    } = {},
): { localDir: string; originDir: string; branch: string; tip: string; prHead: string; fakeTools: string } {
    const { localDir, originDir } = makeGitFixture(dir);
    const fakeTools = path.join(dir, 'fake-tools');
    setupFakeTools(fakeTools);

    const branch = `task/${taskIds[0]}`;
    gitIn(localDir, 'checkout', '-b', branch);
    const statuses: Record<string, Record<string, unknown>> = {};
    for (const taskId of taskIds) {
        const status = makeStatus(taskId, branch, options.prNumbers?.[taskId]);
        statuses[taskId] = status;
        writeTaskFiles(localDir, taskId, status);
    }
    gitIn(localDir, 'add', 'tasks');
    gitIn(localDir, 'commit', '-m', 'add task artifacts');
    const tip = gitIn(localDir, 'rev-parse', branch);
    gitIn(localDir, 'push', '-u', 'origin', branch);
    const prHead = options.advanceRemote ? advanceBranchOnOrigin(dir, originDir, branch) : tip;
    if (options.advanceRemote && options.materializeAdvancedHead !== false) {
        gitIn(localDir, 'fetch', 'origin', branch);
    }

    if (options.mergeToOrigin !== false) {
        simulateMergeOnOrigin(dir, originDir, statuses);
    }
    if (options.deleteRemote !== false) {
        gitIn(localDir, 'push', 'origin', '--delete', branch);
    }
    if (options.syncBase) {
        gitIn(localDir, 'checkout', 'main');
        gitIn(localDir, 'pull', '--ff-only', 'origin', 'main');
    } else {
        gitIn(localDir, 'checkout', branch);
    }

    return { localDir, originDir, branch, tip, prHead, fakeTools };
}

function expectArchivedAndDeleted(repoDir: string, taskId: string, branch: string): void {
    assert.ok(fs.existsSync(path.join(repoDir, 'tasks', '_archive', taskId)));
    assert.ok(!fs.existsSync(path.join(repoDir, 'tasks', taskId)));
    assert.equal(branchExists(repoDir, branch), false);
}

function expectTaskAndBranchSurvive(repoDir: string, taskId: string, branch: string): void {
    assert.ok(!fs.existsSync(path.join(repoDir, 'tasks', '_archive', taskId)));
    assert.equal(branchExists(repoDir, branch), true);
    assert.doesNotThrow(() => gitIn(repoDir, 'cat-file', '-e', `${branch}:tasks/${taskId}/status.json`));
}

void test('--pr pins pr.number on create path and leaves status clean', () => {
    withTempDir('run-task-ship-pr-create-', dir => {
        const { localDir } = makeGitFixture(dir);
        const fakeTools = path.join(dir, 'fake-tools');
        setupFakeTools(fakeTools);
        const taskId = 'ship-pr-create';
        const branch = `task/${taskId}`;
        gitIn(localDir, 'checkout', '-b', branch);
        writeTaskFiles(localDir, taskId, makeHumanReviewStatus(taskId, branch));

        const result = runCanon(localDir, [taskId, '--pr'], fakeTools, {
            FAKE_GH_STATE_FILE: path.join(dir, 'gh-state.txt'),
            FAKE_GH_CREATE_NUMBER: '101',
        });

        assert.equal(result.status, 0, result.stderr);
        const status = readStatusFile(localDir, taskId) as { pr?: { number?: number } };
        assert.equal(status.pr?.number, 101);
        assert.equal(gitIn(localDir, 'status', '--porcelain'), '');
        assert.match(gitIn(localDir, 'log', '--oneline', '-2'), /record pr\.number/);
    });
});

void test('--pr pins existing PR number and exits clean on re-run', () => {
    withTempDir('run-task-ship-pr-existing-', dir => {
        const { localDir } = makeGitFixture(dir);
        const fakeTools = path.join(dir, 'fake-tools');
        setupFakeTools(fakeTools);
        const taskId = 'ship-pr-existing';
        const branch = `task/${taskId}`;
        gitIn(localDir, 'checkout', '-b', branch);
        writeTaskFiles(localDir, taskId, makeHumanReviewStatus(taskId, branch));

        const env = {
            FAKE_GH_OPEN_PR_NUMBER: '77',
            FAKE_GH_PR_HEAD: branch,
            FAKE_GH_PR_BASE: 'main',
            FAKE_GH_PR_URL: 'https://github.com/example/repo/pull/77',
        };
        const first = runCanon(localDir, [taskId, '--pr'], fakeTools, env);
        assert.equal(first.status, 0, first.stderr);
        assert.equal(gitIn(localDir, 'status', '--porcelain'), '');

        const second = runCanon(localDir, [taskId, '--pr'], fakeTools, env);
        assert.equal(second.status, 0, second.stderr);
        const status = readStatusFile(localDir, taskId) as { pr?: { number?: number } };
        assert.equal(status.pr?.number, 77);
        assert.equal(gitIn(localDir, 'status', '--porcelain'), '');
    });
});

void test('--pr pins bundle PR number to every task', () => {
    withTempDir('run-task-ship-pr-bundle-', dir => {
        const { localDir } = makeGitFixture(dir);
        const fakeTools = path.join(dir, 'fake-tools');
        setupFakeTools(fakeTools);
        const taskIds = ['ship-pr-bundle-a', 'ship-pr-bundle-b'];
        const branch = `task/${taskIds[0]}`;
        gitIn(localDir, 'checkout', '-b', branch);
        for (const taskId of taskIds) {
            writeTaskFiles(localDir, taskId, makeHumanReviewStatus(taskId, branch));
        }

        const result = runCanon(localDir, [...taskIds, '--pr'], fakeTools, {
            FAKE_GH_OPEN_PR_NUMBER: '88',
            FAKE_GH_PR_HEAD: branch,
            FAKE_GH_PR_BASE: 'main',
        });

        assert.equal(result.status, 0, result.stderr);
        for (const taskId of taskIds) {
            const status = readStatusFile(localDir, taskId) as { pr?: { number?: number } };
            assert.equal(status.pr?.number, 88);
        }
    });
});

void test('--ship proves pinned merged PR, fast-forwards, archives, and deletes local branch', () => {
    withTempDir('run-task-ship-happy-', dir => {
        const taskId = 'ship-happy';
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 101 },
        });

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /fast-forwarding/);
        expectArchivedAndDeleted(localDir, taskId, branch);
    });
});

void test('--ship refuses pinned PR merged into the wrong base', () => {
    withTempDir('run-task-ship-wrong-base-', dir => {
        const taskId = 'ship-wrong-base';
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 102 },
        });

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'release/v1',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /not 'main'/);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship refuses branch-reuse head mismatch and --force does not bypass it', () => {
    for (const force of [false, true]) {
        withTempDir(`run-task-ship-reuse-${force ? 'force' : 'normal'}-`, dir => {
            const taskId = force ? 'ship-reuse-force' : 'ship-reuse';
            const { localDir, branch, fakeTools } = prepareShipFixture(dir, [taskId], {
                prNumbers: { [taskId]: 103 },
            });
            const staleSha = createUnrelatedCommit(localDir, branch);

            const result = runCanon(localDir, force ? [taskId, '--ship', '--force'] : [taskId, '--ship'], fakeTools, {
                FAKE_GH_PR_STATE: 'MERGED',
                FAKE_GH_BASE_REF_NAME: 'main',
                FAKE_GH_HEAD_REF_OID: staleSha,
            });

            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /not an ancestor/);
            expectTaskAndBranchSurvive(localDir, taskId, branch);
        });
    }
});

void test('--ship refuses unmerged work and base-in-sync without proof', () => {
    for (const syncBase of [false, true]) {
        withTempDir(`run-task-ship-unproven-${syncBase ? 'synced' : 'behind'}-`, dir => {
            const taskId = syncBase ? 'ship-unproven-synced' : 'ship-unproven';
            const { localDir, branch, fakeTools } = prepareShipFixture(dir, [taskId], {
                mergeToOrigin: syncBase,
                deleteRemote: true,
                syncBase,
            });

            const result = runCanon(localDir, [taskId, '--ship'], fakeTools);

            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /merge proof could not be established/);
            expectTaskAndBranchSurvive(localDir, taskId, branch);
        });
    }
});

void test('--ship legacy fallback proves merged PR by ancestor-or-equal head', () => {
    withTempDir('run-task-ship-legacy-', dir => {
        const taskId = 'ship-legacy';
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId]);

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_MERGED_PR_NUMBER: '104',
            FAKE_GH_PR_HEAD: branch,
            FAKE_GH_PR_BASE: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.equal(result.status, 0, result.stderr);
        expectArchivedAndDeleted(localDir, taskId, branch);
    });
});

void test('--ship proves behind-local branch when local tip is an ancestor of PR head', () => {
    withTempDir('run-task-ship-behind-local-', dir => {
        const taskId = 'ship-behind-local';
        const { localDir, branch, tip, prHead, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 107 },
            advanceRemote: true,
        });

        assert.notEqual(tip, prHead);
        assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', tip, prHead], { cwd: localDir }).status, 0);

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: prHead,
        });

        assert.equal(result.status, 0, result.stderr);
        expectArchivedAndDeleted(localDir, taskId, branch);
    });
});

void test('--ship treats an unmaterializable PR head as unproven', () => {
    withTempDir('run-task-ship-missing-head-', dir => {
        const taskId = 'ship-missing-head';
        const { localDir, branch, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 108 },
        });
        const missingSha = 'f'.repeat(40);

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: missingSha,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /could not be materialized locally/);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship archives without proof when local branch is already gone', () => {
    withTempDir('run-task-ship-no-branch-', dir => {
        const taskId = 'ship-no-branch';
        const { localDir, branch, fakeTools } = prepareShipFixture(dir, [taskId], { syncBase: true });
        gitIn(localDir, 'branch', '-D', branch);

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools);

        assert.equal(result.status, 0, result.stderr);
        assert.ok(fs.existsSync(path.join(localDir, 'tasks', '_archive', taskId)));
    });
});

void test('--ship bundle proof is all-or-nothing', () => {
    withTempDir('run-task-ship-bundle-proof-', dir => {
        const taskIds = ['ship-bundle-a', 'ship-bundle-b'];
        const { localDir, branch, fakeTools } = prepareShipFixture(dir, taskIds, {
            prNumbers: { [taskIds[0]]: 105, [taskIds[1]]: 105 },
        });
        const unrelatedHead = createUnrelatedCommit(localDir, branch);

        const result = runCanon(localDir, [...taskIds, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: unrelatedHead,
        });

        assert.notEqual(result.status, 0);
        for (const taskId of taskIds) {
            assert.ok(!fs.existsSync(path.join(localDir, 'tasks', '_archive', taskId)));
            assert.ok(fs.existsSync(path.join(localDir, 'tasks', taskId)));
        }
        assert.equal(branchExists(localDir, branch), true);
    });
});

void test('--ship malformed pr field fails closed instead of trusting the cast', () => {
    withTempDir('run-task-ship-malformed-pr-', dir => {
        const taskId = 'ship-malformed-pr';
        const { localDir, branch, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 'not-a-number' },
        });

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /merge proof could not be established/);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship tolerates remote branch already gone during stale-remote cleanup', () => {
    withTempDir('run-task-ship-remote-delete-race-', dir => {
        const taskId = 'ship-remote-delete-race';
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            deleteRemote: false,
        });
        const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
        setupGitDeleteRace(fakeTools, realGit);

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_MERGED_PR_NUMBER: '106',
            FAKE_GH_PR_HEAD: branch,
            FAKE_GH_PR_BASE: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
            FAKE_GIT_DELETE_REMOTE_REF: branch,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /No-op delete; continuing cleanup/);
        expectArchivedAndDeleted(localDir, taskId, branch);
    });
});
