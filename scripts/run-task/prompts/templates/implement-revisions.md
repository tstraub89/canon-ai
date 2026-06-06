{{{iterBanner}}}

{{{stateHeader}}}
{{{startup}}}

{{{affectedFilesBlock}}}

{{#hasReviewFindings}}
Your prior iteration shipped; the reviewer (Claude) appended findings to `review.md` as `## Round {{priorRound}}`. If you're resuming the prior session, the full task framing (spec, plan, repo conventions) is already in context — skip the re-read. If your context is cold, re-read `tasks/<id>/spec.md` and `tasks/<id>/plan.md` before addressing findings.

Tasks with new review feedback:
{{{reviewLines}}}

For each task:
1. Read the most recent `## Round {{priorRound}}` section of `tasks/<id>/review.md`. That is the entire scope of this iteration.
2. Address every `correctness bug`, `risk/guardrail`, and `spec gap` finding from that round (blocking). `optional cleanup/nit` is at your discretion{{#tightenLine}}{{{tightenLine}}}{{/tightenLine}}
3. Re-run only the validation checks affected by your changes (typically lint, type-check, plus whatever the diff touches).
4. **APPEND** to `tasks/<id>/handoff.md` a new section `{{{handoffAppend}}}` (the template's "On revision rounds" comment shows the shape). Do NOT rewrite the file from scratch — earlier iterations stay as the cumulative record. Include only the delta: findings addressed, AC deltas, re-run validation results.
{{/hasReviewFindings}}
{{#hasPreflightFindings}}
Your prior iteration was rejected by the orchestrator's pre-flight gate **before any Claude review ran**. The rejection details are recorded in `review.md` under `## Validation Gate` / `## Pre-Flight Rejection`.

Tasks with pre-flight rejection feedback:
{{{reviewLines}}}

For each task:
1. Read the pre-flight block in `tasks/<id>/review.md` and follow **whichever framing it carries**:
   - **"Fix the handoff"** items → fix `handoff.md` (Validation Outcomes rows, AC Coverage table, Changes table).
   - **"Fix the code"** items → a required check failed on a file you changed. Fix the regression, re-run the check, and update the handoff.
   - Both framings may be present — address all items from both before resubmitting.
2. **APPEND** to `tasks/<id>/handoff.md` a new section `{{{handoffAppend}}}`. Include the delta: which items you addressed and how.
{{/hasPreflightFindings}}

Spec ACs remain binding. If the review identifies a dropped AC, restore it.
Append to `tasks/<id>/notes.md` for new pitfalls found (prefix: `[implement-revision]`).

When done, run:
{{{phaseCommands}}}
