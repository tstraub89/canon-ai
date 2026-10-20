# Implementation Handoff: autocommit-retry-at-review-entry

> Author: Codex | Spec: `tasks/autocommit-retry-at-review-entry/spec.md` | Plan: `tasks/autocommit-retry-at-review-entry/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed — or a comma-separated list of files in the first column when they're tightly coupled (e.g. a canon-managed root file with its `templates/` mirror, or a generated artifact with its source script). The first column holds one or more tokens — each either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — separated by commas, with an optional short note after the last token. No wildcards, no unfilled `<placeholder>` text, and no prose-embedded paths. Group only files that change together for the same reason; unrelated files read better on separate rows. Every listed path must exist in `git diff <base>...HEAD` after auto-commit.
>
> The pre-flight coverage check reads rows ONLY from this table and from `### Changes` tables inside `## Iteration N` sections. A file-list table under any other heading is invisible to it — don't invent new coverage sections.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

> **Directory paths:** backticking a path to an existing directory is fine — `docs-refs-check` accepts it. A backticked directory path that no longer exists (for example, one this task deleted) can be reported as a missing reference, so describe removed directories in prose or use the markdown-link form above.

| File | What Changed |
|---|---|
| `src/orchestrator/main.ts` | Share accepted-implement-at-HEAD check and retry auto-commit for dirty handoff files before code_review state construction. |
| `src/orchestrator/prompts/templates/code-review-foreman.md` | Add exact-heading citation rule in foreman step 4. |
| `tests/run-task-safety.test.ts` | Cover handoff-only retry, pipeline-owned dirt, accepted SHA/stale accept, and retry commit failure. |
| `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json` | Assert rendered citation rule and regenerate foreman prompt snapshots. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Document review-entry retry and failure behavior; regenerate managed mirror. |
| `dist/orchestrator/run-task.js` | Rebuild committed CLI bundle. |

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

The main loop retries the existing scoped auto-commit before building code_review state, but only when a handoff-listed file is dirty and operator acceptance does not still match HEAD. The existing commit guards remain authoritative.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| The safety tests call the exported retry helper directly instead of driving the full main-loop code_review pre-flight with a worktree fixture. | This pins commit selection, operator acceptance, and failure behavior in isolated git fixtures, but does not verify the integrated pre-flight counter/review.md outcome in the requested main-loop scenario. | AC-1 partial; AC-3 partial |
| The AC-1 regression was not run red against pre-fix code before the production change. | The retry implementation was applied before the new test was executed. The direct helper test passes after the fix, but there is no observed pre-fix failure. | AC-1 partial |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met. AC IDs may be flat-numbered (`AC-1`) or grouped under section letters (`AC-A1`) — mirror whatever scheme spec.md uses.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Partial | Dirty handoff file is committed by the retry helper test, but the full code_review main-loop/pre-flight integration and red-first run remain unverified. |
| AC-2 | Partial | Clean handoff with task artifact and telemetry dirt causes no retry/commit; the fixture calls the helper directly and does not assert code_review progression. |
| AC-3 | Partial | Failing pre-commit hook exits 1 with `Auto-commit failed:` and counters remain unchanged; helper-level fixture does not invoke a real pre-flight path. |
| AC-4 | Met | Current accepted SHA preserves HEAD and dirty source; moving HEAD makes the helper retry and commit. |
| AC-5 | Met | Dirty task review artifact and telemetry with clean handoff paths do not trigger retry. |
| AC-6 | Met | Prompt render assertion passes; both round 1 and round N goldens regenerated. |
| AC-7 | Met | Retry behavior documented and managed mirror synced. |
| AC-8 | Met | Required validations pass. |

## Edge Cases Considered

- Retry pre-check only considers paths parsed from handoff Changes rows; task artifacts and telemetry alone do not trigger it.
- Operator acceptance is honored only while every task's recorded accepted SHA equals active HEAD.

## Blockers

- AC-1 remains partially verified: add/run a worktree-mode main-loop fixture asserting committed range, zero preflight rejections, and no `handoff→diff` review block. Red-first behavior was not observed before the implementation.
- AC-2 and AC-3 likewise lack a full main-loop integration assertion; current fixtures invoke the retry helper directly.

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
> A `Fail` row whose cause lies outside this task's diff: name the result `Fail – unrelated` explicitly, and Notes must cite a specific file reference outside this task's affected files (a sibling worktree path, a fixed-port test's own file, an unrelated spec's path) — the code reviewer only accepts `Fail – unrelated` when Notes names such a reference credibly. Pre-flight's own check is textual — naming a changed file in that row, even to say it passed, can reclassify the whole row as task-owned and reject the handoff. Don't rely on an unqualified filename escaping the check; keep Notes free of any path from this task's diff.
> Record every check in spec.md's Validation Required section here, plus any extra checks you ran. Required checks should not be marked `N/A` or `not_configured` — run the check or adjust the spec; the code reviewer verifies coverage against the spec. The `Check` cell is for human readability (the pre-flight gate no longer string-matches it against the spec), so write whatever names the check clearly — but keep a check's label identical across a baseline row and any later `### Re-run validation` row so its result updates in place.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,489 passed, 1 skipped by sandbox guard. |
| `npm run build` | Pass | Rebuilt `dist/orchestrator/run-task.js`; `dist/cli/index.js` had no generated diff. |
| `npm run sync-templates:check` | Pass | |
| `npm run docs-refs-check` | Pass | |

## Ready for Review

- [ ] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration, or a comma-separated list when files are tightly coupled — see the baseline Changes note above for the grouping guidance and token format. No wildcards, no unfilled `<placeholder>` text, and no prose-embedded paths. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

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

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `tests/run-task-safety.test.ts` | Added worktree-mode main-loop integration coverage for retry success, clean handoff with pipeline-owned dirt, and retry commit failure. |

### Findings addressed

- _test-integrity:_ the prior tests did not exercise main-loop wiring or pre-flight outcomes → added `main()`-driven worktree fixtures covering AC-1, AC-2, and AC-3.
- _red-first:_ temporarily bypassed the retry call and ran the AC-1 integration test before restoring it. Command: `node --import ./tests/md-loader-register.mjs --import tsx --test --test-name-pattern='main retries before code_review preflight in a task worktree' tests/run-task-safety.test.ts`. Observed `handoff→diff: initial-fixture.txt listed in handoff but not in diff` and `preflight_rejections_current_loop` became `1`; after restoring the call, the test passes with the file committed and the counter at `0`.

### AC deltas

- AC-1: Partial → Met. The worktree main-loop test asserts the path appears in `main..HEAD`, the pre-flight counter stays `0`, and `review.md` has no `handoff→diff` block. The red run reproduced the expected pre-flight rejection without the retry.
- AC-2: Partial → Met. A clean handoff with dirty task-review and telemetry artifacts enters code_review, emits no retry line, invokes the review agent, and leaves HEAD unchanged.
- AC-3: Partial → Met. A failing pre-commit hook makes the main loop exit 1 with `Auto-commit failed:`, without invoking review agents or changing review counters/artifact.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,492 passed, 1 skipped by sandbox guard. |
| `npm run build` | Pass | |
| `npm run sync-templates:check` | Pass | |
| `npm run docs-refs-check` | Pass | |
