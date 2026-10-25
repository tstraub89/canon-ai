# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
- [plan] The admission predicate follows the spec's letter: it reads `phases.code_review.iterations_current_loop` and `preflight_rejections_current_loop` only, and does not fall back to the legacy `iterations` alias that `getIterations()` in `src/orchestrator/main.ts` uses. A legacy status carrying only `iterations` at implement `pending` with code_review not blocked would be rejected. Every current writer (route-back, reroute, reset-code-review) writes `iterations_current_loop`, so I judged this low risk and did not widen the spec.
- [plan] The new `--reroute` clause in the code_review loop-cap message is registered in `tests/recovery-hints.test.ts` as an actionable hint, with chained covering tests for implement-entry and code_review-entry, not as exempt. It is a real next-step recovery command, and the chained test doubles as red-first proof that the implement-entry loop-cap state reroutes. Nobody was available to confirm; the spec only requires a registry entry.
