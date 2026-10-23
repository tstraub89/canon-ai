# PR Body: code-review-lens-timing - Record per-lens duration and tokens for code_review sub-agents

## Summary

- When a Claude session in a pipeline phase starts sub-agents, each top-level sub-agent now gets its own row in `metrics.md`, placed after the session row. For `code_review` you see `claude:code-review-anchored` and `claude:code-review-cold` next to the foreman's `claude` row.
- Each sub-agent row takes its duration and model from the stream's sub-agent result. Its tokens are that sub-agent's own cumulative usage, summed from its transcript. The stream's `totalTokens` is not used, because it reports only the final turn.
- The session row is unchanged, and lens tokens are not added to it. The header note in `docs/pipeline-invocations.md` (via the template) says the rows are separate.
- Nested sub-agents get no row. A missing notification, an unreadable transcript, or a zero sum shows `-` for tokens. Recording never fails a run.

Closes #62.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Those checks passed during the implement phase. They were not re-run at QA.
- The stream field paths come from one captured Claude Code 2.1.309 run and are encoded in test fixtures. A live code review run is the real check; if the harness changes those fields, the rows show `-` tokens rather than failing.
- Agent cells are escaped like the Model cell, since the sub-agent type now comes from the stream.
- Follow-up from review, not addressed in this PR: one resume-fallback test does not exercise dedup, and the outer `try/catch` around the lens-row loop is defensive only.
