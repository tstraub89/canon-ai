# Code Review: empty-model-env-unset

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lenses: anchored Claude, cold Claude, cold Codex (no findings).

## Stage 1: Validation Gate

Result: **pass**

| AC | Status | Note |
|---|---|---|
| AC-1 | Partial | The all-14-names loop in `tests/pipeline-policy.test.ts` covers blank and whitespace values against the unset baseline. Several named resolution cases have no assertion (see Finding 1). |
| AC-2 | Met | `tests/run-task-codex-config.test.ts` asserts `config-mini` and `config-full`. |
| AC-3 | Met | `' opus '` resolves to `opus` and `' m '` to `m`. |
| AC-4 | Met | Whitespace model legacy variables are silent. Non-empty ones warn, and the effort warning is unchanged. |
| AC-5 | Met | `envModel` is the single helper, and the structural grep is clean. `CLAUDE_BUDGET` is unchanged, and `src/lib/pipeline-policy.ts` is untouched. |
| AC-6 | Met | The handoff records both red-first runs. |
| AC-7 | Met | `docs/pipeline-orchestrator.md` and `templates/docs/pipeline-orchestrator.md` carry the same sentence once. |

## Stage 2: Findings

1. **code-bug (test coverage, AC-1)** — `tests/pipeline-policy.test.ts:364-368` (anchored lens; medium severity, high confidence). AC-1 lists explicit resolution cases, and these are unasserted:
   - blank `CLAUDE_MODEL` gives QA `claude-haiku-5-5` and a strong cell `opus`;
   - blank `CLAUDE_MODEL_QA` with `CLAUDE_MODEL=legacy-x` gives `legacy-x`;
   - a blank phase pin falls through to its tier or default model;
   - blank `CODEX_MODEL_MINI` with `CODEX_MODEL_DEFAULT=legacy-mini` gives `legacy-mini`;
   - the same holds for `FULL` / `DELICATE`, resolving to `gpt-6.2-sol` by default;
   - `CODEX_MODEL_MINI` unset with a blank `CODEX_MODEL_DEFAULT` gives `gpt-6-luna`.

   The baseline `deepEqual` loop cannot catch a blank primary variable that shadows a set fallback. The blank-`MINI` plus set-`DEFAULT` precedence, the core of #185, has no direct test. Add the missing assertions.
2. **nit** — `src/orchestrator/env.ts:58-60` (flagged by 2 lenses: anchored and cold-Claude). The ternary hard-codes three names. Route every `LEGACY_FALLBACK_ENV_VARS` entry through `envModel` if they are all model variables. Keep the `CODEX_EFFORT_*` check, which sits in a separate list.
3. **nit** — `tests/pipeline-policy.test.ts:389` (anchored lens). The warning test does not snapshot or restore `CODEX_EFFORT_DELICATE`, so an ambient value would break the `messages.length === 4` check.
4. **nit** — the handoff's AC-6 Claude row cites the pre-fix working tree rather than a commit. This is acceptable.

## Dismissed Cold Findings

- Dismissed (cold-Claude): `CLAUDE_BUDGET` is read raw, so an empty string passes through. Spec Non-Goals and AC-5 explicitly leave it out and assert it unchanged.
- Dismissed (cold-Codex): no actionable defects were reported. Finding 1 was not raised by it, but it is verified against the spec.

## Final Verdict

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

## Round 2

**Scope:** Delta — base `3cb58eeecc453f376ad52f8a588379c57739bde4` — reason: small fix within the files already under review

Lenses: anchored Claude (full diff, effective Self-Check and red-first record), cold Claude (delta), cold Codex (delta; no actionable defects).

### Stage 1

Result: **pass**. All of AC-1 through AC-7 are met. The Round 1 gap is closed: the new test `blank model overrides preserve Claude and Codex fallback precedence` in `tests/pipeline-policy.test.ts` asserts every resolution case AC-1 names.

### Stage 2

Round 1 items resolved:
- Finding 1: the AC-1 resolution assertions were added.
- Finding 2: `warnLegacyEnvVars` in `src/orchestrator/env.ts` now routes every entry through `envModel`.
- Finding 3: the warning test now snapshots and restores `CODEX_EFFORT_DELICATE`.

Surviving findings (nits only, no code-bugs):
- nit (anchored): `src/orchestrator/env.ts:26` places `envModel` above the path constants.
- nit (anchored): the test `blank legacy model overrides resolve like unset variables` overlaps the new precedence test. It is harmless, and the red-first command targets it by name.
- nit (cold-Claude): the warning test hard-codes a count of 5. This is a low-severity fragility.

### Dismissed Cold Findings

- Dismissed (cold-Claude): a future non-model entry in `LEGACY_FALLBACK_ENV_VARS` would be trimmed by `envModel`. All current entries are model variables, and the list holds fallbacks only.
- Dismissed (cold-Claude): the `LEGACY_IGNORED_ENV_VARS` effort check still uses truthiness. This is unchanged on purpose per the spec's Non-Goals.
- Dismissed (cold-Claude): `dist/` may not match a clean build. The change mirrors the source exactly, and the handoff reports the build.
- Dismissed (cold-Codex): no actionable defects were reported.

### Final Verdict

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
