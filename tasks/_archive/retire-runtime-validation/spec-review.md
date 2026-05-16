# Spec Review: retire-runtime-validation

> Reviewer: Codex | Spec: `tasks/retire-runtime-validation/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

(no concerns)

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

- **Non-blocking nit:** AC-11d says Codex should confirm the exact prompt-golden update command in `handoff.md`; the current test file already documents it as `UPDATE_GOLDENS=1 npm test` at `tests/run-task-prompts.test.ts:164`. Use that command unless implementation discovers a newer project script.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

- **Non-blocking nit:** AC-20 calls `getAffectedFiles(baseRef, cwd)` a "pure helper" while also requiring it to run `git diff`. The implementable shape is an impure wrapper plus a pure `--name-status` parser/test seam, which is already consistent with AC-21's "accept raw `--name-status` output" instruction.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
