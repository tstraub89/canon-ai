# QA Summary: claude-55-calibration

## Summary

This task re-calibrates canon's Claude-facing pipeline prompts for the 5.5 model generation, mirroring the audit already done on the Codex side. It fixes a contradiction where the code-review foreman was told a quiet lens return is always a bug (a literal model would flag legitimate clean reviews as failures); gives unattended Claude phases an explicit "nobody is watching" contract so a phase doesn't end early on a progress summary; bounds the code-review foreman's delegation so it can't spawn extra reviewers or substitute its own judgment; and adds a proportional feasibility check to the planning prompts (confirm code exists, trace the real runtime path, find every caller, name what makes each new test fail, check boundary values) based on a read-only audit of 422 archived tasks showing ~40% of changes-requested findings traced back to something the plan got wrong. It also adds real routing: if a code reviewer honestly can't produce a verdict twice in a row, the whole run now stops for a human instead of being pushed toward inventing one.

## Files Changed

- `src/orchestrator/prompts/helpers.ts` — new `CLAUDE_HEADLESS` unattended-session contract
- `src/orchestrator/agents/claude.ts` — prepends the contract on every unattended call path (fresh, resumed, fallback, retry)
- `src/orchestrator/prompts/templates/code-review-foreman.md` — valid/clean/missing lens rule, `blocked` outcome, delegation bound
- `src/orchestrator/main.ts` — `checkAndRoute` stop branch for a reviewer-set code_review `blocked`
- `src/orchestrator/prompts/templates/plan.md`, `plan-reroute.md` — feasibility check instruction
- `src/orchestrator/prompts/index.ts` — feasibility check rendered across fast-tier and bundle planning paths; `blocked` command rendering for the foreman
- `.claude/agents/code-review-anchored.md`, `code-review-cold.md` (+ `templates/` mirrors) — explicit clean return forms, no-sub-agent line
- `tests/run-task-prompts.test.ts`, `tests/run-task-code-review.test.ts` — coverage for all of the above
- `tests/run-task-prompts.golden.json` — regenerated (7 affected keys only)
- `docs/decisions.md` — new decision entry recording the audit
- `docs/pipeline-orchestrator.md` (+ `templates/` mirror) — new Phase Routing row for the `blocked` stop
- `dist/orchestrator/run-task.js` — rebuilt

## How to Test

1. Run a small, clean task through the pipeline. Code review should approve without inventing findings from a quiet lens.
2. Run a task with a planted defect. Code review should still request changes for it.
3. Force one code reviewer to return nothing usable twice in a row (e.g. temporarily break a reviewer definition). The run should stop, name the review file to read, and give the reset command — not quietly retry into a fabricated verdict.
4. Watch an unattended run end to end — each Claude phase should finish by writing its artifact and advancing its own phase, not end on a summary or offer to continue, and never start another phase itself.
5. Start a run with `--interactive` — it should still be able to stop and ask a question.
6. Read a medium task's plan — it should briefly confirm the code it relies on exists, name callers, say what makes each new test fail, and flag any conflict with the spec instead of working around it.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1333 tests, 1332 passed, 0 failed, 1 skipped (pre-existing, not this task's tests) |
| `npm run build` | Pass | `dist/orchestrator/run-task.js` rebuilt |
| `npm run sync-templates:check` | Pass | |
| `npm run docs-refs-check` | Pass | |

Code review verdict: **Approved with nits** (all outstanding items are optional follow-ups, listed below).

## Human Verification Required

None.

## Decisions Made During Implementation

- Rephrased a pre-existing dangling `docs/decisions.md` reference to a sibling task's spec as prose (that file was absent from this worktree), rather than inventing the path — code review noted the file does exist at `tasks/_archive/rebaseline-claude-matrix-for-5-5/spec.md` and a link would have worked too; left as a non-blocking nit.
- Scoped the plan feasibility check out of two plan-writing surfaces (the operator-run XS path in `.claude/skills/canon-spec/SKILL.md`, and `spec-revision.md`'s combined plan-update line) — both are deliberate, spec-documented Non-Goals, not gaps found mid-implementation.
- Item 4 (plan feasibility check) rides in this otherwise model-calibration task because it edits the same prompt surfaces the calibration touches; a dedicated plan-review phase is deferred to tstraub89/canon-ai#68.

## Open Questions Needing Human Input

- Optional cleanup nits from code review, none blocking: clarify "one re-spawn" wording (per-lens vs. total) in the foreman template and Decision §3; fix the step-order contradiction in `plan-reroute.md` (feasibility step says "before writing steps" but sits after the steps step); consider linking rather than prose-repairing the `docs/decisions.md` reference; consider adding the new `blocked` stop to `.claude/skills/canon-pipeline/recovery.md`.
- Follow-up filed as a suggestion (not required for this ship): a narrow residual gap where a foreman that writes a no-verdict `review.md` but ends its turn before running `code_review blocked` can still be pushed toward a retry-driven fabricated verdict. Needs two unlikely events in a row and is outside this spec's scope, but worth a tracked issue.

## Quality Log

- Spec verdict: changes_requested (Codex's first spec_review pass found the `checkAndRoute`/`blocked` recovery gap; spec was revised and re-approved)
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Clean run through the pipeline after one spec revision; code review approved with nits, all optional follow-ups.

## Proposed Changelog

### Added

- **A reviewer-set code_review `blocked` now stops the run for a human instead of being recovered into a fabricated verdict.** If a code-review lens genuinely can't produce a usable return twice in a row, the foreman records it in `review.md` with no verdict checked and blocks the whole task (or bundle) with an escalation. The run exits with the pipeline's stop-for-human code; recovery is `canon task reset-code-review <id>` then `canon run <id>`. Previously, any non-`done` code_review status — including an agent's own `blocked` — was treated as an unfinished phase and pushed toward a Claude retry that demanded a verdict.
- **Plans now include a short feasibility check.** Before writing implementation steps, the plan confirms the code it relies on exists (found by searching, not recalled), traces the actual runtime path, names every caller whose contract changes, states what input makes each new regression test fail without the fix, and checks boundary values for any condition the plan writes out. Elements that don't apply are marked N/A; a conflict with the spec is recorded rather than worked around by widening scope.

### Changed

- **The code-review foreman no longer treats a clean lens return as a bug.** It previously said "a quiet lens output is a bug in the lens, not a clean diff," which could lead a literal model to flag a legitimate clean review as a failure. The foreman now distinguishes a valid clean return (the lens's own empty form) from a genuinely missing one, and re-spawns a missing lens once before recording the stop above.
- **Unattended Claude phases now receive an explicit unattended-session contract**, the Claude counterpart to Codex's existing headless preamble: nobody will answer questions mid-phase, ambiguity gets recorded and the phase proceeds, a phase is only complete once its artifact is written and its phase command has run, and it must not start other phases, review passes, or reviewer sub-agents on its own. Interactive sessions are unaffected.
- **The code-review foreman's delegation is bounded.** It spawns exactly its two Claude lenses per round, plus at most one re-spawn of a lens with a missing return — it can no longer substitute its own review or spawn additional reviewers.
