[REVIEW ROUND {{roundN}} — verifying iteration {{priorIteration}}'s response to round {{maxIter}} findings]

Codex appended `## Iteration {{priorIteration}}` to `handoff.md` addressing your prior round's findings. If you're resuming the prior review session, the full task framing (spec, prior review history, repo conventions) is already in context — skip the re-read. If your context is cold, re-read `tasks/<id>/spec.md` and the earlier `## Round` sections of `tasks/<id>/review.md` before verifying the new iteration.

Tasks to re-review:
{{{taskLines}}}
{{{tightenLine}}}
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
Read the actual code diff since your prior review: `git diff {{{baseBranch}}}...HEAD -- <files-from-iteration-{{priorIteration}}>`.
{{/hasDiff}}

For each task:
1. Read the `## Iteration {{priorIteration}}` section of `tasks/<id>/handoff.md` — that's the diff under review this round.
{{#hasDiff}}
2. Read the pre-computed code diff above. Do not trust handoff claims that are not visible in the diff.
{{/hasDiff}}
{{^hasDiff}}
2. Read the actual code diff since your prior review using `git diff {{{baseBranch}}}...HEAD -- <files-from-iteration-{{priorIteration}}>` when the diff was not precomputed. Do not trust handoff claims that are not visible in the diff.
{{/hasDiff}}
3. **Re-fill the Stage 1 AC table.** Every AC from `tasks/<id>/spec.md` gets a row with current Met / Partial / Not Met status against the latest code. This is NOT optional — earlier rounds' AC tables were snapshots of THOSE iterations' code, and iteration {{priorIteration}}'s changes can have broken previously-Met ACs or fixed previously-failing ones. Only a fresh table catches both directions. ACs that were Not Met or Partial in `## Round {{maxIter}}` are this round's load-bearing focus: confirm whether iteration {{priorIteration}} resolved them. For ACs that were Met in round {{maxIter}} AND whose code paths iteration {{priorIteration}} didn't touch, you may mark them `Met (unchanged from round {{maxIter}})` with a one-line evidence pointer — no need to re-derive full evidence — but every AC must still appear in the table.
4. For each finding in your prior `## Round {{maxIter}}` section of `review.md`, verify whether iteration {{priorIteration}} addressed it. The Stage 1 re-table from step 3 feeds this directly: an AC that was Not Met in round {{maxIter}} and is now Met means the corresponding finding is resolved.
5. **APPEND** `## Round {{roundN}} — verifying iteration {{priorIteration}}'s response to round {{maxIter}}` to `review.md` (the template's "On re-review" comment shows the shape). Do not rewrite earlier rounds. Include:
   - **Stage 1 AC re-table** (every AC; current status against current code)
   - Per-finding verification (addressed / still open / no longer relevant) — cross-referenced to the AC re-table where applicable
   - NEW findings introduced by iteration {{priorIteration}}'s changes — **including any AC that regressed from Met to Not Met since round {{maxIter}}** (regressions in previously-passing ACs are correctness bugs even when no explicit finding called them out)
   - Verdict for this round

Set verdict per task: `approved`, `approved_with_nits`, `changes_requested`, or `needs_re_review`.

When done, run (one per task with actual verdict):
{{{phaseCommands}}}
