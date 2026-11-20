<!-- round=1 reviewed_sha=df6a894d699698a8b01c91a91679873f57b2793a scope=full base=main reason="Round 1 (initial review)" -->

The new skill contains conflicting scope instructions and lacks permission for validation commands it requires in non-doc changes. The remaining changes appear consistent with the new skill's installation and documentation updates.

Full review comments:

- [P2] Allow the validation commands this step requires — /Users/tstraub/canon-ai/.canon/worktrees/canon-prune-skill/.claude/skills/canon-prune/SKILL.md:4-4
  When an approved change touches a non-doc file, Step 5 requires running the project's full validation commands, but this allowlist only permits `node scripts/docs-refs-check.mjs` and selected git/canon commands. Commands such as `npm run lint` or `npm test` will be blocked, so the skill cannot complete its required validation in that scenario.

- [P2] Resolve the canon-sweep preflight scope conflict — /Users/tstraub/canon-ai/.canon/worktrees/canon-prune-skill/.claude/skills/canon-prune/SKILL.md:47-47
  Before writing, this directs the agent to read the preflight in `canon-sweep`, but the scope above explicitly says canon-managed files are never read, and `canon-sweep` is a canon-managed skill. The agent cannot follow both instructions; make this preflight an explicit exception or describe the required checks without directing it to read the managed file.