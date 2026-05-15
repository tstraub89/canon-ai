# Implementation Handoff: adopt-eslint

> Author: Codex | Spec: `tasks/adopt-eslint/spec.md` | Plan: `tasks/adopt-eslint/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

| File | What Changed |
|---|---|
| `package.json` | Added `eslint` and `typescript-eslint` to `devDependencies`, plus a `lint` script for `eslint scripts/ tests/`. |
| `package-lock.json` | Refreshed the resolved dependency tree to include ESLint and typescript-eslint, with the root package stanza updated to match the new manifest. |
| `eslint.config.mjs` | Added the flat config using `typescript-eslint`’s `recommendedTypeChecked` preset and `projectService: true`. |
| `scripts/run-task.ts` | Fixed the lint surface with type-aware JSON parsing, redundant-cast removals, and runtime guards for phase statuses / verdicts. |
| `tests/pipeline-policy.test.ts` | Prefixed every top-level `test()` registration with `void` to satisfy `no-floating-promises`. |
| `tests/run-task-parse-porcelain.test.ts` | Prefixed every top-level `test()` registration with `void` to satisfy `no-floating-promises`. |
| `tests/run-task-validation.test.ts` | Prefixed every top-level `test()` registration with `void` to satisfy `no-floating-promises`. |
| `docs/architecture.md` | Rewrote the Validation table linting row to make `npm run lint` required. |
| `docs/codebase-map.md` | Added the `eslint.config.mjs` entry in the configuration table. |
| `tasks/adopt-eslint/status.json` | Advanced the task phase to `implement → done` through the task helper. |
| `tasks/adopt-eslint/notes.md` | Added scratch notes about the lint fix and lockfile refresh behavior. |

## Intent & Rationale

The task establishes ESLint as the repo’s lint gate using `typescript-eslint`’s type-aware recommended rules. The implementation keeps the flat config minimal, wires the new command into `package.json`, and fixes the existing violations instead of suppressing them. The `run-task.ts` change preserves the tuple-driven type derivation while also giving those tuples a real runtime role so the config’s `no-unused-vars` rule stays satisfied.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Kept `_PHASE_STATUS_VALUES` / `_VERDICT_VALUES` but added runtime guards (`isPhaseStatus()` / `isVerdict()`) instead of relying on underscore-only suppression. | `@typescript-eslint/no-unused-vars` still flagged the tuples when they were used only in type positions. Using them in runtime guards preserved the tuple-derived types and removed the lint error without suppressions. | None; the resulting behavior is stricter for malformed `status.json` values. |
| Refreshed `package-lock.json` from the generated `node_modules/.package-lock.json` instead of relying on a live `npm install --package-lock-only`. | The install command stalled in this sandbox. The generated lockfile from the shared install already matched the resolved tree, so it was the deterministic source of truth. | None; `package-lock.json` now matches the installed dependency graph. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: `eslint`, `typescript-eslint` are in `devDependencies` in `package.json`. | Met | Both deps were added to [package.json](/Users/tstraub/dev-worktrees/adopt-eslint/package.json), and the lockfile reflects them. |
| AC-2: `eslint.config.mjs` exists at the repo root with the specified flat-config shape. | Met | [eslint.config.mjs](/Users/tstraub/dev-worktrees/adopt-eslint/eslint.config.mjs) uses `typescript-eslint.configs.recommendedTypeChecked` and `projectService: true`. |
| AC-3: `package.json` has a `lint` script: `eslint scripts/ tests/`. | Met | The script is present and used by validation. |
| AC-4: `npm run lint` exits 0 with no errors or warnings. | Met | Final run passed clean after the runtime tuple guards were added. |
| AC-5: `npm test` still passes with the same test count. | Met | Final run passed with 66 tests, matching the current suite count. |
| AC-6: `npm run type-check` still passes. | Met | Final run passed clean. |
| AC-7: `docs/architecture.md` Validation table Linting row updated from `N/A` to `npm run lint`. | Met | The entire row was rewritten to the required command and note. |
| AC-8: `docs/codebase-map.md` Configuration table has an entry for `eslint.config.mjs`. | Met | Added a dedicated row for the flat config. |

## Edge Cases Considered

- Only top-level `test()` / `it()` registrations were wrapped in `void`; nested test callbacks were left alone.
- The `getPhaseStatus()` / `getVerdict()` helpers now reject malformed serialized values instead of trusting arbitrary parsed JSON.
- The lockfile refresh used the generated installed-tree lockfile after `npm install --package-lock-only` stalled in this sandbox.

## Blockers

- None.

## Validation Outcomes

> All applicable checks must pass before submitting for review. If a check appears in spec.md's Validation Required section, it must be recorded as Pass or Fail here — do not mark a required check N/A. Use N/A only for checks that the spec did not require, and explain why in Notes. Failed checks must be fixed — do not submit with failures. Move unresolved failures to Blockers.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Exited 0 with no errors or warnings. |
| `npm run type-check` | Pass | Exited 0. |
| `npm test` | Pass | Exited 0; reported 66 tests. |
| `Full build` | N/A | No build step exists for canon-ai; scripts run directly through `tsx`. |
| `End-to-end` | N/A | No UI surface or E2E harness exists for this repo. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [x] Branch is current with `origin/<base>`

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Findings addressed

- _correctness bug:_ "<one-line summary>" → fixed at file:line
- _risk/guardrail:_ ... → ...
- _spec gap:_ ... → ...
- _optional cleanup/nit:_ ... → addressed / deferred (rationale)

### AC deltas (if any)

- AC-N: was Partial → now Met (file:line)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |
-->
