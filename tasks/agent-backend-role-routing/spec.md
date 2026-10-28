# Spec: agent-backend-role-routing — Route pipeline phases through role-keyed agent backends

> Written by: Claude | Review by: Codex
> Status: draft (revised after `/canon-spec-review`)

## Problem

Today each phase's vendor is hard-coded in four places at once:

- **Calls.** Every phase file imports a vendor-specific runner and calls it directly. `phases/spec.ts`, `phases/plan.ts`, `phases/qa.ts` and the `code_review` foreman call `runClaude`. `phases/spec-review.ts` and `phases/implement.ts` call `runCodex`. The `code_review` cold lens calls `runColdCodexReview`. `main.ts` also calls runners directly at four sites:
  - the implement artifact fix-up (`runCodex`, `wrapForResume = false`)
  - `retryAgentForPhase` (one `runCodex` call and one `runClaude` call, both with a retry cwd)
  - the QA fix-up (`runClaude` on the in-memory QA session)
- **Config lookup.** Each phase, and `main.ts`, fetches model, effort and budget through the vendor-named getters `getClaudeConfig` and `getCodexConfig`. Those getters are keyed by the `ClaudePhase` and `CodexPhase` types in `src/lib/pipeline-policy.ts`.
- **Session routing.** The session slot is chosen from the static `status.phases[phase].agent` string, which is copied from `.canon/templates/status.json` when the task is created. This happens in the post-phase storage block in `main.ts` and in `retryAgentForPhase`. The slots are named after vendors: `claude_spec`, `claude_review`, `codex`, `codex_spec_review`.
- **Result tagging.** Phase handlers return a hard-coded `agent: 'claude' | 'codex'` literal.

This task is the foundation for a follow-up task that adds a Claude-only provider mode. Under the current coupling, single-provider support can't be added cleanly. The clearest hazard is session routing: if the Codex branch of the storage block served any phase other than `spec_review`, it would write to slot `codex`, and a Codex-run spec or review would overwrite the implement session.

This task changes the routing structure. Under the default (and, in this task, only) provider assignment, every agent invocation stays byte-identical: binary, argv, model, effort, budget, cwd and prompt text. The only intended behavior changes are the two deliberate fixes in the audit below.

### Correctness audit of preserved behaviors

| Behavior | Audit | Outcome |
|---|---|---|
| **Vendor per phase.** Claude runs spec, plan, the code_review foreman and qa. Codex runs spec_review, implement and the cold lens. | Matches `docs/decisions.md` §"Two distinct agents (Claude + Codex), never reviewing own output". | Correct as-is. |
| **Model, effort and budget per phase × size** (`codexMatrix`, `CLAUDE_CELLS`, budget tables). | Pinned by `tests/pipeline-policy.test.ts`. | Correct as-is. |
| **CLI flags.** Headless Claude uses `--dangerously-skip-permissions --max-budget-usd`. Fresh Codex uses `--sandbox workspace-write -C`. Codex resume omits both. | The resume omission means resumed Codex sessions run under the user's own Codex sandbox config. | **Named quirk.** Kept; see Non-Goals. |
| **Failure semantics.** A non-zero Claude exit throws `AgentSessionError` and parks the phase. A non-zero Codex exit only warns; `lastCodexExitStatus` and `shouldParkCrashedReview` then handle a crashed `spec_review`. | Asymmetric, but correct for today's fixed assignment. | **Named quirk.** Kept per backend. The provider-mode task resolves it, because only there can a role change vendor. |
| **Which phases store sessions.** spec, spec_review, implement and code_review store sessions. plan and qa are one-offs. | Correct; documented in the comment on the `main.ts` storage block. | Correct as-is. Only the slot *names* and the *routing key* change. |
| **Stale-resume fresh retry in `runClaude`.** A `--resume` id that no longer exists retries once fresh. | Correct; it protects against expired Claude sessions. | Correct as-is; moves inside the Claude backend. |
| **`wrapForResume` for implement** (`!isRerouted`) and the artifact fix-up (`false`). | Correct: a rerouted implement gets the full prompt, not a resume wrapper. | Correct as-is; passed through the backend unchanged. |
| **Bundle session semantics.** `storeSessionId` writes every bundle member; `getStoredSessionId` reads member 0. The implement hallucination path drops the implement slot on every member. | Correct; a bundle shares one branch and one session. | Correct as-is. |
| **QA `done.md` salvage.** `phases/qa.ts` runs salvage only when `result.capturedStdout` is non-empty, and passes it to `extractDoneMdFromStdout`. For Claude that is raw stream-json, not the agent's text. | Salvage can miss a `done.md` whose content the agent emitted only as text in the stream-json `result` event. | **Fixed deliberately** (AC-8). |
| **Retry and storage with an empty `phases[].agent`.** `retryAgentForPhase` returns `'no_session'` unless `agent` is `claude` or `codex`. The storage block stores nothing for any other value. `canon task`'s `ensurePhaseEntry` writes `agent: ''`. | A phase entry created by the `canon task` helper loses session continuity and retry. Both behaviors come from routing on the `agent` string. | **Fixed deliberately** (AC-6): routing comes from the phase, so these entries now store, resume and retry like template-created ones. |
| **Required binaries.** `canon init` (via `src/cli/deps.ts` `checkDeps`), the orchestrator's `checkDeps`, and `canon doctor` require both `claude` and `codex`. | Correct for today's only assignment. | Correct as-is. The required set now comes from the role map, which still yields both binaries. |

### Alternative considered: keep the vendor key strings as storage names

The hazard above could be fixed by routing on phase while keeping `claude_spec`, `codex`, etc. as storage keys, with no rename and no fallback. This was rejected on human direction. Under the follow-up provider mode, a Claude implement session would be stored in a slot called `codex`, so the rename would happen then instead. Doing it here means the State Schema Discipline migration happens once, alongside the routing change that motivates it.

## Decision

1. **Roles, not vendors.** `src/lib/pipeline-policy.ts` gains a pure role model with six roles:
   - `author`: spec and plan
   - `spec_reviewer`: spec_review
   - `implementer`: implement
   - `reviewer`: the code_review foreman
   - `cold_reviewer`: the code_review cold lens
   - `qa`: qa

   Each pipeline phase has a **primary role**: spec → author, plan → author, spec_review → spec_reviewer, implement → implementer, code_review → reviewer, qa → qa. code_review also uses `cold_reviewer`; human_review has no role.

   A pure function maps each role to a backend id (`claude` | `codex`). This task ships exactly one assignment, the current one, and gives no way to select another. The existing `ClaudePhase`, `CodexPhase`, `codexMatrix` and `CLAUDE_CELLS` stay as they are and become internals of config resolution (Decision 2).
2. **One backend interface that owns vendor detail.** Phases and `main.ts` reach agents only by asking for the backend that fills a role. The interface has two operations:
   - **Session run** (fresh or resume).
   - **Cold review** (a base-ref, spec-blind review).

   The backend resolves model, effort and (for Claude) budget from the role, the originating phase and the tasks. It does this through the existing policy cells, so phases no longer call `getClaudeConfig` or `getCodexConfig`. The phase is required: spec and plan share `author`, but `CLAUDE_MODEL_SPEC` and `CLAUDE_MODEL_PLAN` pin them to different models. Vendor-only parameters such as Codex `wrapForResume` travel as optional run options that the other backend ignores.

   Each run returns a normalized result:
   - `sessionId`
   - `exitCode`
   - `capturedStdout`
   - `text`: the agent's plain-text output. For Claude this is today's `processedText`. For Codex it is the concatenated `agent_message` texts.
   - the backend id that ran

   The cold-review operation mirrors `codex exec review --base`. The Claude backend reports it as unsupported in this task. The follow-up task will probably reshape it into a prompt-driven operation, so treat the interface as provisional.
3. **Role-keyed session slots, chosen by phase.** Sessions are stored under `author`, `spec_reviewer`, `implementer` and `reviewer`. The slot comes from an explicit **phase → slot** map, not from the role alone: spec → `author`, spec_review → `spec_reviewer`, implement → `implementer`, code_review → `reviewer`, plan → none, qa → none. plan and qa share or own roles but never store a session.
   - **Read:** the role key wins. If it is absent, fall back to the legacy key: `author`←`claude_spec`, `spec_reviewer`←`codex_spec_review`, `implementer`←`codex`, `reviewer`←`claude_review`.
   - **Write:** only to the role key.
   - **Clear:** every clear site removes a named role/legacy *pair* (AC-5).

   In-flight `status.json` files are never rewritten in bulk.
4. **`phases[].agent` becomes a record.** When a phase handler actually invokes a backend session, the phase's `agent` field is set to that backend's id. For code_review, that is the backend of the primary `reviewer` role, not the cold lens. A phase that ran no agent leaves the field unchanged; the code_review handoff preflight rejection is one example. No routing decision reads the field.
5. **Required binaries come from the role map.** The set of required agent binaries is the set of backend ids in the active role assignment, which today is still `claude` and `codex`. Three places derive it:
   - the orchestrator's `checkDeps`
   - `src/cli/deps.ts` `checkDeps` (used by `canon init`)
   - `canon doctor`'s agent-binary, Claude-version and Codex-trust checks
6. **A session id is valid only for the backend that created it.** Slots don't record which backend wrote them. The follow-up provider-mode task must pin the provider per task when the task is created, so a task never resumes a session under a different backend. This task records the constraint (Known Risks, `docs/decisions.md` entry) and doesn't enforce it, because only one assignment exists.

## Non-Goals

- No provider-selection setting (`CANON_PROVIDER` or similar), no Claude-only or Codex-only mode, and no per-task provider pin. All of these belong to the follow-up task (AC-10).
- No change to prompt template text, startup blocks, or `tests/run-task-prompts.golden.json` (AC-9).
- No change to models, efforts, budgets, CLI flags, sandboxing, or Codex resume sandboxing.
- No per-provider model cells. `codexMatrix`, `CLAUDE_CELLS`, `ClaudePhase` and `CodexPhase` keep their vendor shape; they are not renamed or deleted.
- No unification of failure semantics across backends. A non-zero Claude exit still throws, and a non-zero Codex exit still warns.
- No tagging of session slots with a backend id (see Decision 6).
- No renaming of `review-cold-codex.md`, the `review-cold-codex-run-N.md` archive, or the scope-reason strings.
- No changes to skills, `.claude/agents/`, README, AGENTS.md, or vendor wording in operator-facing messages. The exception is messages that print a slot key name (Affected Files).
- No change to the deprecated `sessions.claude` slot, which nothing reads.
- No rewrite of `docs/decisions.md` §"Two distinct agents". Cross-model review still holds under the only assignment.

## Acceptance Criteria

- [ ] **AC-1: role, phase and slot maps are pure and tested.**
  - `src/lib/pipeline-policy.ts` exports the role type from Decision 1, a pure role → backend function, a pure phase → primary-role map, and a pure phase → slot map.
  - `tests/pipeline-policy.test.ts` has table rows asserting:
    - (a) role → backend: author→claude, spec_reviewer→codex, implementer→codex, reviewer→claude, cold_reviewer→codex, qa→claude
    - (b) phase → primary role, as in Decision 1
    - (c) phase → slot: spec→author, spec_review→spec_reviewer, implement→implementer, code_review→reviewer, plan→none, qa→none
  - `grep -c "process.env" src/lib/pipeline-policy.ts` prints `0`.
  - Verify: `npm test` and the grep.
- [ ] **AC-2: phases and `main.ts` never name a vendor to invoke or configure an agent.**
  - `grep -rnE "agents/(claude|codex)\.js" src/orchestrator/phases src/orchestrator/main.ts` returns nothing.
  - `grep -nE "\b(runClaude|runCodex|runColdCodexReview)\(" src/orchestrator/main.ts` returns nothing.
  - `grep -rnE "\b(getClaudeConfig|getCodexConfig)\b" src/orchestrator/phases src/orchestrator/main.ts` returns nothing.
  - `grep -rnE "'(claude|codex)'" src/orchestrator/phases` returns nothing.

  Zero hits on all four is the pass condition. The runners and getters may remain as internals of the backend modules.
- [ ] **AC-3: every invocation is byte-identical under the only assignment.**
  - For each call site below, a unit test captures the spawned binary, argv, cwd and prompt through the backend layer (fake spawn or injected deps). It asserts the values today's code produces, including the resolved model, effort and Claude budget:
    1. spec, fresh
    2. spec, revision (resume)
    3. spec_review, fresh and resume
    4. plan
    5. implement, fresh
    6. implement, resume (`wrapForResume = true`)
    7. implement after reroute (`wrapForResume = false`)
    8. code_review foreman, round 1
    9. code_review foreman, round 2+ (resume)
    10. cold lens
    11. qa
    12. the implement artifact fix-up in `main.ts`
    13. the Codex branch of `retryAgentForPhase` (retry cwd)
    14. the Claude branch of `retryAgentForPhase` (retry cwd)
    15. the QA fix-up in `main.ts`
  - The expected values are captured from the pre-change code before the refactor lands.
  - One added case sets `CLAUDE_MODEL_SPEC` and `CLAUDE_MODEL_PLAN` to different values on identical tasks, and asserts that spec and plan each get their own model even though both run as `author`.
  - Verify: `npm test`.
- [ ] **AC-4: session slots are role-keyed, with a legacy read fallback.**
  - After a phase runs, the slot from AC-1(c) is written under its role key. Legacy keys are never written. plan and qa store nothing.
  - For each of the four slots, tests cover:
    - (a) legacy key only → resumes from the legacy id
    - (b) role key only → resumes from the role id
    - (c) both present → the role id wins
    - (d) after the next store, the role key holds the new id and the legacy key is untouched
  - The implement artifact fix-up's read of the implement session (today a direct `sessions.codex` read) goes through the same fallback read.
  - Verify: `npm test`.
- [ ] **AC-5: every clear site removes its named role/legacy pair.**

  | Clear path | Pair(s) removed |
  |---|---|
  | `canon task reset-spec-review` | `author` / `claude_spec` |
  | `canon task reset-code-review` | `reviewer` / `claude_review` |
  | reroute in `main.ts` | `reviewer` / `claude_review` always; plus `spec_reviewer` / `codex_spec_review` on full-tier reroute |
  | implement hallucination path | `implementer` / `codex`, on every bundle member |

  - For each path, a test seeds *both* keys of the pair (and the other pairs) and asserts that exactly the listed keys are removed.
  - All slot access goes through state helpers, so `grep -rnE "(claude_spec|claude_review|codex_spec_review)" src` returns hits only in `src/orchestrator/state.ts` (the legacy map) and `src/orchestrator/types.ts` (the optional legacy fields).
  - Verify: `npm test` and the grep.
- [ ] **AC-6: routing ignores `phases[].agent`; the field records the backend that ran.**
  - **Red-first.** Two tests seed a task whose `phases.<phase>.agent` is `""`, as `ensurePhaseEntry` writes it. Both fail on the pre-change code.
    - (a) `retryAgentForPhase('implement', …)` finds and resumes the stored implementer session. Today it returns `'no_session'`.
    - (b) after spec runs, the storage block writes `sessions.author`. Today it writes nothing.
  - Two more tests:
    - (c) after each agent phase, `phases[<phase>].agent` equals the backend id that ran its primary role. For code_review that is `claude`.
    - (d) a code_review preflight rejection leaves `phases.code_review.agent` unchanged.
  - Verify: `npm test`.
- [ ] **AC-7: required binaries come from the role map.**
  - A unit test of the derivation returns `{claude, codex}` for today's assignment, and `{claude}` for a fixture assignment with no Codex role.
  - A new test drives `src/cli/deps.ts` `checkDeps` with an injected availability probe and asserts that both binaries are required today.
  - The existing doctor tests in `tests/cli.test.ts` still pass unchanged. Doctor still runs the Claude version check and the Codex-trust check.
  - Verify: `npm test`.
- [ ] **AC-8: QA `done.md` salvage reads the agent's text first.**
  - Salvage runs when either `text` or `capturedStdout` is non-empty. It tries `text` first, then falls back to `capturedStdout`.
  - **Red-first.** A test runs the QA phase against a fake `claude` binary on `PATH`, the fake-CLI approach already used in `tests/run-task-safety.test.ts`. `phases/qa.ts` calls the imported runner directly, so it has no injectable runner today. The fake emits a stream-json transcript whose `done.md` body appears only inside the `result` event's text, and the test asserts that salvage recovers it. It fails on the pre-change code by assertion, not by compilation.
  - Verify: `npm test`.
- [ ] **AC-9: prompts and goldens are untouched.**
  - `git diff --name-only main...HEAD -- src/orchestrator/prompts/ tests/run-task-prompts.golden.json` is empty.
- [ ] **AC-10: no provider-selection surface.**
  - `grep -rniE "CANON_PROVIDER|provider_mode|--provider" src` returns nothing.
- [ ] **AC-11: status template guard.**
  - `.canon/templates/status.json` and `templates/.canon/templates/status.json` stay byte-identical (`npm run sync-templates:check`).
  - A row in `tests/run-task-validation.test.ts` asserts that each phase's default `agent` equals the role map's backend for that phase's primary role. `human_review` is excluded and stays `human`.

### Implementation Notes (non-binding; owned by plan/implement)

- A natural home is a new `src/orchestrator/agents/backend.ts` holding the interface, the role → backend resolver, and config resolution through the existing `getClaudeConfig` / `getCodexConfig`.
- `CodeReviewPhaseDeps` injects `runClaude`, `runColdCodexReview`, `getClaudeConfig` and `getCodexConfig` today. Injecting backends instead keeps the test seam. Both `tests/run-task-code-review.test.ts` and `tests/recovery-hints.test.ts` build this deps object and need updating.
- The cold-review failure in `code-review.ts` builds `AgentSessionError` with `agent: 'codex'`. Take the id from the backend instead (AC-2's literal grep).
- `lastClaudeSessionId` and `lastCodexSessionId` in `main.ts` can collapse into one last-session value. It must still hold sessions for phases without a slot, because the QA fix-up resumes the in-memory QA session. Don't add other cross-phase in-memory state.
- To capture AC-3's expected values, record the pre-change argv in a fixture first, then refactor.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/agents/backend.ts` | New. Backend interface, normalized result, role → backend resolver, config resolution. |
| `src/orchestrator/agents/claude.ts` | Claude backend wrapping `runClaude`; `text` from `processedText`; cold review reports unsupported. Argv unchanged. |
| `src/orchestrator/agents/codex.ts` | Codex backend wrapping `runCodex` and `runColdCodexReview`; `text` from `agent_message` items. Argv unchanged. |
| `src/orchestrator/types.ts` | `SessionSlot` → role names; `StatusJson.sessions` gains role keys and keeps legacy keys as optional fields. |
| `src/lib/pipeline-policy.ts` | Role type, phase → role, phase → slot, role → backend, required-agents derivation (all pure). |
| `src/orchestrator/policy.ts` | Exposes the role map; no new env reads. |
| `src/orchestrator/state.ts` | Role-key write, legacy-fallback read, a pair-clear helper, and the legacy key map. |
| `src/orchestrator/phases/spec.ts` | `author` backend; role slot; no vendor literals. |
| `src/orchestrator/phases/plan.ts` | `author` backend; no vendor literals. |
| `src/orchestrator/phases/spec-review.ts` | `spec_reviewer` backend; role slot; no vendor literals. |
| `src/orchestrator/phases/implement.ts` | `implementer` backend; hallucination path uses the pair-clear helper. |
| `src/orchestrator/phases/code-review.ts` | `reviewer` and `cold_reviewer` backends; `CodeReviewPhaseDeps` injects backends; preflight rejection reports no backend. |
| `src/orchestrator/phases/qa.ts` | `qa` backend; salvage gate and source order (AC-8). |
| `src/orchestrator/main.ts` | Phase → slot storage; `retryAgentForPhase` gate and dispatch by role; reroute pair clears; artifact fix-up and QA fix-up through backends; `phases[].agent` record; role-map-derived `checkDeps`. |
| `src/task/index.ts` | reset-spec-review and reset-code-review clear their pairs; "session dropped" messages name the role slot. |
| `src/cli/deps.ts` | Required agent binaries from the role map; injectable availability probe for AC-7. |
| `src/cli/commands/doctor.ts` | Agent binary, Claude-version and Codex-trust checks gated on the derived set (still all of them today). |
| `tests/pipeline-policy.test.ts` | AC-1 rows. |
| `tests/agent-backend.test.ts` | New. AC-3 parity per call site, AC-4 fallback matrix, AC-7 derivation and deps tests. |
| `tests/run-task-code-review.test.ts` | Deps-injection update; AC-6(d). |
| `tests/recovery-hints.test.ts` | Deps-injection update; AC-6(a) retry with an empty `agent`. |
| `tests/run-task-reroute-preflight.test.ts` | AC-5 reroute pair clears (existing slot-clear assertions move to role/legacy pairs). |
| `tests/run-task-safety.test.ts` | AC-5 hallucination pair clear; AC-8 fake-CLI QA salvage test next to the existing fake-CLI harness; existing legacy-slot seeds still pass via fallback. |
| `tests/task-cli.test.ts` | AC-5 reset-* pair clears. |
| `tests/run-task-validation.test.ts` | AC-11 template row; AC-6(b)/(c) storage and record. || `dist/cli/index.js` | Rebuilt. |
| `dist/orchestrator/run-task.js` | Rebuilt. |
| `docs/pipeline-orchestrator.md` | Session-resumption section (role slots and legacy fallback); the reset-spec-review and reset-code-review rows and the reroute paragraph name role slots. |
| `templates/docs/pipeline-orchestrator.md` | Mirror via `npm run sync-templates`. |
| `docs/patterns.md` | The worktree-cwd pitfall's advice to "clear the session slot (e.g., `sessions.codex_spec_review`)" changes to name the role slot, noting that legacy and role keys must be cleared together. |
| `docs/codebase-map.md` | Add `agents/backend.ts`; note role routing. |
| `docs/decisions.md` | New entry, "Phases route by role through agent backends (2026-10)": role-keyed routing and slots, today's assignment and cross-model review unchanged, and session ids bound to their backend (Decision 6). |

### Interaction Dependencies

- **In-flight tasks.** `no-base-scaffold-commit` is currently in `code_review`. These tasks hold legacy-keyed slots and resume through the fallback (AC-4).
- **Bundles.** Stores go to every member, and reads use member 0 through the fallback. A bundle whose members mix legacy and role keys is harmonized on the next store.
- **Recovery paths.** `--reroute`, `reset-spec-review` and `reset-code-review` are the slot-clearing recovery paths (AC-5). `canon task accept` doesn't touch sessions.
- **Detach, watch and stop.** These are vendor-free and unaffected. `canon stop` doesn't use `src/cli/deps.ts`.

### Data Model Changes

- `status.json` `sessions` gains new keys: `author`, `spec_reviewer`, `implementer`, `reviewer`. Legacy keys stay readable and are cleared in pairs, but are no longer written.
- `phases[].agent` keeps the same type (`string`). Its meaning changes from "routing input" to "record of the backend that ran the phase's primary role".
- No version field and no bulk migration. Compatibility comes from the read fallback alone.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build` — commit `dist/` deltas; CI diffs committed `dist/` against a fresh build
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`
- [ ] E2E — N/A (no UI surface)

## Docs Impact

- `docs/pipeline-orchestrator.md` (plus its mirror), `docs/patterns.md`, `docs/codebase-map.md` and `docs/decisions.md` are edited in this task.
- `docs/architecture.md`: the flow diagram names vendors per phase. It is still accurate; QA should confirm.
- `docs/product-context.md`: unchanged. The vendor glossary still holds.

## Known Risks

- **Silent argv drift (AC-3).** Moving runners behind an interface can drop a flag: `--add-dir cwd` on worktree runs, `wrapForResume`, the Claude stale-resume retry, or the Claude budget. AC-3 covers all fifteen call sites, with expected values captured from the pre-change code. Any call site added later must also get a parity row.
- **Slot collision between phases sharing a role.** spec and plan share `author`. If the slot were derived from the role rather than the phase, plan's one-off session would overwrite the spec session. AC-1(c) pins the phase → slot map and AC-4 asserts that plan stores nothing.
- **Fallback ordering bugs (AC-4/5).** A role key that is written but not cleared resumes a stale session after a reroute, which is exactly what the clears exist to prevent. The pair helper and AC-5's per-path tests guard this. A hand-cleared legacy key alone no longer forces a fresh session, so the operator advice in `docs/patterns.md` and `docs/pipeline-orchestrator.md` changes in this task.
- **Newly stored sessions for empty-`agent` entries (AC-6).** Phase entries created by `canon task` will start storing and resuming sessions where they ran fresh before. This is intended, but a stale session id could now be resumed on such an entry. The Claude stale-resume retry covers expired Claude ids; for Codex the risk matches any other stored Codex session.
- **Salvage source change (AC-8).** Reading `text` first could pick a different `done.md` body when `text` and raw stdout both parse. They come from the same session, so a divergence would mean the stream-json parse was already wrong. The red-first test pins the case that motivated the fix.
- **Cross-backend session ids (Decision 6).** Nothing stops a future assignment change from resuming a Codex thread id with Claude, or the reverse. The follow-up task must pin the provider per task. Until then only one assignment exists, so this can't happen.
- **Failure-semantics asymmetry stays.** A uniform interface invites the assumption that a non-zero exit always throws. The interface's doc comment states each backend's semantics.
- **Doctor regression (AC-7).** Gating checks on the derived set must still run all of them today. A wrong derivation would silently drop the Codex-trust check that adopters rely on.
- **Delicate surface.** This touches `main.ts` routing, `pipeline-policy.ts` and the `status.json` schema at once. Worktree isolation shields the supervising orchestrator during the run.

## Human Test Plan

1. Run a small task from spec through QA on the new build. Expected: the same agents, models and costs as before, and the pipeline reaches human review. The only difference in the log is that "session stored" lines show the new slot names.
2. Open that task's status file. Expected: stored sessions use the role names (author, spec reviewer, implementer, reviewer), and each phase records which agent ran it.
3. Resume a task that was mid-flight before upgrading, such as one waiting in code review. Expected: it picks up its previous review session instead of starting cold.
4. Send a task back from code review with a reroute, then resume it. Expected: the review starts a fresh session.
5. Run the environment doctor. Expected: it still checks for both agent tools, the Claude version and the Codex project trust, as before.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) — N/A, refactor; the two deliberate fixes (AC-6, AC-8) carry red-first tests and stated mechanisms in the audit
- [x] (Refactors) *Problem* records the correctness audit of each behavior declared preserved, with one outcome each
