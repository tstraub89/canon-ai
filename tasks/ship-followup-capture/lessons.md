### Gate every caller of a shared phase transition, including salvage paths

*(2026-11-15, source: ship-followup-capture)*

A new rejection in a phase gate reached a caller that did not expect it. The QA stdout-salvage path calls the qa → done transition directly, so a salvaged done.md without the new section threw out of the phase runner and left qa `in_progress` with no repair route. The plan had flagged the path and deferred it, and code review caught it in round 1. Prevention: when a gate adds a rejection to a transition, grep every call site of that transition, including recovery and salvage paths, and confirm each one either handles the rejection or is left alone on purpose. Canonical example: `runQaPhase` in `src/orchestrator/phases/qa.ts`, which calls `taskPhase` and is the path that escaped.

---

### Put a file the plan finds outside Affected Files into the spec before implement

*(2026-11-15, source: ship-followup-capture)*

The plan noticed that a salvage path, five QA test fixtures, and a recovery guide also had to change, but kept them out of the spec's Affected Files and left them as notes for the operator. Implement is capped by Affected Files, so the implementer logged them as Blockers, and code review raised three spec-gap findings that needed an amendment. Prevention: when a plan or notes entry says a file outside Affected Files must change, amend the spec's Affected Files before implement starts instead of leaving it as a note. When writing the list, grep for the tests that drive the changed gate or phase, because fixtures that supply the old input are the usual omissions.
