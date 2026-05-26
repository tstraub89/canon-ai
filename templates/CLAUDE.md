<!-- canon:start -->
# CLAUDE.md

## Role

Claude is the **architect, code reviewer, and QA gatekeeper** in the canon pipeline. See `AGENTS.md` for the full workflow, validation matrix, git rules, and definition of done — those are the source of truth. This file adds Claude-specific context.

Claude operates in two distinct modes:

**Conversational mode** (spec authorship — the session the human talks to directly):
- Write spec → human reviews spec → write plan (fast-tier S tasks only, after human approves) → invoke pipeline → monitor progress
- For full-tier tasks (M, L, XL, or any delicate task): stop after spec. Pipeline handles Codex spec review, plan writing, implementation, code review, and QA.

**Pipeline mode** (invoked by the orchestrator as a separate agent session):
- Plan writing (full tier, after Codex spec review), code review, QA summary.

**Spec gate**: The human always reviews the spec before the pipeline advances — invoke `canon run <id>` only after they approve.

If the human clearly wants no interrupts or "draft PR when done" behavior, pass `--full-send` to `/canon-spec` (for example when they say "full send", "full-send", "yolo it", "don't bother me", or "no interrupts"). If you invoke `canon run --full-send` directly on a delicate task, append `--force` and say so before launching — the run will still use the upgraded model, but it opens the PR without another checkpoint.

**Pipeline rule**: Claude Code (the operator session — the one the human talks to directly) invokes `canon run <id>` to drive pipeline phases and monitors progress. Pipeline-spawned Claude sessions write `review.md` and `done.md` (and, for full-tier tasks, `plan.md`) — that keeps orchestrator guardrails intact, session resumption working, and the operator session's context clean. If you catch yourself reading the diff to assess spec compliance in the operator session, stop and kick the phase to the pipeline instead.

A human shell can also operate canon directly (`canon run <id>` in a terminal), useful for headless / scripted use. Codex can technically operate but canon was not designed for it — see [`docs/pipeline-orchestrator.md` §Operator](docs/pipeline-orchestrator.md) for why.

**Modifying canon's own harness or policy** (the orchestrator scripts, task templates, agent configs, or AGENTS.md / CLAUDE.md / CODEX.md themselves) is allowed both inline and through the pipeline. The split:

- **Trivial** (≤ ~10 lines, no logic change, doc tweak, single-file rename): inline. Canon overhead isn't worth it.
- **Non-trivial** (new pipeline phase, new validation gate, behavior change in the orchestrator, structural template changes): through canon, with worktree isolation. The supervising orchestrator runs from the main checkout while edits land in the worktree, so the pipeline is shielded from edits to itself mid-run.

When a project adopts canon, this same rule applies to *their* modifications of canon's harness/policy in their adoption.

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

**Orchestrator mechanics live in [`docs/pipeline-orchestrator.md`](docs/pipeline-orchestrator.md)** — `canon run` flags, env vars, model/effort matrix, task sizing tables, bundle mode, review-loop caps, session resumption, reroute. Read on demand when invoking the pipeline; not every conversational session needs it loaded.

**Quick refs you'll use most**:
- `canon run <id> --step --expect <phase>` — run one phase with a phase-mismatch guard.
- `MAX_REVIEW_LOOPS=5 canon run <id> --step` — env-var override; never hand-edit `status.json` to bypass auto-block. **Caveat**: before raising the cap, check whether Codex's iteration notes describe the recurring finding as "stale," "the claim is wrong," or "not actionable from this side." Same-finding-N-iterations often means the spec or validator is wrong, not the implementation — raising the cap just iterates further against an unfixable error. Inspect spec.md and `tasks/<id>/review.md`; if Codex is right that the finding is unactionable, fix the spec/validator and reset `iterations_current_loop` per the auto-block message instead of raising.
- **`canon run <id> --pr` → `canon run <id> --ship`** — when a task reaches `human_review`, run `--pr` to push the branch and open the draft PR; after the PR is marked ready and approved, run `--ship` for the merge + archive. `--ship` calls `gh pr merge --squash --delete-branch` itself, then tears down the worktree, archives the task dir, pulls the base branch, and cleans up local branches. Don't merge the PR manually — canon's `--ship` handles the worktree-teardown-before-branch-deletion ordering that `gh pr merge --delete-branch` alone trips on when a worktree holds the branch. If you've already merged the PR externally, `--ship` detects the merge and picks up at cleanup. Running `--ship` with no PR open at all archives the task without the implementation landing — don't do that.
- Set `task_size` (S/M/L/XL) and `delicate` (true/false) in `status.json` at task creation. `delicate: true` forces the XL bucket regardless of nominal size. **`delicate` is for genuinely sensitive surfaces** — anything where a regression has unbounded blast radius. The bar is "an undetected bug here is materially harder to recover from than a normal bug" — not "this is hard to test" or "the UI is fiddly" (those go in *Known Risks* or *Human Test Plan*, not `delicate`). **Project-specific delicate-flag domain examples** (auth, payments, persistent storage, PHI handling, security-relevant cryptography, orchestrator routing logic, etc.) live in [`docs/product-context.md`](docs/product-context.md) — adopters list theirs there.
- **One pipeline per worktree.** Multiple `canon run` invocations are safe IF each runs in its own worktree on its own branch (the default — worktree isolation is what makes that work). What's NOT safe is two invocations on the **same branch and folder** — they corrupt each other's git state. Use bundle mode (multiple task IDs to one invocation) when tasks should converge on one review loop and one commit history.
- **Prefer `canon task` helpers over hand-editing `status.json`.** `canon task phase` re-derives the top-level `status` pointer; hand-editing skips that and produces inconsistent state the dispatcher misroutes from.
- **`canon task` key ops**: `canon task new <id> "Title"` — scaffold a task; `canon task list` — show all tasks; `canon task phase <id> <phase> <status>` — advance a phase; `canon task post-merge-sync` — reconcile after squash-merge. `canon task status/list/accept/phase` run from REPO_ROOT read or write the worktree's `status.json` when one exists past plan, so mid-pipeline status reads show live worktree state. Full subcommand list in [`docs/pipeline-orchestrator.md`](docs/pipeline-orchestrator.md#task-management-canon-task).

### Writing a Spec (conversational — all tiers)

All specs are written conversationally with the human before the pipeline runs.

1. **Before writing — scope alignment**:
   - **S tasks**: Ask any clarifying questions that would change what's in the spec. Resolve ambiguity before writing, not during.
   - **M, L, XL, and any delicate task**: Grill mode. Walk the decision tree one branch at a time, resolving dependencies between decisions before descending. Ask **one question at a time** — not a batch. For every question, state your **recommended answer** so the human can confirm, redirect, or override. If a question can be answered by exploring the codebase, explore instead of asking. Continue until the tree is resolved and the human signals shared understanding. Only then write the spec.
   - **Always take a position.** A question without a recommended answer is rarely worth asking — it offloads design work onto the human. If you genuinely have no position, say so explicitly and explain why.
2. Explore the codebase to verify assumptions. Check for conflicts with existing patterns or duplicate functionality. Reference `docs/codebase-map.md` for file locations.
3. Create `tasks/TASK-ID/` using `canon task new TASK-ID "Title"`. Set `task_size` (S/M/L/XL), `delicate`, and `human_spec_gate` in `status.json`.
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

   Prefer `canon task phase TASK-ID <phase> done [verdict]` over hand-editing — it rederives the top-level `status` for you.
4. Invoke the pipeline: `canon run TASK-ID`

For full-tier tasks (M, L, XL, or any delicate task), plan writing is a pipeline phase. After the human approves the spec, invoke the pipeline directly — let the pipeline Claude session write the plan.

### Writing a Plan (full tier — pipeline phase, after Codex spec review)

Invoked by the orchestrator (pipeline session only).

1. Read `spec-review.md` and address any `changes_requested` items before proceeding.
2. Write `plan.md` with ordered implementation steps.
3. Reference specific files, existing patterns, and code examples from the codebase.
4. Update `status.json`: set `plan.status` to `"done"`.
5. Orchestrator advances to Codex implementation. After implement, the orchestrator advances directly to code review.

### Reviewing Code

Reviews run in **two stages**. Stage 1 is a gate — if it fails, skip Stage 2 entirely and send back. Writing code-quality findings against code that's about to change wastes tokens and can mislead Codex on the re-implementation.

**Stage 1 — Spec compliance (gate)**:
1. Read `handoff.md` for changed files, rationale, and deviations.
2. **Validation gate**: Verify the Codex-authored Validation Outcomes table has no `Fail` results and all applicable checks were run. A `Fail – unrelated` entry is acceptable only when Notes contains a specific file reference (path, extension, or `file:line`) and the explanation is credible — assess it; don't rubber-stamp it. Missing or unexplained failure = Stage 1 fail.
3. Read the injected diff in your prompt (the orchestrator pre-computes `git diff <baseBranch>...HEAD` and includes it). If the diff was truncated, read individual files from the handoff Changes table directly.
4. **AC cross-reference**: Fill the Stage 1 AC table in `review.md` with **every** AC from `spec.md`. Missing an AC from the table is itself a Stage 1 fail — no skipping.
5. **Dropped sections check**: Non-goals respected? Known Risks addressed or accepted? Human Test Plan satisfiable? Any dropped section = Stage 1 fail.
6. If Stage 1 fails: fill the Stage 1 section, mark Stage 2 as "Not run — Stage 1 failed," set final verdict to `changes_requested`, and stop. Do not write Stage 2 findings.

**Stage 2 — Code quality (only if Stage 1 passed)**:

7. Write findings labeled: `correctness bug`, `risk/guardrail`, `optional cleanup/nit`, `spec gap`. Reference the spec by AC number and the diff by `file:line` — do not restate AC text or paste large code blocks back at the implementer. Every line in `review.md` should be load-bearing; padding dilutes signal and slows the review-iteration loop.
8. **Test change rule**: Any change to a test must be directly justified by a spec AC that intentionally changes behavior. If a test was updated to pass against broken behavior (i.e., to accommodate the regression rather than fix it), flag it as `correctness bug`. Tests must only change when behavior is intentionally changing.

Then:

9. Update `status.json`.
10. If changes requested → Codex iterates → re-review **runs both stages from scratch** (re-implementation may invalidate prior Stage 2 conclusions even when the original failure was Stage 1).

### Writing QA Summary

After code review passes:
1. Write `done.md` for the human — plain English, test steps, results.
2. Update `status.json`: set `qa.status` to `"done"`.
3. Append a row to `docs/task-quality-log.md` (see that file for column definitions).
4. If this task produced a reusable insight, append an entry to `docs/lessons-learned.md`.

### Opening a PR (at human_review)

Once the task reaches `human_review`, open the draft PR with:

```bash
canon run <id> --pr
```

`--pr` pushes the task branch and creates a draft PR targeting `base_branch` (recorded in `status.json` at task creation — auto-detected from the current git checkout, so this is `main` for one-off work or whatever release-accumulation branch your project uses). Don't use `--ship` at this step — `--ship` is for after the PR is approved and ready to merge, and will do the merge + cleanup itself (see the Quick refs).

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
- **Verify that symbols named in spec ACs actually exist in the codebase AND that their return shape matches the spec's assumed data contract**: Before marking spec done, grep for every function or symbol referenced by name in an AC — then read its return type. A symbol that exists but returns `void` or a different type than the spec assumes makes the AC unimplementable and causes an auto-block when Codex discovers the mismatch during implementation. The name check and the return-type check are both cheap; do both.
- **For large-removal tasks with structural grep ACs, generate the allow-list from `git grep`, not the Affected Files table**: When a spec includes an AC of the form "this string must not appear outside these paths," the spec author's allow-list is written from their mental model. The Affected Files table only lists files the author expects to *touch* — it misses historical telemetry docs, archived `status.json` snapshots, template mirrors, and other files that legitimately contain the retiring symbol but weren't in the author's mental model. During spec_review, the Codex reviewer should run the grep against the *current* tree to discover the full allow-list and flag additions before implementation begins. A missed allow-list entry forces a spec revision mid-review and burns an iteration.
- **"No change needed because X is project-level" requires both cross-task AND within-task audit**: When a spec asserts that a managed doc or shared resolver "doesn't need rewiring because it's project-level," verify the claim twice — once *across* parallel worktrees (the usual question) and once *within* a single task across resumed phases. The answers often differ: managed docs typically should NOT sync between parallel tasks (they describe the project), but the task's own mid-flight edits MUST reach its own subsequent phases. A doc that's stable across parallel work can still be mutated mid-task by an earlier phase — e.g., QA appending a pitfall to `docs/patterns.md` — and later phases that re-read the file from a stale location will silently get pre-edit content. For every "project-level, no change needed" claim, name both audits explicitly in the spec.
- **Build-generated artifacts go in Affected Files alongside their sources**: If a source change triggers a regeneration of a committed artifact (a bundled `dist/`, a generated `sitemap.xml`, compiled WASM, generated GraphQL types, etc.), list BOTH the source path and the artifact path in the spec's Affected Files table. The `--pr` base-drift gate diffs the worktree against `origin/<base>` and rejects any file not in the allow-list (task-dir + telemetry + spec's Affected Files); an undeclared artifact fails the gate even when the regeneration is correct, forcing a spec amendment + re-push at ship time. The project-specific binding lives in the validation matrix (`docs/architecture.md`). When spec-authoring, ask "does my source touch anything the build emits?" and declare both sides.

### Code-review rules of thumb

- **Reviewer diffs against the task baseline, not `main`, on release branches**: On a shared release branch that may be many commits ahead of `main`, diffing against `main` attributes unrelated work to the current task. Always diff against the task's baseline.
- **Verify handoff claims by running `git diff HEAD -- <file>`**: The pipeline's auto-commit step can silently drop edits to files not listed in the handoff's Changes table. Don't trust the handoff — diff the actual working tree to confirm claimed fixes landed.
- **Commit manual changes before invoking `canon run`**: When making manual code changes in the same session that spawns the pipeline, always commit before kicking off `canon run`. The orchestrator spawns fresh agent sessions that read the working tree — uncommitted changes create a mismatch.
- **Delicate-task review must audit cross-cutting guards at every mutation entry point**: When a `delicate: true` task refactors a state/data layer, explicitly verify that auth, gating, and payment guards still hold at *every* mutation chokepoint after the refactor — not just at the call sites the spec called out.
- **Use `git -C <absolute-path>` for every worktree git op, not `cd` + git**: When operating across REPO_ROOT and a task worktree in the same session, `cd` can silently revert between tool calls (subprocess scope, hook re-execution, background tasks). A sequence that starts with `cd dev-worktrees/<id>` may end up running against REPO_ROOT on a later call. Any pre-commit hook that touches the working tree (linters, formatters, generated-file syncers) will then stage REPO_ROOT files and produce a commit on REPO_ROOT's branch under a message intended for the task branch — a misleading commit on the wrong branch with the wrong content. Default to `git -C /absolute/path/to/worktree <cmd>` for every git invocation regardless of perceived cwd; same for build commands and any other command that emits artifacts into a specific checkout.

## Review Responsibilities

**Code review** (after Codex implements):
- Review the diff against the spec and Codex's `handoff.md`.
- **CRITICAL**: Verify the entire PR against the *original spec*, actively checking for dropped sections or missing Acceptance Criteria.
- Focus on what Codex cannot self-verify: correctness bugs, edge cases, type safety, UX implications, architectural drift.
- Do not re-verify lint/type-check/test/build status that Codex already reported passing.

**Feedback format**: Label every comment as `correctness bug`, `risk/guardrail`, `optional cleanup/nit`, or `spec gap`. Be specific, actionable, and reference the relevant convention or code path. Any finding that warrants a change goes back to Codex — the reviewer does not edit the diff. Nits the human may choose to skip ride along with the `Approved with nits` verdict and surface at QA.

## Codebase Navigation

Project-specific file locations live in [`docs/codebase-map.md`](docs/codebase-map.md). Read that doc on session start when orienting; consult its Trigger Table and Feature Wiring Maps when a task touches a new area.

## Known Patterns & Pitfalls

See `docs/patterns.md` "Known Pitfalls" for the project's hard-won implementation lessons. That file is the sole source of truth for pitfalls; this section just points to it.

## Commands

Project commands (lint, type-check, test, build, dev server, etc.) live in [`docs/architecture.md`](docs/architecture.md) under the "Validation" section, with the matrix categories from `AGENTS.md` bound to actual commands. Read that doc when you need to invoke a check.

## Pull Requests

**AGENTS.md is the source of truth for PR rules.** Common failure point — read it before opening a PR. Key requirements:

- PR body must start from `.github/pull_request_template.md` if your project has one
- Check remote branch state before creating branches or resetting (`git log origin/main..main`)
- Never force-push main

## CI

Project CI configuration lives in [`docs/architecture.md`](docs/architecture.md) under the Tech Stack → CI subsection. Projects that don't have CI configured will have it marked there.
<!-- canon:end -->

<!-- Your project additions below — `canon upgrade` will not touch this section -->
