# Pipeline Orchestrator — Reference

Reference for driving canon's pipeline: CLI surface, flags, task-management subcommands, pipeline tiers, the model/effort matrix, environment variables, worktree mechanics, session resumption, auto-block thresholds, and recovery patterns. Read on demand when you need to know which flag to use, why canon picked a particular model, or how to recover from a stuck phase.

For **command patterns and snag-recovery flows**, see the `/canon-pipeline` skill at `.claude/skills/canon-pipeline/SKILL.md` (installed by `canon init`). For **adversarial pre-pipeline spec review** on S/M/L/XL or delicate tasks, see `/canon-spec-review`.

Canon's phase prompts, skills, and templates deliver reusable roles, implementation rules, validation, git, and release guidance just in time. This file is the source of truth for *how to operate the pipeline*.

## Operator

The operator is the session a human drives canon from — writes specs conversationally for fast-tier tasks, invokes `canon run`, monitors pipeline progress, decides next moves.

Canon is designed for **Claude Code (or a human shell) as operator**. Pipeline-phase agents (Claude and Codex sessions spawned by the orchestrator for `spec_review` / `plan` / `implement` / `code_review` / `qa`) are independent sessions and never invoke the pipeline themselves.

Codex can technically operate canon — it has shell access to run `canon run` — but canon was not designed for this. Codex CLI's session model is optimized for execution tasks, not the extended coordination across phases that operating canon requires. Using Codex as operator also pushes Codex toward conversational tasks (spec drafting, multi-turn discussion with the human) that canon assigns to Claude; once that line blurs, cross-model independence erodes operationally even if it survives technically. The likely outcome is worse, not better, output.

If you find yourself wanting Codex as operator, use Claude Code instead and lean on Codex for the phases canon assigns to it (spec review, implementation, code review). That's canon's intended division of labor.

## Monitoring detached runs

A full-auto `canon run` **auto-detaches** whenever stdout is not a TTY — always true inside Claude Code's Bash tool, CI, and piped invocations. The parent prints a PID + log path and exits in ~1s; the real pipeline runs on in a separate process group so it survives harness pgroup-kills on session resume. Use `canon watch` to re-attach. One-shot and stepped modes stay in the foreground regardless of TTY: `--step`, `--expect`, `--push`, `--pr`, and `--ship` all run synchronously (a foreground `--step` runs a full LLM phase before returning — no `canon watch` needed). Bare `--reroute` auto-detaches like a plain `canon run`; monitor it with `canon watch`. `CANON_NO_DETACH=1` suppresses detaching entirely.

### `canon watch <id>`

A read-only blocking observer. Attaches to an already-running orchestrator, streams phase transitions to stderr, and exits when the run goes idle.

```bash
# Normal two-step (Bash tool or headless):
canon run <id>
canon watch <id>
```

**Exit codes:**

| Code | Meaning |
|---|---|
| `0` | Healthy stop — checkpoint (`human_review`), complete, or `--step` step-done |
| `2` | Bad usage, nothing to watch, unreadable state, ambiguous pid disagreement, or launch-window timeout |
| `3` | Auto-block |
| `4` | Crash — orchestrator died; run `canon run <id>` to resume |
| `5` | `--timeout` elapsed while still attached |

**Summary line** — always the final stdout line, stable `key=value`:

```
state=human_review reason=checkpoint phase=qa→human_review verdict=approved pid=48213
```

Keys: `state`, `reason` (always); `phase`, `verdict`, `pid` when applicable. All progress (attach line, phase transitions, heartbeat-age ticks, `--follow` log stream) goes to **stderr**; stdout carries only this one line.

If the resolver detects a live disagreement between `.canon-pid` and the pid recorded in `.heartbeat.json`, `watch` exits `2` with `reason=ambiguous_pid` and a stderr diagnostic naming both pids instead of guessing which process to attach to.

**Flags:**

| Flag | Effect |
|---|---|
| `--until <phase>` | Return early (exit `0`, `reason=until`) the moment the named phase settles. Invalid phase → exit `2` before attaching. |
| `--timeout <dur>` | Cap the wait. Accepts `<int>s`, `<int>m`, or bare integer seconds. Elapsed → exit `5`. |
| `--follow` / `-f` | Additionally tail-stream the run log to stderr while watching. |

**Requires a live run.** If no orchestrator is running at invocation, `watch` classifies the current state and exits non-zero — it does not block waiting for a run to appear. For point-in-time inspection of a finished task, use `canon task status <id>`.

Do not hand-roll a poll loop (`canon task status` + `grep` + `sleep`) — use `canon watch` instead.

### `canon doctor`

Point-in-time health check. Reports active orchestrators, stale heartbeats, and worktree state. Does not block.

Every orchestrator exit writes a final `■ orchestrator exit code=<N> [reason=<reason>] at <timestamp>` line to `.canon-run.log`. A log that ends without this line means the process was killed un-catchably (SIGKILL/OOM) — its absence is itself a diagnostic signal.

### `canon stop <id>`

Gracefully terminate a detached run. Sends SIGTERM then SIGKILL if needed. Self-heals stale `.canon-pid` / `.heartbeat.json` when the orchestrator is already dead.

---

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
| `--pr` | — | Push + create a draft PR at `human_review`; prefers QA-drafted `tasks/<id>/pr-body.md` for single-task PRs, with a soft fallback. |
| `--reroute` | — | Reset a task from `human_review`, or from a `code_review` block with a `spec_gap` verdict, back into the post-review fix path. Full-tier tasks re-enter at `spec_review`; fast-tier tasks re-enter at `implement`. |
| `--ship` | — | Squash-merge any open PR for the task branch (via `gh pr merge --squash --delete-branch`), pull the base, tear down the worktree, archive `tasks/<id>/` to `_archive/`, and clean up local branches. If the PR was already merged externally, picks up at the cleanup step. |
| `--allow-divergent-base` | — | At `--push`, `--pr`, and `--ship`, bypass only the commit-divergence block when local `<base>` has commits not yet on `origin/<base>`. It does not bypass the file-allow-list base-drift gate; use `--force` for that. |
| `--dry-run` | — | Print the planned phases, agents, model, and effort without spawning an LLM. |
| `--full-send` | — | Pre-clear the human spec gate and auto-open the draft PR at `human_review` — no interrupts. On a `delicate` task, requires `--force`. Mutually exclusive with `--reroute` in one invocation. |
| `--force` | — | Bypass operator-confirmation gates after you've verified the situation: reroute amendment-heading pre-flight, base-drift file allow-list, the dirty-REPO_ROOT guard before first worktree creation, and `--full-send` on delicate. It does **not** bypass the forge-proof merge gate or diff-computation failures. |

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
| `accept` | `<id...> <phase> [--reason "<text>"] [--force]` | Operator accept supports `implement`, `spec_review`, and `code_review`. For `implement`, it is the escape hatch for already-committed work: it marks implement done and sets `operator_accepted` so post-implement auto-commit is skipped when the recorded HEAD still matches. For `spec_review` and `code_review`, `--reason` is required; accept writes a `sanctioned` verdict for non-advancing review verdicts, preserves already-advancing verdicts in a blocked bundle, records `operator_accepted*`, and appends the audit reason to `notes.md`. Review accept intentionally skips the implement-only diff/handoff guards. |
| `set` | `<id> <field> <value>` | Set flat task metadata with validation. Metadata fields `title`, `task_size`, and `delicate` remain settable whenever the task is reachable. Topology fields `worktree` and `base_branch` are only settable before `status.branch` is recorded; once branched, `set` rejects them and points operators at recreating the task or migrating `status.json` manually. Redirected: `full_send` → `canon run --full-send`; `human_spec_gate` → re-run `canon run`; `status` → `canon task phase`; `branch` → git identity, not `canon task set`; `phases`/`sessions`/`canon`/`escalations` → their owning canon task commands. Immutable: `id`, `created`, `updated`, and `_`-prefixed inline-doc keys. Writes warn after dispatch has started because metadata changes take effect on the next `canon run`. |
| `reset-spec-review` | `<id>` | Clear router-relevant state for a fresh spec-review pass after an auto-block. Zeroes iterations, clears verdict, archives the prior `spec-review.md`, and drops the stored `sessions.claude_spec` ID so the next pass runs against a fresh Claude spec session. |
| `reset-code-review` | `<id>` | Clear router-relevant state for a fresh code-review pass after an auto-block. Zeroes the loop-local review counters, clears verdict, archives the prior `review.md`, and drops the stored `sessions.claude_review` ID so the next pass runs against a fresh Claude review session. |
| `post-merge-sync` | `[<branch>]` | After a squash-merge PR, reconcile local branch with origin. Hard-resets if the only divergence is pipeline telemetry; refuses if real new work exists. |

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

# Initialize a release branch per your project's release setup
```

## Pipeline Tiers

The tier is set by the largest task in the run. Task size is set in `status.json` at task creation.

**Fast tier** (all tasks XS, non-delicate):
```
Claude writes spec+plan → [human spec gate] → Codex implements →
Claude reviews code ↔ Codex iterates → Claude writes QA summary → Human tests
```

- Spec and plan are written in one Claude session.
- Codex `spec_review` is skipped; the human spec gate replaces it.
- The plan phase auto-advances (already written during spec).

**Full tier** (any task S, M, L, XL, or `delicate`):
```
Claude writes spec → Codex reviews spec → [human spec gate] → Claude writes plan →
Codex implements → Claude reviews code ↔ Codex iterates →
Claude writes QA summary → Human tests
```

- Spec and plan are written in separate Claude sessions.
- Codex runs a real spec review before the gate. Spec review starts with a **Shape Check** (is the problem real? is the framing right? is there a materially simpler solution? is the AC decomposition right?) before the implementability probe.
- Codex model/effort scales with effective size (matrix below).
- **Optional pre-pipeline self-review**: before invoking `canon run`, the operator can run `/canon-spec-review <task-id>` to dispatch three parallel sub-agents (structural / factual / spec-quality) at the spec and surface BLOCKING / STRONG / NIT findings inline. Catches the class of issues Codex's spec_review would surface across 2-3 iterations in one ~15-min pass. Opt-in; most valuable when iteration cost is real.

**Where validation happens**: Project-specific checks (lint, type-check, unit tests, e2e, etc.) run inside agent phases — Codex runs them during `implement` and records outcomes in the handoff; Claude verifies the outcomes table in Stage 1 code review and re-runs selectively when anything looks off. There is no separate orchestrator-run validation phase.

**Bundle mode**: Pass multiple task IDs to `canon run`. All tasks process together per phase (one agent session each). Tier is set by the most complex task — any S/M/L/XL/delicate pulls the whole bundle to full tier. On code-review `changes_requested`, the entire bundle reroutes to implement. On code-review `spec_gap`, the whole bundle blocks until the operator chooses fix (`canon run <ids> --reroute` after amending the `spec_gap` task specs) or bless (`canon task accept <ids> code_review --reason "<why>"`).

**One pipeline at a time**: Run only one task or bundle through `canon run` at a time. A second concurrent invocation would share the working tree and corrupt both branches. Worktree mode (see below) is the exception: each task gets its own sibling directory, so concurrent runs are possible if each task has `worktree: true`.

## Task Sizing Fields

Set in `status.json` at task creation:

| Field | Values | Purpose |
|---|---|---|
| `task_size` | `XS \| S \| M \| L \| XL` | Drives Codex model + effort selection and the pipeline tier. XS is fast-tier; S+ runs the full pipeline (including Codex spec review). |
| `delicate` | `true \| false` | Forces the XL bucket (full Codex model, high implement effort) regardless of nominal size. Set when an undetected bug has materially harder-to-recover blast radius than a normal bug — common examples: auth, payments, premium gating, persistent storage migrations, security-sensitive cryptography. Project-specific surfaces also qualify (medical PHI, scientific reproducibility, regulated data). The bar is *blast radius*, not difficulty. |
| `human_spec_gate` | `true \| false` | **Single-use latch**, not a persistent toggle. `true` arms a one-time halt after `spec_review`, before planning (default: `true`). The orchestrator flips it to `false` *at the moment it halts* — so `false` means "the gate already fired (or was pre-cleared)," not "review was skipped." See [Spec gate is a single-use latch](#spec-gate-is-a-single-use-latch). |
| `worktree` | `true \| false` | Worktree isolation. `canon task new` scaffolds this to `true`, so worktree mode is the effective default for every scaffolded task — set it to `false` to opt out and run in the main checkout. The orchestrator treats an *absent* field as `false`, but that fallback only applies to hand-rolled `status.json` files. See Worktree Isolation below. |
| `base_branch` | string (default `"main"`) | Branch the task branches off and PRs against. Auto-set by `canon task new` from the current git checkout at task creation. |

### Task sizing guide

> Sizing ranges below are **starting heuristics**. File-count thresholds are project-dependent — a Python data project, a React app, and a Rust system tool all calibrate differently. Recalibrate after ~10 tasks if your S-tasks are routinely too small or your L-tasks too large for the loop caps to make sense.

| Size | Files touched (heuristic) | Scope |
|---|---|---|
| XS | 1–3 | More than trivial inline work (>1 file, or real logic), but little-to-no spec premise worth reviewing; smallest pipeline tier |
| S | 1–3 | Smallest full-tier task; enough logic/risk in the spec that Codex `spec_review` earns its keep |
| M | 4–7 | May touch one context, clear interaction model |
| L | 8+ | Multiple contexts, new subsystem, or touches a sensitive surface |
| XL | — | Milestone-scale, staged implementation, multiple L-scope changes |

### Recommended default for the `delicate` flag

Canon's recommended starting policy for when to scope a task as `delicate: true`: *require evidence of real production impact, not theoretical correctness.*

A `delicate` task carries meaningful regression risk on a security-sensitive surface and runs at the most expensive model+effort tier. "It's technically wrong" is not sufficient justification on its own — a hardening pass on auth/payments/storage that no user has ever hit can take significant pipeline time, introduce regression risk, and produce zero customer-visible value. Before scoping any task as `delicate: true`, require at least one confirmed production incident or a concrete upcoming flow that depends on the fix. Note the incident in the spec's *Problem* section.

This is a default — your project can adopt a stricter or looser bar in `docs/decisions.md` if it has different risk tolerance (e.g., a medical-data project with regulatory exposure may want proactive hardening).

## Codex Model/Effort Matrix

Codex model and effort scale with task size:

| Phase | XS | S | M | L | XL / delicate |
|---|---|---|---|---|---|
| `spec_review` | — (skipped) | mini / medium | mini / high | mini / high | full / high |
| `implement`   | mini / medium | mini / medium | mini / high | mini / high | full / high |

Codex is tuned for token efficiency — the mini model handles most phases; the full model only comes out for XL or delicate work. XL/delicate implement runs at `high`, not `xhigh`: GPT-5.5 tends to overthink at `xhigh` with open-ended tool access (cost without quality gain). Raise via env only if eval shows under-reasoning.

`spec_review` M was raised from `medium` to `high` (2026-07): task-history analysis across canon-ai and galleryplanner found M's excess code_review iterations weren't an implement-quality gap (non-rerouted M and L tasks ran at nearly identical iteration counts, ~1.0–1.4) but a reroute-severity gap (M rerouted-task average 5.15 vs. L's 4.83). M's lighter spec_review effort is the leading hypothesis — not a proven sole cause, since M and L also differ on loop cap, budget, and QA effort. Re-measure the M vs. L reroute rate after this change; see [`docs/decisions.md`](docs/decisions.md) §"`spec_review` M effort raised medium → high (2026-07)" for the full reasoning and caveats.

## Environment Variables

Claude is tuned for correctness — Opus on phases where false negatives cascade, Sonnet on structured/templated phases.

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_MODEL_SPEC` | `opus` | Spec phase (foundational; cascades into every downstream phase). |
| `CLAUDE_MODEL_PLAN` | `sonnet` | Plan phase (structured translation of spec → steps). |
| `CLAUDE_MODEL_REVIEW` | `sonnet` | Code review for XS/S/M/L (Sonnet 4.6 matches the prior Opus flagship on long-horizon / lifecycle / state-machine bug detection — re-baselined 2026-06; L was Opus on Sonnet 4.5). |
| `CLAUDE_MODEL_REVIEW_LARGE` | `opus` | Code review for XL/delicate only — the highest-blast-radius tier where the subtlest cross-file bugs warrant Opus. |
| `CLAUDE_MODEL_QA` | `sonnet` | QA phase. |
| `CLAUDE_BUDGET` | _(size-aware)_ | Max spend per Claude phase (USD). Unset → tiered by effective size: XS/S/M `5.00`, L `10.00`, XL/delicate `20.00`. Set → flat cap for all phases (e.g. `CLAUDE_BUDGET=20.00` overrides the tier). |
| `CANON_PROJECT_NAME` | _(reads `package.json` "name" or "your project")_ | Name injected into agent prompts. |
| `CANON_WORKTREES_ROOT` | `../dev-worktrees` | Where task worktrees are created. When overridden, the orchestrator warns if the path isn't in `.claude/settings*.json` `additionalDirectories`. |
| `CANON_PR_BODY` | _(unset)_ | Literal PR body for `--pr`, overriding the normal resolution chain. Supports `$LABEL` and `$TITLE` placeholders. |
| `MAX_CONTEXT_BYTES` | `65536` | Byte cap on the spec + Affected Files preload injected into Codex's implement prompt. |
| `CANON_NO_DETACH` | _(unset)_ | Set to `1` to keep full-auto runs in the foreground (no auto-detach). |

Codex model overrides:

| Variable | Default | Purpose |
|---|---|---|
| `CODEX_MODEL_MINI` | `gpt-5.4-mini` | Codex model for XS/S/M/L non-delicate phases. |
| `CODEX_MODEL_FULL` | `gpt-5.5` | Codex model for XL or delicate phases. |
| `MAX_REVIEW_LOOPS` | _size-aware_ | Max `spec_review` and `code_review` iterations before auto-block. Unset → 3 for XS/S/M, 5 for L/XL. |

These are canon's shipped defaults at the time of release and may lag
behind what your local `codex` CLI accepts. **Verify they resolve on your
install before relying on the pipeline** — a stale identifier produces a
hard failure on the first phase that needs Codex. If they don't resolve,
set `CODEX_MODEL_MINI` and `CODEX_MODEL_FULL` explicitly to identifiers
your CLI exposes rather than changing the orchestrator contract.

## Worktree Isolation

With `"worktree": true` in `status.json` — the scaffolded default from `canon task new` — implement, code_review, qa, and reroute-time spec_review/plan phases run in a git worktree sibling directory rather than the main repo. This keeps spec files, plan drafts, and other in-flight task artifacts out of the main working tree. Set the field to `false` to opt out and run those phases in the main checkout (canon still creates the `task/<id>` branch there itself).

**Layout**: `../dev-worktrees/<task-id>/` (sibling of the repo root, not a subdirectory). The root is configurable via `CANON_WORKTREES_ROOT`.

**Main repo stays on its base**: In worktree mode, the orchestrator creates the `task/<id>` branch directly in the worktree. The main repo never checks out the task branch.

**Scaffold-to-base before worktree creation**: On the first `implement` phase call (when no task branch exists yet), the orchestrator commits the full `tasks/<id>/` scaffold — every artifact stub plus `status.json` — to the base branch with message `task(<id>): commit artifacts pre-pipeline`. If `PIPELINE_TELEMETRY_FILES` are dirty, a sibling commit follows: `chore: absorb pre-implement telemetry into scaffold for <id>`. Then `ensureBranch` creates the `task/<id>` branch from base, so the new worktree inherits the scaffold via its initial checkout. Without this, the worktree would boot from a base branch that has no `tasks/<id>/` and pipeline phases would have nothing to read. On re-runs of `implement` (reroutes, review iterations) the worktree already exists and the scaffold-to-base commit is skipped — re-committing it would create divergent commits that fight with the task branch's evolved artifacts at PR-merge time.

**Dirty source guard before first worktree**: Before the first worktree is created, the orchestrator inspects `REPO_ROOT` with `git status --porcelain=v1 -uall`. Dirtiness under `tasks/` and `PIPELINE_TELEMETRY_FILES` is allowed because canon owns those scaffold/telemetry paths. Any tracked or untracked source path outside that allow-list aborts worktree creation: commit or stash intentional edits before starting, or rerun with `--force` if the new task should intentionally start from `base_branch` without those local edits.

**Task-state source of truth**: From implement onward, the worktree is canonical for task artifacts (`tasks/<id>/`) and per-task telemetry rows. The main repo keeps the pre-implement scaffold; runtime task-state reads resolve to the worktree when it exists.

**Project-level resources**: REPO_ROOT remains canonical for managed docs, `scripts/`, `src/`, root agent files, and other project-level files. Their cross-worktree coordination is separate from task-state resolution.

**Teardown**: `--ship` calls `git worktree remove --force` *before* archiving the task directory — teardown comes first so the archive write targets the main checkout.

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

When `qa.status` reaches `done`, the orchestrator commits QA artifacts before stopping at `human_review`. The QA-end commit stages the bundled `tasks/<id>/` directories plus any dirty `PIPELINE_TELEMETRY_FILES` or `PIPELINE_MANAGED_DOCS` in the active checkout, with subject `chore: QA artifacts for <task-id>` (bundles list every task id). This commit does not push or create a PR. It leaves the worktree clean for `--reroute`, avoids the `--pr` rebase stash/pop dance, and makes post-QA task state durable against local history surgery. The residual implement-to-first-QA window remains: code_review iterations before the first successful QA still have uncommitted phase artifacts.

At `human_review` with `--push` or `--pr`, the orchestrator auto-commits a scoped allow-list before pushing:

- **`tasks/<id>/`** — task artifacts (spec, plan, handoff, review, done, pr-body, notes).
- **`PIPELINE_TELEMETRY_FILES`** (`docs/lessons-learned.md`, `docs/task-quality-log.md`, `docs/pipeline-invocations.md`) — always auto-committed.
- **`PIPELINE_MANAGED_DOCS`** (`docs/architecture.md`, `docs/codebase-map.md`, `docs/decisions.md`, `docs/patterns.md`, `docs/pipeline-orchestrator.md`, `docs/product-context.md`) — auto-committed when the task's `spec.md` `### Affected Files` table lists the doc. **QA-done widening**: once a task's `qa.status === 'done'`, the allow-list expands to the full `PIPELINE_MANAGED_DOCS` set regardless of Affected Files. QA's Docs Freshness guidance in the QA prompt corrects stale references in protected docs the spec author couldn't have predicted (codebase-map drift, patterns/pitfalls contradicted by the task's behavior change); widening at QA-done avoids forcing a manual spec backfill before `--pr`. QA does **not** promote lessons-learned entries into these docs — promotion is a human-only sweep; QA only appends to `docs/lessons-learned.md` and corrects stale references in the protected set. Tasks that edit a managed doc *before* QA must still list it in Affected Files.

The `--pr` body resolution order is `CANON_PR_BODY` → populated `tasks/<id>/pr-body.md` (single task only) → repo PR template file → `--fill`. Bundles log that per-task QA bodies are not combined and fall back to the template/`--fill` path in this version.

If a dirty file falls outside this union, the pipeline dies with an actionable message describing the allow-list, suggesting either adding the file to `spec.md '### Affected Files'` (for managed docs) or reverting with `git checkout HEAD -- <path>` (for source/test files that should have been committed in the implement phase).

Non-managed Affected Files entries (source files, test files, fixtures) do not enter the `human_review` allow-list as individual files — those belong to the implement phase's auto-commit. Two carve-outs do apply at `human_review`: `PIPELINE_MANAGED_DOCS` entries listed in Affected Files, and **directory-form entries** (a path ending in `/`, e.g. `dist/`) — any dirty file under such a prefix is staged, which is the mechanism for build-generated artifacts regenerated late in the pipeline.

When a managed doc is committed via the Affected Files allow-list, an advisory warning fires per file inviting the operator to `git diff HEAD -- <path>` to verify the content before `--ship` (residual guard against same-file sibling-pipeline overlap).

Before that dirty-tree auto-commit path runs, the orchestrator also runs remote-boundary gates. First, the base-divergence check fetches `origin/<base>` and lists commits on local `<base>` that are not yet on `origin/<base>`. Those commits block `--push`, `--pr`, and `--ship` because they will collide when the base is pulled; bypass only this commit-divergence gate with `--allow-divergent-base`. Second, for `--pr` and `--push`, the base-drift check fetches `origin/<base>` and compares `origin/<base>` to `HEAD` with a two-dot tree diff (`git diff origin/<base> HEAD --name-status -M -z`). Any diff path outside the spec's `### Affected Files`, `tasks/<id>/`, `PIPELINE_TELEMETRY_FILES`, and — once `qa.status === 'done'` — any `PIPELINE_MANAGED_DOCS` entry is drift and aborts the run. This catches cross-pipeline contamination Mode 1 (the base branch advanced while the task branch was running) and wider Mode 2 (foreign content was already committed to the task branch before `--pr`). It is complementary to the dirty-tree gate: the dirty-tree gate stops bad content from being committed at `human_review`, while base-drift stops already-committed branch content from being pushed or PR'd.

For renames, both the old path and the new path must appear in the spec's `### Affected Files` table. The two-dot diff uses rename detection and surfaces both sides; listing only one side leaves the other as drift. `--force` bypasses detected drift with a loud warning after the operator has verified it, but `--force` does not bypass diff-computation failure. `--force` and `--allow-divergent-base` are independent bypasses for distinct gates; pass both only when both the file-allow-list drift and the commit-divergence are intentional.

For projects that version their releases, changelog and version bump remain a manual human + Claude step; projects that don't version skip it.

## Spec gate is a single-use latch

`human_spec_gate` confuses operators because it looks like a persistent on/off setting and isn't. It is a **one-shot latch the orchestrator consumes the first time the pipeline reaches the gate.**

The flip to `false` *is the gate firing* — it happens at the halt, **before** the human has reviewed, not after. Concretely, when the pipeline reaches the gate point with the latch armed, the orchestrator does three things in one step: (1) sets `human_spec_gate = false`, (2) prints the `✋ SPEC GATE` banner, (3) `process.exit(0)`. The reason it burns the latch *at* the halt is so the **next** `canon run <id>` — the one the human types after approving the spec — passes straight through instead of halting on the same gate forever.

Where the gate fires by tier:

- **Fast tier (XS, non-delicate)**: at `spec_review` phase entry. (In practice the operator usually pre-clears it to `false` when writing the plan, because the human's conversational spec approval *is* the gate — so the runtime halt is often already consumed before the pipeline starts.)
- **Full tier (S/M/L/XL/delicate)**: after Codex `spec_review` completes, before planning.
- **`--full-send`**: pre-clears the latch to `false` at launch, so the gate never fires.

So when you inspect `status.json` mid-pipeline and see `human_spec_gate: false`, read it as **"the gate already fired (or was pre-cleared) — review was *not* skipped"**, not "the halt was lost." There is no separate "gate satisfied" field; the consumed latch *is* the record that the gate fired. Re-running `canon run <id>` after the banner is the intended next move — it does not re-arm or re-fire the gate.

**Bundle rule**: the gate skip is all-or-nothing. One task in the bundle with the latch still armed re-engages the halt for the whole invocation; `--full-send` must apply to every task in the bundle to skip it.

## Phase Routing + Auto-Block

After `spec_review` or `code_review`, the orchestrator checks the verdict.

| Phase | Verdict | Route |
|---|---|---|
| `spec_review` | `changes_requested` | Loop back to `spec` automatically, except reroute-amendment reviews block for human revision. |
| `code_review` | `changes_requested` / `needs_re_review` | Loop back to `implement` automatically. |
| `code_review` | `spec_gap` | Block the whole `code_review` bundle with an escalation. Fix path: amend the `spec_gap` task specs and run `canon run <ids> --reroute`. Bless path: `canon task accept <ids> code_review --reason "<why>"`. |
| `spec_review` / `code_review` | `approved` / `approved_with_nits` / `sanctioned` | Continue to the next phase. `sanctioned` is status-only and written by `canon task accept`, not by review artifacts; `canon task accept` refuses a review phase with no recorded verdict unless `--force` is passed. |

**Auto-block on runaway loops**: If spec review or code review returns `changes_requested` for more iterations than the size-aware cap (3 for XS/S/M, 5 for L/XL, or `MAX_REVIEW_LOOPS` if set), the orchestrator auto-blocks that phase and appends an entry to `escalations` in `status.json`. For code review the cap check is the **sum** of `iterations_current_loop` and `preflight_rejections_current_loop` — handoffs bounced by the deterministic pre-flight gate count toward the same budget, and recovery requires resetting both counters (the block message says which). Separately, a pre-flight where every blocker is a `blocked` validation row auto-blocks immediately without consuming loop budget. On approval, `iterations_current_loop` resets to `0` while `iterations_total` (lifetime verdict count) and `auto_block_count` are preserved — history is never erased.

**`Fail – unrelated` result state**: When a required check fails due to a pre-existing flake or a test outside the task's Affected Files, Codex may record `Fail – unrelated` in the Validation Outcomes table instead of blocking on a bare `Fail`. The orchestrator accepts this state only when the Notes column contains a specific file reference (a path, file extension, or `file:line`); vague notes are rejected. The code-review prompt instructs Claude to assess whether the explanation is credible and the failure is genuinely out of scope.

If the human authorizes more iterations, override via env var rather than hand-editing `status.json`:

```bash
MAX_REVIEW_LOOPS=5 canon run <id> --step
```

If a `code_review` task auto-blocks and you need to reset the loop counters instead of raising the cap, use `canon task reset-code-review <id>`.

## Session Resumption

The orchestrator resumes agent sessions across phases instead of spawning fresh ones — for the phases that participate in a resumption cluster. Plan and QA sessions are intentionally one-offs (never stored), and code-review round 1 always starts fresh even when a prior `claude_review` session exists; only round 2+ resumes it. For participating phases, the session ID is discovered and stored in `status.json` under one of four slots: `sessions.claude_spec`, `sessions.claude_review`, `sessions.codex`, or `sessions.codex_spec_review` (Codex spec review uses its own slot so it never clobbers the implement session). Subsequent phases for the same agent pass `--resume <id>` (Claude) or `codex exec resume <id>` (Codex), preserving conversation context and skipping doc re-reads.

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

Code review starts with a cold-Codex diff review run by the orchestrator in the active worktree: `codex exec review --json --base <baseBranch> -m <miniModel>`, where `<miniModel>` is canon's resolved mini Codex model. The captured findings are written verbatim to `tasks/<id>/review-cold-codex.md` for every task in the invocation. Bundles run this once over the combined branch diff, and the same findings reach every member.

If the cold-Codex review cannot be obtained (no captured findings output, spawn error, stall, or signal), `code_review` stops before any Claude session. Re-run `canon run <id>` when Codex is available; there is no two-Claude-lens fallback. Successful runs emit one duration line in the run log: `→ cold-codex review (<taskIds>): <n>s`.

After that, the code-review foreman prompt includes a scoped diff: `git diff <baseBranch>...HEAD` run in the active worktree (three-dot, so only commits on the task branch are included, not unrelated divergence on `baseBranch`). The diff is capped at 50,000 bytes; if truncated, the prompt notes it. The foreman receives the cold-Codex findings as the pre-obtained third lens input, gives the anchored Claude lens the diff plus spec/handoff context, and gives the cold-Claude lens the diff without spec/AC/canon context. The Codex `--base` review and the Claude scoped diff are both over the task branch versus `<baseBranch>` range.

## Per-Iteration Prompt Slimming

Round 2+ of code review and implement do not re-inject the full task framing. Resumed sessions already have spec/plan/repo conventions in context; round-1 findings are durable in the artifacts; the round-2+ prompts target only the delta. Code-review re-obtains cold-Codex findings and re-runs the Claude lenses from scratch on every round before the foreman synthesizes the new verdict.

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
3. Re-fill the Stage 1 AC table with every AC from spec.md against the latest code
4. Verify each prior finding addressed, cross-referencing the refreshed AC table; flag NEW issues
5. APPEND `## Round N` to review.md
```

The Stage 1 AC table is redone on round 2+. Earlier AC tables were snapshots of earlier code states; a revision can fix a cited finding while regressing an unrelated AC. Every AC appears every round. ACs whose relevant code paths did not change may be marked `Met (unchanged from round N-1)` with a one-line evidence pointer rather than re-derived evidence. Implement-revision prompts are composable: code-review reroutes point at the new `## Round N-1` of `review.md`.

**Round-3+ tightening.** When the round number reaches 3, the prompt adds a discipline rule: findings must be `correctness bug` or `spec gap` only. No `optional cleanup/nit` and no wording-only changes. Encoded as: "we are tightening, not exploring." Without this, round-by-round wording-quibble creep eats the loop budget.

**Anchor markers.** Slim prompts open with a literal `[ITERATION N]` or `[REVIEW ROUND N]` token. On a resumed session, the model can otherwise drift back to thinking it's finishing the prior round. The marker is a cheap anchor.

**Session-neutral by design.** Slim prompts must work whether the session resumed cleanly or fell back to fresh (stale resume). The way to ensure both: name every file the agent might need (`review.md §Round N`, `handoff.md §Iteration N`, the diff). A resumed session can skip the re-reads; a cold-start fallback re-reads the named files. No special-cased dispatch logic.

**Implementation note.** When a slim prompt instructs "do not re-read spec.md unless a finding requires it" *and* the session is unexpectedly fresh, the agent will dutifully skip the re-read and miss critical context. Always phrase the read instruction conditionally — "if your context is cold, re-read X" — rather than absolutely.

## Human Reroute

If the human rejects at `human_review`, or code review blocks with `spec_gap`, use `--reroute` to resume the pipeline against amended requirements. Reroute sets `phases.implement.rerouted = true` so later reroute prompts read `spec.md` for new Amendment sections, compare against prior artifacts, and update only the delta.

Before rerouting from `human_review`, write the new requirements into **`tasks/<id>/spec.md` in the active task directory** for every task as an Amendment section. Before rerouting from a `code_review` `spec_gap` block, only the tasks with a `spec_gap` verdict need an Amendment section; approved or other non-gap siblings in the same bundle do not. If a worktree exists for the task, edit the worktree copy; edit REPO_ROOT only before the task has a worktree. `review.md` alone is not sufficient — Codex reads `spec.md` as the contract.

Full-tier reroute (any S/M/L/XL task or any `delicate` task) re-enters at the same review altitude as the original spec: `human_review` or `code_review` `spec_gap` → `spec_review` → `plan` → `implement`. Codex reviews the amendment in the context of the previously approved ACs and prior `spec-review.md`, without auditing `handoff.md`, `review.md`, or `done.md`. If the amendment is approved, the pipeline flows through to `plan` without re-arming the human spec gate; Claude appends a reroute plan section (`## Reroute Plan` or `## Reroute Plan Round N`) to `plan.md`; Codex then implements from the amendment plus that reroute plan.

If Codex returns `changes_requested` on a full-tier reroute amendment, the pipeline blocks to the human instead of routing to pipeline-Claude spec revision. The block names the rejected task's `spec.md` and `spec-review.md`; revise the amendment in `spec.md`, then re-run the normal command:

```bash
canon run <id>
```

Do **not** re-run with `--reroute` after this block. `--reroute` starts a new reroute round and increments `reroute_count`; an amendment rejection is still the same round.

Fast-tier reroute is unchanged mechanically: XS, non-delicate tasks re-enter directly at `implement`. Operators may optionally append a conversational `## Reroute Plan` section to `plan.md` before rerouting; implement-reroute reads it when present and falls back to the base plan when absent.

Bare `--reroute` auto-detaches and runs the complete rerouted pipeline in the background. Stepped foreground reroutes must combine `--reroute`, `--step`, and the tier-specific expected re-entry phase in a single invocation:

```bash
# Full tier
canon run <id> --reroute --step --expect spec_review

# Fast tier
canon run <id> --reroute --step --expect implement
```

The reroute amendment convention is asymmetric: round 1 accepts a bare `## Amendment` heading, while round 2+ requires `## Amendment Round N` where `N` matches the reroute being entered. The orchestrator pre-flights `spec.md` before mutating `status.json`; if any required task is missing the required heading, the bundle aborts and the error names the task, the expected heading, and the reason. `--force` bypasses the gate and emits one warning per failing task, which is the escape hatch when you intentionally want Codex to re-implement against the existing spec. Legacy variants like `Follow-up` and `Post-review` are no longer accepted. This exists because an operator once rerouted without amending `spec.md`, Codex re-implemented against unchanged requirements, and the same bug shipped again; the stricter label only becomes necessary once multiple amendment rounds need disambiguation. Do not create Amendment sections for the bless path; `canon task accept ... --reason` records `sanctioned` without changing `spec.md` or `reroute_count`.

## Shipping & Post-Merge Reconciliation

**Normal sequence**: `--pr` (push + draft PR) → mark PR ready, get it approved → `--ship` (merge + archive + cleanup, all in one). `--ship` calls `gh pr merge --squash --delete-branch` itself before tearing down the worktree and archiving, so don't merge the PR manually — canon's `--ship` controls the teardown ordering that prevents the "local branch held by worktree → gh fails to delete → remote branch stays around" partial-cleanup state. If you've already merged the PR externally, `--ship` detects the merge and picks up at cleanup. Running `--ship` with no PR open at all archives the task without the implementation landing — don't do that.

**Note on merge strategy**: `--ship` uses `gh pr merge --squash` as canon's default merge strategy. Projects that use rebase-merge or merge-commit should handle the merge outside canon, then run `--ship` afterward so it can detect the merged PR and proceed with cleanup.

**Shared-doc dirt at `--ship`**: when at least one shipped task is worktree-mode, the supervising checkout can carry uncommitted shared-doc dirt, most commonly a sibling task's pre-implement telemetry rows. Dirty managed docs abort `--ship` before anything merges; the error names each file and instructs commit-or-stash, and `--force` does not bypass this gate. Dirty telemetry files are preserved only when the uncommitted content is a byte-for-byte pure append over the HEAD copy: the suffix is backed up to disk, the working copy is reverted to HEAD, and after the archive changes are staged but before they are committed, the suffix is re-appended as an uncommitted change. Non-append telemetry dirt, or a telemetry file that cannot be read at HEAD, aborts pre-merge like managed-doc dirt. Nothing is silently discarded.

`--ship` runs in this order: (1) classify supervising-checkout shared-doc dirt for worktree-mode ships, aborting pre-merge for managed-doc or unsafe telemetry dirt and temporarily preserving safe telemetry appends, (2) verify local `<base>` has no commits ahead of `origin/<base>` unless `--allow-divergent-base` is passed, (3) merge any open PR for the task branch via `gh pr merge --squash --delete-branch`, (4) pull or fast-forward the base branch when needed, (5) run any project-specific post-merge hook under `.canon/hooks/`, (6) prove the task's merge before local branch deletion, (7) `git worktree remove --force` if a worktree was active, (8) archive `tasks/<id>/` to `tasks/_archive/<id>/` in the main checkout, (9) stage archive changes, re-append preserved telemetry dirt as uncommitted supervising-checkout changes, commit and push the archive changes, and clean up local branches. **`--ship` fails closed if `handoff.md` is missing** — a task cannot be archived without validation evidence. Similarly, closing `human_review` without a `handoff.md` present fails with an explicit error rather than silently succeeding.

**Forge-proof deletion gate**: before deleting any local task branch, `--ship` requires positive merge evidence. When the `--pr` path has run, the PR number is stored in a gitignored task-local sidecar (`tasks/<id>/.pr-number`); proof requires the pinned PR to be `MERGED`, the PR `baseRefName` to match the task's `base_branch`, and the local task-branch tip to be an ancestor of, or equal to, the PR `headRefOid`. When the sidecar is absent (tasks created before v1.11, or a worktree rebuilt without `--pr`), `--ship` falls back to a base-filtered merged-PR branch lookup, still requiring the local tip to be ancestor-or-equal to the PR head. If the PR head object cannot be materialized locally, proof is unestablished and `--ship` fails closed. If the local task branch is already absent, no proof is required because there is no local branch deletion left to protect. `--force` does not bypass this proof gate; the failure message names the manual recovery path.

**Ungated fast-forward**: when no PR was merged in the current run and the local base is strictly behind `origin/<base>`, `assertLocalBaseInSyncWithOrigin()` fast-forwards with `git pull --ff-only`. The fast-forward is non-destructive and is not treated as merge proof; the deletion gate still runs afterward.

**Guardrail in code**: `--ship` runs the base-divergence check before merging, blocking when local `<baseBranch>` is ahead of `origin/<baseBranch>` unless `--allow-divergent-base` is passed. `assertLocalBaseInSyncWithOrigin()` still refuses a diverged base; it only fast-forwards the pure-behind case.

## Customizing Canon for Your Project

Project-level customization happens in the adopter-owned agent files, when present, and the `docs/*` knowledge corpus. Edit those directly to add your project's rules, patterns, and decisions. The pipeline reads the protected `docs/*` corpus on session start and gets phase-specific guidance just in time through prompt templates and skills; it does not read adopter agent files.

Task templates are managed by canon — `canon upgrade` overwrites `.canon/templates/*`. To customize a template for your project without losing your changes on upgrade, copy it to `tasks/_templates/<file>` — `canon task new` checks there first and falls back to `.canon/templates/`.

## Related References

- `AGENTS.md` / `CLAUDE.md` — adopter-owned operator context, when present.
- Canon skills and prompt templates — reusable phase guidance delivered just in time.
- `docs/patterns.md` — implementation patterns and Known Pitfalls.
- `docs/decisions.md` — settled architectural decisions.
- `/canon-pipeline` — command patterns and snag-recovery flows for operating the pipeline.
- `/canon-spec-review` — adversarial pre-pipeline spec review (multi-agent fan-out) for S/M/L/XL or delicate tasks.
