The new HEAD snapshot check can be overwritten by a valid repository path, allowing an out-of-scope commit to evade the fix-up guard in that scenario.

Review comment:

- [P2] Keep the HEAD snapshot key distinct from file paths — /Users/tstraub/canon-ai/.canon/worktrees/artifact-lint-agent-fixup/src/orchestrator/main.ts:412-412
  If the repository has a dirty root-level file named `[git HEAD]` before the fix-up, the loop below overwrites this entry with that file's fingerprint. If the agent then commits an out-of-scope change and leaves that file unchanged, the post-snapshot overwrites the HEAD entry again, so the commit can go undetected. Store HEAD separately or use a key that cannot collide with repository paths.