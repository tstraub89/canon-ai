# Spec Review: upgrade-destination-classification

> Reviewer: Codex | Spec: `tasks/upgrade-destination-classification/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)
- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)
- Is there a materially simpler solution that changes the shape of the work?
- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)

No concerns. The problem is real in the current implementation: `src/cli/commands/upgrade.ts`'s `isPathDirty()` skips `??` porcelain entries and returns clean on git probe failures, and `tests/cli.test.ts` currently has a named regression guard for the old untracked-overwrite behavior. The proposed shape moves the safety boundary to a classifier at the existing `pending` gate, which matches the current `runUpgrade()` structure.

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

- Non-blocking nit: the Interaction Dependencies section says "all five write sources" and lists delimited merge, header-only sync, `CANON_OWNED`, `.canon/version`, and `.gitignore`. Current `runUpgrade()` has another explicit `pending.push()` for the docs-refs cutover scaffold, `scripts/docs-refs-config.mjs`, at `src/cli/commands/upgrade.ts:317`, with existing coverage around `tests/cli.test.ts:1475`, `:1551`, and `:1751`. Because the spec also requires applying the classifier at the shared `pending` gate, this is still implementable as written, but the plan should treat that cutover scaffold as part of the pending write surface too.

### Missing Edge Cases

> Scenarios the spec doesn't account for.

- Non-blocking nit: preserve the existing locally-deleted tracked-file behavior when implementing the "absent" class. The spec table says absent destinations write, but it also says tracked-dirty includes local deletion; the current guard intentionally asks git even when `existsSync()` is false, and `tests/cli.test.ts:2181` asserts that a tracked managed file deleted locally is refused. The classifier should resolve tracked deletion before treating a missing path as a safe absent scaffold.
- Non-blocking nit: AC-8's "classification buckets are identical" wording should be interpreted as classifier-state parity, not literal public result parity. For writable classes, `--check` reports `wouldUpgrade` while the real run reports `upgraded`, so the plan/test helper should compare normalized classification buckets or an internal classification seam rather than requiring those action buckets to be byte-identical.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

(none)

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
