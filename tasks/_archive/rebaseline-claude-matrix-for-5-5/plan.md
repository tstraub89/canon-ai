# Plan: rebaseline-claude-matrix-for-5-5

> Spec review verdict: **Approved** (no nits, no changes requested — implement as written).

## Step 0 — Read before touching code

- `src/lib/pipeline-policy.ts` (current `claudeMatrix`, `claudeModelFor`, `PolicyConfig` at :85-106, :254-309)
- `src/orchestrator/policy.ts` (current `config`/`policyConfig()`)
- `src/orchestrator/env.ts` (`LEGACY_FALLBACK_ENV_VARS` at :73-77, duplicate `config` block at :143-155)
- `tests/pipeline-policy.test.ts` (`TEST_CONFIG` :74-84, `loadPolicyConfig` :88-104, `CLAUDE_TABLE` :271-282, `CODE_REVIEW_TABLE` :285-298, delicate-M test :300-303, empty-list test :350-358)
- `docs/pipeline-orchestrator.md` §"Claude Model/Effort Matrix" region (Environment Variables table :239-256, tuning sentence :241)
- `docs/product-context.md:91`, `README.md:89`, `docs/decisions.md` (2026-06 and 2026-09 Codex re-baseline entries as format references)

Confirmed during spec/plan research (no further verification needed at implement time):
- `src/orchestrator/env.ts`'s duplicate `config` object's `claudeModel*`/`codexModel*`/`claudeBudget`/`maxReviewLoops` fields have **no** external readers — only `config.projectName` (`src/orchestrator/prompts/index.ts`) and `config.maxContextBytes` (`src/orchestrator/context.ts`) are consumed outside `env.ts`. Both must be preserved.
- `docs/product-context.md` and `README.md` are **not** in `CANON_OWNED`/`DELIMITED` (`src/lib/canon-owned.ts`) — no `templates/` mirror needed for those two edits. `docs/pipeline-orchestrator.md` **is** managed — its `templates/` mirror regenerates via `npm run sync-templates`. `docs/decisions.md` is deliberately root-only (no mirror), per `docs/patterns.md` "Declare `templates/` mirrors..." pitfall.
- `rg -ln "process\.env\.CLAUDE_MODEL" src/` today hits both `policy.ts` and `env.ts`; after Step 3 removes the duplicate block, only `policy.ts` will match, per AC-4.
- `main.ts`'s dry-run listing (:1451) and retry path (:3130) call `splitPolicy.getClaudeConfig(phase, tasks)` — no caller-side change needed; they pick up the new matrix automatically.

## Step 1 — `src/lib/pipeline-policy.ts`: new `PolicyConfig` shape

Replace the `PolicyConfig` type (current :85-106). Per-phase fields become **nullable pins** (no default baked in), two new nullable tier fields are added, and the legacy catch-all becomes its own nullable field (previously it was silently merged into each per-phase field at the `policy.ts` layer — that merge moves out, since precedence is now pin → tier-var → legacy → default, and only `pipeline-policy.ts` should encode that ordering per the "one resolver" rule... note the *env resolution* of raw strings still happens in `policy.ts`; what changes here is that `policy.ts` no longer merges legacy/default into the per-phase strings — it just forwards each raw env value as-is, nullable):

```ts
export type PolicyConfig = {
    // Per-phase pins. Non-null overrides the model outright for that phase
    // (code_review splits the pin by size — see resolveClaudeModel). Effort
    // never comes from a pin; it's always the phase/size cell's own value.
    claudeModelSpec: string | null;
    claudeModelPlan: string | null;
    claudeModelReview: string | null;       // code_review pin, XS–L only
    claudeModelReviewLarge: string | null;  // code_review pin, XL only
    claudeModelQa: string | null;
    // Tier models. Used when no phase pin applies.
    claudeModelLight: string | null;
    claudeModelStrong: string | null;
    // Legacy catch-all: fallback for every phase when no pin or tier var applies.
    claudeModelLegacy: string | null;
    codexModelMini: string;
    codexModelFull: string;
    maxReviewLoops: number | null;
    claudeBudget: string | null;
};
```

Delete the stale block comment above `claudeModelReviewLarge` (the "History: on Sonnet 4.5..." comment at :89-97) — it documents a decision this task supersedes.

## Step 2 — `src/lib/pipeline-policy.ts`: new matrix builder

Delete `claudeModelFor` (:254-265), `buildHigh`/`buildMedium`/`codeReviewMatrix` and their comments inside `claudeMatrix` (:267-309, including the "code_review splits model by size... Re-baselined 2026-06..." comment block at :288-295). Replace with:

```ts
type ClaudeTier = 'light' | 'strong';

// Tier + effort per phase × size — the Decision table. code_review shares
// spec/plan's shape (light XS/S, strong M/L, strong+high XL); qa is flat
// light/medium regardless of size.
function claudeTierFor(phase: ClaudePhase, size: TaskSize): ClaudeTier {
    if (phase === 'qa') return 'light';
    return size === 'XS' || size === 'S' ? 'light' : 'strong';
}

function claudeEffortFor(phase: ClaudePhase, size: TaskSize): 'medium' | 'high' {
    if (phase === 'qa') return 'medium';
    return size === 'XL' ? 'high' : 'medium';
}

// The phase's pin, per its own scope. code_review is the only phase whose
// pin scope is split by size rather than flat across all five sizes.
function claudePinFor(phase: ClaudePhase, size: TaskSize, config: PolicyConfig): string | null {
    switch (phase) {
        case 'spec': return config.claudeModelSpec;
        case 'plan': return config.claudeModelPlan;
        case 'qa': return config.claudeModelQa;
        case 'code_review':
            return size === 'XL' ? config.claudeModelReviewLarge : config.claudeModelReview;
    }
}

// Precedence: phase pin > tier var (CLAUDE_MODEL_LIGHT/_STRONG) > legacy
// CLAUDE_MODEL > default (sonnet for light, opus for strong). A pin replaces
// the model only — effort always comes from claudeEffortFor.
function resolveClaudeModel(phase: ClaudePhase, size: TaskSize, config: PolicyConfig): string {
    const pin = claudePinFor(phase, size, config);
    if (pin !== null) return pin;
    const tier = claudeTierFor(phase, size);
    const tierModel = tier === 'light' ? config.claudeModelLight : config.claudeModelStrong;
    if (tierModel !== null) return tierModel;
    if (config.claudeModelLegacy !== null) return config.claudeModelLegacy;
    return tier === 'light' ? 'sonnet' : 'opus';
}

function claudeMatrix(config: PolicyConfig): Record<ClaudePhase, Record<TaskSize, ClaudeMatrixConfig>> {
    const phases: readonly ClaudePhase[] = ['spec', 'plan', 'code_review', 'qa'];
    const result = {} as Record<ClaudePhase, Record<TaskSize, ClaudeMatrixConfig>>;
    for (const phase of phases) {
        const row = {} as Record<TaskSize, ClaudeMatrixConfig>;
        for (const size of SIZE_ORDER) {
            row[size] = {
                model: resolveClaudeModel(phase, size, config),
                effort: claudeEffortFor(phase, size),
            };
        }
        result[phase] = row;
    }
    return result;
}
```

`SIZE_ORDER` already exists (:127) and is iterable — reuse it rather than re-listing the five sizes.

No other part of `getPipelinePolicy` (:311-333) changes — `claude: (phase) => ({ ...claudeMat[phase][effectiveSize], budget: ... })` still works unmodified since `claudeMat[phase][effectiveSize]` still yields `{ model, effort }`.

Fix the two other stale comments AC-6 names:
- The `effectiveSize` field comment (:117-118, "Drives model/effort — any auth/Pro/storage-sensitive task gets the full model at xhigh") → rewrite to describe the strong tier at `high`, not "xhigh".
- Leave the Codex-side "xhigh" comment at :218-222 untouched — AC-2's grep explicitly expects it to remain (it's the Codex implement-row comment explaining why Codex XL runs at `high`, not Claude).

## Step 3 — `src/orchestrator/policy.ts`: resolve pins, tier vars, and legacy — no merging

Replace the `config` object and `policyConfig()` body. Each field becomes the raw env value, nullable — no `??` chaining between the Claude-related vars anymore (that ordering now lives entirely in `pipeline-policy.ts`'s `resolveClaudeModel`):

```ts
const config = {
    claudeModelSpec: process.env.CLAUDE_MODEL_SPEC ?? null,
    claudeModelPlan: process.env.CLAUDE_MODEL_PLAN ?? null,
    claudeModelReview: process.env.CLAUDE_MODEL_REVIEW ?? null,
    claudeModelReviewLarge: process.env.CLAUDE_MODEL_REVIEW_LARGE ?? null,
    claudeModelQa: process.env.CLAUDE_MODEL_QA ?? null,
    claudeModelLight: process.env.CLAUDE_MODEL_LIGHT ?? null,
    claudeModelStrong: process.env.CLAUDE_MODEL_STRONG ?? null,
    claudeModelLegacy: process.env.CLAUDE_MODEL ?? null,
    codexModelMini: process.env.CODEX_MODEL_MINI ?? process.env.CODEX_MODEL_DEFAULT ?? 'gpt-6-luna',
    codexModelFull: process.env.CODEX_MODEL_FULL ?? process.env.CODEX_MODEL_DELICATE ?? 'gpt-6-sol',
    maxReviewLoops: parseMaxReviewLoops(process.env.MAX_REVIEW_LOOPS),
    claudeBudget: process.env.CLAUDE_BUDGET ?? null,
};

export function policyConfig(): PolicyConfig {
    return {
        claudeModelSpec: config.claudeModelSpec,
        claudeModelPlan: config.claudeModelPlan,
        claudeModelReview: config.claudeModelReview,
        claudeModelReviewLarge: config.claudeModelReviewLarge,
        claudeModelQa: config.claudeModelQa,
        claudeModelLight: config.claudeModelLight,
        claudeModelStrong: config.claudeModelStrong,
        claudeModelLegacy: config.claudeModelLegacy,
        codexModelMini: config.codexModelMini,
        codexModelFull: config.codexModelFull,
        maxReviewLoops: config.maxReviewLoops,
        claudeBudget: config.claudeBudget,
    };
}
```

The Codex fields and `maxReviewLoops`/`claudeBudget` are unchanged (Non-Goal: no Codex changes). `toPolicyInputs`, `getClaudeConfig`, `getCodexConfig`, `getNominalSize`, `getEffectiveSize`, `getMaxReviewLoops`, `detectTier`, `isPlanCombined`, and the re-exported types (:76-85) all stay as-is — none of them touch the fields that changed shape.

## Step 4 — `src/orchestrator/env.ts`: drop the duplicate block, fix the legacy message

Remove `claudeBudget`, `claudeModelSpec`, `claudeModelPlan`, `claudeModelReview`, `claudeModelReviewLarge`, `claudeModelQa`, `codexModelMini`, `codexModelFull`, `maxReviewLoops` from the exported `config` object (:143-155), keeping only `projectName` and `maxContextBytes`:

```ts
export const config = {
    projectName: resolveProjectName(),
    maxContextBytes: Number.parseInt(process.env.MAX_CONTEXT_BYTES ?? String(64 * 1024), 10),
};
```

Update the `CLAUDE_MODEL` row in `LEGACY_FALLBACK_ENV_VARS` (:74):

```ts
{ old: 'CLAUDE_MODEL', replacement: 'CLAUDE_MODEL_LIGHT / CLAUDE_MODEL_STRONG (still honored as a fallback for every Claude phase, including qa)' },
```

Leave the `CODEX_MODEL_DEFAULT`/`CODEX_MODEL_DELICATE` rows and `LEGACY_IGNORED_ENV_VARS` untouched (Non-Goal: no Codex env changes). `parseMaxReviewLoops`, `warnLegacyEnvVars`, `warnWorktreesRootMismatch`, `resolveProjectName`, `REPO_ROOT`/`TASKS_DIR`/`WORKTREES_ROOT` and everything else in the file is unaffected.

Verify after this step: `rg -n "CLAUDE_MODEL|claudeModel|codexModel|claudeBudget|maxReviewLoops" src/orchestrator/env.ts` returns exactly one line (the `LEGACY_FALLBACK_ENV_VARS` entry above), and `rg -ln "process\.env\.CLAUDE_MODEL" src/` returns only `src/orchestrator/policy.ts`.

## Step 5 — `tests/pipeline-policy.test.ts`: rewrite Claude-cell coverage

1. **`TEST_CONFIG`** (:74-84): update to the new shape, all pins/tier vars/legacy `null` so resolution falls through to the hardcoded defaults:

```ts
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
```

2. **Delete** `CLAUDE_TABLE` and its loop (:270-282), `CODE_REVIEW_TABLE` and its loop (:284-298), the delicate-M code_review test (:300-303), and the two comment blocks describing the old split (:263-268, :288-295 in the source — these live in the test file as the `// ── Claude model/effort matrix ──` header comment and the `CodeReviewRow` section comment).

3. **Add** the AC-1 table-driven replacement — every phase × size against the Decision table (model/effort only; budget is already covered by the separate `BUDGET_TABLE` tests, so don't duplicate it here):

```ts
// ── Claude model/effort matrix ──────────────────────────────────────────────
//
// Three tiers built from two models (light = Sonnet, strong = Opus). spec,
// plan, and code_review share one shape (light XS/S, strong M/L, strong+high
// XL); qa is flat light/medium at every size. See docs/decisions.md
// "Model-generation re-baseline (2026-09): Claude defaults → 5.5 generation".

type ClaudeMatrixRow = { phase: ClaudePhase; size: TaskSize; expected: { model: string; effort: string } };

function claudeSlot(model: string, effort: string): { model: string; effort: string } {
    return { model, effort };
}

const CLAUDE_MATRIX_TABLE: ClaudeMatrixRow[] = (['spec', 'plan', 'code_review'] as ClaudePhase[]).flatMap(phase => [
    { phase, size: 'XS' as TaskSize, expected: claudeSlot('sonnet', 'medium') },
    { phase, size: 'S'  as TaskSize, expected: claudeSlot('sonnet', 'medium') },
    { phase, size: 'M'  as TaskSize, expected: claudeSlot('opus',   'medium') },
    { phase, size: 'L'  as TaskSize, expected: claudeSlot('opus',   'medium') },
    { phase, size: 'XL' as TaskSize, expected: claudeSlot('opus',   'high')   },
]).concat((['XS', 'S', 'M', 'L', 'XL'] as TaskSize[]).map(size => ({
    phase: 'qa' as ClaudePhase, size, expected: claudeSlot('sonnet', 'medium'),
})));

for (const row of CLAUDE_MATRIX_TABLE) {
    void test(`claude matrix: ${row.phase} × ${row.size} → ${row.expected.model}/${row.expected.effort}`, () => {
        const { model, effort } = getPipelinePolicy([s(row.size)], TEST_CONFIG).claude(row.phase);
        assert.deepEqual({ model, effort }, row.expected);
    });
}

void test('claude matrix: delicate M resolves spec/plan/code_review to strong/high, qa to light/medium', () => {
    const p = getPipelinePolicy([s('M', true)], TEST_CONFIG);
    for (const phase of ['spec', 'plan', 'code_review'] as ClaudePhase[]) {
        const { model, effort } = p.claude(phase);
        assert.deepEqual({ model, effort }, { model: 'opus', effort: 'high' }, phase);
    }
    const qa = p.claude('qa');
    assert.deepEqual({ model: qa.model, effort: qa.effort }, { model: 'sonnet', effort: 'medium' });
});
```

(Prefer writing the table as a flat literal array over the `flatMap`/`concat` construction above if it reads more clearly during implementation — either is fine as long as all 20 phase×size cells are covered individually; don't collapse rows into a loop that shares one assertion across phases, since spec/plan/code_review and qa have genuinely different shapes and a shared loop body would hide that.)

4. **Update** the empty-task-list test (:350-358) — the old assertion expected `opus`/`medium`; the new default is `sonnet`/`medium`:

```ts
void test('policy: empty task list falls back to XS/fast tier', () => {
    const p = getPipelinePolicy([], TEST_CONFIG);
    assert.equal(p.tier, 'fast');
    assert.equal(p.nominalSize, 'XS');
    assert.equal(p.effectiveSize, 'XS');
    const spec = p.claude('spec');
    assert.deepEqual({ model: spec.model, effort: spec.effort }, { model: 'sonnet', effort: 'medium' });
});
```

5. **Add** the AC-2 "no xhigh" sweep test:

```ts
void test('claude matrix: effort is never xhigh — only medium or high', () => {
    for (const phase of ['spec', 'plan', 'code_review', 'qa'] as ClaudePhase[]) {
        for (const size of ['XS', 'S', 'M', 'L', 'XL'] as TaskSize[]) {
            const { effort } = getPipelinePolicy([s(size)], TEST_CONFIG).claude(phase);
            assert.ok(effort === 'medium' || effort === 'high', `${phase}/${size}: got ${effort}`);
        }
    }
    const delicateEffort = getPipelinePolicy([s('M', true)], TEST_CONFIG).claude('code_review').effort;
    assert.ok(delicateEffort === 'medium' || delicateEffort === 'high');
});
```

The Codex matrix tests (:228-261, including the `CODEX_MATRIX` table and the "delicate M uses XL row" test) and the routing/budget/loop-cap tests above them are **not touched** — `TEST_CONFIG`'s Codex fields (`codexModelMini`/`codexModelFull`) keep the same values (`'mini'`/`'full'`), so those tests pass unmodified per AC-2's requirement.

## Step 6 — `tests/pipeline-policy.test.ts`: AC-3 override-precedence subprocess tests

Add a second subprocess-config loader alongside the existing `loadPolicyConfig` (which stays, for the `MAX_REVIEW_LOOPS` tests — don't rename or remove it). This one takes an env map, strips every `CLAUDE_MODEL*` var from the inherited environment first (so a variable already set in the shell running `npm test` can't leak into a case that expects it unset), then applies the case's overrides:

```ts
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
        ".then(m => console.log(JSON.stringify(m.policyConfig())))",
        '.catch(error => { console.error(error); process.exit(1); });',
    ].join('')], { cwd: process.cwd(), encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim()) as PolicyConfig;
}
```

Then the precedence cases (each resolves through `getPipelinePolicy(inputs, loadPolicyConfigForEnv(...)).claude(phase)` — never re-check via `policyConfig()` output directly, since the point is the end-to-end resolution):

```ts
// ── Override precedence (AC-3) ─────────────────────────────────────────────

void test('override precedence: no CLAUDE_MODEL* vars set → matrix defaults', () => {
    const config = loadPolicyConfigForEnv({});
    const p = getPipelinePolicy([s('M')], config);
    assert.equal(p.claude('spec').model, 'opus');
    assert.equal(p.claude('code_review').model, 'opus');
    assert.equal(p.claude('qa').model, 'sonnet');
    assert.equal(p.claude('spec').effort, 'medium');
    assert.equal(getPipelinePolicy([s('XL')], config).claude('spec').effort, 'high');
});

void test('override precedence: CLAUDE_MODEL_LIGHT only changes light cells', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL_LIGHT: 'claude-light-x' });
    assert.equal(getPipelinePolicy([s('XS')], config).claude('spec').model, 'claude-light-x');
    assert.equal(getPipelinePolicy([s('XS')], config).claude('qa').model, 'claude-light-x');
    assert.equal(getPipelinePolicy([s('M')], config).claude('spec').model, 'opus');
    assert.equal(getPipelinePolicy([s('M')], config).claude('qa').model, 'claude-light-x');
});

void test('override precedence: CLAUDE_MODEL_STRONG only changes strong cells', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL_STRONG: 'claude-strong-x' });
    assert.equal(getPipelinePolicy([s('M')], config).claude('spec').model, 'claude-strong-x');
    assert.equal(getPipelinePolicy([s('M')], config).claude('code_review').model, 'claude-strong-x');
    assert.equal(getPipelinePolicy([s('M')], config).claude('qa').model, 'sonnet');
    assert.equal(getPipelinePolicy([s('XS')], config).claude('spec').model, 'sonnet');
});

void test('override precedence: CLAUDE_MODEL_SPEC pins spec at every size', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL_SPEC: 'pinned-spec' });
    for (const size of ['XS', 'S', 'M', 'L', 'XL'] as TaskSize[]) {
        assert.equal(getPipelinePolicy([s(size)], config).claude('spec').model, 'pinned-spec', size);
    }
    assert.equal(getPipelinePolicy([s('XL')], config).claude('spec').effort, 'high');
    assert.equal(getPipelinePolicy([s('M')], config).claude('plan').model, 'opus'); // unaffected phase
});

void test('override precedence: CLAUDE_MODEL_PLAN pins plan at every size', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL_PLAN: 'pinned-plan' });
    for (const size of ['XS', 'S', 'M', 'L', 'XL'] as TaskSize[]) {
        assert.equal(getPipelinePolicy([s(size)], config).claude('plan').model, 'pinned-plan', size);
    }
});

void test('override precedence: CLAUDE_MODEL_QA pins qa at every size', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL_QA: 'pinned-qa' });
    for (const size of ['XS', 'S', 'M', 'L', 'XL'] as TaskSize[]) {
        assert.equal(getPipelinePolicy([s(size)], config).claude('qa').model, 'pinned-qa', size);
    }
});

void test('override precedence: CLAUDE_MODEL_REVIEW pins code_review XS–L, not XL', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL_REVIEW: 'pinned-review' });
    for (const size of ['XS', 'S', 'M', 'L'] as TaskSize[]) {
        assert.equal(getPipelinePolicy([s(size)], config).claude('code_review').model, 'pinned-review', size);
    }
    assert.equal(getPipelinePolicy([s('XL')], config).claude('code_review').model, 'opus');
});

void test('override precedence: CLAUDE_MODEL_REVIEW_LARGE pins code_review XL only (incl. delicate promotion)', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL_REVIEW_LARGE: 'pinned-review-large' });
    assert.equal(getPipelinePolicy([s('XL')], config).claude('code_review').model, 'pinned-review-large');
    assert.equal(getPipelinePolicy([s('M', true)], config).claude('code_review').model, 'pinned-review-large');
    assert.equal(getPipelinePolicy([s('M')], config).claude('code_review').model, 'opus');
    assert.equal(getPipelinePolicy([s('XS')], config).claude('code_review').model, 'sonnet');
});

void test('override precedence: legacy CLAUDE_MODEL alone applies to every phase and size', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL: 'legacy-model' });
    for (const phase of ['spec', 'plan', 'code_review', 'qa'] as ClaudePhase[]) {
        for (const size of ['XS', 'S', 'M', 'L', 'XL'] as TaskSize[]) {
            assert.equal(getPipelinePolicy([s(size)], config).claude(phase).model, 'legacy-model', `${phase}/${size}`);
        }
    }
});

void test('override precedence: CLAUDE_MODEL + CLAUDE_MODEL_LIGHT — light cells use the tier var, strong cells use legacy', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL: 'legacy-model', CLAUDE_MODEL_LIGHT: 'light-model' });
    assert.equal(getPipelinePolicy([s('XS')], config).claude('spec').model, 'light-model');
    assert.equal(getPipelinePolicy([s('XS')], config).claude('qa').model, 'light-model');
    assert.equal(getPipelinePolicy([s('M')], config).claude('spec').model, 'legacy-model');
    assert.equal(getPipelinePolicy([s('M')], config).claude('code_review').model, 'legacy-model');
});

void test('override precedence: a phase pin wins over the tier var for the same cell', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL_LIGHT: 'light-model', CLAUDE_MODEL_SPEC: 'pinned-spec' });
    assert.equal(getPipelinePolicy([s('XS')], config).claude('spec').model, 'pinned-spec');
    assert.equal(getPipelinePolicy([s('XS')], config).claude('qa').model, 'light-model');
});

void test('override precedence: a custom model string passes through verbatim', () => {
    const config = loadPolicyConfigForEnv({ CLAUDE_MODEL_STRONG: 'claude-opus-5-5' });
    assert.equal(getPipelinePolicy([s('M')], config).claude('spec').model, 'claude-opus-5-5');
    assert.equal(getPipelinePolicy([s('M')], config).claude('spec').effort, 'medium');
});
```

## Step 7 — `tests/pipeline-policy.test.ts`: AC-4 legacy-message test

Import `LEGACY_FALLBACK_ENV_VARS` from `../src/orchestrator/env.ts` alongside the existing imports, and add:

```ts
void test('env: CLAUDE_MODEL legacy message names the tier vars and covers every phase', () => {
    const entry = LEGACY_FALLBACK_ENV_VARS.find(e => e.old === 'CLAUDE_MODEL');
    assert.ok(entry, 'CLAUDE_MODEL legacy entry must exist');
    assert.match(entry!.replacement, /CLAUDE_MODEL_LIGHT/);
    assert.match(entry!.replacement, /CLAUDE_MODEL_STRONG/);
    assert.doesNotMatch(entry!.replacement, /not applied to qa/);
});
```

## Step 8 — `docs/pipeline-orchestrator.md`

1. **New section**, placed beside the existing "## Codex Model/Effort Matrix" (:212-226) — insert "## Claude Model/Effort Matrix" immediately after it and before "## Claude Budget Matrix" (:228):

```markdown
## Claude Model/Effort Matrix

Claude model and effort scale with task size, built from two tiers — *light* (Sonnet) and *strong* (Opus):

| Phase | XS | S | M | L | XL / delicate |
|---|---|---|---|---|---|
| `spec` | light / medium | light / medium | strong / medium | strong / medium | strong / high |
| `plan` | light / medium | light / medium | strong / medium | strong / medium | strong / high |
| `code_review` | light / medium | light / medium | strong / medium | strong / medium | strong / high |
| `qa` | light / medium | light / medium | light / medium | light / medium | light / medium |

Nothing runs above `high`. `qa` writes `done.md`, lessons, and the quality-log row — it can't block or reroute the pipeline, so it stays on the light model at every size regardless of scope. The other three phases move to the strong model once a task needs sustained, open-ended judgment (M and above); XL/delicate is the only tier that also raises effort.
```

2. **Environment Variables table** (:239-256): add two rows for the new tier vars, and rewrite the five per-phase pin rows to state scope + "replaces the model only." Replace the block from `| \`CLAUDE_MODEL_SPEC\` |` through `| \`CLAUDE_MODEL_QA\` |` (:245-249) with:

```markdown
| `CLAUDE_MODEL_LIGHT` | `sonnet` | Model for every light-tier Claude cell (XS/S on `spec`/`plan`/`code_review`; `qa` at every size), unless a more specific pin below is set. |
| `CLAUDE_MODEL_STRONG` | `opus` | Model for every strong-tier Claude cell (M and up on `spec`/`plan`/`code_review`), unless a more specific pin below is set. |
| `CLAUDE_MODEL_SPEC` | _(unset)_ | Pins the `spec` phase's model at every size, replacing the model only — effort still comes from the matrix above. |
| `CLAUDE_MODEL_PLAN` | _(unset)_ | Pins the `plan` phase's model at every size, replacing the model only. |
| `CLAUDE_MODEL_REVIEW` | _(unset)_ | Pins `code_review`'s model for XS/S/M/L, replacing the model only. Does not reach XL. |
| `CLAUDE_MODEL_REVIEW_LARGE` | _(unset)_ | Pins `code_review`'s model for XL only — `_LARGE` refers to task size, not model tier. Does not reach XS–L. |
| `CLAUDE_MODEL_QA` | _(unset)_ | Pins the `qa` phase's model at every size, replacing the model only. |
```

Note the defaults column changes meaning: `CLAUDE_MODEL_LIGHT`/`_STRONG` show what the tier resolves to when unset (`sonnet`/`opus`); the five pin rows show `_(unset)_` since a pin has no value until an adopter sets one — mirror whatever convention the existing table already uses for optional/unset vars elsewhere in this same table (check `CANON_PR_BODY`'s `_(unset)_` row at :253 for the pattern).

3. **Tuning sentence** (:241, "Claude is tuned for correctness — Opus on phases where false negatives cascade, Sonnet on structured/templated phases.") → rewrite to the three-tier rule, e.g.:

```markdown
Claude runs on two tiers — light (Sonnet) for qa always and for XS/S on the other three phases, strong (Opus) once a phase needs sustained judgment at M and up. A phase pin (below) always replaces the model only; effort comes from the matrix regardless of any pin.
```

## Step 9 — `templates/docs/pipeline-orchestrator.md`

Do not hand-edit. After Step 8 lands, run `npm run sync-templates` to regenerate the mirror, then `npm run sync-templates:check` to confirm it's clean (both are in Validation Required).

## Step 10 — `docs/product-context.md:91`

Current sentence ends: "...Claude's `code_review` for XL/delicate stays Opus at `xhigh`." Replace with something reflecting the new matrix, e.g.:

```markdown
...Claude scales from Sonnet to Opus at M and up, capping at `high` effort for XL/delicate — see `docs/pipeline-orchestrator.md` §"Claude Model/Effort Matrix".
```

Keep the rest of the paragraph (the Codex `high`-not-`xhigh` re-baseline sentence and its `docs/decisions.md` cross-reference) untouched — only the Claude clause at the end changes.

## Step 11 — `README.md:89`

Current: "`delicate: true` ... upgrades the orchestrator's model and effort across every phase." This is inaccurate even before this task (QA and the cold-Codex lens don't upgrade), and AC-6 requires fixing it now. Rewrite to name what actually upgrades:

```markdown
`delicate: true` (set in `status.json` at task creation) promotes any task to full tier and upgrades the model and effort for spec, plan, and code review, plus Codex spec review and implementation — not QA or the cold-Codex review lens. Use it for sensitive surfaces — auth, payments, persistent storage, anything where a regression has unbounded blast radius.
```

## Step 12 — `docs/decisions.md`

Add a new entry after "Model-generation re-baseline (2026-09): Codex defaults → GPT-6 generation" (ends :435), following the same structure as the 2026-06 Claude entry and the 2026-09 Codex entry read in Step 0:

```markdown
---

## Model-generation re-baseline (2026-09): Claude defaults → 5.5 generation

_Generation: Opus 5.5 / Sonnet 5.5._

**Decision**: Replace the Claude `spec`/`plan`/`code_review`/`qa` model+effort matrix with three tiers built from two models — light (Sonnet) and strong (Opus). qa stays on light at every size; the other three phases move light→strong at M and up, and nothing runs above `high` (XL/delicate drops from `xhigh` to `high`). Full evidence and table: `tasks/rebaseline-claude-matrix-for-5-5/spec.md`.

**Why** (vendor and third-party evidence, consulted 2026-09-28 — not a controlled canon evaluation; see Risks below):
- Opus 5.5 xhigh buys almost nothing over high on Terminal-Bench 4.0 (66% at ~$7.30 vs. 64% at ~$3.88) — max scores lower still.
- Sonnet above medium is dominated by Opus on cost *and* quality: Sonnet high (~$1.95, 43%) costs more than Opus low (~$1.30, 39%) and loses badly to Opus medium (~$2.90, 58%); the Sonnet 5.5 launch itself says it complements Opus best at lower effort.
- CodeRabbit's 13-case hard-bug eval: Opus 5.5 caught 8/13 (67% precision) vs. Sonnet 5.5's 6/13 (41%) — first Sonnet CodeRabbit would consider for a main review pass, supporting Sonnet for small and Opus above.
- Opus medium is Artificial Analysis's cost/intelligence-frontier workhorse and Claude Code's own default; low trails badly (42 vs. 51 on their index) and Anthropic notes low effort can skip verification — exactly what plan and review exist to do.
- A 422-task archive analysis found Codex changes the plan's approach only 6% of the time, and plan errors are ~40% of non-hygiene code-review blocking findings sampled (tstraub89/canon-ai#68) — plans are worth the strong tier at M and up.
- qa only writes `done.md`, lessons, and the quality-log row — it can't block or reroute, so it gains nothing from a bigger model or more effort at any size.

**Precedence rule**: per Claude cell, first match wins: (1) the phase's own pin (`CLAUDE_MODEL_SPEC`/`_PLAN`/`_QA` at every size; `CLAUDE_MODEL_REVIEW` at XS–L; `CLAUDE_MODEL_REVIEW_LARGE` at XL only — `_LARGE` names task size, not model tier); (2) the cell's tier var, `CLAUDE_MODEL_LIGHT` or `CLAUDE_MODEL_STRONG`; (3) legacy `CLAUDE_MODEL`, honored as a fallback for every phase including qa (previously undocumented as reaching qa); (4) the default — `sonnet` for light, `opus` for strong. A pin replaces the model only; effort always comes from the matrix. Claude effort has never been env-overridable.

**Pinned-adopter effort change**: an adopter who previously pinned `CLAUDE_MODEL_REVIEW=sonnet` or `CLAUDE_MODEL_PLAN=sonnet` moves from `high` to `medium` effort on M/L review or plan after this release, since the pin now only ever supplies the model. This is intentional — the old per-phase pins were designed against the old matrix's effort curve, and re-pinning a model was never meant to also freeze the effort tier it happened to load at.

**Rollback**: setting `CLAUDE_MODEL_STRONG`/`CLAUDE_MODEL_LIGHT` (or the five older per-phase pins) restores any model choice at any time — but the *effort* cells (nothing above `high`, qa flat at `medium`) only come back to the pre-5.5 curve by installing the canon release before this one; there is no env var for effort.

**Known limits**: this is vendor/third-party benchmark evidence from the 5.5 generation's first weeks, not a canon-run controlled evaluation — reversible by a future release if canon's own task-quality-log data disagrees. Budget caps (`docs/pipeline-orchestrator.md` §"Claude Budget Matrix") are unchanged; Opus medium on M/L plan and review costs more per call than the old Sonnet high, so a phase that hits its cap now fails mid-phase more readily — `CLAUDE_BUDGET` is the escape hatch. Watch M/L invocations after release.
```

## Step 13 — `dist/orchestrator/run-task.js`

Run `npm run build` after Steps 1–4 land (source changes only affect this bundle; no prompt template changed, so `tests/run-task-prompts.golden.json` should be unaffected — confirm via `npm test`, don't regenerate it preemptively).

## Step 14 — Validation

Run in this order, fixing forward on any failure before moving to the next:

1. `npm run lint`
2. `npm run type-check`
3. `npm test` (includes the rewritten `tests/pipeline-policy.test.ts` and the unmodified golden/prompt tests)
4. `npm run sync-templates` then `npm run sync-templates:check`
5. `npm run build`
6. `npm run docs-refs-check`

Then the AC-6 sweep invariant: `rg -n "xhigh|Sonnet 4\.6|Opus 4\.8" README.md docs/product-context.md docs/pipeline-orchestrator.md templates/docs/pipeline-orchestrator.md src/` should return only Codex-describing hits (the `docs/pipeline-orchestrator.md` Codex-matrix prose, `src/orchestrator/agents/codex.ts`'s `VALID_CODEX_EFFORTS` list, and the `src/lib/pipeline-policy.ts` Codex implement-row comment). If a hit isn't Codex-describing, it's a miss from Steps 8–11.

## Notes for implement

- `PolicyConfig`'s only two constructors are `TEST_CONFIG` (test file) and `policyConfig()` (`policy.ts`) — per the spec's Implementation Notes, there's no third call site to hunt for.
- Don't reach for `??` chaining across the pin/tier/legacy/default layers inside `resolveClaudeModel` beyond what's shown — each layer needs its own explicit `!== null` check because `??` would also treat an intentionally-set-but-falsy value as absent; strings here are never empty-string-valid, so this is a style choice for clarity, not a correctness requirement, but keep the four `if`/return layers rather than collapsing them into a single `??` chain — a single chain reads as "these have identical precedence," which isn't true (pin and tier-var are structurally different: one is size-scoped per phase, the other is a flat tier lookup).
- Handoff Changes table needs both `docs/pipeline-orchestrator.md` and its `templates/docs/pipeline-orchestrator.md` mirror listed (generated-artifact row) — per `docs/patterns.md` "Declare `templates/` mirrors..." pitfall, omitting the mirror row fails the `code_review` handoff-diff preflight even though `sync-templates:check` passed.

When done, run:

```
cd '/Users/tstraub/canon-ai' && canon task phase rebaseline-claude-matrix-for-5-5 plan done
```
