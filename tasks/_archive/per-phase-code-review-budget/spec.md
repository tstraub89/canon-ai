# Spec: per-phase-code-review-budget — Per-phase CLAUDE_BUDGET — code_review gets its own budget curve

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

`scripts/pipeline-policy.ts` resolves a single `budget` value per task size (`BUDGET_BY_SIZE: Record<TaskSize, string>` — XS/S `$5`, M/L `$10`, XL `$20`) and spreads that same figure into every Claude phase (`spec`, `plan`, `code_review`, `qa`) uniformly: `resolveBudget()` is called once per task (line 239, outside any phase-specific branch) and the result is spread into all four phases' returned config at line 247 (`claude: (phase) => ({ ...claudeMat[phase][effectiveSize], budget })`). Model and effort already vary correctly by phase (`claudeMatrix()`); budget does not.

Since `#182` (2026-06-27, "Add cold-Codex third lens to code_review"), `code_review` runs a structurally different — and structurally more expensive — workload than `spec`/`plan`/`qa`: an orchestrator-run cold-Codex diff review, then a Claude foreman that spawns an anchored-Claude lens and a cold-Claude lens and synthesizes all three inputs in one session, sometimes including empirical verification (reverting a fix and re-running the project's test suite to confirm a finding actually discriminates). `spec`/`plan`/`qa` do none of this — they're single-pass Claude sessions.

The uniform per-size budget cannot express this gap. Confirmed on a live task: an M-tier task in the `gallery_wall` project (running canon-ai's own pipeline) exhausted `code_review`'s just-raised $10 M-tier budget mid-review (`.canon-run.log`: `orchestrator exit code=1 [reason=claude session exited 1 (possible budget exhaustion — see CLAUDE_BUDGET)]` at the point the cold-Codex-lens findings were being synthesized), and needed a manual `CLAUDE_BUDGET=20.00` override (confirmed via `ps eww` on the live orchestrator process) to complete a third review iteration. Raising the uniform per-size number further would over-provision `spec`/`plan`/`qa`, which don't do this work and where a tight budget ceiling is a more useful circuit breaker on a genuinely runaway session.

This is a routing-policy gap, not a bug in the $10 M-tier bump itself (`docs/decisions.md` §"`spec_review` M effort raised medium → high (2026-07)" already documents that bump and flags it addresses reroute-severity, not phase-cost variance).

## Decision

Give `code_review` its own budget curve, independent of `spec`/`plan`/`qa`, keyed by the same `TaskSize` axis canon already uses for model/effort. `spec`/`plan`/`qa` keep their current size-based values unchanged.

New `code_review` budget by size (a smoother ramp, not a flat multiplier of the unchanged phases):

| Size | XS | S | M | L | XL |
|---|---|---|---|---|---|
| `spec`/`plan`/`qa` (unchanged) | $5.00 | $5.00 | $10.00 | $10.00 | $20.00 |
| `code_review` (new) | $5.00 | $10.00 | $15.00 | $20.00 | $40.00 |

`CLAUDE_BUDGET` remains a single flat env-var override: when set, it overrides every phase uniformly, exactly as it does today (`resolveBudget(effectiveSize, config.claudeBudget)`'s `claudeBudget ?? …` short-circuit). No new env var is introduced for per-phase overrides.

Structurally, this follows the same `Record<ClaudePhase, Record<TaskSize, T>>` shape `codexMatrix()` and `claudeMatrix()` already use for model/effort — `BUDGET_BY_SIZE` becomes phase-aware using that same convention, and `resolveBudget()` gains a `phase: ClaudePhase` parameter. The resolution moves from a single call before the `claude: (phase) => …` closure (today's line 239) to inside that closure, since the result now varies per phase.

## Non-Goals

- No new environment variable for a per-phase override (e.g. no `CLAUDE_BUDGET_CODE_REVIEW`) — the existing flat `CLAUDE_BUDGET` remains the only override, and it still applies to all phases uniformly when set.
- No change to Codex phases (`spec_review`, `implement`) — the `--max-budget-usd` flag is Claude-CLI-only (confirmed in `runClaude()`); Codex has no equivalent budget cap today and this task does not add one.
- No change to `MAX_REVIEW_LOOPS`, model, or effort routing for any phase or size.
- No mechanism to detect or surface "budget exhaustion may mean the task was mis-sized" — that's a separate, real idea (raised during spec discussion) but a distinct feature with its own detection/signal design; out of scope here.
- No change to the XS/S/M/L/XL number `spec`/`plan`/`qa` currently resolve to.

## Acceptance Criteria

- [ ] AC-1: `getPipelinePolicy(...).claude('code_review')` returns `budget: '5.00'` for XS, `'10.00'` for S, `'15.00'` for M, `'20.00'` for L, and `'40.00'` for XL (non-delicate, no `CLAUDE_BUDGET` env override) — verified by a table-driven test row per size in `tests/pipeline-policy.test.ts`.
- [ ] AC-2: `getPipelinePolicy(...).claude('spec')`, `.claude('plan')`, and `.claude('qa')` are unchanged from current behavior — `'5.00'` for XS/S, `'10.00'` for M/L, `'20.00'` for XL — verified by updating the existing `BUDGET_TABLE`/`CLAUDE_TABLE` rows in `tests/pipeline-policy.test.ts` to assert per-phase instead of a single flat `expected` value.
- [ ] AC-3: A `delicate: true` task (any nominal size) resolves `code_review` budget as `'40.00'` (the XL figure — delicate promotes `effectiveSize` to XL for routing purposes) and `spec`/`plan`/`qa` as `'20.00'`, matching XL non-delicate — verified by a delicate-specific test row.
- [ ] AC-4: Setting `CLAUDE_BUDGET=<n>` (env var) makes every phase — `spec`, `plan`, `code_review`, `qa` — resolve to `<n>` regardless of size or phase, preserving today's flat-override escape hatch — verified by a test row with `claudeBudget` set in `PolicyConfig`, asserting all four phases return the override value.
- [ ] AC-5: `resolveBudget()`'s signature includes a `phase: ClaudePhase` parameter; grep confirms no remaining call site invokes it without one (`grep -n "resolveBudget(" scripts/pipeline-policy.ts` shows only phase-aware call(s)).
- [ ] AC-6: `docs/pipeline-orchestrator.md`'s `CLAUDE_BUDGET` row (currently a single flat "size-aware" description) is replaced with a matrix table in the style of the existing `## Codex Model/Effort Matrix` section, showing the `spec`/`plan`/`qa` vs. `code_review` split across all five sizes, plus a one-line note that the env var override stays flat across phases.
- [ ] AC-7: `npm run build` produces no diff against the committed `dist/` (i.e. the rebuilt `dist/` is committed alongside the `scripts/pipeline-policy.ts` source change) — verified by running `npm run build && git diff --exit-code -- dist/`.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/pipeline-policy.ts` | Replace `BUDGET_BY_SIZE: Record<TaskSize, string>` with a phase-aware table (e.g. `BUDGET_BY_PHASE_AND_SIZE: Record<ClaudePhase, Record<TaskSize, string>>`), matching the `spec`/`plan`/`qa` values to today's `BUDGET_BY_SIZE` and adding the new `code_review` row. Add a `phase: ClaudePhase` parameter to `resolveBudget()`. Move the `budget` resolution from its current single call site (line 239, before the `claude: (phase) => …` closure) to inside that closure so it can vary per phase. |
| `tests/pipeline-policy.test.ts` | Restructure `BUDGET_TABLE` (currently one `expected` string asserted against both `spec` and `qa`) to assert per-phase; update `CLAUDE_TABLE`'s hardcoded `budget: '10.00'` expectations to be phase-correct; add a delicate-task row exercising `code_review` at the XL figure; add a `CLAUDE_BUDGET` env-override row asserting flat behavior across phases. `CODE_REVIEW_TABLE` (already asserts a `code_review`-specific budget per size) is the template to extend to the other three phases. |
| `docs/pipeline-orchestrator.md` | Replace the `CLAUDE_BUDGET` row in the `## Environment Variables` table (currently: *"Unset → tiered by effective size: XS/S `5.00`, M/L `10.00`, XL/delicate `20.00`. Set → flat cap for all phases."*) with a new subsection mirroring `## Codex Model/Effort Matrix`'s table format, showing the `spec`/`plan`/`qa` vs. `code_review` split. |
| `docs/decisions.md` | Extend the existing "`spec_review` M effort raised medium → high (2026-07)" entry (or add an adjacent entry) noting `CLAUDE_BUDGET` moved from a size-only axis to a phase+size axis, and why (`code_review`'s cold-Codex-lens + foreman-synthesis workload, added by `#182`, is structurally costlier than the single-pass phases) — so a future change doesn't flatten the axis back without re-deriving this reasoning. (`docs/decisions.md` is **not** canon-owned per `src/lib/canon-owned.ts`, so it has no auto-synced `templates/` mirror.) |
| `templates/docs/pipeline-orchestrator.md` (generated mirror) | Auto-regenerated by the pre-commit `sync-canon-templates` hook because `docs/pipeline-orchestrator.md` is canon-owned (`src/lib/canon-owned.ts:23`). Declared here per `docs/patterns.md` "Declare `templates/` mirrors of canon-managed edits in BOTH the spec Affected Files and the handoff Changes table" — no hand edit; it mirrors the root doc's change verbatim and must also appear in the implement handoff Changes table. |
| `dist/` (rebuilt, directory form) | `scripts/pipeline-policy.ts` bundles into the published CLI; committed `dist/` must match a fresh `npm run build` output per `docs/architecture.md` §Validation. Listed as a trailing-slash directory-form entry (the sanctioned form for build-generated output per the `human_review` allow-list carve-out, `docs/pipeline-orchestrator.md:305`), not a `dist/**` glob — the handoff/affected-files path parser rejects `*`/`?` wildcards (`scripts/run-task/validation.ts:1220`). |

### Interaction Dependencies

- `scripts/run-task/phases/code-review.ts`, `spec.ts`, `plan.ts`, `qa.ts` each call `getClaudeConfig(phase, tasks)` once per phase and pass `cfg.budget` into exactly one `runClaude(...)` call — no code change needed there; they already read whatever `getPipelinePolicy(...).claude(phase)` returns.
- `scripts/run-task/policy.ts` (`policyConfig()`) and `scripts/run-task/env.ts` read `CLAUDE_BUDGET` from `process.env` into a single flat string today — no change needed; the override remains flat by design (see Non-Goals).
- Bundle mode (multiple task IDs sharing one `code_review` invocation) already resolves `effectiveSize` as the bundle's max size before calling `.claude('code_review')` — the phase-aware table doesn't change bundle-sizing semantics, only which number that resolved size maps to for a given phase.

### Data Model Changes

None — no `status.json` schema change. This is confined to `scripts/pipeline-policy.ts`'s internal routing table and its test/doc coverage.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build` — required because `scripts/pipeline-policy.ts` bundles into the published CLI (`docs/architecture.md` §Validation: "Full build... Required for any change that affects `dist/` output... `scripts/pipeline-policy.ts`..."); committed `dist/` must match a fresh build
- [x] `npm run docs-refs-check` — required because `docs/pipeline-orchestrator.md` and `docs/decisions.md` change
- [ ] `<E2E>`

## Docs Impact

- `docs/pipeline-orchestrator.md` — `CLAUDE_BUDGET` env-var row replaced with a Phase × Size matrix table (see Affected Files).
- `docs/decisions.md` — existing 2026-07-11 budget-equalization entry extended (or a new adjacent entry added) to record the size-only → phase+size axis change.
- `docs/codebase-map.md`, `docs/patterns.md`, `docs/product-context.md` — none expected to go stale; `pipeline-policy.ts`'s existing "Pure Policy + Test Discipline" pattern entry in `docs/patterns.md` already describes exactly this kind of table-driven change and needs no update.

## Known Risks

- **Off-by-one on the phase/size table transcription.** Five sizes × two budget curves (three phases share one curve, `code_review` has its own) is 10 distinct cell values plus the delicate/XL promotion case. A transcription slip (e.g. swapping the L and XL `code_review` figures) would silently under- or over-provision a real pipeline run. Mitigated by AC-1/AC-2/AC-3's exhaustive per-cell test rows — every cell in the new table gets an explicit assertion, following the "Pure Policy + Test Discipline" pattern's rule that a matrix cell without a test row is a Stage 1 review failure.
- **`resolveBudget()` call-site relocation.** Moving the call from before the `claude: (phase) => …` closure to inside it must not accidentally change behavior for `codex: (phase) => matrix[phase][effectiveSize]` (the Codex arm, which has no budget field and must stay untouched) — AC-5's grep check plus the full `pipeline-policy.test.ts` suite passing covers this.
- **Delicate-task promotion interaction.** `delicate: true` promotes `effectiveSize` to `XL` before any matrix lookup (existing behavior, unchanged) — AC-3 exists specifically because a phase-aware table adds a second axis where this promotion must still apply correctly (both the `code_review` XL figure and the `spec`/`plan`/`qa` XL figure), not just the size axis alone.
- **Only the M cell has real evidence; S, L, and XL are unvalidated extrapolations.** The spec's sole empirical data point is the gallery_wall M-tier exhaustion. S ($10, a 100% jump from $5) and L ($20, a 100% jump from $10) are locked into AC-1's hard pass/fail assertions with the same certainty as the confirmed M cell, despite having no incident behind them — and XL ($40) compounds that: XL/delicate review already runs Opus at `xhigh`, which is expensive per-token independent of this change. The mechanism (phase-aware routing) is sound regardless of the exact numbers; if S, L, or XL prove insufficient or excessive once real usage data accumulates, that's a follow-up size-curve tuning task, not a sign this task's mechanism is wrong.

## Human Test Plan

1. Run a small (XS or S) task through the pipeline and watch the `code_review` phase's log line (`→ Model: ... | Effort: ... | Budget: ...`). Expected: the budget shown for `code_review` is higher than the budget shown for that same task's `spec`/`plan`/`qa` phases (except at XS, where they're equal).
2. Run (or inspect a recent) M-tier task's `code_review` phase. Expected: the budget shown is $15, not the old uniform $10 — enough headroom that a normal 3-lens review with one empirical test-rerun doesn't hit budget exhaustion.
3. Check the pipeline's documented environment variables. Expected: `CLAUDE_BUDGET` is now documented as a phase-aware matrix (like the existing Codex model/effort matrix), not a single flat size-tiered number.
4. Set `CLAUDE_BUDGET=15.00` manually before running any task. Expected: every phase (spec, plan, code_review, qa) uses exactly $15 — the manual override still works as a global escape hatch.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A, full tier (M, delicate)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]` (not `- [ ]`)
- [x] (Bug/flake fixes; N/A for features/refactors) — N/A, this is a routing-policy enhancement, not a bug fix
