## Summary

- Recalibrate the Codex `spec_review` prompt so a strong, literal reviewer (the 5.6-generation model) reviews for precision, not just recall: state once that a clean spec with no blocking findings is a valid outcome, extend "silence is the default" across the whole review instead of just the shape check, add a scope boundary that lets pre-existing behavior a spec explicitly excludes and verifies unaffected be downgraded to a nit (while keeping omitted-required dependencies, transitive effects, and contradictions blocking), and add a worked example that an obviously-implied default is a plan-phase nit, not a blocker.
- Regenerate the golden test fixture and rebuild the shipped orchestrator bundle so the recalibrated wording is what actually ships.
- Record the durable meta-insight in `docs/decisions.md`: guardrail prompts carry an implicit model-strength calibration, so a future model-generation bump should trigger a re-check of `spec_review` and its peer guardrails.
- Reconcile the full-send review block with the recalibrated base: redirect its "raise the bar / thoroughness higher" framing to attention-allocation ("what full-send changes is *where you look*, not how much you flag"), and bind it to the silence default, scope boundary, and verdict rules the rest of the prompt sets out (the three full-send focus areas are unchanged).

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` since `scripts/run-task/` changed)

## Notes

- Three tasks in one week (`update-install-root-provenance`, `stable-validation-ids`, `fix-installed-provenance-version`) burned 6–7 `spec_review` rounds each on manufactured blocking findings against specs that were already sound under the old "push to find fault" framing — one of them attacked behavior the spec had explicitly excluded and verified unaffected. This change is the fix.
- No executed prompt A/B or precision/recall eval backs this — a prompt's effect on a stochastic reviewer isn't deterministically reproducible, and building that harness would be exactly the kind of over-mechanization this change guards against. The evidence is convergent (the three internal incidents plus vendor guidance that the 5.6 generation is higher-recall/lower-precision than its predecessor), and the safety net is a live dogfood observation: `default-codex-models-to-5-6-generation` is the first task to run `spec_review` under the recalibrated prompt, and a genuine blocker it fails to catch is the signal to reopen this.
- What counts as a blocking finding, the Shape Check probes, the verdict thresholds, and the bug/flake evidence ladder are all unchanged — this only narrows what gets flagged, not the bar for flagging it.
- Deliberately left alone: `spec-review-reroute.md` (a different, post-human-review flow with no over-firing evidence against it).
- Three-lens code review (anchored Claude, cold Claude, cold Codex) converged on approved with nits — no correctness bugs or blocking spec gaps.
- **Post-QA inline follow-up (full-send block).** Code review flagged the full-send variant's "raise the bar" framing — the same over-firing pattern this task fixes, in the same file — as a follow-up candidate. Rather than defer it, it was reconciled inline after QA (see the fifth Summary bullet). Because this edit landed after the 3-lens pipeline code_review, it was reviewed independently via `codex review`: clean approval, with one positional-reference P2 caught and fixed (the note referenced rules "above" when the full-send block renders before them, so it now names them position-independently).
