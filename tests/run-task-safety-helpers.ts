import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { REPO_ROOT } from '../src/orchestrator/env.js';
import type { StatusJson, TaskContext } from '../src/orchestrator/types.js';


export const WORKTREE_ROOT = process.cwd();
export const TSX_LOADER = path.join(WORKTREE_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');

export function canonicalizeTestPath(candidate: string): string {
    try {
        return fs.realpathSync(candidate);
    } catch {
        return path.resolve(candidate);
    }
}

export function withTempDir(prefix: string, fn: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    try {
        fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

export function writeTaskStatus(tasksRoot: string, taskId: string, status: Record<string, unknown>): void {
    const taskDir = path.join(tasksRoot, taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

export function writeExecutable(scriptDir: string, name: string, body: string[]): void {
    fs.writeFileSync(path.join(scriptDir, name), ['#!/bin/sh', 'set -eu', ...body, ''].join('\n'), { mode: 0o755 });
}

export function setupFakeGit(scriptDir: string): void {
    const gitPath = path.join(scriptDir, 'git');
    fs.writeFileSync(gitPath, [
        '#!/bin/sh',
        'set -eu',
        'printf "%s\\n" "$*" >> "$FAKE_GIT_LOG"',
        'if [ "${1:-}" = "rev-parse" ] && [ "${2:-}" = "--path-format=absolute" ] && [ "${3:-}" = "--git-dir" ] && [ "${4:-}" = "--git-common-dir" ] && [ -n "${FAKE_GIT_COMMON_DIR:-}" ]; then',
        '  case "$FAKE_GIT_COMMON_DIR" in /*) c="$FAKE_GIT_COMMON_DIR";; *) c="$PWD/$FAKE_GIT_COMMON_DIR";; esac',
        '  printf "%s\\n%s\\n" "${FAKE_GIT_DIR:-$c}" "$c"',
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
        'if [ "${1:-}" = "diff" ] && [ "${2:-}" = "HEAD" ] && [ "${3:-}" = "--name-only" ] && [ "${4:-}" = "--no-renames" ] && [ "${5:-}" = "--diff-filter=D" ]; then',
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
        '  if [ "${2:-}" = "origin/${FAKE_GIT_BASE_BRANCH:-main}...HEAD" ] && [ "${FAKE_GIT_AFFECTED_DIFF_FAIL:-}" = "1" ]; then',
        '    printf "%s\\n" "${FAKE_GIT_AFFECTED_DIFF_ERROR:-affected diff failed}" >&2',
        '    exit 128',
        '  fi',
        '  if [ "${2:-}" = "origin/${FAKE_GIT_BASE_BRANCH:-main}...HEAD" ] && [ -n "${FAKE_GIT_AFFECTED_FILES+x}" ]; then',
        '    OLDIFS="$IFS"',
        '    IFS=","',
        '    for FILE in $FAKE_GIT_AFFECTED_FILES; do printf "M\\0%s\\0" "$FILE"; done',
        '    IFS="$OLDIFS"',
        '    exit 0',
        '  fi',
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
        'if [ "${1:-}" = "merge-tree" ]; then',
        '  MERGE_STATUS="${FAKE_GIT_MERGE_TREE_STATUS:-0}"',
        '  if [ "$MERGE_STATUS" = "0" ]; then printf "%s\\0" 0000000000000000000000000000000000000001; exit 0; fi',
        '  if [ "$MERGE_STATUS" = "1" ]; then',
        '    printf "%s\\0" 0000000000000000000000000000000000000001',
        '    OLDIFS="$IFS"; IFS=","; for FILE in ${FAKE_GIT_MERGE_TREE_CONFLICTS:-}; do [ -z "$FILE" ] || printf "%s\\0" "$FILE"; done; IFS="$OLDIFS"',
        '    exit 1',
        '  fi',
        '  printf "%s\\n" "${FAKE_GIT_MERGE_TREE_ERROR:-merge-tree failed}" >&2',
        '  exit "$MERGE_STATUS"',
        'fi',
        'if [ "${1:-}" = "reset" ] && [ "${2:-}" = "--soft" ]; then',
        '  if [ "${FAKE_GIT_RESET_SOFT_FAIL:-}" = "1" ]; then printf "%s\\n" "reset failed" >&2; exit 1; fi',
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
        'if [ "${1:-}" = "fetch" ] && [ "${2:-}" = "origin" ] && { [ "${3:-}" = "${FAKE_GIT_BASE_BRANCH:-main}" ] || [ "${3:-}" = "+refs/heads/${FAKE_GIT_BASE_BRANCH:-main}:refs/remotes/origin/${FAKE_GIT_BASE_BRANCH:-main}" ]; }; then',
        '  exit 0',
        'fi',
        'if [ "${1:-}" = "log" ] && [ "${2:-}" = "origin/${FAKE_GIT_BASE_BRANCH:-main}..refs/heads/${FAKE_GIT_BASE_BRANCH:-main}" ]; then',
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

export function setupFakeCliTools(scriptDir: string): void {
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
        '  read_pr_state',
        '  if [ -z "$FAKE_GH_STATE_NUMBER" ]; then if [ "$json" = "1" ]; then printf "[]\\n"; fi; exit 0; fi',
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

export function setupInvocationLoggingCliTools(scriptDir: string): void {
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
        "status.status = phase === 'spec' ? 'spec_review' : phase === 'spec_review' ? 'plan' : phase === 'plan' ? 'implement' : phase === 'implement' ? 'code_review' : phase === 'code_review' ? 'qa' : phase === 'qa' ? 'human_review' : status.status;",
        "fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\\n`);",
        '',
    ].join('\n'), 'utf8');
    for (const agent of ['claude', 'codex']) {
        writeExecutable(scriptDir, agent, [
            'if [ "${1:-}" = "--version" ]; then printf "%s\\n" "fake-agent 1.0"; exit 0; fi',
            `printf "%s\\n" "${agent}" >> "$FAKE_AGENT_LOG"`,
        'if [ -n "${FAKE_AGENT_ARGV_LOG:-}" ]; then node -e \'require("fs").appendFileSync(process.env.FAKE_AGENT_ARGV_LOG, JSON.stringify({agent:process.argv[1],argv:process.argv.slice(2),cwd:process.cwd()})+"\\n")\' "' + agent + '" "$@"; fi',
        'is_resume=0; for arg in "$@"; do case "$arg" in resume|--resume) is_resume=1 ;; esac; done',
        'if [ -n "${FAKE_AGENT_EDIT_SCRIPT:-}" ]; then node "$FAKE_AGENT_EDIT_SCRIPT" "' + agent + '" "$@" || exit $?; fi',
        'if [ "' + agent + '" = "claude" ] && [ "${FAKE_AGENT_FAIL_RESUME:-0}" = "1" ] && [ "$is_resume" = "1" ]; then exit 7; fi',
        'if [ -n "${FAKE_AGENT_COMPLETE_PHASE:-}${FAKE_AGENT_COMPLETE_SEQUENCE:-}" ] && { [ "${FAKE_AGENT_SKIP_COMPLETE_ON_RESUME:-0}" != "1" ] || [ "$is_resume" != "1" ]; }; then node "$FAKE_AGENT_COMPLETER"; fi',
        'if [ "' + agent + '" = "codex" ] && [ -n "${FAKE_CODEX_THREAD_ID:-}" ]; then printf \'{"type":"thread.started","thread_id":"%s"}\\n\' "$FAKE_CODEX_THREAD_ID"; fi',
        'if [ "' + agent + '" = "claude" ] && [ -n "${FAKE_CLAUDE_SESSION_ID:-}" ]; then printf \'{"type":"result","result":"ok","session_id":"%s"}\\n\' "$FAKE_CLAUDE_SESSION_ID"; fi',
            'exit 0',
        ]);
    }
}

export function installDocsRefsChecker(repoDir: string, options: { hook: boolean }): void {
    const scriptsDir = path.join(repoDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.copyFileSync(path.join(WORKTREE_ROOT, 'scripts/docs-refs-check.mjs'), path.join(scriptsDir, 'docs-refs-check.mjs'));
    gitIn(repoDir, 'add', 'scripts/docs-refs-check.mjs');
    gitIn(repoDir, 'commit', '-m', 'add docs refs checker fixture');
    if (options.hook) {
        const hooksDir = path.resolve(repoDir, execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: repoDir, encoding: 'utf8' }).trim());
        fs.mkdirSync(hooksDir, { recursive: true });
        // On macOS the temp path can have a /var alias while Git reports /private/var.
        // Use the canonical path so the checker's import.meta.url entry guard runs.
        const checkerPath = fs.realpathSync(path.join(repoDir, 'scripts/docs-refs-check.mjs'));
        fs.writeFileSync(path.join(hooksDir, 'pre-commit'), `#!/bin/sh\nexec node '${checkerPath}'\n`, { mode: 0o755 });
        gitIn(repoDir, 'config', 'core.hooksPath', hooksDir);
    }
}

export function prepareImplementFixupFixture(dir: string, taskId: string, options: {
    artifactFinding?: 'handoff' | 'review' | 'none';
    session?: boolean;
    hook?: 'checker' | 'fail' | 'absent';
    resumeScript?: string;
    failResume?: boolean;
    commitCleanFile?: boolean;
}) {
    fs.mkdirSync(dir, { recursive: true });
    const { localDir } = makeGitFixture(dir);
    if (options.commitCleanFile) {
        fs.writeFileSync(path.join(localDir, 'clean-tracked.txt'), 'baseline\n');
        gitIn(localDir, 'add', 'clean-tracked.txt');
        gitIn(localDir, 'commit', '-m', 'add clean tracked fixture file');
        gitIn(localDir, 'push', 'origin', 'main');
    }
    const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', 0);
    fs.appendFileSync(path.join(tasksRoot, taskId, 'spec.md'), '\n## Validation Required\n\n- [x] `npm test`\n');
    // The broken ref is written during the implement run (FAKE_AGENT_SEED_FILE),
    // after the pre-implement scaffold commit, as it would be in a real run.
    const seedFile = options.artifactFinding === 'handoff' ? path.join(tasksRoot, taskId, 'handoff.md')
        : options.artifactFinding === 'review' ? path.join(tasksRoot, taskId, 'review.md') : '';
    if (options.hook !== 'absent') installDocsRefsChecker(localDir, { hook: options.hook !== undefined });
    if (options.hook === 'fail') {
        const hooksDir = path.resolve(localDir, execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: localDir, encoding: 'utf8' }).trim());
        // Reject only commits that stage something outside tasks/, so the
        // pre-implement scaffold commit (task artifacts only) still lands.
        fs.writeFileSync(path.join(hooksDir, 'pre-commit'), "#!/bin/sh\ngit diff --cached --name-only | grep -qv '^tasks/' || exit 0\nexit 1\n", { mode: 0o755 });
    }
    const fakeBins = path.join(dir, 'fake-bins');
    fs.mkdirSync(fakeBins, { recursive: true });
    setupInvocationLoggingCliTools(fakeBins);
    fs.writeFileSync(path.join(fakeBins, 'codex'), [
        '#!/bin/sh',
        'if [ "${1:-}" = "--version" ]; then printf "%s\\n" "fake-agent 1.0"; exit 0; fi',
        'printf "%s\\n" "codex" >> "$FAKE_AGENT_LOG"',
        'node -e \'require("fs").appendFileSync(process.env.FAKE_AGENT_ARGV_LOG, JSON.stringify(process.argv.slice(1))+"\\n")\' -- "$@"',
        'is_resume=0; for arg in "$@"; do if [ "$arg" = "resume" ]; then is_resume=1; fi; done',
        'if [ "$is_resume" = "1" ] && [ -n "${FAKE_AGENT_EDIT_SCRIPT:-}" ]; then node "$FAKE_AGENT_EDIT_SCRIPT" codex "$@"; fi',
        'if [ "$is_resume" = "1" ] && [ "${FAKE_AGENT_FAIL_RESUME:-0}" = "1" ]; then exit 7; fi',
        'if [ "$is_resume" = "1" ]; then exit 0; fi',
        'printf "fixture\\n" > initial-fixture.txt',
        'if [ -n "${FAKE_AGENT_SEED_FILE:-}" ]; then printf "\\nSee \\`src/removed-by-task.ts\\` for details.\\n" >> "$FAKE_AGENT_SEED_FILE"; fi',
        'node "$FAKE_AGENT_COMPLETER"',
        options.session ? 'printf \'{"type":"thread.started","thread_id":"fixture-implement-session"}\\n\'' : ':',
        'exit 0',
    ].join('\n'), { mode: 0o755 });
    const agentLog = path.join(dir, 'agent-invocations.log');
    const argvLog = path.join(dir, 'agent-argv.jsonl');
    const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: localDir, encoding: 'utf8' }).trim();
    const result = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, 3, [], {
        FAKE_AGENT_COMPLETE_PHASE: 'implement',
        ...(seedFile ? { FAKE_AGENT_SEED_FILE: seedFile } : {}),
        FAKE_AGENT_ARGV_LOG: argvLog,
        FAKE_AGENT_LOG: agentLog,
        ...(options.resumeScript ? { FAKE_AGENT_EDIT_SCRIPT: options.resumeScript } : {}),
        ...(options.failResume ? { FAKE_AGENT_FAIL_RESUME: '1' } : {}),
    });
    return { result, localDir, tasksRoot, agentLog, argvLog, headBefore };
}

// Commits after `base` other than the pre-implement scaffold commit. That
// commit only lands where the fixture's task dir resolves inside the repo
// (Linux CI); macOS tmpdir aliasing skips it.
export function nonScaffoldCommits(repoDir: string, base: string): string[] {
    return execFileSync('git', ['log', '--format=%s', `${base}..HEAD`], { cwd: repoDir, encoding: 'utf8' })
        .split('\n').filter(Boolean).filter(subject => !/^task\([^)]+\): commit artifacts pre-pipeline$/.test(subject));
}

export function countResumes(argvLog: string): number {
    return fs.readFileSync(argvLog, 'utf8').trim().split('\n').filter(Boolean)
        .map(line => JSON.parse(line) as string[] | { argv: string[] })
        .filter(entry => (Array.isArray(entry) ? entry : entry.argv).some(arg => arg === 'resume' || arg === '--resume' || arg.startsWith('--resume='))).length;
}

export function prepareQaFixupFixture(dir: string, taskId: string, options: {
    session?: boolean;
    failResume?: boolean;
    editOutside?: boolean;
}) {
    fs.mkdirSync(dir, { recursive: true });
    const { localDir } = makeGitFixture(dir);
    const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', 0, 0, true);
    const statusPath = path.join(tasksRoot, taskId, 'status.json');
    const status = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as { status: string; phases: Record<string, { status: string; verdict?: string }> };
    status.status = 'qa';
    status.phases.code_review.status = 'done';
    status.phases.code_review.verdict = 'approved';
    status.phases.qa.status = 'pending';
    fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);
    installDocsRefsChecker(localDir, { hook: false });
    const fakeBins = path.join(dir, 'fake-bins');
    fs.mkdirSync(fakeBins, { recursive: true });
    setupInvocationLoggingCliTools(fakeBins);
    const editScript = path.join(dir, 'qa-edit.mjs');
    const donePath = path.join(tasksRoot, taskId, 'done.md');
    fs.writeFileSync(editScript, [
        "import fs from 'node:fs';",
        `const done = ${JSON.stringify(donePath)};`,
        "const resume = process.argv.includes('--resume');",
        "if (!resume) fs.writeFileSync(done, '# Completed\\n\\nSee `src/removed-by-task.ts` for details.\\n');",
        options.editOutside ? "if (resume) fs.appendFileSync('initial-fixture.txt', 'changed outside artifacts\\n');" : '',
    ].filter(Boolean).join('\n'));
    const argvLog = path.join(dir, 'agent-argv.jsonl');
    const agentLog = path.join(dir, 'agent-invocations.log');
    const result = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, 3, [], {
        FAKE_AGENT_COMPLETE_PHASE: 'qa',
        ...(options.session ? { FAKE_CLAUDE_SESSION_ID: 'qa-fixup-session' } : {}),
        ...(options.failResume ? { FAKE_AGENT_FAIL_RESUME: '1' } : {}),
        FAKE_AGENT_EDIT_SCRIPT: editScript,
        FAKE_AGENT_SKIP_COMPLETE_ON_RESUME: '1',
        FAKE_AGENT_ARGV_LOG: argvLog,
        FAKE_AGENT_LOG: agentLog,
    }, false);
    return { result, localDir, tasksRoot, argvLog, agentLog };
}

export type FakeRunHarness = {
    localDir: string;
    tasksRoot: string;
    fakeBins: string;
    fakeGitDir: string;
    gitLogPath: string;
    currentBranchPath: string;
};

export function makeFakeRunHarness(dir: string, taskId: string, status: Record<string, unknown>): FakeRunHarness {
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

export function runFakeMain(
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
        ...(cwd !== harness.localDir ? { FAKE_GIT_DIR: path.join(harness.localDir, '.git', 'worktrees', path.basename(cwd)) } : {}),
        FAKE_GIT_ACTIVE_TOPLEVEL: cwd,
        FAKE_GIT_CURRENT_BRANCH: harness.currentBranchPath,
        FAKE_GIT_BASE_BRANCH: 'main',
        FAKE_GIT_TASK_BRANCH: `task/${taskId}`,
        ...extraEnv,
    });
    return runMainInline(taskId, args, env, cwd);
}

export function runRealMainWithFakeAgents(
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

export function readAgentInvocations(logPath: string): string[] {
    if (!fs.existsSync(logPath)) return [];
    return fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
}

export function makeReviewLoopStatus(
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

export function writeReviewLoopFixture(
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
        '## Self-Check',
        '',
        '| Check | Evidence |',
        '|---|---|',
        '| Test integrity | N/A — fixture handoff |',
        '| Restatement sweep | N/A — fixture handoff |',
        '| Sibling parity | N/A — fixture handoff |',
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

export function runReviewLoopMain(
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
        CANON_PROVIDER: undefined,
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

export function withFakeGitEnv<T>(
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

export function runNodeInline(
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
            CLAUDE_MODEL_SPEC_REVIEW: undefined,
            CLAUDE_MODEL_IMPLEMENT: undefined,
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

export function runMainInline(
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

export function runEnsureBranchInline(
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

export function runEnsureBundleBranchInline(
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

export function childEnvWithoutTasksOverride(updates: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, ...updates };
    delete env.CANON_TASKS_DIR_OVERRIDE;
    return env;
}

export function gitIn(cwd: string, ...args: string[]): void {
    execFileSync('git', args, { cwd, stdio: 'ignore' });
}

export function makeGitFixture(dir: string): { localDir: string; originDir: string } {
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

// Real-git base-drift tests drive main(), which requires the agent CLIs on
// PATH before routing; put fakes first so CI runners without them still pass.
export function baseDriftEnv(dir: string, tasksRoot: string): NodeJS.ProcessEnv {
    const fakeBins = path.join(dir, 'fake-agent-cli');
    if (!fs.existsSync(fakeBins)) {
        fs.mkdirSync(fakeBins, { recursive: true });
        setupFakeCliTools(fakeBins);
    }
    return {
        ...process.env,
        CANON_TASKS_DIR_OVERRIDE: tasksRoot,
        PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
    };
}

export function makeBaseDriftFixture(
    dir: string,
    options: { seedFiles?: Record<string, string>; taskFiles?: Record<string, string>; declared: string[] },
): { localDir: string; originDir: string; tasksRoot: string; thirdParty(fn: (cwd: string) => void): void } {
    const { localDir, originDir } = makeGitFixture(dir);
    for (const [relative, content] of Object.entries(options.seedFiles ?? {})) {
        const target = path.join(localDir, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, 'utf8');
        gitIn(localDir, 'add', relative);
    }
    if (Object.keys(options.seedFiles ?? {}).length > 0) {
        gitIn(localDir, 'commit', '-m', 'shared base seed');
        gitIn(localDir, 'push', 'origin', 'main');
    }
    gitIn(localDir, 'checkout', '-b', 'task/demo');
    for (const [relative, content] of Object.entries(options.taskFiles ?? {})) {
        const target = path.join(localDir, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, 'utf8');
        gitIn(localDir, 'add', relative);
    }
    if (Object.keys(options.taskFiles ?? {}).length > 0) gitIn(localDir, 'commit', '-m', 'task change');
    const tasksRoot = path.join(dir, 'tasks');
    writeTaskStatus(tasksRoot, 'task-a', makeCompleteStatus('task-a', 'task/demo'));
    writeAffectedFilesSpec(tasksRoot, 'task-a', options.declared);
    return {
        localDir,
        originDir,
        tasksRoot,
        thirdParty(fn) {
            const thirdPartyDir = path.join(dir, 'third-party');
            execFileSync('git', ['clone', '-b', 'main', originDir, thirdPartyDir], { stdio: 'ignore' });
            gitIn(thirdPartyDir, 'config', 'user.email', 'third@example.com');
            gitIn(thirdPartyDir, 'config', 'user.name', 'Third Party');
            fn(thirdPartyDir);
            gitIn(thirdPartyDir, 'add', '-A');
            gitIn(thirdPartyDir, 'commit', '-m', 'base advance');
            gitIn(thirdPartyDir, 'push', 'origin', 'main');
        },
    };
}

export function makeOutOfRootTaskFixture(dir: string, taskId: string, linkedWorktree: string): {
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

export function makeBootstrappedTaskWorktreeFixture(dir: string, taskId: string, initialFiles: Record<string, string> = {}): {
    localDir: string;
    worktreeDir: string;
    branch: string;
} {
    const { localDir } = makeGitFixture(dir);
    for (const [file, content] of Object.entries(initialFiles)) {
        const filePath = path.join(localDir, file);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');
    }
    if (Object.keys(initialFiles).length > 0) {
        gitIn(localDir, 'add', '--', ...Object.keys(initialFiles));
        gitIn(localDir, 'commit', '-m', 'add base fixture files');
    }
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

export function makeNodeModulesGateFixture(
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

export function makeWorkspaceResolverFixture(
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

export function captureConsoleError<T>(fn: () => T): { result: T; stderr: string } {
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

export function makeWorkspaceNodeModulesGateFixture(
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

export type TrackedNodeModulesVariant = 'missing' | 'file' | 'directory' | 'verified-symlink' | 'wrong-target-symlink';

export function makeEnsureWorktreeNodeModulesFixture(
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

export type WorkspaceDestinationVariant =
    | TrackedNodeModulesVariant
    | 'destination-escape'
    | 'destination-dangling'
    | 'destination-file'
    | 'workspace-absent'
    | 'source-hoisted';

export function makeEnsureWorktreeWorkspaceFixture(
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

export function makeHumanReviewPendingStatus(taskId: string, branch: string): Record<string, unknown> {
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

export function setupDivergentBaseRepo(dir: string, taskId: string): { localDir: string; shortSha: string } {
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

export function setupFullSendTailFixture(
    dir: string,
    addExtraCommit?: (localDir: string, taskId: string) => void,
    options: { fullSend?: boolean; baseBranch?: string } = {},
): { localDir: string; originDir: string; originBaseSha: string; taskId: string; fakeBins: string } {
    const taskId = 'task-a';
    const { localDir: clonedDir, originDir } = makeGitFixture(dir);
    const localDir = path.join(dir, 'worktrees', taskId);
    fs.mkdirSync(path.dirname(localDir), { recursive: true });
    fs.renameSync(clonedDir, localDir);
    fs.mkdirSync(path.join(localDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(localDir, 'src/module.ts'), 'export const value = 1;\n', 'utf8');
    gitIn(localDir, 'add', 'src/module.ts');
    gitIn(localDir, 'commit', '-m', 'add tracked module');
    gitIn(localDir, 'push', 'origin', 'main');
    const originBaseSha = execFileSync('git', ['--git-dir', originDir, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim();

    const status = makeCompleteStatus(taskId, `task/${taskId}`);
    status.full_send = options.fullSend ?? true;
    status.base_branch = options.baseBranch ?? 'main';
    if (options.baseBranch) gitIn(localDir, 'checkout', '-b', options.baseBranch);
    (status.phases as Record<string, { status: string; agent: string }>).human_review = { status: 'pending', agent: 'human' };
    writeTaskStatus(path.join(localDir, 'tasks'), taskId, status);
    writeAffectedFilesSpec(path.join(localDir, 'tasks'), taskId, []);
    gitIn(localDir, 'add', 'tasks');
    gitIn(localDir, 'commit', '-m', `task(${taskId}): commit artifacts pre-pipeline`);
    addExtraCommit?.(localDir, taskId);
    gitIn(localDir, 'checkout', '-b', `task/${taskId}`);
    fs.writeFileSync(path.join(localDir, 'tasks', taskId, 'handoff.md'), [
        '# Implementation Handoff', '', '## Validation Outcomes', '', '| Check | Result | Notes |', '|---|---|---|', '| `lint` | Pass | ok |', '',
    ].join('\n'), 'utf8');
    const fakeBins = path.join(dir, 'fake-bins');
    fs.mkdirSync(fakeBins, { recursive: true });
    setupFakeCliTools(fakeBins);
    return { localDir, originDir, originBaseSha, taskId, fakeBins };
}

export function runFullSendTailFixture(
    fixture: ReturnType<typeof setupFullSendTailFixture>,
    dir: string,
    env: NodeJS.ProcessEnv = {},
): { status: number | null; stderr: string; stdout: string } {
    return runMainInline(fixture.taskId, ['--full-send', '--force'], {
        PATH: `${fixture.fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        CANON_TASKS_DIR_OVERRIDE: path.join(fixture.localDir, 'tasks'),
        CANON_WORKTREES_ROOT: path.dirname(fixture.localDir),
        FAKE_GH_LOG: path.join(dir, 'gh.log'),
        FAKE_GH_PR_STATE_FILE: path.join(dir, 'pr-state.txt'),
        ...env,
    }, fixture.localDir);
}

export function scaffoldGitOutput(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

export function runScaffoldFixture(
    fixture: ReturnType<typeof setupFullSendTailFixture>, dir: string, args: string[], env: NodeJS.ProcessEnv = {},
): { status: number | null; stderr: string; stdout: string } {
    return runMainInline(fixture.taskId, args, {
        PATH: `${fixture.fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        CANON_TASKS_DIR_OVERRIDE: path.join(fixture.localDir, 'tasks'),
        CANON_WORKTREES_ROOT: path.dirname(fixture.localDir),
        FAKE_GH_LOG: path.join(dir, 'gh.log'),
        FAKE_GH_PR_STATE_FILE: path.join(dir, 'pr-state.txt'),
        ...env,
    }, fixture.localDir);
}

export function remoteScaffoldTip(fixture: ReturnType<typeof setupFullSendTailFixture>, base = 'main'): string {
    const result = spawnSync('git', ['--git-dir', fixture.originDir, 'rev-parse', '--verify', `refs/heads/${base}`], { encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : '';
}

export function scaffoldGhLog(dir: string): string {
    return fs.existsSync(path.join(dir, 'gh.log')) ? fs.readFileSync(path.join(dir, 'gh.log'), 'utf8') : '';
}

export function rejectScaffoldBase(fixture: ReturnType<typeof setupFullSendTailFixture>, base: string): void {
    writeExecutable(path.join(fixture.originDir, 'hooks'), 'pre-receive', [
        `while read old new ref; do if [ "$ref" = "refs/heads/${base}" ]; then echo 'protected branch rejection' >&2; exit 1; fi; done`,
        'exit 0',
    ]);
}

export function makeCompleteStatus(taskId: string, branch: string): Record<string, unknown> {
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

export function writeReviewRecoveryTask(
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

export function writeAffectedFilesSpec(tasksRoot: string, taskId: string, fileCells: readonly string[]): void {
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

export function writeShipTaskArtifacts(repoDir: string, taskId: string, branch: string, worktree: boolean): void {
    const tasksRoot = path.join(repoDir, 'tasks');
    const status = makeCompleteStatus(taskId, branch);
    status.worktree = worktree;
    writeTaskStatus(tasksRoot, taskId, status);
    writeAffectedFilesSpec(tasksRoot, taskId, ['`src/example.ts`']);
}

export function simulateShipMergeOnOrigin(dir: string, originDir: string, taskId: string, branch: string, worktree: boolean): void {
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

export function runShipTask(
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

export type HumanReviewHarness = {
    dir: string;
    tasksRoot: string;
    fakeBins: string;
    fakeGitDir: string;
    currentBranchPath: string;
    gitLogPath: string;
};

export function setupHumanReviewHarness(dir: string, taskIds: readonly string[]): HumanReviewHarness {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
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

export function runHumanReviewCommit(
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

export function runHumanReviewMain(
    harness: HumanReviewHarness,
    args: readonly string[],
    env: Record<string, string>,
): { status: number | null; stderr: string; stdout: string } {
    return runNodeInline([
        `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
        `.then(m => { process.argv = ['node', 'canon', 'task-a', ...${JSON.stringify(args)}]; return m.main(); })`,
        '.catch(err => { console.error(err); process.exit(1); });',
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
        FAKE_GIT_COMMON_DIR: '.git',
        FAKE_GIT_STATUS_OUTPUT: ' M tasks/task-a/done.md',
        FAKE_GIT_DIFF_OUTPUT: 'tasks/task-a/done.md',
        ...env,
    }, harness.dir);
}

export function combinedOutput(result: { stderr: string; stdout: string }): string {
    return `${result.stdout}\n${result.stderr}`;
}

export function writeQaArtifacts(repoDir: string, taskId: string): void {
    const taskDir = path.join(repoDir, 'tasks', taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    for (const fileName of ['handoff.md', 'review.md', 'done.md', 'notes.md', 'status.json']) {
        fs.writeFileSync(path.join(taskDir, fileName), `${taskId} ${fileName}\n`, 'utf8');
    }
}

export function runCommitQaArtifactsInline(taskId: string, cwd: string): { status: number | null; stderr: string; stdout: string } {
    return runNodeInline([
        `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
        `.then(m => { m.commitQaArtifacts([${JSON.stringify(taskId)}], ${JSON.stringify(cwd)}); })`,
        `.catch(err => { console.error(err); process.exit(1); });`,
    ].join('\n'), childEnvWithoutTasksOverride(), cwd);
}

export function runAutoCommitCodeInline(taskId: string, cwd: string): { status: number | null; stderr: string; stdout: string } {
    return runNodeInline([
        `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
        `.then(m => { m.autoCommitCode([${JSON.stringify(taskId)}], ${JSON.stringify(cwd)}); })`,
        '.catch(err => { console.error(err); process.exit(1); });',
    ].join('\n'), childEnvWithoutTasksOverride(), cwd);
}

export function runReviewEntryRetryInline(taskId: string, cwd: string): { status: number | null; stderr: string; stdout: string } {
    return runNodeInline([
        `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
        `.then(m => m.retryImplementAutoCommitAtReviewEntry([${JSON.stringify(taskId)}], ${JSON.stringify(cwd)}))`,
        '.catch(err => { console.error(err); process.exit(1); });',
    ].join('\n'), { ...childEnvWithoutTasksOverride(), CANON_TASKS_DIR_OVERRIDE: path.join(cwd, 'tasks') }, cwd);
}

export function runEnsureWorktreeInline(
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

export function runIsExemptNodeModulesEntryInline(
    entry: { raw: string; indexStatus: string; worktreeStatus: string; paths: string[] },
    cwd: string,
): { status: number | null; stderr: string; stdout: string } {
    return runNodeInline([
        `import(${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)})`,
        `.then(m => { console.log(String(m.isExemptNodeModulesEntry(${JSON.stringify(entry)}, ${JSON.stringify(cwd)}))); })`,
        `.catch(err => { console.error(err); process.exit(1); });`,
    ].join('\n'), childEnvWithoutTasksOverride(), cwd);
}

export function runTeardownWorktreeInline(
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

export function writeImplementEvidenceFixture(tasksRoot: string, taskId: string, handoffChanges: readonly string[]): void {
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
        '## Self-Check',
        '',
        '| Check | Evidence |',
        '|---|---|',
        '| Test integrity | N/A — fixture handoff |',
        '| Restatement sweep | N/A — fixture handoff |',
        '| Sibling parity | N/A — fixture handoff |',
        '',
        '## Validation Outcomes',
        '',
        '| Check | Result | Notes |',
        '|---|---|---|',
        '| `lint` | Pass | ok |',
        '',
    ].join('\n'), 'utf8');
}

export function makeAutoCommitFixture(dir: string, files: Record<string, string>, handoffChanges: readonly string[]): string {
    const { localDir } = makeGitFixture(dir);
    for (const [file, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(localDir, file), content, 'utf8');
    }
    const taskId = 'task-a';
    const tasksRoot = path.join(localDir, 'tasks');
    writeImplementEvidenceFixture(tasksRoot, taskId, handoffChanges);
    writeTaskStatus(tasksRoot, taskId, makeCompleteStatus(taskId, `task/${taskId}`));
    gitIn(localDir, 'add', '--', ...Object.keys(files), `tasks/${taskId}`);
    gitIn(localDir, 'commit', '-m', 'fixture baseline');
    gitIn(localDir, 'checkout', '-b', `task/${taskId}`);
    return localDir;
}

export function latestNameStatuses(cwd: string): Set<string> {
    return new Set(execFileSync('git', ['show', '--name-status', '--pretty=format:', 'HEAD'], {
        cwd, encoding: 'utf8',
    }).trim().split('\n'));
}

export function prepareReviewEntryMainFixture(dir: string, taskId: string, commitSource: boolean, dirtySource: boolean) {
    const { localDir, worktreeDir } = makeBootstrappedTaskWorktreeFixture(dir, taskId, {
            'initial-fixture.txt': 'committed baseline\n',
        });
    if (commitSource) {
        gitIn(localDir, 'config', 'core.hooksPath', '/dev/null');
        fs.writeFileSync(path.join(worktreeDir, 'initial-fixture.txt'), 'committed task change\n');
        gitIn(worktreeDir, 'add', 'initial-fixture.txt');
        gitIn(worktreeDir, 'commit', '-m', 'commit handoff fixture source');
    }

    const tasksRoot = writeReviewLoopFixture(worktreeDir, taskId, 'code_review', 0, 0, true);
    fs.appendFileSync(path.join(tasksRoot, taskId, 'spec.md'), '\n## Validation Required\n\n- [x] `npm test`\n');
    fs.appendFileSync(path.join(tasksRoot, taskId, 'handoff.md'), [
            '',
            '## AC Coverage',
            '',
            '| AC | Status | Notes |',
            '|---|---|---|',
            '| AC-1 | Met | fixture |',
            '',
        ].join('\n'));
    const statusPath = path.join(tasksRoot, taskId, 'status.json');
    const taskStatus = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as Record<string, unknown>;
    taskStatus.worktree = true;
    taskStatus.branch = `task/${taskId}`;
    fs.writeFileSync(statusPath, `${JSON.stringify(taskStatus, null, 2)}\n`);
    if (dirtySource) fs.writeFileSync(path.join(worktreeDir, 'initial-fixture.txt'), 'dirty implement result\n');

    const fakeBins = path.join(dir, 'fake-bins');
    fs.mkdirSync(fakeBins, { recursive: true });
    setupInvocationLoggingCliTools(fakeBins);
    writeExecutable(fakeBins, 'codex', [
            'if [ "${1:-}" = "--version" ]; then printf "%s\\n" "fake-agent 1.0"; exit 0; fi',
            'node -e \'console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"clean review"}})); console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:1,output_tokens:1}}))\'',
        ]);
    return { localDir, worktreeDir, tasksRoot, statusPath, fakeBins };
}

export function runReviewEntryMainFixture(fixture: ReturnType<typeof prepareReviewEntryMainFixture>, taskId: string, extraEnv: NodeJS.ProcessEnv = {}) {
    return runReviewLoopMain(fixture.localDir, fixture.tasksRoot, fixture.fakeBins, taskId, 3, [], {
        CANON_WORKTREES_ROOT: path.join(fixture.localDir, '.canon', 'worktrees'),
        FAKE_AGENT_COMPLETE_PHASE: 'code_review',
        ...extraEnv,
    });
}

export function commitIgnoreRules(cwd: string, rules: string): void {
    fs.writeFileSync(path.join(cwd, '.gitignore'), rules, 'utf8');
    gitIn(cwd, 'add', '.gitignore');
    gitIn(cwd, 'commit', '-m', 'ignore rules');
}

export function writeApprovedSpecReview(tasksRoot: string, taskId: string): void {
    fs.mkdirSync(path.join(tasksRoot, taskId), { recursive: true });
    fs.writeFileSync(path.join(tasksRoot, taskId, 'spec-review.md'), [
        '# Spec Review',
        '',
        '- [x] Approved',
        '',
    ].join('\n'), 'utf8');
}

export function writePopulatedPlan(tasksRoot: string, taskId: string): void {
    fs.mkdirSync(path.join(tasksRoot, taskId), { recursive: true });
    fs.writeFileSync(path.join(tasksRoot, taskId, 'plan.md'), [
        '# Plan',
        '',
        '1. Implement the change.',
        '',
    ].join('\n'), 'utf8');
}

// Probe whether the .git directory is writable before attempting to create a
// real worktree. Two environments legitimately block this:
//   1. Codex's sandbox (blocks all .git/ writes by design)
//   2. Running from inside a linked worktree (.git is a file, not a dir)
// In both cases the underlying code is correct — skipping avoids a false
// EPERM failure that has nothing to do with the behavior under test.
export const gitDirWritable = (() => {
    // Per-process name: several test files import this module concurrently.
    const probe = path.join(REPO_ROOT, '.git', `.worktree-test-probe-${process.pid}`);
    try {
        fs.writeFileSync(probe, '');
        fs.unlinkSync(probe);
        return true;
    } catch {
        return false;
    }
})();

// ── guardConcurrentRun ──────────────────────────────────────────────────────

export function makeGuardResolver(rootDir: string) {
    return (id: string) => path.join(rootDir, 'tasks', id);
}

export function captureDie(): { msg: string | null; fn: (m: string) => never } {
    const capture: { msg: string | null; fn: (m: string) => never } = {
        msg: null,
        fn: (m: string): never => { capture.msg = m; throw new Error(m); },
    };
    return capture;
}

export function writeFreshHeartbeat(taskDir: string, pid: number): void {
    const now = Date.now();
    const hb = { pid, started_at_ms: now - 5_000, last_update_ms: now - 500, task_ids: ['task-1'] };
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, '.heartbeat.json'), JSON.stringify(hb, null, 2), 'utf8');
}

export function writeFreshnessConfig(root: string, value: unknown): void {
    fs.mkdirSync(path.join(root, '.canon'), { recursive: true });
    fs.writeFileSync(path.join(root, '.canon/config.json'), typeof value === 'string' ? value : JSON.stringify(value));
}


export function parityTask(status: StatusJson): TaskContext {
    return { taskId: status.id ?? 'parity', title: status.title ?? 'parity', status,
        specReviewVerdict: 'approved', iterations: 0, iterations_current_loop: 0, iterations_total: 0, rerouteCount: 0 };
}
