{{{iterBanner}}}

{{{stateHeader}}}
{{{startup}}}

{{#hasReviewFindings}}
Your prior iteration shipped; the reviewer (Claude) appended findings to `review.md` as `## Round {{priorRound}}`. If you're resuming the prior session, the full task framing (spec, plan, repo conventions) is already in context — skip the re-read. If your context is cold, re-read `tasks/<id>/spec.md` and `tasks/<id>/plan.md` before addressing findings.

Tasks with new review feedback:
{{{reviewLines}}}

For each task:
1. Read the most recent `## Round {{priorRound}}` section of `tasks/<id>/review.md`. That is the entire scope of this iteration.
2. Address every `correctness bug`, `risk/guardrail`, and `spec gap` finding from that round (blocking). `optional cleanup/nit` is at your discretion{{#tightenLine}}{{{tightenLine}}}{{/tightenLine}}
3. Re-run only the validation checks affected by your changes (typically lint, type-check, plus whatever the diff touches).
{{/hasReviewFindings}}
{{#hasRuntimeFailures}}
## Runtime check failures to address

The orchestrator ran runtime checks after your last implementation and recorded the following failures. You cannot re-run these checks yourself — the orchestrator re-runs them after you close implement.

{{#runtimeFailureEntries}}
### Check: `{{{checkName}}}` (task: `{{{taskId}}}`)

Artifacts: `{{{artifactPath}}}`
{{#hasHint}}
Reading hint: {{{artifactReadingHint}}}
{{/hasHint}}

Captured stderr (head-truncated):
```
{{{stderrContent}}}
```

Discipline:
1. READ the artifacts before proposing a fix. The cause is usually visible there.
2. Fix the code, NOT the check. Don't add waits, weaken selectors, or modify assertions unless the spec explicitly authorizes a behavior change.
3. You cannot re-run this check yourself — the orchestrator will re-run after you close implement. You're fixing blind based on captured output.
4. If you cannot determine the root cause from the artifacts, write your hypothesis in the handoff's Blockers section and request human escalation. Blind guessing burns iterations toward auto-block.

{{/runtimeFailureEntries}}
{{/hasRuntimeFailures}}
{{#hasReviewFindings}}
4. **APPEND** to `tasks/<id>/handoff.md` a new section `{{{handoffAppend}}}` (the template's "On revision rounds" comment shows the shape). Do NOT rewrite the file from scratch — earlier iterations stay as the cumulative record. Include only the delta: findings addressed, AC deltas, re-run validation results.
{{/hasReviewFindings}}
{{^hasReviewFindings}}
1. **APPEND** to `tasks/<id>/handoff.md` a new section `{{{handoffAppend}}}` (the template's "On revision rounds" comment shows the shape). Do NOT rewrite the file from scratch — earlier iterations stay as the cumulative record. Include only the delta: runtime failures addressed, AC deltas, re-run validation results.
{{/hasReviewFindings}}

Spec ACs remain binding. If the review or runtime check identifies a dropped AC, restore it.
Append to `tasks/<id>/notes.md` for new pitfalls found (prefix: `[implement-revision]`).

When done, run:
{{{phaseCommands}}}
