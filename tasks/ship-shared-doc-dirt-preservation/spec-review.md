# Spec Review: ship-shared-doc-dirt-preservation

> Reviewer: Codex | Spec: `tasks/ship-shared-doc-dirt-preservation/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)
- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)
- Is there a materially simpler solution that changes the shape of the work?
- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)

No concerns. The current ship path still has the blanket `checkout HEAD -- ...presentSharedDocs` block at [scripts/run-task/main.ts](/Users/tstraub/canon-ai/canon-ai-dev/scripts/run-task/main.ts:2063), and the revised spec addresses both halves of the problem: pre-merge safety and post-archive preservation of foreign telemetry.

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

(none)

### Missing Edge Cases

> Scenarios the spec doesn't account for.

- **Non-blocking nit:** The Problem section says the six managed docs include `docs/lessons-learned.md`, but the current constants classify that file as telemetry: `PIPELINE_TELEMETRY_FILES` includes `docs/lessons-learned.md`, while `PIPELINE_MANAGED_DOCS` starts at `docs/architecture.md` and does not include it ([scripts/run-task/worktree.ts](/Users/tstraub/canon-ai/canon-ai-dev/scripts/run-task/worktree.ts:9)). The Decision, AC-11, and implementation-facing details use the correct classification, so this does not block implementation; it is just a wording trap for future readers/manual testers.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

(none)

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
