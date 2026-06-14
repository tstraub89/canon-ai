# Implementation Handoff: reroute-detaches-before-loop

> Author: Codex | Spec: `tasks/reroute-detaches-before-loop/spec.md` | Plan: `tasks/reroute-detaches-before-loop/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `scripts/run-task/cli.ts` | Added exported `isSynchronousMode()` predicate used by the detach gate. |
| `scripts/run-task/main.ts` | Replaced the inline synchronous-mode expression with `splitCli.isSynchronousMode(cliArgs)` and rewrote the detach rationale comment so bare reroute detaches while `--reroute --step` stays foreground. |
| `scripts/run-task/detach.ts` | Strips `--reroute` from the detached child argv after the parent has already run the reroute reset, preventing the re-exec child from re-running the reset guard. |
| `tests/detach.test.ts` | Added predicate coverage for synchronous-mode rows and a detach child argv test proving `--reroute` is removed while `CANON_DETACHED=1` is still set. |
| `CLAUDE.md` | Updated the reroute step-guards quick ref to document bare reroute auto-detach and single-command stepped reroutes. |
| `templates/CLAUDE.md` | Synced mirror of `CLAUDE.md`. |
| `docs/pipeline-orchestrator.md` | Removed `--reroute` from the synchronous foreground-mode list and collapsed two-command stepped reroute examples into single combined commands. |
| `templates/docs/pipeline-orchestrator.md` | Synced mirror of `docs/pipeline-orchestrator.md`. |
| `dist/scripts/run-task.js` | Rebuilt bundle from source via `npm run build`. |

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

Bare `--reroute` now reaches the same auto-detach gate as a normal long-running pipeline run because the detach gate calls the exported `isSynchronousMode()` predicate, which only treats `--pr`, `--push`, `--ship`, `--step`, and `--expect` as synchronous.

The parent still runs `rerouteFromHumanReview()` before the detach gate, so amendment validation and reset output remain inline. To keep the detached child from repeating that reset, `detachAndExit()` strips the standalone `--reroute` flag from the child argv after the parent has already applied the reset. The child still receives `CANON_DETACHED=1` for the existing no-re-detach behavior, but it re-enters `main()` without the reroute flag and proceeds into the phase loop from the reset phase.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Used the spec-allowed argv-strip mechanism in `detachAndExit()` instead of the plan's `CANON_DETACHED` guard in `main.ts`. | The full suite exposed that `CANON_DETACHED=1` is inherited by detached-pipeline subprocesses; an env-only guard incorrectly skipped parent reroute reset in nested `main()` calls. Stripping `--reroute` scopes the skip to the re-exec child created by `detachAndExit()`. | Meets AC-4 via child argv removal; `tests/detach.test.ts` asserts the child receives `CANON_DETACHED=1` and no `--reroute`. |
| Kept AC-4 coverage in `tests/detach.test.ts` rather than adding `tests/run-task-reroute-preflight.test.ts`. | The final mechanism is isolated to `detachAndExit()` argv construction, so the existing detach test seam is the most direct unit coverage and stays within the spec's original test file. | Meets AC-4 without widening test fixture scope. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: synchronous-mode decision does not treat `--reroute` as synchronous | Met | `isSynchronousMode()` checks `pr`, `push`, `ship`, `step`, and `expectPhase`; the detach gate calls it. |
| AC-2: synchronous-mode decision extracted into exported pure function | Met | `scripts/run-task/cli.ts` exports `isSynchronousMode(args)`, and `main()` calls `splitCli.isSynchronousMode(cliArgs)`. |
| AC-3: unit test asserts extracted predicate rows | Met | `tests/detach.test.ts` covers bare reroute, each synchronous flag, expect phase, reroute+step, and bare args. |
| AC-4: detached reroute child does not re-run reset | Met | `detachAndExit()` strips `--reroute` from the child argv while setting `CANON_DETACHED=1`; test asserts both. |
| AC-5: reroute reset and validation run in foreground parent before detach | Met | `main()` still calls `rerouteFromHumanReview()` before building `initialState` and before the detach gate. |
| AC-6: detach comment no longer lists reroute as one-shot | Met | `main.ts` one-shot list is `--pr / --push / --ship`; the comment separately states bare reroute detaches and reroute+step stays foreground. |
| AC-7: operator docs updated at three touchpoints | Met | Updated `docs/pipeline-orchestrator.md` monitoring and stepped reroute sections plus `CLAUDE.md` quick ref. |
| AC-8: templates mirrors synced | Met | `npm run sync-templates` updated mirrors; `npm run sync-templates:check` passes. |
| AC-9: dist rebuilt | Met | `npm run build` rebuilt `dist/scripts/run-task.js`. |
| AC-10: full validation suite passes | Met | All required commands passed; E2E is marked n/a by the spec. |

## Edge Cases Considered

- Inherited `CANON_DETACHED=1` in subprocesses: rejected the env-only guard because it skipped parent reroute reset outside the actual detached child path.
- `--reroute --step`: remains foreground because `step` is still in `isSynchronousMode()`.
- Invalid reroute: still fails before detach because `rerouteFromHumanReview()` remains before the detach gate.

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
| `npm run lint` (= `eslint scripts/ tests/ src/`) | Pass | Re-run after final source edits. |
| `npm run type-check` (= `tsc -p tsconfig.json --noEmit`) | Pass | Re-run after final code edits. |
| `npm test` (= `node --test --import tsx tests/*.test.ts`) | Pass | Full suite: 865 pass, 1 skipped, 0 fail. |
| `npm run build` (= `tsup` + postbuild) | Pass | Rebuilt `dist/scripts/run-task.js`; postbuild path normalizer ran. |
| `npm run sync-templates:check` | Pass | Reported all canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | Reported all refs OK. |
| E2E — n/a (no E2E surface for the orchestrator) | deferred_by_spec | Spec Validation Required marks E2E as n/a. |

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
