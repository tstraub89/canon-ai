# Implementation Handoff: reroute-preflight-spec-amendment-check

> Author: Codex | Spec: `tasks/reroute-preflight-spec-amendment-check/spec.md` | Plan: `tasks/reroute-preflight-spec-amendment-check/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.

| File | What Changed |
|---|---|
| `scripts/run-task/validation.ts` | Added exported `verifyRerouteAmendment(taskId, requiredRound, cwd)` with round-aware amendment checks, missing-file fallback, and round-specific reason strings. |
| `scripts/run-task/main.ts` | Wired `rerouteFromHumanReview` to preflight each task against `verifyRerouteAmendment` before any `status.json` mutation, aborting on failure unless `--force` is set; also exported a narrow test hook for the reroute integration tests. |
| `scripts/run-task/cli.ts` | Updated `--reroute` help text to describe the asymmetric `## Amendment` / `## Amendment Round N` requirement and the `--force` bypass. |
| `scripts/run-task/prompts/index.ts` | Threaded the reroute round number into the reroute prompt rendering context. |
| `scripts/run-task/prompts/templates/implement-reroute.md` | Narrowed the reroute instructions so Codex looks for the matching amendment heading for the current round and ignores prior-round sections. |
| `docs/pipeline-orchestrator.md` | Documented the reroute amendment preflight, round-specific heading contract, force bypass, and legacy-heading rejection. |
| `tests/run-task-validation.test.ts` | Added unit coverage for round 1 and round 2 amendment detection, legacy-heading rejection, and missing-file handling. |
| `tests/run-task-reroute-preflight.test.ts` | Added subprocess integration coverage for worktree-mode abort, `--force` bypass, bundle failure aggregation, and the round-2 boundary. |
| `tests/run-task-safety.test.ts` | Updated the existing reroute/full_send safety fixture to use a worktree-backed spec so it exercises the real reroute path after the new preflight. |
| `tests/run-task-prompts.golden.json` | Refreshed the reroute prompt snapshot to match the round-aware instructions. |
| `dist/scripts/run-task.js` | Regenerated build output for the scripts/run-task source changes. |

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

The implementation adds a preflight gate to `--reroute` so the operator has to amend `spec.md` before Codex reruns implement. The helper is round-aware: round 1 accepts the loose `## Amendment` form, while round 2+ requires the strict `## Amendment Round N` form matching the next reroute count. The main reroute path resolves the task’s active cwd, checks each task before mutating status, and either aborts with a per-task error or proceeds with a warning when `--force` is intentionally used.

The prompt template and help text were updated in lockstep so the operator-facing and agent-facing instructions match the gate. The integration tests exercise the actual reroute path in worktree mode, which is the path that was regressed in the reported failure mode.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Exported `rerouteFromHumanReview` and added `setCliArgsForTest` in `scripts/run-task/main.ts` so the reroute preflight integration tests can call the real implementation directly in a subprocess. | The plan suggested a CLI-spawn harness or a mirrored build artifact; the direct-source subprocess was simpler, exercised the real code path, and avoided maintaining a temp mirror. The exports are narrow and not user-facing. | None |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: `verifyRerouteAmendment` helper with round-aware acceptance, missing-file fallback, and reason strings | Met | Implemented in `scripts/run-task/validation.ts`; covered by the new unit tests in `tests/run-task-validation.test.ts`. |
| AC-2: `rerouteFromHumanReview` preflights before mutation and aborts with the required multi-line message | Met | The preflight loop runs after human_review validation and before any `writeStatus`; the abort message names task, path, round, expected heading, reason, bypass, and docs pointer. |
| AC-3: `--force` bypass emits one warning per failing task and proceeds | Met | Verified in `tests/run-task-reroute-preflight.test.ts` with the worktree-backed force-bypass fixture. |
| AC-4: helper reads `tasks/<id>/spec.md` from `cwd` and returns a missing-file reason instead of throwing | Met | Uses `path.join(cwd, 'tasks', taskId, 'spec.md')` and returns `spec.md missing at ...` on read failure. |
| AC-5: validation tests cover the round-1, round-2, legacy, and missing-file cases | Met | `tests/run-task-validation.test.ts` now contains nine reroute-amendment cases covering the entire matrix. |
| AC-6: `--reroute` help text mentions the asymmetric requirement and `--force` bypass | Met | Updated in `scripts/run-task/cli.ts`. |
| AC-7: no-force abort integration test | Met | New worktree-mode subprocess test asserts the abort and unchanged status. |
| AC-8: force-bypass integration test | Met | New worktree-mode subprocess test asserts success, warning output, and reroute metadata. |
| AC-9: bundle multi-failure integration test | Met | New subprocess test checks that all failing tasks are named and no status mutates. |
| AC-10: round-2 boundary test | Met | New subprocess test proves `## Amendment` no longer suffices on round 2 and that `## Amendment Round 2` succeeds. |
| AC-11: reroute prompt template directs Codex to the matching amendment section | Met | `scripts/run-task/prompts/templates/implement-reroute.md` now receives the round number and tells Codex which heading to use. |
| AC-12: docs/pipeline-orchestrator.md documents the reroute amendment contract | Met | Added the preflight and legacy-heading guidance to the reroute section. |

## Edge Cases Considered

- Worktree-backed reroutes resolve `spec.md` through `resolveTaskCwd(taskId)` rather than the supervising checkout root.
- Mixed bundles respect each task’s own `reroute_count`, so round 1 and round 2+ failures are reported independently.
- Round 1 accepts the strict `## Amendment Round 1` form as well as the loose `## Amendment` form.
- Round 2+ rejects the loose heading and the legacy variants (`Follow-up`, `Post-review`).
- The helper is fail-closed on missing `spec.md`.

## Blockers

- `origin/release/v1.4` advanced by one unrelated commit (`22a3a07`, docs/BACKLOG). I fetched the update, but I did not rebase because the worktree is intentionally dirty with uncommitted task artifacts and source changes; validation was rerun on the final tree as-is.

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
| `lint` (`npm run lint`) | Pass | Re-run after the final fixture edit. |
| `type-check` (`npm run type-check`) | Pass | Re-run after the final fixture edit. |
| `unit tests` (`npm test`) | Pass | Full suite passed, including the new reroute preflight tests. |
| `docs-refs-check` (`npm run docs-refs-check`) | Pass | Passed after the docs/orchestrator update. |
| `build` (`npm run build`) | Pass | Regenerated `dist/scripts/run-task.js`. |
| `E2E` | deferred_by_spec | Spec marks E2E as N/A; no UI surface is involved. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>`

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

| File | What Changed |
|---|---|

> **Reverting a file?** Perfect revert (no longer in `git diff base...HEAD`): delete it from all prior Changes tables and omit it here. Imperfect revert (still in diff, e.g., trailing newline): add it here as "Reverted to original (describe residual diff)".

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
