import test from 'node:test';
import assert from 'node:assert/strict';
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
} from '../scripts/pipeline-policy.ts';

const TEST_CONFIG: PolicyConfig = {
    claudeModelSpec: 'opus',
    claudeModelPlan: 'sonnet',
    claudeModelReview: 'sonnet',
    claudeModelReviewLarge: 'opus',
    claudeModelQa: 'sonnet',
    codexModelMini: 'mini',
    codexModelFull: 'full',
    maxReviewLoops: null,
};

const s = (task_size: TaskSize, delicate = false): PolicyInput => ({ task_size, delicate });

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
    { name: 'S non-delicate',  tasks: [s('S')],        tier: 'fast', nominal: 'S',  effective: 'S',  planCombined: true,  maxLoops: 3 },
    { name: 'S delicate',      tasks: [s('S', true)],  tier: 'full', nominal: 'S',  effective: 'XL', planCombined: false, maxLoops: 3 },
    { name: 'M non-delicate',  tasks: [s('M')],        tier: 'full', nominal: 'M',  effective: 'M',  planCombined: false, maxLoops: 3 },
    { name: 'M delicate',      tasks: [s('M', true)],  tier: 'full', nominal: 'M',  effective: 'XL', planCombined: false, maxLoops: 3 },
    { name: 'L non-delicate',  tasks: [s('L')],        tier: 'full', nominal: 'L',  effective: 'L',  planCombined: false, maxLoops: 5 },
    { name: 'L delicate',      tasks: [s('L', true)],  tier: 'full', nominal: 'L',  effective: 'XL', planCombined: false, maxLoops: 5 },
    { name: 'XL non-delicate', tasks: [s('XL')],       tier: 'full', nominal: 'XL', effective: 'XL', planCombined: false, maxLoops: 5 },
    { name: 'XL delicate',     tasks: [s('XL', true)], tier: 'full', nominal: 'XL', effective: 'XL', planCombined: false, maxLoops: 5 },

    // Bundles: max scope wins for nominal; any delicate promotes effective to XL
    { name: 'bundle [S, S]',                  tasks: [s('S'), s('S')],               tier: 'fast', nominal: 'S',  effective: 'S',  planCombined: true,  maxLoops: 3 },
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
    for (const size of ['S', 'M', 'L', 'XL'] as TaskSize[]) {
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

// ── Codex model/effort matrix (phase × effectiveSize) ──────────────────────

type CodexRow = {
    phase: CodexPhase;
    size: TaskSize;
    expected: { model: string; effort: string };
};

const CODEX_MATRIX: CodexRow[] = [
    // spec_review
    { phase: 'spec_review', size: 'S',  expected: { model: 'mini', effort: 'medium' } },
    { phase: 'spec_review', size: 'M',  expected: { model: 'mini', effort: 'medium' } },
    { phase: 'spec_review', size: 'L',  expected: { model: 'mini', effort: 'high' } },
    { phase: 'spec_review', size: 'XL', expected: { model: 'full', effort: 'high' } },
    // implement
    { phase: 'implement',   size: 'S',  expected: { model: 'mini', effort: 'medium' } },
    { phase: 'implement',   size: 'M',  expected: { model: 'mini', effort: 'high' } },
    { phase: 'implement',   size: 'L',  expected: { model: 'mini', effort: 'high' } },
    { phase: 'implement',   size: 'XL', expected: { model: 'full', effort: 'xhigh' } },
];

for (const row of CODEX_MATRIX) {
    void test(`codex matrix: ${row.phase} × ${row.size} → ${row.expected.model}/${row.expected.effort}`, () => {
        const p = getPipelinePolicy([s(row.size)], TEST_CONFIG);
        assert.deepEqual(p.codex(row.phase), row.expected);
    });
}

void test('codex matrix: delicate M uses XL row (effective size)', () => {
    const p = getPipelinePolicy([s('M', true)], TEST_CONFIG);
    assert.deepEqual(p.codex('implement'), { model: 'full', effort: 'xhigh' });
    assert.deepEqual(p.codex('spec_review'), { model: 'full', effort: 'high' });
});

// ── Claude model/effort matrix ──────────────────────────────────────────────
//
// Most Claude phases use one model across all sizes — varying effort, not
// model — so we pin them at a representative size (M). code_review is the
// exception: it splits model by size (small for S/M, large for L/XL) so the
// matrix below enumerates every size.

type ClaudeRow = { phase: ClaudePhase; expected: { model: string; effort: string } };
const CLAUDE_TABLE: ClaudeRow[] = [
    { phase: 'spec', expected: { model: 'opus',   effort: 'high'   } },
    { phase: 'plan', expected: { model: 'sonnet', effort: 'high'   } },
    { phase: 'qa',   expected: { model: 'sonnet', effort: 'medium' } },
];

for (const row of CLAUDE_TABLE) {
    void test(`claude model: ${row.phase} → ${row.expected.model}/${row.expected.effort}`, () => {
        const p = getPipelinePolicy([s('M')], TEST_CONFIG);
        assert.deepEqual(p.claude(row.phase), row.expected);
    });
}

type CodeReviewRow = { size: TaskSize; expected: { model: string; effort: string } };
const CODE_REVIEW_TABLE: CodeReviewRow[] = [
    { size: 'S',  expected: { model: 'sonnet', effort: 'medium' } },
    { size: 'M',  expected: { model: 'sonnet', effort: 'high'   } },
    { size: 'L',  expected: { model: 'opus',   effort: 'high'   } },
    { size: 'XL', expected: { model: 'opus',   effort: 'xhigh'  } },
];

for (const row of CODE_REVIEW_TABLE) {
    void test(`claude model: code_review × ${row.size} → ${row.expected.model}/${row.expected.effort}`, () => {
        const p = getPipelinePolicy([s(row.size)], TEST_CONFIG);
        assert.deepEqual(p.claude('code_review'), row.expected);
    });
}

void test('claude model: delicate M code_review uses XL slot (large model + xhigh)', () => {
    const p = getPipelinePolicy([s('M', true)], TEST_CONFIG);
    assert.deepEqual(p.claude('code_review'), { model: 'opus', effort: 'xhigh' });
});

// ── Standalone helpers (detectTier, isPlanCombined, size helpers) ──────────
//
// These are the same logic reached through getPipelinePolicy but exposed for
// callsites that don't build a full policy. Tests pin their behavior so
// future refactors can't silently diverge the two surfaces.

void test('detectTier: S-only bundle is fast, any other size/delicate is full', () => {
    assert.equal(detectTier([s('S')]), 'fast');
    assert.equal(detectTier([s('S'), s('S')]), 'fast');
    assert.equal(detectTier([s('S', true)]), 'full');
    assert.equal(detectTier([s('M')]), 'full');
    assert.equal(detectTier([s('S'), s('M')]), 'full');
});

void test('isPlanCombined: only S non-delicate', () => {
    assert.equal(isPlanCombined(s('S')), true);
    assert.equal(isPlanCombined(s('S', true)), false);
    assert.equal(isPlanCombined(s('M')), false);
    assert.equal(isPlanCombined(s('XL')), false);
});

void test('getNominalSize / getEffectiveSize: scope vs scope+delicate', () => {
    assert.equal(getNominalSize([s('M', true)]), 'M');
    assert.equal(getEffectiveSize([s('M', true)]), 'XL');
    assert.equal(getNominalSize([s('S'), s('L')]), 'L');
    assert.equal(getEffectiveSize([s('S'), s('L')]), 'L');
});

void test('defaultMaxReviewLoops: 3 for S/M, 5 for L/XL', () => {
    assert.equal(defaultMaxReviewLoops('S'), 3);
    assert.equal(defaultMaxReviewLoops('M'), 3);
    assert.equal(defaultMaxReviewLoops('L'), 5);
    assert.equal(defaultMaxReviewLoops('XL'), 5);
});

// ── Empty input (defensive — retry path builds a minimal task list) ────────

void test('policy: empty task list falls back to S/fast tier', () => {
    // An empty list shouldn't crash. Today it resolves to `S` nominal/effective
    // (no delicate = no promotion, no non-S = fast tier). Not a real runtime case.
    const p = getPipelinePolicy([], TEST_CONFIG);
    assert.equal(p.tier, 'fast');
    assert.equal(p.nominalSize, 'S');
    assert.equal(p.effectiveSize, 'S');
    assert.deepEqual(p.claude('spec'), { model: 'opus', effort: 'medium' });
});
