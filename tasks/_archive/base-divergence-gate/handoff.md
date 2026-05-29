# Implementation Handoff: base-divergence-gate

> Author: Codex | Spec: `tasks/base-divergence-gate/spec.md` | Plan: `tasks/base-divergence-gate/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.

| File | What Changed |
|---|---|
| `scripts/run-task/git.ts` | Added `getUnpushedBaseCommits(baseBranch, cwd)` using `gitSafeAtRaw` to parse `origin/<base>..<base>` log output into `{ sha, subject }` commits. |
| `scripts/run-task/validation.ts` | Added `verifyBaseDivergenceFromData` and `verifyBaseDivergence` with fetch-before-check semantics, fail-open fetch handling, and explicit git-error results. |
| `scripts/run-task/types.ts` | Added `CliArgs.allowDivergentBase`. |
| `scripts/run-task/cli.ts` | Parsed `--allow-divergent-base`, defaulted it to false, returned it from `parseArgs`, and documented its relationship to `--force`. |
| `scripts/run-task/main.ts` | Wired the base-divergence gate into `--push`/`--pr` before base-drift and into `--ship` before merge; added prNum-specific merge-confirmation tolerance and the pure `classifyMergeOutcome` seam. |
| `scripts/run-task/phases/implement.ts` | Added the first-implement scaffold push reminder inside the existing `!worktreeAlreadyCreated` guard. |
| `tests/run-task-validation.test.ts` | Added data-seam and real-git fixture coverage for base-divergence detection, including root-vs-worktree parity. |
| `tests/run-task-safety.test.ts` | Added subprocess coverage for `--push` block/bypass, reminder-once behavior, and `classifyMergeOutcome` decision matrix coverage. |
| `tests/run-task-cli.test.ts` | Updated parser shape tests for the new `CliArgs` field and added explicit `--allow-divergent-base` parser coverage. |
| `docs/codebase-map.md` | Updated the orchestration map row to cover base-drift plus base-divergence gates and their entry points. |
| `docs/pipeline-orchestrator.md` | Documented `--allow-divergent-base`, gate ordering, independent bypass semantics, and the new ship ahead-divergence block. |
| `templates/docs/pipeline-orchestrator.md` | Synchronized the derived template copy for the root-authoritative pipeline-orchestrator doc. |
| `dist/scripts/run-task.js` | Regenerated the bundled CLI after `scripts/run-task/**` source changes. |

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

The implementation adds a commit-level base-divergence gate ahead of the existing tree-drift allow-list gate. The new gate catches the specific local-base-ahead condition before it is misreported as file drift, keeps `verifyBaseDrift` unchanged as the backstop, and uses the new `--allow-divergent-base` flag as a narrow bypass only for the commit-divergence check.

The ship path now checks ahead-divergence before attempting the irreversible PR merge. The merge cleanup tolerance was also changed from stderr substring matching to a prNum-specific merge-state check so cleanup failures after a successful merge are tolerated, while real merge failures still fail closed.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Updated `tests/run-task-cli.test.ts`, which was not in the spec's Affected Files table. | Adding `CliArgs.allowDivergentBase` changes the returned parser object shape; the full `npm test` suite failed until the existing parser assertions were updated. | Supports AC-4 and keeps required unit validation green. |
| `verifyBaseDivergence` treats a non-existent `cwd` as `ok: false` instead of generic fetch fail-open. | AC-8 explicitly requires the non-existent-cwd git-failure path to return `ok: false` with non-empty `stderr`; normal fetch/network failures for an existing cwd still warn and fail open per AC-3. | Meets AC-3's network-blip behavior and AC-8's invalid-cwd integration test. |
| Regenerated `dist/scripts/run-task.js` and ran `npm run build` even though the spec marked Build N/A. | `docs/architecture.md` requires the build artifact to be updated for `scripts/run-task/**` changes. | No AC behavior change; keeps distributable CLI aligned with source. |
| Updated `templates/docs/pipeline-orchestrator.md`, which was not in the spec's Affected Files table. | `npm run sync-templates:check` failed after the root doc edit; project policy makes `templates/` derived from root-authoritative managed docs. | Keeps sync validation green; see Blockers for the spec-scope gap. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `getUnpushedBaseCommits` exists in `scripts/run-task/git.ts`, calls `gitSafeAtRaw(cwd, 'log', origin/base range, '--format=%H%x09%s')`, parses tab-separated lines, and returns the requested ok/stderr shape. |
| AC-2 | Met | `verifyBaseDivergenceFromData` exists in `scripts/run-task/validation.ts`, returns empty for no commits, and formats the colliding-commits message with short SHAs, `git push origin`, and `--allow-divergent-base`. |
| AC-3 | Met | `verifyBaseDivergence` fetches `origin <base>`, fail-opens existing-cwd fetch failures with `fetchFailed: true`, wraps helper failures with `fetchFailed: false`, and returns the four-field interface on every path. |
| AC-4 | Met | `CliArgs.allowDivergentBase` is typed, parsed, defaulted, returned, documented, and unit-tested. |
| AC-5 | Met | `commitHumanReviewFiles` runs `verifyBaseDivergence` before the unchanged `verifyBaseDrift` call; hard-block, fetch-fail-open, and bypass warning branches are wired. |
| AC-6 | Met | `shipTasks` runs the same base-divergence semantics after `ensureCheckedOutBaseBranch` and before `mergeOpenPRsAndPull`; `assertLocalBaseInSyncWithOrigin` remains in its downstream cleanup-only path. |
| AC-7 | Met | `tests/run-task-validation.test.ts` covers empty data, exact one-commit format, multi-commit order/separate lines, and the required operator-command substrings. |
| AC-8 | Met | Real-git tests cover clean repo success, non-existent cwd failure, and matching `commits[]` from repo root and linked worktree cwd. |
| AC-9 | Met | `tests/run-task-safety.test.ts` runs the `main --push` subprocess path with a local-base-ahead fixture for both block and `--allow-divergent-base` bypass branches. |
| AC-10 | Met | The full `npm test` suite passes, including the existing base-drift tests; the new bypass path continues into the old base-drift gate. |
| AC-11 | Met | `docs/codebase-map.md` now names base-drift plus base-divergence gates, lists `--push`/`--pr`/`--ship`, and references the new and existing helpers. |
| AC-12 | Met | `docs/pipeline-orchestrator.md` documents the new flag, applicable phases, bypass boundaries, `--force` independence, and ship ahead-divergence ordering. |
| AC-13 | Met | `runImplementPhase` emits one `git push origin <base>` reminder inside `!worktreeAlreadyCreated`; the safety test asserts it appears once on first implement and not on reroute/iteration. |
| AC-14 | Met | `mergeOpenPRsAndPull` uses `isPRMerged(prNum)` for the attempted PR only, routes through `classifyMergeOutcome`, warns on confirmed merge/delete failures, and preserves `assertOriginTaskBranchAbsent` in the tolerated path. |
| AC-15 | Met | `tests/run-task-safety.test.ts` covers all three `classifyMergeOutcome` branches. |

## Edge Cases Considered

- Fetch/network failure on an existing cwd warns and fails open; a missing cwd remains a git-execution failure.
- Local base ahead is detected from both the supervising repo root and a linked worktree cwd.
- `--allow-divergent-base` bypasses only commit divergence; `--force` remains the separate file-drift bypass.
- `--ship` blocks ahead-divergence before merge, preventing the later pull conflict.
- Merge cleanup failures are tolerated only after the attempted PR number is confirmed merged.
- A tolerated merge/delete failure still runs the remote-branch absence safety check.
- The scaffold reminder is gated by `!worktreeAlreadyCreated`, so reroutes and review iterations stay quiet.

## Blockers

- [scope] The final diff includes three necessary files outside the spec's Affected Files table: `tests/run-task-cli.test.ts`, `dist/scripts/run-task.js`, and `templates/docs/pipeline-orchestrator.md`. They are required for parser-shape validation, fresh published CLI output, and root/template sync respectively. The spec should be amended or the operator should explicitly accept the scope expansion before later remote-boundary gates; otherwise the base-drift allow-list can treat these paths as out-of-scope.

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
| **Linting** — `npm run lint` | Pass | Final run passed. |
| **Type checking** — `npm run type-check` | Pass | Final run passed. |
| **Unit tests** — `npm test` | Pass | Final run passed: 613 tests, 612 pass, 1 skipped. |
| **Build** — `npm run build` | Pass | Final run passed and regenerated `dist/scripts/run-task.js`. |
| **E2E** — N/A | deferred_by_spec | Spec: Validation Required — E2E N/A. Canon has no UI surface. |
| **Docs references** — `npm run docs-refs-check` | Pass | Final run passed: All refs OK. |
| `npm run sync-templates:check` | Pass | Added after `docs/pipeline-orchestrator.md` changed because the project requires root/template sync for canon-managed docs. |
| `git diff --check` | Pass | Final whitespace check passed. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>` — not verified by Codex; local refs do not include `origin/release/v1.6.1`, and the orchestrator owns git writes such as fetch/pull/push for this phase.

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
