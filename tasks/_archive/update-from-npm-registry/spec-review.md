# Spec Review: update-from-npm-registry

> Reviewer: Codex | Spec: `tasks/update-from-npm-registry/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)
- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)
- Is there a materially simpler solution that changes the shape of the work?
- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)

(no concerns / list items)

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

- (none)

### Missing Edge Cases

> Scenarios the spec doesn't account for.

- (none)

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

- (none)

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)

### Nits for the plan phase

- The registry-selection predicate should explicitly track whether `CANON_UPSTREAM_REPO` was set, in addition to comparing the effective slug. The decision says any override uses the GitHub path, while the implementation note says the canonical-slug comparison selects the registry path; an explicit override whose value equals `tstraub89/canon-ai` would otherwise be ambiguous. Add the no-override condition to the plan/tests so that this case cannot accidentally select the registry path.

## Amendment Review

- [x] **Approved with nits**

> Findings: The amendment is implementable and remains coherent with the approved registry/GitHub split. Adding `--save-exact` only to local registry installs preserves the existing exact-pin behavior of the replaced Git path; the amendment explicitly leaves global installs and Git-path installs unchanged. The current `currentPinFromManifest()` implementation already accepts a bare `X.Y.Z` dependency value, so the amended announcement assertion is compatible with the current manifest-reading contract. Non-blocking nits: AC-11 should name the local-update fixture or state which dependency block is asserted so the exact-manifest-pin check cannot be implemented only against the announcement; and the carried lockfile/header cleanup should be included in the implementation diff as stated (the current `package-lock.json` root still has `hasInstallScript: true`, and the hook header still describes a postinstall wrapper shipped via `files`).
