# Spec Review: recalibrate-spec-review-for-stronger-reviewer

> Reviewer: Codex | Spec: `tasks/recalibrate-spec-review-for-stronger-reviewer/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)
- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)
- Is there a materially simpler solution that changes the shape of the work?
- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)

- **Blocking — the targeted prompt mechanism is still unverified, and the revision now makes executed confirmation an explicit Non-Goal.** The current artifacts establish review churn and one clearly out-of-scope final finding, but they do not distinguish “this push-to-find-fault wording causes the over-fire” from task-specific spec quality, the model's behavior independent of that sentence, or another instruction in the rendered prompt. The external sources are corroboration, not a repro: OpenAI's actual heading is “Favor leaner prompts,” and its procedure says to remove one instruction group at a time and rerun the same representative evals; CodeRabbit measured Sol inside its own filtered code-review ensemble, not canon's current prompt against this candidate. The spec instead rejects every executed comparison and relies on a later dogfood run, but an under-firing reviewer produces no observable failure unless an independent oracle finds the blocker it missed. Structural golden and phrase assertions only prove which wording ships. This is a stochastic behavioral fix, so the spec-author checkpoint still needs executed evidence appropriate to that mechanism—a bounded prototype spike on labeled representative specs can satisfy it without creating a permanent research harness. Problem must report that confirmation, and the implementer must be required to reproduce the pre-change disposition before applying the final wording.

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

- none

### Missing Edge Cases

> Scenarios the spec doesn't account for.

- **Non-blocking (nit) — Human Test Plan step 2 drops AC-3's load-bearing carve-out.** It tells the human that untouched pre-existing behavior is always “at most a minor note,” while AC-3 correctly preserves blocking findings for required-but-omitted or transitive dependencies in pre-existing code. Repeat the full excluded-and-verified-unaffected predicate there so human verification does not expect the broader, unsafe rule. AC-3 is unambiguous, so plan/implementation can follow it in the meantime.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

- none

## Verdict

- [ ] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [x] **Changes requested** — spec must be revised before plan phase (list items above)
