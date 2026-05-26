# Spec: codex-code-review-phase — Codex adversarial code-review phase after Claude approves

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

Claude `code_review` (Sonnet at S/M, Opus at L/XL/delicate post-2026-05-26) is shaped by canon's two-stage review framing: Stage 1 verifies AC compliance + validation gate as a checklist; Stage 2 hunts bugs *after* the checklist mindset has been activated. The reviewer is anchored on "does this match the spec?" — a happy-path lens that makes lifecycle / state-machine / consistency-across-paths bugs hard to see.

Empirically, on the most recent delicate L task, every buffer-leak / lifecycle bug landed in the PR was caught by manual `codex review --uncommitted` runs *after* the pipeline's code_review approved. The pipeline's code_review approved each iteration and the operator re-found the next bug each time. Canon is **functionally relying on the human to run `codex review`** to catch the bugs it misses — a workflow gap masquerading as a quality control step.

Per the orchestrator analysis, three orthogonal factors make local `codex review` catch what pipeline reviewers miss: **framing** (Codex's default review prompt is purely adversarial, not AC-checklist-then-bug-hunt), **no spec anchor** (reading the diff cold forces lifecycle derivation from code, not from spec's happy path), and **model/prompt independence** (a different agent on a different prompt surfaces different blind spots).

The fix is to formalize the manual workflow as a pipeline phase: after Claude `code_review` returns `approved`/`approved_with_nits`, a Codex adversarial pass runs against the diff with no spec context. If Codex finds P0/P1/P2 issues, route back to implement. The phase is gated on Claude approval (so Codex never reviews code that's about to change), scoped to the **full task delta from `base_branch`** (so commits Claude rejected in earlier cycles — which still sit in the branch history because each implement reroute appends a new commit rather than rewriting prior ones — are not silently skipped), and tier-gated like Codex spec_review (skipped on S non-delicate, run on full tier). The cost of this scoping is that on each Codex iteration the previously-reviewed portions of the diff are re-examined; this is bounded by `MAX_REVIEW_LOOPS` and considered an acceptable tradeoff against the alternative "last Codex-approved baseline" scheme, which would require a separate state machine to track which commits Codex has already cleared.

## Decision

Add a new pipeline phase `codex_code_review` between `code_review` and `qa` in `PHASE_ORDER`. The phase:

- Runs **only after Claude `code_review` returns `approved` or `approved_with_nits`**, never on intermediate Claude reroutes.
- Is **skipped on fast tier** (S non-delicate) — same gate as Codex `spec_review`.
- Invokes `codex review --base <base_branch>` where `<base_branch>` is the task's recorded base (`status.json.base_branch`, the same value the `--pr` base-drift gate uses). Default Codex review prompt; no custom prompt injection — the adversarial framing comes from `codex review`'s built-in behavior. No `PROMPT` positional argument is passed.
- Parses Codex's stdout for findings by line prefix `- [P<n>] `, where `<n>` ∈ `{0,1,2,3}`. Derives verdict: any P0/P1/P2 → `changes_requested`; P3-only → `approved_with_nits`; no findings → `approved`.
- Writes findings to `tasks/<id>/codex-review.md`, with the raw `codex review` stdout plus an orchestrator-appended verdict block (P-counts, verdict, base branch reviewed against, iteration number). Per-iteration history via `## Round N` append (no overwriting prior rounds).
- On `changes_requested`, reroutes to `implement` — same logic path as Claude's `code_review` reroute. After implement re-runs, the pipeline re-enters Claude `code_review` from scratch (existing PHASE_ORDER semantics); if Claude approves again, codex_code_review runs again. Iteration counters are per-phase: Claude's `code_review.iterations_current_loop` and Codex's `codex_code_review.iterations_current_loop` are independent, each reset to 0 when its own phase returns approved/approved_with_nits, each capped by `MAX_REVIEW_LOOPS` (3 for S/M, 5 for L/XL).
- Pipeline policy: `codex_code_review` mirrors `spec_review`'s Codex matrix — `codexModelMini` for M/L (effort medium/high), `codexModelFull` for XL/delicate (effort high). Same env vars (`CODEX_MODEL_MINI`, `CODEX_MODEL_FULL`).
- Escape hatch: `CODEX_CODE_REVIEW_DISABLED=true` env var makes the phase a no-op — marks done with verdict `approved`, no Codex CLI invocation, no `codex-review.md` written. Useful for debugging when codex_code_review itself is masking another issue or for iterating fast on an unrelated phase. **Not** an outage-recovery tool for the Codex CLI — `checkDeps()` still requires `codex` because full-tier runs also invoke Codex for `spec_review` and `implement`. If the Codex binary is genuinely unreachable, the run cannot proceed regardless of this flag, and the appropriate remediation is fixing the CLI environment.
- Bundle mode: one `codex review --base <base_branch>` invocation against the bundle's shared base branch (every bundle task shares the same base by construction). The full stdout is replicated to each task's `codex-review.md`. The bundle-level verdict is applied to every task. If `changes_requested`, the entire bundle reroutes (mirrors Claude `code_review` bundle behavior).
- **Remove** the existing `code_review approved/approved_with_nits → qa` transition in `scripts/run-task/main.ts`'s dispatcher. The new advance path is `code_review approved → codex_code_review → qa` (or `→ qa` directly on fast-tier skip). Codex must delete the old transition; leaving both paths in place produces a silent ordering bug where qa might run before codex_code_review on some branch.

### Why auto-reroute, not advisory-at-human-review?

An intermediate alternative was considered: run `codex review` automatically at the new phase, but surface findings to the human at `human_review` (no auto-reroute, no iteration counter doubling, no bundle-mode reroute amplification). It's meaningfully simpler and was explicitly rejected during scoping. Reasons documented here so future readers / Codex spec_review don't re-litigate:

1. **The "any implement cycle invalidates prior approvals" invariant.** Canon's existing code_review prompt re-runs both Stage 1 and Stage 2 from scratch after every implement reroute, because re-implementation can shift ACs and break previously-approved tests. Advisory mode breaks this invariant — the human reviews findings at `human_review` *after* QA has already run against potentially-buggy code; QA's "test ran clean" signal is misleading if a lifecycle bug went undetected.
2. **Formalizing the workflow, not duplicating it.** The Problem statement is that canon is *functionally relying* on the human to run `codex review` post-pipeline. Advisory mode preserves that workflow shape (human reviews findings, manually decides whether to reroute) — it just runs the codex review on the human's behalf. Auto-reroute closes the loop entirely; advisory leaves the operator in it.
3. **Iteration counter doubling and bundle reroute amplification are real costs, but acceptable ones.** Worst-case iteration ceilings are bounded (see Known Risks), and bundles can be unbundled by the operator if Codex's blocking is over-reaching. These costs are visible in telemetry and self-correcting via env-var tuning; advisory mode hides the same costs as "human reviewer fatigue" which is invisible to telemetry.
4. **Reversibility.** If auto-reroute proves too aggressive on a class of tasks, downgrading to advisory is a one-PR change (route to human_review instead of implement on changes_requested). Going the other direction (advisory → auto-reroute later) would require re-deciding the iteration semantics from scratch.

## Non-Goals

- **Customizing the Codex review prompt.** The whole framing benefit is "Codex sees the diff cold." Adding spec context, AC anchors, or canon-specific framing would defeat the purpose. The pipeline invokes `codex review --base <base_branch>` with default behavior; the PROMPT positional arg is not used.
- **Parallel review with Claude.** Codex runs only after Claude approves — never alongside, never in parallel, never on intermediate Claude reroute cycles. Saves tokens and avoids reviewing code that's about to be rewritten.
- **Per-task opt-out.** No `status.json` flag to disable codex_code_review for a single task. If a task wants lighter review, set `task_size: S` (which auto-skips this phase). The env var is for global debugging escape, not per-task tuning.
- **Skipping Claude on Codex-triggered reroutes.** When Codex returns changes_requested, the pipeline reroutes to implement; the next cycle goes implement → Claude `code_review` → (if approved) → Codex `codex_code_review`. Claude re-reviews from scratch. Skipping Claude on the second cycle would save one Claude pass but break the "any implement cycle invalidates prior approvals" invariant.
- **Detecting and reviewing inline reviewer fixes.** Currently no policy permits Claude to edit code during code_review (the templates/CLAUDE.md "Trivial Fix Exception" was removed). The `--base <base_branch>` scope used here would naturally cover any inline reviewer commits if they ever land, but this is incidental, not designed behavior — out of scope to formalize.
- **Migrating existing in-flight tasks to the new schema.** Tasks created before this PR ships will not have `phases.codex_code_review` in their status.json. The orchestrator must handle the absent field gracefully (read-as-default empty entry), but a one-time migration script is not required — in-flight tasks will pick up the new phase on their next code_review approval.

## Acceptance Criteria

### Schema and types

- [ ] **AC-1**: `PHASE_ORDER` in `scripts/run-task/types.ts` includes `'codex_code_review'` between `'code_review'` and `'qa'`. Full order: `['spec', 'spec_review', 'plan', 'implement', 'code_review', 'codex_code_review', 'qa', 'human_review']`.
- [ ] **AC-2**: `Phase` type union (derived from `typeof PHASE_ORDER[number]`) includes `'codex_code_review'`; all downstream type usages (PhaseEntry, dispatcher cases) compile clean.
- [ ] **AC-3**: `.canon/templates/status.json` includes a `phases.codex_code_review` entry with shape `{ status: 'pending', agent: 'codex', verdict: '', iterations: 0, iterations_current_loop: 0, iterations_total: 0, changes_requested_total: 0, auto_block_count: 0 }`. The phase's `_verdict_values` block (file-level comment) is unchanged — `approved | approved_with_nits | changes_requested | needs_re_review` already covers all codex_code_review verdicts.
- [ ] **AC-5**: `canon task new` scaffolds new tasks with the new `phases.codex_code_review` entry populated (per AC-3 default).
- [ ] **AC-6**: `canon task phase <id> codex_code_review <status> [verdict]` accepts the new phase name and updates the phase entry; invalid usage rejected with the existing error message format. Specifically, `src/task/index.ts` adds `'codex_code_review'` to the `REVIEW_PHASES` set (currently `{spec_review, code_review}`), updates the error message in `assertValidVerdict` to read "verdict is only valid for spec_review, code_review, and codex_code_review phases", and the existing `updateReviewCounters` call site (guarded by `REVIEW_PHASES.has(phaseArg)`) now fires for codex_code_review verdicts.
- [ ] **AC-7**: `deriveTopLevelStatus` in `scripts/run-task/state.ts` walks the updated `PHASE_ORDER` and correctly identifies `codex_code_review` as the current phase when prior phases are done.
- [ ] **AC-7a (non-resumable phase)**: `codex_code_review` is **intentionally non-resumable**. No `sessions.codex_code_review` slot is added to `StatusJson.sessions` or `.canon/templates/status.json`. Rationale: the new `runCodexReview` helper (AC-10) does not consume the `codex exec --json` event stream that produces `thread.started.thread_id`, so there is no session ID to store; and the value of the phase is a *cold adversarial pass* — resuming a partial session would defeat the framing benefit. Each Codex iteration runs fresh against the current branch state. Document the non-resumable choice inline in `runCodexCodeReviewPhase` so it doesn't get "fixed" by a future contributor adding session machinery.

### Phase implementation

- [ ] **AC-8**: New module `scripts/run-task/phases/codex-code-review.ts` exports `runCodexCodeReviewPhase(state: PipelineState, interactive: boolean, resumeId: string | null): Promise<PhaseRunResult>`.
- [ ] **AC-9 (review scope)**: The phase invokes `codex review --base <base_branch>` where `<base_branch>` is read from `status.json.base_branch` (any task in the bundle — all share the base by construction). No commit-SHA scoping; the review covers the full task delta against the base branch so commits Claude rejected in earlier `code_review` cycles are not skipped. `phases.implement.commit_sha` is **not** introduced by this task.
- [ ] **AC-9d (CLI invocation failure)**: If the `codex` CLI itself exits non-zero (binary missing, network error, auth failure, timeout), the phase fails closed: marks `phases.codex_code_review.status = 'blocked'`, writes the stderr (truncated to 4KB) into `codex-review.md` under a `### CLI Failure` heading, exits with code 2 to surface the failure to the operator. Does NOT mark verdict = approved (would mask outages). Recovery: re-run after fixing the CLI environment, or set `CODEX_CODE_REVIEW_DISABLED=true` to bypass for debugging purposes.
- [ ] **AC-10 (runner API)**: The phase invokes `codex review --base <base_branch>` via a **new** exported helper in `scripts/run-task/agents/codex.ts` — the existing `runCodex(prompt, …)` requires a non-empty prompt and routes through `codex exec`, neither of which fits `codex review`. The new helper signature is `runCodexReview(args: { baseBranch: string; cwd: string; model: string; effort: string; metricsContext?: { taskId: string; phase: string; iteration?: number; activeCwd?: string } }): Promise<{ exitCode: number; stdout: string; stderr: string }>`. It invokes the `codex` binary with argv `['-m', model, '-c', 'model_reasoning_effort=<effort>', 'review', '--base', baseBranch]` from `cwd` — **model and effort are top-level flags placed before the `review` subcommand**, because `codex review -m <model>` is not a valid invocation (the `review` subcommand has no `-m` option; verified against the installed `codex-cli` in the repo's `canon.codex_cli` snapshot). It captures stdout+stderr, records the standard metrics tuple via `recordMetric`, and returns the raw result without exiting on non-zero (the caller handles failure per AC-9d). The interactive path and `--json` event stream from `runCodex` are not used — `codex review` is a one-shot adversarial pass and its stdout is the artifact.
- [ ] **AC-11**: Severity parser is a pure function `parseCodexReviewSeverities(output: string): { P0: number; P1: number; P2: number; P3: number }` that counts matches of regex `^- \[P([0-3])\] ` (multiline, global) on the stdout. Exported and unit-tested.
- [ ] **AC-12**: Verdict derivation is a pure function `deriveCodexCodeReviewVerdict(counts): 'approved' | 'approved_with_nits' | 'changes_requested'` with the mapping: any P0/P1/P2 > 0 → `changes_requested`; P3 > 0 and P0/P1/P2 = 0 → `approved_with_nits`; all zero → `approved`. Exported and unit-tested.
- [ ] **AC-13**: `tasks/<id>/codex-review.md` is written with the raw `codex review` stdout as the iteration's body, followed by a fenced orchestrator-appended verdict block:
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
  Subsequent iterations append `## Round N+1` (with their own raw output + verdict block) rather than overwriting.
- [ ] **AC-14**: On phase completion, `status.json.phases.codex_code_review.verdict` is set to the derived verdict; `status` is set to `done`.
- [ ] **AC-14a (phase gate)**: `PHASE_GATE_CONFIG` in `scripts/run-task/validation.ts` gains a `codex_code_review` entry that enforces three properties when an operator **or the orchestrator** advances the phase to `done`. There is **no exemption** for fast-tier-skip (AC-16) or disabled-by-env-var (AC-28) paths — they satisfy the gate by writing the minimal skip artifact (AC-16a) before calling `taskPhase()`. The three properties:
  1. **Artifact present**: `tasks/<id>/codex-review.md` must exist and be non-template (use the default `isTemplateUnfilled` detector).
  2. **Verdict required**: a verdict argument must be supplied (same as `requiresVerdict: true`).
  3. **Verdict must match artifact**: the verdict line in the artifact's most recent `### Verdict (orchestrator-computed)` block (format `- Verdict: <value>`) must equal the verdict argument.
  Property (3) cannot reuse `extractCheckedVerdict()` because codex-review.md uses a `- Verdict: <value>` line, not a checked checkbox. Implement by extending `PhaseGateConfig` with an optional `verdictExtractor?: (content: string) => string | null` field; if set, `checkPhaseGate` calls it instead of `extractCheckedVerdict`. Add a new exported helper `extractCodexReviewVerdict(content: string): string | null` in `scripts/run-task/validation.ts` that locates the last `### Verdict (orchestrator-computed)` block and returns the value after `- Verdict: `. Wire the gate config: `codex_code_review: { artifactName: 'codex-review.md', requiresVerdict: true, verdictMustMatchArtifact: true, verdictExtractor: extractCodexReviewVerdict }`.

### Orchestration and routing

- [ ] **AC-15**: The dispatcher in `scripts/run-task/main.ts` advances to `codex_code_review` after `code_review` returns `approved` or `approved_with_nits`. On `changes_requested` from Claude, the existing reroute logic still routes back to implement; codex_code_review does not run.
- [ ] **AC-16**: `codex_code_review` is **skipped** when `detectTier(tasks) === 'fast'` (S non-delicate). The orchestrator writes a minimal skip artifact to `tasks/<id>/codex-review.md` (see AC-16a), marks `phases.codex_code_review.status = 'done'` and `verdict = 'approved'` without invoking the Codex CLI, then advances to `qa`. Mirrors the existing fast-tier `spec_review` skip pattern in main.ts.
- [ ] **AC-16a (skip artifact)**: When the orchestrator skips the phase (fast-tier skip from AC-16, or disabled-by-env-var from AC-28), it writes a minimal `codex-review.md` artifact whose `### Verdict (orchestrator-computed)` block parses cleanly via `extractCodexReviewVerdict` and matches the status.json verdict, so the existing phase gate (AC-14a) holds without exemption. Shape:
  ````
  ## Round 1

  (skipped — <reason>, no Codex review performed)

  ### Verdict (orchestrator-computed)
  - P0: 0
  - P1: 0
  - P2: 0
  - P3: 0
  - Verdict: approved
  - Base branch reviewed: <base_branch> (skipped)
  - Iteration: 1
  ````
  `<reason>` is `fast tier` for the AC-16 path and `disabled by CODEX_CODE_REVIEW_DISABLED` for the AC-28 path. The artifact is *not* a template per `isTemplateUnfilled` because it contains real prose and a populated verdict block. Rationale: a uniform gate is simpler and more auditable than a gate exemption — operators or post-hoc audits looking at `tasks/<id>/codex-review.md` can see *why* no review ran, and `canon task accept`-style flows that route through `taskPhase()` continue to work without special-casing.
- [ ] **AC-17**: When `codex_code_review` returns `changes_requested`, the orchestrator reroutes to `implement` using the same reroute reset logic that Claude `code_review` uses (reset `implement`, `code_review`, `codex_code_review`, `qa` to `pending`; preserve iteration counters per `--reroute` semantics).
- [ ] **AC-18**: `codex_code_review.iterations_current_loop` increments on each phase run; resets to 0 when verdict is `approved` or `approved_with_nits`. `iterations_total` always increments. Auto-block fires when `iterations_current_loop >= MAX_REVIEW_LOOPS` (same size-aware default as code_review).
- [ ] **AC-19**: Auto-block error message for codex_code_review references `tasks/<id>/codex-review.md` (not `review.md`); recovery steps mention `phases.codex_code_review.iterations_current_loop = 0`.
- [ ] **AC-19a (dry-run output)**: `printDryRunPlan` in `scripts/run-task/main.ts` (the hard-coded Claude-vs-Codex phase branch around lines 1128–1143) is extended to include `codex_code_review` in the Codex branch alongside `spec_review` and `implement`, and to skip it on fast tier alongside the existing `spec_review` fast-tier skip. Effect: `canon run <id> --dry-run` on a full-tier task lists `codex_code_review: Codex / <model> / <effort>` between `code_review` and `qa`; on a fast-tier task, the line is omitted. Without this AC, `getCodexConfig('codex_code_review', tasks)` would silently fall through the if-chain and the planned phase would not appear in the operator's preview.

### Bundle mode

- [ ] **AC-23**: In bundle mode, one `codex review --base <base_branch>` invocation runs against the bundle's shared base branch (every bundle task shares the same base by construction).
- [ ] **AC-24**: The same raw output is written to each `tasks/<id>/codex-review.md` (with task-specific round headers).
- [ ] **AC-25**: The bundle-level verdict is applied uniformly: every bundle task's `phases.codex_code_review.verdict` is set to the same value. If `changes_requested`, the whole bundle reroutes (every task's implement returns to `pending`).

### Pipeline policy

- [ ] **AC-26**: `scripts/pipeline-policy.ts` exposes a new `CodexPhase` value `'codex_code_review'`. The `codexMatrix` adds a row mirroring `spec_review`'s shape:
  - S: `{ model: codexModelMini, effort: 'medium' }` (unused in practice because fast-tier skips, but kept for completeness)
  - M: `{ model: codexModelMini, effort: 'medium' }`
  - L: `{ model: codexModelMini, effort: 'high' }`
  - XL: `{ model: codexModelFull, effort: 'high' }`
- [ ] **AC-27**: `getCodexConfig('codex_code_review', tasks)` returns the correct model/effort per effective size; delicate promotes to XL slot.

### Disable switch

- [ ] **AC-28**: `CODEX_CODE_REVIEW_DISABLED=true` (env var, parsed as string `'true'`) makes the phase a no-op: orchestrator writes the minimal skip artifact per AC-16a (with `<reason>` = `disabled by CODEX_CODE_REVIEW_DISABLED`), marks `phases.codex_code_review.status = 'done'`, `verdict = 'approved'`, and does not invoke the Codex CLI. Logged at info level so it's visible in pipeline output.
- [ ] **AC-29**: Any other value (unset, `'false'`, `'0'`, `'no'`) leaves the phase enabled.
- [ ] **AC-29a (dependency preflight)**: `checkDeps()` in `scripts/run-task/main.ts` is **not** modified by this task. The Codex binary check still runs for every non-ship/non-dry-run invocation regardless of `CODEX_CODE_REVIEW_DISABLED`. Rationale: full-tier runs invoke Codex for `spec_review` and `implement` anyway, so a missing `codex` binary is a fatal precondition independent of this flag. The env var is a phase-level skip for debugging or fast iteration on adjacent phases — not an outage-recovery tool for the Codex CLI. (If a future need emerges for a "Codex CLI globally unavailable" mode, it would be a separate env var that gates the dep check and forces fast-tier behavior on every task — out of scope here.)

### Tests

- [ ] **AC-30**: New test file `tests/codex-code-review-phase.test.ts` covers `parseCodexReviewSeverities` with the following cases:
  - Empty string → all zeros
  - Codex "no findings" prose only (the user-provided example "I did not find a discrete correctness issue introduced by the patch.") → all zeros
  - Single P2 finding (real-world example from spec) → `{ P0: 0, P1: 0, P2: 1, P3: 0 }`
  - Mixed P0/P1/P2/P3 → correct counts
  - Lines with `- [P5]` (invalid digit) or `[P2]` without `- ` prefix → not counted
  - Lines with `- [P2] ` mid-content (e.g., in a code block or quoted) → counted (acceptable false positive; parser is line-prefix-based by design)
- [ ] **AC-31**: New test cases in `tests/pipeline-policy.test.ts` cover `codex_code_review`:
  - Codex matrix: codex_code_review × {S, M, L, XL} → expected model/effort
  - Codex matrix: delicate M promotes to XL slot (full model)
- [ ] **AC-32**: Verdict derivation tests in the same test file as AC-30 cover all three verdict outcomes (approved, approved_with_nits, changes_requested) per the mapping in AC-12.
- [ ] **AC-32a (task CLI verdict coverage)**: Tests in `tests/task-phase.test.ts` (or the existing `canon task phase` test file — locate via `grep -l "assertValidVerdict\|REVIEW_PHASES" tests/`; create a new test file only if no existing target file fits) cover:
  - `canon task phase <id> codex_code_review done approved` accepts the verdict and writes it to the phase entry.
  - `canon task phase <id> codex_code_review done changes_requested` increments `iterations_current_loop`, `iterations_total`, and `changes_requested_total`.
  - `canon task phase <id> codex_code_review done approved` (after a prior `changes_requested`) resets `iterations_current_loop` to 0 and increments `iterations_total`.
  - The updated error text in `assertValidVerdict` lists all three review phases when a non-review phase is given a verdict.
- [ ] **AC-32b (phase gate coverage)**: Tests in the existing phase-gate test file (`grep -l "checkPhaseGate\|PHASE_GATE_CONFIG" tests/` — likely `tests/validation.test.ts` or similar; add cases to the existing file rather than creating a new one) cover:
  - `extractCodexReviewVerdict` returns the value from `- Verdict: <value>` on a well-formed artifact (single round and multi-round); returns `null` when no verdict block exists.
  - When multiple `### Verdict (orchestrator-computed)` blocks exist (multi-round artifact), `extractCodexReviewVerdict` returns the **last** one.
  - `checkPhaseGate('<task>', 'codex_code_review', 'approved')` returns `{ ok: false }` when `codex-review.md` is missing.
  - `checkPhaseGate` returns `{ ok: false }` with a verdict-mismatch reason when the artifact's last verdict differs from the verdict argument.
  - `checkPhaseGate` returns `{ ok: true }` when the artifact exists, is non-template, and the artifact's last verdict matches the verdict argument.
  - `checkPhaseGate` returns `{ ok: true }` for the AC-16a skip artifact shape (the `(skipped — <reason>, …)` body + `Verdict: approved` block), confirming the uniform gate covers skip/disabled paths without exemption.

### Docs

- [ ] **AC-33**: `docs/pipeline-orchestrator.md` updated:
  - `PHASE_ORDER` references throughout reflect the new phase
  - Codex env var table adds a row for `CODEX_CODE_REVIEW_DISABLED`
  - Codex model matrix table adds `codex_code_review` row
  - "Review Loops & Auto-block" section mentions both code_review and codex_code_review have independent counters; worst-case ceiling note (2× MAX_REVIEW_LOOPS)
- [ ] **AC-34**: `CLAUDE.md` "Review Responsibilities" section adds a note that codex_code_review runs after Claude approves; Claude code_review is unchanged in behavior but documented as "first stage" of a two-agent review.
- [ ] **AC-35**: `AGENTS.md` updated where phase order or codex CLI invocations are documented.
- [ ] **AC-36**: `CODEX.md` updated to describe codex_code_review responsibilities (default review prompt, no spec injection, output format expectations).
- [ ] **AC-37**: `docs/codebase-map.md` updated with the new phase module (`scripts/run-task/phases/codex-code-review.ts`).
- [ ] **AC-38**: `templates/` mirror updated for every changed canon-managed file; `npm run sync-templates:check` passes.
- [ ] **AC-39**: `npm run docs-refs-check` passes (no broken refs from new file paths).
- [ ] **AC-40**: `CHANGELOG.md` gets a new bullet under `[1.5.0] — unreleased` → `### Added` describing the new phase, env var, and the rationale (one paragraph max).

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/types.ts` | Add `'codex_code_review'` to `PHASE_ORDER`; verify `Phase` and `PhaseEntry` derivations propagate. No change to `StatusJson.sessions` — see AC-7a. |
| `scripts/run-task/phases/codex-code-review.ts` | **New file**. Exports `runCodexCodeReviewPhase`. Reads `status.base_branch`, checks `CODEX_CODE_REVIEW_DISABLED`, calls the new `runCodexReview` helper with `--base <base_branch>`, parses output, writes `codex-review.md`, sets verdict. |
| `scripts/run-task/agents/codex.ts` | Add new exported `runCodexReview(args)` helper that invokes `codex -m <model> -c model_reasoning_effort=<effort> review --base <base_branch>` from the task cwd (model/effort are top-level flags; the `review` subcommand has no `-m` flag), captures stdout+stderr, records metrics, and returns the raw result without exiting on non-zero. Does **not** modify or refactor the existing `runCodex` function (out of scope). |
| `scripts/run-task/main.ts` | Dispatcher: route to codex_code_review after code_review approves; fast-tier skip; reroute target on changes_requested. Extend `printDryRunPlan`'s Codex-phase branch to include `codex_code_review` and apply the fast-tier skip (AC-19a). **No change** to `autoCommitCode` (no SHA tracking required). **No change** to `checkDeps` (see AC-29a). No change to the `sessions` resumption block (see AC-7a). |
| `scripts/run-task/state.ts` | Verify `deriveTopLevelStatus` walks new PHASE_ORDER correctly (likely no code change — it's data-driven). |
| `scripts/run-task/check-phase-gate.ts` | Verify `--expect codex_code_review` works (likely no code change — PHASE_ORDER-driven). |
| `scripts/run-task/policy.ts` | Add `'codex_code_review'` to `CodexPhase` re-export (if not auto-propagated from pipeline-policy.ts). |
| `scripts/pipeline-policy.ts` | Add `'codex_code_review'` to `CodexPhase` type; add matching row in `codexMatrix`. |
| `scripts/run-task/validation.ts` | Add `parseCodexReviewSeverities` and `deriveCodexCodeReviewVerdict` exports for unit tests. Add `extractCodexReviewVerdict(content)` helper. Extend `PhaseGateConfig` type with optional `verdictExtractor` field. Add `codex_code_review` entry to `PHASE_GATE_CONFIG` (AC-14a). Extend `checkPhaseGate` so `verdictMustMatchArtifact` uses `config.verdictExtractor` when present, falling back to `extractCheckedVerdict` for existing phases. |
| `src/task/index.ts` | Add `'codex_code_review'` to the `REVIEW_PHASES` set; update the error text in `assertValidVerdict` to list all three review phases (`spec_review, code_review, codex_code_review`). `PHASE_ORDER`-driven phase validation already handles the new name without further edits. |
| `.canon/templates/status.json` | Add `phases.codex_code_review` entry only. (No `phases.implement.commit_sha` field — that approach was rejected in spec_review.) |
| `templates/.canon/templates/status.json` | Mirror of above (canon-managed template). |
| `tests/codex-code-review-phase.test.ts` | **New file**. Severity parser + verdict derivation tests. |
| `tests/pipeline-policy.test.ts` | Add codex_code_review matrix rows (per size and delicate promotion). |
| `tests/task-phase.test.ts` (or existing equivalent — see AC-32a) | Add tests for `canon task phase <id> codex_code_review done <verdict>` behavior: verdict acceptance, counter increment/reset, updated error text. |
| `docs/pipeline-orchestrator.md` | PHASE_ORDER references, env var table row, model matrix row, review-loop note. |
| `templates/docs/pipeline-orchestrator.md` | Mirror of above. |
| `CLAUDE.md` | "Review Responsibilities" section: note codex_code_review runs after Claude approves. |
| `templates/CLAUDE.md` | Mirror of above. |
| `AGENTS.md` | Phase order, validation/review section updates. |
| `templates/AGENTS.md` | Mirror of above. |
| `CODEX.md` | New section on codex_code_review responsibilities (default review prompt, no spec injection). |
| `templates/CODEX.md` | Mirror of above. |
| `docs/codebase-map.md` | New entry for `scripts/run-task/phases/codex-code-review.ts`. |
| `templates/docs/codebase-map.md` | Mirror of above. |
| `CHANGELOG.md` | New bullet under [1.5.0] → Added. |
| `dist/cli/index.js` | Build-generated artifact. Regenerated by `npm run build` after source changes; committed alongside source to satisfy CI's `git diff --exit-code -- dist/` gate. No hand edits. |
| `dist/scripts/run-task.js` | Build-generated artifact (orchestrator bundle). Regenerated by `npm run build`. No hand edits. |

### Interaction Dependencies

- **Reroute machinery (`canon run --reroute`)**: existing reroute resets `implement`, `code_review`, `qa` to pending. Extend to also reset `codex_code_review`.
- **Bundle mode**: existing bundle dispatch already runs one agent session for code_review across all tasks. Codex_code_review reuses this pattern (one codex CLI call, output replicated per-task).
- **Session resumption**: Claude/Codex sessions are resumable via `sessions.<phase>`. `codex_code_review` is **intentionally non-resumable** (AC-7a) — `codex review` is a one-shot cold adversarial pass, not a long-running session, and the helper does not consume the `--json` event stream that would surface a `thread_id`. No `sessions.codex_code_review` slot is added.
- **`canon task accept`**: today only supports `implement`. Codex_code_review may want operator-accept too eventually, but out of scope here — if an operator wants to skip codex_code_review on a specific task, they set `CODEX_CODE_REVIEW_DISABLED=true` for that invocation.
- **Quality log (`docs/task-quality-log.md`)**: column schema unchanged. New phase contributes to overall iteration counts but the log structure is flexible.

### Data Model Changes

- `Phase` type union: adds `'codex_code_review'`.
- `StatusJson.phases.codex_code_review`: new phase entry (same shape as `code_review` — status, agent, verdict, iteration counters, auto-block counter).
- `StatusJson.sessions`: **no change** — codex_code_review is non-resumable by design (AC-7a).

No migration required for in-flight tasks; an absent `phases.codex_code_review` reads as the default empty phase entry on first dispatch. No new fields on `phases.implement` (commit-SHA scoping was considered and rejected — see Decision and the spec_review revision history).

## Validation Required

- [x] Linting (`npm run lint`) — required for all changes
- [x] Type checking (`npm run type-check`) — schema/type additions affect type inference across the orchestrator
- [x] Unit tests (`npm test`) — new parser tests + extended policy tests
- [x] Full build (`npm run build`) — change affects `scripts/run-task/**`, `scripts/pipeline-policy.ts` (transitively bundled into `dist/`); committed `dist/` must match a fresh build
- [x] Docs references (`npm run docs-refs-check`) — new file paths referenced from docs
- [x] Canon-managed template sync (`npm run sync-templates:check`) — multiple canon-managed root files (AGENTS.md, CLAUDE.md, CODEX.md, docs/pipeline-orchestrator.md, docs/codebase-map.md, .canon/templates/status.json) change in this PR; templates/ mirrors must stay in sync
- [ ] End-to-end tests — N/A per `docs/architecture.md` (no E2E surface in canon-ai)

## Docs Impact

- `docs/pipeline-orchestrator.md` (PHASE_ORDER, env vars, model matrix, review-loop note)
- `docs/codebase-map.md` (new phase module)
- `CLAUDE.md`, `AGENTS.md`, `CODEX.md` (phase ordering, review responsibilities)
- `.canon/templates/status.json` (schema additions)
- `CHANGELOG.md` ([1.5.0] → Added)

All listed canon-managed files require matching `templates/` updates per the canon-managed file convention.

## Known Risks

- **Codex CLI output format brittleness.** The severity parser depends on `codex review`'s output lines starting with `- [P<n>] `. If a future codex CLI release changes the format (e.g., emoji prefix, different bracket style, severity rename), the parser silently miscounts. Mitigation: parser tests pin the current format; a codex CLI upgrade discovered to break the format requires parser update + new test cases. Document the format-dependence in `codex-code-review.ts` near the regex.
- **Three full-model Codex passes on XL/delicate.** With this change, XL/delicate tasks now run `codexModelFull` on `spec_review` + `implement` + `codex_code_review` — a real cost increase. Watch `docs/task-quality-log.md` over the next 5–10 XL/delicate tasks; if codex_code_review's catch rate is low, the obvious knob is downgrading its model to `codexModelMini` even on XL (one-line change in `codexMatrix`).
- **Iteration counter doubling.** Worst case per task: `MAX_REVIEW_LOOPS` Claude iterations + `MAX_REVIEW_LOOPS` Codex iterations + every Codex iteration triggers a fresh Claude re-review. Total Claude iterations ≤ `MAX_REVIEW_LOOPS × MAX_REVIEW_LOOPS` in the absolute worst case. In practice tasks converge well below; if a task hits this, the spec or implementation has a deeper issue and auto-block is the right behavior. Note in the auto-block message that hitting the cap on codex_code_review specifically often indicates a spec-level issue rather than implementation churn.
- **Chicken-and-egg pipeline run.** This task's own pipeline run will *not* include codex_code_review (the phase doesn't exist until this PR merges). For in-flight tasks created before merge: absent `phases.codex_code_review` reads as the default empty entry (status `pending`, verdict empty) — standard optional-chain reads, no crash. Since the phase reads `status.base_branch` (which has been a long-standing field, not new in this task), there's no other schema-drift concern. The combined effect: legacy in-flight tasks transition into the new phase seamlessly on their next code_review approval.
- **Bundle mode false-positive surface.** In bundle mode, a P2 finding affecting only one task in the bundle reroutes the whole bundle. This matches existing Claude `code_review` bundle behavior, so it's consistent — but worth flagging that bundles amplify Codex's blocking impact. If a bundle's catch rate suggests this is over-blocking, the answer is "don't bundle delicate tasks" rather than weakening the gate.
- **Cold-spec adversarial framing is the *value*, not a bug.** Reviewers (Codex spec_review or a future code-quality auditor) may instinctively suggest passing the spec into codex_code_review's invocation "for context." Resist. The empirical evidence is "Codex reading the diff cold catches what Codex reading the diff anchored on spec misses." This is in the Non-Goals for a reason; the Codex invocation must not see the spec.
- **Re-review cost from `--base` scoping.** Reviewing the full task delta on every Codex iteration means the previously-reviewed portion of the diff is examined again on iteration 2, 3, etc. This was a deliberate tradeoff against a "last Codex-approved baseline" mechanism (rejected as more complex to implement and verify than a re-review pass against a bounded `MAX_REVIEW_LOOPS` ceiling). If telemetry later shows the re-review cost is material — e.g., XL/delicate tasks consistently hitting the cap because each iteration burns reasoning tokens re-checking unchanged hunks — the obvious follow-up is recording a "last Codex-approved commit SHA" in `phases.codex_code_review` and constructing the review range as `<approved-SHA>..HEAD`. That work is out of scope here.

## Human Test Plan

> Steps for the product owner. Written for someone who tests the pipeline as a whole, not the implementation.

1. **Fresh M task end-to-end.** Spec an M-tier task, run the pipeline. After the pipeline completes, inspect the task's `status.json` and confirm `phases.codex_code_review` shows `status: done` with a verdict, and `tasks/<id>/codex-review.md` exists with raw Codex output + a verdict block.
2. **Fast-tier skip on S non-delicate.** Spec an S non-delicate task, run the pipeline. Confirm `phases.codex_code_review.status = done`, `verdict = approved`, the pipeline log shows codex_code_review as "skipped (fast tier)," and `tasks/<id>/codex-review.md` exists with a minimal skip artifact (`(skipped — fast tier, …)` body and a `Verdict: approved` block) — no Codex CLI was invoked.
3. **Delicate task catches a planted bug.** Spec a delicate L task with an obvious lifecycle bug (e.g., a buffer that isn't re-armed on failure). Confirm Codex's `codex_code_review` catches it (verdict `changes_requested`, P2 finding in `codex-review.md`), reroutes to implement, and the bug is fixed on iteration 2.
4. **Reroute counter independence.** Force Claude code_review to reroute twice on a task (e.g., AC noncompliance), then approve. Confirm Claude's `code_review.iterations_current_loop` reset to 0 after approval and Codex's `codex_code_review.iterations_current_loop` starts at 0 (independent). Codex's iteration runs against the full task delta from `base_branch`, which intentionally includes all implement commits in the branch — including any that Claude rejected in earlier cycles.
5. **Env var escape hatch.** Set `CODEX_CODE_REVIEW_DISABLED=true` and run a full-tier task. Confirm the phase is marked done with verdict `approved`, the pipeline log shows "codex_code_review disabled by env var," and `tasks/<id>/codex-review.md` exists with a minimal skip artifact (`(skipped — disabled by CODEX_CODE_REVIEW_DISABLED, …)` body and a `Verdict: approved` block) — no Codex CLI was invoked.
6. **Bundle mode.** Bundle two M tasks. Confirm both `tasks/<id>/codex-review.md` files exist after the pipeline runs; if Codex reroutes, both tasks' `phases.implement.status` returns to `pending`.
7. **Quality log audit after 5–10 tasks.** Check `docs/task-quality-log.md`. Are P0/P1/P2 findings from codex_code_review real bugs that Claude code_review missed? If yes, the phase is paying for itself. If no (Codex is finding things Claude already approved correctly), the threshold may be too tight or the model too capable for the bug class — file a follow-up to tune.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done.

- [x] Every AC states exactly how to verify it (file path, function name, expected behavior)
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Known Risks covers failure modes for the trickiest ACs (parser brittleness, cost stack, counter doubling, chicken-and-egg, bundle amplification, framing-anchor temptation)
- [x] Human Test Plan uses product/behavior language only — no internal code references
- [x] Validation Required has at least one entry marked `- [x]`
