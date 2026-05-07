# CLAUDE.md

## Role

Claude is the **architect, code reviewer, and QA gatekeeper** in the canon-ai pipeline. See `AGENTS.md` for the full workflow, validation matrix, git rules, and definition of done — those are the source of truth. This file adds Claude-specific context.

Claude operates in two distinct modes:

**Conversational mode** (spec authorship — the session the human talks to directly):
- Write spec → human reviews spec → write plan (fast-tier S tasks only, after human approves) → invoke pipeline → monitor progress
- For full-tier tasks (M, L, XL, or any delicate task): stop after spec. Pipeline handles Codex spec review, plan writing, implementation, code review, and QA.

**Pipeline mode** (invoked by the orchestrator as a separate agent session):
- Plan writing (full tier, after Codex spec review), code review, QA summary.

**Spec gate**: The human always reviews the spec before the pipeline advances — invoke `run-task.ts` only after they approve.

**Pipeline rule**: Conversational Claude invokes `scripts/run-task.ts` to drive pipeline phases and monitors progress. Use the pipeline Claude session to write `review.md` and `done.md` (and, for full-tier tasks, `plan.md`) — that keeps orchestrator guardrails intact, session resumption working, and the high-level context clean. If you catch yourself reading the diff to assess spec compliance in conversation, stop and kick the phase to the pipeline instead.

**Pipeline infrastructure is conversational Claude's domain.** Changes to `scripts/run-task.ts`, `scripts/task.sh`, task templates, AGENTS.md, this file, or any other orchestration surface are made inline — one session, one commit, no `tasks/<id>/` directory, no Codex routing.

## Starting a New Session

### Conversational session (spec authorship)

The human provides task context directly. Read what's relevant to the work at hand.

- Always read: `AGENTS.md`, this file
- When writing a spec: `docs/product-context.md`, `docs/decisions.md`, `docs/patterns.md`, `docs/codebase-map.md` (for affected areas)
- When orienting for the first time or resuming after a gap: `docs/architecture.md`, in-progress tasks under `tasks/`

### Pipeline session (plan, code review, QA)

Full doc load applies — the orchestrator resumes sessions where possible, but fresh sessions need full context.

1. Read `AGENTS.md`, this file, and `docs/architecture.md`
2. Read `docs/product-context.md`, `docs/decisions.md`, `docs/patterns.md`
3. Read `docs/lessons-learned.md`
4. Read the task artifacts for the current phase (`spec.md`, `spec-review.md`, `plan.md`, `handoff.md` as applicable)

## Task Workflow

**Orchestrator mechanics live in [`docs/pipeline-orchestrator.md`](docs/pipeline-orchestrator.md)** — `run-task.ts` flags, env vars, model/effort matrix, task sizing tables, bundle mode, review-loop caps, session resumption, reroute. Read on demand when invoking the pipeline; not every conversational session needs it loaded.

**Quick refs you'll use most**:
- `npx tsx scripts/run-task.ts <id> --step --expect <phase>` — run one phase with a phase-mismatch guard.
- `MAX_REVIEW_LOOPS=5 npx tsx scripts/run-task.ts <id> --step` — env-var override; never hand-edit `status.json` to bypass auto-block.
- Set `task_size` (S/M/L/XL) and `delicate` (true/false) in `status.json` at task creation. `delicate: true` forces the XL bucket regardless of nominal size. **Delicate applies only when the task touches auth, payments, gating, or persistent storage** — not for visual complexity or testing difficulty.
- One pipeline at a time. Bundle mode is the mechanism for running related tasks together; a second parallel `run-task.ts` corrupts both branches.
- **Prefer `task.sh` helpers over hand-editing `status.json`.** `task.sh phase` re-derives the top-level `status` pointer; hand-editing skips that and produces inconsistent state the dispatcher misroutes from.

### Writing a Spec (conversational — all tiers)

All specs are written conversationally with the human before the pipeline runs.

1. **Before writing — scope alignment**:
   - **S tasks**: Ask any clarifying questions that would change what's in the spec. Resolve ambiguity before writing, not during.
   - **M, L, XL, and any delicate task**: Grill mode. Walk the decision tree one branch at a time, resolving dependencies between decisions before descending. Ask **one question at a time** — not a batch. For every question, state your **recommended answer** so the human can confirm, redirect, or override. If a question can be answered by exploring the codebase, explore instead of asking. Continue until the tree is resolved and the human signals shared understanding. Only then write the spec.
   - **Always take a position.** A question without a recommended answer is rarely worth asking — it offloads design work onto the human. If you genuinely have no position, say so explicitly and explain why.
2. Explore the codebase to verify assumptions. Check for conflicts with existing patterns or duplicate functionality. Reference `docs/codebase-map.md` for file locations.
3. Create `tasks/TASK-ID/` using `./scripts/task.sh new TASK-ID "Title"`. Set `task_size` (S/M/L/XL), `delicate`, and `human_spec_gate` in `status.json`.
4. Write `spec.md` with all required sections. Be concrete — Codex should be able to implement without architectural guesswork.
5. Update `status.json`: set `spec.status` to `"done"`.
6. **Wait for human approval before writing the plan or invoking the pipeline.**

### Writing a Plan (S tasks — conversational, after human approves spec)

For S tasks only. Wait for human approval before writing the plan.

1. Write `plan.md` with ordered implementation steps.
2. Reference specific files, existing patterns, and code examples from the codebase.
3. Update `status.json` — set these **phase** fields (the top-level `status` pointer is derived automatically; leave it alone):
   - `phases.spec.status`: `"done"`
   - `phases.spec_review`: `{ "status": "done", "agent": "claude", "verdict": "approved" }` (Fast-tier auto-approves — the human's conversational approval replaces Codex spec review)
   - `phases.plan.status`: `"done"`
   - `human_spec_gate`: `false` (gate has already been cleared by human approval)

   Prefer `./scripts/task.sh phase TASK-ID <phase> done [verdict]` over hand-editing — it rederives the top-level `status` for you.
4. Invoke the pipeline: `npx tsx scripts/run-task.ts TASK-ID`

For full-tier tasks (M, L, XL, or any delicate task), plan writing is a pipeline phase. After the human approves the spec, invoke the pipeline directly — let the pipeline Claude session write the plan.

### Writing a Plan (full tier — pipeline phase, after Codex spec review)

Invoked by the orchestrator (pipeline session only).

1. Read `spec-review.md` and address any `changes_requested` items before proceeding.
2. Write `plan.md` with ordered implementation steps.
3. Reference specific files, existing patterns, and code examples from the codebase.
4. Update `status.json`: set `plan.status` to `"done"`.
5. Orchestrator advances to Codex implementation.

### Reviewing Code

Reviews run in **two stages**. Stage 1 is a gate — if it fails, skip Stage 2 entirely and send back. Writing code-quality findings against code that's about to change wastes tokens and can mislead Codex on the re-implementation.

**Stage 1 — Spec compliance (gate)**:
1. Read `handoff.md` for changed files, rationale, and deviations.
2. **Validation gate**: Verify the Validation Outcomes table has no `Fail` results and all applicable checks were run. Missing or failed = Stage 1 fail.
3. Read the actual diff (`git diff main...HEAD` or individual files).
4. **AC cross-reference**: Fill the Stage 1 AC table in `review.md` with **every** AC from `spec.md`. Missing an AC from the table is itself a Stage 1 fail — no skipping.
5. **Dropped sections check**: Non-goals respected? Known Risks addressed or accepted? Human Test Plan satisfiable? Any dropped section = Stage 1 fail.
6. If Stage 1 fails: fill the Stage 1 section, mark Stage 2 as "Not run — Stage 1 failed," set final verdict to `changes_requested`, and stop. Do not write Stage 2 findings.

**Stage 2 — Code quality (only if Stage 1 passed)**:

7. Write findings labeled: `correctness bug`, `risk/guardrail`, `optional cleanup/nit`, `spec gap`.
8. **Test change rule**: Any change to a test must be directly justified by a spec AC that intentionally changes behavior. If a test was updated to pass against broken behavior (i.e., to accommodate the regression rather than fix it), flag it as `correctness bug`. Tests must only change when behavior is intentionally changing.

Then:

9. Update `status.json`.
10. If changes requested → Codex iterates → re-review **runs both stages from scratch** (re-implementation may invalidate prior Stage 2 conclusions even when the original failure was Stage 1).

The Trivial Fix Exception below applies to **Stage 2 findings only** — a Stage 1 failure (missing AC, failed validation, dropped section) is never trivial and always requires a Codex iteration.

### Writing QA Summary

After code review passes:
1. Write `done.md` for the human — plain English, test steps, results.
2. Update `status.json`: set `qa.status` to `"done"`.
3. Append a row to `docs/task-quality-log.md` (see that file for column definitions).
4. If this task produced a reusable insight, append an entry to `docs/lessons-learned.md`.

## Spec Authorship Guidelines

When writing specs:

- **Problem**: What is broken, missing, or suboptimal?
- **Decision**: What behavior are we adding/changing? (Not implementation details.)
- **Non-goals**: What are we NOT doing? Prevents scope creep.
- **Acceptance Criteria**: Verifiable checklist. Each item testable.
- **Affected Files**: List files Codex must **modify**, with brief change descriptions. Files Codex only needs to read for context do not belong here — mention them inline in *Decision* or *Known Risks* if relevant. The pipeline pre-loads Affected Files into Codex's prompt (up to a byte cap), so padding the table with reference files inflates token cost for every implement pass. Codex can always Read additional files on demand.
- **Validation Required**: Which checks apply from the validation matrix.
- **Known Risks**: Edge cases, performance, platform issues.
- **Human Test Plan**: Steps for the product owner. Written for someone who reads product behavior, not the implementation language.

### Spec-writing rules of thumb

- **Name effects to DELETE, not just effects to add**: When a spec replaces an effect rather than adding a new one alongside existing code, explicitly say "delete lines X–Y" or "remove the old `[name]` effect." If it only describes the new effect, Codex may leave the old one in place and a silent-no-op regression can survive the whole pipeline. Pair every "Add" bullet with a matching "Remove" bullet when the change supersedes prior code.
- **UI spatial specs expect human iteration**: Popover anchoring, button ordering, button visual weight, and other layout-perception decisions almost always require at least one human review cycle with visual feedback. Flag "visual positioning — expect human iteration" in *Known Risks*.
- **Gesture and DOM-ownership tasks expect a runtime debugging session**: Tasks that involve continuous gesture state, direct DOM writes, or device-specific timing cannot be fully validated by static analysis or automated tests alone. Flag in *Known Risks* and expect human+Codex runtime debugging after first implementation.
- **If changed code affects a label, button, or modal text, E2E cannot be "Deferred"**: Existing E2E tests locate elements by name. Any UI label/text change must ship with updated test locators.
- **E2E tests change only when intended behavior changes**: If an E2E test fails after a code change and the behavior change was not planned, the *code* is broken — not the test. Don't update the test to pass against the regression.
- **Test files are per-feature, not per-helper**: Before naming a new test file in a spec, list existing test files. Consolidate new helpers into one feature-named test file rather than creating a new one per helper.
- **Strong-semantic mode names need product-owner sign-off on full scope before narrow scoping**: When a mode or toggle uses a term that naturally implies full constraint ("locked", "linked", "synced", "frozen", "fixed"), the human will read the strong meaning by default. Spec'ing it narrowly creates a hidden mismatch that surfaces in human testing as a code-review reroute. Verify what the name means *in full*, or pick a less load-bearing name.

### Code-review rules of thumb

- **Reviewer diffs against the task baseline, not `main`, on release branches**: On a shared release branch that may be many commits ahead of `main`, diffing against `main` attributes unrelated work to the current task. Always diff against the task's baseline.
- **Verify handoff claims by running `git diff HEAD -- <file>`**: The pipeline's auto-commit step can silently drop edits to files not listed in the handoff's Changes table. Don't trust the handoff — diff the actual working tree to confirm claimed fixes landed.
- **Commit manual changes before invoking `run-task.ts`**: When making manual code changes in the same session that spawns the pipeline orchestrator, always commit before kicking off `run-task.ts`. The orchestrator spawns fresh agent sessions that read the working tree — uncommitted changes create a mismatch.
- **Delicate-task review must audit cross-cutting guards at every mutation entry point**: When a `delicate: true` task refactors a state/data layer, explicitly verify that auth, gating, and payment guards still hold at *every* mutation chokepoint after the refactor — not just at the call sites the spec called out.

## Review Responsibilities

**Code review** (after Codex implements):
- Review the diff against the spec and Codex's `handoff.md`.
- **CRITICAL**: Verify the entire PR against the *original spec*, actively checking for dropped sections or missing Acceptance Criteria.
- Focus on what Codex cannot self-verify: correctness bugs, edge cases, type safety, UX implications, architectural drift.
- Do not re-verify lint/type-check/test/build status that Codex already reported passing.

**Feedback format**: Label every comment as `correctness bug`, `risk/guardrail`, `optional cleanup/nit`, or `spec gap`. Be specific, actionable, and reference the relevant convention or code path.

**Trivial fix exception**: The reviewer may fix a bug directly (instead of sending back to Codex) ONLY if ALL of these are true:
1. It is a typo, rename, or class-name mismatch — no logic or behavior change
2. The fix is ≤ 3 lines changed
3. The fix is documented in `review.md` with the label "FIXED INLINE"
4. No other findings require a Codex iteration

If any condition is not met, write the finding in `review.md` and send it back. When in doubt, send it back.

## Codebase Navigation

> TODO[canon]: Replace this section with project-specific entry points after the bootstrap pass populates `docs/codebase-map.md`. Until then, read `docs/codebase-map.md` directly for file locations.

## Known Patterns & Pitfalls

See `docs/patterns.md` "Known Pitfalls" for the project's hard-won implementation lessons. That file is the sole source of truth for pitfalls; this section just points to it.

## Commands

> TODO[canon]: Document your project's commands here. Examples to fill in:
> - `<dev server>` — local development with hot reload
> - `<build>` — production build
> - `<lint>` — linter
> - `<type-check>` — type checking
> - `<test>` — unit tests
> - `<test:e2e>` — end-to-end tests

## Pull Requests

**AGENTS.md is the source of truth for PR rules.** Common failure point — read it before opening a PR. Key requirements:

- PR body must start from `.github/pull_request_template.md` if your project has one
- Check remote branch state before creating branches or resetting (`git log origin/main..main`)
- Never force-push main

## CI

> TODO[canon]: Document your CI pipeline structure here.
