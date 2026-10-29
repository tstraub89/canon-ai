# Spec Review: agent-backend-role-routing

> Reviewer: Codex | Spec: `tasks/agent-backend-role-routing/spec.md`

## Shape Check

no concerns

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes, except the explicitly new files and the QA test-seam nit below.
- [x] Proposed patterns are consistent with existing conventions.
- [x] No blocking conflicts with existing functionality.

## Issues Found

### Correctness Issues

1. **Non-blocking (nit): use an available seam for the QA red-first test.** `tasks/agent-backend-role-routing/spec.md:167` describes an existing injected runner, but `src/orchestrator/phases/qa.ts:26` accepts only state, interactive mode and the PR template; line 39 directly calls the imported `runClaude`. Passing an extra fake runner cannot control the pre-change invocation. Plan should use the existing fake-CLI/PATH approach demonstrated at `tests/run-task-safety.test.ts:10677`, or introduce a behavior-preserving injection seam before demonstrating the failing assertion. The salvage behavior and required red-first outcome are clear; this is a test-harness correction within the listed files.

### Missing Edge Cases

none

### Type Safety / Interface Gaps

2. **Non-blocking (nit): retain the originating phase when resolving an author run's config.** `tasks/agent-backend-role-routing/spec.md:59` describes config resolution from role and tasks, but spec and plan share `author` while `src/lib/pipeline-policy.ts:295` and line 296 select distinct model pins. With different `CLAUDE_MODEL_SPEC` and `CLAUDE_MODEL_PLAN` values on identical tasks, resolving only from `author` would use the wrong model for one phase. Include the originating phase in the run/config request and pin this case in AC-3 parity coverage. AC-3 already requires preserving the per-phase values, so this is interface threading for plan, not a change to the intended contract.

## Verification

- Traced phase handlers, backend runners, session helpers, post-phase storage, retry, reset and reroute paths, dependency checks, and existing test fixtures.
- Executed focused assertions against current source: a stream-json result containing a QA summary yields no salvage from raw stdout, while its plain-text result is recovered; identical task inputs resolve distinct spec and plan model pins.
- `npm run lint` and `npm run docs-refs-check` passed.
- Live agent invocation parity and migration behavior remain implementation validation; no live agent sessions were launched during this review.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — no blocking findings; carry both observations into plan
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
