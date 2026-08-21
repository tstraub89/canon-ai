# Implementation Handoff: relax-reroute-gate-post-implement

> Author: Codex | Spec: `tasks/relax-reroute-gate-post-implement/spec.md` | Plan: `tasks/relax-reroute-gate-post-implement/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/main.ts` | Widened reroute admission to derived `code_review`, `qa`, and `human_review` phases while preserving the spec-gap exemption predicate; added actual-entry-state banner labels and the fail-closed rejection summary. |
| `src/cli/index.ts` | Updated top-level `--reroute` help to the post-implement admission rule. |
| `src/orchestrator/cli.ts` | Updated the independently rendered run-command `--reroute` help to the same rule. |
| `src/orchestrator/context.ts` | Made the implement reroute state header phase-neutral while retaining the human actor and reroute round. |
| `src/orchestrator/prompts/index.ts` | Reframed implement-reroute banners, task lines, and preamble around a human-authored post-implement amendment; removed `humanReviewRound`. |
| `src/orchestrator/prompts/templates/implement-reroute.md` | Replaced the human-review-origin claim with a human-authored amendment opener. |
| `src/orchestrator/prompts/templates/plan-reroute.md` | Replaced the human-review-origin claim with post-implement amendment/reroute wording. |
| `src/orchestrator/prompts/templates/spec-review-reroute.md` | Replaced the human-review-origin claim with post-implement amendment/reroute wording. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Documented widened admission, unchanged spec-gap sibling exemption, human-decision requirement, and the pre-QA uncommitted-artifact warning; regenerated the managed mirror. |
| `.claude/skills/canon-pipeline/SKILL.md`, `templates/.claude/skills/canon-pipeline/SKILL.md` | Renamed the reroute section, documented widened admission and the explicit-human-decision guardrail, retained the narrow sibling exemption, and regenerated the managed mirror. |
| `README.md` | Updated both user-facing reroute command descriptions. |
| `tests/run-task-reroute-preflight.test.ts` | Added admitted/rejected state matrices, mixed-phase normalization, exemption invariants, unamended spec-gap coverage, QA `--force` coverage, and state-varying banner assertions. |
| `tests/run-task-prompts.test.ts` | Repointed the single-task positive and bundle negative strong-anchor assertions to the reroute-round phrasing. |
| `tests/run-task-prompts.golden.json` | Regenerated exactly the six reroute prompt entries; both QA prompt entries remain byte-identical. |
| `dist/orchestrator/run-task.js` | Rebuilt the tracked orchestrator bundle from the changed orchestrator sources and prompt templates. |
| `dist/cli/index.js` | Rebuilt the tracked CLI bundle from the changed help source. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

The gate now admits a bundle only when every task's derived current phase belongs to a small explicit post-implement set. The pre-existing `allCodeReviewBlocked && someSpecGap` predicate remains separate and still controls only the narrow sibling exemption and the spec-gap banner, so widening admission cannot grant exemptions to new states. Rejection remains fail-closed and reports every task's derived phase before any state write.

The pre-reset banner derives its label from the captured entry statuses, including per-task labels for mixed-phase bundles. Post-reset prompts cannot recover that entry phase without new persisted state, so they instead state the common truthful contract: a human wrote an amendment and rerouted completed implementation work, and the agent should implement only the delta.

The pre-fix focused reroute suite produced 12 expected failures at the former two-case gate. After the implementation, all 42 focused reroute-preflight tests passed, including the original spec-gap exemption rows unchanged.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Kept the pre-first-QA safety warning self-contained instead of linking to the planned `docs/patterns.md` section. | `npm run docs-refs-check` proved that heading exists only in canon-ai's root patterns doc, not the adopter scaffold copy; shipping the reference would violate adopter scope. | AC-9 remains met: the warning and prohibited operations are still explicit, and docs-reference validation passes. |
| Strengthened several example prompt rewrites to explicitly say a human amended/wrote the spec and rerouted the task. | Some plan examples only said a human “provided feedback,” while binding AC-10(d) requires the human to remain the actor who wrote the amendment and decided the reroute on every rewritten surface. | AC-10 is met more directly; prompt routing and exempt-task lines remain unchanged. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 — admission widened | Met | Parameterized coverage admits blocked/changes-requested/in-progress/pending `code_review`, approved-review → pending `qa`, and in-progress `qa`; existing `human_review` and blocked `spec_gap` rows also assert reset metadata. |
| AC-2 — earlier and complete states rejected without mutation | Met | Rows cover `spec`, `spec_review`, `plan`, `implement`, and `complete`, plus an admitted/off-phase bundle; every rejection asserts `Current state:` and byte-identical status files. |
| AC-3 — mixed admitted phases normalize | Met | A `qa` + `human_review` full-tier bundle succeeds and both statuses derive `spec_review`; its banner names both task IDs and entry phases. |
| AC-4 — exemption predicate unchanged | Met | Original mixed-spec-gap exemption tests remain unchanged and green; a two-task non-gap block with one missing amendment aborts without either exemption field. |
| AC-5 — spec-gap tasks never exempt unamended | Met | Tests cover a true spec-gap-entry bundle and a non-blocked `spec_gap` state where the exemption predicate does not apply; both abort naming the gap task without mutation. |
| AC-6 — Amendment/`--force` behavior unchanged | Met | A `qa in_progress` pair verifies the full failure block, byte-identical abort, per-task force warning, successful reset, and no exemption. |
| AC-7 — banner reflects entry state | Met | State-varying assertions isolate the label before `→`: code-review block names status/verdict and excludes `human_review`/`spec_gap`; human-review label excludes `code_review`. Existing spec-gap label and mixed-bundle labels are also pinned. |
| AC-8 — old predicate removed | Met | `allAtHumanReview` is absent; `allCodeReviewBlocked`, `someSpecGap`, and `isSpecGapReroute` remain. |
| AC-9 — contract surfaces and sweep | Met | Both CLI help blocks, both README locations, the pipeline doc, the pipeline skill, and managed mirrors state the new rule. Sweep classification is recorded below; dated records were not edited. |
| AC-10 — truthful human-directed prompts | Met | All nine rewritten sources keep `human` as the amendment/reroute actor; `humanReviewRound` is absent; strong-anchor tests were rewritten; all six rendered reroute prompts pass the forbidden co-occurrence check. |
| AC-11 — generated artifacts | Met | Both mirrors and both dist bundles regenerated. Golden audit found exactly the six permitted changed keys; `promptQa` and `promptQa_withTemplate` are byte-identical to HEAD. |
| AC-12 — suite green | Met | Lint, type-check, and the full unit suite pass on the final tree. |
| AC-13 — explicit human decision | Met | The pipeline reference and pipeline skill each contain a separate `human decision` guardrail requiring explicit human direction even in autonomous modes; mirrors match. |

## AC-9 Sweep Classification

The same-line co-occurrence sweep for reroute plus `human_review`, “human review,” or `spec_gap` was classified as follows:

- Rewritten current-contract surfaces: both README locations; the skill admission/exemption lines and mirror; the pipeline flags/admission/exemption/re-entry lines and mirror; the new main rejection rule.
- Rule 1 dated/telemetry records: `docs/BACKLOG.md` historical entries and existing `docs/task-quality-log.md` rows/definition (plus its mirror). `docs/BACKLOG.md`, `CHANGELOG.md`, and all shared telemetry files have no task implementation diff.
- Rule 2 live non-admission contracts: the `reroute_count`/`Human reroute?` rationale in `docs/decisions.md`; the `Human reroute?` metric instruction in the QA template; the code-review `spec_gap` routing rows and bundle paragraph in the pipeline doc/mirror.
- Other non-precondition mentions: the QA-end durability note in `docs/patterns.md`, the post-reroute `full_send` human-verification message in `main.ts`, and the internal spec-gap-exemption comment in the prompt builder. None presents `human_review` or `spec_gap` as a prerequisite for invoking `--reroute`.

## Edge Cases Considered

- A dead orchestrator can leave `code_review in_progress`; the gate admits it only because the caller's existing concurrent-run guard handles live processes.
- Stale or empty code-review verdicts are admitted but never generalized into sibling exemptions.
- Any single earlier-phase or complete task rejects the whole bundle before the Amendment check or status writes.
- A mixed admitted bundle loses phase consistency during admission but regains one normalized phase after the existing reset loop; the banner preserves visibility of the differing entry states.
- `--force` from a widened state bypasses only the Amendment abort and does not synthesize exemption metadata.
- The golden audit explicitly guards against accidental QA prompt movement.
- Pre-QA reroutes preserve files themselves but leave task artifacts vulnerable to later destructive manual git operations, now stated in user-facing guidance.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final-tree ESLint run passed. |
| `npm run type-check` | Pass | Final-tree strict TypeScript check passed. |
| `npm test` | Pass | Full test suite passed, including all 42 reroute-preflight tests and prompt fidelity tests. |
| `npm run build` | Pass | Rebuilt both tracked bundles; postbuild normalization completed. |
| `npm run sync-templates:check` | Pass | Both managed root/mirror pairs are in sync. |
| `npm run docs-refs-check` | Pass | All root and adopter-scaffold references pass. |
| Focused reroute-preflight suite | Pass | `node --test --import ./tests/md-loader-register.mjs --import tsx tests/run-task-reroute-preflight.test.ts` passed 42/42 after the change. |
| Focused prompt suite | Pass | Same direct runner against `tests/run-task-prompts.test.ts` passed 35/35 without golden-update mode. |
| Golden scope audit | Pass | Exactly six reroute keys changed; both QA keys were byte-unchanged and all six reroute values passed the forbidden human/review-tried-rejected regex. |
| `git diff --check` | Pass | No whitespace errors. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
