# Implementation Handoff: doctor-quality-log-header-check

> Author: Codex | Spec: `tasks/doctor-quality-log-header-check/spec.md` | Plan: `tasks/doctor-quality-log-header-check/plan.md`

## Changes

| File | What Changed |
|---|---|
| `scripts/run-task/quality-log.ts` | Exported `CANON_LOG_HEADERS`, `LocatedLogTable`, and `locateLogTable`; parsing logic is unchanged. |
| `src/cli/commands/doctor.ts` | Added fail-soft `checkQualityLog(cwd)` using `getQualityLogFile` and `locateLogTable`, and wired it into the Canon setup checks. |
| `tests/cli.test.ts` | Added missing, well-formed, malformed-header, and unreadable-path check coverage. |
| `docs/codebase-map.md` | Documented the quality-log module and the doctor check. |
| `dist/cli/index.js` | Regenerated published CLI bundle from the final source. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

The doctor check delegates table detection to the quality-log writer's exported parser, preserving one source of truth for required headers. Missing files pass because the writer creates them on first QA completion; malformed or unreadable files warn without aborting doctor.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| None | Implementation follows the approved delegation and fixture approach. | None |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `CANON_LOG_HEADERS` and `locateLogTable` are exported; existing quality-log tests pass. |
| AC-2 | Met | `checkQualityLog` imports and calls `getQualityLogFile` / `locateLogTable`; no local header comparison is present. |
| AC-3 | Met | Missing-file unit test returns `pass`. |
| AC-4 | Met | Real `docs/task-quality-log.md` skeleton fixture returns `pass`. |
| AC-5 | Met | Missing `Notes` header fixture returns `warn` with the relative file path and template reference. |
| AC-6 | Met | `checkQualityLog(cwd)` is in `doctorCmd`'s `canonChecks` array. |
| AC-7 | Met | `src/cli/commands/upgrade.ts` has no task-quality-log diff or reference. |
| AC-8 | Met | `docs/codebase-map.md` documents both the quality-log module and updated doctor surface. |
| AC-9 | Met | Directory-path fixture returns `warn` with a read failure detail rather than throwing. |
| AC-10 | Met | Fresh build changed `dist/cli/index.js`; `dist/scripts/run-task.js` was unchanged and remains build-consistent. |

## Edge Cases Considered

- `ENOENT` is treated as a passing absent-file case; other read errors are downgraded to warnings.
- Header validation remains in `locateLogTable`, including duplicate-header rejection and required-column membership.
- Doctor follows its existing plain-`cwd` convention; it does not route to task worktrees.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | ESLint completed successfully. |
| `npm run type-check` | Pass | TypeScript completed successfully. |
| `npm test` | Pass | Full suite: 1066 passed, 1 skipped, 0 failed. |
| `npm run build` | Pass | Fresh tsup build and postbuild normalization completed; only `dist/cli/index.js` changed. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates:check` | deferred_by_spec | Spec explicitly marks this not applicable; no canon-managed files changed. |
| E2E | deferred_by_spec | Spec explicitly marks this N/A; no UI surface changed. |
| `git diff --check` | Pass | No whitespace errors. |
| Upgrade immutability grep/diff | Pass | `src/cli/commands/upgrade.ts` is unchanged and contains no `task-quality-log` reference. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
