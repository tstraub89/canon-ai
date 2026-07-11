# Plan: per-phase-code-review-budget

> Spec: `tasks/per-phase-code-review-budget/spec.md` | Spec review: `tasks/per-phase-code-review-budget/spec-review.md` (verdict: approved_with_nits)

This plan implements a full-tier (M) task with no spec changes required — the nit from spec review (explicit template-sync validation step) is folded into Step 8 below.

## Step 1 — `scripts/pipeline-policy.ts`: replace the size-only budget table with a phase-aware one

Current shape (`scripts/pipeline-policy.ts:69-75`):

```ts
const BUDGET_BY_SIZE: Record<TaskSize, string> = {
    XS: '5.00',
    S: '5.00',
    M: '10.00',
    L: '10.00',
    XL: '20.00',
};
```

Replace with two size curves plus a phase-keyed lookup, following the same `Record<ClaudePhase, Record<TaskSize, T>>` convention `claudeMatrix()` and `codexMatrix()` already use:

```ts
// spec/plan/qa are single-pass Claude sessions. code_review runs a
// structurally costlier workload since #182 (cold-Codex diff review, then a
// Claude foreman that spawns an anchored-Claude lens and a cold-Claude lens
// and synthesizes all three — sometimes including an empirical test-suite
// re-run) and gets its own curve. See docs/decisions.md "`CLAUDE_BUDGET`
// becomes phase-aware, not just size-aware (2026-07)".
const SINGLE_PASS_BUDGET_BY_SIZE: Record<TaskSize, string> = {
    XS: '5.00',
    S: '5.00',
    M: '10.00',
    L: '10.00',
    XL: '20.00',
};
const CODE_REVIEW_BUDGET_BY_SIZE: Record<TaskSize, string> = {
    XS: '5.00',
    S: '10.00',
    M: '15.00',
    L: '20.00',
    XL: '40.00',
};
const BUDGET_BY_PHASE_AND_SIZE: Record<ClaudePhase, Record<TaskSize, string>> = {
    spec: SINGLE_PASS_BUDGET_BY_SIZE,
    plan: SINGLE_PASS_BUDGET_BY_SIZE,
    code_review: CODE_REVIEW_BUDGET_BY_SIZE,
    qa: SINGLE_PASS_BUDGET_BY_SIZE,
};
```

Place this where `BUDGET_BY_SIZE` currently sits (after `SIZE_ORDER`, before `maxSize()`). Do not export it — `BUDGET_BY_SIZE` isn't exported today either.

## Step 2 — `resolveBudget()`: add the `phase` parameter

Current (`scripts/pipeline-policy.ts:90-92`):

```ts
function resolveBudget(effectiveSize: TaskSize, claudeBudget: string | null): string {
    return claudeBudget ?? BUDGET_BY_SIZE[effectiveSize];
}
```

New:

```ts
function resolveBudget(phase: ClaudePhase, effectiveSize: TaskSize, claudeBudget: string | null): string {
    return claudeBudget ?? BUDGET_BY_PHASE_AND_SIZE[phase][effectiveSize];
}
```

Put `phase` first (mirrors the `matrix[phase][effectiveSize]` access pattern used by the `codex:` and `claude:` closures below).

## Step 3 — `getPipelinePolicy()`: move budget resolution inside the `claude` closure

Current (`scripts/pipeline-policy.ts:229-249`):

```ts
export function getPipelinePolicy(
    tasks: readonly PolicyInput[],
    config: PolicyConfig,
): PipelinePolicy {
    const tier = detectTier(tasks);
    const nominalSize = getNominalSize(tasks);
    const effectiveSize = getEffectiveSize(tasks);
    const matrix = codexMatrix(config);
    const claudeMat = claudeMatrix(config);
    const maxReviewLoops = config.maxReviewLoops ?? defaultMaxReviewLoops(nominalSize);
    const budget = resolveBudget(effectiveSize, config.claudeBudget);
    return {
        tier,
        nominalSize,
        effectiveSize,
        planCombined: tier === 'fast',
        maxReviewLoops,
        codex: (phase) => matrix[phase][effectiveSize],
        claude: (phase) => ({ ...claudeMat[phase][effectiveSize], budget }),
    };
}
```

Delete the `const budget = resolveBudget(...)` line entirely, and resolve budget per-call inside `claude:`:

```ts
        codex: (phase) => matrix[phase][effectiveSize],
        claude: (phase) => ({
            ...claudeMat[phase][effectiveSize],
            budget: resolveBudget(phase, effectiveSize, config.claudeBudget),
        }),
```

No other line in `getPipelinePolicy()` changes. The `codex:` closure is untouched — confirms Known Risk #2 in the spec (the Codex arm has no budget field and must stay unaffected).

No changes needed in `scripts/run-task/policy.ts` (`getClaudeConfig()` already forwards `phase` through to `.claude(phase)` unchanged) or in any of the four phase files that call `cfg.budget` into `runClaude(...)` — confirmed by grep, each already reads whatever `.claude(phase)` returns:

- `scripts/run-task/phases/spec.ts:21,23` and `:37,39`
- `scripts/run-task/phases/plan.ts:23,25`
- `scripts/run-task/phases/qa.ts:26,28`
- `scripts/run-task/phases/code-review.ts:350,353` (via injected `deps.getClaudeConfig`/`deps.runClaude`)

## Step 4 — `tests/pipeline-policy.test.ts`: restructure budget tests to be per-phase

**a. `BUDGET_TABLE`** (currently `tests/pipeline-policy.test.ts:101-118`, one `expected` string checked against `spec`/`qa` only). Replace with a per-phase row covering AC-1/AC-2/AC-3 in one exhaustive pass:

```ts
type BudgetRow = { name: string; tasks: PolicyInput[]; singlePass: string; codeReview: string };

const BUDGET_TABLE: BudgetRow[] = [
    { name: 'XS non-delicate', tasks: [s('XS')],       singlePass: '5.00',  codeReview: '5.00' },
    { name: 'S non-delicate',  tasks: [s('S')],        singlePass: '5.00',  codeReview: '10.00' },
    { name: 'M non-delicate',  tasks: [s('M')],        singlePass: '10.00', codeReview: '15.00' },
    { name: 'L non-delicate',  tasks: [s('L')],        singlePass: '10.00', codeReview: '20.00' },
    { name: 'XL non-delicate', tasks: [s('XL')],       singlePass: '20.00', codeReview: '40.00' },
    { name: 'M delicate',      tasks: [s('M', true)],  singlePass: '20.00', codeReview: '40.00' },
];

for (const row of BUDGET_TABLE) {
    void test(`claude budget: ${row.name}`, () => {
        const p = getPipelinePolicy(row.tasks, TEST_CONFIG);
        assert.equal(p.claude('spec').budget, row.singlePass, 'spec');
        assert.equal(p.claude('plan').budget, row.singlePass, 'plan');
        assert.equal(p.claude('qa').budget, row.singlePass, 'qa');
        assert.equal(p.claude('code_review').budget, row.codeReview, 'code_review');
    });
}
```

The `M delicate` row is AC-3's dedicated delicate test row (delicate promotes `effectiveSize` to XL, so it asserts against the XL figures: `singlePass: '20.00'`, `codeReview: '40.00'`).

**b. The flat-override test** (currently `tests/pipeline-policy.test.ts:120-127`, only checks `spec` and `code_review`). Extend to all four phases — this is AC-4:

```ts
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
```

**c. `CLAUDE_TABLE`** (`tests/pipeline-policy.test.ts:172-184`, pinned at size `M`, asserts `spec`/`plan`/`qa` model+effort with a hardcoded `budget: '10.00'`). No change needed — M's `spec`/`plan`/`qa` budget is unchanged at `$10.00`, so the existing `assert.deepEqual(p.claude(row.phase), { ...row.expected, budget: '10.00' })` still holds. Leave as-is; do not touch.

**d. `CODE_REVIEW_TABLE`** (`tests/pipeline-policy.test.ts:186-193`). Update the `budget` column to the new curve — this is the exact table the spec review nit and `docs/patterns.md`'s "Pure Policy + Test Discipline" pattern point at as the template to extend:

```ts
const CODE_REVIEW_TABLE: CodeReviewRow[] = [
    { size: 'XS', expected: { model: 'sonnet', effort: 'medium', budget: '5.00' } },
    { size: 'S',  expected: { model: 'sonnet', effort: 'medium', budget: '10.00' } },
    { size: 'M',  expected: { model: 'sonnet', effort: 'high',   budget: '15.00' } },
    { size: 'L',  expected: { model: 'sonnet', effort: 'high',   budget: '20.00' } },
    { size: 'XL', expected: { model: 'opus',   effort: 'xhigh',  budget: '40.00' } },
];
```

**e. Delicate code_review test** (`tests/pipeline-policy.test.ts:202-205`). Update the expected budget from `'20.00'` to `'40.00'` (XL slot):

```ts
void test('claude model: delicate M code_review uses XL slot (large model + xhigh)', () => {
    const p = getPipelinePolicy([s('M', true)], TEST_CONFIG);
    assert.deepEqual(p.claude('code_review'), { model: 'opus', effort: 'xhigh', budget: '40.00' });
});
```

**f. Empty-task-list test** (`tests/pipeline-policy.test.ts:252-260`). No change — XS `spec` budget stays `'5.00'` (single-pass curve, unaffected).

## Step 5 — Run `npm test`, `npm run lint`, `npm run type-check`

Confirm the restructured tests pass and no type errors were introduced (`resolveBudget`'s new signature, `BUDGET_BY_PHASE_AND_SIZE`'s type). Fix before moving on.

## Step 6 — `docs/pipeline-orchestrator.md`: replace the flat `CLAUDE_BUDGET` row and add a Claude Budget Matrix section

**a.** Replace the `CLAUDE_BUDGET` row in the `## Environment Variables` table (currently `docs/pipeline-orchestrator.md:236`):

```
| `CLAUDE_BUDGET` | _(size-aware)_ | Max spend per Claude phase (USD). Unset → tiered by effective size: XS/S `5.00`, M/L `10.00`, XL/delicate `20.00`. Set → flat cap for all phases (e.g. `CLAUDE_BUDGET=20.00` overrides the tier). |
```

with:

```
| `CLAUDE_BUDGET` | _(phase- and size-aware)_ | Max spend per Claude phase (USD). Unset → resolved from the Claude Budget Matrix below (phase × size). Set → flat cap applied uniformly across every phase and size (e.g. `CLAUDE_BUDGET=15.00` overrides every phase to $15). |
```

**b.** Insert a new `## Claude Budget Matrix` section immediately after the existing `## Codex Model/Effort Matrix` section (which ends at `docs/pipeline-orchestrator.md:223`) and before `## Environment Variables` (`docs/pipeline-orchestrator.md:225`) — sibling matrix sections stay adjacent, mirroring the doc's existing structure:

```markdown
## Claude Budget Matrix

Claude phase budgets scale with task size. `spec`/`plan`/`qa` are single-pass Claude sessions and share one curve; `code_review` runs a structurally costlier workload — a cold-Codex diff review followed by a Claude foreman that spawns an anchored-Claude lens and a cold-Claude lens and synthesizes all three, sometimes including an empirical test-suite re-run to confirm a finding discriminates — and gets its own, higher curve.

| Phase | XS | S | M | L | XL / delicate |
|---|---|---|---|---|---|
| `spec` / `plan` / `qa` | $5.00 | $5.00 | $10.00 | $10.00 | $20.00 |
| `code_review` | $5.00 | $10.00 | $15.00 | $20.00 | $40.00 |

`CLAUDE_BUDGET` remains a single flat env-var override: when set, it applies uniformly across every phase and size, exactly as before. See `CLAUDE_BUDGET` in the Environment Variables section below.
```

Do not use markdown anchor-fragment links (`[text](#claude-budget-matrix)`) for the cross-references — use plain prose pointers, matching how `docs/decisions.md` already references this doc (`see \`CLAUDE_BUDGET\` in \`docs/pipeline-orchestrator.md\``) rather than fragment anchors, since `docs-refs-check` validates backtick-wrapped file paths and there's no need to introduce an anchor-link form it doesn't already exercise.

## Step 7 — `docs/decisions.md`: add an adjacent decision entry, and mark the prior entry's budget note as superseded

**a.** In the existing `` `spec_review` M effort raised medium → high (2026-07) `` entry (`docs/decisions.md:218-228`), the **Rule** paragraph (line 228) currently reads in part: *"(`CLAUDE_BUDGET` was also in this category but was equalized to $10 for both M and L on 2026-07-11 — M's review-heavy reroutes were plausibly bumping the old $5 cap; see `CLAUDE_BUDGET` in `docs/pipeline-orchestrator.md`.)"* — append one sentence so it doesn't read as still-current once budget becomes phase-aware:

```
...see `CLAUDE_BUDGET` in `docs/pipeline-orchestrator.md`. This equalization was later superseded by a phase-aware split — see "`CLAUDE_BUDGET` becomes phase-aware, not just size-aware (2026-07)" below.)
```

**b.** Add a new entry directly after that entry's closing `---` (`docs/decisions.md:230`), before the `## Auto-commit owned by the orchestrator (not the agent)` heading (`docs/decisions.md:232`):

```markdown
## `CLAUDE_BUDGET` becomes phase-aware, not just size-aware (2026-07)

**Decision**: Split `CLAUDE_BUDGET`'s resolution table from a `TaskSize`-only axis into a `ClaudePhase` × `TaskSize` table. `spec`/`plan`/`qa` keep the existing size-tiered values (XS/S $5, M/L $10, XL $20); `code_review` gets its own, higher curve (XS $5, S $10, M $15, L $20, XL $40).

**Why**: Since `#182` ("Add cold-Codex third lens to code_review"), `code_review` runs a structurally different and costlier workload than the other three Claude phases: an orchestrator-run cold-Codex diff review, then a Claude foreman that spawns an anchored-Claude lens and a cold-Claude lens and synthesizes all three in one session — sometimes including empirical verification (reverting a fix and re-running the project's test suite to confirm a finding actually discriminates). `spec`/`plan`/`qa` are single-pass Claude sessions with no equivalent multi-lens fan-in. A uniform per-size budget can't express that gap: raising it enough to cover `code_review`'s worst case over-provisions the other three phases, where a tight ceiling is a more useful circuit breaker on a genuinely runaway session. Confirmed empirically on `a-gallery-wall-task` (M-tier, `gallery_wall` project): `code_review` exhausted the just-raised $10 M-tier budget mid-synthesis and needed a manual `CLAUDE_BUDGET=20.00` override to complete a third review iteration.

**Rule**: See the Claude Budget Matrix in `docs/pipeline-orchestrator.md` for the full phase × size table. Only the M `code_review` cell ($15) has direct incident evidence behind it; S ($10), L ($20), and XL ($40) are extrapolations along the same ramp and may need re-tuning once real usage data accumulates — that's a follow-up curve-tuning task, not evidence the phase-aware mechanism itself is wrong. The `CLAUDE_BUDGET` env var itself is unchanged: when set, it still overrides every phase and size uniformly — no new per-phase override env var was introduced.

---
```

(Note the trailing `---` separator, matching the doc's existing entry-delimiter convention.)

## Step 8 — Regenerate the `templates/` mirror (spec-review nit)

`docs/pipeline-orchestrator.md` is canon-owned (`src/lib/canon-owned.ts:23`), so its `templates/docs/pipeline-orchestrator.md` mirror must be regenerated and committed alongside it — this is the nit the spec review flagged (Validation Required didn't list an explicit sync step). After Step 6's edits:

```
npm run sync-templates
npm run sync-templates:check
```

The pre-commit hook (`npm run sync-templates -- --stage`) will also catch this if skipped, but run it explicitly here so the mirror is verified before handoff rather than relying on the hook alone. `docs/decisions.md` is **not** canon-owned (not in `CANON_OWNED`/`DELIMITED` in `src/lib/canon-owned.ts`) — no mirror needed for Step 7.

## Step 9 — `npm run docs-refs-check`

Required because `docs/pipeline-orchestrator.md` and `docs/decisions.md` changed (per spec's Validation Required). Fix any broken citation before proceeding.

## Step 10 — `npm run build` and verify `dist/` is clean

`scripts/pipeline-policy.ts` bundles into the published CLI (`docs/architecture.md:139`: any change to `scripts/pipeline-policy.ts` requires a full rebuild). Run:

```
npm run build
git diff --exit-code -- dist/
```

If the second command shows a diff, commit the rebuilt `dist/` alongside the source change (AC-7). Do not hand-edit anything under `dist/`.

## Step 11 — Final validation sweep

Re-run the full set before handoff, in this order: `npm run lint`, `npm run type-check`, `npm test`, `npm run build` (should now be a no-op diff), `npm run docs-refs-check`, `npm run sync-templates:check`.

## Handoff Changes table — files that must all be listed

- `scripts/pipeline-policy.ts`
- `tests/pipeline-policy.test.ts`
- `docs/pipeline-orchestrator.md`
- `docs/decisions.md`
- `templates/docs/pipeline-orchestrator.md` (generated mirror — do not hand-edit; regenerated by Step 8)
- `dist/` (directory-form entry, no wildcard — per `scripts/run-task/validation.ts:1213` `validateExtractedPath()`, only literal `*`/`?` are rejected, so a trailing-slash directory entry is valid and is the sanctioned form for build output per `docs/pipeline-orchestrator.md`'s directory-form carve-out)

## Notes on spec Known Risks (no action needed beyond what's above)

- **Off-by-one on table transcription**: covered by Step 4a/4d's exhaustive per-cell test rows — every one of the 10 new cells (5 sizes × 2 curves) gets an explicit assertion.
- **`resolveBudget()` call-site relocation**: Step 3 confirms the `codex:` closure is untouched; the full test suite (Step 5) is the regression check.
- **Delicate-task promotion interaction**: Step 4a's `M delicate` row exercises both the `code_review` XL figure and the `spec`/`plan`/`qa` XL figure together.
- **Only M has real incident evidence**: already addressed by Step 7's Rule paragraph flagging S/L/XL as extrapolations, not independently verified figures — no code change follows from this, it's a documentation-honesty note only.
