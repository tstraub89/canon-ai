# Implementation Handoff: bundle-preflight-atomic-rejection

> Author: Codex | Spec: `tasks/bundle-preflight-atomic-rejection/spec.md` | Plan: `tasks/bundle-preflight-atomic-rejection/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.

| File | What Changed |
|---|---|
| `dist/scripts/run-task.js` | Regenerated build output for the code-review phase changes. |
| `scripts/run-task/phases/code-review.ts` | Added clean-sibling pre-flight review stubs, centralized bundle pre-flight artifact writing across all tasks, kept Route B auto-block semantics, and broadened Route A `taskPhasePreflightRejected` calls to all bundle tasks. |
| `tests/run-task-validation.test.ts` | Added isolated bundle pre-flight regression tests covering Route A, Route B, prior-review append behavior, pass-through no-op, single-task behavior, and existing bundle rerouting. |

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

The implementation keeps the existing pre-flight route split intact: fixable failures still reroute to implement, and blocked-only infrastructure failures still auto-block for human triage. The changed part is the bundle handling before those branches: every task in the bundle now gets a `review.md` artifact when any sibling fails pre-flight.

Failing tasks still receive the existing `buildPreflightReviewBlock` content. Clean siblings receive a route-specific stub that omits `## Stage 1`; fresh Route A stubs include the authoritative `Changes requested` checkbox, while appended Route A stubs and all Route B halt stubs omit verdict checkboxes so prior real review verdict parsing is preserved.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Added exported `writePreflightReviewArtifacts` in addition to `buildCleanTaskReviewStub`. | This gives tests a seam that exercises the same artifact loop used by `runCodeReviewPhase`, including failing-task vs clean-task selection and append-vs-fresh behavior. | Strengthens AC-1 through AC-4 and AC-14 coverage. |
| Did not edit `src/task/index.ts` docstring. | The plan requested it, but the spec's Affected Files table did not authorize that file and no AC requires the docstring change. | No AC impact. |
| `dist/cli/index.js` was not changed. | `npm run build` completed successfully, but the CLI bundle stayed byte-identical; only `dist/scripts/run-task.js` changed. | No AC impact; build validation still passed. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `writePreflightReviewArtifacts` enumerates all `tasks` when any `preflightFailed` entry exists; tests cover two-task and three-task bundles. |
| AC-2 | Met | Failing tasks still call `buildPreflightReviewBlock(classified, route)`; single-task and bundle tests assert the existing failing-task block shape. |
| AC-3 | Met | Clean Route A/Route B stubs omit `## Stage 1`; tests assert absence. |
| AC-4 | Met | Clean stubs append over prior real reviews using non-`## Round` headings and omit appended verdict checkboxes; prior-approved parser divergence is tested. |
| AC-5 | Met | Route A now calls `taskPhasePreflightRejected` for every task in `tasks`, not only `preflightFailed`; tests assert all bundle statuses. |
| AC-6 | Met | Route A tests assert every bundled task reaches `code_review.status = done` and `verdict = changes_requested`. |
| AC-7 | Met | Fresh clean Route A stubs include the specified rejection text, sibling links, and a `Changes requested` verdict parsed by `extractCheckedVerdict`. |
| AC-8 | Met | `checkAndRoute('code_review', ...)` test verifies all-`done` Route A statuses route the whole bundle back to implement via existing status verdicts. |
| AC-9 | Met | Route A tests assert pre-flight and changes-requested counters increment and iteration counters remain unchanged for all bundle tasks. |
| AC-10 | Met | Route B test uses existing `autoBlockPhase` for all task IDs and asserts blocked status/escalations without pre-flight or changes-requested counter bumps. |
| AC-11 | Met | Clean Route B halt stubs have no `## Verdict`, no checked changes-requested verdict, and no `## Stage 1`; tested. |
| AC-12 | Met | Existing `determinePreflightRoute` / `buildPreflightReviewBlock` behavior is unchanged and covered by the existing blocked-only route test plus new Route B bundle test. |
| AC-13 | Met | The combined loop-cap logic at the top of `runCodeReviewPhase` was left unchanged; Route A now increments `preflight_rejections_current_loop` on every bundle task, so the existing max-across-bundle cap still applies. |
| AC-14 | Met | Added tests for Route A 2-task, Route A 3-task, clean prior real review append, prior-approved divergence, Route B auto-block, all-pass no-op, and single-task Route A/Route B behavior. |

## Edge Cases Considered

- Clean sibling with no prior real review: fresh Route A stub includes the only checked verdict, so artifact parsing matches `status.json`.
- Clean sibling with prior approved review: appended Route A stub omits verdict checkboxes, so artifact parsing still returns the prior approval while status records the orchestrator rejection.
- Blocked-only route: clean halt stubs never carry routing verdicts, and status changes remain owned by `autoBlockPhase`.
- Single-task pre-flight failures: no clean-stub path is used, so the prior failing-task block shape is preserved.
- All tasks pass pre-flight: the artifact writer is a no-op when `preflightFailed` is empty.

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
| Linting (`npm run lint`) | Pass | |
| Type checking (`npm run type-check`) | Pass | |
| Unit tests (`npm test`) | Pass | 764 tests: 763 pass, 1 skipped. Also ran targeted `node --test --import ./tests/md-loader-register.mjs --import tsx tests/run-task-validation.test.ts`. |
| Full build (`npm run build`) | Pass | Regenerated `dist/scripts/run-task.js`; `dist/cli/index.js` remained byte-identical. |
| Docs references (`npm run docs-refs-check`) | Fail – unrelated | Pre-existing broken refs outside this task's Affected Files: docs/decisions.md:242 references missing tasks/codex-code-review-phase/evidence-codex-vs-claude.md; docs/decisions.md:244 references missing tasks/codex-code-review-phase/spec.md. |
| Canon-managed template sync (`npm run sync-templates:check`) | Pass | |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass or are documented as unrelated in Validation Outcomes
- [x] All deviations from plan documented with rationale
- [x] Branch is current with `origin/<base>` (local `origin/release/v1.10` is an ancestor of HEAD)

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
