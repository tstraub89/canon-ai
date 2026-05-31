# Spec Review: docs-refs-adopter-config

> Reviewer: Codex | Spec: `tasks/docs-refs-adopter-config/spec.md`

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

- The helper seam is underspecified. The plan needs a way to point the docs-refs loader at an arbitrary repo/config root so the "missing config" and "malformed config" cases can be exercised without accidentally reading the real repo sibling in this checkout.
- AC-8/9 need one explicit cutover signal in `UpgradeResult` or the CLI layer. Right now `runUpgrade()` only reports `upgraded`, `unchanged`, `skipped`, `wouldUpgrade`, `dirtyRefused`, and `malformed`; the plan should name where the "scaffold config, defer checker script" state lives so the output stays deterministic.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

- If the loader helper is exported, the `.d.ts` file needs the helper declaration plus the preserved `VALID_DIRS` export. The current declaration file only covers `NOISY_SOURCE_PATHS` and the other CLI helpers, so the typings change needs to be explicit in plan.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
