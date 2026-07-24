# Implementation Handoff: recalibrate-spec-review-for-stronger-reviewer

> Author: Codex | Spec: `tasks/recalibrate-spec-review-for-stronger-reviewer/spec.md` | Plan: `tasks/recalibrate-spec-review-for-stronger-reviewer/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

| File | What Changed |
|---|---|
| `scripts/run-task/prompts/templates/spec-review.md` | Reframed the review objective around precise blockers and a valid clean-spec outcome, extended the silence default across implementability, added the bounded scope carve-out, and added the implied-default nit example. |
| `tests/run-task-prompts.golden.json` | Regenerated the prompt fixture; direct before/after key comparison confirms only `promptSpecReview` changed. |
| `dist/scripts/run-task.js` | Rebuilt the published orchestrator bundle so the shipped prompt contains the recalibrated instructions. |
| `docs/decisions.md` | Added the dated decision that reviewer guardrails carry an implicit model-strength calibration and must be revisited on model-generation changes. |

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

The implementation removes prompt scaffolding that pushed the stronger reviewer to manufacture findings while preserving the substantive blocker definition, Shape Check probes, bug/flake evidence ladder, verdict mapping, and cross-review ownership rules. The scope boundary is deliberately narrow: only behavior explicitly excluded and verified unaffected is downgraded; required-but-omitted dependencies, transitive effects, and contradictions remain blocking.

The source prompt was then propagated through both tested and shipped forms: the golden fixture was regenerated and isolated to the normal `promptSpecReview` key, and the distribution bundle was rebuilt. The decision log records the model-calibration principle so future model-generation upgrades trigger review of peer guardrails.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| None | The plan's exact prompt and decision-log wording was applied as written. | None |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1: Clean spec is a valid outcome | Met | The objective now explicitly says that no blocking findings is a valid, expected result; the former neutral-review failure framing is removed, and `failure mode` is absent from the source prompt. |
| AC-2: Whole-review silence default | Met | The silence default now names Shape Check and implementability, prohibits manufactured findings, and states that an empty implementability list is valid. |
| AC-3: Scope boundary with omitted-dependency carve-out | Met | Explicitly excluded and verified-unaffected behavior is a nit at most, while required callers/parsers/migrations/tests, transitive effects, and contradictions remain blocking. |
| AC-4: Blocking-vs-nit example | Met | The classification includes the field-name/implied-convention example as a plan-phase nit rather than Blocking. |
| AC-5: Guardrail phrase preservation | Met | The exact strings `No agent reviews its own output` and `Each role owns a checkpoint` remain; `task baseline` and `git -C` are absent; the unchanged AC-11 structural test passes. |
| AC-6: Golden regenerated | Met | `UPDATE_GOLDENS=1 npm test` regenerated the fixture; an object-key comparison against `HEAD` reports only `promptSpecReview`, and a subsequent unmodified-environment `npm test` passes. |
| AC-7: Shipped bundle rebuilt | Met | A fresh `npm run build` updated only `dist/scripts/run-task.js`; the new objective, silence default, scope boundary, and nit example are present in the bundle, while `dist/cli/index.js` remains clean. |
| AC-8: Durable meta-insight recorded | Met | `docs/decisions.md` now contains the July 2026 model-strength-calibration entry citing this task as the trigger; `npm run docs-refs-check` passes. |

## Edge Cases Considered

- Preserved blocking status for required-but-omitted pre-existing surfaces so the new scope boundary cannot suppress real interaction dependencies.
- Limited the out-of-scope downgrade to behavior both explicitly excluded and verified unaffected; merely reaching untouched code does not qualify.
- Preserved the bug/flake evidence ladder, Shape Check probes, verdict thresholds, checkpoint ownership phrase, and cross-review phrase verbatim.
- Left `spec-review-reroute.md` and all reroute golden entries unchanged because the evidence and scope apply only to the normal changes-requested loop.
- Confirmed the regenerated golden changed one key and the build changed one declared distribution artifact.
- Confirmed neither authorized root file is canon-managed, so no `templates/` mirror was generated or edited.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| Golden regeneration (`UPDATE_GOLDENS=1 npm test`) | Pass | 1,027 tests: 1,026 passed, 1 skipped because linked-worktree `.git` writes are restricted; golden regenerated successfully. |
| Lint (`npm run lint`) | Pass | ESLint completed with no findings. |
| Type checking (`npm run type-check`) | Pass | TypeScript completed with no errors. |
| Unit tests (`npm test`) | Pass | Clean-environment rerun: 1,027 tests, 1,026 passed, 1 expected environment skip, 0 failures. |
| Full build (`npm run build`) | Pass | Fresh tsup build succeeded; postbuild normalization completed and only the declared orchestrator bundle differs. |
| Docs references (`npm run docs-refs-check`) | Pass | `All refs OK`. |
| Canon-managed template sync (`npm run sync-templates:check`) | Pass | `All canon-managed files in sync`. |
| Diff hygiene (`git diff --check`) | Pass | No whitespace errors. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
