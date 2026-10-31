# Code Review: claude-provider-mode

> Reviewer: Claude | Spec: `tasks/claude-provider-mode/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

A foreman synthesized this review from three lenses:

- an anchored Claude lens (Stage 1 / Stage 2 charter);
- a cold-Claude lens that read only the diff and base ref;
- the cold-Codex lens that the orchestrator ran beforehand.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run (lint, type-check, full `npm test`, build, docs-refs-check, sync-templates:check; E2E N/A per spec)
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC (N/A — feature; spec states no red-first mechanism applies)

The anchored lens independently confirmed several results:

- `npm run build` leaves `dist/` clean against HEAD.
- `type-check`, `lint`, `sync-templates:check` and `docs-refs-check` pass.
- 265 targeted tests pass with `CANON_PROVIDER`, `CLAUDE_MODEL_SPEC_REVIEW` and `CLAUDE_MODEL_IMPLEMENT` exported.
- All 23 existing prompt-golden values are byte-identical.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Provider policy | Pass | `parseProvider` / `roleAssignmentFor` / `MIXED_ROLE_ASSIGNMENT` in `src/lib/pipeline-policy.ts`. `resolveProviderSetting` in `src/orchestrator/policy.ts` resolves lazily. `grep -c process.env` on the pure policy returns 0. `CANON_PROVIDER` appears only in `policy.ts`. Test rows include the codex/bogus/case cases and the import-with-bogus case. |
| AC-2: Task pin | Pass | `taskNew` stamps the provider. `taskSet` parses `provider`, clears sessions and reports which. `session_backends` is redirected. Completion metadata and golden are updated, and there is a worktree-routing assertion. The orchestrator refuses `codex`/`Claude` pins. |
| AC-3: Routing reads the pin once per run | Pass | The required-parameter grep returns nothing and type-check passes. The full-tier fake-agent run covers both providers, with no `codex` on PATH in Claude mode. Changing the disk pin mid-run leaves routing unchanged. |
| AC-4: Mixed-provider bundles refused | Pass | `resolveBundleProvider` runs before `checkDeps` and before any spawn. The message names each task's provider. Status files stay byte-identical and no invocation log is written. |
| AC-5: Backend-tagged sessions | Pass | No `sessions` / `session_backends` writes exist outside `state.ts`. The four-slot table covers role, legacy and both keys under tagged and untagged sessions. Retry, fix-up, provider-switch and no-diff wiring are covered. |
| AC-6: Implement resumes after Claude park | Pass | The emitted id is stored tagged `claude` and the run exits 2. The re-run resumes with the park prompt, which does not contain "already complete". With no id, nothing is stored. Revision and reroute keep precedence. |
| AC-7: spec_review resumes without false preamble | Pass | `isReReview` keys on a prior changes-requested round (Claude only). The park test asserts no preamble, and the re-review test keeps it. Spec and code_review parks store nothing. |
| AC-8: Claude config for spec_review/implement | Pass | Cells, pins, budgets and delicate→XL are in place, with precedence rows for both phases. |
| AC-9: Recovery paths under Claude | Pass | Tests cover the dry run, retry for both phases, and fix-up. |
| AC-10: Code review skips cold lens in Claude mode | Pass | The cold dependency is never called. The stale `review-cold-codex.md` is removed. The numbered record is written with its headers, and round 2 resolves `delta`. Mixed hard-fail tests are unchanged. |
| AC-11: Two-lens foreman prompt | Pass | New round-1 and round-2 Claude goldens; the mixed goldens are byte-identical. |
| AC-12: Role-holder text | Partial | (a), (b), (c) and (e) pass. (d) passes for the headless path, but the rule is attached by appending the whole `CODEX_HEADLESS` block to the startup with no interactive gate. That makes interactive sessions false and duplicates the headless block in non-interactive ones (Finding 2). |
| AC-13: Dependency checks follow provider | Pass | `deps.ts` and `doctor.ts` resolve the provider at check time. The trust check is skipped under `claude`. A bogus value yields a failed check with no stack trace. Run dependency checks are tested for both providers. |
| AC-14: Mixed mode unchanged | Pass | The 15-site parity expectations are unmodified. Env scrubs are in the three named files. The full suite passed with the new variables exported. |
| AC-15: Decisions and docs | Pass | Three What/Why/Rule entries, with pointers and the Sessions note. The new `pipeline-orchestrator.md` text has no `§"…"` pointers. `codebase-map.md` and `architecture.md` are updated. Both doc checks pass. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation is broad and well covered. Provider policy is pure and table-driven. Session tagging is centralized in `state.ts`. Code review skips the cold lens cleanly, and mixed-mode parity is pinned by the untouched goldens and the argv parity test.

Two prompt-delivery defects surface only on the new Claude-implementer paths, which no existing mixed caller exercises:

- the Claude backend drops the `wrapForResume` request field;
- the Blockers rule is attached by appending the whole Codex headless block, with no interactive gate.

Both are small, contained fixes.

### Findings

#### Correctness Bugs

1. **`code-bug`: the Claude backend ignores `wrapForResume`, so Claude-mode implement reroutes and artifact fix-ups get a resume-wrapped prompt.**
   - Flagged by: cold-Claude. Foreman verified.
   - Where: `src/orchestrator/agents/claude.ts:324` (`claudeBackend.run` never forwards `request.wrapForResume`) and `:140` (`attempt` always applies `toResumePrompt` when resuming).
   - Who relies on it: `AgentRunRequest.wrapForResume` (`src/orchestrator/agents/backend.ts:16`) is set to `false` by the implement reroute (`src/orchestrator/phases/implement.ts:114`, `wrapForResume: !isRerouted`) and by the implement artifact fix-up (`src/orchestrator/main.ts:578`). Before this task, only Codex received those calls and it honors the flag (`agents/codex.ts:45`). Under `claude`, both calls now reach Claude.
   - Effect on a Claude reroute:
     - `toResumePrompt` strips `CLAUDE_IMPLEMENTER_STARTUP`, which carries the "orchestrator owns commits" statement. That statement is the only mitigation for the spec's Known Risk "No write sandbox for a Claude implementer".
     - It also prepends the "[Resumed session — … Skip startup boilerplate re-reads …]" banner, which contradicts the reroute prompt's own grounding that session memory is stale.
   - Fix: pass `request.wrapForResume` through to `runClaude` and honor it in both the interactive (`:120`) and stream (`:140`) branches, mirroring `runCodex`.
   - Tests: one test per call site asserting that the prompt sent to `claude` on a Claude-provider reroute (and fix-up) keeps the implementer startup and has no "[Resumed session" banner.

2. **`code-bug`: `implementerStartup` appends the full `CODEX_HEADLESS` block for Claude-held implementer and spec-reviewer prompts unconditionally, including interactive runs.**
   - Flagged by: anchored (primary) and cold-Claude (duplicate headless blocks), so 2 lenses.
   - Where: `src/orchestrator/prompts/index.ts:138-140` and `:509`.
   - Interactive runs (`-I`): the agent is told "this runs non-interactively — nobody reads your messages … Don't stop to ask for confirmation", which is false in a live operator session. The mixed path gates the same block on `!interactive` (`agents/codex.ts:46`).
   - Non-interactive runs: the prompt carries both `CLAUDE_HEADLESS` (prepended by `runClaude`) and `CODEX_HEADLESS`, and their ambiguity and approval rules differ:
     - ambiguity goes to "artifact or notes.md" vs "a handoff `[ambiguity]` Blocker";
     - approvals are "Skip that action unless this prompt explicitly authorizes it" vs "continue with the authorized work".
   - What the spec asked for: Decision §10 and AC-12(d) ask only for the "always end by writing the artifact and running the phase command, even with Blockers" rule on the text sent to `claude`.
   - Fix: deliver that rule on the non-interactive path only, for example by adding it in the Claude backend or `runClaude` when `!interactive` and the role is implementer or spec_reviewer, or by gating `implementerStartup` on interactivity. Do not duplicate the overlapping headless guidance.
   - Tests: keep AC-12(d)'s assertion. Add an interactive-mode assertion that a Claude-provider implement prompt does not contain "nobody reads your messages", and an assertion that the non-interactive prompt contains exactly one headless block.

#### Risk / Guardrails

3. **Session-id capture now takes the last `session_id` from any stream event and persists across attempts.**
   - Flagged by: anchored and cold-Claude, both low confidence, so 2 lenses.
   - Where: `src/orchestrator/agents/claude.ts:171`.
   - The outer `sessionId` is shared between `attempt(resumeId)` and the `attempt(null)` fallback after resume-not-found, so a failed second attempt can throw with the first attempt's id. Any event carrying a different `session_id` would also overwrite it. The id then feeds park storage (`main.ts` `parkAgentSessionFailure`).
   - Impact is low: a wrong id resumes as not-found and falls back fresh.
   - Recommended in the same round: reset the id per attempt, and prefer the `system`/`init` (or `result`) event's id over arbitrary events.

4. **A recovery-session failure inside `checkAndRoute('implement')` parks implement with the session stored.**
   - Flagged by: anchored. The cold-Claude finding on the park-resume entry predicate overlaps it, so 2 lenses.
   - Where: `src/orchestrator/main.ts:3597-3601` / `:4225`. An `AgentSessionError` from the docs-refs fix-up or from `retryAgentForPhase`, after a completed implement, goes through `withAgentSessionPark`. The next run therefore takes the park-resume path ("work may be partial").
   - This is consistent with spec §7 / Interaction Dependencies ("the session store on park happens there … so every park path is covered"). The resume prompt says to continue and validate, so the outcome is benign.
   - The spec's Known Risk "Park-resume entry condition" names this class only for new auto-blocks. Non-blocking; worth one regression test if Finding 1's fix touches the fix-up path.

#### Optional Cleanup / Nit

- `src/orchestrator/prompts/index.ts:158-161` / `:371-373` and `src/orchestrator/prompts/helpers.ts:38-41`: the park-resume header and the Claude startup are built by exact-string `.replace` on text owned elsewhere (`context.ts` mode line; the `CODEX_STARTUP` sandbox sentence), and both fail silently if the source changes. Add assertions that `Mode: **park resume**` is present and that `fresh — first implementation pass` is absent. Flagged by anchored and cold-Claude.
- `src/orchestrator/main.ts:4039-4047`: provider resolution and bundle-consistency checks also run for `--ship` and `--dry-run`, which spawn no agents, so a task with a hand-edited invalid pin cannot be shipped. This matches spec §2/§5 (the orchestrator refuses), but exempting `--ship` would be friendlier. Flagged by anchored and cold-Claude.
- `src/orchestrator/prompts/index.ts:366`: the park-resume prompt pastes the raw escalation reason, which includes the operator re-run instruction. Consider stripping the operator-recovery clause (cold-Claude).
- `tests/run-task-safety.test.ts` park test (session=false): it asserts only that `--resume` is absent. Also assert the normal fresh prompt (no "previous session stopped") that AC-6 names (anchored).
- `src/task/index.ts:227`: `resolveProviderSetting()` runs before argument and ID validation in `taskNew`, so a bad `CANON_PROVIDER` masks usage errors (anchored).
- `src/orchestrator/state.ts:483`: `session_backends: {}` is left empty after clears (anchored).
- `docs/decisions.md` (provider-pin entry): it restates the implement budget values inline, and that copy will drift from the matrix (anchored).
- `src/orchestrator/phases/code-review.ts:456`: stray blank line (anchored).
- Spec Known Risk "Resuming a confused session" says the no-diff guard catches a park-resumed session that claims changes without producing them. The guard runs only on revision (`implement.ts:115`), so the risk text overstates the mitigation. Spec §7 never required extending the guard, so this is a task-artifact wording note, not a spec gap that blocks; the anchored lens raised it as a spec-gap. Re-word it if the spec is touched.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): the Claude implementer runs with `--dangerously-skip-permissions` and `--add-dir REPO_ROOT` and no write sandbox. This is explicitly a Non-Goal ("Claude sandboxing or agent-commit detection … adds neither a sandbox default nor commit detection") and is recorded under Known Risks "No write sandbox for a Claude implementer". Finding 1 restores the prompt-only mitigation on reroutes.
- Dismissed (cold-Claude): the revision no-diff "hallucination" guard misfires if a Claude implementer commits its own edits. This is a consequence of the same accepted Non-Goal (no agent-commit detection), and the Known Risk already names the clean-tree consequence.
- Dismissed (cold-Claude): `isParkResume` fires for any blocked implement with a compatible stored session. The spec's Known Risk "Park-resume entry condition" accepts this predicate by design. Manual `canon task phase … blocked` does not store a session, and the existing no-diff auto-block clears the slot. Recorded under Finding 4 for the one real path.
- Dismissed (cold-Claude): a spec_review park during a re-review round shows the "revised" preamble. Spec §7 defines the predicate as "a previous review round requested changes", and the spec was in fact revised after that round. Plain round-1 park-resume context is not required by §7.
- Dismissed (cold-Claude): doctor and init check `CANON_PROVIDER` while the orchestrator checks the task pin. This is spec-intended (Decision §11; doctor "says it checks the `CANON_PROVIDER` setting, not the providers pinned on existing tasks").
- Dismissed (cold-Claude): the run `--help` text, `.canon/templates/*` and `canon-status` still use Codex wording. The Non-Goals defer the "vendor-wording sweep of README, skills, `.canon/templates/*` artifact templates, … CLI help" to the follow-up wording task.
- Dismissed (cold-Claude): round 2+ scope reasons mention "cold-Codex archive record" in the Claude foreman prompt. AC-11 scopes the no-Codex rule to text "from `code-review-foreman.md`". These reasons come from `pipeline-policy.ts` and appear only when the numbered record is missing or malformed, which normal Claude rounds avoid by writing it. The handoff documents this as deliberate mixed-text preservation.
- Dismissed (cold-Claude): `canon task set … provider` during a live detached run races with the running orchestrator. Spec §3 defines next-run semantics, and the unlocked read-modify-write of `status.json` applies to every existing `canon task set` field, so it is not introduced here.
- Dismissed (cold-Claude): `usableSessionId` checks tags across all bundle members but returns `taskIds[0]`'s id via `getStoredSessionId`. The leader-sourced id predates this task (`getStoredSessionId` is unchanged), and the tag scan is stricter, not looser.
- Cold-Codex reported no actionable defects, so there is nothing to dismiss.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Address Findings 1 and 2 (both `code-bug`). Finding 3 is recommended in the same round. The nits are optional.

---

<!--
On re-review, append below this line:

Heading rule for ANY append to this file: only real review rounds may use a
`## Round N` heading. The verdict parser scopes to the latest `## Round` body —
an administrative block (pre-flight rejection, halt note, audit stamp) headed
`## Round …` with no verdict checkbox makes the parser return no verdict and
breaks routing. Administrative appends use a non-Round heading (e.g.
`## Pre-Flight Rejection (round N)`) and omit the verdict checkbox entirely.

## Round N — verifying iteration N-1's response to round N-1

**Scope:** Full | Delta — base `<baseBranch or prevSHA>` — reason: <trigger reason, or "delta">

### Stage 1 — Acceptance Criteria Re-Check

Re-fill this table with every AC from spec.md against the latest code. Earlier AC tables were snapshots of earlier iterations, not reusable proof. ACs whose relevant code paths did not change may be marked `Met (unchanged from round N-1)` with a one-line evidence pointer.

| AC | Status | Notes |
|---|---|---|
| AC-1: ... | Met / Partial / Not Met | ... |
| AC-2: ... | Met / Partial / Not Met | ... |

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line; AC-N now Met in table above) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->

## Round 2 — verifying iteration 1's response to round 1

**Scope:** Full — base `main` — reason: delicate

This round synthesizes three lenses: the anchored Claude lens, the cold-Claude lens (diff and base ref only), and cold-Codex. Cold-Codex found no actionable regressions.

### Stage 1 — Acceptance Criteria Re-Check

**Validation gate: pass.**

- The Iteration 2 table in `handoff.md` has no `Fail` rows. lint, type-check, the full `npm test` (1,840 tests), build, docs-refs-check and sync-templates:check all pass. E2E is deferred by the spec.
- The anchored lens re-ran these checks itself:
  - `npm run type-check` and `npm run lint` pass.
  - `npm run build` leaves `dist/` clean.
  - The full `npm test` passed 1840/1840 with `CANON_PROVIDER`, `CLAUDE_MODEL_SPEC_REVIEW` and `CLAUDE_MODEL_IMPLEMENT` exported.
  - All 23 original prompt goldens are byte-identical to `main`.
- Red-first evidence was read across the whole handoff. The feature has no mandatory red-first AC, and Iteration 2 records voluntary pre-fix evidence against `cc87035`.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 1) | `pipeline-policy.ts` / `policy.ts` untouched by iteration 1. |
| AC-2 | Met (unchanged from round 1) | `src/task/index.ts` and completion untouched. |
| AC-3 | Met (unchanged from round 1) | Routing untouched; type-check and suite pass. |
| AC-4 | Met (unchanged from round 1) | `resolveBundleProvider` untouched. |
| AC-5 | Met (unchanged from round 1) | `state.ts` untouched; tag-table and retry/fix-up tag tests pass. |
| AC-6 | Met | Park/resume tests now pin the `Mode: **park resume**` header, and the no-id rerun pins the fresh header. A new recovery-retry park→resume regression is at `tests/run-task-safety.test.ts:11519`. |
| AC-7 | Met | Session capture is per attempt, taking ids only from top-level init/result events (`src/orchestrator/agents/claude.ts:141,173-176,187-188,241`). The spec_review park tests pass. |
| AC-8 | Met (unchanged from round 1) | Policy cells untouched. |
| AC-9 | Met | The artifact fix-up sends its own prompt without the resume banner and keeps its no-commit instruction (`tests/run-task-safety.test.ts:11398-11399`). |
| AC-10 | Met (unchanged from round 1) | `code-review.ts` untouched. |
| AC-11 | Met (unchanged from round 1) | Foreman goldens are unchanged. |
| AC-12 | Met (was Partial) | The completion rule is added only for unattended implementer/spec_reviewer calls (`src/orchestrator/agents/claude.ts:325-326`). Unattended runs get exactly one headless block and interactive runs get none. A reroute keeps the Claude implementer startup (`src/orchestrator/prompts/index.ts:506`). |
| AC-13 | Met (unchanged from round 1) | `deps.ts` / `doctor.ts` untouched. |
| AC-14 | Met | The 15-site parity values are unmodified. In mixed mode Claude runs only author, reviewer and qa, so the completion rule never applies and `wrapForResume` keeps its default. |
| AC-15 | Met (unchanged from round 1) | Docs untouched. |

### Verifying Round 1 findings

- _correctness bug F1:_ "Claude backend ignores `wrapForResume`" → addressed ✓.
  - `src/orchestrator/agents/claude.ts:96,120,142,328` forward and honor the flag in both the interactive and stream branches.
  - A Claude reroute keeps the implementer startup with no resume banner (`tests/run-task-safety.test.ts:11497-11501`).
  - The anchored lens dropped the forwarding as a mutation, and four tests turned red.
- _correctness bug F2:_ "`CODEX_HEADLESS` appended unconditionally" → addressed ✓.
  - `CODEX_HEADLESS` is no longer imported into `prompts/index.ts`.
  - The standalone `PHASE_ARTIFACT_COMPLETION` sentence (`src/orchestrator/prompts/helpers.ts:42`) is added only when the call is unattended and the role is implementer or spec_reviewer.
  - The anchored lens forced `needsCompletionRule = false` as a mutation, and the gate test turned red.
- _risk F3:_ "session id drifts across events and attempts" → addressed ✓.
  - The id is held per attempt and taken only from top-level `system`/`init` or `result` events, with result taking precedence.
  - Tests cover a foreign-event id and a failed fallback that has no id.
- _risk F4:_ "recovery failure parks with session" → addressed by a regression test with no code change, which matches round 1's non-blocking framing ✓.
- _nits:_ the park/fresh header assertions and the session=false prompt assertion were added. The remaining optional nits are carried below.

### New findings (only NEW issues introduced by Iteration 1's changes)

No `code-bug` or `spec-gap` findings survive.

#### Optional Cleanup / Nit

- `src/orchestrator/agents/claude.ts:241`: removing the stdout-regex session-id fallback changes mixed-mode success-path capture only for a stream that has no top-level `init` event and no `result.session_id`.
  - Real `stream-json --verbose` output always emits `init` first.
  - `streamProcess` feeds every line, including an unterminated final one, through `onLine` (`src/orchestrator/agents/stream.ts:78-84`).
  - No test pinned the regex.
  - Practically unreachable; noted against the AC-14 Non-Goal for completeness (anchored, low/low).
- `src/orchestrator/agents/claude.ts:187-188`: a later `result` event with non-null `parent_tool_use_id` sets `captured.sessionId` to null instead of being skipped. The `init` id still backstops it (anchored).
- `tests/agent-backend.test.ts:62`: the parity expectation `resumeId && (claude || wrapForResume)` still encodes the pre-F1 assumption that Claude ignores the flag. The values stay correct because every mixed Claude row passes `true`. Add a comment, since AC-14 freezes the values (anchored).
- `docs/pipeline-orchestrator.md:476` says Claude session ids come from `result.session_id`. Failure-path capture now also uses `system`/`init`, so the line is incomplete (anchored).
- AC-12(d)'s wording ("the full text sent to `claude` … includes" the rule) has no interactive carve-out. The implementation omits the rule interactively, as round 1's F2 directed, which mirrors Codex's `!interactive` gate. The behavior is correct. If the spec is touched again, say "non-interactive". The anchored lens raised this as a spec-gap; it is recorded as a wording nit because the round 1 review resolved it and the implementer had nothing to guess.
- `src/orchestrator/prompts/helpers.ts:74-79`: on resumed Claude revision and park-resume calls (`wrapForResume=true`), `toResumePrompt` strips `CLAUDE_IMPLEMENTER_STARTUP`, as the spec requires. The commit-ownership line therefore relies on turn-1 context. `retryAgentForPhase` restates it (`src/orchestrator/main.ts:3520-3521`); the park-resume and revision prompts could too (anchored).
- `src/orchestrator/prompts/templates/implement.md:37,56`, `implement-revisions.md:43` and `implement-reroute.md:28` say "your sandbox". For an unsandboxed Claude implementer this reads as "your environment", so it is not materially false. This falls under the deferred wording sweep (cold-Claude).
- `src/task/index.ts:44` hard-codes `['mixed', 'claude']` rather than deriving it from the policy's provider list (cold-Claude).
- `src/orchestrator/phases/implement.ts:135`: the no-diff guard calls `clearSessionPair` only `if (s.sessions)`, so a tag with no `sessions` object survives. That is harmless, because the use-time check reads `sessions` first (cold-Claude).
- Carried from round 1, unchanged and optional:
  - `--ship`/`--dry-run` refuse an invalid pin (`main.ts` ~4039).
  - The park-resume prompt pastes the raw escalation reason, including the operator re-run clause (`prompts/index.ts` ~362-366).
  - The `.replace`-built park header and Claude startup are fragile (`prompts/index.ts:368-371`, `helpers.ts:29`).
  - `session_backends: {}` is left after clears.
  - The decisions entry restates the implement budget curve.
  - There is a stray blank line at `code-review.ts` ~456.
  - The spec's "Resuming a confused session" Known Risk overstates the no-diff guard.
  - `resolveProviderSetting()` runs before arg parsing in `taskNew`.

### Dismissed Cold Findings

- Dismissed (cold-Claude): the Claude implementer is unsandboxed (`--dangerously-skip-permissions`, `--add-dir REPO_ROOT`), inherits `RUN_TASK_ORCHESTRATOR=1`, and has no post-session HEAD-moved check. These are the spec Non-Goals "Claude sandboxing or agent-commit detection" and "neither a sandbox default nor commit detection", recorded under Known Risks "No write sandbox for a Claude implementer". The prompt-only mitigation is now preserved on reroutes (F1).
- Dismissed (cold-Claude): the revision no-diff guard false-positives if a Claude implementer commits its own edits. This follows from the same accepted Non-Goal (no agent-commit detection), and the Known Risk names the clean-tree consequence.
- Dismissed (cold-Claude): `isParkResume` could override an implementer's deliberate `blocked` mark.
  - The implement templates never tell the implementer to mark implement `blocked`: Blockers, including `[wrong-premise]`, are recorded in `handoff.md`, then the phase is closed (`implement.md:37`, `implement-revisions.md:43`).
  - The resume predicate is the one the spec accepts in Known Risks "Park-resume entry condition".
- Dismissed (cold-Claude): the post-completion recovery failure parks implement with its session. Spec §7 and Interaction Dependencies place session storage at the single park boundary "so every park path is covered". Iteration 1 added a regression proving the resulting resume completes (round 1 F4).
- Dismissed (cold-Claude): the completion sentence reaches the docs-refs fix-up session. The fix-up prompt explicitly overrides the "instructions above" about finishing with a phase command, and the sentence sits above that override, so the override governs. The anchored lens verified the ordering.
- Dismissed (cold-Claude): after a Claude→mixed switch mid-loop, the next round may take delta scope from a Claude-mode record. Spec §9 requires the record "so delta scope works from round 2". The prior reviewed commit was fully reviewed by the round's lenses, and delicate/XL tasks always run full.
- Dismissed (cold-Claude): `canon task set … provider` races a live run. Spec §3 defines next-run semantics, and the unlocked read-modify-write applies to every existing `canon task set` field.
- Dismissed (cold-Claude): doctor checks `CANON_PROVIDER`, not task pins. This is spec-intended (Decision §11).
- Dismissed (cold-Claude): the module-level `runProvider` is never reset. Spec §3 mandates a single per-process read, and `main()` is invoked once per process. In-process reuse is hypothetical.
- Cold-Codex reported no actionable regressions, so there is nothing to dismiss.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
