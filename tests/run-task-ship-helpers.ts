import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { METRICS_SKELETON } from '../src/orchestrator/metrics.js';
import { CANON_LOG_HEADERS } from '../src/orchestrator/quality-log.js';


export const WORKTREE_ROOT = process.cwd();
export const TSX_LOADER = path.join(WORKTREE_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');
export const MD_LOADER = path.join(WORKTREE_ROOT, 'tests', 'md-loader-register.mjs');

export const MAIN_HREF = pathToFileURL(path.join(WORKTREE_ROOT, 'src', 'orchestrator', 'main.ts')).href;

export type RunResult = { status: number | null; stdout: string; stderr: string };

export function withTempDir(prefix: string, fn: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    try {
        fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

export function gitIn(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function gitRawIn(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function makeGitFixture(dir: string, initialFiles: Record<string, string> = {}): { localDir: string; originDir: string } {
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

export function writeExecutable(scriptDir: string, name: string, body: string[]): void {
    fs.writeFileSync(path.join(scriptDir, name), ['#!/bin/sh', 'set -eu', ...body, ''].join('\n'), { mode: 0o755 });
}

export function setupFakeTools(scriptDir: string): void {
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
        '  if [ "$state_filter" = "open" ] && [ "${FAKE_GH_PR_LIST_FAIL:-}" = "1" ]; then printf "%s\\n" "open PR listing failed" >&2; exit 1; fi',
        '  if [ "$state_filter" = "open" ] && [ "${FAKE_GH_PR_LIST_MALFORMED:-}" = "1" ]; then printf "%s\\n" "not json"; exit 0; fi',
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
        '  if [ "${FAKE_GH_MERGE_FAIL:-}" = "1" ]; then printf "%s\\n" "${FAKE_GH_MERGE_ERROR:-merge failed}" >&2; exit 1; fi',
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
        'if [ "${1:-}" = "repo" ] && [ "${2:-}" = "view" ]; then',
        '  if [ "${FAKE_GH_REPO_VIEW_FAIL:-}" = "1" ]; then printf "%s\\n" "repository settings unavailable" >&2; exit 1; fi',
        '  if [ "${FAKE_GH_REPO_VIEW_MALFORMED:-}" = "1" ]; then printf "%s\\n" "not json"; exit 0; fi',
        '  allowed_methods=",${FAKE_GH_ALLOWED_METHODS:-squash,rebase,merge},"',
        '  case "$allowed_methods" in *,squash,*) squash=true ;; *) squash=false ;; esac',
        '  case "$allowed_methods" in *,rebase,*) rebase=true ;; *) rebase=false ;; esac',
        '  case "$allowed_methods" in *,merge,*) merge=true ;; *) merge=false ;; esac',
        '  printf \'{"squashMergeAllowed":%s,"rebaseMergeAllowed":%s,"mergeCommitAllowed":%s}\\n\' "$squash" "$rebase" "$merge"',
        '  exit 0',
        'fi',
        'printf "%s\\n" "unexpected gh args: $*" >&2',
        'exit 1',
    ]);
}

export function setupGitDeleteRace(scriptDir: string, realGit: string): void {
    writeExecutable(scriptDir, 'git', [
        'if [ "${1:-}" = "push" ] && [ "${2:-}" = "origin" ] && [ "${3:-}" = "--delete" ] && [ "${4:-}" = "${FAKE_GIT_DELETE_REMOTE_REF:-}" ]; then',
        '  printf "%s\\n" "error: unable to delete: remote ref does not exist" >&2',
        '  exit 1',
        'fi',
        `exec ${JSON.stringify(realGit)} "$@"`,
    ]);
}

export function setupGitArchiveFailure(scriptDir: string, realGit: string, mode: 'commit' | 'push'): void {
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

export function runCanon(cwd: string, args: readonly string[], fakeTools: string, env: Record<string, string> = {}): RunResult {
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

export function makeStatus(taskId: string, branch: string, provider?: unknown): Record<string, unknown> {
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
    if (provider !== undefined) status.provider = provider;
    return status;
}

export function makeHumanReviewStatus(taskId: string, branch: string): Record<string, unknown> {
    const status = makeStatus(taskId, branch);
    status.status = 'human_review';
    const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
    phases.human_review = { status: 'pending', agent: 'human' };
    return status;
}

export function writePrNumberSidecar(repoDir: string, taskId: string, prNumber: unknown): void {
    fs.writeFileSync(path.join(repoDir, 'tasks', taskId, '.pr-number'), String(prNumber), 'utf8');
}

export function writeTaskFiles(repoDir: string, taskId: string, status: Record<string, unknown>): void {
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

export function readStatusFile(repoDir: string, taskId: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(repoDir, 'tasks', taskId, 'status.json'), 'utf8')) as Record<string, unknown>;
}

export function branchExists(repoDir: string, branch: string): boolean {
    const result = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repoDir });
    return result.status === 0;
}

export function createUnrelatedCommit(repoDir: string, originalBranch: string): string {
    gitIn(repoDir, 'checkout', '-b', `unrelated-${Math.random().toString(16).slice(2)}`, 'main');
    fs.writeFileSync(path.join(repoDir, 'unrelated.txt'), `unrelated ${Date.now()}\n`, 'utf8');
    gitIn(repoDir, 'add', 'unrelated.txt');
    gitIn(repoDir, 'commit', '-m', 'unrelated head');
    const sha = gitIn(repoDir, 'rev-parse', 'HEAD');
    gitIn(repoDir, 'checkout', originalBranch);
    return sha;
}

export function advanceBranchOnOrigin(dir: string, originDir: string, branch: string): string {
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

export function simulateMergeOnOrigin(dir: string, originDir: string, statuses: Record<string, Record<string, unknown>>, files: Record<string, string> = {}): void {
    const mergeDir = path.join(dir, `merge-${Math.random().toString(16).slice(2)}`);
    execFileSync('git', ['clone', originDir, mergeDir], { stdio: 'ignore' });
    gitIn(mergeDir, 'config', 'user.email', 'test@example.com');
    gitIn(mergeDir, 'config', 'user.name', 'Test User');
    gitIn(mergeDir, 'checkout', 'main');
    for (const [taskId, status] of Object.entries(statuses)) {
        writeTaskFiles(mergeDir, taskId, status);
    }
    for (const [file, content] of Object.entries(files)) writeRel(mergeDir, file, content);
    gitIn(mergeDir, 'add', 'tasks', ...Object.keys(files));
    gitIn(mergeDir, 'commit', '-m', 'simulate squash merge');
    gitIn(mergeDir, 'push', 'origin', 'main');
}

export function prepareShipFixture(
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
        taskFiles?: Record<string, string>;
        providers?: Record<string, unknown>;
    } = {},
): { localDir: string; originDir: string; branch: string; tip: string; prHead: string; fakeTools: string } {
    const { localDir, originDir } = makeGitFixture(dir, options.initialFiles);
    const fakeTools = path.join(dir, 'fake-tools');
    setupFakeTools(fakeTools);

    const branch = `task/${taskIds[0]}`;
    gitIn(localDir, 'checkout', '-b', branch);
    const statuses: Record<string, Record<string, unknown>> = {};
    for (const taskId of taskIds) {
        const status = makeStatus(taskId, branch, options.providers?.[taskId]);
        statuses[taskId] = status;
        writeTaskFiles(localDir, taskId, status);
        if (options.prNumbers?.[taskId] !== undefined) {
            writePrNumberSidecar(localDir, taskId, options.prNumbers[taskId]);
        }
    }
    for (const [file, content] of Object.entries(options.taskFiles ?? {})) writeRel(localDir, file, content);
    gitIn(localDir, 'add', 'tasks', ...Object.keys(options.taskFiles ?? {}));
    gitIn(localDir, 'commit', '-m', 'add task artifacts');
    const tip = gitIn(localDir, 'rev-parse', branch);
    gitIn(localDir, 'push', '-u', 'origin', branch);
    const prHead = options.advanceRemote ? advanceBranchOnOrigin(dir, originDir, branch) : tip;
    if (options.advanceRemote && options.materializeAdvancedHead !== false) {
        gitIn(localDir, 'fetch', 'origin', branch);
    }

    if (options.mergeToOrigin !== false) {
        simulateMergeOnOrigin(dir, originDir, statuses, options.taskFiles);
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

export function prepareSharedWorktreeShipFixture(
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

export function prepareShipOverrideFixture(
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

export function expectArchivedAndDeleted(repoDir: string, taskId: string, branch: string): void {
    assert.ok(fs.existsSync(path.join(repoDir, 'tasks', '_archive', taskId)));
    assert.ok(!fs.existsSync(path.join(repoDir, 'tasks', taskId)));
    assert.equal(branchExists(repoDir, branch), false);
}

export function expectTaskAndBranchSurvive(repoDir: string, taskId: string, branch: string): void {
    assert.ok(!fs.existsSync(path.join(repoDir, 'tasks', '_archive', taskId)));
    assert.equal(branchExists(repoDir, branch), true);
    assert.doesNotThrow(() => gitIn(repoDir, 'cat-file', '-e', `${branch}:tasks/${taskId}/status.json`));
}

export function markTaskWorktree(repoDir: string, taskId: string): void {
    const statusPath = path.join(repoDir, 'tasks', taskId, 'status.json');
    const status = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as Record<string, unknown>;
    status.worktree = true;
    fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

export function sharedDocInitialFiles(taskId: string): Record<string, string> {
    return {
        'docs/pipeline-invocations.md': 'pipeline base\n',
        'docs/lessons-learned.md': `lessons base for tasks/${taskId}/spec.md\n`,
        'docs/task-quality-log.md': `quality base for tasks/${taskId}/review.md\n`,
        'docs/patterns.md': 'patterns base\n',
    };
}

export function readRel(repoDir: string, relPath: string): string {
    return fs.readFileSync(path.join(repoDir, relPath), 'utf8');
}

export function writeRel(repoDir: string, relPath: string, content: string): void {
    const fullPath = path.join(repoDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
}

export function assertNoPrMergeInvoked(logPath: string): void {
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    assert.doesNotMatch(log, /pr merge/);
}

export function makeTmpDir(dir: string): string {
    const tmpDir = path.join(dir, 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    return tmpDir;
}

export function backupEntries(tmpDir: string): string[] {
    if (!fs.existsSync(tmpDir)) return [];
    return fs.readdirSync(tmpDir).filter(entry => entry.startsWith('canon-ship-shared-doc-backup-'));
}

export function qualityDoc(taskId: string, verdict: string, note: string, extra?: string): string {
    const headers = [...CANON_LOG_HEADERS, ...(extra === undefined ? [] : ['Adopter'])];
    return '# Task Quality Log\n\n## Log\n\n' +
        `| ${headers.join(' | ')} |\n|${headers.map(() => '---').join('|')}|\n` +
        `| 2026-01-01 | ${taskId} | M | ${verdict} | 3 | 4 | 0 | 0 | No | ${note} |${extra === undefined ? '' : ` ${extra} |`}\n\n## Periodic Reviews\n`;
}

export function telemetryFragments(taskId: string): Record<string, string> {
    return {
        [`tasks/${taskId}/metrics.md`]: METRICS_SKELETON +
            `| 2026-01-01 | ${taskId} | spec | claude | test | 1 | 1s | 42 | ok |\n` +
            `| 2026-01-02 | ${taskId} | plan | claude | test | 1 | 2s | 43 | ok |\n`,
        [`tasks/${taskId}/quality-log.md`]: qualityDoc(taskId, 'approved', `see tasks/${taskId}/done.md`),
        [`tasks/${taskId}/lessons.md`]: `### Lesson for ${taskId}\n\nSee tasks/${taskId}/notes.md.\n`,
    };
}
