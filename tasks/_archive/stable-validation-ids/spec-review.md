# Spec Review: stable-validation-ids

> Reviewer: Codex | Spec: `tasks/stable-validation-ids/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)
- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)
- Is there a materially simpler solution that changes the shape of the work?
- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)

no concerns

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] The canonicalization failures reproduce deterministically against the current helper and latest-outcome map
- [x] The revised parser-selection and evidence-consolidation contracts are implementable against the current branches
- [x] Required and informational identities can be kept in separate key spaces
- [ ] Per-task validation IDs remain unambiguous in the existing bundle prompt path

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase or its own required behavior.

none

### Missing Edge Cases

> Scenarios the spec doesn't account for.

1. **Blocking — bundle state headers lose the task ownership required to interpret reusable IDs.** The Non-Goals explicitly permit every bundle member to define `VAL-1`, and AC-15 requires the implement state header to render checks as `VAL-<n>: <prose>`. The current bundle path does not retain that ownership: `buildImplementStateHeader` flattens `extractValidationChecks(id)` from all task IDs into one `Set<string>` and renders one unqualified `Required validation:` line (`context.ts:157-183`, `226`). With task A defining `VAL-1: lint` and task B defining `VAL-1: e2e`, the prompt would show two `VAL-1` entries without saying which handoff owns either one. That gives the implementer an ambiguous copy target and can produce unknown/missing-ID retries in bundle mode despite each spec being valid. Add a bundle AC that uses colliding per-task IDs with different prose and requires task-qualified/grouped header output (while preserving the current compact single-task output), and update the `context.ts` design row accordingly.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

1. **Non-blocking nit — the revision-prompt surface is missing from Affected Files.** AC-3 requires `promptSpecRevision` to gain the VAL-ID self-check, but the current function only renders `scripts/run-task/prompts/templates/spec-revision.md` and that template has no self-check slot (`prompts/index.ts:105-120`; current template contents). The plan can resolve this by adding that template to scope and passing/rendering the new guidance there rather than embedding a one-off string in `index.ts`.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [x] **Changes requested** — spec must be revised before plan phase (list items above)
