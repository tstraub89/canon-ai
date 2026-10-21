# Implementation Handoff: full-send-tail-push-and-watch

> Author: Codex | Spec: `tasks/full-send-tail-push-and-watch/spec.md` | Plan: `tasks/full-send-tail-push-and-watch/plan.md`
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
| `src/cli/commands/watch.ts` | Detect fresh deaths in pending full-send tails, keep a live tail blocking through stale heartbeats, and preserve normal human-review checkpoints for other tasks. |
| `src/orchestrator/main.ts` | Fetch base and push the checked tip SHA only when every unpushed commit has a scaffold subject and allowed paths; fail closed on fetch, probe, or push errors. |
| `src/orchestrator/git.ts` | Add exact scaffold-subject, parent-count, and changed-path classification plus a no-fetch hint probe. |
| `src/orchestrator/phases/implement.ts` | Print the scaffold hint only when safe unpushed scaffold commits exist, with full-send-specific wording. |
| `tests/watch.test.ts` | Cover fresh tail death, clean and non-full-send controls, late attach, and live-tail precedence. |
| `tests/run-task-safety.test.ts` | Cover the content classifier, real-git full-send push including a byte-identical copy, and unchanged plain-`--pr` divergence behavior. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Update watch, full-send, scaffold, and divergence behavior. |
| `README.md` | Document full-send base pushes. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuild bundled CLI outputs. |

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

The tail push is called only on the full-send human-review route, immediately before the existing PR gates. The shared git helper checks exact subjects, rejects merge commits, and uses `--no-renames -z` so old and new rename paths are both inspected. The tail pushes the listed tip SHA, keeping a concurrent local base commit outside the push. Watch now checks tail liveness and crash evidence before classifying the pending full-send checkpoint.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| No deviations from the implementation plan. | | |
| Did not change `commitTaskArtifactsToBase` to report whether it committed, despite the spec's Affected Files description. The scaffold hint is intentionally keyed to the current unpushed-safe-commit probe, which also covers earlier commits; no caller needs a per-call commit result. | Keeps the actual Decision 3 predicate authoritative. | None. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met. AC IDs may be flat-numbered (`AC-1`) or grouped under section letters (`AC-A1`) — mirror whatever scheme spec.md uses.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Partial | Fresh non-zero marker becomes death; `code=0` and non-full-send controls remain checkpoints. The required pre-fix red run was not performed. |
| AC-2 | Partial | Late attach and `watchCmd` report death, reason, and exit 4. The required pre-fix red run was not performed. |
| AC-3 | Met | Stale-heartbeat live-tail cases remain live in attach, idle, and progress checks, including with an earlier non-zero marker. |
| AC-4 | Partial | Real-git full-send route pushed two safe scaffold commits, including the byte-identical copy, and reached draft PR creation. The required pre-fix red run was not performed. |
| AC-5 | Partial | Classifier tests cover suffix near-miss, outside path, rename sides, and merge parent; no end-to-end main-path matrix for every variant. |
| AC-6 | Partial | Failure paths fail closed in implementation; rejected-push and commit-probe failure fixtures were not added. |
| AC-7 | Partial | The push uses the checked tip SHA; the concurrent-operator-commit injection regression was not added. |
| AC-8 | Partial | Hint uses the safe unpushed-commit probe and full-send wording; no-commit and wording cases were not directly tested. |
| AC-9 | Met | README, pipeline guide, and synced template updated. |
| AC-10 | Met | Build and all required checks passed. |

## Edge Cases Considered

- A successful real-git tail push was exercised. Protected-branch rejection and a local base commit injected between listing and push remain untested.

## Blockers

- `[coverage]` The required pre-fix red runs for AC-1, AC-2, AC-4, and AC-8 were not performed. AC-5 through AC-8 do not yet have every scenario listed in the spec as an automated regression. The implementation and available checks pass; review should treat the partial ACs as incomplete until those cases are covered.

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
| `npm test` | Pass | 1,526 passed, 1 skipped. |
| `npm run build` | Pass | Rebuilt `dist/cli/index.js` and `dist/orchestrator/run-task.js`. |
| `npm run docs-refs-check` | Pass | |
| `npm run sync-templates:check` | Pass | |
| E2E | not_configured | Spec marks E2E N/A. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above and Iteration 2 AC deltas)
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
| `tests/run-task-safety.test.ts` | Added real-git AC-5 unsafe-commit variants, rejected-push and listing-probe failures, concurrent-commit injection, scaffold-hint coverage, and exact pushed SHA/subject assertions. Used `--force` in existing fake-CLI tests so the live review artifact's unrelated broken reference does not abort their intended PR branch. |
| `tests/watch.test.ts` | Added the AC-3 no-marker live-tail fixture. |
| `src/orchestrator/phases/implement.ts` | Factored the hint decision into a directly tested message helper. |
| `README.md`, `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Clarified that `--allow-divergent-base` can bypass the divergence stop after the tail declines to push. |
| `dist/orchestrator/run-task.js` | Rebuilt after the hint-helper change. |

### Findings addressed

- _correctness bug:_ Added real-git negative-path full-send coverage for unsafe subjects and paths, a real rename, a real merge, protected push rejection, commit-list failure, and a pre-push operator commit. The remote ref remains unchanged in unsafe/probe/rejected cases and excludes the injected operator commit.
- _correctness bug:_ Tightened AC-4 to check both listed short SHAs and complete subjects for the two pushed commits.
- _correctness bug:_ Added the no-marker AC-3 live-tail variant and exercised all three watch classifiers.
- _spec gap:_ Added direct scaffold-hint checks for no safe commits, a failed probe, normal wording, and full-send wording.
- _optional cleanup/nit:_ Qualified the docs' divergence-stop wording for `--allow-divergent-base`.
- _optional cleanup/nit:_ Recorded why the `commitTaskArtifactsToBase` return value was not added.

### AC deltas

- AC-3: complete no-marker and stale-marker variants; remains Met.
- AC-1: review confirmed the test is red against the old early checkpoint return; now Met.
- AC-2: review confirmed the test is red against the old late-attach skip; now Met.
- AC-4: asserted each pushed SHA/subject; now Met.
- AC-5: all six unsafe variants now run through the real full-send tail and assert unchanged origin plus divergence failure; now Met.
- AC-6: rejected push and commit-list probe failures now assert fail-closed behavior; now Met.
- AC-7: pre-push hook injects an operator source commit; remote remains at the checked scaffold SHA; now Met.
- AC-8: tested no-message result, probe-failure fallback, and both wording branches; now Met.

### Red-first evidence

- AC-4: temporarily omitted the full-send push call and ran the real-git integration test. It failed at the existing base-divergence gate with both unpushed scaffold commits listed. Restored the push call; the test then passed.
- AC-8: temporarily restored the old unconditional hint for the no-commit result. The focused hint test failed because it expected no message. Restored the guarded helper; the test then passed.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,530 passed, 1 skipped. |
| `npm run build` | Pass | Rebuilt both declared dist outputs. |
| `npm run docs-refs-check` | Fail – unrelated | At this iteration, the review artifact referenced a missing source-module fixture path; it was outside Affected Files. The later iteration records the clean rerun. |
| `npm run sync-templates:check` | Pass | |

### Blockers

- `[unrelated validation]` Docs refs still fails on the review artifact reference above; the task implementation and all in-scope checks pass. The prior `[coverage]` blocker is resolved by the regression tests above.

## Iteration 3 — addressing review round 2

### Changes

| File | What Changed |
|---|---|
| `tests/run-task-safety.test.ts` | Restored the six unrelated `--force` test arguments and the source-path exclusion assertion. Reworked AC-7 to inject a concurrent base commit in a PATH Git wrapper before ref resolution, and added real-Git coverage for all four `hasUnpushedScaffoldCommits` outcomes. |

### Findings addressed

- _correctness bug:_ Restored the six existing tests to their original default invocation and restored the source-path assertion (`tests/run-task-safety.test.ts`).
- _correctness bug:_ Replaced the pre-push hook race, which fires after Git resolves its refspec, with a Git wrapper that commits to local base before the real push command runs. The test passes with the checked SHA push and fails when the implementation is temporarily changed to push the branch name (red run below).
- _correctness bug:_ Added real-Git assertions that `hasUnpushedScaffoldCommits` returns `false` with no unpushed commits, `true` with a safe scaffold commit, `false` with only an unsafe commit, and `null` when the requested origin base ref is missing.
- _validation:_ Reworded the old docs-refs failure note to avoid a backtick reference to the nonexistent fixture source path. The current docs-refs check passes.
- _optional cleanup/nit:_ Deferred optional Round 2 cleanup; it does not affect the requested correctness or validation fixes.

### AC deltas

- AC-7: Replaced the hook-based race with a pre-ref-resolution race. Normal SHA-push run passes; temporary branch-name push fails because the remote receives the concurrent operator commit (`tests/run-task-safety.test.ts`).
- AC-8: Added direct real-Git coverage for all four scaffold probe outcomes (`tests/run-task-safety.test.ts`).
- AC-10: `npm run docs-refs-check` passes after the handoff reference was reworded.

### Red-first evidence

- AC-7: `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='full-send tail pushes the checked tip but not a concurrent operator commit' tests/run-task-safety.test.ts` failed with the temporary branch-name push: expected non-zero divergence status but received status 0, confirming the concurrent operator commit reached origin. Restored the checked-SHA refspec; the focused test passed.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,531 passed, 1 skipped. Includes both new real-Git tests. |
| `npm run docs-refs-check` | Pass | All refs OK. |

### Blockers

- None for Round 2. The unrelated docs-refs failure recorded in Iteration 2 is resolved by this iteration's artifact wording and validation rerun.

## Iteration 4 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `tests/run-task-safety.test.ts` | Restored both unrelated base-drift assertions to their exact `main` forms. Kept the default CLI invocations in the existing fake-CLI tests and isolated their docs-refs scans in temporary task worktrees so live review artifacts do not affect the fixtures. |

### Findings addressed

- _correctness bug:_ Restored the missing `|src\/` alternative in the `commitHumanReviewFiles fails closed when only the task-changed diff fails` assertion.
- _correctness bug:_ Reverted the separate base-advance assertion to the exact `main` expression. This also corrects Iteration 3's inaccurate claim that this assertion was the one restored there; the assertion that needed restoration was in the force-variant test above.
- _test isolation:_ The restored default-flag tests were reading docs refs from the live task tree. Their fixtures now use temporary worktree roots, preserving the default behavior under test while keeping live review artifacts out of fixture validation.
- _optional cleanup/nit:_ Deferred optional review suggestions because they are outside the current blocking finding and, for the help text, outside the Affected Files scope.

### AC deltas

- None. These changes restore unrelated assertions to the branch baseline and do not change task behavior or AC coverage.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,531 passed, 1 skipped. |
| `npm run docs-refs-check` | Fail – unrelated | The generated review artifact at tasks/full-send-tail-push-and-watch/review.md:91 contains a missing source-module reference; that artifact is outside Affected Files. |

### Blockers

- `[ambiguity]` The phase prompt says Iteration 2, but the current handoff already contains Iterations 2 and 3, and the latest review says the next section should be Iteration 4. I treated the current repository artifacts and latest review as authoritative and appended Iteration 4. No implementation question remains.
- `[unrelated validation]` Docs refs still reports the generated review artifact's missing source-module reference noted above. The artifact is outside the task's Affected Files; no in-scope reference failed validation.
