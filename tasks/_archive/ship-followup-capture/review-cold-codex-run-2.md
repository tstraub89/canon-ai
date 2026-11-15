<!-- round=1 reviewed_sha=4d557aa702c539dfdf8aae58d3dc3789199fb6e4 scope=full base=main reason="Round 1 (initial review)" -->

The follow-up parser accepts categories outside the documented set, allowing malformed entries through the QA gate and into ship output. Template synchronization and type-checking pass, but neither catches this validation gap.

Review comment:

- [P2] Reject unsupported follow-up categories — /Users/tstraub/canon-ai/.canon/worktrees/ship-followup-capture/src/orchestrator/followups.ts:71-71
  When `done.md` contains a structurally valid row with a category outside the documented set (for example, `bug`), the QA gate accepts it and `--ship` prints it as if it were valid. Validate each category against `FOLLOWUP_CATEGORIES` so invalid classifications are caught before shipping.