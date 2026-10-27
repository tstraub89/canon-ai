# Raise mini implement effort and default the full model to GPT-6.1 Sol

## Summary

- Codex `implement` now runs the mini model at `xhigh` effort for XS and S tasks (was `medium`) and at a new `max` effort for M and L tasks (was `high`). XL and delicate tasks keep the full model at `high`.
- `max` is now an accepted Codex effort in `VALID_CODEX_EFFORTS`. Only Codex CLI 0.164.0 with `gpt-6-luna` has been verified to accept it.
- The shipped full-model fallback (`CODEX_MODEL_FULL`) moves from `gpt-6-sol` to `gpt-6.1-sol`. Pricing is unchanged.
- Removed the docs and comments that claimed effort could be raised through an environment variable, that effort scales with task size, or that `xhigh` overthinks. No effort env var exists; effort comes only from the matrix.
- Added a decisions entry with the benchmark evidence, both `max` probes, the operator cohort comparison, rollback steps, and the follow-up measurement.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- **Maximum effort needs a compatible Codex CLI and mini model.** Canon does not check this at runtime. On an older CLI, or with `CODEX_MODEL_MINI` set to a model that rejects `max`, M and L implement runs fail at the Codex call. The fix is to upgrade the CLI, change or unset `CODEX_MODEL_MINI`, or install the previous canon release. The environment-table caveat in `docs/pipeline-orchestrator.md` lists these steps.
- **Effort has no environment override.** Restoring the old effort cells means installing the previous release. Restoring the old full model is `CODEX_MODEL_FULL=gpt-6-sol`.
- **The evidence is vendor-published benchmarks plus a small operator-reported cohort.** The decisions entry treats the change as a hypothesis. The follow-up is to compare `code_review` rounds and `changes_requested` rates for non-delicate XS–L tasks before and after the change date, in `docs/task-quality-log.md`.
- **Behavior change for canon-on-canon runs.** Pipeline runs use the globally installed canon, so the new cells take effect there only after release and `canon update`.
