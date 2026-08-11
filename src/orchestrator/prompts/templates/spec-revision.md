You are revising specs for {{taskScope}} for {{projectName}}.

{{{startup}}}

Tasks with review feedback:
{{{reviewLines}}}

Address every `changes_requested` finding in each spec.md.{{#combined}}
Also update plan.md if spec changes affect the implementation approach.{{/combined}}

**Spec-writing rules of thumb** — apply when revising each spec:

- **Name effects to DELETE** — frame supersession as replacement, not add-plus-remove. State: "replace `oldFn` with `newFn`; `oldFn` must not exist after" — not separate "Add" and "Remove" bullets.
- **Prefer positive or structural assertions** over prose negations for load-bearing constraints. Back a "must not" with a grep AC or positive reframe; bare prose negation is fragile.
- **Symbols named in ACs must exist** — grep for every function or symbol an AC names; verify its return shape matches the spec's assumed data contract before marking spec done.
- **Enumerate every caller and classify its execution context before asserting how a mechanism works** — "counter X only increments on event Y" or "this writer can only be invoked from surface Z" is a control-flow claim, and control-flow claims need every caller traced. A helper named for one trigger routinely serves several, and whether a call site runs inside an agent's own session or in the orchestrator's process is invisible from the function body. Grep every caller of the function or counter — including skills and docs, not just source — and classify each site as in-agent-session or orchestrator-context before the spec asserts anything about it.
- **Behavioral contracts, not mechanics** — ACs describe observable behavior; defer implementation mechanics (signatures, constant names, precise algorithms) to plan/implement. If review rounds start re-litigating literal regexes, exact file layouts, or verbatim command strings, the spec has dropped to code altitude and each round's "underspecified" finding just adds more reviewable surface: move the mechanics into a clearly-labeled non-binding *Implementation Notes* subsection owned by plan/implement, rather than wording the same mechanism more precisely.
- **Bug and flake-fix specs need a confirmed mechanism and red-first test** — For a bug or flake fix, the spec author must state, in *Problem*, both the confirmed mechanism and how it was confirmed — not merely a plausible cause. Evidence must match the mechanism class: a deterministic mechanism (fixed inputs hit the same wrong branch every run) may cite a trace with the verified trigger values; a runtime-dependent mechanism (race, timing, environment/config interaction) needs executed confirmation — a throwaway prototype-fix spike that makes the symptom vanish, or a deterministic forced repro. The author must satisfy that checkpoint before the spec is marked done; on fast-tier (XS, non-delicate) tasks the `spec_review` checkpoint is skipped, so no reviewer will catch an unverified mechanism. The *Acceptance Criteria* must include a red-first regression-test AC: a test that fails on the pre-fix code for the stated reason and passes after the fix. If the mechanism is environment-bound and a faithful repro is impractical, *Problem* must say so and name a deterministic alternative (integration fixture or documented manual repro) instead of skipping verification silently.
- **At ≥3 spec_review iterations, read the rounds' content, not the count** — label each round *edge-fine-tune* (it narrows an already-identified case — converging, safe to finish once the remaining findings are addressed) or *scope-expansion* (it names a **new** structural case the spec hadn't covered — a real design gap). Round count alone is not the signal; a 6-round run of successive fine-tunes is convergence, not churn. On genuine scope-expansion, don't refine again: check whether the last two rejections share one structural root, and whether an existing layer already owns the concern. Dropping the whole mechanism class — or deleting the mechanism in favor of the layer that already owns it — is usually cheaper than another round of hardening.
- **Refactor specs need structural caps** — provide hard size caps, explicit deletion expectations per symbol, and an allow-list grep AC for any symbol that must disappear.
- **UI spatial / gesture tasks** — flag "visual positioning — expect human iteration" or "runtime debugging required" in *Known Risks*.
- **Sensitive-surface escalation** — flag these categories as `delicate: true` in `status.json` and call them out in *Known Risks*: auth, billing / payments, privacy / data handling, destructive operations, schema / data-model migrations, analytics-event changes. The human spec gate is where such tasks stop for review.

When done, run:
{{{phaseCommands}}}
