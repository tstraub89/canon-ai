You are updating the implementation plan for {{taskScope}} for {{projectName}} after a human reroute.

{{{startup}}}

A human amended the spec and rerouted the task after implementation began. Codex has reviewed the amendment. Your job is to **append** a reroute plan section to `plan.md`; do not rewrite or remove existing plan content.

{{{roundBanner}}}Amendment review verdicts:
{{{verdictLines}}}

For each task — EXCEPT tasks whose line above marks them EXEMPT (those have no amendment; skip every step below for them and append NO Reroute Plan section to their plan.md):
1. Read `tasks/<id>/spec.md` from your current directory, including the amendment for the round listed above.
2. Read `tasks/<id>/plan.md` to understand the prior plan.
3. Establish the current implementation state from the worktree: `git status` and `git diff` against the task's base branch. The prior implementation round may be complete or partial. Read `tasks/<id>/handoff.md` as a record of Codex's prior work only if it has been filled in — after an aborted first pass it may still be the unfilled template.
4. Read `tasks/<id>/spec-review.md` for the latest reroute amendment review and any nits to incorporate.
5. Append a new section to `tasks/<id>/plan.md`:
   - Round 1: `## Reroute Plan`
   - Round N >= 2: `## Reroute Plan Round N`
6. Plan this round's scope: the amendment, plus any unfinished work from the original ACs and earlier amendment rounds (those sections stay binding wherever not yet implemented; the newest amendment wins on conflict). Reference specific files, functions, and existing patterns. Acknowledge prior plan steps that are already implemented without re-planning them.
7. {{{feasibilityCheck}}}

Do **not** rewrite or remove existing sections from `plan.md`. The appended reroute plan is what implement-reroute reads as its guide for this round.

When done, run:
{{{phaseCommands}}}

<!-- per-round append shape:
## Reroute Plan [Round N]
### Round Scope
- Feasibility: ...
- ...ordered steps for this round's scope (amendment plus unfinished earlier work)...
-->
