import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
    defaultMaxReviewLoops,
    detectTier,
    getEffectiveSize,
    getNominalSize,
    getPipelinePolicy,
    isPlanCombined,
    type ClaudePhase,
    type CodexPhase,
    type PolicyConfig,
    type PolicyInput,
    type TaskSize,
    CODE_REVIEW_DELTA_LINE_THRESHOLD,
    resolveCodeReviewScope,
    type CodeReviewScopeFacts,
} from '../src/lib/pipeline-policy.ts';
import { LEGACY_FALLBACK_ENV_VARS } from '../src/orchestrator/env.ts';

const reviewFacts: CodeReviewScopeFacts = {
    isRound1: false, effectiveSize: 'M', delicate: false, baseBranch: 'main',
    prevRecord: { reviewedSha: 'a'.repeat(40), exists: true, isAncestor: true, equalsHead: false },
    deltaPaths: ['src/a.ts'], priorChangeSetPaths: ['src/a.ts'],
    deltaFileStats: [{ path: 'src/a.ts', added: 2, deleted: 1 }],
    taskIds: ['work'], telemetryFiles: ['docs/lessons-learned.md'],
};

for (const [name, override, reason] of [
    ['round 1', { isRound1: true }, /Round 1/],
    ['XL', { effectiveSize: 'XL' }, /XL task size/],
    ['delicate', { effectiveSize: 'XL', delicate: true }, /delicate/],
    ['missing archive', { prevRecord: null }, /no cold-Codex archive record/],
    ['disagreeing records', { prevRecord: null, previousRecordsDisagree: true }, /bundle members disagree/],
    ['unparseable archive', { prevRecord: null, previousArchiveMalformed: true }, /unparseable cold-Codex archive record/],
    ['bad SHA', { prevRecord: { reviewedSha: 'bad', exists: false, isAncestor: false, equalsHead: false } }, /does not resolve/],
    ['non-ancestor', { prevRecord: { reviewedSha: 'a', exists: true, isAncestor: false, equalsHead: false } }, /not an ancestor/],
    ['same HEAD', { prevRecord: { reviewedSha: 'a', exists: true, isAncestor: true, equalsHead: true } }, /equals HEAD/],
    ['outside path', { deltaPaths: ['src/b.ts'] }, /outside the previous round's change set/],
    ['over threshold', { deltaFileStats: [{ path: 'src/a.ts', added: CODE_REVIEW_DELTA_LINE_THRESHOLD + 1, deleted: 0 }] }, /exceeds 400/],
    ['failed delta path probe', { deltaPaths: null }, /delta path probe failed/],
    ['failed prior path probe', { priorChangeSetPaths: null }, /previous change-set path probe failed/],
    ['failed line-stat probe', { deltaFileStats: null }, /delta line-stat probe failed/],
] as const) {
    void test(`code-review scope: ${name} forces full`, () => {
        const result = resolveCodeReviewScope({ ...reviewFacts, ...override });
        assert.equal(result.scope, 'full');
        assert.equal(result.base, 'main');
        assert.match(result.reason, reason);
    });
}

void test('code-review scope: normal delta and exact line boundary', () => {
    assert.deepEqual(resolveCodeReviewScope(reviewFacts), { scope: 'delta', base: 'a'.repeat(40), reason: 'delta' });
    assert.equal(resolveCodeReviewScope({ ...reviewFacts,
        deltaFileStats: [{ path: 'src/a.ts', added: CODE_REVIEW_DELTA_LINE_THRESHOLD, deleted: 0 }],
    }).scope, 'delta');
});

void test('code-review scope excludes task artifacts and telemetry from paths and line count', () => {
    const result = resolveCodeReviewScope({ ...reviewFacts,
        deltaPaths: ['tasks/work/handoff.md', 'docs/lessons-learned.md', 'src/a.ts'],
        deltaFileStats: [
            { path: 'tasks/work/handoff.md', added: 800, deleted: 0 },
            { path: 'docs/lessons-learned.md', added: 800, deleted: 0 },
            { path: 'src/a.ts', added: 1, deleted: 0 },
        ],
    });
    assert.equal(result.scope, 'delta');
});

const TEST_CONFIG: PolicyConfig = {
    claudeModelSpec: null,
    claudeModelPlan: null,
    claudeModelReview: null,
    claudeModelReviewLarge: null,
    claudeModelQa: null,
    claudeModelLight: null,
    claudeModelStrong: null,
    claudeModelLegacy: null,
    codexModelMini: 'mini',
    codexModelFull: 'full',
    maxReviewLoops: null,
    claudeBudget: null,
};

const s = (task_size: TaskSize, delicate = false): PolicyInput => ({ task_size, delicate });

function loadPolicyConfig(raw: string): { config: PolicyConfig; stderr: string } {
    const policyUrl = pathToFileURL(path.join(process.cwd(), 'src/orchestrator/policy.ts')).href;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--eval', [
        `import(${JSON.stringify(policyUrl)})`,
        ".then(m => console.log(JSON.stringify(m.policyConfig())))",
        '.catch(error => { console.error(error); process.exit(1); });',
    ].join('')], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, MAX_REVIEW_LOOPS: raw },
    });
    assert.equal(result.status, 0, result.stderr);
    return {
        config: JSON.parse(result.stdout.trim()) as PolicyConfig,
        stderr: result.stderr,
    };
}

// ── Tier / sizing / plan-combined / loop-cap routing ───────────────────────

type RoutingRow = {
    name: string;
    tasks: PolicyInput[];
    tier: 'fast' | 'full';
    nominal: TaskSize;
    effective: TaskSize;
    planCombined: boolean;
    maxLoops: number;
};

const ROUTING_TABLE: RoutingRow[] = [
    // Single-task: size × delicate
    { name: 'XS non-delicate', tasks: [s('XS')],       tier: 'fast', nominal: 'XS', effective: 'XS', planCombined: true,  maxLoops: 3 },
    { name: 'XS delicate',     tasks: [s('XS', true)], tier: 'full', nominal: 'XS', effective: 'XL', planCombined: false, maxLoops: 3 },
    { name: 'S non-delicate',  tasks: [s('S')],        tier: 'full', nominal: 'S',  effective: 'S',  planCombined: false, maxLoops: 3 },
    { name: 'S delicate',      tasks: [s('S', true)],  tier: 'full', nominal: 'S',  effective: 'XL', planCombined: false, maxLoops: 3 },
    { name: 'M non-delicate',  tasks: [s('M')],        tier: 'full', nominal: 'M',  effective: 'M',  planCombined: false, maxLoops: 3 },
    { name: 'M delicate',      tasks: [s('M', true)],  tier: 'full', nominal: 'M',  effective: 'XL', planCombined: false, maxLoops: 3 },
    { name: 'L non-delicate',  tasks: [s('L')],        tier: 'full', nominal: 'L',  effective: 'L',  planCombined: false, maxLoops: 5 },
    { name: 'L delicate',      tasks: [s('L', true)],  tier: 'full', nominal: 'L',  effective: 'XL', planCombined: false, maxLoops: 5 },
    { name: 'XL non-delicate', tasks: [s('XL')],       tier: 'full', nominal: 'XL', effective: 'XL', planCombined: false, maxLoops: 5 },
    { name: 'XL delicate',     tasks: [s('XL', true)], tier: 'full', nominal: 'XL', effective: 'XL', planCombined: false, maxLoops: 5 },

    // Bundles: max scope wins for nominal; any delicate promotes effective to XL
    { name: 'bundle [XS, XS]',                tasks: [s('XS'), s('XS')],             tier: 'fast', nominal: 'XS', effective: 'XS', planCombined: true,  maxLoops: 3 },
    { name: 'bundle [XS, S]',                 tasks: [s('XS'), s('S')],              tier: 'full', nominal: 'S',  effective: 'S',  planCombined: false, maxLoops: 3 },
    { name: 'bundle [XS, M]',                 tasks: [s('XS'), s('M')],              tier: 'full', nominal: 'M',  effective: 'M',  planCombined: false, maxLoops: 3 },
    { name: 'bundle [S, S]',                  tasks: [s('S'), s('S')],               tier: 'full', nominal: 'S',  effective: 'S',  planCombined: false, maxLoops: 3 },
    { name: 'bundle [S, M]',                  tasks: [s('S'), s('M')],               tier: 'full', nominal: 'M',  effective: 'M',  planCombined: false, maxLoops: 3 },
    { name: 'bundle [S, L]',                  tasks: [s('S'), s('L')],               tier: 'full', nominal: 'L',  effective: 'L',  planCombined: false, maxLoops: 5 },
    { name: 'bundle [M, XL]',                 tasks: [s('M'), s('XL')],              tier: 'full', nominal: 'XL', effective: 'XL', planCombined: false, maxLoops: 5 },
    { name: 'bundle [S, S-delicate]',         tasks: [s('S'), s('S', true)],         tier: 'full', nominal: 'S',  effective: 'XL', planCombined: false, maxLoops: 3 },
    { name: 'bundle [M, S-delicate]',         tasks: [s('M'), s('S', true)],         tier: 'full', nominal: 'M',  effective: 'XL', planCombined: false, maxLoops: 3 },
    { name: 'bundle [L, M-delicate]',         tasks: [s('L'), s('M', true)],         tier: 'full', nominal: 'L',  effective: 'XL', planCombined: false, maxLoops: 5 },

    // Missing task_size defaults to M (matches legacy behavior in run-task.ts)
    { name: 'undefined task_size defaults to M', tasks: [{ delicate: false }], tier: 'full', nominal: 'M', effective: 'M', planCombined: false, maxLoops: 3 },
];

for (const row of ROUTING_TABLE) {
    void test(`policy: ${row.name}`, () => {
        const p = getPipelinePolicy(row.tasks, TEST_CONFIG);
        assert.equal(p.tier, row.tier, 'tier');
        assert.equal(p.nominalSize, row.nominal, 'nominalSize');
        assert.equal(p.effectiveSize, row.effective, 'effectiveSize');
        assert.equal(p.planCombined, row.planCombined, 'planCombined');
        assert.equal(p.maxReviewLoops, row.maxLoops, 'maxReviewLoops');
    });
}

// ── MAX_REVIEW_LOOPS env override applies uniformly across sizes ───────────

void test('policy: MAX_REVIEW_LOOPS override overrides size-aware default', () => {
    for (const size of ['XS', 'S', 'M', 'L', 'XL'] as TaskSize[]) {
        const p = getPipelinePolicy([s(size)], { ...TEST_CONFIG, maxReviewLoops: 5 });
        assert.equal(p.maxReviewLoops, 5, `size ${size} honors override`);
    }
});

void test('policy: MAX_REVIEW_LOOPS=0 is a valid (suicidal) override', () => {
    // Not "null coalesces to default" — 0 is a distinct value the env override
    // can set. Guards against regressions that use `??` vs `||` inversions.
    const p = getPipelinePolicy([s('L')], { ...TEST_CONFIG, maxReviewLoops: 0 });
    assert.equal(p.maxReviewLoops, 0);
});

void test('policy config rejects malformed or negative MAX_REVIEW_LOOPS and preserves zero', () => {
    for (const raw of ['abc', '-1', '1.5', '2junk']) {
        const loaded = loadPolicyConfig(raw);
        assert.equal(loaded.config.maxReviewLoops, null, raw);
        assert.equal(getPipelinePolicy([s('M')], loaded.config).maxReviewLoops, 3, raw);
        assert.match(loaded.stderr, new RegExp(`Invalid MAX_REVIEW_LOOPS value .*${raw.replace('.', '\\.')}`));
    }
    const zero = loadPolicyConfig('0');
    assert.equal(zero.config.maxReviewLoops, 0);
    assert.doesNotMatch(zero.stderr, /Invalid MAX_REVIEW_LOOPS/);
});

// ── CLAUDE_BUDGET env override / tiered defaults ──────────────────────────

type BudgetRow = { name: string; tasks: PolicyInput[]; singlePass: string; codeReview: string };

const BUDGET_TABLE: BudgetRow[] = [
    { name: 'XS non-delicate', tasks: [s('XS')], singlePass: '5.00', codeReview: '5.00' },
    { name: 'S non-delicate', tasks: [s('S')], singlePass: '5.00', codeReview: '10.00' },
    { name: 'M non-delicate', tasks: [s('M')], singlePass: '10.00', codeReview: '15.00' },
    { name: 'L non-delicate', tasks: [s('L')], singlePass: '10.00', codeReview: '20.00' },
    { name: 'XL non-delicate', tasks: [s('XL')], singlePass: '20.00', codeReview: '40.00' },
    { name: 'M delicate', tasks: [s('M', true)], singlePass: '20.00', codeReview: '40.00' },
];

for (const row of BUDGET_TABLE) {
    void test(`claude budget: ${row.name} when CLAUDE_BUDGET unset`, () => {
        const p = getPipelinePolicy(row.tasks, TEST_CONFIG);
        assert.equal(p.claude('spec').budget, row.singlePass, 'spec');
        assert.equal(p.claude('plan').budget, row.singlePass, 'plan');
        assert.equal(p.claude('qa').budget, row.singlePass, 'qa');
        assert.equal(p.claude('code_review').budget, row.codeReview, 'code_review');
    });
}

void test('claude budget: CLAUDE_BUDGET flat override wins for every effective size and phase', () => {
    const cfg: PolicyConfig = { ...TEST_CONFIG, claudeBudget: '20.00' };
    for (const row of BUDGET_TABLE) {
        const p = getPipelinePolicy(row.tasks, cfg);
        assert.equal(p.claude('spec').budget, '20.00', row.name);
        assert.equal(p.claude('plan').budget, '20.00', row.name);
        assert.equal(p.claude('qa').budget, '20.00', row.name);
        assert.equal(p.claude('code_review').budget, '20.00', row.name);
    }
});

// ── Codex model/effort matrix (phase × effectiveSize) ──────────────────────

type CodexRow = {
    phase: CodexPhase;
    size: TaskSize;
    expected: { model: string; effort: string };
};

const CODEX_MATRIX: CodexRow[] = [
    // spec_review
    { phase: 'spec_review', size: 'XS', expected: { model: 'mini', effort: 'medium' } },
    { phase: 'spec_review', size: 'S',  expected: { model: 'mini', effort: 'medium' } },
    { phase: 'spec_review', size: 'M',  expected: { model: 'mini', effort: 'high' } },  // raised from medium 2026-07: M's reroute severity tracked its lighter spec_review effort
    { phase: 'spec_review', size: 'L',  expected: { model: 'mini', effort: 'high' } },
    { phase: 'spec_review', size: 'XL', expected: { model: 'full', effort: 'high' } },
    // implement
    { phase: 'implement',   size: 'XS', expected: { model: 'mini', effort: 'medium' } },
    { phase: 'implement',   size: 'S',  expected: { model: 'mini', effort: 'medium' } },
    { phase: 'implement',   size: 'M',  expected: { model: 'mini', effort: 'high' } },
    { phase: 'implement',   size: 'L',  expected: { model: 'mini', effort: 'high' } },
    { phase: 'implement',   size: 'XL', expected: { model: 'full', effort: 'high' } },  // re-baselined 2026-06: was xhigh (GPT-5.5 overthinks at xhigh w/ open-ended tools)
    // code_review (cold-Codex review lens)
    { phase: 'code_review', size: 'XS', expected: { model: 'mini', effort: 'high' } },
    { phase: 'code_review', size: 'S',  expected: { model: 'mini', effort: 'high' } },
    { phase: 'code_review', size: 'M',  expected: { model: 'mini', effort: 'high' } },
    { phase: 'code_review', size: 'L',  expected: { model: 'mini', effort: 'high' } },
    { phase: 'code_review', size: 'XL', expected: { model: 'mini', effort: 'high' } },
];

for (const row of CODEX_MATRIX) {
    void test(`codex matrix: ${row.phase} × ${row.size} → ${row.expected.model}/${row.expected.effort}`, () => {
        const p = getPipelinePolicy([s(row.size)], TEST_CONFIG);
        assert.deepEqual(p.codex(row.phase), row.expected);
    });
}

void test('codex matrix: delicate M uses XL row (effective size)', () => {
    const p = getPipelinePolicy([s('M', true)], TEST_CONFIG);
    assert.deepEqual(p.codex('implement'), { model: 'full', effort: 'high' });
    assert.deepEqual(p.codex('spec_review'), { model: 'full', effort: 'high' });
    assert.deepEqual(p.codex('code_review'), { model: 'mini', effort: 'high' });
});

// ── Claude model/effort matrix ──────────────────────────────────────────────

const CLAUDE_MATRIX_TABLE: Array<{ phase: ClaudePhase; size: TaskSize; model: string; effort: string }> = [
    ...(['spec', 'plan', 'code_review'] as ClaudePhase[]).flatMap((phase): Array<{ phase: ClaudePhase; size: TaskSize; model: string; effort: string }> => [
        { phase, size: 'XS', model: 'sonnet', effort: 'medium' },
        { phase, size: 'S', model: 'sonnet', effort: 'medium' },
        { phase, size: 'M', model: 'opus', effort: 'medium' },
        { phase, size: 'L', model: 'opus', effort: 'medium' },
        { phase, size: 'XL', model: 'opus', effort: 'high' },
    ]),
    ...(['XS', 'S', 'M', 'L', 'XL'] as TaskSize[]).map((size): { phase: ClaudePhase; size: TaskSize; model: string; effort: string } =>
        ({ phase: 'qa', size, model: 'sonnet', effort: 'medium' })),
];

for (const row of CLAUDE_MATRIX_TABLE) {
    void test(`claude matrix: ${row.phase} × ${row.size} → ${row.model}/${row.effort}`, () => {
        const { model, effort } = getPipelinePolicy([s(row.size)], TEST_CONFIG).claude(row.phase);
        assert.deepEqual({ model, effort }, { model: row.model, effort: row.effort });
    });
}

void test('claude matrix: delicate M promotes spec, plan, and review, but not qa', () => {
    const policy = getPipelinePolicy([s('M', true)], TEST_CONFIG);
    for (const phase of ['spec', 'plan', 'code_review'] as ClaudePhase[]) {
        const { model, effort } = policy.claude(phase);
        assert.deepEqual({ model, effort }, { model: 'opus', effort: 'high' }, phase);
    }
    const { model, effort } = policy.claude('qa');
    assert.deepEqual({ model, effort }, { model: 'sonnet', effort: 'medium' });
});

void test('claude matrix: every effort is medium or high', () => {
    for (const row of CLAUDE_MATRIX_TABLE) {
        const effort = getPipelinePolicy([s(row.size)], TEST_CONFIG).claude(row.phase).effort;
        assert.ok(effort === 'medium' || effort === 'high', `${row.phase}/${row.size}: ${effort}`);
    }
    for (const phase of ['spec', 'plan', 'code_review', 'qa'] as ClaudePhase[]) {
        const effort = getPipelinePolicy([s('M', true)], TEST_CONFIG).claude(phase).effort;
        assert.ok(effort === 'medium' || effort === 'high', `delicate/${phase}: ${effort}`);
    }
});

// ── Override precedence ────────────────────────────────────────────────────

const CLAUDE_MODEL_ENV_VARS = [
    'CLAUDE_MODEL', 'CLAUDE_MODEL_SPEC', 'CLAUDE_MODEL_PLAN', 'CLAUDE_MODEL_REVIEW',
    'CLAUDE_MODEL_REVIEW_LARGE', 'CLAUDE_MODEL_QA', 'CLAUDE_MODEL_LIGHT', 'CLAUDE_MODEL_STRONG',
];

function loadPolicyConfigForEnv(overrides: Record<string, string>): PolicyConfig {
    const policyUrl = pathToFileURL(path.join(process.cwd(), 'src/orchestrator/policy.ts')).href;
    const env = { ...process.env };
    for (const key of CLAUDE_MODEL_ENV_VARS) delete env[key];
    Object.assign(env, overrides);
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--eval', [
        `import(${JSON.stringify(policyUrl)})`,
        '.then(m => console.log(JSON.stringify(m.policyConfig())))',
        '.catch(error => { console.error(error); process.exit(1); });',
    ].join('')], { cwd: process.cwd(), encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(result.stdout.trim()) as PolicyConfig;
    for (const row of CLAUDE_MATRIX_TABLE) {
        const effort = getPipelinePolicy([s(row.size)], config).claude(row.phase).effort;
        assert.equal(effort, row.effort, `${row.phase}/${row.size}: overrides never change effort`);
    }
    return config;
}

void test('override precedence: no Claude model variables uses defaults', () => {
    const config = loadPolicyConfigForEnv({});
    assert.equal(getPipelinePolicy([s('XS')], config).claude('spec').model, 'sonnet');
    assert.equal(getPipelinePolicy([s('M')], config).claude('spec').model, 'opus');
    assert.equal(getPipelinePolicy([s('XL')], config).claude('spec').effort, 'high');
    assert.equal(getPipelinePolicy([s('M')], config).claude('qa').model, 'sonnet');
});

void test('override precedence: empty tier model values are treated as unset', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL_LIGHT: '', CLAUDE_MODEL_STRONG: '' });
    for (const row of CLAUDE_MATRIX_TABLE) {
        assert.equal(getPipelinePolicy([s(row.size)], config).claude(row.phase).model, row.model, `${row.phase}/${row.size}`);
    }
});

void test('override precedence: light tier variable only changes light cells', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL_LIGHT: 'custom-light' });
    for (const row of CLAUDE_MATRIX_TABLE) {
        const expected = row.model === 'sonnet' ? 'custom-light' : row.model;
        assert.equal(getPipelinePolicy([s(row.size)], config).claude(row.phase).model, expected, `${row.phase}/${row.size}`);
    }
});

void test('override precedence: strong tier variable only changes strong cells', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL_STRONG: 'custom-strong' });
    for (const row of CLAUDE_MATRIX_TABLE) {
        const expected = row.model === 'opus' ? 'custom-strong' : row.model;
        assert.equal(getPipelinePolicy([s(row.size)], config).claude(row.phase).model, expected, `${row.phase}/${row.size}`);
    }
    for (const phase of ['spec', 'plan', 'code_review'] as ClaudePhase[]) {
        assert.equal(getPipelinePolicy([s('M', true)], config).claude(phase).model, 'custom-strong', `delicate/${phase}`);
    }
    assert.equal(getPipelinePolicy([s('M', true)], config).claude('qa').model, 'sonnet');
});

for (const [variable, phase] of [
    ['CLAUDE_MODEL_SPEC', 'spec'], ['CLAUDE_MODEL_PLAN', 'plan'], ['CLAUDE_MODEL_QA', 'qa'],
] as const) {
    void test(`override precedence: ${variable} pins ${phase} at every size`, () => {
        const config = loadPolicyConfigForEnv({ [variable]: 'pinned' });
        for (const row of CLAUDE_MATRIX_TABLE) {
            const policy = getPipelinePolicy([s(row.size)], config);
            assert.equal(policy.claude(row.phase).model, row.phase === phase ? 'pinned' : row.model, `${row.phase}/${row.size}`);
            assert.equal(policy.claude(row.phase).effort, row.effort, `${row.phase}/${row.size}`);
        }
    });
}

void test('override precedence: review pin covers XS–L only', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL_REVIEW: 'pinned-review' });
    for (const row of CLAUDE_MATRIX_TABLE) {
        const expected = row.phase === 'code_review' && row.size !== 'XL' ? 'pinned-review' : row.model;
        assert.equal(getPipelinePolicy([s(row.size)], config).claude(row.phase).model, expected, `${row.phase}/${row.size}`);
    }
    assert.equal(getPipelinePolicy([s('M', true)], config).claude('code_review').model, 'opus');
});

void test('override precedence: large review pin covers XL and delicate only', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL_REVIEW_LARGE: 'pinned-large' });
    for (const row of CLAUDE_MATRIX_TABLE) {
        const expected = row.phase === 'code_review' && row.size === 'XL' ? 'pinned-large' : row.model;
        assert.equal(getPipelinePolicy([s(row.size)], config).claude(row.phase).model, expected, `${row.phase}/${row.size}`);
    }
    assert.equal(getPipelinePolicy([s('M', true)], config).claude('code_review').model, 'pinned-large');
});

void test('override precedence: legacy model alone covers every cell', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL: 'legacy-model' });
    for (const row of CLAUDE_MATRIX_TABLE) {
        const policy = getPipelinePolicy([s(row.size)], config);
        assert.equal(policy.claude(row.phase).model, 'legacy-model');
        assert.equal(policy.claude(row.phase).effort, row.effort);
    }
});

void test('override precedence: tier variable beats legacy only for its cells', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL: 'legacy', CLAUDE_MODEL_LIGHT: 'light' });
    for (const row of CLAUDE_MATRIX_TABLE) {
        const expected = row.model === 'sonnet' ? 'light' : 'legacy';
        assert.equal(getPipelinePolicy([s(row.size)], config).claude(row.phase).model, expected, `${row.phase}/${row.size}`);
    }
});

void test('override precedence: strong tier variable beats legacy only for its cells', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL: 'legacy', CLAUDE_MODEL_STRONG: 'strong' });
    for (const row of CLAUDE_MATRIX_TABLE) {
        const expected = row.model === 'opus' ? 'strong' : 'legacy';
        assert.equal(getPipelinePolicy([s(row.size)], config).claude(row.phase).model, expected, `${row.phase}/${row.size}`);
    }
    for (const phase of ['spec', 'plan', 'code_review'] as ClaudePhase[]) {
        assert.equal(getPipelinePolicy([s('M', true)], config).claude(phase).model, 'strong', `delicate/${phase}`);
    }
});

void test('override precedence: phase pin beats tier variable', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL_LIGHT: 'light', CLAUDE_MODEL_SPEC: 'pinned-spec' });
    assert.equal(getPipelinePolicy([s('XS')], config).claude('spec').model, 'pinned-spec');
    assert.equal(getPipelinePolicy([s('XS')], config).claude('qa').model, 'light');
});

void test('override precedence: custom model string passes through verbatim', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL_STRONG: 'claude-opus-5-5' });
    const { model, effort } = getPipelinePolicy([s('M')], config).claude('spec');
    assert.deepEqual({ model, effort }, { model: 'claude-opus-5-5', effort: 'medium' });
});

void test('legacy warning names tier variables and every-phase fallback', () => {
    const entry = LEGACY_FALLBACK_ENV_VARS.find(candidate => candidate.old === 'CLAUDE_MODEL');
    assert.ok(entry);
    assert.match(entry.replacement, /CLAUDE_MODEL_LIGHT/);
    assert.match(entry.replacement, /CLAUDE_MODEL_STRONG/);
    assert.match(entry.replacement, /fallback for every Claude phase/);
    assert.doesNotMatch(entry.replacement, /not applied to qa/);
});

// ── Standalone helpers (detectTier, isPlanCombined, size helpers) ──────────
//
// These are the same logic reached through getPipelinePolicy but exposed for
// callsites that don't build a full policy. Tests pin their behavior so
// future refactors can't silently diverge the two surfaces.

void test('detectTier: XS-only bundle is fast, any other size/delicate is full', () => {
    assert.equal(detectTier([s('XS')]), 'fast');
    assert.equal(detectTier([s('XS'), s('XS')]), 'fast');
    assert.equal(detectTier([s('XS', true)]), 'full');
    assert.equal(detectTier([s('S')]), 'full');
    assert.equal(detectTier([s('M')]), 'full');
    assert.equal(detectTier([s('XS'), s('S')]), 'full');
    assert.equal(detectTier([s('XS'), s('M')]), 'full');
    assert.equal(detectTier([s('S'), s('M')]), 'full');
});

void test('isPlanCombined: only XS non-delicate', () => {
    assert.equal(isPlanCombined(s('XS')), true);
    assert.equal(isPlanCombined(s('XS', true)), false);
    assert.equal(isPlanCombined(s('S')), false);
    assert.equal(isPlanCombined(s('M')), false);
    assert.equal(isPlanCombined(s('XL')), false);
});

void test('getNominalSize / getEffectiveSize: scope vs scope+delicate', () => {
    assert.equal(getNominalSize([s('XS')]), 'XS');
    assert.equal(getEffectiveSize([s('XS')]), 'XS');
    assert.equal(getEffectiveSize([s('XS', true)]), 'XL');
    assert.equal(getNominalSize([s('M', true)]), 'M');
    assert.equal(getEffectiveSize([s('M', true)]), 'XL');
    assert.equal(getNominalSize([s('S'), s('L')]), 'L');
    assert.equal(getEffectiveSize([s('S'), s('L')]), 'L');
});

void test('defaultMaxReviewLoops: 3 for XS/S/M, 5 for L/XL', () => {
    assert.equal(defaultMaxReviewLoops('XS'), 3);
    assert.equal(defaultMaxReviewLoops('S'), 3);
    assert.equal(defaultMaxReviewLoops('M'), 3);
    assert.equal(defaultMaxReviewLoops('L'), 5);
    assert.equal(defaultMaxReviewLoops('XL'), 5);
});

// ── Empty input (defensive — retry path builds a minimal task list) ────────

void test('policy: empty task list falls back to XS/fast tier', () => {
    // An empty list shouldn't crash. Today it resolves to `XS` nominal/effective
    // (no delicate = no promotion, no non-XS = fast tier). Not a real runtime case.
    const p = getPipelinePolicy([], TEST_CONFIG);
    assert.equal(p.tier, 'fast');
    assert.equal(p.nominalSize, 'XS');
    assert.equal(p.effectiveSize, 'XS');
    assert.deepEqual(p.claude('spec'), { model: 'sonnet', effort: 'medium', budget: '5.00' });
});
