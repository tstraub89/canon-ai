# Implementation Handoff: metrics-header-mode-dirt

> Author: Codex | Spec: `tasks/metrics-header-mode-dirt/spec.md` | Plan: `tasks/metrics-header-mode-dirt/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/metrics.ts`, `src/lib/markdown-table.ts` | Widen a narrower metrics header with the shared header-only merge while preserving rows and fragments without a table. |
| `src/cli/commands/upgrade.ts` | Re-export and use the relocated `mergeHeaderOnly` helper; upgrade behavior remains unchanged. |
| `src/orchestrator/validation.ts`, `src/orchestrator/main.ts` | Carry changed/unchanged/unknown file-mode state into shared-doc classification and fail closed when the raw mode probe is invalid. |
| `tests/metrics.test.ts`, `tests/run-task-validation.test.ts`, `tests/run-task-ship-docs-fold.test.ts` | Cover legacy/current/no-table metrics fragments, classifier modes, and a real-git mode-only ship abort. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Document the shared-doc mode check for `--ship`. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuilt bundles. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`.

## Intent & Rationale

`recordMetric` now replaces only a narrower table header block before appending, leaving old rows intact. The existing header merge was moved into `src/lib/markdown-table.ts` so the CLI upgrade path and orchestrator can share it without an orchestrator-to-CLI dependency. Before `--ship` classifies dirty shared docs, it probes index-to-worktree raw diff modes and passes the result to the pure classifier; a changed or unknown mode aborts before merge.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| None. | Implemented the planned helper relocation and behavior. | None. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1: legacy 9-column header is widened, old row remains byte-identical, appended row has 10 cells | Met | `tests/metrics.test.ts` asserts the complete skeleton header through the separator, the exact old row, and the new row cell count. |
| AC-2: current/fresh headers and no-table fragments are preserved | Met | Existing fresh-fragment coverage plus the new current-header and no-table prefix assertions pass. |
| AC-3: changed/unknown modes abort while unchanged verdicts remain stable | Met | `tests/run-task-validation.test.ts` covers telemetry and managed docs, pure append, mode plus changed content, unknown mode, and unchanged mode. Existing classifier cases also pass. |
| AC-4: real-git chmod-only telemetry dirt aborts and leaves mode/content intact | Met | POSIX fixture sets `core.fileMode=true`; stderr, non-zero exit, bytes, and mode are asserted. |
| AC-5: operator docs and mirror describe mode abort | Met | Both docs state changed or uncheckable mode aborts pre-merge; template sync check passes. |
| AC-6: bundles rebuilt and full suite passes | Met | `npm run build` passed; `npm test` passed (2322 passed, 1 skipped, 0 failed). |

## Edge Cases Considered

- A metrics fragment with no `| Timestamp |` header is appended to without rewriting its existing content.
- Equal-width/current headers are not rewritten; only narrower headers are widened.
- Staged mode changes already have a porcelain status other than `' M'` and continue to abort through the existing classifier branch.
- Mode probe failures or malformed raw records classify every dirty shared doc as unknown and abort. `core.fileMode=false` remains out of scope as specified.
- The real-git mode test skips on Windows, where POSIX mode changes are unavailable.

## Blockers

- None.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-1 | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='widens a legacy' tests/metrics.test.ts` | `7ad13834614962ca70bf59a62b082e78c51e8d82` | With baseline `src/orchestrator/metrics.ts`, assertion showed the actual 9-column header instead of `METRICS_SKELETON` through its 10-column separator. | Same targeted test passed after fix; full `npm test` passed. |
| AC-4 | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='mode-only telemetry' tests/run-task-ship-docs-fold.test.ts` | `7ad13834614962ca70bf59a62b082e78c51e8d82` | With baseline `src/orchestrator/main.ts`, the process exited 0 after chmod-only change; assertion expected non-zero. | Same targeted test passed after fix; full `npm test` passed. |

## Self-Check

| Check | Evidence |
|---|---|
| Test integrity | `tests/metrics.test.ts`: exact header, old-row bytes and new-row cells; AC-1 baseline run failed because the 9-column header remained. `tests/run-task-validation.test.ts`: exact mode abort reasons and unchanged preserve verdict; existing default-argument tests cover unchanged legacy calls. `tests/run-task-ship-docs-fold.test.ts`: exit status, message, bytes and mode; AC-4 baseline run exited 0. Both red-first commands and post-fix outcomes are recorded above. |
| Restatement sweep | Searched `Shared-doc dirt at`, `uncommitted file-mode`, `file mode could not be checked`, `mergeHeaderOnly`, `classifySharedDocDirtFromData`, and `classifyAndPreserveSharedDocDirt`. Updated the two in-scope pipeline docs. `docs/BACKLOG.md` only names the existing helper/flow and does not state the changed contract. `tests/cli.test.ts` exercises the moved helper through the preserved `src/cli/commands/upgrade.ts` re-export; its existing tests passed in the full suite. |
| Sibling parity | Checked telemetry and configured/managed docs through `classifySharedDocSetFromData`; both get the mode state. Non-plain porcelain codes still abort through the existing status branch, including staged mode changes. `canon upgrade` retains its existing `mergeHeaderOnly` entry point through re-export. The mode probe applies to every dirty shared doc in the existing shared-doc gate. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run build` | Pass | Rebuilt `dist/cli/index.js` and `dist/orchestrator/run-task.js`. |
| `npm run lint` | Pass | Required check. |
| `npm run type-check` | Pass | Required check. |
| `npm test` | Pass | 2322 passed, 1 skipped, 0 failed. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
