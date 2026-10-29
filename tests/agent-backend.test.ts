import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Pins literal session flags and model/effort/budget defaults under a scrubbed env.
// Expected argv uses current config getters and shared prompt helpers; actual
// call-site parity is covered in run-task-safety and run-task-code-review tests.
const parityRows = [
    ['spec fresh', 'author', 'spec', null, true],
    ['spec revision', 'author', 'spec', 'session', true],
    ['spec review fresh', 'spec_reviewer', 'spec_review', null, true],
    ['spec review resume', 'spec_reviewer', 'spec_review', 'session', true],
    ['plan', 'author', 'plan', null, true],
    ['implement fresh', 'implementer', 'implement', null, true],
    ['implement resume', 'implementer', 'implement', 'session', true],
    ['implement reroute', 'implementer', 'implement', 'session', false],
    ['foreman round 1', 'reviewer', 'code_review', null, true],
    ['foreman round 2', 'reviewer', 'code_review', 'session', true],
    ['qa', 'qa', 'qa', null, true],
    ['implement artifact fixup', 'implementer', 'implement', 'session', false],
    ['Codex retry', 'implementer', 'implement', 'session', true],
    ['Claude retry', 'reviewer', 'code_review', 'session', true],
    ['QA fixup', 'qa', 'qa', 'session', true],
] as const;

void test('backend session contract: literal flags and policy defaults', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-parity-'));
    try {
        for (const binary of ['claude', 'codex']) {
            fs.writeFileSync(path.join(dir, binary), `#!${process.execPath}
const fs = require('fs');
fs.appendFileSync(process.env.PARITY_LOG, JSON.stringify({ binary: '${binary}', argv: process.argv.slice(2), cwd: process.cwd() })+'\\n');
console.log(JSON.stringify({type:'result',result:'plain text',session_id:'new-session'}));
console.log(JSON.stringify({type:'thread.started',thread_id:'new-session'}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'plain text'}}));
console.log(JSON.stringify({type:'turn.completed'}));
`, { mode: 0o755 });
        }
        const env = { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH ?? ''}`, PARITY_LOG: path.join(dir, 'log') };
        for (const key of Object.keys(env)) if (/^(CLAUDE_MODEL|CLAUDE_BUDGET|CODEX_MODEL|MAX_REVIEW_LOOPS)/.test(key)) delete env[key as keyof typeof env];
        const result = spawnSync(process.execPath, ['--import', './tests/md-loader-register.mjs', '--import', 'tsx', '--input-type=module', '-e', `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { agentBackendFor } from './src/orchestrator/agents/backend.ts';
import { getClaudeConfig, getCodexConfig } from './src/orchestrator/policy.ts';
import { CLAUDE_HEADLESS, CODEX_HEADLESS, toResumePrompt } from './src/orchestrator/prompts/helpers.ts';
import { REPO_ROOT } from './src/orchestrator/env.ts';
const tasks = [{ status: { task_size: 'L', delicate: false } }];
for (const [name, role, phase, resumeId, wrapForResume] of ${JSON.stringify(parityRows)}) {
    const claude = ['author','reviewer','qa'].includes(role);
    const cfg = claude ? getClaudeConfig(phase, tasks) : getCodexConfig(phase, tasks);
    const prompt = 'Complete ' + name + '\\nfrom disk.';
    const cwd = ${JSON.stringify(dir)};
    const result = await agentBackendFor(role).run({ role, phase, tasks, prompt, interactive: false, resumeId, cwd, wrapForResume });
    assert.equal(result.text, 'plain text', name);
    assert.equal(result.backend, claude ? 'claude' : 'codex', name);
    const actual = JSON.parse(fs.readFileSync(process.env.PARITY_LOG, 'utf8').trim().split('\\n').at(-1));
    const rendered = resumeId && (claude || wrapForResume) ? toResumePrompt(prompt) : prompt;
    const effective = (claude ? CLAUDE_HEADLESS : CODEX_HEADLESS) + '\\n\\n' + rendered;
    const expected = claude
      ? ['-p', effective, '--model', cfg.model, '--effort', cfg.effort, '--add-dir', REPO_ROOT, '--max-budget-usd', cfg.budget, '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose', '--add-dir', cwd, ...(resumeId ? ['--resume',resumeId] : [])]
      : resumeId ? ['exec','resume',resumeId,'--json','-c','model_reasoning_effort='+cfg.effort,effective,'-m',cfg.model]
      : ['exec','--json','-c','model_reasoning_effort='+cfg.effort,'--sandbox','workspace-write',effective,'-m',cfg.model,'-C',cwd];
    assert.deepEqual(actual, { binary: claude ? 'claude' : 'codex', argv: expected, cwd: fs.realpathSync(cwd) }, name);
    assert.equal(cfg.model, claude ? phase === 'qa' ? 'claude-haiku-5-5' : 'opus' : 'gpt-6-luna', name);
    if (claude) assert.equal(cfg.budget, phase === 'code_review' ? '20.00' : '10.00', name);
    assert.equal(cfg.effort, claude ? 'medium' : phase === 'implement' ? 'max' : 'high', name);
}
`], { cwd: process.cwd(), env, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stdout + result.stderr);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('session fallback matrix, bundle writes, pair clears and agent records', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-state-'));
    try {
        const result = spawnSync(process.execPath, ['--import', './tests/md-loader-register.mjs', '--import', 'tsx', '--input-type=module', '-e', `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getStoredSessionId, storeSessionId, clearSessionPair, recordPhaseAgent, readStatus } from './src/orchestrator/state.ts';
const root = process.env.CANON_TASKS_DIR_OVERRIDE;
const pairs = { author: 'claude_spec', spec_reviewer: 'codex_spec_review', implementer: 'codex', reviewer: 'claude_review' };
function seed(id, sessions) {
    fs.mkdirSync(path.join(root,id), {recursive:true});
    fs.writeFileSync(path.join(root,id,'status.json'),JSON.stringify({title:id, worktree:false, phases:{spec:{status:'done',agent:''}},sessions}));
}
for (const [role, legacy] of Object.entries(pairs)) {
    for (const mode of ['legacy', 'role', 'both']) {
        const sessions = { ...(mode !== 'role' ? {[legacy]:'old'} : {}), ...(mode !== 'legacy' ? {[role]:'new'} : {}) };
        for (const id of ['a','b']) seed(id,sessions);
        assert.equal(getStoredSessionId(['a','b'],role), mode === 'legacy' ? 'old' : 'new');
        storeSessionId(['a','b'],role,'next');
        for (const id of ['a','b']) {
            const after = readStatus(id).sessions;
            assert.equal(after[role], 'next');
            assert.equal(after[legacy], sessions[legacy]);
        }
    }
    const sessions = Object.fromEntries(Object.entries(pairs).flatMap(([r,l])=>[[r,r],[l,l]]));
    const status = { sessions: {...sessions} };
    clearSessionPair(status,role);
    delete sessions[role]; delete sessions[legacy];
    assert.deepEqual(status.sessions,sessions);
}
recordPhaseAgent(['a','b'],'spec','claude');
for (const id of ['a','b']) assert.equal(readStatus(id).phases.spec.agent,'claude');
recordPhaseAgent(['a'],'qa','claude');
assert.equal(readStatus('a').phases.qa,undefined);
`], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, CANON_TASKS_DIR_OVERRIDE: dir } });
        assert.equal(result.status, 0, result.stdout + result.stderr);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

void test('init probes both required agent binaries', async () => {
    const { checkDeps } = await import('../src/cli/deps.js');
    const probes: string[] = [];
    checkDeps(cmd => { probes.push(cmd); return true; });
    assert.deepEqual(probes, ['git', 'claude', 'codex', 'gh']);
});

void test('author config preserves distinct spec and plan model pins', () => {
    const result = spawnSync(process.execPath, ['--import', './tests/md-loader-register.mjs', '--import', 'tsx', '--input-type=module', '-e', `
import assert from 'node:assert/strict';
import { agentBackendFor } from './src/orchestrator/agents/backend.ts';
const tasks = [{status:{task_size:'L'}}];
const author = agentBackendFor('author');
assert.equal(author.resolveConfig('spec',tasks).model,'spec-pin');
assert.equal(author.resolveConfig('plan',tasks).model,'plan-pin');
await assert.rejects(author.coldReview({role:'author',phase:'spec',tasks,baseBranch:'main',cwd:process.cwd()}),/unsupported/);
`], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, CLAUDE_MODEL_SPEC: 'spec-pin', CLAUDE_MODEL_PLAN: 'plan-pin' } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const missing of ['claude', 'codex']) {
    void test(`init refuses when required ${missing} binary is unavailable`, () => {
        const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
import { checkDeps } from './src/cli/deps.ts';
checkDeps(cmd => cmd !== '${missing}');
`], { cwd: process.cwd(), encoding: 'utf8', env: process.env });
        assert.equal(result.status, 1);
        assert.match(result.stderr, new RegExp(`✗ ${missing}`));
    });
}
