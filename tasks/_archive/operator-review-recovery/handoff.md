# Implementation Handoff: operator-review-recovery

> Author: Codex | Spec: `tasks/operator-review-recovery/spec.md` | Plan: `tasks/operator-review-recovery/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `scripts/run-task/main.ts` | Relaxed `--reroute` precondition for whole-bundle `code_review` `spec_gap` blocks, reset stale review sanctions on reroute/reopen, and rewrote the spec-gap recovery block to present audited fix/bless paths. |
| `src/task/index.ts` | Added review-phase `canon task accept` support with mandatory `--reason`, accept-only `sanctioned` verdict handling, audit fields/notes writes, bundle preservation of already-advancing verdicts, and stale-sanction clearing on manual reopen. |
| `scripts/run-task/types.ts` | Added `sanctioned` to the canonical verdict value list. |
| `src/cli/index.ts` | Updated `canon task` help for the `sanctioned` verdict and review-phase accept syntax. |
| `AGENTS.md` | Documented spec-gap fix/bless recovery, review-phase accept commands, and `sanctioned` audit semantics. |
| `CLAUDE.md` | Updated quick refs and review guidance for `--reroute` from `spec_gap`, review accept, and the amendment/reroute-count invariant. |
| `docs/pipeline-orchestrator.md` | Documented the expanded reroute precondition, review-phase accept behavior, `sanctioned` routing, and spec-gap recovery taxonomy. |
| `docs/BACKLOG.md` | Marked the manual `spec_gap` recovery asymmetry entry resolved by this task. |
| `.canon/templates/status.json` | Added `sanctioned` to the scaffolded verdict help string. |
| `templates/AGENTS.md` | Synced canon-managed mirror of `AGENTS.md`. |
| `templates/CLAUDE.md` | Synced canon-managed mirror of `CLAUDE.md`. |
| `templates/docs/pipeline-orchestrator.md` | Synced canon-managed mirror of `docs/pipeline-orchestrator.md`. |
| `templates/.canon/templates/status.json` | Synced canon-managed mirror of `.canon/templates/status.json`. |
| `dist/scripts/run-task.js` | Rebuilt bundled orchestrator artifact. |
| `dist/cli/index.js` | Rebuilt bundled CLI artifact. |
| `tests/run-task-reroute-preflight.test.ts` | Added coverage for `--reroute` from spec-gap blocks, clean resets, mixed-bundle acceptance/rejection, and the replacement spec-gap recovery message. |
| `tests/run-task-validation.test.ts` | Added verdict-surface drift guards and routing tests proving `sanctioned` advances like approval without artifact parsing. |
| `tests/task-cli.test.ts` | Added review-phase accept tests for mandatory reasons, audit trail, accept-only verdict rejection, invariant preservation, stale-sanction clearing, and mixed-bundle bless behavior. |

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

Implemented the two sanctioned recovery paths on the existing surfaces rather than adding new commands. The fix path reuses `rerouteFromHumanReview` with a bundle-aware entry predicate: either all tasks are at `human_review`, or all are blocked at `code_review` and at least one carries `spec_gap`. The existing reset loop now also clears review operator-acceptance fields, so rerouted review state is clean.

The bless path extends `canon task accept` with a separate review-phase branch. It deliberately skips implement-only dirty-tree/diff/handoff guards, requires a written reason, writes `sanctioned` only for non-advancing verdicts, preserves genuine approvals in mixed blocked bundles, and logs the operator reason in `notes.md`. `sanctioned` is accepted as a status value but cannot be minted through `canon task phase`.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Preserved the original `--reason` string in review-accept notes while using `trim()` only to reject empty reasons. | The plan trimmed before writing; AC-7/known risk requires the operator's reason text to reach `notes.md` verbatim. | Strengthens AC-7 without changing command behavior. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `rerouteFromHumanReview` accepts all-human-review or all-code-review-blocked with some `spec_gap`; tests cover allowed/rejected single and mixed states. |
| AC-2 | Met | Spec-gap reroute uses the same reset loop, increments `reroute_count`, marks `implement.rerouted`, resets downstream phases, and clears full-tier `codex_spec_review`. |
| AC-3 | Met | Existing amendment-round gate is exercised by round-1 and round-2 tests, including rejection of stale bare `## Amendment` for round 2. |
| AC-4 | Met | Printed and persisted spec-gap recovery text now names `canon run <ids> --reroute` and `canon task accept <ids> code_review --reason`, with full bundle IDs and no `code_review pending` recommendation. |
| AC-5 | Met | `taskAccept` supports `implement`, `spec_review`, and `code_review`; review phases require non-empty `--reason` and accept multi-ID bundles. |
| AC-6 | Met | Review accept writes review phases directly to `done`, sanctions non-advancing verdicts, derives the next top-level phase, and bypasses phase artifact verdict matching. |
| AC-7 | Met | Review accept writes `operator_accepted*` fields for sanctioned members, appends `notes.md` audit lines with phase and reason, and preserves existing escalations. |
| AC-8 | Met | `sanctioned` is in value surfaces and templates; `canon task phase ... sanctioned` is rejected with an accept command redirect; artifact verdict parser remains unchanged. |
| AC-9 | Met | `checkAndRoute` treats `sanctioned` as an advancing review verdict and does not trip the `spec_gap` block. |
| AC-10 | Met | Review accept does not edit `spec.md` or `implement.reroute_count`; tested with before/after snapshots. |
| AC-11 | Met | Manual phase reopen and reroute resets clear stale `operator_accepted*` fields and review verdicts. |
| AC-12 | Met | Root docs, synced templates, status template, and BACKLOG were updated; template sync and docs refs pass. |
| AC-13 | Met | Spec-gap reroute leaves `code_review` as `pending` with empty verdict and zeroed loop/preflight counters. |
| AC-14 | Met | Spec-gap handler still blocks the full bundle; reroute resets every member including approved siblings; off-phase sibling bundles reject without mutation. |
| AC-15 | Met | Review accept is bundle-aware: non-advancing verdicts become `sanctioned`, approved siblings keep `approved`, partial accept leaves unnamed siblings blocked. |

## Edge Cases Considered

- `code_review` blocked with `spec_gap` plus approved sibling: fix path resets both; bless path sanctions only the gap task and preserves the approved sibling verdict.
- `code_review` blocked without any `spec_gap`: `--reroute` rejects.
- `code_review` blocked with a sibling in `implement`: `--reroute` rejects and leaves both status files untouched.
- Review accept with missing/blank reason: rejects before writing status.
- Review accept with an already-advancing verdict in a blocked bundle: unblocks without `operator_accepted*` relabel.
- Manual `canon task phase ... sanctioned`: rejected so `sanctioned` remains accept-only.
- Stale review sanction reopened by `canon task phase ... pending` or reroute: audit fields and verdict are cleared.
- `--reason` containing spaces is parsed and written to `notes.md`.

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
| `npm run lint` | Pass | Ran in final validation chain. |
| `npm run type-check` | Pass | Ran in final validation chain. |
| `npm test` | Pass | Full suite: 811 passed, 1 skipped, 0 failed. |
| `npm run build` | Pass | Rebuilt `dist/cli/index.js` and `dist/scripts/run-task.js`. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [x] Branch is current with `origin/<base>` (`git fetch origin`; `origin/release/v1.11` is an ancestor of HEAD)

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
