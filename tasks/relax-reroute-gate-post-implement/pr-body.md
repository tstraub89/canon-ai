## Summary

- `--reroute` used to only work from `human_review`, or from a `code_review` block carrying a `spec_gap` verdict — everything else, including the common case of a task auto-blocked at `code_review` after too many review rounds, or one just sitting at `qa`, had no sanctioned reroute path.
- Widen admission to any phase that implies a completed `implement` round — `code_review`, `qa`, or `human_review`, any status/verdict, single tasks or mixed-phase bundles — while leaving the Amendment pre-flight, the spec-gap sibling exemption, and the reset loop completely unchanged.
- Update every surface that stated the old two-case rule (both CLI help blocks, both README spots, the pipeline doc, the pipeline skill) and every reroute prompt that claimed a human had reviewed/run/tried the prior implementation — that claim is now false in three of the five newly-admitted states, so the prompts say only that a human decided to reroute and wrote an amendment after implementation finished.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt + committed `dist/`)

## Notes

- The reroute banner (emitted before the state reset) now names each task's real entry phase instead of a hard-coded `human_review`/`spec_gap` label — this is the main place the widening becomes visible to an operator who's used to reroute only firing from `human_review`.
- Rerouting from `code_review` or `qa`-pending happens before the QA-end commit, so task artifacts can be uncommitted in the worktree at that point. Reroute itself does no git operation and destroys nothing, but I called this out explicitly in the pipeline doc and fixed a `docs/patterns.md` line that had (accidentally) implied otherwise — it said `--reroute` always starts from committed post-QA state, which stopped being true.
- Added an explicit "this is a human decision" sentence to the two surfaces an agent driving canon actually consults before invoking `--reroute` (the pipeline doc and the pipeline skill) — widening admission makes reroute reachable from states an autonomous pipeline could plausibly hit on its own, which `human_review`-only admission never allowed.
- Code review (3-lens: anchored, spec-blind cold-Claude, cold-Codex) came back approved with nits — no correctness bugs, all 13 ACs independently verified. It also surfaced three pre-existing issues in files this task deliberately didn't touch (a stale-verdict wedge risk in `code_review` after a multi-round reroute, `--full-send` tasks being permanently unrerouteable, and an evidence-freshness guard gap for `code_review`/`qa` resets) — none of them regressions from this change, all flagged for separate follow-up.
