<!-- round=1 reviewed_sha=c63dbfd8704849477f99922c0db5aa8ff1714126 scope=full base=main reason="Round 1 (initial review)" -->

The new fix-up scope guard can miss changes to ignored files, allowing out-of-scope agent edits to go undetected. Type-check passed; the full test run was interrupted before completion.

Review comment:

- [P2] Include ignored files in the fix-up scope check — /Users/tstraub/canon-ai/.canon/worktrees/artifact-lint-agent-fixup/src/orchestrator/main.ts:398-400
  When a resumed agent changes an ignored file outside the listed artifacts (for example, an ignored local config or secret), `git status` omits it from both snapshots, so `diffScopeSnapshots` sees no change and the run proceeds to commit. This leaves the new scope guard unable to detect out-of-scope edits in ignored files; include ignored paths or otherwise verify filesystem changes as well.