You are addressing **human-review feedback** on {{taskScope}} for {{projectName}}.

{{{stateHeader}}}
{{{roundBanner}}}{{{preamble}}}

{{#startup}}{{{startup}}}
{{/startup}}{{{risksBlock}}}{{{pitfallsBlock}}}{{{contextBlock}}}
{{{affectedFilesBlock}}}
Tasks with amended specs:
{{{taskLines}}}

{{{groundingRule}}}

**How to approach this:**
0. If a task's line above marks it EXEMPT, skip steps 1-2 for that task entirely — its spec has NO Amendment section and its plan has NO Reroute Plan section, by design. For exempt tasks, follow the task-specific line above: approved siblings only need shared-behavior re-verification, while siblings with prior review findings must still address those findings.
1. For each task above, read `tasks/<id>/spec.md` from your current working directory (the worktree). REPO_ROOT's copy is the pre-implement scaffold and does NOT contain operator amendments. Locate the exact heading named in its entry — `## Amendment` for round 1, or `## Amendment Round N` for round 2+. Each task carries its own reroute round (bundles may mix rounds), so use the heading specified in that task's line, not a bundle-wide assumption. Treat that section's content as the new requirements; ignore prior-round sections when implementing this one.
2. Check `tasks/<id>/plan.md` for `## Reroute Plan` (round 1) or `## Reroute Plan Round N` (N = that task's reroute round). If present, use that section as the delta guide. If absent (fast-tier reroute with no conversational reroute plan), read the base plan for orientation.
3. Read tasks/<id>/handoff.md to understand what you previously shipped. Do NOT assume the handoff covers the amendment — it was written before the amendment existed.
4. Identify the delta: which ACs are new, which changed, which were already addressed by the previous implementation.
5. Implement the delta. Previously-correct work stays; only change what the amendment requires. If the amendment conflicts with a prior AC, the amendment wins.
6. Re-run ALL applicable validation checks (lint, type-check, test, build, e2e as applicable per the spec's Validation Required). Required checks must be recorded as Pass or Fail; do not mark a required check N/A.
7. **Rewrite handoff.md** to reflect the complete current state of the implementation — including the round-1 work that still applies plus the new amendment work. The reviewer reads handoff.md as the single source of truth, not your prior session's context.

**Spec ACs are binding** — including both original ACs and amendment ACs. If you think an amendment AC is infeasible as written, document it under Blockers in handoff.md. Do not silently drop any AC.

Append to tasks/<id>/notes.md for any surprising behavior found while re-reading the codebase (prefix: `[implement-reroute]`).

When done, run:
{{{phaseCommands}}}
