# Code Review: docs-refs-adopter-skip-and-ellipsis

## Validation Gate

**BLOCKED — pre-flight rejected handoff before full review:**

- Validation Required item missing from handoff.md: Linting (`npm run lint`). Handoff has rows for: lint), type-check), test), docs-refs-check), build, tests, scripts/docs-refs-check.mjs). (Required canonicalized to: 'lint'.)
- Validation Required item missing from handoff.md: Type checking (`npm run type-check`). Handoff has rows for: lint), type-check), test), docs-refs-check), build, tests, scripts/docs-refs-check.mjs). (Required canonicalized to: 'type-check'.)
- Validation Required item missing from handoff.md: Unit tests (`npm test`) — includes the existing `tests/docs-refs-check.test.ts` suite plus the two new fixtures. Handoff has rows for: lint), type-check), test), docs-refs-check), build, tests, scripts/docs-refs-check.mjs). (Required canonicalized to: 'test'.)
- Validation Required item missing from handoff.md: Docs references (`npm run docs-refs-check`) — must pass against canon's own tree. Handoff has rows for: lint), type-check), test), docs-refs-check), build, tests, scripts/docs-refs-check.mjs). (Required canonicalized to: 'docs-refs-check'.)

## Verdict

- [x] **Changes requested** — fix the above and resubmit handoff.

## Round 2 — verifying iteration 2's response to round 1

### Findings from round 1

The validation gate blocked on Iteration 1 because the required-check labels were paraphrased (e.g., "Linting (npm run lint)") instead of matching the spec's canonical text. The gate rejected all four required checks.

### Verification

Iteration 2 corrected the validation label text and cleaned backtick refs to nonexistent fixture paths from the handoff prose. The re-run docs-refs check passed per the iteration 2 re-run table. However, the Check column was still wrapped in outer backtick inline-code (e.g., `` `Linting (\`npm run lint\`)` ``), which changed canonicalization and left the validator unable to match the required checks.

### Verdict

**Changes requested** — inline-code wrapping on Check column must be removed.

## Round 3 — verifying iteration 3's response to round 2

### Prior finding: inline-code wrapping in Check column (correctness bug)

Iteration 3 claims to have removed the outer backtick wrapping from the Validation Outcomes Check column so the canonicalizer can match the required checks. The current handoff (lines 91–94) shows the four required-check rows as plain text with only the embedded command backtick-wrapped — `Linting (\`npm run lint\`)` — which matches the spec's own `- [x] Linting (\`npm run lint\`)` verbatim. The `Full build` and `End-to-end tests` rows (deferred_by_spec, not required) still have outer backtick wrapping, but those are not in the validator's required-match set. The iteration 3 re-run shows Docs references: Pass. **Addressed.**

### New findings from iteration 3 changes

No code behavior was changed in iterations 2 or 3 — both iterations touched only `handoff.md` and `notes.md`. The substantive implementation was completed in Iteration 1 and has not changed. No new correctness bugs or spec gaps introduced by iteration 3.

### Verdict

- [x] **Approved** — All ACs verified against the diff: `NOISY_SOURCE_PATHS = []` constant placed after `VALID_DIRS` (AC-1); prefix and exact-match skip logic with segment-boundary guard (AC-2/2b/2c); module-default fallback wired through (AC-2d); canon-universal exemptions preserved (AC-3); `...` short-circuit in `isPlaceholderTarget` (AC-4); templates copy mirrored (AC-5); all five test cases present with correct seam/mutate split (AC-6); `.d.ts` updated with mutable `NOISY_SOURCE_PATHS` and optional `options` param (AC-6b); validation checks pass (AC-7/AC-8).
