# Implementation Handoff: claude-55-calibration

> Author: Codex | Spec: `tasks/claude-55-calibration/spec.md` | Plan: `tasks/claude-55-calibration/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/prompts/helpers.ts` | Added the unattended Claude contract without changing shared startup text. |
| `src/orchestrator/agents/claude.ts` | Prepends that contract on every unattended attempt, including resume and fallback. |
| `src/orchestrator/prompts/templates/code-review-foreman.md` | Distinguishes valid clean results from missing lens returns, limits delegation, and orders a no-verdict stop after a second missing return. |
| `src/orchestrator/main.ts` | Stops reviewer-set code-review blocks before evidence recovery, escalates the entire bundle, and prints reset instructions. |
| `src/orchestrator/prompts/templates/plan.md` | Inserts the shared feasibility instruction in normal planning. |
| `src/orchestrator/prompts/templates/plan-reroute.md` | Inserts the feasibility instruction in reroute-only shared steps and Delta example. |
| `src/orchestrator/prompts/index.ts` | Renders the feasibility check across the specified plan paths and code-review blocked commands. |
| `.claude/agents/code-review-anchored.md`, `templates/.claude/agents/code-review-anchored.md` | Added a clean Stage 2 return form and direct-review delegation bound; synchronized adopter mirror. |
| `.claude/agents/code-review-cold.md`, `templates/.claude/agents/code-review-cold.md` | Added direct-review delegation bound; synchronized adopter mirror. |
| `tests/run-task-prompts.test.ts` | Covers clean/missing foreman rules, delegation, preamble content isolation, planning paths, and bundle commands. |
| `tests/run-task-code-review.test.ts` | Covers reviewer stops, bundle escalation/reset, unchanged recovery, and fake-Claude invocation modes. |
| `tests/run-task-prompts.golden.json` | Regenerated the seven intended prompt snapshots. |
| `docs/decisions.md` | Recorded the calibration audit and plan-quality evidence; repaired a dangling reference already present in the decision record. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Documented blocked-review routing and recovery; synchronized adopter mirror. |
| `dist/orchestrator/run-task.js` | Rebuilt the published orchestrator bundle. |

## Canon Governance

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

The foreman now treats charter-form clean returns as valid and gives a genuinely missing lens one retry. If it is still missing, a written review and reviewer-set `blocked` state stop the run before verdict recovery can pressure the reviewer to invent a verdict. Unattended Claude calls receive a phase-completion contract without changing interactive startup text. Planning prompts ask for a short, evidence-based feasibility check.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Rephrased the existing missing rebaseline-task spec reference in `docs/decisions.md` as prose. | That spec file is absent in this worktree. The first full test run reached `docs-refs-check` through safety integration tests and failed on the pre-existing reference. This in-scope edit makes the required references check pass without inventing another task's file. | Supports AC-9 and its validation gate; no product behavior change. |
| Added a bundle prompt assertion and checked every member's review path in the reviewer-stop test. | The spec requires blocked commands and stop paths for every bundle member; these assertions make that explicit. | Strengthens AC-1 and AC-1b. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | All four foreman render paths reject the former quiet-output line and contain valid empty and Stage-1-fail forms, one re-spawn, no-verdict handling, and blocked commands; a bundle assertion checks both commands. See red-first evidence below. |
| AC-1b | Met | Single-task and mixed-bundle fixtures exit 2, escalate, avoid evidence recovery, and name reviews/reset commands. Reset restores implement `done` and code_review `pending`; an ordinary `in_progress` fixture still prints `Evidence insufficient`. In the same red run, the single-task case had zero escalations rather than one. |
| AC-2 | Met | Anchored return format contains `STAGE_2_FINDINGS: (none)`; cold clean form and both high-recall instructions remain. |
| AC-3 | Met | Fake-Claude tests capture fresh, resumed, fallback, and interactive argv. In the red run, the three unattended positive assertions failed because `CLAUDE_HEADLESS` was absent; the interactive negative case passed. |
| AC-4 | Met | Token assertions cover each contract element and check those tokens are absent from `CLAUDE_STARTUP`. |
| AC-5 | Met | Foreman limits reviewers to its two lenses plus one re-spawn, charters forbid further delegation, and unattended contract forbids unrequested review work. |
| AC-6 | Met | Normal plan render contains existence/search, runtime path, callers, failing-test input, predicate boundaries, scope, async/stateful checks, N/A, and contradiction handling. |
| AC-7 | Met | Normal single/bundle planning, reroute shared steps, and fast-tier single/bundle combined planning render the check; full-tier spec remains unchanged. Exempt sibling verdict lines contain no check. |
| AC-8 | Met | Goldens changed only `promptPlan`, `promptCodeReview_round1`, `promptCodeReview_roundN`, `promptPlan_reroute_round1`, `promptPlan_reroute_bundle`, `promptCodeReview_deltaRound`, and `promptCodeReview_fullSendOutOfScope`; build and mirrors pass. |
| AC-9 | Met | New decision entry records the audit, three calibration changes, preamble placement rule, and separate observational plan-quality paragraph. Docs references pass. |
| AC-10 | Met | The Phase Routing table row was found at line 380 by the specified grep; template sync check passes. See command output below. |

### Red-first evidence

Before the implementation changes, this scoped command exited 1:

```sh
node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='code-review foreman distinguishes|reviewer-set code_review blocked|runClaude headless preamble' tests/run-task-prompts.test.ts tests/run-task-code-review.test.ts
```

The foreman test first failed because the rendered prompt still contained `quiet lens output is a bug`. The blocked-review fixture recorded zero escalations instead of one. Fresh, resumed, and fallback fake-Claude tests failed because the headless constant was absent; the interactive negative case passed.

The AC-10 check returned:

```text
380:| `code_review` | reviewer-set `blocked` (no verdict) | Block the whole `code_review` bundle with an escalation and exit `2`; no evidence recovery or retry is attempted. The stop names each task's `review.md`. Recovery: `canon task reset-code-review <id>` for each task, then `canon run <ids>`. |
```

Prompt-text assertions prove the instructions are present in rendered prompts; they do not establish how a model will behave in a live review.

## Edge Cases Considered

- A no-verdict `blocked` review stops only after its written `review.md` survives the existing post-foreman template reset.
- A mixed bundle blocks all members and names every review file and reset command.
- Ordinary incomplete code review continues through evidence recovery; interactive Claude never receives the unattended contract.
- A missing resumed Claude session falls back to a fresh call with the same contract.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final source and tests. |
| `npm run type-check` | Pass | Final source and tests. |
| `npm test` | Pass | Final run: 1333 tests, 1332 passed, 0 failed, 1 skipped. |
| `npm run build` | Pass | Rebuilt `dist/orchestrator/run-task.js` after the final routing edit. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync after `npm run sync-templates`. |
| `npm run docs-refs-check` | Pass | All references valid after repairing the pre-existing dangling reference. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
