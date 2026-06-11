## Summary

- Guard `canon task accept` against sanctioning a review phase that never ran: exits non-zero before touching any state when no review verdict exists, names the offending task, and points to `--force` as the explicit bypass. Bundle invocations are atomic — all tasks are checked before any mutation.
- Scope the reroute amendment pre-flight to spec_gap tasks only in mixed-bundle reroutes: non-gap siblings no longer need an `## Amendment` heading, matching what the recovery banner already tells the operator to do. A per-round `reroute_exempt` marker lets downstream evidence gates treat exempt siblings as first-pass; exemptions clear on subsequent reroutes to keep round-heading numbering collision-free.
- Failing-verdict siblings (`changes_requested`, `needs_re_review`) are also exempt from amendment requirements but keep their prior review findings binding — the implement-reroute prompt names the prior verdict and directs the implementer at the existing `review.md`, rather than describing them as approved.
- Closes both harness bugs filed in `docs/BACKLOG.md` after the v1.11.0 diff review (PR #154).

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` or `scripts/run-task/` changed)

## Notes

- `reroute_exempt` and `reroute_exempt_prior_verdict` markers are kept local to `main.ts`/`validation.ts` with explicit runtime narrowing rather than being added to the shared `types.ts` module — `status.json` is already treated as `unknown` at the boundary, so this is the right layer.
- `reroute_exempt_prior_verdict` is written before verdict-clearing reset and deleted when the exemption is absent, so failing-sibling prompt flavor survives the reroute's state transition without leaking into subsequent rounds.
- `docs/pipeline-orchestrator.md` updated for the new verdictless-accept refusal behavior and spec_gap-only amendment requirement in mixed bundles; template copy auto-synced.
