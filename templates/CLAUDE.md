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

**Spec gate**: The human always reviews the spec before the pipeline advances — invoke `canon run <id>` only after they approve. The `human_spec_gate` flag is a **single-use latch**, not a persistent setting: the orchestrator flips it `true`→`false` *at the moment it halts* for review, so a later `false` means "the gate already fired (or was pre-cleared)," **not** that review was skipped. Re-running after the banner is the intended next step and does not re-fire the gate. Full mechanics: [`docs/pipeline-orchestrator.md` §Spec gate is a single-use latch](docs/pipeline-orchestrator.md).

If the human clearly wants no interrupts or "draft PR when done" behavior, pass `--full-send` to `/canon-spec` (for example when they say "full send", "full-send", "yolo it", "don't bother me", or "no interrupts"). If you invoke `canon run --full-send` directly on a delicate task, append `--force` and say so before launching — the run will still use the upgraded model, but it opens the PR without another checkpoint.

**Pipeline rule**: Claude Code (the operator session — the one the human talks to directly) invokes `canon run <id>` to drive pipeline phases and monitors progress. Pipeline-spawned Claude sessions write `review.md`, `done.md`, and QA-drafted `pr-body.md` (and, for full-tier tasks, `plan.md`) — that keeps orchestrator guardrails intact, session resumption working, and the operator session's context clean. If you catch yourself reading the diff to assess spec compliance in the operator session, stop and kick the phase to the pipeline instead. Relatedly: `canon task new` lays down **every** artifact (`spec.md`, `plan.md`, `spec-review.md`, `handoff.md`, `review.md`, `done.md`, `pr-body.md`, `notes.md`) as a stub up front, so the presence of an artifact file — or stub content inside it — says nothing about whether its phase has run. Phase state lives only in `status.json`; read it with `canon task status <id>` and never infer phase progress from which files exist.

A human shell can also operate canon directly (`canon run <id>` in a terminal), useful for headless / scripted use. Codex can technically operate but canon was not designed for it — see [`docs/pipeline-orchestrator.md` §Operator](docs/pipeline-orchestrator.md) for why.

**Modifying canon's own harness or policy** (the orchestrator scripts, task templates, agent configs, or AGENTS.md / CLAUDE.md themselves) is allowed both inline and through the pipeline. The split:

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
- **`canon run <id> --pr` → `canon run <id> --ship`** — when a task reaches `human_review`, run `--pr` to push the branch and open the draft PR; after the PR is marked ready and approved, run `--ship` for the merge + archive. `--ship` calls `gh pr merge --squash --delete-branch` itself and pulls the base branch, then tears down the worktree, archives the task dir, and cleans up local branches. Don't merge the PR manually — canon's `--ship` handles the worktree-teardown-before-branch-deletion ordering that `gh pr merge --delete-branch` alone trips on when a worktree holds the branch. If you've already merged the PR externally, `--ship` detects the merge and picks up at cleanup. Before deleting a local task branch, `--ship` requires forge-proof merge evidence from the pinned PR state, base-ref match, and the local branch tip being ancestor-or-equal to the PR head; if the PR head cannot be materialized locally, proof fails closed. `--force` does not bypass that gate. If the local branch is already absent, proof is skipped because there is no local branch deletion left to protect. Running `--ship` with no PR open at all archives the task without the implementation landing — don't do that.
- **`canon watch <id>`** — after `canon run` detaches (it auto-detaches whenever stdout isn't a TTY — the norm in the operator session and CI), block until the run settles instead of hand-rolling a `status.json` poll loop. `watch` attaches to the live orchestrator, streams phase transitions to stderr, and exits with a classified code (`0` healthy stop · `2` nothing-to-watch · `3` auto-block · `4` death · `5` timeout) plus a `state=… reason=…` summary line on stdout. `--until <phase>` returns early; `-f` tails the run log. It refuses to attach when the pid file and a live heartbeat pid disagree (pid-reuse safety). Pair with `canon run <id>`: run detaches, watch blocks.
- **Reroute step guards**: bare `--reroute` auto-detaches; monitor it with `canon watch`. For a stepped foreground reroute, combine the reset and step in one command: full-tier tasks re-enter at `spec_review`, so use `canon run <id> --reroute --step --expect spec_review`; fast-tier tasks re-enter at `implement`, so use `canon run <id> --reroute --step --expect implement`. You may optionally append `## Reroute Plan` to `plan.md` first, and implement-reroute reads it when present. `--reroute` is allowed from `human_review` and from a `code_review` block with a `spec_gap` verdict. If amendment review blocks with `changes_requested`, revise the Amendment section in `spec.md` and re-run `canon run <id>` — not `--reroute`. Round 2+ amendments must use the heading `## Amendment Round N` (not bare `## Amendment`) — the orchestrator matches on that heading. Do not hand-add Amendment sections outside the reroute path; the invariant is `## Amendment [Round N]` exists when `reroute_count` advanced.
- Set `task_size` (S/M/L/XL) and `delicate` (true/false) in `status.json` at task creation. `delicate: true` forces the XL bucket regardless of nominal size. **`delicate` is for genuinely sensitive surfaces** — anything where a regression has unbounded blast radius. The bar is "an undetected bug here is materially harder to recover from than a normal bug" — not "this is hard to test" or "the UI is fiddly" (those go in *Known Risks* or *Human Test Plan*, not `delicate`). **Project-specific delicate-flag domain examples** (auth, payments, persistent storage, PHI handling, security-relevant cryptography, orchestrator routing logic, etc.) live in [`docs/product-context.md`](docs/product-context.md) — adopters list theirs there.
- **One pipeline per worktree.** Multiple `canon run` invocations are safe IF each runs in its own worktree on its own branch (the default — worktree isolation is what makes that work). What's NOT safe is two invocations on the **same branch and folder** — they corrupt each other's git state. Use bundle mode (multiple task IDs to one invocation) when tasks should converge on one review loop and one commit history.
- **Prefer `canon task` helpers over hand-editing `status.json`.** `canon task phase` re-derives the top-level `status` pointer; hand-editing skips that and produces inconsistent state the dispatcher misroutes from.
- **`canon task` key ops**: `canon task new <id> "Title"` — scaffold a task; `canon task list` — show all tasks; `canon task phase <id> <phase> <status>` — advance a phase; `canon task accept <ids> spec_review|code_review --reason "<why>"` — sanction a review verdict as `sanctioned` with a notes audit line; `canon task post-merge-sync` — reconcile after squash-merge. `canon task status/list/accept/phase` run from REPO_ROOT read or write the worktree's `status.json` when one exists past plan, so mid-pipeline status reads show live worktree state. Full subcommand list in [`docs/pipeline-orchestrator.md`](docs/pipeline-orchestrator.md#task-management-canon-task).
- **Never read `tasks/<id>/status.json` directly from REPO_ROOT once a task is past plan.** From implement onward, the worktree is the live copy — the base branch copy is stale. Use `canon task status <id>` to get current state (it routes to the worktree automatically).

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
2. Write `plan.md` with ordered implementation steps.
3. Reference specific files, existing patterns, and code examples from the codebase.
4. Update `status.json`: set `plan.status` to `"done"`.
5. Orchestrator advances to Codex implementation. After implement, the orchestrator advances directly to code review.

### Reviewing Code

The pipeline-spawned `code_review` session is a **synthesis foreman**. It spawns two isolated review lenses in parallel, adjudicates their findings, writes the single `review.md`, and sets the verdict.

- **Anchored lens**: applies the normal two-stage charter below using `spec.md`, `handoff.md`, and the diff.
- **Cold lens**: reviews the diff only, with no spec, AC, handoff rationale, canon docs, or prior findings.

The foreman deduplicates overlapping findings, drops cold findings that the spec shows are intended, and classifies every surviving finding as `code-bug` or `spec-gap`. A `spec_gap` verdict means the implementation cannot fix the issue because the spec is missing, wrong, or too ambiguous; the orchestrator blocks `code_review` with an escalation so the human can choose fix or bless. Fix: amend `spec.md` and run `canon run <ids> --reroute` so the amendment gets spec review and plan refresh. Bless: run `canon task accept <ids> code_review --reason "<why>"`, which records `sanctioned` in status and writes the audit reason to `notes.md`.

The anchored lens runs in **two stages**. Stage 1 is a gate — if it fails, skip Stage 2 entirely and send back. Writing code-quality findings against code that's about to change wastes tokens and can mislead Codex on the re-implementation.

**Stage 1 — Spec compliance (gate)**:
1. Read `handoff.md` for changed files, rationale, and deviations.
2. **Validation gate**: Verify the Codex-authored Validation Outcomes table has no `Fail` results and all applicable checks were run. A `Fail – unrelated` entry is acceptable only when Notes contains a specific file reference (path, extension, or `file:line`) and the explanation is credible — assess it; don't rubber-stamp it. Missing or unexplained failure = Stage 1 fail. A `Fail – unrelated` entry citing a file the task itself modified is invalid — a failure in a file Codex changed belongs to the task regardless of the label. The pre-flight gate enforces this deterministically; Stage 1 catches subtler cases where the file changed indirectly.
3. Read the injected diff in your prompt (the orchestrator pre-computes `git diff <baseBranch>...HEAD` and includes it). If the diff was truncated, read individual files from the handoff Changes table directly.
4. **AC cross-reference**: Fill the Stage 1 AC table in `review.md` with **every** AC from `spec.md`. Missing an AC from the table is itself a Stage 1 fail — no skipping.
5. **Dropped sections check**: Non-goals respected? Known Risks addressed or accepted? Human Test Plan satisfiable? Any dropped section = Stage 1 fail.
6. If Stage 1 fails: fill the Stage 1 section, mark Stage 2 as "Not run — Stage 1 failed," set final verdict to `changes_requested`, and stop. Do not write Stage 2 findings.

**Stage 2 — Code quality (only if Stage 1 passed)**:

7. Return findings labeled: `correctness bug`, `risk/guardrail`, `optional cleanup/nit`, or `spec gap`. Reference the spec by AC number and the diff by `file:line` — do not restate AC text or paste large code blocks back at the implementer. Every line that reaches `review.md` should be load-bearing; padding dilutes signal and slows the review-iteration loop.
8. **Test change rule**: Any change to a test must be directly justified by a spec AC that intentionally changes behavior. If a test was updated to pass against broken behavior (i.e., to accommodate the regression rather than fix it), flag it as `correctness bug`. Tests must only change when behavior is intentionally changing.

Then:

9. Foreman writes `review.md` and updates `status.json` with `approved`, `approved_with_nits`, `changes_requested`, or `spec_gap`. (`needs_re_review` is a legacy alias still accepted by the parser and routed/counted identically to `changes_requested`; the foreman's menu doesn't offer it.) A `sanctioned` verdict is operator-written only via `canon task accept`.
10. If changes requested → Codex iterates → re-review **runs both lenses from scratch** (re-implementation may invalidate prior Stage 2 conclusions even when the original failure was Stage 1). If `spec_gap` → use the fix path (`--reroute` after amending `spec.md`) or the bless path (`canon task accept ... --reason`); do not use `canon task phase ... code_review pending` as the recovery path.

### Writing QA Summary

After code review passes:
1. Write `done.md` for the human — plain English, test steps, results.
2. Draft `pr-body.md` for `--pr` — outward-facing, no canon attribution, using the repo's PR template when present and a default skeleton otherwise.
3. Update `status.json`: set `qa.status` to `"done"`.
4. Append a row to `docs/task-quality-log.md` (see that file for column definitions).
5. If this task produced a reusable insight, **append** an entry to `docs/lessons-learned.md` — append-only. Never edit, prune, promote, or reorganize other entries (this task's earlier ones or any other task's), and never promote into permanent docs; promoting/pruning the buffer is a human-initiated, human-approved action. If the buffer now exceeds ~15 entries, note in `done.md` that a human lessons sweep is due — do not perform it.

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
- **Non-goals**: What are we NOT doing? Prevents scope creep. For a load-bearing exclusion (one a regression could plausibly violate), prefer a positive scope-bound or a grep AC over the prose "NOT" alone — see the negation rule of thumb below.
- **Acceptance Criteria**: Verifiable checklist. Each item testable.
- **Affected Files**: List files Codex must **modify**, with brief change descriptions. Files Codex only needs to read for context do not belong here — mention them inline in *Decision* or *Known Risks* if relevant. The pipeline pre-loads Affected Files into Codex's prompt (up to a byte cap), so padding the table with reference files inflates token cost for every implement pass. Codex can always Read additional files on demand.
- **Validation Required**: Which checks apply from the validation matrix.
- **Known Risks**: Edge cases, performance, platform issues.
- **Human Test Plan**: Steps for the product owner. Written for someone who reads product behavior, not the implementation language.

### Spec-writing rules of thumb

- **Name effects to DELETE — frame supersession as replacement, not add-plus-remove**: When a change supersedes prior code, state it as a single *replacement* — "replace `oldFn` with `newFn`; `oldFn` must not exist after" — rather than an "Add `newFn`" bullet sitting next to a separate "Remove `oldFn`" bullet. Two adjacent bullets where one adds and the other negates is the weakest framing: if only the "Add" half registers, Codex leaves the old effect in place and a silent-no-op regression survives the whole pipeline. The replacement phrasing makes the deletion intrinsic to the instruction instead of a separable afterthought. Strongest of all is to back the deletion with a structural check (grep that the old symbol is gone — see the negation rule of thumb below); only fall back to paired add/remove bullets when a true replacement genuinely can't be expressed.
- **Prefer positive or structural assertions over prose negations for load-bearing constraints**: A constraint that *must* hold ("never X", "not Y", a Non-goal that rules out a tempting scope expansion) is most fragile when it lives only as a prose negation — the salient claim is the thing being forbidden, and a reader's pull is toward enacting it, not suppressing it (inductive-bias intuition from the finetuning result in [Negation Neglect](https://arxiv.org/abs/2605.13829), especially its local-vs-separated negation contrast — the paper studies finetuning, not in-context instruction-following, so treat this as directional). Two hedges, strongest first: (1) **structural** — back the constraint with a grep AC ("`SYMBOL` must not appear outside these paths"); the validator is ground truth and doesn't depend on how anything weights the "not" (see the structural-grep-AC rule below for building its allow-list); (2) **positive reframe** — where no validator fits, state the bound positively ("scope is single-item only; batch belongs in TASK-XYZ") instead of "we are NOT doing batch." Reserve bare prose negation for low-stakes clarifications.
- **UI spatial specs expect human iteration**: Popover anchoring, button ordering, button visual weight, and other layout-perception decisions almost always require at least one human review cycle with visual feedback. Flag "visual positioning — expect human iteration" in *Known Risks*.
- **Gesture and DOM-ownership tasks expect a runtime debugging session**: Tasks that involve continuous gesture state, direct DOM writes, or device-specific timing cannot be fully validated by static analysis or automated tests alone. Flag in *Known Risks* and expect human+Codex runtime debugging after first implementation.
- **If changed code affects a label, button, or modal text, E2E cannot be "Deferred"**: Existing E2E tests locate elements by name. Any UI label/text change must ship with updated test locators.
- **E2E tests change only when intended behavior changes**: If an E2E test fails after a code change and the behavior change was not planned, the *code* is broken — not the test. Don't update the test to pass against the regression.
- **Test files are per-feature, not per-helper**: Before naming a new test file in a spec, list existing test files. Consolidate new helpers into one feature-named test file rather than creating a new one per helper.
- **Strong-semantic mode names need product-owner sign-off on full scope before narrow scoping**: When a mode or toggle uses a term that naturally implies full constraint ("locked", "linked", "synced", "frozen", "fixed"), the human will read the strong meaning by default. Spec'ing it narrowly creates a hidden mismatch that surfaces in human testing as a code-review reroute. Verify what the name means *in full*, or pick a less load-bearing name.
- **Verify that symbols named in spec ACs actually exist in the codebase AND that their return shape matches the spec's assumed data contract**: Before marking spec done, grep for every function or symbol referenced by name in an AC — then read its return type. A symbol that exists but returns `void` or a different type than the spec assumes makes the AC unimplementable and causes an auto-block when Codex discovers the mismatch during implementation. The name check and the return-type check are both cheap; do both.
- **For large-removal tasks with structural grep ACs, generate the allow-list from `git grep`, not the Affected Files table**: When a spec includes an AC of the form "this string must not appear outside these paths," the spec author's allow-list is written from their mental model. The Affected Files table only lists files the author expects to *touch* — it misses historical telemetry docs, archived `status.json` snapshots, template mirrors, and other files that legitimately contain the retiring symbol but weren't in the author's mental model. During spec_review, the Codex reviewer should run the grep against the *current* tree to discover the full allow-list and flag additions before implementation begins. A missed allow-list entry forces a spec revision mid-review and burns an iteration.
- **"No change needed because X is project-level" requires both cross-task AND within-task audit**: When a spec asserts that a managed doc or shared resolver "doesn't need rewiring because it's project-level," verify the claim twice — once *across* parallel worktrees (the usual question) and once *within* a single task across resumed phases. The answers often differ: managed docs typically should NOT sync between parallel tasks (they describe the project), but the task's own mid-flight edits MUST reach its own subsequent phases. A doc that's stable across parallel work can still be mutated mid-task by an earlier phase — e.g., QA appending a pitfall to `docs/patterns.md` — and later phases that re-read the file from a stale location will silently get pre-edit content. For every "project-level, no change needed" claim, name both audits explicitly in the spec.
- **Build-generated artifacts go in Affected Files alongside their sources**: If a source change triggers a regeneration of a committed artifact (a bundled `dist/`, a generated `sitemap.xml`, compiled WASM, generated GraphQL types, etc.), list BOTH the source path and the artifact path in the spec's Affected Files table. The `--pr` base-drift gate diffs the worktree against `origin/<base>` and rejects any file not in the allow-list (task-dir + telemetry + spec's Affected Files, plus all managed docs once QA is done); an undeclared artifact fails the gate even when the regeneration is correct, forcing a spec amendment + re-push at ship time. The project-specific binding lives in the validation matrix (`docs/architecture.md`). When spec-authoring, ask "does my source touch anything the build emits?" and declare both sides.
- **At ≥3 spec_review iterations, pause and read the round-over-round shape before continuing**: Iteration count alone doesn't condemn a spec — what matters is whether the revisions are *fine-tuning edge cases* (a missed file path, a wording precision, a single overlooked validator) or *expanding scope* (each round surfaces a new sub-problem, parser shape, or gate semantic the previous round didn't anticipate). Edge-fine-tune iterations are normal and worth proceeding through. Scope-expansion iterations smell of a design problem — the gate or AC may be fundamentally more complex than the spec assumed. At round 3+, enumerate what each round changed, label each round as edge-fine-tune or scope-expansion, then decide explicitly: proceed, carve out the scope-expanding piece, redesign the AC with a simpler invariant, or accept a narrower scope and file the rest. Don't iterate further on autopilot. Canonical case: the telemetry-discrimination-gate spec accumulated 5 scope-expanding rounds before being carved out as a separate task with a simpler invariant.
- **A spec states behavioral contracts, not implementation mechanics — over-specification breeds its own review thrash**: The deeper a spec prescribes *how* (exact function signatures, internal pure/impure seams, precise algorithms, a `Verify:` clause bolted onto every AC), the more surface its own clauses have to contradict *each other* — and `spec_review` dutifully flags those contradictions, burning rounds that have nothing to do with whether the design is right. Keep ACs about *observable behavior and contracts*; defer mechanics (signatures, seams, constant names) to plan/implement with an explicit "mechanics deferred" note; consolidate verification into one **Testing Matrix** section instead of a per-AC `Verify:` clause that cross-cuts the others. **Diagnostic tell** (companion to the iteration-shape rule above): when `spec_review`'s Shape Check goes *clean* yet `changes_requested` keeps firing on wording / internal consistency, the spec's *size*, not its design, is the fault — the remedy is to **simplify** (collapse to contracts + a testing matrix and defer mechanics), not to iterate or raise `MAX_REVIEW_LOOPS`. Canonical case: the `canon-watch` spec ran 7 rounds + 2 auto-blocks — rounds 1–4 caught real bugs, rounds 5–6 were contradictions between 17 ACs of implementation-prescription; collapsing it to 13 behavioral ACs + a testing matrix passed `spec_review` in one round.
- **Reproduce a flake's actual mechanism before spec'ing its fix — don't encode a plausible-but-unverified hypothesis**: A failure snapshot usually fits several mechanisms, so a fix on the first plausible story can close a bug that isn't the one you're seeing while the real cause ships untouched and the symptom returns. Falsify the hypothesis on paper, then reproduce it deterministically (fault injection / forced race / targeted repro), before the spec's *Problem* and ACs commit to a root cause — and write the deterministic repro into the *Human Test Plan*, not just "the flake stopped." Full rule, role checkpoints, and the canonical Smart Fill dropped-photo case live in `AGENTS.md` §"Diagnose Before You Fix" — canon's source of truth; this bullet is the spec-author's pointer to it.
- **Refactor specs need numerical caps + explicit deletion expectations, not just behavioral goals**: For a refactor over ~1000 LOC of mutation (especially when a smaller model implements it), behavioral goals like "extract the helpers into modules" aren't enough — a model can do every extraction correctly yet leave the originals in place, *cloning* instead of *moving*, so the gutted file ends up as large as before with two parallel implementations. Give the spec hard structural invariants: a size cap (e.g., "`main.ts` ≤ 400 lines after"), an explicit allow-list of what may remain, and a per-symbol deletion expectation ("for every symbol an AC moves, the reviewer greps the gutted file for its name and fails the AC if it still appears"). This is the whole-file companion to "Name effects to DELETE." Tell: a refactor that reroutes on a "cloned, not moved" finding was under-specified on structural invariants, not under-powered on the model — patch the spec with caps before reaching for a bigger model.

### Code-review rules of thumb

- **Reviewer diffs against the task baseline, not `main`, on release branches**: On a shared release branch that may be many commits ahead of `main`, diffing against `main` attributes unrelated work to the current task. Always diff against the task's baseline.
- **Verify handoff claims by running `git diff HEAD -- <file>`**: The pipeline's auto-commit step can silently drop edits to files not listed in the handoff's Changes table. Don't trust the handoff — diff the actual working tree to confirm claimed fixes landed.
- **Commit manual changes before invoking `canon run`**: When making manual code changes in the same session that spawns the pipeline, always commit before kicking off `canon run`. The orchestrator spawns fresh agent sessions that read the working tree — uncommitted changes create a mismatch.
- **Delicate-task review must audit cross-cutting guards at every mutation entry point**: When a `delicate: true` task refactors a state/data layer, explicitly verify that auth, gating, and payment guards still hold at *every* mutation chokepoint after the refactor — not just at the call sites the spec called out.
- **Use `git -C <absolute-path>` for every worktree git op, not `cd` + git**: When operating across REPO_ROOT and a task worktree in the same session, `cd` can silently revert between tool calls (subprocess scope, hook re-execution, background tasks). A sequence that starts with `cd dev-worktrees/<id>` may end up running against REPO_ROOT on a later call. Any pre-commit hook that touches the working tree (linters, formatters, generated-file syncers) will then stage REPO_ROOT files and produce a commit on REPO_ROOT's branch under a message intended for the task branch — a misleading commit on the wrong branch with the wrong content. Default to `git -C /absolute/path/to/worktree <cmd>` for every git invocation regardless of perceived cwd; same for build commands and any other command that emits artifacts into a specific checkout.
- **Don't infer one git invariant from another**: `git status --porcelain` returning empty means no uncommitted edits — it doesn't mean origin matches HEAD (local commits made after a previous push leave clean tree + divergent origin). Symmetrically: "origin/<branch> exists" doesn't mean origin matches HEAD; the local remote-tracking ref can be stale if a prior fetch failed. The same shape applies beyond git ("branch is checked out" ≠ "worktree directory exists"; "PR exists" ≠ "PR is in the expected state"). The actual check is usually cheap; do it directly, don't infer from a related state. Full pitfall in `docs/patterns.md`.
- **A cross-cutting invariant belongs in one shared helper, not patched per call site**: When the same rule must hold at multiple enforcement points — every gate, every command, every writer of a field — implement it once as a shared helper that all sites call, rather than fixing the sites one at a time. The tell that you're under-consolidated: review findings come back round after round as the *same bug class at a new location* ("this gate doesn't enforce X" at site A, then B, then C). That is distinct from the design/size signal, where each round surfaces a genuinely *new* sub-problem (see the spec-review iteration-shape rule). When a finding is "site S doesn't enforce X," grep for every site that should enforce X *before* patching S; at ≥3 sites, extract the helper and route them all through it. Corollary: have the shared helper validate its own untyped inputs (type at-risk fields `unknown` so the compiler forces runtime checks) rather than trusting a type that a corrupt on-disk value can silently violate. Second corollary — **mirroring a resolution means calling the resolver**: a feature that operates on a path or state an existing resolver already computes must import and call that resolver (export it if private), never reconstruct the common-case default. A hand-rolled path literal or `existsSync` check silently drops the override / branch-lookup / tolerance semantics the real resolver carries, and works in every test that doesn't exercise those modes. Two canonical incidents in one release: a nudge spec'd against a `tasks/_templates/` literal missing `CANON_TASKS_DIR_OVERRIDE` (caught at spec_review), and a ship-path `resolveShipCwd` that approximated `getActiveCwd` with a dir-exists check, silently breaking bundle-secondary resolution (caught only at PR review).

## Review Responsibilities

**Code review** (after Codex implements):
- Run as the foreman over the anchored and cold lenses; do not collapse back to a single direct-review pass.
- Review the anchored lens output against the spec and Codex's `handoff.md`.
- Reconcile cold-lens findings against the spec before keeping or dismissing them.
- **CRITICAL**: Verify the entire PR against the *original spec*, actively checking for dropped sections or missing Acceptance Criteria.
- Focus on what Codex cannot self-verify: correctness bugs, edge cases, type safety, UX implications, architectural drift.
- Do not re-verify lint/type-check/test/build status that Codex already reported passing.

**Feedback format**: Label every comment as `correctness bug`, `risk/guardrail`, `optional cleanup/nit`, or `spec gap`. Be specific, actionable, and reference the relevant convention or code path. Code-bug findings go back to Codex. Spec gaps block for human amendment. Nits the human may choose to skip ride along with the `Approved with nits` verdict and surface at QA.

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
