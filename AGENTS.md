# Agent Quality Rules (Source of Truth)

> This is the canon. Agents read this file at session start and operate under its rules.

## Mission

Ensure all agentic contributions are correct, verifiable, and aligned with the project's architecture, conventions, validation requirements, and git hygiene.

This file is the source of truth for workflow, quality, validation, and git rules. [`CLAUDE.md`](./CLAUDE.md) and [`CODEX.md`](./CODEX.md) add agent-specific context but must not override this file. If two sections overlap, the stricter rule wins.

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

**Agent memory**: Both agents read `docs/lessons-learned.md` at session start. During the QA/done step, Claude distills `tasks/TASK-ID/notes.md` into polished entries in `docs/lessons-learned.md`. Raw notes are discarded after distillation.

**Per-task notes**: Any agent in any phase may append to `tasks/TASK-ID/notes.md` when it encounters surprising codebase behavior, ambiguous specs, implementation pitfalls, or friction worth remembering. Keep entries short (1–3 lines) with the phase name as prefix (e.g., `[spec_review] ...`). These are raw scratchpad observations — the QA step collates and distills them into `docs/lessons-learned.md`.

**Workflow observability**: Two files track pipeline health. `docs/pipeline-invocations.md` is auto-appended by `scripts/run-task.ts` after every agent invocation (duration + tokens). `docs/task-quality-log.md` is appended by Claude during the QA/done step — tracks spec review outcomes, review iterations, dropped ACs, validation gaps, and failure phases. The product owner reviews trends periodically.

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
Codex implements → Claude reviews code ↔ Codex iterates → Claude writes QA summary → Human tests
```
- Spec and plan are written in separate Claude sessions.
- Codex runs a real spec review before the gate. Spec review starts with a **Shape Check** (is the problem real? is the framing right? is there a materially simpler solution? is the AC decomposition right?) before the implementability probe. Silence is the default — a real shape concern becomes the lead reason for `changes_requested`; no concern leaves the section empty and review proceeds.
- Codex model/effort scales with effective size: M gets mini at medium effort (low-cost sanity check), L gets mini at high, XL/delicate gets the full model at high (spec review) or xhigh (implement).

**Bundle mode**: Pass multiple task IDs to `run-task.ts`. All tasks are processed together per phase (one agent session each). The tier is determined by the most complex task — any M/L/XL/delicate pulls the entire bundle to full tier. On code review changes_requested, the whole bundle reroutes to implement.

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
    notes.md          # Any agent, any phase — raw observations and gotchas
    status.json       # Updated by whichever agent acts
```

Templates live in `tasks/_templates/`. To start a task, use `./scripts/task.sh new <TASK-ID> <title>`.

**Task ID naming**: Use lowercase kebab-case (e.g., `add-login-modal`, `refactor-cache-layer`). The pipeline orchestrator validates that IDs contain only lowercase alphanumeric characters, hyphens, dots, and underscores.

**Handoff sequence**:
1. Claude creates `tasks/TASK-ID/spec.md` and sets `status.json` phase `spec` → `done`
2. Codex reads spec, writes `tasks/TASK-ID/spec-review.md` with findings, sets `spec_review` → `done` (or `changes_requested`)
3. Claude creates `tasks/TASK-ID/plan.md`, sets `plan` → `done`
4. Codex implements, creates `tasks/TASK-ID/handoff.md`, sets `implement` → `done`
5. Claude reads handoff + diff, creates `tasks/TASK-ID/review.md`, sets `code_review` → `done`
6. If changes requested: Codex iterates, updates `handoff.md`, Claude re-reviews
7. Claude creates `tasks/TASK-ID/done.md` for the human, sets `qa` → `done`
8. Human tests against `done.md` checklist, sets `human_review` → `done`

### Pipeline Orchestrator

`scripts/run-task.ts` automates the standard pipeline. It reads `status.json` to determine the current phase, spawns the correct agent CLI (Claude or Codex), and advances through phases automatically — including feedback loops when spec review or code review requests changes. Only conversational Claude invokes it.

**Mechanics live in [`docs/pipeline-orchestrator.md`](docs/pipeline-orchestrator.md)** — flags, env vars, model/effort matrix, task sizing, auto-branch/commit, phase routing, auto-block, session resumption, human reroute. That doc is on-demand reading; no agent needs it loaded by default.

Task management helper (requires `jq`) — used by both agents:
```bash
./scripts/task.sh new <TASK-ID> <title>               # Create task from templates
./scripts/task.sh list                                 # List all tasks with current phase
./scripts/task.sh status <TASK-ID>                     # Show full task status
./scripts/task.sh phase <TASK-ID> <phase> <status>     # Update phase status
```

### Commit Ownership

The pipeline produces three categories of changes. Each has a clear owner:

1. **Code changes**: Codex writes the files during implement. The orchestrator commits them after implement passes validation, before handing off to code_review. Commit message: `<task title> [<TASK-ID>]`.

2. **Task artifacts** (`tasks/TASK-ID/`): Committed once at the end, after human_review approves. A single commit bundles spec, plan, reviews, handoff, done, and notes. Commit message: `chore: add task artifacts for <TASK-ID>`.

3. **Changelog + version bump**: A separate release step after human_review, done collaboratively by the human and Claude. Not automated by the pipeline. See Release Rules below.

**Who commits when** (summary):

| When | What | Who |
|---|---|---|
| After implement passes validation | Code changes | Orchestrator (auto) |
| After human_review approves | Task artifacts | Orchestrator or human |
| Before PR / merge | Changelog + version bump | Human + Claude |

### Spec Lifecycle

- Working specs live in `tasks/TASK-ID/spec.md` during development.
- Do not commit working or draft specs to `docs/`.
- Only finalized, durable product docs may be committed to `docs/`.
- After a task is complete and merged, archive task artifacts to `tasks/_archive/<TASK-ID>/`.

### Docs Freshness

These docs are "institutional memory." If they drift, agents start with stale assumptions and make bad decisions. They **must stay current**, but each phase decides what to actually load — see `CLAUDE.md` and `CODEX.md` for phase-specific reading lists.

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
- ✓ "The retry timeout is `RETRY_TIMEOUT_MS` in `src/network/retry.ts`."
  ↳ The invariant stays in the doc. The value is delegated to the symbol.

**When docs ARE the source of truth** (state directly):
- Intent and decisions (`docs/decisions.md`) — code shows *what*, not *why*.
- Cross-cutting invariants — "all premium features gate through `Entitlements`" is a rule across many files.
- Workflow/process — `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `docs/pipeline-orchestrator.md`.
- History — `docs/lessons-learned.md`.
- Product behavior + terminology — `docs/product-context.md`.

## Roles (Summary)

See `CLAUDE.md` for full Claude guidance (spec authorship, code review rules, QA format). See `CODEX.md` for full Codex guidance (implementation rules, handoff format, spec review approach).

**Claude**: Writes specs and plans, reviews code, writes QA summaries. Does not review its own specs.
**Codex**: Reviews Claude's specs (full tier), implements, writes handoffs. Does not review its own code.
**Human**: Product decisions, priority, final behavioral testing.

If Claude and Codex disagree on approach, escalate to the human with a clear summary of each side's rationale.

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

The rules below are canon-supplied universals — they apply to every project canon-ai is dropped into.

### Safe-First Rules

> Always applicable, regardless of stack.
>
> 1. For storage, reload, sync, or data-affecting flows: ship the safer guarded behavior first.
> 2. Behavior that reloads the app, replaces local state, or dismisses user work must be gated by explicit user action.
> 3. Prefer shared types over duplicating signatures.

### Lint & Type Safety Policy

> Always applicable. Suppressing a lint or type error is a last resort, not a convenience escape hatch.
>
> 1. **Lint suppression comments**: Never add a suppression without a same-line justification explaining *why the rule is wrong for this specific case*. If you can't write that justification, the rule is right and the code needs to change.
> 2. **`any` / dynamic typing**: `any` propagates silently — once it enters a call chain, every downstream consumer loses type safety. When the shape is truly unknown at the boundary (network responses, JSON parsing, third-party callbacks), type as `unknown` and narrow explicitly.

## Validation Matrix

The matrix below is the canon-supplied **structural** matrix — it tells agents which *categories* of check apply to which *categories* of change. The structure is universal and ships with canon.

| Change Type | Required Check Categories |
|---|---|
| Most changes | Linting, type checking, unit tests |
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
2. **The QA step proposes a draft changelog entry in `done.md`**. The human reviews and finalizes the copy, then Claude applies the changelog update + version bump before PR/merge. Agents do not auto-finalize changelog copy — phrasing is a human decision.
3. **Changelog + version bump are committed separately from code changes** — they are the last commit on the branch. Keeps version-bump commits cherry-pickable / revertable in isolation.
4. **No major versioning surprises.** If a task introduces a breaking change that the spec didn't flag, raise it during QA before shipping — do not silently assume the change is acceptable.

## Handoff Validation (Before Merge)

- [ ] Version correct
- [ ] Changelog updated if needed
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
