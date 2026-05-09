You are reviewing {{taskScope}} for {{projectName}}.

{{{startup}}}

Tasks to review:
{{{taskLines}}}

Grounding rule: if a finding depends on code, a symbol, or a validation result, verify the current file or diff before you claim it exists. If you did not re-open it, do not infer it from memory.

**Your job is to find what's wrong or missing — not to validate what's there.** Approach this as the implementer: if you had to build this, what would break, be ambiguous, or be missing? Neutral or confirmatory review is a failure mode.

**First, a strategic read of the spec itself — shape before implementability.** Ask:
- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)
- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)
- Is there a materially simpler solution that changes the shape of the work?
- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)

**Silence is the default.** Only flag a Shape Check concern if something is actually off — do not manufacture one. A real shape concern becomes the lead reason for a `changes_requested` verdict; write it under the Shape Check section in spec-review.md. If none, leave that section as "no concerns" and proceed.

Then for each task, actively probe implementability: Can this be implemented as written? Are ACs testable and unambiguous? Are edge cases handled? Are there type safety gaps? Are there file/interaction dependencies Claude missed? Does this conflict with existing patterns in the codebase?{{#isBundle}}
Also probe for cross-task conflicts or missing dependencies between tasks.{{/isBundle}}
{{#combined}}
Review plan.md for each task as well — flag if the approach is unsound.{{/combined}}

**Classify every finding before deciding your verdict:**
- **Blocking**: would cause wrong behavior, a silent bug, or make an AC unimplementable as written. Requires `changes_requested`.
- **Non-blocking (nit)**: an implementation detail Codex can resolve by reading the codebase (prop flow, state threading, naming); a minor ambiguity with an obvious default; a question the plan phase should address. Does NOT require `changes_requested`.

**Verdict rules:**
- `changes_requested` — one or more blocking findings. Spec must be revised before the plan phase.
- `approved_with_nits` — no blocking findings, but non-blocking nits worth passing forward. **Loop exits immediately.** Nits are written to spec-review.md and the plan phase picks them up.
- `approved` — no findings worth noting.

**Batch related nits.** If you have multiple non-blocking observations, include them all in one `approved_with_nits` verdict rather than raising one per round.

If you encounter surprising codebase behavior, append to tasks/<id>/notes.md (prefix: [spec_review]).

For each task, write tasks/<id>/spec-review.md using the template. Set your verdict: approved, approved_with_nits, or changes_requested.

When done, run (one per task with actual verdict):
{{{phaseCommands}}}
