# Spec Review: preflight-failure-routing

> Reviewer: Codex | Spec: `tasks/preflight-failure-routing/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

No concerns.

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

None.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

None.

## Verdict

- [x] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)

## Amendment Review

- [ ] **Approved**
- [ ] **Approved with nits**
- [x] **Changes requested**

> Findings:
>
> 1. **AC-1b relies on an outer rejection that does not exist for the example it gives.** The amendment says a bare-basename citation such as `editor.spec.ts` should not match `changedFiles`, and that this "neither falsely rejects nor falsely accepts" because the existing file-ref format requirement handles it at the outer layer (spec.md:147, spec.md:152). In the current implementation, the outer requirement is `const hasFileRef = /\w+\.\w+|:\d+/.test(row.notes ?? '')`, so a bare filename with an extension does satisfy the `Fail – unrelated` Notes requirement before the in-diff guard runs (scripts/run-task/validation.ts:570-578). Combined with AC-1b's required no-match behavior, a handoff can cite `editor.spec.ts` while the diff contains `e2e/specs/editor.spec.ts` and still be accepted as unrelated. That weakens the already-approved AC-1 laundering guard instead of closing the basename bypass described in the amendment problem statement. The amendment needs to choose an implementable rule: either reject bare basenames in the outer `Fail – unrelated` validation, or explicitly accept that basename-only citations proceed to Claude credibility review and remove the "nor falsely accepts" / "outer layer handles this" claim.

## Amendment Review

- [ ] **Approved**
- [x] **Approved with nits**
- [ ] **Changes requested**

> Findings:
>
> 1. **Non-blocking:** AC-1a is verifiable for POSIX-style absolute paths as written, and the change text also names Windows-style drive-letter paths (spec.md:148, spec.md:152). If the implementation keeps that Windows-style support in scope, the AC-1a test row should include a drive-letter citation or the test name/body should make clear that "absolute path" covers that variant too. This is not a blocker because the amendment's core POSIX absolute-path and basename-validation behavior is specified and testable.

## Amendment Review Round 2

- [ ] **Approved**
- [ ] **Approved with nits**
- [x] **Changes requested**

> Findings:
>
> 1. **AC-1c contradicts the still-active AC-1b contract for the same citation form.** Amendment 1 still says `editor.spec.ts:1231` "passes the outer check and proceeds to Claude Stage 1 review" and its verify text says the same basename-with-line form "passes outer check (proceeds normally)" (spec.md:147, spec.md:154). Amendment Round 2 now requires `editor.spec.ts:1231` to be classified as a regression when `e2e/specs/editor.spec.ts` is in `changedFiles` (spec.md:184, spec.md:190). The current code shape makes that conflict concrete: `hasSpecificFailUnrelatedReference` accepts any token with a `:line` suffix, `extractCitedFilePaths` emits basename tokens with extensions, and `matchAgainstChangedFiles` currently falls through to an exact `changedFiles.has(normalized)` for non-absolute paths (scripts/run-task/validation.ts:402-436). The amendment should explicitly supersede/narrow AC-1b, e.g. AC-1b only verifies the outer reference check with a not-in-diff basename, while AC-1c owns the in-diff basename-plus-line rejection. As written, an implementer cannot satisfy both cumulative ACs.

## Amendment Review Round 2

- [ ] **Approved**
- [ ] **Approved with nits**
- [x] **Changes requested**

> Findings:
>
> 1. **Round 2 needs to revise the Amendment 1 basename-with-line expectation, not just add AC-1c.** The current spec still says `editor.spec.ts:1231` "proceeds to Claude Stage 1 review" and AC-1b's verification expects the same basename-with-line form to "proceed normally" (spec.md:147, spec.md:154). Round 2's new behavior requires that exact form to become a regression blocker when the task diff contains a matching last path segment, with `editor.spec.ts:1231` + `e2e/specs/editor.spec.ts` as the positive test case (spec.md:184, spec.md:190). The current helper surface confirms these are the same path through the validator: `hasSpecificFailUnrelatedReference` accepts `:line` tokens, `extractCitedFilePaths` keeps basename-with-extension tokens, and `matchAgainstChangedFiles` is the place the new basename branch would decide whether the citation is in-diff (scripts/run-task/validation.ts:402-436). As written, AC-1b and AC-1c give conflicting expected outcomes for `editor.spec.ts:1231` unless AC-1b is narrowed to "passes only the outer reference check" or its positive case uses a basename that is not present in `changedFiles`.

## Amendment Review Round 2

- [ ] **Approved**
- [x] **Approved with nits**
- [ ] **Changes requested**

> Findings:
>
> 1. **Non-blocking:** The current AC text is implementable: AC-1b now scopes `editor.spec.ts:1231` to the outer reference check and explicitly hands the in-diff decision to AC-1c (spec.md:154, spec.md:190). One stale sentence remains in Amendment 1's change prose saying a `filename.ext:line` form "proceeds to Claude Stage 1 review" (spec.md:147). Round 2 supersedes that behavior, and the verifiable ACs are clear enough to implement, but deleting or rewording that sentence would reduce reader friction.

## Amendment Review Round 3

- [ ] **Approved**
- [ ] **Approved with nits**
- [x] **Changes requested**

> Findings:
>
> 1. **Round 3's proposed `isFailResult` scan catches `Fail – unrelated`, contradicting its own scope and the approved accept path.** The amendment says all non-required result states except plain `Fail` remain consistent with old behavior, explicitly including non-required `Fail – unrelated`, and that "Only plain `Fail` on non-required rows is the regression" (spec.md:206). But its change instruction says to scan every `latestResults` row where `isFailResult` is true and emit a regression blocker (spec.md:208). In the current validator, `isFailResult` is prefix-based (`/^fail/i`) and returns true for `Fail – unrelated`; `isUnrelatedFailResult` is the separate narrower helper (scripts/run-task/validation.ts:500-514). Implementing Round 3 literally would therefore turn a non-required `Fail – unrelated` row into a regression blocker, which contradicts the amendment's stated scope and weakens the already-approved genuinely-unrelated accept path (spec.md:56). The amendment needs to specify a plain-fail predicate/order explicitly, e.g. `isFailResult(row.result) && !isUnrelatedFailResult(row.result)`, and add a negative test for non-required `Fail – unrelated`.
>
> 2. **The new AC label duplicates the already-approved AC-10.** The original approved spec already has `AC-10 (implement-revision prompt is bucket-neutral, not handoff-biased)` (spec.md:66). Round 3 adds another `AC-10` for non-required `Fail` rows (spec.md:212). That makes cumulative AC coverage ambiguous for implement handoff/review tables. Rename the amendment AC to the next unused label before implementation.

## Amendment Review Round 3

- [ ] **Approved**
- [ ] **Approved with nits**
- [x] **Changes requested**

> Findings:
>
> 1. **The amendment asks for a plain-`Fail` behavior but points at a helper that also matches `Fail – unrelated`.** Round 3 says non-required `Fail – unrelated` rows should remain accepted/unchanged and that the regression is limited to "Only plain `Fail`" rows (spec.md:206). Its implementation direction then says to add a scan for every non-required row where `isFailResult` is true (spec.md:208, spec.md:218). In the current code, `isFailResult` is `/^fail/i`, while `isUnrelatedFailResult` is a separate narrower predicate (scripts/run-task/validation.ts:500-514). A literal implementation would therefore classify non-required `Fail – unrelated` rows as regression blockers, which contradicts Round 3's stated boundary and the approved unrelated-failure accept path (spec.md:55-56). The amendment needs to require a plain-fail test explicitly, such as excluding `isUnrelatedFailResult(row.result)`, and include a negative test for a non-required `Fail – unrelated` row.
>
> 2. **Round 3 reuses an existing AC identifier.** The approved spec already contains `AC-10` for the implement-revision prompt requirement (spec.md:66). Round 3 adds another `AC-10` for non-required `Fail` handling (spec.md:212). Cumulative handoff/review AC tables would have two different requirements with the same label, so the amendment should rename the new criterion to the next unused AC number before implementation.

## Amendment Review Round 3

- [x] **Approved**
- [ ] **Approved with nits**
- [ ] **Changes requested**

> Findings: None.
