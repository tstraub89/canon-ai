# Pipeline Orchestrator — Reference

Reference for driving canon's pipeline: CLI surface, flags, task-management subcommands, pipeline tiers, the model/effort matrix, environment variables, worktree mechanics, session resumption, auto-block thresholds, and recovery patterns. Read on demand when you need to know which flag to use, why canon picked a particular model, or how to recover from a stuck phase.

For **command patterns and snag-recovery flows**, see the `/canon-pipeline` skill at `.claude/skills/canon-pipeline/SKILL.md` (installed by `canon init`). For **adversarial pre-pipeline spec review** on M/L/XL or delicate tasks, see `/canon-review`.

`AGENTS.md` is the source of truth for *roles, escalation, implementation rules, validation, git, and release*. This file is the source of truth for *how to operate the pipeline*.

## Operator

The operator is the session a human drives canon from — writes specs conversationally for fast-tier tasks, invokes `canon run`, monitors pipeline progress, decides next moves.

Canon is designed for **Claude Code (or a human shell) as operator**. Pipeline-phase agents (Claude and Codex sessions spawned by the orchestrator for `spec_review` / `plan` / `implement` / `code_review` / `qa`) are independent sessions and never invoke the pipeline themselves.

Codex can technically operate canon — it has shell access to run `canon run` — but canon was not designed for this. Codex CLI's session model is optimized for execution tasks, not the extended coordination across phases that operating canon requires. Using Codex as operator also pushes Codex toward conversational tasks (spec drafting, multi-turn discussion with the human) that canon assigns to Claude; once that line blurs, cross-model independence erodes operationally even if it survives technically. The likely outcome is worse, not better, output.

If you find yourself wanting Codex as operator, use Claude Code instead and lean on Codex for the phases canon assigns to it (spec review, implementation, code review). That's canon's intended division of labor.

## Invocation surface

```bash
canon run <task-id> [<task-id> ...]
```

Multiple IDs = bundle mode (see below).

### Flags

| Flag | Alias | Effect |
|---|---|---|
| `--step` | `-1` | Run **one phase** then stop. |
| `--expect <phase>` | — | Assert the current phase matches before running — fails fast on phase mismatch. Combine with `--step` for safety. |
| `--interactive` | `-I` | Open interactive agent sessions instead of non-interactive. |
| `--push` | — | Push the task branch to remote at `human_review`. |
| `--pr` | — | Push + create a draft PR at `human_review`. |
| `--reroute` | — | Reset a task from `human_review` back to `implement` (post-review fix path). |
| `--ship` | — | Squash-merge any open PR for the task branch (via `gh pr merge --squash --delete-branch`), pull the base, tear down the worktree, archive `tasks/<id>/` to `_archive/`, and clean up local branches. If the PR was already merged externally, picks up at the cleanup step. |
| `--dry-run` | — | Print the planned phases, agents, model, and effort without spawning an LLM. |

**Default is full auto** — without `--step`, the pipeline runs all phases to completion (or to the next human gate).

## Task management (`canon task`)

`canon task` is the lightweight lifecycle CLI that manages task directories, `status.json`, and release branches. **No AI is spawned**; it is pure filesystem and git operations. Always prefer `canon task` helpers over hand-editing `status.json` directly — the helpers re-derive the top-level `status` pointer and keep state consistent.

```bash
canon task <subcommand> [args]
```

### Subcommands

| Subcommand | Args | What it does |
|---|---|---|
| `new` | `<id> "Title" [--base <branch>]` | Scaffold `tasks/<id>/` from `.canon/templates/`. Stamps provenance in `status.json`. Auto-detects `base_branch` from current git checkout; use `--base` to override. |
| `list` | — | Print all tasks and their current pipeline phase. |
| `status` | `<id>` | Print full `status.json` detail for a task. |
| `phase` | `<id> <phase> <status> [verdict]` | Update a task phase and re-derive the top-level `status` pointer. Phases: `spec spec_review plan implement code_review qa human_review`. Status: `pending in_progress done changes_requested blocked`. |
| `accept` | `<id...> <phase> [--force]` | Operator escape hatch for the case where work has been manually committed outside the pipeline and `canon run` keeps re-running auto-commit against the already-landed commit. Marks the phase done AND sets `phases.<phase>.operator_accepted: true` so the post-phase dispatch (auto-commit for implement) is skipped on subsequent runs. Today only `implement` is supported. Accepts multiple task IDs for bundle mode — the handoff coverage check unions every task's handoff against one `baseRef..HEAD` diff, so siblings don't cross-reject. All tasks must share `base_branch` and working tree. Guards: prior phases complete, clean source tree, reachable `base_branch`, non-empty `baseRef..HEAD`, no malformed handoff Changes rows, and handoff coverage matches the diff. `--force` bypasses the accept-time guards, but downstream code_review preflight may still reject malformed or mismatched handoffs. |
| `reset-spec-review` | `<id>` | Clear router-relevant state for a fresh spec-review pass after an auto-block. Zeroes iterations, clears verdict, archives the prior `spec-review.md`. |
| `post-merge-sync` | `[<branch>]` | After a squash-merge PR, reconcile local branch with origin. Hard-resets if the only divergence is pipeline telemetry; refuses if real new work exists. |
| `release-init` | `<version>` | Initialize a `release/v<MAJ.MIN>` branch off main with the version bumped and an empty CHANGELOG block. |

### Common patterns

```bash
# Create a new task (auto-detects base branch)
canon task new feat-search "Add search to sidebar"

# Create a task targeting a release branch
canon task new feat-x "X feature" --base release/v1.6

# Check what's in flight
canon task list

# Advance a phase manually (after conversational spec approval)
canon task phase feat-search spec done
canon task phase feat-search spec_review done approved
canon task phase feat-search plan done

# After a squash-merge PR lands
canon task post-merge-sync

# Initialize a release branch
canon task release-init 1.6.0
```

## Pipeline Tiers

The tier is set by the largest task in the run. Task size is set in `status.json` at task creation.

**Fast tier** (all tasks S, non-delicate):
```
Claude writes spec+plan → [human spec gate] → Codex implements →
Claude reviews code ↔ Codex iterates → Claude writes QA summary → Human tests
```

- Spec and plan are written in one Claude session.
- Codex `spec_review` is skipped; the human spec gate replaces it.
- The plan phase auto-advances (already written during spec).

**Full tier** (any task M, L, XL, or `delicate`):
```
Claude writes spec → Codex reviews spec → [human spec gate] → Claude writes plan →
Codex implements → Claude reviews code ↔ Codex iterates →
Claude writes QA summary → Human tests
```

- Spec and plan are written in separate Claude sessions.
- Codex runs a real spec review before the gate. Spec review starts with a **Shape Check** (is the problem real? is the framing right? is there a materially simpler solution? is the AC decomposition right?) before the implementability probe.
- Codex model/effort scales with effective size (matrix below).
- **Optional pre-pipeline self-review**: before invoking `canon run`, the operator can run `/canon-review <task-id>` to dispatch three parallel sub-agents (structural / factual / spec-quality) at the spec and surface BLOCKING / STRONG / NIT findings inline. Catches the class of issues Codex's spec_review would surface across 2-3 iterations in one ~15-min pass. Opt-in; most valuable when iteration cost is real.

**Where validation happens**: Project-specific checks (lint, type-check, unit tests, e2e, etc.) run inside agent phases — Codex runs them during `implement` and records outcomes in the handoff; Claude verifies the outcomes table in Stage 1 code review and re-runs selectively when anything looks off. There is no separate orchestrator-run validation phase.

**Bundle mode**: Pass multiple task IDs to `canon run`. All tasks process together per phase (one agent session each). Tier is set by the most complex task — any M/L/XL/delicate pulls the whole bundle to full tier. On code-review `changes_requested`, the entire bundle reroutes to implement.

**One pipeline at a time**: Run only one task or bundle through `canon run` at a time. A second concurrent invocation would share the working tree and corrupt both branches. Worktree mode (see below) is the exception: each task gets its own sibling directory, so concurrent runs are possible if each task has `worktree: true`.

## Task Sizing Fields

Set in `status.json` at task creation:

| Field | Values | Purpose |
|---|---|---|
| `task_size` | `S \| M \| L \| XL` | Drives Codex model + effort selection and the pipeline tier. S is fast-tier; M+ runs the full pipeline (including Codex spec review). |
| `delicate` | `true \| false` | Forces the XL bucket (full Codex model, xhigh implement effort) regardless of nominal size. Set when an undetected bug has materially harder-to-recover blast radius than a normal bug — common examples: auth, payments, premium gating, persistent storage migrations, security-sensitive cryptography. Project-specific surfaces also qualify (medical PHI, scientific reproducibility, regulated data). The bar is *blast radius*, not difficulty. |
| `human_spec_gate` | `true \| false` | Pauses the pipeline after `spec_review` for human review before planning (default: `true`). |
| `worktree` | `true \| false` | Opt-in worktree isolation (default: absent/false). See Worktree Isolation below. |
| `base_branch` | string (default `"main"`) | Branch the task branches off and PRs against. Auto-set by `canon task new` from the current git checkout at task creation. |

### Task sizing guide

> Sizing ranges below are **starting heuristics**. File-count thresholds are project-dependent — a Python data project, a React app, and a Rust system tool all calibrate differently. Recalibrate after ~10 tasks if your S-tasks are routinely too small or your L-tasks too large for the loop caps to make sense.

| Size | Files touched (heuristic) | Scope |
|---|---|---|
| S | 1–3 | Single behavior, no cross-context mutations, no sensitive surfaces |
| M | 4–7 | May touch one context, clear interaction model |
| L | 8+ | Multiple contexts, new subsystem, or touches a sensitive surface |
| XL | — | Milestone-scale, staged implementation, multiple L-scope changes |

### Recommended default for the `delicate` flag

Canon's recommended starting policy for when to scope a task as `delicate: true`: *require evidence of real production impact, not theoretical correctness.*

A `delicate` task carries meaningful regression risk on a security-sensitive surface and runs at the most expensive model+effort tier. "It's technically wrong" is not sufficient justification on its own — a hardening pass on auth/payments/storage that no user has ever hit can take significant pipeline time, introduce regression risk, and produce zero customer-visible value. Before scoping any task as `delicate: true`, require at least one confirmed production incident or a concrete upcoming flow that depends on the fix. Note the incident in the spec's *Problem* section.

This is a default — your project can adopt a stricter or looser bar in `docs/decisions.md` if it has different risk tolerance (e.g., a medical-data project with regulatory exposure may want proactive hardening).

## Codex Model/Effort Matrix

Codex model and effort scale with task size:

| Phase | S | M | L | XL / delicate |
|---|---|---|---|---|
| `spec_review` | — (skipped) | mini / medium | mini / high | full / high |
| `implement`   | mini / medium | mini / high | mini / high | full / xhigh |

Codex is tuned for token efficiency — the mini model handles most phases; the full model only comes out for XL or delicate work.

## Environment Variables

Claude is tuned for correctness — Opus on phases where false negatives cascade, Sonnet on structured/templated phases.

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_MODEL_SPEC` | `opus` | Spec phase (foundational; cascades into every downstream phase). |
| `CLAUDE_MODEL_PLAN` | `sonnet` | Plan phase (structured translation of spec → steps). |
| `CLAUDE_MODEL_REVIEW` | `sonnet` | Code review for S/M (checklist-shaped AC verification). |
| `CLAUDE_MODEL_REVIEW_LARGE` | `opus` | Code review for L/XL/delicate (lifecycle/state-machine reasoning where Sonnet was missing bugs Codex caught post-PR). |
| `CLAUDE_MODEL_QA` | `sonnet` | QA phase. |
| `CLAUDE_BUDGET` | `5.00` | Max spend per Claude phase (USD). |
| `CANON_PROJECT_NAME` | _(reads `package.json` "name" or "your project")_ | Name injected into agent prompts. |

Codex model overrides:

| Variable | Default | Purpose |
|---|---|---|
| `CODEX_MODEL_MINI` | `gpt-5.4-mini` | Codex model for S/M/L non-delicate phases. |
| `CODEX_MODEL_FULL` | `gpt-5.5` | Codex model for XL or delicate phases. |
| `MAX_REVIEW_LOOPS` | _size-aware_ | Max `spec_review` and `code_review` iterations before auto-block. Unset → 3 for S/M, 5 for L/XL. |

These are canon's shipped defaults at the time of release and may lag
behind what your local `codex` CLI accepts. **Verify they resolve on your
install before relying on the pipeline** — a stale identifier produces a
hard failure on the first phase that needs Codex. If they don't resolve,
set `CODEX_MODEL_MINI` and `CODEX_MODEL_FULL` explicitly to identifiers
your CLI exposes rather than changing the orchestrator contract.

## Worktree Isolation

Set `"worktree": true` in `status.json` to run Codex's implement, code_review, and qa phases in a git worktree sibling directory rather than the main repo. This keeps spec files, plan drafts, and other in-flight task artifacts out of the main working tree.

**Layout**: `../dev-worktrees/<task-id>/` (sibling of the repo root, not a subdirectory).

**Main repo stays on its base**: In worktree mode, the orchestrator creates the `task/<id>` branch directly in the worktree. The main repo never checks out the task branch.

**Task-state source of truth**: From implement onward, the worktree is canonical for task artifacts (`tasks/<id>/`) and per-task telemetry rows. The main repo keeps the pre-implement scaffold; runtime task-state reads resolve to the worktree when it exists.

**Project-level resources**: REPO_ROOT remains canonical for managed docs, `scripts/`, `src/`, root agent files, and other project-level files. Their cross-worktree coordination is separate from task-state resolution.

**Teardown**: `--ship` calls `git worktree remove --force` after archiving the task directory.

**Bundle constraint**: All tasks in a bundle must agree on `worktree`.

## Canon Snapshot Stamping

Every task carries a provenance snapshot in `status.json.canon`. `canon task new` stamps it when the task is created, and the orchestrator refreshes it again before any real phase work begins so older tasks pick up the current canon checkout and CLI versions on the next pipeline run.

- Native checkouts record the canon checkout SHA in both `upstream_commit` and `orchestrator_commit`.
- Vendored checkouts record the submodule SHA in `upstream_commit` and the host repo SHA in `orchestrator_commit`.
- Missing `codex` or `claude` binaries record `<unavailable>` instead of failing the run.
- `--dry-run` is read-only and does not refresh the snapshot.

## Auto-Branch + Auto-Commit

**Auto-branch**: The orchestrator creates a `task/<TASK-ID>` branch before the implement phase and records it in `status.json`.

**Auto-commit**: After implement passes validation, the orchestrator auto-commits source files listed in `handoff.md`'s Changes table — including `### Changes` tables in `## Iteration N` sections (files introduced in later review rounds are valid). If any non-task source files remain dirty after staging, the commit is aborted and the pipeline stops for manual intervention. `handoff.md` must list every changed file including both sides of renames. Specs with a missing or empty `## Validation Required` section are rejected at this gate — handoff validation cannot be bypassed by omitting the section.

At `human_review` with `--push` or `--pr`, the orchestrator auto-commits a scoped allow-list before pushing:

- **`tasks/<id>/`** — task artifacts (spec, plan, handoff, review, done, notes).
- **`PIPELINE_TELEMETRY_FILES`** (`docs/lessons-learned.md`, `docs/task-quality-log.md`, `docs/pipeline-invocations.md`) — always auto-committed.
- **`PIPELINE_MANAGED_DOCS` ∩ spec's `### Affected Files`** — a managed doc (`docs/architecture.md`, `docs/codebase-map.md`, `docs/decisions.md`, `docs/patterns.md`, `docs/pipeline-orchestrator.md`, `docs/product-context.md`) is auto-committed only if the task's `spec.md` `### Affected Files` table lists it. Tasks that legitimately edit a managed doc must list it in Affected Files.

If a dirty file falls outside this union, the pipeline dies with an actionable message describing the allow-list, suggesting either adding the file to `spec.md '### Affected Files'` (for managed docs) or reverting with `git checkout HEAD -- <path>` (for source/test files that should have been committed in the implement phase).

Non-managed Affected Files entries (source files, test files, fixtures) do not enter the `human_review` allow-list. The Affected Files carve-out at `human_review` is restricted to `PIPELINE_MANAGED_DOCS` only.

When a managed doc is committed via the Affected Files allow-list, an advisory warning fires per file inviting the operator to `git diff HEAD -- <path>` to verify the content before `--ship` (residual guard against same-file sibling-pipeline overlap).

Before that dirty-tree auto-commit path runs, `commitHumanReviewFiles` also runs the base-drift check for `--pr` and `--push`: it fetches `origin/<base>` and compares `origin/<base>` to `HEAD` with a two-dot tree diff (`git diff origin/<base> HEAD --name-status -M -z`). Any diff path outside the spec's `### Affected Files`, `tasks/<id>/`, and `PIPELINE_TELEMETRY_FILES` is drift and aborts the run. This catches cross-pipeline contamination Mode 1 (the base branch advanced while the task branch was running) and wider Mode 2 (foreign content was already committed to the task branch before `--pr`). It is complementary to the dirty-tree gate: the dirty-tree gate stops bad content from being committed at `human_review`, while base-drift stops already-committed branch content from being pushed or PR'd.

For renames, both the old path and the new path must appear in the spec's `### Affected Files` table. The two-dot diff uses rename detection and surfaces both sides; listing only one side leaves the other as drift. `--force` bypasses detected drift with a loud warning after the operator has verified it, but `--force` does not bypass diff-computation failure.

Changelog and version bump remain a manual human + Claude step.

## Phase Routing + Auto-Block

After `spec_review` or `code_review`, the orchestrator checks the verdict. If `changes_requested`, it loops back to the prior agent automatically (up to `MAX_REVIEW_LOOPS`).

**Auto-block on runaway loops**: If spec review or code review returns `changes_requested` for more iterations than the size-aware cap (3 for S/M, 5 for L/XL, or `MAX_REVIEW_LOOPS` if set), the orchestrator auto-blocks that phase and appends an entry to `escalations` in `status.json`. On approval, `iterations_current_loop` resets to `0` while `iterations_total` (lifetime verdict count) and `auto_block_count` are preserved — history is never erased.

**`Fail – unrelated` result state**: When a required check fails due to a pre-existing flake or a test outside the task's Affected Files, Codex may record `Fail – unrelated` in the Validation Outcomes table instead of blocking on a bare `Fail`. The orchestrator accepts this state only when the Notes column contains a specific file reference (a path, file extension, or `file:line`); vague notes are rejected. The code-review prompt instructs Claude to assess whether the explanation is credible and the failure is genuinely out of scope.

If the human authorizes more iterations, override via env var rather than hand-editing `status.json`:

```bash
MAX_REVIEW_LOOPS=5 canon run <id> --step
```

## Session Resumption

The orchestrator resumes agent sessions across phases instead of spawning fresh ones. After each phase, the session ID is discovered and stored in `status.json` under one of four slots: `sessions.claude_spec`, `sessions.claude_review`, `sessions.codex`, or `sessions.codex_spec_review` (Codex spec review uses its own slot so it never clobbers the implement session). Subsequent phases for the same agent pass `--resume <id>` (Claude) or `codex exec resume <id>` (Codex), preserving conversation context and skipping doc re-reads.

**Stale Claude session auto-recovery**: A stored Claude session ID can go stale (long usage-limit gaps, workstation rotation, aggressive `~/.claude/projects/` pruning). When `claude --resume <id>` can't find the session, the orchestrator detects the pattern and retries once with a fresh session and the full original prompt.

## Streaming + Stall Detection

Agent invocations stream NDJSON events live rather than blocking on subprocess completion. The orchestrator spawns Claude (`--output-format stream-json --verbose`) or Codex (`--json`), parses each event as it arrives, and renders a one-line tick (`→ Read tasks/X/spec.md`, `← turn completed`) for live progress visibility.

**Stall detection.** Every parsed event resets an idle timer. If the timer fires (no stdout/stderr data for the configured window), the orchestrator escalates: SIGTERM the child, then SIGKILL after a short grace if it doesn't exit. The child is treated as failed regardless of exit code when the watchdog fires.

**Configuration.** `PIPELINE_STALL_TIMEOUT_MS` env var (default 10 minutes — long enough for normal agent reasoning bursts, short enough that a wedged process doesn't sit forever). Override per invocation when running heavier tasks:

```bash
PIPELINE_STALL_TIMEOUT_MS=1800000 canon run <id>
```

**Implementation gotcha.** `child.killed` flips `true` the instant `kill('SIGTERM')` is called — it does not tell you whether the child actually exited. The SIGKILL escalation must check a locally-tracked `closed` flag set in the child's `'close'` handler, not `child.killed`. Otherwise the SIGKILL never fires for a truly unresponsive child and the promise hangs.

**What's preserved.** Token counts (parsed from the stream's final `result` event for Claude, accumulated from `turn.completed` events for Codex), session IDs (from `result.session_id` / `thread.started`), and the assistant's final text (mirrored to stdout post-exit, so backgrounded runs and captured logs both surface what the agent said). The stale-resume detection still pattern-matches the captured stderr/stdout combined.

## Code Review Diff Injection

Both round-1 and round-N code review prompts include a scoped diff: `git diff <baseBranch>...HEAD` run in the active worktree (three-dot, so only commits on the task branch are included, not unrelated divergence on `baseBranch`). The diff is capped at 50,000 bytes; if truncated, the prompt notes it. This keeps the reviewer focused on the task delta and avoids attributing unrelated baseline work to the current task.

## Per-Iteration Prompt Slimming

Round 2+ of code review and implement do not re-inject the full task framing. Resumed sessions already have spec/plan/repo conventions in context; round-1 findings are durable in the artifacts; the round-2+ prompts target only the delta.

**Cumulative artifacts.** `handoff.md` and `review.md` grow by section per round:
- Round 1 fills the existing template structure.
- Round 2+ APPENDS a new `## Iteration N` (handoff) or `## Round N` (review) section near the bottom.
- Earlier sections stay untouched as the cumulative record.

The append-don't-rewrite convention is enforced both in the prompts and via a comment block at the bottom of each template showing the expected shape.

**Slim resumed-session prompts.** Round 2+ prompts for both code review and implement are tight. Code review's slim shape:

```
[REVIEW ROUND N — verifying iteration N-1's response to round N-1 findings]

Codex appended `## Iteration N-1` to handoff.md addressing your prior round's findings.
[Resumed session: framing in context. Cold start: re-read spec.md and earlier review.md sections.]

Tasks to re-review: <one-line per task pointing at the specific section>

For each task:
1. Read `## Iteration N-1` of handoff.md
2. Read git diff since prior review
3. Verify each prior finding addressed; flag NEW issues only
4. APPEND `## Round N` to review.md
```

The Stage 1 AC table is **not** redone on round 2+ — that gate already passed in round 1. Implement-revision prompts are composable: code-review reroutes point at the new `## Round N-1` of `review.md`.

**Round-3+ tightening.** When the round number reaches 3, the prompt adds a discipline rule: findings must be `correctness bug` or `spec gap` only. No `optional cleanup/nit` and no wording-only changes. Encoded as: "we are tightening, not exploring." Without this, round-by-round wording-quibble creep eats the loop budget.

**Anchor markers.** Slim prompts open with a literal `[ITERATION N]` or `[REVIEW ROUND N]` token. On a resumed session, the model can otherwise drift back to thinking it's finishing the prior round. The marker is a cheap anchor.

**Session-neutral by design.** Slim prompts must work whether the session resumed cleanly or fell back to fresh (stale resume). The way to ensure both: name every file the agent might need (`review.md §Round N`, `handoff.md §Iteration N`, the diff). A resumed session can skip the re-reads; a cold-start fallback re-reads the named files. No special-cased dispatch logic.

**Implementation note.** When a slim prompt instructs "do not re-read spec.md unless a finding requires it" *and* the session is unexpectedly fresh, the agent will dutifully skip the re-read and miss critical context. Always phrase the read instruction conditionally — "if your context is cold, re-read X" — rather than absolutely.

## Human Reroute

If the human rejects at `human_review`, use `--reroute` to atomically reset `implement`, `code_review`, and `qa` back to pending and resume the pipeline. Reroute sets `phases.implement.rerouted = true` so the next `implement` phase sends Codex an **amended-spec** prompt (read `spec.md` for new Amendment sections, compare against `handoff.md`, update the delta).

Before rerouting, write the new requirements into **`tasks/<id>/spec.md` in the active task directory** as an Amendment section. If a worktree exists for the task, edit the worktree copy; edit REPO_ROOT only before the task has a worktree. `review.md` alone is not sufficient — Codex reads `spec.md` as the contract.

The reroute amendment convention is asymmetric: round 1 accepts a bare `## Amendment` heading, while round 2+ requires `## Amendment Round N` where `N` matches the reroute being entered. The orchestrator pre-flights `spec.md` before mutating `status.json`; if any task is missing the required heading, the bundle aborts and the error names the task, the expected heading, and the reason. `--force` bypasses the gate and emits one warning per failing task, which is the escape hatch when you intentionally want Codex to re-implement against the existing spec. Legacy variants like `Follow-up` and `Post-review` are no longer accepted. This exists because an operator once rerouted without amending `spec.md`, Codex re-implemented against unchanged requirements, and the same bug shipped again; the stricter label only becomes necessary once multiple amendment rounds need disambiguation.

## Shipping & Post-Merge Reconciliation

**Normal sequence**: `--pr` (push + draft PR) → mark PR ready, get it approved → `--ship` (merge + archive + cleanup, all in one). `--ship` calls `gh pr merge --squash --delete-branch` itself before tearing down the worktree and archiving, so don't merge the PR manually — canon's `--ship` controls the teardown ordering that prevents the "local branch held by worktree → gh fails to delete → remote branch stays around" partial-cleanup state. If you've already merged the PR externally, `--ship` detects the merge and picks up at cleanup. Running `--ship` with no PR open at all archives the task without the implementation landing — don't do that.

`--ship` runs in this order: (1) merge any open PR for the task branch via `gh pr merge --squash --delete-branch`, (2) pull the base branch (now has the squashed commit), (3) run any project-specific post-merge hook under `.canon/hooks/`, (4) archive `tasks/<id>/` to `tasks/_archive/<id>/`, (5) `git worktree remove --force` if a worktree was active, (6) clean up local branches. **`--ship` fails closed if `handoff.md` is missing** — a task cannot be archived without validation evidence. Similarly, closing `human_review` without a `handoff.md` present fails with an explicit error rather than silently succeeding.

**Always rebase local main on `origin/main` before invoking `--ship`.** When a worktree-implemented PR squash-merges, `origin/main` picks up `tasks/<id>/` files from the squash commit. If `--ship` runs before local rebases, the task directory ends up in both `tasks/<id>/` and `tasks/_archive/<id>/` and needs manual reconciliation.

**Guardrail in code**: `--ship` runs `assertLocalBaseInSyncWithOrigin()` first. It fetches `origin/<baseBranch>`, counts commits behind, and dies with a "rebase first" message if local is behind.

## Customizing Canon for Your Project

Project-level customization happens at the files canon scaffolded into your repo: `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, and the `docs/*` knowledge corpus. Edit those directly to add your project's rules, patterns, and decisions. The pipeline reads them on every session start.

Task templates are managed by canon — `canon upgrade` overwrites `.canon/templates/*`. To customize a template for your project without losing your changes on upgrade, copy it to `tasks/_templates/<file>` — `canon task new` checks there first and falls back to `.canon/templates/`.

## Related References

- `AGENTS.md` — workflow rules, roles, escalation, validation, git/release.
- `CLAUDE.md` — Claude phase-specific guidance (spec authorship, code review, QA).
- `CODEX.md` — Codex phase-specific guidance (implementation, handoff, spec review).
- `docs/patterns.md` — implementation patterns and Known Pitfalls.
- `docs/decisions.md` — settled architectural decisions.
- `/canon-pipeline` — command patterns and snag-recovery flows for operating the pipeline.
- `/canon-review` — adversarial pre-pipeline spec review (multi-agent fan-out) for M/L/XL or delicate tasks.
