# Spec: codex-code-review-phase — Opt-in Codex adversarial code-review phase after Claude approves

> Written by: Claude | Review by: Codex
> Status: draft (revival — supersedes the v1.5-era spec; see Revival Context)

## Revival Context

This task was specced and implemented against `release/v1.5`, then **parked** (not archived) at v1.5 ship-time. Two things changed since:

1. **The original motivation was partially undermined.** The first spec's Problem leaned on "manual `codex review` at PR-open catches lifecycle bugs Claude `code_review` approved." A chunk of that evidence was later traced to a *Claude bug*: when a pre-flight rejection occurred, the round-N prompt told Claude "Stage 1 already passed," so Claude wasn't actually re-verifying ACs. That bug was fixed (round-N now re-runs both stages from scratch). Post-fix, Claude `code_review` does real systematic AC verification every round, so the catch-rate delta a Codex pass adds on top is no longer assumed large.
2. **The design is being narrowed.** Rather than a default-on phase for all full-tier tasks with size-keyed model selection, this revival makes the phase **opt-in per task** and **mini-model-only**. It runs only when an operator explicitly asks for a cold adversarial second-reviewer pass on a task they judge worth it.

The operator has consciously chosen to revive **without** a formal "observe N tasks first" evidence window (the qualitative signal — "Codex has earned its keep" — is deemed sufficient). The opt-in + mini-only design bounds the downside: if the phase rarely earns its keep, its cost is incurred only when explicitly requested, so it self-limits rather than taxing every pipeline run.

The old implementation on branch `task/codex-code-review-phase` is a **reference only** — the orchestrator has churned ~4000 LOC since the merge-base and the design has changed. This spec drives a fresh implementation against the current tree.

## Problem

Claude `code_review` is shaped by canon's two-stage framing: Stage 1 verifies AC compliance + the validation gate as a checklist; Stage 2 hunts bugs *after* the checklist mindset is active. The reviewer is anchored on "does this match the spec?" — a happy-path lens that makes lifecycle / state-machine / consistency-across-paths bugs harder to surface.

A genuinely independent adversarial pass — a different agent, on a different prompt, reading the diff **cold with no spec anchor** — surfaces a different class of blind spot. Today, the only way to get that pass is for the operator to run `codex review` by hand at PR-open. That works but is (a) manual and easy to forget, and (b) happens *after* QA has already run against potentially-buggy code, so QA's "tests pass" signal can be misleading if a lifecycle bug slipped through.

For a delicate or lifecycle-heavy task, the operator may want this cold adversarial pass formalized into the pipeline — gated behind Claude approval (so Codex never reviews code that's about to change) and auto-rerouting on findings (so the bug is fixed before QA, preserving canon's "any implement cycle invalidates prior approvals" invariant). But it should not tax every task: most tasks don't need a second independent reviewer, and a full-model Codex pass on top of `spec_review` + `implement` is real cost.

The fix is an **opt-in** pipeline phase: when a task sets `codex_code_review: true`, then after Claude `code_review` returns `approved`/`approved_with_nits`, a mini-model Codex adversarial pass runs against the full diff with no spec context. P0/P1/P2 findings route back to implement; otherwise the pipeline advances to qa.

## Decision

Add a new pipeline phase `codex_code_review` between `code_review` and `qa` in `PHASE_ORDER`. The phase:

- Is **opt-in per task** via a new `status.json` boolean field `codex_code_review` (default `false`/absent). When the flag is not set, the phase is a **no-op skip** for that task — *regardless of task size or delicate status*. There is **no tier gate**: the operator's flag is the sole eligibility signal. An opted-in S task runs it; a non-opted-in XL/delicate task does not.
- When opted in, runs **only after Claude `code_review` returns `approved` or `approved_with_nits`**, never on intermediate Claude reroutes.
- Invokes `codex review --base <base_branch>` where `<base_branch>` is the task's recorded base (`status.json.base_branch`, the same value the `--pr` base-drift gate uses). Default Codex review prompt; **no custom prompt injection** — the adversarial framing comes from `codex review`'s built-in behavior. No `PROMPT` positional argument is passed.
- Parses Codex's stdout for findings by line prefix `- [P<n>] `, where `<n>` ∈ `{0,1,2,3}`. Derives verdict: any P0/P1/P2 → `changes_requested`; P3-only → `approved_with_nits`; no findings → `approved`.
- Writes findings to `tasks/<id>/codex-review.md`: the raw `codex review` stdout plus an orchestrator-appended verdict block (P-counts, verdict, base branch reviewed against, iteration number). Per-iteration history via `## Round N` append (no overwriting prior rounds).
- On `changes_requested`, reroutes to `implement` — same logic path as Claude's `code_review` reroute. After implement re-runs, the pipeline re-enters Claude `code_review` from scratch (existing PHASE_ORDER semantics); if Claude approves again, codex_code_review runs again. Iteration counters are per-phase and independent: `code_review.iterations_current_loop` and `codex_code_review.iterations_current_loop` each reset to 0 when their own phase returns approved/approved_with_nits, each capped by `MAX_REVIEW_LOOPS` (size-aware default).
- **Model: `codexModelMini` always**, at effort scaled by effective size (S/M → `medium`, L/XL → `high`). There is **no `codexModelFull` promotion** for this phase — even on XL/delicate. Rationale: XL/delicate tasks already spend `codexModelFull` on `spec_review` + `implement`; a third full-model Codex pass was the original cost concern. Mini keeps the adversarial-review value at much lower marginal cost.
- Is **intentionally non-resumable** (no `sessions.codex_code_review` slot) — `codex review` is a one-shot cold pass; each iteration runs fresh against current branch state.
- Bundle mode: the phase runs for the bundle if **any** task in the bundle sets `codex_code_review: true`. One `codex review --base <base_branch>` invocation against the bundle's shared base branch; the raw stdout is replicated to each opted-in task's `codex-review.md` and the verdict applied to each opted-in task. On `changes_requested`, the entire bundle reroutes (mirrors Claude `code_review` bundle behavior). Non-opted-in tasks in the bundle get the standard skip artifact.
- **Remove** the existing `code_review approved/approved_with_nits → qa` transition in `scripts/run-task/main.ts`'s dispatcher. The new advance path is `code_review approved → codex_code_review → qa`. The `codex_code_review` phase itself decides per-task whether to run the Codex pass or write a skip artifact, then advances to `qa`. Leaving both transitions in place produces a silent ordering bug where qa might run before codex_code_review.

### Why opt-in flag alone (no tier gate)?

The original design gated on tier (full-tier only) and made the phase default-on. This revival makes it opt-in and drops the tier gate. Reasoning, documented so spec_review doesn't re-litigate:

- **Opt-in already expresses proportionality.** The original tier gate existed to keep a default-on phase off low-blast-radius work. Once the phase is opt-in, the operator setting the flag *is* the proportionality decision. A second tier gate on top would only produce the surprising failure mode "I set the flag but it didn't run," plus an extra skip code path.
- **Trust operator intent.** An operator who sets `codex_code_review: true` on a small task knows they want a cold adversarial pass on it. The phase should honor that rather than second-guess it by size.
- **Simpler.** No `detectTier`-based branch in this phase; eligibility is a single boolean read.

### Why auto-reroute, not advisory-at-human-review?

(Unchanged from the original design — the reasoning still holds.) Advisory mode (run `codex review` but surface findings at `human_review` without auto-reroute) was considered and rejected:

1. **Preserves the "any implement cycle invalidates prior approvals" invariant.** Auto-reroute fixes the bug before QA; advisory lets QA run against buggy code, making "tests pass" misleading.
2. **Closes the loop instead of duplicating the manual workflow.** Advisory just runs the human's manual `codex review` for them; auto-reroute formalizes the fix loop.
3. **Costs are bounded and visible.** Iteration doubling and bundle reroute amplification are real but capped by `MAX_REVIEW_LOOPS` and visible in telemetry; advisory hides the same cost as invisible reviewer fatigue.
4. **Reversibility.** Auto-reroute → advisory is a one-PR change later; the reverse requires re-deciding iteration semantics from scratch.

## Non-Goals

- **Default-on / always-run.** The phase never runs unless a task opts in. This inverts the original spec's "Per-task opt-out" non-goal: opt-in is now the model.
- **Tier-based eligibility.** No `detectTier` gate. Size and delicate status do not affect whether the phase runs — only the flag does. (Size still affects effort selection when it *does* run.)
- **A global env-var disable switch.** The original `CODEX_CODE_REVIEW_DISABLED` env var is dropped. With opt-in, "don't run it" is just "don't set the flag," so a global kill-switch is redundant. (A future global toggle, if ever needed, would be a separate change.)
- **`codexModelFull` for any size.** Mini-only, by design. If catch rate on XL/delicate proves to need a stronger model, that's a one-line follow-up — but the default is mini.
- **Customizing the Codex review prompt.** The framing benefit is "Codex sees the diff cold." Adding spec context, AC anchors, or canon framing defeats the purpose. `codex review --base <base_branch>` with default behavior; no PROMPT positional arg.
- **Parallel review with Claude.** Codex runs only after Claude approves — never alongside, never on intermediate Claude reroute cycles.
- **Skipping Claude on Codex-triggered reroutes.** When Codex returns changes_requested, the next cycle goes implement → Claude `code_review` → (if approved) → Codex `codex_code_review`. Claude re-reviews from scratch. Skipping it would break the "any implement cycle invalidates prior approvals" invariant.
- **Commit-SHA / "last Codex-approved baseline" scoping.** The review covers the full task delta from `base_branch` on every iteration. No `phases.implement.commit_sha` field is introduced. (Re-review cost is a bounded, accepted tradeoff — see Known Risks.)
- **Migrating existing in-flight tasks.** Tasks created before this ships won't have `phases.codex_code_review` or the `codex_code_review` flag in status.json. The orchestrator reads both as default (absent flag → false → skip; absent phase entry → default empty). No migration script.

## Acceptance Criteria

### Schema, types, and the opt-in flag

- [ ] **AC-1**: `PHASE_ORDER` in `scripts/run-task/types.ts` includes `'codex_code_review'` between `'code_review'` and `'qa'`. Full order: `['spec', 'spec_review', 'plan', 'implement', 'code_review', 'codex_code_review', 'qa', 'human_review']`.
- [ ] **AC-2**: `Phase` type (derived from `typeof PHASE_ORDER[number]`) includes `'codex_code_review'`; all downstream usages (PhaseEntry, dispatcher cases) compile clean.
- [ ] **AC-3**: The `codex_code_review` opt-in flag is added to the `StatusJson` type (top-level optional boolean, sibling of `delicate`/`full_send`), defaulting to `false` when absent. Document inline that absence ⇒ phase skipped.
- [ ] **AC-4**: `.canon/templates/status.json` includes (a) the top-level `"codex_code_review": false` flag with a brief `_codex_code_review` doc line explaining opt-in semantics, and (b) a `phases.codex_code_review` entry with shape `{ status: 'pending', agent: 'codex', verdict: '', iterations: 0, iterations_current_loop: 0, iterations_total: 0, changes_requested_total: 0, auto_block_count: 0 }`. The existing `_verdict_values` block already covers all codex_code_review verdicts (unchanged).
- [ ] **AC-5**: `canon task new` scaffolds new tasks with both the top-level `codex_code_review: false` flag and the `phases.codex_code_review` entry (per AC-4 defaults).
- [ ] **AC-6**: `canon task phase <id> codex_code_review <status> [verdict]` accepts the new phase name and updates the phase entry; invalid usage rejected with the existing error format. Specifically, `src/task/index.ts` adds `'codex_code_review'` to the `REVIEW_PHASES` set (currently `{spec_review, code_review}`), updates the `assertValidVerdict` error message to read "verdict is only valid for spec_review, code_review, and codex_code_review phases", and the existing `updateReviewCounters` call site (guarded by `REVIEW_PHASES.has(phaseArg)`) fires for codex_code_review verdicts.
- [ ] **AC-6a (pre-flight rejection interaction)**: Adding `codex_code_review` to `REVIEW_PHASES` also makes it eligible for `taskPhasePreflightRejected` (the pre-flight rejection path keyed off `REVIEW_PHASES` in `src/task/index.ts`). This is **intentional and accepted** — codex_code_review is a genuine review phase, so pre-flight rejection applying to it is consistent. Document the coupling inline so a future reader knows it's deliberate, not accidental. No separate pre-flight set is introduced.
- [ ] **AC-7**: `deriveTopLevelStatus` walks the updated `PHASE_ORDER` and identifies `codex_code_review` as the current phase when prior phases are done. (Likely no code change — data-driven; verify.)
- [ ] **AC-7a (non-resumable phase)**: `codex_code_review` is **intentionally non-resumable**. No `sessions.codex_code_review` slot is added to `StatusJson.sessions` or `.canon/templates/status.json`. Rationale: the `runCodexReview` helper (AC-10) does not consume the `codex exec --json` event stream that produces `thread.started.thread_id`, so there is no session ID to store; and the value is a *cold adversarial pass* — resuming a partial session defeats the framing benefit. Document the non-resumable choice inline in `runCodexCodeReviewPhase`.

### Phase implementation

- [ ] **AC-8**: New module `scripts/run-task/phases/codex-code-review.ts` exports `runCodexCodeReviewPhase(state: PipelineState, interactive: boolean, resumeId: string | null): Promise<PhaseRunResult>`. (Match the current signature shape of the sibling phase modules — verify against `scripts/run-task/phases/code-review.ts` at implement time; "mechanics deferred" where the current signature differs from this sketch.)
- [ ] **AC-8a (opt-in skip)**: When **no** task in scope has `codex_code_review === true`, the phase writes the skip artifact (AC-13a) to each task's `codex-review.md`, marks `phases.codex_code_review.status = 'done'` and `verdict = 'approved'` **without invoking the Codex CLI**, and advances to `qa`. Skip reason text: `not opted in (codex_code_review flag not set)`.
- [ ] **AC-9 (review scope)**: When at least one task is opted in, the phase invokes `codex review --base <base_branch>` where `<base_branch>` is read from `status.json.base_branch`. No commit-SHA scoping; the review covers the full task delta against the base branch so commits Claude rejected in earlier `code_review` cycles are not skipped.
- [ ] **AC-9d (CLI invocation failure)**: If the `codex` CLI exits non-zero (binary missing, network, auth, timeout), the phase fails closed: marks `phases.codex_code_review.status = 'blocked'`, writes stderr (truncated to 4KB) into `codex-review.md` under a `### CLI Failure` heading, exits with code 2. Does **not** mark verdict = approved (would mask outages). Recovery: re-run after fixing the CLI environment.
- [ ] **AC-10 (runner API)**: A **new** exported helper in `scripts/run-task/agents/codex.ts` invokes `codex review`. The existing `runCodex(prompt, …)` requires a non-empty prompt and routes through `codex exec`, neither of which fits `codex review`. Signature: `runCodexReview(args: { baseBranch: string; cwd: string; model: string; effort: string; metricsContext?: { taskId: string; phase: string; iteration?: number; activeCwd?: string } }): Promise<{ exitCode: number; stdout: string; stderr: string }>`. It invokes `codex` with argv `['-m', model, '-c', 'model_reasoning_effort=<effort>', 'review', '--base', baseBranch]` from `cwd` — **model and effort are top-level flags before the `review` subcommand** (`codex review -m <model>` is invalid; the `review` subcommand has no `-m`). Verify this invocation against the currently installed `codex` CLI at implement time (the CLI version in the original snapshot may differ from current). Captures stdout+stderr, records the standard metrics tuple via `recordMetric`, returns the raw result without exiting on non-zero (caller handles failure per AC-9d). Does **not** modify `runCodex`.
- [ ] **AC-11**: Severity parser `parseCodexReviewSeverities(output: string): { P0: number; P1: number; P2: number; P3: number }` counts matches of regex `^- \[P([0-3])\] ` (multiline, global) on stdout. Exported and unit-tested.
- [ ] **AC-12**: Verdict derivation `deriveCodexCodeReviewVerdict(counts): 'approved' | 'approved_with_nits' | 'changes_requested'`: any P0/P1/P2 > 0 → `changes_requested`; P3 > 0 and P0/P1/P2 = 0 → `approved_with_nits`; all zero → `approved`. Exported and unit-tested.
- [ ] **AC-13**: `tasks/<id>/codex-review.md` is written with the raw `codex review` stdout as the iteration body, followed by a fenced orchestrator-appended verdict block:
  ````
  ## Round N

  <raw codex review stdout>

  ### Verdict (orchestrator-computed)
  - P0: 0
  - P1: 0
  - P2: 1
  - P3: 2
  - Verdict: changes_requested
  - Base branch reviewed: main
  - Iteration: 1
  ````
  Subsequent iterations append `## Round N+1` rather than overwriting.
- [ ] **AC-13a (skip artifact)**: On the opt-in skip path (AC-8a), the orchestrator writes a minimal `codex-review.md` whose `### Verdict (orchestrator-computed)` block parses cleanly via `extractCodexReviewVerdict` and matches the status.json verdict, so the phase gate (AC-14a) holds **without exemption**. Shape:
  ````
  ## Round 1

  (skipped — not opted in (codex_code_review flag not set), no Codex review performed)

  ### Verdict (orchestrator-computed)
  - P0: 0
  - P1: 0
  - P2: 0
  - P3: 0
  - Verdict: approved
  - Base branch reviewed: <base_branch> (skipped)
  - Iteration: 1
  ````
  The artifact is *not* a template per `isTemplateUnfilled` (real prose + populated verdict block). Rationale: a uniform gate is simpler and more auditable than a gate exemption.
- [ ] **AC-14**: On phase completion, `status.json.phases.codex_code_review.verdict` is set to the derived verdict and `status` to `done`.
- [ ] **AC-14a (phase gate)**: `PHASE_GATE_CONFIG` in `scripts/run-task/validation.ts` gains a `codex_code_review` entry enforcing, when the phase is advanced to `done` (by operator **or** orchestrator, including the skip path which satisfies the gate via the AC-13a artifact — **no exemption**):
  1. **Artifact present**: `tasks/<id>/codex-review.md` exists and is non-template (`isTemplateUnfilled`).
  2. **Verdict required**: a verdict argument is supplied.
  3. **Verdict matches artifact**: the verdict in the artifact's most recent `### Verdict (orchestrator-computed)` block (`- Verdict: <value>`) equals the verdict argument.
  Property (3) can't reuse `extractCheckedVerdict()` (codex-review.md uses a `- Verdict:` line, not a checkbox). Extend `PhaseGateConfig` with optional `verdictExtractor?: (content: string) => string | null`; if set, `checkPhaseGate` calls it instead of `extractCheckedVerdict`. Add exported `extractCodexReviewVerdict(content: string): string | null` that locates the **last** `### Verdict (orchestrator-computed)` block and returns the value after `- Verdict: `. Wire: `codex_code_review: { artifactName: 'codex-review.md', requiresVerdict: true, verdictMustMatchArtifact: true, verdictExtractor: extractCodexReviewVerdict }`.

### Orchestration and routing

- [ ] **AC-15**: The dispatcher in `scripts/run-task/main.ts` advances to `codex_code_review` after `code_review` returns `approved`/`approved_with_nits`. On `changes_requested` from Claude, the existing reroute logic still routes back to implement; codex_code_review does not run. The old `code_review → qa` transition is removed (see Decision).
- [ ] **AC-17**: When `codex_code_review` returns `changes_requested`, the orchestrator reroutes to `implement` using the same reroute reset logic Claude `code_review` uses (reset `implement`, `code_review`, `codex_code_review`, `qa` to `pending`; preserve iteration counters per `--reroute` semantics).
- [ ] **AC-18**: `codex_code_review.iterations_current_loop` increments on each *non-skip* phase run; resets to 0 when verdict is `approved`/`approved_with_nits`. `iterations_total` increments on each non-skip run. Auto-block fires when `iterations_current_loop >= MAX_REVIEW_LOOPS` (same size-aware default as code_review). The opt-in skip path does not increment iteration counters.
- [ ] **AC-19**: Auto-block error message for codex_code_review references `tasks/<id>/codex-review.md` (not `review.md`); recovery steps mention `phases.codex_code_review.iterations_current_loop = 0`. Per project policy the message should note that hitting the cap on codex_code_review often indicates a spec-level issue rather than implementation churn.
- [ ] **AC-19a (dry-run output)**: `printDryRunPlan` in `scripts/run-task/main.ts` is extended so that on an **opted-in** task it lists `codex_code_review: Codex / <model> / <effort>` between `code_review` and `qa`, and on a **non-opted-in** task the line is omitted (or shown as "skipped — not opted in"). The gate is the flag, not tier. Without this, `getCodexConfig('codex_code_review', tasks)` would fall through silently and the planned phase wouldn't appear in the operator preview.

### Bundle mode

- [ ] **AC-23**: In bundle mode, the Codex pass runs if **any** bundled task has `codex_code_review: true`. One `codex review --base <base_branch>` invocation against the bundle's shared base branch.
- [ ] **AC-24**: The same raw output is written to each **opted-in** task's `tasks/<id>/codex-review.md` (with task-specific round headers). Non-opted-in tasks in the bundle receive the AC-13a skip artifact.
- [ ] **AC-25**: The bundle-level verdict is applied to every **opted-in** task's `phases.codex_code_review.verdict`. If `changes_requested`, the whole bundle reroutes (every task's implement returns to `pending`, mirroring Claude `code_review` bundle behavior).

### Pipeline policy

- [ ] **AC-26**: `scripts/pipeline-policy.ts` adds `'codex_code_review'` to the `CodexPhase` type and a matching `codexMatrix` row, **mini-model for every size**:
  - S: `{ model: codexModelMini, effort: 'medium' }`
  - M: `{ model: codexModelMini, effort: 'medium' }`
  - L: `{ model: codexModelMini, effort: 'high' }`
  - XL: `{ model: codexModelMini, effort: 'high' }`
  No `codexModelFull` entry for any size (contrast `spec_review`/`implement`, which promote XL to full).
- [ ] **AC-27**: `getCodexConfig('codex_code_review', tasks)` returns mini at the size-appropriate effort. Delicate (which elevates effective size to XL) still resolves to `{ codexModelMini, 'high' }` — i.e., delicate raises effort to `high` but does **not** promote the model to full for this phase.

### Tests

- [ ] **AC-30**: New test file `tests/codex-code-review-phase.test.ts` covers `parseCodexReviewSeverities`:
  - Empty string → all zeros.
  - "No findings" prose only (e.g. "I did not find a discrete correctness issue introduced by the patch.") → all zeros.
  - Single P2 finding → `{ P0: 0, P1: 0, P2: 1, P3: 0 }`.
  - Mixed P0/P1/P2/P3 → correct counts.
  - `- [P5]` (invalid digit) or `[P2]` without `- ` prefix → not counted.
  - `- [P2] ` mid-content (code block / quote) → counted (accepted false positive; parser is line-prefix-based by design).
- [ ] **AC-31**: New cases in `tests/pipeline-policy.test.ts`:
  - codex_code_review × {S, M, L, XL} → expected **mini** model + effort.
  - delicate M → effort `high`, model still **mini** (no full promotion).
- [ ] **AC-32**: Verdict-derivation tests (same file as AC-30) cover all three outcomes per AC-12.
- [ ] **AC-32a (task CLI verdict coverage)**: Tests in the existing `canon task phase` test file (locate via `grep -l "assertValidVerdict\|REVIEW_PHASES" tests/`; create a new file only if none fits) cover:
  - `canon task phase <id> codex_code_review done approved` accepts and writes the verdict.
  - `... done changes_requested` increments `iterations_current_loop`, `iterations_total`, `changes_requested_total`.
  - `... done approved` after a prior `changes_requested` resets `iterations_current_loop` to 0 and increments `iterations_total`.
  - The updated `assertValidVerdict` error text lists all three review phases.
- [ ] **AC-32b (phase gate coverage)**: Tests in the existing phase-gate test file (`grep -l "checkPhaseGate\|PHASE_GATE_CONFIG" tests/`) cover:
  - `extractCodexReviewVerdict` returns the value on well-formed single- and multi-round artifacts; returns the **last** block's value on multi-round; returns `null` when no verdict block exists.
  - `checkPhaseGate('<task>', 'codex_code_review', 'approved')` → `{ ok: false }` when `codex-review.md` is missing.
  - `checkPhaseGate` → `{ ok: false }` with a verdict-mismatch reason when the artifact's last verdict differs from the argument.
  - `checkPhaseGate` → `{ ok: true }` when artifact exists, is non-template, and last verdict matches.
  - `checkPhaseGate` → `{ ok: true }` for the AC-13a skip artifact (skip body + `Verdict: approved`), confirming the uniform gate covers the skip path without exemption.
- [ ] **AC-32c (opt-in skip routing test)**: A test (in `tests/codex-code-review-phase.test.ts` or the harness test file) confirms that when no task is opted in, the phase writes the skip artifact, sets verdict `approved`, does not invoke the Codex CLI, and advances to `qa` — and that when a task is opted in, the Codex path is taken. Mock/stub the `runCodexReview` helper to assert it is/ isn't called.

### Docs

- [ ] **AC-33**: `docs/pipeline-orchestrator.md`: PHASE_ORDER references reflect the new phase; Codex model-matrix table adds the `codex_code_review` row (mini-only); the opt-in flag (`codex_code_review` in status.json) is documented; "Review Loops & Auto-block" notes both code_review and codex_code_review have independent counters (worst-case 2× ceiling). Remove any mention of a `CODEX_CODE_REVIEW_DISABLED` env var (it does not exist in this design).
- [ ] **AC-34**: `CLAUDE.md` "Review Responsibilities" notes that codex_code_review runs after Claude approves **when a task opts in**; Claude code_review behavior is unchanged but documented as the first stage of a (conditionally) two-agent review.
- [ ] **AC-35**: `AGENTS.md` updated where phase order / codex CLI invocations / review flow are documented, including the opt-in flag.
- [ ] **AC-36**: `CODEX.md` updated to describe codex_code_review responsibilities (default review prompt, no spec injection, output format expectations).
- [ ] **AC-37**: `docs/codebase-map.md` updated with the new phase module (`scripts/run-task/phases/codex-code-review.ts`).
- [ ] **AC-38**: `templates/` mirror updated for every changed canon-managed file; `npm run sync-templates:check` passes. (Per the canon-managed convention, edit root, let the pre-commit sync stage templates.)
- [ ] **AC-39**: `npm run docs-refs-check` passes (no broken refs from the new file path).
- [ ] **AC-40**: `CHANGELOG.md` gets a new bullet under the current unreleased `### Added` describing the opt-in phase, the `codex_code_review` flag, mini-only model, and the cold-spec rationale (one paragraph max).

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/types.ts` | Add `'codex_code_review'` to `PHASE_ORDER`; add optional `codex_code_review?: boolean` to `StatusJson`. Verify `Phase`/`PhaseEntry` derivations propagate. No `StatusJson.sessions` change (AC-7a). |
| `scripts/run-task/phases/codex-code-review.ts` | **New file**. Exports `runCodexCodeReviewPhase`. Reads per-task `codex_code_review` flag; if none opted in, writes skip artifact + advances; else reads `base_branch`, calls `runCodexReview`, parses output, writes `codex-review.md`, sets verdict. |
| `scripts/run-task/agents/codex.ts` | Add exported `runCodexReview(args)` invoking `codex -m <model> -c model_reasoning_effort=<effort> review --base <base_branch>` from task cwd; capture stdout+stderr; record metrics; return raw result without exiting on non-zero. Do **not** modify `runCodex`. |
| `scripts/run-task/main.ts` | Dispatcher: route to codex_code_review after code_review approves; reroute target on changes_requested. Extend `printDryRunPlan`'s Codex-phase branch to include codex_code_review gated on the opt-in flag (AC-19a). No `autoCommitCode` change (no SHA tracking). No `checkDeps` change (Codex binary already required for spec_review/implement). No `sessions` resumption change (AC-7a). |
| `scripts/run-task/state.ts` | Verify `deriveTopLevelStatus` walks new PHASE_ORDER correctly (likely no code change). |
| `scripts/run-task/check-phase-gate.ts` | Verify `--expect codex_code_review` works (likely no code change — PHASE_ORDER-driven). |
| `scripts/pipeline-policy.ts` | Add `'codex_code_review'` to `CodexPhase`; add mini-only `codexMatrix` row (AC-26). |
| `scripts/run-task/validation.ts` | Add `parseCodexReviewSeverities`, `deriveCodexCodeReviewVerdict`, `extractCodexReviewVerdict`. Extend `PhaseGateConfig` with optional `verdictExtractor`. Add `codex_code_review` entry to `PHASE_GATE_CONFIG`. Extend `checkPhaseGate` to use `verdictExtractor` when present, else `extractCheckedVerdict`. |
| `src/task/index.ts` | Add `'codex_code_review'` to `REVIEW_PHASES`; update `assertValidVerdict` error text to list all three review phases. Note the intentional pre-flight-rejection coupling (AC-6a). PHASE_ORDER-driven validation already handles the name. |
| `.canon/templates/status.json` | Add top-level `codex_code_review: false` flag (+ doc line) and `phases.codex_code_review` entry. |
| `templates/.canon/templates/status.json` | Mirror (auto-synced). |
| `tests/codex-code-review-phase.test.ts` | **New file**. Severity parser + verdict derivation + opt-in routing tests. |
| `tests/pipeline-policy.test.ts` | Add codex_code_review matrix rows (mini-only; delicate stays mini). |
| `tests/` (canon-task-phase + phase-gate test files — locate per AC-32a/32b) | Add task-CLI verdict and phase-gate cases. |
| `docs/pipeline-orchestrator.md` | PHASE_ORDER, model matrix row, opt-in flag, review-loop note. |
| `templates/docs/pipeline-orchestrator.md` | Mirror (auto-synced). |
| `CLAUDE.md` / `templates/CLAUDE.md` | Review Responsibilities note (opt-in two-agent review). |
| `AGENTS.md` / `templates/AGENTS.md` | Phase order / review flow / opt-in flag. |
| `CODEX.md` / `templates/CODEX.md` | codex_code_review responsibilities section. |
| `docs/codebase-map.md` / `templates/docs/codebase-map.md` | New phase module entry. |
| `CHANGELOG.md` | New bullet under unreleased → Added. |
| `dist/cli/index.js`, `dist/scripts/run-task.js` | Build-generated; regenerated by `npm run build`, committed to satisfy CI's `git diff --exit-code -- dist/` gate. No hand edits. |

> Mechanics deferred: exact phase-module signature, helper-internal seams, and constant names are left to plan/implement against the current tree — the sibling phase modules and `runCodex` have likely drifted from the original snapshot. ACs above state observable behavior and contracts; verify symbol shapes at implement time.

### Interaction Dependencies

- **Reroute machinery (`canon run --reroute`)**: existing reroute resets `implement`, `code_review`, `qa` to pending. Extend to also reset `codex_code_review`.
- **Bundle mode**: existing bundle dispatch runs one agent session for code_review across tasks. codex_code_review reuses the pattern (one CLI call, output replicated to opted-in tasks).
- **Session resumption**: `codex_code_review` is intentionally non-resumable (AC-7a). No `sessions.codex_code_review` slot.
- **Pre-flight rejection**: adding to `REVIEW_PHASES` couples codex_code_review into the pre-flight rejection path — intentional (AC-6a).
- **`canon task accept`**: today supports `implement` only. Out of scope to extend to codex_code_review; an operator who doesn't want the phase on a task simply leaves the flag unset.
- **Quality log (`docs/task-quality-log.md`)**: column schema unchanged.

### Data Model Changes

- `Phase` union: adds `'codex_code_review'`.
- `StatusJson`: adds optional top-level `codex_code_review?: boolean` (opt-in flag).
- `StatusJson.phases.codex_code_review`: new phase entry (same shape as `code_review`).
- `StatusJson.sessions`: no change (non-resumable).

No migration for in-flight tasks: absent flag reads as false (skip); absent phase entry reads as default empty on first dispatch.

## Validation Required

- [x] Linting (`npm run lint`)
- [x] Type checking (`npm run type-check`) — schema/type additions affect inference across the orchestrator
- [x] Unit tests (`npm test`) — new parser/verdict/routing tests + extended policy tests
- [x] Full build (`npm run build`) — changes `scripts/run-task/**` + `scripts/pipeline-policy.ts` (bundled into `dist/`); committed `dist/` must match a fresh build
- [x] Docs references (`npm run docs-refs-check`) — new file path referenced from docs
- [x] Canon-managed template sync (`npm run sync-templates:check`) — multiple canon-managed root files change; `templates/` mirrors must stay in sync
- [ ] End-to-end tests — N/A per `docs/architecture.md` (no E2E surface in canon-ai)

## Docs Impact

- `docs/pipeline-orchestrator.md` (PHASE_ORDER, model matrix, opt-in flag, review-loop note)
- `docs/codebase-map.md` (new phase module)
- `CLAUDE.md`, `AGENTS.md`, `CODEX.md` (phase ordering, review responsibilities, opt-in)
- `.canon/templates/status.json` (flag + phase entry)
- `CHANGELOG.md` (unreleased → Added)

All listed canon-managed files require matching `templates/` updates per the canon-managed file convention.

## Known Risks

- **Opt-in adoption risk.** The phase only earns its keep if operators remember to set `codex_code_review: true` on the tasks that benefit (delicate / lifecycle-heavy / state-machine work). If the flag is never set, the phase is inert. This is an accepted tradeoff for the revival — the alternative (default-on) was the original design whose cost/benefit is now in question. Mitigation: document *when to opt in* in CLAUDE.md/AGENTS.md (delicate or lifecycle-heavy tasks where a cold adversarial second reviewer pays off).
- **Evidence gate consciously bypassed.** The parked-task recovery plan called for observing 5–10 tasks before reviving. The operator chose to proceed on qualitative signal instead. If catch rate proves low, the cost is opt-in-bounded (only opted-in tasks pay), so it self-limits rather than taxing every run. Re-evaluate via `docs/task-quality-log.md` after the first several opted-in tasks; if Codex consistently finds nothing Claude missed, the follow-up is to stop opting in (no code change needed) or remove the phase.
- **Codex CLI output-format brittleness.** The severity parser depends on `codex review` emitting lines starting with `- [P<n>] `. A future CLI release changing the format silently miscounts. Mitigation: parser tests pin the current format; document the format-dependence near the regex. Also re-verify the `codex review` invocation flags (AC-10) against the *currently installed* CLI at implement time — the original snapshot's CLI version may differ.
- **Iteration counter doubling.** Worst case: `MAX_REVIEW_LOOPS` Claude iterations + `MAX_REVIEW_LOOPS` Codex iterations, with every Codex reroute triggering a fresh Claude re-review (≤ `MAX_REVIEW_LOOPS²` Claude iterations in the absolute worst case). In practice tasks converge well below; hitting the cap signals a deeper spec/impl issue and auto-block is correct. Note this in the auto-block message.
- **Bundle false-positive surface.** A P2 affecting one opted-in task reroutes the whole bundle (matches existing Claude `code_review` bundle behavior). If over-blocking, the answer is "don't bundle" rather than weakening the gate.
- **Cold-spec adversarial framing is the *value*, not a bug.** Reviewers may instinctively suggest passing the spec into the Codex invocation "for context." Resist — it defeats the purpose. This is a Non-Goal for a reason; the Codex invocation must not see the spec.
- **Re-review cost from `--base` scoping.** Reviewing the full task delta every Codex iteration re-examines previously-reviewed hunks. Deliberate tradeoff vs. a "last Codex-approved SHA" mechanism (rejected as more complex). If telemetry later shows material cost, the follow-up is recording a last-approved SHA and reviewing `<approved-SHA>..HEAD`. Out of scope here.
- **Chicken-and-egg.** This task's own pipeline run will not include codex_code_review (the phase doesn't exist until it merges). In-flight tasks created before merge read the absent flag as false (skip) and the absent phase entry as default empty — no crash.

## Human Test Plan

> Steps for the product owner. Tests the pipeline as a whole, not the implementation.

1. **Opt-in M task runs the phase.** Spec an M task, set `codex_code_review: true` in its status.json, run the pipeline. After completion confirm `phases.codex_code_review` shows `status: done` with a verdict and `tasks/<id>/codex-review.md` contains raw Codex output + a verdict block.
2. **Non-opted-in task skips it (any size).** Run an XL/delicate task with the flag unset. Confirm `phases.codex_code_review.status = done`, `verdict = approved`, the pipeline log shows codex_code_review "skipped — not opted in," and `codex-review.md` holds the minimal skip artifact (`(skipped — not opted in …)` body + `Verdict: approved`) — no Codex CLI was invoked. This confirms there is no tier gate forcing it on large tasks.
3. **Opted-in delicate task catches a planted bug.** Spec a delicate L task with `codex_code_review: true` and an obvious lifecycle bug (e.g. a buffer not re-armed on failure). Confirm Codex catches it (verdict `changes_requested`, P2 in `codex-review.md`), reroutes to implement, and it's fixed on the next iteration. Confirm the model used was the **mini** model, not full (check the dry-run plan or metrics).
4. **Reroute counter independence.** Force Claude `code_review` to reroute twice then approve on an opted-in task. Confirm `code_review.iterations_current_loop` reset to 0 after approval and `codex_code_review.iterations_current_loop` starts at 0 (independent). Codex reviews the full task delta from `base_branch`, including commits Claude rejected earlier.
5. **Bundle with mixed opt-in.** Bundle two M tasks, only one with the flag set. Confirm the opted-in task gets real Codex output and the other gets the skip artifact; if Codex reroutes, both tasks' implement returns to `pending`.
6. **Quality-log audit after several opted-in tasks.** Check `docs/task-quality-log.md`. Are codex_code_review's P0/P1/P2 findings real bugs Claude `code_review` missed? If yes, opting in is paying off. If consistently no, stop opting in (or file a follow-up to retire the phase).

---

## Spec Quality Checklist

> Claude: complete this before marking spec done.

- [x] Every AC states how to verify it (file path, function name, expected behavior)
- [x] Affected Files lists specific files with specific change descriptions
- [x] Known Risks covers failure modes for the trickiest ACs (parser brittleness, counter doubling, chicken-and-egg, bundle amplification, framing-anchor temptation, opt-in adoption, evidence bypass)
- [x] Human Test Plan uses product/behavior language only
- [x] Validation Required has at least one entry marked `- [x]`
