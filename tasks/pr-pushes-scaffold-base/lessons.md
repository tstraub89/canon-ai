### Match a remote ref probe on the exact `refs/heads/<name>` line, not a pattern

*(2026-10-24, source: pr-pushes-scaffold-base)*

`git ls-remote origin <pattern>` tail-matches: asking for `x` also prints `refs/heads/feat/x`. A probe that treats any output as "the branch exists" will read a different branch's ref as the one it wanted, and then push or skip based on that. The failure mode is silent: the wrong ref looks present. Rule: parse the output and compare the full ref name, and map exit codes separately (here, 2 means the ref is absent and 128 means the remote is unreachable, so a missing branch and a network failure take different paths). Canonical example: `probeOriginBranch` in `src/orchestrator/git.ts`. Verify with a fixture where the wanted name is a suffix of another branch.

### Fail closed when a prune or refresh of remote state fails

*(2026-10-24, source: pr-pushes-scaffold-base)*

When a check computes "commits not on any remote" from remote-tracking refs, a stale ref for a branch deleted on the remote hides local commits from the check. The fix is to prune first, but a failed prune must not fall back to the unpruned refs; that silently reopens the hole. Rule: if the refresh step fails, skip the action that depends on it and warn, and do not compute from the old state. Prove the prune matters with a mutation: remove only the prune, confirm the stale-ref fixture then succeeds in pushing something it should refuse, and restore it. Canonical example: the missing-remote range in `src/orchestrator/git.ts` and its stale-origin integration case in `tests/run-task-safety.test.ts`.
