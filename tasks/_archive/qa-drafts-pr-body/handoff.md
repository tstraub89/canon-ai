# Implementation Handoff: qa-drafts-pr-body

> Author: Codex | Spec: `tasks/qa-drafts-pr-body/spec.md` | Plan: `tasks/qa-drafts-pr-body/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file - the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` - no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form - not backticks and not bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `AGENTS.md` | Documented `pr-body.md` in the task artifact list, the QA handoff sequence, and the `--pr` auto-commit allow-list. |
| `CLAUDE.md` | Noted that QA now drafts `pr-body.md` and described its outward-facing, no-attribution role. |
| `dist/cli/index.js` | Rebuilt bundle output from the CLI/doc updates. |
| `dist/scripts/run-task.js` | Rebuilt bundle output from the orchestrator and QA prompt changes. |
| `docs/codebase-map.md` | Added `pr-body.md` to the task-artifact template map. |
| `docs/pipeline-orchestrator.md` | Documented the new `--pr` body-resolution order and the `pr-body.md` task artifact. |
| `scripts/run-task/main.ts` | Added QA PR-body resolution, worktree-first template loading for QA, and the new `--pr` fallback branch. |
| `scripts/run-task/phases/qa.ts` | Passed the resolved PR template through to the QA prompt. |
| `scripts/run-task/prompts/index.ts` | Extended `promptQa` so the QA template can inject a PR template or default skeleton. |
| `scripts/run-task/prompts/templates/qa.md` | Instructed QA to write `tasks/<id>/pr-body.md` and avoid canon attribution. |
| `scripts/run-task/validation.ts` | Added `isPrBodyTemplate` as the stub detector for `pr-body.md`. |
| `scripts/run-task/worktree.ts` | Registered `pr-body.md` in `TASK_ARTIFACT_FILES`. |
| `src/lib/canon-owned.ts` | Added `.canon/templates/pr-body.md` to the canon-owned upgrade list. |
| `tasks/qa-drafts-pr-body/handoff.md` | Recorded the implementation results, file list, AC coverage, blockers, and validation outcomes. |
| `tasks/qa-drafts-pr-body/status.json` | Task bookkeeping updated for the active implement phase and branch stamp. |
| `templates/AGENTS.md` | Mirrored the AGENTS.md task-artifact and QA-summary updates. |
| `templates/CLAUDE.md` | Mirrored the QA `pr-body.md` guidance. |
| `templates/docs/pipeline-orchestrator.md` | Mirrored the new `--pr` body-resolution order and task-artifact listing. |
| `templates/.canon/templates/pr-body.md` | Added the mirrored canon template stub for `pr-body.md`. |
| `.canon/templates/pr-body.md` | Added the new canon-managed `pr-body.md` scaffold. |
| `tests/cli.test.ts` | Extended the adopter-shipped leakage scan to cover `templates/.canon/templates/pr-body.md`. |
| `tests/run-task-prompts.golden.json` | Regenerated the QA prompt snapshot for the new default skeleton and explicit template injection branch. |
| `tests/run-task-prompts.test.ts` | Added coverage for the QA prompt's explicit PR-template injection path. |
| `tests/run-task-safety.test.ts` | Added coverage for `resolveQaPrBody` plus the `--pr` fallback-log path. |
| `tests/run-task-validation.test.ts` | Added coverage for `isPrBodyTemplate` on missing, stub, and populated files. |

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

QA now drafts an outward-facing `pr-body.md` so single-task `--pr` runs can open with a human-readable body instead of the raw repo template. The implementation keeps the existing `CANON_PR_BODY` override untouched, resolves templates worktree-first to match the rest of the pipeline, and falls back cleanly for missing/stub bodies and bundle PRs.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason - document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| _(none)_ | | |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: QA writes a filled body | Met | `scripts/run-task/phases/qa.ts`, `scripts/run-task/prompts/index.ts`, `scripts/run-task/prompts/templates/qa.md`, `.canon/templates/pr-body.md`, `tests/run-task-validation.test.ts`, `tests/run-task-prompts.test.ts` |
| AC-2: outward-facing, no footprint | Met | `scripts/run-task/prompts/templates/qa.md` forbids canon/AI attribution; `done.md` behavior is unchanged. |
| AC-3: `--pr` precedence | Met | `scripts/run-task/main.ts` resolves `CANON_PR_BODY` first, then populated `pr-body.md`, then the repo template. |
| AC-4: soft fallback + log | Met | `scripts/run-task/main.ts` logs the fallback reason; `tests/run-task-safety.test.ts` covers the missing-body case. |
| AC-5: bundles fall back | Met | `scripts/run-task/main.ts` routes bundles to the template/`--fill` fallback; `tests/run-task-safety.test.ts` covers the helper branch. |
| AC-6: artifact registration | Met | `.canon/templates/pr-body.md`, `templates/.canon/templates/pr-body.md`, `src/lib/canon-owned.ts`, `scripts/run-task/worktree.ts`, `tests/cli.test.ts`. |
| AC-7: populated is well-defined | Met | `scripts/run-task/validation.ts` now owns `isPrBodyTemplate`; missing/stub/populated cases are covered in tests. |
| AC-8: no regression | Met | `resolveCanonPrBody` tests still pass; `main.ts` still honors `CANON_PR_BODY` before any PR-body file logic. |

## Edge Cases Considered

- Worktree-first template resolution for QA and for `--pr`, so a task-branch template is not shadowed by REPO_ROOT.
- Missing vs stub `pr-body.md` both fall back cleanly, but with different log reasons for easier operator diagnosis.
- Bundle PRs do not try to concatenate per-task bodies.
- `CANON_PR_BODY` still wins before any file-based body selection.
- `done.md` remains the only QA gate artifact; the new PR body is additive.

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
> | `blocked` | Check would have run but infrastructure was unavailable (CI down, network out). Triage required - distinct from `Fail`. |
>
> Required checks (those in spec.md's Validation Required section) cannot be marked `N/A` or `not_configured` - adjust the spec or run the check.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | Full suite passed, including the new prompt / safety / validation coverage. |
| `npm run build` | Pass | Rebuilt `dist/` after the source changes. |
| `npm run docs-refs-check` | Pass | |
| `npm run sync-templates:check` | Pass | |
| `E2E` | not_configured | Spec marks E2E as N/A; there is no UI surface for this task. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>`
