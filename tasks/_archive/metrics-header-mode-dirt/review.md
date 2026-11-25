# Code Review: metrics-header-mode-dirt

> Reviewer: Claude (foreman synthesis) | Spec: `tasks/metrics-header-mode-dirt/spec.md`

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Inputs: anchored Claude lens, cold-Claude lens, cold-Codex (no actionable findings).

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run (per handoff; not re-run by the lenses)
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for AC-1 and AC-4 against baseline commit
- [x] Self-Check evidence is not contradicted by the diff

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | Legacy header widened to the full skeleton block, old row byte-identical, new row 10 cells (`tests/metrics.test.ts`). |
| AC-2 | Pass | Current-header and no-table fragments are left untouched. |
| AC-3 | Pass | Classifier covers changed and unknown modes for telemetry and managed docs. Default `'unchanged'` keeps existing calls stable. |
| AC-4 | Pass | Real-git chmod-only test asserts non-zero exit, the abort text, the file name with the mode reason, and unchanged mode and content. |
| AC-5 | Pass | Both `docs/pipeline-orchestrator.md` and its `templates/` mirror are updated. |
| AC-6 | Pass | `dist/` rebuilt; the handoff reports the full suite passing. |

### Dropped Sections Check

- [x] Non-goals respected
- [x] Known Risks addressed (no-table fragment, `core.fileMode`)
- [x] Human Test Plan is satisfiable

### Stage 1 Verdict

- [x] **Pass**
- [ ] **Fail**

## Stage 2 — Code Quality

### Summary

The implementation is small and matches the spec. The mode probe fails closed on probe errors and on malformed or odd-count output. The `mergeHeaderOnly` relocation keeps the `upgrade.ts` re-export, so no CLI behavior changes. The only real issue is leftover comments from the move.

### Findings

#### Correctness Bugs

(none)

#### Nits (optional)

1. **Orphaned comments after the helper move** (`src/cli/commands/upgrade.ts:70-92`, nit, flagged by 2 lenses: anchored and cold-Claude). The `TABLE_SEPARATOR_RE` comment now ends mid-sentence ("The lookahead"). The `mergeHeaderOnly` JSDoc now sits above `printDocsRefsCutoverWarning`, so it misdocuments that function. Verified in the diff. Source comments are stripped by `tsup`, so there is no adopter-visible effect. Fix: delete or move those comments.
2. **Header block chosen by first separator, not the `| Timestamp |` line** (`src/orchestrator/metrics.ts:41-50`, nit, flagged by 2 lenses). A hand-edited fragment with an earlier table-like line could have the wrong block replaced. This follows the spec's own implementation note, which reuses `mergeHeaderOnly`. The risk is low, because fragments are machine-written.
3. **Mixed line endings on CRLF fragments** (`src/orchestrator/metrics.ts:44-49`, nit, anchored lens). The widened header is LF while the rows stay CRLF. The spec requires rows to stay unchanged, and the effect is display-only.

#### Test Coverage Notes

- The real-git AC-4 test covers only a telemetry doc with a mode-only change. Mode-plus-append and managed docs are covered only by pure classifier tests, and `unknown` only at the classifier level. This meets the AC as written.

## Dismissed Cold Findings

- Dismissed (cold-Claude): non-atomic read-then-write in `recordMetric` could lose rows under concurrent writers or a mid-write crash. Fragments are per-task and single-writer. The widening runs only once per legacy file, and `recordMetric` is wrapped in try/catch. The shared-file override is a test hook. Low confidence and not grounded in a real flow.
- Dismissed (cold-Claude): the `split('|')` column count miscounts a header with an escaped `\|`. The skeleton header has no such cell, so this cannot occur.
- Dismissed (cold-Claude): a legacy header with the same column count but different names is never migrated. This is outside the spec, which migrates only narrower headers.
- Dismissed (cold-Claude): a failed probe surfaces only the generic "could not be checked" reason. This is specified (AC-3) and fail-closed.
- Dismissed (cold-Claude, test-integrity): NUL-parsing is untested for malformed output. This is covered at the classifier level and is fail-closed. It is a coverage note, not a bug.
- Dismissed (cold-Codex): no findings returned, so there is nothing to dismiss.

## Final Verdict

- [ ] **Approved**
- [x] **Approved with nits**
- [ ] **Changes requested**
- [ ] **Spec gap**
