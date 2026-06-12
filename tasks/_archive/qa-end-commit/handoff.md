# Implementation Handoff: qa-end-commit

> Author: Codex | Spec: `tasks/qa-end-commit/spec.md` | Plan: `tasks/qa-end-commit/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `scripts/run-task/main.ts` | Added `commitQaArtifacts(taskIds, cwd)` and routed the `qa` phase through it from `checkAndRoute`. |
| `scripts/run-task/validation.ts` | Added `PIPELINE_MANAGED_DOCS` to the implement auto-commit source-bypass set. |
| `tests/run-task-safety.test.ts` | Added staged-path, helper, bundle, evidence-advance, clean-tree, and allow-list regression coverage for QA-end commits. |
| `tests/run-task-parse-porcelain.test.ts` | Added managed-doc bypass coverage for `findUncoveredTrackedChanges`. |
| `dist/scripts/run-task.js` | Rebuilt the compiled run-task bundle. |
| `docs/pipeline-orchestrator.md` | Documented the QA-end artifact commit and its relationship to `human_review`. |
| `templates/docs/pipeline-orchestrator.md` | Synced the canon-managed pipeline doc mirror. |
| `docs/patterns.md` | Updated the git-surgery pitfall to reflect that the post-QA window is now committed and only the pre-QA residual remains. |
| `docs/BACKLOG.md` | Checked off the QA-end commit backlog item and corrected its managed-doc allow-list note. |

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

Implemented the QA-end artifact commit as a sibling to the existing human-review commit path. The helper uses the same `humanReviewAllowedPath` and `buildHumanReviewStagePaths` primitives, but it derives the allowed managed-doc set from the full `PIPELINE_MANAGED_DOCS` list because `qa.status === 'done'` at the chokepoint. It commits only in the supplied active checkout `cwd`, performs no push/PR work, and is invoked from `checkAndRoute('qa', ...)`, which covers both normal QA completion and evidence-based QA auto-advance.

The implement reconciler now treats managed docs like task artifacts and telemetry for orphan-source detection. That closes issue #152's structural mechanism even if a managed doc is dirty during an implement boundary.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Added a post-add staged-file allow-list check in `commitQaArtifacts`. | This mirrors `commitHumanReviewFiles`'s second-stage guard more closely and prevents a dirty allowed directory from sweeping pre-staged out-of-scope files into the QA-end commit. | Strengthens AC-7/AC-10; no behavior outside the spec. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `commitQaArtifacts` exists in `scripts/run-task/main.ts` and reuses `buildHumanReviewStagePaths`; staged-path tests cover full managed-doc mode and worktree-derived dirty entries. |
| AC-2 | Met | `checkAndRoute('qa')` invokes the helper for bundle task ids; real-git helper test asserts post-commit `git status --porcelain=v1 -uall` is clean for task artifacts, telemetry, and managed docs. |
| AC-3 | Met | The helper is called from the single `checkAndRoute` QA case; evidence-advance test verifies `tryEvidenceAdvance`'s `qa done` path commits before returning. |
| AC-4 | Met | Single-task and bundle tests assert `chore: QA artifacts for task-a` and `chore: QA artifacts for task-a, task-b`. |
| AC-5 | Met | Existing clean-tree `--pr`/`human_review` tests still pass and assert push/PR behavior without an empty commit. |
| AC-6 | Met | Existing dirty allowed `--pr` test still passes and asserts the commit + push path for late artifact edits. |
| AC-7 | Met | Helper takes `cwd`, reads `git status` from that checkout, and tests assert non-dirty managed docs are not staged from a hardcoded root list. |
| AC-8 | Met | QA-end helper leaves a real git worktree clean after managed-doc QA edits; the managed-doc bypass prevents a later implement auto-commit abort on the same class of dirty doc. |
| AC-9 | Met | `autoCommitAllowedSourceBypass` now includes `PIPELINE_MANAGED_DOCS`; porcelain test verifies `docs/codebase-map.md` absent from handoff is not uncovered. |
| AC-10 | Met | QA-end helper reuses `humanReviewAllowedPath`; tests cover managed docs absent from Affected Files being staged and dirty out-of-union source files aborting with the QA-end allow-list message. |

## Edge Cases Considered

- Clean QA-end rerun: if no dirty entries exist, `commitQaArtifacts` returns without an empty commit.
- Pre-staged unexpected files: checked before and after staging to avoid commit sweep-in.
- Bundles: one QA-end commit names every task id and stages every dirty bundled task dir.
- Managed docs absent from spec Affected Files: accepted only at QA-end/full managed-doc mode.
- Dirty source/test files at QA-end: rejected as implement-phase leftovers.

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
| `npm run lint` | Pass | ESLint completed successfully. |
| `npm run type-check` | Pass | TypeScript completed successfully. |
| `npm test` | Pass | Full suite: 854 pass, 1 skipped, 0 fail. |
| `npm run build` | Pass | Rebuilt `dist/scripts/run-task.js`. |
| `npm run sync-templates:check` | Pass | Canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| E2E | not_configured | Spec Validation Required marks E2E N/A; no UI surface. |

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
