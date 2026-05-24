# Implementation Handoff: scope-pr-auto-commit-to-affected-files-v2

> Author: Codex | Spec: `tasks/scope-pr-auto-commit-to-affected-files-v2/spec.md` | Plan: `tasks/scope-pr-auto-commit-to-affected-files-v2/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.

| File | What Changed |
|---|---|
| `scripts/run-task/validation.ts` | Added `parseAffectedFilesFromSpec(taskId)` using the existing Design-section/table/path-cell parsers, with malformed-row reporting. |
| `scripts/run-task/main.ts` | Scoped `human_review` commit allow-list to task artifacts, telemetry files, and managed docs listed in spec Affected Files; added malformed-row and managed-doc advisory warnings. |
| `tests/run-task-validation.test.ts` | Added parser fixtures for valid, missing, sectionless, malformed, backtick, and markdown-link Affected Files cases. |
| `tests/run-task-safety.test.ts` | Added human_review allow-list safety coverage for out-of-scope managed docs, in-scope managed docs, telemetry, bundles, malformed rows, non-managed entries, and mixed entries. |
| `.canon/templates/spec.md` | Added the managed-doc Affected Files note under `### Affected Files`. |
| `templates/.canon/templates/spec.md` | Mirrored the managed-doc Affected Files note in the install template. |
| `docs/pipeline-orchestrator.md` | Documented the narrowed `human_review` auto-commit allow-list, die behavior, non-managed exclusion, and advisory warning. |

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

The implementation narrows only the `human_review` auto-commit allow-list. It parses each task's spec Affected Files table once, intersects those paths with `PIPELINE_MANAGED_DOCS`, and threads that resolved set through the existing dirty-file, stage-path, pre-stage, and post-stage checks. Telemetry remains always allowed, task artifacts remain always allowed, and source/test files listed in Affected Files still die if dirty at `human_review`.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Checked the three required rows in this task's `spec.md` Validation Required section. | The implement prompt and spec prose required lint/type/unit, but the rows were unchecked; `validateHandoffAgainstSpec()` only recognizes checked required rows. This is a task-artifact correction, not a behavior change. | None. Enables normal handoff validation for the checks already required by the prompt. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: `parseAffectedFilesFromSpec` exported | Met | Implemented in `scripts/run-task/validation.ts` using `extractSectionBodies`, `parseTableH3`, and `parseHandoffPathCell`. |
| AC-2: Missing/unreadable/missing-section cases return empty | Met | Covered in `tests/run-task-validation.test.ts`; read failures and missing Design/Affected Files return `{ files: [], malformed: [] }`. |
| AC-3: `humanReviewAllowedPath` widened and no managed-doc shared-doc carve-out | Met | Signature now takes `affectedManagedDocs`; body allows task artifacts, `PIPELINE_TELEMETRY_FILES`, or `affectedManagedDocs`. |
| AC-4: `buildHumanReviewStagePaths` widened | Met | Signature now takes `affectedManagedDocs`; stage set is task dirs, telemetry, and affected managed docs present in dirty entries. |
| AC-5: `commitHumanReviewFiles` resolves affected managed docs once | Met | Parser/filter block runs after mirroring and before porcelain; malformed rows warn with task ID; all call sites receive the resolved set. |
| AC-6: Unexpected dirty-file die message updated | Met | Message names the allow-list shape, managed-doc remediation, implement-phase source/test remediation, and `git checkout HEAD --`; other die messages were left unchanged. |
| AC-7: Advisory warning for committed managed docs | Met | Warning fires once per staged affected managed doc and does not block commit; covered in safety tests. |
| AC-8: Parser tests | Met | Added the four AC-2 cases plus malformed placeholder and backtick/markdown-link smoke tests. |
| AC-9: Commit allow-list safety tests | Met | Added all seven requested cases in `tests/run-task-safety.test.ts`. |
| AC-10: Spec templates updated | Met | Updated both `.canon/templates/spec.md` and `templates/.canon/templates/spec.md`. |
| AC-11: Pipeline docs updated | Met | Updated `docs/pipeline-orchestrator.md` Auto-Branch + Auto-Commit section. |

## Edge Cases Considered

- Specs missing `spec.md`, `## Design`, or `### Affected Files` do not throw and do not widen the allow-list.
- Malformed Affected Files rows warn with task ID but do not enter the allow-list.
- Bundle runs union each task's affected managed docs.
- Non-managed Affected Files entries remain excluded from `human_review` commits, including mixed managed/non-managed specs.
- Same-file managed-doc overlap remains a path-level residual; the advisory warning is the guardrail requested by the spec.

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
| `lint` (`npm run lint`) | Pass | `eslint scripts/ tests/ src/` completed successfully. |
| `type-check` (`npm run type-check`) | Pass | `tsc -p tsconfig.json --noEmit` completed successfully. |
| `unit tests` (`npm test`) — run the full suite | Pass | Full `node --test --import ./tests/md-loader-register.mjs --import tsx tests/*.test.ts` suite passed: 387 pass, 1 skipped. |
| `build` — N/A; no build step beyond type-check | deferred_by_spec | Spec: §Validation Required marks build N/A. |
| `E2E` — N/A; no UI | deferred_by_spec | Spec: §Validation Required marks E2E N/A. |

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
