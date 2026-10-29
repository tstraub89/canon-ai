# Implementation Handoff: agent-backend-role-routing

> Author: Codex | Spec: `tasks/agent-backend-role-routing/spec.md` | Plan: `tasks/agent-backend-role-routing/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/lib/pipeline-policy.ts` | Pure role assignment, phase/role/slot maps, required backend derivation. |
| `src/orchestrator/agents/backend.ts` | Shared backend requests, normalized session results, role resolver and failure-semantics contract. |
| `src/orchestrator/agents/claude.ts` | Claude backend adapter; preserves runner argv and stale-resume handling. |
| `src/orchestrator/agents/codex.ts` | Codex backend adapter and plain agent-message text in session results. |
| `src/orchestrator/types.ts` | Role session slots, optional legacy fields, normalized phase agent record and Codex text. |
| `src/orchestrator/policy.ts` | Re-exports pure role routing policy. |
| `src/orchestrator/state.ts` | Role-first legacy-fallback reads, role-only writes, pair clears and canonical phase-agent records. |
| `src/orchestrator/phases/spec.ts` | Author backend for fresh and revision sessions. |
| `src/orchestrator/phases/plan.ts` | Author backend with originating plan phase and unchanged cwd. |
| `src/orchestrator/phases/spec-review.ts` | Spec reviewer backend with unchanged fresh/resume framing. |
| `src/orchestrator/phases/implement.ts` | Implementer backend; pair clear for hallucinated revisions across bundle members. |
| `src/orchestrator/phases/code-review.ts` | Injected reviewer/cold reviewer backends; no agent record on preflight rejection. |
| `src/orchestrator/phases/qa.ts` | QA backend and text-first done-summary salvage with stdout fallback. |
| `src/orchestrator/main.ts` | Role dispatch for retries/fix-ups/dry-run; phase-slot storage, agent records, reroute clears and derived binary requirements. |
| `src/task/index.ts` | Reset commands clear both slot names and report role slots. |
| `src/cli/deps.ts` | Derived required binaries with an injectable availability probe. |
| `src/cli/commands/doctor.ts` | Derived agent checks while retaining Claude version and Codex trust checks. |
| `tests/pipeline-policy.test.ts` | Role assignment, phase mapping, slot mapping and required binary fixtures. |
| `tests/agent-backend.test.ts` | Captured session argv baseline, normalized text, fallback/store matrix, dependencies and separate author model pins. |
| `tests/run-task-code-review.test.ts` | Backend injection, no-agent preflight record, foreman/cold-lens argv and prompt parity. |
| `tests/recovery-hints.test.ts` | Adapts recovery fixtures to injected backends. |
| `tests/run-task-reroute-preflight.test.ts` | Full/fast reroutes remove exactly their role/legacy pairs. |
| `tests/run-task-safety.test.ts` | Three red-first regressions, phase/retry/fix-up parity, bundle hallucination clearing, worktree record routing and main storage for every agent phase. |
| `tests/task-cli.test.ts` | Reset pair deletion preserves all other slot pairs. |
| `tests/run-task-validation.test.ts` | Default status-template agents match the role assignment. |
| `dist/cli/index.js` | Regenerated CLI bundle. |
| `dist/orchestrator/run-task.js` | Regenerated orchestrator bundle. |
| `docs/pipeline-orchestrator.md` | Role slots, legacy fallback and paired recovery clearing. |
| `templates/docs/pipeline-orchestrator.md` | Generated mirror via template sync. |
| `docs/patterns.md` | Worktree recovery advice clears both role and legacy slots. |
| `docs/codebase-map.md` | Adds role backend entry point. |
| `docs/decisions.md` | Records role routing and the future provider-pinning constraint. |
| `tasks/agent-backend-role-routing/notes.md` | Records red-first observations, argv baseline and scope-parser issue. |
| `tasks/agent-backend-role-routing/handoff.md` | Implementation evidence and review handoff. |

## Canon Governance

The authoritative provenance is recorded in this task's status file.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

Phases select roles and delegate configuration and execution to backend adapters. The existing runners retain their argument construction and failure behavior. Explicit phase slots prevent plan from overwriting spec continuity; role writes and paired legacy fallback/clears preserve in-flight tasks without a bulk migration. The agent field records returned primary-backend invocations rather than selecting them. QA salvage now examines normalized text before raw stdout.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Red-first and main-loop storage tests use the existing fixture helpers in `tests/run-task-safety.test.ts`, rather than splitting them among recovery/validation test files. | Keeps the real fake-CLI, branch and worktree setup shared. All edits remain in Affected Files. | AC-6 fully exercised; AC-11 template guard remains in `tests/run-task-validation.test.ts`. |
| The argv baseline uses literal argv expectations and a pre-refactor runner run, then actual call-site comparisons against retained runners. | Avoids unstable on-disk prompt fixtures containing temporary paths. The cold-review argv is independently pinned, and prompts/goldens remain unchanged. | AC-3 covered across all fifteen invocation categories. |
| Default assignment is private to the pure policy module. | Tests use public pure functions and fixture assignments; runtime resolution still exposes only the single assignment. | AC-1/7/10 unchanged. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Table rows cover six roles and every phase/slot, including human review; pure policy has zero environment reads. |
| AC-2 | Met | All four prohibited invocation/configuration/vendor-literal searches return zero hits. |
| AC-3 | Met | Captured pre-refactor session argv baseline; real phase, reviewer, cold-lens, retry and fix-up calls capture binary/argv/cwd/prompt through adapters. Distinct spec/plan model pins are asserted. See parity matrix below. |
| AC-4 | Met | Four-slot legacy/role/both read matrix and subsequent stores preserve legacy ids. Bundle stores update both members. Main tests prove plan/QA store nothing. Implement fix-up prefers the role id over a seeded stale legacy id. |
| AC-5 | Met | Reset, fast/full reroute and two-member hallucination fixtures seed all pairs and assert the exact surviving set. Legacy names in source occur only in state/types. |
| AC-6 | Met | Both empty-agent failures reproduced on base and pass now. Main storage tests cover every agent phase; rejected preflight returns no backend and preserves the agent field. Canonical writer has a real worktree regression test. |
| AC-7 | Met | Default and Claude-only fixture derivations tested; init availability and missing-binary rejection tested. Existing doctor tests pass unchanged in the full suite. |
| AC-8 | Met | Fake Claude result-event-only summary fails on base and is salvaged now; implementation gates on either output and tries text before stdout. |
| AC-9 | Met | Both committed-range and working-tree prompt/golden diffs are empty. |
| AC-10 | Met | No provider-selection env, field or flag matches in source. |
| AC-11 | Met | Default agent guard matches role routing; status templates are byte-identical and template sync passes. |

### Invocation parity matrix

| AC-3 site | Evidence |
|---|---|
| 1–2 spec fresh/revision | `tests/run-task-safety.test.ts` phase parity rows; revision resumes; spec retains omitted cwd. |
| 3 spec review fresh/resume | `tests/run-task-safety.test.ts` phase rows and existing reroute cwd coverage. |
| 4 plan | `tests/run-task-safety.test.ts` phase row; separate author config pins in `tests/agent-backend.test.ts`. |
| 5–7 implement fresh/resume/reroute | `tests/run-task-safety.test.ts` phase rows; resume wrapper enabled normally and disabled after reroute. |
| 8–9 review foreman rounds 1/2 | `tests/run-task-code-review.test.ts` real-backend parity rows; fresh first round, resumed later round. |
| 10 cold lens | `tests/run-task-code-review.test.ts` captures cold-review argv and base ref in both rounds. |
| 11 QA | `tests/run-task-safety.test.ts` phase parity row. |
| 12 implement artifact fix-up | `tests/run-task-safety.test.ts` review-entry fixture asserts complete argv, worktree cwd and unwrapped fix-up prompt. |
| 13–14 Codex/Claude retry | `tests/run-task-safety.test.ts` retry rows compare complete invocation with retained runners and assert no retry metrics. |
| 15 QA fix-up | `tests/run-task-safety.test.ts` in-process QA fixture asserts complete resumed argv, budget and cwd. |

`tests/agent-backend.test.ts` additionally pins literal session flags, model, effort and budget under a scrubbed environment across the session scenarios. Its original runner baseline passed before non-test edits at base commit 9675e2f2713e31e7c41445eee607e2d5b39c03b8.

## Edge Cases Considered

- Missing sessions and missing phase entries remain tolerated. Null/undefined role ids fall back; empty strings retain nullish-read semantics.
- Plan shares author configuration but has no session slot; QA keeps only the immediate in-memory session needed by its fix-up.
- Bundle writes/records target every member; reads use member zero; hallucination recovery clears every member.
- Preflight rejection records no backend. Fast-tier skipped phases preserve their prior agent fields.
- Claude stale-resume retry, interactive behavior, budgets and Codex non-zero-return behavior remain in the original runners.
- New session fields are optional. Manual schema review confirms no template rewrite or migration runner is required by this additive compatibility change.
- Live credentialed provider sessions were not run; subprocess fixtures cover invocation wiring. The spec's human smoke plan remains for QA/human review.

## Blockers

- [ambiguity] Does the fused Affected Files row in `tasks/agent-backend-role-routing/spec.md` authorize `dist/cli/index.js`? Interpreted the explicit literal path and required rebuild instruction as authorization to regenerate both bundles. The spec itself was left unchanged.
- [pipeline] Confirmed with the real `parseAffectedFilesFromSpec` in `src/orchestrator/validation.ts`: the fused row silently omits `dist/cli/index.js` and reports no malformed cell. A downstream scope gate can reject this required generated bundle until the spec owner separates its row. Changing the parser or spec is outside the implementation cap; no git-state recovery was attempted.

## Red-First Evidence

All three tests ran before non-test edits. The command below selected only these regression tests, and all failed by assertion rather than compilation.

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-6(a) | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='role routing red-first' tests/run-task-safety.test.ts` | 9675e2f2713e31e7c41445eee607e2d5b39c03b8 | Empty implement agent returned RETRY=no_session instead of invoking the stored implementer session. | Pass in targeted rerun and final full suite. |
| AC-6(b) | Same selected command as AC-6(a). | 9675e2f2713e31e7c41445eee607e2d5b39c03b8 | sessions.author was undefined after the completed empty-agent spec session. | Pass in targeted rerun and final full suite. |
| AC-8 | Same selected command as AC-6(a). | 9675e2f2713e31e7c41445eee607e2d5b39c03b8 | Result-event text was emitted, but done.md did not exist (false versus true). | Pass in targeted rerun and final full suite. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final source/test tree. |
| `npm run type-check` | Pass | Node 24.21.0 / TypeScript project check. |
| `npm test` | Pass | Final full suite: 1788 tests; 1787 passed, zero failures, one skip. Earlier full-suite checkpoint also passed. |
| `npm run build` | Pass | Both committed bundles regenerated from the current source. |
| `npm run sync-templates:check` | Pass | Managed mirror synchronized; status-template bytes unchanged. |
| `npm run docs-refs-check` | Pass | Required pre-handoff run passed; also rechecked after this artifact was written. |
| Structural AC checks | Pass | AC-1/2/5/9/10 searches and template byte comparison satisfy their specified zero-hit/allowlist conditions; working-tree prompts/goldens also unchanged. |
| `git diff --check` | Pass | No whitespace errors. |
| E2E | not_configured | Spec Validation Required explicitly marks E2E N/A: no UI surface. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage).
- [x] All applicable validation checks pass.
- [x] All deviations documented.

The scope-parser blocker above needs spec-owner attention before downstream scope reconciliation.

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `src/orchestrator/phases/qa.ts` | Uses truthy fallback because the summary extractor returns an empty string on no match. |
| `tests/run-task-safety.test.ts` | Adds stdout fallback, empty-text fallback and competing-summary priority cases; adds a legacy-slot empty-agent retry case and a populated-agent control. |
| `tests/agent-backend.test.ts` | Describes the adapter contract and current-config expectations accurately; removes the misleading provenance comment and all-call-sites title. |
| `tests/run-task-code-review.test.ts` | Corrects optional nit 5's indentation. |
| `dist/orchestrator/run-task.js` | Rebuilt QA fallback change. |
| `tasks/agent-backend-role-routing/notes.md` | Records the empty-string extractor contract, isolated historical retry evidence and incoming spec-row repair. |
| `tasks/agent-backend-role-routing/handoff.md` | Appends this revision's findings, evidence and validation. |

### Findings addressed

- Correctness bug 1: `src/orchestrator/phases/qa.ts` now uses `||`, so a failed text extraction tries captured stdout. New real phase/fake-Claude tests cover both non-summary and empty normalized text, and verify that normalized text still wins when both sources contain a summary.
- Risk 2: new fixtures in `tests/run-task-safety.test.ts` seed only the legacy implement session. On the original base, the empty-agent case fails while the otherwise identical Codex-agent control resumes that session. Both pass with current routing. This supplies isolated AC-6(a) evidence without relying on the role-key rename. The original role-slot and AC-6(b) storage tests remain, as permitted by the review.
- Risk 3: `tests/agent-backend.test.ts` now states that it exercises backend adapter scenarios and constructs expectations with current config getters/shared prompt helpers under a scrubbed environment. It no longer claims to exercise every call site or be a runnable fixture at the pre-backend commit. The earlier baseline experiment recorded above used the pre-refactor test form; the checked-in test is not itself that historical form. Actual call-site comparisons remain in `tests/run-task-safety.test.ts` and `tests/run-task-code-review.test.ts`.
- Optional nit 5: aligned the detached cold-review binding with its enclosing block. Other optional API/type refactors were left unchanged.

### AC deltas

| AC | Status | Evidence |
|---|---|---|
| AC-8 | Met — restored from Round 1's Partial | Both stdout fallbacks now execute; text-priority control remains green. |
| AC-6 | Met — evidence strengthened | Legacy-only retry fixture isolates the empty-agent failure on the original base, with a passing populated-agent control. |
| AC-3 | Met — unchanged behavior | Only the adapter test's description changed; per-site invocation parity still passes in the full suite. |

### Red-First Evidence

No production code changed before the QA red run. For the historical retry check, an archive of the recorded base was extracted into a scratch directory, linked to the installed test dependencies, and given only the new legacy retry test cases; no original production files were patched.

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-8 | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='QA salvage output selection' tests/run-task-safety.test.ts` | c6c3e4f0b10c0a8bef1b7b290d706610884e0506 | Both fallback cases failed by assertion because done.md was absent. Text-priority control passed. | All three cases pass; included in the nine-check focused run and full suite. |
| AC-6(a), Risk 2 | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='legacy retry isolates empty agent' tests/run-task-safety.test.ts` | 9675e2f2713e31e7c41445eee607e2d5b39c03b8, scratch archive with only these tests added | Empty-agent case returned RETRY=no_session instead of resuming the legacy id. Codex-agent control passed with the same legacy slot and id. | Both variants pass and assert exec resume with the stored legacy id; included in the full suite. |

### Blockers

None open for this iteration. The incoming edit to `tasks/agent-backend-role-routing/spec.md` separates the CLI bundle row. The real affected-files parser now includes `dist/cli/index.js` with no malformed cells, resolving both historical scope-row entries in the initial Blockers section. This revision preserved that incoming edit rather than modifying the spec.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Includes new fixture cases and corrected test wording. |
| `npm run type-check` | Pass | Current source and tests. |
| `npm test` | Pass | Full suite: 1793 tests, 1792 passed, zero failures, one skip. |
| `npm run build` | Pass | Both bundles rebuilt; only the orchestrator bundle changed this iteration. |
| `npm run sync-templates:check` | Pass | Managed files remain synchronized. |
| `npm run docs-refs-check` | Pass | Passed before writing this section; rechecked with the appended artifact. |
| Focused regression run | Pass | Nine checks: original red-first cases, QA invocation parity, legacy retry/control, and three output-selection cases. |
| Cumulative handoff coverage | Pass | Every path in git diff main...HEAD --name-only is covered across the Changes tables; current source edits are also covered. |
| `git diff --check` | Pass | No whitespace errors. |
| E2E | not_configured | Spec Validation Required explicitly marks E2E N/A: no UI surface. |
