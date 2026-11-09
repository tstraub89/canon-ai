# Implementation Handoff: spec-prompts-term-renames-rule

> Author: Codex | Spec: `tasks/spec-prompts-term-renames-rule/spec.md` | Plan: `tasks/spec-prompts-term-renames-rule/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/prompts/templates/spec.md` | Added the exact term-renames bullet from the spec Decision between the refactor audit and UI task bullets. |
| `src/orchestrator/prompts/templates/spec-revision.md` | Added the identical term-renames bullet at the same position. |
| `tests/run-task-prompts.test.ts` | Added a parity test for the two skill copies, both prompt templates, the identical full bullet, and both rendered prompt outputs. |
| `tests/run-task-prompts.golden.json` | Regenerated only `promptSpec`, `promptSpecRevision`, `promptSpec_withDocsMap`, and `promptSpecRevision_withDocsMap`. |
| `dist/orchestrator/run-task.js` | Rebuilt the bundled prompt templates. |

## Canon Governance

The authoritative provenance stamp for this task lives in the `canon` fields of `tasks/spec-prompts-term-renames-rule/status.json`.

## Intent & Rationale

Carry the existing canon-spec term-renames rule into both spec-authoring prompt paths, including spec revision, and pin the carriers and rendered outputs with a regression test. The wording is copied byte-for-byte from the spec Decision so both prompt variants stay aligned.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| None. | Implemented the planned template, parity test, golden, and bundle changes. | None. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1: Exact bullet placement in both templates | Met | Compared each line with the fenced Decision bullet and checked that the preceding refactor audit and following UI task lines are adjacent. |
| AC-2: Four rendered prompt goldens | Met | `UPDATE_GOLDENS=1 npm test` changed exactly the four named keys; `tests/completion.golden.json` is byte-identical to HEAD. |
| AC-3: Parity regression test and red-first run | Met | The new test asserts both skill copies, both prompt templates, identical full bullet lines, and both builder outputs. It failed on the base commit for the missing prompt-template phrase, then passed after the change. |
| AC-4: Scope and prompt-template grep | Met | The worktree diff, excluding task artifacts, contains exactly the five Affected Files. `grep -rl 'gate per string family' src/orchestrator/prompts/templates/` returns only `src/orchestrator/prompts/templates/spec.md` and `src/orchestrator/prompts/templates/spec-revision.md`. The orchestrator owns the subsequent commit and committed-range check. |
| AC-5: Rebuilt bundle and freshness | Met | `npm run build` regenerated `dist/orchestrator/run-task.js`; it contains the title phrase. A repeat build produced identical bytes (SHA-256 `3eb3c61342955d4b0156464b8ab136fef8f963693e04afd01afccc80efa0d10a`). The committed-dist freshness command runs after the orchestrator commits the listed files. |

## Edge Cases Considered

- Checked `promptSpec` and `promptSpecRevision` in their normal and `withDocsMap` golden variants.
- The parity test requires exactly one title-bearing line in each prompt template, and compares the full lines.
- Confirmed the title phrase appears only in the two spec-authoring prompt templates under `src/orchestrator/prompts/templates/`.

## Blockers

- [ambiguity] The phase metadata and spec validation list contain the literal `<E2E>` without an executable command. I interpreted it using `docs/architecture.md`'s End-to-end tests mapping: this prompt-template-only change has no UI surface or end-to-end runtime, so E2E is N/A. The lint, type-check, build, and full unit suite all ran.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-3 | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='term-renames guidance stays aligned across spec surfaces' tests/run-task-prompts.test.ts` | `288499c1e7d8b22d270a58fbaee39cbd6681b65f` | Failed at the assertion for `src/orchestrator/prompts/templates/spec.md`: it was missing `Codebase-wide term renames: gate per string family, not per enumerated hit`. | The same command passed after adding the bullet to both prompt templates. |

## Self-Check

| Check | Evidence |
|---|---|
| Test integrity | `tests/run-task-prompts.test.ts` checks the title in `.claude/skills/canon-spec/SKILL.md`, `templates/.claude/skills/canon-spec/SKILL.md`, and both prompt templates; requires one identical full bullet line per template; and checks outputs of `promptSpec` and `promptSpecRevision`. The AC-3 red-first row above records the failure on the base commit and the passing post-fix run. |
| Restatement sweep | Searched the title phrase across both skill copies and `src/orchestrator/prompts/templates/`. Both skill copies already carry the longer canonical version and remain unchanged per Non-Goals; the two prompt template hits are the only intended additions. The scoped grep `grep -rl 'gate per string family' src/orchestrator/prompts/templates/` returned exactly `src/orchestrator/prompts/templates/spec.md` and `src/orchestrator/prompts/templates/spec-revision.md`. |
| Sibling parity | Checked the parallel authoring paths: `promptSpec` and `promptSpecRevision` both receive the rule, use identical text, and are covered by standard and docs-map goldens. Other phase prompts remain unchanged per Non-Goals. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Exit 0. |
| `npm run type-check` | Pass | Exit 0. |
| `UPDATE_GOLDENS=1 npm test` | Pass | Full suite: 2,174 passed, 1 skipped, 0 failed. Changed golden keys are exactly the four listed in AC-2. |
| `npm test` | Pass | Full suite against the regenerated goldens: 2,174 passed, 1 skipped, 0 failed. |
| `npm run build` | Pass | Rebuilt both build entries; only `dist/orchestrator/run-task.js` is changed for this task. |
| End-to-end tests (`<E2E>`) | N/A | No UI surface or end-to-end runtime applies; see `docs/architecture.md`'s validation mapping. |
| `git diff --exit-code -- tests/completion.golden.json` | Pass | No diff. |
| `git diff --check` | Pass | No whitespace errors. |
| Repeated build byte check | Pass | Second build matched the first bundle's SHA-256 listed under AC-5. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass
- [x] All deviations from plan documented with rationale
