# Spec Review: canon-docs-dedup

> Reviewer: Codex | Spec: `tasks/canon-docs-dedup/spec.md`

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

none

### Missing Edge Cases

> Scenarios the spec doesn't account for.

- The docs-impact pass should probably include `AGENTS.md` as a freshness target, not just `CLAUDE.md` / `templates/CLAUDE.md`. This task changes a developer workflow rule (root is authoritative, templates are derived, hook + CI enforce it), and `AGENTS.md` is the repo's workflow source of truth.
- `AC-7`'s adopter-project check is a little too absolute as written: “no `.git/hooks/pre-commit` written” is only true for a fresh adopter repo. If the adopter already has its own hook, the more precise verification is that canon's install does not introduce its own hook/config there.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

none

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
