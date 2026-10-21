### Probe the commit you are about to push, after hooks have run

*(date 2026-10-20, source: base-drift-conflicts-only)*

A gate that checks a commit before a push must read the commit git recorded, not a candidate built beforehand. A pre-commit hook can rewrite the index after the candidate is built, so a check that passed on the candidate can still push a conflicting tree. This task's spec review rejected a pre-commit candidate probe for that reason and probed `HEAD` after `git commit` instead. When a gate aborts after the commit, undo it with `git reset --soft` to the recorded pre-commit HEAD, which keeps the content staged. Check the fixture for a hook that rewrites the index: the test should fail if the gate probes the pre-hook index. Canonical example: the base-drift gate in `src/orchestrator/main.ts`, with the hook-rewrite case in `tests/run-task-safety.test.ts`.
