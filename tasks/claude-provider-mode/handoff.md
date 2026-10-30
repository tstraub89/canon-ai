# Implementation Handoff: claude-provider-mode

> Author: Codex | Spec: `tasks/claude-provider-mode/spec.md` | Plan: `tasks/claude-provider-mode/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/lib/pipeline-policy.ts` | Provider presets and strict parser; explicit role assignments; Claude spec-review/implement cells, pins and budgets. |
| `src/orchestrator/policy.ts` | Call-time provider setting and task/bundle pin validation; model pins and provider source label. |
| `src/orchestrator/agents/backend.ts` | Require an explicit role assignment for backend lookup. |
| `src/orchestrator/agents/claude.ts` | Resolve both new Claude phases and attach yielded stream session IDs to failures. |
| `src/orchestrator/agents/errors.ts` | Carry optional failed-session continuity in AgentSessionError. |
| `src/orchestrator/types.ts` | Optional provider/backend-tag schema and required run-state provider. |
| `src/orchestrator/state.ts` | Tagged writes, paired clears, use-time compatibility checks, and provider-switch clearing. |
| `src/orchestrator/main.ts` | Pin provider once, reject incompatible bundles, route dependencies/recovery/fix-ups, persist eligible parked sessions, and render role-holder messages. |
| `src/orchestrator/phases/spec.ts` | Route author calls with the run assignment. |
| `src/orchestrator/phases/spec-review.ts` | Route reviewer, render role-holder messages, and distinguish parked first reviews from revised-spec reviews. |
| `src/orchestrator/phases/plan.ts` | Route author calls with the run assignment. |
| `src/orchestrator/phases/implement.ts` | Route implementer, select partial-work park resume, and render role-aware no-diff warnings/escalations. |
| `src/orchestrator/phases/code-review.ts` | Skip the orchestrator cold lens in Claude mode, remove stale findings, and always write its numbered round record. |
| `src/orchestrator/phases/qa.ts` | Route QA calls with the run assignment. |
| `src/orchestrator/prompts/index.ts` | Render role holders, provider-aware startup, partial-work park resume, and two-lens foreman views. |
| `src/orchestrator/prompts/helpers.ts` | Claude startup without the sandbox claim; reusable artifact/phase-command instruction and resume stripping. |
| `src/orchestrator/prompts/templates/spec-review.md` | Role variables and separate-session cross-review wording in Claude mode. |
| `src/orchestrator/prompts/templates/spec-review-reroute.md` | Provider-specific cross-review wording. |
| `src/orchestrator/prompts/templates/plan.md` | Render the implementer role holder. |
| `src/orchestrator/prompts/templates/plan-reroute.md` | Render spec-reviewer and prior implementer role holders. |
| `src/orchestrator/prompts/templates/qa.md` | Role-aware commit ownership and tool examples. |
| `src/orchestrator/prompts/templates/code-review-foreman.md` | Conditional three-input mixed synthesis versus two-Claude-lens synthesis, preserving adjudication rules. |
| `src/task/index.ts` | Stamp and set provider pins; clear incompatible sessions; expose completion metadata; refuse direct backend-tag edits. |
| `src/cli/deps.ts` | Compute required binaries at dependency-check time from the selected provider. |
| `src/cli/commands/doctor.ts` | Report the provider setting, require only its binaries, and skip Codex trust in Claude mode. |
| `dist/cli/index.js` | Rebuilt CLI bundle. |
| `dist/orchestrator/run-task.js` | Rebuilt orchestrator bundle. |
| `tests/pipeline-policy.test.ts` | Provider validation/purity, lazy setting resolution, new phase matrix/precedence coverage and environment scrubs. |
| `tests/agent-backend.test.ts` | Preserved 15-site argv parity; backend-tag compatibility matrix, paired clears and provider-aware init checks. |
| `tests/task-cli.test.ts` | Provider creation/set/refusal and canonical worktree write coverage. |
| `tests/completion.golden.json` | Regenerated shell completions for provider and its values. |
| `tests/completion.test.ts` | Pin provider metadata and exercise every advertised setter value. |
| `tests/run-task-safety.test.ts` | Pinned routing, bundle refusal, park/resume, recovery/fix-up, prompt/message, precedence, dependency and environment tests. |
| `tests/run-task-validation.test.ts` | Pass the mixed assignment when pinning status-template agent defaults. |
| `tests/run-task-code-review.test.ts` | Explicit assignment call sites and Claude-mode stale-file/round-record/delta-scope coverage. |
| `tests/recovery-hints.test.ts` | Supply mixed provider in the phase-state fixture. |
| `tests/run-task-prompts.test.ts` | Role-holder/startup/content-preservation assertions and new Claude foreman goldens. |
| `tests/run-task-prompts.golden.json` | Added only Claude round-1 and round-2 entries; all 23 existing values unchanged. |
| `tests/cli.test.ts` | Doctor/init dependency behavior, trust skipping and clean invalid-provider errors. |
| `docs/decisions.md` | Three What/Why/Rule provider decisions, legacy decision pointers and session-tag note. |
| `docs/pipeline-orchestrator.md` | Provider selection/switching, new model/budget rows, two-lens review, tags and park/resume documentation. |
| `templates/docs/pipeline-orchestrator.md` | Generated mirror of the authoritative managed document. |
| `docs/codebase-map.md` | Map provider resolution, explicit routing, session tags and dynamic dependency checks. |
| `docs/architecture.md` | Document optional provider/backend-tag fields and absent-value semantics. |
| `tasks/claude-provider-mode/notes.md` | Append implementation observations and validation discoveries. |
| `tasks/claude-provider-mode/handoff.md` | Record implementation scope, AC evidence, interpretations and validation. |
| `tasks/claude-provider-mode/status.json` | Pipeline phase bookkeeping through the required canon task command; no manual status edits. |

## Canon Governance

The provenance source remains this task's status.json canon stamp.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

Provider selection is explicit and durable: new tasks pin the environment setting, old tasks remain mixed, and each run holds one validated assignment. Backend tags prevent cross-provider session reuse. Only Claude-provider implement and spec_review retain a yielded session on failure; their subsequent prompts distinguish unfinished work from a completed implementation or revised spec.

Claude code review keeps the anchored and spec-blind Claude lenses and the numbered scope record, while mixed review retains its cold-Codex gate. Prompt variables change authored role-holder text without rewriting injected task content. The existing mixed argv parity test and all 23 existing prompt golden values remain unchanged.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Kept the existing buildPipelineState(taskIds) signature rather than adding an optional provider argument. | A shared resolver uses the run's pinned provider, falling back to fixture/task pins for direct helper calls. No alternate assignment override is needed. | AC-3 preserved; the mid-run disk-pin change test passes. |
| Reused the existing headless artifact/phase-command text in Claude implementer/spec-reviewer startup rather than modifying the shared Claude headless block. | This gives those new Claude-held phases the required Blockers rule while preserving existing mixed-mode runner prompts and argv. | AC-12 and AC-14 preserved. |

No source edits exceed the Affected Files cap. The existing completion renderer and numbered archive writer needed no edits: `src/cli/commands/completion.ts` already consumes field metadata, and `src/orchestrator/review-archive.ts` already accepts an arbitrary record body.

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Exact provider parsing, lazy setting resolution, invalid-import test, pure policy and sole setting-name ownership checks. |
| AC-2 | Met | Creation pinning/refusal, atomic setter refusal, backend-tag redirect, completion values and worktree-only mutation tests. |
| AC-3 | Met | Required assignment parameters type-check. Full-tier fake-agent runs reach spec_review and implement with the expected backend/model; changing the disk pin mid-run leaves routing unchanged. |
| AC-4 | Met | Mixed-provider bundle refuses before agent execution and leaves both status files byte-identical. |
| AC-5 | Met | Four-slot table covers role/legacy/both forms, compatible/incompatible/untagged tags and clears. Phase-use, retry, fix-up, provider-switch and no-diff tests cover the wiring. |
| AC-6 | Met | Failed Claude implement retains/tag-resumes an emitted ID with partial-work/park-reason wording; no-ID rerun starts fresh; revision and reroute keep precedence. |
| AC-7 | Met | Failed first Claude spec review resumes without the revised-spec preamble; prior changes-requested review retains it. Mixed and Claude spec/code-review parks do not store failed sessions. |
| AC-8 | Met | Both new phases cover all five sizes, delicate promotion, phase pins at every size, tier/legacy precedence and flat budget override. Existing matrix expectations pass. |
| AC-9 | Met | Claude dry-run covers every phase; both retry phases use Claude matrix config; artifact fix-up resumes the compatible Claude implementer. |
| AC-10 | Met | Injected dependency test forbids any cold-backend request, removes stale unnumbered findings, checks record headers, and resolves delta from the next round's record. Existing mixed hard-fail tests pass. |
| AC-11 | Met | New round-1/round-2 Claude goldens contain the two-lens protocol without Codex passages. Existing mixed goldens remain byte-identical. |
| AC-12 | Met | Every prompt builder, retry/fix-up prompts, startup stripping, Blockers rule, injected-content sentinel, implement log, reroute note and no-diff escalation are covered. |
| AC-13 | Met | Doctor/init pass their Claude dependency checks without Codex; doctor skips its trust check and labels the setting source. Mixed run still requires Codex. Invalid provider errors contain no stack trace. |
| AC-14 | Met | Original 15-site parity expectations unchanged. Full suite passed with all three new environment variables exported; existing mixed prompt values unchanged. |
| AC-15 | Met | Decision entries, matrices, selection/switch/session docs and schema/module notes updated. Managed mirror and docs references pass. |

## Edge Cases Considered

- Unset/empty environment setting versus absent, invalid, null or case-mismatched stored pins.
- Untagged role/legacy sessions inherit mixed backends; a mismatch clears the whole pair and its tag only at use.
- Provider changes during a run affect the next run; incompatible sessions cannot cross backend boundaries.
- A parked implement may have partial edits. Revision and reroute context takes precedence over park-resume context.
- A failed Claude session without an emitted ID cannot create a resumable slot.
- Numbered review records remain usable for delta scope even when no orchestrator cold lens ran.
- Task IDs and missing status files keep their actionable validation errors before provider resolution.
- Real subscription/budget exhaustion was not exercised; tests use fake executables and real subprocess/state paths. The spec's live Human Test Plan remains for review. Claude commit ownership remains prompt-only, and the implementation budget curve remains provisional.

## Blockers

No implementation work or required automated validation is blocked.

- [ambiguity] Provider switching describes old-versus-new assignments, but invalid old pins have no valid assignment. Interpreted clearing as comparing each session's recorded backend (or mixed attribution) against the new assignment. This matches states canon writes and permits repairing an invalid pin; documented in the existing plan notes and tested.
- [ambiguity] The revised-spec preamble rule and mixed-mode preservation can differ after a mixed Codex park. Applied the new prior-changes-requested predicate to Claude-provider tasks only; mixed retains its existing resume-ID predicate, consistent with AC-14 and the plan's interpretation.

The existing scope-policy reasons can still mention the legacy cold-Codex archive when a numbered record is missing or malformed. These are record diagnostics rather than a current role holder; left unchanged as planned to preserve mixed text. Normal Claude rounds write the record. No out-of-scope context-module edit was made; park resume replaces only the known fresh-mode header line after rendering.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| None | Feature; spec explicitly requires no red-first mechanism. | | | |

Two post-implementation mutation checks validated test discrimination: removing park-session storage failed on the absent session ID, and bypassing the Claude cold-lens skip failed on the forbidden cold_reviewer dependency request. Both mutations were restored before the final passing full suite. These are not claimed as pre-fix evidence.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final source/test state. |
| `npm run type-check` | Pass | Required assignment parameters and provider state compile. |
| `npm test` | Pass | Final full run: 1,831 tests; 1,830 passed, 1 skipped, 0 failed. Ran with CANON_PROVIDER=claude, CLAUDE_MODEL_SPEC_REVIEW=unused-review-pin and CLAUDE_MODEL_IMPLEMENT=unused-implement-pin exported. The earlier invalid-ID ordering failure was corrected; its targeted regression and this full rerun pass. |
| `npm run build` | Pass | Rebuilt both declared dist artifacts after the final runtime changes. |
| `npm run docs-refs-check` | Pass | All references valid; rerun after handoff writing as well. |
| `npm run sync-templates:check` | Pass | Authoritative managed doc and generated mirror agree. |
| Scoped component tests | Pass | 354 tests across policy/backend/completion/prompts/review/task CLI. Additional scoped subprocess tests cover new recovery and message paths. |
| Mutation discrimination | Pass | Both deliberately removed wiring lines caused their expected test failures; restored source passes. |
| Prompt compatibility and structural scope checks | Pass | All 23 old golden values unchanged; sole provider-setting owner is the policy wrapper; pure policy has no environment reads; no source edits outside the cap. |
| E2E | deferred_by_spec | Spec Validation Required explicitly marks E2E N/A because there is no UI surface. |

## Ready for Review

- [x] All spec ACs met under the recorded interpretations.
- [x] All applicable automated validation checks pass.
- [x] Deviations, limitations and interpretations documented.

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `src/orchestrator/agents/claude.ts` | Forward and honor wrapForResume in both delivery modes; add the missing completion sentence only to unattended implementer/spec-reviewer calls; isolate and narrow session-ID capture per subprocess attempt. |
| `src/orchestrator/prompts/helpers.ts` | Define the standalone artifact/phase-command completion sentence without adding another headless block. |
| `src/orchestrator/prompts/index.ts` | Remove unconditional Codex headless guidance from Claude prompt construction and retain Claude implementer startup on resumed reroutes. |
| `tests/agent-backend.test.ts` | Cover unwrapped interactive/unattended resume delivery and recognized session events versus foreign events and resume-not-found fallback attempts. |
| `tests/run-task-prompts.test.ts` | Check the final prompt sent in both interactive modes; move the Blockers-rule assertion to backend delivery while keeping raw prompt startup/stripping checks. |
| `tests/run-task-safety.test.ts` | Strengthen actual reroute/fix-up assertions, pin park/fresh headers, and cover a failed implement recovery retry followed by a successful park resume. |
| `dist/orchestrator/run-task.js` | Rebuild the changed orchestrator runtime. The rebuilt CLI bundle has no new delta this iteration. |
| `tasks/claude-provider-mode/notes.md` | Append backend delivery, attempt-local capture and recovery-path observations. |
| `tasks/claude-provider-mode/handoff.md` | Append this review response and validation evidence; preserve earlier sections. |

### Findings addressed

- **Correctness bug F1 — ignored wrapForResume:** fixed in `src/orchestrator/agents/claude.ts` (lines 96, 120, 142 and 328). The backend forwards the existing request flag, and both interactive and stream calls honor it. The actual Claude implement-reroute test now proves that the commit-ownership/startup instructions survive and no generic resumed-session banner is added. The actual artifact-fix-up test proves that its native no-commit instruction survives without that banner.
- **Correctness bug F2 — unconditional/duplicate headless guidance:** removed the full Codex headless block from raw Claude prompts in `src/orchestrator/prompts/index.ts`. `src/orchestrator/agents/claude.ts` (lines 325–328) adds only the missing completion sentence when the call is unattended and the role is implementer or spec_reviewer. Interactive calls receive neither that sentence nor unattended guidance; unattended calls contain exactly one headless block. This supersedes iteration 1's startup-delivery approach without changing mixed-mode headless text.
- **Risk/guardrail F3 — session-ID drift across events/attempts:** session capture now lives inside each attempt in `src/orchestrator/agents/claude.ts` (lines 139–142). Only top-level system/init and result events supply IDs; result IDs take precedence. Removed the arbitrary stdout regex fallback. Tests reject a foreign event ID, retain a recognized result ID, and prove that a failed fresh fallback gets its own ID or null instead of the rejected resume attempt's ID.
- **Risk/guardrail F4 — completed implement recovery can park:** verified the existing behavior rather than changing the specified park predicate. A new integration test drives a failed recovery retry through checkAndRoute and the shared park boundary, verifies its new Claude-tagged session, then resumes it with the partial-work prompt and completes successfully. Artifact-reference fix-ups catch AgentSessionError locally; they retain their existing local-failure behavior.
- **Optional test-strengthening nits:** park prompts now explicitly require the park-resume mode header and reject the misleading fresh-mode description; no-ID reruns explicitly require the normal fresh prompt. Other optional wording/ergonomics suggestions were left unchanged.

### AC deltas

| AC | Status | Evidence |
|---|---|---|
| AC-6 | Met, strengthened | Explicit park/fresh mode assertions and recovery-retry park/resume regression. |
| AC-9 | Met, strengthened | Actual Claude artifact fix-up preserves its purpose-built prompt and commit restriction. |
| AC-12 | Restored to Met from review's Partial | The Blockers completion rule is checked on final unattended delivery; interactive implementer/spec-reviewer prompts contain no false unattended instructions. Reroute startup and fix-up commit restrictions are preserved. |
| AC-14 | Met, unchanged | Original argv parity passes; all 25 current prompt golden values, including the 23 original mixed entries, are unchanged. |

### Blockers / interpretations

No implementation or required automated validation is blocked.

- [ambiguity] F1's proposed test says the artifact fix-up should keep the implementer startup, but the existing purpose-built fix-up prompt never contains that startup. Interpreted the request as preserving its supplied prompt and commit restriction without generic resume rewriting. Reroutes retain full Claude implementer startup; fix-ups retain their native instruction that the orchestrator commits after the turn. Actual call-site tests cover both, and backend tests separately prove any supplied startup survives wrapForResume=false.

### Red-First Evidence

The spec remains a feature with no mandatory red-first AC. These additional regressions were nevertheless written and run before changing non-test code this round, against the task branch's pre-revision HEAD.

| Finding / AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| F1 / AC-9, AC-12 | Regression batch R2 below | cc870352310cf8d7b9cb5531d99137b254a8f870 | Both backend modes and actual reroute/fix-up call sites received the unwanted resumed-session banner; reroute lacked its retained startup. | Pass: both backend modes and both call sites. |
| F2 / AC-12(d) | Regression batch R2 below | cc870352310cf8d7b9cb5531d99137b254a8f870 | Final unattended prompt had two headless blocks; interactive prompt had one instead of zero. | Pass: one unattended block, zero interactive blocks; completion sentence still delivered when unattended. |
| F3 / AC-6, AC-7 | Regression batch R2 below | cc870352310cf8d7b9cb5531d99137b254a8f870 | Foreign-event ID replaced active-session; failed fallback reused old-attempt instead of null. | Pass: recognized per-attempt IDs only; positive new-ID/result-ID cases also pass. |

Regression batch R2 (8 expected failures and 3 passing control cases before the fixes):

```bash
node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='Claude backend honors purpose-built|Claude failure session capture|Claude role prompts gate|Claude provider artifact fix-up resumes only|Claude parked implement preserves reroute' tests/agent-backend.test.ts tests/run-task-prompts.test.ts tests/run-task-safety.test.ts
```

The F4 recovery regression passed against the same pre-revision HEAD and after the fixes; it protects specified behavior rather than claiming a pre-fix defect.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Current source and regression tests. |
| `npm run type-check` | Pass | Optional runner flag and all backend call sites compile. |
| `npm test` | Pass | Full suite: 1,840 tests, 1,839 passed, 1 skipped, 0 failed. Ran with CANON_PROVIDER=claude, CLAUDE_MODEL_SPEC_REVIEW=unused-review-pin and CLAUDE_MODEL_IMPLEMENT=unused-implement-pin exported. |
| `npm run build` | Pass | Both declared artifacts rebuilt; only the orchestrator bundle has a revision delta. |
| `npm run docs-refs-check` | Pass | References checked, including a rerun after this artifact append. |
| `npm run sync-templates:check` | Pass | No managed root/mirror drift. |
| Scoped backend/prompt tests | Pass | 81 tests; includes original argv parity and unchanged prompt goldens. |
| Scoped recovery/reroute/fix-up tests | Pass | 9 tests, including final delivered prompts and the recovery-session park. |
| Current-diff/scope/golden checks | Pass | Changed files reopened; source changes stay within the cap; all 25 golden values unchanged; cumulative Changes coverage checked before phase close. |

E2E remains deferred by the spec's explicit no-UI exception. Live Claude subscription/budget testing remains in the Human Test Plan; no new live-service claim is made.
