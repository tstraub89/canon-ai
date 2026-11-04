# Implementation Plan: cold-lens-full-model-l-xl

> Written by: Claude | Implements: `tasks/cold-lens-full-model-l-xl/spec.md`

## Approach

The behavior change is two matrix cells. Everything else is tests that pin those cells and sweeping the prose that restates "the cold lens is mini at every size." Spec review approved the spec with no findings, so this plan has no nits to fold in.

The runtime path needs no code change beyond the cells. `runCodeReviewPhase()` (`src/orchestrator/phases/code-review.ts:428`) calls `deps.agentBackendFor('cold_reviewer', roleAssignmentFor(state.provider)).coldReview({ phase: 'code_review', tasks, … })`. In mixed mode that is `codexBackend.coldReview` (`src/orchestrator/agents/codex.ts:262`), which resolves `getCodexConfig('code_review', tasks)`, i.e. `getPipelinePolicy(...).codex('code_review')` = `codexMatrix(config).code_review[effectiveSize]`, and passes `cfg.model` to `runColdCodexReview()`, which emits `-m <model>` (`codex.ts:173`). Delicate and bundle promotion happen in `getEffectiveSize()` (`pipeline-policy.ts:192`) before the matrix lookup.

**Feasibility check**
- **Exists:** `codexMatrix()` `code_review` row at `src/lib/pipeline-policy.ts:252-258` with comment at `:231-232`. `CODEX_MATRIX` table at `tests/pipeline-policy.test.ts:236-255`, the delicate-M test at `:264-269`, `TEST_CONFIG` (`codexModelMini: 'mini'`, `codexModelFull: 'full'`) at `:88-89`, and the `s(size, delicate)` helper at `:94`. The parity harness at `tests/run-task-code-review.test.ts:1729-1782`, and the `spawnSync` + tsx child pattern in `runCheckAndRouteInFixture()` at `:327-339`. `agentBackendFor` and `ColdReviewRequest` in `src/orchestrator/agents/backend.ts:25-48`. `MIXED_ROLE_ASSIGNMENT` in `src/lib/pipeline-policy.ts:389`. Env resolution happens at module load in `src/orchestrator/policy.ts:30-31` (`CODEX_MODEL_MINI ?? CODEX_MODEL_DEFAULT`, `CODEX_MODEL_FULL ?? CODEX_MODEL_DELICATE`). All of these were found by searching.
- **Real path:** traced above. No code on the path forces mini today; the pin lives only in the matrix cells.
- **Callers:** `codex('code_review')` and `getCodexConfig('code_review', …)` have three consumers: `codexBackend.coldReview` (runtime), the parity test (`run-task-code-review.test.ts:1768`, which reads the model dynamically and keeps passing), and `pipeline-policy.test.ts`. The `makeDeps` cold backend stub hard-codes `mini-from-policy` and never reaches the matrix. No error contract changes.
- **Tests that can fail:** the AC-1 L and XL rows, the AC-2 delicate-M and [S, L] / [S, S-delicate] cases, and the AC-3 L and delicate-M cases all expect `full`. On the current matrix they resolve to `mini`, so each fails before the change. The [XS, M] and M-non-delicate cases are guards: they pass both before and after.
- **Predicates:** no new conditions. Size resolution is `getEffectiveSize` (delicate→XL, else max nominal). The cells cover all five sizes, and the AC-2 bundle cases cover the boundaries: max lands on L, delicate member, max stays at M.
- **Scope:** every file below is in the spec's Affected Files. One mismatch: `dist/cli/index.js` does not contain `codexMatrix` (only `policy.ts`'s env config, at line 299), and `tsup` strips comments, so a fresh build will probably leave it byte-identical. See Step 9 and `notes.md`.
- **Async/stateful:** N/A (pure table change; the new test is a single synchronous child spawn).

## Steps

### Step 1: Flip the policy cells and rewrite the row comment

Files: `src/lib/pipeline-policy.ts`

- In `codexMatrix()`'s `code_review` row, change `L` and `XL` to `{ model: config.codexModelFull, effort: 'high' }`. Leave XS/S/M on `config.codexModelMini` at `'high'`. Touch no other row.
- Replace the comment at lines 231-232 (`code_review: the mandatory cold-Codex lens stays on mini at every size …`) with something like:

```ts
    //   code_review: the mandatory cold-Codex lens runs at flat high effort.
    //                XS/S/M use mini; L and XL/delicate use the full model
    //                (2026-11): post-PR defect fixes rise with size and peak
    //                at L, and a full-model replay of a delicate task
    //                recovered P1s the mini run missed (see decisions.md).
```

  The new comment must not contain the AC-4 grep phrases (`stays on mini`, `stays on the mini`, `deliberately flat`). "XS/S/M use mini" is safe.

### Step 2: Policy tests (AC-1, AC-2)

Files: `tests/pipeline-policy.test.ts`

- In `CODEX_MATRIX`, change the `code_review` `L` and `XL` rows to `expected: { model: 'full', effort: 'high' }`. Leave every `spec_review` and `implement` row byte-identical, since AC-1 checks that this task's diff leaves them unchanged.
- In `'codex matrix: delicate M uses XL row (effective size)'`, change the `code_review` assertion to `{ model: 'full', effort: 'high' }`.
- Add one table-driven test right after it (per `docs/patterns.md` "Pure Policy + Test Discipline": one test row per routing decision):

```ts
for (const { name, tasks, model } of [
    { name: '[S, L]',           tasks: [s('S'), s('L')],       model: 'full' },
    { name: '[S, S-delicate]',  tasks: [s('S'), s('S', true)], model: 'full' },
    { name: '[XS, M]',          tasks: [s('XS'), s('M')],      model: 'mini' },
]) {
    void test(`codex matrix: bundle ${name} cold lens → ${model}/high`, () => {
        assert.deepEqual(getPipelinePolicy(tasks, TEST_CONFIG).codex('code_review'), { model, effort: 'high' });
    });
}
```

  The delicate-M case is the edited existing test, so with these three AC-2's four cases are covered.

### Step 3: Spawned-process invocation test (AC-3)

Files: `tests/run-task-code-review.test.ts`

Add **one** test directly after the `review invocation parity` loop (around line 1782). It spawns a single child process for all three cases, following "Slow Test Discipline": one spawn, not three. Template:

- Use `withTempTasksAsync`. Write a fake `codex` binary into `activeCwd`, using the same body as the parity fake: append `{binary, argv, cwd}` JSON to `process.env.REVIEW_PARITY_LOG`, then print the `item.completed` agent_message and `turn.completed` lines. Mode `0o755`.
- Build the child script as an ESM string that imports from absolute paths. Use the same `JSON.stringify(path.join(process.cwd(), 'src/…'))` style as `runCheckAndRouteInFixture`:

```js
import { agentBackendFor } from <abs src/orchestrator/agents/backend.ts>;
import { MIXED_ROLE_ASSIGNMENT } from <abs src/lib/pipeline-policy.ts>;
const backend = agentBackendFor('cold_reviewer', MIXED_ROLE_ASSIGNMENT);
for (const c of JSON.parse(process.env.COLD_LENS_CASES)) {
    const tasks = c.tasks.map(t => ({ taskId: t.id, status: { task_size: t.size, delicate: t.delicate } }));
    const r = await backend.coldReview({ role: 'cold_reviewer', phase: 'code_review', tasks, baseBranch: 'main', cwd: process.env.COLD_LENS_CWD });
    if (!r.success) { console.error('cold review failed for ' + c.name); process.exit(1); }
}
```

  The policy reads only `status.task_size` / `status.delicate` (`toPolicyInputs`, `policy.ts`), so minimal task objects are enough. Omit `metricsContext` so nothing writes telemetry.
- Cases, in order: `L` non-delicate, `M` delicate, `M` non-delicate (one task each).
- Spawn with `spawnSync(process.execPath, ['--import', <abs tests/md-loader-register.mjs>, '--import', import.meta.resolve('tsx'), '--input-type=module', '-e', script], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, PATH: `${activeCwd}${path.delimiter}${process.env.PATH ?? ''}`, REVIEW_PARITY_LOG: log, CANON_TASKS_DIR_OVERRIDE: tasksRoot, COLD_LENS_CWD: activeCwd, COLD_LENS_CASES: JSON.stringify(cases), CODEX_MODEL_MINI: 'cold-lens-test-mini', CODEX_MODEL_FULL: 'cold-lens-test-full' } })`. Use explicit model values that differ from the shipped defaults. They take precedence over any `CODEX_MODEL_DEFAULT` / `CODEX_MODEL_DELICATE` or a developer's own `CODEX_MODEL_FULL` inherited from `process.env`.
- Assert `result.status === 0`, with stdout and stderr as the message. Read the log and assert exactly three captures, each `binary === 'codex'`, with literal argv:
  - L: `['exec','review','--json','-c','model_reasoning_effort=high','--base','main','-m','cold-lens-test-full']`
  - M delicate: same, `-m cold-lens-test-full`
  - M: same, `-m cold-lens-test-mini`
- Mark it `{ concurrency: false }` like its neighbours. Name it e.g. `cold lens model follows effective size: L and delicate → CODEX_MODEL_FULL, M → CODEX_MODEL_MINI`.

Why a child process: `policy.ts` freezes the env model values at import, and the test process has already imported it. `makeDeps` stubs the cold backend's config. Neither in-process route can catch a wrong cell (spec Known Risks).

### Step 4: Pipeline guide (AC-5, AC-4)

Files: `docs/pipeline-orchestrator.md` (canon-managed and shipped to adopters: describe behavior, and cite no `src/` paths or function names)

1. **Matrix row** (line 235): `| \`code_review\` (cold lens) | mini / high | mini / high | mini / high | full / high | full / high |`.
2. **Line 237**, "the mini model handles most phases; the full model only comes out for XL or delicate work": change it to say the full model comes out for XL or delicate work and for the cold-Codex review lens at L. Keep the rest of the paragraph (the M/L implement Luna-at-`max` text).
3. **Line 239**, the "deliberately flat" paragraph: replace the whole paragraph. Suggested text: "In mixed mode the cold-Codex `code_review` lens runs at `high` effort at every size: the mini model at XS, S and M, and the full model at L and XL/delicate, where diffs are largest and defects most often get past review. `CODEX_MODEL_FULL` therefore also steers the lens at L and XL/delicate, and `CODEX_MODEL_MINI` steers it at XS–M. A bundle runs one cold review at its effective size, so one L, XL, or delicate member puts the whole bundle's cold review on the full model."
4. **Env table** (lines 310-311). `CODEX_MODEL_MINI`: "Codex model for non-delicate `spec_review` and `implement` at XS–L, and for the non-delicate cold-Codex review lens at XS–M." `CODEX_MODEL_FULL`: "Codex model for XL or delicate phases, and for the cold-Codex review lens at L." Do not keep the literal `XS/S/M/L non-delicate`, which is an AC-4 grep phrase.
5. **Invocation description** (line 501): rename the placeholder `<miniModel>` → `<model>` in both places. Replace "(mini / `high` at every size)" with "(mini / `high` at XS–M, full / `high` at L and XL/delicate)".
6. **Delicate field-table row** (line 200): "Forces the XL bucket (in mixed mode the full Codex model, including the cold-Codex review lens; high Claude …)".
7. **Delicate paragraph** (line 221): "promotes spec review, implementation, and in mixed mode the cold-Codex review lens to their XL cells (in mixed mode, the full Codex model)".

Then run `npm run sync-templates` so `templates/docs/pipeline-orchestrator.md` updates, and confirm with `npm run sync-templates:check`. Do not hand-edit the mirror.

### Step 5: README (AC-5)

Files: `README.md`

- Line 67 (problem/solution table): "…moves spec review, implementation, and (in mixed mode) the cold-Codex review lens to the XL cells (the full Codex model in mixed mode)…".
- Line 100: "…plus moves spec review, implementation, and, in mixed mode, the cold-Codex review lens to their XL cells (in mixed mode, the full Codex model); QA stays on its regular cells." The phrase `review lens stay on their regular` must no longer appear (AC-4).

### Step 6: Recovery skill (AC-5)

Files: `.claude/skills/canon-pipeline/recovery.md` (canon-managed; the mirror `templates/.claude/skills/canon-pipeline/recovery.md` is regenerated by `npm run sync-templates`)

At line 84, keep the sentence and insert a clause after "only reaching the top tier guarantees that", e.g. "(in mixed mode, an M→L bump does swap the cold-Codex review lens to the full model)". Cite no source paths.

### Step 7: Decision record (AC-6)

Files: `docs/decisions.md`

- **Supersession pointer:** in §"Cold-Codex code-review lens: orchestrator-run, sequential, hard-fail (2026-06)" (line 358), add an inline italic pointer right after "…overrides still apply to its model." Follow the existing house style (`*(Superseded by "…")*`, e.g. line 225). Example: `*(The model clause, both the \`-m <miniModel>\` invocation and the mini-at-every-size pin above, is superseded by "Cold-Codex lens uses the full model at L and XL/delicate (2026-11)"; the sequential, hard-fail, bundle, and verbatim-findings rules below stay in force.)*`. Rename no headings. Do not rewrite the 2026-06 text.
- **New section** appended at the end of the file, after the "Judgment calls…" section, with a `---` separator only if neighbouring sections use one. Heading: `## Cold-Codex lens uses the full model at L and XL/delicate (2026-11)`. Use `**Decision**`, `**Why**`, and `**Rule**` paragraphs, the same labels as the 2026-06 entry it supersedes.
  - Decision: the `code_review` cells are XS/S/M mini/`high` and L/XL (incl. delicate and any bundle with a delicate member) full/`high`. The lens keeps no prompt and its sequential, hard-fail, one-review-per-bundle contract. `CODEX_MODEL_FULL`/`CODEX_MODEL_DELICATE` now steer it at L/XL, and `CODEX_MODEL_MINI`/`CODEX_MODEL_DEFAULT` at XS–M. It supersedes only the model clause of the 2026-06 entry.
  - Why: summarize the spec's *Problem*. Give the post-PR defect-fix gradient ("a private adopter project", 384 PRs: XS 16% / S 40% / M 49% / L 68%; canon-ai 39 PRs: S 57% / M 78%), with ~80% caught by the PR-level bot after the lens passed. Give the finding-rate drop (~36% → ~14% → ~10%) tracking the move to mini. Cite the PR #120 positive replay and the PR #88 null replay; both are canon-ai's own public PRs, so naming them is fine. Include the **evidence-strength caveat**: the size gradient doesn't prove a model-tier effect, the causal evidence is one positive and one null replay, the positive replay was delicate, and L rests on its leak rate and low share. Also give why M was not included and why `spec_review` L was not changed (23-task classification).
  - Rule: rollback is installing the previous canon release, since no per-phase Codex override exists. Re-measurement is tracked in the BACKLOG entry (Step 8), covering the cold-lens finding rate and the post-PR defect-fix rate on L and delicate tasks, plus whether M should follow.
  - Name no private project or path. AC-7's grep (`\bGP\b|[Gg]allery|@capacitor|Style\.Dark`) must find nothing in the added lines.

### Step 8: BACKLOG re-measurement entry (AC-7)

Files: `docs/BACKLOG.md`

Replace the whole `CODEX_MODEL_REVIEW` entry (lines 162-169, from the `- [ ]` bullet through its `**Effort**` line) in place with a re-measurement follow-up:
- Title, e.g.: `**Re-measure the cold-Codex lens after the L/XL full-model switch** *(filed 2026-11-04 when \`cold-lens-full-model-l-xl\` moved L and XL/delicate \`code_review\` cells to the full model. **Priority: measurement — run after a release has been in use for a few weeks.**)*`
- **Baseline**: keep the yield numbers verbatim (36% n=39 / 14% n=122 / 10% n=83, 17% counting every round; the 26 Luna-era findings breakdown; 28 of 42). Generalize the private details: "canon-ai + GP" → "canon-ai and a private adopter project", and the `@capacitor/status-bar` `Style.Dark` claim → "the same inverted platform-API claim, repeated across rounds".
- **Measure**: (1) the cold-lens finding rate (share of tasks whose last cold-Codex run had ≥1 finding, plus unique accepted catches) on L and delicate tasks after the release; (2) the post-PR defect-fix rate on L and delicate task PRs vs. the pre-change gradient.
- **Open question**: whether M should follow (49–78% leak rate, but common, so cost is higher). Keep the `CODEX_MODEL_REVIEW` per-phase override idea as a one-line rejected/parked alternative ("only if a future trial needs it").
- **Risk/Effort** lines are optional; keep them short.
- Drop the old "Restatements to update" bullet, since this task does that work. Also drop "GP picks it up only after…".
- Check: `sed -n '<entry range>p' docs/BACKLOG.md | grep -nE '\bGP\b|[Gg]allery|@capacitor|Style\.Dark'` returns nothing.

### Step 9: Changelog (AC-8)

Files: `CHANGELOG.md`

Under `## [Unreleased]` (currently empty) add `### Changed` with one adopter-facing bullet in the 3.17.0 style (bold lead sentence, plain prose). Draft:

> - **The mixed-mode cold-Codex review lens uses the full Codex model on L and XL/delicate tasks.** XS, S and M tasks keep the mini model; effort stays `high` everywhere. `CODEX_MODEL_FULL` now also steers the lens on L, XL and delicate tasks, so a custom full-model override reaches it. A bundle that contains an L, XL, or delicate member runs its single cold review on the full model. To go back to the mini model at every size, install the previous canon release; there is no per-phase override.

No private names (AC-7 grep).

### Step 10: Sync, build, validate (AC-9, Validation Required)

1. `npm run sync-templates`, then `npm run sync-templates:check`.
2. `npm run build`. Commit `dist/orchestrator/run-task.js`, which changes because the matrix literal lives there (`function codexMatrix` at `dist/orchestrator/run-task.js:745`). `dist/cli/index.js` holds only the env config, not the matrix, so the rebuild is expected to leave it unchanged. List it in `handoff.md`'s Changes table only if `git diff` shows it changed: a listed path absent from the diff fails the handoff coverage check. Either way AC-9 holds if `git diff --exit-code -- dist/` is clean after committing.
3. `npm run lint && npm run type-check && npm test`, then `npm run docs-refs-check`.
4. Run the AC-4 grep from the spec verbatim. Expected remaining hits: only `docs/decisions.md` line(s) in the 2026-06 section covered by the new pointer. If any `docs/BACKLOG.md`, `src`, `templates`, `README.md`, or `.claude` hit remains, fix it.

## Testing Plan

- **Unit**: `tests/pipeline-policy.test.ts`. Edit the `CODEX_MATRIX` L/XL `code_review` rows and the delicate-M assertion, and add the 3-row bundle table (AC-1, AC-2). The existing "every Codex matrix effort is one the Codex effort validator accepts" test needs no change, since effort stays `high`.
- **Integration (spawned)**: `tests/run-task-code-review.test.ts`. One new child-process test through the real `agentBackendFor` → `codexBackend.coldReview` → `runColdCodexReview` path with a fake `codex` on `PATH` and explicit `CODEX_MODEL_MINI`/`CODEX_MODEL_FULL` values, asserting the literal argv per case (AC-3). The existing parity test still passes unchanged: it reads `codex.model` dynamically.
- Scoped quick run while iterating: `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='codex matrix|review invocation parity|cold lens model' tests/pipeline-policy.test.ts tests/run-task-code-review.test.ts`.
- **E2E**: N/A (no UI).

## Open Questions (unattended session)

- None blocking. The `dist/cli/index.js` expectation mismatch is recorded in `notes.md` and handled in Step 10.
