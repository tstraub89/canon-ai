# Implementation Handoff: default-qa-model-to-haiku

> Author: Codex | Spec: `tasks/default-qa-model-to-haiku/spec.md` | Plan: `tasks/default-qa-model-to-haiku/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/lib/pipeline-policy.ts`, `src/orchestrator/env.ts`, `dist/orchestrator/run-task.js` | Added the QA-specific model default and legacy warning; rebuilt the runtime bundle. |
| `tests/pipeline-policy.test.ts` | Updated matrix assertions and added QA precedence coverage for every size and delicate M. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Updated the model matrix and environment-variable guidance; regenerated the managed mirror. |
| `docs/product-context.md` | Updated the full-tier QA model summary. |
| `docs/decisions.md` | Added the Haiku default decision and superseding notes on the 2026-09 QA rationale and precedence. |

## Canon Governance

The provenance stamp is recorded in the `.canon` field of `tasks/default-qa-model-to-haiku/status.json`; this handoff does not duplicate those values.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

QA now uses a distinct policy tier with `CLAUDE_MODEL_QA` first, legacy `CLAUDE_MODEL` second, and `claude-haiku-5-5` as the default. QA remains at medium effort for XS through XL and delicate tasks. Light and strong tiers continue to govern their existing cells.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| None | Implemented the planned QA tier, precedence, tests, documentation, template sync, and build. | None |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1: matrix cells | Met | Matrix tests cover all sizes, and delicate M keeps QA at Haiku/medium while other Claude cells retain their prior model and effort. |
| AC-2: QA precedence | Met | Tests cover QA pin, legacy fallback, light/strong isolation, all sizes, delicate M, and medium effort. Existing tier-cell assertions remain covered. |
| AC-3: legacy warning | Met | Warning text names `CLAUDE_MODEL_QA` and retains the every-Claude-phase fallback wording; its test passes. |
| AC-4: docs sweep | Met | Updated the matrix, environment-variable guide, product summary, and `effectiveSize` comment. Both specified stale-phrase greps return zero matches. |
| AC-5: no new knob | Met | Source grep returns exactly the seven model variables named in the spec. |
| AC-6: decisions entry | Met | Added the decision, matrix, evidence, alternatives, precedence, adopter changes and rollback, measurement rule, and three superseding notes. |
| AC-7: mirror and build outputs | Met | Template sync and build pass; the rebuilt `dist/orchestrator/run-task.js` contains `claude-haiku-5-5` and is clean against the index after its implementation commit. |

## Edge Cases Considered

- QA behavior with each of XS, S, M, L, XL, and delicate M.
- `CLAUDE_MODEL_QA` overriding legacy and tier variables.
- Legacy `CLAUDE_MODEL` taking precedence over light and strong tier variables for QA.
- Light and strong variables leaving QA on its own default when no legacy fallback or QA pin is set.
- QA effort remaining medium for every model choice.

## Blockers

- None.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-1/AC-2 plan mutation check | `node --import tsx --test tests/pipeline-policy.test.ts` | `acbe1e3bd35312267005269cf27266a93517391d` with the QA dispatch branch temporarily removed | QA matrix and precedence tests failed; the QA cell followed the strong-tier fallback instead of returning Haiku. | Restored the branch; focused suite passes 109 tests and the full suite passes. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Re-run after the test assertion update. |
| `npm run type-check` | Pass | Re-run after the test assertion update. |
| `npm test` | Pass | 1,756 passed, 1 skipped, 0 failed. |
| `node --import tsx --test tests/pipeline-policy.test.ts` | Pass | 109 passed, 0 failed. |
| `npm run build` | Pass | Rebuilt `dist/orchestrator/run-task.js`; model-string grep count is 1. |
| `git diff --exit-code -- dist/` | Pass | Re-run after committing the generated runtime bundle; no diff remains under `dist/`. |
| `npm run sync-templates` | Pass | Regenerated the `docs/pipeline-orchestrator.md` mirror. |
| `npm run sync-templates:check` | Pass | All canon-managed files are in sync. |
| `npm run docs-refs-check` | Pass | All refs OK after the final docs update. |
| AC-4 stale-phrase greps | Pass | Both specified greps returned zero matches. |
| AC-5 model-variable grep | Pass | Exact expected set: LIGHT, PLAN, QA, REVIEW, REVIEW_LARGE, SPEC, STRONG. |
| `git diff --check` | Pass | No whitespace errors. |

## Ready for Review

- [x] All spec ACs met
- [x] All applicable validation checks pass
- [x] All deviations from plan documented
