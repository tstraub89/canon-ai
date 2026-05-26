# Spec Review: orchestrator-survive-sighup

> Reviewer: Claude (fast-tier auto-approval after human conversational approval) | Spec: `tasks/orchestrator-survive-sighup/spec.md`

## Shape Check

The spec problem is real and well-grounded (verified failure mode from a 2026-05-25 real-run with smoking-gun root cause in code). Framing is correct — the fix addresses the named cause (no SIGHUP handler + inherited child stdin), not a symptom. AC decomposition is appropriately granular for an S task: AC-1 installs the handler, AC-2 verifies survival, AC-3 changes child stdin, AC-4 verifies SIGINT preserved, AC-5/6 cover docs.

No simpler solution exists — the failure mode is a process-management primitive issue and the two-line fix IS the simpler shape.

(no concerns)

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes — verified via `/canon-review` Agent B pass: `scripts/run-task.ts` is a 5-line entry point, `agents/stream.ts:32` matches the documented `stdio` array, `STALL_TIMEOUT_MS` at `env.ts:50` confirmed, `warn` exported from `cli.ts:12`.
- [x] Proposed patterns are consistent with existing conventions — `process.on(...)` at module top-level is idiomatic Node; `stdio: ['ignore', ...]` is a standard Node spawn pattern; new test file follows `run-task-<topic>.test.ts` naming convention.
- [x] No conflicts with existing functionality — SIGINT path untouched; foreground UX unchanged; existing 10-min stall timer remains armed.

## Issues Found

### Correctness Issues

(none — `/canon-review` Agent B flagged one spec-clarity issue regarding the Codex stdin paragraph; that has been resolved by spec edit before this review)

### Missing Edge Cases

(none for S-tier scope; the long-tail silent-death modes — SIGKILL, OOM, kernel panic, machine sleep — are explicitly out of scope and tracked in `docs/BACKLOG.md` as the heartbeat-detection follow-on)

### Type Safety / Interface Gaps

(none — both edits are pure JS runtime behavior, no type surface change)

## Verdict

- [x] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)

Fast-tier auto-approval: human conversational approval + `/canon-review` three-agent pre-flight (2 of 3 agents `[NO FINDINGS]`, 1 STRONG finding on spec clarity resolved before this verdict).
