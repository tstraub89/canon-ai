# Implementation Handoff: spec-judgment-calls

> Author: implementer | Spec: `tasks/spec-judgment-calls/spec.md` | Plan: `tasks/spec-judgment-calls/plan.md`

## Changes

| File | What Changed |
|---|---|
| `.canon/templates/spec.md`, `templates/.canon/templates/spec.md` | Added the Judgment Calls section, its table and classification rules, and the checklist item. |
| `.canon/templates/spec-review.md`, `templates/.canon/templates/spec-review.md` | Added the judgment-call question to the Shape Check. |
| `.canon/templates/done.md`, `templates/.canon/templates/done.md` | Added Judgment Calls to Confirm before Decisions Made. |
| `.claude/skills/canon-spec/SKILL.md`, `templates/.claude/skills/canon-spec/SKILL.md` | Added the author rule, self-check, grill counter-case, and spec-gate presentation instruction. |
| `.claude/skills/canon-spec-review/SKILL.md`, `templates/.claude/skills/canon-spec-review/SKILL.md` | Added Agent C item (11) at STRONG with the concrete review bar. |
| `.claude/skills/canon-pipeline/SKILL.md`, `templates/.claude/skills/canon-pipeline/SKILL.md` | Added the Author-row reminder at the human spec gate. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Added the judgment-call Shape Check question and canonical definitions. |
| `src/orchestrator/prompts/index.ts` | Added the Judgment Calls requirement to the spec prompt self-check. |
| `src/orchestrator/prompts/templates/spec.md` | Added the author obligation and fast-tier notice. |
| `src/orchestrator/prompts/templates/spec-revision.md` | Added the author obligation and Author reset rule for changed choices. |
| `src/orchestrator/prompts/templates/spec-review.md` | Added the Blocking check with bar B and the missing-section default. |
| `src/orchestrator/prompts/templates/qa.md` | Added done.md and PR-body output guidance for Author rows. |
| `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json` | Added canonical-text parity coverage and regenerated the seven specified prompt snapshots. |
| `dist/orchestrator/run-task.js` | Rebuilt the bundled prompt output. |

## Canon Governance

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

Added consistent author, reviewer, gate, and QA guidance for judgment calls while keeping the new check in prompts and skills rather than parser or validation tooling. Canonical definitions D, S, and B are pinned across their required carriers by a regression test.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| None | The implementation follows the plan's specified surfaces and behavior. The repository's Node test invocation was used for the red-first check because it registers the Markdown loader required by prompt imports. | None |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1: Template section | Met | `## Judgment Calls` sits between Decision and Non-Goals in `.canon/templates/spec.md`; the table, Human/Author meanings, approval rule, revision reset, and `None — <reason>` are present. |
| AC-2: Self-check parity | Met | The template checklist, `canon-spec` skill list, and `promptSpec` self-check all require each call's alternative and Decided by value. |
| AC-3: Pipeline author rules | Met | The spec prompt carries D/S and the fast-tier-only-check clause; the revision prompt carries D/S and the changed-choice reset without a fast-tier clause. |
| AC-4: Skill author rule | Met | The `canon-spec` rules of thumb carry the same author obligation, D/S, and fast-tier clause. |
| AC-5: Grill rule | Met | The recommended-answer and Always take a position instructions remain; the grill also asks for the runner-up's strongest case and what would flip the call. |
| AC-6: Gate presentation | Met | `canon-spec` asks the author to present Author rows or none; `canon-pipeline` asks the operator to review those rows at the human gate. |
| AC-7: spec_review check | Met | The pipeline prompt applies B as a Blocking check, keeps the missing/empty-section default explicit, and leaves the silence paragraph unchanged. The template, pipeline guide, and Agent C item (11) carry the matching questions. |
| AC-8: QA output | Met | `done.md` lists Author rows or `None.` before Decisions Made; single-task PR guidance places rows in a notes-like section or appends a Judgment calls heading. |
| AC-9: Canonical-text test | Met | The test defines D/S/B once, checks non-empty existing carrier lists and rendered prompts, and enforces contiguous D/S. Base run failed on missing D in `.canon/templates/spec.md`; removing D from `src/orchestrator/prompts/templates/spec-revision.md` also failed with the carrier-specific assertion, and restoring it passed. |
| AC-10: No tooling enforcement | Met | `grep -rn "Judgment Calls" src/` returned hits only under `src/orchestrator/prompts/`. Existing `tests/task-cli.test.ts:442-452` marks a fixture spec without the section done successfully. |
| AC-11: Scope bound | Met | The current diff against the task base contains none of the prohibited review, reroute, canon-init, phase, or validation files. |
| AC-12: Goldens and mirrors | Met | Golden comparison against the task base found exactly the seven named keys. `npm run sync-templates:check` passed. |

## Edge Cases Considered

- A missing or empty Judgment Calls section alone does not produce a finding; an unlisted call still does when it meets all parts of B.
- A fast-tier task skips `spec_review`, so the author-facing spec prompt and skill make the author's own obligation explicit.
- A changed chosen option in a revision resets that row to `Author`; approval of the spec as a whole does not mark it `Human`.
- If no Author rows exist, or the spec has no section, QA writes `None.` in done.md and adds nothing to the PR body.
- A template override that omits the section remains uncovered by the template, while the review prompt still checks calls meeting B.

## Blockers

- None.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-9 | `node --test --import ./tests/md-loader-register.mjs --import tsx tests/run-task-prompts.test.ts` | `972e468ca4c8dd4e5c0065183deabe4108ce3fc9` | The test reported `.canon/templates/spec.md`: missing canonical definition D. After implementation, temporarily removing D from `src/orchestrator/prompts/templates/spec-revision.md` failed with the expected carrier-specific assertion. | Restoring D made the targeted parity test pass; the full golden-update test run passed. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Completed with exit code 0. |
| `npm run type-check` | Pass | Completed with exit code 0. |
| `npm test` (`UPDATE_GOLDENS=1`) | Pass | Full suite: 2,067 passed, 1 skipped, 0 failed. The skipped linked-worktree test reports `.git/` writes are restricted in this sandbox. Golden-key comparison matched exactly the seven AC-12 keys. |
| `npm run build` | Pass | Rebuilt `dist/orchestrator/run-task.js`; build completed successfully. |
| `npm run sync-templates:check` | Pass | All canon-managed files are in sync. |
| `npm run docs-refs-check` | Pass | All refs passed after the handoff was written. |
| Canonical-text targeted test with D restored | Pass | The focused `judgment-call guidance stays aligned across spec surfaces` test passed. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

## Iteration 2 — addressing review round 1

### Findings Addressed

- Fixed the unclosed inline-code span around `None — <reason>` in the `promptSpec` self-check (review round 1 correctness bug).
- Clarified revision behavior: a row keeps its `Decided by` value when the chosen option is unchanged, and changing the option resets it to `Author`.
- Strengthened rendered-prompt assertions for the spec self-check, revision prompt's D guidance, and QA's `Judgment Calls to Confirm` heading.

### Changes

| File | What Changed |
|---|---|
| `src/orchestrator/prompts/index.ts` | Closed the `None — <reason>` inline-code span in the self-check. |
| `src/orchestrator/prompts/templates/spec-revision.md` | Made the unchanged-choice `Decided by` preservation rule explicit. |
| `tests/run-task-prompts.test.ts` | Added rendered-prompt assertions for the self-check code span, revision D guidance, and QA heading. |
| `tests/run-task-prompts.golden.json` | Regenerated prompt snapshots; the changed keys remain exactly `promptSpec`, `promptSpec_withDocsMap`, `promptSpecRevision`, `promptSpecRevision_withDocsMap`, `promptSpecReview`, `promptQa`, and `promptQa_withTemplate`. |
| `dist/orchestrator/run-task.js` | Rebuilt the bundled prompt output. |

### AC Deltas

- AC-2: corrected the self-check item's malformed inline-code span.
- AC-3: revision guidance now says unchanged choices retain their `Decided by` value; changed choices reset to `Author`.
- AC-8: the rendered QA prompt is asserted to include `## Judgment Calls to Confirm`.
- AC-9: rendered-prompt assertions now cover the closed self-check code span and D in `promptSpecRevision`.
- AC-12: golden comparison against `972e468ca4c8dd4e5c0065183deabe4108ce3fc9` still reports exactly the seven specified keys.

### Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| Focused judgment-call prompt test | Pass | `node --test --test-name-pattern='judgment-call guidance stays aligned across spec surfaces' --import ./tests/md-loader-register.mjs --import tsx tests/run-task-prompts.test.ts` passed. |
| `npm run lint` | Pass | Exit code 0. |
| `npm run type-check` | Pass | Exit code 0. |
| `UPDATE_GOLDENS=1 npm test` | Pass | Full suite: 2,067 passed, 1 skipped, 0 failed; the skipped linked-worktree test reports `.git/` writes are restricted in this sandbox. |
| `npm run build` | Pass | Rebuilt `dist/orchestrator/run-task.js` successfully. |
| `npm run docs-refs-check` | Pass | All refs passed after the iteration record was appended. |

### Blockers

- None.
