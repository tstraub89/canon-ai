# Spec: preflight-exempt-telemetry — Code-review pre-flight exempts pipeline telemetry files from diff coverage check

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

`verifyHandoffAgainstDiffFromData` in [scripts/run-task/validation.ts:917](scripts/run-task/validation.ts:917) iterates every file in `git diff <baseRef>...HEAD --name-only` and requires every path to appear in some bundle member's handoff Changes table. Files under `tasks/<id>/**` are exempted (pipeline-owned task artifacts via `isPipelineOwnedTaskArtifact`), but `PIPELINE_TELEMETRY_FILES` are NOT exempted.

This is correct on the first implement cycle (no prior QA commits exist on the task branch). It fails post-reroute, because `--reroute` resets `phases.implement.status` to pending but leaves the prior cycle's QA commits on the branch. The next implement+code_review run sees QA's earlier commits to `docs/lessons-learned.md`, `docs/pipeline-invocations.md`, `docs/task-quality-log.md` in `baseRef...HEAD`, demands handoff coverage for them, and rejects Codex's handoff — even though Codex did not write those files on this implement run.

Observed in production on gallery_wall PR #107 (2026-05-26, task `a-gallery-wall-task`). After `--reroute` with a spec amendment, the next code_review pre-flight failed with:

```
diff→handoff: docs/lessons-learned.md in diff but not in any bundle handoff
diff→handoff: docs/patterns.md in diff but not in any bundle handoff
diff→handoff: docs/pipeline-invocations.md in diff but not in any bundle handoff
diff→handoff: docs/task-quality-log.md in diff but not in any bundle handoff
```

Codex's round-2 fix added 4 telemetry-doc rows to its Changes table to satisfy the check. The descriptions in those rows describe QA's prior-cycle work, not Codex's current-cycle work — the handoff became a fossil misattributing QA's commits to Codex.

(`docs/patterns.md` is in `PIPELINE_MANAGED_DOCS`, not `PIPELINE_TELEMETRY_FILES`. This task addresses only telemetry — see *Non-Goals*.)

## Decision

Add `PIPELINE_TELEMETRY_FILES` to the diff→handoff exemption set in `verifyHandoffAgainstDiffFromData`. Telemetry files are never authored by Codex — they are appended by Claude QA (`done.md` writing phase) and by the orchestrator itself (`pipeline-invocations.md` logging). Their presence in the cumulative branch diff carries no signal about implement-phase correctness.

The existing `HANDOFF_DIFF_EXEMPT_PATHS` constant at [scripts/run-task/validation.ts:888](scripts/run-task/validation.ts:888) is already consulted in both the diff→handoff loop ([validation.ts:948-953](scripts/run-task/validation.ts:948)) and the rename loop ([validation.ts:955-963](scripts/run-task/validation.ts:955)) but is currently initialized to an empty `Set`. Extending it to include `PIPELINE_TELEMETRY_FILES` is the entire functional change — no new control flow.

This is a one-way filter: telemetry files in the **diff** no longer require handoff coverage. The reverse direction (telemetry file listed in handoff but missing from diff) is already handled correctly — if Codex spuriously claims to have edited a telemetry file, the existing handoff→diff check catches it.

`PIPELINE_TELEMETRY_FILES` is already imported from `./worktree.js` on line 5 of validation.ts — no new import needed.

## Non-Goals

- **Not exempting `PIPELINE_MANAGED_DOCS`** (`docs/patterns.md`, `docs/architecture.md`, etc.). Those CAN legitimately be edited by Codex when the spec calls for it, in which case they belong in the handoff. Trading off: a managed-docs edit by QA before reroute will still cause the same diff→handoff failure on the next implement cycle. Living with that until it shows up; this task addresses only the telemetry case.
- **Not adding an "implement baseline SHA" mechanism** (option 1 from the bug report). A deeper fix that would generalize to all post-reroute scope-creep issues; out of scope for this S task.
- **Not changing `rerouteFromHumanReview`** in [scripts/run-task/main.ts:1750](scripts/run-task/main.ts:1750). The fix is in the validation function, not in how reroute records state.
- **Not changing the handoff→diff direction.** Spurious handoff entries for telemetry files remain a fail.

## Acceptance Criteria

- [ ] AC-1: `HANDOFF_DIFF_EXEMPT_PATHS` in [scripts/run-task/validation.ts:888](scripts/run-task/validation.ts:888) is changed from `new Set([])` to a `ReadonlySet<string>` containing every entry of `PIPELINE_TELEMETRY_FILES`. The initializer must reference the imported `PIPELINE_TELEMETRY_FILES` symbol by name (do not duplicate the string list).
- [ ] AC-2: The diff→handoff loop at [validation.ts:948-953](scripts/run-task/validation.ts:948) and rename loop at [validation.ts:955-963](scripts/run-task/validation.ts:955) are left structurally unchanged — they already consult `HANDOFF_DIFF_EXEMPT_PATHS`.
- [ ] AC-3: The comment block above `HANDOFF_DIFF_EXEMPT_PATHS` is updated to explain *why* telemetry files are exempt (written by QA / orchestrator, not Codex; their presence in cumulative branch diff is noise on post-reroute runs). Reference PR #107 as the discovery vector.
- [ ] AC-4: A new test in `tests/run-task-validation.test.ts` named exactly `'verifyHandoffAgainstDiffFromData exempts PIPELINE_TELEMETRY_FILES from diff→handoff check'` replays the PR #107 scenario. `diffFiles` contains `'src/foo.ts'`, `'docs/lessons-learned.md'`, `'docs/pipeline-invocations.md'`, `'docs/task-quality-log.md'`; `handoffFilesByTask` (built via the existing `makeHandoffMap` helper) covers only `'src/foo.ts'`. Asserts `issues` is empty (`assert.deepEqual(issues, [])`).
- [ ] AC-5: A second test named exactly `'verifyHandoffAgainstDiffFromData still rejects non-telemetry diff files missing from handoff when telemetry is also present'` confirms the existing rejection still works alongside the exemption: `diffFiles` contains `'docs/lessons-learned.md'` AND `'src/baz.ts'`; `handoffFilesByTask` covers neither. Asserts exactly one issue, containing the substring `'src/baz.ts'` and NOT containing `'lessons-learned'`.
- [ ] AC-6: `npm run build` regenerates `dist/cli/index.js` and `dist/scripts/run-task.js`; both contain the `PIPELINE_TELEMETRY_FILES` reference inside `HANDOFF_DIFF_EXEMPT_PATHS`. The regenerated `dist/` files are committed alongside source (project's "Full build" rule from `docs/architecture.md`).
- [ ] AC-7: `npm run lint`, `npm run type-check`, `npm test`, `npm run docs-refs-check`, and `npm run sync-templates:check` all pass.

## Design

### Affected Files

> Any protected doc Claude expects QA to touch (codebase-map, decisions, patterns, architecture, product-context, pipeline-orchestrator) must be listed here. Telemetry files (lessons-learned, task-quality-log, pipeline-invocations) are auto-committed and do not need a row.

| File | Change |
|---|---|
| `scripts/run-task/validation.ts` | Change `HANDOFF_DIFF_EXEMPT_PATHS` initializer (~line 888) from `new Set([])` to `new Set([...PIPELINE_TELEMETRY_FILES])` (typed as `ReadonlySet<string>` as today). Update the comment block immediately above the const to explain rationale (telemetry written by QA/orchestrator, not Codex; PR #107 surfaced this). No other code changes in this file. |
| `tests/run-task-validation.test.ts` | Append two new `void test(...)` blocks after the existing `'verifyHandoffAgainstDiffFromData rejects a diff file missing from all handoffs'` test (~line 925) for locality. Use the existing `makeHandoffMap` helper used by sibling tests. Names per AC-4 / AC-5 (exact strings). |
| `dist/cli/index.js` | Regenerated by `npm run build`. |
| `dist/scripts/run-task.js` | Regenerated by `npm run build`. |

### Interaction Dependencies

- `verifyHandoffAgainstDiff` (the I/O-wrapping caller at [validation.ts:998](scripts/run-task/validation.ts:998)) is unchanged — it just forwards data to `verifyHandoffAgainstDiffFromData`. No callers above it need updating.
- The `--pr` base-drift check (`verifyBaseDrift` at [validation.ts:1018](scripts/run-task/validation.ts:1018)) already treats `PIPELINE_TELEMETRY_FILES` as allowed paths via `allowedPaths` (line 1037). Behavior consistent.

### Data Model Changes

None. `HANDOFF_DIFF_EXEMPT_PATHS` is a module-local constant; its shape stays `ReadonlySet<string>`.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; new tests added per AC-4 / AC-5
- [x] `npm run build` — `scripts/run-task/validation.ts` is in the dist source set
- [x] `npm run docs-refs-check` — spec.md references file paths and line numbers
- [x] `npm run sync-templates:check` — CI runs it regardless; no canon-managed root files touched
- E2E: N/A (no UI surface)

## Docs Impact

None. The change is a one-line widening of an exemption set, plus its explanatory comment. No project-level doc updates required. The pipeline invocations log will record the task and the lessons-learned log MAY get an entry from QA (orchestrator-managed, not spec-driven).

## Known Risks

- **Over-exemption**: a real bug where Codex spuriously commits to telemetry files (e.g., a runaway implement run dumping to `docs/lessons-learned.md`) would no longer be caught by this pre-flight. Assessed low risk — Codex has never been observed writing to telemetry files outside of its handoff scope, and a deliberate write would still appear in the operator-visible commit log. The `--pr` base-drift check still treats telemetry as "allowed paths" — same prior behavior at the `--pr` stage.
- **Sibling case unaddressed**: `PIPELINE_MANAGED_DOCS` edits by QA before reroute (e.g., QA appending a pitfall to `docs/patterns.md`) would still cause the same diff→handoff failure on a post-reroute implement run. Explicit non-goal here, but worth noting — if it shows up, follow-up task expands `HANDOFF_DIFF_EXEMPT_PATHS` (or, better, adopts the implement-baseline-SHA fix).
- **No reroute-replay integration test**. A full reroute-cycle integration test would exercise the actual PR #107 path. The unit test against `verifyHandoffAgainstDiffFromData` directly is the cheapest reproduction of the bug; reroute mechanics aren't changing.

## Human Test Plan

1. Apply the change. Run `npm run build`; confirm `dist/cli/index.js` and `dist/scripts/run-task.js` get updated and are committed.
2. Open `dist/cli/index.js` and search for `HANDOFF_DIFF_EXEMPT_PATHS`. Confirm its initializer now contains the three telemetry file paths (`docs/pipeline-invocations.md`, `docs/task-quality-log.md`, `docs/lessons-learned.md`) instead of being empty.
3. Run `npm test`. Both new tests (named per the AC strings) should appear in the output and pass; no existing test should regress.
4. Read the updated comment block above `HANDOFF_DIFF_EXEMPT_PATHS` in `scripts/run-task/validation.ts`. The "why" should be readable without needing the PR #107 bug report — a future canon developer who hits this comment should understand the rationale.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names) — adjusted to be readable by a canon-ai maintainer (this project's product owner is its developer)
- [x] Validation Required has at least one entry marked `- [x]`
