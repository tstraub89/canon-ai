# Plan: add-xs-tier — Add XS task size as the new fast-tier floor

> Author: Claude | Implements: `tasks/add-xs-tier/spec.md`

Nit from `spec-review.md` incorporated: Step 2 includes renaming/updating the empty-list fallback test (`policy: empty task list falls back to S/fast tier`) to expect `'XS'` nominal/effective after `maxSize` seeds at the new floor.

## Implementation Order

Work through steps in order. Each step is self-contained; don't skip ahead — the TypeScript type system catches matrix omissions as compile errors, so verifying after Step 1 with `npm run type-check` is the fast inner loop.

---

### Step 1 — Core policy change: `scripts/pipeline-policy.ts`

This is the single source of truth. Do all six sub-steps atomically (the `Record<TaskSize, …>` literal types mean a partial update is a compile error).

**1a. Widen `TaskSize`** (line 10):
```typescript
export type TaskSize = 'XS' | 'S' | 'M' | 'L' | 'XL';
```

**1b. Prepend XS to `SIZE_ORDER` and add to `BUDGET_BY_SIZE`** (lines 68–74):
```typescript
const SIZE_ORDER: readonly TaskSize[] = ['XS', 'S', 'M', 'L', 'XL'];
const BUDGET_BY_SIZE: Record<TaskSize, string> = {
    XS: '5.00',
    S:  '5.00',
    M:  '5.00',
    L:  '10.00',
    XL: '20.00',
};
```

**1c. Seed `maxSize` at the new floor** (line 77). The current seed is `'S'`; with XS prepended at index 0, an all-XS bundle would never climb above the old seed and would mis-report as `S`. Change to:
```typescript
let max: TaskSize = 'XS';
```

**1d. Add XS to `defaultMaxReviewLoops`** (line 126). XS clones S's 3-loop cap:
```typescript
export function defaultMaxReviewLoops(nominalSize: TaskSize): number {
    return nominalSize === 'XS' || nominalSize === 'S' || nominalSize === 'M' ? 3 : 5;
}
```
Also update the comment at ≈line 122 from `3 for S/M` → `3 for XS/S/M`. The historical "old caps" note at ≈line 120 (`The old caps (2 for S/M…)`) describes superseded state and must NOT be changed.

**1e. Flip `detectTier` and `isPlanCombined`** to XS (lines 96, 105):
```typescript
export function detectTier(tasks: readonly PolicyInput[]): PipelineTier {
    return tasks.some(t => (t.task_size ?? 'M') !== 'XS' || (t.delicate ?? false))
        ? 'full'
        : 'fast';
}

export function isPlanCombined(task: PolicyInput): boolean {
    return task.task_size === 'XS' && !(task.delicate ?? false);
}
```

**1f. Add XS rows to `codexMatrix` and `claudeMatrix`**. XS clones today's S values exactly — no new model rows, no new effort levels.

In `codexMatrix` (≈lines 144–158), add `XS` entries cloning the S values:
```typescript
spec_review: {
    XS: { model: config.codexModelMini, effort: 'medium' },
    S:  { model: config.codexModelMini, effort: 'medium' },
    // ... M, L, XL unchanged
},
implement: {
    XS: { model: config.codexModelMini, effort: 'medium' },
    S:  { model: config.codexModelMini, effort: 'medium' },
    // ... M, L, XL unchanged
},
```
Update the comment at ≈line 142 (currently "The `S` row under spec_review is unused in practice (S fast tier skips…)"). S is now full tier, so the XS row is the unused one:
```
// The `XS` row under spec_review is unused in practice (XS fast tier skips
// Codex spec review entirely) but kept for completeness and testability.
// The `S` row is now active — S is full tier and runs spec_review.
```

In `claudeMatrix` (≈lines 173–212), add `XS:` entries in `buildHigh`, `buildMedium`, and `codeReviewMatrix`, each cloning the S value:
- `buildHigh`: `XS: { model, effort: 'medium' }` (matches existing S entry)
- `buildMedium`: `XS: { model, effort: 'medium' }` (matches existing S entry)
- `codeReviewMatrix`: `XS: { model: config.claudeModelReview, effort: 'medium' }` (matches existing S entry)

Update the `codeReviewMatrix` comment (≈line 192–193): `Sonnet (claudeModelReview) handles S/M/L` → `Sonnet (claudeModelReview) handles XS/S/M/L`.

**1g. Update fast-tier-invariant comments** per AC-11:
- `PipelinePolicy.planCombined` doc (≈line 60): `True when the whole bundle runs the fast tier (S, non-delicate)` → `(XS, non-delicate)`
- `detectTier` comment (≈line 93): `Fast tier: S only, non-delicate` → `Fast tier: XS only, non-delicate`; the full-tier list `any M/L/XL` gains S → `any S/M/L/XL`
- `isPlanCombined` comment (≈line 102): `True only for S non-delicate` → `True only for XS non-delicate`
- Loop-cap config comment (≈line 43): `3 for S/M` → `3 for XS/S/M`

Verify: `npm run type-check` must pass after this step. Every `Record<TaskSize, …>` literal forces an XS key or fails to compile.

---

### Step 2 — Policy tests: `tests/pipeline-policy.test.ts`

Every matrix cell and routing surface must have a corresponding test row per the Pure Policy + Test Discipline pattern. All changes are additive or rename/flip; no existing test is deleted.

**2a. `ROUTING_TABLE`** (≈lines 43–65):
- Add XS single-task rows at the top of the table:
  ```typescript
  { name: 'XS non-delicate', tasks: [s('XS')],       tier: 'fast', nominal: 'XS', effective: 'XS', planCombined: true,  maxLoops: 3 },
  { name: 'XS delicate',     tasks: [s('XS', true)],  tier: 'full', nominal: 'XS', effective: 'XL', planCombined: false, maxLoops: 3 },
  ```
- Flip the existing `S non-delicate` row from fast to full tier (S is now full):
  ```typescript
  { name: 'S non-delicate', tasks: [s('S')], tier: 'full', nominal: 'S', effective: 'S', planCombined: false, maxLoops: 3 },
  ```
- Add XS bundle rows and flip `bundle [S, S]` to full tier:
  ```typescript
  { name: 'bundle [XS, XS]', tasks: [s('XS'), s('XS')], tier: 'fast', nominal: 'XS', effective: 'XS', planCombined: true,  maxLoops: 3 },
  { name: 'bundle [XS, S]',  tasks: [s('XS'), s('S')],  tier: 'full', nominal: 'S',  effective: 'S',  planCombined: false, maxLoops: 3 },
  { name: 'bundle [XS, M]',  tasks: [s('XS'), s('M')],  tier: 'full', nominal: 'M',  effective: 'M',  planCombined: false, maxLoops: 3 },
  // existing bundle [S, S] flipped:
  { name: 'bundle [S, S]',   tasks: [s('S'), s('S')],   tier: 'full', nominal: 'S',  effective: 'S',  planCombined: false, maxLoops: 3 },
  ```

**2b. `BUDGET_TABLE`** (≈lines 98–104). Add:
```typescript
{ name: 'XS non-delicate', tasks: [s('XS')], expected: '5.00' },
```

**2c. `CODEX_MATRIX`** (≈lines 131–142). Add XS rows:
```typescript
{ phase: 'spec_review', size: 'XS', expected: { model: 'mini', effort: 'medium' } },
{ phase: 'implement',   size: 'XS', expected: { model: 'mini', effort: 'medium' } },
```

**2d. `CODE_REVIEW_TABLE`** (≈lines 179–184). Add:
```typescript
{ size: 'XS', expected: { model: 'sonnet', effort: 'medium', budget: '5.00' } },
```

**2e. `MAX_REVIEW_LOOPS` override test** (≈line 81): include XS in the size loop:
```typescript
for (const size of ['XS', 'S', 'M', 'L', 'XL'] as TaskSize[]) {
```

**2f. Band comment** (≈line 161): `Sonnet for S/M/L` → `Sonnet for XS/S/M/L`.

**2g. `detectTier` standalone test** (≈line 204):
- Rename: `'detectTier: XS-only bundle is fast, any other size/delicate is full'`
- Update assertions:
  ```typescript
  assert.equal(detectTier([s('XS')]), 'fast');
  assert.equal(detectTier([s('XS'), s('XS')]), 'fast');
  assert.equal(detectTier([s('XS', true)]), 'full');
  assert.equal(detectTier([s('S')]), 'full');       // S is now full tier
  assert.equal(detectTier([s('M')]), 'full');
  assert.equal(detectTier([s('XS'), s('S')]), 'full');
  assert.equal(detectTier([s('XS'), s('M')]), 'full');
  ```

**2h. `isPlanCombined` test** (≈line 212):
- Rename: `'isPlanCombined: only XS non-delicate'`
- Update assertions:
  ```typescript
  assert.equal(isPlanCombined(s('XS')), true);
  assert.equal(isPlanCombined(s('XS', true)), false);
  assert.equal(isPlanCombined(s('S')), false);     // S is now full tier
  assert.equal(isPlanCombined(s('M')), false);
  assert.equal(isPlanCombined(s('XL')), false);
  ```

**2i. `defaultMaxReviewLoops` test** (≈line 226):
- Rename: `'defaultMaxReviewLoops: 3 for XS/S/M, 5 for L/XL'`
- Add XS assertion:
  ```typescript
  assert.equal(defaultMaxReviewLoops('XS'), 3);
  assert.equal(defaultMaxReviewLoops('S'), 3);
  assert.equal(defaultMaxReviewLoops('M'), 3);
  assert.equal(defaultMaxReviewLoops('L'), 5);
  assert.equal(defaultMaxReviewLoops('XL'), 5);
  ```

**2j. Empty-list test** (≈lines 235–243) — the spec-review nit. With `maxSize` seeding at `'XS'`, an empty list now resolves to XS nominal/effective:
```typescript
void test('policy: empty task list falls back to XS/fast tier', () => {
    // An empty list shouldn't crash. Today it resolves to `XS` nominal/effective
    // (no delicate = no promotion, no non-XS = fast tier). Not a real runtime case.
    const p = getPipelinePolicy([], TEST_CONFIG);
    assert.equal(p.tier, 'fast');
    assert.equal(p.nominalSize, 'XS');
    assert.equal(p.effectiveSize, 'XS');
    assert.deepEqual(p.claude('spec'), { model: 'opus', effort: 'medium', budget: '5.00' });
});
```
Note: `effort: 'medium'` remains correct — XS clones S's `buildHigh` row which has `effort: 'medium'`.

---

### Step 3 — Non-policy test fixture updates (AC-12b)

Only three fixtures encode the fast-tier contract. The other six `task_size: 'S'` fixtures use S as an arbitrary valid size and must NOT be changed (changing them would alter what they test, not improve it).

**3a. `tests/run-task-reroute-preflight.test.ts`:**
- At lines 38–40, add `'XS'` to the `RerouteStatusOptions.taskSize` union type:
  ```typescript
  taskSize: 'XS' | 'S' | 'M' | 'L' | 'XL';
  ```
- At line 684, change the fast-tier reroute test fixture:
  ```typescript
  taskSize: 'XS'   // was: 'S'
  ```
  Rationale: this test asserts the fast-tier reroute contract (spec_review/plan untouched, resume at implement). At full tier (which S now is), reroute resets spec_review — inverting the assertions.

**3b. `tests/run-task-safety.test.ts`:**
- At line 2391: `task_size: 'XS'` (was `'S'`) — fast-tier spec-gate test.
- At line 2445: `task_size: 'XS'` (was `'S'`) — fast-tier full-send spec-gate test.
  Rationale: both tests assert `runSpecReviewPhase` leaves `spec_review.status === 'pending'` (the fast-tier skip). At full tier, S would actually run spec_review and invert the assertions.

After Step 3: `npm test` must pass with all three tier-dependent fixtures on XS.

---

### Step 4 — Size-selection guidance (AC-13/14/15/16/17)

Documentation edits — no build step required.

**4a. `docs/architecture.md` (≈line 106, AC-17):**
Change the size enum from `S | M | L | XL` to `XS | S | M | L | XL`.

**4b. `docs/product-context.md` (AC-15):**
- Tier glossary row (≈line 41):
  - `Fast tier (S non-delicate)` → `Fast tier (XS non-delicate)` (Family A)
  - `Full tier (M/L/XL or any delicate)` → `Full tier (S/M/L/XL or any delicate)` (Family B)
- Task-size glossary row (≈line 42): Add `XS` as the first entry: `` `XS` (fast-tier floor, more than trivial inline but no spec premise to challenge), `S` (smallest full-tier), ... `` (Family C)
- Tiers/Sizes/Authorization section (≈lines 90–91):
  - `Fast tier: \`S\` non-delicate` → `` `XS` non-delicate ``
  - `Full tier: anything \`M\`, \`L\`, \`XL\`, or \`delicate\`` → ``anything `S`, `M`, `L`, `XL`, or `delicate` ``

**4c. `docs/decisions.md` (AC-16a and AC-16b):**
- Rewrite the "Fast tier skips Codex spec review" entry (≈lines 81–87) to name XS throughout. The rewritten entry must be internally consistent:
  - Heading: rename to `Fast tier (XS) skips Codex spec review`
  - `task_size: S` → `task_size: XS`
  - `trivial tasks (S, non-delicate)` → `(XS, non-delicate)`
  - "Don't add spec_review to S non-delicate tasks" → "XS non-delicate tasks"
  - Full-tier membership clause gains S: "Reserving Codex spec review for S/M/L/XL/delicate tasks"
  - Stale advice "size it M" → "size it S" (S now gets spec_review)
- Add a new short entry (AC-16b): `"XS is the pipeline floor; spec_review is the XS→S dividing line."` Content: XS is chosen over inline when more than one file changes or real logic is involved, but the spec has no premise worth reviewing. `spec_review` is the dividing line because S is the first size with enough spec premise to be worth challenging.

**4d. `docs/pipeline-orchestrator.md` (AC-14):**

Use the AC-14 worklist from the spec as the authoritative map; edit and verify each:
- Line 5 (intro `/canon-spec-review`): `M/L/XL or delicate` → `S/M/L/XL or delicate`
- ≈line 151 Fast tier header: `(all tasks S, non-delicate)` → `(all tasks XS, non-delicate)`
- ≈line 161 Full tier header: enumerate S in the membership list
- ≈line 175 bundle line: `any M/L/XL/delicate` → `any S/M/L/XL/delicate`
- ≈line 185 sizing-fields table `task_size` row: values `S \| M \| L \| XL` → `XS \| S \| M \| L \| XL`; description `"S is fast-tier; M+ runs the full pipeline"` → `"XS is fast-tier; S+ runs the full pipeline"`
- ≈lines 195–200 sizing guide table: add XS row above S with the inline→XS→S framing
- ≈lines 214–219 model/effort matrix: add XS column (= S values); update S row to show spec_review runs (no longer `— (skipped)`)
- ≈line 229: `Code review for S/M/L` → add XS
- ≈line 232 budget tier: `S/M 5.00` → `XS/S/M 5.00`
- ≈line 243 `CODEX_MODEL_MINI`: `S/M/L non-delicate phases` → `XS/S/M/L non-delicate phases`
- ≈line 245 `MAX_REVIEW_LOOPS`: `3 for S/M` → `3 for XS/S/M`
- ≈line 319 human-spec-gate: `Fast tier (S, non-delicate)` → `(XS, non-delicate)`
- ≈line 320: `Full tier (M/L/XL/delicate)` → add S
- ≈line 338 auto-block: `3 for S/M, 5 for L/XL` → `3 for XS/S/M, 5 for L/XL`
- ≈line 421 reroute: `any M/L/XL task or any delicate task` → add S
- ≈line 431 reroute fast: `S, non-delicate tasks re-enter` → `XS, non-delicate tasks re-enter`
- ≈line 472 `/canon-spec-review`: `M/L/XL or delicate tasks` → add S

**4e. `.claude/skills/canon-spec/SKILL.md` (AC-13, AC-19):**
- Size-assessment list (≈lines 70–77): Add XS entry above S with the inline→XS→S decision rule. Inline = Claude implements + `codex review` at intervals, no ACs/plan/task. XS = more than trivial inline (>1 file, or real logic) but little-to-no spec premise worth reviewing — the smallest pipeline tier; choosing it over inline buys the cross-review flip (Codex implements against written ACs, Claude reviews), a plan, and a real `code_review`. S = spec carries enough logic/risk that a Codex `spec_review` pass earns its keep. Frame the cross-review flip as a property of running the pipeline at all (not unique to XS); make clear `spec_review` is the XS→S dividing line.
- Grill-mode split (≈lines 78–80): light path → **XS**; grill path → **S/M/L/XL/delicate** (S is now full tier).
- Full-tier membership (≈lines 177/196): `M/L/XL/delicate` → `S/M/L/XL/delicate` (Family B).
- Bug-fix rule-of-thumb (≈line 152): `on fast-tier (S, non-delicate) tasks` → `(XS, non-delicate)` (Family A).

---

### Step 5 — Guidance-consistency sweep (remaining AC-19 surfaces)

Grouped by family for efficient editing.

**Family A — fast-tier identity must name XS:**
- `.canon/templates/spec.md` (line 10): `(S, non-delicate)` → `(XS, non-delicate)`
- `scripts/run-task/prompts/templates/spec.md` (line 16): `(S)` → `(XS)`
- `scripts/run-task/prompts/templates/spec-revision.md` (line 17): `(S)` → `(XS)`
- `.claude/skills/canon-spec-review/SKILL.md` (lines 3, 17): fast-tier auto-approve `(S)` → `(XS)`
- `.claude/skills/canon-pipeline/SKILL.md` (lines 55, 158): fast-tier state/re-entry notes name XS
- `scripts/run-task/cli.ts` (line 118): `Fast tier (S, non-delicate only) skips Codex spec review` → `(XS, non-delicate only)`; (line 153) `fast-tier tasks (S) re-enter` → `(XS) re-enter`
- `src/cli/index.ts` (line 95): `fast-tier tasks (S) re-enter at implement` → `(XS) re-enter at implement`
- `README.md` (line 73): `fast-tier tasks (S)` → `(XS)`; (line 62): `Fast tier (small tasks)` → `Fast tier (XS tasks)` — precision edit, not gate-caught but required to match the invariant

**Family B — full-tier / spec_review membership must include S:**
- `.claude/skills/canon-spec-review/SKILL.md` (lines 3, 16): `(M/L/XL/delicate)` → `(S/M/L/XL/delicate)`
- `.claude/skills/canon-pipeline/SKILL.md` (lines 56, 156): full-tier state/re-entry notes gain S
- `scripts/run-task/cli.ts` (line 118): `Full tier (any M/L/XL or delicate task)` → add S; (line 152): similar membership line gains S
- `src/cli/index.ts` (line 94): `Full-tier tasks (M/L/XL or delicate) re-enter at spec_review` → add S
- `README.md` (line 73): `full-tier (M/L/XL or delicate)` → add S

**Family C — size-set / shared-band enumerations add XS:**
- `.claude/skills/canon-spec-review/SKILL.md` (line 102): `<S/M/L/XL>` → `<XS/S/M/L/XL>`
- `.claude/skills/canon-status/SKILL.md` (line 63): `3 for S/M` → `3 for XS/S/M`
- (All pipeline-orchestrator.md and product-context.md occurrences are already in Step 4.)

**Family D — stop calling inline work "XS":**
- `README.md` (lines 126, 155): Rephrase "XS" usages to "trivial"/"below-pipeline"
- `.claude/skills/canon-inline-review/SKILL.md` (lines 10, 15): Rephrase to "trivial"/"below-pipeline". After the edit: `rg -nw 'XS' .claude/skills/canon-inline-review/SKILL.md` must return zero.

---

### Step 6 — Build, golden, sync, and structural gate

Run in this exact order.

**6a. Build:**
```bash
npm run build
```
Recompiles `pipeline-policy.ts` + CLI into `dist/`. Version is baked into dist; CI's `git diff dist/` gate catches skipped builds.

**6b. Regenerate golden:**
```bash
UPDATE_GOLDENS=1 npm test
```
Regenerates `tests/run-task-prompts.golden.json` after the runtime-prompt `(S)`→`(XS)` flips in Step 5. Commit the regenerated golden; a plain `npm test` must then pass against it. Note: the golden is NOT excluded from AC-18's Family A gate — a forgotten regen trips the grep.

**6c. Sync templates:**
```bash
npm run sync-templates
npm run sync-templates:check
```
Regenerates `templates/` mirrors for these edited canon-managed files (only files in `CANON_OWNED` in `src/lib/canon-owned.ts`):
- `templates/docs/pipeline-orchestrator.md`
- `templates/.canon/templates/spec.md`
- `templates/.claude/skills/canon-spec/SKILL.md`
- `templates/.claude/skills/canon-spec-review/SKILL.md`
- `templates/.claude/skills/canon-pipeline/SKILL.md`
- `templates/.claude/skills/canon-inline-review/SKILL.md`
- `templates/.claude/skills/canon-status/SKILL.md`

`docs/product-context.md`, `docs/decisions.md`, and `docs/architecture.md` are NOT in `CANON_OWNED` — no mirrors are produced for them.

**6d. Full validation:**
```bash
npm run lint
npm run type-check
npm test
npm run docs-refs-check
```
All must pass.

**6e. AC-18 structural gate.** Run each grep; all must return zero:

Family A:
```bash
rg -nP --hidden -g '!.git' -g '!tasks/**' -g '!node_modules' -g '!dist/**' -g '!templates/**' \
   -g '!CHANGELOG.md' -g '!docs/lessons-learned.md' -g '!docs/BACKLOG.md' \
   -g '!tests/pipeline-policy.test.ts' \
   -e 'fast[- ]tier \(S[ ,)]' -e 'Fast tier \(S' -e 'fast-tier tasks \(S\)' -e 'trivial tasks \(S' \
   -e '\bS[\s,)\x60]*non-delicate'
```
(`-P` required for lookbehind. `tests/pipeline-policy.test.ts` excluded from this family only — its `S non-delicate` test labels describe a still-existing S task, not stale fast-tier guidance.)

Family B:
```bash
rg -nP --hidden -g '!.git' -g '!tasks/**' -g '!node_modules' -g '!dist/**' -g '!templates/**' \
   -g '!CHANGELOG.md' -g '!docs/lessons-learned.md' -g '!docs/BACKLOG.md' \
   -e '(?<!S/)M/L/XL' -e '(?<!S, )M, L, XL'
```

Family D:
```bash
rg -nP --hidden -g '!.git' -g '!tasks/**' -g '!node_modules' -g '!dist/**' -g '!templates/**' \
   -g '!CHANGELOG.md' -g '!docs/lessons-learned.md' -g '!docs/BACKLOG.md' \
   -e 'XS\s+(fixes|changes|inline|edits|tweaks)' -e '(inline|below-pipeline)\b[^.\n]{0,12}\bXS\b' -e 'XS\b[^.\n]{0,40}too small'
```
Also: `rg -nw 'XS' .claude/skills/canon-inline-review/SKILL.md` → zero.

If any grep returns hits, locate and fix each before the handoff.

---

## Key Pitfalls

- **Don't change any existing S/M/L/XL effort or model value.** XS adds cells; it never modifies existing ones. The type system enforces this.
- **Seed `maxSize` at `'XS'`, not `'S'`.** Forgetting makes all-XS bundles mis-report as S nominal/effective (AC-9; spec-review nit).
- **Two routing surfaces, not one.** `detectTier` (bundle-level) and `isPlanCombined` (per-task) are independent (lines 96, 105). Flip both.
- **Three non-policy fixtures must change to XS; six must NOT.** AC-12b enumerates both. The six that use S as an arbitrary valid size (canon-snapshot, validation ×2, counter-schema, prompts, ship, task-cli) must not change. `npm test` is the backstop.
- **Templates/ mirrors are derived.** Never hand-edit `templates/<file>`. `npm run sync-templates` regenerates them. Declare them in the handoff Changes table.
- **The golden must be regenerated** after editing runtime prompt templates, or the AC-18 Family-A grep fires on `tests/run-task-prompts.golden.json`.
- **Historical note at ≈`pipeline-policy.ts:120`** (`The old caps (2 for S/M…)`) is excluded from the sweep per AC-11 — leave it unchanged.
- **Family B gate uses lookbehind** — requires `rg -P`. Without `-P`, the lookbehind is silently ignored and the grep may pass vacuously.
