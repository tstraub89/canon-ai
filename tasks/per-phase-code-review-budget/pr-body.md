## Summary

- Give `code_review` its own `CLAUDE_BUDGET` curve instead of sharing a flat per-size cap with `spec`/`plan`/`qa`. Since the three-lens review (anchored + cold Claude + cold Codex, foreman-synthesized) landed, `code_review` runs a structurally costlier session than the other Claude phases — an M-tier task in another project actually exhausted its shared $10 budget mid-review. `spec`/`plan`/`qa` keep today's values (XS/S $5, M/L $10, XL $20); `code_review` now runs XS $5, S $10, M $15, L $20, XL $40.
- The flat `CLAUDE_BUDGET` env-var override is unchanged — set it and every phase still resolves to that one value regardless of size.
- Docs (`docs/pipeline-orchestrator.md`'s Claude Budget Matrix, `docs/decisions.md`) updated to match; the prior size-only equalization decision is marked superseded.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` — `scripts/pipeline-policy.ts` changed)

## Notes

- Only the M `code_review` cell ($15) has direct incident evidence; S ($10), L ($20), and XL ($40) are extrapolations along the same ramp, called out as such in `docs/decisions.md`. A follow-up tuning task can adjust these once more usage data accumulates.
- This branch is 2 commits behind `main` (a CHANGELOG correction and a backlog-triage commit). This task's diff only touches the 6 files above and doesn't conflict with either, but I'd rebase/merge `main` in before landing so a two-dot diff or fast-forward can't make those commits look reverted.
- `resolveBudget()` now runs once per phase lookup instead of once per policy call (a spec-directed change, since the result now varies per phase) — negligible cost, it's a pure O(1) table lookup.
