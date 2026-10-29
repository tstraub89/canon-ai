# Pipeline Orchestrator — Reference

Reference for driving canon's pipeline: CLI surface, flags, task-management subcommands, pipeline tiers, the model/effort matrix, environment variables, worktree mechanics, session resumption, auto-block thresholds, and recovery patterns. Read on demand when you need to know which flag to use, why canon picked a particular model, or how to recover from a stuck phase.

For **command patterns and snag-recovery flows**, see the `/canon-pipeline` skill at `.claude/skills/canon-pipeline/SKILL.md` (installed by `canon init`). For **adversarial pre-pipeline spec review**, strongly recommended for any spec with logic to vet, see `/canon-spec-review`.

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

`canon watch --help` prints usage to stdout and exits 0 with no summary line; the summary-line contract covers watching, not help.

```bash
# Normal two-step (Bash tool or headless):
canon run <id>
canon watch <id>
```

**Exit codes:**

| Code | Meaning |
|---|---|
| `0` | Healthy stop — checkpoint (`human_review`), complete, or `--step` step-done (reported only when no crash evidence exists; a pending full-send tail remains live until it stops) |
| `2` | Bad usage, nothing to watch, unreadable state, ambiguous pid disagreement, or launch-window timeout |
| `3` | Auto-block |
| `4` | Crash — orchestrator died, or the run log's last exit marker is non-zero and not older than the task's `status.json` (a stale marker from an earlier run is ignored). For a full-send task at pending `human_review`, this also detects a dead tail; a live orchestrator keeps watch blocking even with a stale heartbeat. These checks apply whether `canon watch` attached before the run exited or after it had already died; run `canon run <id>` to resume |
| `5` | `--timeout` elapsed while still attached |

**Summary line** — always the final stdout line, stable `key=value`:

```
state=human_review reason=checkpoint phase=qa→human_review verdict=approved pid=48213
```

For a crash, the failure reason is printed on stderr; the summary line itself is unchanged.

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

Gracefully terminate a detached run. Sends SIGTERM then SIGKILL if needed. Self-heals stale `.canon-pid` / `.heartbeat.json` when the orchestrator is already dead. The orchestrator forwards the signal to its agent process groups, waits up to three seconds, then sends SIGKILL to surviving groups and allows up to one second for reaping before removing runtime markers and exiting. Phase completion is suppressed during shutdown so it cannot interrupt this cleanup.

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
| `--push` | — | Push the task branch to remote at `human_review`, first pushing canon's own scaffold commits to base (see the remote-boundary gates below). |
| `--pr` | — | Push + create a draft PR at `human_review`, first pushing canon's own scaffold commits to base (see the remote-boundary gates below); prefers QA-drafted `tasks/<id>/pr-body.md` for single-task PRs, with a soft fallback. |
| `--reroute` | — | Reset a task once implementation has begun: current phase `code_review`, `qa`, or `human_review` (any status or verdict), or `implement` when implement is in progress or blocked, code review is blocked, or code review already ran in the current loop (a review round or a pre-flight rejection). In a bundle, a sibling at implement pending with no current-loop activity is admitted alongside a task that qualifies when both belong to the same non-empty task branch. Full-tier tasks re-enter at `spec_review`; fast-tier tasks re-enter at `implement`. |
| `--ship` | — | Squash-merge any open PR for the task branch (via `gh pr merge --squash`), delete the remote task branch, pull the base, tear down the worktree, archive `tasks/<id>/` to `_archive/`, and clean up local branches. If the PR was already merged externally, picks up at the cleanup step. |
| `--allow-divergent-base` | — | At `--push`, `--pr`, and `--ship`, bypass only the commit-divergence block when local `<base>` has commits not yet on `origin/<base>`. At `--pr`/`--push`, a rejected scaffold push warns and continues; the flag does not apply when origin has no `<base>` branch. It does not bypass the base-drift gate (merge conflicts and out-of-scope task files); use `--force` for that. |
| `--dry-run` | — | Print the planned phases, agents, model, and effort without spawning an LLM. |
| `--full-send` | — | Pre-clear the human spec gate and auto-open the draft PR at `human_review` — no interrupts. Uses the same scaffold base push as `--pr`/`--push` (see the remote-boundary gates below). On a `delicate` task, requires `--force`. Mutually exclusive with `--reroute` in one invocation. |
| `--force` | — | Bypass operator-confirmation gates after you've verified the situation: reroute amendment-heading pre-flight, base-drift gate (merge conflicts and out-of-scope task files), the dirty-REPO_ROOT guard before first worktree creation, and `--full-send` on delicate. It does **not** bypass the forge-proof merge gate, diff-computation failures, or merge-conflict probe failures. |

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
| `set` | `<id> <field> <value>` | Set flat task metadata with validation. Metadata fields `title`, `task_size`, `delicate`, and `human_spec_gate` remain settable whenever the task is reachable; setting `human_spec_gate true` clears `full_send` with a note, while setting it `false` is refused on delicate tasks (use `canon run --full-send --force`). Topology fields `worktree` and `base_branch` are only settable before `status.branch` is recorded; once branched, `set` rejects them and points operators at recreating the task or migrating `status.json` manually. Redirected: `full_send` → `canon run --full-send` to enable it (it persists until `--reroute` clears it or arming the spec gate does); `status` → `canon task phase`; `branch` → git identity, not `canon task set`; `phases`/`sessions`/`canon`/`escalations` → their owning canon task commands. Immutable: `id`, `created`, `updated`, and `_`-prefixed inline-doc keys. Writes warn after dispatch has started because metadata changes take effect on the next `canon run`. |
| `reset-spec-review` | `<id>` | Clear router-relevant state for a fresh spec-review pass after an auto-block. Zeroes iterations, clears verdict, archives the prior `spec-review.md`, and drops the stored `sessions.author` ID (and its legacy `claude_spec` fallback) so the next pass runs against a fresh Claude spec session. Re-arms `human_spec_gate` unless the task is full-send, because the gate disarms itself when it halts. |
| `reset-code-review` | `<id>` | Clear router-relevant state for a fresh code-review pass after an auto-block. Zeroes the loop-local review counters, clears verdict, archives the prior `review.md` and re-scaffolds a fresh one from the task templates, and drops the stored `sessions.reviewer` ID (and its legacy `claude_review` fallback) so the next pass runs against a fresh Claude review session. |
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
- Effective size selects both the Codex and Claude model/effort cells in the matrices below.
- **Recommended pre-pipeline self-review**: after the spec is written and before invoking `canon run`, run `/canon-spec-review` (task ID optional — it defaults to the task under discussion) to dispatch three parallel sub-agents (structural / factual / spec-quality) at the spec and surface BLOCKING / STRONG / NIT findings inline. Catches the class of issues Codex's spec_review would surface across 2-3 iterations in one ~15-min pass, and its factual lens also finds gaps Codex's spec_review tends to miss, such as a second implementation of the changed behavior that the spec does not name. Strongly recommended for every spec with logic to vet; on the fast tier it is the only automated spec review.

**Where validation happens**: Project-specific checks (lint, type-check, unit tests, e2e, etc.) run inside agent phases — Codex runs them during `implement` and records outcomes in the handoff; Claude verifies the outcomes table in Stage 1 code review and re-runs selectively when anything looks off. There is no separate orchestrator-run validation phase.

**Bundle mode**: Pass multiple task IDs to `canon run`. All tasks process together per phase (one agent session each). Tier is set by the most complex task — any S/M/L/XL/delicate pulls the whole bundle to full tier. On code-review `changes_requested`, the entire bundle reroutes to implement. On code-review `spec_gap`, the whole bundle blocks until the operator chooses fix (`canon run <ids> --reroute` after amending the `spec_gap` task specs) or bless (`canon task accept <ids> code_review --reason "<why>"`).

**One pipeline at a time**: Run only one task or bundle through `canon run` at a time. A second concurrent invocation would share the working tree and corrupt both branches. Worktree mode (see below) is the exception: each task gets its own in-repo directory, so concurrent runs are possible if each task has `worktree: true`.

## Task Sizing Fields

Set in `status.json` at task creation:

| Field | Values | Purpose |
|---|---|---|
| `task_size` | `XS \| S \| M \| L \| XL` | Drives the pipeline tier and effective-size model/effort cells for Codex and Claude. XS is fast-tier; S+ runs the full pipeline (including Codex spec review). |
| `delicate` | `true \| false` | Forces the XL bucket (full Codex model and high Claude spec/plan/code-review effort) regardless of nominal size. Set when an undetected bug has materially harder-to-recover blast radius than a normal bug — common examples: auth, payments, premium gating, persistent storage migrations, security-sensitive cryptography. Project-specific surfaces also qualify (medical PHI, scientific reproducibility, regulated data). The bar is *blast radius*, not difficulty. |
| `human_spec_gate` | `true \| false` | **Single-use latch**, not a persistent toggle. `true` arms a one-time halt after `spec_review`, before planning (default: `true`). A human can re-arm it with `canon task set <id> human_spec_gate true`; setting it `false` on a delicate task is refused. The orchestrator flips it to `false` *at the moment it halts*, but a human can also disarm it, so `false` means "fired, pre-cleared, or disarmed," not proof the gate fired. See [Spec gate is a single-use latch](#spec-gate-is-a-single-use-latch). |
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

A `delicate` task carries meaningful regression risk on a security-sensitive surface and promotes Codex spec review and implementation to the full model, alongside stronger Claude review. "It's technically wrong" is not sufficient justification on its own — a hardening pass on auth/payments/storage that no user has ever hit can take significant pipeline time, introduce regression risk, and produce zero customer-visible value. Before scoping any task as `delicate: true`, require at least one confirmed production incident or a concrete upcoming flow that depends on the fix. Note the incident in the spec's *Problem* section.

This is a default — your project can adopt a stricter or looser bar in `docs/decisions.md` if it has different risk tolerance (e.g., a medical-data project with regulatory exposure may want proactive hardening).

## Codex Model/Effort Matrix

Codex model and effort come from a fixed phase × size matrix:

| Phase | XS | S | M | L | XL / delicate |
|---|---|---|---|---|---|
| `spec_review` | — (skipped) | mini / high | mini / high | mini / high | full / high |
| `implement`   | mini / xhigh | mini / xhigh | mini / max | mini / max | full / high |
| `code_review` (cold lens) | mini / high | mini / high | mini / high | mini / high | mini / high |

Codex is tuned for token efficiency — the mini model handles most phases; the full model only comes out for XL or delicate work. Effort comes only from this matrix; there is no Codex effort environment override. M/L implement runs use Luna at `max`, while XL/delicate runs use Sol at `high`: delicate work already gets the stronger model, and Sol at `xhigh` costs about 1.5–2× Sol at `high`. Re-evaluating the full model's effort curve remains a separate follow-up.

The cold-Codex `code_review` lens is deliberately flat: as a mandatory hard-fail gate, it runs at `high` effort and stays on the mini model at every size, including XL/delicate.

`spec_review` runs at `high` at every size that runs it. S moved up from `medium` after a replay of approved specs whose tasks were later rerouted: `high` caught more of the known spec gaps than `medium` and blocked no more clean specs, for about twice the tokens of a short review. `xhigh` and `max` caught slightly more again but cost 3–5× `high`'s output tokens. M moved up earlier: task-history analysis found M's excess code_review iterations weren't an implement-quality gap (non-rerouted M and L tasks ran at nearly identical iteration counts) but a reroute-severity gap, with M's lighter spec_review effort the leading hypothesis. M and L also differ on loop cap and budget, so this isn't a proven sole cause; if you retune the matrix, re-measure your own M vs. L reroute rate.

## Claude Model/Effort Matrix

Claude model and effort scale with effective task size. The light tier defaults to `sonnet`, the strong tier defaults to `opus`, and `qa` uses its own default model, `claude-haiku-5-5`:

| Phase | XS | S | M | L | XL / delicate |
|---|---|---|---|---|---|
| `spec` | sonnet / medium | sonnet / medium | opus / medium | opus / medium | opus / high |
| `plan` | sonnet / medium | sonnet / medium | opus / medium | opus / medium | opus / high |
| `code_review` | sonnet / medium | sonnet / medium | opus / medium | opus / medium | opus / high |
| `qa` | claude-haiku-5-5 / medium | claude-haiku-5-5 / medium | claude-haiku-5-5 / medium | claude-haiku-5-5 / medium | claude-haiku-5-5 / medium |

`spec`, `plan`, and `code_review` move to the strong tier at M, where sustained judgment matters; only XL/delicate raises effort to `high`. QA writes completion artifacts and cannot reroute a task (it can only stop the pipeline by marking `qa` blocked), so it uses its own default model rather than the light tier. The operator reports an uncontrolled field sample of about 37 tasks across canon-ai and an adopter with no QA failures, budget-cap hits, or retries; the 20 canon-ai `claude-haiku-5-5` QA invocation rows are all `ok` and took 44–214 seconds. Set `CLAUDE_MODEL_QA=sonnet` to restore the previous QA model. No Claude cell runs above `high`.

## Claude Budget Matrix

Claude phase budgets scale with task size. `spec`/`plan`/`qa` are single-pass Claude sessions and share one curve; `code_review` runs a structurally costlier workload — a cold-Codex diff review followed by a Claude foreman that spawns an anchored-Claude lens and a cold-Claude lens and synthesizes all three, sometimes including an empirical test-suite re-run to confirm a finding discriminates — and gets its own, higher curve.

| Phase | XS | S | M | L | XL / delicate |
|---|---|---|---|---|---|
| `spec` / `plan` / `qa` | $5.00 | $5.00 | $10.00 | $10.00 | $20.00 |
| `code_review` | $5.00 | $10.00 | $15.00 | $20.00 | $40.00 |

`CLAUDE_BUDGET` remains a single flat env-var override: when set, it applies uniformly across every phase and size, exactly as before. See `CLAUDE_BUDGET` in the Environment Variables section below.

## Environment Variables

Claude uses the light tier for XS/S spec, plan, and code review only. QA uses its own default model. M and above use the strong tier for spec, plan, and code review. A phase pin changes only the model; effort comes from the matrix.

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_MODEL_LIGHT` | `sonnet` | Model for light-tier cells: XS/S `spec`/`plan`/`code_review`, unless a phase pin applies. |
| `CLAUDE_MODEL_STRONG` | `opus` | Model for strong-tier cells: M and above `spec`/`plan`/`code_review`, unless a phase pin applies. |
| `CLAUDE_MODEL_SPEC` | _(unset)_ | Pins the `spec` model at every size, replacing the model only; effort still comes from the matrix. |
| `CLAUDE_MODEL_PLAN` | _(unset)_ | Pins the `plan` model at every size where a separate plan phase runs (XS fast tier combines spec and plan under the `spec` cell), replacing the model only; effort still comes from the matrix. |
| `CLAUDE_MODEL_REVIEW` | _(unset)_ | Pins the `code_review` model for XS/S/M/L only, replacing the model only; effort still comes from the matrix. Does not reach XL/delicate. |
| `CLAUDE_MODEL_REVIEW_LARGE` | _(unset)_ | Pins the `code_review` model for XL/delicate only, replacing the model only; effort still comes from the matrix. `_LARGE` means task size, not model tier. Does not reach XS–L. |
| `CLAUDE_MODEL_QA` | _(unset; QA default is `claude-haiku-5-5`)_ | Pins the `qa` model at every size, replacing the model only; effort still comes from the matrix. This is QA's only override besides legacy `CLAUDE_MODEL`. Set it to `sonnet` (or the previous light-tier model) to restore the pre-change QA model. |
| `CLAUDE_MODEL` | _(unset; deprecated)_ | Legacy catch-all model for every Claude phase, including `qa`, only where no phase pin or tier variable applies. Phase pin → tier variable (tiered cells only) → this fallback → default (`sonnet` light, `opus` strong, `claude-haiku-5-5` for `qa`). For QA, this fallback applies when `CLAUDE_MODEL_QA` is unset. |
| `CLAUDE_BUDGET` | _(phase- and size-aware)_ | Max spend per Claude phase (USD). Unset → resolved from the Claude Budget Matrix above (phase × size). Set → flat cap applied uniformly across every phase and size (e.g. `CLAUDE_BUDGET=15.00` overrides every phase to $15). |
| `CANON_PROJECT_NAME` | _(reads `package.json` "name" or "your project")_ | Name injected into agent prompts. |
| `CANON_WORKTREES_ROOT` | .canon/worktrees | Where task worktrees are created. When overridden, the orchestrator warns if the path isn't in `.claude/settings*.json` `additionalDirectories`. |
| `CANON_PR_BODY` | _(unset)_ | Literal PR body for `--pr`, overriding the normal resolution chain. Supports `$LABEL` and `$TITLE` placeholders. |
| `MAX_CONTEXT_BYTES` | `65536` | Byte cap on the spec + Affected Files preload injected into Codex's implement prompt. |
| `CANON_NO_DETACH` | _(unset)_ | Set to `1` to keep full-auto runs in the foreground (no auto-detach). |

Codex model overrides:

| Variable | Default | Purpose |
|---|---|---|
| `CODEX_MODEL_MINI` | `gpt-6-luna` | Codex model for XS/S/M/L non-delicate phases. |
| `CODEX_MODEL_FULL` | `gpt-6.1-sol` | Codex model for XL or delicate phases. |
| `MAX_REVIEW_LOOPS` | _size-aware_ | Max `spec_review` and `code_review` iterations before auto-block. Unset → 3 for XS/S/M, 5 for L/XL. |

M/L implementation uses `max`, which requires a Codex CLI and mini model
that accept that effort. This was verified only with Codex CLI 0.164.0 and
`gpt-6-luna`. If an M/L implement call fails on `max`, upgrade the Codex CLI,
point `CODEX_MODEL_MINI` at a model that accepts `max` (or unset it), or
install the previous canon release. There is no effort environment override.

These are canon's shipped defaults at the time of release and may lag
behind what your local `codex` CLI accepts. **Verify they resolve on your
install before relying on the pipeline** — a stale identifier produces a
hard failure on the first phase that needs Codex. If they don't resolve,
set `CODEX_MODEL_MINI` and `CODEX_MODEL_FULL` explicitly to identifiers
your CLI exposes rather than changing the orchestrator contract.

## Worktree Isolation

With `"worktree": true` in `status.json` — the scaffolded default from `canon task new` — implement, code_review, qa, and reroute-time spec_review/plan phases run in a git worktree directory under `.canon/worktrees/` rather than the main repo. This keeps spec files, plan drafts, and other in-flight task artifacts out of the main working tree. Set the field to `false` to opt out and run those phases in the main checkout (canon still creates the `task/<id>` branch there itself).

**Layout**: `.canon/worktrees/<task-id>/` (inside the repo). The root is configurable via `CANON_WORKTREES_ROOT`. Project tooling that walks the repository with root-anchored `**/` globs should exclude `.canon/worktrees/`. `git clean -ffdx` (double force), or removing `.canon`, destroys in-flight worktrees; plain `git clean -fdx` skips them.

**Upgrading from the previous default**: A task whose worktree predates this layout refuses to run with `canon run` until its directory is moved under `.canon/worktrees/<task-id>/` and repaired from the main checkout with `git worktree repair .canon/worktrees/<task-id>` (the path argument is required for a moved worktree), or `CANON_WORKTREES_ROOT` is pinned to the old *parent* location (for example `../dev-worktrees`, not the task directory itself). `canon` commands invoked from inside that old directory hit the existing invocation-root refusal and must be run from the main checkout, where `canon task` still reads and writes the task's real state. `--ship` on such a task still merges and archives it, leaving the old directory behind.

**Missing registered worktrees**: If a canon task worktree is deleted by hand while git still registers it, `canon run` checks every registered `task/*` worktree after the invocation-root guard and stops before any phase. This applies to normal runs and other run modes, but not `--dry-run`, `--ship`, or invocations using `CANON_TASKS_DIR_OVERRIDE`. The refusal names each missing path and branch, and gives `git worktree add -f <path> <branch>` to restore a checkout or `git worktree remove --force <path>` to discard the registration. Anything not yet committed to the branch was lost with the deleted directory. The entry check fails closed if git worktree enumeration fails; canon neither prunes nor recreates worktrees there.

**Main repo stays on its base**: In worktree mode, the orchestrator creates the `task/<id>` branch directly in the worktree. The main repo never checks out the task branch.

**Scaffold-to-base before worktree creation**: On the first `implement` phase call (when no task branch exists yet), the orchestrator commits the full `tasks/<id>/` scaffold — every artifact stub plus `status.json` — to the base branch with message `task(<id>): commit artifacts pre-pipeline`. If `PIPELINE_TELEMETRY_FILES` are dirty (legacy rows left by an older engine; current pre-implement metrics fragments ride the task scaffold commit), a sibling commit follows: `chore: absorb pre-implement telemetry into scaffold for <id>`. Then `ensureBranch` creates the `task/<id>` branch from base, so the new worktree inherits the scaffold via its initial checkout. Without this, the worktree would boot from a base branch that has no `tasks/<id>/` and pipeline phases would have nothing to read. On re-runs of `implement` (reroutes, review iterations) the worktree already exists and the scaffold-to-base commit is skipped — re-committing it would create divergent commits that fight with the task branch's evolved artifacts at PR-merge time. The scaffold hint is printed only when an unpushed safe scaffold commit is detected; it says `--pr`, `--push` and full-send push the scaffold when every unpushed base commit carries only task artifacts and pipeline telemetry.

**Dirty source guard before first worktree**: Before the first worktree is created, the orchestrator inspects `REPO_ROOT` with `git status --porcelain=v1 -uall`. Dirtiness under `tasks/`, `PIPELINE_TELEMETRY_FILES`, and the install record `canon update` writes (`provenance.json` under `.canon`) is allowed because canon owns those paths. Any tracked or untracked source path outside that allow-list aborts worktree creation: commit or stash intentional edits before starting, or rerun with `--force` if the new task should intentionally start from `base_branch` without those local edits.

**Task-state source of truth**: From implement onward, the worktree is canonical for task artifacts (`tasks/<id>/`) and per-task telemetry rows. The main repo keeps the pre-implement scaffold; runtime task-state reads resolve to the worktree when it exists.

**Shared dependency links**: Worktree creation links the root `node_modules` and each eligible npm workspace's installed `node_modules` from `REPO_ROOT` into the task worktree. Eligible workspaces come from non-negated `workspaces` patterns in `REPO_ROOT/package.json` and must resolve inside both checkouts. A missing or hoisted workspace install is skipped silently; an absent worktree workspace is skipped with an info message; and an unsafe destination is skipped with a warning. A real file or directory at the workspace `node_modules` path is left untouched, while a wrong-target symlink or an uninspectable entry aborts initial setup. On later implement entries, canon repairs only missing workspace links in its registered task worktree; it leaves existing root, workspace, and `.env*` entries untouched.

**Project-level resources**: REPO_ROOT remains canonical for `scripts/`, `src/`, root agent files, and other project-level files. Their cross-worktree coordination is separate from task-state resolution. Managed docs and the docs-freshness config are the exception: task phases and the QA-end and human-review commits read them from the active worktree, and only `--ship` reads them from the main checkout. Make config or managed-doc edits for an in-flight task in its worktree.

**Teardown**: `--ship` calls `git worktree remove --force` *before* archiving the task directory — teardown comes first so the archive write targets the main checkout.

**Bundle constraint**: All tasks in a bundle must agree on `worktree`.

## Canon Snapshot Stamping

Every task carries a provenance snapshot in `status.json.canon`. `canon task new` stamps it when the task is created, and the orchestrator refreshes it again before any real phase work begins so older tasks pick up the current canon checkout and CLI versions on the next pipeline run.

- Native checkouts record the canon checkout SHA in both `upstream_commit` and `orchestrator_commit`.
- Vendored checkouts record the submodule SHA in `upstream_commit` and the host repo SHA in `orchestrator_commit`.
- Installed-package runs record `<unavailable>` for `upstream_commit` — never the adopter's own commit — while `orchestrator_commit` still tracks the driving repository's commit (the adopter, or its host when the adopter is itself a submodule).
- Every mode additionally records the executing canon's version in `canon_version`.
- Missing `codex` or `claude` binaries record `<unavailable>` instead of failing the run.
- `--dry-run` is read-only and does not refresh the snapshot.

## Auto-Branch + Auto-Commit

**Auto-branch**: The orchestrator creates a `task/<TASK-ID>` branch before the implement phase and records it in `status.json`.

**Auto-commit**: After implement passes validation, the orchestrator auto-commits source files listed in `handoff.md`'s Changes table — including `### Changes` tables in `## Iteration N` sections (files introduced in later review rounds are valid). If any non-task source files remain dirty after staging, the commit is aborted and the pipeline stops for manual intervention. `handoff.md` must list every changed file including both sides of renames. Specs with a missing or empty `## Validation Required` section are rejected at this gate — handoff validation cannot be bypassed by omitting the section.

If an auto-commit fails, the next `canon run` retries it before code_review's pre-flight; if that retry fails, the run stops before the pre-flight without consuming a review loop.

Before either implement auto-commit (after implement or on the review-entry retry), canon runs the shipped docs-refs checker in the active checkout. Findings in a bundle task's `handoff.md` resume the stored Codex implement session for up to two fix attempts; findings in other files do not trigger a fix-up. With no stored session, a failed fix session, or findings remaining, canon warns and continues with the existing commit behavior. The QA-end commit similarly checks each task's `done.md` and `pr-body.md` and can resume the in-process QA Claude session; remaining findings warn, and the `--pr` gate remains unchanged. Before each fix session canon compares tracked paths Git reports as changed and non-ignored untracked paths in the active checkout, each bundle member's `status.json`, and `HEAD`; any change outside that phase's own artifacts stops the run before commit.

When `qa.status` reaches `done`, the orchestrator commits QA artifacts before stopping at `human_review`. The QA-end commit stages the bundled `tasks/<id>/` directories plus any dirty `PIPELINE_TELEMETRY_FILES` or admitted docs in the active checkout, with subject `chore: QA artifacts for <task-id>` (bundles list every task id). This commit does not push or create a PR. It leaves the worktree clean for `--reroute`, avoids the `--pr` rebase stash/pop dance, and makes post-QA task state durable against local history surgery. The residual implement-to-first-QA window remains: code_review iterations before the first successful QA still have uncommitted phase artifacts. A top-level `node_modules` entry, or the canonical worktree-relative `<destination>/node_modules` for an eligible npm workspace selected by a non-negated pattern in `REPO_ROOT/package.json`, containing a regular `package.json`, not nested under `node_modules`, and contained in both `REPO_ROOT` and the active worktree, is exempt from both this gate's dirty-tree check and the `human_review` dirty-tree check below when a filesystem probe confirms it is canon's untracked symlink to the corresponding `REPO_ROOT` path; anything else at those paths (a staged entry, a real file/directory, a symlink pointing elsewhere, or an entry that fails containment) still blocks normally. For an ordinary workspace directory, `<destination>` equals the declared workspace path; for an in-repo symlinked workspace, it is that directory's canonical destination. The workspace exemption applies only while a distinct task worktree is active. After verified untracked links are removed from classification, any remaining dirty path whose final segment is exactly `node_modules` is rejected before staging.

At `human_review` with `--push` or `--pr`, the orchestrator auto-commits a scoped allow-list before pushing:

- **`tasks/<id>/`** — task artifacts (spec, plan, handoff, review, done, pr-body, notes).
- **`PIPELINE_TELEMETRY_FILES`** (`docs/lessons-learned.md`, `docs/task-quality-log.md`, `docs/pipeline-invocations.md`) — legacy edits remain auto-committed. New task runs write `metrics.md`, `quality-log.md`, and `lessons.md` fragments in each task directory; `--ship` folds them into the shared logs before archiving and deletes the fragments. Runtime writes are fail-soft. Missing fragments are a no-op; fold failures abort before archive-state changes. `--pr` warns on shared-log edits because parallel tasks will conflict there. A non-interactive Claude session that spawns sub-agents also writes one `claude:<agent type>` row per top-level sub-agent; duration comes from the harness and tokens from that sub-agent's own transcript (or `-` when unavailable), separate from the session row.
- **Admitted docs** — `(protected ∪ mapped) − flag_only`, resolved from the project's docs-freshness config (config.json in the .canon directory). The protected set defaults to architecture, codebase-map, patterns, product-context, and decisions; `protected` replaces it. All docs in `paths` values are mapped docs. Admission depends only on config, never on the diff. Affected Files admits protected, mapped, or flag-only docs explicitly assigned to the implementer. **QA-done widening** adds all admitted docs once any task's `qa.status === 'done'`. QA's prompt set is the protected set plus docs mapped from globs matching the task's rename-aware three-dot diff, excluding task artifacts and telemetry. Flag-only docs in that prompt set are reported in done.md's "Docs drift" section instead of edited. QA only corrects stale references; it does not promote lessons into permanent docs. Malformed config stops every consumer without falling back to defaults. Run-start validation precedes heartbeat, status changes, reroute, and ship actions; unknown keys warn. Every form reads the active checkout except `--ship`, which reads the main checkout.

The `--pr` body resolution order is `CANON_PR_BODY` → populated `tasks/<id>/pr-body.md` (single task only) → repo PR template file → `--fill`. Bundles log that per-task QA bodies are not combined and fall back to the template/`--fill` path in this version.

If a dirty file falls outside this union, the pipeline dies with an actionable message describing the allow-list, suggesting either adding the file to `spec.md '### Affected Files'` (for configured docs) or reverting with `git checkout HEAD -- <path>` (for source/test files that should have been committed in the implement phase).

Non-managed Affected Files entries (source files, test files, fixtures) do not enter the `human_review` allow-list as individual files — those belong to the implement phase's auto-commit. Two carve-outs do apply at `human_review`: admitted or flag-only docs listed in Affected Files, and **directory-form entries** (a path ending in `/`, e.g. `dist/`) — a matching prefix is staged as one pathspec, which is the mechanism for build-generated artifacts regenerated late in the pipeline. One shared classifier decodes and normalizes porcelain paths for both the allow-list and stage-path selection. A non-exempt path whose final segment is exactly `node_modules` aborts before staging, while vendored descendants such as `dist/lambda/node_modules/pkg/index.js` remain eligible. Scoped exclusion pathspecs are added only for porcelain-visible links already verified as exempt, so canon's links cannot ride the prefix into a commit and ignored real workspace installs are not explicitly passed to `git add`.

When a configured doc is committed via the Affected Files allow-list, an advisory warning fires per file inviting the operator to `git diff HEAD -- <path>` to verify the content before `--ship` (residual guard against same-file sibling-pipeline overlap).

The orchestrator runs remote-boundary gates before pushing at human_review. First, the base-divergence check fetches `origin/<base>` and lists commits on local `<base>` that are not yet on `origin/<base>`. At `--pr` and `--push`, including full-send, canon pushes the checked tip SHA to base when every commit has an exact canon scaffold or telemetry subject, no merge parent, and changes only paths under `tasks/` or in pipeline telemetry. If any commit is unsafe, nothing is pushed and the existing divergence gate blocks unless `--allow-divergent-base` is set. After a successful push, canon re-lists before deciding divergence, so pushed commits cause no override warning and concurrent local commits still reach the gate. If the range is empty and the remote base exists, canon pushes nothing and prints nothing.

If origin has no `<base>` branch, canon first prunes stale origin refs, then checks commits reachable from local `<base>` and from no live `origin/*` ref. If every local-only commit is canon-safe, it pushes the checked tip to create `origin/<base>`. With an empty range, it still creates the base at the pinned local tip: origin already has every commit, so this publishes only a branch. An unsafe local-only commit blocks with the complete range marked canon-safe or not and a manual push hint; `--allow-divergent-base` does not bypass this block because the PR needs a remote base to target. A rejected creation push also stops even with the flag.

A non-fast-forward rejection says origin has commits local base lacks and directs the operator to run `git pull --rebase` on base before re-running; canon never pulls, rebases, forces, or retries automatically. Other push rejections say the base may be protected and give manual push/merge guidance. With an existing remote base, `--allow-divergent-base` still attempts the safe push; if rejected it warns that the scaffold commits were not pushed, then lists the divergent commits and continues with the override. A fetch failure, including a failed prune, warns and skips the base push and divergence check. List or commit-inspection failures stop before any base push. `--ship` retains its divergence gate without a scaffold push or missing-remote classification: a missing remote base still warns and skips.

Second, for `--pr` and `--push`, the base-drift gate runs immediately before each push, after the human_review commit on the dirty path. It fetches `origin/<base>`, compares the trees for scope drift, and probes `git merge-tree --write-tree HEAD origin/<base>` against the exact commit Git recorded. Any conflicted path blocks, including allowlisted paths, with merge/rebase remediation. Base advance that merges cleanly only prints an info line with the number of files outside this task's Affected Files. Task-changed files outside Affected Files still block; add legitimate paths to the spec's Affected Files table or remove unintended changes from the task branch (with `git checkout origin/<base> -- <path>` and a revert commit, or `git revert <sha>`). On a dirty-path abort, the human_review commit is soft-reset, leaving its changes staged and nothing committed or pushed. This catches conflicts before `--ship` and preserves the scope check for foreign content on the task branch. Git older than 2.38 skips the conflict check with a warning; other probe failures fail closed.

At `code_review` entry, a pre-flight checks the task's own rename-aware three-dot diff against the same Affected Files allowlist, always admitting the admitted docs, including mapped docs even when a later round no longer touches their glob. In a normal run, an out-of-scope file blocks before either review agent runs and does not consume review-loop budget. Add the file to the affected task spec's `### Affected Files` table in the active checkout, then rerun `canon run <id>` (pass every bundle ID for a bundle); or reroute with a note to remove the file. In full-send mode, when every bundle member has `full_send: true`, the foreman judges each file as a scope expansion, spec miss, or change to remove. The first two outcomes require an `## Amendment (full-send scope)` section with an Affected Files row and reason (that heading feeds the Affected Files allowlist but never satisfies the human reroute-amendment gate); the last requires `changes_requested`. The foreman records each judgment in `review.md`, and an unjudged file auto-blocks before QA, including when a review finishes during recovery. Amend the spec and rerun `canon run <id>` to resume an unjudged-file block.

For renames, both the old path and the new path must appear in the spec's `### Affected Files` table. The two-dot diff uses rename detection and surfaces both sides; listing only one side leaves the other as drift. `--force` bypasses conflicts and scope drift with a loud warning after the operator has verified them, but it does not bypass diff-computation or merge-conflict probe failures. `--force` and `--allow-divergent-base` are independent bypasses for distinct gates; pass both only when both the base-drift gate and the commit-divergence are intentional.

For projects that version their releases, changelog and version bump remain a manual human + Claude step; projects that don't version skip it.

## Spec gate is a single-use latch

`human_spec_gate` confuses operators because it looks like a persistent on/off setting and isn't. It is a **one-shot latch the orchestrator consumes the first time the pipeline reaches the gate.**

When the pipeline reaches the gate point with the latch armed, the orchestrator does three things in one step: (1) sets `human_spec_gate = false`, (2) prints the `✋ SPEC GATE` banner, (3) `process.exit(0)`. A human can also re-arm or disarm the latch with `canon task set`; disarming it on a delicate task is refused. The orchestrator consumes the latch at the halt so the **next** `canon run <id>` — the one the human types after approving the spec — passes straight through instead of halting on the same gate forever.

Where the gate fires by tier:

- **Fast tier (XS, non-delicate)**: at `spec_review` phase entry. (In practice the operator usually pre-clears it to `false` when writing the plan, because the human's conversational spec approval *is* the gate — so the runtime halt is often already consumed before the pipeline starts.)
- **Full tier (S/M/L/XL/delicate)**: after Codex `spec_review` completes, before planning.
- **`--full-send`**: pre-clears the latch to `false` at launch, so the gate never fires.

On a full-tier reroute, an armed latch halts after the amendment's `spec_review`, unless that `spec_review` is closed with `canon task accept`, which is itself the human sign-off and skips the gate. A fast-tier reroute re-enters at `implement`, so it never reaches the gate. A reroute does not re-arm a consumed latch by itself; to halt after the amendment's review, run `canon task set <id> human_spec_gate true` before rerouting.

So when you inspect `status.json` mid-pipeline and see `human_spec_gate: false`, read it as **"fired, pre-cleared, or disarmed"**; the value alone does not prove the gate fired or that review was not skipped. Re-running `canon run <id>` after the banner proceeds past the consumed latch.

**Bundle rule**: the gate skip is all-or-nothing. One task in the bundle with the latch still armed re-engages the halt for the whole invocation; `--full-send` must apply to every task in the bundle to skip it.

## Phase Routing + Auto-Block

After `spec_review` or `code_review`, the orchestrator checks the verdict.

| Phase | Verdict | Route |
|---|---|---|
| `spec_review` | `changes_requested` | Loop back to `spec` automatically, except reroute-amendment reviews block for human revision. |
| `code_review` | `changes_requested` / `needs_re_review` | Loop back to `implement` automatically. |
| `code_review` | `spec_gap` | Block the whole `code_review` bundle with an escalation. Fix path: amend the `spec_gap` task specs and run `canon run <ids> --reroute`. Bless path: `canon task accept <ids> code_review --reason "<why>"`. |
| `code_review` | reviewer-set `blocked` (no verdict) | Block the whole `code_review` bundle with an escalation and exit `2`; no evidence recovery or retry is attempted. The stop names each task's `review.md`. Recovery: `canon task reset-code-review <id>` for each task, then `canon run <ids>`. |
| `qa` | session-set `blocked` | Block the whole `qa` bundle with an escalation and exit `2`; no evidence recovery or retry is attempted, even when `done.md` is populated. The stop names each blocked task's `done.md`. Recovery: resolve the cause, then `canon run <ids>` re-runs QA for every member. |
| `spec_review` / `code_review` | `approved` / `approved_with_nits` / `sanctioned` | Continue to the next phase. `sanctioned` is status-only and written by `canon task accept`, not by review artifacts; `canon task accept` refuses a review phase with no recorded verdict unless `--force` is passed. |

**Auto-block on runaway loops**: When spec review or code review reaches or exceeds the size-aware cap (3 for XS/S/M, 5 for L/XL, or `MAX_REVIEW_LOOPS` if set), the orchestrator auto-blocks that review phase and appends an entry to `escalations` in `status.json`. The primary check runs at the next revision phase's entry, before a spec revision or re-implementation starts; the review phase retains the same check as a defense-in-depth backstop for unexpected state. For code review the cap check is the **sum** of `iterations_current_loop` and `preflight_rejections_current_loop` — handoffs bounced by the deterministic pre-flight gate count toward the same budget, and recovery requires resetting both counters (the block message says which). Separately, a pre-flight where every blocker is a `blocked` validation row auto-blocks immediately without consuming loop budget. On approval, `iterations_current_loop` resets to `0` while `iterations_total` (lifetime verdict count) and `auto_block_count` are preserved — history is never erased.

**Agent-session failures park the phase.** Non-interactive agent spawn errors, stalls, signals, non-zero Claude exits, and an unavailable cold-Codex review park the current phase as `blocked`, append an escalation, and exit `2`. Fix the cause (auth, budget via `CLAUDE_BUDGET` for Claude, credits/quota, or network), then re-run `canon run <id>`. In a bundle every member is parked, including any member that already finished the phase; re-run `canon run <id-a> <id-b>` to redo the phase for the whole bundle. No manual phase reset is required. Interactive failures retain their terminal exit behavior, and ordinary non-zero Codex exits still return for phase-completion verification.

**Crashed Codex `spec_review` parks instead of advancing.** When a returning non-interactive `codex exec` spec-review invocation exits non-zero and the phase did not reach `done` through the agent's own `canon task phase` bookkeeping, the orchestrator does not read a verdict from `spec-review.md`. It records `blocked` plus an escalation on every bundle member (including any completed member), reports the exit code and likely recoverable causes (out-of-credits, auth, network, or MCP crash), tells the operator to fix the cause and re-run the same `canon run` command for all members, and exits `2`. This is deliberately fail-closed: a non-zero exit is not a completed review, and the orchestrator cannot distinguish a genuine verdict followed by shutdown noise from a crash that left the prior round's verdict in the cumulative artifact. Trusting that artifact could fabricate a review and inflate the durable counters used by auto-block. The tradeoff is that the rare benign case—a real verdict was written, the process then exited non-zero, and bookkeeping was skipped—also parks and must be re-run. A self-bookkept `done` review still continues despite a trailing non-zero exit, and clean-exit evidence recovery is unchanged. Interactive Codex failures exit before this recovery path, while `code_review` is Claude-owned and cannot trigger this Codex-specific park.

**`Fail – unrelated` result state**: When a required check fails due to a pre-existing flake or a test outside the task's Affected Files, Codex may record `Fail – unrelated` in the Validation Outcomes table instead of blocking on a bare `Fail`. The deterministic pre-flight gate accepts this state — with one anti-laundering exception: if the Notes cite a file this task changed, the row is a regression (a failure in your own diff can't be relabeled unrelated). The gate does **not** otherwise judge the credibility of the "unrelated" claim; the code-review prompt instructs Claude to assess whether the explanation is credible and the failure is genuinely out of scope. This is part of the gate's deliberate division of labor — see the note below.

**The validation-outcome pre-flight is structural, not spec-matching.** The deterministic gate that runs before code review asserts only what it can judge unambiguously from the handoff's Validation Outcomes table: the spec declares at least one required check, every recorded row is filled in (no leftover template placeholder), and no row is an unexplained failure (a plain `Fail`, or a `Fail – unrelated` citing a changed file). It deliberately does **not** pair each spec-required check to a handoff row by prose — that string matching repeatedly false-blocked valid work when the spec's wording and the handoff's cell text drifted apart. Whether each specific required check was actually run (present, and not wrongly skipped or marked `N/A`/`not_configured`) is judged by Claude in Stage 1 code review, which reads the outcomes table against the spec — see "Where validation happens" above.

If the human authorizes more iterations, override via env var rather than hand-editing `status.json`:

```bash
MAX_REVIEW_LOOPS=5 canon run <id>
```

After the normal revision-entry block, a cap-raised resume runs the deferred `spec` or `implement` revision first and returns to review only after that revision completes. Resuming without raising the cap re-blocks immediately without consuming another agent cycle.

For a genuine rescope instead of a cap increase, run the matching reset command once per blocked task:

```bash
canon task reset-spec-review <id>
canon task reset-code-review <id>
```

Both reset commands run directly from the loop-cap block state and mark the corresponding predecessor (`spec` or `implement`) done, accepting it as-is so the next run starts review without another revision. To run the deferred revision before review, raise the cap instead. No intermediate phase edit is required.

A `code_review` loop-cap block means implementation has begun, so if the spec itself must change, add the next Amendment section and run `canon run <id> --reroute` instead of resetting. A `spec_review` loop-cap block is not admitted by `--reroute`: revise the spec normally and resume with a raised cap, or run `canon task reset-spec-review <id>` to accept the current spec for re-review.

`task_size` is also a live lever here, not just a creation-time setting — `canon task set <id> task_size <size>` takes effect on the very next `canon run` (see `canon task set` above). If rounds keep producing new findings clustered in the same file or mechanism rather than a runaway-scope loop, that's a case for bumping the tier as well as the cap, not the cap alone — see "Findings keep clustering in the same mechanism" in `/canon-pipeline`'s `recovery.md`.

## Session Resumption

The orchestrator resumes agent sessions across phases instead of spawning fresh ones — for the phases that participate in a resumption cluster. Plan and QA sessions are intentionally one-offs (never stored); QA’s session id may still be resumed in-process for the artifact fix-up above, but is never persisted. Code-review round 1 always starts fresh even when a prior `reviewer` session exists; only round 2+ resumes it. For participating phases, the session ID is discovered and stored in `status.json` by phase: spec → `sessions.author`, spec_review → `sessions.spec_reviewer`, implement → `sessions.implementer`, code_review → `sessions.reviewer` (spec review has its own slot so it never clobbers the implement session). Subsequent phases for the same agent pass `--resume <id>` (Claude) or `codex exec resume <id>` (Codex), preserving conversation context and skipping doc re-reads.

Role keys win on read; when absent, canon falls back to the old keys: author ← claude_spec, spec_reviewer ← codex_spec_review, implementer ← codex, reviewer ← claude_review. New sessions are written only to role keys. Clears remove both keys of a pair; when clearing a session manually, remove both its role and legacy key to force a fresh run. Full-tier reroutes also clear the spec_reviewer / codex_spec_review pair. The phase's agent field records the backend that actually ran; it does not select a runner.

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

Code review starts with a cold-Codex diff review run by the orchestrator in the active worktree: `codex exec review --json -c model_reasoning_effort=<effort> --base <reviewBase> -m <miniModel>`, where canon resolves `<miniModel>` and `<effort>` through the `code_review` policy row (mini / `high` at every size). The captured findings are written verbatim to `tasks/<id>/review-cold-codex.md` for every task in the invocation. Bundles run this once over the combined branch diff, and the same findings reach every member.

The review base is the task's base branch for Round 1, effective XL or delicate tasks, an absent or unusable previous-round archive, a delta touching a path outside the previous change set, or a delta over 400 added and deleted lines. Otherwise the base is the reviewed SHA in the newest archive for round N−1. Both path sets include both sides of renames; task artifacts and telemetry do not count toward the path or line triggers. Missing, unresolvable, non-ancestor, or HEAD-equal previous SHAs force a full review, as does a failed delta path or line-stat probe. Every successful cold-Codex invocation adds `tasks/<id>/review-cold-codex-run-N.md` with a header recording round, reviewed SHA, scope, base, and reason; the unnumbered file retains only the latest verbatim findings.

If the cold-Codex review cannot be obtained (no captured findings output, spawn error, stall, or signal), `code_review` stops before any Claude session. Re-run `canon run <id>` when Codex is available; there is no two-Claude-lens fallback. Successful runs emit one duration line in the run log: `→ cold-codex review (<taskIds>): <n>s`.

After that, the foreman receives the cold-Codex findings as the pre-obtained third lens input. On a full round, the prompt includes `git diff <baseBranch>...HEAD` from the active worktree, capped at 50,000 bytes. On a delta round, it includes `<prevSHA>..HEAD` for cold-Claude and explicitly tells anchored Claude to retrieve the full task diff by command. If the delta diff cannot be injected, the foreman is told to retrieve it by command before spawning cold-Claude. Anchored Claude also receives spec/handoff/prior review context; cold-Claude remains spec-blind. The prompt states the scope, base, and reason and tells the foreman to record them in `review.md`.

## Per-Iteration Prompt Slimming

Round 2+ of code review and implement do not re-inject the full task framing. Resumed sessions already have spec/plan/repo conventions in context, and round-1 findings are durable in the artifacts. Code review selects a full or delta scope as described above, then re-obtains cold-Codex findings and re-runs the Claude lenses from scratch before the foreman synthesizes the new verdict.

**Cumulative artifacts.** `handoff.md` and `review.md` grow by section per round:
- Round 1 fills the existing template structure.
- Round 2+ APPENDS a new `## Iteration N` (handoff) or `## Round N` (review) section near the bottom.
- Earlier sections stay untouched as the cumulative record.

The append-don't-rewrite convention is enforced both in the prompts and via a comment block at the bottom of each template showing the expected shape.

**Resumed-session prompts.** The code-review foreman prompt renders the round number and prior handoff iteration, then asks the foreman to spawn both Claude lenses and synthesize their findings with newly obtained cold-Codex findings. Delta rounds inject only the capped fix diff for cold-Claude and direct anchored Claude to retrieve the full task diff by command. Full rounds inject the capped full task diff as before. The foreman re-fills the AC table and appends `## Round N` to `review.md`; implement revisions point at the prior round's findings.

The Stage 1 AC table is redone on round 2+. Earlier AC tables were snapshots of earlier code states; a revision can fix a cited finding while regressing an unrelated AC. Every AC appears every round. ACs whose relevant code paths did not change may be marked `Met (unchanged from round N-1)` with a one-line evidence pointer rather than re-derived evidence. Implement-revision prompts are composable: code-review reroutes point at the new `## Round N-1` of `review.md`.

**Round-3+ tightening.** When the round number reaches 3, the prompt adds a discipline rule: findings must be `correctness bug` or `spec gap` only. No `optional cleanup/nit` and no wording-only changes. Encoded as: "we are tightening, not exploring." Without this, round-by-round wording-quibble creep eats the loop budget.

**Anchor markers.** Slim prompts open with a literal `[ITERATION N]` or `[REVIEW ROUND N]` token. On a resumed session, the model can otherwise drift back to thinking it's finishing the prior round. The marker is a cheap anchor.

**Session-neutral by design.** Slim prompts must work whether the session resumed cleanly or fell back to fresh (stale resume). The way to ensure both: name every file the agent might need (`review.md §Round N`, `handoff.md §Iteration N`, the diff). A resumed session can skip the re-reads; a cold-start fallback re-reads the named files. No special-cased dispatch logic.

**Implementation note.** When a slim prompt instructs "do not re-read spec.md unless a finding requires it" *and* the session is unexpectedly fresh, the agent will dutifully skip the re-read and miss critical context. Always phrase the read instruction conditionally — "if your context is cold, re-read X" — rather than absolutely.

## Human Reroute

`--reroute` is admitted once implementation has begun: current phase `code_review`, `qa`, or `human_review` (any status or verdict), or `implement` when implement is in progress or blocked, code review is blocked, or code review already ran in the current loop (a review round or a pre-flight rejection). In a bundle, a sibling at implement pending with no current-loop activity is admitted alongside a task that qualifies when both belong to the same non-empty task branch. Name every task of a shared-branch bundle in one reroute; a reroute that names only part of it is refused before any state changes, and the message lists the missing tasks. A task admitted as a sibling is not exempt from the amendment requirement: it needs its own Amendment section, just like the task that qualifies. Reroute sets `phases.implement.rerouted = true` so later reroute prompts read `spec.md` for new Amendment sections, establish current state from the worktree and any filled-in prior artifacts, and implement the amendment plus unfinished original ACs and earlier amendment rounds (the newest amendment wins on conflict).

**Deciding to reroute a task is a human decision.** An agent driving canon — including under `--full-send` or another autonomous mode — must obtain an explicit human decision before invoking `--reroute`; it is never something the agent infers or decides on its own initiative. `--reroute` has no interactive confirmation step of its own, so this is a documentation-level requirement, not a code-enforced one.

Write the new requirements into **`tasks/<id>/spec.md` in the active task directory** for every named task as an Amendment section — except on a spec_gap-entry reroute (every named task blocked at `code_review` with at least one `spec_gap` verdict), where only the `spec_gap` tasks need an Amendment section; approved or other non-gap siblings in the same bundle do not. If a worktree exists for the task, edit the worktree copy; edit REPO_ROOT only before the task has a worktree. `review.md` alone is not sufficient — Codex reads `spec.md` as the contract.

Full-tier reroute (any S/M/L/XL task or any `delicate` task) re-enters at the same review altitude as the original spec — `spec_review` → `plan` → `implement` — regardless of which admitted state the task was rerouted from: `code_review`, `qa`, or `human_review` (any status or verdict), or `implement` when implement is in progress or blocked, code review is blocked, or code review already ran in the current loop (a review round or a pre-flight rejection), or an approved implement-pending bundle sibling with no current-loop activity alongside a qualifying task on the same non-empty task branch. Codex reviews the amendment in the context of the previously approved ACs and prior `spec-review.md`, without auditing `handoff.md`, `review.md`, or `done.md`. If the amendment is approved, the pipeline flows through to `plan` unless the operator re-armed the human spec gate first, in which case it halts at the gate. Once past `spec_review`, Claude appends a reroute plan section (`## Reroute Plan` or `## Reroute Plan Round N`) to `plan.md`; Codex then implements the amendment plus unfinished original ACs and earlier amendment rounds, using that reroute plan.

An implement-entry reroute leaves the aborted round’s uncommitted source edits in the worktree; a modified tracked source file omitted from the handoff’s Changes table blocks the auto-commit whenever the handoff lists other uncommitted changes (if it lists none, the omitted file stays uncommitted until the QA-end check rejects it), while an untracked file is committed only if listed. An omitted untracked file stays out of the commit, unseen by code review, until the QA-end check rejects it. Delete leftovers the amendment makes obsolete rather than listing them. Rerouting from `implement`, `code_review`, or a `qa` `pending`/`in_progress` entry happens before the QA-end commit, so task artifacts may still be uncommitted in the worktree. `--reroute` performs no git operation itself, so nothing is destroyed by the reroute. Do not run a manual git command that can discard uncommitted state (`reset --hard`, `checkout HEAD~N`, `stash drop`, or equivalent) in that window.

Reroute archives each named task's `review.md` to `review-prior-<n>.md` in the active task directory, where `<n>` is one greater than the highest archive number already present (or 1 when none exist). It archives every task before changing any task's `status.json`; if an archive fails, reroute aborts without mutating any member's status, while any already-completed rename remains safely preserved on disk. A `review.md` that is still the pristine scaffold is left in place and produces no archive. After archiving a filled review, reroute writes a fresh `review.md` scaffold into the task directory — from the project's `review.md` override under `tasks/_templates/` if it keeps one, otherwise from `.canon/templates/review.md` — so the code-review foreman fills the same template structure a new task starts with. If neither template exists, reroute warns and continues; the foreman then writes the file from scratch. Reroute also drops the stored `sessions.reviewer` ID (and its legacy `claude_review` fallback), so post-reroute code review starts a genuine round 1 rather than resuming a session that remembers prior rounds. Rerouted tasks’ prompts point at the newest archive when one exists; its unresolved findings remain binding unless the amendment supersedes them. Exempt siblings fall back to `review.md` when no archive exists.

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

**Normal sequence**: `--pr` (push + draft PR) → mark PR ready, get it approved → `--ship` (merge + archive + cleanup, all in one). `--ship` calls `gh pr merge --squash` itself, deletes the remote task branch, and deletes the local branch only after tearing down the worktree that holds it, so don't merge the PR manually — canon's `--ship` controls that cleanup ordering. If you've already merged the PR externally, `--ship` detects the merge and picks up at cleanup. Running `--ship` with no PR open at all archives the task without the implementation landing — don't do that.

**Note on merge strategy**: `--ship` uses `gh pr merge --squash` as canon's default merge strategy. Projects that use rebase-merge or merge-commit should handle the merge outside canon, then run `--ship` afterward so it can detect the merged PR and proceed with cleanup.

**Shared-doc dirt at `--ship`**: when at least one shipped task is worktree-mode, the supervising checkout can carry uncommitted shared-doc dirt, most commonly telemetry rows an older engine appended. Dirty configured docs (protected, mapped, or flag-only) abort `--ship` before anything merges; the error names each file and instructs commit-or-stash, and `--force` does not bypass this gate. Dirty telemetry files are preserved only when the uncommitted content is a byte-for-byte pure append over the HEAD copy: the suffix is backed up to disk, the working copy is reverted to HEAD, and after the archive changes are staged but before they are committed, the suffix is re-appended as an uncommitted change. Non-append telemetry dirt, or a telemetry file that cannot be read at HEAD, aborts pre-merge like configured-doc dirt. Nothing is silently discarded.

`--ship` runs in this order: (1) classify supervising-checkout shared-doc dirt for worktree-mode ships, aborting pre-merge for configured-doc or unsafe telemetry dirt and temporarily preserving safe telemetry appends, (2) verify local `<base>` has no commits ahead of `origin/<base>` unless `--allow-divergent-base` is passed, (3) merge any open PR for the task branch via `gh pr merge --squash` and delete the remote task branch, (4) pull or fast-forward the base branch when needed, (5) run any project-specific post-merge hook under `.canon/hooks/`, (6) prove the task's merge before local branch deletion, (7) fold task telemetry fragments into the three shared logs in argument order and remove the fragments, aborting on failure before any archive-state change, (8) `git worktree remove --force` if a worktree was active, (9) archive `tasks/<id>/` to `tasks/_archive/<id>/` in the main checkout, (10) stage archive changes plus all three shared telemetry docs, re-append preserved telemetry dirt as uncommitted supervising-checkout changes, commit and push the archive changes, and clean up local branches. **`--ship` fails closed if `handoff.md` is missing** — a task cannot be archived without validation evidence. Similarly, closing `human_review` without a `handoff.md` present fails with an explicit error rather than silently succeeding.

**Failure after the telemetry fold**: fragment deletion prevents a second fold, but does not make later archive, commit, or push failures automatically recoverable. Preserve the folded shared docs and any completed archive moves; do not reset or check out the shared docs, since the consumed fragments cannot regenerate those rows. Inspect the working tree and index, resolve the reported archive/commit/push problem, and commit and push the intended folded docs and archive changes on the declared base branch, keeping any sibling telemetry out of that commit. Complete any remaining task/archive cleanup manually as needed. Before retrying still-unarchived tasks in worktree mode, preserve their already-folded docs in a commit: the dirty-doc guard may refuse quality-row edits or classify appended metrics/lessons as sibling dirt. Do not assume a plain `--ship` retry will finish a partially archived task. If only the push failed, the `chore: archive` commit already holds the folded docs and archive moves locally: fix the push problem and run `git push origin <base>`; do not reset the local base or re-run the fold.

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
- `/canon-spec-review` — adversarial pre-pipeline spec review (multi-agent fan-out); strongly recommended after authoring any spec with logic to vet.
