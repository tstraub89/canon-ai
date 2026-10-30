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
        for (const key of Object.keys(env)) if (/^(CANON_PROVIDER|CLAUDE_MODEL|CLAUDE_BUDGET|CODEX_MODEL|MAX_REVIEW_LOOPS)/.test(key)) delete env[key as keyof typeof env];
        const result = spawnSync(process.execPath, ['--import', './tests/md-loader-register.mjs', '--import', 'tsx', '--input-type=module', '-e', `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MIXED_ROLE_ASSIGNMENT } from './src/lib/pipeline-policy.ts';
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
    const result = await agentBackendFor(role, MIXED_ROLE_ASSIGNMENT).run({ role, phase, tasks, prompt, interactive: false, resumeId, cwd, wrapForResume });
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
        storeSessionId(['a','b'],role,'next','claude');
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
    checkDeps(cmd => { probes.push(cmd); return true; }, 'mixed');
    assert.deepEqual(probes, ['git', 'claude', 'codex', 'gh']);
});

void test('author config preserves distinct spec and plan model pins', () => {
    const result = spawnSync(process.execPath, ['--import', './tests/md-loader-register.mjs', '--import', 'tsx', '--input-type=module', '-e', `
import assert from 'node:assert/strict';
import { MIXED_ROLE_ASSIGNMENT } from './src/lib/pipeline-policy.ts';
import { agentBackendFor } from './src/orchestrator/agents/backend.ts';
const tasks = [{status:{task_size:'L'}}];
const author = agentBackendFor('author', MIXED_ROLE_ASSIGNMENT);
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
`], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, CANON_PROVIDER: undefined, CLAUDE_MODEL_SPEC_REVIEW: undefined, CLAUDE_MODEL_IMPLEMENT: undefined } });
        assert.equal(result.status, 1);
        assert.match(result.stderr, new RegExp(`✗ ${missing}`));
    });
}

void test('backend tags guard each session at use and clear complete slot pairs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-session-tags-'));
    try {
        const result = spawnSync(process.execPath, ['--import', './tests/md-loader-register.mjs', '--import', 'tsx', '--input-type=module', '-e', `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { usableSessionId, storeSessionId, clearSessionPair, readStatus, clearMismatchedSessions } from './src/orchestrator/state.ts';
import { roleAssignmentFor, MIXED_ROLE_ASSIGNMENT } from './src/lib/pipeline-policy.ts';
const root = process.env.CANON_TASKS_DIR_OVERRIDE;
const pairs = { author:'claude_spec',spec_reviewer:'codex_spec_review',implementer:'codex',reviewer:'claude_review' };
for (const [slot,legacy] of Object.entries(pairs)) {
    for (const provider of ['mixed','claude']) for (const form of ['role','legacy','both']) for (const tag of [undefined,'claude','codex','invalid']) {
        const assignment = roleAssignmentFor(provider);
        const status = {id:'task',worktree:false,phases:{},sessions:{unrelated:'keep',...(form !== 'legacy' ? {[slot]:'session'} : {}),...(form !== 'role' ? {[legacy]:'session'} : {})},session_backends:tag ? {[slot]:tag} : {}};
        fs.mkdirSync(path.join(root,'task'),{recursive:true});
        fs.writeFileSync(path.join(root,'task','status.json'),JSON.stringify(status));
        const expected = (tag ?? MIXED_ROLE_ASSIGNMENT[slot]) === assignment[slot];
        const warnings = []; const old = console.error; console.error = (...args)=>warnings.push(args.join(' '));
        let actual;
        try { actual = usableSessionId(['task'],slot,assignment); } finally { console.error = old; }
        assert.equal(actual, expected ? 'session' : null, JSON.stringify({slot,provider,form,tag}));
        if (!expected) {
            const after = readStatus('task');
            assert.equal(after.sessions[slot],undefined); assert.equal(after.sessions[legacy],undefined); assert.equal(after.session_backends[slot],undefined);
            assert.match(warnings.join(' '),new RegExp(slot+'.*stored backend '+(tag ?? MIXED_ROLE_ASSIGNMENT[slot])+'.*current backend '+assignment[slot]));
        } else assert.equal(warnings.length,0);
        storeSessionId(['task'],slot,'new',assignment[slot]);
        const after = readStatus('task');
        assert.equal(after.session_backends[slot],assignment[slot]);
        clearSessionPair(after,slot); assert.equal(after.session_backends[slot],undefined);
    }
}
const switchable = {sessions:{author:'author',implementer:'impl',codex:'legacy',spec_reviewer:'spec'},session_backends:{author:'claude',implementer:'codex',spec_reviewer:'codex'}};
assert.deepEqual(clearMismatchedSessions(switchable,roleAssignmentFor('claude')),['spec_reviewer','implementer']);
assert.deepEqual(switchable.sessions,{author:'author'});
assert.deepEqual(clearMismatchedSessions(switchable,roleAssignmentFor('mixed')),[]);
`], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, CANON_TASKS_DIR_OVERRIDE: dir } });
        assert.equal(result.status, 0, result.stdout + result.stderr);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

void test('init checks the provider setting lazily and Claude needs no Codex', async () => {
    const { checkDeps } = await import('../src/cli/deps.js');
    const previous = process.env.CANON_PROVIDER;
    try {
        process.env.CANON_PROVIDER = 'claude';
        const probes: string[] = [];
        checkDeps(cmd => { probes.push(cmd); return cmd !== 'codex'; });
        assert.deepEqual(probes, ['git', 'claude', 'gh']);
    } finally { if (previous === undefined) delete process.env.CANON_PROVIDER; else process.env.CANON_PROVIDER = previous; }
});
