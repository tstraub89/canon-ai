import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

import { REPO_ROOT } from '../scripts/run-task/env.js';
import {
    buildHumanReviewStagePaths,
    classifyMergeOutcome,
    enableFullSend,
    findPullRequestTemplate,
    formatCompleteStateBanner,
    formatExistingPRMessage,
    resolveCanonPrBody,
    resolveQaPrBody,
} from '../scripts/run-task/main.js';
import { ensureBranch, ensureCheckedOutBaseBranch, findDirtyRepoRootSourcePaths } from '../scripts/run-task/git.js';
import { commitArchiveChanges } from '../scripts/run-task/main.js';
import { resolveTaskCwd } from '../scripts/run-task/state.js';

const WORKTREE_ROOT = process.cwd();
const TSX_LOADER = path.join(WORKTREE_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');

function withTempDir(prefix: string, fn: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    try {
        fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function writeTaskStatus(tasksRoot: string, taskId: string, status: Record<string, unknown>): void {
    const taskDir = path.join(tasksRoot, taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

function writeExecutable(scriptDir: string, name: string, body: string[]): void {
    fs.writeFileSync(path.join(scriptDir, name), ['#!/bin/sh', 'set -eu', ...body, ''].join('\n'), { mode: 0o755 });
}

function setupFakeGit(scriptDir: string): void {
    const gitPath = path.join(scriptDir, 'git');
    fs.writeFileSync(gitPath, [
        '#!/bin/sh',
        'set -eu',
        'printf "%s\\n" "$*" >> "$FAKE_GIT_LOG"',
        'if [ "${1:-}" = "rev-parse" ] && [ "${2:-}" = "--abbrev-ref" ] && [ "${3:-}" = "HEAD" ]; then',
        '  cat "$FAKE_GIT_CURRENT_BRANCH"',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "rev-parse" ] && [ "${2:-}" = "HEAD" ]; then',
        '  if [ -n "${FAKE_GIT_HEAD_SHA:-}" ]; then printf "%s\\n" "$FAKE_GIT_HEAD_SHA"; else printf "%s\\n" "abc123"; fi',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "rev-parse" ] && [ "${2:-}" = "--verify" ] && [ "${3:-}" = "origin/$FAKE_GIT_REMOTE_BRANCH" ]; then',
        '  if [ "${FAKE_GIT_REMOTE_EXISTS:-1}" = "1" ]; then exit 0; fi',
        '  exit 1',
        'fi',
        'if [ "${1:-}" = "remote" ] && [ "${2:-}" = "get-url" ] && [ "${3:-}" = "origin" ]; then',
        '  if [ -n "${FAKE_GIT_REMOTE_URL:-}" ]; then printf "%s\\n" "$FAKE_GIT_REMOTE_URL"; fi',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "show-ref" ] && [ "${2:-}" = "--verify" ] && [ "${3:-}" = "--quiet" ]; then',
        '  if [ "${4:-}" = "refs/heads/${FAKE_GIT_BASE_BRANCH:-main}" ]; then exit 0; fi',
        '  if [ "${4:-}" = "refs/heads/$FAKE_GIT_TASK_BRANCH" ]; then exit 1; fi',
        '  exit 1',
        'fi',
        'if [ "${1:-}" = "checkout" ] && [ "${2:-}" = "${FAKE_GIT_BASE_BRANCH:-main}" ]; then',
        '  printf "%s\\n" "${FAKE_GIT_BASE_BRANCH:-main}" > "$FAKE_GIT_CURRENT_BRANCH"',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "checkout" ] && [ "${2:-}" = "-b" ] && [ "${3:-}" = "$FAKE_GIT_TASK_BRANCH" ]; then',
        '  printf "%s\\n" "$FAKE_GIT_TASK_BRANCH" > "$FAKE_GIT_CURRENT_BRANCH"',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "checkout" ] && [ "${2:-}" = "$FAKE_GIT_TASK_BRANCH" ]; then',
        '  printf "%s\\n" "$FAKE_GIT_TASK_BRANCH" > "$FAKE_GIT_CURRENT_BRANCH"',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "add" ]; then',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "ls-files" ] && [ "${2:-}" = "--deleted" ]; then',
        '  if [ -n "${FAKE_GIT_DELETED_FILES:-}" ]; then printf "%s\\n" "$FAKE_GIT_DELETED_FILES"; fi',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "ls-files" ] && [ "${2:-}" = "--error-unmatch" ]; then',
        '  if [ "${FAKE_GIT_LS_FILES_FAIL:-}" = "1" ]; then exit 1; fi',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "status" ] && [ "${2:-}" = "--porcelain=v1" ]; then',
        '  if [ -n "${FAKE_GIT_STATUS_OUTPUT:-}" ]; then printf "%s\\n" "$FAKE_GIT_STATUS_OUTPUT"; fi',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "diff" ] && [ "${2:-}" != "--cached" ]; then',
        '  if [ "${FAKE_GIT_DRIFT_DIFF_FAIL:-}" = "1" ]; then',
        '    printf "%s\\n" "${FAKE_GIT_DRIFT_DIFF_ERROR:-tree diff failed}" >&2',
        '    exit 1',
        '  fi',
        '  if [ -n "${FAKE_GIT_DRIFT_FILES:-}" ]; then',
        '    OLDIFS="$IFS"',
        '    IFS=","',
        '    for FILE in $FAKE_GIT_DRIFT_FILES; do',
        '      printf "M\\0%s\\0" "$FILE"',
        '    done',
        '    IFS="$OLDIFS"',
        '  fi',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "diff" ] && [ "${2:-}" = "--cached" ] && [ "${3:-}" = "--name-only" ]; then',
        '  if [ -n "${FAKE_GIT_DIFF_OUTPUT:-}" ]; then printf "%s\\n" "$FAKE_GIT_DIFF_OUTPUT"; fi',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "commit" ]; then',
        '  if [ "${FAKE_GIT_FAIL_COMMIT:-}" = "1" ]; then',
        '    printf "%s\\n" "commit failed" >&2',
        '    exit 1',
        '  fi',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "push" ] && [ "${2:-}" = "origin" ] && [ "${3:-}" = "${FAKE_GIT_BASE_BRANCH:-}" ]; then',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "push" ] && [ "${2:-}" = "origin" ] && [ "${3:-}" = "${FAKE_GIT_TASK_BRANCH:-}" ]; then',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "fetch" ] && [ "${2:-}" = "origin" ] && [ "${3:-}" = "${FAKE_GIT_BASE_BRANCH:-main}" ]; then',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "log" ] && [ "${2:-}" = "origin/${FAKE_GIT_BASE_BRANCH:-main}..${FAKE_GIT_BASE_BRANCH:-main}" ]; then',
        '  if [ "${FAKE_GIT_BASE_LOG_FAIL:-}" = "1" ]; then',
        '    printf "%s\\n" "${FAKE_GIT_BASE_LOG_ERROR:-base log failed}" >&2',
        '    exit 1',
        '  fi',
        '  if [ -n "${FAKE_GIT_UNPUSHED_BASE_COMMITS:-}" ]; then printf "%s\\n" "$FAKE_GIT_UNPUSHED_BASE_COMMITS"; fi',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "log" ]; then',
        '  if [ -n "${FAKE_GIT_LOG_OUTPUT:-}" ]; then printf "%s\\n" "$FAKE_GIT_LOG_OUTPUT"; fi',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "rev-list" ] && [ "${2:-}" = "--count" ] && [ "${3:-}" = "HEAD..origin/${FAKE_GIT_BASE_BRANCH:-main}" ]; then',
        '  printf "%s\\n" "${FAKE_GIT_REVLIST_COUNT:-0}"',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "ls-remote" ] && [ "${2:-}" = "--heads" ] && [ "${3:-}" = "origin" ] && [ "${4:-}" = "refs/heads/$FAKE_GIT_TASK_BRANCH" ]; then',
        '  if [ -n "${FAKE_GIT_LS_REMOTE_OUTPUT:-}" ]; then printf "%s\\n" "$FAKE_GIT_LS_REMOTE_OUTPUT"; fi',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "branch" ] && [ "${2:-}" = "-D" ] && [ "${3:-}" = "$FAKE_GIT_TASK_BRANCH" ]; then',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "worktree" ] && [ "${2:-}" = "list" ] && [ "${3:-}" = "--porcelain" ]; then',
        '  if [ -n "${FAKE_GIT_WORKTREE_LIST_FILE:-}" ] && [ -f "$FAKE_GIT_WORKTREE_LIST_FILE" ]; then',
        '    cat "$FAKE_GIT_WORKTREE_LIST_FILE"',
        '  fi',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "worktree" ] && [ "${2:-}" = "add" ]; then',
        '  target=""',
        '  if [ "${3:-}" = "-b" ]; then',
        '    target="$5"',
        '  else',
        '    target="$3"',
        '  fi',
        '  mkdir -p "$target"',
        '  if [ -n "${FAKE_GIT_WORKTREE_STATUS_SOURCE:-}" ] && [ -n "${FAKE_GIT_WORKTREE_TASK_ID:-}" ]; then',
        '    mkdir -p "$target/tasks/$FAKE_GIT_WORKTREE_TASK_ID"',
        '    cp "$FAKE_GIT_WORKTREE_STATUS_SOURCE" "$target/tasks/$FAKE_GIT_WORKTREE_TASK_ID/status.json"',
        '  fi',
        '  exit 0',
        'fi',
        'printf "%s\\n" "unexpected git args: $*" >&2',
        'exit 1',
        '',
    ].join('\n'), { mode: 0o755 });
}

function setupFakeCliTools(scriptDir: string): void {
    writeExecutable(scriptDir, 'claude', ['exit 0']);
    writeExecutable(scriptDir, 'codex', ['exit 0']);
    writeExecutable(scriptDir, 'gh', [
        'if [ -n "${FAKE_GH_LOG:-}" ]; then printf "%s\\n" "$*" >> "$FAKE_GH_LOG"; fi',
        'state_file="${FAKE_GH_PR_STATE_FILE:-}"',
        'read_pr_state() {',
        '  if [ -n "$state_file" ] && [ -f "$state_file" ]; then',
        '    IFS="|" read -r FAKE_GH_STATE_NUMBER FAKE_GH_STATE_URL FAKE_GH_STATE_BASE FAKE_GH_STATE_HEAD < "$state_file"',
        '  else',
        '    FAKE_GH_STATE_NUMBER="${FAKE_GH_PR_NUMBER:-}"',
        '    FAKE_GH_STATE_URL="${FAKE_GH_PR_URL:-}"',
        '    FAKE_GH_STATE_BASE="${FAKE_GH_PR_BASE:-}"',
        '    FAKE_GH_STATE_HEAD="${FAKE_GH_PR_HEAD:-}"',
        '  fi',
        '}',
        'if [ "${1:-}" = "pr" ] && [ "${2:-}" = "list" ]; then',
        '  head=""',
        '  base=""',
        '  json=0',
        '  while [ $# -gt 0 ]; do',
        '    case "$1" in',
        '      --head) head="$2"; shift 2 ;;',
        '      --base) base="$2"; shift 2 ;;',
        '      --json) json=1; shift 2 ;;',
        '      *) shift ;;',
        '    esac',
        '  done',
        '  read_pr_state',
        '  if [ -z "$FAKE_GH_STATE_NUMBER" ]; then exit 0; fi',
        '  # When FAKE_GH_PR_BASE is set, simulate `gh pr list --base` filtering:',
        '  # only emit the PR when the caller passes a matching --base value.',
        '  # This is how production gh behaves and lets tests assert that callers',
        '  # actually pass --base (P2 audit fix on release PR #82).',
        '  if [ -n "$FAKE_GH_STATE_BASE" ] && [ -n "$base" ] && [ "$base" != "$FAKE_GH_STATE_BASE" ]; then',
        '    if [ "$json" = "1" ]; then printf "[]\\n"; fi',
        '    exit 0',
        '  fi',
        '  if [ "$json" = "1" ]; then',
        '    printf \'[{"number":%s,"headRefName":"%s"}]\\n\' "$FAKE_GH_STATE_NUMBER" "${FAKE_GH_STATE_HEAD:-$head}"',
        '  else',
        '    printf "%s\\n" "$FAKE_GH_STATE_NUMBER"',
        '  fi',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "pr" ] && [ "${2:-}" = "create" ]; then',
        '  number="${FAKE_GH_PR_CREATE_NUMBER:-101}"',
        '  url="${FAKE_GH_PR_CREATE_URL:-https://github.com/x/y/pull/$number}"',
        '  head=""',
        '  base=""',
        '  if [ "${FAKE_GH_PR_CREATE_FAIL:-}" = "1" ]; then',
        '    printf "%s\\n" "${FAKE_GH_PR_CREATE_ERROR:-draft PR creation failed}" >&2',
        '    exit 1',
        '  fi',
        '  while [ $# -gt 0 ]; do',
        '    case "$1" in',
        '      --head) head="$2"; shift 2 ;;',
        '      --base) base="$2"; shift 2 ;;',
        '      *) shift ;;',
        '    esac',
        '  done',
        '  if [ -n "$state_file" ]; then',
        '    printf "%s|%s|%s|%s\\n" "$number" "$url" "$base" "$head" > "$state_file"',
        '  fi',
        '  printf "%s\\n" "$url"',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "pr" ] && [ "${2:-}" = "merge" ]; then',
        '  if [ "${FAKE_GH_MERGE_FAIL:-}" = "1" ]; then',
        '    printf "%s\\n" "${FAKE_GH_MERGE_ERROR:-merge failed}" >&2',
        '    exit 1',
        '  fi',
        '  read_pr_state',
        '  branch="${FAKE_GH_STATE_HEAD:-}"',
        '  if [ -z "$branch" ]; then branch="${FAKE_GH_PR_HEAD:-}"; fi',
        '  if [ -n "$branch" ]; then git push origin --delete "$branch" >/dev/null 2>&1 || true; fi',
        '  if [ -n "$state_file" ]; then printf "\\n" > "$state_file"; fi',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "pr" ] && [ "${2:-}" = "view" ]; then',
        '  pr_num="${3:-}"',
        '  json=""',
        '  while [ $# -gt 0 ]; do',
        '    case "$1" in',
        '      --json) json="$2"; shift 2 ;;',
        '      --jq) shift 2 ;;',
        '      *) shift ;;',
        '    esac',
        '  done',
        '  read_pr_state',
        '  if [ "$json" = "state" ]; then',
        '    if [ -n "$FAKE_GH_PR_STATE" ]; then printf "%s\\n" "$FAKE_GH_PR_STATE"; exit 0; fi',
        '    exit 1',
        '  fi',
        '  if [ "$json" = "headRefOid" ]; then',
        '    if [ -n "$FAKE_GH_HEAD_REF_OID" ]; then printf "%s\\n" "$FAKE_GH_HEAD_REF_OID"; exit 0; fi',
        '    exit 1',
        '  fi',
        '  if [ "$json" = "baseRefName" ]; then',
        '    if [ -n "${FAKE_GH_BASE_REF_NAME:-}" ]; then printf "%s\\n" "$FAKE_GH_BASE_REF_NAME"; exit 0; fi',
        '    if [ -n "$FAKE_GH_STATE_BASE" ]; then printf "%s\\n" "$FAKE_GH_STATE_BASE"; exit 0; fi',
        '    exit 1',
        '  fi',
        '  if [ -n "$FAKE_GH_STATE_NUMBER" ] && [ "$pr_num" = "$FAKE_GH_STATE_NUMBER" ] && [ -n "$FAKE_GH_STATE_URL" ]; then printf "%s\\n" "$FAKE_GH_STATE_URL"; exit 0; fi',
        '  if [ -n "${FAKE_GH_PR_URL:-}" ]; then printf "%s\\n" "$FAKE_GH_PR_URL"; exit 0; fi',
        '  exit 1',
        'fi',
        'printf "%s\\n" "unexpected gh args: $*" >&2',
        'exit 1',
    ]);
}

function withFakeGitEnv<T>(
    vars: Record<string, string>,
    fn: (env: NodeJS.ProcessEnv) => T,
): T {
    const original = { ...process.env };
    try {
        for (const [key, value] of Object.entries(vars)) {
            process.env[key] = value;
        }
        return fn(process.env);
    } finally {
        for (const key of Object.keys(process.env)) {
            if (!(key in original)) {
                delete process.env[key];
            }
        }
        for (const [key, value] of Object.entries(original)) {
            process.env[key] = value;
        }
    }
}

function runNodeInline(
    script: string,
    env: NodeJS.ProcessEnv,
    cwd = process.cwd(),
): { status: number | null; stderr: string; stdout: string } {
    const telemetryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-metrics-'));
    const telemetryFile = path.join(telemetryDir, 'pipeline-invocations.md');
    const result = spawnSync(process.execPath, [
        '--import',
        path.join(WORKTREE_ROOT, 'tests', 'md-loader-register.mjs'),
        '--import',
        TSX_LOADER,
        '-e',
        script,
    ], {
        cwd,
        env: {
            ...env,
            CANON_METRICS_FILE_OVERRIDE: env.CANON_METRICS_FILE_OVERRIDE ?? telemetryFile,
        },
        encoding: 'utf8',
    });
    fs.rmSync(telemetryDir, { recursive: true, force: true });
    return {
        status: result.status,
        stderr: result.stderr ?? '',
        stdout: result.stdout ?? '',
    };
}

function childEnvWithoutTasksOverride(updates: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, ...updates };
    delete env.CANON_TASKS_DIR_OVERRIDE;
    return env;
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

function makeHumanReviewPendingStatus(taskId: string, branch: string): Record<string, unknown> {
    return {
        ...makeCompleteStatus(taskId, branch),
        status: 'human_review',
        phases: {
            spec: { status: 'done', agent: 'claude' },
            spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
            plan: { status: 'done', agent: 'claude' },
            implement: { status: 'done', agent: 'codex' },
            code_review: { status: 'done', agent: 'claude', verdict: 'approved' },
            qa: { status: 'done', agent: 'claude' },
            human_review: { status: 'pending', agent: 'human' },
        },
    };
}

function setupDivergentBaseRepo(dir: string, taskId: string): { localDir: string; shortSha: string } {
    const { localDir } = makeGitFixture(dir);
    fs.writeFileSync(path.join(localDir, 'unpushed-scaffold.txt'), 'local base only\n', 'utf8');
    gitIn(localDir, 'add', 'unpushed-scaffold.txt');
    gitIn(localDir, 'commit', '-m', 'task(other): commit artifacts pre-pipeline');
    const shortSha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
        cwd: localDir,
        encoding: 'utf8',
    }).trim();

    const branch = `task/${taskId}`;
    gitIn(localDir, 'checkout', '-b', branch);
    writeTaskStatus(path.join(localDir, 'tasks'), taskId, makeHumanReviewPendingStatus(taskId, branch));
    writeAffectedFilesSpec(path.join(localDir, 'tasks'), taskId, []);
    return { localDir, shortSha };
}

function makeCompleteStatus(taskId: string, branch: string): Record<string, unknown> {
    return {
        id: taskId,
        title: taskId,
        branch,
        base_branch: 'main',
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
    };
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

function writeShipTaskArtifacts(repoDir: string, taskId: string, branch: string, worktree: boolean): void {
    const tasksRoot = path.join(repoDir, 'tasks');
    const status = makeCompleteStatus(taskId, branch);
    status.worktree = worktree;
    writeTaskStatus(tasksRoot, taskId, status);
    writeAffectedFilesSpec(tasksRoot, taskId, ['`src/example.ts`']);
}

function simulateShipMergeOnOrigin(dir: string, originDir: string, taskId: string, branch: string, worktree: boolean): void {
    const thirdPartyDir = path.join(dir, `third-party-${taskId}`);
    execFileSync('git', ['clone', originDir, thirdPartyDir], { stdio: 'ignore' });
    gitIn(thirdPartyDir, 'config', 'user.email', 'test@example.com');
    gitIn(thirdPartyDir, 'config', 'user.name', 'Test User');
    gitIn(thirdPartyDir, 'checkout', 'main');
    writeShipTaskArtifacts(thirdPartyDir, taskId, branch, worktree);
    gitIn(thirdPartyDir, 'add', 'tasks');
    gitIn(thirdPartyDir, 'commit', '-m', `simulate squash merge for ${taskId}`);
    gitIn(thirdPartyDir, 'push', 'origin', 'main');
}

function runShipTask(
    taskId: string,
    fakeBins: string,
    cwd: string,
    env: Record<string, string>,
): { status: number | null; stderr: string; stdout: string } {
    const mainHref = pathToFileURL(path.join(process.cwd(), 'scripts/run-task/main.ts')).href;
    const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        ...env,
    };
    delete childEnv.CANON_TASKS_DIR_OVERRIDE;
    return runNodeInline([
        `import(${JSON.stringify(mainHref)})`,
        `.then(m => {`,
        `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--ship'];`,
        `  return m.main();`,
        `})`,
        `.catch(err => { console.error(err); process.exit(1); });`,
    ].join('\n'), childEnv, cwd);
}

type HumanReviewHarness = {
    dir: string;
    tasksRoot: string;
    fakeBins: string;
    fakeGitDir: string;
    currentBranchPath: string;
    gitLogPath: string;
};

function setupHumanReviewHarness(dir: string, taskIds: readonly string[]): HumanReviewHarness {
    const tasksRoot = path.join(dir, 'tasks');
    const fakeBins = path.join(dir, 'fake-bins');
    const fakeGitDir = path.join(fakeBins, 'git-bin');
    fs.mkdirSync(fakeBins, { recursive: true });
    fs.mkdirSync(fakeGitDir, { recursive: true });
    setupFakeGit(fakeGitDir);
    setupFakeCliTools(fakeBins);

    for (const taskId of taskIds) {
        writeTaskStatus(tasksRoot, taskId, makeCompleteStatus(taskId, 'task/task-a'));
        writeAffectedFilesSpec(tasksRoot, taskId, []);
    }

    const currentBranchPath = path.join(dir, 'current-branch.txt');
    fs.writeFileSync(currentBranchPath, 'task/task-a\n');

    return {
        dir,
        tasksRoot,
        fakeBins,
        fakeGitDir,
        currentBranchPath,
        gitLogPath: path.join(dir, 'git.log'),
    };
}

function runHumanReviewCommit(
    harness: HumanReviewHarness,
    taskIds: readonly string[],
    env: Record<string, string>,
): { status: number | null; stderr: string; stdout: string } {
    return runNodeInline([
        "import { commitHumanReviewFiles } from './scripts/run-task/main.ts';",
        `commitHumanReviewFiles(${JSON.stringify(taskIds)}, ${JSON.stringify(harness.dir)}, false);`,
    ].join('\n'), {
        ...process.env,
        PATH: `${harness.fakeGitDir}${path.delimiter}${harness.fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        CANON_TASKS_DIR_OVERRIDE: harness.tasksRoot,
        FAKE_GIT_LOG: harness.gitLogPath,
        FAKE_GIT_CURRENT_BRANCH: harness.currentBranchPath,
        FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
        FAKE_GIT_REMOTE_EXISTS: '1',
        FAKE_GIT_BASE_BRANCH: 'main',
        FAKE_GIT_TASK_BRANCH: 'task/task-a',
        ...env,
    });
}

function combinedOutput(result: { stderr: string; stdout: string }): string {
    return `${result.stdout}\n${result.stderr}`;
}

function writeImplementEvidenceFixture(tasksRoot: string, taskId: string, handoffChanges: readonly string[]): void {
    fs.mkdirSync(path.join(tasksRoot, taskId), { recursive: true });
    fs.writeFileSync(path.join(tasksRoot, taskId, 'spec.md'), [
        `# Spec: ${taskId}`,
        '',
        '## Design',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `package.json` | fixture source file |',
        '',
        '## Validation Required',
        '',
        '- [x] lint',
        '',
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(tasksRoot, taskId, 'handoff.md'), [
        `# Implementation Handoff: ${taskId}`,
        '',
        '## Changes',
        '',
        '| File | Change |',
        '|---|---|',
        ...handoffChanges.map(cell => `| ${cell} | fixture change |`),
        '',
        '## Validation Outcomes',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| `lint` | Pass | ok |',
        '',
    ].join('\n'), 'utf8');
}

function writeApprovedSpecReview(tasksRoot: string, taskId: string): void {
    fs.mkdirSync(path.join(tasksRoot, taskId), { recursive: true });
    fs.writeFileSync(path.join(tasksRoot, taskId, 'spec-review.md'), [
        '# Spec Review',
        '',
        '- [x] Approved',
        '',
    ].join('\n'), 'utf8');
}

function writePopulatedPlan(tasksRoot: string, taskId: string): void {
    fs.mkdirSync(path.join(tasksRoot, taskId), { recursive: true });
    fs.writeFileSync(path.join(tasksRoot, taskId, 'plan.md'), [
        '# Plan',
        '',
        '1. Implement the change.',
        '',
    ].join('\n'), 'utf8');
}

void test('ensureBranch creates a task branch from the declared release base, not main', () => {
    withTempDir('run-task-safety-branch-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const logPath = path.join(dir, 'git.log');
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'main\n');
        setupFakeGit(fakeGitDir);

        const taskId = 'release-task';
        const taskBranch = `task/${taskId}`;
        const taskStatus = {
            title: taskId,
            base_branch: 'release/v1',
            branch: '',
            worktree: false,
            phases: {},
        };
        writeTaskStatus(tasksRoot, taskId, taskStatus);

        withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: logPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'release/v1',
            FAKE_GIT_TASK_BRANCH: taskBranch,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        }, () => {
            ensureBranch([taskId]);
        });

        const log = fs.readFileSync(logPath, 'utf8').trim().split('\n');
        assert.ok(log.includes('rev-parse --abbrev-ref HEAD'));
        assert.ok(log.includes('show-ref --verify --quiet refs/heads/release/v1'));
        assert.ok(log.indexOf('checkout release/v1') < log.indexOf(`checkout -b ${taskBranch}`));

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as { branch?: string };
        assert.equal(updated.branch, taskBranch);
    });
});

void test('findDirtyRepoRootSourcePaths allows task artifacts and telemetry only', () => {
    const dirty = findDirtyRepoRootSourcePaths([
        ' M tasks/example/spec.md',
        '?? tasks/example/handoff.md',
        ' M docs/pipeline-invocations.md',
        ' M docs/task-quality-log.md',
        ' M docs/lessons-learned.md',
        ' M src/feature.ts',
        '?? scripts/local-check.ts',
        '',
    ].join('\n'));

    assert.deepEqual(dirty, ['src/feature.ts', 'scripts/local-check.ts']);
});

void test('ensureBranch rejects first worktree creation when REPO_ROOT has dirty source files', () => {
    withTempDir('run-task-safety-worktree-dirty-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const logPath = path.join(dir, 'git.log');
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'release/v1\n');
        setupFakeGit(fakeGitDir);

        const taskId = 'dirty-worktree-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'release/v1',
            branch: '',
            worktree: true,
            phases: {},
        });

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: logPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'release/v1',
            FAKE_GIT_TASK_BRANCH: `task/${taskId}`,
            FAKE_GIT_STATUS_OUTPUT: ' M src/dirty.ts',
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { ensureBranch } from './scripts/run-task/git.js';",
            `ensureBranch(${JSON.stringify([taskId])});`,
        ].join('\n'), env));

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Worktree creation aborted/);
        assert.match(result.stderr, /src\/dirty\.ts/);

        const log = fs.readFileSync(logPath, 'utf8');
        assert.doesNotMatch(log, /worktree add/);
    });
});

void test('ensureBranch allows first worktree creation when only task artifacts and telemetry are dirty', () => {
    withTempDir('run-task-safety-worktree-allowed-dirty-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const logPath = path.join(dir, 'git.log');
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'release/v1\n');
        setupFakeGit(fakeGitDir);

        const taskId = 'allowed-dirty-worktree';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'release/v1',
            branch: '',
            worktree: true,
            phases: {},
        });

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: logPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'release/v1',
            FAKE_GIT_TASK_BRANCH: `task/${taskId}`,
            FAKE_GIT_STATUS_OUTPUT: [
                ' M tasks/allowed-dirty-worktree/spec.md',
                ' M docs/pipeline-invocations.md',
            ].join('\n'),
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { ensureBranch } from './scripts/run-task/git.js';",
            `ensureBranch(${JSON.stringify([taskId])});`,
        ].join('\n'), env));

        assert.equal(result.status, 0, result.stderr);
        const log = fs.readFileSync(logPath, 'utf8');
        assert.ok(log.includes(`worktree add -b task/${taskId} ${path.join(worktreesRoot, taskId)} release/v1`));
        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as { branch?: string };
        assert.equal(updated.branch, `task/${taskId}`);
    });
});

void test('ensureBranch ticks active heartbeats into the worktree task dir after first worktree creation', () => {
    withTempDir('run-task-safety-worktree-heartbeat-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const logPath = path.join(dir, 'git.log');
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'release/v1\n');
        setupFakeGit(fakeGitDir);

        const taskId = 'heartbeat-worktree-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'release/v1',
            branch: '',
            worktree: true,
            phases: {},
        });

        const sourceTaskDir = path.join(tasksRoot, taskId);
        const worktreeTaskDir = path.join(worktreesRoot, taskId, 'tasks', taskId);
        const sourceHeartbeatFile = path.join(sourceTaskDir, '.heartbeat.json');
        const worktreeHeartbeatFile = path.join(worktreeTaskDir, '.heartbeat.json');

        assert.ok(!fs.existsSync(worktreeHeartbeatFile), 'worktree heartbeat must not exist before worktree creation');

        const childScript = [
            "import fs from 'node:fs';",
            "import path from 'node:path';",
            "import { startHeartbeat } from './scripts/run-task/heartbeat.js';",
            "import { ensureBranch } from './scripts/run-task/git.js';",
            `const taskId = ${JSON.stringify(taskId)};`,
            `const worktreesRoot = ${JSON.stringify(worktreesRoot)};`,
            `const sourceHeartbeatFile = ${JSON.stringify(sourceHeartbeatFile)};`,
            `const sourceTaskDir = ${JSON.stringify(sourceTaskDir)};`,
            "let suppressFlip = false;",
            "const handle = startHeartbeat([taskId], () => {",
            "  if (suppressFlip) return sourceTaskDir;",
            "  const worktreeStatusFile = path.join(worktreesRoot, taskId, 'tasks', taskId, 'status.json');",
            "  return fs.existsSync(worktreeStatusFile)",
            "    ? path.join(worktreesRoot, taskId, 'tasks', taskId)",
            "    : sourceTaskDir;",
            "}, { intervalMs: 999_999 });",
            "try {",
            "  if (!fs.existsSync(sourceHeartbeatFile)) throw new Error('initial heartbeat missing before worktree creation');",
            "  ensureBranch([taskId]);",
            "  suppressFlip = true;",
            "} finally {",
            "  handle.stop();",
            "}",
            "console.log(`CHILD_PID:${process.pid}`);",
        ].join('\n');

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: logPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'release/v1',
            FAKE_GIT_TASK_BRANCH: `task/${taskId}`,
            FAKE_GIT_WORKTREE_STATUS_SOURCE: path.join(sourceTaskDir, 'status.json'),
            FAKE_GIT_WORKTREE_TASK_ID: taskId,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline(childScript, env));

        assert.equal(result.status, 0, result.stderr);
        const childPidMatch = result.stdout.match(/CHILD_PID:(\d+)/);
        assert.ok(childPidMatch, `child pid marker missing from stdout: ${result.stdout}`);
        const childPid = Number(childPidMatch[1]);
        assert.ok(fs.existsSync(worktreeHeartbeatFile), 'worktree heartbeat must be written by the creation-path tick');
        const record = JSON.parse(fs.readFileSync(worktreeHeartbeatFile, 'utf8')) as { pid: number; last_update_ms: number };
        assert.equal(record.pid, childPid);
        assert.ok(Date.now() - record.last_update_ms < 1_000);

        const log = fs.readFileSync(logPath, 'utf8');
        assert.match(log, /worktree add -b task\/heartbeat-worktree-task/);
    });
});

void test('ensureBranch ticks active heartbeats into every bundled worktree task dir after first worktree creation', () => {
    withTempDir('run-task-safety-worktree-bundle-heartbeat-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const logPath = path.join(dir, 'git.log');
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'release/v1\n');
        setupFakeGit(fakeGitDir);

        const primaryTaskId = 'bundle-heartbeat-primary';
        const secondaryTaskId = 'bundle-heartbeat-secondary';
        const taskIds = [primaryTaskId, secondaryTaskId];
        const taskBranch = `task/${primaryTaskId}`;
        const sourcePrimaryTaskDir = path.join(tasksRoot, primaryTaskId);
        const primaryWorktreeTaskDir = path.join(worktreesRoot, primaryTaskId, 'tasks', primaryTaskId);
        const secondaryWorktreeTaskDir = path.join(worktreesRoot, primaryTaskId, 'tasks', secondaryTaskId);

        writeTaskStatus(tasksRoot, primaryTaskId, {
            title: primaryTaskId,
            base_branch: 'release/v1',
            branch: '',
            worktree: true,
            phases: {},
        });
        writeTaskStatus(tasksRoot, secondaryTaskId, {
            title: secondaryTaskId,
            base_branch: 'release/v1',
            branch: '',
            worktree: true,
            phases: {},
        });

        const childScript = [
            "import fs from 'node:fs';",
            "import path from 'node:path';",
            "import { startHeartbeat } from './scripts/run-task/heartbeat.js';",
            "import { ensureBranch } from './scripts/run-task/git.js';",
            `const taskIds = ${JSON.stringify(taskIds)};`,
            `const primaryTaskId = ${JSON.stringify(primaryTaskId)};`,
            `const tasksRoot = ${JSON.stringify(tasksRoot)};`,
            `const worktreesRoot = ${JSON.stringify(worktreesRoot)};`,
            `const sourcePrimaryTaskDir = ${JSON.stringify(sourcePrimaryTaskDir)};`,
            `const primaryWorktreeTaskDir = ${JSON.stringify(primaryWorktreeTaskDir)};`,
            `const secondaryWorktreeTaskDir = ${JSON.stringify(secondaryWorktreeTaskDir)};`,
            "const resolveTaskDir = (taskId) => {",
            "  const sourceStatusPath = path.join(tasksRoot, taskId, 'status.json');",
            "  if (taskId === primaryTaskId && fs.existsSync(path.join(primaryWorktreeTaskDir, 'status.json'))) {",
            "    return primaryWorktreeTaskDir;",
            "  }",
            "  if (fs.existsSync(sourceStatusPath)) {",
            "    const status = JSON.parse(fs.readFileSync(sourceStatusPath, 'utf8'));",
            "    if (status.worktree === true && String(status.branch ?? '').trim()) {",
            "      return path.join(worktreesRoot, primaryTaskId, 'tasks', taskId);",
            "    }",
            "  }",
            "  return path.join(tasksRoot, taskId);",
            "};",
            "startHeartbeat(taskIds, resolveTaskDir, { intervalMs: 999_999 });",
            "if (!fs.existsSync(sourcePrimaryTaskDir + '/.heartbeat.json')) throw new Error('initial primary heartbeat missing before worktree creation');",
            "if (!fs.existsSync(path.join(tasksRoot, taskIds[1], '.heartbeat.json'))) throw new Error('initial secondary heartbeat missing before worktree creation');",
            "ensureBranch(taskIds);",
            "for (const taskId of taskIds) {",
            "  const worktreeHeartbeatFile = path.join(worktreesRoot, primaryTaskId, 'tasks', taskId, '.heartbeat.json');",
            "  if (!fs.existsSync(worktreeHeartbeatFile)) throw new Error(`${taskId} worktree heartbeat missing after branch recording`);",
            "  const record = JSON.parse(fs.readFileSync(worktreeHeartbeatFile, 'utf8'));",
            "  if (record.pid !== process.pid) throw new Error(`${taskId} heartbeat pid mismatch`);",
            "  if (Date.now() - record.last_update_ms >= 1_000) throw new Error(`${taskId} heartbeat stale after branch recording`);",
            "}",
            "console.log(`CHILD_PID:${process.pid}`);",
        ].join('\n');

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: logPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'release/v1',
            FAKE_GIT_TASK_BRANCH: taskBranch,
            FAKE_GIT_WORKTREE_STATUS_SOURCE: path.join(sourcePrimaryTaskDir, 'status.json'),
            FAKE_GIT_WORKTREE_TASK_ID: primaryTaskId,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline(childScript, env));

        const log = fs.readFileSync(logPath, 'utf8');
        assert.ok(log.includes(`worktree add -b ${taskBranch} ${path.join(worktreesRoot, primaryTaskId)} release/v1`));
        assert.equal(result.status, 0, result.stderr);
        const childPidMatch = result.stdout.match(/CHILD_PID:(\d+)/);
        assert.ok(childPidMatch, `child pid marker missing from stdout: ${result.stdout}`);
        const childPid = Number(childPidMatch[1]);
        for (const taskId of taskIds) {
            const worktreeHeartbeatFile = path.join(worktreesRoot, primaryTaskId, 'tasks', taskId, '.heartbeat.json');
            assert.ok(fs.existsSync(worktreeHeartbeatFile), `${taskId} worktree heartbeat must exist after branch recording`);
            const record = JSON.parse(fs.readFileSync(worktreeHeartbeatFile, 'utf8')) as { pid: number; last_update_ms: number };
            assert.equal(record.pid, childPid);
            assert.ok(Date.now() - record.last_update_ms < 1_000);
        }
        const updatedPrimary = JSON.parse(fs.readFileSync(path.join(tasksRoot, primaryTaskId, 'status.json'), 'utf8')) as { branch?: string };
        const updatedSecondary = JSON.parse(fs.readFileSync(path.join(tasksRoot, secondaryTaskId, 'status.json'), 'utf8')) as { branch?: string };
        assert.equal(updatedPrimary.branch, taskBranch);
        assert.equal(updatedSecondary.branch, taskBranch);
    });
});

void test('ensureBranch force-bypasses dirty source guard for first worktree creation', () => {
    withTempDir('run-task-safety-worktree-dirty-force-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const logPath = path.join(dir, 'git.log');
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'release/v1\n');
        setupFakeGit(fakeGitDir);

        const taskId = 'force-dirty-worktree';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'release/v1',
            branch: '',
            worktree: true,
            phases: {},
        });

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: logPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'release/v1',
            FAKE_GIT_TASK_BRANCH: `task/${taskId}`,
            FAKE_GIT_STATUS_OUTPUT: ' M src/dirty.ts',
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { ensureBranch } from './scripts/run-task/git.js';",
            `ensureBranch(${JSON.stringify([taskId])}, { force: true });`,
        ].join('\n'), env));

        assert.equal(result.status, 0, result.stderr);
        const log = fs.readFileSync(logPath, 'utf8');
        assert.ok(log.includes(`worktree add -b task/${taskId} ${path.join(worktreesRoot, taskId)} release/v1`));
    });
});

void test('ensureBranch bypasses dirty source guard when worktree branch is already recorded', () => {
    withTempDir('run-task-safety-worktree-existing-dirty-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const logPath = path.join(dir, 'git.log');
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'release/v1\n');
        setupFakeGit(fakeGitDir);

        const taskId = 'existing-dirty-worktree';
        const taskBranch = `task/${taskId}`;
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'release/v1',
            branch: taskBranch,
            worktree: true,
            phases: {},
        });

        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${path.join(worktreesRoot, taskId)}`,
            'HEAD abc123',
            `branch refs/heads/${taskBranch}`,
            '',
        ].join('\n'), 'utf8');

        withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: logPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'release/v1',
            FAKE_GIT_TASK_BRANCH: taskBranch,
            FAKE_GIT_STATUS_OUTPUT: ' M src/dirty.ts',
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, () => {
            ensureBranch([taskId]);
        });

        const log = fs.readFileSync(logPath, 'utf8');
        assert.doesNotMatch(log, /status --porcelain=v1 -uall/);
        assert.doesNotMatch(log, /worktree add/);
        assert.match(log, /worktree list --porcelain/);
    });
});

void test('ensureCheckedOutBaseBranch switches to the declared base before shipping', () => {
    withTempDir('run-task-safety-ship-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const logPath = path.join(dir, 'git.log');
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/release-task\n');
        setupFakeGit(fakeGitDir);

        const taskId = 'release-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'release/v1',
            branch: `task/${taskId}`,
            worktree: false,
            phases: {},
        });

        withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: logPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'release/v1',
            FAKE_GIT_TASK_BRANCH: `task/${taskId}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        }, () => {
            const base = ensureCheckedOutBaseBranch([taskId]);
            assert.equal(base, 'release/v1');
        });

        const log = fs.readFileSync(logPath, 'utf8').trim().split('\n');
        assert.ok(log.includes('rev-parse --abbrev-ref HEAD'));
        assert.ok(log.includes('show-ref --verify --quiet refs/heads/release/v1'));
        assert.ok(log.includes('checkout release/v1'));
    });
});

void test('commitArchiveChanges stops before push when archive commit fails', () => {
    withTempDir('run-task-safety-archive-', dir => {
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const logPath = path.join(dir, 'git.log');
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'main\n');
        setupFakeGit(fakeGitDir);

        withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: logPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'main',
            FAKE_GIT_TASK_BRANCH: 'task/example',
            FAKE_GIT_DIFF_OUTPUT: 'tasks/example/status.json',
            FAKE_GIT_FAIL_COMMIT: '1',
        }, () => {
            const result = commitArchiveChanges(['example'], 'main', ['tasks/example']);
            assert.deepEqual(result, { committed: false, stderr: 'commit failed' });
        });

        const log = fs.readFileSync(logPath, 'utf8');
        assert.match(log, /add -A -- tasks\/example/);
        assert.match(log, /diff --cached --name-only/);
        assert.match(log, /commit -m chore: archive example/);
        assert.doesNotMatch(log, /push origin main/);
    });
});

void test('resolveTaskCwd routes worktree-backed secondary tasks to the primary worktree', () => {
    withTempDir('run-task-safety-worktree-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/shared\n');
        setupFakeGit(fakeGitDir);

        const primaryTaskId = 'task-a';
        const secondaryTaskId = 'task-b';
        const primaryWorktree = path.join(worktreesRoot, primaryTaskId);
        fs.mkdirSync(path.join(primaryWorktree, 'tasks', primaryTaskId), { recursive: true });
        fs.writeFileSync(path.join(primaryWorktree, 'tasks', primaryTaskId, 'status.json'), '{}\n', 'utf8');

        writeTaskStatus(tasksRoot, primaryTaskId, {
            title: primaryTaskId,
            base_branch: 'main',
            branch: 'task/shared',
            worktree: true,
            phases: {},
        });
        writeTaskStatus(tasksRoot, secondaryTaskId, {
            title: secondaryTaskId,
            base_branch: 'main',
            branch: 'task/shared',
            worktree: true,
            phases: {},
        });

        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${primaryWorktree}`,
            'HEAD abc123',
            'branch refs/heads/task/shared',
            '',
        ].join('\n'), 'utf8');

        withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, () => {
            const cwd = resolveTaskCwd(secondaryTaskId);
            assert.equal(cwd, primaryWorktree);
        });
    });
});

void test('resolveTaskCwd fails closed when a worktree-backed task has no available worktree', () => {
    withTempDir('run-task-safety-worktree-missing-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'main\n');
        setupFakeGit(fakeGitDir);

        const taskId = 'orphaned-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'main',
            branch: 'task/orphaned',
            worktree: true,
            phases: {},
        });

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { resolveTaskCwd } from './scripts/run-task/state.js';",
            `console.log(resolveTaskCwd(${JSON.stringify(taskId)}));`,
        ].join('\n'), env));

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Worktree for task 'orphaned-task' is expected but missing/);
    });
});

void test('getActiveCwd fails closed when a worktree-backed bundle has no available worktree', () => {
    withTempDir('run-task-safety-worktree-active-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'bundle-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'main',
            branch: 'task/bundle',
            worktree: true,
            phases: {},
        });

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { getActiveCwd } from './scripts/run-task/worktree.js';",
            `console.log(getActiveCwd(${JSON.stringify([taskId])}));`,
        ].join('\n'), env));

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Worktree for task 'bundle-task' is expected but missing/);
    });
});

// Probe whether the .git directory is writable before attempting to create a
// real worktree. Two environments legitimately block this:
//   1. Codex's sandbox (blocks all .git/ writes by design)
//   2. Running from inside a linked worktree (.git is a file, not a dir)
// In both cases the underlying code is correct — skipping avoids a false
// EPERM failure that has nothing to do with the behavior under test.
const gitDirWritable = (() => {
    const probe = path.join(REPO_ROOT, '.git', '.worktree-test-probe');
    try {
        fs.writeFileSync(probe, '');
        fs.unlinkSync(probe);
        return true;
    } catch {
        return false;
    }
})();

void test('REPO_ROOT stays anchored to the supervising checkout when imported from a linked worktree', {
    skip: gitDirWritable ? false : '.git/ writes are restricted in this environment (sandbox or linked worktree)',
}, () => {
    withTempDir('run-task-root-regression-', dir => {
        const worktreeDir = path.join(dir, 'linked-worktree');
        const addResult = spawnSync('git', ['worktree', 'add', '--detach', worktreeDir, 'HEAD'], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
        });
        assert.equal(addResult.status, 0, addResult.stderr ?? addResult.stdout ?? 'git worktree add failed');

        try {
            const result = runNodeInline([
                `import(${JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'scripts/run-task/env.ts')).href)})`,
                '.then(m => { console.log(m.REPO_ROOT); })',
                '.catch(err => { console.error(err); process.exit(1); });',
            ].join(''), process.env, worktreeDir);

            assert.equal(result.status, 0, result.stderr);
            assert.equal(result.stdout.trim(), REPO_ROOT);
        } finally {
            spawnSync('git', ['worktree', 'remove', '--force', worktreeDir], {
                cwd: REPO_ROOT,
                encoding: 'utf8',
            });
        }
    });
});

void test('buildHumanReviewStagePaths includes only task artifacts, telemetry, and affected managed docs', () => {
    const paths = buildHumanReviewStagePaths(['task-a'], new Set(['docs/codebase-map.md', 'docs/patterns.md']), [
        {
            raw: '?? tasks/task-a/handoff.md',
            indexStatus: '?',
            worktreeStatus: '?',
            paths: ['tasks/task-a/handoff.md'],
        },
        {
            raw: ' M docs/architecture.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['docs/architecture.md'],
        },
        {
            raw: ' M docs/codebase-map.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['docs/codebase-map.md'],
        },
        {
            raw: ' M docs/decisions.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['docs/decisions.md'],
        },
        {
            raw: ' M docs/patterns.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['docs/patterns.md'],
        },
        {
            raw: ' M docs/lessons-learned.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['docs/lessons-learned.md'],
        },
    ]);

    assert.deepEqual(paths, [
        'tasks/task-a',
        'docs/lessons-learned.md',
        'docs/codebase-map.md',
        'docs/patterns.md',
    ]);
});

void test('taskDirFor returns REPO_ROOT task dir before a worktree branch is recorded', () => {
    withTempDir('run-task-state-pre-impl-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'state-pre';
        writeTaskStatus(path.join(localDir, 'tasks'), taskId, {
            ...makeCompleteStatus(taskId, ''),
            branch: '',
            worktree: true,
        });

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'scripts/run-task/state.ts')).href)})`,
            `.then(m => { console.log(m.taskDirFor(${JSON.stringify(taskId)})); })`,
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join(''), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: path.join(dir, 'worktrees'),
        }), localDir);

        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), path.join(fs.realpathSync(localDir), 'tasks', taskId));
    });
});

void test('taskDirFor returns the task worktree dir after worktree status exists', () => {
    withTempDir('run-task-state-post-impl-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'state-post';
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        const status = {
            ...makeCompleteStatus(taskId, `task/${taskId}`),
            branch: `task/${taskId}`,
            worktree: true,
        };
        writeTaskStatus(path.join(localDir, 'tasks'), taskId, status);
        writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'scripts/run-task/state.ts')).href)})`,
            `.then(m => { console.log(m.taskDirFor(${JSON.stringify(taskId)})); })`,
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join(''), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
        }), localDir);

        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), path.join(worktreeDir, 'tasks', taskId), result.stderr);
    });
});

void test('parseAffectedFilesFromSpec reads the worktree spec when one exists', () => {
    withTempDir('run-task-parser-worktree-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'parser-worktree';
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        const status = {
            ...makeCompleteStatus(taskId, `task/${taskId}`),
            branch: `task/${taskId}`,
            worktree: true,
        };
        writeTaskStatus(path.join(localDir, 'tasks'), taskId, status);
        writeAffectedFilesSpec(path.join(localDir, 'tasks'), taskId, ['`docs/decisions.md`']);
        writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
        writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), taskId, ['`docs/codebase-map.md`']);

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'scripts/run-task/validation.ts')).href)})`,
            `.then(m => { console.log(JSON.stringify(m.parseAffectedFilesFromSpec(${JSON.stringify(taskId)}))); })`,
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join(''), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
        }), localDir);

        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout) as { files: string[]; malformed: unknown[] }, {
            files: ['docs/codebase-map.md'],
            malformed: [],
        });
    });
});

void test('commitTaskArtifactsToBase absorbs dirty pre-implement telemetry in a separate commit', () => {
    withTempDir('run-task-telemetry-absorb-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'telemetry-absorb';
        writeTaskStatus(path.join(localDir, 'tasks'), taskId, makeCompleteStatus(taskId, ''));
        fs.mkdirSync(path.join(localDir, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), 'pre-implement row\n', 'utf8');

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'scripts/run-task/git.ts')).href)})`,
            `.then(m => { m.commitTaskArtifactsToBase([${JSON.stringify(taskId)}], new Set()); })`,
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join(''), childEnvWithoutTasksOverride(), localDir);

        assert.equal(result.status, 0, result.stderr);
        const status = spawnSync('git', ['status', '--porcelain', '--', 'docs/pipeline-invocations.md'], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.equal(status.stdout.trim(), '');
        const log = spawnSync('git', ['log', '--format=%s', '-2'], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.match(log.stdout, /chore: absorb pre-implement telemetry into scaffold for telemetry-absorb/);
        assert.match(log.stdout, /task\(telemetry-absorb\): commit artifacts pre-pipeline/);
    });
});

void test('runImplementPhase writes metrics and task artifacts only in the worktree after scaffold commit', () => {
    withTempDir('run-task-implement-worktree-ssot-', dir => {
        const taskId = 'implement-ssot';
        const { localDir } = makeGitFixture(dir);
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);
        writeExecutable(fakeBins, 'codex', [
            'if [ "${1:-}" = "exec" ]; then',
            `  mkdir -p tasks/${taskId}`,
            `  printf "%s\\n" "worktree handoff" > tasks/${taskId}/handoff.md`,
            'fi',
            'exit 0',
        ]);
        fs.mkdirSync(path.join(localDir, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), 'baseline telemetry\n', 'utf8');
        gitIn(localDir, 'add', 'docs/pipeline-invocations.md');
        gitIn(localDir, 'commit', '-m', 'add telemetry baseline');

        const status = {
            ...makeCompleteStatus(taskId, ''),
            branch: '',
            base_branch: 'main',
            worktree: true,
            phases: {
                spec: { status: 'done', agent: 'claude' },
                spec_review: { status: 'done', agent: 'codex', verdict: 'approved' },
                plan: { status: 'done', agent: 'claude' },
                implement: { status: 'pending', agent: 'codex' },
                code_review: { status: 'pending', agent: 'claude', verdict: '' },
                qa: { status: 'pending', agent: 'claude' },
                human_review: { status: 'pending', agent: 'human' },
            },
        };
        writeTaskStatus(path.join(localDir, 'tasks'), taskId, status);
        fs.writeFileSync(path.join(localDir, 'tasks', taskId, 'spec.md'), '# Spec\n\n## Acceptance Criteria\n\n- [ ] AC-1: Fixture\n', 'utf8');
        fs.writeFileSync(path.join(localDir, 'tasks', taskId, 'plan.md'), '# Plan\n', 'utf8');
        fs.writeFileSync(path.join(localDir, 'tasks', taskId, 'handoff.md'), 'root scaffold\n', 'utf8');

        const childEnv = childEnvWithoutTasksOverride({
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_WORKTREES_ROOT: worktreesRoot,
            CANON_METRICS_FILE_OVERRIDE: '',
        });
        const result = spawnSync(process.execPath, [
            '--import',
            path.join(WORKTREE_ROOT, 'tests', 'md-loader-register.mjs'),
            '--import',
            TSX_LOADER,
            '-e',
            [
                `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'scripts/run-task/phases/implement.ts')).href)})`,
                '.then(async m => {',
                '  const fs = await import("node:fs");',
                `  const status = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(localDir, 'tasks', taskId, 'status.json'))}, 'utf8'));`,
                '  await m.runImplementPhase({',
                `    tasks: [{ taskId: ${JSON.stringify(taskId)}, title: ${JSON.stringify(taskId)}, specReviewVerdict: 'approved', iterations: 0, iterations_current_loop: 0, iterations_total: 0, rerouteCount: 0, status }],`,
                "    tier: 'full',",
                '    isBundle: false,',
                '  }, false, null);',
                '})',
                '.catch(err => { console.error(err); process.exit(1); });',
            ].join('\n'),
        ], {
            cwd: localDir,
            encoding: 'utf8',
            env: childEnv,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.equal((result.stdout.match(/git push origin main/g) ?? []).length, 1);
        const rootTaskStatus = spawnSync('git', ['status', '--porcelain', '--', `tasks/${taskId}`], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.equal(rootTaskStatus.stdout.trim(), '');
        assert.equal(fs.readFileSync(path.join(localDir, 'docs', 'pipeline-invocations.md'), 'utf8'), 'baseline telemetry\n');
        assert.match(fs.readFileSync(path.join(worktreeDir, 'docs', 'pipeline-invocations.md'), 'utf8'), /implement-ssot/);
        assert.equal(fs.readFileSync(path.join(localDir, 'tasks', taskId, 'handoff.md'), 'utf8'), 'root scaffold\n');
        assert.equal(fs.readFileSync(path.join(worktreeDir, 'tasks', taskId, 'handoff.md'), 'utf8'), 'worktree handoff\n');

        const secondResult = spawnSync(process.execPath, [
            '--import',
            path.join(WORKTREE_ROOT, 'tests', 'md-loader-register.mjs'),
            '--import',
            TSX_LOADER,
            '-e',
            [
                `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'scripts/run-task/phases/implement.ts')).href)})`,
                '.then(async m => {',
                '  const fs = await import("node:fs");',
                `  const status = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(worktreeDir, 'tasks', taskId, 'status.json'))}, 'utf8'));`,
                '  await m.runImplementPhase({',
                `    tasks: [{ taskId: ${JSON.stringify(taskId)}, title: ${JSON.stringify(taskId)}, specReviewVerdict: 'approved', iterations: 0, iterations_current_loop: 0, iterations_total: 0, rerouteCount: 0, status }],`,
                "    tier: 'full',",
                '    isBundle: false,',
                '  }, false, null);',
                '})',
                '.catch(err => { console.error(err); process.exit(1); });',
            ].join('\n'),
        ], {
            cwd: localDir,
            encoding: 'utf8',
            env: childEnv,
        });
        assert.equal(secondResult.status, 0, secondResult.stderr);
        assert.doesNotMatch(secondResult.stdout, /git push origin main/);

        if (fs.existsSync(worktreeDir)) {
            spawnSync('git', ['worktree', 'remove', '--force', worktreeDir], {
                cwd: localDir,
                encoding: 'utf8',
            });
        }
    });
});

void test('formatCompleteStateBanner renders the open_pr state with the merge-next command', () => {
    const banner = formatCompleteStateBanner(['task-a'], {
        kind: 'open_pr',
        branch: 'task/task-a',
        prNum: 42,
        prUrl: 'https://github.com/x/y/pull/42',
    });

    assert.match(banner, /TASK COMPLETE — already past human_review/);
    assert.match(banner, /Open PR: #42/);
    assert.match(banner, /canon run task-a --ship/);
});

void test('formatCompleteStateBanner renders the pushed_no_pr state with the retry command', () => {
    const banner = formatCompleteStateBanner(['task-a'], {
        kind: 'pushed_no_pr',
        branch: 'task/task-a',
        baseBranch: 'dev',
    });

    assert.match(banner, /Branch task\/task-a is on origin but no open PR/);
    assert.match(banner, /canon run task-a --pr/);
    assert.match(banner, /canon run task-a --ship/);
});

void test('formatCompleteStateBanner renders the unpushed state with the manual-merge fallback', () => {
    const banner = formatCompleteStateBanner(['task-a'], {
        kind: 'unpushed',
        branch: 'task/task-a',
        baseBranch: 'dev',
    });

    assert.match(banner, /Local branch task\/task-a is not on origin/);
    assert.match(banner, /merge to dev manually/);
});

void test('formatExistingPRMessage returns the idempotent existing-PR message', () => {
    assert.equal(
        formatExistingPRMessage(17, 'https://github.com/x/y/pull/17'),
        'Existing draft PR: #17 (https://github.com/x/y/pull/17)',
    );
});

// ── resolveCanonPrBody (ninja-mode PR body) ─────────────────────────────────

void test('resolveCanonPrBody: default (no env var) returns null so gh uses its own defaults', () => {
    assert.equal(resolveCanonPrBody(['foo'], 'Foo task title', {}), null);
});

void test('resolveCanonPrBody: empty env var still returns null (treated as opt-out)', () => {
    assert.equal(resolveCanonPrBody(['foo'], 'Foo task title', { CANON_PR_BODY: '' }), null);
});

void test('resolveCanonPrBody: env var expands $LABEL and $TITLE placeholders for single task', () => {
    const out = resolveCanonPrBody(['fix-hover'], 'Fix hover state', {
        CANON_PR_BODY: 'Generated for $LABEL\n\nTitle: $TITLE',
    });
    assert.equal(out, 'Generated for fix-hover\n\nTitle: Fix hover state');
});

void test('resolveCanonPrBody: env var joins multiple task IDs into $LABEL', () => {
    const out = resolveCanonPrBody(['a', 'b', 'c'], 'Bundle title', {
        CANON_PR_BODY: 'Tasks: $LABEL',
    });
    assert.equal(out, 'Tasks: a, b, c');
});

// ── resolveQaPrBody (QA drafted PR body) ───────────────────────────────────

void test('resolveQaPrBody: returns body-file for a populated single-task body', () => {
    withTempDir('canon-pr-body-', dir => {
        const taskId = 'task-a';
        const tasksDir = path.join(dir, 'tasks');
        const prBodyPath = path.join(tasksDir, taskId, 'pr-body.md');
        fs.mkdirSync(path.dirname(prBodyPath), { recursive: true });
        fs.writeFileSync(prBodyPath, [
            '# Summary',
            '',
            '- Filled by QA.',
            '',
        ].join('\n'));

        const result = resolveQaPrBody([taskId], dir);
        assert.deepEqual(result, { kind: 'body-file', path: prBodyPath });
    });
});

void test('resolveQaPrBody: returns fallback for a missing single-task body', () => {
    withTempDir('canon-pr-body-missing-', dir => {
        const result = resolveQaPrBody(['task-a'], dir);
        assert.deepEqual(result, { kind: 'fallback', reason: 'pr-body.md not found' });
    });
});

void test('resolveQaPrBody: returns fallback for the stub template', () => {
    withTempDir('canon-pr-body-stub-', dir => {
        const taskId = 'task-a';
        const prBodyPath = path.join(dir, 'tasks', taskId, 'pr-body.md');
        fs.mkdirSync(path.dirname(prBodyPath), { recursive: true });
        fs.writeFileSync(prBodyPath, [
            '<!-- [pr-body-stub] QA fills this file during the qa phase. Do not edit manually before QA runs. -->',
            '',
            '# PR Body: [TASK-ID] - [Title]',
            '',
        ].join('\n'));

        const result = resolveQaPrBody([taskId], dir);
        assert.deepEqual(result, { kind: 'fallback', reason: 'pr-body.md is still the stub template' });
    });
});

void test('resolveQaPrBody: bundles fall back because per-task bodies are not combined', () => {
    withTempDir('canon-pr-body-bundle-', dir => {
        const result = resolveQaPrBody(['task-a', 'task-b'], dir);
        assert.deepEqual(result, {
            kind: 'fallback',
            reason: 'bundle: per-task pr-body.md files are not combined in this version',
        });
    });
});

void test('findPullRequestTemplate: returns null when no template exists', () => {
    withTempDir('canon-pr-template-', dir => {
        assert.equal(findPullRequestTemplate(dir), null);
    });
});

void test('findPullRequestTemplate: finds .github/pull_request_template.md', () => {
    withTempDir('canon-pr-template-', dir => {
        const githubDir = path.join(dir, '.github');
        fs.mkdirSync(githubDir, { recursive: true });
        const expected = path.join(githubDir, 'pull_request_template.md');
        fs.writeFileSync(expected, '## Summary\n');
        assert.equal(findPullRequestTemplate(dir), expected);
    });
});

void test('findPullRequestTemplate: docs/ subdirectory location', () => {
    // Tests the docs/ fallback location in the candidate list — separate from
    // the .github/ case-sensitivity story (macOS treats lowercase + uppercase
    // basenames as the same file there, so testing both adds no coverage).
    withTempDir('canon-pr-template-', dir => {
        const docsDir = path.join(dir, 'docs');
        fs.mkdirSync(docsDir, { recursive: true });
        const expected = path.join(docsDir, 'pull_request_template.md');
        fs.writeFileSync(expected, '## Summary\n');
        assert.equal(findPullRequestTemplate(dir), expected);
    });
});

void test('main prints the complete-phase banner when the task is already complete', () => {
    withTempDir('run-task-complete-banner-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        writeTaskStatus(tasksRoot, 'task-a', makeCompleteStatus('task-a', 'task/task-a'));
        writeTaskStatus(tasksRoot, 'task-b', makeCompleteStatus('task-b', 'task/task-a'));
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', 'task-b'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GH_PR_NUMBER: '88',
            FAKE_GH_PR_URL: 'https://github.com/x/y/pull/88',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /TASK COMPLETE — already past human_review/);
        assert.equal((result.stdout.match(/TASK COMPLETE — already past human_review/g) ?? []).length, 1);
        assert.match(result.stdout, /canon run task-a task-b --ship/);
    });
});

void test('main prints the state-aware pushed_no_pr banner when the task is complete', () => {
    withTempDir('run-task-complete-pushed-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        writeTaskStatus(tasksRoot, 'task-a', makeCompleteStatus('task-a', 'task/task-a'));
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'task-a'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /TASK COMPLETE — already past human_review/);
        assert.match(result.stdout, /no open PR/);
        assert.match(result.stdout, /canon run task-a --pr/);
    });
});

void test('main prints the state-aware unpushed banner when the task is complete', () => {
    withTempDir('run-task-complete-unpushed-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        writeTaskStatus(tasksRoot, 'task-a', makeCompleteStatus('task-a', 'task/task-a'));
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'task-a'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '0',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /TASK COMPLETE — already past human_review/);
        assert.match(result.stdout, /not on origin/);
        assert.match(result.stdout, /canon run task-a --pr/);
    });
});

void test('main --pr on complete is idempotent when an open PR already exists', () => {
    withTempDir('run-task-complete-pr-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        writeTaskStatus(tasksRoot, 'task-a', makeCompleteStatus('task-a', 'task/task-a'));
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--pr'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GH_PR_NUMBER: '88',
            FAKE_GH_PR_URL: 'https://github.com/x/y/pull/88',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Existing draft PR: #88 \(https:\/\/github\.com\/x\/y\/pull\/88\)/);
        assert.doesNotMatch(result.stdout, /TASK COMPLETE — already past human_review/);
        // Codex P1 on release PR #82: push MUST run even when an open PR is
        // already detected — clean tree + open PR doesn't guarantee origin
        // matches HEAD (new local commits after the PR was opened would be
        // silently dropped without this push).
        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.match(gitLog, /^push origin task\/task-a$/m, 'push must run on PR-exists branch');
    });
});

void test('main --pr on complete logs the pr-body fallback when pr-body.md is missing', () => {
    withTempDir('run-task-complete-pr-body-fallback-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, 'task-a');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        fs.mkdirSync(worktreeDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const status = makeCompleteStatus('task-a', 'task/task-a');
        status.worktree = true;
        writeTaskStatus(tasksRoot, 'task-a', status);
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');
        const prStateFile = path.join(dir, 'gh-pr-state.txt');

        const result = runNodeInline([
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--pr'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GH_LOG: path.join(dir, 'gh.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GH_PR_STATE_FILE: prStateFile,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /PR body fallback \(pr-body\.md not found\) — falling back to repo PR template or --fill/);
        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.match(gitLog, /^push origin task\/task-a$/m, 'push must run before falling back to the repo template');
        const ghLog = fs.readFileSync(path.join(dir, 'gh.log'), 'utf8');
        assert.match(ghLog, /pr create .*--body-file .*pull_request_template\.md/m);
    });
});

void test('main --pr at human_review is idempotent when an open PR already exists', () => {
    withTempDir('run-task-human-review-pr-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const status = makeCompleteStatus('task-a', 'task/task-a');
        const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
        phases.human_review = { status: 'pending', agent: 'human' };
        writeTaskStatus(tasksRoot, 'task-a', status);
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--pr'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GH_PR_NUMBER: '88',
            FAKE_GH_PR_URL: 'https://github.com/x/y/pull/88',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Existing draft PR: #88 \(https:\/\/github\.com\/x\/y\/pull\/88\)/);
        assert.doesNotMatch(result.stdout, /TASK COMPLETE — already past human_review/);
        // Codex P1 on release PR #82: see complete-phase test above for full
        // rationale — push must run even when an open PR is detected.
        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.match(gitLog, /^push origin task\/task-a$/m, 'push must run on PR-exists branch');
    });
});

void test('main --pr does NOT match an open PR on the wrong base (Codex P2 on release PR #82 audit)', () => {
    // makeCompleteStatus() declares base_branch: 'main', so a task with an
    // open PR against an unrelated base ('release/v9') must not be picked
    // up as the "existing PR" for idempotent --pr. Before the fix,
    // findOpenPRNumber ignored --base entirely; the wrong-base PR's URL
    // would be printed and (worse) mergeOpenPRsAndPull would squash-merge
    // it into the wrong base on --ship.
    withTempDir('run-task-wrong-base-pr-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        writeTaskStatus(tasksRoot, 'task-a', makeCompleteStatus('task-a', 'task/task-a'));
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--pr'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GH_PR_NUMBER: '99',
            FAKE_GH_PR_URL: 'https://github.com/x/y/pull/99',
            FAKE_GIT_BASE_BRANCH: 'main',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            // gh shim: only return PR #99 if --base release/v9 (task expects main).
            FAKE_GH_PR_BASE: 'release/v9',
        });

        // The wrong-base PR must NOT be reported as the existing draft.
        // Note: we don't assert status === 0 because the test doesn't fully
        // wire the push/PR-create happy path (we only care about the
        // idempotency-check branch). The key assertion is the negative one.
        assert.doesNotMatch(result.stdout, /Existing draft PR: #99/);
    });
});

void test('main --pr at human_review with dirty allowed files is idempotent when an open PR already exists (GP #10)', () => {
    // 1.2.0's --pr idempotency only fired on the clean-tree retry path. The
    // dirty-tree commit-then-create path went straight to `gh pr create` and
    // died on its "PR already exists" exit code. GP's starter-preview-renderer
    // bundle hit this when QA finished writing artifacts and `--pr` ran while
    // tasks/<id>/done.md was still uncommitted — the PR (already opened on a
    // prior run) caused canon to exit 1 even though the work succeeded.
    withTempDir('run-task-human-review-pr-dirty-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const status = makeCompleteStatus('task-a', 'task/task-a');
        const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
        phases.human_review = { status: 'pending', agent: 'human' };
        writeTaskStatus(tasksRoot, 'task-a', status);
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--pr'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            // Dirty file is on the allowlist — this is the "QA wrote done.md
            // and canon needs to commit + push + report" path.
            FAKE_GIT_STATUS_OUTPUT: ' M tasks/task-a/done.md',
            FAKE_GIT_DIFF_OUTPUT: 'tasks/task-a/done.md',
            FAKE_GH_PR_NUMBER: '94',
            FAKE_GH_PR_URL: 'https://github.com/x/y/pull/94',
        });

        // 1.3.0 expectation: the existing PR is detected after the commit + push,
        // canon prints the URL, and exits 0. Pre-fix this exited 1 with the
        // `gh pr create` "PR already exists" stderr propagated up.
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Existing draft PR: #94 \(https:\/\/github\.com\/x\/y\/pull\/94\)/);
        // The commit + push must still happen for QA artifacts to reach origin
        // before the PR-exists branch returns.
        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.match(gitLog, /^commit /m, 'commit must run on dirty-tree path');
        assert.match(gitLog, /^push origin task\/task-a$/m, 'push must run on dirty-tree path');
    });
});

void test('main --pr on complete still rejects dirty files outside the human_review allowlist', () => {
    withTempDir('run-task-complete-pr-dirty-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        writeTaskStatus(tasksRoot, 'task-a', makeCompleteStatus('task-a', 'task/task-a'));
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--pr'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_STATUS_OUTPUT: '?? src/rogue.ts',
            FAKE_GH_PR_NUMBER: '88',
            FAKE_GH_PR_URL: 'https://github.com/x/y/pull/88',
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /working tree has dirty files outside the human_review allowlist/);
    });
});

// Fake git: checkout only changes the current-branch marker, so tasks/<id>/ stays on disk.
// This covers complete-state archiving; the real-git tests below cover the non-worktree ENOENT path.
void test('main --ship still works when the task is already complete', () => {
    withTempDir('run-task-complete-ship-', dir => {
        const taskId = 'ship-smoke';
        const repoRoot = process.cwd();
        const taskDir = path.join(repoRoot, 'tasks', taskId);
        const archiveDir = path.join(repoRoot, 'tasks', '_archive', taskId);
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        fs.mkdirSync(taskDir, { recursive: true });
        writeTaskStatus(path.join(repoRoot, 'tasks'), taskId, makeCompleteStatus(taskId, `task/${taskId}`));
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, `task/${taskId}\n`);

        try {
            const result = runNodeInline([
                "import { main } from './scripts/run-task/main.ts';",
                `process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--ship'];`,
                "main().catch(err => { console.error(err); process.exit(1); });",
            ].join('\n'), {
                ...process.env,
                PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
                FAKE_GIT_LOG: path.join(dir, 'git.log'),
                FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
                FAKE_GIT_BASE_BRANCH: 'main',
                FAKE_GIT_TASK_BRANCH: `task/${taskId}`,
                FAKE_GIT_REMOTE_BRANCH: `task/${taskId}`,
                FAKE_GIT_REMOTE_EXISTS: '0',
                FAKE_GIT_REVLIST_COUNT: '0',
                FAKE_GIT_STATUS_OUTPUT: '',
            });

            assert.equal(result.status, 0, result.stderr);
            assert.match(result.stdout, /Shipped 1 task to _archive\/\./);
        } finally {
            fs.rmSync(taskDir, { recursive: true, force: true });
            fs.rmSync(archiveDir, { recursive: true, force: true });
        }
    });
});

void test('main --ship handles a task with worktree: false when base lacks status.json', () => {
    withTempDir('run-task-ship-non-worktree-', dir => {
        const taskId = 'ship-nw';
        const branch = `task/${taskId}`;
        const { localDir, originDir } = makeGitFixture(dir);
        const fakeBins = path.join(dir, 'fake-bins');
        const worktreesRoot = path.join(dir, 'worktrees');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);

        gitIn(localDir, 'checkout', '-b', branch);
        writeShipTaskArtifacts(localDir, taskId, branch, false);
        gitIn(localDir, 'add', 'tasks');
        gitIn(localDir, 'commit', '-m', `add ${taskId}`);
        const taskTip = execFileSync('git', ['rev-parse', branch], { cwd: localDir, encoding: 'utf8' }).trim();
        gitIn(localDir, 'push', '-u', 'origin', branch);

        simulateShipMergeOnOrigin(dir, originDir, taskId, branch, false);

        const result = runShipTask(taskId, fakeBins, localDir, {
            FAKE_GH_PR_NUMBER: '42',
            FAKE_GH_PR_HEAD: branch,
            FAKE_GH_PR_BASE: 'main',
            FAKE_GH_HEAD_REF_OID: taskTip,
            CANON_WORKTREES_ROOT: worktreesRoot,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Shipped 1 task to _archive\/\./);
        assert.ok(fs.existsSync(path.join(localDir, 'tasks', '_archive', taskId)));
    });
});

void test('main --ship handles a task with worktree: true and tears down the worktree', () => {
    withTempDir('run-task-ship-worktree-', dir => {
        const taskId = 'ship-wt';
        const branch = `task/${taskId}`;
        const { localDir, originDir } = makeGitFixture(dir);
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);

        gitIn(localDir, 'checkout', '-b', branch);
        writeShipTaskArtifacts(localDir, taskId, branch, true);
        gitIn(localDir, 'add', 'tasks');
        gitIn(localDir, 'commit', '-m', `add ${taskId}`);
        const taskTip = execFileSync('git', ['rev-parse', branch], { cwd: localDir, encoding: 'utf8' }).trim();
        gitIn(localDir, 'push', '-u', 'origin', branch);

        gitIn(localDir, 'checkout', 'main');
        fs.mkdirSync(worktreesRoot, { recursive: true });
        gitIn(localDir, 'worktree', 'add', worktreeDir, branch);
        simulateShipMergeOnOrigin(dir, originDir, taskId, branch, true);

        try {
            const result = runShipTask(taskId, fakeBins, localDir, {
                FAKE_GH_PR_NUMBER: '43',
                FAKE_GH_PR_HEAD: branch,
                FAKE_GH_PR_BASE: 'main',
                FAKE_GH_HEAD_REF_OID: taskTip,
                CANON_WORKTREES_ROOT: worktreesRoot,
            });

            assert.equal(result.status, 0, result.stderr);
            assert.match(result.stdout, /Shipped 1 task to _archive\/\./);
            assert.ok(fs.existsSync(path.join(localDir, 'tasks', '_archive', taskId)));
            assert.ok(!fs.existsSync(worktreeDir));
        } finally {
            if (fs.existsSync(worktreeDir)) {
                spawnSync('git', ['worktree', 'remove', '--force', worktreeDir], {
                    cwd: localDir,
                    encoding: 'utf8',
                });
            }
        }
    });
});

void test('enableFullSend writes full_send and clears human_spec_gate for every task', () => {
    withTempDir('run-task-full-send-enable-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        writeTaskStatus(tasksRoot, 'task-a', {
            id: 'task-a',
            title: 'task-a',
            base_branch: 'main',
            human_spec_gate: true,
            full_send: false,
            worktree: false,
            phases: {},
        });
        writeTaskStatus(tasksRoot, 'task-b', {
            id: 'task-b',
            title: 'task-b',
            base_branch: 'main',
            human_spec_gate: true,
            full_send: false,
            worktree: false,
            phases: {},
        });

        withFakeGitEnv({
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        }, () => {
            enableFullSend(['task-a', 'task-b']);
        });

        const statusA = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            full_send?: boolean;
            human_spec_gate?: boolean;
        };
        const statusB = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-b', 'status.json'), 'utf8')) as {
            full_send?: boolean;
            human_spec_gate?: boolean;
        };

        assert.equal(statusA.full_send, true);
        assert.equal(statusA.human_spec_gate, false);
        assert.equal(statusB.full_send, true);
        assert.equal(statusB.human_spec_gate, false);
    });
});

void test('fast-tier spec review keeps the gate when a bundle mixes full-send and normal tasks', () => {
    withTempDir('run-task-full-send-fast-mixed-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        for (const [taskId, fullSend] of [['task-a', true], ['task-b', false]] as const) {
            writeTaskStatus(tasksRoot, taskId, {
                id: taskId,
                title: taskId,
                base_branch: 'main',
                task_size: 'S',
                human_spec_gate: true,
                full_send: fullSend,
                worktree: false,
                phases: {
                    spec: { status: 'done', agent: 'claude' },
                    spec_review: { status: 'pending', agent: 'codex' },
                    plan: { status: 'pending', agent: 'claude' },
                },
            });
            writeApprovedSpecReview(tasksRoot, taskId);
            writePopulatedPlan(tasksRoot, taskId);
        }

        const result = runNodeInline([
            "import { buildPipelineState } from './scripts/run-task/main.ts';",
            "import { runSpecReviewPhase } from './scripts/run-task/phases/spec-review.ts';",
            '(async () => {',
            "  const state = buildPipelineState(['task-a', 'task-b']);",
            '  await runSpecReviewPhase(state, false, null);',
            '})().catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), {
            ...process.env,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /SPEC GATE — Review before Codex implements\./);

        const statusA = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            human_spec_gate?: boolean;
            phases?: { spec_review?: { status?: string }; plan?: { status?: string } };
        };
        const statusB = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-b', 'status.json'), 'utf8')) as {
            human_spec_gate?: boolean;
            phases?: { spec_review?: { status?: string }; plan?: { status?: string } };
        };
        assert.equal(statusA.human_spec_gate, false);
        assert.equal(statusB.human_spec_gate, false);
        assert.equal(statusA.phases?.spec_review?.status, 'pending');
        assert.equal(statusB.phases?.spec_review?.status, 'pending');
        assert.equal(statusA.phases?.plan?.status, 'pending');
        assert.equal(statusB.phases?.plan?.status, 'pending');
    });
});

void test('fast-tier spec review skips the gate when every task is full-send', () => {
    withTempDir('run-task-full-send-fast-all-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        for (const taskId of ['task-a', 'task-b']) {
            writeTaskStatus(tasksRoot, taskId, {
                id: taskId,
                title: taskId,
                base_branch: 'main',
                task_size: 'S',
                human_spec_gate: true,
                full_send: true,
                worktree: false,
                phases: {
                    spec: { status: 'done', agent: 'claude' },
                    spec_review: { status: 'pending', agent: 'codex' },
                    plan: { status: 'pending', agent: 'claude' },
                },
            });
            writeApprovedSpecReview(tasksRoot, taskId);
            writePopulatedPlan(tasksRoot, taskId);
        }

        const result = runNodeInline([
            "import { buildPipelineState } from './scripts/run-task/main.ts';",
            "import { runSpecReviewPhase } from './scripts/run-task/phases/spec-review.ts';",
            '(async () => {',
            "  const state = buildPipelineState(['task-a', 'task-b']);",
            '  await runSpecReviewPhase(state, false, null);',
            '})().catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), {
            ...process.env,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(result.stdout, /SPEC GATE — Review before Codex implements\./);

        const statusA = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            phases?: { spec_review?: { status?: string }; plan?: { status?: string } };
        };
        const statusB = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-b', 'status.json'), 'utf8')) as {
            phases?: { spec_review?: { status?: string }; plan?: { status?: string } };
        };
        assert.equal(statusA.phases?.spec_review?.status, 'done');
        assert.equal(statusB.phases?.spec_review?.status, 'done');
        assert.equal(statusA.phases?.plan?.status, 'done');
        assert.equal(statusB.phases?.plan?.status, 'done');
    });
});

void test('commitHumanReviewFiles(createPR = false) pushes without opening a PR', () => {
    withTempDir('run-task-commit-pr-false-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        writeTaskStatus(tasksRoot, 'task-a', {
            id: 'task-a',
            title: 'task-a',
            base_branch: 'main',
            full_send: false,
            human_spec_gate: false,
            worktree: false,
            phases: {
                human_review: { status: 'pending', agent: 'human' },
            },
        });
        fs.writeFileSync(path.join(tasksRoot, 'task-a', 'handoff.md'), [
            '# Implementation Handoff: task-a',
            '',
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `lint` | Pass | ok |',
            '',
        ].join('\n'), 'utf8');

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');
        const ghLogPath = path.join(dir, 'gh.log');

        const result = runNodeInline([
            "import { commitHumanReviewFiles } from './scripts/run-task/main.ts';",
            `commitHumanReviewFiles(['task-a'], ${JSON.stringify(dir)}, false);`,
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GIT_STATUS_OUTPUT: ' M tasks/task-a/handoff.md',
            FAKE_GIT_DIFF_OUTPUT: 'tasks/task-a/handoff.md',
            FAKE_GH_LOG: ghLogPath,
        });

        assert.equal(result.status, 0, result.stderr);

        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.match(gitLog, /^push origin task\/task-a$/m);
        assert.equal(fs.existsSync(ghLogPath), false);
    });
});

void test('commitHumanReviewFiles(createPR = true) opens a PR on a clean-tree retry', () => {
    withTempDir('run-task-commit-pr-true-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        writeTaskStatus(tasksRoot, 'task-a', {
            id: 'task-a',
            title: 'task-a',
            base_branch: 'main',
            full_send: false,
            human_spec_gate: false,
            worktree: false,
            phases: {
                human_review: { status: 'pending', agent: 'human' },
            },
        });

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');
        const gitLogPath = path.join(dir, 'git.log');
        const ghLogPath = path.join(dir, 'gh.log');
        const prStateFile = path.join(dir, 'gh-pr-state.txt');

        const result = runNodeInline([
            "import { commitHumanReviewFiles } from './scripts/run-task/main.ts';",
            `commitHumanReviewFiles(['task-a'], ${JSON.stringify(dir)}, true);`,
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: gitLogPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GIT_STATUS_OUTPUT: '',
            FAKE_GIT_DIFF_OUTPUT: '',
            FAKE_GH_LOG: ghLogPath,
            FAKE_GH_PR_STATE_FILE: prStateFile,
            FAKE_GH_PR_CREATE_NUMBER: '202',
            FAKE_GH_PR_CREATE_URL: 'https://github.com/x/y/pull/202',
        });

        assert.equal(result.status, 0, result.stderr);

        const gitLog = fs.readFileSync(gitLogPath, 'utf8');
        assert.match(gitLog, /^push origin task\/task-a$/m);
        const ghLog = fs.readFileSync(ghLogPath, 'utf8');
        assert.match(ghLog, /^pr list /m);
        assert.match(ghLog, /^pr create /m);
    });
});

void test('classifyMergeOutcome tolerates clean gh merge exits', () => {
    assert.equal(classifyMergeOutcome({ exitOk: true, mergeConfirmed: false }), 'tolerate');
});

void test('classifyMergeOutcome tolerates failed gh exits when the attempted PR is merged', () => {
    assert.equal(classifyMergeOutcome({ exitOk: false, mergeConfirmed: true }), 'tolerate');
});

void test('classifyMergeOutcome fails failed gh exits when the attempted PR is not merged', () => {
    assert.equal(classifyMergeOutcome({ exitOk: false, mergeConfirmed: false }), 'fail');
});

void test('main --push blocks when local base has unpushed commits', () => {
    withTempDir('run-task-base-divergence-block-', dir => {
        const taskId = 'task-a';
        const { localDir, shortSha } = setupDivergentBaseRepo(dir, taskId);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'scripts/run-task/main.ts')).href)})`,
            `.then(m => {`,
            `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--push'];`,
            `  return m.main();`,
            `})`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }), localDir);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, new RegExp(shortSha));
        assert.match(result.stderr, /--allow-divergent-base/);
        assert.match(result.stderr, /Base divergence detected/);
    });
});

void test('main --push --allow-divergent-base warns and proceeds past the divergence gate', () => {
    withTempDir('run-task-base-divergence-bypass-', dir => {
        const taskId = 'task-a';
        const { localDir, shortSha } = setupDivergentBaseRepo(dir, taskId);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'scripts/run-task/main.ts')).href)})`,
            `.then(m => {`,
            `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--push', '--allow-divergent-base'];`,
            `  return m.main();`,
            `})`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }), localDir);

        const output = combinedOutput(result);
        assert.match(output, /--allow-divergent-base override/);
        assert.match(output, new RegExp(shortSha));
        assert.doesNotMatch(output, /Base divergence detected/);
    });
});

void test('main --full-send --force advances to draft PR and marks human_review done', () => {
    withTempDir('run-task-full-send-tail-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const status = makeCompleteStatus('task-a', 'task/task-a');
        status.delicate = true;
        const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
        phases.qa = { status: 'done', agent: 'claude' };
        phases.human_review = { status: 'pending', agent: 'human' };
        status.full_send = false;
        status.human_spec_gate = true;
        writeTaskStatus(tasksRoot, 'task-a', status);
        fs.writeFileSync(path.join(tasksRoot, 'task-a', 'handoff.md'), [
            '# Implementation Handoff: task-a',
            '',
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `lint` | Pass | ok |',
            '',
        ].join('\n'), 'utf8');

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');
        const prStateFile = path.join(dir, 'gh-pr-state.txt');

        const result = runNodeInline([
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--full-send', '--force'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GH_PR_STATE_FILE: prStateFile,
            FAKE_GH_PR_CREATE_NUMBER: '101',
            FAKE_GH_PR_CREATE_URL: 'https://github.com/x/y/pull/101',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /FULL-SEND COMPLETE — draft PR open\./);
        assert.match(result.stdout, /PR: https:\/\/github\.com\/x\/y\/pull\/101/);
        assert.equal((result.stdout.match(/^  PR: https:\/\/github\.com\/x\/y\/pull\/101$/gm) ?? []).length, 1);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            full_send?: boolean;
            human_spec_gate?: boolean;
            phases?: { human_review?: { status?: string } };
        };
        assert.equal(updated.full_send, true);
        assert.equal(updated.human_spec_gate, false);
        assert.equal(updated.phases?.human_review?.status, 'done');

        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.match(gitLog, /^push origin task\/task-a$/m);
        assert.match(gitLog, /^rev-parse --abbrev-ref HEAD$/m);
        assert.ok(fs.existsSync(prStateFile));
    });
});

void test('main full-send tail reports the PR URL after pinning pr.number', () => {
    withTempDir('run-task-full-send-pr-placeholder-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const status = makeCompleteStatus('task-a', 'task/task-a');
        const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
        phases.qa = { status: 'done', agent: 'claude' };
        phases.human_review = { status: 'pending', agent: 'human' };
        status.full_send = false;
        status.human_spec_gate = true;
        writeTaskStatus(tasksRoot, 'task-a', status);
        fs.writeFileSync(path.join(tasksRoot, 'task-a', 'handoff.md'), [
            '# Implementation Handoff: task-a',
            '',
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `lint` | Pass | ok |',
            '',
        ].join('\n'), 'utf8');

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');
        const prStateFile = path.join(dir, 'gh-pr-state.txt');

        const result = runNodeInline([
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--full-send'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GH_PR_STATE_FILE: prStateFile,
            FAKE_GH_PR_CREATE_NUMBER: '303',
            FAKE_GH_PR_CREATE_URL: 'https://github.com/x/y/pull/303',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /PR: https:\/\/github\.com\/x\/y\/pull\/303/);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            phases?: { human_review?: { status?: string } };
        };
        assert.equal(updated.phases?.human_review?.status, 'done');
    });
});

void test('main full-tier mixed bundle keeps the spec gate when not every task is full-send', () => {
    withTempDir('run-task-full-send-full-mixed-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        for (const [taskId, fullSend] of [['task-a', true], ['task-b', false]] as const) {
            const status = makeCompleteStatus(taskId, 'task/task-a');
            const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
            phases.spec_review = { status: 'pending', agent: 'codex' };
            phases.plan = { status: 'pending', agent: 'claude' };
            status.task_size = 'M';
            status.full_send = fullSend;
            status.human_spec_gate = true;
            writeTaskStatus(tasksRoot, taskId, status);
            writeApprovedSpecReview(tasksRoot, taskId);
        }

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', 'task-b', '--step'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GH_PR_CREATE_NUMBER: '404',
            FAKE_GH_PR_CREATE_URL: 'https://github.com/x/y/pull/404',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /SPEC GATE — Human review required before planning\./);
        assert.match(result.stdout, /When ready: canon run task-a task-b/);

        const statusA = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            human_spec_gate?: boolean;
            phases?: { spec_review?: { status?: string }; plan?: { status?: string } };
        };
        const statusB = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-b', 'status.json'), 'utf8')) as {
            human_spec_gate?: boolean;
            phases?: { spec_review?: { status?: string }; plan?: { status?: string } };
        };
        assert.equal(statusA.human_spec_gate, false);
        assert.equal(statusB.human_spec_gate, false);
        assert.equal(statusA.phases?.spec_review?.status, 'done');
        assert.equal(statusB.phases?.spec_review?.status, 'done');
        assert.equal(statusA.phases?.plan?.status, 'pending');
        assert.equal(statusB.phases?.plan?.status, 'pending');
    });
});

void test('main full-tier all-full-send bundle skips the spec gate', () => {
    withTempDir('run-task-full-send-full-all-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        for (const taskId of ['task-a', 'task-b']) {
            const status = makeCompleteStatus(taskId, 'task/task-a');
            const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
            phases.spec_review = { status: 'pending', agent: 'codex' };
            phases.plan = { status: 'pending', agent: 'claude' };
            status.task_size = 'M';
            status.full_send = true;
            status.human_spec_gate = true;
            writeTaskStatus(tasksRoot, taskId, status);
            writeApprovedSpecReview(tasksRoot, taskId);
        }

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', 'task-b', '--step'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GH_PR_CREATE_NUMBER: '405',
            FAKE_GH_PR_CREATE_URL: 'https://github.com/x/y/pull/405',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(result.stdout, /SPEC GATE — Human review required before planning\./);
        assert.match(result.stdout, /Next phase: plan/);

        const statusA = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            phases?: { spec_review?: { status?: string }; plan?: { status?: string } };
        };
        const statusB = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-b', 'status.json'), 'utf8')) as {
            phases?: { spec_review?: { status?: string }; plan?: { status?: string } };
        };
        assert.equal(statusA.phases?.spec_review?.status, 'done');
        assert.equal(statusB.phases?.spec_review?.status, 'done');
        assert.equal(statusA.phases?.plan?.status, 'pending');
        assert.equal(statusB.phases?.plan?.status, 'pending');
    });
});

void test('main --full-send on a delicate task without --force dies before phase routing', () => {
    withTempDir('run-task-full-send-force-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const status = makeCompleteStatus('task-a', 'task/task-a');
        status.delicate = true;
        status.full_send = false;
        status.human_spec_gate = true;
        writeTaskStatus(tasksRoot, 'task-a', status);

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--full-send'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
        });

        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /--full-send on delicate task 'task-a' requires --force/);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            full_send?: boolean;
            human_spec_gate?: boolean;
        };
        assert.equal(updated.full_send, true);
        assert.equal(updated.human_spec_gate, false);

        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.doesNotMatch(gitLog, /^push /m);
    });
});

void test('commitHumanReviewFiles dies on out-of-scope managed docs with actionable allowlist guidance', () => {
    withTempDir('run-task-human-review-managed-out-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        // Override the harness's qa.status = 'done' (which would auto-allowlist
        // PIPELINE_MANAGED_DOCS per the QA Docs Freshness sweep): the rejection
        // path under test is for managed-doc edits that landed BEFORE qa ran.
        const taskStatus = makeCompleteStatus('task-a', 'task/task-a');
        const phases = taskStatus.phases as Record<string, { status: string }>;
        phases.qa = { ...phases.qa, status: 'in_progress' };
        phases.human_review = { ...phases.human_review, status: 'pending' };
        writeTaskStatus(harness.tasksRoot, 'task-a', taskStatus);

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M docs/codebase-map.md',
            FAKE_GIT_DIFF_OUTPUT: '',
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /allowlist/);
        assert.match(result.stderr, /PIPELINE_MANAGED_DOCS/);
        assert.match(result.stderr, /Affected Files/);
        assert.match(result.stderr, /implement phase/);
        assert.match(result.stderr, /git checkout HEAD --/);
    });
});

void test('commitHumanReviewFiles commits in-scope managed docs and emits one advisory warning', () => {
    withTempDir('run-task-human-review-managed-in-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`docs/codebase-map.md`']);

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M docs/codebase-map.md',
            FAKE_GIT_DIFF_OUTPUT: 'docs/codebase-map.md',
        });

        assert.equal(result.status, 0, result.stderr);
        const output = combinedOutput(result);
        assert.equal((output.match(/WARNING: docs\/codebase-map\.md/g) ?? []).length, 1);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(gitLog, /^add -A -- docs\/codebase-map\.md$/m);
        assert.match(gitLog, /^commit /m);
    });
});

void test('commitHumanReviewFiles auto-allowlists PIPELINE_MANAGED_DOCS once qa.status is done', () => {
    withTempDir('run-task-human-review-qa-done-allowlist-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        // Spec lists no managed docs; harness's makeCompleteStatus already has
        // qa.status = 'done', so the auto-allowlist kicks in.
        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M docs/patterns.md',
            FAKE_GIT_DIFF_OUTPUT: 'docs/patterns.md',
        });

        assert.equal(result.status, 0, result.stderr);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(gitLog, /^add -A -- docs\/patterns\.md$/m);
        assert.match(gitLog, /^commit /m);
    });
});

void test('commitHumanReviewFiles accepts directory-form Affected Files entries in the dirty tree', () => {
    withTempDir('run-task-human-review-dirform-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`dist/`']);

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M dist/cli/index.js',
            FAKE_GIT_DIFF_OUTPUT: 'dist/cli/index.js',
        });

        assert.equal(result.status, 0, result.stderr);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        // git add -A -- dist/ stages everything dirty under the prefix.
        assert.match(gitLog, /^add -A -- dist\/$/m);
        assert.match(gitLog, /^commit /m);
    });
});

void test('commitHumanReviewFiles commits telemetry files without managed-doc advisory', () => {
    withTempDir('run-task-human-review-telemetry-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M docs/lessons-learned.md',
            FAKE_GIT_DIFF_OUTPUT: 'docs/lessons-learned.md',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(combinedOutput(result), /WARNING:/);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(gitLog, /^add -A -- docs\/lessons-learned\.md$/m);
        assert.match(gitLog, /^commit /m);
    });
});

void test('commitHumanReviewFiles base-drift gate accepts files listed in Affected Files', () => {
    withTempDir('run-task-base-drift-allowed-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`docs/codebase-map.md`']);

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_DRIFT_FILES: 'docs/codebase-map.md',
            FAKE_GIT_STATUS_OUTPUT: ' M tasks/task-a/done.md',
            FAKE_GIT_DIFF_OUTPUT: 'tasks/task-a/done.md',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(combinedOutput(result), /base-drift detected/);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(gitLog, /^commit /m);
    });
});

void test('commitHumanReviewFiles base-drift gate dies on drift outside the allowlist', () => {
    withTempDir('run-task-base-drift-die-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`scripts/run-task/main.ts`']);

        // Use a non-managed-doc drift file: PIPELINE_MANAGED_DOCS like
        // docs/decisions.md are auto-allowlisted once qa.status === 'done'
        // (BACKLOG #994), which the harness's makeCompleteStatus already sets.
        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_DRIFT_FILES: 'docs/BACKLOG.md',
            FAKE_GIT_STATUS_OUTPUT: ' M tasks/task-a/done.md',
            FAKE_GIT_DIFF_OUTPUT: 'tasks/task-a/done.md',
        });

        assert.notEqual(result.status, 0);
        const output = combinedOutput(result);
        assert.match(output, /docs\/BACKLOG\.md/);
        assert.match(output, /--force/);
        assert.match(output, /PIPELINE_TELEMETRY_FILES/);
        assert.match(output, /Affected Files/);
        assert.match(output, /git checkout origin\/main -- <path>/);
        assert.match(output, /git revert <sha>/);
        assert.doesNotMatch(output, /git checkout HEAD --/);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.doesNotMatch(gitLog, /^commit /m);
    });
});

void test('commitHumanReviewFiles base-drift gate warns and proceeds with --force', () => {
    withTempDir('run-task-base-drift-force-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`scripts/run-task/main.ts`']);

        const result = runNodeInline([
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--push', '--force'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${harness.fakeGitDir}${path.delimiter}${harness.fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: harness.tasksRoot,
            FAKE_GIT_LOG: harness.gitLogPath,
            FAKE_GIT_CURRENT_BRANCH: harness.currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_BASE_BRANCH: 'main',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GIT_DRIFT_FILES: 'docs/BACKLOG.md',
            FAKE_GIT_STATUS_OUTPUT: ' M tasks/task-a/done.md',
            FAKE_GIT_DIFF_OUTPUT: 'tasks/task-a/done.md',
        });

        assert.equal(result.status, 0, result.stderr);
        const output = combinedOutput(result);
        assert.match(output, /--force override: base-drift detected/);
        assert.match(output, /docs\/BACKLOG\.md/);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(gitLog, /^commit /m);
        assert.match(gitLog, /^push origin task\/task-a$/m);
    });
});

void test('commitHumanReviewFiles base-drift gate fails closed when tree diff fails', () => {
    withTempDir('run-task-base-drift-diff-fail-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_DRIFT_DIFF_FAIL: '1',
            FAKE_GIT_DRIFT_DIFF_ERROR: 'fatal: simulated tree diff failure',
            FAKE_GIT_STATUS_OUTPUT: ' M tasks/task-a/done.md',
            FAKE_GIT_DIFF_OUTPUT: 'tasks/task-a/done.md',
        });

        assert.notEqual(result.status, 0);
        const output = combinedOutput(result);
        assert.match(output, /could not compute base-drift diff against origin\/main/);
        assert.match(output, /fatal: simulated tree diff failure/);
        assert.match(output, /cannot be bypassed with --force/);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.doesNotMatch(gitLog, /^commit /m);
    });
});

void test('commitHumanReviewFiles base-drift gate dies when the base branch advanced outside Affected Files', () => {
    withTempDir('run-task-base-drift-mode1-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const { localDir, originDir } = makeGitFixture(dir);
        writeTaskStatus(tasksRoot, 'task-a', makeCompleteStatus('task-a', 'task/demo'));
        writeAffectedFilesSpec(tasksRoot, 'task-a', ['`scripts/run-task/main.ts`']);

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
        // Use docs/BACKLOG.md (not in PIPELINE_MANAGED_DOCS) so the gate fires —
        // managed-doc paths are auto-allowlisted at qa.status === 'done'.
        const baseAdvanceFile = path.join(thirdPartyDir, 'docs', 'BACKLOG.md');
        fs.mkdirSync(path.dirname(baseAdvanceFile), { recursive: true });
        fs.writeFileSync(baseAdvanceFile, 'third-party content\n', 'utf8');
        gitIn(thirdPartyDir, 'add', 'docs/BACKLOG.md');
        gitIn(thirdPartyDir, 'commit', '-m', 'third-party base advance');
        gitIn(thirdPartyDir, 'push', 'origin', 'main');

        const result = runNodeInline([
            "import { commitHumanReviewFiles } from './scripts/run-task/main.ts';",
            `commitHumanReviewFiles(['task-a'], ${JSON.stringify(localDir)}, false);`,
        ].join('\n'), {
            ...process.env,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        });

        assert.notEqual(result.status, 0);
        const output = combinedOutput(result);
        assert.match(output, /base-drift detected/);
        assert.match(output, /docs\/BACKLOG\.md/);
        assert.doesNotMatch(output, /scripts\/run-task\/main\.ts\s*$/m);
    });
});

void test('commitHumanReviewFiles unions affected managed docs across bundled tasks', () => {
    withTempDir('run-task-human-review-bundle-union-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a', 'task-b']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`docs/codebase-map.md`']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-b', ['`docs/patterns.md`']);

        const result = runHumanReviewCommit(harness, ['task-a', 'task-b'], {
            FAKE_GIT_STATUS_OUTPUT: [' M docs/codebase-map.md', ' M docs/patterns.md'].join('\n'),
            FAKE_GIT_DIFF_OUTPUT: ['docs/codebase-map.md', 'docs/patterns.md'].join('\n'),
        });

        assert.equal(result.status, 0, result.stderr);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(gitLog, /^add -A -- docs\/codebase-map\.md$/m);
        assert.match(gitLog, /^add -A -- docs\/patterns\.md$/m);
        assert.match(gitLog, /^commit /m);
    });
});

void test('commitHumanReviewFiles warns on malformed affected-file rows without allowing the placeholder', () => {
    withTempDir('run-task-human-review-malformed-row-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`docs/codebase-map.md`', '`<path>`']);

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M docs/codebase-map.md',
            FAKE_GIT_DIFF_OUTPUT: 'docs/codebase-map.md',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(combinedOutput(result), /task-a spec\.md Affected Files row malformed/);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(gitLog, /^add -A -- docs\/codebase-map\.md$/m);
        assert.doesNotMatch(gitLog, /<path>/);
    });
});

void test('commitHumanReviewFiles does not allow non-managed affected-file entries', () => {
    withTempDir('run-task-human-review-source-out-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`scripts/run-task/main.ts`']);

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M scripts/run-task/main.ts',
            FAKE_GIT_DIFF_OUTPUT: '',
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /working tree has dirty files outside the human_review allowlist/);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.doesNotMatch(gitLog, /^commit /m);
        assert.doesNotMatch(gitLog, /^add -A -- scripts\/run-task\/main\.ts$/m);
    });
});

void test('commitHumanReviewFiles filters mixed managed and non-managed affected-file entries per path', () => {
    withTempDir('run-task-human-review-mixed-filter-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', [
            '`docs/codebase-map.md`',
            '`tests/run-task-safety.test.ts`',
        ]);

        const managedResult = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M docs/codebase-map.md',
            FAKE_GIT_DIFF_OUTPUT: 'docs/codebase-map.md',
        });

        assert.equal(managedResult.status, 0, managedResult.stderr);
        assert.match(combinedOutput(managedResult), /WARNING: docs\/codebase-map\.md/);

        const sourceResult = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M tests/run-task-safety.test.ts',
            FAKE_GIT_DIFF_OUTPUT: '',
        });

        assert.notEqual(sourceResult.status, 0);
        assert.match(sourceResult.stderr, /working tree has dirty files outside the human_review allowlist/);
    });
});

void test('main full-send tail fails closed when human_review gate rejects the task', () => {
    withTempDir('run-task-full-send-gate-fail-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const status = makeCompleteStatus('task-a', 'task/task-a');
        const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
        phases.qa = { status: 'done', agent: 'claude' };
        phases.human_review = { status: 'pending', agent: 'human' };
        status.full_send = false;
        status.human_spec_gate = true;
        writeTaskStatus(tasksRoot, 'task-a', status);

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--full-send'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
        });

        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /handoff\.md|human_review|gate/i);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            phases?: { human_review?: { status?: string } };
        };
        assert.equal(updated.phases?.human_review?.status, 'pending');

        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.doesNotMatch(gitLog, /^push /m);
    });
});

void test('main --full-send rejects multi-branch bundles before gate or PR creation', () => {
    withTempDir('run-task-full-send-bundle-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const taskA = makeCompleteStatus('task-a', 'task/task-a');
        const taskB = makeCompleteStatus('task-b', 'task/task-b');
        for (const [taskId, status] of [['task-a', taskA], ['task-b', taskB]] as const) {
            const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
            phases.qa = { status: 'done', agent: 'claude' };
            phases.human_review = { status: 'pending', agent: 'human' };
            status.full_send = false;
            status.human_spec_gate = true;
            writeTaskStatus(tasksRoot, taskId, status);
        }

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', 'task-b', '--full-send'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
        });

        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /Full-send tail aborted: bundle spans multiple branches/);

        const statusA = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            full_send?: boolean;
            phases?: { human_review?: { status?: string } };
        };
        const statusB = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-b', 'status.json'), 'utf8')) as {
            full_send?: boolean;
            phases?: { human_review?: { status?: string } };
        };
        assert.equal(statusA.full_send, true);
        assert.equal(statusB.full_send, true);
        assert.equal(statusA.phases?.human_review?.status, 'pending');
        assert.equal(statusB.phases?.human_review?.status, 'pending');

        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.doesNotMatch(gitLog, /^push /m);
    });
});

void test('main rejects hand-edited full_send plus delicate without --force', () => {
    withTempDir('run-task-full-send-hand-edit-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const status = makeCompleteStatus('task-a', 'task/task-a');
        const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
        phases.qa = { status: 'done', agent: 'claude' };
        phases.human_review = { status: 'pending', agent: 'human' };
        status.delicate = true;
        status.full_send = true;
        status.human_spec_gate = false;
        writeTaskStatus(tasksRoot, 'task-a', status);

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'task-a'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
        });

        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /--full-send on delicate task 'task-a' requires --force/);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            full_send?: boolean;
            phases?: { human_review?: { status?: string } };
        };
        assert.equal(updated.full_send, true);
        assert.equal(updated.phases?.human_review?.status, 'pending');

        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.doesNotMatch(gitLog, /^push /m);
    });
});

void test('main full-send tail fails closed when draft PR creation fails', () => {
    withTempDir('run-task-full-send-pr-fail-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const status = makeCompleteStatus('task-a', 'task/task-a');
        const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
        phases.qa = { status: 'done', agent: 'claude' };
        phases.human_review = { status: 'pending', agent: 'human' };
        status.full_send = false;
        status.human_spec_gate = true;
        writeTaskStatus(tasksRoot, 'task-a', status);
        fs.writeFileSync(path.join(tasksRoot, 'task-a', 'handoff.md'), [
            '# Implementation Handoff: task-a',
            '',
            '## Validation Outcomes',
            '',
            '| Check | Result | Notes |',
            '|---|---|---|',
            '| `lint` | Pass | ok |',
            '',
        ].join('\n'), 'utf8');

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--full-send'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GH_PR_CREATE_FAIL: '1',
            FAKE_GH_PR_CREATE_ERROR: 'draft PR creation failed',
        });

        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /draft PR creation failed/);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            phases?: { human_review?: { status?: string } };
        };
        assert.equal(updated.phases?.human_review?.status, 'pending');

        const gitLog = fs.readFileSync(path.join(dir, 'git.log'), 'utf8');
        assert.match(gitLog, /^push origin task\/task-a$/m);
    });
});

void test('main --reroute clears full_send', () => {
    withTempDir('run-task-reroute-full-send-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const status = makeCompleteStatus('task-a', 'task/task-a');
        const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
        phases.human_review = { status: 'pending', agent: 'human' };
        status.full_send = true;
        status.human_spec_gate = false;
        writeTaskStatus(tasksRoot, 'task-a', status);
        const worktreesRoot = path.join(dir, 'worktrees');
        writeTaskStatus(path.join(worktreesRoot, 'task-a', 'tasks'), 'task-a', status);
        // This fixture sets CANON_TASKS_DIR_OVERRIDE, so taskDirFor intentionally
        // reads the override root; production worktree-mode reroute reads the
        // active worktree's spec.
        const amendmentSpec = [
            '# Spec',
            '',
            '## Amendment',
            '',
            'Reroute spec amendment for the full_send regression test.',
            '',
        ].join('\n');
        fs.writeFileSync(path.join(tasksRoot, 'task-a', 'spec.md'), amendmentSpec, 'utf8');
        fs.writeFileSync(path.join(worktreesRoot, 'task-a', 'tasks', 'task-a', 'spec.md'), amendmentSpec, 'utf8');

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');

        const result = runNodeInline([
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'task-a', '--reroute'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stdout, /full_send cleared/);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'task-a', 'status.json'), 'utf8')) as {
            full_send?: boolean;
            phases?: {
                spec_review?: { status?: string };
                plan?: { status?: string };
                implement?: { status?: string };
                code_review?: { status?: string };
                qa?: { status?: string };
                human_review?: { status?: string };
            };
        };
        assert.equal(updated.full_send, false);
        assert.equal(updated.phases?.spec_review?.status, 'pending');
        assert.equal(updated.phases?.plan?.status, 'pending');
        assert.equal(updated.phases?.implement?.status, 'pending');
        assert.equal(updated.phases?.code_review?.status, 'pending');
        assert.equal(updated.phases?.qa?.status, 'pending');
        assert.equal(updated.phases?.human_review?.status, 'pending');
    });
});

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
            "import { checkAndRoute } from './scripts/run-task/main.ts';",
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
            "import { checkAndRoute } from './scripts/run-task/main.ts';",
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
            "import { checkAndRoute } from './scripts/run-task/main.ts';",
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
            "import { checkAndRoute } from './scripts/run-task/main.ts';",
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
            "import { checkAndRoute } from './scripts/run-task/main.ts';",
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
            "import { main } from './scripts/run-task/main.ts';",
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
            "import { main } from './scripts/run-task/main.ts';",
            "process.argv = ['node', 'canon', 'BadID'];",
            "main().catch(err => { console.error(err); process.exit(1); });",
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeBins}:${process.env.PATH ?? ''}`,
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
        "import { registerExitHandlers, setExitReason } from './scripts/run-task/cli.js';",
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

void test('Claude failure ladders set exit reasons and Codex non-zero exits do not exit by themselves', () => {
    withTempDir('orchestrator-exit-agents-', dir => {
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });

        writeExecutable(fakeBins, 'claude', ['exit 1']);
        const claudeResult = runNodeInline([
            "import { registerExitHandlers } from './scripts/run-task/cli.js';",
            "import { runClaude } from './scripts/run-task/agents/claude.js';",
            'registerExitHandlers();',
            '(async () => {',
            "  await runClaude('prompt', false, null, 'model', 'effort', '10', undefined, process.cwd());",
            '})().catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        });
        assert.equal(claudeResult.status, 1, claudeResult.stderr);
        const claudeMarkers = claudeResult.stderr.match(/^■ orchestrator exit .*$/gm) ?? [];
        assert.equal(claudeMarkers.length, 1, claudeResult.stderr);
        assert.match(claudeMarkers[0] ?? '', /code=1/);
        assert.match(claudeMarkers[0] ?? '', /claude session exited 1/);

        const codexSpawnErrorDir = path.join(dir, 'codex-spawn-error-bin');
        fs.mkdirSync(codexSpawnErrorDir, { recursive: true });
        const spawnErrorResult = runNodeInline([
            "import { registerExitHandlers } from './scripts/run-task/cli.js';",
            "import { runCodex } from './scripts/run-task/agents/codex.js';",
            'registerExitHandlers();',
            '(async () => {',
            "  await runCodex('prompt', false, null, 'model', 'effort', undefined, process.cwd());",
            '})().catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), {
            ...process.env,
            PATH: codexSpawnErrorDir,
        });
        assert.equal(spawnErrorResult.status, 1, spawnErrorResult.stderr);
        const spawnMarkers = spawnErrorResult.stderr.match(/^■ orchestrator exit .*$/gm) ?? [];
        assert.equal(spawnMarkers.length, 1, spawnErrorResult.stderr);
        assert.match(spawnMarkers[0] ?? '', /codex session spawn error:/);

        writeExecutable(fakeBins, 'codex', ['exit 1']);
        const codexNoExitResult = runNodeInline([
            "import { registerExitHandlers } from './scripts/run-task/cli.js';",
            "import { runCodex } from './scripts/run-task/agents/codex.js';",
            'registerExitHandlers();',
            '(async () => {',
            "  await runCodex('prompt', false, null, 'model', 'effort', undefined, process.cwd());",
            "  console.log('after-runCodex');",
            '})().catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        });
        assert.equal(codexNoExitResult.status, 0, codexNoExitResult.stderr);
        assert.match(codexNoExitResult.stdout, /after-runCodex/);
        assert.doesNotMatch(codexNoExitResult.stderr, /codex session exited 1/);
        assert.doesNotMatch(codexNoExitResult.stderr, /code=1/);

        writeExecutable(fakeBins, 'codex', ['sleep 2']);
        const stallResult = runNodeInline([
            "import { registerExitHandlers } from './scripts/run-task/cli.js';",
            "import { runCodex } from './scripts/run-task/agents/codex.js';",
            'registerExitHandlers();',
            '(async () => {',
            "  await runCodex('prompt', false, null, 'model', 'effort', undefined, process.cwd());",
            '})().catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            PIPELINE_STALL_TIMEOUT_MS: '1',
        });
        assert.equal(stallResult.status, 1, stallResult.stderr);
        const stallMarkers = stallResult.stderr.match(/^■ orchestrator exit .*$/gm) ?? [];
        assert.equal(stallMarkers.length, 1, stallResult.stderr);
        assert.match(stallMarkers[0] ?? '', /codex session stalled/);

        writeExecutable(fakeBins, 'codex', ['kill -TERM $$']);
        const signalResult = runNodeInline([
            "import { registerExitHandlers } from './scripts/run-task/cli.js';",
            "import { runCodex } from './scripts/run-task/agents/codex.js';",
            'registerExitHandlers();',
            '(async () => {',
            "  await runCodex('prompt', false, null, 'model', 'effort', undefined, process.cwd());",
            '})().catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        });
        assert.equal(signalResult.status, 1, signalResult.stderr);
        const signalMarkers = signalResult.stderr.match(/^■ orchestrator exit .*$/gm) ?? [];
        assert.equal(signalMarkers.length, 1, signalResult.stderr);
        assert.match(signalMarkers[0] ?? '', /codex session received signal SIGTERM/);
    });
});

void test('uncaught exceptions and unhandled rejections write one exit marker and exit 1', () => {
    const uncaughtResult = runNodeInline([
        "import { registerExitHandlers } from './scripts/run-task/cli.js';",
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
        "import { registerExitHandlers } from './scripts/run-task/cli.js';",
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
            "import { recordMetric } from './scripts/run-task/metrics.ts';",
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
