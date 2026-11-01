<!-- round=1 reviewed_sha=2ba16915463ca0b8fce866a760f69cbd19c4361b scope=full base=main reason="Round 1 (initial review)" -->

The new guard misses valid `gh pr merge` invocations when a global repository flag precedes the subcommand, allowing the task-PR merge bypass it is intended to prevent. Other reviewed changes did not yield additional actionable findings.

Review comment:

- [P2] Detect repository flags before the `pr` subcommand — /Users/tstraub/canon-ai/.canon/worktrees/adopter-bypass-guards/.claude/hooks/canon-guard.mjs:441-441
  When `gh` is invoked with a global repository flag before the subcommand, such as `gh -R owner/repo pr merge 12 --squash`, `invocation.args[0]` is `-R`, so this check skips the merge rule and allows a task PR to be squash-merged without canon cleanup. Normalize or skip global flags before matching `pr merge`.