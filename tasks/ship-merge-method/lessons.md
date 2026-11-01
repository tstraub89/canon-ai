### Restore side effects before `die()`, not in a `finally`

*(date 2026-11-01, source: ship-merge-method)*

`die()` calls `process.exit`, so a `try`/`finally` around a call that dies never runs its cleanup. Before this task, `shipTasks` backed up the supervising checkout's telemetry appends and then died on a failed merge, leaving the appends only in a temp backup. The fix is to have the failing step return a result so the caller restores the state and then dies. Canonical example: `mergeOpenPRsAndPull` in `src/orchestrator/main.ts` returns a failed result, and `shipTasks` restores the preserved dirt before it exits. Any new cleanup that must survive a failed irreversible step (a merge, a push) needs the same shape, and the test should seed the state and assert it is restored after a forced failure.
