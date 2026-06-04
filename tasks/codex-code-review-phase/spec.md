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

The fix is an **opt-in** pipeline phase: when a task sets `codex_code_review: true`, then after Claude `code_review` returns `approved`/`approved_with_nits`, a mini-model Codex adversarial pass runs against the full diff with no spec context. Findings are then **adjudicated by Claude** (the only agent that sees both the findings and the spec) and routed by altitude — code bugs reroute to implement; spec/plan gaps escalate to the human (or, under full-send, auto-amend the spec); false positives are dismissed. A cumulative reroute cap (`MAX_CODEX_REROUTES`) prevents a runaway loop, overriding full-send. (See Decision → "Adjudicated, altitude-aware routing.") If no task opts in, the phase is a no-op skip and the pipeline advances to qa.

## Decision

Add a new pipeline phase `codex_code_review` between `code_review` and `qa` in `PHASE_ORDER`. The phase:

- Is **opt-in per task** via a new `status.json` boolean field `codex_code_review` (default `false`/absent). When the flag is not set, the phase is a **no-op skip** for that task — *regardless of task size or delicate status*. There is **no tier gate**: the operator's flag is the sole eligibility signal. An opted-in S task runs it; a non-opted-in XL/delicate task does not.
- When opted in, runs **only after Claude `code_review` returns `approved` or `approved_with_nits`**, never on intermediate Claude reroutes.
- Invokes `codex review --base <base_branch>` where `<base_branch>` is the task's recorded base (`status.json.base_branch`, the same value the `--pr` base-drift gate uses). Default Codex review prompt; **no custom prompt injection** — the adversarial framing comes from `codex review`'s built-in behavior. No `PROMPT` positional argument is passed.
- Parses Codex's stdout for findings by line prefix `- [P<n>] `, where `<n>` ∈ `{0,1,2,3}`. Derives verdict: any P0/P1/P2 → `changes_requested`; P3-only → `approved_with_nits`; no findings → `approved`.
- Writes findings to `tasks/<id>/codex-review.md`: the raw `codex review` stdout plus an orchestrator-appended verdict block (P-counts, verdict, base branch reviewed against, iteration number). Per-iteration history via `## Round N` append (no overwriting prior rounds).
- On `changes_requested`, the findings are **not auto-rerouted to `implement`**. They first pass through **Claude adjudication** (see "Adjudicated, altitude-aware routing" below): Claude — the only agent that sees both the findings and the spec — classifies each finding as a code bug, a spec/plan gap, or a false positive, and routes accordingly. Code-bug reroutes re-enter `implement`, then Claude `code_review` from scratch (existing PHASE_ORDER semantics), then `codex_code_review` again if Claude re-approves. Iteration counters are per-phase and independent: `code_review.iterations_current_loop` and `codex_code_review.iterations_current_loop` each reset to 0 when their own phase returns approved/approved_with_nits, each capped by `MAX_REVIEW_LOOPS` (size-aware default).
- A **task-lifetime cumulative counter `codex_code_review.reroutes_total`** tracks every `codex_code_review`-driven reroute (code-bug reroute to `implement` *and* spec amendment), and is **never reset** — not by reroutes, not by amendments, not by phase approvals. It is capped by **`MAX_CODEX_REROUTES`** (env-overridable, default 3). When the cap is reached, the run **auto-blocks and escalates to a human even in full-send mode** — the runaway guard overrides full-send's "no interrupts," the same way ordinary auto-block does. This bounds the cross-amendment loop that `iterations_current_loop` cannot (each amendment resets the per-loop counter). See "Adjudicated, altitude-aware routing" and Known Risks.
- **Model: `codexModelMini` always**, at effort scaled by effective size (S/M → `medium`, L/XL → `high`). There is **no `codexModelFull` promotion** for this phase — even on XL/delicate. Rationale: XL/delicate tasks already spend `codexModelFull` on `spec_review` + `implement`; a third full-model Codex pass was the original cost concern. Mini keeps the adversarial-review value at much lower marginal cost.
- Is **intentionally non-resumable** (no `sessions.codex_code_review` slot) — `codex review` is a one-shot cold pass; each iteration runs fresh against current branch state.
- Bundle mode: the phase runs for the bundle if **any** task in the bundle sets `codex_code_review: true`. One `codex review --base <base_branch>` invocation against the bundle's shared base branch; the raw stdout is replicated to each opted-in task's `codex-review.md` and the verdict applied to each opted-in task. On `changes_requested`, the entire bundle reroutes (mirrors Claude `code_review` bundle behavior). Non-opted-in tasks in the bundle get the standard skip artifact.
- **Remove** the existing `code_review approved/approved_with_nits → qa` transition in `scripts/run-task/main.ts`'s dispatcher. The new advance path is `code_review approved → codex_code_review → qa`. The `codex_code_review` phase itself decides per-task whether to run the Codex pass or write a skip artifact, then advances to `qa`. Leaving both transitions in place produces a silent ordering bug where qa might run before codex_code_review.

### Why opt-in flag alone (no tier gate)?

The original design gated on tier (full-tier only) and made the phase default-on. This revival makes it opt-in and drops the tier gate. Reasoning, documented so spec_review doesn't re-litigate:

- **Opt-in already expresses proportionality.** The original tier gate existed to keep a default-on phase off low-blast-radius work. Once the phase is opt-in, the operator setting the flag *is* the proportionality decision. A second tier gate on top would only produce the surprising failure mode "I set the flag but it didn't run," plus an extra skip code path.
- **Trust operator intent.** An operator who sets `codex_code_review: true` on a small task knows they want a cold adversarial pass on it. The phase should honor that rather than second-guess it by size.
- **Simpler.** No `detectTier`-based branch in this phase; eligibility is a single boolean read.

### Adjudicated, altitude-aware routing

The original design auto-rerouted every `changes_requested` straight to `implement`. That assumes every Codex finding is a code bug against a correct spec — which is wrong, for a structural reason: **Codex reviews the diff cold (no spec context — that is the phase's whole value), so it is blind to spec intent.** Cold-Codex can only emit *symptoms* ("this code has an unhandled case / inconsistency / gap"); it cannot say "AC-5 is wrong" because it never saw AC-5. Diagnosing what *altitude* a symptom lives at — code, plan, or spec — requires an agent that can see the spec. That agent is Claude (the architect/gatekeeper), never cold-Codex.

So on `changes_requested`, findings pass through **Claude adjudication** before any routing. Claude reads the Codex findings *and* the spec, classifies each finding, and routes by altitude:

| Altitude | Default routing | Full-send routing |
|---|---|---|
| **Code bug** (impl diverges from a correct spec) | reroute to `implement` (closes the loop before QA, preserving "any implement cycle invalidates prior approvals") | same |
| **Spec / plan gap** (spec missing an AC, wrong requirement, design flaw the diff faithfully built) | **escalate to human — do NOT auto-reroute.** Surface the finding + Claude's diagnosis; human amends the spec (→ re-enter at `spec_review`) or dismisses | **Claude auto-drafts the spec amendment and re-enters at `spec_review`** autonomously (no interrupt) — full-send means the human pre-authorized autonomous spec changes, same as it already skips the spec gate |
| **False positive** (intended per a Non-Goal; Codex lacked context) | Claude dismisses with documented rationale, no reroute | same |

The keystone is the spec-gap row, and it falls straight out of canon's **"the spec gate is human-owned"** invariant: spec amendments are human decisions, so a spec-level finding must surface to the human rather than silently rewrite the spec — *except* under full-send, where the human has explicitly delegated that authority (full-send already skips the spec gate and auto-opens the PR; auto-amending on a spec-gap finding is the same delegation).

This also resolves the old "advisory vs. auto-reroute" debate, which was a false binary. The right answer is **altitude-dependent**: code findings stay automatic (preserving the fix-before-QA invariant); spec findings go advisory-to-human (honoring the human-owned spec gate) — or autonomous under full-send. The observed reality that Codex's findings skew holistic/spec-level is exactly why the original all-auto-reroute design was wrong.

**Mechanics deferred to plan**: whether adjudication is a small Claude sub-step inside `codex_code_review` that emits a routing decision, or is implemented by re-entering the existing Claude `code_review` phase with the Codex findings injected (Claude `code_review` is already the adjudicator role). The spec fixes the *contract* (findings are adjudicated by a spec-aware agent; routing is altitude-dependent per the table); the implementation seam is a plan/implement decision.

### Runaway prevention (the `MAX_CODEX_REROUTES` cap)

The full-send auto-amend path opens a loop the per-loop counters cannot bound: `code_review → codex_code_review → amend → spec_review → plan → implement → code_review → codex_code_review → …`. Each amendment resets `iterations_current_loop`, so `MAX_REVIEW_LOOPS` never trips even as the task cycles the whole pipeline repeatedly. The fix is the cumulative, never-reset `codex_code_review.reroutes_total` counter capped by `MAX_CODEX_REROUTES` (default 3). At cap the run auto-blocks and escalates to a human **regardless of full-send**. The auto-block message frames a high count as a *design signal* — N Codex-driven reroutes (especially amendments) means the spec likely has a deeper problem — and routes to a human rather than inviting a counter bump, consistent with canon's "never silently raise caps / same-finding-N-iterations = the spec is wrong" discipline.

## Non-Goals

- **Default-on / always-run.** The phase never runs unless a task opts in. This inverts the original spec's "Per-task opt-out" non-goal: opt-in is now the model.
- **Tier-based eligibility.** No `detectTier` gate. Size and delicate status do not affect whether the phase runs — only the flag does. (Size still affects effort selection when it *does* run.)
- **A global env-var disable switch.** The original `CODEX_CODE_REVIEW_DISABLED` env var is dropped. With opt-in, "don't run it" is just "don't set the flag," so a global kill-switch is redundant. (A future global toggle, if ever needed, would be a separate change.)
- **`codexModelFull` for any size.** Mini-only, by design. If catch rate on XL/delicate proves to need a stronger model, that's a one-line follow-up — but the default is mini.
- **Customizing the Codex review prompt.** The framing benefit is "Codex sees the diff cold." Adding spec context, AC anchors, or canon framing defeats the purpose. `codex review --base <base_branch>` with default behavior; no PROMPT positional arg. Note: altitude classification (code vs. spec vs. false-positive) is **Claude's adjudication job**, not Codex's — Codex stays cold; giving it the spec to self-classify is explicitly out of scope and would destroy the catch-rate value.
- **Auto-amending the spec outside full-send.** In the default (non-full-send) mode, a spec/plan-level finding **escalates to the human** — canon never silently rewrites a human-owned spec. Autonomous spec amendment happens *only* under full-send, where the human has pre-delegated that authority.
- **Parallel review with Claude.** Codex runs only after Claude approves — never alongside, never on intermediate Claude reroute cycles.
- **Skipping Claude on Codex-triggered reroutes.** When Codex returns changes_requested, the next cycle goes implement → Claude `code_review` → (if approved) → Codex `codex_code_review`. Claude re-reviews from scratch. Skipping it would break the "any implement cycle invalidates prior approvals" invariant.
- **Commit-SHA / "last Codex-approved baseline" scoping.** The review covers the full task delta from `base_branch` on every iteration. No `phases.implement.commit_sha` field is introduced. (Re-review cost is a bounded, accepted tradeoff — see Known Risks.)
- **Migrating existing in-flight tasks.** Tasks created before this ships won't have `phases.codex_code_review` or the `codex_code_review` flag in status.json. The orchestrator reads both as default (absent flag → false → skip; absent phase entry → default empty). No migration script.

## Acceptance Criteria

> These are **behavioral contracts** only. Implementation mechanics — exact symbol/constant names, the severity regex, the `codex review` argv ordering, the phase-gate field wiring, and the artifact format — live in *Design → Affected Files* and the *Mechanics (deferred)* note there; they are guidance for plan/implement against the current tree, **not** AC surface to be re-litigated at spec_review. Verification is consolidated into the single **Testing Matrix** (AC-12) rather than scattered across per-AC clauses.

- [ ] **AC-1 (phase + opt-in, no tier gate)**: A new phase `codex_code_review` sits between `code_review` and `qa` in `PHASE_ORDER`, opt-in via a top-level `codex_code_review` boolean (default `false`/absent). **The flag alone governs eligibility — there is no tier gate**: task size and `delicate` never force or suppress the phase (size only sets Codex effort when it does run).
- [ ] **AC-2 (skip when not opted in)**: When no in-scope task opts in, the phase is a no-op skip — it writes a skip artifact, sets verdict `approved`, invokes no Codex CLI, and advances to `qa`. In bundle mode the Codex pass runs if **any** bundled task opts in; non-opted tasks in the bundle receive the skip artifact.
- [ ] **AC-3 (cold review, mini model)**: When opted in, the phase runs `codex review` against the **full task delta from `base_branch`**, **cold — no spec/AC/canon context injected** (the cold framing is the entire value and must be preserved). Model is `codexModelMini` for **every** size — no full-model promotion, even on XL/delicate; effort scales by size.

- [ ] **AC-4 (verdict + persistence)**: The phase derives a verdict from Codex's P0–P3 findings — any P0/P1/P2 → `changes_requested`; P3-only → `approved_with_nits`; none → `approved` — and persists the raw Codex output plus the computed verdict per round to `codex-review.md` (append, never overwrite).
- [ ] **AC-5 (fail closed)**: A non-zero `codex` CLI exit (missing binary, network, auth, timeout) fails closed — phase marked `blocked`, stderr captured to the artifact, **never** marked `approved` (must not mask outages).
- [ ] **AC-6 (non-resumable)**: The phase is non-resumable by design — no `sessions` slot; each iteration is a fresh cold pass.
- [ ] **AC-7 (adjudication)**: On `changes_requested`, findings are **adjudicated by Claude** (the spec-aware agent) before any routing — never auto-rerouted blind. Each finding is classified **code bug / spec-plan gap / false positive**, and Claude's per-finding rationale is persisted to a human-readable adjudication artifact.
- [ ] **AC-8 (altitude routing)**: Adjudicated findings route per the table in *Decision → Adjudicated, altitude-aware routing*: **code bug** → reroute to `implement` (full reroute reset; re-enters Claude `code_review` from scratch); **false positive** → dismissed with rationale, no reroute (an all-dismissed round resolves to `approved`/`approved_with_nits` and advances to `qa`); **spec/plan gap** → escalate to a human by default (halt, escalation entry, no spec edit, no `qa`), or auto-amend the spec and re-enter `spec_review` under full-send.
- [ ] **AC-9 (runaway cap)**: A cumulative `codex_code_review.reroutes_total` counts every Codex-driven reroute (code-bug reroute **and** full-send amendment) and is **never reset** — not by reroute, amendment, or approval. It is capped by `MAX_CODEX_REROUTES` (default 3, env-overridable); at the cap the run **auto-blocks and escalates to a human even under full-send** (the guard overrides full-send, as ordinary auto-block does). Auto-block/escalation messaging frames a high count as a spec-design signal, never an invitation to bump the cap. (The existing per-loop `iterations_current_loop`/`MAX_REVIEW_LOOPS` still bounds within-version churn; this cumulative cap bounds the cross-amendment loop the per-loop counter cannot.)
- [ ] **AC-10 (state + gate integrity)**: (a) Schema additions — the opt-in flag and the phase entry (including cumulative `reroutes_total`) — land in the StatusJson type, the template, and `canon task new` scaffolding, with absent-field reads defaulting safely (no migration). (b) `codex_code_review` is registered as a review phase for verdict/counter handling, which **intentionally** also makes it pre-flight-rejection eligible. (c) A **uniform phase gate** guards advancement to `done` (artifact present + non-template, verdict supplied, verdict matches the artifact) with **no exemption** — skip, escalate, and amend paths all satisfy it via their persisted artifacts. (d) The old `code_review → qa` transition is **removed** (advance path becomes `code_review → codex_code_review → qa`) so `qa` can never run before `codex_code_review`. (e) `--reroute` resets `codex_code_review` alongside `implement`/`code_review`/`qa`, and the dry-run plan shows the phase gated on the opt-in flag.

- [ ] **AC-11 (docs + sync)**: All canon-managed surfaces are updated and template-synced — `docs/pipeline-orchestrator.md` (PHASE_ORDER, mini-only model row, opt-in flag, adjudicated routing, `MAX_CODEX_REROUTES`/`reroutes_total` + cap-overrides-full-send), `CLAUDE.md` (Review Responsibilities: opt-in two-agent review), `AGENTS.md` (review flow + the **extended full-send semantics**), `CODEX.md` (codex_code_review responsibilities, no spec injection), `docs/codebase-map.md` (new module), the `_full_send` template doc line, and a `CHANGELOG.md` Added bullet — and `npm run docs-refs-check` + `npm run sync-templates:check` pass. No reference to a `CODEX_CODE_REVIEW_DISABLED` env var exists anywhere (it is not part of this design).

- [ ] **AC-12 (Testing Matrix)**: The following are covered by automated tests. (Test-file placement and helper/symbol names are mechanics — locate existing files at implement time; consolidate per the project's per-feature test-file convention.)

  | Area | Cases | Expected |
  |---|---|---|
  | Severity parser | empty · "no findings" prose · single P2 · mixed P0–P3 · invalid digit (`[P5]`) / missing `- ` prefix · `- [P2]` mid-content | correct P-counts; invalid/unprefixed not counted; mid-content counted (accepted line-prefix false positive) |
  | Verdict derivation | P0/P1/P2 present · P3-only · none | `changes_requested` · `approved_with_nits` · `approved` |
  | Policy matrix | codex_code_review × {S,M,L,XL} · delicate M | mini model every size; delicate raises effort to `high` but stays mini (no full promotion) |
  | Task CLI verdict | `done approved` · `done changes_requested` · `done approved` after prior CR · non-review phase given a verdict | verdict written; counters increment; `iterations_current_loop` resets on approve; error text lists all three review phases |
  | Phase gate | missing artifact · verdict mismatch · match · skip artifact | `{ok:false}` · `{ok:false}` · `{ok:true}` · `{ok:true}` (uniform gate covers skip without exemption); last-block verdict extracted on multi-round |
  | Opt-in routing | no task opted in · ≥1 opted in | skip artifact + `approved` + no CLI + advance to qa · Codex path taken |
  | Adjudication + cap | code-bug · spec-gap non-full-send · spec-gap full-send (under cap) · false-positive (all dismissed) · cap reached (code-bug AND full-send amend) · env override | →implement +`reroutes_total` · halt + escalation, no reroute/amend/qa · →spec_review +`reroutes_total` · no reroute, →qa · auto-block + human **even in full-send** (full-send does not bypass cap) · `MAX_CODEX_REROUTES` honored |

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/types.ts` | Add `'codex_code_review'` to `PHASE_ORDER`; add optional `codex_code_review?: boolean` to `StatusJson`; add `reroutes_total` to the codex_code_review phase-entry type. Verify `Phase`/`PhaseEntry` derivations propagate. No `StatusJson.sessions` change (AC-6, non-resumable). |
| `scripts/run-task/phases/codex-code-review.ts` | **New file**. Exports `runCodexCodeReviewPhase`. Reads per-task `codex_code_review` flag; if none opted in, writes skip artifact + advances; else reads `base_branch`, calls `runCodexReview`, parses output, writes `codex-review.md`, sets verdict, and on `changes_requested` performs (or triggers) Claude adjudication → altitude-aware routing (AC-7/AC-8). |
| `scripts/run-task/agents/codex.ts` | Add exported `runCodexReview(args)` invoking `codex -m <model> -c model_reasoning_effort=<effort> review --base <base_branch>` from task cwd; capture stdout+stderr; record metrics; return raw result without exiting on non-zero. Do **not** modify `runCodex`. |
| `scripts/run-task/main.ts` | Dispatcher: route to codex_code_review after code_review approves; implement the adjudicated routing (code → implement; spec-gap → escalate/halt, or full-send → re-enter spec_review) and the `MAX_CODEX_REROUTES` cap check + `reroutes_total` increment + cap-overrides-full-send auto-block (AC-7–AC-9). Extend `printDryRunPlan`'s Codex-phase branch to include codex_code_review gated on the opt-in flag (AC-10e). No `autoCommitCode` change (no SHA tracking). No `checkDeps` change (Codex binary already required for spec_review/implement). No `sessions` resumption change (AC-6). |
| `scripts/run-task/state.ts` | Verify `deriveTopLevelStatus` walks new PHASE_ORDER correctly (likely no code change). |
| `scripts/run-task/check-phase-gate.ts` | Verify `--expect codex_code_review` works (likely no code change — PHASE_ORDER-driven). |
| `scripts/pipeline-policy.ts` | Add `'codex_code_review'` to `CodexPhase`; add mini-only `codexMatrix` row (AC-3). |
| `scripts/run-task/validation.ts` | Add `parseCodexReviewSeverities`, `deriveCodexCodeReviewVerdict`, `extractCodexReviewVerdict`. Extend `PhaseGateConfig` with optional `verdictExtractor`. Add `codex_code_review` entry to `PHASE_GATE_CONFIG`. Extend `checkPhaseGate` to use `verdictExtractor` when present, else `extractCheckedVerdict`. |
| `src/task/index.ts` | Add `'codex_code_review'` to `REVIEW_PHASES`; update `assertValidVerdict` error text to list all three review phases. Note the intentional pre-flight-rejection coupling (AC-10b). PHASE_ORDER-driven validation already handles the name. |
| `.canon/templates/status.json` | Add top-level `codex_code_review: false` flag (+ doc line) and `phases.codex_code_review` entry (incl. `reroutes_total: 0`). Update the `_full_send` doc line to reflect the extended semantics (full-send also auto-amends the spec on a spec-gap Codex finding, bounded by `MAX_CODEX_REROUTES`). |
| `templates/.canon/templates/status.json` | Mirror (auto-synced). |
| `tests/codex-code-review-phase.test.ts` | **New file**. Severity parser + verdict derivation + opt-in routing tests. |
| `tests/pipeline-policy.test.ts` | Add codex_code_review matrix rows (mini-only; delicate stays mini). |
| `tests/` (parser/policy/task-phase/phase-gate/harness test files — locate at implement time) | Cover the AC-12 Testing Matrix; consolidate per the project's per-feature test-file convention rather than one file per helper. |
| `docs/pipeline-orchestrator.md` | PHASE_ORDER, model matrix row, opt-in flag, review-loop note. |
| `templates/docs/pipeline-orchestrator.md` | Mirror (auto-synced). |
| `CLAUDE.md` / `templates/CLAUDE.md` | Review Responsibilities note (opt-in two-agent review). |
| `AGENTS.md` / `templates/AGENTS.md` | Phase order / review flow / opt-in flag / adjudicated routing / **extended full-send semantics** (auto-amend on spec-gap finding) + `MAX_CODEX_REROUTES` cap. |
| `CODEX.md` / `templates/CODEX.md` | codex_code_review responsibilities section. |
| `docs/codebase-map.md` / `templates/docs/codebase-map.md` | New phase module entry. |
| `CHANGELOG.md` | New bullet under unreleased → Added. |
| `dist/cli/index.js`, `dist/scripts/run-task.js` | Build-generated; regenerated by `npm run build`, committed to satisfy CI's `git diff --exit-code -- dist/` gate. No hand edits. |

> **Mechanics deferred (guidance, not AC surface).** The following are left to plan/implement against the current tree — the sibling phase modules and `runCodex` have likely drifted from the original snapshot, so verify all shapes at implement time:
> - **New helpers** (suggested names): `runCodexCodeReviewPhase` (phase module, signature matching the sibling phases); `runCodexReview` in `agents/codex.ts` (the existing `runCodex` requires a non-empty prompt + `codex exec`, so a new helper is needed); pure `parseCodexReviewSeverities` and `deriveCodexCodeReviewVerdict`; `extractCodexReviewVerdict` for the gate.
> - **`codex review` invocation gotcha**: model/effort are **top-level flags before the `review` subcommand** — `codex -m <model> -c model_reasoning_effort=<effort> review --base <base>`. `codex review -m <model>` is invalid (the subcommand has no `-m`). Confirm against the installed CLI.
> - **Severity parse**: line-prefix match `^- \[P([0-3])\] ` (multiline). Mid-content lines count (accepted false positive).
> - **Phase gate**: extend `PhaseGateConfig` with an optional `verdictExtractor` (codex-review.md uses a `- Verdict: <value>` line, not a checkbox); the extractor reads the **last** `### Verdict (orchestrator-computed)` block.
> - **Artifact shape** (illustrative): per round, raw Codex stdout followed by a `### Verdict (orchestrator-computed)` block listing `P0–P3`, `Verdict`, `Base branch reviewed`, `Iteration`. Skip/escalate/amend paths write the same block shape (with a `(skipped — <reason> …)` or adjudication body) so the uniform gate holds. Adjudication rationale is persisted as an `## Adjudication` section (or sibling artifact).
> - **CLI failure**: capture stderr (truncate ~4KB) under a `### CLI Failure` heading; phase `blocked`, exit non-zero, never `approved`.

### Interaction Dependencies

- **Reroute machinery (`canon run --reroute`)**: existing reroute resets `implement`, `code_review`, `qa` to pending. Extend to also reset `codex_code_review`.
- **Bundle mode**: existing bundle dispatch runs one agent session for code_review across tasks. codex_code_review reuses the pattern (one CLI call, output replicated to opted-in tasks).
- **Session resumption**: `codex_code_review` is intentionally non-resumable (AC-6). No `sessions.codex_code_review` slot.
- **Pre-flight rejection**: adding to `REVIEW_PHASES` couples codex_code_review into the pre-flight rejection path — intentional (AC-10b).
- **`canon task accept`**: today supports `implement` only. Out of scope to extend to codex_code_review; an operator who doesn't want the phase on a task simply leaves the flag unset.
- **Full-send mode (`full_send`)**: this task **extends** full-send's meaning. Today full-send = skip spec gate + auto-open PR after clean QA. After this task, full-send *also* = auto-amend the spec on a spec-gap Codex finding (AC-8), bounded by `MAX_CODEX_REROUTES`. The cap's auto-block overrides full-send (AC-9) — full-send's "no interrupts" yields to the runaway guard, exactly as ordinary auto-block already does.
- **Escalations (`status.json.escalations`)**: the non-full-send spec-gap halt (AC-8) appends an escalation entry. Reuses the existing escalations array; no schema change beyond a new entry kind.
- **Quality log (`docs/task-quality-log.md`)**: column schema unchanged.

### Data Model Changes

- `Phase` union: adds `'codex_code_review'`.
- `StatusJson`: adds optional top-level `codex_code_review?: boolean` (opt-in flag).
- `StatusJson.phases.codex_code_review`: new phase entry — same shape as `code_review` **plus** a cumulative `reroutes_total: number` (never reset; AC-9).
- `StatusJson.sessions`: no change (non-resumable).
- New env var `MAX_CODEX_REROUTES` (default 3) — not persisted in status.json; read at dispatch like `MAX_REVIEW_LOOPS`.

No migration for in-flight tasks: absent flag reads as false (skip); absent phase entry reads as default empty (`reroutes_total` defaults to 0) on first dispatch.

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
- **Iteration counter doubling (within a spec version).** Worst case: `MAX_REVIEW_LOOPS` Claude iterations + `MAX_REVIEW_LOOPS` Codex iterations, with every Codex code-bug reroute triggering a fresh Claude re-review (≤ `MAX_REVIEW_LOOPS²` Claude iterations in the absolute worst case). In practice tasks converge well below; hitting the per-loop cap signals a deeper spec/impl issue and auto-block is correct.
- **Cross-amendment runaway (full-send).** The full-send auto-amend path (AC-8) can loop `codex_code_review → amend → spec_review → plan → implement → code_review → codex_code_review`, and each amendment **resets** `iterations_current_loop` so the per-loop cap never trips. This is the specific runaway the cumulative `reroutes_total` + `MAX_CODEX_REROUTES` cap (AC-9) exists to stop — at cap the run auto-blocks and escalates to a human even under full-send. Without the cap a full-send run could amend the spec indefinitely; the cap is therefore load-bearing, not a nicety. Default 3 is deliberately low because amendment-driven churn almost always means the spec is wrong, not that more iterations will converge.
- **Adjudication misclassification.** Claude could mis-classify a finding's altitude — call a genuine spec gap a "code bug" (→ wasted implement cycle that can't fix it, eventually caught by the cap) or a real bug a "false positive" (→ ships). Mitigation: the adjudication artifact records Claude's per-finding rationale (AC-7/AC-8) so a human can audit the calls at human_review or PR review; and the cap converts persistent mis-routing into a human escalation rather than an infinite loop. This is an inherent limit of any altitude-routing layer and is accepted; the artifact + cap bound the blast radius.
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
6. **Spec-gap finding escalates to human (default mode).** On an opted-in task (not full-send), arrange for Codex to surface a finding whose root cause is a missing requirement (e.g. an unhandled case the spec never asked to handle). Confirm Claude's adjudication classifies it as a spec/plan gap, the run **halts with an escalation entry** (does NOT reroute to implement, does NOT touch the spec, does NOT advance to qa), and the adjudication artifact explains the diagnosis. Confirm you can then revise the spec's Amendment section and re-run.
7. **Spec-gap finding auto-amends (full-send).** Same setup but with `full_send: true`. Confirm Claude auto-drafts the amendment, the run re-enters at `spec_review` without prompting you, and `reroutes_total` incremented. Confirm the amendment then flows through spec_review normally.
8. **False positive does not force a reroute.** On an opted-in task, arrange for Codex to flag behavior that is intended per a Non-Goal. Confirm Claude's adjudication dismisses it with a recorded rationale, no implement reroute happens, and the pipeline advances to qa.
9. **Runaway cap halts full-send.** On a full-send task, force repeated spec-gap findings (or set `MAX_CODEX_REROUTES=1`). Confirm that once `reroutes_total` hits the cap the run **auto-blocks and waits for you even though full-send is on**, and the message points at the spec as the likely root cause rather than suggesting a cap bump.
10. **Quality-log audit after several opted-in tasks.** Check `docs/task-quality-log.md`. Are codex_code_review's P0/P1/P2 findings real bugs Claude `code_review` missed? If yes, opting in is paying off. If consistently no, stop opting in (or file a follow-up to retire the phase). Also spot-check the adjudication artifacts: are altitude classifications (code vs. spec vs. false-positive) landing correctly?

---

## Spec Quality Checklist

> Claude: complete this before marking spec done.

- [x] ACs are **behavioral contracts** (12, not 46); mechanics deferred to Affected Files + the Mechanics note; verification consolidated into the AC-12 Testing Matrix — per the over-specification lesson in `docs/lessons-learned.md`
- [x] Affected Files lists specific files with specific change descriptions (and carries the deferred implementation mechanics)
- [x] Known Risks covers failure modes for the trickiest ACs (parser brittleness, counter doubling, cross-amendment runaway + cap, adjudication misclassification, chicken-and-egg, bundle amplification, framing-anchor temptation, opt-in adoption, evidence bypass)
- [x] Human Test Plan uses product/behavior language only
- [x] Validation Required has at least one entry marked `- [x]`
