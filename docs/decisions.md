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

**Rule**: New task-facing provenance should read from `status.json.canon`. The canonical upstream repo slug lives in `CANON_UPSTREAM_REPO` in `scripts/run-task/canon-snapshot.ts`; do not duplicate that value in docs or handoff artifacts unless you're explicitly pointing back to the symbol. `captureCanonSnapshot()` may override the stamped slug at call time from a non-empty `CANON_UPSTREAM_REPO` env var, but the symbol remains the default source of truth.

Installed-package mode identifies canon by `canon_version` rather than a borrowed adopter commit, because no canon commit is recoverable from the published artifact. This does not bake a source SHA into `dist` (the reproducible-dist CI gate prevents that) or read the updater's `.canon` provenance receipt for a canon SHA (the write-time receipt can drift from the executing binary in a global install).

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

## Fast tier (XS non-delicate) skips Codex spec review

**Decision**: Tasks marked `task_size: XS` and not `delicate` skip the Codex spec review phase entirely. The human spec gate replaces it.

**Why**: The alternative — every task gets full spec review — was thorough but expensive. For fast-tier tasks (XS, non-delicate), the human-Claude conversation produces a spec the human directly approves; routing it through a Codex review pass adds latency and cost without catching real issues, because the spec has little-to-no premise worth challenging. Reserving Codex spec review for S/M/L/XL/delicate tasks (where shape concerns and decomposition are real) preserves the cost-quality tradeoff.

**Rule**: Don't add spec_review work to XS non-delicate tasks. If a task feels like it needs spec review, that's a signal to size it S (or set `delicate: true`), not to bypass the tier rule.

---

## XS is the pipeline floor; spec_review is the XS→S dividing line

**Decision**: XS exists for changes where running the pipeline beats inline work, but the spec still has little-to-no premise worth reviewing. S is the first full-tier size.

**Why**: Inline work is for trivial direct edits; Claude implements and asks Codex for review at intervals, with no task, ACs, or plan. XS is for more than a trivial one-file inline change (>1 file, or real logic): it buys the pipeline's cross-review direction, written ACs, a plan, and a real code review while still skipping Codex spec_review. S begins when the spec carries enough logic or risk that Codex challenging the premise earns its keep.

**Rule**: Choose inline below the pipeline, XS for the smallest pipeline-worthy work, and S when spec_review should run.

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

**Why**: SemVer is well-understood and matches user expectations for what to expect from a version bump. Tying agent authorization to bump tier means agents can ship low-risk fixes autonomously while breaking changes always involve a human — the bumps that matter most for adopters are gated. Shipping the changelog with the package gives adopters a single in-tree record of what changed between versions they install. (Pre-v1.0.0, the changelog lived only on `dev` because `main` was a portable template; that distinction is gone now that releases are cut from `main` — see [`release-process.md`](release-process.md) for canon-ai's current trunk-based release flow.)

**Rule**:

- **SemVer interpretation**:
  - **Patch**: bug fixes only, no behavior change beyond fixing the bug.
  - **Minor**: new features (new pipeline phase, new validation gate, new template section, new agent capability) without breaking existing usage.
  - **Major**: breaking changes — anything that requires adopters to update their `.canon/templates/`, their `status.json` schema, their workflow expectations, or any canon-supplied policy in a way that breaks existing tasks mid-flight.
  - **Guidance refinements are patch-eligible**: clarifying, tightening, or adding a rule of thumb / pitfall to *existing* canon-owned guidance surfaces (`docs/*`, skills, prompts, templates) is a patch even though it ships to adopters via `canon upgrade` — it refines guidance rather than adding a capability. A *new template section*, *new managed file*, *new pipeline phase/gate*, or *new agent capability* remains minor. Categorize net-new rules of thumb under `### Added` and edits to existing rules under `### Changed`.
  - **Changed canon-supplied defaults are minor**: changing the default model or reasoning-effort the matrix selects for a phase/size (what adopters get unless they override an env var) is a **minor** behavior change, not a patch — adopters feel it as different cost/latency/quality even though it doesn't break existing tasks. It is human-authorized (minor) and goes under `### Changed`. (A pure prompt-wording refinement that does not change which model/effort runs stays patch.)

- **Agent authorization**:
  - **Patch**: agents may bump the version and commit the changelog edit autonomously.
  - **Minor**: the release/changelog step (for example, via `/canon-changelog`) — **not the QA phase** — proposes the bump tier; QA contributes changelog entry text only. The human reviews before the changelog/version-bump commit lands.
  - **Major**: human-only. If a task introduces a breaking change that the spec didn't flag, raise it during QA before shipping.

- **Changelog audience and scope**:
  - `CHANGELOG.md` lives on `main` and ships with the published `canon-ai` npm package.
  - Audience is canon-ai contributors and adopters who want to know what changed between versions they install or upgrade to.
  - Format follows Keep a Changelog conventions.
  - The repo is currently private; the package is published from `main`. A future public release would not change the changelog model — `CHANGELOG.md` stays in-tree.

- **Release mechanics**: How to actually execute a release (version bump commands, lockfile refresh, tag-and-publish flow, hotfix path, auto-release workflow) lives in [`release-process.md`](release-process.md). That doc is the source of truth for *how*; this entry is the source of truth for *what counts as a bump and who authorizes it*. Notable rule from `release-process.md`: never use `sed` to bump versions in `package.json` or `package-lock.json` — use `npm version --no-git-tag-version` + `npm install --package-lock-only`. The 1.1.3 picocolors lockfile incident was caused by exactly that footgun.

---

## Canon ships zero owned content into adopter agent files

**Decision**: Adopter `AGENTS.md` and `CLAUDE.md` stay fully project-owned. Canon's reusable workflow rules ship through just-in-time prompt templates, Claude Code skills, task templates, and protected docs instead.

**Why**: The rules that pipeline agents need are delivered at the phase or skill that consumes them. Keeping a multi-hundred-line canon-owned block in every adopter agent file duplicates that context, increases session load, and makes local project guidance harder to scan. A recommend-only discovery nudge is enough for fresh sessions to learn that a repo uses canon without canon owning the file.

**Rule**: `AGENTS.md` and `CLAUDE.md` are not members of `CANON_OWNED` or `DELIMITED` in `src/lib/canon-owned.ts`. `canon init` does not create them; `canon upgrade` does not modify them. They come from the built-in `/init` (Claude Code's `/init` → `CLAUDE.md`; Codex's init → `AGENTS.md`), not from canon; canon only detects their presence so it can suggest the discovery nudge or the optional `CLAUDE.md` = `@AGENTS.md` consolidation.

---

## Canon-shipped guidance never names orchestration internals

**Decision**: Canon-managed and shipped guidance must not point adopters at canon orchestration internals — the orchestrator source under `scripts/run-task/**`, canon's CLI source under `src/**`, or the per-phase prompt templates under `scripts/run-task/prompts/templates/`. Adopters customize task templates by copying them into `tasks/_templates/` (which `canon task new` prefers over the canon-shipped `.canon/templates/` defaults, and which `canon upgrade` never overwrites); canon's shipped surfaces otherwise stay decoupled from the implementation machinery adopters do not have. This is the broad principle; enforcement of it is split between a mechanical gate and authoring/review discipline (see Rule).

**Why**: Canon ships into adopter repos through upgradeable guidance surfaces, while the orchestration internals live only in canon's own checkout. If shipped prose points at those internals, adopters get broken references — surfaced when their `docs-refs-check` next runs (canon invokes it at `--pr`/commit time in `scripts/run-task/main.ts`, and in CI for repos that wire it up), not at `canon upgrade` itself — or instructions they cannot follow. Keeping shipped guidance on adopter-facing phases, concepts, and overridable templates preserves the contract without leaking canon's implementation details. The v2.0.0 leak (`adopter-agent-file-redesign`, a shipped skill naming the internal `implement.md` prompt template) is the canonical instance this rule guards against.

**Rule**:

- **The leak gate in `scripts/sync-canon-templates.mjs` mechanically enforces the unambiguous subset** of this principle, and the gate (run via `npm run sync-templates:check`) must pass before shipping canon-managed markdown, skills, or templates. The gate blocks two reference classes because they are *unambiguously* canon-internal: (1) path refs under `scripts/run-task/` (the orchestrator tree, including the prompt templates), and (2) bare basenames of internal-only per-phase prompt templates — those under `scripts/run-task/prompts/templates/` that have no `.canon/templates/` or task-artifact counterpart (e.g. `qa.md`, `implement.md`). It deliberately does **not** blanket-block bare `src/` or `scripts/` path refs: those directory names are ambiguous — adopters have their *own* `src/` and `scripts/`, and shipped guidance legitimately references the adopter's source root as a concept (e.g. `canon-init/SKILL.md`'s "`src/` or equivalent source root"). A blanket prefix block there would false-positive on correct adopter-facing prose.

- **For the ambiguous internals the gate cannot mechanize** — a ref to one of canon's *own* `src/**` files (e.g. `` `src/task/index.ts` ``) inside shipped guidance — the principle is upheld by authoring and code review, not the gate. When authoring or reviewing canon-managed surfaces, treat a specific canon `src/**` file path as a leak and rephrase it to name the adopter-facing concept, phase, or override point instead.

- **Either way, the fix for a flagged or spotted leak is the same**: rephrase to name the phase, adopter-facing concept, or override point — never the internal file path. Strengthening the gate to cover an additional reference class is worthwhile only when that class can be detected without false-positiving on legitimate adopter-facing usage.

---

## Canon prescribes no release model to adopters

**Decision**: Canon's adopter-facing guidance prescribes no specific release model. The `--pr` / `--ship` / `base_branch` mechanics are model-neutral by design. Adopters may use release-branch-per-version, trunk-from-main, tag-from-main, no versioning, or any hybrid — canon supports all of them because `base_branch` is recorded **per task** in `status.json` at creation.

**Why**: The alternative — shipping one concrete model as "the" canon workflow — produced recurring scope creep: prescriptive release-branch language crept back into adopter-facing surfaces multiple times because nothing pinned the stance. The orchestrator has been model-agnostic in code (`getBaseBranch()` in `scripts/run-task/git.ts` reads `base_branch` from `status.json` with no hardcoded `dev`/`release/` assumption) since before v1.0.0; the guidance lagged. Recording the stance as a settled decision is the anti-regression guard.

The per-task `base_branch` also makes hybrid repos first-class: a project that ships one surface via release branches and another straight to `main` can use canon for both — it just records the appropriate `base_branch` when creating each task.

**Rule**: Adopter-facing guidance — the skill files, every `CANON_OWNED` doc (e.g. `docs/pipeline-orchestrator.md`), task templates, prompt templates, and other shipped canon-owned surfaces — must not present any single release model as required or as the canon default. When giving a worked example, label it as one common shape and name the authority pointer (the adopter's own `decisions.md §Versioning and Release Policy` and/or their release doc). Do not re-introduce unconditional release-branch framing in shipped surfaces; if a release-model-specific step is genuinely needed, scope it within a named recipe or a conditional clause.

---

## Model-generation re-baseline (2026-06)

_Generation: Opus 4.8 / Sonnet 4.6 / GPT-5.5._

**Decision**: Re-baseline the review harness and the code_review/implement model+effort tiers for the model generation canon now runs on. Three changes land in 1.11.0: (1) the review lenses are instructed to over-report with severity + confidence labels and the foreman filters (find/filter split); (2) `code_review` L tier moves Opus → Sonnet 4.6, leaving Opus only for XL/delicate; (3) `implement` XL/delicate effort eases `xhigh` → `high`. Full analysis: [`harness-audit-2026-06.md`](harness-audit-2026-06.md).

**Why**:
- **Find/filter split.** Opus 4.8 and Sonnet 4.6 follow review instructions *literally*. Conservative prompts ("only high-severity," "don't nitpick") now measurably suppress real-bug recall, not just noise (CodeRabbit 100-PR planted-bug study: criticals 35→29, majors 119→81; recovered to parity once conservative language was dropped and filtering moved downstream). Canon's foreman architecture already separates synthesis from finding, so the fix is prompt wording: lenses report everything with severity+confidence; the foreman ranks and filters. The round-3+ tightening rule was likewise reworded to a *synthesis-stage* filter so it no longer instructs the lenses to self-censor.
- **L review → Sonnet 4.6.** The earlier L→Opus bump was a Sonnet-4.5-era response to missed lifecycle/state-machine bugs. Sonnet 4.6 closed that long-horizon gap (matches the prior Opus flagship per vendor + practitioner eval), so L returns to Sonnet at ~1/5 cost. Opus stays on XL/delicate.
- **Implement XL/delicate effort `xhigh` → `high`.** GPT-5.5 tends to *overthink* at `xhigh` with open-ended tool access — latency and token cost without a quality gain, per OpenAI's own guidance — and canon's core thesis is token discipline over reflexive max-effort. The blast-radius caution that initially argued for keeping `xhigh` doesn't hold up: `high` isn't "less careful," and `xhigh`'s overthinking can *reduce* quality on open-ended agentic work, not just cost more. Raise via `CODEX_*`/effort env only if eval shows under-reasoning on delicate work.

**Deliberately NOT changed**:
- **Effort floors** — audited and already adequate: the matrix's `medium` entries are either on Sonnet/tiny diffs or on phase/size combos that don't run (fast-tier spec is conversational); every Opus exploration tier (spec M+, code_review XL) is already `high`/`xhigh`, and code_review L is Sonnet/`high`.
- **Lens count: one anchored + two cross-family adversarial lenses (cold-Claude + cold-Codex).** The near-clone caveat scopes to same-model additions: beyond one anchored reviewer and one same-family adversarial reviewer, added same-model reviewers tend to produce correlated misses, limited recall gain, and more noise. A lens from a different model family is the exception when evidence shows decorrelated blind spots. The archived head-to-head (`docs/canon-opus48-gpt55-report.md`: 173 Codex PR findings, 0 false positives, ~76% off-AC) found Codex and cold-Claude complementary, and the operator's current practice of pre-running `codex review` before PRs confirms Codex repeatedly finds P2s the Claude lenses miss. Do not add another same-model review lens without fresh evidence; cross-family additions are evaluated on their own merits.

**Backlogged (separate future minors, each its own spec)**: a test-generation / self-verification phase after implement; confidence-based cascaded reviewer escalation (Sonnet→Opus on low confidence) replacing pure size-based routing; micro-spec decomposition guidance for L/XL; a spec-contradiction lint in `/canon-spec-review`.

---

## `spec_review` M effort raised medium → high (2026-07)

**Decision**: Raise Codex `spec_review` effort for M-sized tasks from `medium` to `high`, matching L. This supersedes the 2026-06 re-baseline's "effort floors already adequate" audit, which had not yet analyzed reroute-severity data — the claim above needs correcting: M's `medium` floor was not adequate.

**Why**: A task-history analysis across canon-ai's own archive and a second production project (galleryplanner), ~145 tasks with code_review iteration data, found:
- Aggregate `code_review.iterations_total` looked worse for M (avg 2.91) than L (avg 2.21) — naively suggesting mini struggles more with M-scope implementation than L-scope.
- Controlling for whether a task hit a mid-implement reroute (`implement.reroute_count > 0`) overturned that read: **non-rerouted** M and L tasks were nearly identical (1.40 vs 1.00 avg rounds) — mini's clean-path implementation quality doesn't degrade going from M to L. The entire size-correlated gap lived in reroute rate and severity, not implement capability.
- Rerouted tasks average ~3.7x more code_review rounds than non-rerouted ones (4.39 vs 1.19) — reroute status, not size, is the dominant cost driver. And M's rerouted tasks were the worst of any size band (avg 5.15, vs. L's 4.83, S's 3.45). This is a correlational read, not a controlled isolation — M and L also differ in loop cap, budget, and QA effort, so `spec_review` effort is the leading **hypothesis** for M's worse reroute severity, not a proven sole cause. It's the one difference that plausibly acts *before* implementation (catching scope gaps pre-reroute) and it lines up with the effort-curve evidence below, which is why it's the lever this decision changes first — not because the other confounds have been ruled out.
- External corroboration: a practitioner study running GPT-5.5-driven Codex across 26 real tasks on an open-source repo found `medium → high` is the single largest quality jump (test-pass 81%→96%, review-pass doubles) for a modest cost increase (+43%), while `high → xhigh` shows diminishing-to-negative returns (test-pass regresses, cost nearly doubles again) — the OpenAI-guidance overthinking pattern already cited for the `implement` XL/delicate `xhigh` decision above, independently reproduced at the `medium`/`high` boundary this change touches.

**Rule**: `spec_review` M now runs `mini/high`, identical to L on both `spec_review` and `implement`. M and L still differ on `MAX_REVIEW_LOOPS` (3 vs. 5) and Claude `qa` effort (`medium` vs. `high` per `claudeMatrix()`'s `buildMedium`) — those are unchanged by this decision and are blast-radius/patience knobs rather than Codex model-capability tuning. (`CLAUDE_BUDGET` was also in this category but was equalized to $10 for both M and L on 2026-07-11 — M's review-heavy reroutes were plausibly bumping the old $5 cap; see `CLAUDE_BUDGET` in `docs/pipeline-orchestrator.md`. This equalization was later superseded by a phase-aware split — see "`CLAUDE_BUDGET` becomes phase-aware, not just size-aware (2026-07)" below.) Re-measure M vs. L reroute rate and severity after this ships across enough tasks to be meaningful; if they converge, that's evidence (not yet proof) that `spec_review` effort was the load-bearing difference, and the remaining QA-effort gap becomes the next thing worth questioning. Do not chase a Codex model-family upgrade (e.g. GPT-5.6 Luna/Sol) for M or L on the strength of the pre-correction iteration data — that data pointed at a spec_review effort gap, not a model-capability gap.

---

## `CLAUDE_BUDGET` becomes phase-aware, not just size-aware (2026-07)

**Decision**: Split `CLAUDE_BUDGET`'s resolution table from a `TaskSize`-only axis into a `ClaudePhase` × `TaskSize` table. `spec`/`plan`/`qa` keep the existing size-tiered values (XS/S $5, M/L $10, XL $20); `code_review` gets its own, higher curve (XS $5, S $10, M $15, L $20, XL $40).

**Why**: Since `#182` ("Add cold-Codex third lens to code_review"), `code_review` runs a structurally different and costlier workload than the other three Claude phases: an orchestrator-run cold-Codex diff review, then a Claude foreman that spawns an anchored-Claude lens and a cold-Claude lens and synthesizes all three in one session — sometimes including empirical verification (reverting a fix and re-running the project's test suite to confirm a finding actually discriminates). `spec`/`plan`/`qa` are single-pass Claude sessions with no equivalent multi-lens fan-in. A uniform per-size budget can't express that gap: raising it enough to cover `code_review`'s worst case over-provisions the other three phases, where a tight ceiling is a more useful circuit breaker on a genuinely runaway session. Confirmed empirically on `a-gallery-wall-task` (M-tier, `gallery_wall` project): `code_review` exhausted the just-raised $10 M-tier budget mid-synthesis and needed a manual `CLAUDE_BUDGET=20.00` override to complete a third review iteration.

**Rule**: See the Claude Budget Matrix in `docs/pipeline-orchestrator.md` for the full phase × size table. Only the M `code_review` cell ($15) has direct incident evidence behind it; S ($10), L ($20), and XL ($40) are extrapolations along the same ramp and may need re-tuning once real usage data accumulates — that's a follow-up curve-tuning task, not evidence the phase-aware mechanism itself is wrong. The `CLAUDE_BUDGET` env var itself is unchanged: when set, it still overrides every phase and size uniformly — no new per-phase override env var was introduced.

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

## Cold independent review: cold-Claude + cold-Codex in-pipeline, PR-level Codex backstop retained

**Decision** (updated 2026-06): Canon's independent-adversarial-review direction is a three-input synthesis: anchored Claude, cold-Claude, and cold-Codex. The earlier `codex-code-review-phase` archive is superseded by an in-pipeline cold-Codex lens adopted on fresh human direction.

**Why**: A cold review pass catches lifecycle/state-machine/consistency bugs that spec-anchored code review structurally misses. The archived evidence remains relevant (`tasks/_archive/codex-code-review-phase/evidence-codex-vs-claude.md`: across 173 Codex PR findings, 0 false positives and ~76% sat off-AC), but its "park Codex" conclusion has been overtaken by current dogfood: Codex routinely finds PR P2s missed by the Claude lenses, and the operator now pre-runs `codex review` before opening PRs. This change institutionalizes that manual step inside `code_review`. PR-level Codex review remains on as a belt-and-suspenders backstop.

**Rule**: The cold-Codex lens is in-pipeline. The PR-level `codex review` remains as a final backstop. The archived `codex-code-review-phase` spec is historical reference, not the active design.

---

## Cold-Codex code-review lens: orchestrator-run, sequential, hard-fail (2026-06)

**Decision**: During `code_review`, the orchestrator runs a sequential cold-Codex review before the Claude foreman: `codex exec review --json -c model_reasoning_effort=<effort> --base <baseBranch> -m <miniModel>` in the active task worktree. `<miniModel>` and `<effort>` resolve through `getCodexConfig('code_review', tasks)`: the `code_review` row in `codexMatrix()` pins the model to `codexModelMini` and effort to flat `high` at every size, including XL/delicate. The lens deliberately receives no full-model upgrade; `CODEX_MODEL_MINI` / `CODEX_MODEL_DEFAULT` overrides still apply to its model. The captured `agent_message` text is written verbatim to `tasks/<id>/review-cold-codex.md` and injected into the foreman prompt as the pre-obtained third lens input.

The foreman still spawns only the two Claude lenses. It synthesizes anchored Claude, cold-Claude, and cold-Codex with verify-don't-relay discipline: cold findings are checked against the diff/code, anchored findings are reconciled against spec scope, and a verified cold finding is not dismissed merely for being off-AC.

Failure is deterministic: if the cold-Codex review produces no findings output or the subprocess cannot run, `code_review` stops before any Claude session. There is no new verdict, no `codex_error`, and no graceful two-Claude-lens fallback.

Bundle contract: a bundle shares one branch and one combined diff, so the orchestrator runs one cold-Codex review per `code_review` invocation. The same captured findings reach every member's foreman prompt/artifact, and failure is atomic across the bundle.

**Why**: Orchestrator-run was chosen over foreman-owned execution because the foreman would need a poller or a new verdict/routing path to hard-fail reliably. The orchestrator already owns Codex subprocess invocation and can halt before synthesis without changing `checkAndRoute()`. Sequential execution is the v1 tradeoff: it adds wall-clock latency, but the run log records `→ cold-codex review (<taskIds>): <n>s` so a later concurrency decision can use real data.

---

## JIT rule delivery: canon rules injected per phase, not ambient auto-loaded

**Decision**: Canon's operating rules are delivered just-in-time per consuming phase via injected prompt templates (`implement.md`, `qa.md`, `spec-review.md`, etc.), agent charters (`.claude/agents/`), and skills (`.claude/skills/`) — not via ambient auto-load of `AGENTS.md` / `CLAUDE.md` in every pipeline session.

**Why**: Previously, every phase auto-loaded all rules through `AGENTS.md` / `CLAUDE.md`. That meant code-review lenses carried spec-writing guidance they never use, and the implement prompt carried QA rules. Scoping each rule to the specific phase that consumes it shrinks each phase's prompt to its own job and reduces cross-rule attention dilution.

**Rule**: Pipeline-facing operating rules need a surviving JIT home in the consuming phase's prompt, charter, or skill. `AGENTS.md` / `CLAUDE.md` may still exist as operator-facing context and project additions, but they must not be the sole home for a rule required by a pipeline phase. The vacate task removes the now-redundant canon-block copies.

---

## Agent files come from built-in `/init`, not canon scaffolding

**Decision**: Claude Code's built-in `/init` and Codex's init command generate the adopter's `CLAUDE.md` and `AGENTS.md` as high-level codebase overviews. Canon does not scaffold, modify, or read those files; it only detects them so it can recommend the discovery nudge and the optional `CLAUDE.md` = `@AGENTS.md` consolidation. Adopter agent files remain adopter-owned.

**Why**: Canon already has the `docs/` knowledge corpus and phase-scoped skills/prompts for its own operating rules. Keeping agent-file generation inside the host tool's built-in init flow aligns canon-ai's guidance with what adopters actually get from their agent shell, avoids duplicating the bootstrapping job, and keeps canon's install/bootstrap story focused on the docs corpus it does own.

**Rule**: Do not describe canon as generating or reading adopter agent files. Recommend the built-in `/init` for agent-file creation, keep canon's bootstrap claims scoped to the `docs/` corpus, and treat `AGENTS.md` / `CLAUDE.md` as adopter-owned overviews that may optionally consolidate via `@AGENTS.md`.
