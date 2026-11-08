### Judge cumulative handoff evidence by its effective record, not each block

*(date 2026-11-08, source: handoff-self-check-evidence)*

When a gate reads an artifact that accumulates across review rounds, define the effective row for each check (the latest block with a filled row for it; placeholder rows supersede nothing) and state that superseded rows are never judged. Otherwise a baseline `N/A — no tests changed` stays active after a revision adds a test, and a correction appended later leaves the original false claim standing. The revision prompt appends only the delta, so the supersession rule has to live in the gate's charter, the revision prompt, and the foreman's re-review instruction, each with the two canonical examples. Before writing such a check, grep the revision prompt for "delta only" wording and confirm the spec says what supersedes what. Spec review caught the gap in round 1 for this task.
