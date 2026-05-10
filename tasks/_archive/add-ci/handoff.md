# Implementation Handoff: add-ci

> Author: Codex | Spec: `tasks/add-ci/spec.md` | Plan: `tasks/add-ci/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

| File | What Changed |
|---|---|
| `.github/workflows/ci.yml` | Added a CI workflow for pushes and PRs to `main`/`dev`, with Node 22.x and 24.x matrix jobs, `paths-ignore`, concurrency cancellation, and the required `npm ci` → `npm audit --omit=dev` → `npm run lint` → `npm run type-check` → `npm test` sequence. |
| `package.json` | Changed the `test` script glob from `tests/**/*.test.ts` to `tests/*.test.ts` so `npm test` works under POSIX shells in CI. |
| `docs/architecture.md` | Replaced the stale CI gap text with the new workflow details, updated the unit-test binding to the new glob, and refreshed the Cross-platform row to point at the GitHub Actions matrix. |
| `docs/codebase-map.md` | Added an entry for `.github/workflows/ci.yml` in the Configuration table. |

## Intent & Rationale

The implementation adds the CI workflow described by the spec and keeps the repo docs aligned with the new behavior. The workflow is intentionally explicit about triggers, matrix versions, concurrency, and the exact validation sequence so branch protection can gate on the job names without additional interpretation.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Updated the `docs/architecture.md` unit-tests binding from `tests/**/*.test.ts` to `tests/*.test.ts`. | The `package.json` test script change made the existing validation row stale, so I kept the architecture doc consistent with the new script. | None; this tightens docs freshness around the same AC set. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: `.github/workflows/ci.yml` exists and is valid YAML. | Met | File added and validated by the workflow YAML content. |
| AC-2: Workflow triggers on push to `main` and `dev`, and on PRs targeting `main` and `dev`. No other branches trigger CI. | Met | Both `push` and `pull_request` are limited to `main`/`dev`; non-doc paths are gated by `paths-ignore`. |
| AC-3: Workflow runs a strategy matrix across Node `22.x` and `24.x`. | Met | Matrix is configured in `.github/workflows/ci.yml`. |
| AC-4: Each matrix job runs `npm ci`, then `npm audit --omit=dev`, then `npm run lint`, then `npm run type-check`, then `npm test` — in that order. | Met | Exact step order is in the workflow file. |
| AC-5: Workflow has a `concurrency` group keyed on `${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true`. | Met | Added verbatim. |
| AC-6: `push` and `pull_request` triggers both have `paths-ignore` covering `docs/**`, `tasks/**`, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `scripts/task.sh`, `.agent/**`, `.github/**/*.md`. | Met | Both events include the ignore list. |
| AC-7: Actions use `actions/checkout@v6` and `actions/setup-node@v6` (not deprecated v4). | Met | Workflow uses `@v6` for both actions. |
| AC-8: `package.json` `test` script uses `tests/*.test.ts` (single-star glob) instead of `tests/**/*.test.ts`. | Met | Script updated. |
| AC-9: `docs/architecture.md` Tech Stack bullet for CI is rewritten to describe the new workflow. | Met | Top-level CI bullet now points at `.github/workflows/ci.yml` and describes the checks. |
| AC-10: `docs/architecture.md` `## CI` section describes the new workflow and no longer says "no CI configured." | Met | Section rewritten with triggers, matrix, checks, concurrency, and branch-protection guidance. |
| AC-11: `docs/architecture.md` Validation table Cross-platform row updated to reference the CI matrix in `.github/workflows/ci.yml`. | Met | Row now points at the workflow matrix. |
| AC-12: `docs/architecture.md` no longer contains the strings "none currently configured" or "no CI configured" anywhere in the file. | Met | Verified after the rewrite. |
| AC-13: `docs/codebase-map.md` Configuration table includes an entry for `.github/workflows/ci.yml`. | Met | Added new row in the Configuration table. |
| AC-14: `npm audit --omit=dev` passes locally (no high/critical vulnerabilities in production deps). | Met | Passed with `found 0 vulnerabilities`. |
| AC-15: `npm run lint` passes locally. | Met | Passed. |
| AC-16: `npm run type-check` passes locally. | Met | Passed. |
| AC-17: `npm test` passes locally after the `package.json` change (test count unchanged — currently 58). | Met | `npm test` passed. The current suite reports 69 tests; the spec note saying 58 appears stale, but the glob change did not alter the suite shape. |

## Edge Cases Considered

- Doc-only commits are skipped by the workflow via `paths-ignore`, so task-artifact churn does not burn CI minutes.
- The single-star test glob only matches root-level tests, which matches the current tree and keeps the npm script portable across shells.
- Branch protection is intentionally left out of code and called out in the human test plan because it must be configured in GitHub UI.

## Blockers

- `[ambiguity]` The spec’s test-count note is stale: `npm test` currently reports 69 tests, not 58. I treated the AC as “the package.json glob change does not alter the suite” and verified that the suite passes unchanged, but the numeric note in the spec should be refreshed.

## Validation Outcomes

> All applicable checks must pass before submitting for review. If a check appears in spec.md's Validation Required section, it must be recorded as Pass or Fail here — do not mark a required check N/A. Use N/A only for checks that the spec did not require, and explain why in Notes. Failed checks must be fixed — do not submit with failures. Move unresolved failures to Blockers.

| Check | Result | Notes |
|---|---|---|
| `npm audit --omit=dev` | Pass | `found 0 vulnerabilities` |
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | `69` tests passed; the spec’s `58` note is stale, but this change did not alter the suite. |
| End-to-end | N/A | No UI surface; spec did not require E2E. |
| Full build | N/A | No build step in this repo. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [x] Branch is current with `origin/<base>`

