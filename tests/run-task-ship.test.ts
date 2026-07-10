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

function gitRawIn(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function makeGitFixture(dir: string, initialFiles: Record<string, string> = {}): { localDir: string; originDir: string } {
    const originDir = path.join(dir, 'origin.git');
    const localDir = path.join(dir, 'local');
    execFileSync('git', ['init', '--bare', originDir], { stdio: 'ignore' });
    execFileSync('git', ['clone', originDir, localDir], { stdio: 'ignore' });
    gitIn(localDir, 'config', 'user.email', 'test@example.com');
    gitIn(localDir, 'config', 'user.name', 'Test User');
    gitIn(localDir, 'checkout', '-b', 'main');
    fs.writeFileSync(path.join(localDir, 'README.md'), '# fixture\n', 'utf8');
    fs.writeFileSync(
        path.join(localDir, '.gitignore'),
        'tasks/**/.canon-pid\ntasks/**/.canon-run.log\ntasks/**/.heartbeat.json\ntasks/**/.pr-number\n',
        'utf8',
    );
    for (const [relPath, content] of Object.entries(initialFiles)) {
        const fullPath = path.join(localDir, relPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf8');
    }
    gitIn(localDir, 'add', 'README.md', '.gitignore', ...Object.keys(initialFiles));
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

function setupGitArchiveFailure(scriptDir: string, realGit: string, mode: 'commit' | 'push'): void {
    const guard = mode === 'commit'
        ? [
            'if [ "${1:-}" = "commit" ] && [ "${2:-}" = "-m" ]; then',
            '  case "${3:-}" in',
            '    "chore: archive "*)',
            '      printf "%s\\n" "simulated archive commit failure" >&2',
            '      exit 1',
            '      ;;',
            '  esac',
            'fi',
        ]
        : [
            'if [ "${1:-}" = "push" ] && [ "${2:-}" = "origin" ] && [ $# -eq 3 ]; then',
            '  printf "%s\\n" "simulated archive push failure" >&2',
            '  exit 1',
            'fi',
        ];
    writeExecutable(scriptDir, 'git', [
        ...guard,
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

function makeStatus(taskId: string, branch: string): Record<string, unknown> {
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
    return status;
}

function makeHumanReviewStatus(taskId: string, branch: string): Record<string, unknown> {
    const status = makeStatus(taskId, branch);
    status.status = 'human_review';
    const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
    phases.human_review = { status: 'pending', agent: 'human' };
    return status;
}

function writePrNumberSidecar(repoDir: string, taskId: string, prNumber: unknown): void {
    fs.writeFileSync(path.join(repoDir, 'tasks', taskId, '.pr-number'), String(prNumber), 'utf8');
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
        initialFiles?: Record<string, string>;
    } = {},
): { localDir: string; originDir: string; branch: string; tip: string; prHead: string; fakeTools: string } {
    const { localDir, originDir } = makeGitFixture(dir, options.initialFiles);
    const fakeTools = path.join(dir, 'fake-tools');
    setupFakeTools(fakeTools);

    const branch = `task/${taskIds[0]}`;
    gitIn(localDir, 'checkout', '-b', branch);
    const statuses: Record<string, Record<string, unknown>> = {};
    for (const taskId of taskIds) {
        const status = makeStatus(taskId, branch);
        statuses[taskId] = status;
        writeTaskFiles(localDir, taskId, status);
        if (options.prNumbers?.[taskId] !== undefined) {
            writePrNumberSidecar(localDir, taskId, options.prNumbers[taskId]);
        }
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

function prepareSharedWorktreeShipFixture(
    dir: string,
    taskIds: readonly [string, string],
    options: {
        secondaryRepoBaseBranch?: string;
        prNumber: number;
    },
): { localDir: string; branch: string; tip: string; fakeTools: string } {
    const { localDir } = makeGitFixture(dir);
    const fakeTools = path.join(dir, 'fake-tools');
    setupFakeTools(fakeTools);

    const branch = `task/${taskIds[0]}`;
    const worktreeDir = path.join(dir, 'worktrees', taskIds[0]);
    gitIn(localDir, 'worktree', 'add', worktreeDir, '-b', branch, 'main');

    const primaryStatus = makeStatus(taskIds[0], branch);
    primaryStatus.base_branch = 'main';
    primaryStatus.worktree = true;
    writeTaskFiles(localDir, taskIds[0], primaryStatus);
    writeTaskFiles(worktreeDir, taskIds[0], primaryStatus);
    writePrNumberSidecar(worktreeDir, taskIds[0], options.prNumber);

    const secondaryWorktreeStatus = makeStatus(taskIds[1], branch);
    secondaryWorktreeStatus.base_branch = 'main';
    secondaryWorktreeStatus.worktree = true;
    writeTaskFiles(worktreeDir, taskIds[1], secondaryWorktreeStatus);
    writePrNumberSidecar(worktreeDir, taskIds[1], options.prNumber);

    const secondaryRepoStatus = makeStatus(taskIds[1], branch);
    secondaryRepoStatus.base_branch = options.secondaryRepoBaseBranch ?? 'release/v1';
    secondaryRepoStatus.worktree = true;
    writeTaskFiles(localDir, taskIds[1], secondaryRepoStatus);

    gitIn(worktreeDir, 'add', 'tasks');
    gitIn(worktreeDir, 'commit', '-m', 'add shared worktree task artifacts');
    gitIn(worktreeDir, 'push', '-u', 'origin', branch);
    const tip = gitIn(worktreeDir, 'rev-parse', branch);

    return { localDir, branch, tip, fakeTools };
}

function prepareShipOverrideFixture(
    dir: string,
    taskId: string,
    options: {
        repoBaseBranch?: string;
        overrideBaseBranch?: string;
        prNumber: number;
    },
): { localDir: string; branch: string; tip: string; fakeTools: string; tasksRoot: string } {
    const { localDir, originDir } = makeGitFixture(dir);
    const fakeTools = path.join(dir, 'fake-tools');
    setupFakeTools(fakeTools);

    const branch = `task/${taskId}`;
    gitIn(localDir, 'checkout', '-b', branch);

    const repoStatus = makeStatus(taskId, branch);
    repoStatus.base_branch = options.repoBaseBranch ?? 'release/v1';
    repoStatus.worktree = false;
    writeTaskFiles(localDir, taskId, repoStatus);
    writePrNumberSidecar(localDir, taskId, options.prNumber);

    gitIn(localDir, 'add', 'tasks');
    gitIn(localDir, 'commit', '-m', 'add override task artifacts');
    gitIn(localDir, 'push', '-u', 'origin', branch);
    const tip = gitIn(localDir, 'rev-parse', branch);

    const overrideDir = path.join(dir, 'override');
    const tasksRoot = path.join(overrideDir, 'tasks');
    execFileSync('git', ['clone', originDir, overrideDir], { stdio: 'ignore' });
    gitIn(overrideDir, 'config', 'user.email', 'test@example.com');
    gitIn(overrideDir, 'config', 'user.name', 'Test User');
    gitIn(overrideDir, 'checkout', '-b', branch, `origin/${branch}`);
    const overrideStatus = makeStatus(taskId, branch);
    overrideStatus.base_branch = options.overrideBaseBranch ?? 'main';
    overrideStatus.worktree = false;
    writeTaskFiles(overrideDir, taskId, overrideStatus);
    writePrNumberSidecar(overrideDir, taskId, options.prNumber);

    return { localDir, branch, tip, fakeTools, tasksRoot };
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

function markTaskWorktree(repoDir: string, taskId: string): void {
    const statusPath = path.join(repoDir, 'tasks', taskId, 'status.json');
    const status = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as Record<string, unknown>;
    status.worktree = true;
    fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

function sharedDocInitialFiles(taskId: string): Record<string, string> {
    return {
        'docs/pipeline-invocations.md': 'pipeline base\n',
        'docs/lessons-learned.md': `lessons base for tasks/${taskId}/spec.md\n`,
        'docs/task-quality-log.md': `quality base for tasks/${taskId}/review.md\n`,
        'docs/patterns.md': 'patterns base\n',
    };
}

function readRel(repoDir: string, relPath: string): string {
    return fs.readFileSync(path.join(repoDir, relPath), 'utf8');
}

function writeRel(repoDir: string, relPath: string, content: string): void {
    const fullPath = path.join(repoDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
}

function assertNoPrMergeInvoked(logPath: string): void {
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    assert.doesNotMatch(log, /pr merge/);
}

function makeTmpDir(dir: string): string {
    const tmpDir = path.join(dir, 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    return tmpDir;
}

function backupEntries(tmpDir: string): string[] {
    if (!fs.existsSync(tmpDir)) return [];
    return fs.readdirSync(tmpDir).filter(entry => entry.startsWith('canon-ship-shared-doc-backup-'));
}

void test('--pr writes the sidecar on create path and leaves status clean', () => {
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
        assert.equal(fs.readFileSync(path.join(localDir, 'tasks', taskId, '.pr-number'), 'utf8'), '101');
        const status = readStatusFile(localDir, taskId) as { pr?: { number?: number } };
        assert.equal(status.pr, undefined);
        assert.equal(gitIn(localDir, 'status', '--porcelain'), '');
        assert.equal(gitIn(localDir, 'log', '--format=%s', '-1'), `chore: add task artifacts for ${taskId}`);
        assert.equal(gitIn(localDir, 'log', '--format=%s', '--grep=record pr.number'), '');
        assert.doesNotMatch(gitIn(localDir, 'log', '--format=%s', '-1'), /\[skip ci\]/);
    });
});

void test('--pr keeps the artifacts commit unmarked, sets upstream tracking, and reruns cleanly', () => {
    withTempDir('run-task-ship-pr-tracking-', dir => {
        const { localDir } = makeGitFixture(dir);
        const fakeTools = path.join(dir, 'fake-tools');
        setupFakeTools(fakeTools);
        const taskId = 'ship-pr-tracking';
        const branch = `task/${taskId}`;
        gitIn(localDir, 'checkout', '-b', branch);
        writeTaskFiles(localDir, taskId, makeHumanReviewStatus(taskId, branch));

        const first = runCanon(localDir, [taskId, '--pr'], fakeTools, {
            FAKE_GH_STATE_FILE: path.join(dir, 'gh-state.txt'),
            FAKE_GH_CREATE_NUMBER: '101',
            FAKE_GH_CREATE_URL: 'https://github.com/example/repo/pull/101',
        });

        assert.equal(first.status, 0, first.stderr);
        const status = readStatusFile(localDir, taskId) as { pr?: { number?: number } };
        assert.equal(status.pr, undefined);
        assert.equal(fs.readFileSync(path.join(localDir, 'tasks', taskId, '.pr-number'), 'utf8'), '101');
        assert.equal(gitIn(localDir, 'rev-parse', '--abbrev-ref', `${branch}@{upstream}`), `origin/${branch}`);
        assert.match(gitIn(localDir, 'status', '-sb'), new RegExp(`^## ${branch}\\.{3}origin/${branch}$`, 'm'));
        assert.equal(gitIn(localDir, 'status', '--porcelain'), '');
        assert.doesNotMatch(gitIn(localDir, 'log', '--format=%s', '-1'), /\[skip ci\]/);

        const second = runCanon(localDir, [taskId, '--pr'], fakeTools, {
            FAKE_GH_STATE_FILE: path.join(dir, 'gh-state.txt'),
            FAKE_GH_CREATE_NUMBER: '101',
            FAKE_GH_CREATE_URL: 'https://github.com/example/repo/pull/101',
        });

        assert.equal(second.status, 0, second.stderr);
        assert.equal(gitIn(localDir, 'rev-parse', '--abbrev-ref', `${branch}@{upstream}`), `origin/${branch}`);
        assert.match(gitIn(localDir, 'status', '-sb'), new RegExp(`^## ${branch}\\.{3}origin/${branch}$`, 'm'));
        assert.equal(gitIn(localDir, 'status', '--porcelain'), '');
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
        assert.equal(fs.readFileSync(path.join(localDir, 'tasks', taskId, '.pr-number'), 'utf8'), '77');
        assert.equal(gitIn(localDir, 'status', '--porcelain'), '');

        const second = runCanon(localDir, [taskId, '--pr'], fakeTools, env);
        assert.equal(second.status, 0, second.stderr);
        assert.equal(fs.readFileSync(path.join(localDir, 'tasks', taskId, '.pr-number'), 'utf8'), '77');
        assert.equal(gitIn(localDir, 'status', '--porcelain'), '');
        assert.doesNotMatch(gitIn(localDir, 'log', '--format=%s', '-1'), /\[skip ci\]/);
    });
});

void test('--pr dirty path with already-pinned open PR keeps the head unmarked', () => {
    withTempDir('run-task-ship-pr-pinned-', dir => {
        const { localDir } = makeGitFixture(dir);
        const fakeTools = path.join(dir, 'fake-tools');
        setupFakeTools(fakeTools);
        const taskId = 'ship-pr-pinned';
        const branch = `task/${taskId}`;
        gitIn(localDir, 'checkout', '-b', branch);
        writeTaskFiles(localDir, taskId, makeHumanReviewStatus(taskId, branch));
        writePrNumberSidecar(localDir, taskId, 77);
        gitIn(localDir, 'add', 'tasks');
        gitIn(localDir, 'commit', '-m', 'seed pinned PR');
        gitIn(localDir, 'push', '-u', 'origin', branch);
        fs.appendFileSync(path.join(localDir, 'tasks', taskId, 'handoff.md'), '\nlocal dirty change\n', 'utf8');

        const result = runCanon(localDir, [taskId, '--pr'], fakeTools, {
            FAKE_GH_OPEN_PR_NUMBER: '77',
            FAKE_GH_PR_HEAD: branch,
            FAKE_GH_PR_BASE: 'main',
            FAKE_GH_PR_URL: 'https://github.com/example/repo/pull/77',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.equal(fs.readFileSync(path.join(localDir, 'tasks', taskId, '.pr-number'), 'utf8'), '77');
        assert.equal(gitIn(localDir, 'status', '--porcelain'), '');
        assert.doesNotMatch(gitIn(localDir, 'log', '--format=%s', '-1'), /\[skip ci\]/);
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
            assert.equal(status.pr, undefined);
            assert.equal(fs.readFileSync(path.join(localDir, 'tasks', taskId, '.pr-number'), 'utf8'), '88');
        }
    });
});

void test('--ship proves pinned merged PR, fast-forwards, archives, and deletes local branch', () => {
    withTempDir('run-task-ship-happy-', dir => {
        const taskId = 'ship-happy';
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 101 },
        });
        assert.equal(fs.readFileSync(path.join(localDir, 'tasks', taskId, '.pr-number'), 'utf8'), '101');

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

void test('--ship preserves appended pipeline invocation dirt as uncommitted after archive', () => {
    withTempDir('run-task-ship-preserve-invocations-', dir => {
        const taskId = 'ship-preserve-invocations';
        const suffix = 'sibling pre-implement telemetry row\n';
        const tmpDir = makeTmpDir(dir);
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles: sharedDocInitialFiles(taskId),
            prNumbers: { [taskId]: 301 },
        });
        markTaskWorktree(localDir, taskId);
        fs.appendFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), suffix, 'utf8');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
            TMPDIR: tmpDir,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Preserving uncommitted docs\/pipeline-invocations\.md dirt during --ship; backup: /);
        const backupPath = result.stdout.match(/backup: (.+)/)?.[1]?.trim();
        assert.ok(backupPath);
        assert.equal(fs.existsSync(backupPath), false);
        assert.match(readRel(localDir, 'docs/pipeline-invocations.md'), new RegExp(suffix.trim()));
        assert.doesNotMatch(gitIn(localDir, 'show', 'HEAD:docs/pipeline-invocations.md'), new RegExp(suffix.trim()));
        assert.match(gitRawIn(localDir, 'status', '--porcelain', '--', 'docs/pipeline-invocations.md'), /^ M docs\/pipeline-invocations\.md\n$/);
        expectArchivedAndDeleted(localDir, taskId, branch);
    });
});

void test('--ship aborts mixed shared-doc dirt before backups or mutation', () => {
    withTempDir('run-task-ship-mixed-shared-doc-dirt-', dir => {
        const taskId = 'ship-mixed-shared-doc-dirt';
        const tmpDir = makeTmpDir(dir);
        const ghLog = path.join(dir, 'gh.log');
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles: sharedDocInitialFiles(taskId),
            prNumbers: { [taskId]: 302 },
        });
        markTaskWorktree(localDir, taskId);
        const telemetryPath = 'docs/pipeline-invocations.md';
        const managedPath = 'docs/patterns.md';
        fs.appendFileSync(path.join(localDir, telemetryPath), 'safe telemetry suffix\n', 'utf8');
        fs.appendFileSync(path.join(localDir, managedPath), 'managed edit\n', 'utf8');
        const telemetryBefore = readRel(localDir, telemetryPath);
        const managedBefore = readRel(localDir, managedPath);

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
            FAKE_GH_LOG: ghLog,
            TMPDIR: tmpDir,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /docs\/patterns\.md/);
        assertNoPrMergeInvoked(ghLog);
        assert.equal(readRel(localDir, telemetryPath), telemetryBefore);
        assert.equal(readRel(localDir, managedPath), managedBefore);
        assert.equal(backupEntries(tmpDir).length, 0);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship aborts managed shared-doc dirt and --force does not bypass it', () => {
    for (const force of [false, true]) {
        withTempDir(`run-task-ship-managed-dirt-${force ? 'force' : 'normal'}-`, dir => {
            const taskId = force ? 'ship-managed-dirt-force' : 'ship-managed-dirt';
            const ghLog = path.join(dir, 'gh.log');
            const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
                initialFiles: sharedDocInitialFiles(taskId),
                prNumbers: { [taskId]: 303 },
            });
            markTaskWorktree(localDir, taskId);
            fs.appendFileSync(path.join(localDir, 'docs', 'patterns.md'), 'operator edit\n', 'utf8');
            const before = readRel(localDir, 'docs/patterns.md');

            const result = runCanon(
                localDir,
                force ? [taskId, '--ship', '--force'] : [taskId, '--ship'],
                fakeTools,
                {
                    FAKE_GH_PR_STATE: 'MERGED',
                    FAKE_GH_BASE_REF_NAME: 'main',
                    FAKE_GH_HEAD_REF_OID: tip,
                    FAKE_GH_LOG: ghLog,
                },
            );

            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /docs\/patterns\.md/);
            assert.match(result.stderr, /commit or stash your edits/);
            assertNoPrMergeInvoked(ghLog);
            assert.equal(readRel(localDir, 'docs/patterns.md'), before);
            expectTaskAndBranchSurvive(localDir, taskId, branch);
        });
    }
});

void test('--ship aborts non-pure-append telemetry dirt before merge', () => {
    withTempDir('run-task-ship-non-append-telemetry-', dir => {
        const taskId = 'ship-non-append-telemetry';
        const ghLog = path.join(dir, 'gh.log');
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles: sharedDocInitialFiles(taskId),
            prNumbers: { [taskId]: 304 },
        });
        markTaskWorktree(localDir, taskId);
        writeRel(localDir, 'docs/pipeline-invocations.md', 'modified existing line\n');
        const before = readRel(localDir, 'docs/pipeline-invocations.md');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
            FAKE_GH_LOG: ghLog,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /not a pure append/);
        assertNoPrMergeInvoked(ghLog);
        assert.equal(readRel(localDir, 'docs/pipeline-invocations.md'), before);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship aborts untracked telemetry dirt before merge', () => {
    withTempDir('run-task-ship-untracked-telemetry-', dir => {
        const taskId = 'ship-untracked-telemetry';
        const ghLog = path.join(dir, 'gh.log');
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 305 },
        });
        markTaskWorktree(localDir, taskId);
        writeRel(localDir, 'docs/pipeline-invocations.md', 'untracked telemetry\n');
        const before = readRel(localDir, 'docs/pipeline-invocations.md');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
            FAKE_GH_LOG: ghLog,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /git status shows this path as '\?\?'/);
        assertNoPrMergeInvoked(ghLog);
        assert.equal(readRel(localDir, 'docs/pipeline-invocations.md'), before);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship preserves archive-staged telemetry dirt without committing the suffix', () => {
    withTempDir('run-task-ship-preserve-archive-telemetry-', dir => {
        const taskId = 'ship-preserve-archive-telemetry';
        const lessonsSuffix = 'sibling lesson suffix\n';
        const qualitySuffix = 'sibling quality suffix\n';
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles: sharedDocInitialFiles(taskId),
            prNumbers: { [taskId]: 306 },
        });
        markTaskWorktree(localDir, taskId);
        fs.appendFileSync(path.join(localDir, 'docs', 'lessons-learned.md'), lessonsSuffix, 'utf8');
        fs.appendFileSync(path.join(localDir, 'docs', 'task-quality-log.md'), qualitySuffix, 'utf8');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.equal(result.status, 0, result.stderr);
        const committedLessons = gitIn(localDir, 'show', 'HEAD:docs/lessons-learned.md');
        const committedQuality = gitIn(localDir, 'show', 'HEAD:docs/task-quality-log.md');
        assert.match(committedLessons, new RegExp(`tasks/_archive/${taskId}/spec\\.md`));
        assert.match(committedQuality, new RegExp(`tasks/_archive/${taskId}/review\\.md`));
        assert.doesNotMatch(committedLessons, new RegExp(lessonsSuffix.trim()));
        assert.doesNotMatch(committedQuality, new RegExp(qualitySuffix.trim()));
        assert.match(readRel(localDir, 'docs/lessons-learned.md'), new RegExp(lessonsSuffix.trim()));
        assert.match(readRel(localDir, 'docs/task-quality-log.md'), new RegExp(qualitySuffix.trim()));
        assert.match(gitRawIn(localDir, 'status', '--porcelain', '--', 'docs/lessons-learned.md'), /^ M docs\/lessons-learned\.md\n$/);
        assert.match(gitRawIn(localDir, 'status', '--porcelain', '--', 'docs/task-quality-log.md'), /^ M docs\/task-quality-log\.md\n$/);
        expectArchivedAndDeleted(localDir, taskId, branch);
    });
});

void test('--ship preserves telemetry in the working tree when the archive commit fails', () => {
    withTempDir('run-task-ship-archive-commit-fail-', dir => {
        const taskId = 'ship-archive-commit-fail';
        const suffix = 'pending row\n';
        const { localDir, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles: { 'docs/pipeline-invocations.md': '# Pipeline Invocations\n\nexisting row\n' },
            prNumbers: { [taskId]: 308 },
        });
        markTaskWorktree(localDir, taskId);
        fs.appendFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), suffix, 'utf8');

        const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
        setupGitArchiveFailure(fakeTools, realGit, 'commit');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /failed to commit archive changes/);
        assert.equal(
            readRel(localDir, 'docs/pipeline-invocations.md'),
            '# Pipeline Invocations\n\nexisting row\npending row\n',
        );
    });
});

void test('--ship preserves telemetry in the working tree when the archive push fails', () => {
    withTempDir('run-task-ship-archive-push-fail-', dir => {
        const taskId = 'ship-archive-push-fail';
        const suffix = 'pending row\n';
        const { localDir, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles: { 'docs/pipeline-invocations.md': '# Pipeline Invocations\n\nexisting row\n' },
            prNumbers: { [taskId]: 309 },
        });
        markTaskWorktree(localDir, taskId);
        fs.appendFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), suffix, 'utf8');

        const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
        setupGitArchiveFailure(fakeTools, realGit, 'push');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /simulated archive push failure/);
        assert.equal(
            readRel(localDir, 'docs/pipeline-invocations.md'),
            '# Pipeline Invocations\n\nexisting row\npending row\n',
        );
    });
});

void test('--ship aborts a staged-only edit on a managed doc before merge', () => {
    withTempDir('run-task-ship-staged-managed-', dir => {
        const taskId = 'ship-staged-managed';
        const ghLog = path.join(dir, 'gh.log');
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles: { 'docs/patterns.md': '# Patterns\n\nexisting pattern\n' },
            prNumbers: { [taskId]: 310 },
        });
        markTaskWorktree(localDir, taskId);
        const target = path.join(localDir, 'docs', 'patterns.md');
        const headContent = fs.readFileSync(target, 'utf8');
        fs.writeFileSync(target, `${headContent}staged edit\n`, 'utf8');
        gitIn(localDir, 'add', 'docs/patterns.md');
        fs.writeFileSync(target, headContent, 'utf8');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
            FAKE_GH_LOG: ghLog,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /docs\/patterns\.md/);
        assertNoPrMergeInvoked(ghLog);
        assert.notEqual(gitIn(localDir, 'diff', '--cached', '--', 'docs/patterns.md'), '');
        assert.equal(readRel(localDir, 'docs/patterns.md'), headContent);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship aborts a staged-only edit on a telemetry file before merge', () => {
    withTempDir('run-task-ship-staged-telemetry-', dir => {
        const taskId = 'ship-staged-telemetry';
        const ghLog = path.join(dir, 'gh.log');
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles: { 'docs/pipeline-invocations.md': '# Pipeline Invocations\n\nexisting row\n' },
            prNumbers: { [taskId]: 311 },
        });
        markTaskWorktree(localDir, taskId);
        const target = path.join(localDir, 'docs', 'pipeline-invocations.md');
        const headContent = fs.readFileSync(target, 'utf8');
        fs.writeFileSync(target, `${headContent}staged row\n`, 'utf8');
        gitIn(localDir, 'add', 'docs/pipeline-invocations.md');
        fs.writeFileSync(target, headContent, 'utf8');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
            FAKE_GH_LOG: ghLog,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /docs\/pipeline-invocations\.md/);
        assertNoPrMergeInvoked(ghLog);
        assert.notEqual(gitIn(localDir, 'diff', '--cached', '--', 'docs/pipeline-invocations.md'), '');
        assert.equal(readRel(localDir, 'docs/pipeline-invocations.md'), headContent);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship aborts a working-tree deletion of a tracked shared doc before merge', () => {
    withTempDir('run-task-ship-deleted-doc-', dir => {
        const taskId = 'ship-deleted-doc';
        const ghLog = path.join(dir, 'gh.log');
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            initialFiles: { 'docs/decisions.md': '# Decisions\n\nexisting decision\n' },
            prNumbers: { [taskId]: 312 },
        });
        markTaskWorktree(localDir, taskId);
        fs.rmSync(path.join(localDir, 'docs', 'decisions.md'));

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
            FAKE_GH_LOG: ghLog,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /docs\/decisions\.md/);
        assertNoPrMergeInvoked(ghLog);
        assert.match(gitRawIn(localDir, 'status', '--porcelain', '--', 'docs/decisions.md'), /^ D docs\/decisions\.md\n$/);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
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

void test('--ship malformed sidecar fails closed instead of trusting the cast', () => {
    withTempDir('run-task-ship-malformed-pr-', dir => {
        const taskId = 'ship-malformed-pr';
        const { localDir, branch, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 'not-a-number' },
        });
        assert.equal(fs.readFileSync(path.join(localDir, 'tasks', taskId, '.pr-number'), 'utf8'), 'not-a-number');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /merge proof could not be established/);
        expectTaskAndBranchSurvive(localDir, taskId, branch);
    });
});

void test('--ship orphaned worktree state reads the sidecar without crashing', () => {
    withTempDir('run-task-ship-orphaned-worktree-', dir => {
        const taskId = 'ship-orphaned-worktree';
        const { localDir, branch, tip, fakeTools } = prepareShipFixture(dir, [taskId], {
            prNumbers: { [taskId]: 109 },
        });
        const statusPath = path.join(localDir, 'tasks', taskId, 'status.json');
        const status = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as Record<string, unknown>;
        status.worktree = true;
        fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.equal(result.status, 0, result.stderr);
        expectArchivedAndDeleted(localDir, taskId, branch);
    });
});

void test('--ship bundle secondary resolves to the shared worktree, not REPO_ROOT', () => {
    withTempDir('run-task-ship-shared-worktree-', dir => {
        const taskIds = ['ship-shared-primary', 'ship-shared-secondary'];
        const { localDir, branch, tip, fakeTools } = prepareSharedWorktreeShipFixture(dir, taskIds as [string, string], {
            prNumber: 210,
            secondaryRepoBaseBranch: 'release/v1',
        });

        const result = runCanon(localDir, [...taskIds, '--ship'], fakeTools, {
            FAKE_GH_OPEN_PR_NUMBER: '210',
            FAKE_GH_PR_HEAD: branch,
            FAKE_GH_PR_BASE: 'main',
            FAKE_GH_PR_URL: 'https://github.com/example/repo/pull/210',
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.equal(result.status, 0, result.stderr);
        for (const taskId of taskIds) {
            assert.ok(fs.existsSync(path.join(localDir, 'tasks', '_archive', taskId)));
            assert.ok(!fs.existsSync(path.join(localDir, 'tasks', taskId)));
        }
    });
});

void test('--ship honors CANON_TASKS_DIR_OVERRIDE when resolving ship cwd', () => {
    withTempDir('run-task-ship-override-cwd-', dir => {
        const taskId = 'ship-override-cwd';
        const { localDir, branch, tip, fakeTools, tasksRoot } = prepareShipOverrideFixture(dir, taskId, {
            prNumber: 211,
            repoBaseBranch: 'release/v1',
            overrideBaseBranch: 'main',
        });

        assert.equal(readStatusFile(localDir, taskId).base_branch, 'release/v1');
        assert.equal(readStatusFile(path.dirname(tasksRoot), taskId).base_branch, 'main');

        const result = runCanon(localDir, [taskId, '--ship'], fakeTools, {
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GH_OPEN_PR_NUMBER: '211',
            FAKE_GH_PR_HEAD: branch,
            FAKE_GH_PR_BASE: 'main',
            FAKE_GH_PR_URL: 'https://github.com/example/repo/pull/211',
            FAKE_GH_PR_STATE: 'MERGED',
            FAKE_GH_BASE_REF_NAME: 'main',
            FAKE_GH_HEAD_REF_OID: tip,
        });

        assert.equal(result.status, 0, result.stderr);
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
