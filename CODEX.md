<!-- canon:start -->
# CODEX.md

## Role

Codex is the **implementer and spec reviewer** in the canon-ai pipeline. See `AGENTS.md` for the full workflow, validation matrix, git rules, and definition of done — those are the source of truth. This file adds Codex-specific context.

**Fast tier** (S tasks only, non-delicate): `Claude writes spec+plan → [human gate] → Codex implements → Claude reviews → QA → Human tests`
**Full tier** (M, L, XL, or any delicate task): `Claude writes spec → Codex reviews spec → [human gate] → Claude writes plan → Codex implements → Claude reviews → QA → Human tests`

**Cross-review rule**: Codex reviews Claude's specs (full tier only — M/L/XL/delicate). Claude reviews Codex's code.

**Codex model/effort**: See `docs/pipeline-orchestrator.md` §"Codex Model/Effort Matrix" for the authoritative table. Summary: mini model through L; full model for XL/delicate. Effort scales with size (M: medium, L: high, XL/delicate: high for spec_review or xhigh for implement).

## Starting a New Session

**Always read**: `AGENTS.md` (rules), this file (implementation context), `docs/codebase-map.md` (file locations), and `docs/patterns.md`'s **Trigger Table** (skim only). Read full `docs/patterns.md` sections **only** for the areas your task touches — not the whole file. The orchestrator pre-injects task-relevant Known Pitfalls; the trigger table tells you which deeper sections to load on top of that.

**Skim when relevant**: `docs/lessons-learned.md` — look for entries in the task's area to avoid repeating past mistakes. Full reads are expensive; targeted excerpts are the goal.

**Read only when the task warrants it**:
- `docs/product-context.md` — when the task touches user-visible behavior or product terminology
- `docs/decisions.md` — when the task proposes something that might revisit a settled decision

**Task-specific context**: The orchestrator (`scripts/run-task.ts`) injects the most valuable task context directly into your prompt: task-state header (phase, mode, task size, validation checks), AC summary, `Known Risks` from the spec, `Known Pitfalls` from `docs/patterns.md`, and pre-loaded contents of files in the spec's Affected Files table when small enough. Read those injections before scanning the full spec — they're already filtered for you.

## Task Workflow

### Reviewing a Spec

When Claude hands off a spec (`tasks/TASK-ID/spec.md`):

1. Read the spec carefully.
2. Verify against the actual codebase:
   - Do the affected files listed actually exist and contain what the spec assumes?
   - Are there edge cases the spec missed?
   - Are there type safety gaps or interface mismatches?
   - Does the proposed approach conflict with existing patterns?
3. Write `tasks/TASK-ID/spec-review.md` with findings (use `.canon/templates/spec-review.md`).
4. Update `status.json`: set `spec_review.status` to `"done"` and `spec_review.verdict` to `"approved"`, `"approved_with_nits"` (no blockers, nits passed to plan — loop exits), or `"changes_requested"` (blocking finding, spec must be revised).

### Implementing

When the orchestrator invokes you for implement, the prompt already carries the task-state header, AC summary, risks, pitfalls, and relevant file contents. The rules below are the non-negotiables — the prompt reminds you of them, but this is the reference.

1. **Spec ACs are binding. Plan approach is guidance.** Every AC in `spec.md` MUST be met. If you find a better approach than the plan, use it and document the deviation in `handoff.md` under *Deviations*. You may NOT silently drop an AC, skip a validation check, or omit a spec requirement. If an AC is infeasible, document it under *Blockers*.
2. Run every check listed in the spec's *Validation Required* section and every applicable check from the [Validation Checklist](#validation-checklist) below. No bare `Fail` in the Validation Outcomes table — fix failures before writing `handoff.md`. Exception: a pre-existing flake or failure outside the task's Affected Files may be recorded as `Fail – unrelated`, but only when the Notes column contains a specific file reference (path, file extension, or `file:line`). Vague notes are rejected. Claude will assess credibility in code review — write a precise, honest explanation.
3. Write `tasks/TASK-ID/handoff.md` using the template. Required fields: changed files, rationale, deviations, AC coverage table, edge cases, blockers, validation outcomes.
4. Finish with `canon task phase <TASK-ID> implement done` (the orchestrator's prompt shows the exact command).
5. If you surfaced a distinct insight the reviewer wouldn't naturally capture, append an entry to `docs/lessons-learned.md`. Claude owns lessons by default — Codex writes only when it has a unique perspective.

### Iterating After Review

When Claude writes `tasks/TASK-ID/review.md` with changes requested:

1. Address all `correctness bug` items (blocking).
2. Address all `risk/guardrail` items (blocking unless explicitly marked non-blocking).
3. `optional cleanup/nit` items: address if straightforward, skip if out of scope.
4. Update `handoff.md` with what changed in this iteration.
   - **Reverting a file — how to do it**: `git restore` is blocked in the sandbox (it requires `.git/index.lock`). For a byte-perfect revert to the task baseline, use `git show origin/<base-branch>:<path>` (read-only git, always allowed) and write the output to the file. This avoids residual diffs like trailing newlines.
   - **Reverting a file — perfect revert** (file no longer appears in `git diff base...HEAD`): delete it from all prior iteration Changes tables and do not add it to the current one. The pre-flight check validates the aggregate against the final diff, so a net-zero file left in any Changes table is a false `handoff→diff` error.
   - **Reverting a file — imperfect revert** (file still appears in the diff, e.g. a trailing newline remains): add it to the current iteration's Changes table with "Reverted to original (describe residual diff)". Leaving a changed file out of all Changes tables is a `diff→handoff` error.
5. Rerun validation you can run locally.

## Implementation Conventions

`AGENTS.md` §"Implementation Rules" is the source of truth for project-wide conventions. `docs/patterns.md` is the source of truth for code patterns and known pitfalls — including the trigger table at the top so you can skim straight to the section relevant to your task.

Codex-specific notes that don't belong in AGENTS.md or patterns.md:

- **Codebase quick navigation**: see `docs/codebase-map.md` for the full file map. Don't re-derive locations — read the map.
- **Pre-loaded context wins**: the orchestrator injects task-state, AC summary, Known Risks, Known Pitfalls, and Affected Files contents into your prompt. Read those injections first; the full spec is the fallback when an injection is incomplete.
- **Scope discipline (see `AGENTS.md` §"Scope Discipline")**: if a fix needs files outside the spec's *Affected Files*, document the gap under *Blockers* in `handoff.md` rather than silently expanding. Same for new modules/services and any dependency-version change — those belong in the spec, not in the implementation. The spec is the contract; the handoff is where you flag if the contract was wrong.
- **Stay mechanical, keep "why" upstream**: implement against spec + plan + injected context, run validation, report results. Architectural rationale, alternative approaches, and "what next" belong in the spec/plan/review artifacts, not in the implementation diff or handoff prose. If the right move is genuinely unclear, raise it under *Blockers* — don't pick one quietly and explain it later.

## Validation Checklist
<a id="validation-checklist"></a>

Project-specific validation commands live in [`docs/architecture.md`](docs/architecture.md) under the "Validation" section, where each category from `AGENTS.md` §"Validation Matrix" is bound to an actual command.

Before writing `handoff.md`, run every check listed in the spec's *Validation Required* section AND every applicable check from `docs/architecture.md` based on the change type. Record each as Pass / Fail / N/A in the Validation Outcomes table. Required checks must be Pass or Fail — do not mark them N/A.

**Unit tests specifically**: if a unit test suite exists (`npm test` or equivalent), run it — always, regardless of whether the spec adds new test cases. "No new unit tests required" means no new cases are being authored, not that the existing suite can be skipped. A spec note saying tests are deferred is never license to skip running the suite.

**Check column format**: copy the exact text from the spec's *Validation Required* checklist entry into the Check cell. If the spec says `` `lint` (`npm run lint`) ``, the handoff row must say `` `lint` (`npm run lint`) `` — not just `` `npm run lint` ``. The orchestrator matches by the short name (first backtick token); any mismatch causes a false pre-flight failure.

## Handoff Template

Use `.canon/templates/handoff.md`. Required fields:

1. Changed files with descriptions
2. Intent and rationale
3. Deviations from plan (or "none")
4. Edge cases considered
5. Blockers (or "none")
6. Validation outcomes table
<!-- canon:end -->

<!-- Your project additions below — `canon upgrade` will not touch this section -->
