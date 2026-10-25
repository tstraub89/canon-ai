The reroute prompt can omit unresolved prior review findings because it identifies their archive without directing the agent to read it. Type-checking, tests, template-sync, and build completed successfully, but they do not cover this prompt gap.

Review comment:

- [P2] Read archived findings on amended reroutes — /Users/tstraub/canon-ai/.canon/worktrees/reroute-from-implement/src/orchestrator/prompts/index.ts:467-467
  When a rerouted task has a filled prior review, the reroute archives `review.md` and this line says its unresolved findings remain binding, but the prompt never tells the agent to open that archive; the later steps only require reading the spec, plan, worktree state, and handoff. The agent can therefore miss unresolved findings and leave them unaddressed. Explicitly direct it to read the named archive and account for findings not superseded by the amendment.