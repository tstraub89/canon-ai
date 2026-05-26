# Implementation Handoff: preflight-exempt-telemetry

> Author: Codex | Spec: `tasks/preflight-exempt-telemetry/spec.md` | Plan: `tasks/preflight-exempt-telemetry/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.

| File | What Changed |
|---|---|
| `scripts/run-task/validation.ts` | Replaced the empty `HANDOFF_DIFF_EXEMPT_PATHS` initializer with `new Set<string>(PIPELINE_TELEMETRY_FILES)` and added the explanatory comment block above it. No control-flow changes in the diff→handoff or rename loops. |
| `tests/run-task-validation.test.ts` | Added the two requested `verifyHandoffAgainstDiffFromData` regression tests covering the telemetry exemption and the non-telemetry negative control. |
| `dist/cli/index.js` | Regenerated via `npm run build`; the bundled validator now carries the telemetry exemption in `HANDOFF_DIFF_EXEMPT_PATHS`. |
| `dist/scripts/run-task.js` | Regenerated via `npm run build`; the bundled validator now carries the telemetry exemption in `HANDOFF_DIFF_EXEMPT_PATHS`. |

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

This task only needed one functional change: widen the diff→handoff exemption set to include telemetry files that are written by QA or the orchestrator, not by Codex. The validator already had the correct loops in place; the false-positive came from the set being empty, so post-reroute telemetry edits in the cumulative branch diff were being mistaken for missing Codex handoff coverage. The added tests reproduce the PR #107 case and confirm the exemption does not weaken the existing rejection for real non-telemetry misses.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| _(none)_ | The implementation followed the plan exactly: one validator constant change, two tests, then a build to refresh `dist/`. | None |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: `HANDOFF_DIFF_EXEMPT_PATHS` in [`scripts/run-task/validation.ts`](../../scripts/run-task/validation.ts) is changed from `new Set([])` to a `ReadonlySet<string>` containing every entry of `PIPELINE_TELEMETRY_FILES`. The initializer must reference the imported `PIPELINE_TELEMETRY_FILES` symbol by name (do not duplicate the string list). | Met | Implemented as `new Set<string>(PIPELINE_TELEMETRY_FILES)` at [`scripts/run-task/validation.ts`](../../scripts/run-task/validation.ts). |
| AC-2: The diff→handoff loop at [`validation.ts:948-953`](../../scripts/run-task/validation.ts) and rename loop at [`validation.ts:955-963`](../../scripts/run-task/validation.ts) are left structurally unchanged — they already consult `HANDOFF_DIFF_EXEMPT_PATHS`. | Met | The loops still consult `HANDOFF_DIFF_EXEMPT_PATHS`; only the set initializer changed. |
| AC-3: The comment block above `HANDOFF_DIFF_EXEMPT_PATHS` is updated to explain *why* telemetry files are exempt (written by QA / orchestrator, not Codex; their presence in cumulative branch diff is noise on post-reroute runs). Reference PR #107 as the discovery vector. | Met | Added the PR #107 rationale and the QA/orchestrator provenance in [`scripts/run-task/validation.ts`](../../scripts/run-task/validation.ts). |
| AC-4: A new test in `tests/run-task-validation.test.ts` named exactly `'verifyHandoffAgainstDiffFromData exempts PIPELINE_TELEMETRY_FILES from diff→handoff check'` replays the PR #107 scenario. `diffFiles` contains `'src/foo.ts'`, `'docs/lessons-learned.md'`, `'docs/pipeline-invocations.md'`, `'docs/task-quality-log.md'`; `handoffFilesByTask` (built via the existing `makeHandoffMap` helper) covers only `'src/foo.ts'`. Asserts `issues` is empty (`assert.deepEqual(issues, [])`). | Met | Added the exact test name and assertion in [`tests/run-task-validation.test.ts`](../../tests/run-task-validation.test.ts). |
| AC-5: A second test named exactly `'verifyHandoffAgainstDiffFromData still rejects non-telemetry diff files missing from handoff when telemetry is also present'` confirms the existing rejection still works alongside the exemption: `diffFiles` contains `'docs/lessons-learned.md'` AND `'src/baz.ts'`; `handoffFilesByTask` covers neither. Asserts exactly one issue, containing the substring `'src/baz.ts'` and NOT containing `'lessons-learned'`. | Met | Added the exact negative-control test in [`tests/run-task-validation.test.ts`](../../tests/run-task-validation.test.ts). |
| AC-6: `npm run build` regenerates `dist/cli/index.js` and `dist/scripts/run-task.js`; both contain the `PIPELINE_TELEMETRY_FILES` reference inside `HANDOFF_DIFF_EXEMPT_PATHS`. The regenerated `dist/` files are committed alongside source (project's "Full build" rule from `docs/architecture.md`). | Met | Rebuilt successfully; both bundled files contain `new Set(PIPELINE_TELEMETRY_FILES)` in `HANDOFF_DIFF_EXEMPT_PATHS`. |
| AC-7: `npm run lint`, `npm run type-check`, `npm test`, `npm run docs-refs-check`, and `npm run sync-templates:check` all pass. | Met | All required validation commands passed in this worktree. |

## Edge Cases Considered

- Telemetry files remain exempt only in the diff→handoff direction. If Codex spuriously lists a telemetry file in the handoff without a matching diff entry, the existing handoff→diff check still fails.
- The rename loop stayed untouched structurally, so the existing rename coverage behavior continues to apply with the widened exemption set.
- `PIPELINE_MANAGED_DOCS` were intentionally not exempted. A QA-side edit to one of those files after reroute would still fail this pre-flight and needs a separate fix if it becomes a recurring issue.

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
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | |
| `npm run build` | Pass | Regenerated `dist/cli/index.js` and `dist/scripts/run-task.js`. |
| `npm run docs-refs-check` | Pass | |
| `npm run sync-templates:check` | Pass | |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [x] Branch is current with `origin/<base>`

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

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
