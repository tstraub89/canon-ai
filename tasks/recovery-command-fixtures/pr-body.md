# PR Body: recovery-command-fixtures - Pin every recovery-command hint to a test that runs it from the emitting state

## Summary

- Fix the spec_gap halt's fix hint so it names the amendment heading the next `--reroute` requires. After a task's first reroute, the hint now says `## Amendment Round N`; before, it said a bare `## Amendment` that `--reroute` refused. The console copy and the saved reason share one helper, `rerouteAmendmentHeading`, so the hint and the reroute pre-flight cannot drift.
- Fix the full-send scope note in the same message, which still named the round heading. It now names `## Amendment (full-send scope)`, so a scope-only section can no longer pre-satisfy a later human `--reroute` after a BLESS.
- Add `tests/recovery-hints.test.ts`: a registry of every source line naming `--reroute`, `reset-code-review`, `reset-spec-review` or `canon task accept`, each marked actionable (with covering tests) or exempt (with a reason). A registry test fails on an unregistered line, a stale snippet, or a covering test that does not exist.
- Add chained fixtures that run each actionable hint's printed command from every state that emits it.
- Extend the loop-cap and reviewer-block tests to take the reset command from the emitted text instead of hard-coding it.
- Update the "Enforce the recovery-message and fail-closed pitfalls mechanically" entry in `docs/BACKLOG.md`.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- `dist/orchestrator/run-task.js` is rebuilt for the hint change. `dist/cli/index.js` is not changed.
- The reroute fixture was red-first: with the old hint, the printed `--reroute` aborts with "expected heading: ## Amendment Round 2". The full suite passes on the final tree (1,574 passed, 1 skipped for the existing `.git/` write restriction).
- The registry is a tripwire for literal command text in `src/`. A hint assembled from fragments or variables escapes it. Hints that name other `canon` commands (`canon task phase`, `canon task set`, `--force`, and others) are not covered. `docs/BACKLOG.md` records both.
- Follow-up candidate, not in this PR: the "already done" spec-gate note in `src/task/index.ts` still says "add an amendment" without a round number. The command it names is accepted, so it is not wrong today.
