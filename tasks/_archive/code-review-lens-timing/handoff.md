# Implementation Handoff: code-review-lens-timing

> Author: Codex | Spec: `tasks/code-review-lens-timing/spec.md` | Plan: `tasks/code-review-lens-timing/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/agents/claude.ts` | Capture top-level sub-agent results and notification transcripts; write per-lens rows with deduplicated cumulative usage. |
| `src/orchestrator/types.ts` | Permit `claude:<agent type>` metric agents. |
| `src/orchestrator/metrics.ts` | Escape Agent cells and document the sub-agent row contract in the skeleton. |
| `templates/docs/pipeline-invocations.md` | Keep adopter metrics header note identical to the runtime skeleton. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Document the per-lens metrics behavior and synced template. |
| `tests/metrics.test.ts` | Check header-note equality and Agent-cell escaping. |
| `tests/claude-subagent-metrics.test.ts` | Exercise sub-agent metrics through a fake Claude executable and transcript fixtures. |
| `dist/orchestrator/run-task.js` | Rebuilt published bundle. |

## Canon Governance

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

Claude stream results are now retained until session completion so their corresponding transcript can be read after the session exits. Each qualifying top-level sub-agent gets a separate row after the foreman row, and transcript read or metrics-write failures remain fail-soft.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| None | Implemented the planned stream capture, transcript summation, docs, tests, and generated bundle. | None |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Fake Claude harness verifies session and anchored-lens rows, model, duration, deduplicated transcript total, and status. |
| AC-2 | Met | Verifies anchored then cold lens order. |
| AC-3 | Met | Verifies failed status, session-model fallback, missing notification, unreadable transcript, and zero token total. |
| AC-4 | Met | Non-lens, missing duration, nested, and malformed events leave only the session row. |
| AC-5 | Met | Non-zero Claude exit retains the lens row and failed session row; metrics writer already has fail-soft warning coverage. |
| AC-6 | Met | Hostile Agent value remains a nine-cell row after escaping. |
| AC-7 | Met | Runtime skeleton and adopter template notes compare equal; orchestrator reference and template are synced. |

## Edge Cases Considered

- Duplicate transcript assistant entries with the same message ID count once; entries without IDs count independently.
- Results are deduplicated by tool_use_id across resume-not-found fallback attempts.
- Missing notification or transcript data yields `-` tokens; nested results are ignored.
- A missing `parent_tool_use_id` is treated as top-level (`== null`), consistent with excluding non-null nested events.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,562 passed, 1 skipped, 0 failed. |
| `npm run build` | Pass | Rebuilt `dist/orchestrator/run-task.js`; CLI bundle had no delta. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
