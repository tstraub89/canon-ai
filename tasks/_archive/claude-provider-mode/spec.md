# Spec: claude-provider-mode — Claude-only provider mode

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

canon requires both Claude Code and the Codex CLI. An operator who has only one subscription, or who runs out of Codex quota partway through a task, cannot finish work in canon. The foundation task `agent-backend-role-routing` (merged as tstraub89/canon-ai#134) routed every phase through role-keyed agent backends, but the role→backend map is a fixed module-private constant (`DEFAULT_ROLE_ASSIGNMENT` in `src/lib/pipeline-policy.ts`), and nothing can select or pin another assignment. `docs/decisions.md` §"Phases route by role through agent backends (2026-10)" records the constraint this task must honor: a session id is valid only for the backend that created it.

Pointing spec_reviewer, implementer and cold_reviewer at Claude today breaks in these confirmed places (traced by reading the code; this is a feature, so no red-first mechanism applies):

- **No Claude config for spec_review or implement.** `claudeBackend.resolveConfig` throws for both phases, so `canon run --dry-run`, `retryAgentForPhase` and `fixUpImplementArtifactRefs` would crash. `ClaudePhase`, `CLAUDE_CELLS`, `claudeMatrix`, `claudePinFor` and `BUDGET_BY_PHASE_AND_SIZE` have no rows for them.
- **Cold review.** `code_review` always runs the orchestrator's cold lens and hard-fails when it is unavailable; the Claude backend's `coldReview` rejects. The foreman already spawns a spec-blind cold-Claude sub-agent, so an orchestrator cold-Claude lens would duplicate it (decided: drop it in Claude mode). Delta scope (`resolveCodeReviewScope` via `findColdCodexArchiveForRound`) depends on the numbered `review-cold-codex-run-N.md` round record, so dropping the lens must not drop the record.
- **Session loss on park.** Claude raises `AgentSessionError` on any non-zero exit, including budget exhaustion, and sessions are stored only after a phase returns normally, so a parked Claude implement or spec_review loses its session. Codex returns its session id on a non-zero exit. The existing resume gates also cannot resume a park: implement resumes only from `in_progress` (a park sets `blocked`), its resume prompt (`promptImplementResume`) asserts "The code changes are already complete", and spec_review treats any resumed session as a re-review (`isReReview = resumeId !== null`) and tells the reviewer the spec was revised.
- **False text.** `CODEX_STARTUP` (`src/orchestrator/prompts/helpers.ts`), used by the spec-review and implement prompts, says "the sandbox blocks `.git` writes", which is false for Claude. Prompt templates and builders name Codex as the holder of a role (for example `promptSpec`'s "Codex implements directly from this"), and so do operator log and escalation strings (for example `implement.ts` "Phase: implement (Codex…)", `main.ts` "Codex will re-read spec.md", "Codex marked implement done"). The code-review foreman template frames its whole synthesis around a cold-Codex input. A Claude implementer gets `CLAUDE_HEADLESS`, which lacks `CODEX_HEADLESS`'s rule to always write the artifact and run the phase command, even with Blockers.
- **Dependency checks.** `requiredAgentBackends()` defaults to the mixed assignment and is called with no argument by doctor, by `HARD_DEPS` (computed at module load in `src/cli/deps.ts`) and by the orchestrator's `checkDeps`, so `codex` is always required.

Config collision between the reviewer and the cold reviewer is not a problem to solve: config resolves per backend (`backend.resolveConfig`), and Claude mode runs no cold lens.

## Decision

Add a per-task **provider** that selects the role assignment.

1. **Selecting.** `CANON_PROVIDER` accepts `mixed` (default when unset or empty) or `claude`. It is read only in `src/orchestrator/policy.ts`, at resolution time rather than module load. Any other value, including `codex`, is refused with a message naming the accepted values; for `codex` the message says Codex-only mode is not supported yet. Commands that resolve it (`canon task new`, `canon doctor`, `canon init`) report the message and exit non-zero; none crashes with a stack trace.
2. **Pinning.** `canon task new` stamps `status.json.provider` from the resolved setting. A task without `provider` behaves as `mixed`. A stored value other than `mixed` or `claude` makes `canon run` refuse the task with the AC-1 message. `canon task set <id> provider <mixed|claude>` changes the pin.
3. **One read per run.** `canon run` resolves each task's provider once, at start, and uses that assignment for the whole process. A `canon task set ... provider` during a run takes effect on the next `canon run`.
4. **Mapping.** The pure policy maps a provider to a role assignment: `mixed` is today's assignment; `claude` assigns every role to `claude`. Every backend lookup and every required-binaries computation takes an assignment explicitly; the implicit mixed defaults are removed.
5. **Bundles.** `canon run` refuses a bundle whose members resolve to different providers before any phase runs, naming each task and its provider.
6. **Backend-tagged sessions.** Each stored session records the backend that created it. A session tagged with a backend that differs from the role's current backend is never resumed, checked where each slot is used (not on every read of every slot). Changing a task's provider with `canon task set` clears every session slot whose role changes backend between the old and new assignment and prints which slots it cleared. Untagged sessions (role-keyed or legacy) are attributed to the `mixed` assignment's backend for that role, since every existing session was written under mixed routing. If a mismatched session is still found at use (for example a hand edit), canon warns (slot, stored backend, current backend), clears the slot pair, and the phase starts fresh.
7. **Park keeps the session (Claude provider only).** On a `claude`-provider task, when a non-interactive Claude implement or spec_review session fails (budget, stall, signal, non-zero exit) after its stream yielded a session id, canon stores that id in the role slot, tagged `claude`, before parking. The next run resumes it:
   - **implement** resumes when the phase is `blocked` and a `claude`-tagged implementer session is stored, using a new park-resume prompt: the previous session stopped before finishing (it names the park reason), work may be partial, continue the implementation against the spec and plan, then validate, write `handoff.md`, and run the phase command. Revision and reroute keep precedence, as today.
   - **spec_review** resumes the session, and the "spec has been revised since your last review" preamble is shown only when a previous review round requested changes, not merely because a session is resumed.
   - spec, plan, code_review and QA keep today's park behavior (no session stored). Mixed-provider tasks keep today's park behavior in every phase.
8. **Claude config for spec_review and implement.** Both get Claude cells on the standard Claude row (sonnet/medium XS–S, opus/medium M–L, opus/high XL/delicate), with phase pins `CLAUDE_MODEL_SPEC_REVIEW` and `CLAUDE_MODEL_IMPLEMENT` (every size) following the existing precedence: pin → `CLAUDE_MODEL_LIGHT`/`CLAUDE_MODEL_STRONG` → legacy `CLAUDE_MODEL` → tier default. spec_review uses the single-pass budget curve; implement gets its own curve: XS $10, S $15, M $25, L $40, XL $60. `CLAUDE_BUDGET` remains a flat override for every Claude phase, including these. These cells are reached only on `claude`-provider tasks. Evidence for the row: Anthropic's 2026-09-28 launch charts show Opus 5.5 medium above Sonnet 5.5 high on FrontierCode 1.1 (54.6% vs 49.4%), CursorBench 4.0 (52.5% vs 47.8%) and Terminal-Bench 4.0 (57.6% vs 43.0%), and Sonnet above medium is a poor cost/quality trade.
9. **Code review in Claude mode.** The orchestrator runs no cold lens. The foreman synthesizes its two Claude lenses (anchored and cold sub-agents); its whole prompt is rendered for a two-lens review, with no cold-Codex input, no "do not run `codex`" instruction, no cold-Codex dismissal or archive-header instructions, and no "do not treat a missing cold-Codex lens as approval evidence" line. The orchestrator still writes the per-round numbered record (`review-cold-codex-run-N.md`) with the same header (round, reviewed SHA, scope, base, reason) and a body stating that no orchestrator cold lens runs in Claude mode, so delta scope works from round 2. `review-cold-codex.md` is not written, and a `review-cold-codex.md` left by an earlier mixed-mode round is removed when a Claude-mode round runs, so no stale Codex findings sit beside the current review. Mixed mode keeps the cold-Codex lens, its hard-fail and its prompt unchanged.
10. **Text that names a role holder.** Template-authored prompt text and operator-facing log, banner and escalation strings that name the holder of a role render it from the task's assignment. Under `mixed` every rendered prompt and message is byte-identical to today's. Task content inserted into prompts (spec excerpts, Known Risks, Affected Files contents) is passed through unchanged. Under `claude`, the startup text for Claude-held implementer and spec-reviewer prompts says commits belong to the orchestrator without claiming a sandbox, and those prompts carry the "always end by writing the artifact and running the phase command, even with Blockers" rule. `toResumePrompt` strips the new startup text just as it strips today's.
11. **Dependencies.** `canon doctor` and `canon init` derive required binaries from `CANON_PROVIDER`; `canon run` derives them from the bundle's pinned provider. Under `claude`, `codex` is not required and the Codex project-trust check is skipped. Doctor's output says it checks the `CANON_PROVIDER` setting, not the providers pinned on existing tasks.
12. **Decisions.** Three new `docs/decisions.md` entries: (a) review independence in Claude mode is separate sessions plus spec-blind lenses, not a second model family; this narrows §"Two distinct agents (Claude + Codex), never reviewing own output" to mixed mode; (b) the orchestrator cold lens and its hard-fail apply to mixed mode only, and the per-round record is always written; (c) the provider pin with backend-tagged sessions, superseding the "pin the provider per task at creation before changing role assignments" constraint in §"Phases route by role through agent backends (2026-10)".

## Non-Goals

- **Codex-only mode.** `CANON_PROVIDER=codex` and a stored `"provider": "codex"` are refused (AC-1, AC-2).
- **Automatic provider fallback.** canon does not switch a task's provider when a quota or budget error occurs; the operator switches with `canon task set`.
- **Per-role assignment overrides** beyond the `mixed` and `claude` presets.
- **Claude sandboxing or agent-commit detection.** A Claude implementer runs with `--dangerously-skip-permissions` and could run `git commit`; this task adds neither a sandbox default nor commit detection. Recorded in Known Risks.
- **An orchestrator cold-Claude lens**, and role-keyed config for a cold reviewer on Claude.
- **Vendor-wording sweep** of README, skills, `.canon/templates/*` artifact templates, `AGENTS.md`, CLI help, and doc prose that is vendor-specific but not made false by this task. That is the follow-up wording task. This task changes the text named in Decision §10 and AC-12, the decision entries, and the doc lines named in AC-15.
- **Any mixed-mode behavior change.** Argv, models, efforts, budgets, prompts, messages, park behavior, cold-lens behavior and defaults stay identical for `mixed` tasks (AC-14).
- **Migrating existing tasks**, or renaming the `review-cold-codex*` files.
- **Changing `MetricEntry`, `phases[].agent` recording, or the status template's `agent` defaults.**

## Acceptance Criteria

- [ ] **AC-1 — Provider policy.** `src/lib/pipeline-policy.ts` exports a provider type (`'mixed' | 'claude'`), the mixed role assignment, and a pure function mapping a provider to a `RoleAssignment`: `mixed` returns today's six-role mapping and `claude` maps all six roles to `claude`. `src/orchestrator/policy.ts` resolves `CANON_PROVIDER` (unset or empty → `mixed`) when asked, not at import; an invalid value or `codex` produces an error naming `mixed` and `claude`, and for `codex` it says Codex-only mode is not supported yet. Verify with `tests/pipeline-policy.test.ts` rows for each input; importing `policy.ts` with `CANON_PROVIDER=bogus` does not throw; `grep -c "process.env" src/lib/pipeline-policy.ts` returns `0`; `grep -rln CANON_PROVIDER src` lists only `src/orchestrator/policy.ts`.
- [ ] **AC-2 — Task pin.** `canon task new` with `CANON_PROVIDER=claude` writes `"provider": "claude"`; with it unset, `"provider": "mixed"`; with `CANON_PROVIDER=bogus`, it exits non-zero with the AC-1 message and no stack trace, and creates no task directory. `canon task set <id> provider claude|mixed` succeeds; `codex` or `bogus` exits non-zero naming the accepted values and leaves `status.json` unchanged. `canon task set <id> session_backends ...` is refused with a redirect message like `sessions`. A `status.json` with no `provider` routes as `mixed`; one with `"provider": "codex"` or `"Claude"` makes `canon run` exit non-zero with the AC-1 message before any agent spawns. Tab completion offers `provider` and its values (`tests/completion.golden.json`, with `tests/completion.test.ts` pinning the settable-field metadata). A `canon task set <id> provider claude` while the task is in its worktree window writes the worktree's `status.json` (worktree-routing test per `docs/patterns.md`). Verify with `tests/task-cli.test.ts` cases.
- [ ] **AC-3 — Routing reads the pin, once per run.** No backend lookup or required-binaries computation has an implicit default assignment: `agentBackendFor`, `roleBackendId` and `requiredAgentBackends` take the assignment (or the tasks) as a required parameter, verified by `npm run type-check` and by `grep -rnE "(agentBackendFor|roleBackendId|requiredAgentBackends)\(\s*('[a-z_]+'\s*)?\)" src` returning no matches. An integration test runs a full-tier `claude`-provider task with a fake `claude` on `PATH` and no `codex` on `PATH` through spec_review and implement, and asserts both invoked `claude` with the matrix model and recorded `phases.<phase>.agent === 'claude'`; the same fixture with `provider: "mixed"` invokes `codex` for both. A test that changes the task's `provider` in `status.json` between two phases of one `canon run` process shows the second phase still uses the provider read at start.
- [ ] **AC-4 — Mixed-provider bundles refused.** `canon run A B` where A is `claude` and B is `mixed` (or has no `provider`) exits non-zero before any agent spawn; the message names each task with its provider; neither `status.json` changes; no fake-agent log line is written.
- [ ] **AC-5 — Backend-tagged sessions.** Every session write records its backend; every clear (including reroute clears and the implement no-diff guard's clear) removes the tag with the slot pair. A table test covers, for each of the four role slots: (a) tagged, same backend → resumed at use; (b) tagged, different backend → not resumed, warning names slot, stored backend and current backend, role key and legacy key cleared, phase runs fresh; (c) untagged role key under `mixed` → resumed; (d) untagged role key under `claude` for spec_reviewer or implementer → treated as (b); (e) legacy-key-only follows (c)/(d). The check runs at the slot's use: a `claude` task with a stale Codex `implementer` session reaching spec_review produces no warning about `implementer`. `retryAgentForPhase` and `fixUpImplementArtifactRefs` apply the same check (one case each). `canon task set <id> provider claude` on a task with stored Codex `spec_reviewer` and `implementer` sessions and a Claude `author` session clears exactly the first two, keeps `author`, and prints the cleared slots; switching back to `mixed` clears nothing that is Claude-held under both.
- [ ] **AC-6 — Implement resumes after a Claude park.** On a `claude`-provider task, a fake `claude` for implement emits a `session_id` then exits non-zero: the run exits 2, implement is `blocked`, and the `implementer` slot holds that id tagged `claude`. Re-running with a succeeding fake passes `--resume <id>` and the park-resume prompt, which states the previous session stopped before finishing and that work may be partial, and does not contain "already complete". When the failing fake yields no session id, no slot is written and the re-run starts fresh with the normal implement prompt. A revision or reroute entry still uses its own prompt.
- [ ] **AC-7 — spec_review resumes after a Claude park without a false preamble.** On a `claude`-provider task, a first-pass spec_review fake that emits a `session_id` then exits non-zero stores the id tagged `claude`; the re-run passes `--resume <id>` and its prompt does not contain "has been revised since your last review". A spec_review entered after a `changes_requested` round with a stored session still gets that preamble (existing behavior). On a `mixed`-provider task, a parked Claude spec or code_review session stores nothing (unchanged).
- [ ] **AC-8 — Claude config for spec_review and implement.** `getPipelinePolicy` returns, for Claude spec_review and implement at XS/S/M/L/XL: model `sonnet`/`sonnet`/`opus`/`opus`/`opus`, effort `medium`/`medium`/`medium`/`medium`/`high`; budget for spec_review $5/$5/$10/$10/$20 and for implement $10/$15/$25/$40/$60; `delicate` promotes to XL. Precedence rows in `tests/pipeline-policy.test.ts` cover `CLAUDE_MODEL_SPEC_REVIEW`, `CLAUDE_MODEL_IMPLEMENT`, `CLAUDE_MODEL_LIGHT`, `CLAUDE_MODEL_STRONG`, `CLAUDE_MODEL` and `CLAUDE_BUDGET` for both phases. Existing Codex rows and the four existing Claude phase rows keep their expected values.
- [ ] **AC-9 — Recovery paths work under Claude.** For a `claude`-provider task: `canon run --dry-run` prints the plan for every phase without throwing; `retryAgentForPhase` for spec_review and implement spawns `claude` with the matrix config; `fixUpImplementArtifactRefs` resumes the implementer on `claude`. One test per path.
- [ ] **AC-10 — Code review skips the cold lens in Claude mode.** For a `claude`-provider task at code_review, using the code-review phase's injectable backend `deps`: no cold review is requested (the cold-review dependency is never called); `review-cold-codex.md` is not written, and a pre-existing one is removed; a numbered `review-cold-codex-run-N.md` round record is written with round, reviewed SHA, scope, base and reason headers. A second-round fixture resolves `delta` scope from that record. For `mixed`, the existing cold-lens tests (including the hard-fail `AgentSessionError` with `agent === 'codex'`) keep their expected values.
- [ ] **AC-11 — Two-lens foreman prompt.** The foreman prompt rendered for a `claude`-provider task describes a two-lens synthesis and contains no `/cold-Codex|codex review|\bCodex\b/` text from `code-review-foreman.md`; in particular it does not contain "do not treat a missing cold-Codex lens as approval evidence". The `mixed` render is byte-identical to its existing golden entry. Verify with new golden entries for `claude` round 1 and round 2.
- [ ] **AC-12 — Role-holder text in prompts and messages.** (a) With no provider set, every existing entry in `tests/run-task-prompts.golden.json` is unchanged. (b) A test renders every exported prompt builder in `src/orchestrator/prompts/index.ts` (and the fix-up and retry prompts in `main.ts`) for a `claude`-provider fixture whose spec, plan and Affected Files contain no vendor names, and asserts none matches `/\bCodex\b/`. (c) The startup text in the Claude implementer and spec-reviewer prompts does not contain "sandbox blocks" and states that the orchestrator owns commits; `toResumePrompt` strips it (extend the `tests/run-task-prompts.test.ts` strip test). (d) The full text sent to `claude` for `claude`-provider implement and spec_review includes the "always end by writing the artifact and running the phase command, even with Blockers" rule. (e) For a `claude`-provider task, these operator strings name Claude (or no vendor) instead of Codex: the implement and spec_review phase log lines, the spec-gate banner's reviewer line, the fast-tier spec-review skip note, the reroute notes in `main.ts`, the "marked implement done but handoff.md evidence is missing" warning, the fix-up "no session is available" message, and the implement no-diff guard's warnings and escalation reason. A test covers the implement log line, the reroute note and the no-diff escalation reason; `mixed` text is unchanged. Messages gated on a Codex exit status stay as they are, since they cannot fire on a `claude` task.
- [ ] **AC-13 — Dependency checks follow the provider.** With `CANON_PROVIDER=claude`, `canon doctor` and `canon init`'s dependency check pass with `git` and `claude` on `PATH` and no `codex`, and doctor skips the Codex project-trust check; with it unset, both still require `codex`; with `CANON_PROVIDER=bogus`, doctor reports the AC-1 message as a failed check without crashing. Doctor's output names the provider it checked as coming from `CANON_PROVIDER`. `canon run` on a `claude`-provider task with no `codex` on `PATH` passes its dependency check; on a `mixed` task it fails naming `codex`. Verify with `tests/agent-backend.test.ts` and `tests/cli.test.ts` cases.
- [ ] **AC-14 — Mixed mode unchanged.** With `CANON_PROVIDER` unset and no `provider` in `status.json`, the foundation's 15-site argv parity test in `tests/agent-backend.test.ts` passes with its expected values unmodified. Call sites in existing tests may change only to pass the mixed assignment or the tasks where a signature now requires them. The env scrubs in `tests/agent-backend.test.ts`, `tests/run-task-safety.test.ts` and `tests/pipeline-policy.test.ts` also remove `CANON_PROVIDER`, `CLAUDE_MODEL_SPEC_REVIEW` and `CLAUDE_MODEL_IMPLEMENT`, so the suite passes in a shell that exports them. `npm test` passes.
- [ ] **AC-15 — Decisions and docs.** `docs/decisions.md` gains the three entries in Decision §12, each with What/Why/Rule; the "Two distinct agents" and "Phases route by role" entries gain a one-line pointer to them, and the "Phases route by role" Sessions paragraph notes the backend tag. `docs/pipeline-orchestrator.md` gains a `CANON_PROVIDER` env-var row, `CLAUDE_MODEL_SPEC_REVIEW` and `CLAUDE_MODEL_IMPLEMENT` rows, spec_review and implement rows in the Claude Model/Effort and Budget matrices (marked as used only in Claude mode), the Claude-mode code-review behavior, the `canon task set ... provider` switch and its slot clearing, and updates the park paragraph (Claude-mode implement and spec_review keep their session) and the Session Resumption section (backend tags, Claude-mode park resume). New `pipeline-orchestrator.md` text contains no `§"…"` pointers into `docs/decisions.md` (that doc is not canon-owned, so docs-refs-check resolves such pointers against the template copy). `docs/codebase-map.md` and `docs/architecture.md` are updated where they describe `policy.ts`, `state.ts`, `deps.ts` or the `status.json` schema. `npm run sync-templates:check` and `npm run docs-refs-check` pass.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/lib/pipeline-policy.ts` | Provider type, exported mixed assignment, provider→assignment map; required assignment parameter on `roleBackendId` and `requiredAgentBackends`; Claude spec_review/implement cells, pins, budgets. |
| `src/orchestrator/policy.ts` | Lazy resolution and validation of `CANON_PROVIDER`; task provider resolution and validation; re-export the new policy surface. |
| `src/orchestrator/agents/backend.ts` | `agentBackendFor` takes the assignment. |
| `src/orchestrator/agents/claude.ts` | `resolveConfig` for spec_review and implement; attach the stream's session id to thrown `AgentSessionError`s. |
| `src/orchestrator/agents/errors.ts` | `AgentSessionError` carries an optional session id. |
| `src/orchestrator/types.ts` | `StatusJson.provider`; `StatusJson.session_backends`. |
| `src/orchestrator/state.ts` | Tagged session writes; tag removal in `clearSessionPair`; tag-aware lookup for the slot in use; untagged → mixed backend; clear changed slots on provider switch. |
| `src/orchestrator/main.ts` | Resolve the provider once per run and pass the assignment to every lookup (`runPhase`, `retryAgentForPhase`, `fixUpImplementArtifactRefs`, dry run, display label, `checkDeps`); refuse mixed-provider bundles and invalid stored providers; store the Claude session on park for implement and spec_review on `claude` tasks; role-holder text in reroute notes, the spec-gate banner, the implement-evidence warning and the fix-up message. |
| `src/orchestrator/phases/spec.ts` | Backend lookup with assignment. |
| `src/orchestrator/phases/spec-review.ts` | Backend lookup with assignment; re-review preamble keyed on a prior changes-requested round; role-holder text in the phase log, spec-gate banner and fast-tier skip note. |
| `src/orchestrator/phases/plan.ts` | Backend lookup with assignment. |
| `src/orchestrator/phases/implement.ts` | Backend lookup with assignment; park-resume entry and prompt selection; role-holder text in the phase log and no-diff guard warnings and escalation reason; guard clear removes the tag. |
| `src/orchestrator/phases/code-review.ts` | Backend lookups for reviewer and cold_reviewer with assignment; skip the cold lens in Claude mode, write the round record, remove a stale `review-cold-codex.md`; pass the provider to the foreman prompt. |
| `src/orchestrator/phases/qa.ts` | Backend lookup with assignment. |
| `src/orchestrator/review-archive.ts` | Round-record writer accepts the Claude-mode body (if the writer needs a change). |
| `src/orchestrator/prompts/index.ts` | Role-holder names and startup blocks from the task's assignment in every builder (including `promptSpec`'s "Codex implements directly from this"); park-resume implement prompt; two-lens foreman rendering. |
| `src/orchestrator/prompts/helpers.ts` | Provider-aware startup text for implementer and spec-reviewer prompts; Blockers-then-phase-command rule for Claude-held ones; `toResumePrompt` strips the new startup text. |
| `src/orchestrator/prompts/templates/spec-review.md` | Role-holder names from variables; mixed render unchanged. |
| `src/orchestrator/prompts/templates/spec-review-reroute.md` | Same. |
| `src/orchestrator/prompts/templates/plan.md` | Same. |
| `src/orchestrator/prompts/templates/plan-reroute.md` | Same. |
| `src/orchestrator/prompts/templates/qa.md` | Same, including the generic vendor list at line 43. |
| `src/orchestrator/prompts/templates/code-review-foreman.md` | Every cold-Codex passage (input description, injected-findings section, missing-lens branch, cross-model agreement, dismissal and archive-header instructions) conditional on mixed mode, with two-lens wording for Claude mode. |
| `src/task/index.ts` | Stamp `provider` in `taskNew` with the AC-1 error path; `provider` in `SETTABLE_FIELDS` and `TASK_SET_FIELD_VALUES` with value validation and slot clearing; `session_backends` redirect in `REDIRECT_MESSAGES`. |
| `src/cli/commands/completion.ts` | Only if completion does not pick up `provider` from `SETTABLE_FIELDS`/`TASK_SET_FIELD_VALUES`. |
| `src/cli/deps.ts` | Required binaries computed at check time from a passed or resolved provider. |
| `src/cli/commands/doctor.ts` | Required binaries and Codex trust check from `CANON_PROVIDER`; report an invalid value as a failed check; name the provider source. |
| `dist/cli/index.js` | Rebuilt. |
| `dist/orchestrator/run-task.js` | Rebuilt. |
| `tests/pipeline-policy.test.ts` | AC-1, AC-8 rows; env scrub. |
| `tests/agent-backend.test.ts` | AC-3, AC-5, AC-13, AC-14; env scrub; call sites. |
| `tests/task-cli.test.ts` | AC-2. |
| `tests/completion.golden.json` | `provider` completion. |
| `tests/completion.test.ts` | AC-2: the expected `TASK_SET_FIELD_VALUES` key list (line 35), the `SETTABLE_FIELDS` comparison (line 39) and the setter-coverage `fields` list and assertion (lines 402–407) include `provider`, so every listed `provider` value is exercised through `taskSet`. |
| `tests/run-task-safety.test.ts` | AC-4, AC-6, AC-7, AC-9, AC-12e; env scrub. |
| `tests/run-task-validation.test.ts` | AC-3 call site: the status-template agent-defaults test (line 4357) passes the exported mixed assignment to `roleBackendId`, so it still pins the template to the mixed defaults. |
| `tests/run-task-code-review.test.ts` | AC-10; call sites. |
| `tests/recovery-hints.test.ts` | Call sites for the `agentBackendFor` stub. |
| `tests/run-task-prompts.test.ts` | AC-11, AC-12. |
| `tests/run-task-prompts.golden.json` | New Claude-provider entries only. |
| `tests/cli.test.ts` | AC-13 doctor/init cases. |
| `docs/decisions.md` | AC-15 entries, pointers, Sessions note. |
| `docs/pipeline-orchestrator.md` | AC-15 rows and prose. |
| `templates/docs/pipeline-orchestrator.md` | Synced mirror. |
| `docs/codebase-map.md` | AC-15 lines. |
| `docs/architecture.md` | AC-15 `status.json` schema note. |

### Interaction Dependencies

- **Reroute** clears the reviewer and (full tier) spec_reviewer slots; the clear removes their tags (AC-5).
- **Worktree window:** `canon task set provider` during implement writes the worktree's `status.json` through the existing task-dir routing (AC-2).
- **Implement no-diff guard** (`implement.ts`) clears the implementer slot and its tag; its auto-block reason names the role holder (AC-5, AC-12e).
- **Fast tier** skips spec_review, so `claude` mode on XS non-delicate tasks uses Claude for spec+plan, implement, code_review and QA.
- **`canon task accept` and `reset-*`** do not touch sessions beyond existing clears.
- **Metrics:** `MetricEntry.agent` already accepts `'claude'`.
- **Park semantics:** `withAgentSessionPark`/`parkAgentSessionFailure` are the single park boundary; the session store on park happens there (or immediately before the throw reaches it) so every park path is covered.

### Data Model Changes

`status.json` gains two optional fields; absence means today's behavior:

```json
{
  "provider": "mixed",
  "session_backends": { "implementer": "codex" }
}
```

- `provider`: `"mixed" | "claude"`. Absent → `mixed`. Other values are refused by `canon run` (AC-2).
- `session_backends`: map from role slot (`author`, `spec_reviewer`, `implementer`, `reviewer`) to `"claude" | "codex"`, written with every `sessions.<slot>` write and removed with every clear of that slot pair. A slot with a session but no tag is attributed to the mixed assignment's backend for that role. Orchestrator-owned: `canon task set` refuses it.

`docs/patterns.md` §"State Schema Discipline" makes `.canon/templates/status.json` the schema source of truth. The template is left unchanged on purpose: both fields are optional with defined absent semantics, `taskNew` stamps `provider`, and `session_backends` exists only once a session is stored. The template's `agent` defaults are pinned by a test to the mixed assignment. Parsers: `state.ts` reads both fields; `git.ts` and `validation.ts` do not read sessions or provider and need no change.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite
- [x] `npm run build` (both `dist/` artifacts are rewritten)
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`
- [ ] E2E — N/A, no UI surface

## Docs Impact

- `docs/decisions.md`, `docs/pipeline-orchestrator.md`, `docs/codebase-map.md`, `docs/architecture.md`: edited (AC-15).
- `docs/patterns.md`: the State Schema Discipline exception is recorded in this spec; QA checks whether the pattern needs a note.
- `docs/product-context.md`: Roles and glossary wording belongs to the follow-up wording task.

## Known Risks

- **No write sandbox for a Claude implementer.** Codex's `--sandbox workspace-write` blocks `.git` writes; Claude runs with `--dangerously-skip-permissions`. A Claude implementer that runs `git commit` leaves a clean tree, and `autoCommitCode` only prints "No uncommitted changes to auto-commit.", so canon's commit message and ownership are lost. Mitigation is prompt-only (AC-12c). The opt-in mechanism (`sandbox.enabled` + `autoAllowBashIfSandboxed` in the adopter's `.claude/settings.json`, probed in `docs/BACKLOG.md`) is documented by the wording task, not defaulted.
- **Weaker review independence.** In Claude mode, Claude reviews Claude: spec_review, implement and code_review differ only by session and (from M) model tier, and code review loses the cross-family lens. The decision entry states this plainly; operators who want cross-family review stay on `mixed`.
- **Implement budget curve is a guess.** Codex has no implement cap today. $10–$60 is above benchmark per-task costs, but canon implement runs are longer; a cap hit parks the phase with the session kept (AC-6), and `CLAUDE_BUDGET` raises it. Calibrate from `docs/pipeline-invocations.md` after the first Claude-mode runs.
- **`CLAUDE_BUDGET` also caps implement and spec_review** in Claude mode. An operator who set a low flat value for review would cap implement too.
- **Park-resume entry condition.** Implement resumes from `blocked` only when a `claude`-tagged implementer session is stored. Another source of an implement block that leaves such a session stored would wrongly resume; today the no-diff guard is the other implement auto-block and it clears the slot. A new implement auto-block must clear the slot or be excluded explicitly.
- **Resuming a confused session.** A budget-capped session may resume into a muddled context. The park-resume prompt restates the remaining work, and the no-diff guard catches a session that claims changes without producing them.
- **Provider switch loses context.** A switch clears the affected slots and the next phase starts fresh, possibly in a worktree holding the other backend's partial changes. canon already restarts implement fresh over partial work after the no-diff guard, but the restarted session must reconcile partial work from files alone.
- **Tag/clear drift.** A slot write or clear that bypasses the `state.ts` helpers leaves a stale or missing tag. AC-5's table guards the helpers; review should grep for direct `sessions.` writes outside `state.ts`.
- **Prompt golden churn.** Role-holder variables must render byte-identical mixed text (AC-12a); a whitespace slip changes every golden.
- **Foreman two-lens rewrite.** The foreman template is the code-review contract; a Claude-mode branch that drifts from the mixed branch's synthesis rules could weaken review. AC-11 pins the Claude render with goldens so review can read it in full.

## Human Test Plan

1. In a scratch project with only Claude Code installed, set the provider to Claude and run the health check. Expected: it passes without asking for Codex and says which provider setting it checked.
2. Create a small task and run it through the pipeline. Expected: every phase runs on Claude, the run log never says Codex is doing the work, code review finishes without the Codex review step, and the task reaches human review.
3. In a project with both tools, start a task in the default mode, stop it partway through implementation, switch that task to Claude, and run it again. Expected: switching reports that the earlier review and implementation sessions were dropped, and a fresh Claude session continues the work.
4. On a Claude-provider task, run implementation with a very low budget. Expected: the run stops with a budget message; after raising the budget and re-running, implementation picks up where it left off rather than claiming it was already done.
5. Run a normal task in the default mode. Expected: nothing looks or behaves differently from before.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A, full tier
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) — N/A, feature
- [x] (Refactors) — N/A, feature; mixed-mode preservation is pinned by AC-14 and AC-12a

---

## Amendment

### Problem

In Claude mode, code review still writes `review-cold-codex-run-N.md`. The file holds only the round header that delta scope reads plus the line "No orchestrator cold lens runs in Claude mode." Its name names a lens that did not run, and the foreman reports a "Cold-Codex run" file in its synthesis. The record is round state, not a Codex artifact.

### Decision

Claude mode writes its per-round record as `tasks/<id>/review-round-N.md`: the same header line (`round`, `reviewed_sha`, `scope`, `base`, `reason`) and no lens findings. Numbering is numeric max+1 within the `review-round-` family, independent of round number, like the existing archive. Mixed mode is unchanged and keeps writing `review-cold-codex-run-N.md` byte-for-byte.

The round lookup that delta scope uses reads **both** families, so a task that switches provider between review rounds still finds round N−1 in either family. Within a family it keeps today's rule (highest-numbered file whose header round matches). If both families hold a match for the round and their reviewed SHAs differ, the record is treated as unusable, so the round falls back to full scope; if the SHAs agree, either record is used. The malformed-record check covers both families. Claude mode still removes a stale unnumbered `review-cold-codex.md`.

### Non-Goals

- Moving round metadata into `status.json` (a possible follow-up; it would change mixed mode).
- Renaming the mixed-mode archive or migrating existing `review-cold-codex-run-N.md` files.
- Changing the header format, delta triggers, or foreman prompt.

### Acceptance Criteria

- [ ] AC-16: On a Claude-provider task, a code-review round writes `review-round-N.md` with the round header and writes no `review-cold-codex-run-*.md` and no `review-cold-codex.md`; a stale `review-cold-codex.md` present before the round is removed. Verified by a test in the code-review suite.
- [ ] AC-17: Round-2 scope is resolved as follows, verified by tests — delta from the round-1 record in (a)–(c): (a) Claude round 1 → Claude round 2 (`review-round-1.md`); (b) mixed round 1 → Claude round 2 (`review-cold-codex-run-1.md`); (c) Claude round 1 → mixed round 2 (`review-round-1.md`). (d) both families hold round 1 with different reviewed SHAs → round 2 runs full scope. A malformed `review-round-N.md` is reported by the malformed-record check the same way a malformed cold-Codex archive is.
- [ ] AC-18: Mixed mode is unchanged: the existing mixed code-review tests and goldens pass without edits to their expected values, and a mixed round still writes `review-cold-codex-run-N.md` and `review-cold-codex.md`.
- [ ] AC-19: `docs/pipeline-orchestrator.md` (and its synced mirror) and the Claude-mode entry in `docs/decisions.md` describe the Claude-mode record as `review-round-N.md` and say the lookup reads both families; no doc says Claude mode writes `review-cold-codex-run-N.md`.

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/review-archive.ts` | Add the `review-round-` record writer; make the round lookup and malformed check read both families. |
| `src/orchestrator/phases/code-review.ts` | Claude-mode branch writes the neutral round record instead of the cold-Codex archive. |
| `tests/run-task-code-review.test.ts` | Tests for AC-16, AC-17 and AC-18. |
| `docs/pipeline-orchestrator.md` | Describe the Claude-mode round record and the two-family lookup. |
| `templates/docs/pipeline-orchestrator.md` | Synced mirror. |
| `docs/decisions.md` | Update the Claude-mode code-review entry's filename sentence. |
| `dist/cli/index.js` | Rebuilt. |
| `dist/orchestrator/run-task.js` | Rebuilt. |

### Validation Required

- [x] `npm run build && npm run type-check && npm run lint && npm test`
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`

### Known Risks

- **One-family lookup.** Reading only the new family would make every provider switch mid-review fall back to full scope, and reading only the old one would make every Claude round 2 a full review. AC-17 (a)–(c) pin both directions.
- **Numbering collision across families.** Each family numbers on its own; the lookup matches on the header's round, not the file number, so equal numbers in both families are harmless.
