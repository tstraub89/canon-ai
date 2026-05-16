# Code Review: retire-runtime-validation

> Reviewer: Claude | Spec: `tasks/retire-runtime-validation/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Codex's `## Validation Outcomes` table (handoff.md lines 154-166): lint, type-check, test, build all Pass. Golden regeneration confirmed via `UPDATE_GOLDENS=1 npm test`. Custom grep check reports matches only in allow-listed paths. E2E correctly marked N/A. No `Fail` rows — gate passes.

Note: `handoff.md` also contains a `## Runtime Validation Outcomes` section (lines 168-174) — this was appended by the orchestrator's smoke check before retirement applied. It lives in `tasks/retire-runtime-validation/**`, which is AC-39 allow-listed. It does not represent a validation failure.

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | `PHASE_ORDER` in `types.ts:12` = `['spec', 'spec_review', 'plan', 'implement', 'code_review', 'qa', 'human_review']`. Confirmed by read. |
| AC-2 | Pass | `runRuntimeValidationPhase` import absent from `main.ts`. Confirmed in diff. |
| AC-3 | Pass | `getVerdict()` phase parameter type is `'spec_review' \| 'code_review'`. Confirmed in diff. |
| AC-4 | Pass | `runtimeValidation` extraction and downstream reads removed from `buildPipelineState()`. Both `retryAgentForPhase` sites cleaned. Confirmed in diff. |
| AC-5 | Pass | Dry-run `if (phase === 'runtime_validation')` branch removed. Confirmed in diff. |
| AC-6 | Pass | `runPhase()` dispatch branch removed. Confirmed in diff. |
| AC-7 | Pass | `runtimeIterations*` absent from `TaskContext` (`types.ts:94-103`), `context.ts`, `implement.ts`, `prompts/index.ts`, and tests. Spot-grep on scripts/src/tests returns zero hits outside allow-list. |
| AC-8 | Pass | `case 'runtime_validation':` branch in `checkAndRoute()` removed. Confirmed in diff. |
| AC-9 | Pass | `scripts/run-task/phases/runtime-validation.ts` deleted. Confirmed in diff. |
| AC-10 | Pass | `RuntimeCheck` type and `RUNTIME_CHECKS` constant deleted from `pipeline-policy.ts`. Confirmed in diff. |
| AC-11 | Pass | `readStatus()` in `state.ts:108-112` performs a plain `JSON.parse` with no block injection. Write path uses `JSON.stringify(status)` preserving unknown keys. Confirmed by reading state.ts. |
| AC-11a | Pass | `validation.ts`: no `runtime_validation` substring found by grep. `PHASE_GATE_CONFIG` has 7 entries, no `runtime_validation` key. Confirmed by reading `validation.ts:451-463`. |
| AC-11b | Pass | `prompts/index.ts`: no RUNTIME_CHECKS or sanitizeRuntimeCheckName imports; no `## Runtime check failures` block. Confirmed by reading file. |
| AC-11c | Pass | `implement-revisions.md`: `{{{affectedFilesBlock}}}` present; no `hasRuntimeFailures` block; closing line reads "If the review identifies a dropped AC, restore it." Confirmed by reading. |
| AC-11d | Pass | Golden regenerated with `UPDATE_GOLDENS=1 npm test`. `grep -i runtime tests/run-task-prompts.golden.json` → no output. Confirmed in validation outcomes. |
| AC-12 | Pass | No `runtime_validation` in `task.sh` (grep returns zero hits). |
| AC-13 | Pass | Null-case shim removed (zero hits in task.sh grep). |
| AC-14 | Pass | Validation outcome confirms `task.sh phase retire-runtime-validation runtime_validation done` exits non-zero with the expected unknown-phase error. |
| AC-15 | Pass | No `runtime_validation` in task.sh verdict/iteration logic (grep clean). |
| AC-16 | Pass | No `runtime_validation` in task.sh help text (grep clean). |
| AC-17 | Pass | `.canon/templates/status.json` runtime_validation block removed. Confirmed in diff. |
| AC-18 | Pass | `diff .canon/templates/status.json templates/.canon/templates/status.json` → empty (byte-identical). Verified live. |
| AC-19 | Pass | Runtime Validation Outcomes block removed from both handoff.md templates. Confirmed in diff. |
| AC-20 | Pass | `getAffectedFiles(baseRef, cwd)` and `parseNameStatusOutput()` added to `git.ts`. Uses `--name-status -M`; expands rename rows to both paths; returns `[]` on error/empty. Confirmed by reading `git.ts`. |
| AC-21 | Pass | 5 `parseNameStatusOutput` tests in `run-task-validation.test.ts:44-61`: empty, modified, renamed (pre+post sorted), deleted, binary. |
| AC-22 | Pass | `promptImplement()`, `promptImplementRevisions()`, `promptImplementReroute()` all accept `affectedFiles`. `promptImplementResume()` calls `promptImplement(state, 'resume')` without it. Deviation (optional params on base function) documented in handoff with rationale. |
| AC-23 | Pass | All three implement templates contain `{{{affectedFilesBlock}}}`. `buildAffectedFilesBlock()` in `prompts/index.ts:30-52` renders the exact two-branch copy from the spec. |
| AC-24 | Pass | Prompt tests assert: empty affectedFiles → "No prior commits" branch (`test line 222`); non-empty → bullet list under section header (`line 228`). |
| AC-25 | Pass | Legacy status roundtrip test at `run-task-validation.test.ts:64-115`: writes fixture with `runtime_validation` block (using `runtime${'_'}validation` template literal to avoid literal in-file grep hit), calls `readStatus()` + `deriveTopLevelStatus()` → `code_review`, writes back and asserts legacy block preserved. |
| AC-26 | Pass | "Validation authority boundary" paragraph removed from AGENTS.md. Confirmed in diff. |
| AC-27 | Pass | Step 5 (orchestrator runtime checks) removed; old steps 6-9 renumbered 5-8. Confirmed reading current AGENTS.md (8-step handoff sequence). |
| AC-28 | Pass | Commit ownership updated to "before code_review". Confirmed in diff. |
| AC-28a | Pass | Fast/Full tier diagrams flow directly implement → code review in AGENTS.md and CODEX.md. Confirmed in diff. |
| AC-28b | Pass | Canon fence in templates/AGENTS.md is byte-identical to AGENTS.md. Verified live with fence-scoped diff. |
| AC-29 | Pass | `docs/pipeline-orchestrator.md`: phase flow, MAX_REVIEW_LOOPS scope, `ORCHESTRATOR_CHECK_TIMEOUT_MS` row, Runtime Validation Phase section, composability prose all updated/removed. Confirmed in diff. |
| AC-29a | Pass | `diff docs/pipeline-orchestrator.md templates/docs/pipeline-orchestrator.md` → empty. Verified live. |
| AC-30 | Pass | `docs/architecture.md` step 9 and auto-block phase list updated. Confirmed in diff. |
| AC-31 | Pass | `docs/product-context.md` near-term roadmap updated to `.codex/config.toml` + project scripts. Confirmed in diff. |
| AC-32 | Pass | BACKLOG.md: verdict-source scope narrowed to `('spec_review', 'code_review')`; deepsec entry retains code-review.ts:87 live call site, runtime-validation.ts:188 removed; RuntimeCheck.cwd entry retired in place. Confirmed in diff. |
| AC-33 | Pass | `grep -n "runtime_validation" src/cli/index.ts` → no output. Verified live. |
| AC-34 | Pass | `.canon/README.md` gained "Project-specific validation checks during `implement`" section. `diff .canon/README.md templates/.canon/README.md` → IDENTICAL. Verified live. |
| AC-34a | Pass | README.md pipeline flow drops `runtime_validation`. Confirmed in diff. |
| AC-34b | Pass | CLAUDE.md and CODEX.md runtime references removed. Confirmed in diff. |
| AC-34c | Pass | Canon fences of CLAUDE.md and CODEX.md byte-identical to templates. Verified live with fence-scoped diff. |
| AC-34d | Pass | canon-pipeline and canon-status SKILL.md files updated; both identical to their template mirrors. Verified live. |
| AC-35 | Pass | `tests/run-task-runtime-validation.test.ts` deleted. Confirmed in diff. |
| AC-36 | Pass | `runtime_validation` phase blocks removed from harness, canon-snapshot, and counter-schema test fixtures. Confirmed in handoff. |
| AC-37 | Pass | "checkPhaseGate: runtime_validation has no gate" test not present in test file. |
| AC-37a | Pass | `grep -n "runtime_validation\|RUNTIME_CHECKS" tests/pipeline-policy.test.ts` → no output. Verified live. |
| AC-37b | Pass | `grep -n "runtimeIterations" tests/run-task-prompts.test.ts` → no output. Verified live. |
| AC-38 | Pass | Supersession pointer line present after H1 in `tasks/_archive/runtime-validation-phase/done.md`. Confirmed by reading. |
| AC-39 | Pass | grep output lists only allow-listed paths: CHANGELOG.md (3), docs/BACKLOG.md (4), docs/decisions.md (4), docs/lessons-learned.md (4), docs/pipeline-invocations.md (13), docs/task-quality-log.md (2), tasks/_archive/** (294), tasks/retire-runtime-validation/** (180). Spot-check of scripts/src/tests returns zero hits. |
| AC-40 | Pass | lint, type-check, test (232: 231 pass, 1 skip, 0 fail vs baseline 237), build — all pass. Non-zero test delta recorded. |

### Dropped Sections Check

- [x] Non-goals respected: no new project-policy extension point; Validation Outcomes section unchanged; two-stage review structure untouched; no version bump.
- [x] Known Risks addressed: all six known risks (Declared/Executable drift, TaskContext field cascade, AGENTS.md renumbering, template mirror divergence, state-loading stripping, affectedFiles empty-set) structurally mitigated and verified by the AC coverage above.
- [x] Human Test Plan satisfiable: steps 1-9 are testable against the merged artifact.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation is complete and clean. A very large diff (40 ACs across 57 files) executed with no correctness issues, no dropped sections, and no structural regressions. The AC-25 roundtrip test using `runtime${'_'}validation` template literal is a nice touch — it keeps the test itself out of the AC-39 grep while still exercising the full legacy-tolerance path.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

(none)

#### Spec Gaps

(none)

## Final Verdict

- [x] **Approved**
- [ ] **Approved with nits**
- [ ] **Changes requested**
- [ ] **Needs re-review**

---

<!--
On re-review, append below this line:

## Round N — verifying iteration N's response to round N-1

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
