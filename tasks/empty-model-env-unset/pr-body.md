## Summary

- An exported model variable that is empty or only spaces now counts as unset. This covers `CLAUDE_MODEL`, the per-phase `CLAUDE_MODEL_*` pins, the light and strong tier variables, `CODEX_MODEL_MINI` and `CODEX_MODEL_FULL`, and their deprecated `CODEX_MODEL_DEFAULT` and `CODEX_MODEL_DELICATE` names. Before, a blank value was sent to the agent as an empty model name.
- A blank value falls through to the next setting in the existing order, so a blank Codex variable falls back to `.canon/config.json` again.
- Non-empty model values are trimmed. The deprecation warning stays silent for blank legacy variables.
- Every model env read now goes through one helper, `envModel`, in `src/orchestrator/env.ts`. `src/lib/pipeline-policy.ts` is unchanged.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Blank values are silent. The variable falls through with no warning, the same way an empty `CANON_PROVIDER` is treated as unset.
- Only non-empty model values are trimmed. Model strings in `.canon/config.json` are not trimmed, so a padded value there behaves as it did before.
- Judgment calls not explicitly confirmed during spec review:
  - Whitespace-only values count as unset, not only empty ones. I chose this over matching `CLAUDE_MODEL_LIGHT`, which only treats `''` as unset.
  - Non-empty values are trimmed before use. A trailing space would otherwise reach `--model`.
  - The helper lives in `src/orchestrator/env.ts`, so the resolver and the legacy warning share one definition of "set". `env.ts` cannot import from `policy.ts` without a cycle.
  - I left `CLAUDE_BUDGET` alone. It is a number with its own parsing, so it gets a separate change.
  - I did not mark the change delicate, even though pipeline policy is listed as delicate, because `src/lib/pipeline-policy.ts` is untouched.
