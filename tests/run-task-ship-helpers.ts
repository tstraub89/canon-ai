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
        'if [ "${1:-}" != api ]; then printf "%s\\n" "HTTP 403: GitHub GraphQL is not available" >&2; exit 1; fi',
        `node - "$@" <<'NODE'`,
        'const fs=require("fs"),cp=require("child_process"),a=process.argv.slice(2),e=process.env;',
        'let method="GET",input="",endpoint="",mergeMethod="";',
        'for(let i=1;i<a.length;i++){if(a[i]==="-X")method=a[++i];else if(a[i]==="--hostname"||a[i]==="--jq")i++;else if(a[i]==="--input")input=a[++i];else if(a[i]==="-f")mergeMethod=a[++i];else if(a[i]==="--paginate"){}else endpoint=a[i];}',
        'const u=new URL(endpoint,"https://x.invalid"),q=u.searchParams;let path=decodeURIComponent(u.pathname);if(path.startsWith("/repos/{owner}/{repo}"))path=path.slice("/repos/{owner}/{repo}".length);const stateFile=e.FAKE_GH_STATE_FILE||"";',
        'let state={};try{if(stateFile&&fs.existsSync(stateFile))state=Object.fromEntries(fs.readFileSync(stateFile,"utf8").trim().split("|").map((v,i)=>["number url base head status".split(" ")[i],v]));}catch{}',
        'const fail=(s)=>{process.stderr.write(s+"\\n");process.exit(1)},out=(s)=>process.stdout.write(s+"\\n"),truth=(name)=>e[name]==="1";',
        'if(path==="/pulls"&&method==="GET"){const st=q.get("state")||"open";if(st==="open"&&truth("FAKE_GH_PR_LIST_FAIL"))fail("open PR listing failed");if(st==="open"&&truth("FAKE_GH_PR_LIST_MALFORMED")){out("not json");process.exit(0);}let n=st==="open"?(e.FAKE_GH_OPEN_PR_NUMBER||""):(e.FAKE_GH_MERGED_PR_NUMBER||"");let head=e.FAKE_GH_PR_HEAD||q.get("head")?.replace(/^.*?:/,"")||state.head||"";let base=e.FAKE_GH_PR_BASE||state.base||q.get("base")||"";let status=st==="open"?"open":"closed";if(state.status==="OPEN"&&st==="open"){n=state.number;head=state.head;base=state.base;}if(state.status==="MERGED"&&st!=="open"){n=state.number;head=state.head;base=state.base;}if(q.get("base")&&base&&q.get("base")!==base)n="";const item=n?{number:Number(n),state:status,merged_at:st==="closed"?"2026-01-01T00:00:00Z":null,head:{ref:head},base:{ref:base||q.get("base")||"main"}}:null;if(item)out(JSON.stringify(item));process.exit(0);}',
        'if(path==="/pulls"&&method==="POST"){if(truth("FAKE_GH_PR_CREATE_FAIL"))fail(e.FAKE_GH_PR_CREATE_ERROR||"draft PR creation failed");const p=JSON.parse(fs.readFileSync(input,"utf8")),n=e.FAKE_GH_CREATE_NUMBER||"101",url=e.FAKE_GH_CREATE_URL||`https://github.com/example/repo/pull/${n}`;if(e.FAKE_GH_CREATE_PAYLOAD)fs.copyFileSync(input,e.FAKE_GH_CREATE_PAYLOAD);if(stateFile)fs.writeFileSync(stateFile,`${n}|${url}|${p.base}|${p.head}|OPEN\\n`);out(JSON.stringify({number:Number(n),html_url:url}));process.exit(0);}',
        'if((path===""||path==="/")&&method==="GET"){if(truth("FAKE_GH_REPO_VIEW_FAIL"))fail("repository settings unavailable");if(truth("FAKE_GH_REPO_VIEW_MALFORMED")){out("not json");process.exit(0);}const m=","+(e.FAKE_GH_ALLOWED_METHODS||"squash,rebase,merge")+",";out(JSON.stringify({allow_squash_merge:m.includes(",squash,"),allow_rebase_merge:m.includes(",rebase,"),allow_merge_commit:m.includes(",merge,")}));process.exit(0);}',
        'if(path.endsWith("/merge")&&path.includes("/pulls/")&&method==="PUT"){if(truth("FAKE_GH_MERGE_FAIL"))fail(e.FAKE_GH_MERGE_ERROR||"merge failed");if(stateFile&&state.number)fs.writeFileSync(stateFile,`${state.number}|${state.url}|${state.base}|${state.head}|MERGED\\n`);process.exit(0);}',
        'if(path.includes("/pulls/")&&!path.endsWith("/merge")){const legacy=e.FAKE_GH_PR_STATE||state.status||"MERGED",st=legacy==="OPEN"?"open":"closed",merged=legacy==="MERGED"?"2026-01-01T00:00:00Z":null;out(JSON.stringify({state:st,merged_at:merged,head:{sha:e.FAKE_GH_HEAD_REF_OID||""},base:{ref:e.FAKE_GH_BASE_REF_NAME||state.base||e.FAKE_GH_PR_BASE||"main"},html_url:e.FAKE_GH_PR_URL||state.url||"https://github.com/example/repo/pull/1"}));process.exit(0);}',
        'fail("unexpected gh api args: "+a.join(" "));',
        'NODE',
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

export function simulateMergeOnOrigin(
    dir: string,
    originDir: string,
    statuses: Record<string, Record<string, unknown>>,
    files: Record<string, string> = {},
    omit: readonly string[] = [],
): void {
    const mergeDir = path.join(dir, `merge-${Math.random().toString(16).slice(2)}`);
    execFileSync('git', ['clone', originDir, mergeDir], { stdio: 'ignore' });
    gitIn(mergeDir, 'config', 'user.email', 'test@example.com');
    gitIn(mergeDir, 'config', 'user.name', 'Test User');
    gitIn(mergeDir, 'checkout', 'main');
    for (const [taskId, status] of Object.entries(statuses)) {
        writeTaskFiles(mergeDir, taskId, status);
    }
    for (const [file, content] of Object.entries(files)) writeRel(mergeDir, file, content);
    for (const file of omit) fs.rmSync(path.join(mergeDir, file), { force: true });
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
        omitTaskFiles?: readonly string[];
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
    for (const file of options.omitTaskFiles ?? []) fs.rmSync(path.join(localDir, file), { force: true });
    gitIn(localDir, 'add', 'tasks', ...Object.keys(options.taskFiles ?? {}));
    gitIn(localDir, 'commit', '-m', 'add task artifacts');
    const tip = gitIn(localDir, 'rev-parse', branch);
    gitIn(localDir, 'push', '-u', 'origin', branch);
    const prHead = options.advanceRemote ? advanceBranchOnOrigin(dir, originDir, branch) : tip;
    if (options.advanceRemote && options.materializeAdvancedHead !== false) {
        gitIn(localDir, 'fetch', 'origin', branch);
    }

    if (options.mergeToOrigin !== false) {
        simulateMergeOnOrigin(dir, originDir, statuses, options.taskFiles, options.omitTaskFiles ?? []);
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
