# Spec: empty-model-env-unset — Treat empty model env vars as unset

> Written by: Claude | Review by: spec reviewer
> Status: draft

> **Full-send mode**: This spec was produced in full-send mode.

## Problem

GitHub #131, plus the empty-`CODEX_MODEL_*` bullet of #185. Canon reads its model environment variables once, at module load, in `src/orchestrator/policy.ts`. Most of them use `?? null`, so an exported empty variable (`CLAUDE_MODEL=`) counts as **set** and its empty string is used as a model name:

- `CLAUDE_MODEL`, `CLAUDE_MODEL_QA`, `CLAUDE_MODEL_SPEC_REVIEW`, `CLAUDE_MODEL_IMPLEMENT`, `CLAUDE_MODEL_SPEC`, `CLAUDE_MODEL_PLAN`, `CLAUDE_MODEL_REVIEW`, `CLAUDE_MODEL_REVIEW_LARGE` use `?? null`.
- `CODEX_MODEL_MINI` / `CODEX_MODEL_FULL` use `process.env.CODEX_MODEL_MINI ?? process.env.CODEX_MODEL_DEFAULT` (and the same for `FULL` / `DELICATE`).
- `CLAUDE_MODEL_LIGHT` / `CLAUDE_MODEL_STRONG` already use `|| null`, so `''` is unset, but a whitespace-only value (`'  '`) is truthy and still counts as set.

**Confirmed mechanism (deterministic, executed).** A throwaway script ran `policyConfig()` with `CLAUDE_MODEL=`, `CODEX_MODEL_MINI=`, `CODEX_MODEL_DEFAULT=legacy-mini`, `CLAUDE_MODEL_LIGHT='  '` and `CLAUDE_MODEL_QA` unset. It printed `claudeModelLegacy: ""` and `codexModelMini: ""`. So the empty `CODEX_MODEL_MINI` hides both the set legacy `CODEX_MODEL_DEFAULT` and the built-in default. The resolver then uses these values as real models:

- **Claude, `src/lib/pipeline-policy.ts` `resolveClaudeModel`:**
  - A non-null pin wins.
  - QA returns `config.claudeModelLegacy ?? QA_DEFAULT_MODEL`, which is `''`.
  - The light and strong cells return the legacy value when it is `!== null`, which is `''`.

  So every Claude phase without a pin or tier variable spawns `claude --model ''`. An empty phase pin (`CLAUDE_MODEL_SPEC=`) wins over everything.
- **Codex, `getCodexConfig` in `policy.ts`:** it resolves `config.codexModelMini ?? section.models.mini ?? 'gpt-6-luna'` to `''`, so the `.canon/config.json` model is also ignored and Codex runs with `-m ''`.

`warnLegacyEnvVars` in `src/orchestrator/env.ts` already uses a truthy check, so an empty legacy variable gives no deprecation warning. A whitespace-only one does warn today.

## Decision

Every model environment variable canon reads counts as **unset** when it is empty or whitespace-only. When the value is non-empty, canon uses it with surrounding whitespace trimmed. This applies to all `CLAUDE_MODEL*` variables (the phase pins, the light/strong tier variables and legacy `CLAUDE_MODEL`) and to `CODEX_MODEL_MINI`, `CODEX_MODEL_FULL` and their deprecated fallbacks `CODEX_MODEL_DEFAULT` and `CODEX_MODEL_DELICATE`.

An unset value falls through the existing precedence chain unchanged:

- **Claude:** phase pin → light/strong variable → legacy `CLAUDE_MODEL` → default.
- **Codex:** `CODEX_MODEL_MINI` → `CODEX_MODEL_DEFAULT` → `codex.models.mini` → `gpt-6-luna`, and the same for full.

The deprecation warning for legacy variables follows the same rule: an empty or whitespace-only legacy variable is unset, so canon prints no warning.

## Judgment Calls

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| Whitespace-only values | Treat as unset, like empty | Treat only `''` as unset, matching today's `CLAUDE_MODEL_LIGHT` behavior | No model name is whitespace. A stray space from a shell `export X= ` is the same mistake as an empty value. Canon's existing empty-means-unset precedent, `CANON_UPSTREAM_REPO` in `canon-snapshot.ts`, trims first | `Author` |
| Non-empty values | Trimmed before use | Used verbatim | A trailing space in `CLAUDE_MODEL=opus ` would otherwise reach `--model` and fail at the provider. `.canon/config.json` model strings reject whitespace-only values but are stored untrimmed (`docs-freshness.ts`), so after this change env and config differ on surrounding spaces. Trimming config models is left out of scope (see Non-Goals) | `Author` |
| Blank value: silent or warn | Silently treat as unset | Warn "X is set but empty; ignoring" | Canon's precedent is silent: `CANON_PROVIDER` treats unset or empty as `mixed` with no message (`policy.ts` `resolveProviderSetting`; pipeline-orchestrator.md Environment Variables) | `Author` |
| Helper location | One exported helper in `src/orchestrator/env.ts`, used by `policy.ts` and `warnLegacyEnvVars` | Helper in `policy.ts`, with a second check in `env.ts` | `policy.ts` already imports `env.ts`, so `env.ts` can't import back without a cycle. One helper keeps the resolver and the warning from disagreeing about what counts as set | `Author` |
| Scope beyond models | Model variables only | Also `CLAUDE_BUDGET`, which has the same `??` empty-string issue | #131 and the #185 bullet are about models. The budget is a different value type (a number) with its own parsing, so it's tracked separately (see Non-Goals) | `Author` |
| Delicate | No | Yes, because `docs/product-context.md` lists pipeline policy as delicate | The delicate entry names `src/lib/pipeline-policy.ts`, the matrix and fallback chain. That file is unchanged here. This change only normalises env input before the chain sees it, and a wrong model shows up immediately in each phase's `Model:` log line | `Author` |

## Non-Goals

- No change to the precedence chains, the defaults or the model matrix in `src/lib/pipeline-policy.ts`. That file stays untouched (AC-5).
- `CLAUDE_BUDGET`'s empty-string handling is not fixed here. It needs its own number parsing.
- No new validation that a non-empty model name is a real model.
- `.canon/config.json` model strings are not trimmed here (they are already rejected when empty or whitespace-only).
- `CODEX_EFFORT_*` legacy warnings keep their current check; only model variables use the new helper.
- The other #185 items (doctor wording, the unknown-key hint, duplicated defaults, the deprecation text) are not addressed here.

## Acceptance Criteria

The model variables, all 12: `CLAUDE_MODEL`, `CLAUDE_MODEL_QA`, `CLAUDE_MODEL_SPEC_REVIEW`, `CLAUDE_MODEL_IMPLEMENT`, `CLAUDE_MODEL_SPEC`, `CLAUDE_MODEL_PLAN`, `CLAUDE_MODEL_REVIEW`, `CLAUDE_MODEL_REVIEW_LARGE`, `CLAUDE_MODEL_LIGHT`, `CLAUDE_MODEL_STRONG`, `CODEX_MODEL_MINI`, `CODEX_MODEL_FULL`, plus the deprecated fallbacks `CODEX_MODEL_DEFAULT` and `CODEX_MODEL_DELICATE`.

- [ ] **AC-1: empty and whitespace-only values count as unset, for every model variable.** `tests/pipeline-policy.test.ts`, via the spawned-process helper `loadPolicyConfigForEnv` (env is captured at module load). For each variable above and for each of `''` and `'  '`, the matching `policyConfig()` field equals what it is when the variable is unset. Use a loop over the names, like the existing pin test. Resolution cases:
  - With `CLAUDE_MODEL` blank, QA resolves to `claude-haiku-5-5`, a light cell to `sonnet` and a strong cell to `opus`.
  - With `CLAUDE_MODEL_QA` blank and `CLAUDE_MODEL=legacy-x`, QA resolves to `legacy-x`.
  - With a phase pin blank, the cell falls through to its tier or default model.
  - With `CODEX_MODEL_MINI` blank and `CODEX_MODEL_DEFAULT=legacy-mini`, the result is `legacy-mini`. With both blank or unset, the result is `gpt-6-luna`. With `CODEX_MODEL_MINI` unset and `CODEX_MODEL_DEFAULT` blank, the result is also `gpt-6-luna`. The same holds for `FULL` / `DELICATE` → `gpt-6.2-sol`.
- [ ] **AC-2: a blank Codex env model falls through to config.** With a `.canon/config.json` setting `codex.models.mini: config-mini` and `codex.models.full: config-full`, setting `CODEX_MODEL_MINI` and `CODEX_MODEL_FULL` to `''` gives `config-mini` and `config-full`. Test it through `getCodexConfig`, or through the Codex backend invocation path that `tests/run-task-codex-config.test.ts` already uses.
- [ ] **AC-3: non-empty values are trimmed.** `CLAUDE_MODEL_QA=' opus '` resolves to `opus`, and `CODEX_MODEL_MINI=' m '` to `m`.
- [ ] **AC-4: legacy-warning behavior (new tests; no warning tests exist today).** `warnLegacyEnvVars` prints no warning for `CLAUDE_MODEL`, `CODEX_MODEL_DEFAULT` or `CODEX_MODEL_DELICATE` set to `'  '`. It still prints its existing warning for each when set to a non-empty value. The `CODEX_EFFORT_*` warnings are unchanged.
- [ ] **AC-5: one normaliser, structurally checked.**
  - `src/orchestrator/env.ts` exports one helper that takes a variable name and returns the trimmed value, or `null` when unset or blank.
  - `grep -rnE "process\.env(\.|\[['\"])(CLAUDE_MODEL|CODEX_MODEL)" src/` returns no lines.
  - Each of the 14 names above appears as a string argument to that helper.
  - `CLAUDE_BUDGET` is still read as it is today, and a `CLAUDE_BUDGET=''` assertion in the same test file shows `claudeBudget` unchanged.
  - `git diff main -- src/lib/pipeline-policy.ts` is empty.
- [ ] **AC-6: red-first.** The AC-1 blank-`CLAUDE_MODEL` and blank-`CODEX_MODEL_MINI` cases fail on `main` before the fix, because they resolve to `''`, and pass after. Record both runs in the handoff.
- [ ] **AC-7: docs.** `docs/pipeline-orchestrator.md` and its mirror `templates/docs/pipeline-orchestrator.md` say once, in the Environment Variables section, that an empty or whitespace-only model variable counts as unset and that values are trimmed. `npm run sync-templates:check` passes.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/env.ts` | Export the env-model helper (trim; blank → `null`); `warnLegacyEnvVars` uses it for the three legacy model variables |
| `src/orchestrator/policy.ts` | Read every `CLAUDE_MODEL*` and `CODEX_MODEL*` variable, including the deprecated Codex fallbacks, through the helper |
| `tests/pipeline-policy.test.ts` | AC-1, AC-3, AC-4, AC-5 (budget) and AC-6 cases |
| `tests/run-task-codex-config.test.ts` | AC-2: blank `CODEX_MODEL_MINI`/`FULL` fall through to the configured models |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | One sentence: empty or whitespace-only model variables count as unset; mirror synced |
| `dist/` | Rebuilt bundles that include `policy.ts` and `env.ts` |

### Implementation Notes (non-binding)

- The helper might be `envModel(name: string): string | null`, returning `process.env[name]?.trim() || null`. Compose the Codex chain as `envModel('CODEX_MODEL_MINI') ?? envModel('CODEX_MODEL_DEFAULT')`.

### Interaction Dependencies

- Every Claude and Codex phase's model selection reads these values. The precedence chain and defaults are unchanged.
- The deprecation warning at run start.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite
- [x] `npm run build` — `dist/` rebuilt and committed
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`

## Docs Impact

- `docs/pipeline-orchestrator.md` and its mirror are edited (AC-7).
- `README.md` restates the precedence chain but says nothing about empty values, so it isn't stale and needs no edit.
- `docs/decisions.md` records the Claude and Codex precedence chains, which are unchanged. QA should confirm no edit is needed.

## Known Risks

- **Module-load capture.** policy.ts reads env once, at import, so in-process `process.env` changes have no effect on `policyConfig()`. Policy tests must use the spawned `loadPolicyConfigForEnv`. `warnLegacyEnvVars` reads env when it is called, so in-process env changes work there.
- **An over-broad trim.** If the helper is applied to a non-model variable by mistake, for example the budget, it would change behavior outside scope. AC-5 pins the 14 names and checks that `CLAUDE_BUDGET` is unchanged.

## Human Test Plan

1. Export an empty Claude model variable (for example the legacy catch-all) and start a pipeline run on a small task.
2. Expected: the run log shows the normal default model for each phase (for example Sonnet for a small spec, Haiku for QA), not a blank model, and the run doesn't fail at agent start.
3. Export an empty Codex mini model variable while the project config names a mini model, and run a phase that uses Codex.
4. Expected: the Codex phase uses the configured model.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files uses exactly one `### Affected Files` heading under `## Design`, one file per row, each with a specific change
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] If this spec replaces existing behavior: framed as one replacement with a structural grep AC (AC-5)
- [x] Non-Goals rules out the most tempting scope expansions (budget, pipeline-policy.ts), backed by AC-5
- [x] Symbols named in ACs actually exist in the codebase (grep-verified: `policyConfig`, `getCodexConfig`, `warnLegacyEnvVars`, `loadPolicyConfigForEnv`, `resolveClaudeModel`, `QA_DEFAULT_MODEL`)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug fix) *Problem* states the confirmed mechanism with executed confirmation; AC-6 is the red-first regression test
- [x] (Refactors) N/A — bug fix
- [x] *Judgment Calls* lists every judgment call with its strongest alternative and Decided by
