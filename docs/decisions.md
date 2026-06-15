# Architecture Decisions

> Why things are the way they are. Agents: do not re-propose alternatives to settled decisions without strong justification and human approval.

## How to use this doc

Each decision documents a settled architectural choice — what was chosen, why, and the rule that follows. The point is to prevent future agents (and humans) from re-debating questions that are already resolved.

A good decision entry has three sections:

1. **What** was decided (one sentence)
2. **Why** (the reasoning and tradeoffs)
3. **Rule** (what agents should/shouldn't do as a result)

Decisions can be reopened, but only with **strong justification and human approval** — not because an agent prefers a different style. If a decision turns out to be wrong, write a new entry that supersedes it and notes what changed.

> **Scope: only-debatable decisions.** This file does not catalogue every choice in the codebase — only ones where the alternative was genuinely attractive at the time. Settled-by-default choices (TypeScript over JavaScript, npm over a custom resolver, etc.) don't earn entries; they're not worth re-debating.

---

## File-based handoffs between phases (vs. shared in-memory state)

**Decision**: Every cross-phase contract is a file under `tasks/<id>/`. No in-memory state passes between phases. The orchestrator reads files, writes files, and parses files when transitioning phases.

**Why**: The alternative — in-memory state, faster transitions, no parsing — was attractive on speed but lost two critical properties. **(1) Resumability**: a process crash, a CLI timeout, or a deliberate `Ctrl+C` mid-run loses everything. With files, re-running `run-task.ts <id>` from a cold start picks up wherever the filesystem says the task is. **(2) Observability**: humans can read every artifact an agent wrote or saw. Memory leaks no signal across boundaries; files leave a trail. The cost (parsing markdown tables) is acceptable — `parseHandoffFiles()` is ~20 lines.

**Rule**: When adding a new cross-phase contract, add a markdown file to `.canon/templates/` with a documented schema. Don't pass data through stdout, env vars, or in-memory orchestrator state across a phase boundary.

---

## Canon provenance stamp recorded in `status.json`

**Decision**: Every task records a canon provenance stamp in `status.json.canon`, and task artifacts should reference that field rather than duplicating canon metadata in `handoff.md` or elsewhere.

**Why**: Canon's behavior changes with the checkout that's governing the run: templates, routing, and guardrails all move with the canon commit. Without a first-class stamp, the artifacts prove what happened but not which canon snapshot governed it. That makes dogfood analysis, support, and postmortems guesswork. Writing the stamp at task creation and refreshing it before real orchestrator work preserves a durable provenance trail without forcing the handoff to become a second source of truth.

**Rule**: New task-facing provenance should read from `status.json.canon`. The canonical upstream repo slug lives in `CANON_UPSTREAM_REPO` in `scripts/run-task/canon-snapshot.ts`; do not duplicate that value in docs or handoff artifacts unless you're explicitly pointing back to the symbol.

---

## Two distinct agents (Claude + Codex), never reviewing own output

**Decision**: Claude is the architect/reviewer/QA. Codex is the implementer/spec-reviewer. Each agent reviews the *other*'s output, never its own.

**Why**: A single agent doing everything is simpler — fewer prompts, fewer model integrations, no inter-agent contracts. But every agent has a blind spot for its own work: the same priors that produced output X tend to validate output X. Cross-review is what catches dropped ACs, scope drift, and subtle correctness bugs that a self-review would rationalize. The two-model split also lets each model do what it's best at — Claude leans architectural and tone-aware, Codex leans implementation-focused — with the spec/review boundary forcing structured handoffs that reduce silent disagreements.

**Rule**: No agent reviews its own output. Spec reviews go to Codex; code reviews go to Claude. If a future change adds a new phase, the agent assignment must preserve cross-review (the agent that authored the artifact is not the agent that reviews it).

---

## Worktree isolation default-on (vs. opt-in)

**Decision**: `.canon/templates/status.json` defaults `worktree: true`. Tasks run in a separate git worktree on a separate branch by default; opt-out is a deliberate per-task flag.

**Why**: The alternative — opt-in worktrees, simpler default — produced a real footgun before this decision: two `run-task.ts` invocations on the same branch corrupted each other's git state. Worktree isolation makes that impossible by giving each task its own working tree. The cost of default-on is one extra directory per task; the cost of default-off is occasional unrecoverable git-state corruption. Asymmetric — default to safety.

**Rule**: New tasks should keep `worktree: true` unless there's a specific reason not to (e.g., the task is canon-on-canon orchestration tweaks where the supervising orchestrator must run in the same checkout). Opting out is a deliberate per-task call, documented in `notes.md`.

---

## Worktree-canonical task state from implement onward

**Decision**: From implement onward, the task worktree is the source of truth for task-scoped state: `tasks/<id>/` artifacts and per-task telemetry rows. REPO_ROOT remains the source of truth for project-level resources and for pre-implement task state before a worktree exists.

**Why**: The previous dual-source model kept REPO_ROOT and the worktree in sync through mirror steps. That created stale parser reads, dirty REPO_ROOT task artifacts during `--ship`, and ambiguous operator guidance about which copy to amend. A single runtime resolver closes that bug class without changing the pre-implement scaffold flow.

**Rule**: Use `taskDirFor()` for general task-state reads and writes; it resolves to the worktree when one exists and REPO_ROOT otherwise. Use `taskDirForRepoRoot()` only for operations that intentionally need REPO_ROOT semantics regardless of worktree state, such as `resolveTaskCwd`, `commitTaskArtifactsToBase`, and the post-teardown archive move in `shipTasks`. Do not reintroduce REPO_ROOT mirrors of task artifacts or telemetry after plan; managed-doc coordination is a separate concern.

---

## Two-stage code review with Stage 1 as a gate

**Decision**: Code review runs in two stages. Stage 1 verifies spec compliance (validation outcomes, AC coverage, dropped sections); if Stage 1 fails, Stage 2 (code quality) is skipped entirely and the review sends back to Codex.

**Why**: The alternative — one review pass that mixes both — was simpler but produced two failure modes. **(1)** Stage 2 findings written against code that's about to change waste tokens (Codex re-implements; the Stage 2 nits become irrelevant or wrong). **(2)** Reviewers fall into "code quality" mode and miss spec-compliance failures because the code looks fine on its own. Stage 1 as a gate forces the reviewer to assess "does this match the spec?" before "is this well-written?" — a different lens that catches different bugs. The cost (re-running both stages on iteration) is bounded by `MAX_REVIEW_LOOPS`.

**Rule**: Reviewers must complete Stage 1 (the gate) and only proceed to Stage 2 if it passes. Failing Stage 1 means writing the gate findings, marking Stage 2 as "Not run — Stage 1 failed," and sending back. Don't skip Stage 1 for a "quick code-quality look."

---

## Fast tier (S non-delicate) skips Codex spec review

**Decision**: Tasks marked `task_size: S` and not `delicate` skip the Codex spec review phase entirely. The human spec gate replaces it.

**Why**: The alternative — every task gets full spec review — was thorough but expensive. For trivial tasks (S, non-delicate), the human-Claude conversation produces a spec the human directly approves; routing it through a Codex review pass adds latency and cost without catching real issues, because the spec is short enough that the human's own gate is a sufficient check. Reserving Codex spec review for M/L/XL/delicate tasks (where shape concerns and decomposition are real) preserves the cost-quality tradeoff.

**Rule**: Don't add spec_review work to S non-delicate tasks. If a task feels like it needs spec review, that's a signal to size it M (or set `delicate: true`), not to bypass the tier rule.

---

## Full-send mode collapses the spec gate and human_review stop behind one explicit flag

**Decision**: Canon's "spec to draft PR with no human interrupts" flow is an explicit `status.json.full_send` mode, enabled by `canon run --full-send` and cleared by `--reroute`.

**Why**: The alternative was to rely on manual `status.json` edits or to add a separate `canon task new --full-send` creation path. That would have split the mechanism across multiple surfaces and made the opt-in easy to miss. A single file-backed flag keeps the state observable, lets the dispatcher honor it consistently at both human interrupt points, and preserves the existing review chains and PR creation path instead of creating a special pipeline.

**Rule**: When adding a new human-interrupt gate, check whether it should honor `status.json.full_send` by convention. If it should, the router must clear or bypass that gate explicitly in code; don't add a parallel flag or a one-off manual workaround.

---

## Pure routing policy extracted into `pipeline-policy.ts`

**Decision**: Tier detection, sizing, model/effort selection, and loop-cap defaults live in a pure side-effect-free module (`scripts/pipeline-policy.ts`). The orchestrator passes resolved config in; the policy returns decisions out.

**Why**: Routing logic was originally spread across `run-task.ts` as inline conditionals. The drift was real — multiple `if (size === 'XL' || delicate) ...` checks that diverged subtly over time. Extracting into a pure module gave us **(1)** a single place to change routing, **(2)** table-driven tests in `tests/pipeline-policy.test.ts` covering every cell of the size × phase matrix, and **(3)** a clean boundary between "what does the env say?" (resolved in `run-task.ts`) and "what should we do?" (decided in `pipeline-policy.ts`). The cost of extraction (one extra import, slightly more ceremony) is paid back the first time a routing rule changes.

**Rule**: Any new routing decision (model choice, effort, tier, loop cap) goes in `pipeline-policy.ts`. Add a row to `pipeline-policy.test.ts`. Do not write inline routing in `scripts/run-task/main.ts` or the phase modules.

---

## Agent CLIs as subprocesses (vs. direct API calls)

**Decision**: The orchestrator drives the `claude` and `codex` CLIs as subprocesses. It does not call Anthropic or OpenAI APIs directly.

**Why**: The alternative — direct API calls — was attractive for control (precise prompts, structured outputs, custom retries). But the CLIs already solve session continuity (`--resume <session-id>`), model selection, credential management, and the streaming UX that humans rely on when watching the pipeline. Reimplementing those layers would be a meaningful chunk of code, with no functional benefit until canon-ai needs something the CLIs can't express. The CLIs also let humans intervene mid-run (Ctrl+C, inspection, manual continuation) using the same tooling they already know.

**Rule**: New agent capabilities go through the CLI surface. If a feature requires direct API access, escalate — that's a real change in dependency shape and deserves its own decision entry.

---

## Versioning and release policy

**Decision**: canon-ai uses SemVer with strict bump-tier definitions; agent authorization scales with bump tier; `CHANGELOG.md` lives on `main` and ships with the published `canon-ai` npm package.

**Why**: SemVer is well-understood and matches user expectations for what to expect from a version bump. Tying agent authorization to bump tier means agents can ship low-risk fixes autonomously while breaking changes always involve a human — the bumps that matter most for adopters are gated. Shipping the changelog with the package gives adopters a single in-tree record of what changed between versions they install. (Pre-v1.0.0, the changelog lived only on `dev` because `main` was a portable template; that distinction is gone now that `main` is the release branch.)

**Rule**:

- **SemVer interpretation**:
  - **Patch**: bug fixes only, no behavior change beyond fixing the bug.
  - **Minor**: new features (new pipeline phase, new validation gate, new template section, new agent capability) without breaking existing usage.
  - **Major**: breaking changes — anything that requires adopters to update their `.canon/templates/`, their `status.json` schema, their workflow expectations, or any canon-supplied policy in a way that breaks existing tasks mid-flight.
  - **Guidance refinements are patch-eligible**: clarifying, tightening, or adding a rule of thumb / pitfall to *existing* canon guidance docs (`CLAUDE.md`, `AGENTS.md`, `docs/*`) is a patch even though it ships to adopters via `canon upgrade` — it refines guidance rather than adding a capability. A *new template section*, *new managed file*, *new pipeline phase/gate*, or *new agent capability* remains minor. Categorize net-new rules of thumb under `### Added` and edits to existing rules under `### Changed`.
  - **Changed canon-supplied defaults are minor**: changing the default model or reasoning-effort the matrix selects for a phase/size (what adopters get unless they override an env var) is a **minor** behavior change, not a patch — adopters feel it as different cost/latency/quality even though it doesn't break existing tasks. It is human-authorized (minor) and goes under `### Changed`. (A pure prompt-wording refinement that does not change which model/effort runs stays patch.)

- **Agent authorization**:
  - **Patch**: agents may bump the version and commit the changelog edit autonomously.
  - **Minor**: agents propose the bump in `done.md` (draft changelog entry); the human reviews before the changelog/version-bump commit lands.
  - **Major**: human-only. If a task introduces a breaking change that the spec didn't flag, raise it during QA before shipping.

- **Changelog audience and scope**:
  - `CHANGELOG.md` lives on `main` and ships with the published `canon-ai` npm package.
  - Audience is canon-ai contributors and adopters who want to know what changed between versions they install or upgrade to.
  - Format follows Keep a Changelog conventions.
  - The repo is currently private; the package is published from `main`. A future public release would not change the changelog model — `CHANGELOG.md` stays in-tree.

- **Release mechanics**: How to actually execute a release (version bump commands, lockfile refresh, tag-and-publish flow, hotfix path, auto-release workflow) lives in [`release-process.md`](release-process.md). That doc is the source of truth for *how*; this entry is the source of truth for *what counts as a bump and who authorizes it*. Notable rule from `release-process.md`: never use `sed` to bump versions in `package.json` or `package-lock.json` — use `npm version --no-git-tag-version` + `npm install --package-lock-only`. The 1.1.3 picocolors lockfile incident was caused by exactly that footgun.

---

## Canon prescribes no release model to adopters

**Decision**: Canon's adopter-facing guidance prescribes no specific release model. The `--pr` / `--ship` / `base_branch` mechanics are model-neutral by design. Adopters may use release-branch-per-version, trunk-from-main, tag-from-main, no versioning, or any hybrid — canon supports all of them because `base_branch` is recorded **per task** in `status.json` at creation.

**Why**: The alternative — shipping one concrete model as "the" canon workflow — produced recurring scope creep: prescriptive release-branch language crept back into adopter-facing surfaces multiple times because nothing pinned the stance. The orchestrator has been model-agnostic in code (`getBaseBranch()` in `scripts/run-task/git.ts` reads `base_branch` from `status.json` with no hardcoded `dev`/`release/` assumption) since before v1.0.0; the guidance lagged. Recording the stance as a settled decision is the anti-regression guard.

The per-task `base_branch` also makes hybrid repos first-class: a project that ships one surface via release branches and another straight to `main` can use canon for both — it just records the appropriate `base_branch` when creating each task.

**Rule**: Adopter-facing guidance — the skill files, every `CANON_OWNED` doc (e.g. `docs/pipeline-orchestrator.md`), and the delimited `AGENTS.md` / `CLAUDE.md` (see `CANON_OWNED` and `DELIMITED` in `src/lib/canon-owned.ts`) — must not present any single release model as required or as the canon default. When giving a worked example, label it as one common shape and name the authority pointer (the adopter's own `decisions.md §Versioning and Release Policy` and/or their release doc). Do not re-introduce unconditional release-branch framing in shipped surfaces; if a release-model-specific step is genuinely needed, scope it within a named recipe or a conditional clause.

---

## Model-generation re-baseline (2026-06)

_Generation: Opus 4.8 / Sonnet 4.6 / GPT-5.5._

**Decision**: Re-baseline the review harness and the code_review/implement model+effort tiers for the model generation canon now runs on. Three changes land in 1.11.0: (1) the two review lenses are instructed to over-report with severity + confidence labels and the foreman filters (find/filter split); (2) `code_review` L tier moves Opus → Sonnet 4.6, leaving Opus only for XL/delicate; (3) `implement` XL/delicate effort eases `xhigh` → `high`. Full analysis: [`harness-audit-2026-06.md`](harness-audit-2026-06.md).

**Why**:
- **Find/filter split.** Opus 4.8 and Sonnet 4.6 follow review instructions *literally*. Conservative prompts ("only high-severity," "don't nitpick") now measurably suppress real-bug recall, not just noise (CodeRabbit 100-PR planted-bug study: criticals 35→29, majors 119→81; recovered to parity once conservative language was dropped and filtering moved downstream). Canon's foreman architecture already separates synthesis from finding, so the fix is prompt wording: lenses report everything with severity+confidence; the foreman ranks and filters. The round-3+ tightening rule was likewise reworded to a *synthesis-stage* filter so it no longer instructs the lenses to self-censor.
- **L review → Sonnet 4.6.** The earlier L→Opus bump was a Sonnet-4.5-era response to missed lifecycle/state-machine bugs. Sonnet 4.6 closed that long-horizon gap (matches the prior Opus flagship per vendor + practitioner eval), so L returns to Sonnet at ~1/5 cost. Opus stays on XL/delicate.
- **Implement XL/delicate effort `xhigh` → `high`.** GPT-5.5 tends to *overthink* at `xhigh` with open-ended tool access — latency and token cost without a quality gain, per OpenAI's own guidance — and canon's core thesis is token discipline over reflexive max-effort. The blast-radius caution that initially argued for keeping `xhigh` doesn't hold up: `high` isn't "less careful," and `xhigh`'s overthinking can *reduce* quality on open-ended agentic work, not just cost more. Raise via `CODEX_*`/effort env only if eval shows under-reasoning on delicate work.

**Deliberately NOT changed**:
- **Effort floors** — audited and already adequate: the matrix's `medium` entries are either on Sonnet/tiny diffs or on phase/size combos that don't run (fast-tier spec is conversational); every Opus exploration tier (spec M+, code_review XL) is already `high`/`xhigh`, and code_review L is Sonnet/`high`.
- **Lens count stays two** (one anchored + one cold). 2026 correlated-error research endorses exactly this: beyond one anchored + one adversarial lens, added reviewers are near-clones (limited recall, more noise). Do not add a third lens.

**Backlogged (separate future minors, each its own spec)**: a test-generation / self-verification phase after implement; confidence-based cascaded reviewer escalation (Sonnet→Opus on low confidence) replacing pure size-based routing; micro-spec decomposition guidance for L/XL; a spec-contradiction lint in `/canon-review`.

---

## Auto-commit owned by the orchestrator (not the agent)

**Decision**: After Codex's `implement` phase passes validation, the orchestrator (`autoCommitCode()` in `scripts/run-task/main.ts`) parses the handoff Changes table and creates the implement commit. Codex does not run `git commit` itself.

**Why**: The alternative — Codex manages its own commits — produced two failure modes. **(1)** Inconsistent commit messages, untracked files swept in, partial commits left mid-implement. **(2)** No structural guarantee that the commit matches the handoff. Centralizing the commit step in the orchestrator gave us a single chokepoint to enforce: every dirty file must be in the handoff Changes table; every handoff file must exist or be already-committed. That cross-check is the load-bearing safety property that makes code review meaningful — the reviewer knows the diff and the handoff agree before they start.

**Rule**: Codex must not run `git commit` during implement. The orchestrator owns the commit. If `autoCommitCode()`'s constraints feel too tight (e.g., a legitimate change needs files outside the handoff table), the fix is to update the handoff, not to bypass the auto-commit.


---

## Declared Canon vs Executable Canon as a recurring audit lens

**Decision**: When reviewing canon's own changes (its harness, policy, templates, or rule files), the explicit framing is "does the executable behavior match the declared behavior?" Drift between the two — `AGENTS.md` / `CLAUDE.md` / docs promising one rule while `scripts/run-task/`, `scripts/task.sh`, or templates enforce something weaker, different, or stale — is its own bug class and gets called out as such.

**Why**: TokenAnxiety's first dogfood report (discussion #27, 2026-05-10) surfaced multiple findings that all reduced to declared/executable drift, not philosophical objections to canon:
- `task.sh` resets `iterations` to 0 on approval — telemetry promised cumulative count, code provides loop-local count. ([scripts/task.sh:344](scripts/task.sh#L344))
- `code-review.ts` and `plan.ts` reject template-unfilled artifacts; `spec-review.ts` (until commit 27463ce) didn't — the rule was declared uniformly but enforced asymmetrically.
- `human_review: done` can flip true with unresolved `human_pending` validations — the declared "done means done" contract isn't enforced.

These look like separate bugs at the artifact level. They share a generator: rules added to declared canon without a corresponding executable enforcement, or with an enforcement that drifts as the harness evolves. Naming the pattern explicitly lets reviewers ask one question that catches a family of bugs, rather than re-discovering each instance.

**Rule**: When reviewing changes to canon's harness, policy, or rule files, run the declared/executable check explicitly:
1. If a change touches `AGENTS.md` / `CLAUDE.md` / `docs/patterns.md` / `docs/decisions.md` to *add or strengthen* a rule, verify the orchestrator/scripts/templates enforce it — and add the enforcement if not. A new declared rule without an executable counterpart is a half-landed change.
2. If a change touches the executable surface (orchestrator, `src/task/index.ts`, templates) to *weaken or alter* a rule, verify the declared canon still describes the executable behavior — and update the docs/rule files if not.
3. When a real bug surfaces, ask: is this a *one-off failure* (write the fix) or is it a *declared/executable drift* (write the fix AND name the family in the commit message or BACKLOG)? If the latter, look for related drift in adjacent surfaces.

Periodic application: when running an audit on canon (TokenAnxiety-style dogfood, an `architect_review`-shaped pass over the harness, or just a pre-release sweep), explicitly bucket findings as "declared bug," "executable bug," or "drift between the two." The drift bucket is usually the most productive one to mine.


---

## Canon is a quality layer, not an authoring tool

**Decision**: Canon does not compete with AI authoring tools (Cursor, Copilot, Claude Code, Codex, Devin, Aider). Canon's category is the *quality layer for AI coding agents*: a repo-local governance system that turns existing agents' output into spec-bound, independently reviewed, validation-backed, human-shippable work. Authoring-tool features (better code completion, repo search, autonomous PR generation) are explicitly out of scope; quality-layer features (spec authorship discipline, cross-agent review, validation evidence, definition-of-done enforcement) are explicitly in scope.

**Why**: The authoring-tool category is already a knife fight with deeply-resourced incumbents and is collapsing feature boundaries quickly. Canon has no credible structural advantage in raw authoring. The quality/governance category has a real gap that no incumbent owns: review bots (CodeRabbit, Bugbot, Greptile, Cursor Bugbot) live at the PR seam; instruction files (`CLAUDE.md`, `AGENTS.md`, Copilot custom instructions) live at the prompt seam; nobody sits in the full spec→implement→review→QA lifecycle with structured handoffs the way canon does. Canon's two-agent split + cross-review + validation matrix + canon-vs-task distinction is the differentiated surface. External evidence (Stack Overflow 2025 AI survey: 84% using AI, 29% trust; DORA March 2026: time saved on generation moves into verification overhead; Veracode 2025: 45% of AI-generated code samples had risky security flaws) confirms the market pain is real and downstream of authoring tools, not solved by them. Memo #30 (2026-05-10) made the strategic case in detail.

**Qualifier — what the rule does NOT mean**: "Quality layer, not authoring" describes canon's *competitive positioning*, not its full effect surface. Canon's spec phase + grill mode genuinely improves *authoring* quality at the source — by forcing scope alignment and surfacing constraints before implementation — but improving authoring is a byproduct, not the wedge. The positioning rule is: don't market canon against authoring tools, don't scope canon features around competing with authoring tools, and don't accept "but canon also helps authoring" as a reason to expand into authoring territory.

**Rule**: When scoping a new canon feature or evaluating an external request, ask: *does this make AI-authored work more spec-bound, more independently reviewed, more validation-backed, or more human-shippable?* If yes, in scope. If it's about generating better code, suggesting code, completing code, or replacing human authoring — out of scope; refer the user to the appropriate authoring tool. Reopening this decision requires evidence that the quality-layer wedge has failed at validation (pilot programs showing canon does not actually reduce rework on governed tasks), not preference for the broader scope.


---

## Track new work in BACKLOG.md by default; reserve GH issues for adopter-filed bugs and PR-tied items

**Decision**: New work items captured during canon-ai development land in `docs/BACKLOG.md`, not as GitHub issues. GitHub issues are reserved for three specific cases: (1) bugs and feature requests filed by external adopters — the filer's choice of surface, leave them where they are; (2) items about to land in a PR that wants `Closes #N` auto-close; (3) items with active asynchronous discussion involving someone outside the current session.

**Why**: BACKLOG's prose-and-cross-reference format is materially better than the issue-body format for the kind of work canon currently runs — design-stage entries with sequencing dependencies, replace-vs-augment tensions, future-additions tables, and links to other entries. Issues are good for linear lifecycles (open → fix → close); BACKLOG is good for living documents that evolve as related findings surface. At canon-ai's current scale (single developer + occasional external dogfooder, private repo, auto-close-on-merge doesn't fire for `dev`), GitHub's issue affordances (assignment, labels, project boards, search) are unused and add no value over a flat doc. The decision is reversible if canon goes OSS later and external bug filings overwhelm the BACKLOG-first flow — promote BACKLOG entries back into issues at that point.

**Rule**: When framing a new piece of work — a design idea, a follow-up from a discussion, a refactor proposal — add an entry to `docs/BACKLOG.md` under the appropriate section. Only open a GH issue when one of the three reserved cases applies. Signal that an entry belongs in BACKLOG rather than as an issue: it has "depends on / blocks / interacts with" pointers to other entries, it has unresolved design tensions worth documenting, or it's prose-density work that the issue format actively compresses. External adopter filings stay as issues regardless — migrating them would feel dismissive of external-contributor signal.


---

## Validation runs inside agent phases (supersedes orchestrator-run `runtime_validation`)

**Decision**: Validation execution lives inside agent phases — Codex runs project-specific checks during `implement`; Claude verifies in Stage 1 code review by reading the outcomes table critically and re-running selectively when anything looks off. The orchestrator does not run independent validation checks. The `runtime_validation` phase as currently shipped (orchestrator-run smoke plus a planned project-policy loader extension point) is being retired as a consequence; that retirement work has its own task.

**Why**: The earlier model treated the orchestrator as an independent witness against agents hallucinating Pass results. Two findings collapse that thesis:

1. **Empirical**: agents don't fabricate test execution. The realistic failure modes are:
   - Skipping a check entirely when the spec doesn't crisply require it.
   - Interpreting a real failure as pre-existing/unrelated when it's actually consequential to the task.
   - Summarizing "10 passed, 5 skipped" as "tests pass" without naming the skips.

   All three are spec-clarity and interpretation failures, not execution failures — they don't change based on *who* ran the check. An orchestrator-run smoke still produces output that some agent has to summarize into the handoff outcomes table, and that's where the slip happens. The witness layer was never going to catch these; Stage 1 code review (Claude reading the outcomes table against the diff *and the spec*) is the only layer that does, and that layer is unaffected by the runner. The existing `Fail – unrelated` mechanism (Notes column must contain a specific file reference, assessed by Claude in Stage 1) is the right guardrail for failure-mode #2. A deterministic pre-flight layer was added on top (task `preflight-failure-routing`): a `Fail – unrelated` entry whose cited file is in the task's own branch diff is now rejected before Claude review — the "unrelated" label is invalid for a file the task changed. Entries citing a file genuinely outside the diff still pass to Stage 1 where Claude assesses credibility.

2. **Architectural**: the witness boundary was theater. The conversational Claude session runs canon with broad operator permissions; the orchestrator is a Node.js script in that same shell. There is no security/trust asymmetry between "what the orchestrator runs" and "what Codex runs in its sandbox" — both execute in the operator's terminal. Codex's tighter default sandbox is OpenAI's shipping choice; canon's Codex invocation owns the sandbox baseline explicitly in `scripts/run-task/agents/codex.ts` (`--sandbox workspace-write`). The model relied on a trust gradient that doesn't exist.

What the orchestrator does uniquely (and these stand): routes between phases and writes `status.json`; computes the diff for `affectedFiles`; spawns agent CLIs with the right session context; auto-commits per the handoff table. None of these require it to also run validation checks.

**Rule**:

1. **Validation execution stays in agent phases.** Codex runs project-specific checks (lint, type-check, unit tests, e2e, staging smoke, anything else) during `implement`. Claude verifies in Stage 1 code review by reading the `## Validation Outcomes` table — if any row looks ambiguous (vague Pass with skipped tests, missing test names, predicate-gated check unexpectedly skipped), Claude re-runs that check in its own session before approving.

2. **Adopters extend validation via project scripts, not via canon-side policy modules.** Real checks live in the project's `package.json` scripts (or equivalent) and run inside Codex's `implement` phase. Canon owns the Codex sandbox baseline (`--sandbox workspace-write`) in the runner; canon does not ship project-local Codex config because Codex CLI does not auto-discover it. Adopters who want personal Codex defaults (sandbox, MCP servers, model preferences) set them in `~/.codex/config.toml` — those apply to all `codex` invocations they run, not just canon's, and canon's runner flags take precedence for canon's invocations.

3. **The orchestrator pre-computes `affectedFiles` and injects it into the implement prompt.** Predicate gating (e.g., "run e2e only if `src/` changed") moves into prompt-shaped logic inside Codex's implement session. The orchestrator already knows the committed-file set; injecting it once eliminates the need for project-side TS predicates to re-derive it.

4. **`runtime_validation` is retired.** Drop it from `PHASE_ORDER`, the dispatch switches, `task.sh` validation, `status.json` schema, and the handoff template's Runtime Validation Outcomes section. The smoke echo in `RUNTIME_CHECKS` goes with it. This is a separate task; this entry authorizes the change.

5. **The validation-authority boundary in `AGENTS.md` is removed by the retirement task.** Going forward there is one validation outcomes section, authored by Codex during implement. There is no separate orchestrator-authored counterpart.

**Supersedes**: The validation-authority boundary previously documented in `AGENTS.md` (Codex authors `## Validation Outcomes`; orchestrator authors `## Runtime Validation Outcomes`). Also supersedes the unshipped design that would have added a project-policy loader extension point for `runtime_validation` (`tasks/project-phases/` — deleted; design rationale in conversation history 2026-05-15).

---

## Cold independent review: pursue multi-agent Claude, park the Codex code-review phase

**Decision** (2026-06-04): Canon's independent-adversarial-review direction is **multi-agent Claude cold review**, not a built-in Codex code-review phase. The `codex-code-review-phase` task is **archived** — its spec and evidence stay as reference for possible later use.

**Why**: A cold review pass (a reviewer reading the diff with no spec anchor) catches a class of lifecycle/state-machine/consistency bugs that spec-anchored Claude `code_review` structurally misses — the empirical case is strong (`tasks/_archive/codex-code-review-phase/evidence-codex-vs-claude.md`: across 173 Codex PR findings, 0 false positives and ~76% sat off-AC). But the head-to-head also found Codex and cold-Claude are *complementary, not substitutes*, and that the highest-value marginal add is a **cold-Claude in-pipeline pass**: it reuses the in-loop model (no new dependency) and needs no external review provider, whereas a Codex phase binds canon to one provider that not every adopter runs and that is async + rate-limited on PRs. Archiving keeps the Codex-phase design available for an adopter who lacks any external cold-review source. This refines, not reverses, the [[Two distinct agents]] decision — the goal is still no-self-review independence; the open question is which second reviewer, and the answer is now "a cold-context Claude pass" by default.

**Rule**: Don't build the opt-in Codex code-review phase without fresh human direction. New cold-review work targets a multi-agent Claude pass. Cold-Claude is higher-recall but noisier (lower precision) than Codex, so any cold-Claude review phase must carry an adjudication/precision layer (the adjudication design in the archived spec largely carries over). If reviving the Codex phase for an adopter, drive from `tasks/_archive/codex-code-review-phase/spec.md`, not the stale `task/codex-code-review-phase` branch.
