import { CLAUDE_HEADLESS, CODEX_HEADLESS, toResumePrompt } from '../src/orchestrator/prompts/helpers.js';
import { promptArtifactFixup } from '../src/orchestrator/prompts/index.js';
import { getClaudeConfig, getCodexConfig } from '../src/orchestrator/policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { diffScopeSnapshots } from '../src/orchestrator/main.js';
import { classifySafeToPushCommitFromData, hasUnpushedScaffoldCommits } from '../src/orchestrator/git.js';
import { scaffoldCommitHint } from '../src/orchestrator/phases/implement.js';
import type { StatusJson } from '../src/orchestrator/types.js';
import { filterArtifactFindings, parseDocsRefsFindings, runDocsRefsCheck } from '../src/orchestrator/validation.js';
import {
    withTempDir,
    writeExecutable,
    setupInvocationLoggingCliTools,
    installDocsRefsChecker,
    countResumes,
    readAgentInvocations,
    writeReviewLoopFixture,
    runReviewLoopMain,
    gitIn,
    makeGitFixture,
    setupFullSendTailFixture,
    scaffoldGitOutput,
    runScaffoldFixture,
    remoteScaffoldTip,
    scaffoldGhLog,
    rejectScaffoldBase,
    combinedOutput,
    runAutoCommitCodeInline,
    runReviewEntryRetryInline,
    makeAutoCommitFixture,
    latestNameStatuses,
    prepareReviewEntryMainFixture,
    runReviewEntryMainFixture,
    commitIgnoreRules,
    parityTask,
} from './run-task-safety-helpers.js';

function installArtifactReviewAgent(fixture: ReturnType<typeof prepareReviewEntryMainFixture>): string {
    const driver = path.join(path.dirname(fixture.fakeBins), 'artifact-review-agent.mjs');
    fs.writeFileSync(driver, [
        "import fs from 'node:fs';",
        "import path from 'node:path';",
        'const args = process.argv.slice(2);',
        "if (args[0] === '--version') { console.log('fake Claude 1.0'); process.exit(0); }",
        'const tasksRoot = process.env.CANON_TASKS_DIR_OVERRIDE;',
        'const taskId = process.env.FAKE_AGENT_TASK_ID;',
        'const taskDir = path.join(tasksRoot, taskId);',
        "const statusPath = path.join(taskDir, 'status.json');",
        "const reviewPath = path.join(taskDir, 'review.md');",
        'const logPath = process.env.FAKE_REVIEW_AGENT_LOG;',
        'const calls = logPath && fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8").split("\\n").filter(Boolean).length : 0;',
        'const resumed = args.includes("--resume");',
        'if (logPath) fs.appendFileSync(logPath, JSON.stringify({ args, resumed }) + "\\n");',
        'const recovery = process.env.FAKE_REVIEW_RECOVERY === "1";',
        'const fixMode = process.env.FAKE_REVIEW_FIX_MODE ?? "clean";',
        'const verdict = process.env.FAKE_REVIEW_VERDICT ?? "changes_requested";',
        'const verdictLabel = verdict === "spec_gap" ? "Spec gap" : verdict === "approved" ? "Approved" : "Changes requested";',
        'const makeReview = label => `# Code Review\\n\\n## Verdict\\n\\n- [x] **${label}**\\n\\nFinding: See \\`src/removed-by-task.ts\\`.\\n`;',
        'const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));',
        'if (recovery && calls === 0 && !resumed) {',
        '  fs.writeFileSync(reviewPath, "# Code Review\\n");',
        '} else if (!resumed) {',
        '  fs.writeFileSync(reviewPath, makeReview(verdictLabel));',
        '  status.phases.code_review.status = process.env.FAKE_REVIEW_BLOCKED === "1" ? "blocked" : "done";',
        '  status.phases.code_review.verdict = verdict;',
        '  status.status = "qa";',
        '} else if (recovery && calls === 1) {',
        '  fs.writeFileSync(reviewPath, makeReview(verdictLabel));',
        '  status.phases.code_review.status = "done";',
        '  status.phases.code_review.verdict = verdict;',
        '  status.status = "qa";',
        '} else {',
        '  let content = fs.readFileSync(reviewPath, "utf8");',
        '  if (fixMode === "flip" || fixMode === "flip-fail") content = content.replace("**Changes requested**", "**Approved**");',
        '  else content = content.replace("`src/removed-by-task.ts`", "[src/removed-by-task.ts](src/removed-by-task.ts)");',
        '  fs.writeFileSync(reviewPath, content);',
        '  if (fixMode === "outside") fs.writeFileSync(path.join(process.cwd(), "outside-fixup.txt"), "changed\\n");',
        '  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2) + "\\n");',
        '  console.log(JSON.stringify({ type: "result", result: "ok", session_id: "reviewer-fixup-session" }));',
        '  if (fixMode === "flip-fail") process.exit(7);',
        '  process.exit(0);',
        '}',
        'fs.writeFileSync(statusPath, JSON.stringify(status, null, 2) + "\\n");',
        'if (process.env.FAKE_REVIEW_NO_SESSION !== "1") console.log(JSON.stringify({ type: "result", result: "ok", session_id: "reviewer-fixup-session" }));',
    ].join('\n'));
    fs.writeFileSync(path.join(fixture.fakeBins, 'claude'), [
        '#!/bin/sh',
        'exec node "$FAKE_REVIEW_AGENT_DRIVER" "$@"',
        '',
    ].join('\n'), { mode: 0o755 });
    return driver;
}

function runArtifactReviewFixture(
    fixture: ReturnType<typeof prepareReviewEntryMainFixture>,
    taskId: string,
    driver: string,
    env: NodeJS.ProcessEnv = {},
) {
    return runReviewLoopMain(fixture.localDir, fixture.tasksRoot, fixture.fakeBins, taskId, 3, [], {
        CANON_PROVIDER: 'claude',
        CANON_WORKTREES_ROOT: path.join(fixture.localDir, '.canon', 'worktrees'),
        FAKE_REVIEW_AGENT_DRIVER: driver,
        FAKE_REVIEW_AGENT_LOG: path.join(path.dirname(driver), 'artifact-review-agent.jsonl'),
        ...env,
    });
}

function prepareArtifactReviewRun(dir: string, taskId: string) {
    const fixture = prepareReviewEntryMainFixture(dir, taskId, false, true);
    installDocsRefsChecker(fixture.localDir, { hook: false });
    const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
    status.provider = 'claude';
    fs.writeFileSync(fixture.statusPath, `${JSON.stringify(status, null, 2)}\n`);
    const driver = installArtifactReviewAgent(fixture);
    return { fixture, driver };
}


void test('docs-refs findings parse, filter to own artifacts, and scope snapshots diff content and status', () => {
    const findings = parseDocsRefsFindings([
        'tasks/a/handoff.md:12: `pkg/src/missing.ts` — missing file',
        'tasks/b/done.md:2: https://x — broken link',
        'Found 2 broken refs',
        'garbage',
        'tasks/a/handoff.md:14: `a:b` — missing file',
    ].join('\n'));
    assert.equal(findings.length, 3);
    assert.equal(findings[2].ref, '`a:b`');
    assert.deepEqual(filterArtifactFindings(findings, ['tasks/a/handoff.md']).map(f => f.line), [12, 14]);
    assert.deepEqual(diffScopeSnapshots(new Map([['a', ' M:one'], ['b', '??:old']]), new Map([['a', ' M:two'], ['b', '??:old'], ['c', '??:new']]), new Set(['b'])), ['a', 'c']);
    assert.deepEqual(diffScopeSnapshots(new Map([['a', ' M:x']]), new Map([['a', ' M:x']]), new Set()), []);
    assert.deepEqual(diffScopeSnapshots(new Map([['[git HEAD]', 'before']]), new Map([['[git HEAD]', 'after']]), new Set()), ['[git HEAD]']);
    assert.equal(runDocsRefsCheck(process.cwd(), path.join(os.tmpdir(), 'missing-docs-refs-checker.mjs')).kind, 'absent');
});

for (const args of [['--pr'], ['--push'], ['--pr', '--allow-divergent-base'], ['--full-send', '--force']]) {
    void test(`scaffold base push: ${args.join(' ')} pushes a safe scaffold`, () => {
        withTempDir('scaffold-safe-', dir => {
            const fixture = setupFullSendTailFixture(dir, undefined, { fullSend: args.includes('--full-send') });
            const tip = scaffoldGitOutput(fixture.localDir, 'rev-parse', 'main').trim();
            const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
            const log = path.join(dir, 'git.log');
            writeExecutable(fixture.fakeBins, 'git', ['printf "%s\\n" "$*" >> "$GIT_ARGV_LOG"', 'exec "$REAL_GIT" "$@"']);
            const result = runScaffoldFixture(fixture, dir, args, { REAL_GIT: realGit, GIT_ARGV_LOG: log });
            assert.equal(result.status, 0, combinedOutput(result));
            assert.equal(remoteScaffoldTip(fixture), tip);
            assert.ok(remoteScaffoldTip(fixture, 'task/task-a'));
            assert.match(result.stdout, /Pushed 1 unpushed main commit\(s\)/);
            assert.doesNotMatch(combinedOutput(result), /Base divergence detected|--allow-divergent-base override/);
            if (!args.includes('--full-send')) assert.doesNotMatch(combinedOutput(result), /Full-send/);
            if (args.includes('--pr') || args.includes('--full-send')) assert.match(scaffoldGhLog(dir), /^pr create /m);
            const commands = fs.readFileSync(log, 'utf8').trim().split('\n');
            const pushIndex = commands.indexOf(`push origin ${tip}:refs/heads/main`);
            assert.ok(pushIndex >= 0, commands.join('\n'));
            assert.equal(commands.filter(line => line === `push origin ${tip}:refs/heads/main`).length, 1);
            assert.doesNotMatch(commands[pushIndex], /--force|(?:^| )-(?:f|u)(?: |$)/);
            assert.equal(commands.slice(0, pushIndex).filter(line => line.startsWith('fetch ')).length, 1);
        });
    });
}

void test('scaffold base push: mixed operator and safe commits block all pushes', () => {
    withTempDir('scaffold-mixed-', dir => {
        const fixture = setupFullSendTailFixture(dir, repo => {
            fs.writeFileSync(path.join(repo, 'operator-source.txt'), 'operator\n');
            gitIn(repo, 'add', 'operator-source.txt');
            gitIn(repo, 'commit', '-m', 'operator commit');
        }, { fullSend: false });
        const shas = scaffoldGitOutput(fixture.localDir, 'log', 'origin/main..main', '--format=%h').trim().split('\n');
        const result = runScaffoldFixture(fixture, dir, ['--pr']);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Base divergence detected/);
        assert.match(result.stderr, /Fix: git push origin main/);
        for (const sha of shas) assert.ok(result.stderr.includes(sha));
        assert.equal(remoteScaffoldTip(fixture), fixture.originBaseSha);
        assert.doesNotMatch(scaffoldGhLog(dir), /^pr create /m);
    });
});

for (const published of [false, true]) {
    for (const override of [false, true]) {
        void test(`scaffold base push: missing base published=${published} override=${override}`, () => {
            withTempDir('scaffold-missing-', dir => {
                const fixture = setupFullSendTailFixture(dir, undefined, { fullSend: false, baseBranch: 'feat/x' });
                const tip = scaffoldGitOutput(fixture.localDir, 'rev-parse', 'feat/x').trim();
                if (published) gitIn(fixture.localDir, 'push', 'origin', 'feat/x:refs/heads/task/task-a');
                const result = runScaffoldFixture(fixture, dir, ['--pr', ...(override ? ['--allow-divergent-base'] : [])]);
                // Assert the remote first: the old path can open a fake PR without creating its base.
                assert.equal(remoteScaffoldTip(fixture, 'feat/x'), tip, combinedOutput(result));
                assert.equal(result.status, 0, combinedOutput(result));
                assert.match(scaffoldGhLog(dir), /^pr create .*--base feat\/x/m);
                if (published) assert.match(result.stdout, /Created origin\/feat\/x at/);
            });
        });
    }
}

void test('scaffold base push: a stale origin/main outside the fetch refspec cannot hide an operator commit', () => {
    withTempDir('scaffold-stale-present-', dir => {
        const fixture = setupFullSendTailFixture(dir, undefined, { fullSend: false });
        const scaffold = scaffoldGitOutput(fixture.localDir, 'rev-parse', 'main').trim();
        // Local main: origin's tip -> operator commit -> scaffold. origin/main claims the
        // operator commit, as if origin was reset behind it, and the fetch refspec skips main.
        gitIn(fixture.localDir, 'checkout', 'main');
        gitIn(fixture.localDir, 'reset', '--hard', fixture.originBaseSha);
        fs.writeFileSync(path.join(fixture.localDir, 'operator-source.txt'), 'operator\n');
        gitIn(fixture.localDir, 'add', 'operator-source.txt');
        gitIn(fixture.localDir, 'commit', '-m', 'operator commit');
        const operator = scaffoldGitOutput(fixture.localDir, 'rev-parse', 'HEAD').trim();
        gitIn(fixture.localDir, 'cherry-pick', scaffold);
        gitIn(fixture.localDir, 'checkout', `task/${fixture.taskId}`);
        gitIn(fixture.localDir, 'update-ref', 'refs/remotes/origin/main', operator);
        gitIn(fixture.localDir, 'config', 'remote.origin.fetch', '+refs/heads/other:refs/remotes/origin/other');
        const result = runScaffoldFixture(fixture, dir, ['--pr']);
        assert.equal(remoteScaffoldTip(fixture), fixture.originBaseSha, combinedOutput(result));
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Base divergence detected/);
        assert.doesNotMatch(scaffoldGhLog(dir), /^pr create /m);
    });
});

void test('scaffold base push: missing empty base rejects creation despite override', () => {
    withTempDir('scaffold-empty-rejected-', dir => {
        const fixture = setupFullSendTailFixture(dir, undefined, { fullSend: false, baseBranch: 'feat/x' });
        gitIn(fixture.localDir, 'push', 'origin', 'feat/x:refs/heads/task/task-a');
        rejectScaffoldBase(fixture, 'feat/x');
        const result = runScaffoldFixture(fixture, dir, ['--pr', '--allow-divergent-base']);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /may be protected/);
        assert.equal(remoteScaffoldTip(fixture, 'feat/x'), '');
        assert.doesNotMatch(scaffoldGhLog(dir), /^pr create /m);
    });
});

for (const [stale, narrowed] of [[false, false], [true, false], [true, true]] as const) {
    void test(`scaffold base push: missing unsafe base blocks even with override stale=${stale} narrowed=${narrowed}`, () => {
        withTempDir('scaffold-missing-unsafe-', dir => {
            const fixture = setupFullSendTailFixture(dir, repo => {
                fs.writeFileSync(path.join(repo, 'operator-source.txt'), 'operator\n');
                gitIn(repo, 'add', 'operator-source.txt');
                gitIn(repo, 'commit', '-m', 'operator commit');
            }, { fullSend: false, baseBranch: 'feat/x' });
            if (stale) gitIn(fixture.localDir, 'update-ref', 'refs/remotes/origin/wip', 'feat/x');
            // A single-branch fetch refspec leaves origin/wip outside what a plain --prune covers.
            if (narrowed) gitIn(fixture.localDir, 'config', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main');
            const shas = scaffoldGitOutput(fixture.localDir, 'log', 'main..feat/x', '--format=%h').trim().split('\n');
            for (const args of [['--pr'], ['--pr', '--allow-divergent-base']]) {
                const result = runScaffoldFixture(fixture, dir, args);
                assert.notEqual(result.status, 0);
                assert.match(result.stderr, /origin has no feat\/x branch/);
                assert.match(result.stderr, /\[canon-safe\]/);
                assert.match(result.stderr, /\[not canon-safe:/);
                assert.match(result.stderr, /push feat\/x yourself/);
                assert.match(result.stderr, /--allow-divergent-base does not apply/);
                for (const sha of shas) assert.ok(result.stderr.includes(sha));
                assert.equal(remoteScaffoldTip(fixture, 'feat/x'), '');
                assert.equal(remoteScaffoldTip(fixture, 'task/task-a'), '');
                assert.doesNotMatch(scaffoldGhLog(dir), /^pr create /m);
            }
        });
    });
}

for (const fullSend of [false, true]) {
    void test(`scaffold base push: fetch failure warns and skips fullSend=${fullSend}`, () => {
        withTempDir('scaffold-fetch-failed-', dir => {
            const fixture = setupFullSendTailFixture(dir, undefined, { fullSend });
            const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
            writeExecutable(fixture.fakeBins, 'git', [
                'if [ "$1" = fetch ]; then echo "fatal: Could not resolve host example.invalid" >&2; exit 128; fi',
                `exec "${realGit}" "$@"`,
            ]);
            const result = runScaffoldFixture(fixture, dir, fullSend ? ['--full-send', '--force'] : ['--pr']);
            assert.match(combinedOutput(result), /Could not fetch origin\/main.*Skipping base-divergence check/);
            assert.doesNotMatch(combinedOutput(result), /origin has no main branch/);
            assert.equal(remoteScaffoldTip(fixture), fixture.originBaseSha);
            assert.match(scaffoldGhLog(dir), /^pr create /m);
        });
    });
    void test(`scaffold base push: non-fast-forward names rebase fullSend=${fullSend}`, () => {
        withTempDir('scaffold-non-ff-', dir => {
            const fixture = setupFullSendTailFixture(dir, undefined, { fullSend });
            const other = path.join(dir, 'other');
            gitIn(dir, 'clone', '--branch', 'main', fixture.originDir, other);
            gitIn(other, 'config', 'user.email', 'test@example.com');
            gitIn(other, 'config', 'user.name', 'Test');
            fs.writeFileSync(path.join(other, 'remote.txt'), 'remote\n');
            gitIn(other, 'add', 'remote.txt');
            gitIn(other, 'commit', '-m', 'remote advance');
            gitIn(other, 'push', 'origin', 'main');
            const remoteTip = remoteScaffoldTip(fixture);
            const result = runScaffoldFixture(fixture, dir, fullSend ? ['--full-send', '--force'] : ['--pr']);
            assert.notEqual(result.status, 0);
            assert.match(combinedOutput(result), /git pull --rebase/);
            assert.doesNotMatch(combinedOutput(result), /protected/i);
            assert.equal(remoteScaffoldTip(fixture), remoteTip);
        });
    });
}

for (const override of [false, true]) {
    void test(`scaffold base push: protected present base override=${override}`, () => {
        withTempDir('scaffold-protected-', dir => {
            const fixture = setupFullSendTailFixture(dir, undefined, { fullSend: false });
            rejectScaffoldBase(fixture, 'main');
            const result = runScaffoldFixture(fixture, dir, ['--pr', ...(override ? ['--allow-divergent-base'] : [])]);
            if (override) {
                assert.equal(result.status, 0, combinedOutput(result));
                assert.match(result.stderr, /Scaffold commits were not pushed to origin\/main/);
                assert.match(result.stderr, /--allow-divergent-base override/);
                const sha = scaffoldGitOutput(fixture.localDir, 'rev-parse', '--short=7', 'main').trim();
                assert.ok(result.stderr.includes(sha));
                assert.match(scaffoldGhLog(dir), /^pr create /m);
            } else {
                assert.notEqual(result.status, 0);
                assert.match(result.stderr, /may be protected/);
                assert.doesNotMatch(combinedOutput(result), /Full-send/);
                assert.doesNotMatch(scaffoldGhLog(dir), /^pr create /m);
            }
            assert.equal(remoteScaffoldTip(fixture), fixture.originBaseSha);
        });
    });
}

for (const failure of ['prune', 'list', 'inspect', 'relist']) {
    void test(`scaffold base push: ${failure} probe failure stays guarded`, () => {
        withTempDir('scaffold-probe-failed-', dir => {
            const missing = failure === 'prune';
            const fixture = setupFullSendTailFixture(dir, undefined, { fullSend: false, ...(missing ? { baseBranch: 'feat/x' } : {}) });
            const tip = scaffoldGitOutput(fixture.localDir, 'rev-parse', missing ? 'feat/x' : 'main').trim();
            const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
            const conditions: Record<string, string> = {
                prune: '[ "$1" = fetch ] && [ "${2:-}" = --prune ]',
                list: '[ "$1" = log ] && [ "${2:-}" = origin/main..refs/heads/main ]',
                inspect: '[ "$1" = diff-tree ]',
                relist: `[ "$1" = log ] && [ "\${2:-}" = ${tip}..refs/heads/main ]`,
            };
            writeExecutable(fixture.fakeBins, 'git', [
                `if ${conditions[failure]}; then echo 'simulated ${failure} failure' >&2; exit 128; fi`,
                `exec "${realGit}" "$@"`,
            ]);
            const result = runScaffoldFixture(fixture, dir, ['--pr', '--allow-divergent-base']);
            if (failure === 'prune') {
                assert.match(result.stderr, /Could not fetch origin\/feat\/x.*simulated prune failure.*Skipping base-divergence check/);
                assert.equal(remoteScaffoldTip(fixture, 'feat/x'), '');
                assert.doesNotMatch(result.stdout, /Created origin|Pushed .*unpushed/);
            } else {
                assert.notEqual(result.status, 0);
                assert.match(result.stderr, new RegExp(`--pr aborted:.*(?:list|inspect).*main`));
                assert.match(result.stderr, new RegExp(`simulated ${failure} failure`));
                assert.equal(remoteScaffoldTip(fixture), failure === 'relist' ? tip : fixture.originBaseSha);
                if (failure === 'relist') assert.doesNotMatch(result.stderr, /Nothing was pushed/);
                assert.doesNotMatch(scaffoldGhLog(dir), /^pr create /m);
                assert.equal(remoteScaffoldTip(fixture, 'task/task-a'), '');
            }
        });
    });
}

void test('safe scaffold push classifier requires an exact subject, only allowed paths, and no merge parent', () => {
    const safe = (subject: string, paths: string[], parentCount = 1) =>
        classifySafeToPushCommitFromData({ subject, paths, parentCount });
    assert.deepEqual(safe('task(task-a): commit artifacts pre-pipeline', ['tasks/task-a/status.json']), { safe: true });
    assert.deepEqual(safe('chore: absorb pre-implement telemetry into scaffold for task-a, task-b', ['docs/lessons-learned.md']), { safe: true });
    assert.equal(safe('task(task-a): commit artifacts pre-pipeline suffix', ['tasks/task-a/status.json']).safe, false);
    assert.equal(safe('task(task-a): commit artifacts pre-pipeline', ['src/module.ts']).safe, false);
    assert.equal(safe('task(task-a): commit artifacts pre-pipeline', ['src/module.ts', 'tasks/task-a/module.ts']).safe, false);
    assert.equal(safe('task(task-a): commit artifacts pre-pipeline', ['tasks/task-a/status.json'], 2).safe, false);
    assert.equal(safe('task(task-a): commit artifacts pre-pipeline', ['tasks/task-a/status.json', 'src/module.ts']).safe, false);
});

void test('hasUnpushedScaffoldCommits probes safe, unsafe, and unavailable base history', () => {
    withTempDir('run-task-scaffold-probe-', dir => {
        const safeDir = path.join(dir, 'safe');
        fs.mkdirSync(safeDir, { recursive: true });
        const { localDir: safeRepo } = makeGitFixture(safeDir);
        assert.equal(hasUnpushedScaffoldCommits('main', safeRepo), false);

        fs.mkdirSync(path.join(safeRepo, 'tasks', 'task-a'), { recursive: true });
        fs.writeFileSync(path.join(safeRepo, 'tasks', 'task-a', 'status.json'), '{}\n', 'utf8');
        gitIn(safeRepo, 'add', 'tasks/task-a/status.json');
        gitIn(safeRepo, 'commit', '-m', 'task(task-a): commit artifacts pre-pipeline');
        assert.equal(hasUnpushedScaffoldCommits('main', safeRepo), true);

        const unsafeDir = path.join(dir, 'unsafe');
        fs.mkdirSync(unsafeDir, { recursive: true });
        const { localDir: unsafeRepo } = makeGitFixture(unsafeDir);
        fs.writeFileSync(path.join(unsafeRepo, 'operator-source.txt'), 'operator change\n', 'utf8');
        gitIn(unsafeRepo, 'add', 'operator-source.txt');
        gitIn(unsafeRepo, 'commit', '-m', 'operator source commit');
        assert.equal(hasUnpushedScaffoldCommits('main', unsafeRepo), false);

        assert.equal(hasUnpushedScaffoldCommits('missing-base', safeRepo), null);
    });
});

void test('scaffold hint is absent without safe commits and uses one wording for every mode', () => {
    assert.equal(scaffoldCommitHint('main', false), null);
    assert.equal(scaffoldCommitHint('main', true), scaffoldCommitHint('main', null));
    assert.match(scaffoldCommitHint('main', true) ?? '', /--pr, --push and full-send push it/);
    assert.doesNotMatch(scaffoldCommitHint('main', true) ?? '', /git push origin/);
});

void test('review-entry auto-commit retry is limited to dirty handoff files', () => {
    withTempDir('run-task-review-entry-retry-', dir => {
        const localDir = makeAutoCommitFixture(dir, { 'initial-fixture.txt': 'baseline\n' }, ['`initial-fixture.txt`']);
        const baseline = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: localDir, encoding: 'utf8' }).trim();
        fs.writeFileSync(path.join(localDir, 'tasks/task-a/review.md'), 'pipeline artifact\n');
        fs.mkdirSync(path.join(localDir, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'docs/pipeline-invocations.md'), 'telemetry\n');
        const cleanHandoff = runReviewEntryRetryInline('task-a', localDir);
        assert.equal(cleanHandoff.status, 0, cleanHandoff.stderr);
        assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: localDir, encoding: 'utf8' }).trim(), baseline);
        assert.doesNotMatch(cleanHandoff.stdout, /Retrying the implement auto-commit/);

        fs.writeFileSync(path.join(localDir, 'initial-fixture.txt'), 'handoff source dirty\n');
        const retried = runReviewEntryRetryInline('task-a', localDir);
        assert.equal(retried.status, 0, retried.stderr);
        assert.match(retried.stdout, /Retrying the implement auto-commit/);
        assert.notEqual(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: localDir, encoding: 'utf8' }).trim(), baseline);
    });
});

void test('review-entry retry skips a current operator accept but retries after HEAD advances', () => {
    withTempDir('run-task-review-entry-accepted-', dir => {
        const localDir = makeAutoCommitFixture(dir, { 'initial-fixture.txt': 'baseline\n' }, ['`initial-fixture.txt`']);
        const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: localDir, encoding: 'utf8' }).trim();
        const statusPath = path.join(localDir, 'tasks/task-a/status.json');
        const accepted = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as Record<string, unknown>;
        const phases = accepted.phases as Record<string, Record<string, unknown>>;
        phases.implement.operator_accepted = true;
        phases.implement.operator_accepted_sha = sha;
        fs.writeFileSync(statusPath, `${JSON.stringify(accepted, null, 2)}\n`);
        fs.writeFileSync(path.join(localDir, 'initial-fixture.txt'), 'dirty after accept\n');
        const skipped = runReviewEntryRetryInline('task-a', localDir);
        assert.equal(skipped.status, 0, skipped.stderr);
        assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: localDir, encoding: 'utf8' }).trim(), sha);
        assert.match(execFileSync('git', ['status', '--porcelain'], { cwd: localDir, encoding: 'utf8' }), /initial-fixture\.txt/);
        assert.doesNotMatch(skipped.stdout, /Retrying the implement auto-commit/);

        fs.writeFileSync(path.join(localDir, 'unrelated.txt'), 'advance HEAD\n');
        gitIn(localDir, 'add', 'unrelated.txt');
        gitIn(localDir, 'commit', '-m', 'advance accepted HEAD');
        const retried = runReviewEntryRetryInline('task-a', localDir);
        assert.equal(retried.status, 0, retried.stderr);
        assert.match(retried.stdout, /Retrying the implement auto-commit/);
        assert.doesNotMatch(execFileSync('git', ['status', '--porcelain'], { cwd: localDir, encoding: 'utf8' }), /initial-fixture\.txt/);
    });
});

void test('review-entry retry commit failure exits before any review preflight', () => {
    withTempDir('run-task-review-entry-failure-', dir => {
        const localDir = makeAutoCommitFixture(dir, { 'initial-fixture.txt': 'baseline\n' }, ['`initial-fixture.txt`']);
        fs.writeFileSync(path.join(localDir, 'initial-fixture.txt'), 'dirty\n');
        fs.writeFileSync(path.join(localDir, 'tasks/task-a/review.md'), '# Code Review\n');
        const hook = path.join(localDir, '.git/hooks/pre-commit');
        fs.mkdirSync(path.dirname(hook), { recursive: true });
        fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
        const result = runReviewEntryRetryInline('task-a', localDir);
        assert.equal(result.status, 1);
        assert.match(`${result.stdout}\n${result.stderr}`, /Auto-commit failed:/);
        assert.doesNotMatch(fs.readFileSync(path.join(localDir, 'tasks/task-a/review.md'), 'utf8'), /handoff→diff/);
        const status = JSON.parse(fs.readFileSync(path.join(localDir, 'tasks/task-a/status.json'), 'utf8')) as { phases: { code_review: { preflight_rejections_current_loop?: number; iterations_current_loop?: number } } };
        assert.equal(status.phases.code_review.preflight_rejections_current_loop ?? 0, 0);
        assert.equal(status.phases.code_review.iterations_current_loop ?? 0, 0);
    });
});

void test('main retries before code_review preflight in a task worktree', { concurrency: false }, () => {
    withTempDir('run-task-review-entry-main-', dir => {
        const taskId = 'review-entry-main';
        const fixture = prepareReviewEntryMainFixture(dir, taskId, false, true);
        const { localDir, worktreeDir, tasksRoot, statusPath } = fixture;
        const result = runReviewEntryMainFixture(fixture, taskId);
        assert.equal(result.status, 0, combinedOutput(result));
        const updated = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as {
            phases: { code_review: { preflight_rejections_current_loop?: number } };
        };
        assert.equal(updated.phases.code_review.preflight_rejections_current_loop, 0, combinedOutput(result));
        assert.doesNotMatch(fs.readFileSync(path.join(tasksRoot, taskId, 'review.md'), 'utf8'), /handoff→diff/);
        assert.match(result.stdout, /Retrying the implement auto-commit/);
        assert.ok(execFileSync('git', ['log', '--format=%H', 'main..HEAD', '--', 'initial-fixture.txt'], {
            cwd: worktreeDir, encoding: 'utf8',
        }).trim());
        assert.deepEqual(readAgentInvocations(path.join(localDir, 'agent-invocations.log')), ['claude']);
    });
});

void test('review-entry docs-refs fix-up resumes the stored implement session in the task worktree', { concurrency: false }, () => {
    withTempDir('artifact-fixup-review-entry-', dir => {
        const taskId = 'artifact-fixup-review-entry';
        const fixture = prepareReviewEntryMainFixture(dir, taskId, false, true);
        installDocsRefsChecker(fixture.localDir, { hook: true });
        const handoff = path.join(fixture.worktreeDir, 'tasks', taskId, 'handoff.md');
        fs.appendFileSync(handoff, '\nSee `src/removed-by-task.ts` for details.\n');
        const taskStatus = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as { sessions?: Record<string, string> };
        taskStatus.sessions = { ...(taskStatus.sessions ?? {}), implementer: 'stored-implement-session', codex: 'stale-legacy-implement' };
        fs.writeFileSync(fixture.statusPath, `${JSON.stringify(taskStatus, null, 2)}\n`);
        const editScript = path.join(dir, 'fix-artifact.mjs');
        fs.writeFileSync(editScript, [
            "import fs from 'node:fs';",
            `const file = ${JSON.stringify(handoff)};`,
            "fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('`src/removed-by-task.ts`', '[src/removed-by-task.ts](src/removed-by-task.ts)'));",
        ].join('\n'));
        fs.writeFileSync(path.join(fixture.fakeBins, 'codex'), [
            '#!/bin/sh',
            'if [ "${1:-}" = "--version" ]; then printf "%s\\n" "fake-agent 1.0"; exit 0; fi',
            'printf "%s\\n" "codex" >> "$FAKE_AGENT_LOG"',
            'node -e \'require("fs").appendFileSync(process.env.FAKE_AGENT_ARGV_LOG, JSON.stringify({agent:"codex",argv:process.argv.slice(1),cwd:process.cwd()})+"\\n")\' "$@"',
            'is_resume=0; for arg in "$@"; do if [ "$arg" = "resume" ]; then is_resume=1; fi; done',
            'if [ "$is_resume" = "1" ]; then node "$FAKE_AGENT_EDIT_SCRIPT"; exit 0; fi',
            'node -e \'console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"clean review"}})); console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:1,output_tokens:1}}))\'',
        ].join('\n'), { mode: 0o755 });
        const check = runDocsRefsCheck(fixture.worktreeDir, fs.realpathSync(path.join(fixture.localDir, 'scripts/docs-refs-check.mjs')));
        assert.equal(check.kind, 'findings');
        const findings = check.kind === 'findings' ? filterArtifactFindings(check.findings, [`tasks/${taskId}/handoff.md`]).map(f => f.raw) : [];
        assert.equal(findings.length, 1);
        const expectedPrompt = promptArtifactFixup({ phase: 'implement', findings, artifacts: [`tasks/${taskId}/handoff.md`], attempt: 1, maxAttempts: 2 });
        const beforeStatus = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
        const cfg = getCodexConfig('implement', [parityTask(beforeStatus)]);
        const argvLog = path.join(dir, 'agent-argv.jsonl');
        const result = runReviewEntryMainFixture(fixture, taskId, { FAKE_AGENT_ARGV_LOG: argvLog, FAKE_AGENT_EDIT_SCRIPT: editScript });
        assert.equal(result.status, 0, combinedOutput(result));
        assert.match(result.stdout, /Artifact fix-up \(attempt 1\/2\)/);
        assert.match(fs.readFileSync(handoff, 'utf8'), /\[src\/removed-by-task\.ts\]\(src\/removed-by-task\.ts\)/);
        const entries = fs.readFileSync(argvLog, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { agent: string; argv: string[]; cwd: string });
        assert.equal(entries.filter(entry => entry.agent === 'codex' && entry.argv.includes('resume') && entry.argv.includes('stored-implement-session')).length, 1);
        const fixup = entries.find(entry => entry.agent === 'codex' && entry.argv.includes('stored-implement-session'));
        assert.deepEqual(fixup, { agent: 'codex', cwd: fs.realpathSync(fixture.worktreeDir), argv: [
            'exec', 'resume', 'stored-implement-session', '--json', '-c', `model_reasoning_effort=${cfg.effort}`,
            `${CODEX_HEADLESS}\n\n${expectedPrompt}`, '-m', cfg.model,
        ] });
    });
});

void test('review-entry docs-refs fix-up contains a non-zero Codex resume and continues', { concurrency: false }, () => {
    withTempDir('artifact-fixup-review-entry-failed-', dir => {
        const taskId = 'artifact-fixup-review-entry-failed';
        const fixture = prepareReviewEntryMainFixture(dir, taskId, false, true);
        installDocsRefsChecker(fixture.localDir, { hook: false });
        const handoff = path.join(fixture.worktreeDir, 'tasks', taskId, 'handoff.md');
        fs.appendFileSync(handoff, '\nSee `src/removed-by-task.ts` for details.\n');
        const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as { sessions?: Record<string, string> };
        status.sessions = { ...(status.sessions ?? {}), codex: 'stored-implement-session' };
        fs.writeFileSync(fixture.statusPath, `${JSON.stringify(status, null, 2)}\n`);
        fs.writeFileSync(path.join(fixture.fakeBins, 'codex'), [
            '#!/bin/sh',
            'if [ "${1:-}" = "--version" ]; then printf "%s\\n" "fake-agent 1.0"; exit 0; fi',
            'printf "%s\\n" "codex" >> "$FAKE_AGENT_LOG"',
            'node -e \'require("fs").appendFileSync(process.env.FAKE_AGENT_ARGV_LOG, JSON.stringify(process.argv.slice(1))+"\\n")\' -- "$@"',
            'fail_resume=0; for arg in "$@"; do if [ "$arg" = "stored-implement-session" ]; then fail_resume=1; fi; done',
            'if [ "$fail_resume" = "1" ]; then exit 7; fi',
            'node -e \'console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"clean review"}})); console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:1,output_tokens:1}}))\'',
            'exit 0',
        ].join('\n'), { mode: 0o755 });
        const argvLog = path.join(dir, 'argv.jsonl');
        const result = runReviewEntryMainFixture(fixture, taskId, { FAKE_AGENT_ARGV_LOG: argvLog });
        const output = combinedOutput(result);
        assert.equal(result.status, 0, output);
        assert.match(output, /Artifact fix-up failed/);
        assert.match(output, /Retrying the implement auto-commit/);
        assert.equal(countResumes(argvLog), 1);
        assert.ok(execFileSync('git', ['log', '--format=%H', 'main..HEAD', '--', 'initial-fixture.txt'], { cwd: fixture.worktreeDir, encoding: 'utf8' }).trim());
    });
});

void test('QA docs-refs fix-up resumes its in-process Claude session before committing done.md', { concurrency: false }, () => {
    withTempDir('artifact-fixup-qa-', dir => {
        const { localDir } = makeGitFixture(dir);
        const taskId = 'artifact-fixup-qa';
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
        const editScript = path.join(dir, 'qa-artifact-edit.mjs');
        const donePath = path.join(tasksRoot, taskId, 'done.md');
        fs.writeFileSync(editScript, [
            "import fs from 'node:fs';",
            `const file = ${JSON.stringify(donePath)};`,
            "const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';",
            "if (process.argv.includes('--resume')) fs.writeFileSync(file, content.replace('`src/removed-by-task.ts`', '[src/removed-by-task.ts](src/removed-by-task.ts)'));",
            `else fs.writeFileSync(file, ${JSON.stringify('# Completed\n\nSee `src/removed-by-task.ts` for details.\n')});`,
        ].join('\n'));
        fs.writeFileSync(donePath, '# Completed\n\nSee `src/removed-by-task.ts` for details.\n');
        const check = runDocsRefsCheck(localDir, fs.realpathSync(path.join(localDir, 'scripts/docs-refs-check.mjs')));
        assert.equal(check.kind, 'findings');
        const findings = check.kind === 'findings' ? filterArtifactFindings(check.findings, [`tasks/${taskId}/done.md`]).map(f => f.raw) : [];
        assert.equal(findings.length, 1);
        const expectedPrompt = promptArtifactFixup({ phase: 'qa', findings, artifacts: [`tasks/${taskId}/done.md`, `tasks/${taskId}/pr-body.md`], attempt: 1, maxAttempts: 2 });
        const cfg = getClaudeConfig('qa', [parityTask(JSON.parse(fs.readFileSync(statusPath, 'utf8')) as StatusJson)]);
        const argvLog = path.join(dir, 'qa-agent-argv.jsonl');
        const agentLog = path.join(dir, 'qa-agent-invocations.log');
        const result = runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, 3, ['--expect', 'qa'], {
            FAKE_AGENT_COMPLETE_PHASE: 'qa',
            FAKE_CLAUDE_SESSION_ID: 'qa-session-for-fixup',
            FAKE_AGENT_EDIT_SCRIPT: editScript,
            FAKE_AGENT_SKIP_COMPLETE_ON_RESUME: '1',
            FAKE_AGENT_ARGV_LOG: argvLog,
            FAKE_AGENT_LOG: agentLog,
        });
        assert.equal(result.status, 0, combinedOutput(result));
        assert.match(result.stdout, /Artifact fix-up \(attempt 1\/2\)/);
        assert.match(result.stdout, /QA artifacts/);
        const committed = execFileSync('git', ['show', `HEAD:tasks/${taskId}/done.md`], { cwd: localDir, encoding: 'utf8' });
        assert.match(committed, /\[src\/removed-by-task\.ts\]\(src\/removed-by-task\.ts\)/);
        assert.doesNotMatch(committed, /`src\/removed-by-task\.ts`/);
        const entries = fs.readFileSync(argvLog, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { agent: string; argv: string[]; cwd: string });
        assert.equal(entries.filter(entry => entry.agent === 'claude' && entry.argv.includes('--resume') && entry.argv.includes('qa-session-for-fixup')).length, 1);

        const fixup = entries.find(entry => entry.agent === 'claude' && entry.argv.includes('--resume'));
        assert.deepEqual(fixup, { agent: 'claude', cwd: fs.realpathSync(localDir), argv: [
            '-p', `${CLAUDE_HEADLESS}\n\n${toResumePrompt(expectedPrompt)}`, '--model', cfg.model, '--effort', cfg.effort,
            '--add-dir', fs.realpathSync(localDir), '--max-budget-usd', cfg.budget,
            '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose', '--resume', 'qa-session-for-fixup',
        ] });
    });
});

void test('code-review docs-refs fix-up resumes the reviewer and routes changes_requested to implement', { concurrency: false }, () => {
    withTempDir('artifact-fixup-code-review-', dir => {
        const taskId = 'artifact-fixup-code-review';
        const { fixture, driver } = prepareArtifactReviewRun(dir, taskId);
        const result = runArtifactReviewFixture(fixture, taskId, driver);
        const output = combinedOutput(result);
        assert.equal(result.status, 0, output);
        assert.match(result.stdout, /Artifact fix-up \(attempt 1\/2\)/);
        assert.match(result.stdout, /Step mode: stopping after one phase/);
        assert.match(fs.readFileSync(path.join(fixture.tasksRoot, taskId, 'review.md'), 'utf8'), /\[src\/removed-by-task\.ts\]\(src\/removed-by-task\.ts\)/);
        const invocations = fs.readFileSync(path.join(dir, 'artifact-review-agent.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { args: string[]; resumed: boolean });
        assert.equal(invocations.filter(entry => entry.resumed && entry.args.includes('reviewer-fixup-session')).length, 1);
        const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
        assert.equal(status.phases.code_review?.status, 'pending');
        assert.match(result.stdout, /Next phase: implement/);
    });
});

for (const fixMode of ['flip', 'flip-fail'] as const) {
    void test(`code-review fix-up verdict guard auto-blocks after ${fixMode}`, { concurrency: false }, () => {
        withTempDir(`artifact-review-verdict-${fixMode}-`, dir => {
            const taskId = `artifact-review-verdict-${fixMode}`;
            const { fixture, driver } = prepareArtifactReviewRun(dir, taskId);
            const result = runArtifactReviewFixture(fixture, taskId, driver, { FAKE_REVIEW_FIX_MODE: fixMode });
            const output = combinedOutput(result);
            assert.equal(result.status, 2, output);
            const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
            assert.equal(status.phases.code_review?.status, 'blocked');
            const reason = status.escalations?.at(-1)?.reason ?? '';
            assert.match(reason, new RegExp(taskId));
            assert.match(reason, /checked verdict 'approved'/);
            assert.match(reason, /recorded verdict 'changes_requested'/);
            assert.match(reason, new RegExp(`canon task reset-code-review ${taskId}`));
            assert.match(reason, new RegExp(`canon run ${taskId}`));
            assert.doesNotMatch(output, /Next phase:/);
        });
    });
}

void test('code-review fix-up auto-blocks when the reviewer edits outside review.md', { concurrency: false }, () => {
    withTempDir('artifact-review-scope-', dir => {
        const taskId = 'artifact-review-scope';
        const { fixture, driver } = prepareArtifactReviewRun(dir, taskId);
        const result = runArtifactReviewFixture(fixture, taskId, driver, { FAKE_REVIEW_FIX_MODE: 'outside' });
        const output = combinedOutput(result);
        assert.equal(result.status, 2, output);
        const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
        assert.equal(status.phases.code_review?.status, 'blocked');
        assert.match(status.escalations?.at(-1)?.reason ?? '', /outside-fixup\.txt/);
        assert.doesNotMatch(output, /Next phase:/);
    });
});

void test('code-review fix-up without a reviewer session warns with findings and continues', { concurrency: false }, () => {
    withTempDir('artifact-review-no-session-', dir => {
        const taskId = 'artifact-review-no-session';
        const { fixture, driver } = prepareArtifactReviewRun(dir, taskId);
        const result = runArtifactReviewFixture(fixture, taskId, driver, { FAKE_REVIEW_NO_SESSION: '1' });
        const output = combinedOutput(result);
        assert.equal(result.status, 0, output);
        assert.match(output, /no claude session is available to fix them/i);
        assert.match(output, /src\/removed-by-task\.ts/);
        assert.match(output, /fix them before --pr/i);
        assert.doesNotMatch(output, /Artifact fix-up \(attempt/);
        assert.match(output, /Next phase: implement/);
    });
});

void test('spec_gap review gets its artifact fix-up before the stop', { concurrency: false }, () => {
    withTempDir('artifact-review-spec-gap-', dir => {
        const taskId = 'artifact-review-spec-gap';
        const { fixture, driver } = prepareArtifactReviewRun(dir, taskId);
        const result = runArtifactReviewFixture(fixture, taskId, driver, { FAKE_REVIEW_VERDICT: 'spec_gap' });
        const output = combinedOutput(result);
        assert.equal(result.status, 2, output);
        assert.match(output, /Artifact fix-up \(attempt 1\/2\)/);
        assert.match(output, /SPEC GAP/);
        assert.doesNotMatch(fs.readFileSync(path.join(fixture.tasksRoot, taskId, 'review.md'), 'utf8'), /`src\/removed-by-task\.ts`/);
    });
});

void test('reviewer-blocked review stops without running artifact fix-up', { concurrency: false }, () => {
    withTempDir('artifact-review-blocked-', dir => {
        const taskId = 'artifact-review-blocked';
        const { fixture, driver } = prepareArtifactReviewRun(dir, taskId);
        const result = runArtifactReviewFixture(fixture, taskId, driver, { FAKE_REVIEW_BLOCKED: '1' });
        const output = combinedOutput(result);
        assert.equal(result.status, 2, output);
        assert.match(output, /CODE REVIEW STOPPED/);
        assert.doesNotMatch(output, /Artifact fix-up/);
        const invocations = fs.readFileSync(path.join(dir, 'artifact-review-agent.jsonl'), 'utf8').trim().split('\n');
        assert.equal(invocations.length, 1);
        assert.equal((JSON.parse(invocations[0]) as { resumed: boolean }).resumed, false);
        assert.equal((JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson).phases.code_review?.status, 'blocked');
    });
});

void test('review recovery fix-up runs only after the one-shot reviewer recovery', { concurrency: false }, () => {
    withTempDir('artifact-review-recovery-', dir => {
        const taskId = 'artifact-review-recovery';
        const { fixture, driver } = prepareArtifactReviewRun(dir, taskId);
        fs.writeFileSync(path.join(fixture.tasksRoot, taskId, 'review.md'), '# Code Review\n');
        const result = runArtifactReviewFixture(fixture, taskId, driver, { FAKE_REVIEW_RECOVERY: '1' });
        const output = combinedOutput(result);
        assert.equal(result.status, 0, output);
        assert.equal((output.match(/Artifact fix-up \(attempt 1\/2\)/g) ?? []).length, 1);
        assert.match(output, /Retrying claude session/);
        assert.match(output, /Next phase: implement/);
        assert.doesNotMatch(fs.readFileSync(path.join(fixture.tasksRoot, taskId, 'review.md'), 'utf8'), /`src\/removed-by-task\.ts`/);
        const invocations = fs.readFileSync(path.join(dir, 'artifact-review-agent.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { args: string[]; resumed: boolean });
        assert.equal(invocations.length, 3);
        assert.equal(invocations.filter(entry => entry.resumed && entry.args.includes('reviewer-fixup-session')).length, 2);
    });
});

void test('verdict change in review recovery fix-up auto-blocks code_review', { concurrency: false }, () => {
    withTempDir('artifact-review-recovery-guard-', dir => {
        const taskId = 'artifact-review-recovery-guard';
        const { fixture, driver } = prepareArtifactReviewRun(dir, taskId);
        fs.writeFileSync(path.join(fixture.tasksRoot, taskId, 'review.md'), '# Code Review\n');
        const result = runArtifactReviewFixture(fixture, taskId, driver, { FAKE_REVIEW_RECOVERY: '1', FAKE_REVIEW_FIX_MODE: 'flip' });
        const output = combinedOutput(result);
        assert.equal(result.status, 2, output);
        assert.match(output, /Artifact fix-up verdict guard failed/);
        const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
        assert.equal(status.phases.code_review?.status, 'blocked');
        assert.match(status.escalations?.at(-1)?.reason ?? '', /checked verdict 'approved'.*recorded verdict 'changes_requested'/s);
        assert.doesNotMatch(output, /Next phase:/);
    });
});

void test('main enters code_review without retry when the handoff is clean and pipeline artifacts are dirty', { concurrency: false }, () => {
    withTempDir('run-task-review-entry-clean-', dir => {
        const taskId = 'review-entry-clean';
        const fixture = prepareReviewEntryMainFixture(dir, taskId, true, false);
        fs.writeFileSync(path.join(fixture.tasksRoot, taskId, 'review.md'), '# Code Review\n');
        fs.mkdirSync(path.join(fixture.worktreeDir, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(fixture.worktreeDir, 'docs/pipeline-invocations.md'), 'telemetry\n');
        const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture.worktreeDir, encoding: 'utf8' }).trim();
        const result = runReviewEntryMainFixture(fixture, taskId);
        assert.equal(result.status, 0, combinedOutput(result));
        assert.doesNotMatch(result.stdout, /Retrying the implement auto-commit/);
        assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture.worktreeDir, encoding: 'utf8' }).trim(), before);
        assert.deepEqual(readAgentInvocations(path.join(fixture.localDir, 'agent-invocations.log')), ['claude']);
    });
});

void test('main stops before code_review preflight when the review-entry retry commit fails', { concurrency: false }, () => {
    withTempDir('run-task-review-entry-main-failure-', dir => {
        const taskId = 'review-entry-main-failure';
        const fixture = prepareReviewEntryMainFixture(dir, taskId, false, true);
        const hook = path.join(fixture.localDir, '.git/hooks/pre-commit');
        fs.mkdirSync(path.dirname(hook), { recursive: true });
        fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
        const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture.worktreeDir, encoding: 'utf8' }).trim();
        const result = runReviewEntryMainFixture(fixture, taskId);
        assert.equal(result.status, 1);
        assert.match(combinedOutput(result), /Auto-commit failed:/);
        assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture.worktreeDir, encoding: 'utf8' }).trim(), before);
        assert.doesNotMatch(fs.readFileSync(path.join(fixture.tasksRoot, taskId, 'review.md'), 'utf8'), /handoff→diff/);
        const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as {
            phases: { code_review: { preflight_rejections_current_loop?: number; iterations_current_loop?: number } };
        };
        assert.equal(status.phases.code_review.preflight_rejections_current_loop, 0);
        assert.equal(status.phases.code_review.iterations_current_loop, 0);
        assert.deepEqual(readAgentInvocations(path.join(fixture.localDir, 'agent-invocations.log')), []);
    });
});

void test('autoCommitCode commits an already-staged deletion instead of failing the bulk add', () => {
    withTempDir('run-task-autocommit-staged-deletion-', dir => {
        const localDir = makeAutoCommitFixture(dir, { 'dead.ts': 'export const dead = true;\n' }, ['`dead.ts`']);
        const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: localDir, encoding: 'utf8' }).trim();
        gitIn(localDir, 'rm', 'dead.ts');

        const result = runAutoCommitCodeInline('task-a', localDir);
        assert.equal(result.status, 0, result.stderr);
        assert.notEqual(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: localDir, encoding: 'utf8' }).trim(), before);
        assert.deepEqual(latestNameStatuses(localDir), new Set(['D\tdead.ts']));
        assert.equal(execFileSync('git', ['status', '--porcelain=v1', '-uall'], { cwd: localDir, encoding: 'utf8' }), '');
    });
});

void test('autoCommitCode commits the generator and skips a gitignored artifact listed beside it', () => {
    withTempDir('run-task-autocommit-ignored-artifact-', dir => {
        const localDir = makeAutoCommitFixture(dir, { 'gen.ts': 'export const v = 1;\n' }, ['`gen.ts`', '`gen.out`']);
        commitIgnoreRules(localDir, 'gen.out\n');
        fs.writeFileSync(path.join(localDir, 'gen.ts'), 'export const v = 2;\n', 'utf8');
        fs.writeFileSync(path.join(localDir, 'gen.out'), 'generated\n', 'utf8');

        const result = runAutoCommitCodeInline('task-a', localDir);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(latestNameStatuses(localDir), new Set(['M\tgen.ts']));
        assert.equal(execFileSync('git', ['status', '--porcelain=v1', '-uall'], { cwd: localDir, encoding: 'utf8' }), '');
    });
});
