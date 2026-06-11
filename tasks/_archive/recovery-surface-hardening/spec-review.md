# Spec Review: recovery-surface-hardening

> Reviewer: Codex | Spec: `tasks/recovery-surface-hardening/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

No concerns. The two failure modes are real against the current code: `taskAccept` currently turns an empty review verdict into `sanctioned` in `src/task/index.ts`, and `rerouteFromHumanReview` currently calls `verifyRerouteAmendment` for every task before it resets bundle state in `scripts/run-task/main.ts`.

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

None.

### Missing Edge Cases

> Scenarios the spec doesn't account for.

- Non-blocking: AC-3 names `spec_gap` and `changes_requested`, but `needs_re_review` is also a real non-advancing code-review verdict (`VALID_VERDICTS` in `src/task/index.ts`; the routing table in `docs/pipeline-orchestrator.md` routes it back to implement). The plan/tests should preserve the current `accept` behavior for `needs_re_review` too, not only the two named verdicts.
- Non-blocking: AC-5 uses an approved sibling, but the Decision says the amendment pre-flight scopes to `spec_gap` tasks and exempts approved/non-gap siblings. A mixed bundle with a non-gap, non-approved sibling such as `changes_requested` or `needs_re_review` should get at least a plan note or test if that state is possible through the current review aggregation path.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

- Non-blocking: the spec permits a "per-task counter semantics, a status marker, or gate-side tolerance" implementation. If the plan chooses a new status marker instead of pure gate-side tolerance, the Affected Files table will need to expand to include the status schema surfaces (`scripts/run-task/types.ts`, `.canon/templates/status.json`, and any parser/validation updates). Otherwise Codex would hit the scope-cap rule during implementation.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)

## Amendment Review

- [ ] **Approved**
- [ ] **Approved with nits**
- [x] **Changes requested**

> Findings:
>
> 1. **Missing AC coverage for `needs_re_review` failing siblings.** The amendment Problem and Decision explicitly include both `changes_requested` and `needs_re_review` as failing non-gap sibling verdicts whose prior review findings must stay binding, and `needs_re_review` is a real verdict in `src/task/index.ts` / `docs/pipeline-orchestrator.md`. But AC-9 only verifies B = `changes_requested`, and AC-11 says prior-verdict survival is asserted by the AC-9 test. Add a direct assertion for the `needs_re_review` flavor so the amendment's stated second failing verdict is verifiable.
>
> 2. **Affected Files omits the prompt golden fixture.** The amendment requires changing reroute prompt output/flavoring in `scripts/run-task/prompts/index.ts` and possibly the reroute templates, and the project pattern for prompt-context changes says to regenerate and list `tests/run-task-prompts.golden.json`. The Amendment Affected Files table lists `tests/run-task-prompts.test.ts` but not the golden fixture, leaving Codex without spec scope to update the snapshot file if the prompt change requires it. Add `tests/run-task-prompts.golden.json` to the amendment delta, or explicitly constrain the implementation/tests so no golden fixture change is needed.

## Amendment Review

- [x] **Approved**
- [ ] **Approved with nits**
- [ ] **Changes requested**

> Findings: None.
