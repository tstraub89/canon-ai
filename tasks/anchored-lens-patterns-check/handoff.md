# Implementation Handoff: anchored-lens-patterns-check

> Author: Codex | Spec: `tasks/anchored-lens-patterns-check/spec.md` | Plan: `tasks/anchored-lens-patterns-check/plan.md`

## Changes

| File | What Changed |
|---|---|
| `.claude/agents/code-review-anchored.md`, `templates/.claude/agents/code-review-anchored.md` | Added the conditional Stage 2 patterns check and synced adopter mirror. |
| `tests/run-task-prompts.test.ts` | Added structural regression test for the charter text, category line, and cold charter exclusion. |

## Canon Governance

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

The anchored lens now checks changed code against adopter-specific `docs/patterns.md` rules in every Stage 2 round, using its Trigger Table when present and ignoring unfilled starter placeholders. Findings use the existing categories. A dedicated structural test pins the conditional guidance and unchanged Return Format category line while ensuring the cold charter remains doc-blind.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| None | Followed the planned charter edit, mirror sync, and test. | None |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Anchored Stage 2 names `docs/patterns.md`, uses the Trigger Table, skips `TODO[canon]` placeholders, and reports named or quoted rules; dedicated structural test asserts these tokens. |
| AC-2 | Met | Guidance maps findings to `risk/guardrail` or `correctness bug`; the test pins the unchanged category line `- [correctness bug | risk/guardrail | optional cleanup/nit | spec gap]`. |
| AC-3 | Met | Guidance begins “If the project keeps `docs/patterns.md`”. |
| AC-4 | Met | Test asserts the cold charter omits `patterns.md`; neither prohibited template is in the diff. |
| AC-5 | Met | Synced mirror is byte-identical; `npm run sync-templates:check` passed. |

## Edge Cases Considered

- Projects without `docs/patterns.md` skip this check.
- A patterns file without a Trigger Table is skimmed for relevant sections.
- Unfilled `TODO[canon]` and `_example_` placeholders are excluded from findings.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,255 passed, 1 skipped, 0 failed. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run build` | deferred_by_spec | Spec marks N/A because agent files are not bundled into `dist/`. |
| E2E | deferred_by_spec | Spec marks N/A. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
