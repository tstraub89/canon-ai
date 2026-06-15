<!-- canon:start -->
# Agent Quality Rules (Source of Truth)

> This is the canon. Agents read this file at session start and operate under its rules.

## Mission

Ensure all agentic contributions are correct, verifiable, and aligned with the project's architecture, conventions, validation requirements, and git hygiene.

This file is the source of truth for workflow, quality, validation, and git rules. [`CLAUDE.md`](./CLAUDE.md) adds Claude-specific context but must not override this file. If two sections overlap, the stricter rule wins.

## Agents

| Agent | Primary Role | Writes | Reviews |
|---|---|---|---|
| **Claude** | Architect, Code Reviewer, QA | Specs, plans, code reviews, QA reports | Code (Codex's output) |
| **Codex** | Implementer, Spec Reviewer | Code, handoff reports | Specs (Claude's output) |
| **Human** | Product owner, final arbiter | Product decisions, priority | Specs (when escalated), previews, test plans |

**Cross-review rule**: Each agent reviews the other's work. Claude writes specs → Codex reviews specs. Codex writes code → Claude reviews code. *No agent reviews its own output.*

**Communication norms**: Canon ships with a default tone — direct, low-padding, opinion-bearing — because it minimizes the agent failure mode of "vague politeness loses information." The defaults below are recommended, not load-bearing canon — adjust to match your project's culture if needed.

> **Default norms**: Lead with the finding, not a cushion. Drop non-load-bearing praise — "great work overall, but…" adds noise. Hedge only when uncertainty is real; omit hedging words ("might", "possibly") when it isn't. End at the last substantive sentence; no trailing pleasantries. Disagreement is signal — push back on specs and reviews you disagree with, and say why.

What *is* load-bearing canon (regardless of tone preference): agents must surface real disagreement rather than yielding to politeness, and the human must hear about risks/tradeoffs rather than getting filtered output. Tone is project taste; **honest signal is canon discipline**.

**Agent memory**: Both agents read `docs/lessons-learned.md` at session start. During the QA/done step, Claude distills `tasks/TASK-ID/notes.md` into polished entries and **appends** them to `docs/lessons-learned.md` — append-only; QA never prunes, promotes, or reorganizes the buffer. Raw notes stay in `tasks/TASK-ID/notes.md` (archived with the task dir at ship); only distilled entries reach the buffer. Promoting entries into permanent docs and pruning the buffer is a human-initiated, human-approved action, never something QA performs (see `docs/lessons-learned.md` → "How to use this doc").

**Per-task notes**: Any agent in any phase may append to `tasks/TASK-ID/notes.md` when it encounters surprising codebase behavior, ambiguous specs, implementation pitfalls, or friction worth remembering. Keep entries short (1–3 lines) with the phase name as prefix (e.g., `[spec_review] ...`). These are raw scratchpad observations — the QA step collates and distills them into `docs/lessons-learned.md`.

**Workflow observability**: Two files track pipeline health. `docs/pipeline-invocations.md` is auto-appended by canon's orchestrator after every agent invocation (duration + tokens). `docs/task-quality-log.md` is appended by Claude during the QA/done step — tracks spec review outcomes, review iterations, dropped ACs, validation gaps, and failure phases. The product owner reviews trends periodically.

## Workflow

### Pipeline Tiers

The tier is determined by the largest task size in the run. Task size is set in `status.json` when the task is created.

**Fast tier** (all tasks S, non-delicate):
```
Claude writes spec+plan → [human spec gate] → Codex implements →
Claude reviews code ↔ Codex iterates → Claude writes QA summary → Human tests
```
- Spec and plan are written in one Claude session.
- Codex spec_review is skipped; the human spec gate replaces it.
- The plan phase auto-advances (already written during spec).

**Full tier** (any task M, L, XL, or delicate):
```
Claude writes spec → Codex reviews spec → [human spec gate] → Claude writes plan →
Codex implements → Claude reviews code ↔ Codex iterates →
Claude writes QA summary → Human tests
```
- Spec and plan are written in separate Claude sessions.
- Codex runs a real spec review before the gate. Spec review starts with a **Shape Check** (is the problem real? for a bug or flake fix, is the targeted root cause *verified* or just a plausible hypothesis — see §"Diagnose Before You Fix"? is the framing right? is there a materially simpler solution? is the AC decomposition right?) before the implementability probe. Silence is the default — a real shape concern becomes the lead reason for `changes_requested`; no concern leaves the section empty and review proceeds.
- Codex model/effort scales with effective size: M gets mini at medium effort (low-cost sanity check), L gets mini at high, XL/delicate gets the full model at high effort for both spec review and implement (deliberately not xhigh — it tends to buy overthinking, not quality, with open-ended tool access).

### Full-send mode

Full-send mode is the explicit opt-in for "spec to draft PR with no human interrupts." It collapses the spec gate and the later human_review stop so canon can run from an approved spec to a draft PR without waiting for the human to babysit the pipeline.

- Conversational path: `/canon-spec full send this: <description>`
- Direct CLI path: `canon task new <id> "Title"` then `canon run --full-send <id>`
- Use it when the human wants the full pipeline plus a draft PR, and they trust the review chains end-to-end.
- If the task is delicate, `canon run --full-send` also requires `--force`. The task is still reviewed with the upgraded model; `--force` just acknowledges the high-commitment combination.
- `--reroute` clears `full_send`; only re-enable after re-reading the rerouted result.
- The mode is recorded in `status.json.full_send`, which future human-interrupt gates should honor by convention.
- Bundle semantics: full-send applies per-task. To skip the spec gate for a bundle, every task in the invocation must have `full_send: true`. A single non-full-send task in the bundle re-engages the gate for all.

**Bundle mode**: Pass multiple task IDs to `canon run`. All tasks are processed together per phase (one agent session each). The tier is determined by the most complex task — any M/L/XL/delicate pulls the entire bundle to full tier. On code review `changes_requested`, the whole bundle reroutes to implement. On code review `spec_gap`, the whole bundle blocks until the operator chooses a recovery path: amend the spec and run `canon run <ids> --reroute`, or sanction the review with `canon task accept <ids> code_review --reason "<why>"`.

**Conversational spec authorship**: Specs for emergent tasks are often written conversationally with Claude rather than through the pipeline's spec phase. Manually mark spec (and plan if written together) as done in `status.json`, then run the pipeline — it picks up from the current phase.

### File-Based Handoff Protocol

All handoffs between agents go through files in `tasks/TASK-ID/`. No copy-pasting between chat sessions.

```
tasks/
  TASK-ID/
    spec.md           # Claude writes, Codex reviews
    spec-review.md    # Codex writes (spec review findings)
    plan.md           # Claude writes (after spec approval)
    handoff.md        # Codex writes after implementing
    review.md         # Claude writes after reviewing code
    done.md           # Claude writes for human consumption
    pr-body.md        # Claude drafts the outward-facing PR body for --pr
    notes.md          # Any agent, any phase — raw observations and gotchas
    status.json       # Updated by whichever agent acts
```

Templates live in `.canon/templates/` (managed by canon — do not edit directly). To start a task, use `canon task new <TASK-ID> <title>`. To override a template for this project, copy it to `tasks/_templates/` — `canon task new` checks there first. See `.canon/README.md` for details.

**Task ID naming**: Use lowercase kebab-case (e.g., `add-login-modal`, `refactor-cache-layer`). The pipeline orchestrator validates that IDs contain only lowercase alphanumeric characters, hyphens, dots, and underscores.

**Handoff sequence**:
1. Claude creates `tasks/TASK-ID/spec.md` and sets `status.json` phase `spec` → `done`
2. Codex reads spec, writes `tasks/TASK-ID/spec-review.md` with findings, sets `spec_review` → `done` (or `changes_requested`)
3. Claude creates `tasks/TASK-ID/plan.md`, sets `plan` → `done`
4. Codex implements, creates `tasks/TASK-ID/handoff.md`, sets `implement` → `done`
5. Claude's code-review foreman spawns an anchored lens (spec/AC compliance + quality) and a cold lens (diff-only), synthesizes their findings into `tasks/TASK-ID/review.md`, and sets `code_review` → `done`
6. If changes requested: Codex iterates, updates `handoff.md`, Claude re-reviews
7. Claude creates `tasks/TASK-ID/done.md` and `tasks/TASK-ID/pr-body.md` for the human, sets `qa` → `done`
8. Human tests against `done.md` checklist, sets `human_review` → `done`

**`Fail – unrelated` result state**: When a required check fails due to a pre-existing flake or a failure outside the task's Affected Files, Codex may record `Fail – unrelated` instead of a bare `Fail`. The Notes column must contain a specific file reference (path, extension, or `file:line`) — vague explanations are rejected by the orchestrator. A `Fail – unrelated` entry whose cited file is in the task's branch diff is invalid — the pre-flight gate rejects it deterministically, and Stage 1 flags any that slip through. Claude assesses credibility in Stage 1 code review; an implausible explanation is a Stage 1 fail.

**Per-iteration artifact convention.** `handoff.md` and `review.md` are **cumulative across review rounds, not rewritten**. Round 1 fills the existing template structure. On every subsequent revision:

- **Codex appends** a new `## Iteration N — addressing review round N-1` section to `handoff.md` near the bottom (above any final checklist). Earlier iterations stay untouched as the cumulative record. Include only the delta: findings addressed, AC deltas, re-run validation outcomes.
- **Claude appends** a new `## Round N — verifying iteration N-1's response to round N-1` section to `review.md`. Re-fill the Stage 1 AC table every round: every AC from `spec.md` appears with current Met / Partial / Not Met status against the latest code. ACs whose relevant code paths did not change may be marked `Met (unchanged from round N-1)` with a one-line evidence pointer. Cross-reference prior findings to the refreshed AC table and include any NEW issues introduced by the iteration.

Round 2+ resumed-session prompts depend on this: they scope the agent to the latest section instead of re-injecting full task framing, so **appending (not rewriting) is mandatory** — a rewrite loses the cumulative record and degrades the slim prompt to a full re-prompt. (Artifact templates carry a bottom comment block showing the per-round shape.)

**Reverting a file during iteration.** `git restore` is blocked in the sandbox. For a byte-perfect revert to the task baseline, use `git show origin/<base-branch>:<path>` (read-only git, always allowed) and write the output to the file — this avoids residual diffs like trailing newlines.

- **Perfect revert** (file no longer appears in `git diff base...HEAD`): delete it from all prior iteration Changes tables in `handoff.md` and do not add it to the current one. The pre-flight check validates the aggregate union against the final diff; a net-zero file left in any Changes table is a false `handoff→diff` error.
- **Imperfect revert** (file still appears in the diff, e.g. a trailing newline remains): add it to the current iteration's Changes table with "Reverted to original (describe residual diff)". Leaving a changed file out of all Changes tables is a `diff→handoff` error.

**Rerouted and revised tasks: the pre-flight diff is cumulative.** The verifier checks the union of all Changes tables against `git diff <base>...HEAD` — every commit since task creation, including files committed by *earlier phases* (spec_review doc edits, prior implement rounds). An implementer who enumerates only this round's edits will omit those files and trip a pre-flight rejection citing paths they never touched. Before submitting a handoff on a rerouted or revised task, run `git diff <base>...HEAD --name-only` and confirm every listed path is covered by at least one Changes-table row.

**Referencing deleted (or not-yet-created) files in artifacts.** `docs-refs-check` scans `handoff.md` / `review.md` / `done.md` (but not `spec.md` / `plan.md` / `notes.md`) and flags a backtick path-ref to a file that does not exist — *including one this task deleted* — so a deleted path is **never** written in backticks in these files. The non-backtick form depends on **where** it sits:

- **`handoff.md` Changes-table first column** — `[path](path)` markdown-link **only**. That cell is also parsed by the diff↔handoff reconciler (`parseHandoffPathCell`), which accepts a backtick-path or a markdown-link but **not** bare prose; backticks are out (docs-refs-check), so the markdown-link is the only form that passes both.
- **Free prose** (`review.md`, `done.md`, handoff text outside the table) — `[path](path)` or bare prose; only backticks fail.

### Pipeline Orchestrator

`canon run <task-id>` invokes the orchestrator, which reads `status.json` to determine the current phase, spawns the correct agent CLI (Claude or Codex), and advances through phases automatically — including feedback loops when spec review or code review requests changes. Only conversational Claude invokes it.

**Mechanics live in [`docs/pipeline-orchestrator.md`](docs/pipeline-orchestrator.md)** — flags, env vars, model/effort matrix, task sizing, auto-branch/commit, phase routing, auto-block, session resumption, human reroute. That doc is on-demand reading; no agent needs it loaded by default.

Task management — used by both agents:
```bash
canon task new <TASK-ID> <title>               # Create task from templates
canon task list                                # List all tasks with current phase
canon task status <TASK-ID>                    # Show full task status
canon task phase <TASK-ID> <phase> <status>    # Update phase status
canon task accept <TASK-ID> implement          # Operator escape hatch: mark implement done + skip auto-commit on next run
canon task accept <TASK-ID...> spec_review --reason "<why>"  # Sanction a spec-review verdict with audit trail
canon task accept <TASK-ID...> code_review --reason "<why>"  # Sanction a code-review verdict with audit trail
```

### Commit Ownership

Three change categories, each with a clear owner (orchestrator auto-commit mechanics in [`docs/pipeline-orchestrator.md`](docs/pipeline-orchestrator.md) §Worktree Isolation and §Auto-Branch + Auto-Commit). The table is the summary; the facts it can't hold:

- **Code changes** commit message `<task title> [<TASK-ID>]` (after Codex static validation passes, before `code_review`).
- **Pre-implement scaffold** commit `task(<TASK-ID>): commit artifacts pre-pipeline`; if telemetry is dirty a sibling `chore: absorb pre-implement telemetry into scaffold for <TASK-ID>` follows. Skipped on `implement` re-runs (worktree already exists).
- **`--push`/`--pr` managed-docs allow-list**: any `PIPELINE_MANAGED_DOCS` entry the spec's `### Affected Files` lists — plus *every* such entry once `qa.status === 'done'` (QA's Docs Freshness can fix stale refs the author didn't predict). Artifacts return to base via `--ship`'s squash-merge.
- **Changelog + version bump** *(projects that version)*: a separate human + Claude release step after human_review, not pipeline-automated — see Release Rules.

| When | What | Who |
|---|---|---|
| Before first `implement` phase | Task scaffold (`tasks/<id>/` + dirty telemetry) → base branch | Orchestrator (auto) |
| After implement passes static validation | Code changes → task branch | Orchestrator (auto) |
| At `--push` / `--pr` (human_review) | Final task artifacts + telemetry + managed docs → task branch | Orchestrator (auto) |
| At `--ship` | Squash-merge task branch → base | Orchestrator (auto, via `gh pr merge`) |
| Before PR / merge | Changelog + version bump (per project policy; skip if unversioned) | Human + Claude |

### Spec Lifecycle

- Working specs live in `tasks/TASK-ID/spec.md` during development.
- Do not commit working or draft specs to `docs/`.
- Only finalized, durable product docs may be committed to `docs/`.
- After a task is complete and merged, archive task artifacts to `tasks/_archive/<TASK-ID>/`.

### Docs Freshness

These docs are "institutional memory." If they drift, agents start with stale assumptions and make bad decisions. They **must stay current**, but each phase decides what to actually load — see `CLAUDE.md` for phase-specific reading lists.

**Protected docs** (must stay current; not all read every session):
- `docs/architecture.md` — system overview, tech stack, state model
- `docs/codebase-map.md` — file locations, feature wiring maps
- `docs/decisions.md` — settled architectural decisions
- `docs/patterns.md` — implementation patterns and known pitfalls
- `docs/product-context.md` — user flows, terminology, business rules

**Two-checkpoint system**:

1. **Spec phase (Claude)**: When writing a spec, include a "Docs Impact" note listing any protected docs that might need updating if the task ships. This is a heads-up, not a change — the actual updates happen later.

2. **QA phase (Claude)**: Before writing `done.md`, scan the protected docs for anything contradicted by the task's changes. Update stale references. Common drift: codebase-map file listings, patterns/pitfalls that no longer apply, product-context terminology changes.

**Rule**: If a task changes how a feature works (not just a bug fix), at least one protected doc is probably stale. Check.

### Code is Canonical; Docs Reference Symbols

The code is the source of truth for anything derivable from code: numbers, thresholds, file locations, function signatures, type shapes, observable behavior. Docs that restate these facts inline rot silently — and stale duplicates produce wrong specs, wrong implementations, and wrong reviews. The cost of a stale fact is unbounded; the cost of a pointer is bounded.

**Rule**: If a fact is derivable from code, the doc references the symbol or path; it does not restate the value.

- ✗ "The retry timeout is 5000ms."
  ↳ The `5000` will drift the moment the constant changes.
- ✓ "The docs gate is `VALID_DIRS` in `scripts/docs-refs-check.mjs`."
  ↳ The invariant stays in the doc. The value is delegated to the symbol.

**When docs ARE the source of truth** (state directly):
- Intent and decisions (`docs/decisions.md`) — code shows *what*, not *why*.
- Cross-cutting invariants — "all premium features gate through `Entitlements`" is a rule across many files.
- Workflow/process — `AGENTS.md`, `CLAUDE.md`, `docs/pipeline-orchestrator.md`.
- History — `docs/lessons-learned.md`.
- Product behavior + terminology — `docs/product-context.md`.

## Roles (Summary)

See `CLAUDE.md` for full Claude guidance (spec authorship, code review, QA). Codex guidance (implementation, handoff format, spec review) lives in `AGENTS.md` and the orchestrator's injected prompt. Per-agent roles and the *no agent reviews its own output* rule are in §Agents above.

If Claude and Codex disagree on approach, escalate to the human with a clear summary of each side's rationale.

### Code Review Responsibilities

The pipeline-spawned `code_review` Claude session is a **synthesis foreman**: it spawns two isolated lenses — an **anchored** lens (Stage 1 AC-compliance gate + Stage 2 quality + test-integrity, using spec/handoff/diff) and a **cold** lens (diff only, no spec/canon context) — then deduplicates, drops cold findings the spec shows are intended, classifies survivors `code-bug` or `spec-gap`, writes the single `review.md`, and sets one verdict. `changes_requested` routes back to Codex. `spec_gap` means the code can't fix it (spec missing/wrong) → phase blocked with an escalation; the operator chooses **fix** (add `## Amendment`, `canon run <ids> --reroute` → full-tier re-enters `spec_review` + `plan`) or **bless** (`canon task accept <ids> code_review --reason "<why>"` → records `sanctioned` + appends an audit line to `notes.md`).

## Human Escalation Contract

### Escalate (stop and ask) when:
- UX ambiguity or underspecified user-facing behavior
- Product tradeoffs (feature scope, priority, sequencing)
- Auth, billing, or payment flow changes
- Privacy or data handling changes
- Schema migrations or data model changes that affect persistence
- Analytics event changes (new events, renamed sources)
- Destructive operations (data deletion, account changes)
- Any change the human would want to know about before it ships

### Continue automatically when:
- Contained refactors within existing patterns
- Test fixes or test coverage additions
- Documentation updates
- Task artifact updates (specs, reviews, handoffs, status changes)
- Scoped feature implementation against an approved spec
- Bug fixes with clear reproduction and obvious correct behavior
- Dependency updates (patch level)

### Notify (don't block, but inform) when:
- Ready for human behavioral testing — provide `done.md` with test plan
- A decision was made during implementation that the human should know about
- A risk item was identified but addressed with a guardrail

## Quick Start: Most Missed Rules

- Do not commit working or draft feature specs to `docs/`.
- Final validation must reflect the final code state, not an earlier intermediate revision.
- Before every commit, inspect the staged set so unrelated files are not swept in.
- Push only when the user asked for it.
- If you use an external package API in changed code, treat it as an external API touch and provide citations (when external API tracking is wired in this project).
- For data-affecting behavior, ship the safer guarded version first.
## Implementation Rules

**Project-specific implementation rules live in [`docs/patterns.md`](docs/patterns.md).** Patterns + Known Pitfalls describe how state, styling, testing, performance, gating, assets, analytics, and any other project-specific concerns are handled. Agents read that file at session start; the orchestrator pre-injects task-relevant pitfalls into Codex's implement prompt.

The rules below are canon-supplied universals — they apply to every project canon is dropped into.

### Safe-First Rules

> Always applicable, regardless of stack.
>
> 1. For storage, reload, sync, or data-affecting flows: ship the safer guarded behavior first.
> 2. Behavior that reloads the app, replaces local state, or dismisses user work must be gated by explicit user action.
> 3. Prefer shared types over duplicating signatures.

### Scope Discipline

> Always applicable to the implementer. The spec is the contract.
>
> 1. **Affected Files is the scope cap.** If satisfying an AC genuinely requires editing files outside the spec's *Affected Files* table, stop, document the gap in `handoff.md` under *Blockers*, and surface it for human attention. Do not silently expand scope.
> 2. **No unauthorized new abstractions.** Do not introduce new top-level modules, services, packages, or routing layers that the spec did not authorize. Minor refactors *within* an authorized file are fine; new abstractions are an architecture decision and belong in the spec, not in the implementation.
> 3. **No incidental dependency changes.** Do not add, remove, upgrade, or downgrade dependencies (or their pinned versions) unless the spec explicitly requests it. A version change buried in a feature implementation is a separate decision masquerading as a side effect.

### Lint & Type Safety Policy

> Always applicable. Suppressing a lint or type error is a last resort, not a convenience escape hatch.
>
> 1. **Lint suppression comments**: Never add a suppression without a same-line justification explaining *why the rule is wrong for this specific case*. If you can't write that justification, the rule is right and the code needs to change.
> 2. **`any` / dynamic typing**: `any` propagates silently — once it enters a call chain, every downstream consumer loses type safety. When the shape is truly unknown at the boundary (network responses, JSON parsing, third-party callbacks), type as `unknown` and narrow explicitly.

### Diagnose Before You Fix

> Always applicable when authoring, reviewing, or implementing a fix for an intermittent, flaky, or hard-to-reproduce failure.
>
> A failure *snapshot* — a CI log, one stack trace, a screenshot of a stuck UI — is usually consistent with several mechanisms. A fix built on the first plausible story can be real-but-irrelevant: it closes a bug that isn't the one you're seeing, the true cause ships untouched, and the symptom returns later. Before a fix is specced, approved, or implemented:
>
> 1. **Falsify the hypothesis on paper first.** Reason about whether the proposed mechanism can actually produce the observed symptom. A timing, latency, or ordering argument often kills a plausible story before a line of code is written.
> 2. **Reproduce the mechanism deterministically.** Fault injection, a forced race, or a targeted repro — so the failure has been observed happening *for the reason being claimed*, not merely "it stopped happening after the change."
> 3. **Each role owns a checkpoint.** The spec author states the *verified* mechanism (not a guess) in *Problem*. The spec reviewer (Codex) challenges the premise — does the proposed fix address a confirmed root cause, or an unconfirmed hypothesis? An unverified mechanism is a Shape Check concern. The implementer reproduces before fixing and reports the repro in the handoff.

### Parsing Structured Input

> Always applicable when implementing a parser for author-facing structured input — table cells, headed sections, delimited fields.
>
> Parse cell-by-cell with explicit rejection, not a permissive whole-string regex. When a field has a defined per-cell shape (e.g., a table column expecting exactly one backtick-quoted path), a permissive regex over the whole cell silently extracts the *first* match and discards the rest — the parse "succeeds" but a later step fails with a cryptic error that hides the real contract violation. Anchor each cell to exactly one expected shape and reject malformed cells with a specific reason *at the parse boundary*. "Silently drop data" is far worse than "loud rejection at parse time." (Companion to the Lint & Type Safety rule: type genuinely-unknown input as `unknown` and narrow/validate explicitly rather than trusting a permissive shape.)

## Validation Matrix

The matrix below is the canon-supplied **structural** matrix — it tells agents which *categories* of check apply to which *categories* of change. The structure is universal and ships with canon.

| Change Type | Required Check Categories |
|---|---|
| Most changes | Linting, type checking, unit tests |
| Docs references | Docs references |
| Routes / config / build | Full build |
| UI / interaction changes | End-to-end tests |
| Content / SEO / metadata | Prerender / sitemap / feed regeneration |
| Schema / migration | Migration runner + manual review |
| Cross-platform | Subset of the above on each platform |

**Project-specific command bindings** — what command actually runs for "linting," "type checking," etc. — live in [`docs/architecture.md`](docs/architecture.md) under the "Validation" section. Categories with no project-specific binding (e.g., end-to-end tests on a project with no UI) are marked N/A there.

Validation status in handoff must reflect the final code state — not an earlier intermediate revision.

## Git and PR Workflow

### Branch Sync
1. `git fetch origin && git pull --rebase origin <branch>` before starting work.
2. Resolve divergence early.

### CI
1. GitHub PR checks run on the merge result with the target branch.
2. If `origin/<base>` is ahead, sync and rerun local validation before PR handoff.
3. If `<base>` moves during review, resync and rerun validation.

### Serialized Git State Changes
1. Never run dependent state-changing git commands in parallel.
2. Commit/push flow: inspect staged → commit → verify branch → push.
3. Before every commit: `git status --short` and/or `git diff --cached --stat`.
4. Do not push unless the user asked for it.

## Release Rules

> Canon enforces *workflow* discipline around releases (who proposes, who approves, when commits land). It does NOT enforce a specific versioning scheme or changelog scope — those are project-defined. Edit the project-policy block below to match your conventions; canon's general rules are non-negotiable.

### Project policy

**Project-specific versioning and release policy lives in [`docs/decisions.md`](docs/decisions.md)** as a dedicated decision entry. That file defines: SemVer interpretation (what counts as patch/minor/major for *this* project), agent authorization (which tiers agents may bump without human approval), and changelog audience/scope (user-facing, internal, separate files, or none).

Adopters fill `docs/decisions.md` with a "Versioning and release policy" entry as part of bootstrap. Canon's general rules below remain non-negotiable regardless of project policy.

### Canon's general rules (non-negotiable)

1. **Agents do not bump versions or land changelog edits without explicit scope authorization.** The project-policy block defines what's pre-authorized; everything else is propose-only.
2. **The QA step proposes a draft changelog *entry* in `done.md`** — the entry text only. QA does **not** propose, choose, or re-litigate the version number or bump tier: versioning is governed by project policy, and where a project accumulates work on a versioned release branch the version is already pinned by that branch. The human reviews and finalizes the copy, then Claude applies the changelog update + version bump per project policy before PR/merge. Agents do not auto-finalize changelog copy — phrasing is a human decision.
3. **Changelog + version bump are committed separately from code changes** *(when a project versions its releases)* — isolation intent: keeps version-bump commits cherry-pickable / revertable in isolation. Projects that do not do versioned releases skip this step per their project policy.
4. **No major versioning surprises.** If a task introduces a breaking change that the spec didn't flag, raise it during QA before shipping — do not silently assume the change is acceptable.

## Handoff Validation (Before Merge)

- [ ] Version correct (per project policy; skip if the project doesn't version)
- [ ] Changelog updated if needed (per project policy; skip if the project doesn't version)
- [ ] PR body current
- [ ] Final CI/CD checks green
- [ ] Final diff matches spec intent

## Output Format for Human

When a task cycle completes, the human sees `tasks/TASK-ID/done.md` containing:
1. One-paragraph plain-English summary
2. Files changed
3. How to test (product-level steps, not code)
4. Test results table
5. Decisions made during implementation
6. Open questions needing human input
<!-- canon:end -->

<!-- Your project additions below — `canon upgrade` will not touch this section -->
