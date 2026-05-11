# Canon Backlog

> Future work on the orchestrator itself — features, architectural directions, and capabilities not yet built. This file is canon-ai's own roadmap, not a backlog for projects that *consume* canon-ai (those have their own).
>
> Entries are prose, not tickets. Each captures enough context to reload cold: the problem, the design, what's in scope vs. punted, risks to watch. Effort tags follow the same scale as the workflow rules: `S` (hours to ~2 days), `M` (~2-5 days), `L` (up to ~1 sprint), `XL` (milestone-staged).

## 🛡️ Pipeline Architecture

- [ ] **Scoped Audits Framework + `guard_audit` as the First Audit** *(designed 2026-05-07 from a multi-agent review thread)*
  - **Scope**: Generalize `code_review` from one omnibus reviewer into a *stage* that fans out to N specialist auditors, each scoped to a single concern. The current code-review prompt asks the reviewer to check a long list of things in one pass — spec compliance, validation gates, citation grounding, plan deviations, cross-cutting guards, and so on. Specialist agents with focused prompts and dedicated artifacts are easier to author, easier to evolve, harder to skip silently, and parallelizable. Step 1 is the framework + first audit (`guard_audit`); Step 2 (deferred until Step 1 has shipped through one delicate task on a real project) adds a second audit to prove the generalization.
  - **Framework shape**: A new pipeline stage `audits` sits between `code_review` and `qa`. It runs zero-or-more registered audits sequentially (parallelize later if wall time grows). Each audit is a small plugin: `{ name, when(status, files) → boolean, promptBuilder, artifact, collector?, config? }`. Registry lives in `scripts/pipeline-policy.ts`. Verdict aggregation: any audit FAIL → reroute to implement (audit artifacts join `review.md` as feedback); all PASS → advance to qa. Implement-revision prompt updated to read `tasks/<id>/audits/*.md` for FAILED audits alongside `review.md §Round N`.
  - **`status.json` shape**: `phases.audits` becomes a container with sub-items (`items.<name>.status`, `items.<name>.verdict`, `items.<name>.iterations`) mirroring the existing phase shape so the dispatcher reuses most routing logic. `task.sh` gains a helper to advance audit items.
  - **Artifact layout**: `tasks/<id>/audits/<name>.md`, one per audit. Templates in `tasks/_templates/audits/<name>.md`. Each audit's artifact follows the same skeleton: per-item verification table, verdict checkbox, required actions if FAILED.
  - **First audit — `guard_audit`**: Triggered by `delicate: true`. Hybrid script + LLM. The collector (`scripts/guard-audit-collect.ts`) reads a project-defined registry at `.canon/guards.json` (a small list of guard helper names — auth helpers, feature-gating wrappers, mutation-chokepoint validators — registered per-project), greps the task baseline and HEAD for call sites of each guard, extracts the containing function for each call site, and emits structured JSON. The LLM step (focused Claude phase) reads the JSON + `spec.md` + diff and decides per call site: PRESERVED / RELOCATED (guard moved up the call stack to a wrapper that still gates every entry point) / DROPPED (operation still exists but guard is gone — automatic FAIL) / OBSOLETE (operation no longer requires the guard and `spec.md` authorizes removal — citation required). Writes verdict to `audits/guard.md`.
  - **Triggering failure pattern**: A delicate refactor that consolidates mutation entry points (e.g., moves several call sites into a single store action or shared helper) can silently drop the cross-cutting guards that wrapped the original sites. The general code-review prompt has too much else to check; a specific "for each pre-refactor guard call site, find the post-refactor equivalent and verify the guard survives" pass is what catches this reliably. The CLAUDE.md/AGENTS.md rule alone has historically not been enough — a memory rule that didn't stick becomes a deterministic check.
  - **What's built in Step 1**: `audits` field in `status.json` + `task.sh` helper; `Audit` type + registry in `pipeline-policy.ts`; `runAuditsPhase()` in `run-task.ts` (sequential dispatch loop); reroute-on-failure routing in `checkAndRoute`; the `guard_audit` collector + prompt + template; implement-revision prompt updated; `AGENTS.md` / `CLAUDE.md` docs on the new phase. Estimated 600–800 lines total.
  - **Marginal cost of audit #2**: ~150 lines (prompt builder + template + registry entry + optional collector). The framework absorbs the structural cost.
  - **Punted to later iterations**: auto-detection of which audits to enable from changed paths (start manual: opt in via flags or simple conditions like `delicate: true`); parallel audit execution; per-audit iteration limits and round-2+ slim prompts (audit count is small enough that shared iteration counters and full prompts every round are fine for now); audit-level session resume (audits are stateless one-offs like QA, no resume needed).
  - **Future audits worth adding** (each is a separate ~150-line addition once the framework exists, not separate backlog entries):
    | Audit | When | What it checks |
    |---|---|---|
    | **a11y** | Affected Files include UI component paths | WCAG AA — contrast, focus order, keyboard nav, ARIA |
    | **perf** | Affected Files include hot-path components / hooks | direct DOM writes preserve framework reconciliation contract; no re-render thrash; paint regressions |
    | **breaking-change** | Affected Files include public type surfaces | exported types preserved or deprecations documented |
    | **e2e-locator-coverage** | Diff touches user-visible labels/buttons | every changed label has updated e2e locator (catches the "test deferred while button name changed" pattern) |
    | **citation-grounding** | docs-check flagged any package | every flagged package has a real API cited in handoff. Often inside the omnibus code-review prompt today; extracting it tightens that prompt and gives citations a dedicated artifact. |
    | **deploy-smoke** | Affected Files include deployment config (vercel.json, next.config.js, route configs) | required preview-environment HTTP checks (`/`, `/login`, key routes); local build pass is not enough for route/config tasks. Surfaced from TokenAnxiety dogfood discussion #27 — ui-001 passed local validation but the Vercel preview exposed 404s from `cleanUrls: true` interacting with rewrite destinations. |

    Project-specific audits register their own conditions; canon ships the framework and a couple of generic audits, projects layer on what they need.
  - **Risks to watch**: (a) false positives on legitimate guard consolidation — if a refactor pulls multiple guards into one wrapper, the script flags multiple "DROPPED"; the LLM RELOCATED verdict handles this but the prompt must explicitly check "is the wrapper reachable from every entry point?"; (b) `.canon/guards.json` registry drift — needs a maintenance home, probably appended during the periodic lessons-sweep when a new guard helper is introduced; (c) scope leakage — should the audit grep all of `src/` or just files in spec's Affected Files? Probably all of `src/`, since *unlisted* call sites are exactly where guards get silently dropped.
  - **Why this generalizes the multi-agent-review pattern**: Specialist agents with different scopes are the direction the ecosystem is heading — OpenHands has SecurityAnalyzer, Aider's architect mode externalizes the planner/editor split, hobbyist setups are ad-hoc fanning out review concerns to multiple Claude calls. This framework is the orchestrator-level realization of that pattern: each audit is an agent with a single concern, focused prompt, and dedicated artifact, all routed by data rather than handcrafted dispatch logic. Audit #2 is the proof that generalizes.
  - **Recommended sequencing**: Build framework + `guard_audit` together as Step 1 in one pipeline-infra session. Don't add a second audit in the same change — let one delicate task validate the shape end-to-end first. The audit phase touches dispatcher routing, so this benefits from one round of grilling against an actual delicate-task spec before code lands. Pipeline-infra-changes-are-inline applies; this is the shape of work that goes inline.
  - **Effort**: `M` (Step 1: framework + first audit). `S` (each subsequent audit).

- [ ] **`architect_review` phase — same-model semantic sign-off between code review and QA** *(designed 2026-05-09 from a multi-session conversation about model portability and review independence)*
  - **Scope**: Add a new pipeline phase between `code_review` and `qa` that asks a fundamentally different question than code review: "ignoring whether the patch technically works, is this the right *solution shape* for the problem?" Run by Claude (same model as the code reviewer) but in a fresh session with strict context isolation, an opinionated senior-engineer persona, and a forced counterfactual. The phase produces a three-way verdict: `agree`, `concern_for_human_attention` (advance to QA but flag in `done.md`), or `block_due_to_architecture_risk` (halt, route to human via the existing reroute mechanism, no automatic retry).
  - **Why it's wanted**: code review is line-level — "does this implementation match the spec?" QA is operational — "can we verify behavior with tests?" Neither asks the 30k-ft question: "did this *solve the stated problem*, or did it just satisfy the ACs?" "Are we painting ourselves into a corner?" "Is the spec's framing still right in light of what got built?" Today that check is implicit in the human gate — the human reads `done.md` and either notices semantic drift or doesn't. A structured architect review pre-flags specific shape concerns rather than relying on the human to spot them cold.
  - **Why same-model is acceptable here (the no-self-review principle, refined)**: canon's no-self-review rule strictly read is "no same-model review of the same question with the same context." Architect review asks a *different question* than code review (solution shape vs. line-level correctness), in a *different context* (fresh session, no code-review rationale, opinionated persona). It is not self-review under the strict reading even though both phases are run by Claude. Persona-shift produces independence of question, not independence of blind spots — accepted weakness. This is the *best* place to relax cross-model purity because the failure modes that matter at 30k ft (corner-painting, scope drift, "satisfied ACs but didn't solve the problem") are intuition-level, not LLM-blind-spot-level. The principle should be promoted into `AGENTS.md` as part of this work so the rule is explicit before the phase ships.
  - **Triggering rules**:
    - **Required** for `task_size ∈ {M, L, XL}` and any `delicate: true` task.
    - **Skipped** for `task_size = S` non-delicate (overhead not justified for tiny patches).
    - **Bundle mode**: triggered if any task in the bundle would individually trigger it. One architect review per bundle, not per task — the question is about the bundle's overall shape.
  - **Phase shape and gating**:
    - Runs only when `code_review.verdict ∈ {approved, approved_with_nits}`. If code review is `changes_requested`, the pipeline iterates implement → code review as today. Architect review is downstream of code-review approval; it never fires against a known-broken state.
    - **Single-shot, no review-loop.** Architect review is not iterative — its concerns are upstream-of-implementation (spec / plan / shape), not implementation defects. A `block_due_to_architecture_risk` verdict halts and routes to the human, who decides whether to revise spec, replan, or override. No automatic bounce back to Codex (different from `code_review` failures).
    - `agree` → orchestrator advances to `qa` silently.
    - `concern_for_human_attention` → orchestrator advances to `qa`, sets a flag the QA prompt reads to surface the concern in `done.md` under a new *Architect concerns* section.
    - `block_due_to_architecture_risk` → orchestrator halts, prints the concern, exits non-zero. Operator triggers `--reroute` (existing mechanism) to route back to spec/plan, or overrides via manual phase update.
  - **Inputs (context isolation is load-bearing)**:
    - `spec.md`, `plan.md` (full).
    - The diff (`git diff <baseline>...HEAD`).
    - `code_review.verdict` only — **NOT** the rationale or finding text. Sharing rationale anchors the architect review onto the code review's prior conclusions, defeating the persona-shift. Worth A/B testing whether to share the verdict at all (see Risks).
    - `handoff.md` (full, including any *Iteration N* sections).
    - **Explicitly excluded**: `review.md` body, `notes.md`, prior architect-review artifacts.
  - **Prompt design constraints**:
    1. **Fresh session, adversarial persona.** "You are a senior engineer pulled in to challenge this result, not bless it. Default disposition is skeptical. If the work looks fine, you must defend that conclusion against your own challenge."
    2. **Question explicitly different from code review.** Asks: "Did this solve the problem stated in the spec, or just satisfy the ACs?" "Does anything look like a corner-painting choice future work will regret?" "Is the spec itself still the right framing in light of how this came out?" Does NOT ask "is the code correct" or "does the diff match the spec line-by-line."
    3. **Forced counterfactual.** "What would a senior engineer have done differently if starting from scratch today, knowing what we know now?" Makes the persona do real comparative work and prevents passive acceptance.
    4. **Output schema forces explicit position.** Three-way verdict mandatory. Free-text concern justification required only on `concern_for_human_attention` or `block_due_to_architecture_risk`. Verdict is not the path of least resistance — the model must actively choose a stance, including a defended `agree`.
  - **Artifact and status integration**:
    - New artifact: `tasks/<id>/architect-review.md`. Template carries the four-question structure (problem still correctly framed? solution shape appropriate? hidden future-cost / corner-painting risk? human attention warranted?) plus the verdict and (when non-`agree`) the concern justification.
    - `status.json` gains `phases.architect_review` with `status` and `verdict` fields, mirroring the existing phase shape so the dispatcher reuses routing logic.
    - QA prompt updated to read `architect-review.md` and surface non-`agree` concerns under *Architect concerns* in `done.md`.
    - `docs/task-quality-log.md` gains a column for architect-review verdict and a column for "did it catch something not already in code review or QA." This is how the phase earns its keep empirically.
  - **What's built (estimated 400–600 lines)**:
    - `phases.architect_review` field in `status.json` schema + `task.sh` helper.
    - `runArchitectReviewPhase()` in `run-task.ts` (single-shot dispatch, three-way verdict parsing).
    - Routing in `checkAndRoute`: `agree` / `concern_for_human_attention` → `qa`; `block_due_to_architecture_risk` → integrate with existing reroute mechanism.
    - Prompt template (canon-supplied default + project overlay hook).
    - Artifact template `tasks/_templates/architect-review.md`.
    - QA prompt update for *Architect concerns* surfacing.
    - `AGENTS.md` updates: documenting the new phase, the no-self-review principle's "different question, different context" framing, and the three-way verdict.
    - `CLAUDE.md` updates: pipeline-mode role lists architect review; explicit guidance on the persona, context isolation, and counterfactual.
    - `docs/task-quality-log.md` schema additions.
  - **Failure mode to watch — "architect-review-as-cosplay"**: same-model review with a thin persona produces bland approvals that look like signal but aren't. Symptoms: high `agree` rate with vague concerns, the model echoing code review's framing despite isolation, "looks good" with no counterfactual content. Mitigations are all in the prompt: force the counterfactual, exclude code-review rationale, structure the output schema to require explicit position-taking, monitor verdict distribution in the quality log. After 20–30 M/L/XL tasks, audit: did this phase catch issues not already in code review or QA? If not, the prompt or context isolation is too weak — tighten or remove. The phase has to earn its keep.
  - **Risks to watch**:
    - **Anchoring on code-review verdict**: even seeing `approved_with_nits` may bias the architect toward agreement. Consider stripping verdict context entirely and only telling the architect "code review has passed; your job is shape, not correctness." Worth A/B testing both variants (with-verdict vs. without-verdict) on the first 10–15 tasks.
    - **Persona drift across sessions**: opinionated personas tend to soften when given long context. Keep architect-review prompts short and tight; the spec + plan + diff is already a lot of input. Hold the line on excluding code review's rationale and `notes.md`.
    - **Bundle mode interaction**: triggering on the largest task in a bundle is right. Output is one architect review per bundle, not per task. The schema and prompt must handle multi-task input gracefully.
    - **Interaction with `--reroute`**: `block_due_to_architecture_risk` should integrate with the existing reroute mechanism rather than introduce a separate halt path. Reroute already routes back to spec/plan; architect-review block routes the same way with the concern as the reroute reason.
    - **Cost ceiling**: another full-pipeline phase costs tokens. The S-skip rule keeps it off small patches. If real-world cost/value ratio looks bad after the audit, consider gating architect review behind `delicate: true` only rather than M/L/XL broadly.
  - **Punted to later**:
    - **Cross-model architect review** (using a third model for this phase) — interesting future direction but adds dependency on model availability and undermines canon's two-model thesis. Revisit if same-model architect review proves too weak after the 20–30-task audit.
    - **Per-AC architect review** (one verdict per AC vs. one per task) — overkill at this granularity.
    - **Iterative architect review** — explicitly out of scope; the phase is single-shot by design.
    - **Architect review on conversational fast-tier specs** — fast tier doesn't have an architect review pass today. Whether to add a lightweight pre-implement architect review on full-tier spec authorship is a separate question; punt until the post-code phase has shipped and we know whether the value is in pre- or post-implement framing.
  - **Effort**: `M`. Most novel logic is the verdict parsing and three-way routing; the rest follows existing phase patterns. Touches dispatcher routing, so this benefits from one round of grilling against an actual M-tier task spec before code lands. Pipeline-infra-changes-are-inline applies; this is the shape of work that goes inline.

### Wave 3 cluster — follow-ups from TokenAnxiety dogfood discussion #27

*The four entries below were originally filed as GH issues #31–#34, promoted to BACKLOG per the [BACKLOG-vs-issues decision](decisions.md). Each is independently buildable; sequencing notes call out cross-dependencies.*

**Cluster execution plan** *(decided 2026-05-10; minimize delicate scope per cost concern)* — the Wave 3 entries plus the structured-table parser are sequenced as five sub-bundles, only one delicate:

| Sub-bundle | Size | Delicate | Contents | Sequencing | Status |
|---|---|---|---|---|---|
| **1a-0 parser** | S | no | Structured-table parser utility + retrofit AC coverage + validation outcomes | First; blocks 1a-2 | spec'ing |
| **1a-1 counters** | M | no | Counter schema augment (`iterations_current_loop`/`iterations_total`/`changes_requested_total`/`auto_block_count`/`verdict_source`); `iterations` stays as alias | Parallel with 1a-0 | pending |
| **1a-2 gates** | M | **yes** | Centralized invariant-gate helper for `task.sh phase done`; artifact-exists + template-check + verdict-parseable rules | After 1a-0 | pending |
| **1b** | M | no | Validation result enum extension + QA telemetry verification (gate consumers) | After 1a-2 | pending |
| **1c** | M | no | Canon snapshot stamping | Anytime | pending |

- [ ] **Canon snapshot stamping in task status/handoff artifacts** *(framed 2026-05-10 from discussion #27, item 8)*
  - **Scope**: Add a `canon` block to `status.json` (and a corresponding section in `handoff.md`) at task creation that records the canon version governing this task. TokenAnxiety vendors canon-ai through a git submodule (`vendor/canon-ai`), pinned to a specific commit — different canon commits enforce different rules, ship different templates, route through different orchestrator logic. Task artifacts today say *what happened*, not *what canon governed it*. From the discussion: "If a different Canon snapshot was active during a run, the artifacts do not prove it. That should probably become an explicit field in `status.json` or the handoff."
  - **Shape**:
    ```json
    "canon": {
      "upstream_repo": "tstraub89/canon-ai",
      "upstream_commit": "<short SHA at task new time>",
      "orchestrator_commit": "<downstream commit containing scripts/run-task/>",
      "codex_cli": "<from codex --version>",
      "claude_code": "<from claude --version>"
    }
    ```
  - **Detection logic must handle two modes**:
    - **Native canon-ai** (this repo): `upstream_commit` = `git rev-parse HEAD`, `orchestrator_commit` = same.
    - **Vendored canon** (e.g. TokenAnxiety's `vendor/canon-ai`): `upstream_commit` = submodule HEAD, `orchestrator_commit` = downstream repo HEAD. Detection: if `scripts/run-task/main.ts` resolves to a path under `vendor/<dir>`, or any directory containing a `.git` *file* (not folder) pointing to a separate gitdir, it's vendored.
  - **Behavior**:
    - `task.sh new` writes the `canon` block into the initial `status.json`.
    - `run-task.ts` re-captures the snapshot on each invocation and stores it (so tasks created before this feature still get stamped on next pipeline run).
    - `handoff.md` template gains a "Canon Governance" section that references the `status.json` `canon` values.
    - Missing CLI binaries (codex/claude not installed) record `"<unavailable>"` rather than failing.
  - **Why this matters**: turns future dogfood reports from archaeology into normal telemetry. The `canon dogfood-report` BACKLOG entry depends on this.
  - **Affected files**: `scripts/task.sh`, `scripts/run-task/state.ts`, `scripts/run-task/types.ts`, `tasks/_templates/status.json`, `tasks/_templates/handoff.md`.
  - **Sequencing**: Independent of other Wave 3 entries. Reasonable first thing to land from this cluster.
  - **Effort**: `M`. Schema change + write logic + vendored-mode detection.

- [ ] **Status counter consistency + artifact-invariant gate before phase advancement** *(framed 2026-05-10 from discussion #27, items 1+3+8; verified bug at `scripts/task.sh:344`)*
  - **Scope**: Two related failure modes that both reduce to "status.json can disagree with reality." Fix together — they share schema changes and an invariant-gate framework.
  - **Failure mode 1 — Iterations reset to 0 on approval** *(verified bug)*: `scripts/task.sh:344` resets `iterations` to 0 when verdict is `approved`/`approved_with_nits`. By design — the field models the *current loop*, which resets between cycles. But this destroys the cumulative count needed for trend analysis. James's ui-001 has an escalation record saying spec review hit 3 consecutive `changes_requested` rounds, but final `spec_review.iterations` is 0. `code_review.iterations` is also 0 despite review.md having a Round 2.
  - **Failure mode 2 — Phase status can disagree with artifact** *(partially fixed; broader gap remains)*: PR #29 (commit 27463ce) added a post-Codex template check for `spec-review.md`. But the broader invariant — "phase status = done implies a real artifact with a real verdict" — is enforced ad hoc per phase. Examples from discussion #27:
    - intel-001: `spec_review.status = done` while spec-review.md was untouched template (fixed by 27463ce).
    - ui-002: `human_review: done` while validation outcomes had unresolved `human_pending` rows (different shape, same family — covered partially by the validation result states entry below).
  - **Schema additions on `phases.<phase>`**:
    | Field | Semantics |
    |---|---|
    | `iterations_current_loop` | Replaces current `iterations`. Resets on approval. |
    | `iterations_total` | Monotonic, never resets. |
    | `changes_requested_total` | Count of `changes_requested` verdicts across all loops. |
    | `auto_block_count` | Count of auto-blocks for this phase. |
    | `verdict_source` | `"agent"` \| `"human"` \| `"auto_fast_tier"` — distinguishes who set the verdict. |

    Backward-compat: keep `iterations` as an alias for `iterations_current_loop` during a deprecation window; `task.sh phase` writes both until adopters migrate. Same augment-then-deprecate pattern as the `.canon/config.json` migration.
  - **Pre-advance invariant gate**: Centralized helper called by `task.sh phase <id> <phase> done`:
    - If phase requires an artifact (spec, plan, spec-review, handoff, review, done): artifact must exist AND not match `isTemplateUnfilled`.
    - If phase has a verdict field: verdict must be non-empty AND parseable from artifact.
    - Reject with non-zero exit; orchestrator surfaces the rejection and resets phase to `pending`.
    - The Structured-table parser utility (separate BACKLOG entry, in Harness Bugs section) is the prerequisite for the verdict-extraction half — parse handoff/review tables reliably, then enforce.
  - **Affected files**: `scripts/task.sh` (counter logic + invariant gate), `scripts/run-task/state.ts` + `types.ts` (schema), `scripts/run-task/validation.ts` (invariant-gate primitives), `tasks/_templates/status.json` (schema example), new test file or extension of existing tests (coverage).
  - **Sequencing**: Depends on the structured-table parser utility for the verdict-extraction part of the invariant gate. The counter migration can land independently.
  - **Effort**: `M`. Heaviest schema work from #27. Multiple other Wave 3 entries (validation result states, QA telemetry) depend on the invariant-gate framework this entry establishes.

- [ ] **Extend validation result enum: `human_pending`, `deferred_by_spec`, `not_configured`** *(framed 2026-05-10 from discussion #27, item 5)*
  - **Scope**: Validation results today are effectively `pass | fail | N/A`. James's ui-002 dogfood evidence shows this enum is too coarse: OAuth and Safari/Firefox checks were correctly flagged as human-only, but the task was still marked complete and approved before those provider/browser checks were actually done. `done.md` says human testing is pending; `status.json` says `human_review: done`. `Pass`, `N/A`, and `Human pending` are categorically different. Conflating them lets a task close on incomplete evidence.
  - **Proposed enum**:
    | Value | Semantics |
    |---|---|
    | `pass` | Agent ran the check; it passed. |
    | `fail` | Agent ran the check; it failed. |
    | `not_configured` | Check doesn't apply to this task type (replaces most current `N/A` uses). |
    | `human_pending` | Only a human can run this (OAuth, cross-browser, deployed-only smoke). Task cannot close until resolved. |
    | `deferred_by_spec` | Explicitly out of scope per spec. Requires spec citation in the row's notes. |
    | `blocked` | Check would have run but infrastructure unavailable (CI down, network out). Triage required. |
  - **Behavior changes**:
    - Handoff Validation Outcomes table parser recognizes all new states.
    - `human_review: done` requires zero `human_pending` rows in any task in the bundle, OR an explicit waiver from a human in done.md ("Acknowledged: <list of human_pending items> deferred to post-merge follow-up by [reason]").
    - QA prompt surfaces `human_pending` items in done.md under a "Human Verification Required" section so the human sees them before they think they're done.
  - **Affected files**: `scripts/run-task/validation.ts`, `scripts/run-task/prompts/templates/qa-*.md`, `tasks/_templates/handoff.md` (Validation Outcomes legend), `AGENTS.md` (validation matrix docs), `tests/run-task-validation.test.ts`.
  - **Sequencing**: Depends on the counters+invariants entry for the invariant-gate primitives (`human_review: done` rejection logic). Otherwise independent.
  - **Effort**: `M`. Self-contained but touches multiple surfaces.

- [ ] **QA completion requires task-quality-log row + lessons distillation** *(framed 2026-05-10 from discussion #27, item 7)*
  - **Scope**: Canon designates three workflow-observability files (`docs/pipeline-invocations.md`, `docs/task-quality-log.md`, `docs/lessons-learned.md`). The QA prompt assigns ownership but doesn't enforce. From the discussion: "`docs/task-quality-log.md` only has ui-001 even though ui-002 is marked complete. `docs/lessons-learned.md` still contains only template/example content despite multiple durable lessons." The supposed source of truth becomes incomplete, with no signal distinguishing "no lesson worth recording" from "QA forgot."
  - **Pre-advance invariant on `qa.status = done`**:
    - For each task in the bundle: `docs/task-quality-log.md` has at least one row matching the task id AND modified since the qa phase started.
    - For each task: `done.md` has a "Lessons" section. Empty list is allowed but must be explicit: "Lessons: none — routine task."
    - `docs/pipeline-invocations.md` has a row matching the current invocation.
    - Reject with non-zero exit; rejection messages are actionable (name the file, name the missing row, link to the template).
  - **Affected files**: `scripts/task.sh` (qa-done invariants), `scripts/run-task/validation.ts` (telemetry-presence helpers), `tasks/_templates/done.md` (explicit Lessons section heading), `tests/run-task-validation.test.ts`.
  - **Sequencing**: Depends on the counters+invariants entry for the centralized invariant-gate framework. Without that framework, this is a one-off check in `task.sh`.
  - **Effort**: `S` (once the invariant-gate framework exists).

## 📦 Distribution & Portability

- [ ] **`canon init` bootstrap + canon-as-installable-package** *(reframed 2026-05-10 from strategy memo #30, original portability framing 2026-05-09)*
  - **The wedge**: The activation moment for canon adoption is `canon init` — a CLI that scans a fresh repo, infers canon-shaped governance from evidence, asks the human to approve unknowns, installs the framework, and verifies the install before any task runs. The package extraction (canon as an npm module rather than a copied scaffold) is the *delivery mechanism* for that bootstrap, not the goal itself. Per memo #30: productize the proof, not the control plane. If `canon init` doesn't produce a "canon caught a real problem before merge" moment within the first session, canon feels like process theater and the rest of the product strategy doesn't matter.
  - **Activation moment** (what success looks like on first run, per #30): either (a) canon catches a missed acceptance criterion, unsafe assumption, or missing validation before merge, or (b) the first PR through canon hits fewer review loops than the team's normal AI workflow. The bootstrap exists to make these moments possible inside the first session.
  - **`canon init` — five-phase shape**:
    1. **Discovery** — static scan only by default. Languages, package managers, CI config, test commands, migrations, deployment files, CODEOWNERS, security-sensitive directories, existing docs/ADRs, relevant commit history. Dynamic probing (running project code, executing test suites) requires explicit human approval.
    2. **Inference** — generate candidate artifacts with evidence pointers attached to *every claim*. Each generated section in `docs/codebase-map.md`, `docs/architecture.md`, `docs/patterns.md`, etc. references the files, commits, or commands that grounded it. Confidence labels distinguish strongly-evidenced inferences from guesses. No hallucinated docs.
    3. **Approval** — interactive per-section review: accept / edit / mark unknown / reject / add-human-context. Canon says plainly: one bootstrap cannot recover six months of tacit product memory; it can compress initial orientation. Product decisions, political constraints, edge cases get explicit "human-only context" markers rather than fabricated text.
    4. **Installation** — write only after approval. Writes generated docs, scaffolds `tasks/` shape, drops `.canon/` config (see separate BACKLOG entry on `.canon/` structure), and lays out role files (`AGENTS.md`, `CLAUDE.md`, `CODEX.md`) with canon-supplied defaults plus host-specific overlay anchors.
    5. **Verification** — run `canon verify` immediately. Validation bindings execute, generated docs reference real files, sensitive surfaces are classified, instruction files are internally consistent, task templates produce a valid task, phase gates reject placeholder artifacts. If verify fails, surface the gap before the human attempts a first task.
  - **Evidence-pointer discipline is load-bearing**: This is what distinguishes canon's bootstrap from the dozen "AI generates your docs" tools that have shipped and proved unreliable. Every claim in a generated doc must point to a `file:line`, commit SHA, or command output. The constraint is awkward to engineer but it's the discipline that earns trust on first use. Skip it and canon's bootstrap becomes process theater.
  - **What `canon init` actually delivers — package vs host**:
    - **Package** (`@canon-ai/cli` or similar): orchestrator (`scripts/run-task.ts` entry + `scripts/run-task/` modules), `task.sh` equivalent, canon-supplied task templates, role-file *templates*, validation-matrix structure, prompt builders, audit framework (once `guard_audit`/scoped-audits land), the bootstrap engine itself.
    - **Host repo after `canon init`**: `docs/architecture.md`, `docs/product-context.md`, `docs/decisions.md`, `docs/codebase-map.md`, `docs/patterns.md`, `docs/lessons-learned.md`, `docs/task-quality-log.md`, `docs/pipeline-invocations.md`, `docs/BACKLOG.md`, all `tasks/<id>/`, and `.canon/` (centralized config + project-specific overrides — see separate BACKLOG entry).
    - **Awkward middle — role files**: `AGENTS.md`, `CLAUDE.md`, `CODEX.md` must live at repo root because Claude Code, Codex, and (eventually) Gemini CLI auto-load those exact filenames at session start. Resolution: package ships canonical defaults; host repo commits a thin `.canon/overrides/<file>.md` that the init/update step concatenates onto defaults at versioned anchor points. Extends the existing project-policy fenced-block convention canon already uses for release rules. Updating canon updates the defaults; the project's overrides survive.
  - **CLI sketch**:
    - `npx canon init [--stack <node|python|...>] [--non-interactive]` — bootstrap a host repo via the five-phase flow.
    - `npx canon verify [--strict]` — post-bootstrap (or post-update) installation sanity check. Distinct from issue #26 (`canon doctor`), which checks the *environment* (CLIs installed, Node version, jq present); `canon verify` checks the *installation* (does this canon-governed repo actually work?). These could converge into one command with two modes; defer the decision until both are implemented.
    - `npx canon task new <id> "<title>"` — replaces `./scripts/task.sh new`.
    - `npx canon task run <id> [--step] [--expect <phase>] [--reroute] [--push] [--pr] [--ship]` — replaces `npx tsx scripts/run-task.ts`.
    - `npx canon task phase <id> <phase> <status> [verdict]` — replaces `./scripts/task.sh phase`.
    - `npx canon task list` / `npx canon task status <id>` — equivalents of existing helpers.
    - `npx canon update` — pull canon updates without re-copying files; project overrides survive.
    - `npx canon migrate` — one-shot for existing in-place adopters (e.g. canon-ai itself, TokenAnxiety): detects in-place canon, moves what's now package-shipped out of the repo, leaves project-shipped content in place, generates `.canon/overrides/` from the diff between current files and shipping defaults.
  - **Why this matters beyond the wedge** (preserved from the original framing):
    - **Adoption friction**: existing canon adoption requires copying scripts, templates, role files, `AGENTS.md`, etc. Updates require manual re-copying and merge-by-eye.
    - **Tooling isolation**: canon's runtime deps (`tsx`, etc.) shouldn't collide with the host project's `package.json`. `npx canon` keeps canon's runtime out of the host's dependency graph.
    - **Multi-project use**: developers running canon across multiple projects today maintain N copies of the harness. One package, N projects, shared updates.
    - **Cleaner separation of concerns**: host repo carries *its* memory (decisions, patterns, codebase map, lessons); canon carries *its* framework.
    - **Collapses canon-ai's main/dev branch split** *(big lift)*: canon-ai currently maintains two parallel branches because it's doing two jobs in one tree — distributing canon and developing canon by using canon. The package model splits those jobs cleanly.
    - **Partially absorbs two open harness bugs**: the `autoCommitArtifacts` doc-scope bug and the smoke-sync clobber stem from ambiguity about which `docs/` files are "shared" between worktrees. Once the orchestrator only operates on project artifacts (framework artifacts live in `node_modules`), those ambiguities largely evaporate.
  - **Risks to watch**:
    - **Bootstrap hallucination** — without strict evidence pointers and confidence labels, canon becomes "yet another AI doc generator that lies." Single biggest failure mode. Must be designed against from day one, not bolted on.
    - **First-session activation pressure** — if `canon init` doesn't deliver an "aha" moment in the first session, canon feels like overhead. The bootstrap quality bar is therefore higher than it would be for an internal tool. Pilot evidence (memo #30 §pilot experiments) should validate before broad release.
    - **Dogfooding loop**: canon-ai is canon's primary test bed. Once canon is a package, modifying canon via canon's own pipeline becomes "modify the package, publish, update." Need a linked-dev mode (`npm link`, or a `.canon/canon-source` pointer to a local checkout) to keep canon-on-canon iteration fast. Decide this before publishing.
    - **Overlay merge contract**: role-file overlay is the most delicate package mechanic. Concatenation is simple but fragile if upstream defaults change anchors. Needs versioned fenced sections in the defaults that the overlay slots into, with the install/update step detecting overlay drift.
    - **Doc co-evolution**: today `AGENTS.md` references `docs/architecture.md` etc. by relative path. References must still resolve correctly from the host repo's POV after the package extraction.
    - **Backward compatibility for existing adopters**: existing in-place canon checkouts shouldn't have to start from scratch. The `npx canon migrate` story is the load-bearing piece — get it right or adoption stalls.
  - **Sequencing / dependencies**:
    - Depends on **`.canon/` directory shape** (separate BACKLOG entry) — the bootstrap's Installation phase writes into `.canon/`, so its structure must be settled first.
    - Depends on **role-file decoupling** — the work to cleanly separate "canon-canonical content" from "project-overlay content" inside `AGENTS.md` / `CLAUDE.md` / `CODEX.md`. Prerequisite design work; without it, the overlay merge contract has nothing clean to anchor against.
    - Probably also depends on the **scoped-audits framework** landing first, since the audit registry pattern (`.canon/guards.json`) is the prototype for what `.canon/` config looks like more broadly.
  - **Effort**: `L`. Most of the cost is the bootstrap engine (Discovery → Inference → Approval, with evidence-pointer rigor) plus the overlay design + migration story + dev-loop preservation. The package extraction itself is mechanical once those pieces are in place.

- [ ] **`.canon/` directory for project-specific config and overrides** *(framed 2026-05-10 from strategy memo #30 + the directory-shape discussion that followed)*
  - **Scope**: Establish `.canon/` at the host repo root as the central home for project-specific config that canon needs to govern this repo. Today canon's adapter surface is implicit and scattered: validation matrix lives in `AGENTS.md` prose, codebase-specific knobs live in `docs/product-context.md`, custom audit registry will live in `.canon/guards.json` (per the scoped-audits BACKLOG entry), and there's no central manifest. `.canon/` collects these into one declarative surface so the bootstrap CLI has somewhere to write, the orchestrator has somewhere to read, and a fresh contributor has a clear "this is what canon is configured to do here" entry point.
  - **Why now**: Strategy memo #30 made the case that `canon init` requires a centralized config target — environment and package inference alone is too brittle for monorepos, polyglot repos, and delicate-surface routing. The value isn't bootstrap-specific: even pre-package, consolidating these knobs reduces drift and makes adopters' adaptation overhead smaller. The shape is also forward-compatible with canon-as-package — host overrides land in `.canon/`, canon defaults ship in the package.
  - **Day-one shape** (mechanical to land; minimum viable):
    ```
    .canon/
      config.json      # central declarative config (contents below)
      _templates/      # task-shape templates (status, spec, spec-review, plan, handoff, review, done, notes)
    ```
    `_templates/` is a forward-compatible move from today's `tasks/_templates/` — same files, new home. Separates "canon's machinery" (`.canon/`) from "canon's task production" (`tasks/`).
  - **`config.json` initial contents**:
    - `validation_bindings`: project's commands for each validation matrix category (lint, type-check, test, build, e2e). Replaces the prose validation matrix in `AGENTS.md` for the host repo.
    - `delicate_domains`: list of areas where `delicate: true` is mandatory (auth, payments, persistent storage, etc.). Today lives in `docs/product-context.md`.
    - `worktree`: path and mode settings (currently env-driven via `WORKTREES_ROOT`).
    - `protected_docs`: list of docs the QA Docs Freshness sweep must check. Today implicit in canon-supplied rules.
    - `task_size_policy`: project-specific size hints (file-count thresholds, etc.). Currently judgment-call.
    - `telemetry`: prefs for which events get recorded to `docs/pipeline-invocations.md` and `docs/task-quality-log.md`.
  - **Later additions** (each when its feature lands):
    - `.canon/guards.json` — guard helper registry for `guard_audit` (already noted in the scoped-audits BACKLOG entry).
    - `.canon/audits/` — project-defined audit definitions extending the canon-shipped set.
    - `.canon/validation-bindings.json` — structured replacement for prose validation matrix with stable check IDs. Pairs with the **validation result states** entry in the Wave 3 cluster above. Could either live here as a separate file or be the `validation_bindings` field in `config.json` expanded — defer until that entry's spec.
    - `.canon/overrides/AGENTS.md`, `.canon/overrides/CLAUDE.md`, `.canon/overrides/CODEX.md` — host's overlay onto canon-supplied defaults. Canon-as-package world only; doesn't make sense before package extraction since canon-ai *is* the source of truth today.
  - **Explicitly NOT in `.canon/`**:
    - `.claude/`, `.codex/` — tool-specific configs that exist regardless of canon. Conflating them with canon governance creates a wrong coupling.
    - `docs/` — knowledge corpus, not machinery. Different purpose, different audience (humans read docs; canon machinery reads `.canon/`).
    - `tasks/<id>/` — production task artifacts, not config.
    - `AGENTS.md` / `CLAUDE.md` / `CODEX.md` at repo root — must stay at repo root because Claude Code and Codex auto-load those filenames. The *overrides* go into `.canon/overrides/` (later, package-only).
  - **Replace-vs-augment tension**: When `.canon/config.json` lands, does it *replace* the validation matrix in `AGENTS.md` or *augment* it? Replace is cleaner but breaks adopters' existing setups (canon-ai's `AGENTS.md` becomes wrong, prose matrix needs to move). Augment is backwards-compatible but maintains two sources of truth (drift risk). **Recommended path**: augment first (`config.json` wins when present, prose matrix is fallback), then deprecate the prose matrix after one release. Same pattern as the `iterations` → `iterations_current_loop` migration in the **status counter consistency** Wave 3 entry above.
  - **Risks to watch**:
    - **Drift with prose docs**: during the augment-then-deprecate window, prose matrix and `.canon/config.json` can disagree. Validation matrix lookups must check `.canon/config.json` first and warn (not error) if prose drift is detected.
    - **Discoverability**: putting config in a hidden directory hides it from casual reading. `README.md` and `AGENTS.md` must point to `.canon/config.json` as the source of truth so new contributors find it.
    - **Migration timing**: moving `tasks/_templates/` → `.canon/_templates/` is a single-PR mechanical change for canon-ai itself, but it's a coordinated change for any downstream adopter (TokenAnxiety would need to pick up the move). Include in the canon-as-package `migrate` command.
  - **Sequencing**: Land the day-one shape (`.canon/config.json` + `.canon/_templates/` move) as its own M-tier task — independent of canon-as-package, useful immediately. Layer on `validation-bindings.json` and `audits/` as their respective features land. Layer on `overrides/` only when canon becomes a package. Bootstrap CLI's Installation phase writes into this shape.
  - **Effort**: `M` for the day-one shape (`config.json` schema + read paths + template move + AGENTS.md/docs updates pointing at it). `S` per later addition.

## 🛠️ Tooling & Dev Experience

- [ ] **`canon dogfood-report` command** *(framed 2026-05-10 from TokenAnxiety discussion #27, item 9)*
  - **Scope**: A tooling command that produces a structured retrospective on canon's behavior across a set of tasks — iteration counts (current + cumulative), validation gaps, post-closeout fixes, declared-vs-executable drift findings. The shape of report James wrote manually for discussion #27, but generated mechanically from canon's telemetry files + git log.
  - **Why it's wanted**: dogfood reports are how canon learns about itself. James hand-assembled #27 from `task-quality-log.md` + `pipeline-invocations.md` + `lessons-learned.md` + git log of post-closeout commits. That's exactly the kind of synthesis that should be a command, not a manual exercise — both because the manual version is expensive (~half a day per report) and because canon's own observability story should not be "rely on the human to dig through artifacts."
  - **Shape**: `canon dogfood-report [--since <date>] [--canon-commit <sha>] [--out <path>]` reads:
    - `docs/task-quality-log.md` for per-task metrics
    - `docs/pipeline-invocations.md` for run-by-run history
    - `docs/lessons-learned.md` for distilled lessons (and flags template-only content as suspicious)
    - `tasks/<id>/status.json` for cumulative counters (depends on the **status counter consistency** Wave 3 entry landing)
    - `git log --oneline` for post-closeout fixes near each completed task
    - The `canon` stamp block (depends on the **canon snapshot stamping** Wave 3 entry landing) to bucket findings by governing canon version
  - Outputs a markdown report following the structure of discussion #27: environment versions, tasks reviewed, what worked, hiccups/bugs, suggested follow-ups, evidence bundle.
  - **Sequencing dependency**: this command is the *consumer* of the **canon snapshot stamping** and **status counter consistency** Wave 3 entries. Build it after both land, otherwise the report has the same gaps James called out manually.
  - **Punted to later**: cross-project dogfood report (when canon is a package and TokenAnxiety / GalleryPlanner / others share a schema); LLM-summary mode (Claude reads the raw report and writes the "What Worked / Hiccups" narrative); auto-file-issues mode (each Hiccup section becomes a GitHub issue via `gh issue create`).
  - **Effort**: `S` for the raw-data report. `M` if combined with LLM-narrative mode.

## 🐛 Harness Bugs

- [ ] **Smoke-pipeline-on-active-task can clobber unrelated dev commits via cross-tree sync** *(surfaced 2026-05-09 during `split-run-task` smoke)*
  - **Scope**: When a smoke task is created and the pipeline runs *inside an existing task worktree* (i.e., the operator is `cd`'d into a worktree, runs `task.sh new <smoke-id>`, then `run-task.ts <smoke-id> --step ...`), some sync step — likely `syncWorktreeArtifacts` running worktree→REPO_ROOT — mutates files in `REPO_ROOT/docs/` that have nothing to do with the smoke task. Specifically observed: `docs/lessons-learned.md` in REPO_ROOT had its working tree silently overwritten with the worktree's HEAD content + the worktree's uncommitted QA modifications, *deleting* a recent dev-only commit's added entry that lived only in REPO_ROOT.
  - **Why it's bad**: a `git add docs/lessons-learned.md && git commit` on dev after the smoke runs would silently revert work the operator committed pre-smoke. Caught here because the lost entry was conspicuous; could easily be missed in busier diffs. Same mechanism likely affects `docs/decisions.md`, `docs/product-context.md`, and other "synced" docs that the orchestrator considers shared between worktree and REPO_ROOT.
  - **Likely root cause** (un-confirmed): the sync logic copies worktree → REPO_ROOT for a fixed list of doc files without checking whether REPO_ROOT has its own commits ahead of the worktree's HEAD on that file. The operation is destination-blind — it overwrites whatever's in REPO_ROOT with the worktree's content, even when REPO_ROOT's content includes dev-only commits the worktree doesn't have.
  - **Fix shape**: before sync writes a file to REPO_ROOT, check `git diff <worktree-HEAD> dev -- <file>`; if the dev-side has commits the worktree doesn't have on this file, either (a) skip the sync for that file with a warning, or (b) attempt a 3-way merge, or (c) require operator opt-in. (a) is the safest default. The smoke pattern of "run a smoke from inside an active worktree" is exactly the case that exercises this — it's how operators will validate the pipeline pre-merge.
  - **Recovery for now**: after running a smoke, `git status` in REPO_ROOT and reconcile any unexpected `docs/` modifications before committing.
  - **Effort**: `S`.

- [ ] **`autoCommitArtifacts` misses protected docs that QA touches** *(surfaced 2026-05-09 during `split-run-task` `--pr`)*
  - **Scope**: At `human_review`, `--push` / `--pr` calls `autoCommitArtifacts` to sweep up uncommitted QA output before pushing the task branch. The function commits `tasks/<id>/*` and a few specific files, but it does NOT include the protected docs that QA routinely modifies during the QA phase — `docs/decisions.md`, `docs/product-context.md`, `docs/codebase-map.md`, `docs/architecture.md`, `docs/patterns.md` (per the QA prompt's "Docs freshness" sweep). Result: those files sit dirty in the worktree post-`--pr`, get pushed nowhere, and surface as either (a) merge conflicts later or (b) silently lost work if the worktree gets torn down.
  - **Observed**: `--pr` for `split-run-task` pushed cleanly but left `docs/decisions.md` and `docs/product-context.md` dirty in the worktree (QA's path corrections from `scripts/run-task.ts` to `scripts/run-task/main.ts`). Had to manually `git add` and roll into the merge commit during conflict resolution.
  - **Likely root cause**: `autoCommitArtifacts` has a hardcoded scope list that predates the QA "Docs freshness" sweep being part of canon's standard QA discipline. The discipline added new files to the QA write surface without updating the auto-commit scope.
  - **Fix shape**: extend `autoCommitArtifacts`'s scope to include the protected-doc list from `AGENTS.md` § "Docs Freshness" (or read it from a single source of truth — probably `pipeline-policy.ts` so the list is one place). Alternatively, switch from an allowlist to "commit everything dirty in the worktree at `human_review`" with an explicit denylist for things that should never get auto-committed (e.g., editor backups, `node_modules`).
  - **Likely shares the fix with the smoke-sync clobber bug** above — both stem from "what files does the orchestrator consider task-touched and therefore in scope for auto-commit / sync." A unified protected-docs registry resolves both.
  - **Effort**: `S` (likely bundled with the smoke-sync fix).

- [ ] **Pipeline invoked from inside a worktree creates nested worktree paths** *(surfaced 2026-05-09 during `split-run-task` `--reroute`)*
  - **Scope**: When `npx tsx scripts/run-task.ts <id>` is run from inside an existing worktree (e.g., `cd ~/canon-ai/dev-worktrees/<task> && npx tsx scripts/run-task.ts <task> --reroute`), the orchestrator's `REPO_ROOT` resolution computes a nested path. `REPO_ROOT = path.resolve(__dirname, '..')` evaluates to the worktree itself (because the script's `__dirname` is `<worktree>/scripts`), so `dev-worktrees/<task>` becomes `<worktree>/dev-worktrees/<task>`. `git worktree add` then fails because `task/<id>` is already checked out at the *actual* worktree path.
  - **Reproduction**: `cd ~/canon-ai/dev-worktrees/split-run-task && npx tsx scripts/run-task.ts split-run-task --reroute`. Crashes in `ensureWorktree` → `git worktree add` with `fatal: 'task/<id>' is already used by worktree at '<correct-path>'`.
  - **Fix shape**: `REPO_ROOT` resolution must distinguish "the canonical repo" from "the worktree the script is currently running from." Options: (a) walk up from `__dirname` until we find the parent of `dev-worktrees/` or use `git rev-parse --git-common-dir` to get the canonical repo root regardless of which checkout is active; (b) detect when running inside a worktree and reuse it directly without recomputing paths; (c) require pipeline invocations to come from the canonical REPO_ROOT and bail with a clear message if invoked from a worktree.
  - **Workaround for now**: invoke the pipeline from REPO_ROOT, not from inside the worktree. Smoke testing from inside the worktree (which only invokes `--step --expect <phase>` for read-mostly phases) doesn't hit this — full pipeline invocations from a worktree do.
  - **Effort**: `S`. Likely (a) is the right fix — `git rev-parse --git-common-dir` is the canonical "where is this repo's `.git` directory?" query and works correctly from any worktree.

- [ ] **Structured-table parser utility for orchestrator reads** *(originally surfaced 2026-05-09 during `split-run-task` PR canon-ai#3 codex-review iteration as "AC Coverage parser should be markdown-table-aware"; broadened 2026-05-10 during the JSON-vs-markdown artifact-format design discussion)*
  - **Scope**: The orchestrator reads structured information embedded in markdown tables — AC coverage and validation outcomes today, the architect-review four-question table and per-row audit verdicts when those phases land — using ad-hoc regex. This is brittle and has bitten us before (history below). Replace with a single small markdown-table parser utility (~20–30 lines) that all orchestrator reads route through.
  - **Why this scope, not just AC**: the same problem will recur for every new artifact that has structured rows the orchestrator must enforce. Solving it once as a utility is cheaper than re-solving it per-table, and gives every future phase a consistent contract for "what does it mean for this row to be filled in."
  - **Why this matters for the artifact-format question** *(2026-05-10 design call)*: this utility is canon's enforcement mechanism for "the agent must complete this artifact before the phase advances." It's the markdown-only answer to "do we need JSON sidecars + schema validation" — schema validation by structure parsing rather than by JSON schema. With a real parser in place, the orchestrator can refuse to advance on missing or malformed rows, which is most of what JSON schemas would have given us. Conclusion from that call: stay markdown-only, invest here instead of adding a JSON artifact layer.
  - **Right long-term fix — parser utility shape**:
    - `parseTable(markdown, sectionHeading)` — finds the named section, locates the table header, returns rows as `{ [columnName]: cellText }` objects (column-named cells, not positional).
    - Splits on `|` while respecting `\|` escapes (the round-3 failure mode).
    - Callers compose specific checks against the parsed structure: e.g. `rows.every(r => r['Status'] !== 'Met / Partial / Not met')` for the "filled vs. template" check.
    - Eliminates all four regex false-positive classes (history below) by structure rather than by regex.
  - **Where it gets used**:
    - **Today**: `validateHandoff()` in `scripts/run-task/validation.ts` for both the AC Coverage check and the Validation Outcomes check.
    - **Future**: architect-review per-question verdict table; per-audit row verdicts in audit artifacts; any new artifact whose acceptance criteria include "the orchestrator must inspect specific rows."
  - **What it does NOT do**: it's a parser, not a schema validator. Column-presence and value-domain checks stay caller-side. The parser just turns markdown tables into structured rows reliably.
  - **AC parser regex history (failure modes the new parser must not regress)**:
    1. **Original** (`/\|\s*AC[-\s]/i`): matched the template's *header row* `| AC | Status | Notes |` — let unfilled handoffs pass.
    2. **Round 2** (`/\|\s*AC-\d/i`): matched the template's placeholder row `| AC-1: ... | Met / Partial / Not met |` — same false negative.
    3. **Round 3** (column-based: `/\|\s*AC-\d[^|]*\|\s*([^|]+?)\s*\|/`): broke when an AC description contained an escaped pipe (shell pipelines, `foo \| bar`) — column boundary shifted.
    4. **Round 4 (current)** (substring: count rows containing `Met / Partial / Not met` literal): false-positive if a handoff's prose quotes the template phrase elsewhere on the row.
  - **Why round 4 isn't blocking**: catches the real-world failure mode (bare template handoff). The remaining false positive (prose-quoted placeholder) is theoretical. So this entry is sequencing-flexible — no fire — but worth doing **before** architect-review or the audits framework lands, so those phases use the utility from day one rather than each inventing their own table reads.
  - **Stable validation IDs follow-on** *(framed 2026-05-10 from TokenAnxiety dogfood discussion #27)*: once table parsing is reliable, the *next* brittleness layer is matching validation checks across spec→handoff by **prose label**. James's ui-002 evidence: a mechanically-correct implementation got tripped by a label-mismatch between spec ("`npm run test` — including the four new unit tests (3 in optimizer test file...)") and handoff ("`npm run test`"), causing a false code-review auto-block. The structural fix is to give validation checks stable IDs (e.g. `VAL-1`) in the spec, carry the ID through the handoff row, and compare by ID with prose displayed for humans. Not a separate BACKLOG entry — it's the natural successor to this one. When the parser lands, follow it with a small ID-emitting spec template + ID-matching handoff parser.
  - **Effort**: `S` for the parser + retrofit of the two existing call sites (AC Coverage, Validation Outcomes). Each new structured-table artifact is then a 1-line call to the same utility — marginal cost approaches zero. Stable-IDs follow-on: `S` once parser exists.

- [x] **Handoff Validation Outcomes Check column format mismatch causes false pre-flight failures** *(fixed inline 2026-05-11 — template, CODEX.md prompt, and canonicalization safety net)* *(surfaced 2026-05-11 during `prompt-fidelity-tests` pipeline run; prior instance in `fix-pipeline-bugs`)*
  - **Scope**: `canonicalizeValidationCheck` extracts the first backtick token from both the spec's Validation Required entry and the handoff's Validation Outcomes Check cell, then compares them. The spec format is `` `type-check` (`npm run type-check`) `` — first token is the short name. Codex consistently writes the handoff Check column as `` `npm run type-check` `` — first token is the full command. The two canonicalize differently (`type-check` ≠ `npm run type-check`), so the pre-flight reports all checks as missing even when they all passed. This has happened twice in two different tasks.
  - **Why it keeps happening**: the handoff template's Validation Outcomes table has no concrete example row, and neither the Codex implement prompt nor CODEX.md states the required format for the Check column. Codex fills in the command string because that's the most natural label; the spec's short-name form is only visible if Codex re-reads the spec carefully.
  - **Fix options** (pick one or combine):
    1. **Template fix**: add a concrete example row to the Validation Outcomes table in `tasks/_templates/handoff.md` showing the required format: `` | `lint` (`npm run lint`) | Pass | ... | ``.
    2. **Prompt fix**: add one sentence to the implement prompt or CODEX.md: "In the Validation Outcomes table, the Check column must use the exact text from the spec's Validation Required checklist entry — e.g. `` `type-check` (`npm run type-check`) ``, not just `` `npm run type-check` ``."
    3. **Canonicalization fix**: make `canonicalizeValidationCheck` also try matching against the command substring — if the first token contains spaces (i.e., is a command like `npm run lint`), strip `npm run ` and retry. This makes the validator robust to both formats without requiring Codex to get the format exactly right.
  - **Recommended approach**: (1) + (2) together. (3) is a safety net worth adding but doesn't fix the root cause. All three are trivial and can be done inline without a pipeline task.
  - **Effort**: `S` (trivial — template + prompt tweak, ~10 lines total; canonicalization fix is ~5 lines).

- [x] **Prompt-fidelity regression coverage — rebuild from scratch** *(shipped 2026-05-11 as `prompt-fidelity-tests`)*
  - **History**: `tests/run-task-prompts.test.ts` + `tests/run-task-prompts.golden.json` were captured during the `split-run-task` Mustache port to verify byte-identical prompt output. They were never portable: goldens baked in absolute worktree paths (`/Users/tstraub/canon-ai/dev-worktrees/split-run-task`), and the prompt builders pull in live `docs/patterns.md` content that differs between dev and main. The 2026-05-11 markdown-table-parser pipeline run surfaced a second portability gap — `writeFixtureTask` wrote to `process.cwd()` but `readStatus` reads via REPO_ROOT, so the test only worked when CWD == REPO_ROOT. An attempted fix to route through REPO_ROOT then collided with Codex's sandbox (sandboxed writes can't escape the worktree). Both files were deleted on dev to unblock that task.
  - **What's gone**: the only regression coverage for the Mustache-port prompt builders. Future changes to prompt templates or helpers have no test guard. Manual review of prompt output remains the only check.
  - **When to rebuild**: when prompt-template changes become frequent enough that manual review is too slow, OR when a regression ships that this suite would have caught. Not a fire today.
  - **Right rebuild approach**:
    - **Fixtures live in a temp directory** created per test run (e.g. via `fs.mkdtempSync`), not in REPO_ROOT or CWD. Cleans up after itself and doesn't fight sandbox boundaries.
    - **`readStatus` / `TASKS_DIR` becomes env-overridable** (e.g. `CANON_TASKS_DIR_OVERRIDE`) so the test points production code at the temp fixture dir without monkey-patching modules.
    - **Goldens use placeholders** (`<TASK_CMD spec done>`, `<REPO_ROOT>`, etc.) that the test normalizes both sides through. No absolute paths in stored goldens.
    - **`buildKnownPitfalls` becomes mockable** — stub `docs/patterns.md` content during the test rather than baking live project docs into goldens.
    - **`--update-goldens` mode** for deliberate regeneration.
  - **Effort**: `S` for the rebuild done right (~1 day). The test infrastructure changes are the bulk of the work; capturing fresh goldens is mechanical after that.

- [x] **`--pr` retry fails when commit+push succeeded but `gh pr create` failed transiently** *(fixed inline 2026-05-11 — early-exit retry path in `commitHumanReviewFiles` + extracted `createDraftPRForTask` helper)* *(surfaced 2026-05-11 via CodeRabbit review of PR #39)*
  - **Scope**: `commitHumanReviewFiles` (called by both `--push` and `--pr`) opens with a `git status --porcelain` check and dies with "no dirty task artifacts" if the working tree is clean. If a `--pr` run commits and pushes successfully but `gh pr create` fails transiently (network blip, rate limit), rerunning `--pr` hits this early die — the tree is clean, the commit+push already landed, and the function never reaches the PR creation block. The documented retry path is broken.
  - **Fix shape**: detect the "already pushed, PR not yet created" state and skip to the PR creation block. Simplest signal: if the tree is clean AND `origin/<branchName>` exists AND no open PR exists for this branch, proceed directly to `gh pr create`. Alternatively, split `commitHumanReviewFiles` from `pushAndMaybePR` so each step is independently idempotent.
  - **Workaround for now**: run `gh pr create --draft --base <base> --head task/<id>` manually.
  - **Effort**: `S`.

- [x] **`--ship` uses synthesized `task/<id>` branch name instead of `status.branch`** *(fixed inline 2026-05-11 — new `resolveTaskBranchName` helper used at all 4 call sites)* *(surfaced 2026-05-11 via CodeRabbit review of PR #39)*
  - **Scope**: `verifyLocalBranchPushed` and `assertNoUnpushedWork` in `scripts/run-task/main.ts` hardcode `const branchName = task/${taskId}` rather than reading `status.branch`. The orchestrator records the actual branch in `status.branch` via `ensureBranch` — including cases where the user was on a non-base branch and the pipeline stayed on it. If `status.branch` holds a custom name (e.g. `feature/my-thing`), `--ship` verifies the wrong branch, issues push/delete commands against a non-existent ref, and archives the task without confirming the real branch landed.
  - **Fix shape**: read `status.branch` first; fall back to synthesized `task/<id>` when unset. One-line change per call site.
  - **Effort**: `S`.

- [ ] **Bundle + worktree mode: secondary tasks fall back to REPO_ROOT for status reads** *(surfaced 2026-05-11 via CodeRabbit review of PR #39)*
  - **Scope**: In a worktree bundle (`worktree: true` on multiple tasks), `ensureBranch` creates a single worktree at `WORKTREES_ROOT/<primaryTaskId>/` and records the branch for all tasks. But `resolveTaskCwd(taskId)` checks `WORKTREES_ROOT/<taskId>/tasks/<taskId>/status.json` per-task — which exists only for the primary task. Secondary tasks therefore fall back to `REPO_ROOT` for all status and artifact reads, while code changes live in the primary worktree. Handoff and status writes for secondary tasks diverge: the orchestrator reads/writes REPO_ROOT while Codex/Claude are running against the worktree's code.
  - **Fix shape**: `resolveTaskCwd` needs to be bundle-aware — secondary tasks in a bundle should resolve to the primary task's worktree path. Likely requires threading the full `taskIds` array (or a "primary task" pointer) through the resolution logic, or storing the worktree path explicitly in each task's `status.json` during `ensureBranch`.
  - **Note**: only affects explicit `worktree: true` bundles; `worktree` defaults to absent/false and single-task worktrees are unaffected.
  - **Effort**: `M` (touches state resolution, ensureBranch, and likely the worktree setup path).

- [x] **Code-review preflight loops on task artifacts in branch diff (canon-ai issue [#41](https://github.com/tstraub89/canon-ai/issues/41))** *(filed 2026-05-11 by James/TokenAnxiety; fixed inline same day — `isPipelineOwnedTaskArtifact` exemption in `verifyHandoffAgainstDiffFromData`)*
  - **Scope**: `verifyHandoffAgainstDiff` compares `git diff <base>...HEAD --name-status -M` against the handoff Changes table and rejects any diff file not listed. Task artifacts under `tasks/<id>/` that are committed to the task branch (TokenAnxiety's adoption pattern) get flagged as uncovered diff files, routing back to implement. Each implement retry appends iteration sections to handoff/notes — feeding the loop. Canon-on-canon flow committed task artifacts to base branch pre-preflight so they didn't appear in the diff; adopter flows that don't do that hit the loop.
  - **Fix shape**: Added `isPipelineOwnedTaskArtifact(filePath, taskIds)` helper that returns true if the path starts with `tasks/<active-id>/` for any task in the active bundle. Used to skip both the `diff→handoff` check and the rename-pair check. Pipeline-owned task artifacts are pipeline-managed, not part of the implementation under review.
  - **Tests added**: 4 cases — James's repro from the issue; per-active-task scoping (other tasks still flagged); narrow exemption (app/source still strictly required); rename-pair exemption (archive moves).
  - **Effort**: `S` (~10 lines + 4 tests).

- [ ] **Reroute feedback channel — codify where humans write post-`human_review` feedback** *(surfaced 2026-05-11 during counter-schema-migration spec discussion)*
  - **Scope**: Today `--reroute` resets implement/code_review/qa to pending and sets `phases.implement.rerouted = true`, then Codex reads the `implement-reroute.md` prompt which scans `spec.md` for "Amendment / Round N / Follow-up / Post-review" sections. But `docs/pipeline-orchestrator.md` § Human Reroute also mentions "or update `review.md` for small tweaks" — which the prompt doesn't scan. And in practice, feedback has shown up in `notes.md` too (undocumented ad-hoc channel). Three documented states, one scanned location, drift everywhere.
  - **Why it keeps drifting**: the doc gave an escape valve ("or review.md for small tweaks") without updating the prompt, and `notes.md` was never blessed at all. Each path makes sense in the moment; cumulative effect is "Codex misses half the feedback unless it's in spec.md as a specific section name."
  - **Three options for codification**:
    - **A. Single-channel (spec.md only)**: Strip the "or review.md" line from the doc. Reroute prompt unchanged. Human writes Amendment section in spec.md or doesn't reroute. Clean contract; small-tweaks become slightly more friction. **Smallest scope — likely inline-trivial.**
    - **B. Multi-channel scan**: Reroute prompt reads spec.md + review.md + notes.md. Matches observed practice but Codex risks treating notes.md scratch as authoritative. Medium scope.
    - **C. Dedicated reroute artifact**: New `tasks/<id>/reroute-feedback.md` template + write convention + prompt scan. Cleanest separation from spec/review/notes (which have other roles). Larger scope.
  - **Recommended sequencing**: Defer until a real reroute happens and we observe the channel friction. If notes.md keeps being used and Codex catches it via the prompt's "scan for any section added after the original spec" pattern, maybe just adopt multi-channel informally. If Codex misses real feedback once or twice, that's the signal to pick A, B, or C decisively.
  - **Effort**: `S` (option A — doc + maybe prompt). `S-M` (option B — prompt scan multiple files). `M` (option C — new artifact + template + write convention).

- [ ] **`verdict_source` field on phase blocks** *(deferred from counter-schema-migration spec discussion 2026-05-11)*
  - **Scope**: Add `verdict_source: "agent" | "human" | "auto_fast_tier"` field to iterative phase blocks (`spec_review`, `code_review`, `runtime_validation`) tracking who set each verdict. Originally proposed as part of counter-schema-migration (1a-1), removed because: (a) signal is largely inferable from existing data (orchestrator commits leave git trail, session IDs indicate agent-driven phases, escalations capture auto-block events), and (b) `canon dogfood-report` (the primary downstream consumer) doesn't exist yet, so there's no concrete use case to justify the schema bloat.
  - **When to add it**: when `canon dogfood-report` v1 ships and we observe a concrete "we wish we could distinguish agent-set vs. human-set verdicts" question. Or when an invariant gate or audit phase needs to enforce "this verdict must have been agent-written" semantics.
  - **Shape (when added)**: new `--source <val>` flag on `task.sh phase`, defaults to `"human"` when omitted. Orchestrator's existing `runTaskShFor` invocations pass `--source agent`. CLAUDE.md note on fast-tier conversational spec_review approval recommending `--source auto_fast_tier`.
  - **Effort**: `S` (additive to existing counter schema; well-trodden pattern from the rest of counter-schema-migration).
