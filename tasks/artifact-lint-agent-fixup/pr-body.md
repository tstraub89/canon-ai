# PR Body: artifact-lint-agent-fixup - Send task-artifact docs-refs failures back to the agent session that wrote them

## Summary

- Before canon commits a task's handoff (after implement) or its QA summary and PR body, it runs `docs-refs-check` on those artifacts. A broken reference resumes the session that wrote the artifact, up to two attempts, then falls back to today's behavior.
- A fix session that touches anything outside the agent's own artifacts stops the run before commit and names the changed paths. This covers source files, `status.json`, and commits made by the session.
- A failed fix session warns and continues; it never parks a phase.
- The implement and QA prompts now ask for full-path citations and the markdown-link form for deleted files, so fewer references break in the first place.
- Fixes #102.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [ ] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- The full suite was last run with one failure outside this change: a `git clone` fixture in `tests/run-task-ship.test.ts` exited 128. The safety suite passes on the final tree (256 passed, 1 skipped). Re-run `npm test` before merging.
- The red-first run for the implement case (the broken handoff failing with `Auto-commit failed:` on the pre-change code) was not reproduced in-tree. A scratch-copy run during review showed the failure.
- Small open nit: the scope guard keys its HEAD snapshot as `[git HEAD]` in the same map as repo paths. A root file with that exact name could overwrite it. Not blocking.
- `dist/cli/index.js` and `dist/orchestrator/run-task.js` are rebuilt.
