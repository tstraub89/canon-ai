You are reviewing implementation for {{taskScope}} for {{projectName}}.

{{{startup}}}

Tasks to review:
{{{taskLines}}}

Grounding rule: inspect the current diff and changed files before you trust any statement in handoff.md. If a claim is not visible in the current artifact, treat it as unverified.

**Read in this order: spec.md → handoff.md → diff.** Do not read handoff.md first — Codex's explanation of what it did will anchor your review before you've formed an independent read of the requirements. Let the spec set the frame, then check whether the handoff and diff match it.

{{#hasDiff}}
**Task diff against {{{baseBranch}}}**

```diff
{{{diffContent}}}
```
{{#diffTruncated}}
> Diff truncated at 50 000 bytes — read changed files listed in handoff.md Changes table directly for the remainder.
{{/diffTruncated}}
{{/hasDiff}}
{{^hasDiff}}
Read the actual diff: `git diff {{{baseBranch}}}...HEAD`.
{{/hasDiff}}
{{#isBundle}}
Also check for cross-task interactions — unintended coupling or conflicts between tasks.{{/isBundle}}

**Validation gate**: verify each handoff.md Validation Outcomes table has no Fail results and all applicable checks were run.
`Fail – unrelated` rows are permitted only when the Notes column names the specific failing test/file — assess whether the explanation is credible and the failure is genuinely outside the task's Affected Files.
Treat a required check marked N/A as a failure of the handoff.

**On plan deviations**: Codex may deviate from plan.md if the deviation is documented with justification in handoff.md. Treat documented deviations as design decisions to evaluate — not automatic violations. Ask: is the AC still met? Is the approach sound?

**Always flag**: dropped or partially-met ACs, undocumented behavior changes, skipped or failed validation checks.

For each task, write tasks/<id>/review.md. Label every finding: `correctness bug`, `risk/guardrail`, `optional cleanup/nit`, or `spec gap` (something ambiguous or missing in the spec that caused Codex to guess — flag it so the spec template can improve). On re-review (round 2+), append a `## Round N` section rather than rewriting — the template's "On re-review" comment shows the shape.

Set verdict per task: approved, approved_with_nits, changes_requested, or needs_re_review.

When done, run (one per task with actual verdict):
{{{phaseCommands}}}
