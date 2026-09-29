# Implementation Handoff: rebaseline-claude-matrix-for-5-5

> Author: Codex | Spec: `tasks/rebaseline-claude-matrix-for-5-5/spec.md` | Plan: `tasks/rebaseline-claude-matrix-for-5-5/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/lib/pipeline-policy.ts` | Replaced the Claude matrix with light/strong tier resolution, medium/high effort, and pin → tier → legacy → default precedence. |
| `src/orchestrator/policy.ts` | Passes raw nullable Claude model overrides to the policy. |
| `src/orchestrator/env.ts` | Removed duplicate policy config fields and corrected the legacy model warning. |
| `tests/pipeline-policy.test.ts` | Covers all 20 cells, delicate/empty inputs, effort bounds, and subprocess override precedence and warning behavior. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Documented the Claude matrix and override scopes; regenerated the managed mirror. |
| `docs/product-context.md` | Corrected the XL/delicate Claude review claim. |
| `README.md` | Narrowed the `delicate` upgrade description to the phases it affects. |
| `docs/decisions.md` | Added the 2026-09 Claude 5.5 re-baseline decision, evidence, precedence, pinned-adopter impact, and rollback. |
| `dist/orchestrator/run-task.js` | Rebuilt the orchestrator bundle. |

## Canon Governance

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

Model precedence now resolves once per Claude cell in the pure policy layer. An unset phase pin remains distinguishable from an explicit model, so tier overrides and the legacy fallback can apply without changing effort. QA stays light/medium at every size.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Corrected the adjacent M/L QA-effort claim in the orchestrator doc. | QA effort is now equal at every size; leaving that sentence would contradict the new matrix. | Supports AC-5. |
| Initially kept the generated `dist/cli/index.js` at its pre-task content. | The original manifest omitted it; the operator added it in the 2026-09-29 correction and this iteration rebuilt it. | AC-8 is now met. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | The default 4×5 table, delicate M, and empty-list tests pass; budget tests remain unchanged. |
| AC-2 | Met | Every cell and delicate effort is medium/high; old helpers are absent; Codex tests remain unchanged and pass. |
| AC-3 | Met | Subprocess cases remove all inherited `CLAUDE_MODEL*` variables and cover each precedence layer and pin scope; all cases assert unchanged effort. |
| AC-4 | Met | `env.ts` has only the legacy message's Claude model name; `policy.ts` is the only source reading `process.env.CLAUDE_MODEL*`. |
| AC-5 | Met | Concrete Claude table, variable scopes, pin/effort rule, and tuning text are documented. |
| AC-6 | Met | Stale Claude claims and comments are corrected; remaining xhigh references on scoped surfaces describe Codex. |
| AC-7 | Met | New decision record follows the September Codex entry and covers the required table, evidence, precedence, effort change, and rollback. |
| AC-8 | Met | Mirror and both affected bundles are rebuilt; the prompt golden fixture is unchanged. The manifest correction now covers the CLI bundle. |

## Edge Cases Considered

- A delicate M task selects the XL model/effort cell, while QA remains light/medium.
- Review pins split at the XL boundary; `_REVIEW_LARGE` also covers delicate promotion.
- A legacy catch-all model reaches QA and yields to a tier variable or phase pin.
- Model overrides pass through custom model IDs and never alter effort.

## Blockers

- (none outstanding after the manifest correction; historical scope findings below are retained for context)
- [resolved] SG-1: the original harness test read the removed `env.config.maxReviewLoops` field and failed at `JSON.parse(undefined)`. The manifest correction authorized its retarget to `policyConfig().maxReviewLoops`; the latest full suite passes.
- [resolved] SG-2: a fresh build also changes `dist/cli/index.js` because the CLI imports the shared env module. The manifest correction authorized that generated bundle, which is now retained.
- [resolved] SG-3: `docs/patterns.md` and `docs/codebase-map.md` described the old resolver. The manifest correction authorized both guidance updates, now applied.
- [resolved] The pipeline evidence guard previously rejected the historical `npm test` failure. The latest re-run validation row is `Pass` after the authorized harness test update.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final run passed. |
| `npm run type-check` | Pass | Final run passed. |
| `npm test` | Fail | `tests/run-task-harness.test.ts:33` reads the removed env config field. This deterministic failure is caused by the required removal; see Blockers. |
| `node --test --import ./tests/md-loader-register.mjs --import tsx tests/pipeline-policy.test.ts` | Pass | 103 policy tests passed. |
| `npm run build` | Pass | Build completed; generated an additional unlisted CLI bundle delta that was restored under the scope cap. See Blockers. |
| `npm run sync-templates` | Pass | Mirror regenerated. |
| `npm run sync-templates:check` | Pass | All managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `git diff --check` | Pass | No whitespace errors. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (latest re-run results below; one expected skip)
- [x] All deviations from plan documented with rationale

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `tests/pipeline-policy.test.ts` | Expanded override assertions to all 20 cells, strong XL/delicate boundaries, legacy+tier combinations, and unaffected phases; covered empty tier values. |
| `src/lib/pipeline-policy.ts` | Made tier/effort a compile-time-complete 4×5 table and corrected the resolver-location header. |
| `src/orchestrator/policy.ts` | Treats empty new tier variables as unset while preserving existing pin and legacy behavior. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Documented legacy `CLAUDE_MODEL`, effective-size scaling for both agents, the fast-tier plan caveat, and the XL/delicate review-pin boundary; synced the mirror. |
| `docs/product-context.md` | Replaced the stale “lower effort” fast-tier description with its actual cells. |
| `docs/decisions.md` | Added a supersession note for historical Claude rules and restored the task-analysis reference. |
| `dist/orchestrator/run-task.js` | Rebuilt after the source revision. |
| `tests/run-task-harness.test.ts` | Retargeted the loop-cap validation test to `policyConfig()` without changing inputs or assertions. |
| `dist/cli/index.js` | Rebuilt the newly authorized CLI bundle. |
| `docs/patterns.md` | Corrected the pure-policy and environment-resolution guidance. |
| `docs/codebase-map.md` | Corrected the environment and policy module descriptions. |

### Findings addressed

- **CB-1 (correctness):** The precedence tests now check all 20 default cells for the light and strong tier overrides, both legacy+tier combinations, and every unaffected phase under each pin. The strong override is also checked at delicate M. The previously described XL and legacy+LIGHT mutations would now fail these assertions.
- **R-1 (risk):** The adopter-facing environment table now states the legacy catch-all's scope and the complete precedence order.
- **N-1–N-6, N-8–N-10 (optional):** Clarified historical supersession, resolver location, task-size and pin wording, fast-tier effort, table exhaustiveness, evidence reference, and truthful full-suite status. The prior `npm test` Validation Outcomes row now reads `Fail`, as the reviewer requested.
- **N-7 (optional):** Empty values for the two new tier variables now fall through as unset. Existing pins and legacy `CLAUDE_MODEL` retain their pre-task empty-string semantics.
- **SG-1 / SG-2 / SG-3 (spec gaps):** The 2026-09-29 manifest correction authorized all four missing files. The harness test now uses the surviving resolver, both bundles are rebuilt, and the two guidance docs name the sole policy resolver. No scope blocker remains.

### AC deltas

- **AC-3:** Stronger evidence for every override boundary; policy tests rose from 103 to 105 passing cases.
- **AC-5:** Legacy layer and size/pin scopes are now explicit in the shipped doc and mirror.
- **AC-8:** Partial → Met after the manifest correction and rebuilt CLI bundle.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final revision passed. |
| `npm run type-check` | Pass | Final revision passed. |
| `node --test --import ./tests/md-loader-register.mjs --import tsx tests/pipeline-policy.test.ts` | Pass | 105/105 passed. |
| `npm test` | Pass | Latest full run: 1,320 passed, one skipped, zero failed. The prior harness failure is resolved. |
| `npm run build` | Pass | Both orchestrator and newly authorized CLI bundles rebuilt. |
| `npm run sync-templates` | Pass | Mirror regenerated. |
| `npm run sync-templates:check` | Pass | All managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK after the guidance-doc edits. |
| `git diff --check` | Pass | No whitespace errors after the source and doc edits. |

### Manifest-correction follow-up

The operator amended the spec Affected Files table to include the four files previously identified by SG-1 through SG-3. This follow-up stays in iteration 2 because it completes the same review round. The initial validation failure remains in the baseline table as historical evidence; the latest re-run table above is authoritative for current status. The retargeted harness test passed all 16 focused cases, and the full suite passed. The generated CLI bundle is now retained for the orchestrator’s commit.
