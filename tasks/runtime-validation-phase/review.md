# Code Review: runtime-validation-phase

> Reviewer: Claude | Spec: `tasks/runtime-validation-phase/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results — lint Pass, type-check Pass, `npm test` Pass (103 tests)
- [x] All checks required by the spec's "Validation Required" section were run (lint, type-check, unit tests; build/E2E/migration all N/A per spec)
- [x] Runtime Validation Outcomes absent — this is the expected self-bootstrapping exception. The spec's Known Risks §6 explicitly states "this task's pipeline run uses the OLD PHASE_ORDER (no runtime_validation phase). The new phase only activates after this task lands." Not a gate failure.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | `PHASE_ORDER` in `types.ts:10` has `runtime_validation` between `implement` and `code_review`. `Phase` type derived from tuple. `getVerdict()` widened at `main.ts:128`. `task.sh` phase lists updated in all five case statements plus `cmd_list()` jq filter and `cmd_reset_spec_review()`. `state.ts` back-compat shim: missing block treated as `{status:'done', verdict:'approved', iterations:0}`. |
| AC-2 | Pass | `tasks/_templates/status.json` includes `"runtime_validation": {"status":"pending","agent":"orchestrator","verdict":"","iterations":0}`. `readStatus()` shim handles missing block in existing tasks. |
| AC-3 | Pass | `RuntimeCheck` exported from `pipeline-policy.ts` with all eight fields from spec. `RUNTIME_CHECKS` exports exactly one smoke entry. `tests/pipeline-policy.test.ts` pins the exact shape. |
| AC-4 | Pass | `runRuntimeValidationPhase(taskIds, state, checks?)` in `phases/runtime-validation.ts`. Test seam (`checks?`) works: production callers omit it, tests pass explicit array. `when()` predicate filtering, sequential `spawn`, per-stream capture, handoff write, status/verdict transitions all implemented. |
| AC-4b | Pass | Empty / all-filtered registry: no handoff write, phase set to `{status:'done', verdict:'approved', iterations:0}`, returns early. |
| AC-5 | Pass | Baseline section inserted before `## Ready for Review` by `insertBaselineRuntimeSection`. Iteration re-run appended inside latest `## Iteration N` by `appendIterationRuntimeSection`. `computeLatestRuntimeResults` in `validation.ts` implements latest-wins over baseline + `### Re-run runtime validation` subsections, mirroring `computeLatestValidationResults`. |
| AC-6 | Pass | Fail/Timeout: `status=done`, `verdict=changes_requested`, `iterations += 1`. `checkAndRoute` `case 'runtime_validation':` routes back to implement. Auto-block fires at start of `runRuntimeValidationPhase` when `maxIter >= runtimeLoopCap`, consistent with code_review's placement in `runCodeReviewPhase`. `status` stays `done` so the completion guard at `checkAndRoute`'s phase-must-be-done check passes. |
| AC-7 | Pass | Per-check `timeoutMs` wins over `ORCHESTRATOR_CHECK_TIMEOUT_MS` env var (in `resolveTimeoutMs`). SIGTERM + 3s grace + SIGKILL sequence at `runtime-validation.ts:249–255`. `Timeout` recorded; treated as Fail for routing. Default 10min constant. |
| AC-8 | Pass | `promptImplementRevisions` reads latest failed checks via `computeLatestRuntimeResults`, prefers `tasks/<id>/runtime-check-output/<check>/iter-N/stderr.log` (2KB head-truncated), falls back to 512-byte handoff excerpt with annotation. `artifactReadingHint` sourced from live `RUNTIME_CHECKS` by check name at render time (not from handoff row). |
| AC-9 | Pass | `runPhase` switch dispatches `runtime_validation` to `runRuntimeValidationPhase` at `main.ts:1138`. `checkAndRoute` `case 'runtime_validation':` routes approved → fall-through to code_review, changes_requested → `routeBackTo(taskIds, 'implement')`. `getVerdict()` union widened to include `'runtime_validation'`. |
| AC-9b | Pass | `TaskContext.runtimeIterations` in `types.ts:85`. `buildPipelineState` populates from `status.phases.runtime_validation?.iterations ?? 0`. `shouldUseImplementRevision` checks `t.iterations > 0 \|\| t.runtimeIterations > 0`. Both `retryAgentForPhase` call sites in `main.ts` carry the field. |
| AC-10 | Pass | Test file covers: empty registry, pass/fail/timeout/filter, latest-wins rerun, cwd/cleanup/dirty-artifact-preservation, declared artifactPaths (gitignored + missing path), prompt stderr source order (disk-first + fallback), two-tier capture (100KB full log / 512B handoff / 2KB prompt), three prompt shapes (review-only/runtime-only/both), `buildPipelineState` + `shouldUseImplementRevision` AC-9b coverage, streaming + heartbeat. All spec cases present. |
| AC-11 | Pass | `snapshotDirty` pre/post; `computeDelta` = post \ pre; `isProtectedDeltaPath` guards `tasks/` and `runtime-check-output/`; `cleanupDelta` uses targeted `git checkout --` or `rmSync` — no `git stash` / `git clean`. Declared `artifactPaths` bypass delta (copies regardless of git visibility, including gitignored dirs). On Pass: artifact dir removed; empty parent dirs pruned by `removeEmptyArtifactParents`. `.gitignore` gains `tasks/*/runtime-check-output/`. |
| AC-12 | Pass | Discipline block verbatim. Stderr source order: disk-first, fallback annotated. `artifactReadingHint` sourced from `RUNTIME_CHECKS` at render time. |
| AC-12b | Pass | `{{{iterBanner}}}` and `{{{handoffAppend}}}` computed from `hasReviewFindings` / `hasRuntimeFailures` flags. Mustache `{{#flag}}...{{/flag}}` and `{{^flag}}...{{/flag}}` for the three shapes. Section ordering: review first, runtime second. |
| AC-13 | Pass | `spawn` (not `spawnSync`). Two independent sinks: `fs.createWriteStream` to artifact dir (unbounded) + `HeadBuffer(PROMPT_HEAD_BYTES=2048)` in-memory. Handoff excerpt from `stderrHead.text(HANDOFF_HEAD_BYTES=512)`. Heartbeat every `heartbeatIntervalMs()` (30s prod, env-var seam for tests). Final summary line. Both streams wired to `process.stdout/stderr`. |

### Dropped Sections Check

- [x] Non-goals respected — no cross-check rerun, no plugin system, no sandbox-escape, no per-project config files, no parallel execution
- [x] Known Risks addressed — subprocess hang (SIGTERM/SIGKILL), output size (512B handoff cap, full log on disk), filename-safe names (`sanitizeRuntimeCheckName`), worktree sync timing (post-autoCommit), MAX_REVIEW_LOOPS independence, static-check trust hole (filed as follow-on), no retry-on-flake, scoped cleanup correctness (AC-10 dedicated test), self-bootstrapping (acknowledged and borne out)
- [x] Human Test Plan satisfiable — `orchestrator-phase-smoke` check shipped; steps 1–5 actionable with the delivered code

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

---

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, well-structured implementation. The core dispatcher (`runtime-validation.ts`) is 470 lines covering subprocess lifecycle, two-tier capture, delta snapshot/cleanup, artifact preservation, and handoff writing — each concern is clearly separated into small functions. The prompt builder extension in `prompts/index.ts` composes correctly with the existing infrastructure. Test coverage is thorough and matches the spec's case list. All four nits below are cosmetic or in degraded paths.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

**1. Heartbeat uses hyphen instead of em dash (`runtime-validation.ts:245`)**

```typescript
process.stderr.write(`[${check.name} still running - ${elapsedSec}s elapsed; ...]`);
```

AC-13 specifies an em dash (`—`). Tests assert `/stream-heartbeat still running/` which matches both, so no test failure. Cosmetic only.

**2. `case 'runtime_validation':` placed before `case 'code_review':` in `checkAndRoute` (`main.ts:1475`)**

AC-9 says "add immediately after the existing `case 'code_review':` block." The implementation places it before, in PHASE_ORDER sequence. Switch cases are matched by value, so there is zero correctness impact. PHASE_ORDER ordering is arguably the more navigable convention. Noting the spec divergence.

**3. `stderrExcerptFromNotes` unescaping order is fragile for literal `\n` in stderr (`prompts/index.ts`)**

```typescript
.replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
```

To correctly invert `escapeTableCell`'s transformation, the double-backslash unescape should come first. With the current order, a literal backslash-n (`\n` as two characters) in the original stderr becomes a real newline after the first replace instead of staying as `\n`. This only fires in the degraded fallback path (when `stderr.log` has been manually deleted), and the `[stderr.log missing]` annotation already signals reduced context to Codex. No impact on the primary path.

**4. Test mutates `RUNTIME_CHECKS` directly rather than using the test-seam parameter (`tests/run-task-runtime-validation.test.ts:313, 337`)**

```typescript
RUNTIME_CHECKS.push(check); // ... RUNTIME_CHECKS.pop();
```

The spec note for AC-10 recommends the test-seam (`checks?` parameter) because "ESM-imported `RUNTIME_CHECKS` cannot be mutated at runtime." In practice, the array binding is mutable and `push`/`pop` work. The mutation is isolated (popped in `finally`). The reason it can't use the seam here: `buildRuntimeFailureEntries` in `prompts/index.ts` reads `RUNTIME_CHECKS` directly for `artifactReadingHint` lookup, and there's no seam for that lookup. Given that constraint, mutation is the only way to test the hint wiring. Justified, but worth documenting.

#### Spec Gaps

(none — all ambiguities in the spec were resolved correctly by the implementation)

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Needs re-review** — significant changes expected; re-review (both stages) after iteration

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
