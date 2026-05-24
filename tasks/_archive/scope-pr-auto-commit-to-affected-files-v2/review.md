# Code Review: scope-pr-auto-commit-to-affected-files-v2

> Reviewer: Claude | Spec: `tasks/scope-pr-auto-commit-to-affected-files-v2/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results — lint Pass, type-check Pass, unit tests Pass (387/1 skip), build and E2E deferred_by_spec with citations.
- [x] All checks required by the spec's "Validation Required" section were run — lint, type-check, unit tests all marked Pass.
- [x] No required checks were skipped without justification.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `parseAffectedFilesFromSpec` exported with correct signature and implementation | Pass | `validation.ts:649–681` — signature, try/catch, `extractSectionBodies`, `parseTableH3`, `parseHandoffPathCell` dispatch confirmed in source. |
| AC-2: Missing spec / no Design / no Affected Files H3 returns empty without throwing | Pass | try/catch at `:657`, early return at `:662`; missing H3 handled by `parseTableH3` returning no rows. Four unit-test cases present in diff. |
| AC-3: `humanReviewAllowedPath` widened; no PIPELINE_SHARED_DOCS reference remaining | Pass | `main.ts:634–642` — new signature `(taskIds, affectedManagedDocs, filePath)`; body uses `PIPELINE_TELEMETRY_FILES.includes` and `affectedManagedDocs.has`; PIPELINE_SHARED_DOCS absent. |
| AC-4: `buildHumanReviewStagePaths` widened; iterates telemetry + affectedManagedDocs | Pass | `main.ts:662–684` — two loops (telemetry, affectedManagedDocs) replace single PIPELINE_SHARED_DOCS loop. |
| AC-5: `affectedManagedDocs` built once after mirror, before porcelain; PIPELINE_MANAGED_DOCS filter applied here; malformed warns with task ID; all call sites updated | Pass | `main.ts:907–918` confirmed between `mirrorHumanReviewDocsToCwd` (line 905) and `gitSafeAtRaw` (line 920). All four call sites at lines 965, 978, 1001, 1025 updated. |
| AC-6: Die message at first unexpected-files gate updated; other three die messages unchanged | Pass | `main.ts:968–974` — contains "allowlist" ✓, "PIPELINE_MANAGED_DOCS" ✓, "Affected Files" ✓, "implement phase" ✓, "git checkout HEAD --" ✓. Lines 990, 1004, 1028 die messages unchanged. |
| AC-7: Advisory warning fires once per affectedManagedDocs path in stagePaths; non-blocking | Pass | `main.ts:980–987` — iterates stagePaths Set (no duplicates), warns where `affectedManagedDocs.has(relPath)`. Safety test asserts exactly one match. |
| AC-8: Parser tests — four AC-2 cases + malformed placeholder (e) + backtick/link formats (f) | Pass | All six cases present in `tests/run-task-validation.test.ts` diff; malformed test asserts reason matches `/template placeholder/`. |
| AC-9: Allow-list safety tests — all seven cases (a)–(g) | Pass | All seven tests present in `tests/run-task-safety.test.ts`: out-of-scope dies, in-scope commits + advisory, telemetry without advisory, bundle union, malformed row warning, non-managed source dies, mixed per-path filtering. |
| AC-10: Both spec templates updated with one-line note | Pass | `.canon/templates/spec.md` and `templates/.canon/templates/spec.md` both updated in same commit. |
| AC-11: `docs/pipeline-orchestrator.md` Auto-Branch + Auto-Commit section updated | Pass | Single sentence replaced with four-bullet allow-list description, die behavior, non-managed exclusion, and advisory warning. |

### Dropped Sections Check

- [x] Non-goals respected — `autoCommitCode`, `mirrorHumanReviewDocsToCwd`, `worktree.ts`, no new flags all untouched.
- [x] Known Risks addressed — same-file overlap residual acknowledged in updated orchestrator docs; spec template note handles QA-edits-unlisted-managed-doc risk; malformed-row warning fires at commit time per AC-5.
- [x] Human Test Plan satisfiable — new die, advisory warning, and allow-list narrowing exactly implement the test plan's expected behaviors.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, focused implementation that strictly tightens the allow-list without touching unrelated paths. The new `parseAffectedFilesFromSpec` reuses all existing parser primitives (no new grammar invented). The `affectedManagedDocs` set is threaded through the existing four-gate structure without restructuring it. Tests cover all specified cases including the tricky mixed-managed/non-managed per-path filtering.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

`optional cleanup/nit` — AC-7 warning loop (`main.ts:980–987`) iterates `stagePaths` before the `stagePaths.size === 0` die at line 989. When stagePaths is empty the loop is a no-op so the ordering is functionally correct, but reading the die before the loop would be more natural. Not blocking.

#### Spec Gaps

(none)

## Final Verdict

- [x] **Approved** — ship as-is

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
