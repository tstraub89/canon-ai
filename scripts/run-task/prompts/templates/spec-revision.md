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
- **Behavioral contracts, not mechanics** — ACs describe observable behavior; defer implementation mechanics (signatures, constant names, precise algorithms) to plan/implement.
- **At ≥3 spec_review iterations, read the round-over-round shape** — label each round *edge-fine-tune* (missed path, single validator) or *scope-expansion* (new sub-problem each round). If scope-expansion, redesign the AC rather than iterate further.
- **Refactor specs need structural caps** — provide hard size caps, explicit deletion expectations per symbol, and an allow-list grep AC for any symbol that must disappear.
- **UI spatial / gesture tasks** — flag "visual positioning — expect human iteration" or "runtime debugging required" in *Known Risks*.
- **Sensitive-surface escalation** — flag these categories as `delicate: true` in `status.json` and call them out in *Known Risks*: auth, billing / payments, privacy / data handling, destructive operations, schema / data-model migrations, analytics-event changes. The human spec gate is where such tasks stop for review.

When done, run:
{{{phaseCommands}}}
