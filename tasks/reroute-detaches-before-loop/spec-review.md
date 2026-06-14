# Spec Review: reroute-detaches-before-loop

> Reviewer: Codex | Spec: `tasks/reroute-detaches-before-loop/spec.md`

## Shape Check

No concerns. The spec targets a real control-flow mismatch: current `main()` calls `rerouteFromHumanReview(cliArgs.taskIds)` before the detach gate, then includes `cliArgs.reroute` in the synchronous-mode predicate before entering the `while (true)` phase loop. `detachAndExit()` re-execs the original argv with `CANON_DETACHED=1`, so the spec's double-reroute hazard is also real and correctly promoted to an AC.

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

None blocking.

Nit: AC-4's parent-only reroute-reset behavior is closer to the existing fixture seam in `tests/run-task-reroute-preflight.test.ts` than to `tests/detach.test.ts`. `tests/detach.test.ts` currently imports only `scripts/run-task/detach.ts`, while `tests/run-task-reroute-preflight.test.ts` already imports `main.ts` via subprocess, has `makeRerouteStatus()`, `runMain()`, fake agent binaries, and worktree/status fixtures. The spec is still implementable as written, but the plan should either add `tests/run-task-reroute-preflight.test.ts` to Affected Files or explicitly keep the AC-4 test in `tests/detach.test.ts` without duplicating a large reroute fixture.

Nit: AC-8 says the template mirrors are "synced and staged." Codex should sync and list the mirror files in the handoff Changes table, but staging is owned by the orchestrator per AGENTS.md and the task prompt. Treat the actionable implementation requirement as: update `CLAUDE.md` / `docs/pipeline-orchestrator.md`, sync `templates/CLAUDE.md` / `templates/docs/pipeline-orchestrator.md`, and pass `npm run sync-templates:check`.

### Missing Edge Cases

None.

### Type Safety / Interface Gaps

None.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
