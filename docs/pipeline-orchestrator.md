# Pipeline Orchestrator — Internals Reference

This doc is the source of truth for `scripts/run-task.ts` **internals**: pipeline tiers, model/effort selection, environment variables, worktree mechanics, auto-commit guardrails, session resumption, auto-block thresholds, and the post-merge reconciliation guardrail. Read on demand when you need to understand *why* the orchestrator behaves a certain way.

For **operational** guidance — how to drive the pipeline, common command patterns, snag recovery — write a `/pipeline` skill in `.claude/skills/pipeline/SKILL.md` for your project.

`AGENTS.md` is the source of truth for *roles, escalation, implementation rules, validation, git, and release*. This file is the source of truth for *orchestration internals*.

## Invocation surface

Only conversational Claude (the human's session) runs the orchestrator. Pipeline-phase Claude and Codex are spawned by it and never invoke it themselves.

```bash
npx tsx scripts/run-task.ts <task-id> [<task-id> ...]
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
| `--ship` | — | Mark tasks done and move artifacts to `_archive/`. |
| `--dry-run` | — | Print the planned phases, agents, model, and effort without spawning an LLM. |

**Default is full auto** — without `--step`, the pipeline runs all phases to completion (or to the next human gate).

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
Codex implements → Claude reviews code ↔ Codex iterates → Claude writes QA summary → Human tests
```

- Spec and plan are written in separate Claude sessions.
- Codex runs a real spec review before the gate. Spec review starts with a **Shape Check** (is the problem real? is the framing right? is there a materially simpler solution? is the AC decomposition right?) before the implementability probe.
- Codex model/effort scales with effective size (matrix below).

**Bundle mode**: Pass multiple task IDs to `run-task.ts`. All tasks process together per phase (one agent session each). Tier is set by the most complex task — any M/L/XL/delicate pulls the whole bundle to full tier. On code-review `changes_requested`, the entire bundle reroutes to implement.

**One pipeline at a time**: Run only one task or bundle through `run-task.ts` at a time. A second concurrent invocation would share the working tree and corrupt both branches. Worktree mode (see below) is the exception: each task gets its own sibling directory, so concurrent runs are possible if each task has `worktree: true`.

## Task Sizing Fields

Set in `status.json` at task creation:

| Field | Values | Purpose |
|---|---|---|
| `task_size` | `S \| M \| L \| XL` | Drives Codex model + effort selection and the pipeline tier. S is fast-tier; M+ runs the full pipeline (including Codex spec review). |
| `delicate` | `true \| false` | Forces the XL bucket (full Codex model, xhigh implement effort) regardless of nominal size. Set when an undetected bug has materially harder-to-recover blast radius than a normal bug — common examples: auth, payments, premium gating, persistent storage migrations, security-sensitive cryptography. Project-specific surfaces also qualify (medical PHI, scientific reproducibility, regulated data). The bar is *blast radius*, not difficulty. |
| `human_spec_gate` | `true \| false` | Pauses the pipeline after `spec_review` for human review before planning (default: `true`). |
| `worktree` | `true \| false` | Opt-in worktree isolation (default: absent/false). See Worktree Isolation below. |
| `base_branch` | string (default `"main"`) | Branch the task branches off and PRs against. Auto-set by `task.sh new` from the current git checkout at task creation. |

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

Applied by `getCodexConfig` in `scripts/run-task/policy.ts`:

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
| `CLAUDE_MODEL_REVIEW` | `sonnet` | Code review. |
| `CLAUDE_MODEL_QA` | `sonnet` | QA phase. |
| `CLAUDE_BUDGET` | `5.00` | Max spend per Claude phase (USD). |
| `CANON_PROJECT_NAME` | _(reads `package.json` "name" or "your project")_ | Name injected into agent prompts. |

Codex model overrides:

| Variable | Default | Purpose |
|---|---|---|
| `CODEX_MODEL_MINI` | `gpt-5.4-mini` | Codex model for S/M/L non-delicate phases. |
| `CODEX_MODEL_FULL` | `gpt-5.5` | Codex model for XL or delicate phases. |
| `MAX_REVIEW_LOOPS` | _size-aware_ | Max `spec_review` and `code_review` iterations before auto-block. Unset → 3 for S/M, 5 for L/XL. |

## Worktree Isolation

Set `"worktree": true` in `status.json` to run Codex's implement, code_review, and qa phases in a git worktree sibling directory rather than the main repo. This keeps spec files, plan drafts, and other in-flight task artifacts out of the main working tree.

**Layout**: `../dev-worktrees/<task-id>/` (sibling of the repo root, not a subdirectory).

**Main repo stays on its base**: In worktree mode, the orchestrator creates the `task/<id>` branch directly in the worktree. The main repo never checks out the task branch.

**Artifact sync**: After each agent phase, task artifact files (`spec.md`, `spec-review.md`, `plan.md`, `handoff.md`, `review.md`, `done.md`) are synced from the worktree back to the main repo's `tasks/<id>/` so the pipeline can read them. The sync is delete-aware.

**Telemetry flush**: Telemetry files (`docs/pipeline-invocations.md`, `docs/task-quality-log.md`, `docs/lessons-learned.md`) accumulate via two paths in worktree mode and get flushed to main at `--push`, `--pr`, and `--ship`.

**Teardown**: `--ship` calls `git worktree remove --force` after archiving the task directory.

**Bundle constraint**: All tasks in a bundle must agree on `worktree`.

## Auto-Branch + Auto-Commit

**Auto-branch**: The orchestrator creates a `task/<TASK-ID>` branch before the implement phase and records it in `status.json`.

**Auto-commit**: After implement passes validation, the orchestrator auto-commits source files listed in `handoff.md`'s Changes table. If any non-task source files remain dirty after staging, the commit is aborted and the pipeline stops for manual intervention. `handoff.md` must list every changed file including both sides of renames.

At `human_review` with `--push` or `--pr`, the orchestrator auto-commits task artifacts, telemetry, and the managed docs listed in `PIPELINE_MANAGED_DOCS` before pushing. Changelog and version bump remain a manual human + Claude step.

## Phase Routing + Auto-Block

After `spec_review` or `code_review`, the orchestrator checks the verdict. If `changes_requested`, it loops back to the prior agent automatically (up to `MAX_REVIEW_LOOPS`).

**Auto-block on runaway review loops**: If either review phase returns `changes_requested` for more iterations than the size-aware cap (3 for S/M, 5 for L/XL, or `MAX_REVIEW_LOOPS` if set), the orchestrator auto-blocks that phase and appends an entry to `escalations` in `status.json`. The iteration counter resets to `0` when the phase eventually approves. A repeated review pushback almost always means the spec has a structural or scope issue another mechanical revision won't fix.

If the human authorizes more iterations, override via env var rather than hand-editing `status.json`:

```bash
MAX_REVIEW_LOOPS=5 npx tsx scripts/run-task.ts <id> --step
```

## Session Resumption

The orchestrator resumes agent sessions across phases instead of spawning fresh ones. After each phase, the session ID is discovered and stored in `status.json` under `sessions.claude_spec`, `sessions.claude_review`, or `sessions.codex`. Subsequent phases for the same agent pass `--resume <id>` (Claude) or `codex exec resume <id>` (Codex), preserving conversation context and skipping doc re-reads.

**Stale Claude session auto-recovery**: A stored Claude session ID can go stale (long usage-limit gaps, workstation rotation, aggressive `~/.claude/projects/` pruning). When `claude --resume <id>` can't find the session, the orchestrator detects the pattern and retries once with a fresh session and the full original prompt.

## Streaming + Stall Detection

Agent invocations stream NDJSON events live rather than blocking on `spawnSync` and parsing post-exit. The `streamProcess` helper in `scripts/run-task/agents/stream.ts` spawns Claude (`--output-format stream-json --verbose`) or Codex (`--json`) with `spawn`, attaches a `readline` reader to stdout, parses each event as it arrives, and renders a one-line tick (`→ Read tasks/X/spec.md`, `← turn completed`) for live progress visibility.

**Stall detection.** Every parsed event resets an idle timer. If the timer fires (no stdout/stderr data for the configured window), the orchestrator escalates: SIGTERM the child, then SIGKILL after a short grace if it doesn't exit. The child is treated as failed regardless of exit code when the watchdog fires.

**Configuration.** `PIPELINE_STALL_TIMEOUT_MS` env var (default 10 minutes — long enough for normal agent reasoning bursts, short enough that a wedged process doesn't sit forever). Override per invocation when running heavier tasks:

```bash
PIPELINE_STALL_TIMEOUT_MS=1800000 npx tsx scripts/run-task.ts <id>
```

**Implementation gotcha.** `child.killed` flips `true` the instant `kill('SIGTERM')` is called — it does not tell you whether the child actually exited. The SIGKILL escalation must check a locally-tracked `closed` flag set in the child's `'close'` handler, not `child.killed`. Otherwise the SIGKILL never fires for a truly unresponsive child and the promise hangs.

**What's preserved.** Token counts (parsed from the stream's final `result` event for Claude, accumulated from `turn.completed` events for Codex), session IDs (from `result.session_id` / `thread.started`), and the assistant's final text (mirrored to stdout post-exit, so backgrounded runs and captured logs both surface what the agent said). The stale-resume detection still pattern-matches the captured stderr/stdout combined.

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

The Stage 1 AC table is **not** redone on round 2+ — that gate already passed in round 1. Implement-revision prompts have the same shape, pointing at the new `## Round N-1` of `review.md` instead of the spec/plan.

**Round-3+ tightening.** When the round number reaches 3, the prompt adds a discipline rule: findings must be `correctness bug` or `spec gap` only. No `optional cleanup/nit` and no wording-only changes. Encoded as: "we are tightening, not exploring." Without this, round-by-round wording-quibble creep eats the loop budget.

**Anchor markers.** Slim prompts open with a literal `[ITERATION N]` or `[REVIEW ROUND N]` token. On a resumed session, the model can otherwise drift back to thinking it's finishing the prior round. The marker is a cheap anchor.

**Session-neutral by design.** Slim prompts must work whether the session resumed cleanly or fell back to fresh (stale resume). The way to ensure both: name every file the agent might need (`review.md §Round N`, `handoff.md §Iteration N`, the diff). A resumed session can skip the re-reads; a cold-start fallback re-reads the named files. No special-cased dispatch logic.

**Implementation note.** When a slim prompt instructs "do not re-read spec.md unless a finding requires it" *and* the session is unexpectedly fresh, the agent will dutifully skip the re-read and miss critical context. Always phrase the read instruction conditionally — "if your context is cold, re-read X" — rather than absolutely.

## Human Reroute

If the human rejects at `human_review`, use `--reroute` to atomically reset `implement`, `code_review`, and `qa` back to pending and resume the pipeline. Reroute sets `phases.implement.rerouted = true` so the next `implement` phase sends Codex an **amended-spec** prompt (read `spec.md` for new Amendment sections, compare against `handoff.md`, update the delta).

Write the feedback into `spec.md` as an Amendment section (or update `review.md` for small tweaks) before rerouting so Codex has a concrete target.

## Shipping & Post-Merge Reconciliation

`--ship` archives the task dir to `tasks/_archive/<id>/`, removes the worktree (if any), and marks the task complete.

**Always rebase local main on `origin/main` before invoking `--ship`.** When a worktree-implemented PR squash-merges, `origin/main` picks up `tasks/<id>/` files from the squash commit. If `--ship` runs before local rebases, the task directory ends up in both `tasks/<id>/` and `tasks/_archive/<id>/` and needs manual reconciliation.

**Guardrail in code**: `--ship` runs `assertLocalBaseInSyncWithOrigin()` first. It fetches `origin/<baseBranch>`, counts commits behind, and dies with a "rebase first" message if local is behind.

## Pipeline-Infra Changes Are Inline

Changes to `scripts/run-task.ts`, `scripts/task.sh`, task templates, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, this file, or any other orchestration surface are made inline by conversational Claude — one session, one commit, no `tasks/<id>/` directory, no Codex routing.

## Related References

- `AGENTS.md` — workflow rules, roles, escalation, validation, git/release.
- `CLAUDE.md` — Claude phase-specific guidance (spec authorship, code review, QA).
- `CODEX.md` — Codex phase-specific guidance (implementation, handoff, spec review).
- `scripts/run-task.ts` — orchestrator entry stub.
- `scripts/run-task/` — orchestrator implementation (main, dispatchers, phase handlers, agents, policy, state, worktree, validation, prompts).
- `scripts/task.sh` — task management helper (requires `jq`).
- `scripts/pipeline-policy.ts` — pure routing policy (tier, model/effort, loop caps).
