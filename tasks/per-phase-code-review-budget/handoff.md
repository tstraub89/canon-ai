# Implementation Handoff: per-phase-code-review-budget

> Author: Codex | Spec: `tasks/per-phase-code-review-budget/spec.md` | Plan: `tasks/per-phase-code-review-budget/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> The pre-flight coverage check reads rows ONLY from this table and from `### Changes` tables inside `## Iteration N` sections. A file-list table under any other heading is invisible to it — don't invent new coverage sections.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `scripts/pipeline-policy.ts` | Replaced the size-only Claude budget table with a `ClaudePhase` × `TaskSize` budget table and resolved budget inside the `.claude(phase)` closure. |
| `tests/pipeline-policy.test.ts` | Expanded budget assertions across `spec`, `plan`, `qa`, and `code_review`; updated `code_review` expected budget cells and the delicate XL-promotion assertion. |
| `docs/pipeline-orchestrator.md` | Added the Claude Budget Matrix and updated the `CLAUDE_BUDGET` env-var row to describe phase- and size-aware defaults plus the flat override behavior. |
| `docs/decisions.md` | Added the phase-aware `CLAUDE_BUDGET` decision record and marked the prior M/L equalization note as superseded. |
| `templates/docs/pipeline-orchestrator.md` | Regenerated the canon-managed mirror of `docs/pipeline-orchestrator.md`. |
| `dist/scripts/run-task.js` | Rebuilt published output containing the generated policy change. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`. Reference those fields here instead of duplicating them as a second source of truth.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

`code_review` now gets its own Claude budget curve while `spec`, `plan`, and `qa` retain the existing single-pass curve. The implementation keeps the policy module side-effect-free and table-driven: the env override still short-circuits all phases uniformly, and the Codex model/effort path remains untouched.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| _(none)_ | | |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: `code_review` budget curve by size | Met | `CODE_REVIEW_TABLE` and `BUDGET_TABLE` assert XS `5.00`, S `10.00`, M `15.00`, L `20.00`, XL `40.00`. |
| AC-2: `spec`/`plan`/`qa` unchanged | Met | `BUDGET_TABLE` asserts single-pass budgets XS/S `5.00`, M/L `10.00`, XL `20.00` for all three phases. |
| AC-3: delicate tasks use XL budgets | Met | `M delicate` budget row asserts single-pass `20.00` and `code_review` `40.00`; the existing delicate code-review model test now expects budget `40.00`. |
| AC-4: `CLAUDE_BUDGET` flat override | Met | Override test asserts `spec`, `plan`, `qa`, and `code_review` all return `20.00` for every budget-table row. |
| AC-5: `resolveBudget()` phase parameter and call sites | Met | `grep -n "resolveBudget(" scripts/pipeline-policy.ts` shows only the phase-aware signature and `resolveBudget(phase, effectiveSize, config.claudeBudget)` call. |
| AC-6: pipeline doc matrix | Met | `docs/pipeline-orchestrator.md` now has a `## Claude Budget Matrix` with single-pass and `code_review` rows across all sizes, plus the flat override note. |
| AC-7: rebuilt `dist/` output included | Met | `npm run build` passed twice and `dist/scripts/run-task.js` contains only the generated policy update. In the pre-auto-commit worktree, `git diff --exit-code -- dist/` reports that intentional dirty generated file; `dist/scripts/run-task.js` is listed above (literal path, not directory form — the auto-commit coverage check requires an exact match) for the orchestrator commit. |

## Edge Cases Considered

- `CLAUDE_BUDGET` remains flat because `resolveBudget()` still returns `claudeBudget` before consulting the phase table.
- `delicate: true` still promotes via `effectiveSize` before budget lookup, so every phase picks the XL row without a second delicate branch.
- `codex: (phase) => matrix[phase][effectiveSize]` was left unchanged; the budget change is isolated to Claude config.
- No standalone E2E npm script exists in `package.json`; the full `npm test` run covers the orchestrator subprocess/integration paths available in this repo.

## Blockers

- None.

## Validation Outcomes

> All applicable checks must record a result before submitting for review. Result values:
>
> | Value | Use when |
> |---|---|
> | `Pass` | Agent ran the check; it passed. |
> | `Fail` | Agent ran the check; it failed. Move unresolved failures to Blockers. |
> | `not_configured` | Check doesn't apply to this task type. Only valid for non-required checks. |
> | `N/A` | Legacy synonym for `not_configured`. Prefer `not_configured` going forward. |
> | `human_pending` | Only a human can run this (OAuth, cross-browser, deployed-only smoke). Required checks may use this state; the `human_review` gate will refuse to close the task until the human resolves it OR writes an explicit waiver in done.md. |
> | `deferred_by_spec` | Explicitly out of scope per spec. Requires a spec citation in Notes (e.g., `Spec: §Non-Goals — explicitly defers this`). |
> | `blocked` | Check would have run but infrastructure was unavailable (CI down, network out). Triage required — distinct from `Fail`. |
>
> Required checks (those in spec.md's Validation Required section) cannot be marked `N/A` or `not_configured` — adjust the spec or run the check.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | `eslint scripts/ tests/ src/` completed successfully. |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit` completed successfully. |
| `npm test` | Pass | Exact full-suite run passed: 939 tests, 938 pass, 1 skipped, 0 fail. |
| `npm run build` | Pass | Build completed successfully twice; rebuilt `dist/scripts/run-task.js` is listed in Changes. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates` | Pass | Regenerated `templates/docs/pipeline-orchestrator.md`. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `<E2E>` | Pass | No standalone E2E script is configured in `package.json`; covered by the full orchestrator integration/subprocess coverage in `npm test`, which passed. |
| `grep -n "resolveBudget(" scripts/pipeline-policy.ts` | Pass | Shows only the phase-aware signature and phase-aware call. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

| File | What Changed |
|---|---|

> **Reverting a file?** Perfect revert (no longer in `git diff base...HEAD`): delete it from all prior Changes tables and omit it here. Imperfect revert (still in diff, e.g. trailing newline): add it here as "Reverted to original (describe residual diff)".

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
