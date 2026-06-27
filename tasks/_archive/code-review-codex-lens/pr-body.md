## Summary

- Add a cold Codex (GPT-family) third lens to `code_review`: before spawning the Claude foreman, the orchestrator runs `codex exec review --json --base <base> -m <mini-model>` in the task worktree, captures findings to `review-cold-codex.md`, and injects them into the foreman prompt for 3-way verify-don't-relay synthesis.
- Foreman now adjudicates three inputs with separate reconciliation tracks — cold findings (Claude and Codex) verified against the diff first; a verified cold finding can't be dismissed as off-AC. Cross-model agreement (same behavior flagged by both cold lenses) gets higher-confidence treatment.
- Hard-fail when Codex is unavailable (stops before synthesis; re-runnable); bundle-atomic (one review per invocation, findings fanned to all member task dirs, failure stops all members); duration logged to run log for the sequential-vs-concurrent decision.
- Overturns the prior "two-lens / do not add a third lens" rule in `docs/decisions.md`; near-clone caution scoped to same-model additions, cross-family decorrelation named as the exception.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt `dist/scripts/run-task.js` and committed)
- [x] `npm run sync-templates` + `sync-templates:check`
- [x] Structural grep gate (AC-10): zero "two-lens" / "do not add a third lens" matches on live surfaces

## Notes

- **Bootstrap constraint**: this PR's own `code_review` ran the two-lens path — the 3-lens path only activates for tasks that run `code_review` after this merges. The first live exercise is the next task through `code_review` on the merged base (Human Test Plan).
- **Diff-range parity to verify in dogfood**: `getScopedDiff()` uses `git diff <base>...HEAD` (three-dot); whether `codex review --base` produces the same committed range is operator-confirmed but not test-covered. Verify in the first post-merge run.
- **One optional nit to clean up if desired**: `runColdCodexReview` returns `durationMs` but the phase recomputes its own `Date.now()` bracket and ignores the returned value. Harmless; file a follow-up if it bothers you.
- `docs/pipeline-invocations.md` has a staged metrics entry from the code_review Claude foreman invocations — expected, not a spec violation; the cold-Codex duration is a run-log line only per AC-4.
