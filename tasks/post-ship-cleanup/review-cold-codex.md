The new Self-Check validation rejects legitimate evidence whenever the entire cell is parenthesized. Other reviewed changes did not reveal additional actionable defects.

Review comment:

- [P2] Reject only the actual Self-Check placeholder — /Users/tstraub/canon-ai/.canon/worktrees/post-ship-cleanup/src/orchestrator/validation.ts:112-112
  When valid evidence is written entirely in parentheses, such as `(verified both handoff entry points against the diff)`, this condition rejects it as a template placeholder. That blocks otherwise filled handoffs; match the known placeholder text rather than every parenthesized evidence cell.