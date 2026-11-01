import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { StatusJson } from '../src/orchestrator/types.js';
import {
    WORKTREE_ROOT,
    withTempDir,
    writeTaskStatus,
    writeExecutable,
    setupInvocationLoggingCliTools,
    installDocsRefsChecker,
    readAgentInvocations,
    makeReviewLoopStatus,
    writeReviewLoopFixture,
    runReviewLoopMain,
    runNodeInline,
    makeGitFixture,
    combinedOutput,
    prepareReviewEntryMainFixture,
} from './run-task-safety-helpers.js';


for (const text of ['No summary heading in the normalized text.', '', '# QA Summary\n\nPrefer normalized text.\n']) {
    const hasSummary = text.startsWith('# QA Summary');
    void test(`QA salvage output selection: ${hasSummary ? 'text wins' : text ? 'stdout fallback' : 'empty text fallback'}`, () => {
        withTempDir('role-qa-fallback-', dir => {
            const { localDir } = makeGitFixture(dir);
            const taskId = 'qa-fallback';
            const tasksRoot = writeReviewLoopFixture(localDir, taskId, 'code_review', 0, 0, true);
            const status = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as StatusJson;
            status.phases.code_review!.status = 'done';
            writeTaskStatus(tasksRoot, taskId, status);
            const bins = path.join(dir, 'bins');
            fs.mkdirSync(bins);
            const stdoutSummary = '# QA Summary\n\nRecover the raw stdout summary.\n';
            const transcript = JSON.stringify({ type: 'result', result: text, session_id: 'qa-fallback-session' }) + '\n' + stdoutSummary;
            writeExecutable(bins, 'claude', [`printf '%s' '${transcript}'`]);
            const result = runNodeInline([
                `import { buildPipelineState } from ${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href)};`,
                `import { runQaPhase } from ${JSON.stringify(pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/phases/qa.ts')).href)};`,
                `await runQaPhase(buildPipelineState(['${taskId}']), false, null);`,
            ].join('\n'), { ...process.env, PATH: `${bins}${path.delimiter}${process.env.PATH ?? ''}`, CANON_TASKS_DIR_OVERRIDE: tasksRoot }, localDir);
            assert.equal(result.status, 0, combinedOutput(result));
            const donePath = path.join(tasksRoot, taskId, 'done.md');
            assert.equal(fs.existsSync(donePath), true, 'QA must salvage a summary from one of the two output sources');
            assert.equal(fs.readFileSync(donePath, 'utf8').trim(), (hasSummary ? text : transcript).trim());
            const after = JSON.parse(fs.readFileSync(path.join(tasksRoot, taskId, 'status.json'), 'utf8')) as StatusJson;
            assert.equal(after.phases.qa?.status, 'done');
        });
    });
}

for (const phase of ['spec_review', 'implement'] as const) for (const hasSession of [true, false]) {
    void test(`Claude provider ${phase} park/resume (session=${hasSession})`, () => {
        withTempDir('provider-park-', dir => {
            const taskId = 'provider-park';
            const fixture = prepareReviewEntryMainFixture(dir, taskId, true, false);
            const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
            status.provider = 'claude';
            status.phases[phase]!.status = 'pending';
            writeTaskStatus(fixture.tasksRoot, taskId, status);
            const argvLog = path.join(dir, 'argv.jsonl');
            writeExecutable(fixture.fakeBins, 'claude', [
                'if [ "${1:-}" = "--version" ]; then echo "fake-agent 1.0"; exit 0; fi',
                'node -e \'require("fs").appendFileSync(process.env.FAKE_AGENT_ARGV_LOG,JSON.stringify(process.argv.slice(1))+"\\n")\' -- "$@"',
                ...(hasSession ? ['printf \'{"type":"result","session_id":"park-session","result":"partial"}\\n\''] : []),
                'exit 1',
            ]);
            const extraEnv = { FAKE_AGENT_ARGV_LOG: argvLog };
            const first = runReviewLoopMain(fixture.localDir, fixture.tasksRoot, fixture.fakeBins, taskId, 3, [], extraEnv);
            assert.equal(first.status, 2, combinedOutput(first));
            const parked = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
            const slot = phase === 'implement' ? 'implementer' : 'spec_reviewer';
            assert.equal(parked.phases[phase]?.status, 'blocked');
            assert.equal(parked.sessions?.[slot], hasSession ? 'park-session' : undefined);
            assert.equal(parked.session_backends?.[slot], hasSession ? 'claude' : undefined);
            setupInvocationLoggingCliTools(fixture.fakeBins);
            const second = runReviewLoopMain(fixture.localDir, fixture.tasksRoot, fixture.fakeBins, taskId, 3, [], {
                ...extraEnv, FAKE_AGENT_COMPLETE_PHASE: phase, FAKE_CLAUDE_SESSION_ID: 'completed-session',
            });
            assert.equal(second.status, 0, combinedOutput(second));
            const entries = fs.readFileSync(argvLog, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { argv: string[] } | string[]);
            const last = entries.at(-1) as { argv: string[] };
            assert.equal(last.argv.includes('--resume'), hasSession);
            if (hasSession) assert.equal(last.argv[last.argv.indexOf('--resume') + 1], 'park-session');
            const prompt = last.argv[1];
            assert.match(prompt, /Always end by writing the phase artifact and running the phase command\(s\).*including when you recorded Blockers/);
            if (phase === 'implement' && hasSession) {
                assert.match(prompt, /previous session stopped before finishing.*claude session exited 1/);
                assert.match(prompt, /[Ww]ork may be partial/);
                assert.doesNotMatch(prompt, /already complete/);
                assert.match(prompt, /Mode: \*\*park resume\*\*/);
                assert.doesNotMatch(prompt, /first implementation pass — no prior work/);
            }
            if (!hasSession && phase === 'implement') {
                assert.match(prompt, /Mode: \*\*fresh\*\* — first implementation pass/);
                assert.doesNotMatch(prompt, /previous session stopped before finishing/);
            }
            if (phase === 'spec_review') assert.doesNotMatch(prompt, /has been revised since your last review/);
            const done = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
            assert.equal(done.phases[phase]?.agent, 'claude');
            assert.equal(done.session_backends?.[slot], 'claude');
            if (phase === 'implement') assert.match(second.stdout, /Phase: implement \(Claude/);
        });
    });
}

void test('provider validation refuses invalid pins and mixed bundles before task mutation or agent spawn', () => {
    withTempDir('provider-validation-', dir => {
        const { localDir } = makeGitFixture(dir);
        const tasksRoot = writeReviewLoopFixture(localDir, 'a', 'spec_review', 0, 0, true);
        writeReviewLoopFixture(localDir, 'b', 'spec_review', 0, 0, true);
        const bins = path.join(dir, 'bin'); fs.mkdirSync(bins); setupInvocationLoggingCliTools(bins);
        for (const provider of ['codex', 'Claude', 'claude']) {
            const statusFile = path.join(tasksRoot, 'a', 'status.json');
            const status = JSON.parse(fs.readFileSync(statusFile, 'utf8')) as Record<string, unknown>;
            status.provider = provider; fs.writeFileSync(statusFile, JSON.stringify(status));
            const before = ['a', 'b'].map(id => fs.readFileSync(path.join(tasksRoot, id, 'status.json'), 'utf8'));
            const result = runReviewLoopMain(localDir, tasksRoot, bins, 'a', 3, provider === 'claude' ? ['b'] : []);
            assert.equal(result.status, 1, combinedOutput(result));
            assert.match(combinedOutput(result), provider === 'claude' ? /a: claude, b: mixed/ : /Accepted values: mixed, claude/);
            assert.doesNotMatch(result.stderr, /at .*\.ts:/);
            assert.deepEqual(['a', 'b'].map(id => fs.readFileSync(path.join(tasksRoot, id, 'status.json'), 'utf8')), before);
            assert.equal(fs.existsSync(path.join(localDir, 'agent-invocations.log')), false);
        }
    });
});

for (const extraArgs of [['--dry-run'], ['--ship', '--dry-run']] as const) {
    void test(`${extraArgs.join(' ')} refuses an invalid provider pin cleanly without archiving`, () => {
        withTempDir('provider-dry-run-pin-', dir => {
            const { localDir } = makeGitFixture(dir);
            const tasksRoot = writeReviewLoopFixture(localDir, 'a', 'spec_review', 0, 0, true);
            const bins = path.join(dir, 'bin'); fs.mkdirSync(bins); setupInvocationLoggingCliTools(bins);
            const statusFile = path.join(tasksRoot, 'a', 'status.json');
            const status = JSON.parse(fs.readFileSync(statusFile, 'utf8')) as Record<string, unknown>;
            status.provider = 'bogus'; fs.writeFileSync(statusFile, JSON.stringify(status));
            const result = runReviewLoopMain(localDir, tasksRoot, bins, 'a', 3, extraArgs, {}, false);
            assert.equal(result.status, 1, combinedOutput(result));
            assert.match(combinedOutput(result), /Invalid provider/);
            assert.doesNotMatch(combinedOutput(result), /^\s+at /m);
            assert.equal(fs.existsSync(statusFile), true);
            assert.equal(fs.existsSync(path.join(tasksRoot, '_archive', 'a')), false);
            assert.equal(fs.existsSync(path.join(localDir, 'agent-invocations.log')), false);
        });
    });
}

for (const provider of ['claude', 'mixed'] as const) {
    void test(`main routes full-tier ${provider} spec review through implementation using a single pinned provider`, () => {
        withTempDir('provider-routing-', dir => {
            const taskId = 'provider-route';
            const fixture = prepareReviewEntryMainFixture(dir, taskId, true, false);
            const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
            status.provider = provider;
            status.delicate = false; status.task_size = 'M';
            for (const phase of ['spec_review', 'plan', 'implement'] as const) status.phases[phase]!.status = 'pending';
            // A stale implementer must not be inspected while spec_review is running.
            status.sessions = { implementer: 'stale-impl' }; status.session_backends = { implementer: 'codex' };
            writeTaskStatus(fixture.tasksRoot, taskId, status);
            const log = path.join(dir, 'routing.jsonl');
            for (const binary of ['claude', 'codex']) fs.writeFileSync(path.join(fixture.fakeBins, binary), `#!${process.execPath}
const fs = require('fs'); const path = require('path');
if(process.argv[2]==='--version'){console.log('fake-agent 1.0');process.exit(0);}
const argv=process.argv.slice(2); const statusFile=path.join(process.env.CANON_TASKS_DIR_OVERRIDE,'${taskId}','status.json');
const status=JSON.parse(fs.readFileSync(statusFile,'utf8'));
const phase=['spec_review','plan','implement'].find(p=>status.phases[p].status!=='done');
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({binary:'${binary}',phase,argv})+'\\n');
if(phase==='implement'){console.log(JSON.stringify({type:'result',session_id:'route-session',result:'partial'}));process.kill(process.pid,'SIGTERM');}
else {
status.phases[phase].status='done'; if(phase==='spec_review'){
status.phases[phase].verdict='approved';
fs.writeFileSync(path.join(path.dirname(statusFile),'spec-review.md'),'# Review\\n\\n- [x] **Approved**\\n');
// Change the disk pin during this process; implementation must retain the startup assignment.
status.provider='${provider === 'claude' ? 'mixed' : 'claude'}';
} else fs.writeFileSync(path.join(path.dirname(statusFile),'plan.md'),'# Plan\\n\\n1. Continue.\\n');
fs.writeFileSync(statusFile,JSON.stringify(status));
console.log(JSON.stringify({type:'result',session_id:'route-session',result:'done'}));
console.log(JSON.stringify({type:'thread.started',thread_id:'route-session'}));
}
`, { mode: 0o755 });
            const limitedPath = `${fixture.fakeBins}:/usr/bin:/bin`;
            fs.symlinkSync(process.execPath, path.join(fixture.fakeBins, 'node'));
            if (provider === 'claude') fs.renameSync(path.join(fixture.fakeBins, 'codex'), path.join(fixture.fakeBins, 'unused-codex'));
            const result = runReviewLoopMain(fixture.localDir, fixture.tasksRoot, fixture.fakeBins, taskId, 3, [], { PATH: limitedPath }, false);
            assert.equal(result.status, 2, combinedOutput(result));
            const entries = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { binary: string; phase: string; argv: string[] });
            assert.deepEqual(entries.map(entry => entry.phase), ['spec_review', 'plan', 'implement']);
            assert.deepEqual(entries.map(entry => entry.binary), provider === 'claude' ? ['claude', 'claude', 'claude'] : ['codex', 'claude', 'codex']);
            if (provider === 'claude') {
                assert.match(result.stderr, /Session implementer: stored backend codex, current backend claude/);
                assert.equal(entries[2].argv.includes('--resume'), false);
            }
            for (const entry of entries.filter(entry => entry.phase !== 'plan')) {
                assert.equal(entry.argv[entry.argv.indexOf(provider === 'claude' ? '--model' : '-m') + 1], provider === 'claude' ? 'opus' : 'gpt-6-luna');
            }
            const after = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
            assert.equal(after.phases.spec_review?.agent, provider === 'claude' ? 'claude' : 'codex');
            assert.equal(after.phases.implement?.agent, provider === 'claude' ? 'claude' : 'codex');
            const beforeImplement = combinedOutput(result).split('Phase: implement')[0];
            assert.doesNotMatch(beforeImplement, /Session implementer:/);
        });
    });
}

for (const phase of ['spec_review', 'implement'] as const) for (const mismatch of [false, true]) {
    void test(`Claude provider ${phase} retry checks backend tags (mismatch=${mismatch})`, () => {
        withTempDir('provider-retry-', dir => {
            const fixture = prepareReviewEntryMainFixture(dir, 'provider-retry', true, false);
            const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
            status.provider = 'claude'; status.delicate = false; status.task_size = 'M';
            status.phases[phase]!.status = 'in_progress';
            const slot = phase === 'implement' ? 'implementer' : 'spec_reviewer';
            status.sessions = { [slot]: 'retry-session' }; status.session_backends = { [slot]: mismatch ? 'codex' : 'claude' };
            writeTaskStatus(fixture.tasksRoot, 'provider-retry', status);
            const log = path.join(dir, 'argv');
            const result = runNodeInline(`
import { retryAgentForPhase } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href}';
console.log('RETRY=' + await retryAgentForPhase('provider-retry','${phase}','fixture evidence'));
`, { ...process.env, CANON_TASKS_DIR_OVERRIDE: fixture.tasksRoot, CANON_WORKTREES_ROOT: path.join(fixture.localDir, '.canon/worktrees'),
                PATH: `${fixture.fakeBins}${path.delimiter}${process.env.PATH ?? ''}`, FAKE_AGENT_LOG: path.join(dir, 'agents'), FAKE_AGENT_ARGV_LOG: log,
            }, fixture.localDir);
            assert.equal(result.status, 0, combinedOutput(result));
            if (mismatch) {
                assert.match(result.stdout, /RETRY=no_session/);
                assert.match(result.stderr, new RegExp(`Session ${slot}: stored backend codex, current backend claude`));
                assert.equal(fs.existsSync(log), false);
            } else {
                const entries = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { agent: string; argv: string[] });
                assert.equal(entries.length, 1);
                assert.equal(entries[0].agent, 'claude');
                assert.equal(entries[0].argv[entries[0].argv.indexOf('--model') + 1], 'opus');
                assert.match(entries[0].argv[1], /orchestrator owns commits/);
                assert.doesNotMatch(entries[0].argv[1], /\bCodex\b/);
                assert.equal(entries[0].argv.at(-1), 'retry-session');
            }
        });
    });
}

for (const mismatch of [false, true]) {
    void test(`Claude provider artifact fix-up resumes only a matching backend (mismatch=${mismatch})`, () => {
        withTempDir('provider-fixup-', dir => {
            const id = 'provider-fixup';
            const fixture = prepareReviewEntryMainFixture(dir, id, false, true);
            installDocsRefsChecker(fixture.localDir, { hook: false });
            const handoff = path.join(fixture.tasksRoot, id, 'handoff.md');
            fs.appendFileSync(handoff, '\nSee `src/removed-by-task.ts` for details.\n');
            const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
            status.provider = 'claude'; status.sessions = { implementer: 'fixup-session' }; status.session_backends = { implementer: mismatch ? 'codex' : 'claude' };
            writeTaskStatus(fixture.tasksRoot, id, status);
            const edit = path.join(dir, 'edit.mjs');
            fs.writeFileSync(edit, `import fs from 'node:fs'; const file=${JSON.stringify(handoff)}; fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('\`src/removed-by-task.ts\`','[src/removed-by-task.ts](src/removed-by-task.ts)'));`);
            const log = path.join(dir, 'argv.jsonl');
            const result = runNodeInline(`
import { retryImplementAutoCommitAtReviewEntry } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href}';
await retryImplementAutoCommitAtReviewEntry(['${id}'], ${JSON.stringify(fixture.worktreeDir)});
`, { ...process.env, CANON_TASKS_DIR_OVERRIDE: fixture.tasksRoot, CANON_WORKTREES_ROOT: path.join(fixture.localDir, '.canon/worktrees'),
                PATH: `${fixture.fakeBins}${path.delimiter}${process.env.PATH ?? ''}`, FAKE_AGENT_LOG: path.join(dir, 'agents.log'),
                FAKE_AGENT_ARGV_LOG: log, FAKE_AGENT_EDIT_SCRIPT: edit,
            }, fixture.localDir);
            assert.equal(result.status, 0, combinedOutput(result));
            if (mismatch) {
                assert.match(result.stderr, /Session implementer: stored backend codex, current backend claude/);
                assert.match(result.stderr, /no claude session is available/);
                assert.equal(fs.existsSync(log), false);
            } else {
                const entries = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { agent: string; argv: string[] });
                assert.equal(entries[0].agent, 'claude'); assert.equal(entries[0].argv.at(-1), 'fixup-session');
                assert.doesNotMatch(entries[0].argv[1], /\[Resumed session|Skip startup boilerplate/);
                assert.match(entries[0].argv[1], /Do not run git add or git commit; the orchestrator commits after this turn/);
                assert.doesNotMatch(entries[0].argv[1], /\bCodex\b/);
                assert.doesNotMatch(fs.readFileSync(handoff, 'utf8'), /See `src\/removed/);
            }
        });
    });
}

void test('Claude dry run resolves all phase configs without requiring Codex', () => {
    withTempDir('provider-dry-run-', dir => {
        const { localDir } = makeGitFixture(dir);
        const tasksRoot = writeReviewLoopFixture(localDir, 'dry', 'spec_review', 0);
        const status = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'dry/status.json'), 'utf8')) as StatusJson;
        status.provider = 'claude'; writeTaskStatus(tasksRoot, 'dry', status);
        const bins = path.join(dir, 'bin'); fs.mkdirSync(bins); setupInvocationLoggingCliTools(bins);
        const result = runReviewLoopMain(localDir, tasksRoot, bins, 'dry', 3, ['--dry-run']);
        assert.equal(result.status, 0, combinedOutput(result));
        for (const phase of ['spec', 'spec_review', 'plan', 'implement', 'code_review', 'qa']) assert.match(result.stdout, new RegExp(`- ${phase}: Claude /`));
        assert.equal(fs.existsSync(path.join(localDir, 'agent-invocations.log')), false);
    });
});

void test('Claude spec re-review keeps the revised-spec preamble after changes requested', () => {
    withTempDir('provider-rereview-', dir => {
        const fixture = prepareReviewEntryMainFixture(dir, 'rereview', true, false);
        const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
        status.provider = 'claude'; status.phases.spec_review!.status = 'pending';
        status.phases.spec_review!.iterations_current_loop = 1;
        status.sessions = { spec_reviewer: 'review-session' }; status.session_backends = { spec_reviewer: 'claude' };
        writeTaskStatus(fixture.tasksRoot, 'rereview', status);
        const log = path.join(dir, 'argv');
        const result = runReviewLoopMain(fixture.localDir, fixture.tasksRoot, fixture.fakeBins, 'rereview', 3, [], { FAKE_AGENT_ARGV_LOG: log, FAKE_AGENT_COMPLETE_PHASE: 'spec_review' });
        assert.equal(result.status, 0, combinedOutput(result));
        const entry = JSON.parse(fs.readFileSync(log, 'utf8').trim()) as { argv: string[] };
        assert.match(entry.argv[1], /has been revised since your last review/);
    });
});

for (const provider of ['claude', 'mixed'] as const) for (const resetFrom of ['loop cap', 'gate halt'] as const) {
    void test(`${provider} spec review reset after ${resetFrom} uses the correct session`, () => {
        withTempDir('provider-reset-rereview-', dir => {
            const taskId = 'reset-rereview';
            const fixture = prepareReviewEntryMainFixture(dir, taskId, true, false);
            const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
            const backend = provider === 'claude' ? 'claude' : 'codex';
            status.provider = provider;
            Object.assign(status.phases.spec_review!, {
                status: resetFrom === 'loop cap' ? 'blocked' : 'done',
                verdict: resetFrom === 'loop cap' ? 'changes_requested' : 'approved',
                iterations: resetFrom === 'loop cap' ? 3 : 1,
                iterations_current_loop: resetFrom === 'loop cap' ? 3 : 1,
                iterations_total: resetFrom === 'loop cap' ? 3 : 1,
                changes_requested_total: resetFrom === 'loop cap' ? 3 : 0,
            });
            status.sessions = { spec_reviewer: 'review-session' };
            status.session_backends = { spec_reviewer: backend };
            writeTaskStatus(fixture.tasksRoot, taskId, status);
            setupInvocationLoggingCliTools(fixture.fakeBins);
            const reset = runNodeInline(`
import assert from 'node:assert/strict';
import { taskCmd } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/task/index.ts')).href}';
import { deriveTopLevelStatus, readStatus } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/state.ts')).href}';
taskCmd(['reset-spec-review', '${taskId}']);
assert.equal(deriveTopLevelStatus(readStatus('${taskId}')), 'spec_review');
`, { ...process.env, CANON_TASKS_DIR_OVERRIDE: fixture.tasksRoot }, fixture.localDir);
            assert.equal(reset.status, 0, combinedOutput(reset));
            const afterReset = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
            assert.equal(afterReset.phases.spec_review?.iterations, 0);
            assert.equal(afterReset.phases.spec_review?.iterations_current_loop, 0);
            assert.equal(afterReset.phases.spec_review?.changes_requested_total, resetFrom === 'loop cap' ? 3 : 0);
            assert.equal(afterReset.sessions?.spec_reviewer, provider === 'claude' ? undefined : 'review-session');
            assert.equal(afterReset.session_backends?.spec_reviewer, provider === 'claude' ? undefined : backend);
            const log = path.join(dir, 'argv');
            const result = runReviewLoopMain(fixture.localDir, fixture.tasksRoot, fixture.fakeBins, taskId, 3, [], {
                FAKE_AGENT_ARGV_LOG: log, FAKE_AGENT_COMPLETE_PHASE: 'spec_review',
            });
            assert.equal(result.status, 0, combinedOutput(result));
            const entry = JSON.parse(fs.readFileSync(log, 'utf8').trim()) as { agent: string; argv: string[] };
            assert.equal(entry.agent, backend);
            if (provider === 'claude') {
                assert.equal(entry.argv.includes('--resume'), false);
                assert.doesNotMatch(entry.argv[1], /has been revised since your last review/);
            } else {
                assert.deepEqual(entry.argv.slice(0, 3), ['exec', 'resume', 'review-session']);
                assert.match(entry.argv.join('\n'), /has been revised since your last review/);
            }
        });
    });
}

void test('Claude spec review park after reroute ignores earlier-loop changes-requested history', () => {
    withTempDir('provider-reroute-park-', dir => {
        const taskId = 'reroute-park';
        const fixture = prepareReviewEntryMainFixture(dir, taskId, true, false);
        const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
        status.provider = 'claude';
        Object.assign(status.phases.spec_review!, {
            iterations: 2, iterations_current_loop: 2, changes_requested_total: 2,
        });
        status.sessions = { spec_reviewer: 'prior-loop-session' };
        status.session_backends = { spec_reviewer: 'claude' };
        writeTaskStatus(fixture.tasksRoot, taskId, status);
        fs.appendFileSync(path.join(fixture.tasksRoot, taskId, 'spec.md'), '\n## Amendment\n\nReview the amendment.\n');
        const reroute = runNodeInline(`
import assert from 'node:assert/strict';
import { rerouteFromHumanReview } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href}';
import { deriveTopLevelStatus, readStatus } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/state.ts')).href}';
rerouteFromHumanReview(['${taskId}']);
const status = readStatus('${taskId}');
assert.equal(deriveTopLevelStatus(status), 'spec_review');
assert.equal(status.phases.spec_review.iterations_current_loop, 0);
assert.equal(status.phases.spec_review.changes_requested_total, 2);
assert.equal(status.sessions.spec_reviewer, undefined);
`, { ...process.env, CANON_TASKS_DIR_OVERRIDE: fixture.tasksRoot }, fixture.localDir);
        assert.equal(reroute.status, 0, combinedOutput(reroute));
        const log = path.join(dir, 'argv');
        writeExecutable(fixture.fakeBins, 'claude', [
            'if [ "${1:-}" = "--version" ]; then echo "fake-agent 1.0"; exit 0; fi',
            'node -e \'require("fs").appendFileSync(process.env.FAKE_AGENT_ARGV_LOG,JSON.stringify(process.argv.slice(1))+"\\n")\' -- "$@"',
            'printf \'{"type":"result","session_id":"amendment-session","result":"partial"}\\n\'',
            'exit 1',
        ]);
        for (const resumed of [false, true]) {
            const run = runReviewLoopMain(fixture.localDir, fixture.tasksRoot, fixture.fakeBins, taskId, 3, [], { FAKE_AGENT_ARGV_LOG: log });
            assert.equal(run.status, 2, combinedOutput(run));
            const entries = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]);
            const argv = entries.at(-1)!;
            assert.equal(argv.includes('--resume'), resumed);
            if (resumed) assert.equal(argv[argv.indexOf('--resume') + 1], 'amendment-session');
            assert.doesNotMatch(argv[1], /has been revised since your last review/);
        }
    });
});

void test('Claude fast-tier reroute note names the pinned implementer and clears reviewer tags', () => {
    withTempDir('provider-reroute-', dir => {
        const id = 'provider-reroute';
        const fixture = prepareReviewEntryMainFixture(dir, id, true, false);
        const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
        status.provider = 'claude'; status.task_size = 'XS'; status.delicate = false;
        status.sessions = { reviewer: 'reviewer', claude_review: 'legacy-reviewer', implementer: 'implementer' };
        status.session_backends = { reviewer: 'claude', implementer: 'claude' };
        writeTaskStatus(fixture.tasksRoot, id, status);
        fs.appendFileSync(path.join(fixture.tasksRoot, id, 'spec.md'), '\n## Amendment\n\nContinue the change.\n');
        const result = runNodeInline(`
import { rerouteFromHumanReview } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href}';
rerouteFromHumanReview(['${id}']);
`, { ...process.env, CANON_TASKS_DIR_OVERRIDE: fixture.tasksRoot, CANON_WORKTREES_ROOT: path.join(fixture.localDir, '.canon/worktrees') }, fixture.localDir);
        assert.equal(result.status, 0, combinedOutput(result));
        assert.match(result.stdout, /Note: Claude will re-read spec.md carefully/);
        const after = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
        assert.deepEqual(after.sessions, { implementer: 'implementer' });
        assert.deepEqual(after.session_backends, { implementer: 'claude' });
    });
});

for (const provider of ['mixed', 'claude'] as const) for (const phase of ['spec', 'code_review'] as const) {
    void test(`${provider} ${phase} park does not persist a failed Claude session`, () => {
        withTempDir('provider-no-park-store-', dir => {
            const tasksRoot = path.join(dir, 'tasks');
            const status = makeReviewLoopStatus('no-store', 'code_review', 0) as StatusJson;
            status.provider = provider; status.sessions = {};
            status.phases[phase]!.status = 'in_progress';
            writeTaskStatus(tasksRoot, 'no-store', status);
            const result = runNodeInline(`
import { withAgentSessionPark } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href}';
import { AgentSessionError } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/agents/errors.ts')).href}';
await withAgentSessionPark('${phase}',['no-store'],async()=>{ throw new AgentSessionError({agent:'claude',kind:'exit_code',reason:'failed session',sessionId:'do-not-store'}); });
`, { ...process.env, CANON_TASKS_DIR_OVERRIDE: tasksRoot });
            assert.equal(result.status, 2, combinedOutput(result));
            const after = JSON.parse(fs.readFileSync(path.join(tasksRoot, 'no-store/status.json'), 'utf8')) as StatusJson;
            assert.deepEqual(after.sessions, {});
            assert.equal(after.session_backends, undefined);
        });
    });
}

for (const entry of ['revision', 'reroute'] as const) {
    void test(`Claude parked implement preserves ${entry} prompt precedence`, () => {
        withTempDir('provider-prompt-precedence-', dir => {
            const id = 'precedence';
            const fixture = prepareReviewEntryMainFixture(dir, id, true, false);
            const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
            status.provider = 'claude'; status.phases.implement!.status = 'blocked';
            status.sessions = { implementer: 'park-session' }; status.session_backends = { implementer: 'claude' };
            if (entry === 'revision') status.phases.code_review!.iterations_current_loop = 1;
            else { status.phases.implement!.rerouted = true; status.phases.implement!.reroute_count = 1; }
            writeTaskStatus(fixture.tasksRoot, id, status);
            const log = path.join(dir, 'argv');
            const result = runReviewLoopMain(fixture.localDir, fixture.tasksRoot, fixture.fakeBins, id, 3, [], { FAKE_AGENT_ARGV_LOG: log, FAKE_AGENT_COMPLETE_PHASE: 'implement' });
            assert.equal(result.status, 0, combinedOutput(result));
            const argv = (JSON.parse(fs.readFileSync(log, 'utf8').trim()) as { argv: string[] }).argv;
            assert.match(argv[1], new RegExp(`Mode: \\*\\*${entry}\\*\\*`));
            assert.doesNotMatch(argv[1], /previous session stopped before finishing/);
            if (entry === 'reroute') {
                assert.doesNotMatch(argv[1], /\[Resumed session|Skip startup boilerplate/);
                assert.match(argv[1], /orchestrator owns commits/);
                assert.match(argv[1], /Read docs\/patterns.md and docs\/codebase-map.md before starting/);
            }
            assert.equal(argv.at(-1), 'park-session');
        });
    });
}

void test('mixed run requires Codex even when the environment selects Claude', () => {
    withTempDir('provider-required-binary-', dir => {
        const { localDir } = makeGitFixture(dir);
        const tasksRoot = writeReviewLoopFixture(localDir, 'mixed-deps', 'spec_review', 0, 0, true);
        const bins = path.join(dir, 'bin'); fs.mkdirSync(bins);
        writeExecutable(bins, 'claude', ['exit 0']);
        fs.symlinkSync(process.execPath, path.join(bins, 'node'));
        const result = runReviewLoopMain(localDir, tasksRoot, bins, 'mixed-deps', 3, [], { PATH: `${bins}:/usr/bin:/bin`, CANON_PROVIDER: 'claude' });
        assert.equal(result.status, 1, combinedOutput(result));
        assert.match(result.stderr, /Codex CLI is required/);
    });
});

void test('Claude implement recovery failure parks its new session and resumes unfinished validation', () => {
    withTempDir('provider-recovery-park-', dir => {
        const id = 'recovery-park';
        const fixture = prepareReviewEntryMainFixture(dir, id, true, false);
        const handoff = path.join(fixture.tasksRoot, id, 'handoff.md');
        const validHandoff = fs.readFileSync(handoff, 'utf8');
        fs.writeFileSync(handoff, '# Implementation Handoff\n');
        const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
        status.provider = 'claude'; status.phases.implement!.status = 'done';
        status.sessions = { implementer: 'previous-session' }; status.session_backends = { implementer: 'claude' };
        writeTaskStatus(fixture.tasksRoot, id, status);
        writeExecutable(fixture.fakeBins, 'claude', [
            'printf \'{"type":"result","session_id":"recovery-session","result":"partial recovery"}\\n\'',
            'exit 1',
        ]);
        const first = runNodeInline(`
import {withAgentSessionPark,checkAndRoute} from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href}';
await withAgentSessionPark('implement',['${id}'],()=>checkAndRoute('implement',['${id}']));
`, { ...process.env, CANON_TASKS_DIR_OVERRIDE: fixture.tasksRoot,
            CANON_WORKTREES_ROOT: path.join(fixture.localDir, '.canon/worktrees'), PATH: `${fixture.fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
        }, fixture.localDir);
        assert.equal(first.status, 2, combinedOutput(first));
        assert.match(combinedOutput(first), /Retrying claude session/);
        const parked = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
        assert.equal(parked.phases.implement?.status, 'blocked');
        assert.equal(parked.sessions?.implementer, 'recovery-session');
        assert.equal(parked.session_backends?.implementer, 'claude');
        fs.writeFileSync(handoff, validHandoff);
        setupInvocationLoggingCliTools(fixture.fakeBins);
        const log = path.join(dir, 'argv.jsonl');
        const second = runReviewLoopMain(fixture.localDir, fixture.tasksRoot, fixture.fakeBins, id, 3, [], { FAKE_AGENT_ARGV_LOG: log, FAKE_AGENT_COMPLETE_PHASE: 'implement' });
        assert.equal(second.status, 0, combinedOutput(second));
        const args = (JSON.parse(fs.readFileSync(log, 'utf8').trim()) as { argv: string[] }).argv;
        assert.equal(args.at(-1), 'recovery-session');
        assert.match(args[1], /Mode: \*\*park resume\*\*/);
        assert.match(args[1], /Work may be partial/);
        assert.doesNotMatch(args[1], /already complete/);
    });
});

void test('manifest evidence recovery parks with issues without marking spec done', () => {
    withTempDir('manifest-evidence-', dir => {
        const id = 'manifest-evidence';
        const fixture = prepareReviewEntryMainFixture(dir, id, true, false);
        const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
        status.phases.spec!.status = 'in_progress';
        writeTaskStatus(fixture.tasksRoot, id, status);
        fs.writeFileSync(path.join(fixture.tasksRoot, id, 'spec.md'), '# Spec: evidence\n## Design\n### Affected Files\n| File | Change |\n|---|---|\n| `a.ts` | x || `b.ts` | y |\n');
        const env: NodeJS.ProcessEnv = { ...process.env, CANON_TASKS_DIR_OVERRIDE: fixture.tasksRoot };
        delete env.CANON_SKIP_PHASE_GATE;
        const result = runNodeInline(`
import assert from 'node:assert/strict';
import { tryEvidenceAdvance } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href}';
const result = tryEvidenceAdvance('${id}', 'spec');
assert.equal(result.advanced, false);
assert.match(result.note, /row 1/);
console.log(result.note);
`, env, fixture.localDir);
        assert.equal(result.status, 0, combinedOutput(result));
        assert.equal((JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson).phases.spec?.status, 'in_progress');
    });
});

for (const phase of ['plan', 'implement'] as const) {
    for (const mode of ['blocked', 'forced', 'clean', 'missing'] as const) {
        void test(`manifest pre-flight ${phase}: ${mode} before any agent runs`, () => {
            withTempDir('manifest-entry-', dir => {
                const id = 'manifest-entry';
                const fixture = prepareReviewEntryMainFixture(dir, id, true, false);
                const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
                status.task_size = 'L';
                status.delicate = false;
                status.human_spec_gate = true;
                status.phases.spec!.status = 'done';
                status.phases.spec_review!.status = 'done';
                status.phases.spec_review!.verdict = 'approved';
                status.phases.plan!.status = phase === 'plan' ? 'pending' : 'done';
                status.phases.implement!.status = 'pending';
                status.phases.code_review!.status = 'pending';
                if (phase === 'implement') status.phases.implement!.rerouted = true;
                writeTaskStatus(fixture.tasksRoot, id, status);
                const row = mode === 'clean' ? '| `initial-fixture.txt` | x |' : '| `a.ts` | x || `b.ts` | y |';
                const design = '# Spec: entry\n## Design\n### Affected Files\n| File | Change |\n|---|---|\n| `initial-fixture.txt` | update |\n';
                const manifest = (phase === 'implement' ? design : '') + `# Spec: entry\n## ${phase === 'implement' ? 'Amendment' : 'Design'}\n### Affected Files\n| File | Change |\n|---|---|\n${row}\n`;
                fs.writeFileSync(path.join(fixture.tasksRoot, id, 'spec.md'), mode === 'missing' ? '# Spec: missing manifest\n## Design\nProse only.\n' : manifest);
                // The main checkout remains clean; the gate must read the active copy.
                const mainStatus = path.join(fixture.localDir, 'tasks', id, 'status.json');
                const beforeMain = fs.readFileSync(mainStatus, 'utf8');
                setupInvocationLoggingCliTools(fixture.fakeBins);
                const agentLog = path.join(dir, 'agents.log');
                const env: NodeJS.ProcessEnv = { ...process.env,
                    CANON_WORKTREES_ROOT: path.join(fixture.localDir, '.canon/worktrees'),
                    PATH: `${fixture.fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
                    FAKE_AGENT_LOG: agentLog,
                    CANON_METRICS_FILE_OVERRIDE: path.join(dir, 'metrics.md'),
                };
                delete env.CANON_TASKS_DIR_OVERRIDE;
                delete env.CANON_SKIP_PHASE_GATE;
                delete env.CANON_PROVIDER;
                const handler = phase === 'plan' ? 'runPlanPhase' : 'runImplementPhase';
                const args = phase === 'plan' ? `${mode === 'forced'}` : `null, ${mode === 'forced'}`;
                const result = runNodeInline(`
import assert from 'node:assert/strict';
import { buildPipelineState } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href}';
import { ${handler} } from '${pathToFileURL(path.join(WORKTREE_ROOT, `src/orchestrator/phases/${phase}.ts`)).href}';
const state = buildPipelineState(['${id}']);
assert.equal(state.tasks[0].status.phases.${phase}.status, 'pending');
await ${handler}(state, false, ${args});
`, env, fixture.localDir);
                assert.equal(result.status, mode === 'blocked' || mode === 'missing' ? 2 : 0, combinedOutput(result));
                const output = combinedOutput(result);
                const after = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
                assert.equal(fs.readFileSync(mainStatus, 'utf8'), beforeMain);
                if (mode === 'blocked' || mode === 'missing') {
                    assert.match(output, mode === 'missing' ? /No ### Affected Files table under ## Design/ : /row 1/);
                    assert.match(output, /Fix the ### Affected Files table.*canon run manifest-entry/);
                    assert.equal(after.phases[phase]?.status, 'blocked');
                    assert.equal(after.escalations?.at(-1)?.phase, phase);
                    assert.equal(fs.existsSync(agentLog), false);
                    // Fix and resume the same blocked phase without resetting it.
                    fs.writeFileSync(path.join(fixture.tasksRoot, id, 'spec.md'), design);
                    const resumed = runNodeInline(`
import { buildPipelineState } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href}';
import { ${handler} } from '${pathToFileURL(path.join(WORKTREE_ROOT, `src/orchestrator/phases/${phase}.ts`)).href}';
await ${handler}(buildPipelineState(['${id}']), false${phase === 'implement' ? ', null' : ''});
`, env, fixture.localDir);
                    assert.equal(resumed.status, 0, combinedOutput(resumed));
                    assert.ok(fs.readFileSync(agentLog, 'utf8').trim());
                } else {
                    assert.ok(fs.readFileSync(agentLog, 'utf8').trim());
                    if (mode === 'forced') assert.match(output, /--force bypass:[\s\S]*row 1/);
                    else assert.doesNotMatch(output, /Spec manifest pre-flight/);
                }
            });
        });
    }
}

void test('manifest pre-flight checks every bundle member including exempt reroute siblings', () => {
    withTempDir('manifest-bundle-', dir => {
        const fixture = prepareReviewEntryMainFixture(dir, 'leader', true, false);
        const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
        status.phases.implement!.rerouted = true;
        for (const id of ['leader', 'secondary']) writeTaskStatus(fixture.tasksRoot, id, {
            ...status, id, phases: { ...status.phases, implement: { ...status.phases.implement!, status: 'pending', reroute_exempt: id === 'secondary' } },
        });
        fs.writeFileSync(path.join(fixture.tasksRoot, 'leader/spec.md'), '# Spec: clean\n## Design\n### Affected Files\n| File | Change |\n|---|---|\n| `initial-fixture.txt` | update |\n');
        fs.writeFileSync(path.join(fixture.tasksRoot, 'secondary/spec.md'), '# Spec: bad\n## Amendment\n### Affected files\n| File | Change |\n|---|---|\n| `lost.ts` | x |\n');
        const log = path.join(dir, 'agents.log');
        const result = runNodeInline(`
import { buildPipelineState } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/main.ts')).href}';
import { runImplementPhase } from '${pathToFileURL(path.join(WORKTREE_ROOT, 'src/orchestrator/phases/implement.ts')).href}';
await runImplementPhase(buildPipelineState(['leader','secondary']), false, null);
`, { ...process.env, CANON_TASKS_DIR_OVERRIDE: fixture.tasksRoot, FAKE_AGENT_LOG: log,
            PATH: `${fixture.fakeBins}${path.delimiter}${process.env.PATH ?? ''}` }, fixture.localDir);
        assert.equal(result.status, 2, combinedOutput(result));
        assert.match(combinedOutput(result), /\[secondary\].*Affected Files/);
        assert.equal(fs.existsSync(log), false);
        for (const id of ['leader', 'secondary']) {
            assert.equal((JSON.parse(fs.readFileSync(path.join(fixture.tasksRoot, id, 'status.json'), 'utf8')) as StatusJson).phases.implement?.status, 'blocked');
        }
    });
});

for (const phase of ['plan', 'implement'] as const) {
    void test(`manifest --force reaches ${phase} through main dispatch`, () => {
        withTempDir('manifest-force-main-', dir => {
            const id = 'manifest-force';
            const fixture = prepareReviewEntryMainFixture(dir, id, true, false);
            const status = JSON.parse(fs.readFileSync(fixture.statusPath, 'utf8')) as StatusJson;
            status.task_size = 'L'; status.delicate = false;
            status.phases.spec!.status = 'done';
            status.phases.spec_review!.status = 'done';
            status.phases.spec_review!.verdict = 'approved';
            status.phases.plan!.status = phase === 'plan' ? 'pending' : 'done';
            status.phases.implement!.status = 'pending';
            status.phases.code_review!.status = 'pending';
            writeTaskStatus(fixture.tasksRoot, id, status);
            fs.writeFileSync(path.join(fixture.tasksRoot, id, 'plan.md'), '# Plan: completed\n\n## Steps\n1. Update the module.\n');
            fs.writeFileSync(path.join(fixture.tasksRoot, id, 'spec.md'), '# Spec: edited after review\n## Design\n### Affected Files\n| File | Change |\n|---|---|\n| `a.ts` | x || `b.ts` | y |\n\n## Validation Required\n\n- [x] `npm test`\n');
            setupInvocationLoggingCliTools(fixture.fakeBins);
            const result = runReviewLoopMain(fixture.localDir, fixture.tasksRoot, fixture.fakeBins, id, 3,
                ['--force', '--expect', phase], {
                    CANON_WORKTREES_ROOT: path.join(fixture.localDir, '.canon/worktrees'),
                    FAKE_AGENT_COMPLETE_PHASE: phase,
                });
            assert.equal(result.status, 0, combinedOutput(result));
            assert.match(combinedOutput(result), new RegExp(`--force bypass: Spec manifest pre-flight before ${phase}`));
            assert.ok(readAgentInvocations(path.join(fixture.localDir, 'agent-invocations.log')).length > 0);
        });
    });
}
