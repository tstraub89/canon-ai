## Summary

- Fix `canon run --pr` double-push CI race: the second `chore: record pr.number` commit is eliminated — the PR number is now stored in a gitignored task-local sidecar (`tasks/<id>/.pr-number`) instead of committed `status.json`. `--pr` makes exactly one pushed commit, firing a single CI run on the PR head. No more cancelled checks requiring a manual re-run.
- Scale the per-phase Claude budget by effective task size (S/M → $5, L → $10, XL/delicate → $20) instead of a flat $5 cap. `CLAUDE_BUDGET` env var still overrides the tier with a flat value for all phases.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` or `scripts/run-task/` changed)

## Notes

The original design used a `[skip ci]` marker on the non-head artifacts commit. Code review found that a transient `gh pr create` failure could leave the marked commit as the permanent head with CI suppressed indefinitely — a worse failure mode than the one being fixed. Eliminating the second commit entirely is a net code reduction and removes the race at its source.

`--ship` reads `pr.number` from the sidecar for merge-evidence (base-ref match + head-ancestor proof unchanged). When the sidecar is absent — tasks created before this release, or a worktree that was rebuilt without `--pr` — it falls back to branch-lookup, preserving pre-1.11 behavior.

The budget tier reuses the existing `getEffectiveSize`/`anyDelicate` bucketing from the model/effort matrix. An explicit `CLAUDE_BUDGET=5.00` is treated as a flat override (not the tier), even though S/M tier is also $5 — the distinction matters for L/XL where unset → tiered and set → flat differ.

Human verification: on a live PR, confirm exactly one CI run appears on the head commit after `--pr`; on an L/XL task, confirm the run log reports the higher spend cap.
