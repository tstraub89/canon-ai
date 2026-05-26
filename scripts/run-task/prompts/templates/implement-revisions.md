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
Your prior iteration's handoff was rejected by the orchestrator's pre-flight gate **before any Claude review ran**. The rejection details are recorded in `review.md` under `## Validation Gate` / `## Pre-Flight Rejection`. This is an input-validation failure (typically a malformed Validation Outcomes table, missing AC Coverage rows, or a diff/handoff mismatch), not a code-quality finding.

Tasks with pre-flight rejection feedback:
{{{reviewLines}}}

For each task:
1. Read every BLOCKED bullet under `## Validation Gate` (and `## Pre-Flight Rejection` if appended after a prior round) in `tasks/<id>/review.md`. That is the entire scope of this iteration.
2. Fix the handoff itself — usually `handoff.md`'s Validation Outcomes rows (use backticked command keys, not prose labels), AC Coverage table (fill in concrete statuses, no placeholders), or the Changes table (every path in `git diff <base>...HEAD` must have a row).
3. Source-code changes are usually unnecessary for pre-flight fixes. Only touch source if the rejection lists a concrete bug (e.g., a Fail validation result on a real test).
4. **APPEND** to `tasks/<id>/handoff.md` a new section `{{{handoffAppend}}}`. Include the delta: which BLOCKED items you addressed and how.
{{/hasPreflightFindings}}

Spec ACs remain binding. If the review identifies a dropped AC, restore it.
Append to `tasks/<id>/notes.md` for new pitfalls found (prefix: `[implement-revision]`).

When done, run:
{{{phaseCommands}}}
