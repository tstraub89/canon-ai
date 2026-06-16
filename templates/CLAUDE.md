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

**Spec gate**: The human always reviews the spec before the pipeline advances — invoke `canon run <id>` only after they approve. The `human_spec_gate` flag is a **single-use latch**: re-running after the banner is the intended next step and does not re-fire the gate. Full mechanics: [`docs/pipeline-orchestrator.md` §Spec gate is a single-use latch](docs/pipeline-orchestrator.md).

If the human clearly wants no interrupts or "draft PR when done" behavior, pass `--full-send` to `/canon-spec` (for example when they say "full send", "full-send", "yolo it", "don't bother me", or "no interrupts"). If you invoke `canon run --full-send` directly on a delicate task, append `--force` and say so before launching — the run will still use the upgraded model, but it opens the PR without another checkpoint.

**Pipeline rule**: Claude Code (the operator session — the one the human talks to directly) invokes `canon run <id>` to drive pipeline phases and monitors progress. Pipeline-spawned Claude sessions write `review.md`, `done.md`, and QA-drafted `pr-body.md` (and, for full-tier tasks, `plan.md`). If you catch yourself reading the diff to assess spec compliance in the operator session, stop and kick the phase to the pipeline instead. `canon task new` scaffolds **every** artifact as a stub up front, so file — or stub-content — presence says nothing about whether a phase has run. Phase state lives only in `status.json`; read it with `canon task status <id>` and never infer phase progress from which files exist.

A human shell can also operate canon directly (`canon run <id>` in a terminal), useful for headless / scripted use. Codex can technically operate but canon was not designed for it — see [`docs/pipeline-orchestrator.md` §Operator](docs/pipeline-orchestrator.md) for why.

**Modifying canon's own harness or policy** (the orchestrator scripts, task templates, agent configs, or AGENTS.md / CLAUDE.md themselves) is allowed both inline and through the pipeline. The split:

- **Trivial** (≤ ~10 lines, no logic change, doc tweak, single-file rename): inline. Canon overhead isn't worth it.
- **Non-trivial** (new pipeline phase, new validation gate, behavior change in the orchestrator, structural template changes): through canon, with worktree isolation.

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
- `MAX_REVIEW_LOOPS=5 canon run <id> --step` — env-var override; never hand-edit `status.json` to bypass auto-block. **Caveat**: before raising the cap, check whether Codex's iteration notes describe the recurring finding as "stale," "the claim is wrong," or "not actionable from this side." If the finding is genuinely unactionable, fix the spec/validator and reset `iterations_current_loop` per the auto-block message instead of raising.
- **`canon run <id> --pr` → `canon run <id> --ship`** — at `human_review`, `--pr` pushes the branch + opens the draft PR; after the PR is approved, `--ship` squash-merges + archives (runs `gh pr merge`, tears down the worktree, cleans up branches; mechanics in [`docs/pipeline-orchestrator.md`](docs/pipeline-orchestrator.md)). Don't merge the PR manually. If you merged externally, `--ship` detects it and picks up at cleanup. Running `--ship` with no PR open archives the task without the implementation landing — don't.
- **`canon watch <id>`** — `canon run` auto-detaches when stdout isn't a TTY (operator session + CI). Instead of polling `status.json`, `canon watch` attaches to the live run and blocks until it settles, exiting with a classified code (code set, `--until`/`-f` flags, and pid-reuse safety in [`docs/pipeline-orchestrator.md`](docs/pipeline-orchestrator.md)). Pair them: run detaches, watch blocks.
- **Reroute step guards**: bare `--reroute` auto-detaches; monitor it with `canon watch`. For a stepped foreground reroute, combine reset and step in one command — full-tier re-enters at `spec_review`: `canon run <id> --reroute --step --expect spec_review`; fast-tier re-enters at `implement`: `canon run <id> --reroute --step --expect implement` (optionally append `## Reroute Plan` to `plan.md` first; implement-reroute reads it). `--reroute` is allowed from `human_review` and from a `code_review` block with a `spec_gap` verdict. If amendment review blocks with `changes_requested`, revise the Amendment section in `spec.md` and re-run `canon run <id>` — not `--reroute`. Round 2+ amendments must use the heading `## Amendment Round N` (not bare `## Amendment`); never hand-add Amendment sections outside the reroute path. Full mechanics: [`docs/pipeline-orchestrator.md` §Human Reroute](docs/pipeline-orchestrator.md).
- Set `task_size` (S/M/L/XL) and `delicate` (true/false) in `status.json` at task creation. `delicate: true` forces the XL bucket regardless of nominal size. **`delicate` is for genuinely sensitive surfaces** — where an undetected bug is materially harder to recover from than a normal bug — not "this is hard to test" or "the UI is fiddly" (those go in *Known Risks* or *Human Test Plan*, not `delicate`). **Project-specific delicate-flag domain examples** (auth, payments, persistent storage, PHI handling, security-relevant cryptography, orchestrator routing logic, etc.) live in [`docs/product-context.md`](docs/product-context.md) — adopters list theirs there.
- **One pipeline per worktree.** Multiple `canon run` invocations are safe IF each runs in its own worktree on its own branch (the default). What's NOT safe is two invocations on the **same branch and folder** — they corrupt each other's git state. Use bundle mode (multiple task IDs to one invocation) when tasks should converge on one review loop and one commit history.
- **Prefer `canon task` helpers over hand-editing `status.json`.** `canon task phase` re-derives the top-level `status` pointer; hand-editing skips that and misroutes.
- **`canon task` key ops**: `canon task new <id> "Title"` — scaffold a task; `canon task list` — show all tasks; `canon task phase <id> <phase> <status>` — advance a phase; `canon task accept <ids> spec_review|code_review --reason "<why>"` — sanction a review verdict as `sanctioned` with a notes audit line; `canon task post-merge-sync` — reconcile after squash-merge. These auto-route to the worktree's `status.json` past plan. Full subcommand list in [`docs/pipeline-orchestrator.md`](docs/pipeline-orchestrator.md#task-management-canon-task).
- **Never read `tasks/<id>/status.json` directly from REPO_ROOT once a task is past plan** — the base-branch copy is stale. Use `canon task status <id>` (it routes to the worktree automatically).

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

1. Write `plan.md` with ordered implementation steps.
2. Reference specific files, existing patterns, and code examples from the codebase.
3. Record the human's approval in `tasks/TASK-ID/spec-review.md`: check the **Approved** box and add a one-line note (e.g. "Fast tier — human conversational spec approval; Codex spec review skipped"). The phase gate requires the artifact's checked verdict to match before `spec_review` can advance to `done`.
4. Advance the phases — prefer the helpers over hand-editing (they rederive the top-level `status` pointer; leave it alone either way):
   - `canon task phase TASK-ID spec done`
   - `canon task phase TASK-ID spec_review done approved` (works only after step 3 — the gate reads `spec-review.md`)
   - `canon task phase TASK-ID plan done`
   - Set `human_spec_gate` to `false` in `status.json` (gate has already been cleared by human approval).
5. Invoke the pipeline: `canon run TASK-ID`

For full-tier tasks (M, L, XL, or any delicate task), plan writing is a pipeline phase. After the human approves the spec, invoke the pipeline directly — let the pipeline Claude session write the plan.

### Writing a Plan (full tier — pipeline phase, after Codex spec review)

Invoked by the orchestrator (pipeline session only).

1. Read `spec-review.md` and address any `changes_requested` items before proceeding.
2. Write `plan.md` per the S-tier plan-writing steps above (ordered steps; reference specific files, patterns, and code examples).
3. Update `status.json`: set `plan.status` to `"done"`.
4. Orchestrator advances to Codex implementation, then directly to code review.

### Reviewing Code

The pipeline-spawned `code_review` session is a **synthesis foreman**: it spawns two isolated review lenses in parallel, adjudicates, writes the single `review.md`, and sets the verdict (synthesis contract in `AGENTS.md` §Code Review Responsibilities).

- **Anchored lens**: applies the normal two-stage charter below using `spec.md`, `handoff.md`, and the diff.
- **Cold lens**: reviews the diff only, with no spec, AC, handoff rationale, canon docs, or prior findings.

The foreman deduplicates overlapping findings, drops cold findings that the spec shows are intended, and classifies every surviving finding as `code-bug` or `spec-gap`. A `spec_gap` verdict means the code can't fix it (spec missing/wrong/ambiguous); the phase blocks for the operator to choose fix or bless — see the fix/bless paths in step 10 below.

The anchored lens runs in **two stages**. Stage 1 is a gate — if it fails, skip Stage 2 entirely and send back.

**Stage 1 — Spec compliance (gate)**:
1. Read `handoff.md` for changed files, rationale, and deviations.
2. **Validation gate**: Verify the Codex-authored Validation Outcomes table has no `Fail` results and all applicable checks were run. A `Fail – unrelated` entry is acceptable only when Notes contains a specific, credible file reference (path, extension, or `file:line`) — assess it, don't rubber-stamp. Missing or unexplained failure = Stage 1 fail. A `Fail – unrelated` entry citing any file in the task's branch diff is invalid — the failure belongs to the task regardless of the label. (Full semantics: `AGENTS.md` §File-Based Handoff Protocol.)
3. Read the injected diff in your prompt (the orchestrator pre-computes `git diff <baseBranch>...HEAD` and includes it). If the diff was truncated, read individual files from the handoff Changes table directly.
4. **AC cross-reference**: Fill the Stage 1 AC table in `review.md` with **every** AC from `spec.md`. Missing an AC from the table is itself a Stage 1 fail — no skipping.
5. **Dropped sections check**: Non-goals respected? Known Risks addressed or accepted? Human Test Plan satisfiable? Any dropped section = Stage 1 fail.
6. If Stage 1 fails: fill the Stage 1 section, mark Stage 2 as "Not run — Stage 1 failed," set final verdict to `changes_requested`, and stop. Do not write Stage 2 findings.

**Stage 2 — Code quality (only if Stage 1 passed)**:

7. Return findings labeled: `correctness bug`, `risk/guardrail`, `optional cleanup/nit`, or `spec gap`. Reference the spec by AC number and the diff by `file:line` — do not restate AC text or paste large code blocks back at the implementer.
8. **Test change rule**: Tests change only when behavior intentionally changes (see *Spec-writing rules of thumb*). If a test was updated to pass against broken behavior — accommodating the regression rather than fixing it — flag it as `correctness bug`.

Across both stages, focus on what Codex cannot self-verify — correctness bugs, edge cases, type safety, UX implications, architectural drift — and do not re-verify lint/type-check/test/build status that Codex already reported passing.

Then:

9. Foreman writes `review.md` and updates `status.json` with `approved`, `approved_with_nits`, `changes_requested`, or `spec_gap`. (`needs_re_review` is a legacy alias still accepted by the parser and routed/counted identically to `changes_requested`; the foreman's menu doesn't offer it.) A `sanctioned` verdict is operator-written only via `canon task accept`. Nits ride along with the `approved_with_nits` verdict and surface at QA.
10. If changes requested → Codex iterates → re-review **runs both lenses from scratch** (re-implementation may invalidate prior Stage 2 conclusions even when the original failure was Stage 1). If `spec_gap` → use the fix path (`--reroute` after amending `spec.md`) or the bless path (`canon task accept ... --reason`); do not use `canon task phase ... code_review pending` as the recovery path.

### Writing QA Summary

After code review passes:
1. Write `done.md` for the human — plain English, test steps, results.
2. Draft `pr-body.md` for `--pr` — outward-facing, no canon attribution, using the repo's PR template when present and a default skeleton otherwise.
3. Update `status.json`: set `qa.status` to `"done"`.
4. Append a row to `docs/task-quality-log.md` (see that file for column definitions).
5. If this task produced a reusable insight, **append** an entry to `docs/lessons-learned.md` — append-only. Never edit, prune, promote, or reorganize other entries. If the buffer now exceeds ~15 entries, note in `done.md` that a human lessons sweep is due — do not perform it.

### Opening a PR (at human_review)

Once the task reaches `human_review`, run `canon run <id> --pr` to push the branch and open the draft PR (it targets `base_branch`, recorded at task creation). See the Quick-refs `--pr` → `--ship` bullet; don't `--ship` until the PR is approved.

## Spec Authorship Guidelines

When writing specs:

- **Problem**: What is broken, missing, or suboptimal?
- **Decision**: What behavior are we adding/changing? (Not implementation details.)
- **Non-goals**: What are we NOT doing? Prevents scope creep. For a load-bearing exclusion (one a regression could plausibly violate), prefer a positive scope-bound or a grep AC over the prose "NOT" alone — see the negation rule of thumb below.
- **Acceptance Criteria**: Verifiable checklist. Each item testable.
- **Affected Files**: List files Codex must **modify**, with brief change descriptions. Files Codex only needs to read for context do not belong here — mention them inline in *Decision* or *Known Risks* if relevant. The pipeline pre-loads Affected Files into Codex's prompt (up to a byte cap), so padding the table with reference files inflates token cost for every implement pass. Codex can always Read additional files on demand.
- **Validation Required**: Which checks apply from the validation matrix.
- **Known Risks**: Edge cases, performance, platform issues.
- **Human Test Plan**: Steps for the product owner. Written for someone who reads product behavior, not the implementation language.

### Spec-writing rules of thumb

- **Name effects to DELETE — frame supersession as replacement, not add-plus-remove**: When a change supersedes prior code, state it as a single *replacement* — "replace `oldFn` with `newFn`; `oldFn` must not exist after" — not an "Add `newFn`" bullet beside a separate "Remove `oldFn`" bullet (if only the "Add" half registers, a silent-no-op regression survives). Strongest of all is to back the deletion with a structural check (grep that the old symbol is gone — see the negation rule below); fall back to paired add/remove only when a true replacement can't be expressed.
- **Prefer positive or structural assertions over prose negations for load-bearing constraints**: A constraint that *must* hold ("never X", "not Y", a Non-goal ruling out a tempting scope expansion) is fragile as a bare prose negation. Two hedges, strongest first: (1) **structural** — back it with a grep AC ("`SYMBOL` must not appear outside these paths"; build its allow-list per the git-grep rule below); (2) **positive reframe** — where no validator fits, state the bound positively ("scope is single-item only; batch belongs in TASK-XYZ"). Reserve bare prose negation for low-stakes clarifications.
- **UI spatial specs expect human iteration**: Popover anchoring, button ordering, button visual weight, and other layout-perception decisions almost always require at least one human review cycle with visual feedback. Flag "visual positioning — expect human iteration" in *Known Risks*.
- **Gesture and DOM-ownership tasks expect a runtime debugging session**: Tasks that involve continuous gesture state, direct DOM writes, or device-specific timing cannot be fully validated by static analysis or automated tests alone. Flag in *Known Risks* and expect human+Codex runtime debugging after first implementation.
- **If changed code affects a label, button, or modal text, E2E cannot be "Deferred"**: Existing E2E tests locate elements by name. Any UI label/text change must ship with updated test locators.
- **E2E tests change only when intended behavior changes**: If an E2E test fails after a code change and the behavior change was not planned, the *code* is broken — not the test. Don't update the test to pass against the regression.
- **Test files are per-feature, not per-helper**: Before naming a new test file in a spec, list existing test files. Consolidate new helpers into one feature-named test file rather than creating a new one per helper.
- **Strong-semantic mode names need product-owner sign-off on full scope before narrow scoping**: When a mode or toggle uses a term that implies full constraint ("locked", "linked", "synced", "frozen", "fixed"), verify what the name means *in full* before scoping it narrowly, or pick a less load-bearing name.
- **Verify that symbols named in spec ACs actually exist in the codebase AND that their return shape matches the spec's assumed data contract**: Before marking spec done, grep for every function or symbol an AC names, then read its return type — a symbol that exists but returns `void` or a different type than the spec assumes makes the AC unimplementable. Do both checks.
- **For large-removal tasks with structural grep ACs, generate the allow-list from `git grep`, not the Affected Files table**: When a spec has an AC of the form "this string must not appear outside these paths," build the allow-list by running `git grep` against the *current* tree — the Affected Files table only lists files the author expects to *touch* and misses files that legitimately contain the symbol. During spec_review, the Codex reviewer runs the grep and flags missing allow-list entries before implementation begins.
- **"No change needed because X is project-level" requires both cross-task AND within-task audit**: When a spec asserts a managed doc or shared resolver "doesn't need rewiring because it's project-level," verify the claim twice and name both audits in the spec — once *across* parallel worktrees and once *within* the task across resumed phases. The answers often differ: managed docs usually should NOT sync across parallel tasks, but a task's own mid-flight edits MUST reach its own later phases.
- **Build-generated artifacts go in Affected Files alongside their sources**: If a source change regenerates a committed artifact (a bundled `dist/`, a generated `sitemap.xml`, compiled WASM, generated GraphQL types, etc.), list BOTH the source path and the artifact path in the Affected Files table — the `--pr` base-drift gate rejects any file not in the allow-list. The project-specific binding lives in the validation matrix (`docs/architecture.md`). When spec-authoring, ask "does my source touch anything the build emits?" and declare both sides.
- **At ≥3 spec_review iterations, pause and read the round-over-round shape before continuing**: Label each round *edge-fine-tune* (a missed file path, a wording precision, a single overlooked validator — normal, proceed) or *scope-expansion* (each round surfaces a new sub-problem, parser shape, or gate semantic the previous round didn't anticipate — a design smell). At round 3+, enumerate what each round changed, label each, then decide explicitly: proceed, carve out the scope-expanding piece, redesign the AC with a simpler invariant, or accept a narrower scope and file the rest. Don't iterate further on autopilot.
- **A spec states behavioral contracts, not implementation mechanics — over-specification breeds its own review thrash**: Keep ACs about *observable behavior and contracts*; defer mechanics (signatures, internal seams, precise algorithms, constant names) to plan/implement with an explicit "mechanics deferred" note; consolidate verification into one **Testing Matrix** section instead of a per-AC `Verify:` clause that cross-cuts the others. **Diagnostic tell** (companion to the iteration-shape rule above): when `spec_review`'s Shape Check goes *clean* yet `changes_requested` keeps firing on wording / internal consistency, the spec's *size*, not its design, is the fault — **simplify** (collapse to contracts + a testing matrix and defer mechanics), don't iterate or raise `MAX_REVIEW_LOOPS`.
- **Reproduce a flake's actual mechanism before spec'ing its fix — don't encode a plausible-but-unverified hypothesis**: Falsify the hypothesis on paper, then reproduce it deterministically (fault injection / forced race / targeted repro), before the spec's *Problem* and ACs commit to a root cause — and write the deterministic repro into the *Human Test Plan*, not just "the flake stopped." Full rule and role checkpoints live in `AGENTS.md` §"Diagnose Before You Fix".
- **Refactor specs need numerical caps + explicit deletion expectations, not just behavioral goals**: For a refactor over ~1000 LOC of mutation, behavioral goals like "extract the helpers into modules" aren't enough. Give the spec hard structural invariants: a size cap (e.g., "`main.ts` ≤ 400 lines after"), an explicit allow-list of what may remain, and a per-symbol deletion expectation ("for every symbol an AC moves, the reviewer greps the gutted file for its name and fails the AC if it still appears"). Tell: a refactor that reroutes on a "cloned, not moved" finding was under-specified on structural invariants, not under-powered on the model — patch the spec with caps before reaching for a bigger model.

### Code-review rules of thumb

- **Reviewer diffs against the task baseline, not `main`, on release branches**: On a shared release branch ahead of `main`, always diff against the task's baseline — diffing against `main` attributes unrelated work to the task.
- **Verify handoff claims by running `git diff HEAD -- <file>`**: The auto-commit step can silently drop edits to files not in the handoff's Changes table — don't trust the handoff; diff the working tree to confirm claimed fixes landed.
- **Commit manual changes before invoking `canon run`**: The orchestrator spawns fresh sessions that read the working tree, so commit any manual changes before kicking off `canon run`.
- **Delicate-task review must audit cross-cutting guards at every mutation entry point**: When a `delicate: true` task refactors a state/data layer, explicitly verify that auth, gating, and payment guards still hold at *every* mutation chokepoint after the refactor — not just at the call sites the spec called out.
- **Use `git -C <absolute-path>` for every worktree git op, not `cd` + git**: When operating across REPO_ROOT and a task worktree in one session, `cd` can silently revert between tool calls (subprocess scope, hook re-execution, background tasks) — and a pre-commit hook that touches the tree will then stage REPO_ROOT files onto the wrong branch. Default to `git -C /absolute/path/to/worktree <cmd>` for every git invocation regardless of perceived cwd; same for build commands and anything that emits artifacts into a specific checkout.
- **Don't infer one git invariant from another**: `git status --porcelain` empty ≠ origin matches HEAD; "origin/<branch> exists" ≠ origin matches HEAD; and beyond git, "branch is checked out" ≠ "worktree directory exists", "PR exists" ≠ "PR is in the expected state". The actual check is usually cheap — do it directly, don't infer from a related state. Full pitfall in `docs/patterns.md`.
- **A cross-cutting invariant belongs in one shared helper, not patched per call site**: When the same rule must hold at multiple enforcement points, implement it once as a shared helper all sites call. The tell you're under-consolidated: findings come back round after round as the *same bug class at a new location* (site A, then B, then C) — distinct from the design signal where each round surfaces a genuinely *new* sub-problem (see the spec-review iteration-shape rule). When a finding is "site S doesn't enforce X," grep for every site that should enforce X *before* patching S; at ≥3 sites, extract the helper and route them all through it. Corollary: have the shared helper validate its own untyped inputs (type at-risk fields `unknown` so the compiler forces runtime checks). Second corollary — **mirroring a resolution means calling the resolver**: import and call the existing resolver (export it if private), never reconstruct the common-case default with a hand-rolled path literal or `existsSync` check.

## Review Responsibilities

Code review runs as the foreman over the anchored and cold lenses — see **Reviewing Code** above for the full charter (Stage 1 AC/dropped-section gate, Stage 2 finding labels, verdict routing). Code-bug findings go back to Codex; spec gaps block for human amendment.

## Cross-review for inline and XS work

Non-trivial inline edits and XS fixes too small for a canon task get an independent `codex review` before commit — Claude never self-reviews its own inline code. Use the `/canon-inline-review` skill to drive the review.

## Codebase Navigation

Project-specific file locations live in [`docs/codebase-map.md`](docs/codebase-map.md). Read that doc on session start when orienting; consult its Trigger Table and Feature Wiring Maps when a task touches a new area.

## Known Patterns & Pitfalls

See `docs/patterns.md` "Known Pitfalls" for the project's hard-won implementation lessons. That file is the sole source of truth for pitfalls; this section just points to it.

## Commands

Project commands (lint, type-check, test, build, dev server, etc.) live in [`docs/architecture.md`](docs/architecture.md) under the "Validation" section, with the matrix categories from `AGENTS.md` bound to actual commands. Read that doc when you need to invoke a check.

## Pull Requests

**AGENTS.md is the source of truth for PR rules.** Common failure point — read it before opening a PR. Key requirements:

- If your project has a PR template (GitHub's default location is .github/pull_request_template.md), the PR body must start from it
- Check remote branch state before creating branches or resetting (`git log origin/main..main`)
- Never force-push main

## CI

Project CI configuration lives in [`docs/architecture.md`](docs/architecture.md) under the Tech Stack → CI subsection. Projects that don't have CI configured will have it marked there.
<!-- canon:end -->

<!-- Your project additions below — `canon upgrade` will not touch this section -->
