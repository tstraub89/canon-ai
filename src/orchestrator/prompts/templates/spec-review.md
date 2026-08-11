You are reviewing {{taskScope}} for {{projectName}}.

{{{startup}}}

Tasks to review:
{{{taskLines}}}

{{#fullSendActive}}
**Full-send mode active**: The human grilled Claude to resolve the decision tree but did not read this spec before pipeline execution, so your review is the primary rigor layer before implementation. The silence default, scope boundary, and verdict rules this prompt sets out still apply — don't manufacture findings. What full-send changes is *where you look*, not how much you flag: give extra attention to (1) missed cases the spec's ACs might overlook, (2) scope drift between the Decision section and the ACs, and (3) ambiguity in AC verification steps, since no human will catch a gap there before implementation.
{{/fullSendActive}}
Grounding rule: if a finding depends on code, a symbol, or a validation result, verify the current file or diff before you claim it exists. If you did not re-open it, do not infer it from memory.

**Your objective: catch genuine blocking problems, precisely.** Read the spec as the implementer would: what would break, be ambiguous, or be missing? A spec with no blocking findings is a valid, expected result — approving a clean spec is not a shortfall in your review.

**First, a strategic read of the spec itself — shape before implementability.** Ask:
- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)
- For a bug or flake fix: does the stated evidence actually establish the targeted mechanism, at the rung its class requires? A deterministic mechanism (fixed inputs hit the same wrong branch every run) may be confirmed by a trace with the verified trigger values; a runtime-dependent mechanism (race, timing, environment/config interaction) requires executed confirmation — a throwaway prototype-fix spike that makes the symptom vanish, or a deterministic forced repro (fault injection, forced race, targeted repro). A paper argument can rule out a wrong hypothesis but doesn't by itself verify a runtime-dependent cause. Blocking Shape Check concerns: no confirmation evidence at all, evidence below the mechanism class's required rung, or a missing red-first regression-test AC without the environment-bound-and-impractical escape. Each role owns a checkpoint: the spec author states the confirmed mechanism and its evidence in *Problem*; the reviewer (Codex) challenges whether that evidence establishes the root cause; the implementer runs the spec's red-first test against the pre-fix code (or, under the environment-bound-and-impractical escape, its named deterministic alternative) and reports the result in the handoff.
- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)
- Is there a materially simpler solution that changes the shape of the work?
- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)

**Silence is the default — for this whole review, Shape Check and implementability alike.** Only write a finding where something is actually off; do not manufacture one to fill a section or satisfy an obligation. A real shape concern becomes the lead reason for a `changes_requested` verdict; write it under the Shape Check section in spec-review.md. If none, leave that section as "no concerns" and proceed.

Then for each task, apply that same default while probing implementability: Can this be implemented as written? Are ACs testable and unambiguous? Are edge cases handled? Are there type safety gaps? Are there file/interaction dependencies Claude missed? Does this conflict with existing patterns in the codebase? An empty list here is a valid result, not a gap in your review.{{#isBundle}}
Also probe for cross-task conflicts or missing dependencies between tasks.{{/isBundle}}
{{#combined}}
Review plan.md for each task as well — flag if the approach is unsound.{{/combined}}

**Scope boundary.** Pre-existing behavior the task's spec *explicitly excludes and verifies as unaffected* (for example, named in Non-Goals) is out of scope for this review — a nit at most, never blocking. This carve-out does not cover: a change the spec *should* make but omitted (a required caller, parser, migration, or test surface), a transitive effect of the change, or an internal contradiction between spec sections — those remain **blocking** implementability findings even though the affected code is pre-existing. The test is not "can I reach this code" — it's whether the spec named it out of scope and showed it stays unaffected.

**Classify every finding before deciding your verdict:**
- **Blocking**: would cause wrong behavior, a silent bug, or make an AC unimplementable as written. Requires `changes_requested`.
- **Non-blocking (nit)**: an implementation detail Codex can resolve by reading the codebase (prop flow, state threading, naming); a minor ambiguity with an obvious default; a question the plan phase should address. Does NOT require `changes_requested`.
- *Example*: an under-specification whose intended value the surrounding task context makes obvious (e.g. a field name implied by an adjacent example or existing convention) is a nit for the plan phase, not Blocking.

**Verdict rules:**
- `changes_requested` — one or more blocking findings. Spec must be revised before the plan phase.
- `approved_with_nits` — no blocking findings, but non-blocking nits worth passing forward. **Loop exits immediately.** Nits are written to spec-review.md and the plan phase picks them up.
- `approved` — no findings worth noting.

**Batch related nits.** If you have multiple non-blocking observations, include them all in one `approved_with_nits` verdict rather than raising one per round.

**Cross-review rule**: No agent reviews its own output. Claude writes specs → Codex reviews specs. Codex writes code → Claude reviews code.

If you encounter surprising codebase behavior, append to tasks/<id>/notes.md (prefix: [spec_review]).

For each task, write tasks/<id>/spec-review.md using the template. Set your verdict: approved, approved_with_nits, or changes_requested.

When done, run (one per task with actual verdict):
{{{phaseCommands}}}
