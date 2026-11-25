# Implementation Handoff: empty-model-env-unset

> Author: implementer | Spec: `tasks/empty-model-env-unset/spec.md` | Plan: `tasks/empty-model-env-unset/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/env.ts`, `src/orchestrator/policy.ts` | Added and applied the shared model env normalizer; model legacy warnings use it. |
| `tests/pipeline-policy.test.ts`, `tests/run-task-codex-config.test.ts` | Added blank, whitespace, trim, warning, budget, and config-fallback coverage. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Documented blank model values and trimming in Environment Variables. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuilt bundles. |

## Intent & Rationale

Normalize model environment input once at the shared env boundary so whitespace and empty values fall through existing precedence while non-empty values are trimmed. The budget and effort warning paths remain unchanged.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| None | Followed the planned helper and test approach. | None |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Spawned policy tests compare all 14 blank/whitespace variables against unset baselines; resolution assertions cover Claude defaults and Codex fallback/defaults. |
| AC-2 | Met | Blank mini/full env values resolve to configured models through `getCodexConfig`. |
| AC-3 | Met | Padded Claude QA and Codex mini values resolve trimmed. |
| AC-4 | Met | Warning test checks blank model variables stay silent, non-empty legacy values warn, and effort warning remains. |
| AC-5 | Met | `envModel` is the sole source env reader for all 14 model names; `CLAUDE_BUDGET` remains direct and empty; `src/lib/pipeline-policy.ts` is untouched. |
| AC-6 | Met | Both red-first checks reproduced against the pre-fix policy source; see evidence below. |
| AC-7 | Met | Environment Variables docs and mirror contain the rule once; sync check passed. |

## Edge Cases Considered

- Unset, empty, whitespace-only, and padded non-empty model env values.
- Deprecated Codex fallbacks retain precedence after blank primary values.
- `CLAUDE_BUDGET=''` stays `''`.
- Effort deprecation warnings retain their original truthy check.

## Blockers

- None.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-6 Claude | `node --import tsx --test --test-name-pattern='blank legacy model overrides' tests/pipeline-policy.test.ts` | Pre-fix working-tree source (before implementation) | `'' !== 'sonnet'` for blank `CLAUDE_MODEL`. | Included in passing policy tests. |
| AC-6 Codex | `CODEX_MODEL_MINI='' node --import tsx --eval "import('./src/orchestrator/policy.ts').then(m => { if (m.policyConfig().codexModelMini !== '') process.exit(1); console.log('codexModelMini='); })"` | `HEAD` policy source, restored immediately after the check | Printed `codexModelMini=`: blank mini was treated as a real model instead of falling through. | Blank-model policy/config tests pass with the fix. |

## Self-Check

| Check | Evidence |
|---|---|
| Test integrity | `tests/pipeline-policy.test.ts` pins blank/whitespace values to unset baselines, trimmed values, warning counts, and unchanged empty budget; `tests/run-task-codex-config.test.ts` pins configured mini/full values. Red-first failures above establish the two primary regressions without the fix. |
| Restatement sweep | Searched `CLAUDE_MODEL`, `CODEX_MODEL`, `empty or whitespace-only model` and `trimmed` across `src/`, `docs/`, and `templates/docs/`. No runtime contract duplicates needed changes; the environment reference and its mirror are the two requested doc surfaces. Separate `rg -n 'CLAUDE_MODEL' src/` and `rg -n 'CODEX_MODEL' src/` searches confirm there are no direct `process.env` model reads. |
| Sibling parity | Examined every Claude pin/tier/legacy variable and both Codex primary/fallback pairs in `src/orchestrator/policy.ts`; each routes through `envModel`. The three model legacy warnings use the same helper; the separate `CODEX_EFFORT_*` path remains unchanged as specified. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 2,322 passed, 1 skipped. |
| `npm run build` | Pass | Rebuilt `dist/`. |
| `npm run sync-templates:check` | Pass | |
| `npm run docs-refs-check` | Pass | |

## Iteration 2 — addressing review round 1

### Findings addressed

- **AC-1 coverage:** added explicit fallback assertions for blank Claude legacy, QA pin, and phase pin values; Codex mini/full blank primaries with deprecated fallbacks; and blank deprecated fallbacks reaching built-in defaults. AC-1 is now fully covered.
- **Warning helper consistency:** `warnLegacyEnvVars` now routes every `LEGACY_FALLBACK_ENV_VARS` entry through `envModel`; the separate ignored `CODEX_EFFORT_*` list keeps its prior behavior.
- **Warning test isolation:** the test now saves, sets, and restores `CODEX_EFFORT_DELICATE` alongside `CODEX_EFFORT_DEFAULT`.

### AC delta

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Added the named precedence assertions from Review Round 1 Finding 1; targeted policy tests and the full suite pass. |

### Self-Check

| Check | Evidence |
|---|---|
| Test integrity | In `tests/pipeline-policy.test.ts`, assertions pin blank `CLAUDE_MODEL` to Haiku QA and Opus strong cells, blank QA pin to `legacy-x`, blank spec pin to tier/default, blank Codex mini/full primaries to their deprecated fallback or built-in defaults, and restoration of both effort env variables. These fail on the unnormalized branch because blank primaries shadow the configured fallback/default; the unset-baseline loop also compares all 14 variables. `tests/run-task-codex-config.test.ts` separately pins blank env models to config values. |
| Sibling parity | Rechecked every model env read in `src/orchestrator/policy.ts`: all 10 Claude model variables plus both Codex primary/fallback pairs use `envModel`. All three entries in `LEGACY_FALLBACK_ENV_VARS` use `envModel`; `LEGACY_IGNORED_ENV_VARS` remains the separate effort-only path. Mini/full fallback and config paths are covered in `tests/pipeline-policy.test.ts` and `tests/run-task-codex-config.test.ts`. |

### Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 2,323 passed, 1 skipped. |
| `npm run build` | Pass | Rebuilt `dist/`. |
| `npm run sync-templates:check` | Pass | |
| `npm run docs-refs-check` | Pass | |

## Iteration 1 — addressing pre-flight rejection

### Changes

- Repaired the baseline Restatement sweep cell to avoid a literal pipe in its inline command; the handoff table parser treats that pipe as a cell boundary, and the row now parses as exactly two cells.

### Self-Check

| Check | Evidence |
|---|---|
| Restatement sweep | Rechecked the structural search `process.env` plus the `CLAUDE_MODEL`/`CODEX_MODEL` names across `src/`; it returns no direct reads. The two documentation hits are the requested [docs/pipeline-orchestrator.md](/home/user/canon-ai/.canon/worktrees/empty-model-env-unset/docs/pipeline-orchestrator.md) and [templates/docs/pipeline-orchestrator.md](/home/user/canon-ai/.canon/worktrees/empty-model-env-unset/templates/docs/pipeline-orchestrator.md); no additional in-scope restatement was found. |

### Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 2,322 passed, 1 skipped. |
| `npm run build` | Pass | Rebuilt `dist/`. |
| `npm run sync-templates:check` | Pass | |
| `npm run docs-refs-check` | Pass | |
