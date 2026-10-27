# PR Body: default-qa-model-to-haiku - Make Claude Haiku 5.5 the default QA model

## Summary

- The QA phase now defaults to `claude-haiku-5-5` at medium effort at every task size, including delicate. Spec, plan and code review keep their models.
- QA leaves the light tier: `CLAUDE_MODEL_LIGHT` and `CLAUDE_MODEL_STRONG` no longer reach it. Its precedence is `CLAUDE_MODEL_QA` → legacy `CLAUDE_MODEL` → Haiku.
- Pinned adopters: `CLAUDE_MODEL_QA` is unchanged. Adopters who set only `CLAUDE_MODEL_LIGHT` move QA to Haiku. Adopters who set both `CLAUDE_MODEL_LIGHT` and `CLAUDE_MODEL` move QA to the legacy value. Rollback is one line: `CLAUDE_MODEL_QA=sonnet`.
- The change is recorded as a new entry in `docs/decisions.md`. The evidence is operator-reported and uncontrolled, so the entry includes a measurement rule to check it.
- Docs, the legacy warning text and the model tests are updated to match. `templates/docs/pipeline-orchestrator.md` is regenerated, and `dist/orchestrator/run-task.js` is rebuilt.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Behavior change for adopters who pin the light tier. Their QA step moves off their light model on upgrade, with no config change. The decision entry lists each case.
- No new environment variable. The QA default is a separate resolution branch in `src/lib/pipeline-policy.ts`, not a third tier.
- Open follow-up: the fix-up session that repairs artifact references runs on the QA model and has no Haiku runs yet. If it fails, pin `CLAUDE_MODEL_QA`.
