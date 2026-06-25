# Done: spec-bugfix-diagnosis-rule — Re-home diagnose/reproduce rule + red-first test into spec-authoring surfaces

## Summary

The rule that a bug-fix spec must confirm the failure mechanism before committing to a fix now lives on every surface a spec author actually reads. Previously the rule existed only in the `spec_review` checkpoint prompt; on fast-tier (S, non-delicate) bug fixes, which skip `spec_review` entirely, the rule reached nobody. The additions are scoped to bug/flake fixes (feature and refactor authoring is unchanged) and cover three author-side obligations: state *how* the failure mechanism was confirmed in the *Problem* section (not merely assert a plausible cause); include a regression-test AC that fails on the pre-fix code for the stated reason and passes after the fix (red-first TDD); and, when a faithful repro is impractical because the mechanism is environment-bound, say so explicitly and supply a deterministic alternative rather than skipping verification silently. A spec amendment also reframed the `spec_review` reference as the author's own obligation with an explicit note that fast-tier tasks skip `spec_review` and no reviewer will catch an unverified mechanism. The change was applied to all four rules-of-thumb surfaces (the `/canon-spec` skill, the spec template, and both runtime prompts) and all three self-check homes (skill self-check, template Spec Quality Checklist, and the `selfCheck` constant in the runtime prompt index). All four `templates/` mirrors were regenerated, the prompt golden was refreshed, and `dist/` was rebuilt.

## Files Changed

| File | Change |
|---|---|
| `.claude/skills/canon-spec/SKILL.md` | Added bug/flake-fix-only guidance to spec-writing rules of thumb and self-check list: mechanism confirmation, red-first regression-test AC, two-part within-reason escape, and self-enforcing fast-tier framing for the `spec_review` reference. |
| `.canon/templates/spec.md` | Added bug/flake-fix-only guidance to the *Problem* section, *Acceptance Criteria* section, and Spec Quality Checklist with the same four obligations. |
| `templates/.claude/skills/canon-spec/SKILL.md` | Regenerated mirror of the root skill. |
| `templates/.canon/templates/spec.md` | Regenerated mirror of the root spec template. |
| `scripts/run-task/prompts/templates/spec.md` | Added the bug/flake-fix rules-of-thumb bullet (confirmed mechanism + red-first regression-test AC + two-part environment-bound escape) to the runtime fresh-spec prompt. |
| `scripts/run-task/prompts/templates/spec-revision.md` | Same bullet added to the runtime spec-revision prompt for `changes_requested` reroutes. |
| `scripts/run-task/prompts/index.ts` | Added the conditional bug/flake-fix self-check item to the `selfCheck` constant rendered via `{{{selfCheck}}}` in the spec prompt. |
| `tests/run-task-prompts.golden.json` | Regenerated prompt snapshot; the spec prompt and spec-revision prompt now include the amended rules-of-thumb text. |
| `dist/scripts/run-task.js` | Rebuilt bundle carrying the prompt, template, and self-check updates into the shipped CLI artifact. |
| `docs/pipeline-invocations.md` | Appended reroute/validation entries from Iteration 2 so task telemetry stays current. |

## How to Test

1. Begin writing a spec for a bug fix using `/canon-spec`. Confirm the guidance asks you to explain *how* you confirmed the underlying cause (e.g. reproduction, trace, or forced repro) — not just to state what you think is wrong.
2. Confirm the guidance asks you to include a regression test that would fail on the current unfixed behavior and pass once the fix is in place.
3. For a bug that only surfaces in a specific environment (shallow clone, deploy-only behavior, a race condition), confirm the guidance allows you to document *why* a direct repro is environment-bound and impractical, and what deterministic alternative you used — rather than silently skipping verification.
4. Confirm the guidance explicitly tells you this obligation is yours to satisfy before marking the spec done, and that fast-tier (S, non-delicate) tasks won't get a `spec_review` pass to catch a skipped step.
5. Begin a spec for a new feature or refactor and confirm none of the above steps appear — the new guidance adds no overhead to non-bug-fix specs.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Re-ran after Iteration 2 prompt/self-check updates. |
| `npm run type-check` | Pass | Re-ran after Iteration 2 updates. |
| `npm test` | Pass | Re-ran with `UPDATE_GOLDENS=1` to refresh `tests/run-task-prompts.golden.json`; suite passed. |
| `npm run sync-templates:check` | Pass | Root and mirror files are aligned. |
| `npm run docs-refs-check` | Pass | No broken refs introduced by the new prose. |
| `npm run build` | Pass | Required by Amendment Round 2 (runtime prompts bundle into `dist/scripts/run-task.js`); rebuild completed successfully. |

## Human Verification Required

None.

**Handoff Validation Pre-Merge Checklist**

- [ ] Version correct (per project policy)
- [ ] Changelog updated if needed (per project policy)
- [ ] PR body current
- [ ] Final CI/CD checks green
- [ ] Final diff matches spec intent

## Proposed Changelog

**Added**

- **`/canon-spec` and the spec template now guide bug/flake-fix authors to confirm the failure mechanism before writing the spec.** For a bug or flake fix, the skill, the spec template, and the runtime spec/revision prompts all direct the author to: (1) state in *Problem* how the mechanism was confirmed (reproduction, trace, or forced repro), not merely assert a plausible cause; (2) include a regression-test AC that fails on the pre-fix code for the stated reason and passes after the fix; and (3) when the mechanism is environment-bound and a faithful repro is impractical, say so and supply a deterministic alternative rather than skipping verification silently. The guidance is scoped to bug/flake fixes and does not affect feature or refactor spec authoring. The `spec_review` reference in the produced text is framed as the author's obligation to satisfy before marking the spec done, with an explicit note that fast-tier (S, non-delicate) tasks skip `spec_review` so no reviewer will catch an unverified mechanism. Ships to adopters via `canon upgrade`.

## Decisions Made

1. **Reviewer-side rule kept as-is.** The existing `spec_review` checkpoint prompt already names all three checkpoints (author / reviewer / implementer). This task adds the author-side home; it does not move or alter the reviewer-side rule. The two homes are concept-linked, not path-linked, to avoid the internal-path gate.

2. **AC-7 framing added via spec amendment.** Code review round 1 (spec_gap finding) identified that naming the `spec_review` checkpoint as the enforcement backstop misleads fast-tier authors — the exact audience most at risk — into thinking a reviewer will catch an unverified mechanism. The amendment reframes the phrasing as the author's own obligation with an explicit fast-tier callout.

3. **Escape predicate requires both parts everywhere.** Code review round 1 (spec_gap finding) identified that using only half the escape predicate ("if a direct test is impractical") silently widens the escape to any hard-to-test case. AC-3 was amended to require both parts ("environment-bound AND a faithful repro is impractical") in every occurrence across all surfaces.

4. **Amendment Round 2: runtime surfaces added to scope.** Cold Codex passes during code review found that the rules-of-thumb bullet was present on only 2 of 4 surfaces (the skill and spec template) and the self-check on only 2 of 3 homes — the runtime `spec.md` and `spec-revision.md` prompts and the `selfCheck` constant in `index.ts` were missing. The spec was amended to declare these surfaces and the implementation completed them in Iteration 2.

5. **No new section in the spec template.** Additions land inside the existing *Problem*, *Acceptance Criteria*, and *Spec Quality Checklist* sections — refinements to existing managed surfaces, not new managed sections.

## Open Questions

None.
