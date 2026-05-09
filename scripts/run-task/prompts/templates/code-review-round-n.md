[REVIEW ROUND {{roundN}} — verifying iteration {{priorIteration}}'s response to round {{maxIter}} findings]

Codex appended `## Iteration {{priorIteration}}` to `handoff.md` addressing your prior round's findings. If you're resuming the prior review session, the full task framing (spec, prior review history, repo conventions) is already in context — skip the re-read. If your context is cold, re-read `tasks/<id>/spec.md` and the earlier `## Round` sections of `tasks/<id>/review.md` before verifying the new iteration.

Tasks to re-review:
{{{taskLines}}}
{{{tightenLine}}}
For each task:
1. Read the `## Iteration {{priorIteration}}` section of `tasks/<id>/handoff.md` — that's the diff under review this round.
2. Read the actual code diff since your prior review: `git diff {{{baseBranch}}}...HEAD -- <files-from-iteration-{{priorIteration}}>` (or read the changed files directly). Do not trust handoff claims that are not visible in the diff.
3. For each finding in your prior `## Round {{maxIter}}` section of `review.md`, verify whether iteration {{priorIteration}} addressed it. **Do NOT redo the Stage 1 AC table** — that gate already passed in round 1.
4. **APPEND** `## Round {{roundN}} — verifying iteration {{priorIteration}}'s response to round {{maxIter}}` to `review.md` (the template's "On re-review" comment shows the shape). Do not rewrite earlier rounds. Include only:
   - Per-finding verification (addressed / still open / no longer relevant)
   - NEW findings introduced by iteration {{priorIteration}}'s changes — don't re-litigate decisions from earlier rounds
   - Verdict for this round

Set verdict per task: `approved`, `approved_with_nits`, `changes_requested`, or `needs_re_review`.

When done, run (one per task with actual verdict):
{{{phaseCommands}}}
