# Implementation Handoff: claude-provider-mode

> Author: Codex | Spec: `tasks/claude-provider-mode/spec.md` | Plan: `tasks/claude-provider-mode/plan.md`
>
> Current state after reroute 1. The Amendment overrides the original Claude record filename requirement. Earlier completed implementation and review fixes remain in place.

## Changes

This table covers the complete cumulative task diff plus current tracked and untracked changes. Pipeline-owned task artifacts from prior QA and the reroute are included for coverage; they were preserved rather than rewritten during implementation. Their earlier QA conclusions are not claimed as fresh validation of this amendment.

| File | What Changed |
|---|---|
| `dist/cli/index.js` | Rebuilt CLI bundle for the complete task; no additional reroute delta. |
| `dist/orchestrator/run-task.js` | Rebuilt orchestrator bundle including neutral round-record support. |
| `docs/architecture.md` | Document optional provider/backend-tag fields and absent-value semantics. |
| `docs/codebase-map.md` | Map provider resolution, explicit routing, session tags and dynamic dependency checks. |
| `docs/decisions.md` | Provider/session/review decisions; Claude records use the neutral family and scope lookup reads both families. |
| `docs/pipeline-orchestrator.md` | Provider/config/recovery guidance and matrices; document neutral Claude records, unchanged mixed archives and two-family scope lookup. |
| `src/cli/commands/doctor.ts` | Report the provider setting, require only its binaries, and skip Codex trust in Claude mode. |
| `src/cli/deps.ts` | Compute required binaries at dependency-check time from the selected provider. |
| `src/lib/pipeline-policy.ts` | Provider presets, explicit role assignments, Claude phase cells/pins/budgets, and the new full-scope reason for conflicting prior-round records. |
| `src/orchestrator/agents/backend.ts` | Require an explicit role assignment for backend lookup. |
| `src/orchestrator/agents/claude.ts` | Support both new phases; honor purpose-built resume prompts, gate completion guidance on unattended roles, and capture recognized session IDs per attempt. |
| `src/orchestrator/agents/errors.ts` | Carry optional failed-session continuity in AgentSessionError. |
| `src/orchestrator/main.ts` | Pin provider once, reject incompatible bundles, route dependencies/recovery/fix-ups, persist eligible parked sessions, and render role-holder messages. |
| `src/orchestrator/phases/code-review.ts` | Use explicit provider routing; Claude writes a neutral round record and removes stale unnumbered findings; mixed retains its cold lens and archive; conflicts force full scope. |
| `src/orchestrator/phases/implement.ts` | Route implementer, select partial-work park resume, and render role-aware no-diff warnings/escalations. |
| `src/orchestrator/phases/plan.ts` | Route author calls with the run assignment. |
| `src/orchestrator/phases/qa.ts` | Route QA calls with the run assignment. |
| `src/orchestrator/phases/spec-review.ts` | Route reviewer, render role-holder messages, and distinguish parked first reviews from revised-spec reviews. |
| `src/orchestrator/phases/spec.ts` | Route author calls with the run assignment. |
| `src/orchestrator/policy.ts` | Call-time provider setting and task/bundle pin validation; model pins and provider source label. |
| `src/orchestrator/prompts/helpers.ts` | Claude startup without a sandbox claim, resume stripping, and the standalone unattended artifact/phase-command completion sentence. |
| `src/orchestrator/prompts/index.ts` | Role-holder rendering, partial-work park resume, retained Claude reroute startup, and unchanged mixed/Claude foreman prompt contracts. |
| `src/orchestrator/prompts/templates/code-review-foreman.md` | Conditional three-input mixed synthesis versus two-Claude-lens synthesis, preserving adjudication rules. |
| `src/orchestrator/prompts/templates/plan-reroute.md` | Render spec-reviewer and prior implementer role holders. |
| `src/orchestrator/prompts/templates/plan.md` | Render the implementer role holder. |
| `src/orchestrator/prompts/templates/qa.md` | Role-aware commit ownership and tool examples. |
| `src/orchestrator/prompts/templates/spec-review-reroute.md` | Provider-specific cross-review wording. |
| `src/orchestrator/prompts/templates/spec-review.md` | Role variables and separate-session cross-review wording in Claude mode. |
| `src/orchestrator/review-archive.ts` | Add the lens-neutral round writer; share the unchanged header/numbering format; read both record families and detect malformed records or conflicting SHAs. |
| `src/orchestrator/state.ts` | Tagged writes, paired clears, use-time compatibility checks, and provider-switch clearing. |
| `src/orchestrator/types.ts` | Optional provider/backend-tag schema and required run-state provider. |
| `src/task/index.ts` | Stamp and set provider pins; clear incompatible sessions; expose completion metadata; refuse direct backend-tag edits. |
| `tasks/claude-provider-mode/done.md` | Prior QA summary retained for the next QA phase to refresh after the amendment. |
| `tasks/claude-provider-mode/handoff.md` | Complete current implementation handoff rewritten for reroute 1, including prior regression evidence. |
| `tasks/claude-provider-mode/lessons.md` | Prior task lessons fragment retained for subsequent QA. |
| `tasks/claude-provider-mode/metrics.md` | Pipeline invocation telemetry including earlier phases and reroute phases. |
| `tasks/claude-provider-mode/notes.md` | Cumulative phase observations, including record-family and compatibility findings. |
| `tasks/claude-provider-mode/plan.md` | Original plan plus the reviewed reroute plan for neutral records and two-family lookup. |
| `tasks/claude-provider-mode/pr-body.md` | Prior QA PR-body artifact retained for subsequent QA refresh. |
| `tasks/claude-provider-mode/quality-log.md` | Prior QA task-quality fragment retained for subsequent QA reconciliation. |
| `tasks/claude-provider-mode/review-cold-codex-run-1.md` | Existing mixed-mode review archive retained without migration. |
| `tasks/claude-provider-mode/review-cold-codex-run-2.md` | Existing mixed-mode review archive retained without migration. |
| `tasks/claude-provider-mode/review-cold-codex.md` | Prior mixed-mode cold findings retained as pipeline evidence; the Claude review path removes a stale unnumbered file when it runs. |
| `tasks/claude-provider-mode/review-prior-1.md` | Archived prior review; round 2 approved with nits and has no unresolved blocking findings. |
| `tasks/claude-provider-mode/review.md` | Current review scaffold and pipeline-owned review state after reroute. |
| `tasks/claude-provider-mode/spec-review.md` | Spec-review record including amendment approval. |
| `tasks/claude-provider-mode/spec.md` | Original spec plus the human amendment adding AC-16 through AC-19. |
| `tasks/claude-provider-mode/status.json` | Pipeline-managed phase/provider/session state; phase completion uses the required canon task command. |
| `templates/docs/pipeline-orchestrator.md` | Generated mirror of the authoritative managed document. |
| `tests/agent-backend.test.ts` | Preserved 15-site argv parity; backend-tag compatibility matrix, paired clears and provider-aware init checks. |
| `tests/cli.test.ts` | Doctor/init dependency behavior, trust skipping and clean invalid-provider errors. |
| `tests/completion.golden.json` | Regenerated shell completions for provider and its values. |
| `tests/completion.test.ts` | Pin provider metadata and exercise every advertised setter value. |
| `tests/pipeline-policy.test.ts` | Provider/phase matrix and environment cases plus a matching pure-policy row for conflicting round records. |
| `tests/recovery-hints.test.ts` | Supply mixed provider and complete record-related injected dependencies in the recovery fixture. |
| `tests/run-task-code-review.test.ts` | Preserve mixed expectations; test neutral filenames, provider switches, agreement/conflict, malformed/CRLF/unreadable records, and independent numeric allocation. |
| `tests/run-task-prompts.golden.json` | Added only Claude round-1 and round-2 entries; all 23 existing values unchanged. |
| `tests/run-task-prompts.test.ts` | Role-holder/startup/content-preservation assertions and new Claude foreman goldens. |
| `tests/run-task-safety.test.ts` | Pinned routing, bundle refusal, park/resume, recovery/fix-up, prompt/message, precedence, dependency and environment tests. |
| `tests/run-task-validation.test.ts` | Pass the mixed assignment when pinning status-template agent defaults. |
| `tests/task-cli.test.ts` | Provider creation/set/refusal and canonical worktree write coverage. |

## Canon Governance

The authoritative provenance source remains this task's status.json canon stamp.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

Tasks pin mixed or Claude provider routing, and each run holds one validated assignment. Backend-tagged sessions prevent resuming an ID through another backend. Claude implement and spec-review failures retain a yielded session when parked, with prompts distinguishing unfinished work from completed implementation and revised specs. The prior review fixes remain: Claude honors wrapForResume, unattended completion guidance is delivered once, and session capture is local to a subprocess attempt and recognized top-level events.

The amendment makes Claude round metadata lens-neutral. Claude code review now writes a numbered neutral record with the same scope header and no lens findings; it requests no orchestrator cold lens and removes stale unnumbered findings. Mixed mode retains the cold-Codex invocation and both of its existing output files.

Both record families are read for previous-round scope. Within each family, the highest-numbered readable record whose header matches the requested round wins. Matching SHAs across families are usable; different SHAs make the previous record unusable and produce an explicit full-scope reason. Family-local max+1 allocation preserves invocation history independently of the header round. Existing archives are not renamed or migrated.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| No material reroute-plan deviation. | Added the planned neutral writer, two-family lookup, conflict fact/reason, dependency wiring, tests and docs. | AC-16 through AC-19 met. |
| Original buildPipelineState signature retained. | The run-scoped provider resolver handles main and direct fixture calls without another assignment override. | AC-3 preserved. |
| Prior implementation's headless delivery approach was replaced during review fixes. | Only the missing completion sentence is added by the Claude backend on unattended implementer/spec-reviewer calls; the shared mixed Claude headless block remains unchanged. | AC-12 and AC-14 preserved. |

`scripts/docs-refs-check.mjs` is deliberately untouched: the neutral record body has no backticked paths or links and needs no new noisy-source exemption. The shared completion renderer in `src/cli/commands/completion.ts` already consumes the task field metadata and still needs no edit. No source edits exceed the union of the original and amendment Affected Files tables.

## AC Coverage

| AC | Status | Evidence |
|---|---|---|
| AC-1 | Met | Exact provider parsing, lazy setting resolution, import-with-invalid-setting test, pure policy and sole setting-name ownership checks. |
| AC-2 | Met | Task creation pinning, atomic setter refusal, backend-tag redirect, completion metadata/values and canonical worktree mutation coverage. |
| AC-3 | Met | Explicit assignment parameters compile; full-tier fake-agent runs cover both providers and keep routing fixed when the disk pin changes mid-run. |
| AC-4 | Met | Mixed-provider bundles refuse before agent execution and leave task status files unchanged. |
| AC-5 | Met | Four-slot role/legacy/tag compatibility table and phase-use, retry, fix-up, provider-switch, reroute and no-diff clear tests pass. |
| AC-6 | Met | Claude implement park/resume, no-ID fresh entry, correct mode headers, revision/reroute precedence and recovery-retry park/resume tests pass. |
| AC-7 | Met | First-review park resumes without a false revised-spec preamble; genuine re-review retains it. Failed IDs are attempt-local. Other phase/provider park semantics remain covered. |
| AC-8 | Met | Both new Claude phase matrices, all five sizes, delicate promotion, model precedence and flat budget override coverage pass. |
| AC-9 | Met | Claude dry run, retries and purpose-built implement artifact fix-up paths pass. |
| AC-10 | Met as amended | No Claude cold-backend request; stale unnumbered findings removed; the Amendment replaces the original Claude archive filename with a neutral numbered round record. Delta and mixed hard-fail behavior pass. |
| AC-11 | Met | All 25 current golden values unchanged, including the two Claude foreman entries; the original mixed entries remain byte-identical. |
| AC-12 | Met | Role-holder strings, startup stripping, interactive/unattended delivery, Blockers completion rule, content preservation, reroute and fix-up commit restrictions remain covered. |
| AC-13 | Met | Claude-only dependency/trust behavior, mixed Codex requirement, and clean invalid-setting errors pass. |
| AC-14 | Met | Original argv and mixed prompt expectations unchanged; full suite passes with the three new environment variables exported. |
| AC-15 | Met as amended | Provider/session/model/budget docs retained; the Claude record documentation is updated by AC-19. Docs refs and managed sync pass. |
| AC-16 | Met | Actual Claude phase test writes the neutral round-1/round-2 files, writes no cold archive, and removes stale unnumbered findings. The neutral body has no vendor name or lens findings. |
| AC-17 | Met | Claude-to-Claude, mixed-to-Claude, Claude-to-mixed, conflicting-SHA, agreeing-SHA and malformed-neutral cases pass. Unit tests cover per-family allocation, header-round selection, CRLF, ignored names, malformed files and unreadable records. |
| AC-18 | Met | Existing mixed code-review expectations and all golden values unchanged. A mixed round after a neutral record writes only its existing cold files. Exact mixed header/body bytes and independent allocation are pinned. |
| AC-19 | Met | The pipeline doc and synced mirror describe both families and conflict fallback; the Claude-mode decision names the neutral record. The remaining cold archive filename references in docs describe mixed mode. |

## Review Findings / Scope

The archived review in `tasks/claude-provider-mode/review-prior-1.md` ended with Approved with nits. Its blocking findings are resolved in the current files: resume wrapping, headless delivery, attempt-local session capture, and recovery park coverage. No unresolved blocking finding required additional work in this reroute. Optional nits remain outside this round's scope.

Only the amendment's record handling, its conflict routing fact, required dependency fixtures, docs and generated runtime changed this round. Provider routing, session handling, budgets, foreman prompts and mixed expected values were retained.

## Edge Cases Considered

- Old tasks without a pin remain mixed; invalid pins and incompatible bundles are refused before agent execution.
- Session/backend mismatches clear only the slot being used, and provider changes take effect on the next run.
- Unfinished Claude work resumes after a park; revision and reroute retain precedence. Interactive calls carry no false unattended instructions.
- Equal file numbers across families are harmless: lookup matches the header round, not the filename number.
- Per-family gaps, file numbers reaching 10, a file numbered 0, and nonmatching names retain existing numeric rules.
- A newer malformed or unreadable record is reported by the malformed check and skipped by lookup, preserving the old within-family behavior.
- Agreeing records may differ in other header metadata; only the reviewed SHA drives prior-commit scope. Conflicting SHAs force full scope without relabeling the issue as a bundle disagreement.
- Existing mixed archive bytes, reason strings for existing states, and prompt goldens remain unchanged. Legacy-named lookup APIs now document that they read both families.
- Live Claude subscription/budget exhaustion remains a Human Test Plan item; automated coverage uses fake agents with actual subprocess/state paths. Commit ownership remains prompt-only and implementation budgets remain provisional.

## Blockers

No implementation work or required automated validation is blocked. No new ambiguity was needed for the Amendment.

Retained interpretations from earlier rounds (accepted by the archived review):

- [ambiguity] Provider switching compares stored backend tags, with mixed attribution for untagged sessions, against the target assignment. This also permits repairing an invalid old provider pin.
- [ambiguity] The revised-spec preamble's prior-changes-requested predicate applies to Claude tasks; mixed keeps its existing resume-ID predicate to preserve AC-14.
- [ambiguity] A purpose-built artifact fix-up has no full implementer startup to retain. It preserves its supplied no-commit instruction without generic resume rewriting; reroutes retain full Claude implementer startup. The archived review accepted this interpretation.

## Red-First Evidence

The feature and Amendment contain no mandatory red-first AC. Prior voluntary evidence is carried forward below; this reroute also ran the amendment regression batch before changing non-test code, against HEAD 96c7f758e503a42d648f9a0c306f457407ce73d2. Production sources were clean at entry; the dirty files were task artifacts.

| Finding / AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| None | Original feature; no mandatory red-first mechanism. | | | |
| F1 / AC-9, AC-12 | Regression batch R2 below | cc870352310cf8d7b9cb5531d99137b254a8f870 | Both backend modes and actual reroute/fix-up call sites received the unwanted resumed-session banner; reroute lacked its retained startup. | Pass: both backend modes and both call sites. |
| F2 / AC-12(d) | Regression batch R2 below | cc870352310cf8d7b9cb5531d99137b254a8f870 | Final unattended prompt had two headless blocks; interactive prompt had one instead of zero. | Pass: one unattended block, zero interactive blocks; completion sentence still delivered when unattended. |
| F3 / AC-6, AC-7 | Regression batch R2 below | cc870352310cf8d7b9cb5531d99137b254a8f870 | Foreign-event ID replaced active-session; failed fallback reused old-attempt instead of null. | Pass: recognized per-attempt IDs only; positive new-ID/result-ID cases also pass. |
| AC-16 | Regression batch R3 below | 96c7f758e503a42d648f9a0c306f457407ce73d2 | Claude round wrote the old archive; reading the required neutral round file failed with ENOENT. | Pass: neutral records only for Claude; mixed files unchanged. |
| AC-17(c) | Regression batch R3 below | 96c7f758e503a42d648f9a0c306f457407ce73d2 | A neutral previous-round record produced full scope instead of delta after switching to mixed. | Pass: delta from the neutral record. |
| AC-17(d) | Regression batch R3 below | 96c7f758e503a42d648f9a0c306f457407ce73d2 | Different SHAs across families produced delta instead of full scope. | Pass: explicit conflict reason and full scope. |
| AC-17 malformed record | Regression batch R3 below | 96c7f758e503a42d648f9a0c306f457407ce73d2 | Malformed neutral record was called missing rather than unparseable. | Pass: both families use the same malformed/read-failure check. |

Regression batch R2, carried forward from the prior implementation revision (8 expected failures and 3 passing control cases before those fixes):

```bash
node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='Claude backend honors purpose-built|Claude failure session capture|Claude role prompts gate|Claude provider artifact fix-up resumes only|Claude parked implement preserves reroute' tests/agent-backend.test.ts tests/run-task-prompts.test.ts tests/run-task-safety.test.ts
```

Regression batch R3, before amendment implementation (6 expected failures):

```bash
node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='Claude provider skips orchestrator|round lookup across record families' tests/run-task-code-review.test.ts
```

The mixed-to-Claude scope and same-SHA agreement subcases already resolved delta before this amendment; their red runs failed later on the newly required filename. They are compatibility controls for scope, not claims of a pre-existing scope defect. Claude-to-Claude scope is also covered by the completed phase writer test and the one-family-lookup mutation.

The prior recovery-session regression passed before and after the review fixes. Earlier post-implementation mutation checks for park-session storage and cold-lens skipping also remain valid history. This reroute additionally removed each of the two-family lookup, conflict guard and neutral writer dispatch in turn; each targeted test failed for its intended reason, and every mutation was restored before the final full suite.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run build` | Pass | Both declared bundles rebuilt. The CLI bundle is unchanged from pre-reroute HEAD; the orchestrator bundle includes the new record handling. |
| `npm run type-check` | Pass | All new policy facts and injected dependencies compile. |
| `npm run lint` | Pass | Final source and tests, including the amendment cases. |
| `npm test` | Pass | Full suite: 1,849 tests, 1,848 passed, 1 skipped, 0 failed. Ran with CANON_PROVIDER=claude, CLAUDE_MODEL_SPEC_REVIEW=unused-review-pin and CLAUDE_MODEL_IMPLEMENT=unused-implement-pin exported. |
| `npm run sync-templates:check` | Pass | Authoritative managed document and derived mirror agree. |
| `npm run docs-refs-check` | Pass | All refs valid; rerun after the rewritten handoff as well. |
| Scoped review/policy/recovery tests | Pass | 203 tests passed, including existing mixed expectations and all new record-family cases. |
| Mutation discrimination | Pass | One-family lookup, missing conflict guard and old Claude writer each caused expected failures; restored source passes. |
| Golden / docs / scope / cumulative coverage checks | Pass | All 25 golden entries unchanged; docs attribute old archive writes to mixed only; source edits stay in scope; Changes covers committed and dirty/untracked task paths. |
| E2E | deferred_by_spec | Original Validation Required explicitly marks E2E N/A because there is no UI surface; Amendment adds no UI. |

## Ready for Review

- [x] Original requirements and Amendment AC-16 through AC-19 met under the recorded interpretations.
- [x] All applicable automated validation checks pass.
- [x] Earlier regression evidence carried forward and the current cumulative scope documented.
