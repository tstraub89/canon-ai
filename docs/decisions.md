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

**Rule**: When adding a new cross-phase contract, add a markdown file to `tasks/_templates/` with a documented schema. Don't pass data through stdout, env vars, or in-memory orchestrator state across a phase boundary.

---

## Two distinct agents (Claude + Codex), never reviewing own output

**Decision**: Claude is the architect/reviewer/QA. Codex is the implementer/spec-reviewer. Each agent reviews the *other*'s output, never its own.

**Why**: A single agent doing everything is simpler — fewer prompts, fewer model integrations, no inter-agent contracts. But every agent has a blind spot for its own work: the same priors that produced output X tend to validate output X. Cross-review is what catches dropped ACs, scope drift, and subtle correctness bugs that a self-review would rationalize. The two-model split also lets each model do what it's best at — Claude leans architectural and tone-aware, Codex leans implementation-focused — with the spec/review boundary forcing structured handoffs that reduce silent disagreements.

**Rule**: No agent reviews its own output. Spec reviews go to Codex; code reviews go to Claude. If a future change adds a new phase, the agent assignment must preserve cross-review (the agent that authored the artifact is not the agent that reviews it).

---

## Worktree isolation default-on (vs. opt-in)

**Decision**: `tasks/_templates/status.json` defaults `worktree: true`. Tasks run in a separate git worktree on a separate branch by default; opt-out is a deliberate per-task flag.

**Why**: The alternative — opt-in worktrees, simpler default — produced a real footgun before this decision: two `run-task.ts` invocations on the same branch corrupted each other's git state. Worktree isolation makes that impossible by giving each task its own working tree. The cost of default-on is one extra directory per task; the cost of default-off is occasional unrecoverable git-state corruption. Asymmetric — default to safety.

**Rule**: New tasks should keep `worktree: true` unless there's a specific reason not to (e.g., the task is canon-on-canon orchestration tweaks where the supervising orchestrator must run in the same checkout). Opting out is a deliberate per-task call, documented in `notes.md`.

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

## Pure routing policy extracted into `pipeline-policy.ts`

**Decision**: Tier detection, sizing, model/effort selection, and loop-cap defaults live in a pure side-effect-free module (`scripts/pipeline-policy.ts`). The orchestrator passes resolved config in; the policy returns decisions out.

**Why**: Routing logic was originally spread across `run-task.ts` as inline conditionals. The drift was real — multiple `if (size === 'XL' || delicate) ...` checks that diverged subtly over time. Extracting into a pure module gave us **(1)** a single place to change routing, **(2)** table-driven tests in `tests/pipeline-policy.test.ts` covering every cell of the size × phase matrix, and **(3)** a clean boundary between "what does the env say?" (resolved in `run-task.ts`) and "what should we do?" (decided in `pipeline-policy.ts`). The cost of extraction (one extra import, slightly more ceremony) is paid back the first time a routing rule changes.

**Rule**: Any new routing decision (model choice, effort, tier, loop cap) goes in `pipeline-policy.ts`. Add a row to `pipeline-policy.test.ts`. Do not write inline routing in `run-task.ts`.

---

## Agent CLIs as subprocesses (vs. direct API calls)

**Decision**: The orchestrator drives the `claude` and `codex` CLIs as subprocesses. It does not call Anthropic or OpenAI APIs directly.

**Why**: The alternative — direct API calls — was attractive for control (precise prompts, structured outputs, custom retries). But the CLIs already solve session continuity (`--resume <session-id>`), model selection, credential management, and the streaming UX that humans rely on when watching the pipeline. Reimplementing those layers would be a meaningful chunk of code, with no functional benefit until canon-ai needs something the CLIs can't express. The CLIs also let humans intervene mid-run (Ctrl+C, inspection, manual continuation) using the same tooling they already know.

**Rule**: New agent capabilities go through the CLI surface. If a feature requires direct API access, escalate — that's a real change in dependency shape and deserves its own decision entry.

---

## Auto-commit owned by the orchestrator (not the agent)

**Decision**: After Codex's `implement` phase passes validation, the orchestrator (`autoCommitCode()` in `run-task.ts`) parses the handoff Changes table and creates the implement commit. Codex does not run `git commit` itself.

**Why**: The alternative — Codex manages its own commits — produced two failure modes. **(1)** Inconsistent commit messages, untracked files swept in, partial commits left mid-implement. **(2)** No structural guarantee that the commit matches the handoff. Centralizing the commit step in the orchestrator gave us a single chokepoint to enforce: every dirty file must be in the handoff Changes table; every handoff file must exist or be already-committed. That cross-check is the load-bearing safety property that makes code review meaningful — the reviewer knows the diff and the handoff agree before they start.

**Rule**: Codex must not run `git commit` during implement. The orchestrator owns the commit. If `autoCommitCode()`'s constraints feel too tight (e.g., a legitimate change needs files outside the handoff table), the fix is to update the handoff, not to bypass the auto-commit.
