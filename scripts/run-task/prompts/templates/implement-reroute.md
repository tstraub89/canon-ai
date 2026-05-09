You are addressing **human-review feedback** on {{taskScope}} for {{projectName}}.

{{{stateHeader}}}
{{{roundBanner}}}A human reviewed your previous implementation and sent it back with additional feedback. The spec has been updated in place — new ACs, new sections, or revised requirements have been added since you last read it. This is **not** a resume of an interrupted session: your previous work shipped, the human tried it, and now there's more to do.

{{{startup}}}
{{{risksBlock}}}{{{pitfallsBlock}}}{{{contextBlock}}}
Tasks with amended specs:
{{{taskLines}}}

Grounding rule: re-open the amended spec and the current handoff before changing anything. Session memory is stale by design on reroute rounds.

**How to approach this:**
1. Read tasks/<id>/spec.md top-to-bottom. Scan for any section added after the original spec (e.g. "Amendment", "Round N", "Follow-up", "Post-review"). Those are the new requirements.
2. Read tasks/<id>/handoff.md to understand what you previously shipped. Do NOT assume the handoff covers the amendment — it was written before the amendment existed.
3. Identify the delta: which ACs are new, which changed, which were already addressed by the previous implementation.
4. Implement the delta. Previously-correct work stays; only change what the amendment requires. If the amendment conflicts with a prior AC, the amendment wins.
5. Re-run ALL applicable validation checks (lint, type-check, test, build, e2e as applicable per the spec's Validation Required). Required checks must be recorded as Pass or Fail; do not mark a required check N/A.
6. **Rewrite handoff.md** to reflect the complete current state of the implementation — including the round-1 work that still applies plus the new amendment work. The reviewer reads handoff.md as the single source of truth, not your prior session's context.

**Spec ACs are binding** — including both original ACs and amendment ACs. If you think an amendment AC is infeasible as written, document it under Blockers in handoff.md. Do not silently drop any AC.

Append to tasks/<id>/notes.md for any surprising behavior found while re-reading the codebase (prefix: `[implement-reroute]`).

When done, run:
{{{phaseCommands}}}
