# Spec Review: split-run-task

> Reviewer: Codex | Spec: `tasks/split-run-task/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)
- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)
- Is there a materially simpler solution that changes the shape of the work?
- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)

no concerns

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

- `tasks/split-run-task/spec.md:44-56` and `77-80` leave several currently exported helpers/consts without a named home in the new tree: `PIPELINE_TELEMETRY_FILES`, the porcelain parsers and filters used by `tests/run-task-parse-porcelain.test.ts`, the diff-verification seam used by `tests/run-task-validation.test.ts`, and the QA done.md helpers used by the same area. The refactor is still implementable, but the plan has to guess where those symbols move. Add explicit module ownership for those symbols so AC-8 and the current tests have a single source of truth.
- `tasks/split-run-task/spec.md:48-63` and `183` create an import-boundary risk between `state.ts` and `prompts/helpers.ts`: `phaseCommands` needs `resolveTaskCwd`, while `toResumePrompt` needs the startup-block constants. That cycle is probably survivable in ESM, but the spec does not call it out or define which side owns the lower-level dependency. Document the cycle as intentional, or move one of those helpers into a lower-level shared module so the split stays DAG-shaped.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

(none)

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
