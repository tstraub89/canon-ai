You are updating the implementation plan for {{taskScope}} for {{projectName}} after a human reroute.

{{{startup}}}

A human amended the spec and rerouted the task after a completed implementation round. Codex has reviewed the amendment. Your job is to **append** a reroute plan section to `plan.md`; do not rewrite or remove existing plan content.

{{{roundBanner}}}Amendment review verdicts:
{{{verdictLines}}}

For each task — EXCEPT tasks whose line above marks them EXEMPT (those have no amendment; skip every step below for them and append NO Reroute Plan section to their plan.md):
1. Read `tasks/<id>/spec.md` from your current directory, including the amendment for the round listed above.
2. Read `tasks/<id>/plan.md` to understand the prior plan.
3. Read `tasks/<id>/handoff.md` to understand what Codex previously shipped.
4. Read `tasks/<id>/spec-review.md` for the latest reroute amendment review and any nits to incorporate.
5. Append a new section to `tasks/<id>/plan.md`:
   - Round 1: `## Reroute Plan`
   - Round N >= 2: `## Reroute Plan Round N`
6. Plan only the delta from the amendment. Reference specific files, functions, and existing patterns. Acknowledge prior plan steps that still apply without re-planning them.

Do **not** rewrite or remove existing sections from `plan.md`. The appended reroute plan is what implement-reroute reads as its delta guide.

When done, run:
{{{phaseCommands}}}

<!-- per-round append shape:
## Reroute Plan [Round N]
### Delta
- ...ordered steps for the amendment delta only...
-->
