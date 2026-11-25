# Implementation Plan: empty-model-env-unset

> Written by: Claude | Implements: `tasks/empty-model-env-unset/spec.md`

## Approach

Add one exported helper to `src/orchestrator/env.ts` that takes a variable name and returns its trimmed value, or `null` when the variable is unset, empty or whitespace-only. Route every model variable read in `policy.ts`, and the three legacy model warnings in `warnLegacyEnvVars`, through it. The precedence chain in `src/lib/pipeline-policy.ts` is unchanged. It already treats `null` as unset.

Feasibility check:
- **Exists:** These were found by searching the code:
  - `policyConfig` and `getCodexConfig` in `src/orchestrator/policy.ts`. The `config` object at lines 21-36 holds the 12 `process.env` model reads.
  - `warnLegacyEnvVars`, `LEGACY_FALLBACK_ENV_VARS` and `LEGACY_IGNORED_ENV_VARS` in `src/orchestrator/env.ts`.
  - `loadPolicyConfigForEnv` in `tests/pipeline-policy.test.ts`.
  - `cleanEnv` and the config-writing helpers in `tests/run-task-codex-config.test.ts`.
- **Real path:**
  - At module load, `policy.ts` builds `config`. `policyConfig()` then fills in the Codex defaults with `??`.
  - `getCodexConfig` resolves `config.codexModelMini ?? section.models.mini ?? default`. `getClaudeConfig` calls `getPipelinePolicy(...).claude`, which calls `resolveClaudeModel` and its `!== null` and `??` checks.
  - So a `null` from the helper falls through correctly with no change to the resolver.
- **Callers:**
  - `getClaudeConfig` is used only by `agents/claude.ts`.
  - `getCodexConfig` is used only by `agents/codex.ts`.
  - `warnLegacyEnvVars` is called only from `main.ts`.
  - No other file in `src/` reads these variables.
- **Tests that can fail:**
  - On `main`, a blank `CLAUDE_MODEL` gives `claudeModelLegacy === ''` (confirmed by running it), and a blank `CODEX_MODEL_MINI` gives `''`. Both differ from the "unset" baseline, so AC-1 is red before the fix.
  - For AC-4 on `main`, `'  '` is truthy and today prints a warning, so the no-warning test is red.
- **Predicates:**
  - The helper covers four inputs: `undefined`, `''`, whitespace-only (all return `null`) and padded non-empty (returns the trimmed value).
  - The `CODEX_EFFORT_*` warning keeps its current check (spec Non-Goals).
  - `CLAUDE_BUDGET` is not routed through the helper.
- **Scope:** every file below is in the spec's Affected Files.
- **Async/stateful:** N/A. Values are read once at module load. `warnLegacyEnvVars` reads them when called.

## Steps

### Step 1: Add the helper and use it in the legacy warning

Files: `src/orchestrator/env.ts`

Export `envModel(name: string): string | null`, returning `process.env[name]?.trim() || null`. In `warnLegacyEnvVars`, the `LEGACY_FALLBACK_ENV_VARS` loop (the three model names) uses `envModel(old) !== null` as its condition. Leave the `LEGACY_IGNORED_ENV_VARS` (`CODEX_EFFORT_*`) loop as it is.

### Step 2: Read the model variables through the helper

Files: `src/orchestrator/policy.ts`

Import `envModel` from `./env.js`, which policy.ts already imports from. Replace each of the 12 model reads in `config`:
- `claudeModelX: envModel('CLAUDE_MODEL_X')`, including `_LIGHT` and `_STRONG`, which used `|| null`.
- `claudeModelLegacy: envModel('CLAUDE_MODEL')`.
- `codexModelMini: envModel('CODEX_MODEL_MINI') ?? envModel('CODEX_MODEL_DEFAULT')`, and the same for full with `CODEX_MODEL_DELICATE`.

Adjust the `codexModelMini`/`Full` field types if they were `string | undefined`. The downstream `??` handles `null`. Leave `CLAUDE_BUDGET` and the other reads unchanged.

### Step 3: Tests

Files: `tests/pipeline-policy.test.ts`, `tests/run-task-codex-config.test.ts`

- **AC-1:**
  - Loop over the 14 names with `''` and `'  '`. Compare each `loadPolicyConfigForEnv({ [name]: value })` field with the same field from an all-unset baseline.
  - Add the resolution cases: QA, light and strong with blank `CLAUDE_MODEL`; QA with blank `CLAUDE_MODEL_QA` plus `CLAUDE_MODEL=legacy-x`; a blank pin falling through; the Codex legacy fallback and default cases for mini and full. Use the existing resolution helpers in that file.
- **AC-3:** padded values are trimmed.
- **AC-4:** call `warnLegacyEnvVars` in-process with a captured `warn` or stderr. A whitespace-only legacy model variable produces no warning; a non-empty one still warns; `CODEX_EFFORT_DEFAULT` still warns as before. Restore env in `finally`.
- **AC-5:** a `CLAUDE_BUDGET=''` case shows `claudeBudget` unchanged from today, `''`.
- **AC-2:** in `run-task-codex-config.test.ts`, write a config with `models: { mini: 'config-mini', full: 'config-full' }`, run with `CODEX_MODEL_MINI: ''` and `CODEX_MODEL_FULL: ''`, and assert both configured models are used. Follow the existing `cleanEnv` spawned-run pattern.
- **AC-6:** run the two red-first cases against `main`'s `policy.ts` (stash only the source change) and record the failures, then the passes, in the handoff.

### Step 4: Docs and build

Files: `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md`, `dist/`

Add one sentence under the Environment Variables table: "An empty or whitespace-only model variable counts as unset, and values are trimmed." Run `npm run sync-templates` and `npm run build`.

## Testing Plan

- **Unit:** the Step 3 cases, plus the full `npm test`.
- **E2E:** N/A, since there is no UI. The spawned-process tests exercise the real module-load path.
- **Manual:** `CLAUDE_MODEL= canon run` on a scratch task should log a non-blank `Model:`. This is optional; the Human Test Plan covers it.

## Rollback Plan

Revert the commit. There is no data or schema impact. Env values that worked before (non-empty, unpadded) resolve the same.
