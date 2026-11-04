# Implementation Handoff: cold-lens-full-model-l-xl

> Author: Codex | Spec: `tasks/cold-lens-full-model-l-xl/spec.md` | Plan: `tasks/cold-lens-full-model-l-xl/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/lib/pipeline-policy.ts` | Cold-Codex review uses full/high for effective L and XL; XS/S/M remain mini/high. Updated the row comment. |
| `tests/pipeline-policy.test.ts` | Pinned L/XL cells, delicate-M promotion, and three bundle cases. Other phase expectations are unchanged. |
| `tests/run-task-code-review.test.ts` | Added a fresh-process test through the real Codex backend with distinct explicit model overrides and literal argv assertions for L, delicate M, and ordinary M. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Updated the matrix, model prose, invocation placeholder, override purposes, and both delicate descriptions; generated the mirror through sync. |
| `docs/decisions.md` | Added the November decision with evidence limits and rollback; explicitly superseded only the historical model clause. |
| `docs/BACKLOG.md` | Replaced the override proposal with post-release measurement, preserved yield baselines, generalized private references, and retained the question of M promotion. |
| `README.md` | Both delicate descriptions now include the mixed-mode cold-Codex lens. |
| `.claude/skills/canon-pipeline/recovery.md`, `templates/.claude/skills/canon-pipeline/recovery.md` | Noted that M→L swaps the mixed-mode cold-lens model; generated the mirror through sync. |
| `CHANGELOG.md` | Added an Unreleased Changed bullet explaining cells, custom full-model overrides, bundle promotion, and rollback. |
| `dist/orchestrator/run-task.js` | Rebuilt the distributed policy cells. |

## Canon Governance

The authoritative provenance remains in `tasks/cold-lens-full-model-l-xl/status.json`.

| Field | Source |
|---|---|
| Upstream repo | `canon.upstream_repo` in the task status file |
| Upstream commit | `canon.upstream_commit` in the task status file |
| Orchestrator commit | `canon.orchestrator_commit` in the task status file |
| Codex CLI | `canon.codex_cli` in the task status file |
| Claude Code | `canon.claude_code` in the task status file |

## Intent & Rationale

The existing backend already passes the effective-size policy model to the cold-review subprocess. Changing only the two matrix cells preserves effort, scope, hard-failure behavior, provider routing, and one-review-per-bundle behavior. Tests cover both the pure matrix and literal arguments from the real backend, avoiding the stubbed configuration and module-load environment traps.

The decision and changelog expose the added cost for large/promoted bundles and custom full-model overrides. The BACKLOG follow-up treats improved defect detection as a hypothesis to measure.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Added and ran tests before editing production code. | Voluntarily verified that the coverage detects the old mini cells. | Strengthens AC-1–AC-3; six expected failures before the fix. |
| None otherwise. | Both entry points were rebuilt, but the CLI artifact was byte-identical, as anticipated by the plan. Only the changed artifact is listed above. | See the AC-9 interpretation below. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | All five review cells are tested; a mechanical comparison confirmed spec-review and implement expectation rows are byte-identical to base. |
| AC-2 | Met | Delicate M, [S, L], and [S, S-delicate] resolve full/high; [XS, M] resolves mini/high. |
| AC-3 | Met | A fresh subprocess sets both explicit override values before import, resolves the real cold-review backend, and captures literal full/full/mini arguments with high effort. |
| AC-4 | Met | The exact specified grep finds only the historical paragraph in `docs/decisions.md:358`, covered by its supersession pointer. |
| AC-5 | Met | Re-read every named source/doc passage and confirmed the size split or delicate promotion; both managed mirrors match their roots. |
| AC-6 | Met | New dated Decision/Why/Rule section preserves the historical heading and non-model contracts, records evidence caveats, and names previous-release rollback. |
| AC-7 | Met | Rewritten entry retains the baseline counts, both measures, and M question. Privacy-pattern checks passed on that entry and all added decision/changelog lines. |
| AC-8 | Met | Unreleased Changed bullet covers the split, full-model override effect, combined bundle review, and rollback. |
| AC-9 | Met | Sync check passed. Both entry points were rebuilt twice with stable SHA-256 digests; `dist/cli/index.js` also matches HEAD exactly. Changed generated output is ready for orchestrator-owned commit. |

## Edge Cases Considered

- Effective size, including a delicate secondary bundle member, selects the model; nominal size still controls review-loop limits.
- Ordinary M and [XS, M] retain mini/high; spec-review and implement cells are untouched.
- Explicit test model values override inherited model settings before modules load. Fake CLI output includes both findings and completion, and the test requires exactly three invocations.
- The subprocess imports from the active worktree and verifies its actual invocation cwd, canonicalizing temporary paths for macOS.
- Claude provider mode remains unchanged. Existing parity/provider tests pass in the full suite.

## Blockers

- [ambiguity] AC-9 describes committed-dist parity after committing and asks for both entry points to be rebuilt, while this phase explicitly forbids git writes. Interpretation used: rebuild both entry points, retain only actual generated deltas, and prove repeat-build byte parity before handing off. `dist/cli/index.js` is byte-identical to HEAD and is therefore omitted from Changes; `dist/orchestrator/run-task.js` contains the two new cells. The orchestrator owns the commit and the subsequent committed-tree freshness check. No implementation or scope gap remains under this interpretation.

## Red-First Evidence

The spec does not mandate red-first ACs; these checks were run voluntarily before any non-test implementation edits. The focused command was:

```bash
node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='codex matrix|review invocation parity|cold lens model' tests/pipeline-policy.test.ts tests/run-task-code-review.test.ts
```

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-1 | Focused command above | e8e520f42b7a9393097fc6a578e55ce75401403b | L and XL returned mini/high instead of full/high. | Pass; both rows full/high. |
| AC-2 | Focused command above | e8e520f42b7a9393097fc6a578e55ce75401403b | Delicate M, [S, L], and [S, S-delicate] returned mini/high. | Pass; all three full/high, ordinary bundle guard mini/high. |
| AC-3 | Focused command above | e8e520f42b7a9393097fc6a578e55ce75401403b | Real backend emitted `-m cold-lens-test-mini` for L; literal full-model expectation failed. | Pass; full/full/mini, high effort, exactly three captures. |

The pre-fix focused run had 16 passes and six expected failures; the post-fix focused run passed all 22 tests.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final run passed after changing fake-binary creation to an awaited write. |
| `npm run type-check` | Pass | Re-ran after the test adjustment. |
| `npm test` | Pass | 2,072 tests: 2,071 passed, one skipped, zero failures; about 91 seconds. Optional fish shell checks reported unavailable tooling. |
| `npm run build` | Pass | Both entry points rebuilt. A second build produced identical SHA-256 values for both outputs; CLI output also matches HEAD. |
| `npm run sync-templates:check` | Pass | Both managed pairs synchronized; direct byte comparisons also passed. |
| `npm run docs-refs-check` | Pass | All references valid, including the final handoff check. |
| Focused matrix/backend command above | Pass | 22 passed, zero failures after the fix. |
| AC-4 exact stale-claim grep | Pass | Sole hit is the explicitly superseded historical decision paragraph. |
| AC-7 privacy / AC-1 unchanged-row assertions | Pass | No prohibited private patterns in the specified additions; other phase test rows unchanged. |
| `git diff --check` | Pass | No whitespace errors. |

No paid live-model review was run; subprocess coverage uses a fake executable with the production backend and policy. The spec's live human test plan remains for QA/operator verification.

## Ready for Review

- [x] All spec ACs met (see AC Coverage and AC-9 interpretation above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
