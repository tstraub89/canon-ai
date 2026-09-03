import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

import { REPO_ROOT, WORKTREES_ROOT } from '../src/orchestrator/env.js';
import {
    buildHumanReviewStagePaths,
    classifyMergeOutcome,
    commitQaArtifacts,
    enableFullSend,
    findPullRequestTemplate,
    formatCompleteStateBanner,
    formatExistingPRMessage,
    guardConcurrentRun,
    resolveCanonPrBody,
    resolveQaPrBody,
    shouldParkCrashedReview,
} from '../src/orchestrator/main.js';
import { ensureBranch, ensureCheckedOutBaseBranch, findDirtyRepoRootSourcePaths } from '../src/orchestrator/git.js';
import { commitArchiveChanges, stageArchiveChanges } from '../src/orchestrator/main.js';
import { classifyInvocationRoot, effectiveWorktreesRoot, resolveTaskCwd } from '../src/orchestrator/state.js';
import {
    classifyNodeModulesLinkFromData,
    isContainedIn,
    PIPELINE_MANAGED_DOCS,
    resolveWorkspaceDirs,
    worktreePath,
} from '../src/orchestrator/worktree.js';
import { evaluateCodeReviewLoop } from '../src/orchestrator/review-loop.js';
import type { StatusJson, TaskContext } from '../src/orchestrator/types.js';
import { taskCmd } from '../src/task/index.js';

const WORKTREE_ROOT = process.cwd();
const TSX_LOADER = path.join(WORKTREE_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');

function canonicalizeTestPath(candidate: string): string {
    try {
        return fs.realpathSync(candidate);
    } catch {
        return path.resolve(candidate);
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
        'if [ "${1:-}" = "rev-parse" ] && [ "${2:-}" = "--git-common-dir" ] && [ -n "${FAKE_GIT_COMMON_DIR:-}" ]; then',
        '  printf "%s\\n" "$FAKE_GIT_COMMON_DIR"',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "rev-parse" ] && [ "${2:-}" = "--show-toplevel" ] && [ -n "${FAKE_GIT_ACTIVE_TOPLEVEL:-}" ]; then',
        '  printf "%s\\n" "$FAKE_GIT_ACTIVE_TOPLEVEL"',
        '  exit 0',
        'fi',
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
        'if [ "${1:-}" = "push" ] && [ "${FAKE_GIT_FAIL_PUSH:-}" = "1" ]; then',
        '  printf "%s\\n" "${FAKE_GIT_FAIL_PUSH_ERROR:-push failed}" >&2',
        '  exit 1',
        'fi',
        'if [ "${1:-}" = "push" ] && [ "${2:-}" = "-u" ] && [ "${3:-}" = "origin" ] && [ "${4:-}" = "${FAKE_GIT_BASE_BRANCH:-}" ]; then',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "push" ] && [ "${2:-}" = "--set-upstream" ] && [ "${3:-}" = "origin" ] && [ "${4:-}" = "${FAKE_GIT_BASE_BRANCH:-}" ]; then',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "push" ] && [ "${2:-}" = "-u" ] && [ "${3:-}" = "origin" ] && [ "${4:-}" = "${FAKE_GIT_TASK_BRANCH:-}" ]; then',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "push" ] && [ "${2:-}" = "--set-upstream" ] && [ "${3:-}" = "origin" ] && [ "${4:-}" = "${FAKE_GIT_TASK_BRANCH:-}" ]; then',
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
        '  if [ "${FAKE_GIT_WORKTREE_LIST_FAIL:-}" = "1" ]; then',
        '    printf "%s\\n" "simulated worktree list failure" >&2',
        '    exit 1',
        '  fi',
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

function setupInvocationLoggingCliTools(scriptDir: string): void {
    setupFakeCliTools(scriptDir);
    const completerPath = path.join(scriptDir, 'complete-agent-phase.mjs');
    fs.writeFileSync(completerPath, [
        "import fs from 'node:fs';",
        "import path from 'node:path';",
        "const tasksRoot = process.env.CANON_TASKS_DIR_OVERRIDE;",
        "const taskId = process.env.FAKE_AGENT_TASK_ID;",
        "const fixedPhase = process.env.FAKE_AGENT_COMPLETE_PHASE;",
        "const sequence = (process.env.FAKE_AGENT_COMPLETE_SEQUENCE ?? '').split(',').filter(Boolean);",
        "const logPath = process.env.FAKE_AGENT_LOG;",
        "const invocationCount = logPath && fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').split('\\n').filter(Boolean).length : 0;",
        "const phase = sequence[invocationCount - 1] ?? fixedPhase;",
        "if (!tasksRoot || !taskId || !phase) process.exit(0);",
        "const statusPath = path.join(tasksRoot, taskId, 'status.json');",
        "const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));",
        "status.phases[phase].status = 'done';",
        "if (phase === 'spec_review' || phase === 'code_review') status.phases[phase].verdict = 'approved';",
        "if (phase === 'spec_review') fs.writeFileSync(path.join(tasksRoot, taskId, 'spec-review.md'), '# Spec Review\\n\\n## Verdict\\n\\n- [x] **Approved**\\n- [ ] **Changes requested**\\n');",
        "status.status = phase === 'spec' ? 'spec_review' : phase === 'spec_review' ? 'plan' : phase === 'implement' ? 'code_review' : phase === 'code_review' ? 'qa' : status.status;",
        "fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\\n`);",
        '',
    ].join('\n'), 'utf8');
    for (const agent of ['claude', 'codex']) {
        writeExecutable(scriptDir, agent, [
            'if [ "${1:-}" = "--version" ]; then printf "%s\\n" "fake-agent 1.0"; exit 0; fi',
            `printf "%s\\n" "${agent}" >> "$FAKE_AGENT_LOG"`,
            'if [ -n "${FAKE_AGENT_COMPLETE_PHASE:-}${FAKE_AGENT_COMPLETE_SEQUENCE:-}" ]; then node "$FAKE_AGENT_COMPLETER"; fi',
            'exit 0',
        ]);
    }
}

type FakeRunHarness = {
    localDir: string;
    tasksRoot: string;
    fakeBins: string;
    fakeGitDir: string;
    gitLogPath: string;
    currentBranchPath: string;
};

function makeFakeRunHarness(dir: string, taskId: string, status: Record<string, unknown>): FakeRunHarness {
    const localDir = path.join(dir, 'repo');
    const tasksRoot = path.join(localDir, 'tasks');
    const fakeBins = path.join(dir, 'fake-bins');
    const fakeGitDir = path.join(fakeBins, 'git-bin');
    fs.mkdirSync(fakeGitDir, { recursive: true });
    fs.mkdirSync(path.join(localDir, '.git'), { recursive: true });
    setupFakeGit(fakeGitDir);
    setupFakeCliTools(fakeBins);
    writeTaskStatus(tasksRoot, taskId, status);
    const currentBranchPath = path.join(dir, 'current-branch.txt');
    fs.writeFileSync(currentBranchPath, 'main\n', 'utf8');
    return {
        localDir,
        tasksRoot,
        fakeBins,
        fakeGitDir,
        gitLogPath: path.join(dir, 'git.log'),
        currentBranchPath,
    };
}

function runFakeMain(
    harness: FakeRunHarness,
    taskId: string,
    args: readonly string[] = [],
    extraEnv: NodeJS.ProcessEnv = {},
    cwd = harness.localDir,
): { status: number | null; stderr: string; stdout: string } {
    const env = childEnvWithoutTasksOverride({
        PATH: `${harness.fakeGitDir}${path.delimiter}${harness.fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        FAKE_GIT_LOG: harness.gitLogPath,
        FAKE_GIT_COMMON_DIR: path.join(harness.localDir, '.git'),
        FAKE_GIT_ACTIVE_TOPLEVEL: cwd,
        FAKE_GIT_CURRENT_BRANCH: harness.currentBranchPath,
        FAKE_GIT_BASE_BRANCH: 'main',
        FAKE_GIT_TASK_BRANCH: `task/${taskId}`,
        ...extraEnv,
    });
    return runMainInline(taskId, args, env, cwd);
}

function runRealMainWithFakeAgents(
    taskId: string,
    args: readonly string[],
    localDir: string,
    dir: string,
    cwd = localDir,
): { status: number | null; stderr: string; stdout: string } {
    const fakeBins = path.join(dir, 'fake-agents');
    fs.mkdirSync(fakeBins, { recursive: true });
    setupFakeCliTools(fakeBins);
    const env = childEnvWithoutTasksOverride({
        PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        FAKE_AGENT_LOG: path.join(dir, 'agent-invocations.log'),
        FAKE_AGENT_TASK_ID: taskId,
    });
    delete env.CANON_WORKTREES_ROOT;
    return runMainInline(taskId, args, env, cwd);
}

function readAgentInvocations(logPath: string): string[] {
    if (!fs.existsSync(logPath)) return [];
    return fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
}

function makeReviewLoopStatus(
    taskId: string,
    loop: 'spec_review' | 'code_review',
    current: number,
    preflight = 0,
    revisionDone = false,
): Record<string, unknown> {
    const phases: Record<string, Record<string, unknown>> = {
        spec: { status: loop === 'spec_review' && !revisionDone ? 'pending' : 'done', agent: 'claude' },
        spec_review: {
            status: loop === 'spec_review' ? 'pending' : 'done',
            agent: 'codex',
            verdict: loop === 'spec_review' ? '' : 'approved',
            iterations: loop === 'spec_review' ? current : 0,
            iterations_current_loop: loop === 'spec_review' ? current : 0,
            iterations_total: loop === 'spec_review' ? current + 2 : 1,
            changes_requested_total: loop === 'spec_review' ? current : 0,
            auto_block_count: 0,
        },
        plan: { status: loop === 'spec_review' ? 'pending' : 'done', agent: 'claude' },
        implement: { status: loop === 'code_review' && !revisionDone ? 'pending' : loop === 'code_review' ? 'done' : 'pending', agent: 'codex' },
        code_review: {
            status: 'pending',
            agent: 'claude',
            verdict: '',
            iterations: loop === 'code_review' ? current : 0,
            iterations_current_loop: loop === 'code_review' ? current : 0,
            iterations_total: loop === 'code_review' ? current + 4 : 0,
            changes_requested_total: loop === 'code_review' ? current + preflight : 0,
            preflight_rejections_current_loop: loop === 'code_review' ? preflight : 0,
            preflight_rejections_total: loop === 'code_review' ? preflight + 1 : 0,
            auto_block_count: 0,
        },
        qa: { status: 'pending', agent: 'claude' },
        human_review: { status: 'pending', agent: 'human' },
    };
    return {
        id: taskId,
        title: taskId,
        status: loop === 'spec_review'
            ? (revisionDone ? 'spec_review' : 'spec')
            : (revisionDone ? 'code_review' : 'implement'),
        task_size: 'M',
        delicate: true,
        human_spec_gate: false,
        base_branch: 'main',
        worktree: false,
        phases,
        sessions: loop === 'spec_review'
            ? { claude_spec: 'old-spec-session' }
            : { claude_review: 'old-review-session' },
        escalations: [],
    };
}

function writeReviewLoopFixture(
    repoDir: string,
    taskId: string,
    loop: 'spec_review' | 'code_review',
    current: number,
    preflight = 0,
    revisionDone = false,
): string {
    const tasksRoot = path.join(repoDir, 'tasks');
    writeTaskStatus(tasksRoot, taskId, makeReviewLoopStatus(taskId, loop, current, preflight, revisionDone));
    const taskDir = path.join(tasksRoot, taskId);
    fs.writeFileSync(path.join(taskDir, loop === 'spec_review' ? 'spec-review.md' : 'review.md'), [
        loop === 'spec_review' ? '# Spec Review' : '# Code Review',
        '',
        '## Verdict',
        '',
        '- [x] **Changes requested**',
        '',
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(taskDir, 'spec.md'), [
        `# Spec: ${taskId}`,
        '',
        '## Design',
        '',
        '### Affected Files',
        '',
        '| File | Change |',
        '|---|---|',
        '| `initial-fixture.txt` | fixture |',
        '',
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(taskDir, 'handoff.md'), [
        `# Implementation Handoff: ${taskId}`,
        '',
        '## Changes',
        '',
        '| File | Change |',
        '|---|---|',
        '| `initial-fixture.txt` | fixture |',
        '',
        '## Validation Outcomes',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| `npm test` | Pass | fixture |',
        '',
    ].join('\n'), 'utf8');
    return tasksRoot;
}

function runReviewLoopMain(
    repoDir: string,
    tasksRoot: string,
    fakeBins: string,
    taskId: string,
    cap: number,
    extraArgs: readonly string[] = [],
    extraEnv: NodeJS.ProcessEnv = {},
    step = true,
): { status: number | null; stderr: string; stdout: string } {
    const mainHref = pathToFileURL(path.join(WORKTREE_ROOT, 'src', 'orchestrator', 'main.ts')).href;
    const argv = ['node', 'canon', taskId, ...(step ? ['--step'] : []), ...extraArgs];
    return runNodeInline([
        `import(${JSON.stringify(mainHref)})`,
        '.then(async m => {',
        `  process.argv = ${JSON.stringify(argv)};`,
        '  await m.main();',
        '})',
        '.catch(err => { console.error(err); process.exit(1); });',
    ].join('\n'), {
        ...process.env,
        PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        CANON_NO_DETACH: '1',
        CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        CANON_WORKTREES_ROOT: path.join(repoDir, 'worktrees'),
        MAX_REVIEW_LOOPS: String(cap),
        FAKE_AGENT_LOG: path.join(repoDir, 'agent-invocations.log'),
        FAKE_AGENT_COMPLETER: path.join(fakeBins, 'complete-agent-phase.mjs'),
        FAKE_AGENT_TASK_ID: taskId,
        ...extraEnv,
    }, repoDir);
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

function runMainInline(
    taskId: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    cwd: string,
): { status: number | null; stderr: string; stdout: string } {
    const mainModuleUrl = pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href;
    return runNodeInline([
        `import(${JSON.stringify(mainModuleUrl)})`,
        `.then(async m => { process.argv = ${JSON.stringify(['node', 'canon', taskId, ...args])}; await m.main(); })`,
        '.catch(err => { console.error(err); process.exit(1); });',
    ].join('\n'), { ...env, CANON_NO_DETACH: '1' }, cwd);
}

function runEnsureBranchInline(
    taskId: string,
    cwd: string,
    worktreesRoot: string,
): { status: number | null; stderr: string; stdout: string } {
    const env = childEnvWithoutTasksOverride({ CANON_WORKTREES_ROOT: worktreesRoot });
    const gitModuleUrl = pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/git.ts')).href;
    return runNodeInline([
        `import(${JSON.stringify(gitModuleUrl)})`,
        `.then(m => { m.ensureBranch([${JSON.stringify(taskId)}]); })`,
        '.catch(err => { console.error(err); process.exit(1); });',
    ].join('\n'), env, cwd);
}

function runEnsureBundleBranchInline(
    taskIds: readonly string[],
    cwd: string,
    worktreesRoot: string,
): { status: number | null; stderr: string; stdout: string } {
    const env = childEnvWithoutTasksOverride({ CANON_WORKTREES_ROOT: worktreesRoot });
    const gitModuleUrl = pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/git.ts')).href;
    return runNodeInline([
        `import(${JSON.stringify(gitModuleUrl)})`,
        `.then(m => { m.ensureBranch(${JSON.stringify(taskIds)}); })`,
        '.catch(err => { console.error(err); process.exit(1); });',
    ].join('\n'), env, cwd);
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

function makeOutOfRootTaskFixture(dir: string, taskId: string, linkedWorktree: string): {
    localDir: string;
    branch: string;
} {
    const { localDir } = makeGitFixture(dir);
    const branch = `task/${taskId}`;
    const mainStatus = { ...makeCompleteStatus(taskId, ''), worktree: true };
    writeTaskStatus(path.join(localDir, 'tasks'), taskId, mainStatus);
    gitIn(localDir, 'add', 'tasks');
    gitIn(localDir, 'commit', '-m', `add ${taskId} task artifacts`);
    fs.mkdirSync(path.dirname(linkedWorktree), { recursive: true });
    gitIn(localDir, 'worktree', 'add', '-q', '-b', branch, linkedWorktree, 'main');
    writeTaskStatus(path.join(linkedWorktree, 'tasks'), taskId, { ...mainStatus, branch });
    return { localDir, branch };
}

function makeBootstrappedTaskWorktreeFixture(dir: string, taskId: string): {
    localDir: string;
    worktreeDir: string;
    branch: string;
} {
    const { localDir } = makeGitFixture(dir);
    const branch = `task/${taskId}`;
    const status = { ...makeCompleteStatus(taskId, ''), worktree: true };
    writeTaskStatus(path.join(localDir, 'tasks'), taskId, status);
    gitIn(localDir, 'add', 'tasks');
    gitIn(localDir, 'commit', '-m', `add ${taskId} task artifacts`);
    const worktreeDir = path.join(localDir, '.canon', 'worktrees', taskId);
    const setup = runEnsureBranchInline(taskId, localDir, path.join(localDir, '.canon', 'worktrees'));
    assert.equal(setup.status, 0, setup.stderr);
    return { localDir, worktreeDir, branch };
}

function makeNodeModulesGateFixture(
    dir: string,
    taskId: string,
    gitignoreRule: string | null,
): {
    localDir: string;
    originDir: string;
    worktreesRoot: string;
    worktreeDir: string;
    branch: string;
    repoModulesFixture: string;
} {
    const { localDir, originDir } = makeGitFixture(dir);
    fs.writeFileSync(path.join(localDir, 'package.json'), '{"name":"fixture"}\n', 'utf8');
    if (gitignoreRule === null) {
        gitIn(localDir, 'add', 'package.json');
    } else {
        fs.writeFileSync(path.join(localDir, '.gitignore'), gitignoreRule, 'utf8');
        gitIn(localDir, 'add', '.gitignore', 'package.json');
    }
    gitIn(localDir, 'commit', '-m', 'fixture setup');
    gitIn(localDir, 'push', 'origin', 'main');

    const repoModulesFixture = path.join(localDir, 'node_modules');
    fs.mkdirSync(repoModulesFixture, { recursive: true });
    fs.writeFileSync(path.join(repoModulesFixture, 'marker.txt'), 'root install\n', 'utf8');

    const branch = `task/${taskId}`;
    const worktreesRoot = path.join(dir, 'worktrees');
    const worktreeDir = path.join(worktreesRoot, taskId);
    fs.mkdirSync(worktreesRoot, { recursive: true });
    gitIn(localDir, 'worktree', 'add', worktreeDir, '-b', branch);

    return { localDir, originDir, worktreesRoot, worktreeDir, branch, repoModulesFixture };
}

function makeWorkspaceResolverFixture(
    dir: string,
    workspaces: unknown = ['packages/**'],
): { repoRoot: string; outsideRoot: string } {
    const repoRoot = path.join(dir, 'repo');
    const outsideRoot = path.join(dir, 'outside');
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({ name: 'fixture', workspaces }), 'utf8');
    const manifests: Array<[string, Record<string, string>]> = [
        ['packages/a', { version: '1.0.0' }],
        ['packages/b', { name: 'b' }],
        ['packages/a/node_modules/dep', { name: 'dep' }],
        ['apps/app', { name: 'app' }],
    ];
    for (const [workspace, manifest] of manifests) {
        fs.mkdirSync(path.join(repoRoot, workspace), { recursive: true });
        fs.writeFileSync(path.join(repoRoot, workspace, 'package.json'), JSON.stringify(manifest), 'utf8');
    }
    fs.mkdirSync(path.join(repoRoot, 'packages/a/src'), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, 'packages/notapkg/nested'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'packages/file.txt'), 'plain file\n', 'utf8');
    return { repoRoot, outsideRoot };
}

function captureConsoleError<T>(fn: () => T): { result: T; stderr: string } {
    const original = console.error;
    const lines: string[] = [];
    console.error = (...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
    };
    try {
        return { result: fn(), stderr: lines.join('\n') };
    } finally {
        console.error = original;
    }
}

function makeWorkspaceNodeModulesGateFixture(
    dir: string,
    taskId: string,
    gitignoreRule: string | null,
): {
    localDir: string;
    originDir: string;
    worktreesRoot: string;
    worktreeDir: string;
    branch: string;
    repoModulesFixture: string;
    repoWorkspaceModules: string;
} {
    const { localDir, originDir } = makeGitFixture(dir);
    fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
        name: 'fixture',
        workspaces: ['packages/*'],
    }), 'utf8');
    fs.mkdirSync(path.join(localDir, 'packages/a'), { recursive: true });
    fs.writeFileSync(path.join(localDir, 'packages/a/package.json'), '{"version":"1.0.0"}\n', 'utf8');
    fs.mkdirSync(path.join(localDir, 'packages/notapkg/nested'), { recursive: true });
    fs.writeFileSync(path.join(localDir, 'packages/notapkg/nested/sentinel.txt'), 'not a package\n', 'utf8');
    const addPaths = ['package.json', 'packages'];
    if (gitignoreRule !== null) {
        fs.writeFileSync(path.join(localDir, '.gitignore'), gitignoreRule, 'utf8');
        addPaths.push('.gitignore');
    }
    gitIn(localDir, 'add', ...addPaths);
    gitIn(localDir, 'commit', '-m', 'workspace fixture setup');
    gitIn(localDir, 'push', 'origin', 'main');

    const repoModulesFixture = path.join(localDir, 'node_modules');
    fs.mkdirSync(repoModulesFixture, { recursive: true });
    fs.writeFileSync(path.join(repoModulesFixture, 'marker.txt'), 'root install\n', 'utf8');
    const repoWorkspaceModules = path.join(localDir, 'packages/a/node_modules');
    fs.mkdirSync(repoWorkspaceModules, { recursive: true });
    fs.writeFileSync(path.join(repoWorkspaceModules, 'marker.txt'), 'workspace install\n', 'utf8');

    const branch = `task/${taskId}`;
    const worktreesRoot = path.join(dir, 'worktrees');
    const worktreeDir = path.join(worktreesRoot, taskId);
    fs.mkdirSync(worktreesRoot, { recursive: true });
    gitIn(localDir, 'worktree', 'add', worktreeDir, '-b', branch);
    return {
        localDir,
        originDir,
        worktreesRoot,
        worktreeDir,
        branch,
        repoModulesFixture,
        repoWorkspaceModules,
    };
}

type TrackedNodeModulesVariant = 'missing' | 'file' | 'directory' | 'verified-symlink' | 'wrong-target-symlink';

function makeEnsureWorktreeNodeModulesFixture(
    dir: string,
    taskId: string,
    variant: TrackedNodeModulesVariant,
): { localDir: string; worktreesRoot: string; worktreeDir: string; branch: string; repoModulesFixture: string; wrongTarget: string } {
    const { localDir } = makeGitFixture(dir);
    fs.writeFileSync(path.join(localDir, 'package.json'), '{"name":"fixture"}\n', 'utf8');
    gitIn(localDir, 'add', 'package.json');
    gitIn(localDir, 'commit', '-m', 'package setup');

    const branch = `task/${taskId}`;
    const repoModulesFixture = path.join(localDir, 'node_modules');
    const wrongTarget = path.join(dir, 'wrong-node-modules-target');
    gitIn(localDir, 'checkout', '-b', branch);
    if (variant === 'file') {
        fs.writeFileSync(repoModulesFixture, 'tracked file\n', 'utf8');
        gitIn(localDir, 'add', 'node_modules');
    } else if (variant === 'directory') {
        fs.mkdirSync(repoModulesFixture, { recursive: true });
        fs.writeFileSync(path.join(repoModulesFixture, 'pkg.json'), '{}\n', 'utf8');
        gitIn(localDir, 'add', 'node_modules/pkg.json');
    } else if (variant === 'verified-symlink') {
        fs.symlinkSync(repoModulesFixture, repoModulesFixture);
        gitIn(localDir, 'add', 'node_modules');
    } else if (variant === 'wrong-target-symlink') {
        fs.mkdirSync(wrongTarget, { recursive: true });
        fs.symlinkSync(wrongTarget, repoModulesFixture);
        gitIn(localDir, 'add', 'node_modules');
    }
    if (variant !== 'missing') {
        gitIn(localDir, 'commit', '-m', `track ${variant} node_modules`);
    }
    gitIn(localDir, 'checkout', 'main');
    fs.rmSync(repoModulesFixture, { recursive: true, force: true });
    fs.mkdirSync(repoModulesFixture, { recursive: true });
    fs.writeFileSync(path.join(repoModulesFixture, 'marker.txt'), 'root install\n', 'utf8');

    const worktreesRoot = path.join(dir, 'worktrees');
    const worktreeDir = path.join(worktreesRoot, taskId);
    fs.mkdirSync(worktreesRoot, { recursive: true });
    return { localDir, worktreesRoot, worktreeDir, branch, repoModulesFixture, wrongTarget };
}

type WorkspaceDestinationVariant =
    | TrackedNodeModulesVariant
    | 'destination-escape'
    | 'destination-dangling'
    | 'destination-file'
    | 'workspace-absent'
    | 'source-hoisted';

function makeEnsureWorktreeWorkspaceFixture(
    dir: string,
    taskId: string,
    variant: WorkspaceDestinationVariant,
): {
    localDir: string;
    worktreesRoot: string;
    worktreeDir: string;
    branch: string;
    repoModulesFixture: string;
    repoWorkspaceModules: Record<'packages/a' | 'packages/b', string>;
    wrongTarget: string;
    outsideDestination: string;
} {
    const { localDir } = makeGitFixture(dir);
    fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
        name: 'fixture',
        workspaces: ['packages/*'],
    }), 'utf8');
    for (const workspace of ['packages/a', 'packages/b'] as const) {
        fs.mkdirSync(path.join(localDir, workspace), { recursive: true });
        fs.writeFileSync(path.join(localDir, workspace, 'package.json'), JSON.stringify({ name: workspace }), 'utf8');
    }
    gitIn(localDir, 'add', 'package.json', 'packages');
    gitIn(localDir, 'commit', '-m', 'workspace package setup');

    const branch = `task/${taskId}`;
    const workspaceA = path.join(localDir, 'packages/a');
    const workspaceAModules = path.join(workspaceA, 'node_modules');
    const wrongTarget = path.join(dir, 'wrong-workspace-node-modules-target');
    const outsideDestination = path.join(dir, 'outside-worktree-destination');
    gitIn(localDir, 'checkout', '-b', branch);

    if (variant === 'file') {
        fs.writeFileSync(workspaceAModules, 'tracked workspace file\n', 'utf8');
        gitIn(localDir, 'add', 'packages/a/node_modules');
    } else if (variant === 'directory') {
        fs.mkdirSync(workspaceAModules, { recursive: true });
        fs.writeFileSync(path.join(workspaceAModules, 'pkg.json'), '{}\n', 'utf8');
        gitIn(localDir, 'add', 'packages/a/node_modules/pkg.json');
    } else if (variant === 'verified-symlink') {
        fs.symlinkSync(workspaceAModules, workspaceAModules);
        gitIn(localDir, 'add', 'packages/a/node_modules');
    } else if (variant === 'wrong-target-symlink') {
        fs.mkdirSync(wrongTarget, { recursive: true });
        fs.symlinkSync(wrongTarget, workspaceAModules);
        gitIn(localDir, 'add', 'packages/a/node_modules');
    } else if (variant === 'destination-escape') {
        fs.mkdirSync(outsideDestination, { recursive: true });
        fs.writeFileSync(path.join(outsideDestination, 'sentinel.txt'), 'untouched\n', 'utf8');
        gitIn(localDir, 'rm', '-r', 'packages/a');
        fs.symlinkSync(outsideDestination, workspaceA);
        gitIn(localDir, 'add', 'packages/a');
    } else if (variant === 'destination-dangling') {
        gitIn(localDir, 'rm', '-r', 'packages/a');
        fs.symlinkSync(path.join(dir, 'missing-workspace-target'), workspaceA);
        gitIn(localDir, 'add', 'packages/a');
    } else if (variant === 'destination-file') {
        gitIn(localDir, 'rm', '-r', 'packages/a');
        fs.writeFileSync(workspaceA, 'workspace path is a file\n', 'utf8');
        gitIn(localDir, 'add', 'packages/a');
    } else if (variant === 'workspace-absent') {
        gitIn(localDir, 'rm', '-r', 'packages/a');
    }

    if (variant !== 'missing' && variant !== 'source-hoisted') {
        gitIn(localDir, 'commit', '-m', `workspace destination ${variant}`);
    }
    gitIn(localDir, 'checkout', 'main');

    const repoModulesFixture = path.join(localDir, 'node_modules');
    fs.mkdirSync(repoModulesFixture, { recursive: true });
    fs.writeFileSync(path.join(repoModulesFixture, 'marker.txt'), 'root install\n', 'utf8');
    const repoWorkspaceModules = {
        'packages/a': path.join(localDir, 'packages/a/node_modules'),
        'packages/b': path.join(localDir, 'packages/b/node_modules'),
    } as const;
    for (const workspace of ['packages/a', 'packages/b'] as const) {
        if (variant === 'source-hoisted' && workspace === 'packages/a') continue;
        fs.mkdirSync(repoWorkspaceModules[workspace], { recursive: true });
        fs.writeFileSync(path.join(repoWorkspaceModules[workspace], 'marker.txt'), `${workspace} install\n`, 'utf8');
    }

    const worktreesRoot = path.join(dir, 'worktrees');
    const worktreeDir = path.join(worktreesRoot, taskId);
    fs.mkdirSync(worktreesRoot, { recursive: true });
    return {
        localDir,
        worktreesRoot,
        worktreeDir,
        branch,
        repoModulesFixture,
        repoWorkspaceModules,
        wrongTarget,
        outsideDestination,
    };
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

function writeReviewRecoveryTask(
    tasksRoot: string,
    taskId: string,
    phase: 'spec_review' | 'code_review',
    phaseStatus: 'in_progress' | 'done',
    verdict: string,
    counters = { current: 0, total: 0, changesRequested: 0 },
): void {
    const status = makeCompleteStatus(taskId, `task/${taskId}`);
    status.status = phase;
    status.human_spec_gate = false;
    status.delicate = true;
    const phases = status.phases as Record<string, Record<string, unknown>>;
    phases[phase] = {
        status: phaseStatus,
        agent: phase === 'spec_review' ? 'codex' : 'claude',
        verdict: phaseStatus === 'done' ? verdict : '',
        iterations: counters.current,
        iterations_current_loop: counters.current,
        iterations_total: counters.total,
        changes_requested_total: counters.changesRequested,
        auto_block_count: 0,
        preflight_rejections_current_loop: 0,
    };
    if (phase === 'spec_review') {
        phases.plan = { status: 'pending', agent: 'claude' };
        phases.implement = { status: 'pending', agent: 'codex' };
        phases.code_review = { status: 'pending', agent: 'claude', verdict: '' };
        phases.qa = { status: 'pending', agent: 'claude' };
        phases.human_review = { status: 'pending', agent: 'human' };
    } else {
        phases.qa = { status: 'pending', agent: 'claude' };
        phases.human_review = { status: 'pending', agent: 'human' };
    }
    writeTaskStatus(tasksRoot, taskId, status);
    const artifact = phase === 'spec_review' ? 'spec-review.md' : 'review.md';
    const verdictLabel = verdict === 'changes_requested' ? 'Changes requested'
        : verdict === 'approved_with_nits' ? 'Approved with nits'
        : verdict.charAt(0).toUpperCase() + verdict.slice(1);
    fs.writeFileSync(path.join(tasksRoot, taskId, artifact), [
        phase === 'spec_review' ? '# Spec Review' : '# Code Review',
        '',
        '## Verdict',
        '',
        `- [x] **${verdictLabel}**`,
        '',
    ].join('\n'), 'utf8');
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
    const mainHref = pathToFileURL(path.join(process.cwd(), 'src/orchestrator/main.ts')).href;
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
        "import { commitHumanReviewFiles } from './src/orchestrator/main.ts';",
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

function writeQaArtifacts(repoDir: string, taskId: string): void {
    const taskDir = path.join(repoDir, 'tasks', taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    for (const fileName of ['handoff.md', 'review.md', 'done.md', 'notes.md', 'status.json']) {
        fs.writeFileSync(path.join(taskDir, fileName), `${taskId} ${fileName}\n`, 'utf8');
    }
}

function runCommitQaArtifactsInline(taskId: string, cwd: string): { status: number | null; stderr: string; stdout: string } {
    return runNodeInline([
        `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
        `.then(m => { m.commitQaArtifacts([${JSON.stringify(taskId)}], ${JSON.stringify(cwd)}); })`,
        `.catch(err => { console.error(err); process.exit(1); });`,
    ].join('\n'), childEnvWithoutTasksOverride(), cwd);
}

function runEnsureWorktreeInline(
    taskId: string,
    branch: string,
    cwd: string,
    worktreesRoot?: string,
): { status: number | null; stderr: string; stdout: string } {
    const env = childEnvWithoutTasksOverride();
    if (worktreesRoot === undefined) delete env.CANON_WORKTREES_ROOT;
    else env.CANON_WORKTREES_ROOT = worktreesRoot;
    return runNodeInline([
        `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/worktree.ts')).href)})`,
        `.then(m => { m.ensureWorktree(${JSON.stringify(taskId)}, ${JSON.stringify(branch)}); })`,
        `.catch(err => { console.error(err); process.exit(1); });`,
    ].join('\n'), env, cwd);
}

function runIsExemptNodeModulesEntryInline(
    entry: { raw: string; indexStatus: string; worktreeStatus: string; paths: string[] },
    cwd: string,
): { status: number | null; stderr: string; stdout: string } {
    return runNodeInline([
        `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
        `.then(m => { console.log(String(m.isExemptNodeModulesEntry(${JSON.stringify(entry)}, ${JSON.stringify(cwd)}))); })`,
        `.catch(err => { console.error(err); process.exit(1); });`,
    ].join('\n'), childEnvWithoutTasksOverride(), cwd);
}

function runTeardownWorktreeInline(
    taskId: string,
    cwd: string,
    worktreesRoot?: string,
): { status: number | null; stderr: string; stdout: string } {
    const env = childEnvWithoutTasksOverride();
    if (worktreesRoot === undefined) delete env.CANON_WORKTREES_ROOT;
    else env.CANON_WORKTREES_ROOT = worktreesRoot;
    return runNodeInline([
        `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/worktree.ts')).href)})`,
        `.then(m => { m.teardownWorktree(${JSON.stringify(taskId)}); })`,
        `.catch(err => { console.error(err); process.exit(1); });`,
    ].join('\n'), env, cwd);
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
            "import { ensureBranch } from './src/orchestrator/git.js';",
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
            "import { ensureBranch } from './src/orchestrator/git.js';",
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
            "import { startHeartbeat } from './src/orchestrator/heartbeat.js';",
            "import { ensureBranch } from './src/orchestrator/git.js';",
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
            "import { startHeartbeat } from './src/orchestrator/heartbeat.js';",
            "import { ensureBranch } from './src/orchestrator/git.js';",
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
            "import { ensureBranch } from './src/orchestrator/git.js';",
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

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: logPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_BASE_BRANCH: 'release/v1',
            FAKE_GIT_TASK_BRANCH: taskBranch,
            FAKE_GIT_STATUS_OUTPUT: ' M src/dirty.ts',
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { ensureBranch } from './src/orchestrator/git.js';",
            `ensureBranch(${JSON.stringify([taskId])});`,
        ].join('\n'), env));
        assert.equal(result.status, 0, result.stderr);

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
            stageArchiveChanges(['tasks/example']);
            const result = commitArchiveChanges(['example'], 'main');
            assert.deepEqual(result, { committed: false, stderr: 'commit failed' });
        });

        const log = fs.readFileSync(logPath, 'utf8');
        assert.match(log, /add -A -- tasks\/example/);
        assert.match(log, /diff --cached --name-only/);
        assert.match(log, /commit -m chore: archive example/);
        assert.doesNotMatch(log, /push origin main/);
    });
});

void test('ensureBranch records a bundle secondary\'s branch in the worktree, never main', () => {
    withTempDir('run-task-safety-bundle-wrong-main-', dir => {
        const { localDir } = makeGitFixture(dir);
        const worktreesRoot = path.join(dir, 'worktrees');
        const leaderId = 'bundle-leader';
        const secondaryId = 'bundle-secondary';
        const taskBranch = `task/${leaderId}`;

        writeTaskStatus(path.join(localDir, 'tasks'), leaderId, {
            title: leaderId,
            base_branch: 'main',
            branch: '',
            worktree: true,
            phases: {},
        });
        writeTaskStatus(path.join(localDir, 'tasks'), secondaryId, {
            title: secondaryId,
            base_branch: 'main',
            branch: '',
            worktree: true,
            phases: {},
        });
        gitIn(localDir, 'add', 'tasks');
        gitIn(localDir, 'commit', '-m', 'task artifacts pre-pipeline');

        const gitModuleUrl = pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/git.ts')).href;
        const ensureResult = runNodeInline([
            `import(${JSON.stringify(gitModuleUrl)})`,
            `.then(m => { m.ensureBranch(${JSON.stringify([leaderId, secondaryId])}); })`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({ CANON_WORKTREES_ROOT: worktreesRoot }), localDir);
        assert.equal(ensureResult.status, 0, ensureResult.stderr);

        const leaderWorktree = path.join(worktreesRoot, leaderId);
        const worktreeSecondaryStatus = JSON.parse(
            fs.readFileSync(path.join(leaderWorktree, 'tasks', secondaryId, 'status.json'), 'utf8'),
        ) as { branch?: string };
        assert.equal(worktreeSecondaryStatus.branch, taskBranch);

        const mainSecondaryStatus = JSON.parse(
            fs.readFileSync(path.join(localDir, 'tasks', secondaryId, 'status.json'), 'utf8'),
        ) as { branch?: string };
        assert.equal(mainSecondaryStatus.branch, '');
        const mainStatus = execFileSync('git', ['status', '--porcelain', '--', `tasks/${secondaryId}/status.json`], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.equal(mainStatus, '');

        const stateModuleUrl = pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/state.ts')).href;
        const resolveResult = runNodeInline([
            `import(${JSON.stringify(stateModuleUrl)})`,
            `.then(m => { console.log(m.resolveTaskCwd(${JSON.stringify(secondaryId)})); })`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({ CANON_WORKTREES_ROOT: worktreesRoot }), localDir);
        assert.equal(resolveResult.status, 0, resolveResult.stderr);
        assert.equal(resolveResult.stdout.trim(), fs.realpathSync(leaderWorktree));
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

void test('resolveTaskCwd does not false-match an unrelated worktree that only inherited the task dir', () => {
    withTempDir('run-task-safety-scan-inherited-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'scan-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'main',
            branch: '',
            worktree: true,
            phases: {},
        });

        const otherWorktree = path.join(dir, 'unrelated-worktree');
        writeTaskStatus(path.join(otherWorktree, 'tasks'), taskId, {
            worktree: true,
            branch: '',
            phases: {},
        });
        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${otherWorktree}`,
            'HEAD abc123',
            'branch refs/heads/some-other-branch',
            '',
        ].join('\n'), 'utf8');

        withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, () => {
            assert.equal(resolveTaskCwd(taskId), REPO_ROOT);
        });
    });
});

void test('resolveTaskCwd does not scan worktrees when main records worktree: false', () => {
    withTempDir('run-task-safety-scan-worktree-false-main-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'non-worktree-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'main',
            branch: '',
            worktree: false,
            phases: {},
        });

        const staleWorktree = path.join(dir, 'stale-worktree');
        writeTaskStatus(path.join(staleWorktree, 'tasks'), taskId, {
            worktree: true,
            branch: 'stale-branch',
            phases: {},
        });
        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${staleWorktree}`,
            'HEAD abc123',
            'branch refs/heads/stale-branch',
            '',
        ].join('\n'), 'utf8');

        withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, () => {
            assert.equal(resolveTaskCwd(taskId), REPO_ROOT);
        });
    });
});

void test('resolveTaskCwd does not match a worktree whose own status.json records worktree: false', () => {
    withTempDir('run-task-safety-scan-candidate-worktree-false-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'candidate-worktree-false';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'main',
            branch: '',
            worktree: true,
            phases: {},
        });

        const candidateWorktree = path.join(dir, 'candidate-worktree');
        writeTaskStatus(path.join(candidateWorktree, 'tasks'), taskId, {
            worktree: false,
            branch: 'candidate-branch',
            phases: {},
        });
        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${candidateWorktree}`,
            'HEAD abc123',
            'branch refs/heads/candidate-branch',
            '',
        ].join('\n'), 'utf8');

        withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, () => {
            assert.equal(resolveTaskCwd(taskId), REPO_ROOT);
        });
    });
});

void test('resolveTaskCwd dies naming candidates when two worktrees both claim ownership', () => {
    withTempDir('run-task-safety-scan-ambiguous-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'ambiguous-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'main',
            branch: '',
            worktree: true,
            phases: {},
        });

        const worktreeOne = path.join(dir, 'worktree-one');
        const worktreeTwo = path.join(dir, 'worktree-two');
        for (const [worktreePath, branch] of [[worktreeOne, 'branch-one'], [worktreeTwo, 'branch-two']] as const) {
            writeTaskStatus(path.join(worktreePath, 'tasks'), taskId, {
                worktree: true,
                branch,
                phases: {},
            });
        }
        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${worktreeOne}`,
            'HEAD abc123',
            'branch refs/heads/branch-one',
            '',
            `worktree ${worktreeTwo}`,
            'HEAD def456',
            'branch refs/heads/branch-two',
            '',
        ].join('\n'), 'utf8');

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { resolveTaskCwd } from './src/orchestrator/state.js';",
            `resolveTaskCwd(${JSON.stringify(taskId)});`,
        ].join('\n'), env));

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Multiple worktrees claim ownership/);
        assert.ok(result.stderr.includes(worktreeOne));
        assert.ok(result.stderr.includes(worktreeTwo));
    });
});

void test('resolveTaskCwd dies when git worktree list enumeration fails', () => {
    withTempDir('run-task-safety-scan-enum-fail-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'enum-fail-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'main',
            branch: '',
            worktree: true,
            phases: {},
        });

        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FAIL: '1',
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { resolveTaskCwd } from './src/orchestrator/state.js';",
            `resolveTaskCwd(${JSON.stringify(taskId)});`,
        ].join('\n'), env));

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Could not enumerate git worktrees/);
    });
});

void test('resolveTaskCwd dies when a candidate status.json is present but unparseable', () => {
    withTempDir('run-task-safety-scan-invalid-json-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'invalid-json-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'main',
            branch: '',
            worktree: true,
            phases: {},
        });
        const candidateWorktree = path.join(dir, 'candidate-worktree');
        const candidateTaskDir = path.join(candidateWorktree, 'tasks', taskId);
        fs.mkdirSync(candidateTaskDir, { recursive: true });
        fs.writeFileSync(path.join(candidateTaskDir, 'status.json'), '{ not valid json', 'utf8');

        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${candidateWorktree}`,
            'HEAD abc123',
            'branch refs/heads/some-branch',
            '',
        ].join('\n'), 'utf8');
        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { resolveTaskCwd } from './src/orchestrator/state.js';",
            `resolveTaskCwd(${JSON.stringify(taskId)});`,
        ].join('\n'), env));

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /unreadable status\.json/);
    });
});

void test('resolveTaskCwd dies when a candidate status.json has a schema-invalid branch field', () => {
    withTempDir('run-task-safety-scan-invalid-schema-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);

        const taskId = 'invalid-schema-task';
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'main',
            branch: '',
            worktree: true,
            phases: {},
        });
        const candidateWorktree = path.join(dir, 'candidate-worktree');
        writeTaskStatus(path.join(candidateWorktree, 'tasks'), taskId, {
            worktree: true,
            branch: 123,
            phases: {},
        });

        const worktreeListFile = path.join(dir, 'worktree-list.txt');
        fs.writeFileSync(worktreeListFile, [
            `worktree ${candidateWorktree}`,
            'HEAD abc123',
            'branch refs/heads/some-branch',
            '',
        ].join('\n'), 'utf8');
        const result = withFakeGitEnv({
            PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_WORKTREE_LIST_FILE: worktreeListFile,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_WORKTREES_ROOT: worktreesRoot,
        }, env => runNodeInline([
            "import { resolveTaskCwd } from './src/orchestrator/state.js';",
            `resolveTaskCwd(${JSON.stringify(taskId)});`,
        ].join('\n'), env));

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /unreadable status\.json/);
        assert.match(result.stderr, /expected string, got number/);
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
            "import { resolveTaskCwd } from './src/orchestrator/state.js';",
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
            "import { getActiveCwd } from './src/orchestrator/worktree.js';",
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
                `import(${JSON.stringify(pathToFileURL(path.join(process.cwd(), 'src/orchestrator/env.ts')).href)})`,
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

void test('classifyNodeModulesLinkFromData decision table', () => {
    const expected = '/repo/node_modules';
    assert.equal(
        classifyNodeModulesLinkFromData({ lstatKind: 'symlink', resolvedTarget: expected, expectedTarget: expected }),
        'verified-symlink',
    );
    assert.equal(
        classifyNodeModulesLinkFromData({ lstatKind: 'file', resolvedTarget: null, expectedTarget: expected }),
        'not-exempt',
    );
    assert.equal(
        classifyNodeModulesLinkFromData({ lstatKind: 'directory', resolvedTarget: null, expectedTarget: expected }),
        'not-exempt',
    );
    assert.equal(
        classifyNodeModulesLinkFromData({ lstatKind: 'symlink', resolvedTarget: '/other/node_modules', expectedTarget: expected }),
        'not-exempt',
    );
    assert.equal(
        classifyNodeModulesLinkFromData({ lstatKind: 'missing', resolvedTarget: null, expectedTarget: expected }),
        'not-exempt',
    );
});

void test('classifyNodeModulesLinkFromData fails closed on probe errors', () => {
    assert.equal(
        classifyNodeModulesLinkFromData({ lstatKind: 'error', resolvedTarget: null, expectedTarget: '/repo/node_modules' }),
        'not-exempt',
    );
    assert.equal(
        classifyNodeModulesLinkFromData({ lstatKind: 'symlink', resolvedTarget: null, expectedTarget: '/repo/node_modules' }),
        'not-exempt',
    );
    assert.equal(
        classifyNodeModulesLinkFromData({ lstatKind: 'symlink', resolvedTarget: '/repo/node_modules', expectedTarget: null }),
        'not-exempt',
    );
});

void test('resolveWorkspaceDirs selects the exact eligible npm workspace set', () => {
    const cases: Array<{ name: string; workspaces: unknown; expected: string[] }> = [
        { name: 'recursive glob', workspaces: ['packages/**'], expected: ['packages/a', 'packages/b'] },
        { name: 'multiple patterns', workspaces: ['packages/*', 'apps/*'], expected: ['apps/app', 'packages/a', 'packages/b'] },
        { name: 'literal', workspaces: ['packages/a'], expected: ['packages/a'] },
        { name: 'overlap', workspaces: ['packages/*', 'packages/a'], expected: ['packages/a', 'packages/b'] },
        { name: 'legacy object', workspaces: { packages: ['packages/*'] }, expected: ['packages/a', 'packages/b'] },
        { name: 'no match', workspaces: ['nope/*'], expected: [] },
        { name: 'empty array', workspaces: [], expected: [] },
        { name: 'non-collection', workspaces: 'packages/*', expected: [] },
        { name: 'non-string entry', workspaces: [42, 'packages/a'], expected: ['packages/a'] },
    ];
    withTempDir('run-task-workspace-resolver-', dir => {
        for (const fixtureCase of cases) {
            const caseDir = path.join(dir, fixtureCase.name.replaceAll(' ', '-'));
            fs.mkdirSync(caseDir, { recursive: true });
            const { repoRoot } = makeWorkspaceResolverFixture(caseDir, fixtureCase.workspaces);
            const actual = resolveWorkspaceDirs(repoRoot);
            assert.deepEqual(actual, fixtureCase.expected, fixtureCase.name);
            for (const workspace of actual) {
                assert.equal(path.isAbsolute(workspace), false);
                assert.notEqual(workspace, '');
                assert.notEqual(workspace, '.');
                assert.equal(workspace.split('/').includes('..'), false);
                assert.equal(workspace.split('/').includes('node_modules'), false);
            }
        }

        const absentDir = path.join(dir, 'absent');
        const { repoRoot: absentRoot } = makeWorkspaceResolverFixture(absentDir, []);
        fs.writeFileSync(path.join(absentRoot, 'package.json'), '{"name":"fixture"}\n', 'utf8');
        assert.deepEqual(resolveWorkspaceDirs(absentRoot), []);

        const invalidDir = path.join(dir, 'invalid-package-json');
        const { repoRoot: invalidRoot } = makeWorkspaceResolverFixture(invalidDir, ['packages/*']);
        fs.writeFileSync(path.join(invalidRoot, 'package.json'), '{not json', 'utf8');
        assert.deepEqual(resolveWorkspaceDirs(invalidRoot), []);
    });
});

void test('resolveWorkspaceDirs skips negations while retaining positive matches', () => {
    withTempDir('run-task-workspace-negation-', dir => {
        const { repoRoot } = makeWorkspaceResolverFixture(dir, ['!packages/a', 'packages/*']);
        const captured = captureConsoleError(() => resolveWorkspaceDirs(repoRoot));
        assert.deepEqual(captured.result, ['packages/a', 'packages/b']);
        assert.match(captured.stderr, /!packages\/a/);
    });
});

void test('resolveWorkspaceDirs enforces lexical and realpath source containment', () => {
    withTempDir('run-task-workspace-source-containment-', dir => {
        const { repoRoot, outsideRoot } = makeWorkspaceResolverFixture(
            dir,
            ['packages/*', '../outside/ext'],
        );
        const prefixSibling = `${repoRoot}-evil`;
        fs.mkdirSync(path.join(outsideRoot, 'ext'), { recursive: true });
        fs.writeFileSync(path.join(outsideRoot, 'ext/package.json'), '{"name":"outside"}\n', 'utf8');
        fs.mkdirSync(prefixSibling, { recursive: true });
        fs.writeFileSync(path.join(prefixSibling, 'package.json'), '{"name":"escape"}\n', 'utf8');
        fs.symlinkSync(prefixSibling, path.join(repoRoot, 'packages/escape'));
        fs.symlinkSync(path.join(outsideRoot, 'missing'), path.join(repoRoot, 'packages/dangling'));

        const captured = captureConsoleError(() => resolveWorkspaceDirs(repoRoot));
        assert.deepEqual(captured.result, ['packages/a', 'packages/b']);
        assert.match(captured.stderr, /\.\.\/outside\/ext/);
        assert.match(captured.stderr, /packages\/escape/);
        for (const workspace of captured.result) {
            assert.equal(path.isAbsolute(workspace), false);
            assert.equal(workspace.split('/').includes('..'), false);
            assert.equal(workspace.split('/').includes('node_modules'), false);
        }
    });
});

void test('isContainedIn compares canonical path segments and fails closed', () => {
    withTempDir('run-task-contained-in-', dir => {
        const root = path.join(dir, 'wt');
        const nested = path.join(root, 'packages/a');
        const sibling = path.join(dir, 'wt-evil');
        fs.mkdirSync(nested, { recursive: true });
        fs.mkdirSync(sibling, { recursive: true });
        assert.equal(isContainedIn(nested, root), true);
        assert.equal(isContainedIn(root, root), false);
        assert.equal(isContainedIn(sibling, root), false);
        assert.equal(isContainedIn(path.join(dir, 'missing'), root), false);
        assert.equal(isContainedIn(nested, path.join(dir, 'missing-root')), false);
    });
});

void test('workspace node_modules exemption rejects staged entries before probing', () => {
    withTempDir('run-task-workspace-staged-predicate-', dir => {
        const taskId = 'task-a';
        const { worktreeDir, repoWorkspaceModules } =
            makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        fs.symlinkSync(repoWorkspaceModules, path.join(worktreeDir, 'packages/a/node_modules'));

        const result = runIsExemptNodeModulesEntryInline({
            raw: 'A  packages/a/node_modules',
            indexStatus: 'A',
            worktreeStatus: ' ',
            paths: ['packages/a/node_modules'],
        }, worktreeDir);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), 'false');
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
        {
            raw: '?? node_modules',
            indexStatus: '?',
            worktreeStatus: '?',
            paths: ['node_modules'],
        },
    ]);

    assert.deepEqual(paths, [
        'tasks/task-a',
        'docs/lessons-learned.md',
        'docs/codebase-map.md',
        'docs/patterns.md',
    ]);
});

void test('buildHumanReviewStagePaths with full managed-doc set includes only dirty QA-end paths', () => {
    const paths = buildHumanReviewStagePaths(['task-a'], new Set(PIPELINE_MANAGED_DOCS), [
        {
            raw: ' M tasks/task-a/done.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['tasks/task-a/done.md'],
        },
        {
            raw: ' M tasks/task-a/pr-body.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['tasks/task-a/pr-body.md'],
        },
        {
            raw: ' M docs/codebase-map.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['docs/codebase-map.md'],
        },
        {
            raw: ' M docs/lessons-learned.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['docs/lessons-learned.md'],
        },
    ]);

    assert.ok(paths.includes('tasks/task-a'));
    assert.ok(paths.includes('docs/codebase-map.md'));
    assert.ok(paths.includes('docs/lessons-learned.md'));
    assert.ok(!paths.includes('docs/decisions.md'), 'non-dirty managed docs must not be staged from a hardcoded root list');
});

void test('buildHumanReviewStagePaths stages a QA-touched managed doc absent from Affected Files', () => {
    const paths = buildHumanReviewStagePaths(['task-b'], new Set(PIPELINE_MANAGED_DOCS), [
        {
            raw: ' M docs/decisions.md',
            indexStatus: ' ',
            worktreeStatus: 'M',
            paths: ['docs/decisions.md'],
        },
    ]);

    assert.deepEqual(paths, ['docs/decisions.md']);
});

void test('commitQaArtifacts commits task artifacts, telemetry, and managed docs from the active worktree', () => {
    withTempDir('run-task-qa-end-real-git-', dir => {
        const { localDir } = makeGitFixture(dir);
        writeQaArtifacts(localDir, 'task-a');
        fs.mkdirSync(path.join(localDir, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'docs', 'codebase-map.md'), 'qa doc freshness\n', 'utf8');
        fs.writeFileSync(path.join(localDir, 'docs', 'lessons-learned.md'), 'qa telemetry\n', 'utf8');

        commitQaArtifacts(['task-a'], localDir);

        const status = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.equal(status, '');
        const subject = execFileSync('git', ['log', '-1', '--pretty=%s'], {
            cwd: localDir,
            encoding: 'utf8',
        }).trim();
        assert.equal(subject, 'chore: QA artifacts for task-a');
    });
});

void test('commitQaArtifacts exempts the verified node_modules worktree symlink', () => {
    withTempDir('run-task-nm-qa-end-', dir => {
        const taskId = 'task-a';
        const { worktreeDir, repoModulesFixture } = makeNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        fs.symlinkSync(repoModulesFixture, path.join(worktreeDir, 'node_modules'));
        writeQaArtifacts(worktreeDir, taskId);

        const result = runCommitQaArtifactsInline(taskId, worktreeDir);
        assert.equal(result.status, 0, result.stderr);

        const status = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.equal(status, '?? node_modules\n');
        const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--name-only'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.doesNotMatch(tree, /(?:^|\n)node_modules(?:\n|$)/);
        const subject = execFileSync('git', ['log', '-1', '--pretty=%s'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        }).trim();
        assert.equal(subject, 'chore: QA artifacts for task-a');
    });
});

void test('commitQaArtifacts exempts verified root and workspace node_modules symlinks', () => {
    withTempDir('run-task-workspace-nm-qa-end-', dir => {
        const taskId = 'task-a';
        const { worktreeDir, repoModulesFixture, repoWorkspaceModules } =
            makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        fs.symlinkSync(repoModulesFixture, path.join(worktreeDir, 'node_modules'));
        fs.symlinkSync(repoWorkspaceModules, path.join(worktreeDir, 'packages/a/node_modules'));
        const porcelainBefore = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelainBefore, /^\?\? node_modules$/m);
        assert.match(porcelainBefore, /^\?\? packages\/a\/node_modules$/m);
        writeQaArtifacts(worktreeDir, taskId);

        const result = runCommitQaArtifactsInline(taskId, worktreeDir);
        assert.equal(result.status, 0, result.stderr);

        const porcelainAfter = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.equal(porcelainAfter, '?? node_modules\n?? packages/a/node_modules\n');
    });
});

void test('commitQaArtifacts excludes a verified workspace symlink that resolves inside tasks/<id>', () => {
    // Regression for a PR-review finding on worktree-workspace-node-modules-links:
    // when an eligible workspace resolves inside `tasks/<id>` itself (an unusual
    // but valid workspace glob like `tasks/*`), the verified node_modules symlink
    // must still be excluded from the `git add -A -- tasks/<id>` sweep. Pre-fix,
    // commitQaArtifacts had no exclusion mechanism at all on that add, so the
    // exempt symlink rode the sweep into the index and the post-staging
    // final-segment check aborted the commit with the symlink left staged.
    withTempDir('run-task-workspace-in-taskdir-', dir => {
        const taskId = 'task-a';
        const { localDir } = makeGitFixture(dir);
        const branch = `task/${taskId}`;
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        fs.mkdirSync(worktreesRoot, { recursive: true });
        fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
            name: 'fixture',
            workspaces: ['tasks/*'],
        }), 'utf8');
        fs.mkdirSync(path.join(localDir, 'tasks', taskId), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'tasks', taskId, 'package.json'), '{"version":"1.0.0"}\n', 'utf8');
        fs.writeFileSync(path.join(localDir, '.gitignore'), 'node_modules/\n', 'utf8');
        gitIn(localDir, 'add', 'package.json', '.gitignore');
        gitIn(localDir, 'commit', '-m', 'fixture setup');
        gitIn(localDir, 'push', 'origin', 'main');

        const repoWorkspaceModules = path.join(localDir, 'tasks', taskId, 'node_modules');
        fs.mkdirSync(repoWorkspaceModules, { recursive: true });
        fs.writeFileSync(path.join(repoWorkspaceModules, 'marker.txt'), 'workspace install\n', 'utf8');

        gitIn(localDir, 'worktree', 'add', worktreeDir, '-b', branch);
        writeQaArtifacts(worktreeDir, taskId);
        fs.symlinkSync(repoWorkspaceModules, path.join(worktreeDir, 'tasks', taskId, 'node_modules'));

        const porcelainBefore = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelainBefore, /^\?\? tasks\/task-a\/node_modules$/m);
        assert.match(porcelainBefore, /^\?\? tasks\/task-a\/handoff\.md$/m);

        const result = runCommitQaArtifactsInline(taskId, worktreeDir);
        assert.equal(result.status, 0, result.stderr);

        const porcelainAfter = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.equal(porcelainAfter, '?? tasks/task-a/node_modules\n');
        const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--name-only'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.doesNotMatch(tree, /node_modules/);
        assert.match(tree, /^tasks\/task-a\/handoff\.md$/m);
    });
});

void test('commitQaArtifacts resolves workspace patterns at most once per dirty-tree evaluation', () => {
    withTempDir('run-task-workspace-resolver-once-', dir => {
        const taskId = 'task-a';
        const { localDir, worktreeDir, repoWorkspaceModules } =
            makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
            name: 'fixture',
            workspaces: ['!packages/a', 'packages/*'],
        }), 'utf8');
        fs.symlinkSync(repoWorkspaceModules, path.join(worktreeDir, 'packages/a/node_modules'));
        writeQaArtifacts(worktreeDir, taskId);
        fs.writeFileSync(path.join(worktreeDir, 'stray-one.txt'), 'one\n', 'utf8');
        fs.writeFileSync(path.join(worktreeDir, 'stray-two.txt'), 'two\n', 'utf8');

        const result = runCommitQaArtifactsInline(taskId, worktreeDir);
        assert.notEqual(result.status, 0);
        assert.equal(
            (result.stderr.match(/Ignoring unsupported negated workspace pattern: !packages\/a/g) ?? []).length,
            1,
        );
    });
});

void test('workspace gate predicate rejects escaping and unresolvable destinations without blocking root evaluation', () => {
    withTempDir('run-task-workspace-gate-containment-', dir => {
        const taskId = 'task-a';
        const { worktreeDir, repoModulesFixture, repoWorkspaceModules } =
            makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        fs.symlinkSync(repoModulesFixture, path.join(worktreeDir, 'node_modules'));
        const outsideWorkspace = `${worktreeDir}-evil`;
        fs.mkdirSync(outsideWorkspace, { recursive: true });
        fs.symlinkSync(repoWorkspaceModules, path.join(outsideWorkspace, 'node_modules'));
        fs.rmSync(path.join(worktreeDir, 'packages/a'), { recursive: true, force: true });
        fs.symlinkSync(outsideWorkspace, path.join(worktreeDir, 'packages/a'));

        const workspaceEntry = {
            raw: '?? packages/a/node_modules',
            indexStatus: '?',
            worktreeStatus: '?',
            paths: ['packages/a/node_modules'],
        };
        const escaped = runIsExemptNodeModulesEntryInline(workspaceEntry, worktreeDir);
        assert.equal(escaped.status, 0, escaped.stderr);
        assert.equal(escaped.stdout.trim(), 'false');

        const rootEntry = {
            raw: '?? node_modules',
            indexStatus: '?',
            worktreeStatus: '?',
            paths: ['node_modules'],
        };
        const root = runIsExemptNodeModulesEntryInline(rootEntry, worktreeDir);
        assert.equal(root.status, 0, root.stderr);
        assert.equal(root.stdout.trim(), 'true');

        fs.rmSync(path.join(worktreeDir, 'packages/a'));
        fs.symlinkSync(path.join(dir, 'missing-workspace'), path.join(worktreeDir, 'packages/a'));
        const dangling = runIsExemptNodeModulesEntryInline(workspaceEntry, worktreeDir);
        assert.equal(dangling.status, 0, dangling.stderr);
        assert.equal(dangling.stdout.trim(), 'false');
    });
});

void test('gate exempts the canonical destination of an in-repo symlinked workspace', () => {
    withTempDir('run-task-workspace-canonical-destination-', dir => {
        const taskId = 'task-a';
        const { localDir } = makeGitFixture(dir);
        fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
            name: 'fixture',
            workspaces: ['packages/*'],
        }), 'utf8');
        fs.writeFileSync(path.join(localDir, '.gitignore'), 'node_modules/\n', 'utf8');
        fs.mkdirSync(path.join(localDir, 'packages'), { recursive: true });
        fs.mkdirSync(path.join(localDir, 'modules/a'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'modules/a/package.json'), '{"name":"a"}\n', 'utf8');
        fs.symlinkSync('../modules/a', path.join(localDir, 'packages/a'));
        gitIn(localDir, 'add', '.gitignore', 'package.json', 'packages/a', 'modules/a/package.json');
        gitIn(localDir, 'commit', '-m', 'symlinked workspace fixture');
        fs.mkdirSync(path.join(localDir, 'node_modules'), { recursive: true });
        fs.mkdirSync(path.join(localDir, 'modules/a/node_modules'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'modules/a/node_modules/marker.txt'), 'workspace install\n', 'utf8');

        const branch = `task/${taskId}`;
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        const setup = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(setup.status, 0, setup.stderr);
        const canonicalLink = path.join(worktreeDir, 'modules/a/node_modules');
        assert.equal(fs.lstatSync(canonicalLink).isSymbolicLink(), true);
        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /^\?\? modules\/a\/node_modules$/m);
        writeQaArtifacts(worktreeDir, taskId);

        const result = runCommitQaArtifactsInline(taskId, worktreeDir);
        assert.equal(result.status, 0, result.stderr);
        const after = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.equal(after, '?? modules/a/node_modules\n?? node_modules\n');
    });
});

void test('gate exempts a verified workspace symlink when git C-quotes the path', () => {
    withTempDir('run-task-workspace-quoted-path-', dir => {
        const taskId = 'task-a';
        const { localDir } = makeGitFixture(dir);
        fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
            name: 'fixture',
            workspaces: ['packages/*'],
        }), 'utf8');
        fs.writeFileSync(path.join(localDir, '.gitignore'), 'node_modules/\n', 'utf8');
        const workspace = 'packages/café';
        fs.mkdirSync(path.join(localDir, workspace), { recursive: true });
        fs.writeFileSync(path.join(localDir, workspace, 'package.json'), '{"name":"cafe"}\n', 'utf8');
        gitIn(localDir, 'add', '.gitignore', 'package.json', workspace);
        gitIn(localDir, 'commit', '-m', 'unicode workspace fixture');
        fs.mkdirSync(path.join(localDir, 'node_modules'), { recursive: true });
        fs.mkdirSync(path.join(localDir, workspace, 'node_modules'), { recursive: true });

        const branch = `task/${taskId}`;
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        const setup = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(setup.status, 0, setup.stderr);
        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /packages\/caf\\303\\251\/node_modules/);
        writeQaArtifacts(worktreeDir, taskId);

        const result = runCommitQaArtifactsInline(taskId, worktreeDir);
        assert.equal(result.status, 0, result.stderr);
    });
});

void test('gate treats an untracked workspace path containing a rename separator as one path', () => {
    withTempDir('run-task-workspace-arrow-path-', dir => {
        const taskId = 'task-a';
        const { localDir } = makeGitFixture(dir);
        const workspace = 'packages/a -> b';
        fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
            name: 'fixture',
            workspaces: ['packages/*'],
        }), 'utf8');
        fs.writeFileSync(path.join(localDir, '.gitignore'), 'node_modules/\n', 'utf8');
        fs.mkdirSync(path.join(localDir, workspace), { recursive: true });
        fs.writeFileSync(path.join(localDir, workspace, 'package.json'), '{"name":"arrow"}\n', 'utf8');
        gitIn(localDir, 'add', '.gitignore', 'package.json', workspace);
        gitIn(localDir, 'commit', '-m', 'arrow workspace fixture');
        fs.mkdirSync(path.join(localDir, 'node_modules'), { recursive: true });
        fs.mkdirSync(path.join(localDir, workspace, 'node_modules'), { recursive: true });

        const branch = `task/${taskId}`;
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        const setup = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(setup.status, 0, setup.stderr);
        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /^\?\? "packages\/a -> b\/node_modules"$/m);
        writeQaArtifacts(worktreeDir, taskId);

        const result = runCommitQaArtifactsInline(taskId, worktreeDir);
        assert.equal(result.status, 0, result.stderr);
    });
});

void test('gate decodes selectively quoted workspace paths when core.quotepath is false', () => {
    withTempDir('run-task-workspace-selective-quote-', dir => {
        const taskId = 'task-a';
        const { localDir } = makeGitFixture(dir);
        gitIn(localDir, 'config', 'core.quotepath', 'false');
        const workspace = 'packages/café"q';
        fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
            name: 'fixture',
            workspaces: ['packages/*'],
        }), 'utf8');
        fs.writeFileSync(path.join(localDir, '.gitignore'), 'node_modules/\n', 'utf8');
        fs.mkdirSync(path.join(localDir, workspace), { recursive: true });
        fs.writeFileSync(path.join(localDir, workspace, 'package.json'), '{"name":"cafe"}\n', 'utf8');
        gitIn(localDir, 'add', '.gitignore', 'package.json', workspace);
        gitIn(localDir, 'commit', '-m', 'selectively quoted workspace fixture');
        fs.mkdirSync(path.join(localDir, 'node_modules'), { recursive: true });
        fs.mkdirSync(path.join(localDir, workspace, 'node_modules'), { recursive: true });

        const branch = `task/${taskId}`;
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        const setup = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(setup.status, 0, setup.stderr);
        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /packages\/café\\"q\/node_modules/);
        writeQaArtifacts(worktreeDir, taskId);

        const result = runCommitQaArtifactsInline(taskId, worktreeDir);
        assert.equal(result.status, 0, result.stderr);
    });
});

void test('gate compares normalized Unicode workspace paths', () => {
    withTempDir('run-task-workspace-normalized-path-', dir => {
        const taskId = 'task-a';
        const { localDir } = makeGitFixture(dir);
        const workspace = 'packages/cafe\u0301';
        fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
            name: 'fixture',
            workspaces: ['packages/*'],
        }), 'utf8');
        fs.mkdirSync(path.join(localDir, workspace), { recursive: true });
        fs.writeFileSync(path.join(localDir, workspace, 'package.json'), '{"name":"cafe"}\n', 'utf8');
        gitIn(localDir, 'add', 'package.json', workspace);
        gitIn(localDir, 'commit', '-m', 'decomposed workspace fixture');
        fs.mkdirSync(path.join(localDir, 'node_modules'), { recursive: true });
        fs.mkdirSync(path.join(localDir, workspace, 'node_modules'), { recursive: true });

        const branch = `task/${taskId}`;
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        const setup = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(setup.status, 0, setup.stderr);
        const result = runIsExemptNodeModulesEntryInline({
            raw: '?? packages/café/node_modules',
            indexStatus: '?',
            worktreeStatus: '?',
            paths: ['packages/café/node_modules'],
        }, worktreeDir);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), 'true');
    });
});

void test('commitHumanReviewFiles pushes a tree dirty only with the verified node_modules symlink', () => {
    withTempDir('run-task-nm-human-review-', dir => {
        const taskId = 'task-a';
        const { worktreesRoot, worktreeDir, branch, repoModulesFixture } =
            makeNodeModulesGateFixture(dir, taskId, 'node_modules/\n');

        const status = { ...makeHumanReviewPendingStatus(taskId, branch), worktree: true };
        writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
        writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), taskId, []);
        gitIn(worktreeDir, 'add', 'tasks');
        gitIn(worktreeDir, 'commit', '-m', 'qa artifacts');

        fs.symlinkSync(repoModulesFixture, path.join(worktreeDir, 'node_modules'));

        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            `.then(m => {`,
            `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--push'];`,
            `  return m.main();`,
            `})`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }), worktreeDir);

        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(result.stderr, /outside the human_review allowlist/);
        assert.doesNotMatch(result.stderr, /no allowed dirty files found to stage/);

        const remoteRef = execFileSync('git', ['ls-remote', 'origin', branch], {
            cwd: worktreeDir,
            encoding: 'utf8',
        }).trim();
        assert.ok(remoteRef.length > 0, 'branch was not pushed to origin');
    });
});

void test('commitHumanReviewFiles treats N verified node_modules symlinks as a clean tree', () => {
    withTempDir('run-task-workspace-nm-human-review-', dir => {
        const taskId = 'task-a';
        const { worktreesRoot, worktreeDir, branch, repoModulesFixture, repoWorkspaceModules } =
            makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');

        const status = { ...makeHumanReviewPendingStatus(taskId, branch), worktree: true };
        writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
        writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), taskId, []);
        gitIn(worktreeDir, 'add', 'tasks');
        gitIn(worktreeDir, 'commit', '-m', 'qa artifacts');
        fs.symlinkSync(repoModulesFixture, path.join(worktreeDir, 'node_modules'));
        fs.symlinkSync(repoWorkspaceModules, path.join(worktreeDir, 'packages/a/node_modules'));
        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /^\?\? node_modules$/m);
        assert.match(porcelain, /^\?\? packages\/a\/node_modules$/m);

        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);
        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            `.then(m => {`,
            `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--push'];`,
            `  return m.main();`,
            `})`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }), worktreeDir);

        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(result.stderr, /outside the human_review allowlist/);
        assert.doesNotMatch(result.stderr, /no allowed dirty files found to stage/);
        const remoteRef = execFileSync('git', ['ls-remote', 'origin', branch], {
            cwd: worktreeDir,
            encoding: 'utf8',
        }).trim();
        assert.ok(remoteRef.length > 0, 'branch was not pushed to origin');
    });
});

void test('commitHumanReviewFiles never lets an Affected Files directory prefix allow a node_modules entry', () => {
    withTempDir('run-task-workspace-nm-prefix-reject-', dir => {
        const taskId = 'task-a';
        const { worktreesRoot, worktreeDir, branch } =
            makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        const status = { ...makeHumanReviewPendingStatus(taskId, branch), worktree: true };
        writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
        writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), taskId, ['`packages/`']);
        gitIn(worktreeDir, 'add', 'tasks');
        gitIn(worktreeDir, 'commit', '-m', 'qa artifacts');

        const wrongTarget = path.join(dir, 'wrong-workspace-target');
        fs.mkdirSync(wrongTarget, { recursive: true });
        fs.symlinkSync(wrongTarget, path.join(worktreeDir, 'packages/a/node_modules'));
        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /^\?\? packages\/a\/node_modules$/m);

        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);
        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            `.then(m => {`,
            `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--push'];`,
            `  return m.main();`,
            `})`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }), worktreeDir);

        assert.notEqual(result.status, 0, 'directory prefix unexpectedly allowed node_modules');
        assert.match(result.stderr, /outside the human_review allowlist/);
        const after = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(after, /^\?\? packages\/a\/node_modules$/m);
    });
});

for (const variant of ['ineligible', 'task-branch', 'staged'] as const) {
    void test(`directory prefixes reject ${variant} node_modules entries`, () => {
        withTempDir(`run-task-workspace-nm-prefix-${variant}-`, dir => {
            const taskId = `task-${variant}`;
            const { worktreesRoot, worktreeDir, branch, repoWorkspaceModules } =
                makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
            const status = { ...makeHumanReviewPendingStatus(taskId, branch), worktree: true };
            writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
            writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), taskId, ['`packages/`']);
            gitIn(worktreeDir, 'add', 'tasks');
            gitIn(worktreeDir, 'commit', '-m', 'qa artifacts');

            let rejectedPath: string;
            if (variant === 'ineligible') {
                rejectedPath = 'packages/notapkg/nested/node_modules';
                const wrongTarget = path.join(dir, 'ineligible-target');
                fs.mkdirSync(wrongTarget, { recursive: true });
                fs.symlinkSync(wrongTarget, path.join(worktreeDir, rejectedPath));
            } else if (variant === 'task-branch') {
                rejectedPath = 'packages/c/node_modules';
                fs.mkdirSync(path.join(worktreeDir, 'packages/c'), { recursive: true });
                fs.writeFileSync(path.join(worktreeDir, 'packages/c/package.json'), '{"name":"c"}\n', 'utf8');
                const wrongTarget = path.join(dir, 'task-branch-target');
                fs.mkdirSync(wrongTarget, { recursive: true });
                fs.symlinkSync(wrongTarget, path.join(worktreeDir, rejectedPath));
            } else {
                rejectedPath = 'packages/a/node_modules';
                fs.symlinkSync(repoWorkspaceModules, path.join(worktreeDir, rejectedPath));
                gitIn(worktreeDir, 'add', '-f', rejectedPath);
            }

            const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
                cwd: worktreeDir,
                encoding: 'utf8',
            });
            assert.match(porcelain, new RegExp(`^(?:\\?\\?|A ) ${rejectedPath.replaceAll('/', '\\/')}$`, 'm'));

            const fakeBins = path.join(dir, 'fake-bins');
            fs.mkdirSync(fakeBins, { recursive: true });
            setupFakeCliTools(fakeBins);
            const result = runNodeInline([
                `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
                `.then(m => {`,
                `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--push'];`,
                `  return m.main();`,
                `})`,
                `.catch(err => { console.error(err); process.exit(1); });`,
            ].join('\n'), childEnvWithoutTasksOverride({
                CANON_WORKTREES_ROOT: worktreesRoot,
                PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            }), worktreeDir);

            assert.notEqual(result.status, 0, `${variant} node_modules unexpectedly passed`);
            assert.match(result.stderr, /outside the human_review allowlist/);
            assert.match(result.stderr, /node_modules/);
            const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--name-only'], {
                cwd: worktreeDir,
                encoding: 'utf8',
            });
            assert.doesNotMatch(tree, /node_modules/);
        });
    });
}

void test('directory-prefix staging tolerates an ignored real workspace install beside an exempt link', () => {
    withTempDir('run-task-workspace-nm-prefix-mixed-', dir => {
        const taskId = 'task-a';
        const { localDir, worktreesRoot, worktreeDir, branch, repoWorkspaceModules } =
            makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        const status = { ...makeHumanReviewPendingStatus(taskId, branch), worktree: true };
        writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
        writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), taskId, ['`packages/`']);
        gitIn(worktreeDir, 'add', 'tasks');
        gitIn(worktreeDir, 'commit', '-m', 'qa artifacts');

        fs.mkdirSync(path.join(localDir, 'packages/b/node_modules'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'packages/b/package.json'), '{"name":"b"}\n', 'utf8');
        fs.mkdirSync(path.join(worktreeDir, 'packages/b/node_modules'), { recursive: true });
        fs.writeFileSync(path.join(worktreeDir, 'packages/b/node_modules/marker.txt'), 'local install\n', 'utf8');
        fs.symlinkSync(repoWorkspaceModules, path.join(worktreeDir, 'packages/a/node_modules'));
        fs.writeFileSync(path.join(worktreeDir, 'packages/a/generated.ts'), 'export {};\n', 'utf8');

        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /^\?\? packages\/a\/generated\.ts$/m);
        assert.match(porcelain, /^\?\? packages\/a\/node_modules$/m);
        assert.doesNotMatch(porcelain, /packages\/b\/node_modules/);

        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);
        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            `.then(m => {`,
            `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--push'];`,
            `  return m.main();`,
            `})`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }), worktreeDir);

        assert.equal(result.status, 0, result.stderr);
        const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--name-only'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(tree, /^packages\/a\/generated\.ts$/m);
        assert.doesNotMatch(tree, /node_modules/);
    });
});

void test('directory-form staging normalizes a C-quoted non-ASCII prefix', () => {
    withTempDir('run-task-human-review-dirform-unicode-prefix-', dir => {
        const taskId = 'task-a';
        const { worktreesRoot, worktreeDir, branch } =
            makeNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        const status = { ...makeHumanReviewPendingStatus(taskId, branch), worktree: true };
        writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
        writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), taskId, ['`café/`']);
        gitIn(worktreeDir, 'add', 'tasks');
        gitIn(worktreeDir, 'commit', '-m', 'qa artifacts');
        fs.mkdirSync(path.join(worktreeDir, 'café'), { recursive: true });
        fs.writeFileSync(path.join(worktreeDir, 'café/build.js'), 'export {};\n', 'utf8');

        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /^\?\? "caf\\303\\251\/build\.js"$/m);

        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);
        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            `.then(m => {`,
            `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--push'];`,
            `  return m.main();`,
            `})`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }), worktreeDir);

        assert.equal(result.status, 0, result.stderr);
        const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--name-only', '-z'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        }).split('\0');
        assert.equal(tree.includes('café/build.js'), true);
    });
});

void test('directory-prefix staging does not sweep canon workspace links into the commit', () => {
    withTempDir('run-task-workspace-nm-prefix-stage-', dir => {
        const taskId = 'task-a';
        const { worktreesRoot, worktreeDir, branch, repoWorkspaceModules } =
            makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        const status = { ...makeHumanReviewPendingStatus(taskId, branch), worktree: true };
        writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
        writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), taskId, ['`packages/`']);
        gitIn(worktreeDir, 'add', 'tasks');
        gitIn(worktreeDir, 'commit', '-m', 'qa artifacts');

        fs.symlinkSync(repoWorkspaceModules, path.join(worktreeDir, 'packages/a/node_modules'));
        fs.writeFileSync(path.join(worktreeDir, 'packages/a/allowed-source.ts'), 'export {};\n', 'utf8');
        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /^\?\? packages\/a\/allowed-source\.ts$/m);
        assert.match(porcelain, /^\?\? packages\/a\/node_modules$/m);

        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);
        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            `.then(m => {`,
            `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--push'];`,
            `  return m.main();`,
            `})`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }), worktreeDir);

        assert.equal(result.status, 0, result.stderr);
        const after = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(after, /^\?\? packages\/a\/node_modules$/m);
        const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--name-only'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.match(tree, /^packages\/a\/allowed-source\.ts$/m);
        assert.doesNotMatch(tree, /node_modules/);
    });
});

void test('commitHumanReviewFiles still blocks a force-staged node_modules symlink', () => {
    withTempDir('run-task-nm-human-review-staged-', dir => {
        const taskId = 'task-a';
        const { worktreesRoot, worktreeDir, branch, repoModulesFixture } =
            makeNodeModulesGateFixture(dir, taskId, 'node_modules/\n');

        const status = { ...makeHumanReviewPendingStatus(taskId, branch), worktree: true };
        writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
        writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), taskId, []);
        gitIn(worktreeDir, 'add', 'tasks');
        gitIn(worktreeDir, 'commit', '-m', 'qa artifacts');

        fs.symlinkSync(repoModulesFixture, path.join(worktreeDir, 'node_modules'));
        // Force-stage past .gitignore, e.g. an accidental `git add -f node_modules`.
        // Even though the symlink is otherwise verified, a *staged* node_modules
        // is a deliberate departure from canon's own untracked worktree symlink
        // and must still trip the normal allowlist check, not be waved through.
        gitIn(worktreeDir, 'add', '-f', 'node_modules');

        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);

        const result = runNodeInline([
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
            `.then(m => {`,
            `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--push'];`,
            `  return m.main();`,
            `})`,
            `.catch(err => { console.error(err); process.exit(1); });`,
        ].join('\n'), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
            PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }), worktreeDir);

        assert.notEqual(result.status, 0, 'force-staged node_modules unexpectedly passed');
        assert.match(result.stderr, /outside the human_review allowlist/);
        assert.match(result.stderr, /node_modules/);

        const remoteRef = execFileSync('git', ['ls-remote', 'origin', branch], {
            cwd: worktreeDir,
            encoding: 'utf8',
        }).trim();
        assert.equal(remoteRef.length, 0, 'branch should not have been pushed');
    });
});

void test('commitQaArtifacts still rejects non-exempt node_modules entries', () => {
    for (const variant of ['file', 'directory', 'wrong-target-symlink'] as const) {
        withTempDir(`run-task-nm-negative-${variant}-`, dir => {
            const taskId = `task-${variant}`;
            const gitignoreRule = variant === 'directory' ? null : 'node_modules/\n';
            const { worktreeDir } = makeNodeModulesGateFixture(dir, taskId, gitignoreRule);
            const nodeModulesPath = path.join(worktreeDir, 'node_modules');
            if (variant === 'file') {
                fs.writeFileSync(nodeModulesPath, 'not a symlink\n', 'utf8');
            } else if (variant === 'directory') {
                fs.mkdirSync(nodeModulesPath, { recursive: true });
                fs.writeFileSync(path.join(nodeModulesPath, 'pkg.json'), '{}\n', 'utf8');
            } else {
                const wrongTarget = path.join(dir, 'somewhere-else');
                fs.mkdirSync(wrongTarget, { recursive: true });
                fs.symlinkSync(wrongTarget, nodeModulesPath);
            }
            writeQaArtifacts(worktreeDir, taskId);

            const result = runCommitQaArtifactsInline(taskId, worktreeDir);
            assert.notEqual(result.status, 0, `${variant} unexpectedly passed`);
            assert.match(result.stderr, /QA-end commit aborted: working tree has dirty files outside the QA-end allowlist/);
        });
    }
});

void test('workspace node_modules gate rejects staged, real, wrong-target, and ineligible entries', () => {
    for (const variant of ['staged', 'directory', 'wrong-target', 'ineligible'] as const) {
        withTempDir(`run-task-workspace-nm-negative-${variant}-`, dir => {
            const taskId = `task-${variant}`;
            const gitignoreRule = variant === 'directory' ? null : 'node_modules/\n';
            const { worktreeDir, repoWorkspaceModules } =
                makeWorkspaceNodeModulesGateFixture(dir, taskId, gitignoreRule);
            let candidate: string;
            if (variant === 'ineligible') {
                candidate = path.join(worktreeDir, 'packages/notapkg/nested/node_modules');
                fs.symlinkSync(repoWorkspaceModules, candidate);
            } else {
                candidate = path.join(worktreeDir, 'packages/a/node_modules');
                if (variant === 'directory') {
                    fs.mkdirSync(candidate, { recursive: true });
                    fs.writeFileSync(path.join(candidate, 'marker.txt'), 'real directory\n', 'utf8');
                } else if (variant === 'wrong-target') {
                    const wrongTarget = path.join(dir, 'wrong-target');
                    fs.mkdirSync(wrongTarget, { recursive: true });
                    fs.symlinkSync(wrongTarget, candidate);
                } else {
                    fs.symlinkSync(repoWorkspaceModules, candidate);
                    gitIn(worktreeDir, 'add', '-f', 'packages/a/node_modules');
                }
            }
            writeQaArtifacts(worktreeDir, taskId);
            const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
                cwd: worktreeDir,
                encoding: 'utf8',
            });
            if (variant === 'directory') {
                assert.match(porcelain, /^\?\? packages\/a\/node_modules\/marker\.txt$/m);
            } else if (variant === 'ineligible') {
                assert.match(porcelain, /^\?\? packages\/notapkg\/nested\/node_modules$/m);
            } else if (variant === 'staged') {
                assert.match(porcelain, /^A  packages\/a\/node_modules$/m);
            } else {
                assert.match(porcelain, /^\?\? packages\/a\/node_modules$/m);
            }

            const result = runCommitQaArtifactsInline(taskId, worktreeDir);
            assert.notEqual(result.status, 0, `${variant} unexpectedly passed`);
            assert.match(result.stderr, /outside the QA-end allowlist/);
        });
    }
});

void test('workspace gate predicate classifies an exact real-directory entry as non-exempt', () => {
    withTempDir('run-task-workspace-nm-directory-predicate-', dir => {
        const taskId = 'task-a';
        const { worktreeDir } = makeWorkspaceNodeModulesGateFixture(dir, taskId, null);
        fs.mkdirSync(path.join(worktreeDir, 'packages/a/node_modules'), { recursive: true });
        fs.writeFileSync(path.join(worktreeDir, 'packages/a/node_modules/marker.txt'), 'real directory\n', 'utf8');
        const result = runIsExemptNodeModulesEntryInline({
            raw: '?? packages/a/node_modules',
            indexStatus: '?',
            worktreeStatus: '?',
            paths: ['packages/a/node_modules'],
        }, worktreeDir);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), 'false');
    });
});

void test('workspace node_modules exemption is disabled when no distinct worktree is active', () => {
    withTempDir('run-task-workspace-nm-no-worktree-', dir => {
        const taskId = 'task-a';
        const { localDir, repoWorkspaceModules } =
            makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        const outsideTarget = path.join(dir, 'adopter-workspace-modules');
        fs.mkdirSync(outsideTarget, { recursive: true });
        fs.rmSync(repoWorkspaceModules, { recursive: true, force: true });
        fs.symlinkSync(outsideTarget, repoWorkspaceModules);
        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /^\?\? packages\/a\/node_modules$/m);
        writeQaArtifacts(localDir, taskId);

        const result = runCommitQaArtifactsInline(taskId, localDir);
        assert.notEqual(result.status, 0, 'no-worktree workspace symlink unexpectedly passed');
        assert.match(result.stderr, /outside the QA-end allowlist/);
    });
});

void test('root node_modules exemption remains unchanged when no distinct worktree is active', () => {
    withTempDir('run-task-root-nm-no-worktree-', dir => {
        const taskId = 'task-a';
        const { localDir, repoModulesFixture } =
            makeWorkspaceNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
        const outsideTarget = path.join(dir, 'adopter-root-modules');
        fs.mkdirSync(outsideTarget, { recursive: true });
        fs.rmSync(repoModulesFixture, { recursive: true, force: true });
        fs.symlinkSync(outsideTarget, repoModulesFixture);
        const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.match(porcelain, /^\?\? node_modules$/m);
        writeQaArtifacts(localDir, taskId);

        const result = runCommitQaArtifactsInline(taskId, localDir);
        assert.equal(result.status, 0, result.stderr);
        const after = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.equal(after, '?? node_modules\n');
    });
});

void test('bare node_modules gitignore rule hides the symlink from porcelain entirely', () => {
    withTempDir('run-task-nm-noslash-', dir => {
        const { worktreeDir, repoModulesFixture } = makeNodeModulesGateFixture(dir, 'task-a', 'node_modules\n');
        fs.symlinkSync(repoModulesFixture, path.join(worktreeDir, 'node_modules'));

        const status = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.doesNotMatch(status, /node_modules/);
    });
});

void test('bare node_modules gitignore rule hides nested workspace symlinks entirely', () => {
    withTempDir('run-task-workspace-nm-noslash-', dir => {
        const { worktreeDir, repoWorkspaceModules } =
            makeWorkspaceNodeModulesGateFixture(dir, 'task-a', 'node_modules\n');
        fs.symlinkSync(repoWorkspaceModules, path.join(worktreeDir, 'packages/a/node_modules'));
        const status = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
            cwd: worktreeDir,
            encoding: 'utf8',
        });
        assert.doesNotMatch(status, /node_modules/);
    });
});

void test('ensureWorktree creates and reuses canon node_modules symlinks without clobbering other entries', () => {
    for (const variant of ['missing', 'verified-symlink', 'file', 'directory'] as const) {
        withTempDir(`run-task-ensure-wt-nm-${variant}-`, dir => {
            const taskId = `task-${variant}`;
            const { localDir, worktreesRoot, worktreeDir, branch, repoModulesFixture } =
                makeEnsureWorktreeNodeModulesFixture(dir, taskId, variant);

            const result = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
            assert.equal(result.status, 0, result.stderr);

            const nodeModulesPath = path.join(worktreeDir, 'node_modules');
            const stat = fs.lstatSync(nodeModulesPath);
            if (variant === 'missing' || variant === 'verified-symlink') {
                assert.equal(stat.isSymbolicLink(), true);
                assert.equal(fs.realpathSync(nodeModulesPath), fs.realpathSync(repoModulesFixture));
            } else if (variant === 'file') {
                assert.equal(stat.isFile(), true);
                assert.equal(fs.readFileSync(nodeModulesPath, 'utf8'), 'tracked file\n');
            } else {
                assert.equal(stat.isDirectory(), true);
                assert.equal(fs.readFileSync(path.join(nodeModulesPath, 'pkg.json'), 'utf8'), '{}\n');
            }
        });
    }
});

void test('ensureWorktree prunes a hand-deleted worktree before reusing its branch', () => {
    withTempDir('run-task-ensure-wt-prune-', dir => {
        const taskId = 'task-prune';
        const { localDir, worktreesRoot, worktreeDir, branch } =
            makeEnsureWorktreeNodeModulesFixture(dir, taskId, 'missing');

        const first = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(first.status, 0, first.stderr);
        assert.equal(fs.existsSync(worktreeDir), true);
        fs.rmSync(worktreeDir, { recursive: true, force: true });
        const staleList = execFileSync('git', ['worktree', 'list', '--porcelain'], {
            cwd: localDir,
            encoding: 'utf8',
        });
        const canonicalWorktreeDir = path.join(canonicalizeTestPath(worktreesRoot), taskId);
        assert.match(staleList, new RegExp(`worktree ${canonicalWorktreeDir.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`));

        const second = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(second.status, 0, second.stderr);
        assert.equal(fs.existsSync(worktreeDir), true);
        const repairedList = execFileSync('git', ['worktree', 'list', '--porcelain'], {
            cwd: localDir,
            encoding: 'utf8',
        });
        assert.doesNotMatch(repairedList, /prunable/);
    });
});

void test('canon run refuses a hand-deleted registered canon worktree', () => {
    withTempDir('run-task-missing-canon-worktree-', dir => {
        const taskId = 'missing-canon-worktree';
        const { localDir, worktreeDir, branch } = makeBootstrappedTaskWorktreeFixture(dir, taskId);
        const mainStatusPath = path.join(localDir, 'tasks', taskId, 'status.json');
        const worktreeStatusPath = path.join(worktreeDir, 'tasks', taskId, 'status.json');
        const mainStatus = JSON.parse(fs.readFileSync(mainStatusPath, 'utf8')) as { branch: string; worktree: boolean };
        const worktreeStatus = JSON.parse(fs.readFileSync(worktreeStatusPath, 'utf8')) as {
            branch: string;
            phases: Record<string, { status: string }>;
        };
        assert.equal(mainStatus.branch, '');
        assert.equal(worktreeStatus.branch, branch);
        worktreeStatus.phases.implement.status = 'done';
        worktreeStatus.phases.code_review.status = 'pending';
        fs.writeFileSync(worktreeStatusPath, `${JSON.stringify(worktreeStatus, null, 2)}\n`, 'utf8');
        fs.rmSync(worktreeDir, { recursive: true, force: true });
        const before = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: localDir, encoding: 'utf8' });
        assert.match(before, new RegExp(`worktree .*${taskId}`));

        const env = childEnvWithoutTasksOverride();
        delete env.CANON_WORKTREES_ROOT;
        const result = runMainInline(taskId, [], env, localDir);
        const output = combinedOutput(result);
        assert.notEqual(result.status, 0);
        assert.ok(output.includes(canonicalizeTestPath(worktreeDir)));
        assert.match(output, new RegExp(`branch: ${branch.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`));
        assert.match(output, /git worktree add -f/);
        assert.match(output, /git worktree remove --force/);
        assert.doesNotMatch(output, /ENOENT|\n\s+at .*\(/);
        const after = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: localDir, encoding: 'utf8' });
        assert.match(after, new RegExp(`worktree .*${taskId}`));
        for (const runtimeFile of ['.canon-pid', '.heartbeat.json', '.canon-run.log']) {
            assert.equal(fs.existsSync(path.join(localDir, 'tasks', taskId, runtimeFile)), false);
            assert.equal(fs.existsSync(path.join(worktreeDir, 'tasks', taskId, runtimeFile)), false);
        }
    });
});

void test('canon run refuses a hand-deleted registered canon worktree after reroute', () => {
    withTempDir('run-task-missing-rerouted-worktree-', dir => {
        const taskId = 'missing-rerouted-worktree';
        const { localDir, worktreeDir, branch } = makeBootstrappedTaskWorktreeFixture(dir, taskId);
        const worktreeStatusPath = path.join(worktreeDir, 'tasks', taskId, 'status.json');
        const worktreeStatus = JSON.parse(fs.readFileSync(worktreeStatusPath, 'utf8')) as {
            phases: { implement: { status: string; rerouted?: boolean }; code_review: { status: string } };
        };
        worktreeStatus.phases.implement.status = 'pending';
        worktreeStatus.phases.implement.rerouted = true;
        worktreeStatus.phases.code_review.status = 'pending';
        fs.writeFileSync(worktreeStatusPath, `${JSON.stringify(worktreeStatus, null, 2)}\n`, 'utf8');
        fs.rmSync(worktreeDir, { recursive: true, force: true });
        const env = childEnvWithoutTasksOverride();
        delete env.CANON_WORKTREES_ROOT;
        const result = runMainInline(taskId, [], env, localDir);
        const output = combinedOutput(result);
        assert.notEqual(result.status, 0);
        assert.ok(output.includes(canonicalizeTestPath(worktreeDir)));
        assert.match(output, new RegExp(`branch: ${branch.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`));
        assert.match(output, /git worktree add -f/);
        assert.match(output, /git worktree remove --force/);
        assert.doesNotMatch(output, /ENOENT|\n\s+at .*\(/);
    });
});

void test('missing-worktree refusal clears after restoring the registered checkout', () => {
    withTempDir('run-task-missing-restore-', dir => {
        const taskId = 'missing-restore';
        const { localDir, worktreeDir, branch } = makeBootstrappedTaskWorktreeFixture(dir, taskId);
        fs.rmSync(worktreeDir, { recursive: true, force: true });
        gitIn(localDir, 'worktree', 'add', '-f', worktreeDir, branch);
        const result = runRealMainWithFakeAgents(taskId, [], localDir, dir);
        assert.doesNotMatch(combinedOutput(result), /registered with git but missing on disk/);
        gitIn(localDir, 'worktree', 'remove', '--force', worktreeDir);
    });
});

void test('missing-worktree refusal clears after discarding the registration', () => {
    withTempDir('run-task-missing-discard-', dir => {
        const taskId = 'missing-discard';
        const { localDir, worktreeDir } = makeBootstrappedTaskWorktreeFixture(dir, taskId);
        fs.rmSync(worktreeDir, { recursive: true, force: true });
        gitIn(localDir, 'worktree', 'remove', '--force', worktreeDir);
        const result = runRealMainWithFakeAgents(taskId, [], localDir, dir);
        assert.doesNotMatch(combinedOutput(result), /registered with git but missing on disk/);
    });
});

void test('an existing task branch without a worktree registration is not a missing-worktree refusal', () => {
    withTempDir('run-task-orphan-branch-', dir => {
        const taskId = 'orphan-branch';
        const { localDir } = makeGitFixture(dir);
        const status = { ...makeCompleteStatus(taskId, ''), worktree: true } as Record<string, unknown>;
        const phases = status.phases as Record<string, Record<string, unknown>>;
        phases.implement.status = 'pending';
        phases.code_review.status = 'pending';
        status.status = 'implement';
        writeTaskStatus(path.join(localDir, 'tasks'), taskId, status);
        gitIn(localDir, 'add', 'tasks');
        gitIn(localDir, 'commit', '-m', `add ${taskId} task artifacts`);
        gitIn(localDir, 'branch', `task/${taskId}`, 'main');

        const result = runEnsureBranchInline(taskId, localDir, path.join(localDir, '.canon', 'worktrees'));
        assert.equal(result.status, 0, result.stderr);
        assert.equal(fs.existsSync(path.join(localDir, '.canon', 'worktrees', taskId)), true);
        gitIn(localDir, 'worktree', 'remove', '--force', path.join(localDir, '.canon', 'worktrees', taskId));
        gitIn(localDir, 'branch', '-D', `task/${taskId}`);
    });
});

void test('an intact in-root custom worktree is not a missing-worktree refusal', () => {
    withTempDir('run-task-intact-in-root-', dir => {
        const taskId = 'intact-in-root';
        const linkedWorktree = path.join(dir, 'local', '.canon', 'worktrees', 'custom-name');
        const { localDir } = makeOutOfRootTaskFixture(dir, taskId, linkedWorktree);
        const result = runRealMainWithFakeAgents(taskId, [], localDir, dir);
        assert.doesNotMatch(combinedOutput(result), /registered with git but missing on disk/);
        gitIn(localDir, 'worktree', 'remove', '--force', linkedWorktree);
    });
});

void test('a missing non-task worktree registration is ignored by the canon detector', () => {
    withTempDir('run-task-missing-operator-worktree-', dir => {
        const taskId = 'missing-operator-worktree';
        const { localDir } = makeGitFixture(dir);
        const status = { ...makeCompleteStatus(taskId, ''), worktree: false };
        writeTaskStatus(path.join(localDir, 'tasks'), taskId, status);
        gitIn(localDir, 'add', 'tasks');
        gitIn(localDir, 'commit', '-m', `add ${taskId} task artifacts`);
        const operatorWorktree = path.join(dir, 'operator-worktree');
        gitIn(localDir, 'worktree', 'add', '-b', 'feature/operator-worktree', operatorWorktree, 'main');
        fs.rmSync(operatorWorktree, { recursive: true, force: true });
        const result = runRealMainWithFakeAgents(taskId, [], localDir, dir);
        assert.doesNotMatch(combinedOutput(result), /registered with git but missing on disk/);
    });
});

void test('a missing worktree for another task refuses the current task run', () => {
    withTempDir('run-task-missing-other-worktree-', dir => {
        const otherId = 'other-missing';
        const currentId = 'current-task';
        const { localDir } = makeGitFixture(dir);
        writeTaskStatus(path.join(localDir, 'tasks'), currentId, makeCompleteStatus(currentId, ''));
        gitIn(localDir, 'add', 'tasks');
        gitIn(localDir, 'commit', '-m', `add ${currentId} task artifacts`);
        const otherWorktree = path.join(dir, 'other-worktree');
        gitIn(localDir, 'worktree', 'add', '-b', `task/${otherId}`, otherWorktree, 'main');
        fs.rmSync(otherWorktree, { recursive: true, force: true });
        const result = runMainInline(currentId, [], childEnvWithoutTasksOverride(), localDir);
        const output = combinedOutput(result);
        assert.notEqual(result.status, 0);
        assert.ok(output.includes(canonicalizeTestPath(otherWorktree)));
        assert.match(output, new RegExp(`branch: task/${otherId}`));
    });
});

void test('bundle runs with an intact leader worktree and refuses after the leader is deleted', () => {
    withTempDir('run-task-missing-bundle-leader-', dir => {
        const leaderId = 'bundle-leader-missing';
        const secondaryId = 'bundle-secondary-missing';
        const { localDir } = makeGitFixture(dir);
        writeTaskStatus(path.join(localDir, 'tasks'), leaderId, { ...makeCompleteStatus(leaderId, ''), worktree: true });
        writeTaskStatus(path.join(localDir, 'tasks'), secondaryId, { ...makeCompleteStatus(secondaryId, ''), worktree: true });
        gitIn(localDir, 'add', 'tasks');
        gitIn(localDir, 'commit', '-m', 'add bundle task artifacts');
        const worktreesRoot = path.join(localDir, '.canon', 'worktrees');
        const setup = runEnsureBundleBranchInline([leaderId, secondaryId], localDir, worktreesRoot);
        assert.equal(setup.status, 0, setup.stderr);
        const leaderWorktree = path.join(worktreesRoot, leaderId);
        const env = childEnvWithoutTasksOverride();
        delete env.CANON_WORKTREES_ROOT;
        const intact = runRealMainWithFakeAgents(
            leaderId,
            [secondaryId],
            localDir,
            dir,
        );
        assert.doesNotMatch(combinedOutput(intact), /registered with git but missing on disk/);

        fs.rmSync(leaderWorktree, { recursive: true, force: true });
        for (const taskIds of [[leaderId, secondaryId], [secondaryId]] as const) {
            const result = runMainInline(taskIds[0], taskIds.slice(1), env, localDir);
            const output = combinedOutput(result);
            assert.notEqual(result.status, 0);
            assert.ok(output.includes(canonicalizeTestPath(leaderWorktree)));
            assert.match(output, new RegExp(`branch: task/${leaderId}`));
        }
    });
});

void test('entry detection skips dry-run and ship, and never prunes at entry', () => {
    for (const args of [['--dry-run'], ['--ship']] as const) {
        withTempDir(`run-task-entry-scope-${args[0].slice(2)}-`, dir => {
            const taskId = `entry-scope-${args[0].slice(2)}`;
            const harness = makeFakeRunHarness(dir, taskId, makeCompleteStatus(taskId, ''));
            const result = runFakeMain(harness, taskId, args);
            assert.doesNotMatch(fs.existsSync(harness.gitLogPath) ? fs.readFileSync(harness.gitLogPath, 'utf8') : '', /worktree list --porcelain/);
            assert.doesNotMatch(fs.existsSync(harness.gitLogPath) ? fs.readFileSync(harness.gitLogPath, 'utf8') : '', /worktree prune/);
            assert.equal(result.status === null, false);
        });
    }
});

void test('invocation-root refusal runs before missing-worktree detection', () => {
    withTempDir('run-task-entry-invocation-order-', dir => {
        const taskId = 'entry-invocation-order';
        const harness = makeFakeRunHarness(dir, taskId, makeCompleteStatus(taskId, ''));
        const oldWorktree = path.join(dir, 'old-worktree');
        fs.mkdirSync(oldWorktree, { recursive: true });
        const result = runFakeMain(harness, taskId, [], {}, oldWorktree);
        assert.notEqual(result.status, 0);
        assert.match(combinedOutput(result), /Canon was invoked from a linked git worktree it does not manage/);
        const log = fs.existsSync(harness.gitLogPath) ? fs.readFileSync(harness.gitLogPath, 'utf8') : '';
        assert.doesNotMatch(log, /worktree list --porcelain/);
    });
});

void test('entry worktree enumeration failure refuses closed with git stderr', () => {
    withTempDir('run-task-entry-enumeration-failure-', dir => {
        const taskId = 'entry-enumeration-failure';
        const harness = makeFakeRunHarness(dir, taskId, makeCompleteStatus(taskId, ''));
        const result = runFakeMain(harness, taskId, [], { FAKE_GIT_WORKTREE_LIST_FAIL: '1' });
        const output = combinedOutput(result);
        assert.notEqual(result.status, 0);
        assert.match(output, /git worktree list failed/);
        assert.match(output, /simulated worktree list failure/);
        for (const runtimeFile of ['.canon-pid', '.heartbeat.json', '.canon-run.log']) {
            assert.equal(fs.existsSync(path.join(harness.tasksRoot, taskId, runtimeFile)), false);
        }
    });
});

void test('ensureWorktree creates and tears down the default in-repo worktree cleanly', () => {
    withTempDir('run-task-ensure-wt-default-root-', dir => {
        const taskId = 'task-default-root';
        const { localDir } = makeGitFixture(dir);
        fs.writeFileSync(path.join(localDir, '.gitignore'), 'node_modules\n.env*\n.canon/worktrees/\n', 'utf8');
        fs.writeFileSync(path.join(localDir, 'package.json'), '{"name":"fixture"}\n', 'utf8');
        gitIn(localDir, 'add', '.gitignore', 'package.json');
        gitIn(localDir, 'commit', '-m', 'add canon runtime ignores');
        fs.mkdirSync(path.join(localDir, 'node_modules'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'node_modules', 'marker.txt'), 'root install\n', 'utf8');
        fs.writeFileSync(path.join(localDir, '.env.test'), 'VALUE=1\n', 'utf8');

        const branch = `task/${taskId}`;
        const expectedWorktree = path.join(localDir, '.canon', 'worktrees', taskId);
        const setup = runEnsureWorktreeInline(taskId, branch, localDir);
        assert.equal(setup.status, 0, setup.stderr);
        assert.equal(fs.existsSync(expectedWorktree), true);
        assert.equal(fs.lstatSync(path.join(expectedWorktree, 'node_modules')).isSymbolicLink(), true);
        assert.equal(fs.lstatSync(path.join(expectedWorktree, '.env.test')).isSymbolicLink(), true);

        const registered = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: localDir, encoding: 'utf8' });
        assert.match(registered, new RegExp(`worktree ${canonicalizeTestPath(expectedWorktree).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`));
        assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: localDir, encoding: 'utf8' }), '');

        const teardown = runTeardownWorktreeInline(taskId, localDir);
        assert.equal(teardown.status, 0, teardown.stderr);
        assert.equal(fs.existsSync(expectedWorktree), false);
        const afterTeardown = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: localDir, encoding: 'utf8' });
        assert.doesNotMatch(afterTeardown, /task\/task-default-root/);
        assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: localDir, encoding: 'utf8' }), '');
    });
});

void test('ensureWorktree fails closed on a wrong-target node_modules symlink', () => {
    withTempDir('run-task-ensure-wt-nm-wrong-target-', dir => {
        const taskId = 'task-wrong-target';
        const { localDir, worktreesRoot, branch, wrongTarget } =
            makeEnsureWorktreeNodeModulesFixture(dir, taskId, 'wrong-target-symlink');

        const result = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Worktree setup aborted: .*node_modules is a symlink but does not resolve to/);
        assert.match(result.stderr, new RegExp(wrongTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });
});

void test('ensureWorktree skips an escaping workspace destination and still links contained siblings', () => {
    withTempDir('run-task-ensure-wt-workspace-escape-', dir => {
        const taskId = 'task-workspace-escape';
        const {
            localDir,
            worktreesRoot,
            worktreeDir,
            branch,
            repoWorkspaceModules,
            outsideDestination,
        } = makeEnsureWorktreeWorkspaceFixture(dir, taskId, 'destination-escape');
        const outsideBefore = fs.readdirSync(outsideDestination).sort();

        const result = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);

        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(fs.readdirSync(outsideDestination).sort(), outsideBefore);
        assert.equal(fs.existsSync(path.join(outsideDestination, 'node_modules')), false);
        assert.match(result.stderr, /packages\/a/);
        const siblingLink = path.join(worktreeDir, 'packages/b/node_modules');
        assert.equal(fs.lstatSync(siblingLink).isSymbolicLink(), true);
        assert.equal(fs.realpathSync(siblingLink), fs.realpathSync(repoWorkspaceModules['packages/b']));
    });
});

void test('ensureWorktree classifies workspace node_modules entries without clobbering them', () => {
    for (const variant of ['missing', 'verified-symlink', 'file', 'directory'] as const) {
        withTempDir(`run-task-ensure-wt-workspace-${variant}-`, dir => {
            const taskId = `task-workspace-${variant}`;
            const { localDir, worktreesRoot, worktreeDir, branch, repoWorkspaceModules } =
                makeEnsureWorktreeWorkspaceFixture(dir, taskId, variant);

            const result = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
            assert.equal(result.status, 0, result.stderr);

            const workspaceModules = path.join(worktreeDir, 'packages/a/node_modules');
            const stat = fs.lstatSync(workspaceModules);
            if (variant === 'missing' || variant === 'verified-symlink') {
                assert.equal(stat.isSymbolicLink(), true);
                assert.equal(fs.realpathSync(workspaceModules), fs.realpathSync(repoWorkspaceModules['packages/a']));
                if (variant === 'missing') {
                    assert.match(result.stdout, /Symlinked node_modules into worktree workspace 'packages\/a'/);
                } else {
                    assert.doesNotMatch(result.stdout, /Symlinked node_modules into worktree workspace 'packages\/a'/);
                }
            } else if (variant === 'file') {
                assert.equal(stat.isFile(), true);
                assert.equal(fs.readFileSync(workspaceModules, 'utf8'), 'tracked workspace file\n');
            } else {
                assert.equal(stat.isDirectory(), true);
                assert.equal(fs.readFileSync(path.join(workspaceModules, 'pkg.json'), 'utf8'), '{}\n');
            }
            const siblingModules = path.join(worktreeDir, 'packages/b/node_modules');
            assert.equal(fs.lstatSync(siblingModules).isSymbolicLink(), true);
            assert.equal(fs.realpathSync(siblingModules), fs.realpathSync(repoWorkspaceModules['packages/b']));
        });
    }
});

void test('ensureWorktree fails closed on a wrong-target workspace node_modules symlink', () => {
    withTempDir('run-task-ensure-wt-workspace-wrong-target-', dir => {
        const taskId = 'task-workspace-wrong-target';
        const { localDir, worktreesRoot, branch, wrongTarget } =
            makeEnsureWorktreeWorkspaceFixture(dir, taskId, 'wrong-target-symlink');

        const result = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /packages\/a\/node_modules is a symlink but does not resolve to/);
        assert.match(result.stderr, new RegExp(wrongTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });
});

void test('ensureWorktree rerun repairs workspace links after a prior partial-link abort', () => {
    withTempDir('run-task-ensure-wt-workspace-repair-', dir => {
        const taskId = 'task-workspace-repair';
        const { localDir } = makeGitFixture(dir);
        fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
            name: 'fixture',
            workspaces: ['packages/*'],
        }), 'utf8');
        for (const name of ['a', 'b', 'c']) {
            fs.mkdirSync(path.join(localDir, 'packages', name), { recursive: true });
            fs.writeFileSync(path.join(localDir, 'packages', name, 'package.json'), JSON.stringify({ name }), 'utf8');
        }
        gitIn(localDir, 'add', 'package.json', 'packages');
        gitIn(localDir, 'commit', '-m', 'workspace package setup');

        const branch = `task/${taskId}`;
        const wrongTarget = path.join(dir, 'wrong-target');
        fs.mkdirSync(wrongTarget, { recursive: true });
        gitIn(localDir, 'checkout', '-b', branch);
        fs.symlinkSync(wrongTarget, path.join(localDir, 'packages/b/node_modules'));
        gitIn(localDir, 'add', 'packages/b/node_modules');
        gitIn(localDir, 'commit', '-m', 'stray workspace link');
        gitIn(localDir, 'checkout', 'main');

        fs.mkdirSync(path.join(localDir, 'node_modules'), { recursive: true });
        for (const name of ['a', 'b', 'c']) {
            const sourceModules = path.join(localDir, 'packages', name, 'node_modules');
            fs.mkdirSync(sourceModules, { recursive: true });
            fs.writeFileSync(path.join(sourceModules, 'marker.txt'), `${name}\n`, 'utf8');
        }
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);

        const first = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.notEqual(first.status, 0);
        assert.equal(fs.lstatSync(path.join(worktreeDir, 'packages/a/node_modules')).isSymbolicLink(), true);
        assert.equal(fs.existsSync(path.join(worktreeDir, 'packages/c/node_modules')), false);

        const second = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(second.status, 0, second.stderr);
        assert.equal(
            fs.realpathSync(path.join(worktreeDir, 'packages/c/node_modules')),
            fs.realpathSync(path.join(localDir, 'packages/c/node_modules')),
            'repair mode did not continue past the existing wrong-target link',
        );

        fs.rmSync(path.join(worktreeDir, 'packages/b/node_modules'));
        const third = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(third.status, 0, third.stderr);
        for (const name of ['a', 'b', 'c']) {
            const link = path.join(worktreeDir, 'packages', name, 'node_modules');
            assert.equal(fs.lstatSync(link).isSymbolicLink(), true, `${name} was not repaired`);
            assert.equal(
                fs.realpathSync(link),
                fs.realpathSync(path.join(localDir, 'packages', name, 'node_modules')),
            );
        }
    });
});

void test('ensureWorktree reuse leaves root links and env files untouched', () => {
    for (const variant of ['missing-source', 'wrong-root-link', 'dangling-env-link'] as const) {
        withTempDir(`run-task-ensure-wt-reuse-${variant}-`, dir => {
            const taskId = `task-reuse-${variant}`;
            const { localDir, worktreesRoot, worktreeDir, branch } =
                makeEnsureWorktreeNodeModulesFixture(dir, taskId, 'missing');
            const first = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
            assert.equal(first.status, 0, first.stderr);

            if (variant === 'missing-source') {
                fs.rmSync(path.join(localDir, 'node_modules'), { recursive: true });
            } else if (variant === 'wrong-root-link') {
                fs.rmSync(path.join(worktreeDir, 'node_modules'));
                const wrongTarget = path.join(dir, 'wrong-root-target');
                fs.mkdirSync(wrongTarget, { recursive: true });
                fs.symlinkSync(wrongTarget, path.join(worktreeDir, 'node_modules'));
            } else {
                fs.writeFileSync(path.join(localDir, '.env.reuse'), 'VALUE=1\n', 'utf8');
                fs.symlinkSync(path.join(dir, 'missing-env-target'), path.join(worktreeDir, '.env.reuse'));
            }

            const second = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
            assert.equal(second.status, 0, second.stderr);
            if (variant === 'wrong-root-link') {
                assert.equal(
                    fs.realpathSync(path.join(worktreeDir, 'node_modules')),
                    fs.realpathSync(path.join(dir, 'wrong-root-target')),
                );
            } else if (variant === 'dangling-env-link') {
                assert.equal(fs.lstatSync(path.join(worktreeDir, '.env.reuse')).isSymbolicLink(), true);
            }
        });
    }
});

void test('ensureWorktree reuse suppresses repeated unsupported-pattern warnings', () => {
    withTempDir('run-task-ensure-wt-reuse-warnings-', dir => {
        const taskId = 'task-reuse-warnings';
        const { localDir, worktreesRoot, branch } =
            makeEnsureWorktreeWorkspaceFixture(dir, taskId, 'missing');
        fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
            name: 'fixture',
            workspaces: ['!packages/legacy', 'packages/*'],
        }), 'utf8');

        const first = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(first.status, 0, first.stderr);
        assert.match(first.stderr, /Ignoring unsupported negated workspace pattern: !packages\/legacy/);

        const second = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(second.status, 0, second.stderr);
        assert.doesNotMatch(second.stderr, /Ignoring unsupported negated workspace pattern/);
    });
});

void test('ensureWorktree leaves an existing non-canon worktree untouched', () => {
    withTempDir('run-task-ensure-wt-existing-foreign-', dir => {
        const taskId = 'task-existing-foreign';
        const { localDir, worktreesRoot, branch } =
            makeEnsureWorktreeWorkspaceFixture(dir, taskId, 'missing');
        const foreignWorktree = path.join(dir, 'developer-worktree');
        gitIn(localDir, 'worktree', 'add', foreignWorktree, branch);

        const result = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(fs.existsSync(path.join(foreignWorktree, 'node_modules')), false);
        assert.equal(fs.existsSync(path.join(foreignWorktree, 'packages/a/node_modules')), false);
        assert.equal(fs.existsSync(path.join(worktreesRoot, taskId)), false);
    });
});

void test('ensureWorktree skips hoisted, absent, dangling, and file workspace cases while linking siblings', () => {
    for (const variant of ['source-hoisted', 'workspace-absent', 'destination-dangling', 'destination-file'] as const) {
        withTempDir(`run-task-ensure-wt-workspace-${variant}-`, dir => {
            const taskId = `task-${variant}`;
            const { localDir, worktreesRoot, worktreeDir, branch, repoWorkspaceModules } =
                makeEnsureWorktreeWorkspaceFixture(dir, taskId, variant);

            const result = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
            assert.equal(result.status, 0, result.stderr);
            assert.equal(fs.existsSync(path.join(worktreeDir, 'packages/a/node_modules')), false);
            const siblingModules = path.join(worktreeDir, 'packages/b/node_modules');
            assert.equal(fs.lstatSync(siblingModules).isSymbolicLink(), true);
            assert.equal(fs.realpathSync(siblingModules), fs.realpathSync(repoWorkspaceModules['packages/b']));
            if (variant === 'workspace-absent') {
                assert.match(result.stdout, /Workspace 'packages\/a' is not present/);
                assert.doesNotMatch(result.stderr, /packages\/a/);
            } else if (variant === 'destination-dangling') {
                assert.match(result.stderr, /packages\/a/);
            } else if (variant === 'destination-file') {
                assert.match(result.stderr, /packages\/a.*not a directory/);
            } else {
                assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /packages\/a/);
            }
        });
    }
});

void test('ensureWorktree source containment prevents writes under an outside workspace declaration', () => {
    withTempDir('run-task-ensure-wt-workspace-source-escape-', dir => {
        const taskId = 'task-source-escape';
        const { localDir } = makeGitFixture(dir);
        fs.writeFileSync(path.join(localDir, 'package.json'), JSON.stringify({
            name: 'fixture',
            workspaces: ['packages/*', '../outside/ext'],
        }), 'utf8');
        fs.mkdirSync(path.join(localDir, 'packages/a'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'packages/a/package.json'), '{"name":"a"}\n', 'utf8');
        gitIn(localDir, 'add', 'package.json', 'packages/a/package.json');
        gitIn(localDir, 'commit', '-m', 'workspace package setup');
        const branch = `task/${taskId}`;
        gitIn(localDir, 'branch', branch);
        fs.mkdirSync(path.join(localDir, 'node_modules'), { recursive: true });
        fs.mkdirSync(path.join(localDir, 'packages/a/node_modules'), { recursive: true });
        const outsideWorkspace = path.join(dir, 'outside/ext');
        fs.mkdirSync(outsideWorkspace, { recursive: true });
        fs.writeFileSync(path.join(outsideWorkspace, 'package.json'), '{"name":"outside"}\n', 'utf8');
        fs.writeFileSync(path.join(outsideWorkspace, 'sentinel.txt'), 'untouched\n', 'utf8');
        const outsideBefore = fs.readdirSync(outsideWorkspace).sort();
        const worktreesRoot = path.join(dir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);

        const result = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /\.\.\/outside\/ext/);
        assert.deepEqual(fs.readdirSync(outsideWorkspace).sort(), outsideBefore);
        assert.equal(fs.existsSync(path.join(outsideWorkspace, 'node_modules')), false);
        assert.equal(fs.lstatSync(path.join(worktreeDir, 'packages/a/node_modules')).isSymbolicLink(), true);
        assert.equal(resolveWorkspaceDirs(localDir).some(workspace => workspace.split('/').includes('..')), false);
    });
});

void test('ensureWorktree skips an unresolvable workspace destination and exits successfully', () => {
    withTempDir('run-task-ensure-wt-workspace-dangling-', dir => {
        const taskId = 'task-workspace-dangling';
        const { localDir, worktreesRoot, worktreeDir, branch } =
            makeEnsureWorktreeWorkspaceFixture(dir, taskId, 'destination-dangling');
        const result = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /packages\/a/);
        assert.equal(fs.lstatSync(path.join(worktreeDir, 'packages/a')).isSymbolicLink(), true);
    });
});

void test('teardownWorktree removes root and workspace links without touching source installs', () => {
    withTempDir('run-task-teardown-workspace-links-', dir => {
        const taskId = 'task-teardown-workspace-links';
        const {
            localDir,
            worktreesRoot,
            worktreeDir,
            branch,
            repoModulesFixture,
            repoWorkspaceModules,
        } = makeEnsureWorktreeWorkspaceFixture(dir, taskId, 'missing');
        const setup = runEnsureWorktreeInline(taskId, branch, localDir, worktreesRoot);
        assert.equal(setup.status, 0, setup.stderr);
        assert.equal(fs.lstatSync(path.join(worktreeDir, 'node_modules')).isSymbolicLink(), true);
        assert.equal(fs.lstatSync(path.join(worktreeDir, 'packages/a/node_modules')).isSymbolicLink(), true);

        const teardown = runTeardownWorktreeInline(taskId, localDir, worktreesRoot);
        assert.equal(teardown.status, 0, teardown.stderr);
        assert.equal(fs.existsSync(worktreeDir), false);
        assert.equal(fs.readFileSync(path.join(repoModulesFixture, 'marker.txt'), 'utf8'), 'root install\n');
        assert.equal(
            fs.readFileSync(path.join(repoWorkspaceModules['packages/a'], 'marker.txt'), 'utf8'),
            'packages/a install\n',
        );
        assert.equal(
            fs.readFileSync(path.join(repoWorkspaceModules['packages/b'], 'marker.txt'), 'utf8'),
            'packages/b install\n',
        );
    });
});

void test('commitQaArtifacts uses a bundle commit subject naming every task id', () => {
    withTempDir('run-task-qa-end-bundle-real-git-', dir => {
        const { localDir } = makeGitFixture(dir);
        writeQaArtifacts(localDir, 'task-a');
        writeQaArtifacts(localDir, 'task-b');

        commitQaArtifacts(['task-a', 'task-b'], localDir);

        const subject = execFileSync('git', ['log', '-1', '--pretty=%s'], {
            cwd: localDir,
            encoding: 'utf8',
        }).trim();
        assert.equal(subject, 'chore: QA artifacts for task-a, task-b');
    });
});

void test('commitQaArtifacts rejects dirty files outside the QA-end allowlist', () => {
    withTempDir('run-task-qa-end-outside-allowlist-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);
        writeTaskStatus(tasksRoot, 'task-a', makeCompleteStatus('task-a', 'task/task-a'));

        const result = runNodeInline([
            "import { commitQaArtifacts } from './src/orchestrator/main.ts';",
            `commitQaArtifacts(['task-a'], ${JSON.stringify(dir)});`,
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            FAKE_GIT_LOG: path.join(dir, 'git.log'),
            FAKE_GIT_CURRENT_BRANCH: path.join(dir, 'current-branch.txt'),
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GIT_STATUS_OUTPUT: ' M src/late-edit.ts',
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /QA-end commit aborted: working tree has dirty files outside the QA-end allowlist/);
    });
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
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/state.ts')).href)})`,
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
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/state.ts')).href)})`,
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
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/validation.ts')).href)})`,
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
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/git.ts')).href)})`,
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
                `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/phases/implement.ts')).href)})`,
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
                `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/phases/implement.ts')).href)})`,
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
            "import { main } from './src/orchestrator/main.ts';",
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
            "import { main } from './src/orchestrator/main.ts';",
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
            "import { main } from './src/orchestrator/main.ts';",
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
            "import { main } from './src/orchestrator/main.ts';",
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
        assert.match(gitLog, /^push -u origin task\/task-a$/m, 'push must run on PR-exists branch');
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
            "import { main } from './src/orchestrator/main.ts';",
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
        assert.match(gitLog, /^push -u origin task\/task-a$/m, 'push must run before falling back to the repo template');
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
            "import { main } from './src/orchestrator/main.ts';",
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
        assert.match(gitLog, /^push -u origin task\/task-a$/m, 'push must run on PR-exists branch');
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
            "import { main } from './src/orchestrator/main.ts';",
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
            "import { main } from './src/orchestrator/main.ts';",
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
        assert.match(gitLog, /^push -u origin task\/task-a$/m, 'push must run on dirty-tree path');
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
            "import { main } from './src/orchestrator/main.ts';",
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
                "import { main } from './src/orchestrator/main.ts';",
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
                task_size: 'XS',
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
            "import { buildPipelineState } from './src/orchestrator/main.ts';",
            "import { runSpecReviewPhase } from './src/orchestrator/phases/spec-review.ts';",
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
                task_size: 'XS',
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
            "import { buildPipelineState } from './src/orchestrator/main.ts';",
            "import { runSpecReviewPhase } from './src/orchestrator/phases/spec-review.ts';",
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
            "import { commitHumanReviewFiles } from './src/orchestrator/main.ts';",
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
        assert.match(gitLog, /^push -u origin task\/task-a$/m);
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
            "import { commitHumanReviewFiles } from './src/orchestrator/main.ts';",
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
        assert.match(gitLog, /^push -u origin task\/task-a$/m);
        const ghLog = fs.readFileSync(ghLogPath, 'utf8');
        assert.match(ghLog, /^pr list /m);
        assert.match(ghLog, /^pr create /m);
    });
});

void test('commitHumanReviewFiles preserves the push-failure die message', () => {
    withTempDir('run-task-commit-push-fail-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M tasks/task-a/handoff.md',
            FAKE_GIT_DIFF_OUTPUT: 'tasks/task-a/handoff.md',
            FAKE_GIT_FAIL_PUSH: '1',
            FAKE_GIT_FAIL_PUSH_ERROR: 'simulated push failure',
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Human review push failed: simulated push failure/);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(gitLog, /^push -u origin task\/task-a$/m);
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
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
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
            `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
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
            "import { main } from './src/orchestrator/main.ts';",
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
        assert.match(gitLog, /^push -u origin task\/task-a$/m);
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
            "import { main } from './src/orchestrator/main.ts';",
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
            "import { main } from './src/orchestrator/main.ts';",
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
            "import { main } from './src/orchestrator/main.ts';",
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
            "import { main } from './src/orchestrator/main.ts';",
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

void test('directory-form staging preserves vendored node_modules contents', () => {
    withTempDir('run-task-human-review-vendored-node-modules-', dir => {
        const harness = setupHumanReviewHarness(dir, ['task-a']);
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`dist/`']);
        const vendoredFile = 'dist/lambda/node_modules/lodash/index.js';

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: `?? ${vendoredFile}`,
            FAKE_GIT_DIFF_OUTPUT: vendoredFile,
        });

        assert.equal(result.status, 0, result.stderr);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.match(gitLog, /^add -A -- dist\/$/m);
        assert.match(gitLog, /^commit /m);
    });
});

void test('directory-form staging handles C-quoted filenames and staged renames', () => {
    for (const variant of ['unicode', 'rename'] as const) {
        withTempDir(`run-task-human-review-dirform-${variant}-`, dir => {
            const taskId = `task-${variant}`;
            const { worktreesRoot, worktreeDir, branch } =
                makeNodeModulesGateFixture(dir, taskId, 'node_modules/\n');
            const status = { ...makeHumanReviewPendingStatus(taskId, branch), worktree: true };
            writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
            writeAffectedFilesSpec(path.join(worktreeDir, 'tasks'), taskId, ['`dist/`']);
            fs.mkdirSync(path.join(worktreeDir, 'dist'), { recursive: true });
            if (variant === 'rename') {
                fs.writeFileSync(path.join(worktreeDir, 'dist/old.js'), 'old\n', 'utf8');
            }
            gitIn(worktreeDir, 'add', 'tasks', ...(variant === 'rename' ? ['dist/old.js'] : []));
            gitIn(worktreeDir, 'commit', '-m', 'qa artifacts');

            if (variant === 'unicode') {
                fs.writeFileSync(path.join(worktreeDir, 'dist/café.js'), 'export {};\n', 'utf8');
            } else {
                fs.renameSync(
                    path.join(worktreeDir, 'dist/old.js'),
                    path.join(worktreeDir, 'dist/new.js'),
                );
                gitIn(worktreeDir, 'add', '-A', 'dist');
            }
            const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
                cwd: worktreeDir,
                encoding: 'utf8',
            });
            if (variant === 'unicode') {
                assert.match(porcelain, /^\?\? "dist\/caf\\303\\251\.js"$/m);
            } else {
                assert.match(porcelain, /^R  dist\/old\.js -> dist\/new\.js$/m);
            }

            const fakeBins = path.join(dir, 'fake-bins');
            fs.mkdirSync(fakeBins, { recursive: true });
            setupFakeCliTools(fakeBins);
            const result = runNodeInline([
                `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
                `.then(m => {`,
                `  process.argv = ['node', 'canon', ${JSON.stringify(taskId)}, '--push'];`,
                `  return m.main();`,
                `})`,
                `.catch(err => { console.error(err); process.exit(1); });`,
            ].join('\n'), childEnvWithoutTasksOverride({
                CANON_WORKTREES_ROOT: worktreesRoot,
                PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            }), worktreeDir);

            assert.equal(result.status, 0, result.stderr);
            const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--name-only', '-z'], {
                cwd: worktreeDir,
                encoding: 'utf8',
            }).split('\0');
            assert.equal(tree.includes(variant === 'unicode' ? 'dist/café.js' : 'dist/new.js'), true);
            assert.equal(tree.includes('dist/old.js'), false);
        });
    }
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
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`src/orchestrator/main.ts`']);

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
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`src/orchestrator/main.ts`']);

        const result = runNodeInline([
            "import { main } from './src/orchestrator/main.ts';",
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
        assert.match(gitLog, /^push -u origin task\/task-a$/m);
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
        writeAffectedFilesSpec(tasksRoot, 'task-a', ['`src/orchestrator/main.ts`']);

        gitIn(localDir, 'checkout', '-b', 'task/demo');
        const taskFile = path.join(localDir, 'src', 'orchestrator', 'main.ts');
        fs.mkdirSync(path.dirname(taskFile), { recursive: true });
        fs.writeFileSync(taskFile, 'task content\n', 'utf8');
        gitIn(localDir, 'add', 'src/orchestrator/main.ts');
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
            "import { commitHumanReviewFiles } from './src/orchestrator/main.ts';",
            `commitHumanReviewFiles(['task-a'], ${JSON.stringify(localDir)}, false);`,
        ].join('\n'), {
            ...process.env,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        });

        assert.notEqual(result.status, 0);
        const output = combinedOutput(result);
        assert.match(output, /base-drift detected/);
        assert.match(output, /docs\/BACKLOG\.md/);
        assert.doesNotMatch(output, /src\/orchestrator\/main\.ts\s*$/m);
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
        writeAffectedFilesSpec(harness.tasksRoot, 'task-a', ['`src/orchestrator/main.ts`']);

        const result = runHumanReviewCommit(harness, ['task-a'], {
            FAKE_GIT_STATUS_OUTPUT: ' M src/orchestrator/main.ts',
            FAKE_GIT_DIFF_OUTPUT: '',
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /working tree has dirty files outside the human_review allowlist/);
        const gitLog = fs.readFileSync(harness.gitLogPath, 'utf8');
        assert.doesNotMatch(gitLog, /^commit /m);
        assert.doesNotMatch(gitLog, /^add -A -- src\/orchestrator\/main\.ts$/m);
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
            "import { main } from './src/orchestrator/main.ts';",
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
            "import { main } from './src/orchestrator/main.ts';",
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
            "import { main } from './src/orchestrator/main.ts';",
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
            "import { main } from './src/orchestrator/main.ts';",
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
        assert.match(gitLog, /^push -u origin task\/task-a$/m);
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
            "import { main } from './src/orchestrator/main.ts';",
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

void test('checkAndRoute parks a crashed Codex spec_review before stale-verdict recovery', () => {
    withTempDir('spec-review-crash-park-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const taskId = 'task-crash';
        writeReviewRecoveryTask(tasksRoot, taskId, 'spec_review', 'in_progress', 'changes_requested', {
            current: 1,
            total: 2,
            changesRequested: 1,
        });

        const result = runNodeInline([
            "import { checkAndRoute, setLastCodexExitStatusForTest } from './src/orchestrator/main.ts';",
            'setLastCodexExitStatusForTest(1);',
            `await checkAndRoute('spec_review', [${JSON.stringify(taskId)}]);`,
        ].join('\n'), {
            ...process.env,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        });

        assert.equal(result.status, 2);
        assert.match(result.stderr, /status 1/);
        assert.match(result.stderr, /did not complete/i);
        assert.match(result.stderr, /no verdict was recorded this round/i);
        assert.match(result.stderr, /out-of-credits/);
        assert.match(result.stderr, /auth/);
        assert.match(result.stderr, /network/);
        assert.match(result.stderr, /MCP crash/);
        assert.match(result.stderr, /canon run task-crash/);
        assert.doesNotMatch(result.stderr, /Attempting one-shot retry/);
        assert.doesNotMatch(result.stderr, /completed despite Codex exit status/);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: {
                spec_review?: {
                    status?: string;
                    verdict?: string;
                    iterations_current_loop?: number;
                    iterations_total?: number;
                    changes_requested_total?: number;
                };
            };
        };
        assert.equal(updated.phases?.spec_review?.status, 'in_progress');
        assert.equal(updated.phases?.spec_review?.verdict, '');
        assert.equal(updated.phases?.spec_review?.iterations_current_loop, 1);
        assert.equal(updated.phases?.spec_review?.iterations_total, 2);
        assert.equal(updated.phases?.spec_review?.changes_requested_total, 1);
    });
});

void test('checkAndRoute accepts a self-bookkept spec_review despite a trailing non-zero Codex exit', () => {
    withTempDir('spec-review-done-nonzero-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const taskId = 'task-done';
        writeReviewRecoveryTask(tasksRoot, taskId, 'spec_review', 'done', 'approved_with_nits', {
            current: 0,
            total: 1,
            changesRequested: 0,
        });

        const result = runNodeInline([
            "import { checkAndRoute, setLastCodexExitStatusForTest } from './src/orchestrator/main.ts';",
            'setLastCodexExitStatusForTest(1);',
            `await checkAndRoute('spec_review', [${JSON.stringify(taskId)}]);`,
        ].join('\n'), {
            ...process.env,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /completed despite Codex exit status 1/);
        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: { spec_review?: { status?: string; verdict?: string } };
        };
        assert.equal(updated.phases?.spec_review?.status, 'done');
        assert.equal(updated.phases?.spec_review?.verdict, 'approved_with_nits');
    });
});

void test('checkAndRoute still auto-advances a clean-exit spec_review from its fresh verdict', () => {
    withTempDir('spec-review-clean-recovery-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const taskId = 'task-fresh';
        writeReviewRecoveryTask(tasksRoot, taskId, 'spec_review', 'in_progress', 'changes_requested', {
            current: 0,
            total: 1,
            changesRequested: 1,
        });

        const result = runNodeInline([
            "import { checkAndRoute, setLastCodexExitStatusForTest } from './src/orchestrator/main.ts';",
            'setLastCodexExitStatusForTest(0);',
            `await checkAndRoute('spec_review', [${JSON.stringify(taskId)}]);`,
        ].join('\n'), {
            ...process.env,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /Auto-advanced 'spec_review'/);
        assert.match(result.stderr, /verdict=changes_requested/);
        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: {
                spec?: { status?: string };
                spec_review?: {
                    status?: string;
                    verdict?: string;
                    iterations_current_loop?: number;
                    iterations_total?: number;
                    changes_requested_total?: number;
                };
            };
        };
        assert.equal(updated.phases?.spec?.status, 'pending');
        assert.equal(updated.phases?.spec_review?.status, 'pending');
        assert.equal(updated.phases?.spec_review?.verdict, '');
        assert.equal(updated.phases?.spec_review?.iterations_current_loop, 1);
        assert.equal(updated.phases?.spec_review?.iterations_total, 2);
        assert.equal(updated.phases?.spec_review?.changes_requested_total, 2);
    });
});

void test('crashed-review park is spec_review-only and code_review recovery remains unchanged', () => {
    assert.equal(shouldParkCrashedReview('spec_review', 1), true);
    assert.equal(shouldParkCrashedReview('spec_review', 0), false);
    for (const phase of ['code_review', 'plan', 'implement', 'qa'] as const) {
        assert.equal(shouldParkCrashedReview(phase, 1), false);
    }

    withTempDir('code-review-clean-recovery-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const taskId = 'task-code-review';
        writeReviewRecoveryTask(tasksRoot, taskId, 'code_review', 'in_progress', 'approved');

        const result = runNodeInline([
            "import { checkAndRoute, setLastCodexExitStatusForTest } from './src/orchestrator/main.ts';",
            'setLastCodexExitStatusForTest(0);',
            `await checkAndRoute('code_review', [${JSON.stringify(taskId)}]);`,
        ].join('\n'), {
            ...process.env,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /Auto-advanced 'code_review'/);
        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: { code_review?: { status?: string; verdict?: string } };
        };
        assert.equal(updated.phases?.code_review?.status, 'done');
        assert.equal(updated.phases?.code_review?.verdict, 'approved');
    });
});

void test('main blocks a capped spec loop before revision, re-blocks on resume, and its advertised reset works', { concurrency: false }, () => {
    withTempDir('preroute-spec-loop-cap-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'spec-loop-cap';
        const cap = 3;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'spec_review', cap);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        const agentLog = path.join(localDir, 'agent-invocations.log');

        const first = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap);
        assert.deepEqual(readAgentInvocations(agentLog), []);
        assert.equal(first.status, 2, combinedOutput(first));

        const blocked = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            status?: string;
            escalations?: Array<{ phase?: string; reason?: string }>;
            phases?: {
                spec?: { status?: string };
                spec_review?: { status?: string; auto_block_count?: number };
            };
        };
        assert.equal(blocked.status, 'spec');
        assert.equal(blocked.phases?.spec?.status, 'pending');
        assert.equal(blocked.phases?.spec_review?.status, 'blocked');
        assert.equal(blocked.phases?.spec_review?.auto_block_count, 1);
        assert.equal(blocked.escalations?.length, 1);
        assert.equal(blocked.escalations?.[0]?.phase, 'spec_review');
        const firstResumePhase = blocked.escalations?.[0]?.reason?.match(/Resuming after raising the cap runs `([a-z_]+)`/)?.[1];
        assert.equal(firstResumePhase, 'spec');

        const resumed = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap);
        assert.equal(resumed.status, 2, combinedOutput(resumed));
        assert.deepEqual(readAgentInvocations(agentLog), []);
        const reblocked = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            escalations?: unknown[];
            phases?: { spec_review?: { auto_block_count?: number } };
        };
        assert.equal(reblocked.escalations?.length, 2);
        assert.equal(reblocked.phases?.spec_review?.auto_block_count, 2);

        withFakeGitEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot }, () => {
            taskCmd(['reset-spec-review', taskId]);
        });
        const reset = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            status?: string;
            sessions?: { claude_spec?: string };
            phases?: {
                spec?: { status?: string };
                spec_review?: { status?: string; iterations?: number; iterations_current_loop?: number; verdict?: string };
            };
        };
        assert.equal(reset.status, 'spec_review');
        assert.equal(reset.phases?.spec?.status, 'done');
        assert.equal(reset.phases?.spec_review?.status, 'pending');
        assert.equal(reset.phases?.spec_review?.iterations, 0);
        assert.equal(reset.phases?.spec_review?.iterations_current_loop, 0);
        assert.equal(reset.phases?.spec_review?.verdict, '');
        assert.equal(reset.sessions?.claude_spec, undefined);
        assert.equal(fs.existsSync(path.join(tasksRoot, taskId, 'spec-review-prior-1.md')), true);
    });
});

void test('main blocks a capped code loop before implementation side effects, re-blocks, and its advertised reset works', { concurrency: false }, () => {
    withTempDir('preroute-code-loop-cap-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'code-loop-cap';
        const cap = 3;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', cap);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        const agentLog = path.join(localDir, 'agent-invocations.log');
        const baseTipBefore = execFileSync('git', ['rev-parse', 'main'], { cwd: localDir, encoding: 'utf8' }).trim();

        const first = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap);
        assert.equal(first.status, 2, combinedOutput(first));
        assert.deepEqual(readAgentInvocations(agentLog), []);
        assert.equal(
            execFileSync('git', ['rev-parse', 'main'], { cwd: localDir, encoding: 'utf8' }).trim(),
            baseTipBefore,
        );

        const blocked = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            status?: string;
            escalations?: Array<{ phase?: string; reason?: string }>;
            phases?: {
                implement?: { status?: string };
                code_review?: {
                    status?: string;
                    iterations_total?: number;
                    auto_block_count?: number;
                };
            };
        };
        assert.equal(blocked.status, 'implement');
        assert.equal(blocked.phases?.implement?.status, 'pending');
        assert.equal(blocked.phases?.code_review?.status, 'blocked');
        assert.equal(blocked.phases?.code_review?.auto_block_count, 1);
        assert.equal(blocked.escalations?.length, 1);
        assert.equal(blocked.escalations?.[0]?.phase, 'code_review');
        const firstResumePhase = blocked.escalations?.[0]?.reason?.match(/Resuming after raising the cap runs `([a-z_]+)`/)?.[1];
        assert.equal(firstResumePhase, 'implement');

        const resumed = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap);
        assert.equal(resumed.status, 2, combinedOutput(resumed));
        assert.deepEqual(readAgentInvocations(agentLog), []);
        const reblocked = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            escalations?: unknown[];
            sessions?: { claude_review?: string };
            phases?: {
                code_review?: {
                    iterations_total?: number;
                    auto_block_count?: number;
                };
            };
        };
        assert.equal(reblocked.escalations?.length, 2);
        assert.equal(reblocked.phases?.code_review?.auto_block_count, 2);
        const preservedTotal = reblocked.phases?.code_review?.iterations_total;
        const preservedAutoBlocks = reblocked.phases?.code_review?.auto_block_count;

        withFakeGitEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot }, () => {
            taskCmd(['reset-code-review', taskId]);
        });
        const reset = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            status?: string;
            sessions?: { claude_review?: string };
            phases?: {
                implement?: { status?: string };
                code_review?: {
                    status?: string;
                    iterations?: number;
                    iterations_current_loop?: number;
                    iterations_total?: number;
                    preflight_rejections_current_loop?: number;
                    auto_block_count?: number;
                    verdict?: string;
                };
            };
        };
        assert.equal(reset.status, 'code_review');
        assert.equal(reset.phases?.implement?.status, 'done');
        assert.equal(reset.phases?.code_review?.status, 'pending');
        assert.equal(reset.phases?.code_review?.iterations, 0);
        assert.equal(reset.phases?.code_review?.iterations_current_loop, 0);
        assert.equal(reset.phases?.code_review?.preflight_rejections_current_loop, 0);
        assert.equal(reset.phases?.code_review?.verdict, '');
        assert.equal(reset.phases?.code_review?.iterations_total, preservedTotal);
        assert.equal(reset.phases?.code_review?.auto_block_count, preservedAutoBlocks);
        assert.equal(reset.sessions?.claude_review, undefined);
        assert.equal(fs.existsSync(path.join(tasksRoot, taskId, 'review-prior-1.md')), true);
    });
});

void test('main runs the first spec write when MAX_REVIEW_LOOPS=0 on a genuinely fresh task', { concurrency: false }, () => {
    // MAX_REVIEW_LOOPS=0 is a valid, tested "no retries after review requests
    // changes" override (tests/pipeline-policy.test.ts) -- not "no work at
    // all". A fresh task's spec_review.iterations_current_loop is 0, same as
    // a capped-out task's threshold, so gating the revision-entry checkpoint
    // on count >= cap alone would also block the very first spec write.
    // Real Codex PR finding (src/orchestrator/phases/implement.ts; mirrored
    // here on the spec side).
    withTempDir('preroute-spec-zero-cap-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'spec-zero-cap';
        const cap = 0;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'spec_review', 0);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        const agentLog = path.join(localDir, 'agent-invocations.log');

        const first = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap);
        assert.equal(first.status, 0, combinedOutput(first));
        assert.notDeepEqual(readAgentInvocations(agentLog), []);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: { spec?: { status?: string }; spec_review?: { status?: string } };
        };
        assert.equal(updated.phases?.spec?.status, 'done');
    });
});

void test('main runs the first implement pass when MAX_REVIEW_LOOPS=0 on a genuinely fresh task', { concurrency: false }, () => {
    withTempDir('preroute-code-zero-cap-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'code-zero-cap';
        const cap = 0;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', 0);
        // writeReviewLoopFixture's spec.md has no Validation Required
        // section -- fine for the block-path tests it was built for, but
        // this test lets implement actually run to completion, and
        // checkPhaseGate('implement') requires that section to be present
        // with at least one `[x]`-checked item.
        fs.appendFileSync(
            path.join(tasksRoot, taskId, 'spec.md'),
            '\n## Validation Required\n\n- [x] `npm test`\n',
            'utf8',
        );
        // writeReviewLoopFixture's handoff.md claims initial-fixture.txt
        // changed (matching makeGitFixture's own tracked file of that
        // name), but the fake codex agent normally only flips status.json
        // -- it never actually touches the file. The orchestrator (not the
        // agent) owns staging and committing, so give the fake agent a
        // real, uncommitted working-tree edit to leave behind, matching
        // what handoff.md claims and what a real agent would do.
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        fs.writeFileSync(path.join(fakeBins, 'codex'), [
            '#!/bin/sh',
            'if [ "${1:-}" = "--version" ]; then printf "%s\\n" "fake-agent 1.0"; exit 0; fi',
            'printf "%s\\n" "codex" >> "$FAKE_AGENT_LOG"',
            'printf "fixture\\n" > initial-fixture.txt',
            'if [ -n "${FAKE_AGENT_COMPLETE_PHASE:-}${FAKE_AGENT_COMPLETE_SEQUENCE:-}" ]; then node "$FAKE_AGENT_COMPLETER"; fi',
            'exit 0',
        ].join('\n'), { mode: 0o755 });
        const agentLog = path.join(localDir, 'agent-invocations.log');

        const first = runReviewLoopMain(
            localDir, tasksRoot, fakeBins, taskId, cap, [], { FAKE_AGENT_COMPLETE_PHASE: 'implement' },
        );
        assert.equal(first.status, 0, combinedOutput(first));
        assert.deepEqual(readAgentInvocations(agentLog), ['codex']);

        const updated = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: { implement?: { status?: string } };
        };
        assert.equal(updated.phases?.implement?.status, 'done');
    });
});

void test('main blocks a code loop when reviewer plus pre-flight attempts reach the cap', { concurrency: false }, () => {
    withTempDir('preroute-code-loop-combined-cap-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'code-loop-combined-cap';
        const cap = 3;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', 1, 2);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        const agentLog = path.join(localDir, 'agent-invocations.log');
        const baseTipBefore = execFileSync('git', ['rev-parse', 'main'], { cwd: localDir, encoding: 'utf8' }).trim();

        const result = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap);
        assert.equal(result.status, 2, combinedOutput(result));
        assert.deepEqual(readAgentInvocations(agentLog), []);
        assert.equal(
            execFileSync('git', ['rev-parse', 'main'], { cwd: localDir, encoding: 'utf8' }).trim(),
            baseTipBefore,
        );
        const blocked = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            status?: string;
            escalations?: Array<{ phase?: string }>;
            phases?: { code_review?: { status?: string } };
        };
        assert.equal(blocked.status, 'implement');
        assert.equal(blocked.phases?.code_review?.status, 'blocked');
        assert.equal(blocked.escalations?.at(-1)?.phase, 'code_review');
    });
});

void test('force-accepting a pre-route code-review block makes the follow-on run enter QA without Codex', { concurrency: false }, () => {
    withTempDir('preroute-code-loop-force-accept-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'code-loop-force-accept';
        const cap = 3;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', cap);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        const agentLog = path.join(localDir, 'agent-invocations.log');

        assert.equal(runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap).status, 2);
        assert.deepEqual(readAgentInvocations(agentLog), []);

        const taskModuleHref = pathToFileURL(path.join(WORKTREE_ROOT, 'src', 'task', 'index.ts')).href;
        const accepted = runNodeInline([
            `import(${JSON.stringify(taskModuleHref)})`,
            `.then(m => m.taskAccept([${JSON.stringify(taskId)}], 'code_review', { force: true, reason: 'operator accepted current implementation' }))`,
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), {
            ...process.env,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        }, localDir);
        assert.equal(accepted.status, 0, combinedOutput(accepted));
        assert.match(accepted.stdout, /Next phase: qa/);

        const qaRun = runReviewLoopMain(
            localDir,
            tasksRoot,
            fakeBins,
            taskId,
            cap,
            ['--expect', 'qa'],
            { FAKE_AGENT_COMPLETE_PHASE: 'qa' },
        );
        assert.deepEqual(readAgentInvocations(agentLog), ['claude'], combinedOutput(qaRun));
    });
});

void test('spec-review entry retains the capped-loop backstop and persists state-accurate recovery text', { concurrency: false }, () => {
    withTempDir('spec-review-loop-backstop-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'spec-review-backstop';
        const cap = 3;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'spec_review', cap, 0, true);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);

        const result = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap);
        assert.equal(result.status, 2, combinedOutput(result));
        assert.deepEqual(readAgentInvocations(path.join(localDir, 'agent-invocations.log')), []);
        const blocked = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            status?: string;
            escalations?: Array<{ reason?: string }>;
            phases?: { spec_review?: { status?: string } };
        };
        assert.equal(blocked.status, 'spec_review');
        assert.equal(blocked.phases?.spec_review?.status, 'blocked');
        const reason = blocked.escalations?.at(-1)?.reason ?? '';
        assert.equal(reason.match(/Resuming after raising the cap runs `([a-z_]+)`/)?.[1], 'spec_review');
        assert.doesNotMatch(reason, /iterations_current_loop\s*=/);
        assert.doesNotMatch(reason, /phases\.spec_review\.status\s*=/);
    });
});

void test('raising the spec-loop cap resumes the deferred spec phase before spec_review', { concurrency: false }, () => {
    withTempDir('preroute-spec-loop-raised-cap-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'spec-loop-raised-cap';
        const cap = 3;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'spec_review', cap);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        const agentLog = path.join(localDir, 'agent-invocations.log');

        assert.equal(runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap).status, 2);
        const resumed = runReviewLoopMain(
            localDir,
            tasksRoot,
            fakeBins,
            taskId,
            cap + 1,
            ['--expect', 'spec'],
            { FAKE_AGENT_COMPLETE_PHASE: 'spec' },
        );
        assert.deepEqual(readAgentInvocations(agentLog), ['claude']);
        assert.doesNotMatch(combinedOutput(resumed), /--expect spec but current phase/);
        const afterResume = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: { spec_review?: { status?: string } };
        };
        assert.equal(afterResume.phases?.spec_review?.status, 'blocked');
    });

    withTempDir('preroute-spec-loop-wrong-expect-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'spec-loop-wrong-expect';
        const cap = 3;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'spec_review', cap);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        assert.equal(runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap).status, 2);

        const wrongExpect = runReviewLoopMain(
            localDir,
            tasksRoot,
            fakeBins,
            taskId,
            cap + 1,
            ['--expect', 'spec_review'],
        );
        assert.match(combinedOutput(wrongExpect), /--expect spec_review but current phase is spec/);
        assert.deepEqual(readAgentInvocations(path.join(localDir, 'agent-invocations.log')), []);
    });
});

void test('a plain raised-cap run completes the deferred spec revision and following review in one process', { concurrency: false }, () => {
    withTempDir('preroute-spec-loop-raised-cap-full-run-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'spec-loop-raised-cap-full-run';
        const cap = 3;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'spec_review', cap);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        const agentLog = path.join(localDir, 'agent-invocations.log');

        assert.equal(runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap).status, 2);
        const statusPath = path.join(tasksRoot, taskId, 'status.json');
        const blocked = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as StatusJson;
        blocked.human_spec_gate = true;
        fs.writeFileSync(statusPath, `${JSON.stringify(blocked, null, 2)}\n`, 'utf8');

        const resumed = runReviewLoopMain(
            localDir,
            tasksRoot,
            fakeBins,
            taskId,
            cap + 1,
            [],
            { FAKE_AGENT_COMPLETE_SEQUENCE: 'spec,spec_review' },
            false,
        );
        assert.equal(resumed.status, 0, combinedOutput(resumed));
        assert.deepEqual(readAgentInvocations(agentLog), ['claude', 'codex']);
        const completed = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as StatusJson;
        assert.equal(completed.phases.spec?.status, 'done');
        assert.equal(completed.phases.spec_review?.status, 'done');
        assert.equal(completed.phases.spec_review?.verdict, 'approved');
    });
});

void test('raising the code-loop cap resumes implement before code_review', { concurrency: false }, () => {
    withTempDir('preroute-code-loop-raised-cap-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'code-loop-raised-cap';
        const cap = 3;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', cap);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        const agentLog = path.join(localDir, 'agent-invocations.log');

        assert.equal(runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap).status, 2);
        const resumed = runReviewLoopMain(
            localDir,
            tasksRoot,
            fakeBins,
            taskId,
            cap + 1,
            ['--expect', 'implement'],
            { FAKE_AGENT_COMPLETE_PHASE: 'implement' },
        );
        assert.deepEqual(readAgentInvocations(agentLog), ['codex']);
        assert.doesNotMatch(combinedOutput(resumed), /--expect implement but current phase/);
        const afterResume = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as {
            phases?: { code_review?: { status?: string } };
        };
        assert.equal(afterResume.phases?.code_review?.status, 'blocked');
    });

    withTempDir('preroute-code-loop-wrong-expect-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'code-loop-wrong-expect';
        const cap = 3;
        const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', cap);
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });
        setupInvocationLoggingCliTools(fakeBins);
        assert.equal(runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, cap).status, 2);

        const wrongExpect = runReviewLoopMain(
            localDir,
            tasksRoot,
            fakeBins,
            taskId,
            cap + 1,
            ['--expect', 'code_review'],
        );
        assert.match(combinedOutput(wrongExpect), /--expect code_review but current phase is implement/);
        assert.deepEqual(readAgentInvocations(path.join(localDir, 'agent-invocations.log')), []);
    });
});

void test('a human reroute clears loop-local code-review attempts before implement entry', { concurrency: false }, () => {
    withTempDir('reroute-review-loop-inert-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'reroute-loop-inert';
        const worktreesRoot = path.join(localDir, 'worktrees');
        const worktreeDir = path.join(worktreesRoot, taskId);
        const status = makeReviewLoopStatus(taskId, 'code_review', 3, 2) as StatusJson;
        status.branch = `task/${taskId}`;
        status.worktree = true;
        status.phases.implement!.status = 'done';
        status.phases.code_review!.status = 'done';
        status.phases.code_review!.verdict = 'approved';
        status.phases.qa!.status = 'done';
        status.phases.human_review!.status = 'pending';
        status.status = 'human_review';
        writeTaskStatus(path.join(localDir, 'tasks'), taskId, status);
        writeTaskStatus(path.join(worktreeDir, 'tasks'), taskId, status);
        fs.writeFileSync(path.join(worktreeDir, 'tasks', taskId, 'spec.md'), [
            '# Spec',
            '',
            '## Amendment',
            '',
            'Reroute fixture amendment.',
            '',
        ].join('\n'), 'utf8');

        const mainHref = pathToFileURL(path.join(WORKTREE_ROOT, 'src', 'orchestrator', 'main.ts')).href;
        const result = runNodeInline([
            `import(${JSON.stringify(mainHref)})`,
            '.then(m => {',
            '  m.setCliArgsForTest({ force: false });',
            `  m.rerouteFromHumanReview([${JSON.stringify(taskId)}]);`,
            '})',
            '.catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), childEnvWithoutTasksOverride({
            CANON_WORKTREES_ROOT: worktreesRoot,
        }), localDir);
        assert.equal(result.status, 0, combinedOutput(result));

        const rerouted = JSON.parse(
            fs.readFileSync(path.join(worktreeDir, 'tasks', taskId, 'status.json'), 'utf8'),
        ) as StatusJson;
        assert.equal(rerouted.phases.code_review?.iterations_current_loop, 0);
        assert.equal(rerouted.phases.code_review?.preflight_rejections_current_loop, 0);
        assert.equal(rerouted.phases.code_review?.iterations_total, 7);
        const context: TaskContext = {
            taskId,
            title: taskId,
            specReviewVerdict: rerouted.phases.spec_review?.verdict ?? '',
            iterations: rerouted.phases.code_review?.iterations ?? 0,
            iterations_current_loop: rerouted.phases.code_review?.iterations_current_loop ?? 0,
            iterations_total: rerouted.phases.code_review?.iterations_total ?? 0,
            rerouteCount: rerouted.phases.implement?.reroute_count ?? 0,
            status: rerouted,
        };
        assert.equal(evaluateCodeReviewLoop([context], 3).blocked, false);
    });
});

void test('checkAndRoute commits QA artifacts for every task in a completed QA bundle', () => {
    withTempDir('run-task-qa-bundle-commit-', dir => {
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
            phases.qa = { status: 'done', agent: 'claude' };
            phases.human_review = { status: 'pending', agent: 'human' };
            writeTaskStatus(tasksRoot, taskId, status);
        }

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');
        const gitLogPath = path.join(dir, 'git.log');
        const qualityLogPath = path.join(dir, 'task-quality-log.md');

        const result = runNodeInline([
            "import { checkAndRoute } from './src/orchestrator/main.ts';",
            '(async () => {',
            "  await checkAndRoute('qa', ['task-a', 'task-b']);",
            '})().catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_QUALITY_LOG_FILE_OVERRIDE: qualityLogPath,
            FAKE_GIT_LOG: gitLogPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_BASE_BRANCH: 'main',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GIT_STATUS_OUTPUT: [
                ' M tasks/task-a/done.md',
                ' M tasks/task-b/review.md',
                ' M docs/codebase-map.md',
            ].join('\n'),
            FAKE_GIT_DIFF_OUTPUT: [
                'tasks/task-a/done.md',
                'tasks/task-b/review.md',
                'docs/codebase-map.md',
            ].join('\n'),
        });

        assert.equal(result.status, 0, result.stderr);
        const gitLog = fs.readFileSync(gitLogPath, 'utf8');
        assert.match(gitLog, /^add -A -- tasks\/task-a$/m);
        assert.match(gitLog, /^add -A -- tasks\/task-b$/m);
        assert.match(gitLog, /^add -A -- docs\/codebase-map\.md$/m);
        assert.match(gitLog, /^commit -m chore: QA artifacts for task-a, task-b$/m);
        assert.doesNotMatch(gitLog, /^push /m);
    });
});

void test('checkAndRoute commits QA artifacts after evidence-advancing qa to done', () => {
    withTempDir('run-task-qa-evidence-commit-', dir => {
        const tasksRoot = path.join(dir, 'tasks');
        const fakeBins = path.join(dir, 'fake-bins');
        const fakeGitDir = path.join(fakeBins, 'git-bin');
        fs.mkdirSync(fakeBins, { recursive: true });
        fs.mkdirSync(fakeGitDir, { recursive: true });
        setupFakeGit(fakeGitDir);
        setupFakeCliTools(fakeBins);

        const taskId = 'task-a';
        const status = makeCompleteStatus(taskId, 'task/task-a');
        const phases = status.phases as Record<string, { status: string; agent: string; verdict?: string }>;
        phases.qa = { status: 'in_progress', agent: 'claude' };
        phases.human_review = { status: 'pending', agent: 'human' };
        writeTaskStatus(tasksRoot, taskId, status);
        const taskDir = path.join(tasksRoot, taskId);
        fs.writeFileSync(path.join(taskDir, 'done.md'), '# QA Summary: task-a\n\nReady.\n', 'utf8');
        const qualityLogPath = path.join(dir, 'task-quality-log.md');

        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'task/task-a\n');
        const gitLogPath = path.join(dir, 'git.log');

        const result = runNodeInline([
            "import { checkAndRoute } from './src/orchestrator/main.ts';",
            '(async () => {',
            `  await checkAndRoute('qa', [${JSON.stringify(taskId)}]);`,
            '})().catch(err => { console.error(err); process.exit(1); });',
        ].join('\n'), {
            ...process.env,
            PATH: `${fakeGitDir}${path.delimiter}${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
            CANON_TASKS_DIR_OVERRIDE: tasksRoot,
            CANON_QUALITY_LOG_FILE_OVERRIDE: qualityLogPath,
            FAKE_GIT_LOG: gitLogPath,
            FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
            FAKE_GIT_REMOTE_BRANCH: 'task/task-a',
            FAKE_GIT_REMOTE_EXISTS: '1',
            FAKE_GIT_BASE_BRANCH: 'main',
            FAKE_GIT_TASK_BRANCH: 'task/task-a',
            FAKE_GIT_STATUS_OUTPUT: ' M tasks/task-a/done.md',
            FAKE_GIT_DIFF_OUTPUT: 'tasks/task-a/done.md',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /Auto-advanced 'qa' for 'task-a'/);
        const updated = JSON.parse(fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8')) as {
            phases?: { qa?: { status?: string } };
        };
        assert.equal(updated.phases?.qa?.status, 'done');
        const qualityLog = fs.readFileSync(qualityLogPath, 'utf8');
        assert.match(qualityLog, /\| task-a \|/);
        const gitLog = fs.readFileSync(gitLogPath, 'utf8');
        assert.match(gitLog, /^add -A -- tasks\/task-a$/m);
        assert.match(gitLog, /^commit -m chore: QA artifacts for task-a$/m);
        assert.doesNotMatch(gitLog, /^push /m);
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

void test('Claude failure ladders set exit reasons and Codex non-zero exits do not exit by themselves', () => {
    withTempDir('orchestrator-exit-agents-', dir => {
        const fakeBins = path.join(dir, 'fake-bins');
        fs.mkdirSync(fakeBins, { recursive: true });

        writeExecutable(fakeBins, 'claude', ['exit 1']);
        const claudeResult = runNodeInline([
            "import { registerExitHandlers } from './src/orchestrator/cli.js';",
            "import { runClaude } from './src/orchestrator/agents/claude.js';",
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
            "import { registerExitHandlers } from './src/orchestrator/cli.js';",
            "import { runCodex } from './src/orchestrator/agents/codex.js';",
            'registerExitHandlers();',
            '(async () => {',
            "  await runCodex('prompt', false, null, 'model', 'high', undefined, process.cwd());",
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
            "import { registerExitHandlers } from './src/orchestrator/cli.js';",
            "import { runCodex } from './src/orchestrator/agents/codex.js';",
            'registerExitHandlers();',
            '(async () => {',
            "  await runCodex('prompt', false, null, 'model', 'high', undefined, process.cwd());",
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
            "import { registerExitHandlers } from './src/orchestrator/cli.js';",
            "import { runCodex } from './src/orchestrator/agents/codex.js';",
            'registerExitHandlers();',
            '(async () => {',
            "  await runCodex('prompt', false, null, 'model', 'high', undefined, process.cwd());",
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
            "import { registerExitHandlers } from './src/orchestrator/cli.js';",
            "import { runCodex } from './src/orchestrator/agents/codex.js';",
            'registerExitHandlers();',
            '(async () => {',
            "  await runCodex('prompt', false, null, 'model', 'high', undefined, process.cwd());",
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

// ── guardConcurrentRun ──────────────────────────────────────────────────────

function makeGuardResolver(rootDir: string) {
    return (id: string) => path.join(rootDir, 'tasks', id);
}

function captureDie(): { msg: string | null; fn: (m: string) => never } {
    const capture: { msg: string | null; fn: (m: string) => never } = {
        msg: null,
        fn: (m: string): never => { capture.msg = m; throw new Error(m); },
    };
    return capture;
}

function writeFreshHeartbeat(taskDir: string, pid: number): void {
    const now = Date.now();
    const hb = { pid, started_at_ms: now - 5_000, last_update_ms: now - 500, task_ids: ['task-1'] };
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, '.heartbeat.json'), JSON.stringify(hb, null, 2), 'utf8');
}

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
